# BBR 在 QUIC 下的表现

## TL;DR

BBR 在 QUIC 内部的表现与在 TCP 上有几个关键差异：QUIC 的 ack_delay 字段让 RTT 估计**完全干净**、packet number 单调让丢包检测无歧义、每 stream 独立流控让 cwnd 模型更清爽。但 BBR v1 与 CUBIC 共享 QUIC 时不利公平性仍然存在、CPU overhead 上 user-space AEAD 加密 + pacing 是部署挑战。本节分析 BBR 在 QUIC 实现层的细节、Cloudflare/Akamai 公开数据、关于 BBR v2/v3 在 QUIC 的部署时间表、以及一线部署的真实权衡。

---

## 一、TCP+BBR vs QUIC+BBR 的协议差异

### 1.1 RTT 估计

TCP+BBR 用 `tcp_timestamps` option：
- receiver echo TSecr 回 sender
- sender 算 sample = now - TSecr - **但 sender 不知道 ACK 是否延迟合包**
- BBR v1 假设 ack_delay = 0 → 在 socket coalescing 估算偏低 → BBR cwnd 估 60% → 吞吐 ×0.5

QUIC+BBR：
- ACK frame 中 `ack_delay` 字段（µc/2^N）
- sender 直接回算：`sample = now - send_time - ack_delay`
- BBR 的 RTTprop 不被任何"杂音"污染

实测：在 Cloudflare CDN 上 BBR v1 RTT 估计 50ms 平均，TCP+BBR 是 65ms（15ms 是 ack delay）。

### 1.2 丢包检测

TCP+BBR：
- BBR 用 RACK 之类算法决定丢包
- 依赖 dup ACK count + timestamp
- 在网络包 reorder 时 spurious 快噪

QUIC+BBR：
- ack_ranges frame 让 sender 直接看哪些 packet 已 ack
- packet number 单调 → 包 50 acked 但包 49 没 → 包 49 已丢
- 完全无 dup ACK amount + RACK 复杂度
- BBR loss event 是精确事件

### 1.3 Pacing

BBR 关键思路之一是**pacing rate**（不是单纯 cwnd）：每包发送间隔 = `paced_interval = MTU / pacing_rate`。

TCP+BBR：pacing 落入 qdisc (fq, cake, sch_fq_codel) 实现，但很多 server iptables Layer 4 不支持，pacing 退化为 burst。
QUIC+BBR：user space 主控 timer，每 packet 直接控制 sleep time。`std::time::Duration`:

```rust
let next_send_at = last_packet_send_time + packet_pacing_interval;
sleep_until(next_send_at);
```

精度可达 µs。但 CPU 占用：user-space timer → 多 thread ≈ kernel ctx switch + latency。pacing 量 100 ns/packet provider 微进程 context switch limiting。

---

## 二、QUIC 拥塞控制接口与生态

### 2.1 RFC 9002 给的接口

```python
# Congestion control API (RFC 9002)
class CongestionController:
    def on_packet_sent(self, pn: int, bytes: int, in_flight_bytes: int): pass
    def on_packet_acked(self, acked_packets: List[int], now: float, ack_delay_us: int): pass
    def on_packets_lost(self, lost_packets: List[int], now: float): pass
    def on_rtt_measurement(self, rtt_us: int, now: float): pass
    def on_congestion_event(self): pass
    def loss_detection_timer_expired(self): pass  # PTO 超时

    # state accessor
    def congestion_window(self) -> int: pass
    def bytes_in_flight(self) -> int: pass
    def pacing_rate(self) -> int: pass  # bytes/sec, optional
```

`on_packet_acked` 传 `ack_delay_us` → CC 算法可以直接用。

### 2.2 主流库的 CC 实现

| 库 | NewReno | CUBIC | BBR v1 | BBR v2 | BBR v3 |
|----|---------|-------|--------|--------|--------|
| quiche (Cloudflare) | 默认 | 是 | 是 | 是 | 试验中 |
| quic-go | 默认 | 是 | 是 | 否 | 否 |
| lsquic | 默认 | 是 | 是 | 是 | trial |
| msquic | 是 | 是 | 是 | is | trial |
| ngtcp2 | 是 | 是 | 是 | 否 | 否 |

部署 BBR 在 QUIC 一般直接 setsockopt / config 走特定校准。

```rust
let mut config = quiche::Config::new(quiche::PROTOCOL_VERSION)?;
let cc = quiche::congestion::BBR::new();
config.set_congestion_control(cc);
config.set_initial_congestion_window(10 * 1460);  // 14 KB initial cwnd
config.set_max_idle_timeout(30_000);
config.set_max_send_udp_payload_size(1452);
```

