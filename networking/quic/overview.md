# QUIC over UDP：解决什么

## TL;DR

QUIC 没有新 GSS 层概念，只是把 TCP 30 年没做透的"5 件事"重写一遍。本节走完 packet 字节布局、long/short header、流标识符、变长 packet number、frame 类型清单、ACK frame 结构、PTO 算法、 congestion control 接口——你能从字节角度认识 QUIC、从 wireshark 抓帧反查协议状态。重点：packet number 单调递增如何解决重传歧义。

---

## 一、Quic 包字节布局

### 1.1 Header 两种形态

```
Long Header (handshake / version neg):
0                   1                   2                   3
+---------------+---------------+---------------+---------------+
|1|  Form Bit   | Long Type (7) |                                 |
+---------------+---------------+               +
|                          Version (32)                            |
+---------------+---------------+---------------+---------------+
| DCID Len (8)  | Dest Connection ID (0..160)                     |
+---------------+---------------+---------------+---------------+
| SCID Len (8)  | Src  Connection ID (0..160)                      |
+---------------+---------------+---------------+---------------+
                          Variable per type:
                          Initial Token, Length, PN, CRYPTO/STREAM
+                                payload                          +
+-----------------------------------------------------------------+

Short Header (1-RTT application):
+--+—+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|0|1| S | R | K | P | Packet Number (1..4)      |
+--+—+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
|                   Encrypted Payload         ...
+--+—+--+--+--+--+--+--+--+--+--+--+--+--+--+--+
```

| 字段 | bit | 说明 |
|------|------|------|
| Form bit | 1 | 1=Long, 0=Short |
| Fixed bit | 1 | 必 1 |
| Spin bit | 1 | RTT 测量用 (常见 0/1 交替) |
| Reserved bits | 2 | reserved |
| Key phase bit | 1 | key rotation 切换 |
| Packet number size | 2 | 1/2/4 字节 |
| DCID/SCID | 可变长 | 0-20 字节，但变长编 1 字节 prefix |

CID 是 **变长**（0-20B）+ 类型本身可协商；CID 长度在握手期协商：client 发起 initial，server echo client 选的长度。

### 1.2 Long Header 4 个子类型

| Type bits | 类型 | 用途 |
|-----------|------|------|
| `00` | Initial | 客户端先发，含 ClientHello CRYPTO frame |
| `01` | 0-RTT | 客户端可选，携带 early data + 新 ClientHello |
| `10` | Handshake | server 回，含完成 TLS 握手 |
| `11` | Retry | server 重发，要求 client 重发 initial（防 amplification attack） |

### 1.3 加密层次

- **Initial keys**：用 DCID 作 salt + HKDF 衍生 → 加密 Initial packet CRYPTO frame
- **Handshake keys**：从 TLS handshake secret 派生
- **0-RTT keys**：PSK + 早期 traffic secret
- **1-RTT keys**：主 traffic secret
- **Application keys**：aead 加密 short header packets

每层独立加密 → Initial packet 即使无 TLS handshake 也加密（防 ISP 看透握手）。

---

## 二、Frame Type 表

```
0x00  PADDING
0x01  PING
0x02  ACK
0x03  ACK (ECN)
0x04  RESET_STREAM
0x05  STOP_SENDING
0x06  CRYPTO
0x07  NEW_TOKEN
0x10-0x17  STREAM (8 variants: FIN/OFF/LEN flags)
0x18  MAX_DATA
0x19  MAX_STREAM_DATA
0x1A  MAX_STREAMS (BIDI)
0x1B  MAX_STREAMS (UNI)
0x1C  DATA_BLOCKED
0x1D  STREAM_DATA_BLOCKED
0x1E  STREAMS_BLOCKED
0x1F  NEW_CONNECTION_ID
0x20  RETIRE_CONNECTION_ID
0x21  PATH_CHALLENGE
0x22  PATH_RESPONSE
0x24  HANDSHAKE_DONE
0x26  DATAGRAM
0x1c-0x1d CONNECTION_CLOSE
```

每个 frame 类型有独立功能。STREAM frames (0x10-0x17) 含 FIN flag + offset + length 字段：

