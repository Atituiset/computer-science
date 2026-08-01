# 3. 非对称加密: RSA 与 ECC

## TL;DR

非对称加密 (公钥加密, asymmetric encryption): 加密用**公钥** $pk$ (不需要保密), 解密用**私钥** $sk$. 同理签名: 签用 $sk$, 验用 $pk$.

两大支柱:
- **RSA (Rivest-Shamir-Adleman 1977)**: 基于**大整数因子分解 (integer factorization**) 困难假设. key 多到 2048-4096 bit.
- **ECC (Elliptic Curve Cryptography 1985)**: 基于**椭圆曲线离散对数** (ECDLP) 困难. 256-bit 安全级仅 256-bit key — 比 RSA 6-30× short.

公钥密码学**单项**直接加密大 message 不实际 (RSAES-OAEP 仅 ~190 字节 / 3072-bit 模数). 通常做**密钥交换** (用 RSA/ECDH 协商 short symmetric 密钥) 或 **签名**; 真正 data 加密由 symmetric cipher 受理.

---

## 一、RSA 数学

### 1.1 Keygen

1. 选两等长素数 $p, q$ (e.g. bit-length = 1024 each)
2. 模数 $n = pq$
3. $\varphi(n) = (p-1)(q-1)$ (Euler totient)
4. 选 $e$ 与 $\varphi$ 互素 (常见 65537)
5. 求 $d = e^{-1} \mod \varphi$ (用扩展 Euclidean)
6. 公钥 $(n, e)$, 私钥 $(n, d)$ (或存 $(p, q, d, d\bmod (p-1), d\bmod (q-1), q^{-1}\bmod p)$ 加速)

### 1.2 加密 / 解密

$$c = m^e \bmod n, \quad m = c^d \bmod n $$

由 Euler 定理: 因 $ed \equiv 1 \pmod{\varphi}$, $c^d = (m^e)^d = m^{ed \bmod \varphi} = m$ (when $\gcd(m, n) = 1$)

### 1.3 Python 实现

```python
from math import gcd

def rsa_keygen(bits=2048):
    from Crypto.Util.number import getPrime
    while True:
        p = getPrime(bits // 2); q = getPrime(bits // 2)
        n = p * q
        phi = (p - 1) * (q - 1)
        e = 65537
        if gcd(e, phi) == 1:
            break
    d = pow(e, -1, phi)
    return (n, e), (n, d)

def rsa_encrypt(pk: tuple, m: int) -> int:
    n, e = pk
    return pow(m, e, n)

def rsa_decrypt(sk, c):
    n, d = sk
    return pow(c, d, n)
```

### 1.4 CRT 加速 (RSA-CRT)

私钥操作 $m^d \bmod n$ 用 CRT 拆:
- $m_p = m \bmod p$, $m_q = m \bmod q$
- $d_p = d \bmod (p-1)$, $d_q = d \bmod (q-1)$
- $c_p = m_p^{d_p} \bmod p$, $c_q = m_q^{d_q} \bmod q$
- $h = q^{-1} (c_p - c_q) \bmod p$
- $m = c_q + h q$

Power 比直接 $\bmod n$ pow 上 ~4× (因 modulus half the bit-length + parallelizable). OpenSSL 默认走 CRT.

### 1.5 安全性

- **factoring 困难**: 没有已知多项式算法 factoring $n = pq$. 实际 RSA 我 push 之时 $\sim 829$-bit (2020) 已破 (CADO-NFS, pay 走 2700 CPU 年灯).
- **NIST 推荐**:
  - RSA-2048: 112-bit security
  - RSA-3072: 128-bit security
- **Quantum**: Shor's algorithm O(log³ n) solves factoring on a sufficient large quantum 攻击 factoring → RSA-2048 broken by 4099 qubits 实机 (Logical qubits — 2024 IBM Condor 1121 physis, scale 极待 stage).

---

## 二、RSA 加密实际工装: OAEP

直接 $c = m^e \bmod n$ 是**不安全**:
- 当 $m$ 小 (short message), 低 exponent attack 可"老师摊 出" $m$.
- deterministic 加密 ⇒ 同 plaintext 同 ciphertext, leakage.
- 公钥某 known plaintext attacks (chosen ciphertext) 可 recover.

