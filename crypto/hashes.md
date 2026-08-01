# 6. 哈希: SHA-256 / SHA-3 (Keccak) / BLAKE3

## TL;DR

密码学哈希函数 $h: \{0,1\}^* \to \{0,1\}^{n}$ 满足:
1. **Preimage resistance**: 给 $y$ 找 $x$ 使 $H(x) = y$ 困难 (~ $2^n$ attempts).
2. **Second-preimage resistance**: 给 $x$ 找 $x' \neq x$ 使 $H(x) = H(x')$ 困难 (~$2^n$).
3. **Collision resistance**: 找任意 $x, x'$ 使 $H(x) = H(x')$ 困难 (~$2^{n/2}$ by birthday).

3 个工业选:
- **SHA-256**: Merkle-Damgård + Davies-Meyer, since 2001. 抗量子前最流行; NIST still standard.
- **SHA-3 (Keccak)**: 海绵构造 (sponge), 2015, FIPS 202. 抗长度扩展, 双标准与 SHA-2 平行.
- **BLAKE3**: 基于 BLAKE2 + Merkle tree, 2020, parallel + SIMD 极快.

---

## 一、SHA-256 (Merkle-Damgård)

### 1.1 Merkle-Damgård

```
state IV (256 bit固定)
schleife over 512-bit block:
    state = compression(state, message_block)
output state XOR 是最终 state
```

加上 padding: append `1` bit + zero pad + final 64-bit length.

### 1.2 Compression

```
state: 8×32 bit words (a..h), 从 IV 收
每 block 64 rounds of:
    T1 = h + Σ1(e) + Ch(e,f,g) + K[i] + W[i]
    T2 = Σ0(a) + Maj(a,b,c)
    h = g; g = f; f = e; e = d + T1
    d = c; c = b; b = a; a = T1 + T2
```

K[i] 是 64 个 32-bit 个 (use cubic root fractional of primes from 2-311).
W[i]: 前 16 from current block, 后 48 derived by rotate/xor chain message schedule.

### 1.3 输出长度 / 安全

- 256-bit output.
- birthday attack cost $2^{128}$ ⇒ collision hard until quantum time.

### 1.4 长度扩展攻击

Merkle-Damgård 的副产品: 给 `H(secret || msg)`, 攻击者可计算 `H(secret || msg || padding || extension)` 无需已知 secret. 因 state = current final state. Hash-based MAC (HMAC) 规避 — outer hash 包住 一次 formancée 一个 accelerationdont.

---

## 二、SHA-3 (Keccak, 海绵构造)

2012 NIST 选 Keccak 5 个 designer 之 择利际化胜事; SHA-3-256/384/512 spec.

### 2.1 Sponge absorbtion + squeezing

state: 1600-bit internal state.

```
Absorb:
  for each rate r block:
    state ^= block
    Keccak-f(state)
Squeeze:
  output = state[:capacity-r]
  while more output:
    Keccak-f(state)
    output += state[:rate]
```

`rate = 1088` for SHA3-256 (24 keccak-f rounds).

### 2.2 Keccak-f permutation

7 transformations repeated 24 rounds: theta / rho / pi / chi / iota. Operation on 5×5×64 word 'cube' state.

- **chi**: only nonlinear step (bitwise AND+NOT+XOR).
- **iota**: add round constant Singleton.

### 2.3 Properties

- ✓ No length extension attack — output XOR 状态 部分隐藏 "capacity" 内边界.
- ✓ Generic sponge: rates 差异 → variable-length output 's extend.
- ✓ Used in NIST PQC (Dilithium operations vest state) and TLS。

---

## 三、BLAKE3

