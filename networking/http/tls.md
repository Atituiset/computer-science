# TLS 1.3 与现代加密握手

## TL;DR

TLS 1.3（RFC 8446, 2018）从 2-RTT 握手降到 1-RTT，session resumption 进一步 0-RTT。本节从 RFC 字节布局追到 `openssl s_server` 选项、PSK 与 session ticket 的骗酮、AEAD 加密数据流、ECH (Encrypted Client Hello) 的部署现状。重点：解释为什么 TLS 1.3 比 1.2 安全、0-RTT 的重放代价、出口运维必备的 `ssl_session_cache` 调优。

---

## 一、TLS 1.2 → TLS 1.3 演进

### 1.1 TLS 1.2 完整握手 2 RTT

```
client                                          server
  → ClientHello                                   →
                                                  ← ServerHello
                                                  ← Certificate
                                                  ← ServerKeyExchange
                                                  ← ServerHelloDone
  → ClientKeyExchange (ECDHE pubkey)              →
  → ChangeCipherSpec
  → Finished
                                                  ← ChangeCipherSpec
                                                  ← Finished
  → Application Data                              →
```

特征：
- ServerHello 之后**全明文**，包括证书与 server ECDHE 公钥
- 2 RTT 才能发第一个应用字节
- 加密 + 完整性握手分开（`ChangeCipherSpec`）
- 套件数量 30+，包含 CBC（易出 BEAST/POODLE/Lucky13）、static RSA（无前向安全）、MD5/SHA1

### 1.2 TLS 1.3 1-RTT 握手

```
client                                          server
  → ClientHello {key_share, psk, ...}            →
                                                  ← ServerHello {key_share, suite}     ← 此处已加密
                                                  ← EncryptedExtensions
                                                  ← Certificate
                                                  ← CertificateVerify
                                                  ← Finished
  → Finished                                       →
  → Application Data                              →
                                                  ← Application Data
```

ServerHello 之后所有字节**已加密** — 证书、签名、扩展全部在内。1 RTT 后 client 立即发应用数据。

为什么 1 RTT 够了？因为 client 在 `key_share` extension 中**直接带 ECDHE 公钥**，server 不必等 client_key_exchange 也能算出 handshake secret → 加密可立即起步。

---

## 二、TLS 1.3 详细字段

### 2.1 ClientHello body

```
struct {
    ProtocolVersion legacy_version = 0x0303;       // 仍写 1.2 协商
    Random random;                                  // 32 字节
    opaque legacy_session_id<0..32>;                // 1.2 兼容, 1.3 设为非空, 后看 server 回应是 sts 还是真的 mode
    CipherSuite cipher_suites<2..2^16-2>;           // MUST 全部 AEAD
    opaque legacy_compression_methods<1..2^8-1> = {0};
    Extension extensions<8..2^16-1>;
} ClientHello;

extensions: supported_versions, key_share, supported_groups,
            signature_algorithms, server_name (SNI),
            pre_shared_key, psk_key_exchange_modes,
            early_data (for 0-RTT),
            ...
```

### 2.2 ServerHello body

```
struct {
    ProtocolVersion legacy_version = 0x0303;
    Random random;
    opaque legacy_session_id_echo<0..32>;          // 回显 client 的
    CipherSuite cipher_suite;                       // 选定
    opaque legacy_compression_method = 0;
    Extension extensions<6..2^16-1>;
} ServerHello;

extensions: supported_versions (0x0304), key_share, pre_shared_key
                            (if PSK only mode)
```

### 2.3 加密握手 secret

```python
# TLS 1.3 HKDF 提取
early_secret  = HKDF-Extract(0, PSK_or_zero)
derived       = HKDF-Expand-Label(early_secret, "derived", "", Hash.length)

# 公钥约定后
handshake_secret = HKDF-Extract(derived, ECDH(cli_priv, srv_pub))

# 再扩
finished_key  = HKDF-Expand-Label(handshake_secret, "finished", "", Hash.length)
client_traffic_secre = HKDF-Expand-Label(handshake_secret, "c hs traffic", hello_hash, ...)
server_traffic_secret = ...

# 终态
master_secret = HKDF-Extract(derived, handshake_secret)
```

`HKDF-Expand-Label` 是 TLS 1.3 自有结构 (label + context + length) → 防 Cross-Protocol Confusion攻击。

### 2.4 套件只剩 5 个

```
TLS_AES_256_GCM_SHA384
TLS_AES_128_GCM_SHA256
TLS_CHACHA20_POLY1305_SHA256
TLS_AES_128_CCM_SHA256
TLS_AES_128_CCM_8_SHA256
```

key exchange 走 NIST P-256/P-384/X25519；签名走 RSA-PSS/ECDSA/Ed25519。

### 2.5 TLS 1.3 砍掉的设计

| 1.2 有 | 1.3 删掉原因 |
|--------|--------------|
| CBC mode | BEAST/POODLE/Lucky13 |
| static RSA key exchange | 无前向安全 |
| MD5/SHA1 | 弱 hash |
| Compression | CRIME/BREACH |
| Renegotiation | CVE-2009-3555 三向攻击 |
| DHE_RSA cipher suites | 已被 ECDHE 取代 |
| Camellia/3DES/IDEA | 性能 + 兼容 |
| 数字签名+cipher 解耦 | 套件爆炸管理困难 |