```
STREAM frame (Type|Fin|Len|Off):
0                   1                   2
+---------------+---------------+---------------+
|Frame Type| F | O | L |                       |
+---------------+                               |
|                  Stream ID (varint)            |
+-----------------------------------------------+
|              Offset (varint, if O=1)          |
+-----------------------------------------------+
|              Length (varint, if L=1)          |
+-----------------------------------------------+
|                 Stream Data (var len)         |
+-----------------------------------------------+
```

---

## 三、Stream ID 与方向

```
Stream ID 编码:
0x00 - 0x03    server-initiated bidi  ← HTTP/3 client server push 视角
0x04 - 0x07    client-initiated bidi  ← HTTP/3 client request/response
0x08 - 0x0B    server-initiated uni  ← 控制流 (SETTINGS)
0x0C - 0x0F    client-initiated uni  ← client push 流
```

低 2 位编码：
- bit 0: 0 = client-initiated, 1 = server-initiated
- bit 1: 0 = bidi, 1 = uni

每 stream 独立 flow control (MAX_STREAM_DATA、STREAM_DATA_BLOCKED) 与连接级流控 (MAX_DATA、DATA_BLOCKED) 双层。

---

## 四、Packet Number 单调递增

### 4.1 TCP seq 的歧义

TCP 序号是按**字节序 + 重传** 维护。重传过的 segment 序号相同：
```
sender → seg seq=1000 + data
       ↓ timeout
       → seg seq=1000 + 同 data (重传)
receiver
       → ACK seq=1001 (无法分辨是确认 first 还是 second)
```

→ Karn 算法要求"重传过的包不计 RTT"。但 timestamp option 也是种 workaround。

### 4.2 QUIC 解法

QUIC packet number **每发一个包都+1**（即便内容相同）：
```
包 1: stream data seq=1000
       ↓ timeout
包 2: stream data seq=1000  ← 包号已变！data seq 不变
receiver → ACK 范围 [(包2号)] ... frame 含 ack_range
sender 看到 ACK 包2号 → 100% 确认这是新包确认，不会跟踪 first → 混淆消除
```

```c
// pseudo-code (ncheap sim)
let mut next_pn = 0;

fn send_packet(&mut self, payload: Bytes) {
    let pn = self.next_pn;
    self.next_pn += 1;
    ...
}

fn on_ack(&self, ack_ranges: Vec<(u64, u64)>) {
    let largest_acked = ack_ranges.iter().map(|r| r.1).max();
    // detect new ack:
    if largest_acked > ack prior {
        let rtt_sample = now - self.send_time(largest_acked);
        // ack_delay recompute from frame:
        let rtt = rtt_sample - ack_delay_field;
        // update SRTT without Karn workaround needed
    }
}
```

**关键收益**：不需要 timestamp option，每包 RTT 都能算。

### 4.3 Packet Number 编码压缩

短 header packet number 1/2/4 字节可变。`truncated_pn` 用最低 N 位编码与预期下个 pn 比较：
```c
fn decode_pn(largest_pn: u64, truncated: u64, bits: u32) -> u64 {
    let expected = largest_pn + 1;
    let candidate = (expected & !((1<<bits)-1)) | truncated;
    if candidate < expected - (1<<(bits-1)) {
        candidate + (1<<bits)
    } else if candidate > expected + (1<<(bits-1)) {
        candidate - (1<<bits)
    } else {
        candidate
    }
}
```

→ 99% packet 只编 1 字节，省 byte。但接 packet loss 后还是要发 2 字节。

### 4.4 ACK frame 字段

```
ACK Frame:
0                   1                   2
+---------------+---------------+----------+
| Type 0x02     |  Largest Acknowledged (varint)
+---------------+---------------+----------+
|  ACK Delay (varint)        ← 关键字段 ack_delay
+-------------------------------+
|  ACK Range Count (varint)     |
+-------------------------------+
|  First ACK Range (varint)     |   # 连续确认从 largest 往回数
+-------------------------------+
|  Gap + Ack Range patterns     |   # 用于乱序 ACK
+-------------------------------+
```

ack_delay 编为 `us >> ack_delay_exponent`（协商时设 2^N）。sender 收到后回算：
```python
rtt_sample = (now - send_time_of_largest_acked) - (ack_delay_field << ack_delay_exponent)
srtt = 7/8*srtt + 1/8*rtt_sample  # RFC 9002 §5
```