现代用 **RSAES-OAEP** (Optimal Asymmetric Encryption Padding, Bellare-Rogaway 1995):p

```
em = MGF1(label) || hash(label) || M || 0-pad || 0x01
c = em^e mod n
```
random seed in MGF1 (Mask Generation Function) → encryption 随机化, leakage 除.

### 2.1 工程上界

- RSA-2048 with OAEP 加密 $m$ len ≤ 214 bytes. Not for full HTTPS payload — only transport 向 short signed keys.
- TLS 1.2 RSA key transport 已 deprecate, TLS 1.3 全重 ECDH.

---

## 三、RSA 签名: PSS

```
sign M:
  enc = MGF1(H_1(salt) || hash(M))  ← masked salt
  m = hashed pad + salt + hash(M)
  σ = m^d mod n
verify:
  m = σ^e mod n
  recover salt, recompute enc, compare hash(M)
```

**PSS = Provably secure** in random oracle model. RFC 8017.

**比 PKCS#1 v1.5 签名 (Bellare-Rogaway 1996 hack)**: v1.5 deterministic; Bleichenbacher 1998 私塞 fingerprint attack 后, 业界移到 PSS.

---

## 四、椭圆曲线 ECC

### 4.1 椭圆曲线 (Weierstrass form)

$$ y^2 = x^3 + ax + b \pmod{p}$$

especially prime field $\mathbb{F}_p$. points $(x, y)$ satisfying + identity $O$ (无穷点).

Key fact: ECC 上能构群运算 (point addition): $P + Q = $ 其他由 chord-tangent_gettime 线交曲线 third point 反. 群运算是点 + 标量乘法 ($k \cdot P = P + P + \cdots + P$).

### 4.2 ECDLP

给定 base point $G$ and $k G$, find $k$. 这是 trapdoor inverse: 给 $k, G$ 求 $kG$ 是 O(log k) (binary scalar mult), 但给定 $kG$ 求 $k$ 无已知 polynomial 算法 (general).

### 4.3 ECC keygen

```python
def ecc_keygen(curve):
    d = random.randint(1, curve.n - 1)
    Q = d * curve.G
    return d, Q
```

公钥 $Q$ 是上 curve 上一个 point; private scalar $d$ 数字.

### 4.4 Curve 选择

| Curve | Field | Size | Use |
|-------|-------|------|-----|
| **secp256k1** | $\mathbb{F}_p$, p = 2²⁵⁶ − 2³² − 977 | 256 | Bitcoin |
| **P-256 (secp256r1)** | $\mathbb{F}_p$, p pseudo-random | 256 | TLS widespread |
| **Curve25519** | $\mathbb{F}_{p}$ where p = 2²⁵⁵ − 19 | 256 | Modern (Signal, SSH, modern TLS, WireGuard) |
| **secp384r1** | $\mathbb{F}_p$ pseudo-random | 384 | rare old TLS |
| **Curve448** | $\mathbb{F}_p$, p = 2⁴⁴⁸ − 2²²⁴ - 1 | 448 | RFC 7748 sister |

**Curve25519 vs P-256**: 
- Curve25519 是 Montgomery curve, 实施常数时间 X25519 function (RFC 7748) 极简:
   ```
   X := x; { A24 := 121666; for i := 254 downto 0: swap bit; ... }
   ```
- P-256 (NIST) curve 含特殊系数 + 没严格 constant-time 在 OpenSSL 历史多次 buggy (UG / Hydra cross-version compile 此).

### 4.5 X25519 实现 (打折简版)

```python
def x25519(k: int, u: int) -> int:
    p = 2**255 - 19
    A24 = 121665
    x1 = u
    x2, z2 = 1, 0
    x3, z3 = u, 1
    swap = 0
    for t in range(254, -1, -1):
        k_t = (k >> t) & 1
        swap ^= k_t
        x2, x3 = cswap(swap, x2, x3); z2, z3 = cswap(swap, z2, z3)
        swap = k_t
        A = (x2 + z2) % p
        AA = (A * A) % p
        B = (x2 - z2) % p
        BB = (B * B) % p
        E = (AA - BB) % p
        C = (x3 + z3) % p
        D = (x3 - z3) % p
        DA = (D * A) % p
        CB = (C * B) % p
        x3 = ((DA + CB) ** 2) % p
        z3 = (x1 * ((DA - CB) ** 2)) % p
        x2 = (AA * BB) % p
        z2 = (E * (AA + A24 * E)) % p
    x2, x3 = cswap(swap, x2, x3); z2, z3 = cswap(swap, z2, z3)
    return (x2 * pow(z2, -1, p)) % p

def cswap(swap, a, b):
    return (b, a) if swap else (a, b)
```