---

## 三、BBR v1 在 QUIC 实测

### 3.1 Cloudflare 部署数据

Cloudflare 在 2022 起全线 QUIC + BBR v1：
- HTTP/3 流量从 5% 升到 28%
- P99 latency 同等地 ~9%
- 重传包数下降 5×
- RTT 估计均匀 ± 3ms（TCP+BBR 是 ± 30ms drift）

### 3.2 BBR v2 在 lsquic 公布

Akamai + Facebook 在 lsquic 测 BBR v2:
- ECN support 让 probe 不丢包 → bufferbloat era 0
- ProbeBW 涨幅从 1.25x 降到 1.05x → 公平性提升
- ProbeRTT 周期更长，让 cwnd 不震荡

公平性对比（同链路）：

| 流量组合 | CUBIC 公平 | BBR v1 公平 | BBR v2 公平 |
|----------|------------|-------------|-------------|
| 2× CUBIC | 50%/50% | - | - |
| 2× BBR v1 | 70%/30% | BBR 80%/🍦 | 80%/20% |
| BBR+CUBIC | 80%/20% | - | 55%/45% |
| 2× BBR v2 | - | - | 52%/48% |
| BBR v2 + CUBIC | - | - | 58%/42% |

BBR v2 在 BBR self-fairness 和 CUBIC 兼容性有显著进步。

### 3.3 BBR v3 时间表

Google 内部 2024 测试 BBR v3，2025+ Cloudflare trial。BBR v3 主要改进：
- ECN-V (L4S-ECN) support
- inline RACK-TLP 集成
- 长窗口 burst control (各 stream 不孤军打)
- 客户端 BBR aware <-> server 间参数共享 (extension)_CONF DRAFT

---

## 四、QUIC 流量整形与 pacing

### 4.1 pacing rate

```rust
// lsquic pseudo-code
fn on_packet_acked(acked_packets, ack_delay_us, now) {
    let rtt_sample_micros = (now - self.send_time(largest_acked)) - ack_delay_us;
    self.rtt_estimator.update(rtt_sample_micros);

    self.bw_estimator.on_acked(acked_packets, rtt_sample);
    self.update_pacing_rate();
}

fn update_pacing_rate() {
    let bw_bytes_per_sec = self.bw_estimator.bottleneck_rate();
    let rtt = self.rtt_estimator.min_rtt();
    let cwnd = bw_bytes_per_sec * rtt / 1_000_000 + 10 * 1460;   // BDP + 10 MTU
    let pacing_rate = bw_bytes_per_sec * 1.25;  // 1.25× → probe bw
}
```

实际 UDP socket 可用 `setsockopt(SO_TXTIME)` 与 cmsg / ECN：

```c
struct scm_timestamping tso = { ... };
cmsg.cmsg_level = SOL_SOCKET;
cmsg.cmsg_type = SO_TXTIME;
cmsg.cmsg_len = CMSG_LEN(sizeof(uint64_t));
*(uint64_t*)CMSG_DATA(&cmsg) = next_send_ns;
```

Kernel 5.x with `socket_txtime_launching` 支持精确发送时间——支持 user-space pace 而不全层 setTimeout。

### 4.2 多 stream 共享 cwnd

QUIC 是单 conn + 多 stream，cwnd 是**连接级别**，但每 stream 有独立窗口：
```
conn cwnd = 100 KB (shared)
stream A window 16 KB
stream B window 32 KB
...

A + B computed = 48 KB ≤ cwnd = OK
入flight 上限 = min(sum stream window, conn cwnd)
```

scheduler 决定**pacing 在多个 stream 间公平分**：
```rust
fn pick_next_packet(&self) -> Option<Packet> {
    // weight round-robin, byte quota
    let mut max_byte = 0;
    let mut picked = None;
    for stream in self.streams.values() {
        if stream.pending_bytes() > max_byte {
            max_byte = stream.pending_bytes();
            picked = stream;
        }
    }
    picked.pop_packet()
}
```

防 stream hog: Weighted Fair Queueing，权重可动态调整以响应用户体验。

---

## 五、QUIC over UDP 实战 band不公平问题

### 5.1 BBR v1 占满 buffer

```
链路 100 Mbps, BDP 50 KB
QUIC BBR v1: cwnd ≈ BDP = 50 KB → 但 probe 涨到 1.25 × BDP + ε → buffer 占 12.5 KB
TCP CUBIC: cwnd 涨直到丢包，buffer 占满 100 MB → 谁先丢谁退
同链路 2 流: BBR 不退、CUBIC 退 → BBR 占 80%+ 带宽
```

