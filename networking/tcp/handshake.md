# 三次握手 / 四次挥手 / TIME_WAIT

## TL;DR

三次握手解决"双向序列号同步"，四次挥手解决"双工独立关闭"。真正在生产里出事的是握手背后的两个内核队列（SYN_QUEUE / ACCEPT_QUEUE）和挥手背后的 TIME_WAIT 堆积。本文从 RFC 793 的状态机，追到 Linux 4.x 内核 `inet_csk_listen_poll`、`tcp_v4_conn_request` 的实现路径，再到数据中心里 SYN Flood、SYN Cookie、SO_REUSEPORT eBPF、Linger、RST 注入这些事故现场——一条线打通"协议 → 内核 → 机房"。

---

## 一、为什么是三次而不是两次 / 四次

**思维链（API → 硬件）**：
1. TCP 是**全双工字节流**，两边都要有独立的方向序号（`seq`）。
2. 握手本质：A 告诉 B "我从 x 开始发"，B 告诉 A "我从 y 开始发"，双方互相 ACK 对方的起点。
3. 两次握手（A→B SYN，B→A SYN+ACK 合并）：B 无法确认 A 收到了自己的 seq，A 半连接残留风险。
4. 三次握手刚好覆盖两个方向的 SYN 都被 ACK。

```
   client                                 server
     │  SYN, seq=x, options(MSS,WScale,TS,SACK)        │
     │  ─────────────────────────────────────────────>  │  listen(), inet_csk_accept()
     │                                                  │  allocate sock, push to SYN_QUEUE
     │  SYN+ACK, seq=y, ack=x+1, mirror options         │  reqsk_alloc → inet_csk_reqsk_queue_hash_req
     │  <─────────────────────────────────────────────  │
     │  ACK, ack=y+1                                    │
     │  ─────────────────────────────────────────────>  │  reqsk_queue_remove → accept_queue
     │                                                  │
   ESTABLISHED                                       ESTABLISHED
```

> [!NOTE]
> "ack=x+1" — TCP 规定 SYN 即便没有 payload也消耗一个序号。因为这个序号代表"连接开始"事件本身。FIN 同样消耗一个序号。ACK 不消耗序号。

### 1.1 为什么不能两次

两次握手（RFC 793 早期的 TowardTwoWay）的失败模式：

```
A → B: SYN, seq=x        (旧包, 100ms 迟到)
A → B: SYN, seq=999      (重发)
B → A: SYN+ACK, ack=1000 (B 此时以为新连接建立)
A 收到 → 也以为建立          A 从未发 seq=1000
A 真的从 1000 开始 → B 已经收下
结果: 协议状态错乱
```

三次握手让 A 在第三次 ACK 时再次确认自己的 seq，能拒绝旧 SYN。但同时还有**SYN 乱序**问题，所以 ISN 不能是固定的 0，要随机化（见 §5）。

### 1.2 四次挥手为什么不能合并成三次

TCP 全双工，A 发 FIN 只表示"A 不再写"，B 仍可继续写。B 的 FIN 要等 B 自己把剩下数据发完，所以 ACK(B→A) 与 FIN(B→A) 之间可能有长延迟——必须拆成两个独立包。

```
   A                                    B
   主动关闭                              被动关闭
     │  FIN, seq=u                                 │   A → FIN_WAIT_1
     │  ──────────────────────────────────────>    │   B → CLOSE_WAIT
     │  ACK, ack=u+1                              │
     │  <──────────────────────────────────────    │
     │  (B 把想发的剩余数据继续写)                  │
     │  FIN, seq=v                                │   B → LAST_ACK
     │  <──────────────────────────────────────    │
     │  ACK, ack=v+1                              │
     │  ──────────────────────────────────────>   │   A → TIME_WAIT (2 MSL)
                                                   │   B → CLOSED
```

### 1.3 Half-Close 与服务器的读 0

服务端 `recv()` 返回 0 是 POSIX 标准 —— **不代表错误，表示对端发 FIN**。常被新手当成 EOF 一致处理。这是设计：
- HTTP/1.0 服务端在 client FIN 后仍可继续写响应
- SSH 协议退出阶段用 half-close 通知"fwd channel 关闭但 keepalive 仍在"

读到 `ECONNRESET` (errno 104) 才是异常 —— 对端发了 RST，buffer 里没冲刷的数据全部丢弃。

---

## 二、Linux 内核的握手队列

### 2.1 两个队列的精确含义

```
SYN_QUEUE   = struct inet_listen_hashbin.request_sock_queue
              已收到 SYN，未完成三次握手
ACCEPT_QUEUE= struct inet_csk_listen_sock.accept_queue
              已完成三次握手，等待 accept() 取走
```