---

## 三、0-RTT / PSK / Session Ticket

### 3.1 resumption PSK

```
第 1 次握手 (1 RTT)
client → server: ClientHello, key_share, psk=None
...full handshake...
client ← server: NewSessionTicket { ticket_age_add, ticket_nonce, ticket, lifetime }

第 2 次 (0 RTT)
client → server: ClientHello with
         psk=<ticket_bytes>, key_share=<new pubkey>, early_data="GET / HTTP/1.1\r\nHost: ..."
                      ← encrypted with PSK-derived early traffic secret
server 解密 early_data → 直接处理 HTTP request
server 验 PSK → 1-RTT 完成 full handshake → 后续主 stream
```

### 3.2 0-RTT 安全分析

**重放攻击**：
```
attack 软件 client hello + early data (1 packet, 总 ~1KB)
→ 可在下次 resumption 前发到 server
→ server 接受并执行 early_data 中的请求
```

防御对策：
1. 严格限制 early_data 仅**幂等**方法（GET/HEAD/OPTIONS），POST/PUT 等强制等 1-RTT 完成后才 dispatch
2. server 维护 ticket nonce 单调计数器 + 时间窗口，防同一 PSK 重放多次（这是 RFC 8446 §8 推荐，但实际部署少）
3. 业务标 `Early-Data: 1` 路由不执行非幂等
4. server 端用 anti-replay 数据库 (Cloudflare、Akamai 维护)

### 3.3 session ticket 保管

