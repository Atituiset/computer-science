# 0-RTT / 连接迁移

## TL;DR

0-RTT 让 client 在第一个 RTT 还没完成的时刻就发出应用层请求；连接迁移让 client 跨 ISP、跨物理链路保持续通信。两个机制都依赖 Connection ID 与 PSK，但都面临运维苛刻的边界。本节解开 PSK 派生、ticket anti-replay 防御策略、PATH_CHALLENGE 路径验证、移动端真实 migration 实战。重点：把"0-RTT 只 GET、CM 不破" 变成实际业务部署 checklist。

---

## 一、PSK 与 Session Resumption

### 1.1 概念层次

```
TLS handshake 1 RTT
              ↓
HKDF derives early_secret + handshake_secret + master_secret
              ↓
server 在 handshake 完成 + Application Data 后发 NewSessionTicket frame:
       NewSessionTicket {
           ticket_nonce = 0x...,
           ticket_age_add = 0x...,
           ticket_lifetime = 7200 sec,
           ticket = <encrypts resumption_master_secret + server state secret>
       }
client 收 NewSessionTicket 后 cache:
       - ticket bytes
       - psk_identity = ticket
       - psk = HKDF-Expand-Label(resumption_master_secret, "resumption", "", Hash.length)
              ↑ 客户端从 full handshake derive 出来的
```

### 1.2 第二次连接用 PSK

```
client → Initial packet:
          ClientHello:
              identity = ticket
              obfuscated_ticket_age = ((now - ticket_receipt_time) + ticket_age_add) mod 2^32
              key_share = X25519 pubkey   (for DLE-PSK, mode = psk_dhe_ke)
          0-RTT packet:
              CRYPTO frame with early data (e.g. HTTP/3 GET /index.html)
              STREAM frames (HTTP/3 body if any)

server decrypt Initial packet:
   1. Hash ticket to find original master secret in cache
   2. Verify obfuscated_ticket_age is reasonable (within lifetime)
   3. Derive early traffic secret from PSK + new ClientHello
   4. Decrypt 0-RTT early data
   5. Process early data synchronously (server's CRYPTO frame scheduling)
```

### 1.3 PSK vs ECDHE (no PSK) 对比

| 维度 | PSK-only | PSK+DHE | Full ECDHE |
|------|----------|---------|-------------|
| 握手 RTT | 1 (or 0) | 1 | 1 |
| 0-RTT 가능 | 是 | 是 | 否 |
| 前向安全 | 否 | 是 | 是 |
| 推荐 | 不建议 | 强推 | 新 conn |

PSK+DHE (`psk_dhe_ke`) 让 PSK resumption 仍有前向安全：即使 PSK 泄漏，所有历史流量仍由 ECDHE 派生的 secret 保护。

---

## 二、0-RTT 详解

### 2.1 packet 列表

```
1) Initial Packet (with PSK extension + key_share):
      Crypto (ClientHello)
2) 0-RTT Packet (encrypted with early traffic secret):
      Crypto (early data part 1)
      STREAM (HTTP/3 HEADERS + DATA)
3) 0-RTT Packet (continued):
      Crypto (early data part 2)
      STREAM (continued)
   ...
4) After server's Handshake Done: client sends 1-RTT packets:
      STREAM (application data after handshake)
```

client 端发完 0-RTT 后**继续用 0-RTT secret 加密** 应用数据直到 server Finished reply；之后切到 1-RTT。

### 2.2 0-RTT 接受条件

server 决定是否接受：
- ticket 有效且未过期
- ALPN 协议匹配（HTTP/3 vs h2 vs dq）
- application protocol 与历史 session 一致
- SNI 与 ticket 中记录一致（防 cross-SNI replay）

server 可以**部分接受**：拒绝 0-RTT early data 但接受 PSK resumption，让 cwait 1-RTT 完成发应用数据。client 看到 rejection 就回 1-RTT 发 data。

### 2.3 anti-replay 实战

**RFC 8446 §8**：
> "Implementations MUST NOT use early data for non-idempotent requests"
> "If implemented incorrectly, TLS 1.3 0-RTT creates a new replay attack channel"

四道防线（建议全栈部署）：

