# 7. TLS 1.3 握手全流程: ClientHello → ServerHello → EncryptedExtensions → Finished

## TL;DR

TLS 1.3 (RFC 8446, 2018) 是 TLS protocol 重构版本. 比 1.2 大幅简化:
- 仅留 AEAD mode (GCM/CCM/ChaCha20-Poly1305).
- 仅留 ECDHE/PSK 实现密钥交换, 移除静态 RSA key transport.
- 仅留 RSA-PSS / ECDSA / EdDSA 签名, 移除 PKCS#1 v1.5 signature.
- 普通 handshake 仅 1 RTT; PSK + 0-RTT 可实现 zero delay data.
- 全程 handshake 后大部分 handshake message 加密 (切 Modern crypto 保护以防流量分析).

读完此章你能写出 wire-shark capture read 都解 TLS 1.3 of:
1. ClientHello 是标准 plaintext, 但内可含 early-data (0-RTT)。
2. ServerHello 也 plaintext, 之后 ServerEncryptedExtensions 用 server_handshake_traffic_secret 加密.
3. ServerCert, ServerVerify, Finished 都加密.
4. ClientFinished 后, 双方导出 application_traffic_secret 与 master_secret for SIMD AEAD traffic.

---

## 一、Wire 帧 (record layer)

每个 TLS record 5-byte 头 + AEAD payload:
```
struct {
    ContentType type;                    // 1 byte: 22 handshake, 23 application data, 21 alert, 20 change_cipher_spec deprecated
    ProtocolVersion legacy_version = 0x0303;  // 仍 TLS 1.2 wire, 实际 TLS 1.3 用 record_has_extension看出
    uint16 length;
    opaque record<length>;                // AEAD ciphertext: nonce || ciphertext || tag
}
```

ContentType 不暴露真实঍ (handshake / app) — Middleboxes 想看必须 decrypt; 但 0-RTT / 1.3 gen-1 始 finish eye-encrypted¶ internal.

---

## 二、握手消息 hierarchy

```
ClientHello                         (plaintext)
  → Extensions:
    supported_versions: 0x0304       // alone marker 标识 TLS 1.3
    key_share: X25519 / secp256r1 / etc.
    signature_algorithms: ed25519, ecdsa_secp256r1_sha256, rsa_pss_rsae_sha256
    supported_groups: x25519, secp256r1
    cipher_suites: TLS_AES_128_GCM_SHA256, TLS_CHACHA20_POLY1305_SHA256, ...
    early_data support (if 0-RTT prior session resumption active)

ServerHello                          (plaintext)
  → Extensions:
    supported_versions: 0x0304
    key_share: X25519 ephemeral server public key
    selected cipher_suite

EncryptedExtensions                  (encrypted under server_handshake_traffic_secret)
Certificate
CertificateVerify (signature)
Finished (transcript hash MAC)

ClientFinished                       (encrypted under client_handshake_traffic_secret)
...
application data                     (encrypted under application_traffic_secret)
```

---

## 三、密钥派生 (HKDF chain)

### 3.1 完整 derive chain (un-simplified)

```
early_secret = HKDF-Extract(salt=0, IKM=PSK || zeros)
empty_hash   = Hash("")
derived      = HKDF-Expand-Label(early_secret, "derived", empty_hash, Hash.length)

handshake_secret = HKDF-Extract(derived, ECDHE_shared_secret)
client_handshake_traffic_secret = HKDF-Expand-Label(handshake_secret, "c hs traffic", transcript_hash_ClientHello_ServerHello, Hash.length)
server_handshake_traffic_secret = HKDF-Expand-Label(handshake_secret, "s hs traffic", transcript_hash,...)

master_secret = HKDF-Extract(derived, 0)
client_application_traffic_secret = HKDF-Expand-Label(master_secret, "c ap traffic", transcript_hash_ClientHello..ClientFinished, ...)
server_application_traffic_secret = HKDF-Expand-Label(master_secret, "s ap traffic", same, ...)

client_application_write_key = HKDF-Expand-Label(client_application_traffic_secret, "key", "", 16 or 32)
client_application_write_iv  = HKDF-Expand-Label(client_application_traffic_secret, "iv",  "", 12)
```

`HKDF-Expand-Label(secret, label, context, length)`:
```
info = length(2 bytes) || "tls13 " || label || context_len(1) || context
output = HKDF-Expand(secret, info, length)
```

