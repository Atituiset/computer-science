# TCP / UDP

## TL;DR

TCP 是因特网最常用的可靠字节流协议：握手、保活、保序、重传、流控、拥塞控制。UDP 是无连接协议：只包 IP 头和上层数据，能不能到看命。本文先讲协议族骨架，下篇分专题讲握手、拥塞控制、重传——就讲 TCP 的字节序模型 + 状态机如何让 RFC 793 在 1981 年立起来至今还能跑 100 Gbps。

## TCP vs UDP

| 维度 | TCP | UDP |
|------|-----|-----|
| 模型 | 字节流可靠交付 | 数据报尽力 |
| 连接 | 3-way handshake | 无连接 |
| 顺序 | 保序 | 无序 |
| 重传 | 协议自动 | 应用层自己做 |
| 拥塞控制 | 内置 Reno/Cubic/BBR | 无（QUIC 在 UDP 上自己加） |
| 头开销 | 20 字节 + options | 8 字节 |
| 用例 | HTTP/SSH/SQL | DNS/VOIP/游戏/QUIC |

> [!NOTE]
> TCP 头"20 字节"是不含 options 的最小值；含 TS option（10B）和 SACK option 总长接近 40。这个值会被 ack number + SACK 经常生成 60 字节 header。

---

## TCP 头部

```
0                   16                 31
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|Source Port       |Destination Port                |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|              Sequence Number                     |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|         Acknowledgment Number                    |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|Data Offset|Resv|Flags| Window                  |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|Checksum   |Urgent Pointer                         |
+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
| Options (可变长)                                  |
```

### Flags

| Flag | 含义 |
|------|------|
| SYN | 同步 sequence |
| ACK | 确认号有效 |
| FIN | 关闭发送方向 |
| RST | 重置连接 |
| PSH | push 给接收端立即上交 |
| URG | urgent pointer 有效 |

### Sequence 与 ACK

```
TCP 是按字节序号确认
SYN ISN=A，从对方看 sequence=A+1 之后字节序号=A+1 起
ACK 收到 seq=A+n -> ACK A+n 表示"前 n 字节已收"
所以每次发送+len 在包里更新 sequence
```

ISN (Initial Sequence Number) 必须随机 (RFC 6528) 防 TCP 序列号猜测攻击 (Mitnick 著名 hack 就是这个)。

### Window Size

窗口 = "我说现在还能收 N 字节"，让发送方不发爆接收方。

```
A -> B
A 发 100B，B 收 80B 处理 80B -> ACK reply with Window=20
A 缓冲剩下 80B, 等 Window=0 时收到停发
```

加 Windows Scaling option (RFC 7323) 让 window 字段除以 scale factor 编码 > 64 KB（最多 1 GB）。Linux 默认 `tcp_window_scaling=1`。

### 关键 options

```
MSS (Maximum Segment Size)              : 通常 1460 字节 (1500 MTU - 20 IP - 20 TCP)
SACK Permitted                           : 启用 selective ACK
Timestamps                               : 帮助 RTT 估计 + PAWS (防旧包回放)
Window Scaling                           : 窗口字段 scale factor
TCP Fast Open Cookie                     : 0-RTT 恢复 TFO
```

---

## UDP 头部

```
+----+----+----+----+
| Src | Dst |
| Port| Port|
+----+----+----+----+
|  Length   | Checksum |
+----+----+----+----+
| (data)
```

只有 8 字节。Checksum 在 IPv4 可选 (0=不校验)；IPv6 必须有，否则校验可靠性差。

### UDP-Lite

变体：只校验头部一段字节。视频流允许部分错帧。
**实测中需检查中间设备是否丢包 / 兼容性（特别移动网络经常转 UDP）**——某游戏公司发现全球 4G-5G UDP-Lite 兼容性差 1-2%，正式产品还是用 UDP。

---

## Socket API（程序员视角）

### 服务端 (TCP)

```python
import socket
s = socket.socket(family=socket.AF_INET, type=socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', 8080))
s.listen(128)   # backlog，新全连接队列上限
while True:
    conn, addr = s.accept()
    handle(conn, addr)
```

TCP 已完成握手但应用未 `accept()` 的连接 → accept queue 满 → Linux SYNs 全回 RST (`tcp_abort_on_overflow=1`)，或静默 → 客户端 ACK 重试。

### `SO_REUSEPORT`

Linux 3.9 起一组 accept 进程绑同一 IP:PORT，内核用 hash(conn) 选 thread 避锁。Nginx 1.9+ 默认开启：

```nginx
worker_processes auto;          # CPU 数
worker_aio_requests 256;
listen 443 ssl http2 reuseport;  # 关键 reuseport 让多 worker 各自 accept
```

效果：单 4vCPU 节点 QPS 从 200k → 700k+。

### 客户端

```python
cs = socket.socket()
cs.settimeout(5)
try:
    cs.connect(('api.example.com', 443))
except socket.timeout:
    print('connect timeout')
```

非阻塞 `connect()` 返回 `EINPROGRESS` → 加速 reactor：

```c
int fd = socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK, 0);
int r = connect(fd, ...);  // EINPROGRESS
// 等 epoll_events 投回 fd 可写后，getsockopt(SO_ERROR) 拿结果
```

---

## Linux 内核 socket buffer

