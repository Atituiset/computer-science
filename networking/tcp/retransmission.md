# 重传机制：RTT / RTO / SACK / RACK / TLP

## TL;DR

TCP 可靠字节流全靠"序号 + ACK + 重传"三条腿。最难的一段是"什么时候重传"——RTO 早了误重传浪费带宽，晚了延迟翻倍。本文从 Jacobson 1988 EWMA 公式追到 Linux `tcp_rtt_estimator`，再到 SACK / DSACK / F-RTO / RACK / TLP / ER 这一系列 RFC 9002 时代的演进，最后到 QUIC 在应用层重写一遍——告诉你协议为什么进化、内核代码怎么改、生产者看到什么告警。

---

## 一、为什么重传这么难

单包送出去，sender 看到的反馈只有一类信号 = **ACK 序号**。三种可能性：
```
| ACK seq |      解读                       | sender 反应
| < send  |  乱序 / 丢 ACK                  | 等
| == send |  接收方收到了                    | 推进 cwnd
| > send  |  接收方收到但回更前的 ACK (dup) | dup ACK++，可能丢包
| RTO 触发| 网络在某段时间没回任何信号      | 退 cwnd=1, slow restart
```

设计目标：
- **早发现**（少占 buffer，省 RTO）
- **少误判**（重传好的包 = 浪费带宽 + 多余 RTO 重设）
- **抗乱序**（route flap → seq 顺序到达破坏，不是丢）
- **抗 ACK delay**（ипподрöm 不回立刻 ACK）

四十年里这四条反复写新 RFC。

---

## 二、RTT 估计（Jacobson 1988 EWMA）

### 2.1 朴素均值的历史失败

```python
# 平均:  naive = sum(samples) / N
# 问题1: 流式窗口大小? 100 包? 1000 包?
# 问题2: 网络条件不会"瞬间变化"，平滑响应慢
```

1988 Jacobson 用**指数加权移动平均 (EWMA)**：

$$
\text{SRTT} = (1 - \alpha) \cdot \text{SRTT} + \alpha \cdot \text{SampleRTT}
$$

$$
\text{RTTVAR} = (1 - \beta) \cdot \text{RTTVAR} + \beta \cdot |\text{SRTT} - \text{SampleRTT}|
$$

$$
\text{RTO} = \text{SRTT} + \max(G, 4 \cdot \text{RTTVAR})
$$

- $\alpha = 1/8$：每 RTT 内 8 个 sample，权重平滑
- $\beta = 1/4$：变化项权重 4 × 大
- $G$ = clock granularity (Linux jiffies，约 1ms)

核心直觉：**让 RTO 比 SRTT 大约 4 × RTTVAR**——历史波动越大，预留越宽。

### 2.2 Linux 实现

```c
// net/ipv4/tcp_input.c
static void tcp_rtt_estimator(struct sock *sk, const __u32 mrtt) {
    struct tcp_sock *tp = tcp_sk(sk);
    long m = mrtt;

    if (tp->srtt_us) {                                    // 已有 SRTT
        m -= (tp->srtt_us >> 3);                          // SRTT 新减老
        tp->srtt_us += m;                                 // SRTT = (7/8)*旧 + (1/8)*新
        if (m < 0) m = -m;
        m -= (tp->rttvar_us >> 2);
        tp->rttvar_us += m;                                // RTTVAR EWMA
    } else {
        tp->srtt_us = m << 3;                              // 初值 = 样本 * 8（移位等价 ×8）
        tp->rttvar_us = m << 1;                            // = 样本 * 2
    }
}

// 再调 tcp_set_rto()
__u32 tcp_set_rto(struct tcp_sock *tp) {
    return usecs_to_jiffies(max(tp->srtt_us + (tp->rttvar_us << 2), 1));
}
```

等价数学：`RTO = SRTT + 4 * RTTVAR`，**封顶** RTO 受 sysctl 控制：

```bash
$ sysctl net.ipv4.tcp_min_rto_wtime net.ipv4.tcp_max_rto_wtime  # 实际只有 min/max
$ cat /proc/sys/net/ipv4/tcp_min_rtt_timeout     # 200ms
$ cat /proc/sys/net/ipv4/tcp_retries2            # 15（重传次数上限）
```

