# 拥塞控制：Reno / CUBIC / BBR

## TL;DR

1986 年 10 月，Internet 第一次因 TCP 拥塞瘫死。Van Jacobson 1988 论文提出 Reno 的"加性增、乘性减"——人类第一个工作的分布式拥塞控制。三十年里，CUBIC 用三次方窗口函数让 100 ms RTT 的高带宽链路也能收敛；BBR 把"丢包=拥塞"这条假设彻底废掉，改用带宽探测模型。本文从缓冲数学走到内核 `tcp_congestion_control` 框架，再到 BBR v1/v2/v3 的代际差异、Cloudflare/GitHub 部署报告、ECN/L4S 与 bufferbloat——一线运维工程师必须知道的常量。

---

## 一、为什么需要拥塞控制

### 1.1 1986 年 Internet 崩溃事件

1986 年 10 月，从LBL到UCB的一条 32 kbps 链路，因为 TCP 发送方没有节流，吞吐跌到 **0** bps。每秒还是有 N 个包在网络上，但全部进了路由器 buffer 又被丢掉。Jacobson 分析原因写进 1988 SIGCOMM 的经典论文 "Congestion Avoidance and Control"——人类第一次系统性认识"网络拥塞崩溃"。

### 1.2 IP 层不告诉你"网络忙"

```
+--------+    IP 不反馈     +---------+    IP 不反馈      +-------+
| sender | ───────────────> | router  | ─────────────> |receiver|
+--------+                  +---------+                  +-------+
                                  │
                                  ▼
                            buffer 满 → drop
                            (没有 vilket backpressure)
```

IP 是无反馈的 best-effort，于是发送方只能从两类"间接信号"反推拥塞：
1. **丢包**（buffer 满了，包没到）
2. **RTT 变长**（buffer 在变满）

经典的"水桶模型"：

```
B (bottleneck rate)      [queue depth q(t)]        μ (egress rate)
source ─────────────────>|| buffer ──────────────> link
                              ↑ q_full → drop
```

- 当 source rate > μ：buffer 不断累 → 满后丢包
- 当 source rate < μ：未充分利用
- 当 source rate = μ 但接近满：**任何小抖动**都会触发丢包 → "blade edge" 区域

```
  throughput
     ↑
     │     /\
     │   /    \   ← saw-tooth (锯齿)
     │ /        \
     │/          \
     └───────────────→ 时间
```

### 1.3 公平性、收敛性、稳定性

三个并列目标，难同时达到：
- **收敛性（fairness）**：两流共享链路最终应平分带宽
- **效率**：稳态时 sum 流量 = bottleneck capacity
- **稳定性**：合套收敛后不能震荡破坏

Reno 给出 **AIMD** (Additive Increase, Multiplicative Decrease) 答案，被 30 年证明"在稳态公平 + 收敛"上是博弈论意义下的最佳策略（Chiu & Jain 1989）。

---

## 二、Reno（RFC 5681 标准化版）

### 2.1 三个阶段 + 状态机

```
                 lost (timeout)
                    ┌────────────┐
                    │            ↓
                ┌──────┐    ┌─────────────┐
                │ Slow │    │ Congection  │
        ┌──────>│Start │    │ Avoidance   │
        │       └──────┘    └─────────────┘
        │          │            ↑
        │          │ 3 dup ACK │
        │          ↓            │ cwnd /= 2
        │       ┌──────────┐   │ + fast retransmit
        │       │  Fast    │   │
        └───────│ Recovery │───┘
          loss  └──────────┘
```

| 阶段 | cwnd 行为 | 触发 |
|------|-----------|------|
| Slow Start | 每 ACK `cwnd++`（指数增长） | 连接开始 / RTO 后 |
| Congestion Avoidance | 每 RTT `cwnd += 1 MSS`（线性） | `cwnd >= ssthresh` |
| Fast Retransmit | 立即重传 seg，`cwnd /= 2`, `ssthresh = cwnd/2` | 3 dup ACK |
| Fast Recovery | 持续收新 ACK 时 cwnd 临时加 | dup ACK 之间 |
| RTO Retransmit | `ssthresh = cwnd/2`, `cwnd = 1`, slow start | timeout |

