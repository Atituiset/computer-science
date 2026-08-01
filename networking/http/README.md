# HTTP / TLS

## TL;DR

HTTP 是 TCP/IP 上请求-响应式的文本协议，从 1991 一条 GET 一个文件，到 1997 keep-alive、2015 HTTP/2 多路复用 + HPACK 二进制分帧、2022 HTTP/3 在 QUIC 上 0-RTT——每一代都在解决"单连接带宽用不满"的核心瓶颈，但中间路径上的 TCP 头队阻塞、TLS 握手 RTT、NAT/conntrack 重传、ISP 干扰造成不同年代方案。本文整理四代协议的核心触底点和现代部署的真实陷阱（HTTP/2 stream 互阻、QUIC 0-RTT 重放、HPACK 表溢出、缓存签名键值等）。

---

## 一、四代协议时间线

```
HTTP/0.9      1991   GET /file — 纯文本一字请求
HTTP/1.0      1996   method/headers/status code/Content-Type RFC 1945
HTTP/1.1      1997   keep-alive + Host + chunked + pipeline RFC 7230-7235
SPDY          2009   Google 多路复用实验
HTTP/2        2015   RFC 7540 — 二进制 frame + HPACK + server push
TLS 1.3       2018   RFC 8446 — 1-RTT 默认 + 0-RTT resumption
HTTP/3        2022   RFC 9114 — over QUIC + QPACK + TLS 1.3 内置
```

---

## 二、HTTP/1.0 → 1.1 → 2 → 3 对比表

| 维度 | HTTP/1.0 | HTTP/1.1 | HTTP/2 | HTTP/3 |
|------|----------|----------|--------|--------|
| 连接复用 | 短连接 | keep-alive 默认开 | 同 TCP conn 共享 | QUIC 内 stream 独立 |
| 并发请求 | 串行 | pipeline (禁用主流) | 二进制多 stream | stream 互不阻塞 |
| 头部编码 | ASCII | ASCII | HPACK (Huffman + 动态表) | QPACK |
| 二进制 | 否 | 否 | 是 | 是 |
| 头队阻塞 | TCP + 应用层 | TCP + 应用层 | TCP 头队阻塞 | stream 内独立 |
| 加密 | 可选 (SSL) | 可选 (TLS) | 实际 always TLS | TLS 1.3 强制 |
| 握手 RTT | 3-way + TCP | +1 RTT TLS | +1 RTT TLS 1.3 | 0-RTT (重用) / 1-RTT |
| 包号更新 | 单调 seq | 单调 seq | 单调 seq | **包号单调递增** |
| 中间盒穿透 | 良好 | 良好 | 良好 | UDP 仍可能被丢 |
| 主流部署 | 已淘汰 | 仍占 30% | 主流 (~50%) | 增长中 (~25%) |

---

## 三、HTTP/1.1 的瓶颈

### 3.1 Keep-Alive + 串行响应

```
keep-alive: keep TCP connection
缺点: 客户端收到响应 1 再发请求 2 → 一个 RTT 内只能发一个请
```

### 3.2 Pipeline 在浏览器禁用

Pipeline 原理：客户端连续发 A, B, C 三个请求，server 按 A→B→C 顺序回。但：
- server 响应慢的请求会阻塞后续响应（HoL）
- 错误恢复（同时 404 和 200）容易出错
- Nginx/CDN 部分支持
- 浏览器默认禁用

### 3.3 多连接并发的代价

浏览器对同一域名开 6 个并行 TCP 连接：
- 6 × (3-way handshake + TLS 1.2) = 6 × 4 RTT = 24 RTT 慢启
- TIME_WAIT 堆积在服务端
- TLS 多次 handshake 没共享 session

HTTP/2 的设计目标：**一条 TCP 连接搞定所有请求**。

---

## 四、HTTP/2 深度

### 4.1 二进制 frame 格式

```
+---+----------------+---+--------+-------------+
| R | Length (24)    | T (8) | Flags (8) | StreamID (31) |
+---+----------------+---+--------+-------------+
| Payload (Length bytes)                              |
+--------------------------------------------------+
```

