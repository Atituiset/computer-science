# 8. Polar 码: Arikan 2008 构造与 5G NR 控制信道

## TL;DR

Arikan 2008 提出 **channel polarization** transformation: 将 $n$ 个相同 B-DMC 信道 transform into $n$ 个极化信道, 其中**约一半**变得接近无噪, **另一半** 变得接近全噪. 选 "good" channel for data, "frozen" channel for fixed data. FFT-like recursive structure construction.

5G NR 选 Polar code for **控制信道** (PDCCH, PBCH, etc短 message) and **下行控制信息** (DCI): 短 packet 性能胜 LDPC.

---

## 一、Channel Polarization 直觉

### 1.1 两步基本 transform

给定两 identical 独立 copies $W_1, W_2$:
- Upper channel $W^+$: input $(u_1, u_2)$, output $(y_1, y_2)$ via map $x_1 = u_1 \oplus u_2$, $x_2 = u_2$.
- Lower channel $W^-$: input $u_1$, output $(y_1, y_2)$.

After transformation, $W^+$ 比 $W$ more capable, $W^-$ 比 $W$ less capable:

$$ I(W^+) = 2I(W) - I(W^-) $$

### 1.2 Recursive construction

Apply $N = 2^n$ times; 频道沿 polarized scheduled 形聚 nucleate 一 half required close to 1, volume fraction at up dynamic part → 编 low service come oy one side sub polynomial split.

### 1.3 Polar theorem (Arikan 2008)

For consecutive $N$ polarization transform:
$$ \lim_{n\to\infty} \frac{|\{i: I(W_i) \to 1\}|}{N} = I(W), \quad \lim_{n\to\infty} \frac{|\{i: I(W_i) \to 0\}|}{N} = 1 - I(W) $$

—→ polar 定理: 一半 I 极端 close to 1 (∞ capacity), 一半 close to 0 (no capacity)。

### 1.4 Polar code 的构造

- Choose "frozen" bits (set to 0): those on bad channels.
- Send info bits via good channels.
- Receiver knows frozen bits, helps reduce noise effect.

---

## 二、Encoder

For $N$-bit codeword 来 message $u$:

```python
def polar_transform(u):
    """Apply Arikan butterfly transform."""
    n = len(u)
    if n == 1: return u
    u_even = u[::2]
    u_odd = u[1::2]
    y = polar_transform([a ^ b for a, b in zip(u_even, u_odd)]) + polar_transform(u_odd)
    return y

def polar_encode(info_bits, frozen_mask, N):
    """info_bits ∈ GF(2)^k, frozen_mask ∈ {T,F}^N given by construction; info is placed at 'T' positions."""
    u = [0] * N
    info_iter = iter(info_bits)
    for i in range(N):
        if frozen_mask[i] == 'F':
            u[i] = 0
        else:
            u[i] = next(info_iter)
    return polar_transform(u)
```

Construction of frozen set 用 **density evolution** 或 **Gaussian approximation** (Tal-Vardy 2013): 计算每个 bit channel's Bhattacharyya parameter $Z(W_i) = \sum_y \sqrt{W(y|0) W(y|1)}$ axis good (low $Z$) 给 info.

---

## 三、Successive Cancellation Decoder

经典 decoder:

```python
def polar_decode_sc(y, frozen_mask):
    n = len(y)
    u_hat = [0] * n
    def rec_decode(i):
        if frozen_mask[i] == 'F':
            u_hat[i] = 0
        else:
            likelihood_0 = likelihood_decoder(y, u_hat[:i])
            likelihood_1 = likelihood_decoder(y, u_hat[:i] + [1])
            u_hat[i] = 0 if likelihood_0 > likelihood_1 else 1
        return u_hat[i]
    for i in range(n):
        rec_decode(i)
    return u_hat
```

复杂度 O(N log N);  parallelization 有限.  
List decoder (SCL with CRC-assistedLista 32 实际) 在实践中给距离 short-block capacity仅 0.5 dB.

---

## 四、5G NR Polar construction details

3GPP R15 Polar code 标准 params:
- $N = 2^n$, $n$ = 5..10 (32-1024 bit max).
- $K$ up to 1024.
- Frozen via 5G NR specific reliability sequence (specified in TS 38.212).

Decoder: CRC-Aided Successive Cancellation List (CA-SCL). K = const 某 用 list 32, +CRC verify final candidates. Practical production 距离香农容量 ≤ 0.5 dB at rate 1/2.

---

## 五、Polar Family variants

- **CRC-aided Polar**: CRC例行; SCL candidate filter ⇒ 5G NR.
- **CA-Polar with interleaving**: 跨 H 跳槽 minimum bit error dependence.
- **Polar subcode**: 5G gives flex code rates via rate matching (repetition, puncturing).
- **Grouped / short Polar codes**: improve spectral efficiency for very short messages.

---

## 六、与 LDPC 比较 (短 vs 长 block)

| Block | Polar (SCL-32) | LDPC (Min-Sum) | Best |
|-------|-----------|------------|------|
| $N = 128$ | 0.4 dB to capacity | 1.5 dB | Polar |
| $N = 256$ | 0.5 dB | 1.1 dB | Polar |
| $N = 1024$ | 0.6 dB | 0.5 dB | LDPC |
| $N = 4096$ | 0.9 dB | 0.4 dB | LDPC |

5G 因此选 Polar for short control channels (PDCCH/PBCH) and LDPC for long data (PDSCH/PUSCH).

---

## 七、桥梁

- **ldpc.md prev**: long-block complementary in 5G.
- **complexity.md** 在 coding theory 跟 NP 难涉不同维的介绍 code optimization polynomial issues
- **capacity.md prev**: 距离香农 another soon compression capacity chasing.

---

下一节 → [Turbo 码](turbo.md)