### 2.2 为什么 3 dup ACK

单 dup ACK 可能是乱序（reordering），2 dup 是 spurious reorder 重排路径抖动。RFC 793 不成文：连续 3 dup ACK 是📕较强丢包信号。

但也有缺点：少量丢包（≤ 0.1%）就能 3 dup ACK → CUBIC 打 50%；高 BB link 浪费。

### 2.3 AIMD 数学

让 N 个流共享 C 容量，AIMD 收敛速度：
- 两流不平等：`x_1 + x_2 = C`, `x_1 <x_2`
- 一个 RTT 减半后丢包：两流都 `* (1/2)`，**比例不变但总和 ≈ C**
- 然后双向 +1 MSS / RTT → 平分速度才在 N RTT 内追上

公式：fairness 收敛时间 ≈ `O(N · C / MSS)` RTT。10 Gbps 链路，MSS=1460B，N=4，收敛 RTT ≈ 100ms × 1.7M = **一天**。→ AIMD 在高 BDP 下**根本不收敛**。这是后续 CUBIC 出现的根本动机。

---

## 三、NewReno / SACK

### 3.1 Reno 一次丢多包的悲歌

```
sender: cwnd=12   send 1,2,3,4,5,6,7,8,9,10,11,12
假设 seg 2,5,7 都丢了。
receiver ACK 1, dup 1, dup 1 → sender fast retransmit seg 2
sender  等接收方 ACK 3,4（dup）  
sender 重传 seg 5, ACK 3,4 是 dup 1,之后 ACK 6 dup → 再 fast retransmit  
每一包独立通话 → Reno 退 cwnd 多次。
```

NewReno（RFC 6582）的"partial ACK"：丢一段时 admitting 还有别的丢，cwnd 不会立即回弹，直到所有同一 RTT 窗口丢的都补完。**但**仍是一次只重传一包，效率不够。

### 3.2 SACK（RFC 2018）

receiver 在 ACK option 里带 SACK block：
```
SACK: [seq 1001, seq 2000]    # skip
      [seq 3001, seq 4000]    # skip
      [seq 4001, seq...]      # current ACK point  
sender 一眼看到哪些 seq 收到→只重传丢掉的
```

Linux 默认开（sysctl `tcp_sack=1`，1999 后默认）。没有 SACK 的连接在 0.5% 以上丢包链路上吞吐跌 50%+。

### 3.3 FACK/D-SACK/DSACK

- **FACK** (Forward ACK)：把 SACK 最右边界算 cwnd，更准确反映 in-flight
- **DSACK** (Duplicate SACK)：receiver 收到重复报文时用 SACK 通报 sender，**用于检测假阳性丢包 / 重排**——是 RACK 算法的基础

---

## 四、CUBIC（Linux 2.6.19 默认至今）

### 4.1 动机

Reno 系列在高 BDP（带宽 × 延迟）链路上**线性增**太慢：
- 100 ms RTT × 10 Gbps → BDP = 125 MB ≈ 85k MSS
- Reno + AI 每秒加 100 MSS，从 cwnd/2 = 42.5k 到 85k 需要 425 秒

### 4.2 三次方窗口函数

CUBIC 用纯**时间驱动**的窗口函数：
$$
W(t) = C(t - K)^3 + W_{max}
$$
- $W_{max}$：上次丢包时的 cwnd
- $K = \sqrt[3]{W_{max} \cdot \beta / C}$，$\beta=0.7$（Reno 是 0.5）
- $C$：scaling constant，默认 0.4
- $t$：上次丢包后逝去的时间

凹形曲线：
```
W(t)
 ↑
 │ W_max ··
 │       ·   ·
 │         ·
 │          ·
 │           ·
 │            ·
 │             ·
 └──────────────────→ t
        凹形：离 W_max 远 → 增长慢（让位他人）
              接近 W_max → 加速（探测带宽还多不多）
```

