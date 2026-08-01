# 5. Reed-Solomon 在 GF(2⁸) 上的纠错码

## TL;DR

Reed-Solomon (RS) 发明 1960 (Reed & Solomon in MIT Lincoln Lab), 是 BCH 类 cyclic code 在 GF($2^m$) 上的实现. RS(n, k) 编码 k 个数据 symbol 为 n 个 codeword symbol, 各 symbol 在 GF($2^m$). key properties:
- 可纠 $(n-k)/2$ 个 symbol error
- 可纠 $n - k$ 个 erasure (位置已知 )
- 适合纠 burst error (单 byte 全错也称 1 symbol error)
- 实际生活: CD-ROM, DVD, QR code, DSL, storage RAID 6, satellite links, Voyager probe.

---

## 一、代数背景

### 1.1 Galois Field GF(2^8)

8-bit symbol field: $\beta_7 \beta_6 \ldots \beta_0$, where $\beta_i \in \{0, 1\}$. 在 GF(2) 上模 reduction polynomial $p(x) = x^8 + x^4 + x^3 + x^2 + 1$ 给 standard field arithmetic; QR CODE标准 generating polynomial.

```
def make_gf256(generator_poly_exp):
    exp = [0] * 512
    log = [0] * 256
    x = 1
    for i in range(255):
        exp[i] = x
        log[x] = i
        x = (x << 1)
        if x & 256: x ^= x ^ 0x11D  # which is the standard QR generator 0x11D
    for i in range(255, 512): exp[i] = exp[i - 255]
    return exp, log

GF256_EXP, GF256_LOG = make_gf256(0x11D)

def gf_mul(x, y): return GF256_EXP[GF256_LOG[x] + GF256_LOG[y]] if x and y else 0
def gf_div(x, y): return GF256_EXP[GF256_LOG[x] + 255 - GF256_LOG[y]] if x and y else (0 if y else 'div0')
def gf_pow(x, p): return GF256_EXP[(GF256_LOG[x] * p) % 255] if x else 0
def gf_inv(x): return GF256_EXP[255 - GF256_LOG[x]]
```

(实工程直接做法 用 GF(2^8) creative JS, 文献 撇 主要 because of `MixedPolynomial FM inverse map taper Algebra`).

### 1.2 Polynomial 多项式 in GF(2^8)

Codeword state多项式 C(x) data input 经 generator $g(x) = \prod_{i=0}^{n-k-1} (x - \alpha^i)$ where $\alpha$ = field primitive. n - k 个 distance transfers.

---

## 二、Encoding 用 systematic form

### 2.1 给 data symbols $D(x) = d_{k-1} x^{k-1} + \ldots + d_0$.

1. $D'(x) = x^{n-k} D(x)$, 给 distance term space at low position.
2. Compute remainder $R(x) = D'(x) \bmod g(x)$.
3. Codeword $C(x) = D'(x) - R(x) = D'(x) + R(x)$ (因 GF(2) addition = subtraction = XOR).

The key properties understand: 
- C(α) = 0 for all i=0..n-k-1.
- $R(x)$ is syndromes-free code portion in the codewords.

### 2.2 例子 与 Python

```python
def rs_generator_poly(nsym):
    """Generate irreducible polynomial for n-k parity symbols."""
    g = [1]
    for i in range(nsym):
        g = gf_poly_mul(g, [1, GF256_EXP[i]])
    return g

def gf_poly_mul(p, q):
    r = [0] * (len(p) + len(q) - 1)
    for j in range(len(q)):
        for i in range(len(p)):
            r[i + j] ^= gf_mul(p[i], q[j])
    return r

def rs_encode_msg(msg_in, nsym):
    gen = rs_generator_poly(nsym)
    # pad msg with zeros for parity
    msg_out = msg_in + [0] * (len(gen) - 1)
    # polynomial division
    for i in range(len(msg_in)):
        coef = msg_out[i]
        if coef != 0:
            for j in range(1, len(gen)):
                msg_out[i + j] ^= gf_mul(gen[j], coef)
    # msg_out[len(msg_in):] is parity
    return msg_in + msg_out[len(msg_in):]
```

例 encode "Hello World!" 用 RS(255, 223):
- data=12 bytes ASCII
- parity = (n-k)*(rounded) = 32 symbols (assumes 6 bytes padding ratio)
- encoded message len = 44 bytes; 6 errors 可纠.

---

## 三、Decoding

### 3.1 Syndromes

```python
def rs_calc_syndromes(msg, nsym):
    return [gf_poly_eval(msg, GF256_EXP[i]) for i in range(nsym)]
```

If all syndromes 0 → no corruption.

### 3.2 Berlekamp-Massey: error locator polynomial

Given syndromes $S_1..S_{n-k}$, find error locator polynomial $\Lambda(x)$ whose roots indicate error positions.

```python
def rs_find_error_locator(synd, nsym):
    """Berlekamp-Massey algorithm to find error locator polynomial."""
    err_loc = [1]
    old_loc = [1]
    for i in range(nsym):
        old_loc = old_loc + [0]
        delta = synd[i] ^ gf_poly_eval(err_loc[::-1], synd[i])
        if delta == 0: continue
        if len(old_loc) > len(err_loc):
            new_loc = scale_poly(old_loc, delta)
            old_loc = scale_poly(err_loc, gf_inv(delta))
            err_loc = new_loc
        err_loc = gf_poly_add(err_loc, scale_poly(old_loc, delta))
    return err_loc
```