`listen(fd, backlog)` 的 backlog —— 历史包袱：
- 严格按 RFC: ACCEPT_QUEUE 上限
- Linux 内核实际做法：`min(backlog, somaxconn)`，somaxconn 默认 **4096**（内核 5.4+），早期是 128——这导致大量短连接服务出过事

```bash
$ cat /proc/sys/net/core/somaxconn
4096
$ cat /proc/sys/net/ipv4/tcp_max_syn_backlog
8192
$ sysctl net.ipv4.tcp_abort_on_overflow
net.ipv4.tcp_abort_on_overflow = 0
```

### 2.2 ss / netstat 读队列

```bash
$ ss -lnt
State   Recv-Q  Send-Q  Local Address:Port
LISTEN  0       128     0.0.0.0:8080
```

- `Send-Q` = listen backlog (配置上限)
- `Recv-Q` = 当前 accept_queue 中已完成的连接数（**满了挤掉 ACK**）

> [!WARNING]
> `Recv-Q > 0` 看似好事（连接在等待），实际上意味着你的应用线程 `accept()` 跟不上——长此以往 accept_queue 满，新连接 ACK 被静默丢，client 重传。线上事故经常是这个 Recv-Q 持续 1000+ 直到 timeout。

### 2.3 队列满了会怎样

| 状态 | 过载行为 |
|------|----------|
| SYN_QUEUE 满 | 新 SYN 被 drop → client 进入 SYN 重传 |
| ACCEPT_QUEUE 满 + 第三个 ACK 来 | ACK 被静默丢 → server 重传 SYN+ACK (`tcp_synack_retries`, 默认 5) |
| ACCEPT_QUEUE 满 + `tcp_abort_on_overflow=1` | server 回 RST → client 立即 ECONNRESET |

```c
// net/ipv4/tcp_miniscallops.c 实际路径
if (sk_acceptq_is_full(sk)) {
    if (!tcp_abort_on_overflow)
        goto drop_ack;  // 静默丢，等下次 SYN+ACK 重传
    tcp_send_active_reset(sk, GFP_ATOMIC);
    goto discard;
}
```

### 2.4 调优案例

案例：某支付服务上线峰值 8w QPS，accept 5ms，accept_queue 配 128。压测时 Nginx upstream 大量 499/502。

```bash
# 修复
sysctl -w net.core.somaxconn=32768
server {
    listen 8080 backlog=32768;
}
# Nginx 主配置
worker_connections 65535;
worker_rlimit_nofile 200000;
```

判断 accept 是否瓶颈，看 `nstat`：
```bash
$ nstat -az | grep -i overflow
TcpExtListenOverflows        1342     0.0   # accept queue 满
TcpExtListenDrops            2891     0.0   # SYN queue 满
```

---

## 三、SYN Flood 与 SYN Cookies

### 3.1 攻击原理

攻击者**只发 SYN**，伪造源 IP（spoofer），不回 ACK。server 为每个 SYN 分配 `request_sock`（~256B）并塞入 SYN_QUEUE。一次百万级 SYN Flood 几秒打爆 SYN_QUEUE。

```
攻击者 → server: SYN seq=x (fake src)
server → fake src: SYN+ACK seq=y ack=x+1   # 假 IP 收不到，server 重传
        ↑ 每条 SYN/2xx B 永久占着 SYN_QUEUE 槽位直到 SYN_QUEUE 满
```

### 3.2 SYN Cookie 原理

不分配任何状态、不进 SYN_QUEUE。把状态编码到 ISN：

```
ISN = (hash(sip,sport,dip,dport,secret) << 7) 
       | ((mss_index & 0x7) << 4) 
       | ((t mod  4)) 
       | 1  # 强制最低位 1 防 0
```

收到第三次 ACK 时：`ack = ISN_server + 1`，server 用 client 的 sip/sport/dip/dport 重新 hash 验证。1 ms 内恢复全部状态并把连接放入 accept_queue。

```bash
sysctl net.ipv4.tcp_syncookies
net.ipv4.tcp_syncookies = 1   # 默认开
```

### 3.3 SYN Cookie 副作用

1. **丢 options**：SACK、WScale、Timestamps 都不能在 cookie 中编入 → 长肥管道（high BDP）吞吐受损
2. **MTU/MSS 单向猜测**：通过 syn MSS index 编进 ISN 但只能 4 个档位（536/1300/1440/1460）
3. **不做 SYN 重传**：cookie 状态被 client 是否回 ACK 决定，client 丢 SYN+ACK 直接超时