→ socket 调度延迟从 RTT 估计**剥离**。

---

## 五、PTO 与重传

### 5.1 PTO 探测超时

RFC 9002 定义 PTO 算法：
```
PTO = smoothed_rtt + max(4*rttvar, kGranularity) + max_ack_delay
```

比 TCP RTO 多 `max_ack_delay`，因为 sender 知道接收方 `ack_delay` 是应用回应故意延迟 ACK 的，不能算丢包信号。

### 5.2 PTO 触发后

- 发 PING frame (空) 触 receiver 回 ACK
- 不重置 cwnd=1 (与 TCP RTO 不同)
- packet number 单调 + 1，发探测包即可

### 5.3 丢包检测 + RACK

QUIC 直接借鉴 TCP 已经成熟的 RACK (RFC 8985)：
- 看 ACK 帧中 gap → 包 X 已 acked 但包 X-1 未 acked + 时间晚 → X-1 丢
- ack ranges 让乱序信息公开 → 不需"3 dup ACK"

---

## 六、连接迁移

CID 是 QUIC 跨网络连续的根。

```
client → server: send packets with CID=0x9abc...

client 切到 LTE 5G:
   原 socket (wifi) 段口被 OS close，
   新 socket (LTE) 同一进程继续用 CID=0x9abc
server → 看到 CID 不变 → 仍查 conn state table = OK

路径验证:
client → server: PATH_CHALLENGE (with random 8 bytes) on new path
server → client: PATH_RESPONSE (same 8 bytes) on same new path
client 收到 PATH_RESPONSE → path validated → 切回 send on new
```

NAT rebinding 类似：client 看不到自己源 IP 突变，但 server 看到 packet 源 IP/port 变了 → server 主动 own PATH_CHALLENGE 验证 → 验证通过 = OK 切回 send。

### 6.1 NAT rebinding

```
client → NAT (公网 1.1.1.1:3000)
       → server

NAT 老化 → NAT 给 client 新 port 4000
client 仍只知 NAT 后知，下个 packet NAT 通过出去:
       → server src=1.1.1.1:4000  ← server 看 src 改变

server → PATH_CHALLENGE to 1.1.1.1:4000
client ← PATH_CHALLENGE → PATH_RESPONSE back
server 切到 send 到 4000
```

### 6.2 触发主动 migrate

client 主动切：
```
1. client 在 lwifi socket 上 new socket cell + bind
2. 在新 socket 发 packet 含 PATH_CHALLENGE
3. 同时停止 lateral send
4. 等 PATH_RESPONSE
5. 切到新 socket send，并 retire old CID (让 server 路由表清)
```

中间盒看到 PATH_CHALLENGE 应该不 RTC reset 。

### 6.3 connection close

正常 close：QUIC `CONNECTION_CLOSE` frame → receiver ack → close。
重连成本：client 需新 Initial packet，TLS 1.3 impersonation 2nd RTT (0-RTT if resumption)。

---

## 七、QUIC 拥塞控制接口

QUIC 把 cwnd、pacing rate、congestion event 留成接口（不是内置具体算法）：
- 默认 NewReno (RFC 9002 §B)
- 实现 ≥ = cubic in quiche/quic-go/msquic
- BBR v1/v2/v3 in lsquic, msquic-optional

```python
# QUIC 拥塞控制接口
class CongestionController:
    def on_packet_sent(self, packet_num, bytes):
        pass

    def on_packet_acked(self, ack_info, now):
        # ack_info.ack_ranges: ranges acked
        # ack_info.ack_delay: receiver 计算的延迟
        pass

    def on_congestion_event(self, lost_packets, now):
        # 拥塞事件 (丢包 / ECN)
        pass

    def pacing_rate(self) -> u64:
        pass

    def window(self) -> u64:
        pass
```

→ 不同算法实现 equippable。client/server 可协议协商 congestion controller (extension)。

---

## 八、QUIC 库生态