### 4.3 TCP-Friendly 区段

远离 $W_{max}$ 时 cubic 增长慢，会被 Reno 同链路"挤"。CUBIC 用 TCP-friendly mode：当 cubic 计算 cwnd 低于对应 Reno/std AI 路径时切回 Reno-style 增长 → 公平性保住。

```c
// net/ipv4/tcp_cubic.c
if (tcp_cubic_clip>(ca->cnt, mode)) {
    // 切回 Reno 行为 (1/cwnd 每 ACK++)
    ca->cnt = 50;  // 实际是 cwnd/(W_max)
}
```

### 4.4 调优

```bash
$ sysctl net.ipv4.tcp_congestion_control
net.ipv4.tcp_congestion_control = cubic
# 可用算法
$ sysctl net.ipv4.tcp_available_congestion_control
net.ipv4.tcp_available_congestion_control = reno cubic bbr ...
# per-socket
$ setsockopt(fd, IPPROTO_TCP, TCP_CONGESTION, "bbr", 3);
```

---

## 五、BBR（Google 2016）

### 5.1 破除"丢包=拥塞"假设

家用路由器 buffer = 100 MB（bufferbloat 时代）。CUBIC 一直增直到塞满 100MB，然后丢 0.1% 才减半 →**延迟很长时间 100ms+**。在 5G/WIFI 场景 dispose 体验极差。

BBR 用模型驱动：
```
sending_rate = BtlBw × (1/RTTprop)
              ↑             ↑
              bottleneck    光速往返延迟（不含排队）
              bandwidth
```

并维持 O(1) 队列：cwnd = `BDP + ε`，永远只让 buffer 啃 200ms 队列深度前的小补丁。

### 5.2 四个状态

```
            start
              │
              ↓
       +──────────+
       | Startup  |   ← 2× 探测带宽
       +──────────+
              │  (BtlBw 稳定)
              ↓
       +──────────+
       | Drain    |   ← 排空 startup 期积压
       +──────────+
              │
              ↓
       +──────────+
       | ProbeBW  |   ← 8 个节拍 cycle: gain 1.25/1/0.75 ...
       +──────────+      | (probe 先 1.25×，溢出后 0.75×)
              ↑          ↓
              │     +─────────────+
              │     |  ProbeRTT  |  ← 每 10s 进 200ms cwnd=4 MSS
              └─────|             |   测 RTTprop
                    +─────────────+
```

- Startup：cwnd 加速，2× 每 RTT。当 BtlBw 不再涨（≥3 个 RTT 增速增长不变）→ Drain
- ProbeBW：周期 `gain ∈ {1.25, 0.75, 1, 1, 1, 1, 1}` 7 阶段
- ProbeRTT：每 10s 检查一次 RTTprop，cwnd 短暂封顶 → 测真实 RTT

### 5.3 BBR 的丢包检测 (RACK)

BBR 不靠 3 dup ACK 判丢，**而是 RACK** (Recent Acknowledgement, RFC 8985)：
- ACK 100 后 seg 90 还没 ACK → 90 真的"丢了"
- 用 ACK 到达序列而非 dup ACK 数量
- 同时支持乱序、spurious

### 5.4 BBR v1 的痛点

1. **不公平**：BBR 与 Cubic 共用链路，BBR 赢 100%（因 BBR 不退避）
2. **BBR 多个 BBR 不平分**：Startup 期都 2×，反复冲撞
3. **RTT 测不准**：浅 buffer 旁路，BBR 误认为是真实 RTTprop
4. **过冲**：startup 2× 容易瞬间在浅 buffer 上丢包

### 5.5 BBR v2/v3

Google 2019 推 BBRv2，2023 v3：
- 加入 ECN 反馈（早接收拥塞）
- ProbeBW gain 不再 1.25× 硬探测 → 改成"小步 5%"
- ProbeRTT 节拍自适应
- 多 BBR 流公平性靠共享 BtlBw 估计收敛
- 限速更响应 cross-traffic