ticket 是 server 用本地 secret 加密的 server-side state：
- 优点：server 端不必存所有 session state（信用卡大小条）
- 漏洞面：secret 泄漏 → 所有 ticket 可被解密 → 历史流量也可解 (if replayed to server)
- 解决：定期轮换 ticket encryption key (Let's Encrypt daily)

```openssl
# enable session ticket with rotation
SSL_CTX_set_session_ticket_keys(...)
httpd 2.4 配置:
SSLSessionTickets on
SSLSessionTicketKeyFile /var/cache/tls/keyfile
# rotation cron:
0 3 * * * for i in $(seq 1 3); do openssl rand 48 >> /var/cache/tls/keyfile.current; done
```

### 3.4 PSK-only mode (no ECDHE)

只 PSK 无 ECDHE → 没有 PFS（forward secrecy）。TLS 1.3 默认推荐 `psk_ke_mode = psk_dhe_ke` — 仍做 ECDHE 在 PSK 后，保留 PFS。

> [!WARNING]
> 把 `psk_ke_mode` 关成 PSK-only 是失败的，会丢掉 PFS。生产应保持默认 `psk_dhe_ke`。

---

## 四、SNI + ECH (Encrypted Client Hello)

### 4.1 SNI 暴露域名

```http
ClientHello
  Extension: server_name
    server_name_list
      name_type=host_name
      hostname=www.eff.org     ← 中间盒 / ISP 可看
```

政府防火墙、企业流量分析、ISP 量化用户画像都靠明文 SNI。

### 4.2 ECH (RFC 9460, 2023)

加密 ClientHello inner：
```
client → resolver: HTTPS RR 查询 example.com
                     ↑ 用 DoH/DoT 防 DNS poisoning
                     ↓ RR 携带 public key ECHConfig
       client 发 DNS IPv4 + ECHConfig False.

client → server: ClientHello
                     outer: SNI = cloudflare-ech.com (placeholder)
                     inner: SNI = user.real.site (encrypted)
server 解 inner SNI → 选择对应 vhost cert 上手响应
```

部署：Cloudflare 全网已支持，主流用户探测 40% 启 ECH。Chrome 110+ 默认支持 ECH bootstrap。

### 4.3 ESNI 历史废弃

ESNI (draft-ietf-tls-esni-01) 是 ECH 早期版本，已被 RFC 9460 取代。任何 KB 里搜到 `ESNI` 配置都已过时。

---

## 五、TLS termination 实战

### 5.1 部署模式

```
模式 A：Ingress LB → 后端 cleartext
   client ──TLS──> L7 LB ──http──> backend
   优点: 后端简单
   缺点: 内网明文，溯源信任弱，需要 LB 做完所有 mTLS

模式 B：End-to-End TLS
   client ──TLS──> LB ──TLS──> backend
   优点: 端到端真实证书-verif
   缺点: LB 不 inspect content, 不能为 routing 决策

模式 C:mTLS service mesh
   client ──mTLS──> sidecar (Envoy) ──mTLS──> sidecar (Envoy) ──> app
   优点: zero trust + cert rotation + 位透明
   缺点: sidecar 性能收益低, 需要 SPIFFE/SPIRE
```

### 5.2 cert-manager + Let's Encrypt

```yaml
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: example-com
spec:
  secretName: example-com-tls
  dnsNames:
    - example.com
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
```

rotation：90 天 LE cert，cert-manager 提前 30 天重新申请；kube webhook 推 local ingress secrets。

### 5.3 调优 nginx

```nginx
ssl_protocols TLSv1.3;                         # 不建议 1.2 (除非兼容)
ssl_prefer_server_ciphers off;                 # 1.3 后失去意义
ssl_session_cache shared:SSL:50m;               # 50MB ≈ 400k sessions ticket
ssl_session_timeout 1d;
ssl_session_tickets off;                        # 关 ticket 改用 cache (开发常用)
ssl_early_data on;                              # 启 0-RTT
add_header Early-Data $http_early_data;
add_header Alt-Svc 'h3=":443"';
```

spring-level 调参：
- 大量并发 + short connect → cache 用 `shared` (worker pool 共享) > `builtin` (per-worker 只能见本 worker)
- 长 idle pool 内存压力大 → `proxy_ssl_session_reuse off` 短片 brokerü

### 5.4 OpenSSL / BoringSSL / LibreSSL 对比

| 库 | 维护方 | 性能 | 支持 |
|----|--------|------|------|
| OpenSSL | OMC | 1-1× | 所有版本最全 |
| BoringSSL | Google | 1.2× | Chrome、Android、QUIC |
| LibreSSL | OpenBSD | 1.0× | 部分版本无（缺 HRR/PSK） |
| AWS-LC | AWS | 1.2× | AWS 内部主流 |

BoringSSL 不公开支持都包含 TLS 1.3 + 0-RTT + ECH (long-term display)，Project Wycheproof 已坚守 formal verification。

---

## 六、产线事故

### 事故 1：Session Ticket 密钥轮换漏

运维轮换 nginx `ssl_session_ticket_key` 但**没同步到 backup LB** → backup 一段时间 ticket 解密失败 → resumption 全部 fallback 到全握手 1-RTT。Ops 监控 TLS handshake RTT 突涨 100ms。

**修复**：cert-manager 风格 rotated key file 共享给所有 LB / 容器。

### 事故 2：0-RTT POST 交易被重放

某 wallet 服务启 0-RTT，攻击者抓 client 飞行时帧从 VPN 重放 → 重复一笔转账。损失 7 位数。

**修复**：应用层 hot path 业务路由 inspect `Early-Data: 1` 详究路由非幂等  →  return `425 Too Early` RFC 8470。Nginx 必修配置 `proxy_set_header Early-Data $ssl_early_data;` + `proxy_pass` 后端识别拒绝非幂等。

### 事故 3：CertificateVerify 签名算 算服务器选弱 curve P-224

某旧 PKI 工具组生成 ECDSA 证书用 P-224。后 ECC P-224 安全 key ~112 bit，近日渐进弱点已知。

**修复**：注册前 enforce `key_share` 仅 X25519 / P-256 / P-384，签 CA盖章替换。

### 事故 4：ECH 部分启用，残留 SNI 拦截

业务启了 ECH 但只覆盖 30%，部分客户还是 SNI 明文 →部分路径中间盒掉 + RSA 证书 reverse event。

**修复**：合 client ✗ service roster 全 ECH on + ECHConfigList DNS RR 监控覆盖度。

### 事故事 5：BoringSSL + client Hello 大于 1 个 MSS

某 grpc client 把所有 custom metadata 放到 ClientHello 让其超过 1460B → 触发 TLS handshake 分片，path MTU 不达 MSS → SYN+ACK → fragmented DDoS detection → reset。

**修复**：减 extra metadata 大小 + 集中 metadata 移到 HTTP/2 stream。

---

## 七、易错清单

1. **TLS 1.3 套件数 < 5** — 不存在 SHA1/CBC/RSA-static，所有"TLS 1.3 RC4"配置都是错的
2. **session ticket key 必须定期 rotation**，否则 ticket 泄漏 = 历史流量可解
3. **0-RTT 不能用于非幂等请求** — 业务必须区分 early_data
4. **TLS handshake 必须 inspect `key_share` 中的 curve**，禁止 P-521 (跨设备)
5. **ECH 部分启用比不启用还危险** — 中间盒按 SNI 还是能锁定
   6. **`ssl_session_tickets off` 不一定优** — ticket 比 cache 适合多 worker 模式

---

## 八、这一章带走的东西

1. TLS 1.3 把握手 Schneide 变成 1 RTT + ECDHE in ClientHello，套件降为 5 AEAD + 全前向安全
2. 0-RTT 用 session ticket 编密 PSK，**只能幂等**请求；server 必须靠 `Early-Data` 标识走 anti-replay
3. SNI 明文是主流监控 GREAT-FW *ISP 监控手段，ECH 用 DNS HTTPS RR 公钥 inner SNI 解掉
4. Session ticket 的密钥轮换与 secret 保护是大规模部署隐蔽坑
5. mTLS service mesh + SPIFFE 是 zero trust 内部 + cert 轮换的工业标准
6. 监控 `nstat TcpExtTCPRcv` + `OpenSSL stat` 可以看到 TLS handshake RTT 分布

## 下一节 →

[证书链与 PKI](./pki.md) — X.509 字段、CA 链验证、OCSP 与 stapling、CRLite、ACME、HPKP。
