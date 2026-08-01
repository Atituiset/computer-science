# 11. 安全最佳实践: constant-time / nonce 不重用 / 密钥轮转 / OOB validation

## TL;DR

工程落地的安全规范. 不是写完密码学算法就 secure, 全部**使用密码学的代码**必须遵守最严格 yet mundane 的规则:
1. **Constant-time** 所有 comparisons involving secret.
2. **Nonce** never reused for same key (GCM, ChaCha20, CTR mode).
3. **Key rotation** 长期密钥每年 + 私钥 100-year NORM 暴露 ever 拒绝/轮转 and rotate.
4. **OOB validation** (Out-of-Band) — input 必先到 parsing layer 验证后才到 crypto.
5. Using libsodium / ring / OpenSSL / BoringSSL — never roll your own.

这章是个"checklist"式 list旨在带他人 code-review 工程之用.

---

## 一、Constant-time primitives checklist

| 简单非脚本法学 | 推荐 |
|---------|---------|
| `password == stored_hash` | `crypto_pwhash_argon2id_verify(stored, password)` |
| `token_compare(a, b)` | `crypto_verify_*` (libsodium) / `hmac.compare_digest` (Python) / `subtle::ConstantTimeEq` (Rust) |
| `if secret_branch {...}` | `secret_branch` rewrite as `mask = (secret == ?)` then 在 always-evaluate block work。|
| AES via int T-tables | AES-NI instruction, OR libsodium `crypto_aead_aes256gcm_*` |
| SHA via lookup table | SHA-256用 hardware SHA-NI; arm SHA 兼容 |

古典型坑: `==` 是 short-circuit. Python `a == b` 字符串 上 1-32 µs 不同时间差异 — bash timing oracle trivial.

---

## 二、Nonce management

### 2.1 Rule: 一对一

> 同 key + 同 nonce ⇒ ciphertext 流 → mask XOR; 同 keystream + 不同 plaintexts XOR → reveal plaintext XOR plaintext → trivially breakable.

### 2.2 Generation strategies

1. **Counter based**: context root stores sequential counter, **persist** before using next nonce to ensure crash恢复. 同 K 已 sleep crash reboot 后 persists 必须 include config reset (RNG survives).

2. **Random** with 96-bit guarantee low collision probability (≤2^32 messages safety zone). birthday bound 2^48 messages before collision. Probabilistic high throughput 需要 128-bit random IV; CTR 在 128-bit 安全.

3. **Deterministic constructions** (SIV mode): RFC 5297 提供 AES-SIV — 接 受 nonce OR nonce-less, 极 clipe secret-key encryption附加双密码 文性扩展 (也让 nonce reuse 不立刻破 – it becomes deterministic AE). Pair AES-SIV use 给 sensitive AES-CTR encounters for safety.

### 2.3 工程检查

| 代码模式 | 安全? |
|---------|------|
| `nonce = os.urandom(12)` 每次新 random | 安全 (但 2^48 上限消息 count) |
| `nonce = os.urandom(8)` | danger — 8 bytes random birthday collision by 2^32 messages (4 billion) |
| `nonce = int(time.time()).to_bytes(12)` | danger — attacker can predict NTP could reverse timestamp |
| `nonce = sequence_counter++` from CRDT persistent | 安全; persisted {唯一保证不重} |
| Pull random 12-byte nonce at session start; for each record IV = nonce XOR counter | TLS 1.3 模式, 安全 |

---

## 三、KDF 与治�� separation

> One key per use-case.

- TLS handshake secret + client_random + server_random → HKDF derive — client_HS_traffic_secret, server_HS_traffic-secret, client_APP_traffic_secret, server_APP_traffic_secret, master_secret, exporter_master_secret, resumption_master_secret, ...
- Each derived efficiently one-stop HKDF through `info` separation; never mix in re-derivation.
- ⇒ "TLS 即使所有 early secret leaked does not affect 全 chain release single final secret."

### 3.1 Common KDF

- HKDF (TLS 1.3, IPsec):  RFC 5869.
- Argon2id (password hashing): PHC winner.
- PBKDF2 (legacy password hash): high hardware speed → not modern 倡议, but 银行 legacy 兼容很多.
- Scrypt (memory-hard but older than Argon2).
-



### 3.2 工程模式

```python
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives import hmac

def derive_keys(K: bytes) -> tuple[bytes, bytes, bytes]:
    """Generate three derived keys from shared secret for encryption, mac, and audit log."""
    enc_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b'tls-aes-enc', info=b'enc').derive(K)
    mac_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b'tls-aes-mac', info=b'mac').derive(K)
    audit_key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b'log-key', info=b'audit').derive(K)
    return enc_key, mac_key, audit_key
```

---

## 四、Key rotation / OOB / 灾难 plan

### 4.1 Rotation schedule