> [!WARNING]
> `tcp_syncookies=1` 是"救命底"，建议保持默认 1；但**不要把它当正常状态**。长期依赖 SYN Cookie 意味着 SYN_QUEUE 经常被打满，SACK/WScale 全部失效，长肥管道会变 100 Mbps。该扩队列、上 SynProxy、上 BGP scrubbing 才是正解。

### 3.4 SynProxy（防御升级版）

Linux 4.4+ 内置 `SYNPROXY` netfilter 目标，配合 iptables-extensions：

```
攻击 SYN → SynProxy：先自己握手，再"代理握手"做真握手
SynProxy 与 client 完成三次握手后才转发给真实 server
syn flood 阶段：SynProxy 不分配任何 server 资源
```

```bash
iptables -t raw -A PREROUTING -p tcp -m tcp --syn -j CT --notrack
iptables -A INPUT -p tcp -m tcp --syn -m conntrack --ctstate INVALID,UNTRACKED \
    -j SYNPROXY --sack-perm --timestamp --wscale 7 --mss 1460
```

数据中心常用方案：BGP FlowSpec 把可疑源路由到 scrubber，scrubber 做 SynProxy + challenge 之后再回到 server。

---

## 四、ISN：一个看似小的安全问题

### 4.1 为什么 ISN 必须随机

```
攻击者想知道 client→server 的下一个 seq，就能:
1. 伪造 RST 关连接（RST 只要 seq 在窗口内即可）
2. 在客户端没有发数据时往 server 注入数据（"装作"客户端，如 1985 Morris 攻击）
```

早期 BSD 用一个 1 µs 递增计数器做 ISN，**完全可预测**。1996 Shimomura 被 Mitnick 用这个手法攻破——成为现代计算机安全史开端。

### 4.2 Linux 4.x 的 ISN 算法

```c
// net/ipv4/tcp_ipv4.c: tcp_v4_init_seq()
u32 tcp_v4_init_seq(const struct sk_buff *skb) {
    return secure_tcp_seq(ip_hdr(skb)->saddr, ip_hdr(skb)->daddr,
                          tcp_hdr(skb)->source, tcp_hdr(skb)->dest);
}
```

`secure_tcp_seq` 用 MD5/M不再可见 + 时间戳 + 密钥派生。**很弱**——RFC 6528 要求 ISN 至少 64 位熵，Linux 实际密钥+时钟派生，时间间隔内可预测。

更稳的方式 —— **TCP_MD5SIG** 选项（RFC 2385）：BGP/OSPF/MPLS 控制平面用 TCP MD5，连 ISN 都不验，直接 HMAC 验整个 segment。

TCP AoO (RFC 5925) 是 MD5sig 升级版，增加了算法可协商、key rotation，目前 Cisco Juniper 都支持。

---

## 五、TIME_WAIT 深度分析

### 5.1 为什么需要 TIME_WAIT

被动方 / 主动方都能进入 TIME_WAIT 是**主动关的一方**才进入：

```
A → FIN → B
B → ACK
B → FIN → A
A → ACK        ← 这个 ACK 可能丢！
                ↑ B 重传 FIN，A 必须能再发 ACK
                ↑ A 状态必须保持到 B 至少放弃重传（1 RTT + tolerance = 2 MSL）
```

两个用途（按 RFC 793 原文）：
1. **保 ACK 重传能力**（主用）：B 重传 FIN 到 A 必须有 A 来回 ACK
2. **防止旧连接数据污染新连接**：让旧连接的 trailing 报文在网络中消失（2 MSL = 1 MSL outbound + 1 MSL inbound）

第二个目的事实上**已被 RFC 1337 弱化**：因为现代 ISN 随机化后，新连接不会复用相同 seq → 实际不需要 2 MSL 解决这个。Linux 实际值是 **60s**（`TCP_TIMEWAIT_LEN` in `include/net/tcp.h`），不是教科书说的 2*MSL（120s）。

### 5.2 Linux TIME_WAIT 实现细节

```c
#define TCP_TIMEWAIT_LEN (60 * HZ)   // 60 sec

// net/ipv4/tcp_timer.c: tcp_time_wait()
void tcp_time_wait(struct sock *sk, int state, int timeo) {
    struct inet_timewait_sock *tw;
    tw = inet_twsk_alloc(sk, state);
    // tw 不再持有 send/recv buffer，只是 4-tuple key + timer
    // 大概 200B
}
```