```bash
# 内核 5.4+ 才有 BBR，5.18+ 有 BBRv2 alpha
sysctl -w net.ipv4.tcp_congestion_control=bbr
sysctl -w net.ipv4.tcp_congestion_control=bbr2   # 需要 patch
```

### 5.6 生产部署观测

**Cloudflare 报告**：边缘 L4 LB 后用 BBR 出口，P99 延迟降 8×（buffered 5G Wifi）。但单边改成 BBR，下游 ISP "永远不 backoff"的同样在限速，BBR 策略给实际劣势。

**GitHub**：2018 切 BBR 后内部 RPC P99 ↓30%。但 SSH 长连接公平性下降。最终维持 cubic + 个别路径 BBR。

**YouTube**：手机 SDK active link BBR → 起播时间 ↓11%，复播 4%。

### 5.7 BBR 数据中心内的"反_assoc"问题

数据中心内部 DCQCN / DCTCP / HPCC（存储/HPCC）会与新加入 BBR 冲突。模式：
- RDMA 用 RoCEv2 用 ECN/PCP，是 NIC 实现
- BBR 在网卡 / 内核 socket 层不感知 RoCE 信号
- 混部时 BBR 看到 RoCE 流量"挂"很久，误判 RTTprop→ 窗口大幅缩水

→ 数据中心内部**仍优先拥塞控制做在 NIC** (Mellanox CX-7 等)，TCP BBR 留给跨数据中心 WAN。

---

## 六、ECN、L4S 与未来

### 6.1 ECN (Explicit Congestion Notification, RFC 3168)

IP header TOS 字段 2 bit 编 ECN 标记：
- `00` = Non-ECT, `10/01` = ECT(0/1), `11` = CE (Congestion Event)

设备 buffer 接近满 → **标记不丢**，receiver 复制到 ACK 用 ECE/CWR flag 回 sender。Sender 收到 ECE 后减 cwnd。**无损数据中心的关键**。

### 6.2 L4S (Low Latency, Low Loss, Scalable Throughput, RFC 9330)

2020+ 新一代互联网框架：精度可调节的 ECN 配合新算法（Google Prague/HPCC）/可扩展拥塞控制，目标 **ms 级排队**。
- 公网尚未部署
- 5G slicing、家庭 Gbps FTTH 是潜在市场

### 6.3 AQM（Active Queue Management）

- **RED**：经典（随机小丢）
- **FQ-CoDel**：Linux 默认 qdisc，多流 fair queuing + CoDel 探测
- **CAKE**：FQ-CoDel 升级版，家用 ISPrange 推

```bash
$ tc qdisc replace dev eth0 root cake bandwidth 100M
# 配家用 IS Praxisl 100M，ca 队列会做 fair + 内置 shaper
```

---

## 七、内核代码导览

```c
// net/ipv4/tcp_congestion.c
int tcp_register_congestion_control(struct tcp_congestion_ops *ca) {
    // 把算法挂到全局 ca_list
}

// net/ipv4/tcp_cubic.c
struct tcp_congestion_ops cubictcp = {
    .init           = cubictcp_init,
    .ssthresh       = cubictcp_recalc_ssthresh,
    .cong_avoid     = cubictcp_cong_avoid,   // 核心
    .set_state      = cubictcp_state,
    .undo_cwnd      = tcp_reno_undo_cwnd,
    .cwnd_event     = cubictcp_cwnd_event,
    .pkts_acked     = cubictcp_acked,
    .owner          = THIS_MODULE,
    .name           = "cubic",
};
```

每个 socket：`inet_csk(sk)->icsk_ca_ops` 指向当前算法。`tcp_cong_avoid` 每收到 ACK 调一次：
```c
void tcp_cong_avoid(struct sock *sk, u32 ack, u32 acked) {
    const struct inet_connection_sock *icsk = inet_csk(sk);
    icsk->icsk_ca_ops->cong_avoid(sk, ack, acked);   // cubic / bbr / ...
    tcp_sk(sk)->snd_cwnd_stamp = tcp_jiffies32;
}
```