### 2.3 Karn's Algorithm (RFC 2988)

不能用"重传过的包"算 RTT——你没法区分收到的 ACK 是 ACK 原包还是 ACK 重传包。Karn 算法：**重传过的包不参与 RTT 估计**。

### 2.4 Timestamp Option (RFC 7323)

解决 Karn 问题：每个 segment 携带 sender 写入时戳 TSval，receiver 在 ACK 中回 echo TSecr —— sender：
```c
sample_rtt = now - TSecr
```
每个 ACK 都能算 RTT 即便重传过也准确。Linux 默认开 (`net.ipv4.tcp_timestamps=2`，4.13 后用 RTC mode == 2，旧 RTT=1)。

> [!NOTE]
> Timestamp TSval 是 **单调递增**（kernel usec 时钟），不是 wall clock。echo 回来 kernel 在 ACK 中直接读 TSecr，不必管理回声对应。

### 2.5 RTT 估错的灾难

家用 4G 移动网络 RTT 抖动 5x 是常态：
```
RTT 50ms (基站拥塞) → RTT 200ms (基站恢复)
```
EWMA α=1/8 要 8 RTT 才追上。期间 RTO = 50+4×50=250ms 远小于实际 200ms 的 ACK 到达 → 假阳性 RTO → cwnd=1 重启。

Linux 的 F-RTO (RFC 5682) 改善：
1. RTO 触发，重传 + 等 ACK
2. 来的 ACK 若推进窗口 → 当初 RTO 是 spurious → 撤销 cwnd=1
3. 否则真丢 → 继续 slow start

`net.ipv4.tcp_frto=2` 默认。

---

## 三、RTO 调优盘

### 3.1 退避算法（RFC 6298 §2.5）

```c
icsk->icsk_rto = max(icsk->icsk_rto, icsk->icsk_rto << 1);  // 每次超时翻倍
// tcp_retries1=3, tcp_retries2=15 -> 在到达 N 次后 abort
```

RTO指数退避：

| 触发次数 | RTO 倍（粗略） |
|---------|----------------|
| 1 | 1× |
| 2 | 2× |
| 3 | 4× |
| 4 | 8× |
| 5 | 16× |
| 6 | 32× |
| 7 | 64× (Linux 上限 60s) |

`tcp_retries2=15` 最终 abort (~924 秒)，默认。

### 3.2 慢启动阈值 + ER (Early Retransmit, RFC 5827)

cwnd < 4 时**永远凑不齐 3 dup ACK**，就要 RTO。ER 算法：`DupThresh = max(2, cwnd-1)` —— 让小 cwnd 也能早重传。

`net.ipv4.tcp_early_retrans=3` Linux 4.x 默认。

---

## 四、SACK（RFC 2018，Linux 1999 默认开）

### 4.1 协议结构

```c
TCP Header option:
+---------+---------+---------+---------+
| Kind=5  | Length  | LeftEdge 1 | ...
+---------+---------+---------+---------+
```

每 ACK 最多带 **3 个 SACK block**（受 option 40B 限制，4 个的话没空间给 TS）。

```
   sender                              receiver
     seq=10 ────────────> recv ok
     seq=20 ────────────> LOST
     seq=30 ────────────> recv ok
     seq=40 ────────────> recv ok
     seq=50 ────────────> LOST

     ACK 11, SACK [30, 40], [40, 50]
       ↑ 如何解读:
         我已确认的是 10-19
         我同时也收到了 30-39 和 40-49
         我没收到 20-29 和 50-59
       sender 知道只重传 seg 20 和 seg 50
```

### 4.2 sender 的 scoreboard

```c
struct tcp_sock {
    struct sk_buff_head write_queue;
    struct tcp_sack_block scoreboard[TCP_NUM_SACK];  // 4 个 slot
    struct tcp_sack_block duplicate_sack[1];
    u32 sacked_out;            // SACKed 数
    u32 retransmitted;          // 重传次数
};
```

