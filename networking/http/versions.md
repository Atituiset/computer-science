# HTTP 1.0 → 1.1 → 2 → 3

## TL;DR

四代 HTTP 都在解决同一问题——**单连接带宽用不满**。从 keep-alive 到多路复用，从 ASCII 到 HPACK 二进制帧，从 TCP 承载到 QUIC UDP——每一代的真正动机、协议字节、landing 接入陷阱、产线事故全部展开。本文让你看 digest 时能写出 wireshark 字节布局、讲清 RFC 关键设计点，回答"HTTP/2 HoL blocker vs HTTP/3 strictly better" 这类面试与现场问题。

---

## 一、HTTP/1.0 (RFC 1945, 1996)

### 1.1 协议原始格式

```http
GET /index.html HTTP/1.0
User-Agent: Mozilla/1.0
Accept: text/html

HTTP/1.0 200 OK
Date: Mon, 12 Aug 1996 05:30:00 GMT
Server: NCSA/1.4.2
Content-Type: text/html
Content-Length: 1234

<html> ...
```

特点：
- 每次请求必新建 TCP 连接，结束就 FIN
- header 都是 ASCII，CRLF 结尾，空行结束 header
- 必须用 `Content-Length` 或关闭连接表示响应结束
- 无 Host header → 一 IP 一域名 → 不能 name-based virtual host

### 1.2 keep-alive 非标准

虽 RFC 1945 定义的是短连接，但实际浏览器 + Apache 都用非标准 extension：
```http
Connection: keep-alive
```
让 TCP 连接留住一会儿复用。是 HTTP/1.1 默认行为的来源。

---

## 二、HTTP/1.1 (RFC 7230-7235, 1997, 2014 重写)

### 2.1 关键改动

1. **`Connection: keep-alive` 默认**：要关闭需 `Connection: close`
2. **Host header 强制**：实现 name-based virtual hosting
3. **chunked transfer encoding**：响应没 length 时可流式分块
4. **pipeline**：可批量发请求但响应必须按序

### 2.2 chunked 编码

```http
HTTP/1.1 200 OK
Transfer-Encoding: chunked
Content-Type: application/json

7\r\n
Mozilla\r\n
9\r\n
Developer\r\n
7\r\n
Network\r\n
0\r\n
\r\n
```

每 chunk 前 16 进制长度 + CRLF，`0\r\n\r\n` 结束。让 server 在不知道总长时流式发送——典型场景：ssevent stream、动态生成 PNG、tape archive。

### 2.3 pipeline 的实战死法

pipeline 理论让 client 一次发 N 个 request 不等响应，server 必须按序回。但：

```
client → server: 1, 2, 3 (pipeline)
server 处理 1 需 2 s; 处理 2/3 各 50 ms
**1 的响应 slow → 2/3 响应也卡**
```

更头疼：proxy 链 + pipeline → 反序响应、错配流难诊断；opportunistic IDemPotent OWASP 攻击 → CVE。最终：
- 浏览器（Chrome、Safari）**禁用** pipeline
- Nginx 接收 pipeline 但单连接内仍是按序回
- HTTP/2 用 stream + 二进制帧取代这个设计

### 2.4 keep-alive 实战

```
server.conf:
keepalive_timeout 75;       # 同上 idle 75s 后强制 FIN
keepalive_requests 100;     # 100 个请求后强制重连（防内存碎片）
```

完全用满 keepalive：
- 节省每请求 2-RTT（TCP + TLS handshake），100 ms RTT 下吞吐 ×6
- 但每个 idle 连接占 30KB+ 内存 + 一个 conntrack entry (300 bytes)
- 50k client × 100 = 5M conntrack → 必须配 `nf_conntrack_max` 与 LVS pool

### 2.5 keep-alive 仍存在的痛点

1. **TCP HoL**：单连接内串行响应 → 慢请求阻塞快请求
2. **6 conn 并发上限**：浏览器对同域名起 6 个 TCP 加速 → 但每个都要 TLS handshake 浪费 RTT
3. **slow start**：每个新 TCP 都从 cwnd=1 起跑数 RTT 才达工作带宽

---

## 三、HTTP/2 (RFC 7540/9113, 2015/2022)

### 3.1 设计目标：单连接多 stream

```
       ┌── stream 1 (request A, response A)
client ─── stream 3 (request B, response B)        ── server (1 TCP conn)
       └── stream 5 (request C, response C)
```

每个 stream 在同 TCP 内通过二进制 frame 交错，独立 flow control + 优先级。

### 3.2 Frame 字节布局

```
+-----------------------------------------------+
|                 Length (24)                    |
+---------------+---------------+---------------+
|   Type (8)    |   Flags (8)   |
+-+-------------+---------------+-------------------------------+
|R|                 Stream Identifier (31)                      |
+=+=============================================================+
|                   Frame Payload (0...)                      ...
+---------------------------------------------------------------+
```