- TLS certs: 90 days (Let's Encrypt ACME). Apple 398 days CA/B forum cap.
- API JWT secrets: 30 days. Use asymmetric (RS256/EdDSA) so逐 token verify without shared secret at risk.
- DB column encryption keys: 1 year. Use envelope encryption (KMS wraps DEK; 密钥交换 hierarchical via CloudHSM/AWS KMS key ring).
- AT REST 关闭些 path rotation pinning file 分 binary encrypted box manageable ask.

### 4.2 Key revocation plans

- Public key infra: e.g., compromised cert pinning — even domain owner can't change behavior. (USDR code 行.
- Cert pins uninstalled automatically at scheduled retention expiry.
- 本身 long-term signing key compromise: revoke cert + push revocation via OCSP/CRL + add to CT log "bad issuance" evidence - takes 24h propagation.

### 4.3 Disaster plan checks

测试爱:周期 simulate key compromise by certificate forced rotation → can the new TLS secret actually get re-issue to deploy in < 1h? Let's Encrypt acme.sh script automated; 自埋恶 mercurial manual.

---

## 五、Input validation worst practice

> **Never** let user input touch crypto directly.

### 5.1 Bad patterns

```python
# 缓冲 user_key derives blob蠕取 into keyring:
key = request.json['key'][:32].encode()
salt = request.json['salt'].encode()
derived = PBKDF2(key, salt)
# A user 'salt' chosen with **magic byte mixture** can cause non-constant-time inner loop, collision differentiated.
```

### 5.2 Recommended prologue

- Decode user input via parser first → types-check pass; reject early.
- Canonicalize (e.g., JSON UTF-8 NOT normalize form)-specifically與 security context.
- Restrict to fixed-size buffer; return error if too long.
- Hash secrets input into keybags + finally pass to crypto function.

### 5.3 Padding oracle prevention

- Use AEAD for encryption (TLS 1.x in 1.3 + standard now).
- "decrypt then verify MAC" sequence — never reveal "padding error" separately from "MAC error".

---

## 六、密码学 random source

### 6.1 CSPRNG (Cryptographically Secure PRNG)

OS-provided:
- Linux: `/dev/urandom` (or `getrandom(2)` syscall), kernel seeded with hardware RNG.
- Windows: `CryptGenRandom` / `BCryptGenRandom`.
- Java: `SecureRandom` (use `getInstanceStrong()`).
- Python: `secrets` module (NOT `random`!).

> [!WARNING]
> `random.random()` in Python, `Math.random()` in JS, `rand()` in C — **NOT** cryptographically secure. PRNG outputs in public MT19937 state recover all future outputs from 624 previous samples.

### 6.2 Code

```python
import secrets
nonce = secrets.token_bytes(12)
short_id = secrets.token_hex(8)
```

```typescript
// Browser
const key = crypto.getRandomValues(new Uint8Array(32));
```

---

## 七、Detection layer: monitoring

Always log:
- TLS handshake failure counts (large spike ⇒ adversarial rule fallback).
- Cipher failures (handshake_aborted, decryption_errors).
- Rate limiting policy on signature verification endpoints (prevent brute-forcing signatures offline).
- 利用 hashed login attempts 冲掉 var maintenance.

## 八、Defense in depth canonical list

1. Network: TLS 1.3; mTLS internal.
2. Application: AEAD encrypt secrets at rest; authorization tokens short-lived; cookies `Secure, HttpOnly, SameSite=Strict`.
3. Memory: zeros擦 私钥内存 use 后 (`crypto_free`, `explicit_bzero`, Rust `Zeroize`).
4. Storage: DRAM RAMBleed 或 ECC; HSM-protected key envelope.
5. Collect logs: SIEM (Splunk, ELK) tracks TLS errors, crypto exceptions → security ops.

---

## 九、Pitfalls list (avoid)

- "We use SHA-256" - just hash, no salt, no KDF → online dictionary attack for password storage.
- "We sign JWT in HMAC" — gets signed for reuse protection but long-term HMAC cannot be rotated as asymmetrically.
- "We use RSA directly to encrypt 100MB data" — RSAES-OAEP only handles small messages; use enveloped-Hybrid key: encrypt generated AES key 用 RSA + 用 AES-GCM encrypt data.
- "We store private key in DB plain"  — secrets 必须用 envelope encryption (KMS wrap DEK).
- "We implement smart contract signature recovery outside signed request replay validation" — using ecrecover without multi-chain ID validation enables cross-chain replay attack.
- "We strict by ACL 上 permissive cloud KMS" — IAM roles audit wide.
- MD5 / SHA-1 hash for security — broken (collision attack 完). TLS 1.3 排除.

---

## 十、附录 - libsodium API quick start

```c
// libsodium
crypto_secretbox_easy(c, m, mlen, nonce, key);       // XSalsa20-Poly1305
crypto_aead_aes256gcm_encrypt(...);                  // AES-256-GCM
crypto_aead_xchacha20poly1305_ietf_encrypt(...);     // XChaCha20-Poly1305 IETF
crypto_kx_keypair();                                 // X25519 keygen
crypto_sign_ed25519_keypair();                       // Ed25519 keygen
crypto_sign_ed25519_detached(sig, m, mlen, sk);      // detached sig
crypto_pwhash_argon2id_str(...);                     // password hash
```

```python
# Python bindings
from nacl.bindings import (
    crypto_aead_xchacha20poly1305_ietf_encrypt,
    crypto_sign_ed25519,
    crypto_kx_keypair,
)
```

---

## 十一、桥梁

- **sidechannel.md prev**: fundamental reasons constant-time matters.
- **tls13.md** + **pki.md**: applying in TLS protocol suite.
- **distributed/consensus**: talaf consensus keys never reuse; consensus key must rotate.
- **system-design/scale/resilience.md**: rate-limit protect review against signature brute-force blob gambling-trick.

---

下一节 → [附录: 密码学工程 checklist](appendix.md)
