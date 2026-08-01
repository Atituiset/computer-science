# 5. 数字签名: RSA-PSS / ECDSA / Ed25519

## TL;DR

签名 (signature) = 加密的逆向: 公钥验证, 私钥签名. 三个主流:

| 算法 | 私钥 size | 签 size | 速度 | 安全模型 | Nonce |
|------|----------|----------|------|---------|-------|
| RSA-PSS | 2048-3072 bit | 256 / 384 B | 慢 (慢 N²) | RSA factoring | — |
| ECDSA | 256 bit | 64 B | 中等 | ECDLP | **secret, anti-reuse** |
| Ed25519 | 256 bit | 64 B | 极快 | TW Edwards curve ECDLP | deterministic |

工程最佳实践: **Ed25519 默认**, 当 constrained 用 ECDSA P-256 (TLS), 弹起的合理但当 off-sites RSA-3072 PSS 时 legacy. **绝对不要** ECDSA 重 nonce 重用 (Sony PS3: 私钥 α mins 倒 out).

---

## 一、RSA-PSS (RFC 8017)

### 1.1 签名

给 message $m$ and key $k_{priv}$:
1. msg_hash = Hash($m$)  (SHA-256 recommended)
2. salt = random 32 bytes (same length as hash output)
3. m' = pad || msg_hash || salt
4. H = Hash(m'), DB = pad || H || 0x01; 用 MGF1(H) mask DB
5. em = maskedDB || H
6. σ = em^d mod n   (RSA private op)

Verify:
1. m' = σ^e mod n
2. split em → maskedDB, H, recover DB via MGF1
3. recover salt from m' = pad || msg_hash || salt
4. verify Hash(m') == H, salt byte Length.

### 1.2 Strength

- "Probabilistic" - 同 message 的两个 σ 不同 (salt random).
- Proof in random oracle model: EUF-CMA secure under RSA assumption.

### 1.3 劣势

- 2048-bit minimum, sigs 256B (vs Ed25519 64B);
- signing cost O(n²) with private exponent, ±1 ms LOG slow for HTTP;
- TLS 1.3 RSA-PSS size force штраф钉戴;

Industry 2024 趋向: pure ECDSA/EdDSA more historically RSA-PSS required. 95% cert chain validations 是 RSA-PSS+.

---

## 二、ECDSA (X9.62 / FIPS 186-5)

### 2.1 Set-up

Curve $(G, n, p)$: $G$ base point, $n$ 是 $G$'s order, $p$ prime.

### 2.2 签名

1.eph $k \in [1, n-1]$, nonce.
2. $(x_1, y_1) = kG; r = x_1 \bmod n$. (r 不能 0, 若则挑新 k.)
3. s = k^{-1}(hash(m) + z · r) mod $n$ where $z$ is private key.
4. signature = (r, s).

### 2.3 Verify

Given pubkey Q, msg m, sig (r, s):
1. w = s^{-1} mod n; u1 = hash(m) · w mod n; u2 = r · w mod n.
2. $(x', y') = u_1 G + u_2 Q$.  Accept if $r = x' \bmod n$.

正确: $u_1 G + u_2 Q = u_1 G + u_2 z G = (u_1 + u_2 z)G = (hash · w + r · z · w) G = w(hash + r z) G = w · k · s · G = k G$ 业 key.

### 2.4 **致命** nonce 安全性

恢复 nonce 或 nonce 重用 → 私钥 leak:

给开 message $m_1$ 和 $m_2$, 用同 k 签:
$(r, s_1, s_2)$ known + r hash: $z = (s_1 - s_2)^{-1}(h_1 - s_2 k)$ (anew derive,...).

写:
$$k = (s_1 - s_2)^{-1}(h_1 - h_2) \bmod n, \quad z = (s_1 k - h_1) \cdot r^{-1} \bmod n$$

→ Sony PS3 2010 hack: 同一 k 全 Console signer's header → hacker poche $r, s_1, s_2$, → private key z within minutes → homebrew freedom.

> [!WARNING]
> ECDSA nonce **不能** 用 unsafely-derived random. RFC 6979 gives deterministic nonce via HMAC(key, msg): $k = \text{HMAC}_{key}(\text{HMAC}_{key}(m))\bmod n$. This avoids random source hazard. **Never** implement ECDSA without RFC 6979.

### 2.5 public API 工程模式

```python
from cryptography.hazmat.primitives.asymmetric.ec import ECDSA, EllipticCurvePrivateKey
from cryptography.hazmat.primitives import hashes

# standard ECDSA (with RFC 6979 deterministic k):
private_key: EllipticCurvePrivateKey = ...
signature = private_key.sign(data=data, signature_algorithm=ECDSA(hashes.SHA256()))
```

---

## 三、Ed25519: 真正现代签名

### 3.1 设计

Ed25519 (RFC 8032): Twisted Edwards curve $-x^2 + y^2 = 1 + d x^2 y^2$ over $\mathbb{F}_p$ for $p = 2^{255} - 19$. 比 Weierstrass form 多个 aldow:

1. **Complete addition formula**: 对所有 points 给出 same op, corner case free.
2. **Deterministic nonce from key prefix**: $r = \text{Hash}(\text{prefix} \| m)$, prefix = hash(private_key)[:32]. **No** random nonce — automatic secure.
3. **Batch verify**: verify $n$ signatures simultaneously O(log n) faster.
4. **Faster**: ed25519 sig ~ 50 µs Python, 30 ns optimized AVX (libsodium).

### 3.2 算法 outline

```
private (z)                  ->  public Q = z * B (B is base point)
pr = Hash(z)                ------------------  (64 byte hash)
prefix = pr[32:64]
r = Hash(prefix || m) mod n  ---- deterministic nonce
R = r * B
s = (r + Hash(R || Q || m) · z) mod n
signature = (R || s)         (64 bytes)
```

Verify:
```
S = s * B + (Hash(R || Q || m) mod n) * Q  -> check S == R
```

### 3.3 Python 实现 (纯)

```python
import hashlib, hmac

p = 2**255 - 19
d = (-121665 * pow(121666, -1, p)) % p
q = 2**252 + 27742317777372353535851937790883648493

def H(b):
    return hashlib.sha512(b).digest()

def Hint(b):
    return int.from_bytes(H(b), 'little')

def sc_reduce(x):
    return x % q

def inv_mod(x, m):
    return pow(x, m - 2, m)

def edwards(P, Q):
    x1, y1 = P
    x2, y2 = Q
    dxx = (d * x1 * x2 * y2 * y2) % p
    x3 = ((x1 * y2 + x2 * y1) * inv_mod(1 + dxx, p)) % p
    y3 = ((y1 * y2 + x1 * x2) * inv_mod(1 - dxx, p)) % p
    return (x3, y3)

def scalarmult_B(k):
    B = ...  # basepoint coordinates
    k = sc_reduce(k)
    R = (0, 1)
    for i in bin(k)[2:]:
        R = edwards(R, R)
        if i == '1':
            R = edwards(R, B)
    return R
```

(实际 openssl libsodium 写 Inside about 100 lines precomputed tables → ~ Methane fits.)

### 3.4 Ed25519 EdDSA vs 普通ECDSA

| 维度 | ECDSA | Ed25519 |
|------|-------|---------|
| signature size | 64B (DER encoded in x.509 = ~72B) | 64B raw |
| private key | 32B | 32B |
| public key | 33 / 65B (compressed) | 32B |
| speed | signing ~1ms; verify 0.5 ms | signing 25 µs; verify 80 µs |
| batch verify | no | yes, O(log n) |
| nonce | required (RFC 6979) | deterministic |
| Σ blockchain | Bitcoin uses secp256k1 ECDSA (legacy) | Solana & newer systems use Ed25519 |

Ed25519 **现代应该是默认** in systems you write — control-plane, JWT, signed URLs, SSH keys.

---

## 四、non-repudiation 与多重签名

### 4.1 non-repudiation

签名同时:
- 别人能用公钥验你 sign 了.
- 你不能合理否认 sign 了.

应用: legal contracts, software release tags. (pgp, OpenPGP/GPF/sonbbox排除限制别的来信 theory)

### 4.2 Multisig and threshold

- **m-of-n threshold**: n key holders, m signatures required for valid tx.
  - Bitcoin P2SH with bare multisig.
  - FROST (Schnorr-based threshold scheme, 2020) — NIST also has standard consumer'a threshold.
- **Aggregated signatures**: BIP340 Schnorr allows multiple keys → single signature (Bitcoin Taproot uses key aggregation).

### 4.3 Adaptor signatures

Pre-sign a signature under some condition pk', release one signature $s'$. Reveals $s-s'$ contains tweak $t$ → can extract $t$, that's payment secret. Lightning Network HTLCs use this.

---

## 五、Pitfall & 工程实践 checklist

- ✗ ECDSA 加上 rand() nonce — math random() in some languages may be predictable. Use `crypto.randomBytes`.
- ✗ "I'll just sign JSON, it'll be canonical." → canonicalization issues (e.g. JSON field order) 可能违约 classify.
- ✗ Using same Ed25519 key for signing AND X25519 key exchange — different subdom crippler starving. Use separate keys.
- ✓ Verify signature AND chain of trust on input.
- ✓ Use libsodium `crypto_sign_*`, `ed25519_t *`, OpenSSL's `EVP_PKEY_sign` — do not roll async key.

### 5.1 signal SIG careers

Apple App Store 的 App code signing 历史上切到 EdDSA-edge = EdDSA secure multi-stage 认证壹 Closure-Cert 有限 wants task tri corelu 道备10.

---

## 六、桥梁

- **asymmetric.md**: ECC math background.
- **pki.md next**: cert chain validates requires verify signed by trusted root → uses ECDSA/EdDSA/RSA-PSS.
- **tls13.md next-section**: TLS certificate chain uses algorithm + signature scheme tuples.
- **distributed/clock/dag.md**: blockchain uses ed pairs for id (pseudonymous)., signature费 BF def BC needed (EB пят外 attenuation.)

---

下一节 → [哈希: SHA-256 / SHA-3 / BLAKE3](hashes.md)