`TIME_WAIT` 是个轻量结构（约 200 B），但 `tcp_max_tw_buckets` 默认 4096（旧）/ 现代 262144。极端短连接服务（如 mysql proxy）能堆 100w+ → ~200MB 内存。一般够。但**端口耗尽**才是真头疼：

### 5.3 端口耗尽 (Ephemeral Port Exhaustion)

5000 QPS 短连接，每条 60s TIME_WAIT：
- 出向 client 元组 `(src_ip, src_port, dst_ip, dst_port)` 中 src_port 范围 32768-60999（约 28k 个）
- 28k * (≥60s 握手周期) / QPS = 28k/5k = 5.6 ≤ 风险点

测试方法：
```bash
$ curl -s -w '%{local_port}\n' http://server -o /dev/null
# 单 client 长时间高频短连 → 端口循环
```
你看到 `EADDRNOTAVAIL` 就是这个原因。

### 5.4 缓解措施对比

```
+----------------+------------------------------------+-------------------+------------+
| 措施           | 原理                                | 副作用            | 建议       |
+----------------+------------------------------------+-------------------+------------+
| tcp_tw_reuse=1 | outbound 允许新 connect 复用 TW    | 无                | 强推       |
| tcp_max_tw_bucket | 超 threshold 强行 free            | 旧连接 RST 风险   | 设 500000  |
| SO_REUSEADDR   | bind 时允许复用 TIME_WAIT 端口     | 仅 client 复用    | OK         |
| SO_REUSEPORT   | 多 worker accept 同 port, kernel  | 无                | 强推       |
|                 | hash(conn) 选 worker               |                   |            |
| tcp_tw_recycle | 用 timestamp 判活复用TW入向         | NAT 下灾难        | 4.12 已删  |
| 改长连接       | 不短连根本没 TIME_WAIT             | 增长保活成本      | 根治        |
+----------------+------------------------------------+-------------------+------------+
```

> [!WARNING]
> `tcp_tw_recycle` 在 Linux 4.12 已**移除**。它在 NAT 后续场景会基于 timestamp 判断"是不是同一个 client"，NAT 出来的多个 client 时间戳会"回退"（系统时钟漂）→ 内核认为是"过时连接" → RST。任何文档还在让你 `sysctl -w net.ipv4.tcp_tw_recycle=1` 都过时了。KB 上的修正年代是 2017 年 7 月。

### 5.5 SO_REUSEPORT eBPF 进阶

Linux 4.5+ 后 `SO_REUSEPORT` 支持 attach eBPF program，由 eBPF 自定义 hash 选取 worker。Cloudflare 用这个转发到 sticky worker：
```c
struct bpf_prog $reuseport_prog;
bpf$reuseport(prog, sk_array) {
    // 根据 client IP/Port hash 选 worker，保路由稳定性
    return bpf_sk_reuseport_select(sk_array, opts);
}
```
Cloudflare 的开源 `nginx-quic` 也用此机制在前端 SLB 上做 sticky routing。

---

## 六、Tcpdump + Wireshark 诊断现场

### 6.1 抓三次握手 + 挥手

```bash
$ tcpdump -i eth0 -n -S -tttt \
    'tcp port 443 and (tcp[tcpflags] & tcp-syn != 0 or tcp[tcpflags] & tcp-fin != 0)'

2024-08-21 14:23:09.123 10.0.0.5.51604 > 142.250.80.46.443: Flags [S], seq 2881824731, win 65535, ...
2024-08-21 14:23:09.150 142.250.80.46.443 > 10.0.0.5.51604: Flags [S.], seq 1729185772, ack 2881824732, ...
2024-08-21 14:23:09.150 10.0.0.5.51604 > 142.250.80.46.443: Flags [.], ack 1729185773, win 65535, ...
```

`S` = SYN, `S.` = SYN+ACK, `.` = ACK。三个包来对应三次握手。

### 6.2 内核实时计数

```bash
$ nstat -az | grep -iE '(overflow|dropped|reset|retran)'
TcpExtListenOverflows           1342    0.0   # accept queue 满
TcpExtListenDrops               2891    0.0   # SYN queue 满
TcpExtTCPTimeouts               8912    0.0   # RTO 触发
TcpExtTCPSpuriousRTOs           34      0.0   # 假阳性 RTO
TcpExtEmbryonicRsts             34      0.0   # SYN 状态收到 RST
TcpExtTCPSynRetrans             156     0.0   # SYN 重传数
```

---

## 七、生产事故复盘

### 事故 1：accept queue 满 → 服务端体感不是 listen 失败而是 client timeout

**症状**：某 API gateway 加新接口后开始零星出现 504，client 端 timeout 但服务端业务日志没有任何请求。

