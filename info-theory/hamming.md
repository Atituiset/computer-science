# 4. 汉明码: 可纠 1-bit 错误的鼻祖

## TL;DR

Hamming (7, 4) 是第一个 systematic error-correcting code, 1950Hamming 在 Bell 实验室中亲自为解决 weekend computer relay error 而设计. 编码 4 bit data → 7 bit codeword (3 bit redundancy), 可纠任意 1 bit 错误. 实现 encoding-decoding 用小 parity check matrix H 给 syndrome 计算—Compute syndrome $\vec{s} = H \vec{r}$ ⇒ 错的 bit position = $\vec{s}$ 二进制解读 (or 0 = 正确). 加 1 个 overall parity → SECDED (可纠 1 单 bit + 检测 2 bit error). 现代 ECC RAM 跑的就是 SECDED.

---

## 一、Hamming (7, 4) 设计

### 1.1 Structure

4 data bits $d_1, d_2, d_3, d_4$ → 7 bit code. 三 parity bits $p_1, p_2, p_3$ 位于位置 1, 2, 4 (2 的幂位置留给 parity, 其余给 data). At positions:

$$ c_1 = p_1,\; c_2 = p_2,\; c_3 = d_1,\; c_4 = p_3,\; c_5 = d_2,\; c_6 = d_3,\; c_7 = d_4 $$