每个 SKB 维护 `sk_buff_state_bits`，标记 `S7` (acked)、`S_LOST` 等。Linux 的 `tcp_mark_head_lost` 选择"应该重传"集合。

### 4.3 DSACK (Duplicate SACK, RFC 2883)

receiver 收到 sender 重传的包 → 完成 sender 重传任务。但发现：
```
ACK 100 (3001, 4000)        ← SACK block: 我没收到 30 号包
sender 收到 → 重传 seg 30
ACK 200 (3000, 3001)        ← 我之前误认丢了的 30 实际收到了，但新到的是重复
```
DSACK 块的左边界 < ACK 中序号 → 告知 sender "你重传多了"。

Linux 用 DSACK 触发 F-RTO + TCP mistimes summ：累计 3 DSACK → 信任 RTT 估计偏小，调高 RTO （`tcp_rack_mark_lost` 中的 spurious 检测）。

### 4.4 FACK / RACK

- **FACK** (Forward ACK, 1996)：用最右 SACK 边算 in-flight → RTO 更准
- **RACK** (Recent ACK, RFC 8985)：现代替代，2017 后 Linux 默认。**核心思路**：
  > 如果我已经 ACK 了 seg X（时间 T_x），那 seg Y 必须在 T_y < T_x + reo_wnd（reorder window）前 ACK；否则认为 seg Y 丢了。

```c
rack->xmit_time = 1000ms    // 上次重传 seg X 时间
rack->acked_time = 1100ms   // 新到达 ACK 时间
// 若 seg Y.xmit_time < rack.xmit_time 且 now - rack.acked_time > reo_wnd
// → seg Y 已 lost
```

RACK 不需要 dup ACK，也无须凑 3 次 → 抗乱序好、丢单包重传快、能处理 tail loss。

---

## 五、TLP (Tail Loss Probe, RFC 8985 同期)

### 5.1 问题描述

连接末端丢少数包，sender 永远不会收到 dup ACK（dup ACK 只在 cwnd 内后续包继续到达时产生）。末端要等 RTO（200ms+）

```
sender: 1,2,3,4,5  (cwnd=5 全发完)
                                seg 4 丢了，seg 5 也丢
receiver 收 1,2,3 → ACK 1,2,3 → dup 1, dup 1
sender dup < 3 不会触发 fast retransmit → 等 RTO
```

### 5.2 TLP 算法

cwnd 末端 tail-loss，发一个 **probe** 包（新数据或重传尾包），强制 receiver 回 ACK：
- probe 触发 dup ACK → 启动 SACK/RACK → 选丢失重传
- 不到 RTO 早 200ms 救活

```c
if (loss_state == TCP_LOSS_TLP_PROBE) {
    if (acked_seq < probe_seq)
        tcp_xmit_retransmit_queue(sk, true);
    else
        tcp_rearm_rto(sk);
}
```

`net.ipv4.tcp_tail_loss_probe=1`（所有现代 kernel 默认）。

---

## 六、QUIC 重传范式

QUIC 在应用层重写一切，主要原因：**TCP 中间盒缓存 seq + RST 注入风险**。

### 6.1 包号空间 (Monotonic Packet Number)

QUIC 给每个包号**单调递增**，不仅序号：
```
包号 1: data seq 1000-2000
        丢了重传 → 包号 2: 同 seq 1000-2000
receiver 收到 2 → 还有一个 ACK 空间注 '包1' 我没收到，但包 2 我收到了同样的 seq 数据 → 不再 ACK 包1 → sender 知道包 1 已收到
```
彻底解决 spurious retransmit 的 ACK 混淆。

### 6.2 ACK_DELAY

QUIC ACK option 含 `ack_delay` 字段，receiver 告诉 sender "我故意推迟 ACK 等 Xms"。sender 算 RTT 时扣回：
```python
RTT = (now - send_time) - ack_delay
SRTT = (7/8)*SRTT + (1/8)*RTT
```

让 receiver 合并 ACK + 不污染 RTT 估计（RFC 9002）。

### 6.3 PTO (Probe Timeout)

