# 2. 信道容量: 香农公式 C = B · log₂(1 + SNR)

## TL;DR

**香农容量定理** (1948): given 物理 (带宽 $B$, SNR=S/N) AWGN 通信信道下, 无错传输率**上界**:
$$ C = B \log_2(1 + \mathrm{SNR}) $$

这是一条**自然定律**: no matter what code you design, no matter error-correction, no matter modulation, no encoding scheme can deliver bits reliably faster than $C$ bits/sec.

本章节小问题稍微 recover:
- 5G mmWave 100 MHz, 25 dB SNR ⇒ $C = 830$ Mbit/s, 8x8 MIMO push 学 $6.6$ Gbit/s.
- 香农极限 vs feedback 8dB → real engineers in production 距离 ≤ 1.5 dB via LDPC + LDPC.

---

## 一、Channel model

### 1.1 离散无记忆信道 (DMC)

input alphabet $\mathcal{X}$, output $\mathcal{Y}$, transition probability $p(y|x)$. Memoryless: 每次独立 (与 prior 输入无关).

容量:
$$ C = \sup_{p(x)} I(X; Y) $$

### 1.2 BSC (Binary Symmetric Channel)

$\mathcal{X} = \mathcal{Y} = \{0, 1\}$, $p(0|0) = p(1|1) = 1 - p$, $p(0|1) = p(1|0) = p$.

这里 $p$ 是 bit error probability.

$$ C_{\text{BSC}} = 1 - H_2(p), \quad H_2(p) = -p \log_2 p - (1-p) \log_2(1-p). $$

| $p$ | $C$ | meaning |
|-----|-----|-----|
| 0 | 1 bit | 无噪 |
| 0.5 | 0 bit | 全噪 (无可传) |
| 0.01 | $\approx 0.92$ bit | 8% lost |

### 1.3 BEC (Binary Erasure Channel)

$\mathcal{Y} = \{0, 1, ?\}$ (erasure ?) with prob $\epsilon$:

$$ C_{\text{BEC}} = 1 - \epsilon $$

工程意义: TCP packet loss = erasure channel.  TCP throughput 上界 = bandwidth × $(1 - loss)$.

### 1.4 AWGN

$Y = X + N$, $N \sim \mathcal{N}(0, \sigma^2)$. 给定 input power P, signal-and-noise ratio S/N:

$$ C = \frac{1}{2} \log_2(1 + \mathrm{SNR}) \quad \text{per real symbol}$$

or for bandwidth $B$ bandpass channel:
$$C = B \log_2(1 + \mathrm{SNR}) $$

---

## 二、Capacity 推导 sketch

记 $X$ 是发送信号, power 上界 $P$; 噪声 $N$ 高斯 $\sigma^2$. 我们希望 max $I(X; Y)$ over $p(x)$.

$$ I(X; Y) = h(Y) - h(Y|X) = h(Y) - h(N) $$

因 $h(N) = \frac{1}{2} \log(2\pi e \sigma^2)$ 是常数 (given $X$, $Y = X + N$, $h(Y|X) = h(N)$).

$Y$ has mean $E[X]$ (assume 0 WLOG) and variance $P + \sigma^2$. Max 鞅 high entropy ⇒ Gaussian ⇒ $h(Y) \leq \frac{1}{2} \log(2\pi e (P + \sigma^2))$.

$$\max I = \frac{1}{2}\log(2\pi e(P+\sigma^2)) - \frac{1}{2}\log(2\pi e \sigma^2) = \frac{1}{2}\log\left(1 + \frac{P}{\sigma^2}\right)$$

公式 rise field quickly $\frac{1}{2}\log_2(1 + \mathrm{SNR})$ per sample.

For bandwidth $B$ signal (Nyquist sample rate 2B/sec), result $B\log_2(1+\text{SNR})$.

---

## 三、5G 实践 raw numbers

### 3.1 mmWave 28 GHz cell

| 维度 | 数值 |
|------|------|
| Bandwidth | 100 MHz |
| SNR | 25 dB (cell center) → 5 dB (cell edge) |
| Capacity single stream | 100 × $\log_2(1 + 10^{25/10})$ ≈ 100 × 8.66 = 866 Mbit/s (cell center) |
| Single stream 香农 @ 5dB | 100 × $\log_2(1 + 3.16)$ ≈ 224 Mbit/s |
| MIMO 4x4 spatial streams* | ×4 香农 ≈ 3.46 Gbit/s |
| 5G NR demonstrated peak rate downlink in lab | ~4.2 Gbit/s |

* MIMO spatial multiplexing requires good channel conditions. 4 streams at SNR sufficient.

### 3.2 WiFi 6 / 802.11ax

20 MHz bandwidth 20:11 1024-QAM 11 dB SNR ⇒ capacity 1 Gbit/s theoretical, 实测 100s Mbit/s.

### 3.3 DSL VDSL2

100 kHz - 12 MHz bandwidth. Saturated $\Rightarrow$ 200 Mbit/s total raw (down+up). 距离 line 25 dB SNR at 30 MHz ⇒ $C ≈ 200$ Mbit/s.

---

## 四、Coding gain (实际编码离香农的距离)

**Coding gain**: 双 error-rate (e.g. BER=10⁻⁶), coding 可给相同 BER 用较低 SNR. 单位 dB.