完整实装 ~100 行, Bernstein original C 论 X25519 文源. 没有任何 secret-dependent branch 看到 — constant-time by construction.

### 4.6 安全级别比较

| Class | RSA modulus | ECC params | Quantum solvable? |
|-------|-------------|------------|------|
| 80-bit | 1024-bit | 160-bit | No |
| 112-bit | 2048-bit | 224-bit | Yes (Shor) |
| 128-bit | 3072-bit | 256-bit | Yes (Shor) |
| 192-bit | 7680-bit | 384-bit | Yes (Shor) |
| 256-bit | 15360-bit | 521-bit | Yes (Shor) |

> [!NOTE]
> ECC 在**所有非量子场景下**优势: key 小, cert 小, 握手快, 签短小 含 ChainLink markers 解 password; signature chain 检起加速 from 与 CRL / DFP considerations.

### 4.7 Shor 量子级破 ECC

Shor 算法能 solve DLP on elliptic curves in $O(L^{1.5})$ time. 量子机 6N+3 logical qubits 可破 256-bit ECC. Lattice-bundling protection → PQC ML-KEM (CRYSTALS-Kyber) / ML-DSA / ECC migration milestone 2024-2030 industry.

---

## 五、ECIES: 用 ECDH 替代 RSA

ECIES (Elliptic Curve Integrated Encryption Scheme) 是用 ECDH 协商 secret 然后 symmetric encrypt:

1. 接收方公钥 $Q$; 接收方私钥 $d$.
2. 加密方临时 $e$: ephemeral key $E = e G$. 计算 $S = e Q$; derive $k_{enc}, k_{mac}$ KDF(S).
3. ciphertext $C = \text{SymmetricEncrypt}(k_{enc}, m)$; tag = MAC($k_{mac}$, $C$).
4. Output $(E, C, tag)$.
5. 接收: derive $S = d E$; KDF; decrypt; verify tag.

工程: 用 libsodium `crypto_box` 的 sealed box 加密 API 直接.

---

## 六、工程级 Pitfall checklist

- ✗ 自己 RSA 实现 OAEP; ✓ use OpenSSL / libsodium RFC 8017 implementation
- ✗ ECDSA nonce random — risk 短 shlor collide reuse; ✓ deterministic (RFC 6979) 用 key+msg hash 出 nonce
- ✗ DDH 假设下加密 plaintext 直接 = $m G $ 否 disambig 验**—Theory hinge critical, direct DLP products, use end optional. ✓ ECIES / proper KEM scheme
- ✗ Don't use secp256k1 上 over curve 派生 type 回曲验证 (the input point must satisfy the curve equation)
- ✗ Use same key for signing and encryption — different algorithms / different keys in PIV PVI certified distinguish
- ✗ 永远不要把 ECDSA 两个签名 (with same k) 共用 nonce (PS3 hack 2010) → private Kate.
- ✓ Edwards curve Ed25519 signing is also 一致ly faster & smaller & frees you from k management.

---

## 七、与项目其他章节的交叉

- **number-theory.md**: GCD inverse, Pascal's theorem, mod-arithmetic, Euler totient — 这 area 是 crypto foundation.
- **theory/complexity.md / co-NP / factoring**: FACTOR ∈ NP ∩ co-NP 面临 Shor Algorithm-QCATTAC optimal but not NP-hard → 建议 likely complexity separation.
- **os/net/xdp-dpdk.md**: TLS 一些 ASIC offload 已痕迹, Cloudflare DPDK / TLS inline hotp.
- **distributed/consensus**: 类 DA ledger system (Bitcoin consensus) 用 PoW hashcash redirect with secp256k1 ECDSA on each UTXO spender implementation mass 用 ECC API.
- **system-design/queue/outbox**: at-least-once encrypted tokens idempotency allow charge signature stack.

---

下一节 → [密钥交换: DH / ECDHE / X25519](key-exchange.md)