9 字节固定头 + payload（最大 16 MB 可配）。

### 3.3 帧类型完整清单

| Type | Name | 说明 |
|------|------|------|
| 0x0 | DATA | 请求体或响应体 |
| 0x1 | HEADERS | 压缩 header（HPACK） |
| 0x2 | PRIORITY | stream 优先级（H2 deprecated，H3 已删） |
| 0x3 | RST_STREAM | 重置单个 stream |
| 0x4 | SETTINGS | 参数协商 |
| 0x5 | PUSH_PROMISE | server push（已 deprecate） |
| 0x6 | PING | keepalive 探测 |
| 0x7 | GOAWAY | 整连接优雅关闭 |
| 0x8 | WINDOW_UPDATE | 流控窗扩容 |
| 0x9 | CONTINUATION | HEADERS 续帧（分解较大 HPACK） |
| 0xa | PRIORITY_UPDATE | (HTTP/2 ext) |

### 3.4 SETTINGS 协商

```
SETTINGS_MAX_CONCURRENT_STREAMS    100 (server 默认)
SETTINGS_INITIAL_WINDOW_SIZE       65535 (B, 单 stream 流控)
SETTINGS_MAX_FRAME_SIZE            16384 (16 KB)
SETTINGS_HEADER_TABLE_SIZE         4096 (HPACK dynamic table)
SETTINGS_ENABLE_PUSH               0   (client 显禁 server push)
```

### 3.5 流控三层结构

```
连接级 WINDOW_UPDATE   ← 控总量 (default 64 KB)
       ↓
stream 级 WINDOW_UPDATE ← 每流控 (default 64 KB)
       ↓
应用读 bufferHashSet 不通知原则 → TCP 当 wire 上暂存
```

server 单 stream 攻击者开 1000 stream 占 64 MB，server 默认就**死守**。生产 defaults 应缩小：

```nginx
http2_max_concurrent_streams 32;
http2_max_field_size 4k;
```

### 3.6 gRPC = HTTP/2 + protobuf

```http
POST /helloworld.Greeter/SayHello HTTP/2
content-type: application/grpc+proto
te: trailers

<length-prefixed protobuf bytes>
grpc-status: 0
grpc-message: OK
```

四种 RPC pattern：
1. **unary**：1 req → 1 resp
2. **server stream**：1 req → N resp
3. **client stream**：N req → 1 resp
4. **bidi**：N req ↔ N resp（每 req 一个 frame）

gRPC stream 用 HTTP/2 stream id 复用 → 一 TCP gRPC 连接同时跑多个 client/server stream 调用：

```go
client.go (示例)
conn, _ := grpc.Dial("localhost:50051",
    grpc.WithTransportCredentials(insecure.NewCredentials()),
    grpc.WithDefaultCallOptions(
        grpc.MaxCallRecvMsgSize(16 * 1024 * 1024),
    ),
)
client := pb.NewGreeterClient(conn)
resp, err := client.SayHello(ctx, &pb.HelloRequest{Name: "world"})
```

---

## 四、HTTP/3 (RFC 9114, 2022) over QUIC

### 4.1 帧字节布局

QUIC packet header (short / long form) + payload (含加密后的 HTTP/3 frame)：

```
0                   1                   2                   3
+0+0+0+0+0+0+0+0+0+0+1+1+1+1+1+1+1+1+1+1+2+2+2+2+2+2+2+2+2+2+3+3
+0+1+2+3+4+5+6+7+8+9+0+1+2+3+4+5+6+7+8+9+0+1+2+3+4+5+6+7+8+9+0+1
+-+-+-+-+-+-+-+-+
|0|1|  Form Bit |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                         Packet Number (8/16/32)               |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                       Encrypted Payload (variable)          ...
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

每个 frame（HTTP/3 自有的帧结构）：
```
+------+--------+
| Type | Length |
+------+--------+--------+
| Frame Payload (Length bytes) |
+------+--------+--------+
```
- Type 0x00 / 0x01 / 0x02 / 0x04 / 0x05 / 0x07 / 0x0d 等
- 比 H2 多一个 type for transport-level 信号（`GOAWAY`, `SETTINGS`, `HEADERS`, `DATA`, `CANCEL_PUSH`）

### 4.2 QPACK vs HPACK

QPACK 用相同**思想**（静态表 + 动态表 + Huffman），但：
- 动态表更新和 stream 数据**异步**，避免阻塞 head-of-stream
- 静态表 99 / 99 字段（vs HPACK 61）
- 更高的失命中率代价

实测：HPACK 压缩比 16×；QPACK 在乱序 stream 场景 12-15×，常规场景与 HPACK 相当。

### 4.3 0-RTT 细节

session ticket 用 PSK：
```
client 第 1 次连接 (TLS handshake 1 RTT)
client ← server: NewSessionTicket (encrypts resumption_master_secret)