1. **业务层幂等限制**：early_data 仅 GET/HEAD，POST/DELETE 等危险操作 server 端 detect `Early-Data: 1` 视为非约定后续，回 `425 Too Early` (RFC 8470)
2. **application layer token**：early data 中携带 unique request_id，server 维护 5min cache → 重复 request_id 拒
3. **PSK + ticket_nonce 单调**：server 给每个 ticket 分配 unique nonce，accept early_data 时入 cache;新 early_data 必 nonce 新
4. **time window**：ticket lifetime 严格 24小时，避免 long-term replay window

### 2.4 部署观察

| 厂家 | 接受 0-RTT | anti-replay 策略 |
|------|-----------|------------------|
| Cloudflare | 是 (default) | token nonce cache + GET only |
| AWS CloudFront | 是 (selective) | 业务路由 harness + replay reject |
| Akamai | 是 (selective) | nonce per ticket |
| Google Services | 是 | 业务路由 + replay window |
| 自部署 nginx | opt-in | 必须自定义 module |

实际 deployment：request_id 防重 / idempotency_key / 限 24h window / 1MB early data cap。

### 2.5 0-RTT 字节 budget

```
H3 SETTINGS frame:
   SETTINGS_H3_DATAGRAM = 1
   SETTINGS_QPACK_MAX_TABLE_CAPACITY = 4096
   SETTINGS_H3_MAX_FIELD_SECTION_SIZE = 16384   ← early data 超过这个早期失败
   SETTINGS_H3_ENABLE_CONNECT_PROTOCOL = 0
```

0-RTT max early data size 用 transport parameter `max_early_data_size` 协议。Cloudflare 实测 limit 4096B，避免 0-RTT 占带宽。

---

## 三、连接迁移

### 3.1 CID 与 4-tuple 解耦

```
TCP conn = (src_ip, src_port, dst_ip, dst_port)
            ↑ 一改 conn 死
QUIC conn = Connection ID (1-20 byte arbitrary randomly assigned)
            ↑ 4-tuple 不参与 conn 状态 → 可以随便换
```

握手期 client 与 server 各发 SCID/DCID：
```
client Initial packet:
   DCID = 0x9abc9abc (random 8 bytes by client)
   SCID = 0x8888 (or empty)

server Initial packet:
   DCID = 0x9abc9abc (echo'd from client)
   SCID = 0x... (random, server 选)
```

之后 client 用 DCID = server SCID 反向。每个方向均有 CID 与 packets 路由 table 一一对应。

### 3.2 NEW_CONNECTION_ID frame

server 后续可以发更多 CID 给 client (写在 encrypted 1-RTT packets 中)：
```
NEW_CONNECTION_ID {
   sequence_number = 2,
   retire_prior_to = 0,    # sequence < 此值 应主动 RETIRE_CONNECTION_ID
   connection_id = 0x....,
   stateless_reset_token = ... 16 bytes for 性能 reset
}
```

机制作用：
- 让 client 多 CID 多个 SPD alias 同时打 → 防 tracking
- 一次 issue ~8 个 CID，rotate 池

### 3.3 PATH_CHALLENGE / PATH_RESPONSE

```
PATH_CHALLENGE frame body: random 8 bytes (binary token)
PATH_RESPONSE frame body: same 8 bytes echo'd
```

**路径验证流程**：

```
A → B: send packet on path_1 (CID 不变)
A want switch path → send PATH_CHALLENGE to B with new 4-tuple
                              ↑ random 8 bytes (<path_x>)
B → A: receive PATH_CHALLENGE on path_x
       send PATH_RESPONSE on the SAME path (path_x) with same 8 bytes
A → B: receive PATH_RESPONSE on path_x → path_2 validated → start send on path_2
```

### 3.4 NAT Rebinding

NAT rebinding 是被动迁移：client 看到不变，server 看到变了。
```
家 NAT 老化期 300s → NAT 给新 port 给 client
client 继续在 NAT 后 socket 发，packets 出来 NAT 后 src port 变了
server 看到 src port 变 → 主动 PATH_CHALLENGE → 验证新 path → OK 后切回去
client → 不感知
```

### 3.5 Migration 流程对比

| 维度 | NAT Rebinding (被动) | Active Migration (主动) |
|------|-------------------|------------------------|
| 起因 | NAT 切换 / ISP NAT 中 port rotation | client WiFi ↔ 4G 切换 |
| 谁主动 | server 立刻发 PATH_CHALLENGE | client 立刻在新 socket 发 PATH_CHALLENGE |
| 回应验 | client 被动 PATH_RESPONSE | server 回 PATH_RESPONSE |
| 流中断 | < 1 RTT (server 推断) | 切换 ≥ 1 RTT |

