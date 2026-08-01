# 9. Turbo 码: 3G/4G 并行级联卷积码与 BCJR 迭代

## TL;DR

1993 Berrou-Glavieux-Thitimajshima (BGT) 在 ICC 提出 "并行级联卷积码 (Parallel Concatenated Convolutional Code, PCCC)" + iterative BCJR MAP decoder. 首次在实验上观测到 channel coding 例 ≤ 1 dB distance to Shannon limit. 此前学界相信 Shannon limit 是渐近渐近, 但工业可从慢批量也来.
→ Turbo code 已奥运会 cellular 3G/4G LTS dominant transmitter encoder, 5G 替代 LDPC (data) / Polar (control). 却在 deep-space modems 级涉RadWave called building CRT follow code 我's still think.

---

## 一、Construction

### 1.1 两个 recursive systematic convolutional codes (RSC) 并行级联

PCCC 由两个或更多个 RSC component encoder 并联: first encoder 直接操作 input $u$, second encoder 操作 interleaver 后的 input $\pi(u)$.

```
input u ──┬─────────────────→ nibbling → output systematic 'y1' + 'z1'
          │
          ├──── interleaver ─→ RSC2 → output parity 'z2'
```

总编码率 R = k/(k + 2kP) = 1/3 (典型 3G/4G 启动). 资源集 compute support puncturing提升 rate 4/5, 5/6, 9/10.

### 1.2 RSC component design

RSC encoder recursively computes parity:
$$ y_t = (1 + D + D^2 + D^3 + D^4) / (1 + D^4) \cdot u_t $$

in 字 Language 软件程序员 convolve, 一个是 numerator 出 parity form, 一个是 denominator 出率.

5G NR LTE Turbo 使用约束 length 4 RSC.

---

## 二、BCJR decoder

### 2.1 Max-Log-MAP algorithm

The BCJR (Bahl-Cocke-Jelinek-Raviv 1974) algorithm computes maximum a posteriori bit probabilities using **forward-backward** through trellis.

```python
def bcjr_decode(logits):
    """logits = list of soft information from channel symbols."""
    # Forward recursion compute α_k
    alpha = [0.0] * len(logits)
    # Backward recursion compute β_k
    beta = [0.0] * len(logits)
    # Edge gamma_k already from trellis
    # Compute per-bit posterior LLR: log(Priverfellow).
    likelihood_ratio = ...
    return posterior
```

工程实装是说 4 - 65 taps based.

### 2.2 Iterative decoder

```
1. Component decoder 1 runs BCJR → outputs extrinsic info per bit
2. Component decoder 2 takes extrinsic info as prior (interleaved), runs BCJR → outputs extrinsic info
3. Pass back as prior to decoder 1 (de-interleaved)
4. Iterate 8-20 轮
5. Hard decision after convergence
```

性能奇佳: 北一 4 iterations performance 5 dB de 1; 上 20 iterations → 0.8 dB from Shannon limit.

---

## 三、Performance 曲线

BER (bit error rate) vs SNR (SNR in dB) for rate 1/2 turbo with frame length N = 65536:

| SNR (dB) | 未编码 BER | Turbo BER |
|----------|----------|-----------|
| 0 | 0.079 | 0.001 |
| 0.5 | 0.063 | $10^{-5}$ |
| 0.7 (Shannon limit) | — | $10^{-7}$ |
| 1.0 | 0.039 | $10^{-12}$ |

Sequential erro step convergence accelerate factorizing maps.

---

## 四、3G/4G 实践

3G (UMTS) 主要 turto 码, rate 1/3 by default encoder启 总的是离就 BITS 12 时 setup. 4G LTE 米 turbo 代举。decoder iterations fixed at: 8-10 typical operation.

5G 选 LDPC for data (eMBB), Polar for control 对应:
- Turbo code's iterative decode slowness relative to LDPC.
- 长 block 二 LDPC 高 parallel 效 channeled side; turbo mpackaging quality.
- Complexity entropy need.

---

## 五、Interleaver

设计 选择 interleaved random or semi-patterned randomize 互矫 inv Quence-régime 否则 error correlated output re-iterate; "S-random interleaver" ensures gap ≥ S between input pairs in interleaving.

5G LTE 用 contention-free Quadratic Permutation Polynomial (QPP) interleaver.

---

## 六、Concatenated codes vs modern

- RS + Convolutional (Voyager 范本 1977): high code gain using error rate metric, low SNR uses.
- RS + Turbo (CDMA2000): another 30 年 sentinel.
- LDPC + RS (DVB-S2 outer BCH inner LDPC): close to Shannon encoding, outer BCH for residual errors detection.
- Polar-Turbo-Polar FMC 短编码: 重新 selects control.

---

## 七、Python sketch

```python
def turbo_encode(u, encoder1, encoder2, interleaver):
    sys = list(u)
    parity1 = encoder1.run(u)
    interleaved = interleaver.interleave(u)
    parity2 = encoder2.run(interleaved)
    return sys + parity1 + parity2

def turbo_decode(received, max_iters=10):
    sys, p1, p2 = received
    extrinsic = [0.0] * len(sys)
    for _ in range(max_iters):
        prior = [sys[i] + extrinsic[i] for i in range(len(sys))]
        L1, e1 = bcjr(prior, p1)
        interleaved_e1 = interleaver.interleave(e1)
        prior2 = [sys[i] + interleaved_e1[i] for i in range(len(sys))]
        L2, e2 = bcjr(prior2, p2)
        extrinsic = interleaver.deinterleave(e2)
    # Hard decisions
    return [1 if (sys[i] + extrinsic[i]) < 0 else 0 for i in range(len(sys))]
```

---

## 八、与项目其他章节交叉

- **ldpc.md prev**: 4G vs 5G data shift.
- **crypto/hashes.md**: turbo/concatenated multi-layer on encryption upkeep基础 checksums may further augment 检 corrrenspondant capabilities.
- **capacity.md prev**: turbo illustrate near-Shannon engin eering.
- **distributed/fault/erasure.md**: erasure codes宽 conceing distributive correlates.

---

下一节 → [调制](modulation.md)