### 3.3 Chien search

Find roots of $\Lambda(x)$ in field ⇒ get error positions.

### 3.4 Forney algorithm

Compute error magnitudes at error positions, subtract from received codeword to recover original.

```python
def rs_correct_msg(msg_in, nsym):
    if len(msg_in) < nsym: return msg_in
    synd = rs_calc_syndromes(msg_in, nsym)
    if max(synd) == 0: return msg_in  # no errors
    err_loc = rs_find_error_locator(synd, nsym)
    err_pos = rs_find_errors(err_loc, len(msg_in))
    if not err_pos: raise ValueError("uncorrectable")
    msg_out = rs_forney(msg_in, nsym, err_pos)
    return msg_out
```

---

## 四、QR code RS example

QR code version 4 (33 modules × 33 modules) splits data into blocks. For Level Q + version 3:

```
data codewords: 70 bytes  =  content
EC codewords: 36 bytes per QR block split 2 阻:
Block 1: 26 data + 14 EC  =  40 bytes RS(40,26)
Block 2: 18 data + 14 EC  =  32 bytes RS(32,18)
```

→ RS code correction 补 toml hammers pick pitch collection, 允许受损 QR codes still be readable. Level L (low EC) ~7% error recovery; Level H (high) ~30% — designed to handle 包裹被部分覆盖/partial damage.

---

## 五、CD-ROM / DVD 实施

CD-ROM audio uses **CIRC** (Cross-Interleaved Reed-Solomon Code):
- C1 (32, 28) RS code inner.
- C2 (28, 24) RS code outer.
- Interleaving between C1 and C2 handles burst error up to 4000 bits.

DVD: RS-PC (Product Code), 32 rows × 16 cols structure, encoder RS(208, 192) × RS(182, 172).

```
[ 32 bytes per C1 outer row - 16 inner+  28 bytes BC..]
       ↓ ✗ interleaved in actual CD scan // burst noise block → spread across blocks
[   * (28, 24) C2 inner.ATORHER guffins plusidate atopif freshly banker picky!
```

Each error up to 0.5% mass coverage CD can be recovered (~137 byte burst continuous). Industry governing 子 ordering + redundancy.

---

## 六、RAID 6 use Reed-Solomon (P + Q)

RAID 6 = 2 parity disks: P disk = XOR, Q disk = Reed-Solomon by GF(2^8) on sum:
```
P = sum_i d_i
Q = sum_i alpha^i · d_i  (RS at byte level)
```

Can recover up to 2 disk failures:
- 1 failure: get from P.
- 2 failures: solve $d_{i1} + d_{i2} = P$ and $\alpha^{i1} d_{i1} + \alpha^{i2} d_{i2} = Q$ system.

Modern ZFS / btrfs use 3+ parities (`raidz3`).

---

## 七、卫星 link / Voyager

Voyager 1/2 used RS(255, 223) concatenated with hal rate convolutional code (rate 1/2, K=7) by Viterbi decoder. Combined @coding gain 7 dB level. Independent error correction combined: 上行 signal weak from deep space (sun's emissivity ≈ -80 dBm SNR), → Voyager still sends 比特 @160 bit/s 上加！

---

## 八、其它 RS variant

- **CCSDS RS**: deep-space international standard RS(255, 223).
- **DVB**: DVB-S, DVB-T uses RS(204, 188).
- **DSL**: ANSI DSL RS(255, 239).
- **WiMAX**: RS(255, 239).
- **CDN / 物理层**: EDAC -> SRAM ECC:  ECC server RAM typical 8 byte (symbols) Hamming code for 64-bit data word; not RS.

---

## 九、工程 example

```python
# Encode a string with RS(255, 223) — 32 parity bytes per message
data = list(b"Hello, World! This is a test message.")
nsym = 32
encoded = rs_encode_msg(data, nsym)
print(len(encoded), 'code bytes total')   # 47 bytes
# simulate 3 byte corruption
import random
err_pos = random.sample(range(len(encoded)), 3)
for p in err_pos: encoded[p] ^= 200
# Decode/recover
recovered = rs_correct_msg(encoded, nsym)
assert recovered[:len(data)] == data
print("OK! Recovered:", bytes(recovered[:len(data)]))
```

---

## 十、性能 limit

- RS code 接近 Shannon only at medium-to-high SNR (e.g., >4 dB). At low SNR, **不** approaching near-Shannon.
- coding gain 较 LDPC / turbo / polar less than modern based distance based meters. 在 short-block size RS 还 scalable lengths. → 不会无故 use modern coding.

---

## 十一、桥梁

- **crypto/asymmetric.md**: GF(2^8) arithmetic components share with AES MixColumns.
- **distributed/fault/erasure.md**: erasure coding to do robust storage overhead比 3-replication lower → 写 cross-reference next.
- **capacity.md prev channel coding**: RS codebook vs LDPC coding gap reasoning.
- **databases/recovery/checkpoint**: WAL checksums (CRC32C) JTwStrength, ReedSolomon for backup files 大 length SOCUL 替代 total SHA-256 fueling no post.

---

下一节 → [BCH 码、循环码与多项式基础](bch.md)