```bash
sysctl -w net.core.rmem_max=16777216    # 每 socket 最大收 buffer
sysctl -w net.core.wmem_max=16777216    # 每 socket 最大发 buffer
sysctl -w net.ipv4.tcp_rmem='4096 87380 16777216'   # (min default max) 接收 buffer 自动调节
sysctl -w net.ipv4.tcp_wmem='4096 65536 16777216'   # 发送 buffer
```

`SO_RCVBUF` / `SO_SNDBUF`：socket 缓冲大小，默认 87380B/16KB。
`SO_KEEPALIVE`：保活探测（默认 2h 后发探测）。
`TCP_NODELAY`：禁 Nagle，发小包立刻发不缓冲。
`TCP_QUICKACK`：禁延迟 ack。

### Nagle 算法

TCP 想等 ACK 来 / 直到积累 1 MSS 才发小包，避免公网小包爆炸流量。`TCP_NODELAY` 关闭后立即发。逃离 Nagle 通常和 ACK 延迟搭配导致 200ms 延迟 → 写应用层不延迟 ACK、关 Nagle 或两者都要做。

### Delayed ACK (RFC 1122)

接收端为了 piggyback ACK 在反向数据包上，等 200ms 才发独立 ACK。Nagle 算法与之会有相互作用导致游戏 / RDB 延迟：

```
App: send_small_packet_1 (40B)
Nagle: < 1 MSS，先攒着
Server: 收到，没立刻 ACK；Server 等 200ms
App: 等不到 ACK 一直没继续 send
Server 200ms 后发出独立 ACK
App: 收到 ACK 后才 send 第二个包
=> 端到端延迟 + 200ms
```

解决：业务层一次性写入大 buffer (避免小包)，或 set `TCP_NODELAY`。

---

## TCP 状态机

```
                  +-----------+
                  |   CLOSED  |
                  +-----------+
                        │
                        │ active open
                        ▼
                  +-----------+
                  | SYN_SENT  |
                  +-----------+
                        │
                        │ recv SYN+ACK, send ACK
                        ▼
                  +-----------+
       active open| ESTABLISHED|  passive
  +---------------------------+----------+
  │                                       │
  │ close → FIN                          │ recv FIN → ACK
  ▼                                       ▼
+-----------+                        +-----------+
| FIN_WAIT_1|                        | CLOSE_WAIT|
+-----------+                        +-----------+
        │                                    │
        │ recv ACK                            │ close → FIN
        ▼                                    ▼
+-----------+                        +-----------+
| FIN_WAIT_2|                        | LAST_ACK |
+-----------+                        +-----------+
        │                                    │
        │ recv FIN → ACK                     │ recv ACK
        ▼                                    ▼
+-----------+                        +-----------+
| TIME_WAIT |                        |  CLOSED  |
+-----------+                        +-----------+
        │ 2*MSL later
        ▼
+-----------+
|  CLOSED  |
+-----------+
```

- TIME_WAIT 持续 `2 × MSL` (Linux 60s)，原因：
  - 避免旧数据污染新连接 (RFC 1337 修正 ISN 随机后已不太需要)
  - 让对方最后 ACK 的重传有时间到达 (FIN 重传会再回 ACK)
- LAST_ACK：被动方等待最后 ACK 才关

TIME_WAIT 在服务器大量幼连接时 socket 占用导致内存耗尽。

```bash
sysctl -w net.ipv4.tcp_max_tw_buckets=500000  # 软上限，超过直接 free
sysctl -w net.ipv4.tcp_tw_reuse=1             # outbound 复用
# tcp_tw_recycle 在 kernel 4.12 后被移除！绝对不要用。
```

> [!WARNING]
> `tcp_tw_recycle=1` 在 NAT 场景下：因为它依赖 timestamp 区分客户端，多 client 共享 IP 会导致 timestamp 不一致被丢包。Linux 已在 4.12 移除该 sysctl——任何 KB 还在教你启 `tcp_tw_recycle=1` 的都过时了。

---

## TCP 拥塞窗口（一小段引子，详见后续 congestion 章节）

TCP 维护两个窗口：
- `rwnd` (receive window)：通告接收方可收多少 (在 packet 里)
- `cwnd` (congestion window)：发送方自己猜的网络可容多少
- 实际有效发送 = `min(rwnd, cwnd)`

每 RTT 收到 ACK 后再加 1 MSS（slow start 指数增长），超过 ssthresh 切换到拥塞避免线性增长，丢包时回退到 cwnd/2。一套算法：拥塞避免 + 快重传 + 快恢复**

---

## 这一章带走的东西

1. TCP sequence 是按字节，不是按包 → 应用层"一次 send"在 TCP 看可能是多次传多个 byte（取决于 segment 切分时机）
2. socket buffer 默认值小，性能敏感时要调 SO_RCVBUF/SNDBUF + tcp_rmem
3. TIME_WAIT 是协议保护期，不是 bug；规模压不下来时用 SO_REUSEPORT + 业务连接池替代短连接
4. Nagle + Delayed ACK 互坑会导致 +200ms 延迟，写 client 一次性发完 / 关 Nagle 二选一
5. tcp_tw_recycle 已被 4.12 移除，任何还教这个开关的解释都过时

下一节 → [三次握手 / 四次挥手 / TIME_WAIT](handshake.md)