QUIC 不再用 RTO + binary backoff，用 PTO：
```
PTO = smoothed_rtt + max(4*rttvar, kGranularity) + max_ack_delay
```
+ 指数 backoff，但**也是探测**而非"重传一切"。QUIC 没有僵死 last_ACK state。

---

## 七、生产事故

### 事故 1：跨机房 RTT 抖动 → RTO 雪崩

**症状**：跨城 ECMP 路径切换频繁，RTT 5ms → 50ms → 5ms 反复，TCP 流 throughput 跌落到 5%。

**根因**：(1) F-RTO 未启，(2) RTT 由于 timestamp option 在 path 1 设了 5ms，path 2 设了 50ms，SRTT 慢追；RTO 估 80ms 而实际 50ms 段丢 → spurious 重传 → cwnd 重启 N 次。

**修复**：开启 tcp_frto=2 + tcp_no_metrics_save=1（不缓存 metric），显式 RTT 时间窗。

### 事故 2：高频短连接的"RTO + retry2=15"问题

某 API gateway 100 ms 超时，但 server 残重 TCP，client 等不到 RST，504 频发。`tcp_retries2=15` 默认 924s 才 RST。client K8s 已重试到上游健康——浪费 100 倍超时。

**修复**：
```bash
sysctl -w net.ipv4.tcp_retries2=8    # 降到 ~100s
# 应用层upe socket SO_KEEPALIVE + 超时回收
```

### 事故 3：TLP 误探测导致 throughput 减半

TLP probe 在小 cwnd 时被误认 seg seq 丢了，触发 fast recovery 减半。

**修复**：4.6+ 后内核修复 `tcp_process_tlp_ack` 判定条件，已不踩坑；旧 kernel 升级。

### 事故 4：BGP 邻居路由反复，RTO 起步值 1s → drop traffic

数据中心核心 BGP 路径切换 → RTT 真实 1ms 但路由过剩路径甚至更高，RTO 从 micro-RTT EWMA 出发但前若干包用 SYN 路径 RTO=1s 起步 → 触发后立即 RTO timeout。

**修复**：BBR 不依赖 RTT 估"丢"，BBR `tcp_early_retrans` 也可以。

---

## 八、易错清单

1. **RTO ≠ srtt × 4**：是 `srtt + 4 * rttvar`，必须有 RTT 偏差项
2. **3 dup ACK** 是 fast retransmit 阈值，**但 ER/RACK 后 cwnd<4 也能触发**
3. **重传过的包不能算 RTT 估计**（Karn 算法）——除非 timestamp option
4. **DSACK** 给 sender 看："你之前重传的其实是错的"——F-RTO 判定
5. **RACK 是 2017 后默认**（kernel 4.4+），不要说 "TCP 用 SACK" 就行了——RACK 已是丢弃检测主力
6. **tcp_retries2** 控制错误后的"放弃时间"——8 = 100s，15 默认 = 924s，短连接服务要降到 8
7. **QUIC 的 PTO 不是 RTO**——探测式超时，没有 last_ack 静态

---

## 九、这一章带走的东西

1. RTT 估计是 EWMA + 4σ 法则，Linux `tcp_rtt_estimator` 是教科书实现
2. SACK → DSACK → F-RTO → RACK → TLP 是 20 年递进：治"假阳性"与"末端丢"两类痛点
3. `tcp_timestamps=2` + `tcp_sack=1` + `tcp_rack=1` 是必需默认；任何 server 关闭都是事故源
4. QUIC 用包号单调 + ack_delay 字段 + PTO 把所有 RTO 痛点根除——是 HTTP/3 用 QUIC 的副因，不是主因
5. 生产看 `nstat TcpExtTCPSpuriousRTOs`、`TcpExtTCPLostRetransmit`、`TcpExtTCPRetransFail` 是否振荡
6. **tcp_retries2=15=924s 是隐藏坑**——短连接服务一定要降到 8

## 下一节 →

[HTTP 各版本](../http/versions.md) — HTTP/1.0 闭连接 → HTTP/1.1 keep-alive → HTTP/2 stream multiplexing + HPACK → HTTP/3 over QUIC。