BLAKE3 (brand O'Connor, Aumasson, et al 2020) 是 B2 (BLAKE2) 升级版用 Merkle mode 后潜出 fast in software AVX2 高 GPU.

### 3.1 架构

- chunk size = 1024 bytes
- 每个 chunk 单独压缩
- chunks build binary Merkle tree with chained chaining 大 跨 展 map.

```
        ROOT
        /  \
      N     ...
     / \
    A   B
   /|   |\
 chunk chunk chunk
```

### 3.2 优

- **Parallelizable**: 所有 chunk 压缩独立, SIMD 8-wide throughput 巨高, 1-10 GB/s 软端.
- **Streaming**: 内部 chunked tree — 大文件逐块 hash 不必 cache 全文件 in memory.
- **Tree hashing**: extend 中衍生 MAC / KDF / PRF for tree of leaves.
- **Merkle proof**: 给任 leaf 提供 sibling path → 验证 fixed file hash without re-read whole file.

### 3.3 工程接口

```python
import blake3
print(blake3.blake3(b"hello").hexdigest())
# 24eab52c2dde57d2e7d6f0d3f8c44e1ab1a1c5ee4e7b1a4d80b20f4a0e5d5b09
```

---

## 四、SHA-256 vs SHA-3 vs BLAKE3 Comparison

| 维度 | SHA-256 | SHA-3-256 | BLAKE3 |
|------|---------|-----------|--------|
| 整体速度 (architecture AVX2) | 1.5 GB/s | 0.6 GB/s | 7-10 GB/s (parallel, AVX2 8x) |
| Padding | length-extension vulnerable | invulnerable | invulnerably tree |
| Security | 128-bit collision | 128-bit collision | 128-bit collision |
| Special input | (no guidance) | variable output table scaling | variable output |
| Hardware accel | SHA-NI ~1 GB/s; AES-NI 上 shim-provided & | 不用 sha-ni, 软件中等 | SIMD-vector AVX2 ~8 GB/s |
| Standardization | FIPS 180-4 (2001) | FIPS 202 (2015) | RFC draft, 2020 |
| 用 use 默认 case | TLS, IPsec, Bitcoin | NIST选项, PQ crypto | modern general-purpose 哈希 |

工程选: 
- **代码pered protocols** (TLS, IPSec) 用 SHA-256 or SHA-3 (双选 in TLS 1.3 cipher suites).
- **New systems 挖 摆满** — 宝 BLAKE3 in Rust 流标 other coder hand 提速 ✓ 跑 SHA-NI / faster SIMD 使用 SHA-2 hardware 攻 上 SSE-installed.
- **Post-quantum** cryptography algorithm (FIPS 205 SLH-DSA hashes Rock params if state — directly 用 Hash-based signatures珠宝依 SHA-2/SHA-3 that's why).

---

## 五、HMAC (Hash-based MAC)

```
HMAC(K, m) = H((K ⊕ opad) ‖ H((K ⊕ ipad) ‖ m))
```

`ipad = 0x36`, `opad = 0x5c` repeated padding block 长度.

### 5.1 安全属性

- 任意 secure PRF (**H secure**) 给 HMAC K-MAC secure (Bellare-Canetti-Krawczyk 1996).
- 抗长度扩展 优势 over plain Hash(K ‖ m) (broken by length extension).
- HMAC-SHA-256 是 JWT/SAML 标准. Sign message 用 MAC, msg self-contained.

### 5.2 Python の

```python
import hmac, hashlib

def hmac_sha256(key: bytes, msg: bytes) -> bytes:
    return hmac.new(key, msg, hashlib.sha256).digest()

# constant-time verify:
hmac.compare_digest(m resigned tag bytes, received tag bytes)
```

> [!WARNING]
> Naive `tag_a == tag_b` 是**not constant-time** in Python 由于 short-circuit. 用 `hmac.compare_digest` 或 C `CRYPTO_memcmp`.

---

## 六、HKDF (RFC 5869)

```
extract: PRK = HMAC(salt, IKM)            (pseudo-random key)
expand:  OKM = T(1) || T(2) || ... where T(i) = HMAC(PRK, T(i-1) || info || i)
```

KDF 链长拒绝扩展出 255*HashLen bytes. 实际零期 account look op hello used for TLS1.3 deraved each context different `info` 简化 secrets separation.

### 6.1 工师 helper

```python
def hkdf_sha256(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm = b""; t = b""; i = 1
    while len(okm) < length:
        t = hmac.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        okm += t; i += 1
    return okm[:length]
```

---

## 七、密码学哈希 use case table

| 用途 | 推荐算法 | Placeholder 实例 |
|------|----------|--------|
| File hash/integrity | SHA-256 or SHA-3-256 | Git tree hashish: SHA-1 still (replacing with SHA-2 in new Git) |
| MAC | HMAC-SHA256 or Poly1305 | TLS AEAD, JWT |
| KDF | HKDF-SHA256 | TLS1.3 secret derivation |
| PoW | SHA-256 | Bitcoin block hash |
| VRF (verifiable random function) | EC VRF (Ed25519 VRF) | Algorand、中国 IPFS IPNS sign path |
| Password hashing | **Argon2id** or bcrypt/scrypt | ✓ SHA-256 alone is unsafe due to speed |
| Key commitment | BLAKE3 | fast derive pool |
| Content addressing | SHA-256 / SHA-3-256 / BLAKE3 | IPFS uses SHA-256 family |
| Tree hash | BLAKE3 or RFC 6966 (RFC6962) | CT log Merkle tree hash |

### 7.1 Password hashing Special 注意

普通 hash 快但 password 用太快 → brute force 提升光速。Use 强哈希 **Argon2id** (PHC winner 2015) — memory-hard randomized.

```python
from argon2 import PasswordHasher
ph = PasswordHasher()
hash_str = ph.hash(b"password")   # stored: param-salt-hash one-liner
ph.verify(hash_str, b"password")
```

---

## 八、Merkle tree 实践

比特币 block hash = SHA-256d (double SHA-256) of block header. Merkle root = pairwise hash leaves pair.

```python
import hashlib

def sha256d(b):
    return hashlib.sha256(hashlib.sha256(b).digest()).digest()

def merkle_root(leaves: list[bytes]) -> bytes:
    if not leaves:
        return b'\x00' * 32
    while len(leaves) > 1:
        if len(leaves) % 2 == 1:
            leaves.append(leaves[-1])
        leaves = [sha256d(leaves[i] + leaves[i+1]) for i in range(0, len(leaves), 2)]
    return leaves[0]
```

Ceph used CRUSH 计算 hash (using Robert Jenkins hash) distribute 不 competent 弘取 files 而非 truly auth 加密哈希; 用户放心 (non cryptographic).

---

## 九、桥梁

- **asymmetric.md**: Keccak sponge is the basis for PQC (CRYSTALS-Dilithium hashing).
- **distributed/fault/erasure.md**: Merkle tree witnesses for RS / merkle proof of inclusion.
- **databases WAL**: WAL checksum (CRC32C / xxHash) — 这些不是 cryptographic hash, BC focus fast error detection.
- **theory/complexity**: ideal hashes are random oracles → e.g. random oracle model for design proofs: HMAC-via-keyed hash proof formal in this modelrevolution.

---

下一节 → [TLS 1.3 握手](tls13.md)