### 3.6 跨 ISP 切换实战

某乘客在 youtube 上加速：
```
T=0: home WiFi, conn A start watching
       client DCID = 0x..., 4G IP 1.1.1.1 port 4500 → CDN 2.2.2.2
T=10s: leave home, WiFi lose → 4G active

client 操作系统感知 socket drop:
  same socket close 在 WiFi 下拉
  new socket 在 4G 上起, 用 same CID = 0x...
  
T=11s: send PATH_CHALLENGE on new 4G path
  packet goes through 4G modem (new NAT) → server sees src IP = 3.3.3.3
  server → PATH_RESPONSE on 3.3.3.3
  client validated → server will send new packets back to 3.3.3.3 → 继续 watch
  total interrupted ≤ 1-2 s
```

如果 TCP+TLS：conn 死，client 必须重新建立 TCP connection + TLS handshake (1 RTT TLS 1.3 + slow start restart from cwnd=1) → 5+ 秒中断。

---

## 四、CPU 加密 / stateless reset

### 4.1 stateless reset 防中间盒挂死

client 突然 abort without send CONNECTION_CLOSE，server 此 event 会留 connection 资源。stateless reset token 是方案：

```
server 给一个 connection_id 时也发出 token
       NEW_CONNECTION_ID { ..., stateless_reset_token = T }

server 看到 unknown DCID (OR off reboot 后) -> 仍能 identify 原来是个 QUIC packet
   生成 stateless reset packet 发出 token = T → client 收到理解 conn closed

stateless reset packet:
       short header + connection_id = unknown 0x... + a bit pattern (1)
       ↑ 比 CONN_CLOSE 小得多 (with encrypted CONN_CLOSE frame 没法 decrypt)
```

### 4.2 加密性能

QUIC 每 packet 走 AEAD：
- AES-128-GCM：3 cycles/byte on AVX-512 → 12 Gbps per core
- ChaCha20-Poly1305：4 cycles/byte on AVX2 → 8 Gbps per core

10 Gbps link + 1.5KB packet CPU 负载 1.7 Gbps/core。Cloudflare quiche 报告 QUIC server 50 Gbps 是命中 user space upgrade 满载。

---

## 五、产线部署观察

### 5.1 移动网络 migration 命中率

| 网络 | migration 命中率 |
|------|------------------|
| WiFi → 4G 家庭场景 | ~95% QUIC migration 实际触发 |
| 4G 行车跨基站 | <20% 命中（NAT port 频繁变	RENABLED） |
| 卫星切换 | 暂不稳 |
| LTE → WiFi Hotspot | ~70% 成功 |

### 5.2 LB / Reverse proxy 配置

```nginx
http3 {
    server {
        listen 443 quic reuseport;
        http3 on;
        ssl_protocols TLSv1.3;
        ssl_early_data on;
        add_header Alt-Svc 'h3=":443"';
        
        # QUIC 设置
        quic_max_concurrent_streams 256;
        quic_initial_max_data 16M;
        quic_initial_max_stream_data 1M;
        quic_idle_timeout 60s;
        quic_retry on;
    }
}
```

`quic_retry on` 让 server 启用 Retry packet 防 amplification attack：client initial + 0-RTT 总字节数 <1200B 上限，retry 让 server 拒绝 0-RTT。

### 5.3 客户端配置 quiche

```rust
let mut config = quiche::Config::new(quiche::PROTOCOL_VERSION)?;
config.set_application_protos(b"\x02h3")?;
config.set_max_idle_timeout(30_000);                 // conn idle 30s
config.set_max_udp_payload_size(1452);                // PMTU
config.set_initial_max_data(15_360_000);              // conn-level flow
config.set_initial_max_stream_data_bidi_local(1_536_000);
config.set_initial_max_stream_data_bidi_remote(1_536_000);
config.set_initial_max_streams_bidi(100);
config.set_initial_max_streams_uni(10);
config.set_disable_active_migration(false);           // 允许 migration
config.enable_dgram(true, 1024, 1024);                 // datagram
config.set_active_connection_id_limit(8);              // 多 CID pool
```

### 5.4 0-RTT 业务案例