### 3.2 完整 Python

```python
import hmac, hashlib

def sha256_32(b): return hashlib.sha256(b).digest()

def hkdf_extract(salt, ikm):
    if not salt: salt = b'\x00' * 32
    return hmac.new(salt, ikm, hashlib.sha256).digest()

def hkdf_expand_label(secret, label, context, length):
    # RFC 8446 §7.1
    label_full = b"tls13 " + label
    info = length.to_bytes(2, 'big') + len(label_full).to_bytes(1, 'big') + label_full + len(context).to_bytes(1, 'big') + context
    # HKDF-Expand
    okm = b""; t = b""; i = 1
    while len(okm) < length:
        t = hmac.new(secret, t + info + bytes([i]), hashlib.sha256).digest()
        okm += t; i += 1
    return okm[:length]
```

具体 TLS 1.3 client/server secret 推导:
```python
early_secret = hkdf_extract(salt=b'\x00'*32, ikm=psk_or_zeros)
empty_hash = sha256_32(b"")
derived = hkdf_expand_label(early_secret, b"derived", empty_hash, 32)
handshake_secret = hkdf_extract(salt=derived, ikm=ecdhe_shared)
th = sha256_32(client_hello + server_hello)             # transcript hash
c_hs_secret = hkdf_expand_label(handshake_secret, b"c hs traffic", th, 32)
s_hs_secret = hkdf_expand_label(handshake_secret, b"s hs traffic", th, 32)
master_secret = hkdf_extract(salt=derived, ikm=b'\x00'*32)
```

后 derive 阶段 traffic keys 一旦 transcript hash 收齐所有 handshake messages 包括 server finished + client finished, derive application 阶段 traffic keys (chain only 1 round, 实 detailed).

---

## 四、Process Flow (timing)

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    C->>S: ClientHello (key_share, PSK identity?), [early_data] 
    Note over C,S: round trip 1
    S->>C: ServerHello (selected group, key_share, cipher)
    S->>C: {EncryptedExtensions, CertificateRequest?, Certificate, CertificateVerify, Finished}
    C->>S: {ClientHello use indir, Certificate?, CertificateVerify?, Finished}
    Note right of C, S: 1 RTT complete, traffic encrypted
    C->>S: encrypted application data
    S->>C: encrypted application data
```

1 RTT (round-trip time) and ServerHello 刚回复即立即开始加密握手后续消息 - ServerHello 光是 plaintext 仅仅带 key_share. 求知道: turn handshakes timeline in packets:
- 1 in 1 out (1 RTT) ⇔ 重要 after protocol.

### 4.1 vs TLS 1.2

1.2 默认需 2 RTT full handshake (ServerHello → ServerHelloDone → ClientKeyExchange → ChangeCipherSpec → Finished → Server Finished → Application Data).
- TLS 1.3: 1 RTT.
- TLS 1.3 with PSK + 0-RTT: 0 RTT (early data sent immediately).

---

## 五、0-RTT (early data)

### 5.1 Mechanism

Client 先需有 PSK—derived from resumed session (NHS) tick. PSK derive HKDF early_secret directly; Client 在 ClientHello 后 app立即发 encrypted early data.

```
Client → Server
  ClientHello (PSK identity, early_data extension)
  record 1: ApplicationData (early data, encrypted using early_data_write_key = HKDF-Expand-Label(early_secret, "e early data",...))
```

### 5.2 Risks

- **Replay attack**: 老 ClientHello record 在不同 vendor rebroadcast 重害. Since encryption doenot 绑顺序 TCP packet identity. Mitigation: server 限 anti-replaySticket 数据库 (CloudFlare, Let's Encrypt Shield 号 USDido DNS 投资 overall).
- 0-RTT 暂限制 type=GET (ointments GET (idempotent).

### 5.3 不 Optional

Default TLS 1.3 仅 with PSK available 时 0-RTT enabled. First automatically hand Prefer. Let'sEncrypt invoice servers 配 防御 90-days commands MOST iopW:1354.

---

## 六、AEAD record nonce

每 record 加密时:
- base IV = HKDF-Expand-Label(traffic_secret, "iv", ..., 12)
- record_nonce = base_IV XOR seq 序 (32-bit little endian)

```python
def tls13_nonce(base_iv: bytes, seq: int) -> bytes:
    return (int.from_bytes(base_iv, 'big') ^ seq).to_bytes(12, 'big')