| 库 | 组织 | 语言 | 主要用户 |
|----|------|------|---------|
| quiche | Cloudflare | Rust | Cloudflare CDN, Akamai |
| lsquic | LiteSpeed | C | Akamai, Microsoft Edge |
| ngtcp2 | ngtcp2 | C++ | self-hosting |
| msquic | Microsoft | C | Windows, Azure H3 |
| quic-go | Lucas Clemente | Go | fasthttp, transport-kit, GCP |
| aioquic | aiohttp | Python | cloudflare dev |
| quinn | crCrucial | Rust | rustls 集成 |

```
$ curl -I --http3 https://www.cloudflare.com  (curl 7.66+ 自带 quiche 编译 )
```

---

## 九、产线部署观察

### 9.1 UDP 穿透率

Cloudflare 报告：H3 探测成功率对世界公网 ~80%；中国 / 部分企业 LAN < 30%。Cloudflare 启 "Both HTTP/3 and HTTP/2"，client fallback to h2。

### 9.2 负载均衡 CID 路由

CID 在 initial packet 编码，LB 必须按 CID 路由。L4 LB 不解 CID，要 LB 在 user-space：

```
肺部 load cityName:
LB packet → quic parse → 取 DCID → hash → 一致性 → backend A
backend A 接管 conn state

client conn migration:
   new packet 同 CID，
   LB hash(DCID) = backend A → continue
```

Envoy Cloudflare 都支持，Nginx 1.25.3 quic 版也包含。

### 9.3 实际部署 4 大坑

1. UDP 中间盒 ICMP 不可达 → QUIC 通常忽略 ICMP，跳过 PMTUD；改用 DPLPMTUD（基于 RFC 8899 探 path MTU）
2. UDP 负载均衡 vs L4 LB → 需要 L7 LB 或 L4 LB 编 CID hash（如 Cloudflare）。
3. **0-RTT replay**：业务必须 anti-replay；server cache ticket + nonce + 5min。
4. CPU 占用：1 个 QUIC stream 1 packet encryption 比 TCP 多 30%（DTLS overhead + 封装到 UDP per-packet-encry）；kernel 5.18+ 才支持 offload。

---

## 十、抓帧示例

```bash
$ tcpdump -i eth0 'udp port 443' -w quic.pcap
$ tshark -r quic.pcap -Y 'quic'
 1 Initial Packet (DCID=0x9abc...) CRYPTO offset=0 len=512
 2 Initial Packet (DCID=0x9abc..., SCID=0x8def...) CRYPTO offset=0 len=128
 3 Handshake Packet (DCID=0x9abc...) CRYPTO offset=0 len=1024
 ...
```

Cloudflare 向社区开源的 [`quiche quinn`](https://quiche.io) 提供可视化协议状态。

---

## 十一、易错清单

1. **QUIC 不是 TCP 的"加速器"**：是新 stack，把 TCP/TLS 重写
2. **spin bit 不是 ack 包**：是 RTT 测量用单位 bit，1→0→1 交替
3. **ack_delay 单位是 µs / 2^N**，不是直接 µs；exponent 在 transport parameters 协商
4. **packet number 编码压缩**：1/2/4 字节靠预期值预设最近
5. **stream flow control 是两层**：连接级 + stream 级；不要混淆
6. **TLS 1.3 必须用 QUIC transport parameters extension 协商 parameters**，不是用 TLS extension
7. **CID 长 0-20 bytes, server 需要支持 cid_disc 推荐回 8 字节**

---

## 十二、这一章带走的东西

1. QUIC packet = header (long/short) + frame (STREAM/ACK/CRYPTO/PADDING/...)，每 packet 独立加密
2. packet number 单调递增 + ACK ranges 彻底解决重传歧义与 Karn 算法的需求
3. ACK frame 含 ack_delay 字段让 RTT 估计不被 socket 调度干扰
4. CID 是 conn 标识，让 NAT rebinding、mobile migration、LB routing 一致
5. 0-RTT 用 PSK + early data，replay 风险是应用层 anti-replay + 限幂等请求
6. 一线部署仍有 UDP 中间盒、LB 路由、CPU 加解密、IPv6 等挑战，但 met شر_tweet产
7. 主流库：quiche (CF), msquic (MS), lsquic (Akamai), quic-go, quinn, aioquic

## 下一节 →

[0-RTT / 连接迁移](0rtt.md) — PSK resumption 安全细节、ticket nonce anti-replay、migration PATH_CHALLENGE 与 NAT rebinding 区别。