```
推特 APP feed refresh:
   第 1 次启动 app: full handshake 1 RTT, server 返 NewSessionTicket
   ...
   第 N 次 (24h 内): 0-RTT + GET /v2/feed
      实测 P50 save 150ms (60ms RTT + trace send)
      P99 save 200ms

GET / HTTP/1.1
Host: api.twitter.com
X-Requested-With: twitter
X-Device-ID: ...
X-Request-ID: abc-123 ← anti-replay nonce
```

server 看到 early_data:
- 取 X-Request-ID validate in cache
- 执行 GET /feed → 回 200 + data
- 同 request_id 来了 → reject 425

---

## 六、产线事故

### 事故 1：0-RTT replay 在电商

某购物 APP 启用 0-RTT 后**没有 anti-replay**，攻击者录流重放 → 重复下单。中剂量 6 位数。

**修复**：
1. 业务层用 X-Request-Id (uuid) + 5min cache
2. server 看到 `Early-Data: 1` 时 IP+uid+request_hash 入 cache
3. 路由约束：0-RTT 仅允许 GET / HEAD；POST 自动回到 1-RTT
4. application_id_quota 限速

### 事故 2：移动 migration 引发 server 累积 conn

某 LB 没识别 CID 路由 → migration 后包 route 到不同 backend → 第二个 backend 不知 conn state → reset。client 看到连接 drop 而重连。

**修复**：LB 用 user-space QUIC 解析 + CID 一致性 hash + 状态共享（如 redis）。

### 事件 3：PATH_CHALLENGE 被中间盒 buffer.PageEntry

WiFi → LTE 切换，client 发 PATH_CHALLENGE，但运营商的路由器因为不熟悉的 IP 没回。client 等到 idle timeout 60s 拒连。

**修复**：调短 timeout（路径迁移不短、但 idle 总 timeout），或 fallback TCP+TLS。

### 事件 4：UDP 中间盒 fire timeout

某国家出口防火墙 UDP idle timeout 60s，QUIC 慢连接往往 30s+ 才发 ping → 阻断。

**修复**：QUIC keepalive 改 15s + 自动 fallback TCP HTTPS。

### 事故 5：0-RTT Sentiment是批 但业务早期 run break

某 API 在 0-RTT 时已收到流量 → 重启 backend。内存 cache 丢了 first 5min ticket nonce →- replay 之前 cache ticket 仍 work → 实际录流票 5min 内可重放。

**修复**：server 重启清 cache + session ticket rotation + 30s 上线 dryrun。

---

## 七、易错清单

1. **0-RTT replay 是 cross-connection**，TLS 1.3 不防护，必须 application frequency 检测 nonce / request_id
2. **PSK-only 模式无前向安全**，推荐 PSK+DHE
3. **PATH_CHALLENGE 不应该用 known bytes**，必用 random 8 字节
4. **CID 长度建议 8 字节**：4B 太短碰撞风险，20B too long bandwidth 浪费
5. **NEW_CONNECTION_ID 多 CID 池可抗 correlation tracking**：8个 CID ~8 同时可用
6. **stateless reset token 是 server 给的**，client 不要逼 send。server 在 conn state lost 时用
7. **migration 必须完整验证 path**：semi-validated state 暂时不应该算 ready
8. **0-RTT 不能用于 streaming 长流**：实际上 0-RTT 后必须切到 1-RTT，连续 streaming 已必须完整 handshake

---

## 八、这一章带走的东西

1. 0-RTT 用 PSK + early traffic secret，**只有幂等请求能走**，业务必须 anti-replay
2. PSK-DHE 保前向安全，能 implement 0-RTT 兼顾 PFS
3. CID 是连接唯一标识，让 mobile migration、LB routing 与 NAT rebinding 一致
4. PATH_CHALLENGE / PATH_RESPONSE 是路径验证机制，是 migration 与 NAT rebinding 同一回事
5. 0-RTT 实战部署：request_id nonce + 5 分钟 anti-replay cache + 限 4-16KB
6. migration 让 mobile 用户跨 ISP 持续使用，但 LB 必须解 CID；3-5 跳路由防水 dissipation 是变窄点

## 下一节 →

[BBR 在 QUIC 下的表现](bbr.md) — ack_delay 解放、QUIC 流量整形、BBR v3 在 quiche / msquic 实验部署。