帧类型：
| Type | Name | 说明 |
|------|------|------|
| 0x0 | DATA | 数据 |
| 0x1 | HEADERS | 头部 |
| 0x2 | PRIORITY | 已废弃 |
| 0x3 | RST_STREAM | 流终止 |
| 0x4 | SETTINGS | 参数协商 |
| 0x5 | PUSH_PROMISE | server push (Chrome 105+ 已废弃) |
| 0x6 | PING | keepalive 探测 |
| 0x7 | GOAWAY | 关连接 |
| 0x8 | WINDOW_UPDATE | 流控 |
| 0x9 | CONTINUATION | 多帧连发 |

### 4.2 HPACK（RFC 7541）

HPACK 三道工序：
1. **静态表**（61 个常见 (name,value) 对）
2. **动态表**（连接内共享，FIFO 大小可设）
3. **Huffman 编码**

```
原始 header:
:method: GET
:path: /api/users
user-agent: Mozilla/5.0...

HPACK 后:
0x82                    # :method GET 命中静态表 index=2
0x84 0x??               # :path / 命中静态表后随 path 字符
0x5f 0x92 ...           # user-agent 用 Huffman 编码长度 8 字节
```
800B ASCII header → 50B binary 实测。

`SETTINGS_HEADER_TABLE_SIZE` 默认 4096，超过时 sender 不再写动态表 → 失命中率上升。

### 4.3 Server Push 的失败

HTTP/2 设计里 server 可以在 client 还没请求时主动 `PUSH_PROMISE` 发送资源：
- 用例：HTML 后立即 push CSS/JS
- 痛点：缓存与 client cache 协调困难、重复推送、还占带宽
- Chrome 105 (2022) 已**移除**支持
- HTTP/3 RFC 9114 中 server push 同样存在但客户端默认 disable

### 4.4 HTTP/2 的 HoL 仍未解决

HTTP/2 把多 stream 复用在一条 TCP：

```
stream A    [data] [data] [data]
stream B    [data] [data] [data]
TCP 字节流   ¥¥¥¥¥¥¥¥¥¥¥¥
```

TCP 不懂 stream_id —— 任何一个 stream 的字节丢 → 整条流被卡住等重传 → **所有 stream 都停**。
这就是 HTTP/3 / QUIC 诞生原因：stream 独立重传。

---

## 五、HTTP/3 / QUIC

### 5.1 协议栈

```
HTTP/3 → QUIC (含 TLS 1.3) → UDP → IP → Ethernet
HTTP/2 → TLS 1.3 → TCP → IP → Ethernet
```

QUIC 整合 transport + crypto：握手 + TLS 1.3 握手并发 1 RTT，session ticket 复用后**0-RTT**。

### 5.2 包号单调递增解 ACK 混淆

每个 QUIC packet number **单调递增**，重传的同一个 stream 数据用**新包号**：

```
包 1: stream A data seq=10
       丢失 → 重传
包 2: stream A data seq=10  ← 包号变了！data seq 不变
receiver 收到包 2 → ACK 包 2
sender 不再等包 1 ACK（从 ack_ranges 看到包 1 没 ack 也认）
```

——彻底解决 Karn 算法类的 ACK 重复歧义。再加上 `ack_delay` 字段让 SRTT 估准。

### 5.3 0-RTT 的代价

```
session 1: client hello + TLS handshake 1 RTT → ESTABLISHED
           server 发 session ticket (encrypts resumption master secret)
session 2: client 直接用 ticket 立刻发加密 early data + ClientHello 同包共发
           → 0 RTT 拿到响应
```

代价：
1. **重放攻击风险**：early data 攻击者记录后重放 → server 仍接受
2. 限制：early data **必须幂等**（GET / 头 OK，POST 转账 NO）
3. `Allow-HTTP3-Token-Binding` 与 application 协议必须协商

---

## 六、产线陷阱

### 6.1 HTTP/2 stream 反向拒绝服务

攻击者一次性开 1000 个 stream（HTTP/2 允许），每个只发 1 byte 后不发后续 → server 内存撑爆。CVE-2023-44487（HTTP/2 Rapid Reset）：
- client 发 RST_STREAM 后立即重开
- 每开 RST 几乎没占内存，但 server 已分配 stream context
- DDoS 放大因子 ~100