### 5.2 解决方案

- BBR v2/v3 + ECN 改善 → CUBIC 不退太多
- 共情流 (cross-flow CUBIC) 仍保 30%
- ISP 端 rate-limit (Circlular buffer shaping) 抑制 burst

### 5.3 数据中心 FFT

数据中心内部使用 DCQCN (RoCEv2) 与 TCP BBR 不交错。同样 QUIC BBR:
- ECN 标记 (DCQCN)：QUIC BBR 可读 IP ECN bit → 退避 cwnd
- 但 BBR v1 不响应 ECN，必须 v2 或自实现 patch
- HPCC（RDMA 新算法）不与 BBR 兼容

→ 数据中心内 QUIC BBR **不推荐**，留 CUBIC 或 DCQCN。

---

## 六、产线事故

### 事故 1：BBR v1 + CUBIC 共线，CUBIC 流饿死

数据中心边缘 eBPF 出口：BBR 流 push 占满 1 MAC upstream，同链路一台 server CUBIC 流 throughput 跌 90%。

**修复**：CUBIC 流调 `tcp_cong_control=bbr` 或在配置上分带 rate-limit。或在出口 fq_codel Qdisc 公平排队。

### 事故事 2：QUIC BBR RTTprop 探测失灵

某机房 RTTprop 探测周期 200ms（ProbeRTT cwnd=4），但 minimal RTT 测出 50ms（实际 5ms）。因为 RTO RTOProbe 期间 RTTprop 被误设为 50ms（startup 期）后一直未刷新。

**修复**：调长 ProbeRTT 触发周期 + monotonically decreasing min RTT filter；调用 BBR v2/v3。

### 事故 3：BBR v2 与 CUBIC 公平性测试u

某 cloud 多租户出5000 tenant 共出 Ten Gbps，BBR v2 仍抢 5× CUBIC。换 NewReno (压明 cto)，公平性 50-50。运营商基础流 throughput 不到 5Gbps。

**修复**：默认 NewReno，超带宽 quota 客户启 BBR v2 + ECN。运维层面 enforce per-tenant 之路 quota + fq_codel。

### 事故 4：PMTU 探测错

QUIC 起 DPLPMTUD probe，发现 1500B 但实际对方 router 节流 ICMP PTB → packet 被 silent drop。

**修复**：调低 max_udp_payload_size = 1452 (QUIC recommended)，显式 PMTU 探 分阶段后备。

### 事故 5：0-RTT 与 BBR  cwnd 估计错

0-RTT 早期 data 100KB 已 in-flight，但 server 还没收到 NewSessionTicket + 后：BBR 估 cwnd = 100KB → 用 0-RTT data 与 normal data compute concurrency → cwnd follow too low → 吞吐跌。

**修复**：BBR v2 + psk_dhe_ke + Initial cwnd reset on Full handshake completion (RFC 9002 §A.7)。

---

## 七、易错清单

1. **BBR v1 在 QUIC 仍不公平**：仅 v2 才能 + ECN 启
2. **DPLPMTUD 在 ICMP 锁路由不响应**：必须 fallback to 1452B 避免 silent drop
3. **D-CUBIC vs QUIC BBR**：链路中 mixed，BBR 占 80% → CUBIC 流饿
4. **0-RTT 早期 data 不在 cwnd 计算** 有人误以为 → 应 include
5. **多 stream 共享 cwnd，单一 stream 不能独占**
6. **Pacing rate 用 fq qdisc 配合** 在 QUIC user-space 不必走 fq
7. **数据中心内 QUIC BBR 不推荐**：与 DCQCN/HPCC 不兼容

---

## 八、这一章带走的东西

1. QUIC+BBR 让 RTT 估计从 ± 30ms drift 提到 ± 3ms，pacing 精度 ~us
2. ACK frame `ack_delay` 字段是 BBR RTTprop 测准的根本
3. 各库支持 BBR v1 普及，BBR v2 在 quiche/lsquic 可用；BBR v3 2025+ Cloudflare trial
4. 与 L4S / ECN + BBR v2 是未来 bufferbloat 路径
5. QUIC 多 stream 共享 cwnd + per-stream flow control，scheduler 决定公平分
6. 数据中心 BBR 不推荐；公网边缘 CDN BBR 收益最大
7. SO_TXTIME 内核支持让 user-space pacing 不靠 setTimeout 精度大

## 下一节 →

[Part 4 · 数据库系统](../../databases/index.html) — SQLite 与 Postgres、MySQL、Redis；存储引擎：B-tree / LSM / Page；事务：MVCC / WAL / 2PL；查询：RBO / CBO / HashJoin / SortMergeJoin。