client 第 2 次连接 (用 ticket 加密 early data)
client → server:  SYN+早期 ClientHello + 早期 data (0-RTT)
                  → 此包 server 已能解密 data → 直接处理 GET /index.html
                  → server 同样返回早期 response (0-RTT)
        client 服务端发回 Finished + 主后续 1 RTT 升级 full handshake
```

**早期 data = replayable**。攻击者可记录再重放 → server 不能区分，因此：
- early data 只能做**幂等**请求（GET、HEAD、OPTIONS）
- POST/PUT 必须等 1-RTT 完成后才能发出（client 自己控制）
- server 可识别 `Early-Data: 1` header 拒绝某些路由

### 4.4 不同部署版本对比

| 环境 | HTTP/3 占比 |
|------|-------------|
| Cloudflare 主流客户 | ~25%下行 |
| Google Web | ~60% |
| Microsoft Edge traffic | 15% |
| 中国国内 IDC | <5%（UDP 不通） |
| 公网移动网络 | 慢速增长 |

---

## 五、产线事故

### 事故 1：CVE-2023-44487 Rapid Reset

**症状**：2023-08 一周内世界几大云 + CDN 全 DDoS (Cloudflare 398M rps、AWS 155M rps)。

**根因**：HTTP/2 允许 client 快速 `HEADERS` + `RST_STREAM`，server 端的 stream context 在 RST 后不会立刻释放 → 单 client 通过高频 cycle 占尽 server 内存。

**修复**：升级 Nginx 1.25.3 / Apache 2.4.58 / envoy 1.28 / h2o 2.2.7+。把每 client 的 `max_concurrent_streams` 设小、RST 频率限速。

### 事故 2：gRPC stream leak

gRPC client 不 `CloseSend()` 即直接 release → server 不知 stream 结束 → server 保留 stream 直到 idle timeout (1h) → 内存撑爆。

**修复**：always `defer stream.CloseSend() + ctx cancel`，监控 `grpc_server_stream_started` 长寿命数。

### 事故 3：0-RTT 在电商被 replay

支付订单走 0-RTT 优化 → 攻击者录流后从 VPN 重放 → 重复扣款。

**修复**：注入 ticket 时用 IP 绑定 + nonce，server 端用 `Early-Data: 1` 标识后**强制**主握手才允许写。

### 事故 4：HPACK 表小导致吞吐腰斩

某 nginx 启了 `http2_max_header_list_size 4k` 但 client 发的 1KB+ 头：HPACK 之后动态表超过了 4k 上限 → server 拒绝大头部请求 → 多余 stream 失败。`10721` 错误率 30%+。

**修复**：把 `http2_max_header_list_size` 提到 16k，并考虑 `http2_max_field_size 8k`。

### 事故 5：HTTP/3 UDP 中间盒丢

某企业 LAN FW：UDP 默认 drop，HTTPS H3 探测 100% 失败 → fallback TCP HTTP/2，但部分 client 没配 fallback → 静默墙内访问慢。

**修复**：业务客户端配置 `protocols: ['h3', 'h2']`，自动降级。

---

## 六、易错清单

1. **HTTP/2 与 HTTP/3 不能简单"换"**：HTTP/3 在 QUIC 上，QUIC 在 UDP 上，TLS 1.3 内嵌
2. `Connection: keep-alive` 在 HTTP/2 中不再有意义（HTTP/2 自带持久），但兼容性仍允许
3. **pipeline ≠ HTTP/2 stream**：前者是 1.1 RFC 7230 历史遗物，已 deprecated
4. **HTTP/2 必须 over TLS** 是 RFC 9113 强约束，h2c (HTTP/2 cleartext) 仅内网用
5. **0-RTT 限幂等**：业务必须考虑 replay 防御
6. **gRPC stream 不会自动 GC**：必须显式关闭、或 ctx cancel
7. **HPACK dynamic table 是 per-connection**，不会跨连接传给多 IDLE → 表失命中率接高 → 帧足够数据就降级到全 Huffman

---

## 七、这一章带走的东西

1. HTTP/1.1 → HTTP/2 用二进制 frame + HPACK + stream 多路复用解决"单连接串行响应"瓶颈
2. HTTP/2 没解决 TCP 层 HoL，HTTP/3 在 QUIC UDP 上重写，stream 独立重传 + ack_delay + 单调包号
3. 0-RTT、HPACK dynamic table、gRPC stream leak 是 push prod 的三条最常见坑
4. CVE-2023-44487 HTTP/2 Rapid Reset 是所有 HTTP/2 server 强制升级触发线
5. UDP 穿透率是 HTTP/3 的硬约束，必须配 h2 fallback
6. `nghttp -nv <url>` + wireshark HTTP/2 dissector 是抓帧主力

## 下一节 →

[TLS 1.3 深入](./tls.md) — 1-RTT handshake / 0-RTT resumption / AEAD / session ticket / 证书协商