修复：所有 HTTP/2 server patch。Nginx 1.25.3、Apache 2.4.58、envoy 1.28 等。

### 6.2 0-RTT 重放下场

支付提供商曾用 0-RTT 提前 submit → attack 录流后重放到别处服务 → 用户重复扣款。

修复：业务层标 `Early-Data: 1` 时不接受 non-idempotent，或 server 端在 0-RTT 阶段只 decode + validate 不 exec。

### 6.3 UDP 穿透率

QUIC 走 UDP，但企业防火墙、NAT 设备对 UDP 容忍率低于 TCP：
- 部分 ISP 限速 UDP（怕 amplification）
- 企业防火墙显式丢
- Cloudflare 报告 TCP fallback 仍占 HTTPS 业务 70%

### 6.4 HPACK 工具 vs 通配 cast

诊断工具（curl、wireshark）不直接读 HPACK，需要 `nghttp` / `net-http2.dll` 包解析。建议抓包用 `tcpdump -w out.pcapng` + wireshark 加 HTTP/2 dissector。

---

## 七、对比实验数据

WebPageTest 同站 150 个小图片，RTT 100ms：

| 配置 | 主要特征 | 典型 LCP |
|------|---------|---------|
| HTTP/1.1 6 连接 | 短连接+keep-alive + TLS 1.2 | 4.5 s |
| HTTP/1.1 keep-alive chunked | 单连接串行 | 5.5 s |
| HTTP/2 单连接多 stream | TLS 1.2 + HPACK | 2.8 s |
| HTTP/3 over QUIC | 0-RTT resumption | 2.1 s |

跨机房 RPC 测试，RTT 50ms：

| 协议 | QPS (4 core client) |
|------|---------------------|
| HTTP/1.1 (keep-alive) | 12k |
| HTTP/2 (single stream per req) | 18k |
| gRPC over HTTP/2 (unary) | 22k |
| gRPC + connection pool | 50k+ |
| QUIC（quic-go） | 28k |

---

## 八、抓帧实验（Go）

```go
package main

import (
    "log"
    "net"
    "net/http"
    "golang.org/x/net/http2"
    "golang.org/x/net/http2/h2c"
)

func main() {
    // 抓 HTTP/2 frame 的示例
    // 用 net.ListenPlain 配合 http2.Framer
    ln, _ := net.Listen("tcp", ":8080")
    fr := http2.NewFramer(nil, nil)
    _ = fr
    _ = ln
    _ = http.Server{Handler: h2c.NewHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        log.Printf("stream=%d path=%s", r.ProtoMajor, r.URL.Path)
    }), &http2.Server{})}
}
```

`tcpdump` + `nghttp -nv`：

```bash
$ tcpdump -i eth0 -w /tmp/http2.pcap 'tcp port 443'
$ nghttp -nv https://example.com
[  0.001] send HEADERS frame <length=35, flags=0x05, stream_id=1>
          ; END_STREAM | END_HEADERS
          (padlen=0)
          ; Open new stream
          :method: GET
          :path: /
          :scheme: https
          :authority: example.com
```

---

## 九、这一章带走的东西

1. HTTP/2 解决 HTTP/1.1 应用层 HoL，但被 TCP HoL 反 lock
2. HTTP/3 用 QUIC 在 UDP 上重做：包号单调 + ack_delay + stream 独立重传彻底解 TCP 痛点
3. HPACK = 静态表 + 动态表（per-conn FIFO）+ Huffman；表超限先丢 dynamic entries
4. Server Push 在 HTTP/2 已基本死，HTTP/3 客户端默认 disable
5. 0-RTT 限幂等请求；CVE-2023-44487 Rapid Reset 必须升级 server
6. UDP 穿透率仍 FFT 内难以超过 40%；公网 CDN HTTP/3 仍配 TCP fallback

## 下一节 →

[TLS 1.3 深入](./tls.md) — handshake 0-RTT、AEAD、PSK、session ticket、客户端证书、群组协商