**排查**：
```bash
$ ss -lnt | grep 8443
LISTEN  4423  128   0.0.0.0:8443      # Recv-Q = 4423 > Send-Q (上限 128) ?
```
（其实内核 5.x 把 `Recv-Q` 在 LISTEN 状态展示成"已收到 SYN 待 accept 的"——也就是 SYN_QUEUE 实际长度）。

```bash
$ nstat TcpExtListenOverflows
1342
```

**根因**：Nginx worker_processes 调小 + accept_mutex 锁影响，accept 速度跟不上 SYN 速率。

**修复**：
- 增大 `listen backlog=32768`
- `worker_processes auto` 并 `worker_connections 65535`
- 上 Prometheus 监听 `nstat TcpExtListenOverflows` 报警

### 事故 2：BGP 邻居中断后无法重建

**症状**：BGP session 在 ICT 重启后无法建立，tcpdump 显示三次握手正常 ESTABLISHED 了立刻 RST。

**根因**：BGP 用 MD5 签名 + key rotation 中错位 → server 看到合法 ack 但 MD5 不匹配，静默丢 → client 数秒重传 SYN → ESTABLISHED 触发 → MD5 sig 不符 → RST。

**修复**：`tcpdump` 用 `-M <key>` 验证 + tcpdump `-M` 选项；运维上要先做 key rollout 两端同步。

### 事故 3：机房 LVS LFIN 失败导致大量 LAST_ACK

**症状**：LVS 直接路由模式切换 RS，触发的连接全部进入 LAST_ACK 状态、tcp_tw_buckets。短时间内 `nf_conntrack` 表满，整个机房东西向流量都驻足。

**修复**：
- LVS 上调成 `pers_timeout 50, fin_timeout 5`
- 服务侧 `tcp_fin_timeout=15`（默认 60s）绑 RS 自身
- 加监控告警对 `LAST_ACK` 计数

### 事故 4：CGN 后用户连不上 CDN

**症状**：某运营商用户反馈间歇性连不上 CDN，抓包看到 SYN 重传到 CDN → client 收 SYN+ACK 没回 ack 就 RST。

**根因**：CGN 设备基于 5-tuple 入向记录，client 是 CGN 后的私有 IP，CGN 上 `nf_conntrack` 因为 `tcp_timeout` 太短，SYN 已过期，client 收到 SYN+ACK 后包直接被丢。

**修复**：CGN 调长 timeout，或使用 `syn cookie` 旁路。

---

## 易错清单

1. **三次握手 ≠ "连接已建立"** ：server 没调 accept() 前连接存在但应用看不到
2. `ss -lnt Recv-Q > 0` **不一定**问题，但持续 >100 = 应用 accept 慢
3. `tcp_tw_reuse` 是 outbound，不是 inbound — **不要混淆**
4. systemd 加的 `tcp_tw_recycle` 配置在 4.12+ 内核会被静默忽略（依然很危险 = KB 误导）
5. `ECONNRESET` 不是连接死了，**对端主动发了 RST**
6. `ECONNREFUSED` 是 SYN 后立刻收 RST —— port 没人 listen 或被防火墙 reject
7. `tcp_fin_timeout` 控的是 `FIN_WAIT_2`，**不是** `TIME_WAIT`（TIME_WAIT = 60s 硬编码）

---

## 这一章带走的东西

1. SYN_QUEUE 走 `tcp_max_syn_backlog`，ACCEPT_QUEUE 走 `somaxconn ∧ listen backlog`。两者用 `TcpExtListenOverflows/Drops` 看真实溢出。
2. `tcp_syncookies=1` 是底线，**不是日常**。生产要扩队列 + SynProxy + scrubber，否则 SACK/WScale 全丢，长肥管道退化。
3. TIME_WAIT 60s 硬编码。`tcp_tw_reuse` 是 outbound，可用；SO_REUSEPORT eBPF 是现代粘滞路由神器。
4. `tcp_tw_recycle` 4.12 已删 — 看到 1 的人就告诉他可恶的 NAT。
5. BGP/OSPF 控制平面只用 TCP MD5 sig，连 ISN 都不靠 —— 这是 EBGP multi-hop 比 IBGP 安全的根本原因。
6. 应用层 `recv() 返回 0` = 对端发 FIN —— 不是错。`ECONNRESET` = 对端发 RST —— 业务要记账。

## 下一节 →

[拥塞控制](./congestion.md) — 从 Reno 到 CUBIC 到 BBR，Linux 的 cubic / bbr 开关现况，以及为什么 BBR v1 公平性、v3 才解决带宽收敛。