BBR 的实现在 `net/ipv4/tcp_bbr.c`，~1500 行，主要维护 4 个状态元：
```c
struct bbr {
    u32 min_rtt_us;     // RTTprop 估计
    u32 mIN_rtt_stamp;
    u32 bw_lo, bw_hi;
    u32 cycle_idx;
    u32 mode: 3, ...
};
```

---

## 八、生产事故

### 事故 1：机房切片 BBR 启用后吞吐萎缩

切换 BBR 后跨机房 replication 流量从 5 Gbps 跌到 1.5 Gbps。抓包：BBR ProbeRTT 周期触发频繁（10s 节拍太敏感），中和 ISP 的"限制速率"，窗口一直被压小。

**修复**：恢复 cubic + 切到云厂家私有拥塞控制（如 AWS 的 "cdg"）。

### 事故 2：CUBIC 大 RTT 与短流不公

新 Italy IDC 与新加坡 EC2 走 IPSec VPN，RTT 220ms。DB backup 流（cubic）和短小 API 流共享链路，backup 独占带宽。

**修复**：用 `tc` 分级 + HTB qdisc 限流 backup，或改用 BBP-aware 协议(rdma) / per-flow QoS。

### 事故 3：bufferbloat 让 Zoom RTT 跳 1200ms

家庭 1 Gbps 互联 PC 直插电信，路由器 buffer 深 256MB。Zoom 与 Steam 后台下载同链路，Cubic 一直加 cwnd 占满 buffer，Zoom RTT 1200ms。

**修复**：路由器启用 `CAKE` qdisc 显式低延迟带宽限速：
```bash
$ tc qdisc replace dev eth0 root cake bandwidth 100mbit besteffort nofrag
```

### 事故 4：SACK 关闭导致跨机房吞吐骤降

某应用 socket option 显式 `setsockopt(TCP_SACK, 0)`（被误认为 sec advisory）。0.5% 丢包链路上 throughput <10% capacity。

**修复**：默认 SACK 必须开，把代码移除，部署 patch 灰度。

---

## 九、易错清单

1. **慢启动不慢**："slow" 指"逐渐启动"，不是低带宽；每 ACK cwnd++ 实际指数增长
2. **CUBIC 不一定比 Reno 快**：在不稳定高丢包链路 (5G 弱信号) Reno 反而稳，CUBIC 凹函数回弹慢
3. **BBR 不依赖丢包**——但 BBR v1 在**多 BBR 流间**不公平，需要 v2
4. `tcp_congestion_control=bbr` 是全局默认，per-socket 可在 setsockopt 覆盖
5. **ECN ≠ ECE**：ECN 是 IP 层标记，ECE/CWR 是 TCP 层 flag
6. **拥塞控制 ≠ 流控**：流控由 rwnd（接收方反馈），拥塞控制由 cwnd（发送方自己控）
7. **Don't 在数据中心内部启 TCP BBR**：与 RoCE ECN 冲突，会撕 RTTprop 估错

---

## 十、这一章带走的东西

1. 拥塞控制是发送方单边探测 → 缓冲数学模型 → AIMD 在低 BDP 下最佳，高 BDP 需 cubic/BBR
2. Reno → NewReno + SACK → CUBIC → BBR，一线从"丢包为信号"到"模型为信号"，BBR v2 解决公平
3. Linux 默认 cubic；公网边缘 BBR 体验优；数据中心内部 NIC 拥塞控制 (DCQCN/HPCC)
4. ECN 让"不丢包"的拥塞反馈成为可能；L4S 是 ms 级排队未来
5. bufferbloat 缓解：CAKE/FQ-CoDel 在家庭网络收益最大
6. `tcpdump` + `ss -ti` 看 `cwnd`/`ssthresh`，`nstat TcpExtTCPSpuriousRTOs` 监控假阳性

## 下一节 →

[重传机制](./retransmission.md) — RTO 估算 (RFC 6298)、SACK、RACK、TLP、F-RTO、ER 诸多"我用尽一切手段救你 RTO"。