| Code | Coding gain @ 10⁻⁶ | Fuel use成熟 |
|------|-----------------|------|
| Hamming (15,11) | ~1 dB | 古典 |
| Reed-Solomon (255,223) | ~2-3 dB at BER10⁻⁶ | 品格 industry obsolete 不是 nesta der (offset via symbol errors) |
| Reed-Muller (128,64) | ~1.5 dB | short codes country PDF: Polar 起源有关 |
| Convolutional code + Viterbi (K=7) | ~3-4 dB | 3G 基 line 代 |
| Turbo code (3G) | ~5.5 dB | 3G/4G |
| LDPC (Wifi 6/5G) | ~6-8 dB | 现工 |
| Polar code (5G NR control) | ~5 dB | 5G |
| ML optimal (Shannon limit) | ~9-10 dB** | floor |

**与香农极限的距离**: typical production code 在香农 底 + 1-3 dB ⇒ throughput 法例 lower limit at 95%, much harder to find. 

---

## 五、Cross-layer: capacity vs power, MIMO, OFDM

### 5.1 Power-bandwidth tradeoff

固定 capacity C 下: $P \sim 2^{C/B}$. 高 B 低功率 (NB-IoT), 低 B 高功率 (卫星 VSAT).

### 5.2 MIMO

$M$ transmit antennas, $N$ receive antennas give potential $\min(M, N)$ independent spatial streams:

$$ C_{\text{MIMO}} = H \cdot \log(1 + \text{SNR}) \cdot \min(M, N) $$

(H = scaling factor based on antenna correlation).

5G mmWave 4x4 spatial streams ⇒ ~4× capacity.

### 5.3 OFDM

OFDM 划分 into $K$ subcarriers, each with flat-fading assumption. 总 capacity:

$$ C_{\text{OFDM}} = \sum_i B_i \log_2(1 + \text{SNR}_i) $$

5G OFDM gives per-subcarrier modulation selection: QPSK on weak subcarriers, 64-QAM on good. Water-filling algorithm骏 optimal.

### 5.4 水注 (water-filling)

Power $P$ distribute cross parallel subchannels to maximize total. Optimal:

$$ P_i^* = \max(0, \lambda - \sigma_i^2) $$

where $\lambda$ 是 determined budget constraint $\sum_i P_i^* = P$ total.

→ better subchannels get more power. Practical 5G adaptive modulation does approximate.

---

## 六、典型系统 capacities

| 系统 | Bandwidth | SNR (dB) | Capacity | 5G 的 downlink cell edge (Mbps) |
|------|-----------|----------|----------|----|
| WiFi 6 (1024-QAM) | 160 MHz | 35 | ~5400 Mbit/s | 1.5 Gbit/s peak |
| 5G NR mmWave (28GHz) | 100-400 MHz | 25 (cell); 5 edge | 860-3440 center | 200-500 edge |
| Sub6 5G (3.5GHz) | 100 MHz | 20 / 0 edge | 666 center / 100 edge | 200-500 |
| 4G LTE (Cat 19) | 20 MHz | 15-20 | 200-450 Mbit/s | 1000 peak DL |
| 1000BASE-T Ethernet (1 Gbit/s / 100m Cat5) | bandwidth regulated, binary signaling via PAM5 + DSP | | Dissertation / vs coding kauge.| |
| 10GBASE-T codec (1024-PAM / DSQ128 encoding) 兼容 100m Cat6a | bandwidth 500 MHz over 100 m | 250 MHz—with coding cancel crosstalk | 10 Gbit/s | 100% efficiency |

---

## 七、Capacity 实践: 用 Python 仿真

```python
import numpy as np

def shannon_capacity(bw_hz: float, snr_db: float) -> float:
    return bw_hz * np.log2(1 + 10 ** (snr_db / 10))

# mmWave cell center & edge
print(shannon_capacity(100e6, 25))  # ~866 Mbit/s
print(shannon_capacity(100e6, 5))   # ~224
print(shannon_capacity(100e6, 0))   # ~100

# MIMO throughput (4x4 with same SNR)
print(4 * shannon_capacity(100e6, 10))  # ~1.37 Gbit/s
```

---

## 八、有限 block-length capacity

Shannon's classical theorem是 asymptotic ($n \to \infty$). 有限 block length $n$ 给出修正:
$$ \log M^* \leq n C - \sqrt{n V} Q^{-1}(\epsilon) + O(\log n) $$

where $V$ 是 dispersion (channel dispersion), $Q^{-1}$ 是 inverse Gaussian Q function, $\epsilon$ 是 error probability.

工程意义: short packets (control channels in 5G) 受惩罚. Polar code 在 short packet (e.g., 32-256 bits) 距离香农更近 => 5G 选 Polar for control.

---

## 九、桥梁

- **compression.md prev**: source coding theorem vs. channel coding theorem 双极限.
- **modulation.md next-跳到**: QAM constellations give precisely $\log_2 M$ bits per symbol; 与 capacity $\sim B \log (1+\text{SNR})$ 取 best modulation.
- **ldpc.md**: LDPC is the producer-in-production code nearest to channel capacity for 5G NR data.
- **crypto**: capacity feedback limit 不直接 位 crypto 但 random source entropy uses ≥ 2·H(X) source candidate puts. Multi key bit predictions rate.
- **distributed/clock/dag**: latency-bandwidth product impacts relation 计算 (link RTT × capacity = inflight bits, TCP/QUIC congestion window).

---

下一节 → [无损压缩](compression.md)