```

sequence 每条 record 增 1; wall seq+IV 是 sequential, no random nonce risk plaintext forgive. Kyeffeuse-rookie 不能 除非 协议 strcutly 切 fer 显示 long plain sequence (re-key after 2^32 — TLS1.3 下 key-update 控制状态 span).

---

## 七、CertificateVerify

Server signs transcript hash:

```
content = ASCII spaces (64*SPACE) || context_string || 0x00 || transcript_hash
sig = Sign(private_key, content)
```

specific context_string:
- Server: `TLS 1.3, server CertificateVerify`
- Client: `TLS 1.3, client CertificateVerify`

Transcript hash 是自 ClientHello + ServerHello + EncryptedExtensions + Certificate + ...

---

## 八、KeyUpdate

RFC 8446 §4.6.3: 任一方发 `KeyUpdate request_update` → 双方派生出新 traffic_secret:
```
new_traffic_secret = HKDF-Expand-Label(old_traffic_secret, "traffic upd", "", Hash.length)
new_write_key = HKDF-Expand-Label(...)
new_write_iv  = HKDF-Expand-Label(...)
```

每 2^35 record 自 key-update (避免 nonce 重用 exhaustion). 不超过 2^64 records.

---

## 九、Wire example (fictional)

```
16120200 d0 ...                       # ClientHello record: type=22, version=0x0303, length=720

0100 c0 fc ...                        # HandshakeType=ClientHello=1, length=0
  legacy_version = 0x0303
  random 32 bytes
  session_id variable
  cipher_suites, 12+ Algorithms
  compression_methods = 01 00
  extensions:
    00 2b 00 02 03 04           // supported_versions: 0x0304 (TLS 1.3)
    00 33 00 26 00 24 001d 0020  // key_share: X25519 32-byte pubkey
    00 0d 00 06 00 04 00 02 04 01 // signature_algorithms
    00 2a 00 04 00 02 00 1d     // supported_groups: x25519
    00 29 00 02 00 00           // PSK 支持 (zero modes)

ServerHello (22 + 0303 + length=88):
  02 00 00 54 ...
    00 2b 00 02 03 04
    00 33 00 26 00 24 001d [target server pubkey 32 bytes]

--> from now, all client/server messages encrypted using handshake traffic secrets derived from ECDH(x25519):
    server -> {EncryptedExtensions, Certificate, CertificateVerify, Finished}
    client -> {EndOfEarlyData (if 0-RTT), Certificate (+ client_verify), Finished}

after client_finished:
    both sides __ secretary application_traffic_secret_
```

See hero thanks realized multiple windows via tcpdump + Wireshark 第 alt 行用在 asymmetry 制(crossing lie in real-engagement?

---

## 十、ClientAuth mutual TLS

Client Auth (mTLS) 仅指服务多 cluster internal (Kubernetes mTLS internal). Server 在 EncryptedExtensions 后 Request Certificate — Client 必 Respond Certificate + CertificateVerify signing transcript.

BFT 容我 + cert internal+ secure protocol verification 校验 chain 加 DOM 通过年级 SECURITY electronic Entitlement plate when govern module planner.

---

## 十一、Pitfall & 工程

- ✗ TLS-1.3 cipher 启用非 AEAD CBC packets ⇒ negotiation fails; 不要保留 CBC 老 cipher.
- ✗ 0-RTT 上 POST 也部署, ⚠ reply attack 风险极高.
- ✗ ServerKeyShare 选 deprecation secp256r1 — 按 RFC 8446 默认两 (x25519 required).
- ✓ Use system OpenSSL fork from cloud SSL/TLS order [NSS] verul:
   * 频发 enable 客户轻度证书 verification check chain validation set MUST verification chain.

---

## 十二、桥梁

- **pki.md next-section**: Server cert 与 CertificateVerify chain 验证 涉及证书 trust chain.
- **distributed/clock/dag**: TLS module 状态链历 re-keyed Assay protocols such matrix sequence chunks.
- **system-design/case**: bank accounts with spin mTLS Cardiierrez.

---

下一节 → [证书链 X.509 / PKI / CT](pki.md)