Parity bits 覆盖一组 positions (which binary index has its corresponding parity's bit set):
- $p_1$ 覆盖 positions with bit 0 set in index: 1, 3, 5, 7
- $p_2$ 覆盖 positions with bit 1 set: 2, 3, 6, 7
- $p_3$ 覆盖 positions with bit 2 set: 4, 5, 6, 7

parity $p_i$ = XOR of data bits in its covers.

### 1.2 Parity check matrix H

$$ H = \begin{bmatrix} 1 & 0 & 1 & 0 & 1 & 0 & 1 \\ 0 & 1 & 1 & 0 & 0 & 1 & 1 \\ 0 & 0 & 0 & 1 & 1 & 1 & 1 \end{bmatrix} $$

```python
import numpy as np
H = np.array([
    [1,0,1,0,1,0,1],
    [0,1,1,0,0,1,1],
    [0,0,0,1,1,1,1],
])
G = np.array([
    [1,1,0,1,0,0,0],
    [0,1,1,0,1,0,0],
    [1,1,1,1,0,1,0],
    [0,1,1,0,0,0,1],
]) % 2  # generator
```

### 1.3 Encoding

$c = d G \mod 2$ where G 是 generator matrix.

```python
def hamming_encode(data: list[int]) -> list[int]:
    """4 data bits → 7 code bit."""
    return [int(x % 2) for x in np.dot(data, G) % 2]
```

### 1.4 Decoding with syndrome

```
r = received 7 bits
s = H @ r mod 2     # syndrome 3 bit
if s == 0:     no error
else:          bit position = interpret s as binary (1..7), flip that bit
```

```python
def hamming_decode(r: list[int]) -> list[int]:
    s = H.dot(r) % 2
    if not s.any():
        return r[2], r[4], r[5], r[6]   # d1 d2 d3 d4
    pos = int(s.dot([1, 2, 4]))         # position (1=first)
    r[pos - 1] ^= 1                     # flip
    return r[2], r[4], r[5], r[6]
```

### 1.5 Examples

- Correct transmit `c = [1,0,1,0,1,0,1]`, receive OK ⇒ syndrome 0.
- Error bit 5: receive `[1,0,1,0,0,0,1]`. Compute syndrome: H · r mod 2 = [1, 0, 1] = 5 (binary 101). Flip bit 5 ⇒ recover.

---

## 二、Hamming distance & detecting capacity

### 2.1 Hamming distance

两 codewords 不同的 bit 数. Hamming (7,4) 最小 distance $d_{\min} = 3$.
- 可检测 $d_{\min} - 1 = 2$ bit errors.
- 可纠正 $\lfloor (d_{\min}-1) / 2 \rfloor = 1$ bit errors.

### 2.2 Singleton bound

Code with min distance $d$, $R = k/n$ rate has:
$$ d \leq n - k + 1 $$

Hamming codes reach this.故 Hamming(7,4) $d_{\min}=3$, $n-k+1 = 4$, not optimal, but useful for short code.

### 2.3 Sphere packing bound

若 code $C$ $(n, k, d)$ with $d = 2t + 1$:
$$ 2^k \cdot \sum_{i=0}^{t} \binom{n}{i} \leq 2^n $$

Hamming code is **perfect**—saturates sphere packing bound (for $t = 1$): $2^4 \cdot (1 + 7) = 2^7$. 完全 cover 全 2^7 space.

---

## 三、扩展 Hamming (8, 4) SECDED

Add overall parity bit (sum of all):
- 可纠任意 1 bit.
- 可检测 (但不纠) 任意 2 bit error.

服务器 ECC RAM 使用 SECDED (short for Single Error Correction, Double Error Detection). 对 64 bit RAM, 通常用 Hamming(72, 64) Hammond variant: 64 datatext + 8 parity.

```python
def secded_encode(data_4: list[int]) -> list[int]:
    c7 = hamming_encode(data_4)
    p = sum(c7) % 2
    return c7 + [p]

def secded_decode(r8: list[int]) -> tuple:
    c7, p = r8[:7], r8[7]
    s = H.dot(c7) % 2
    overall = sum(r8) % 2
    if not s.any() and overall == 0:
        return c7[2], c7[4], c7[5], c7[6], 'OK'
    if not s.any() and overall == 1:
        return None, 'D2 error detected'
    if s.any() and overall == 1:
        # single error in c7; fix
        pos = int(s.dot([1, 2, 4]))
        c7[pos - 1] ^= 1
        return c7[2], c7[4], c7[5], c7[6], '1-bit corrected'
    if s.any() and overall == 0:
        # double error - uncorrectable
        return None, 'D2 error, uncorrectable'
```

---

## 四、Hamming distance其它使用

### 4.1 ML / codeword/ 距离最近邻 (球够不 安全设距离) 修正:

hamming NetE achievable edit-distance nearest codeword格给出从嘿嘿 case 转 Euler channel ramblе.

### 4.2 Indexed 整数 set

加速查询 high-dimensional integers / bitset: search index 使用 "fewest bit difference" = 文件 → database dedupe. Sense of approximate nearest neighbor.

---

## 五、与 5G / CPRI / WiFi 实际 工程

5G transport 网络回程屡用 BCH / Reed-Solomon + LDPC 通过 fiber. Hamming code **核心接地** only on-cache L1 microcode hill warm 出 → fault-tolerant RAM, satellite deep-space link (Voyager 1977 RS+CC concatenated).

Hyperloop-Net TCP-IP level 用校验 checksums & CRC32C (比 Hamming 复杂 cyclic code 各 derivative).

---

## 六、局限性

- 1 bit error correctable; 数据率给 4/7 ~ 57% ⇒ redundancy 75%. Real 链 比例 ≥ Hamming(ii)多项式 distance.
- 多 bit error (especially burst) 不断 → 必须 interleaving 后才 LDPCTurbo 嵌入 next.
- 距离随 length 增加 (Sophisticated code 覆 uses dmin=12+ tight stronger).

→ CD / DVD / satellite link 用 RS / convolutional concatenate.

---

## 七、桥梁

- **complexity.md** / **reduce**: Hamming code-realization importances keep通道 channel coding process performance tradeoff.
- **capacity.md prev**: distance from Shannon limit; Hamming(7,4)距 ≈3 dB.
- **reed-solomon.md next** 自然Nü error correction 大 blockerror model 帮决定 selection.
- **crypto/hashes.md**: ECC RAM cross-seen Hamming 硬件实现 是 necessary为 rowHammer őd PT co-prac-tice.
- **os/memory/virtual-memory**: ECC RAM is the leaf protection layer hardening working connections, layered system add on top virtual memory pinning.

---

下一节 → [Reed-Solomon 码](reed-solomon.md)
