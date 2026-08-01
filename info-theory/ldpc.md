# 7. LDPC 码: 5G NR 数据信道与 Tanner 图

## TL;DR

LDPC (Low-Density Parity-Check) 码 Galager 1960 MIT dissertation 提出, "forgotten" 多 decade, 1996 MacKay 重新发现. 现代 5G NR data channel, DVB-S2, WiFi 802.11n+ 都用 LDPC 主导. 关键优点:
- **接近香农容量**: 距离 Shannon 限 < 1 dB in long block.
- **O(n) 解码**: 相比 BCH/Turbo quadratically faster at large n.
- **parallel decoding**: Tanner 图 上 explicitly parallelizable across nodes.

---

## 一、原理

### 1.1 Low-density parity-check matrix H

n columns / m rows; 大多项元素是 0, 少数是 1; sparse. Structured 的 H:
- 5G LDPC base graph: quasi-cyclic 加偏移 = encoding fast.
- LDPC code C = { v ∈ F_2^n : H v^T = 0 }.

### 1.2 Tanner graph

二分图 split:
- Variable nodes (V-nodes): one per code bit.
- Check nodes (C-nodes): one per parity equation (row of H).
- Edge between V-node i and C-node j iff H[j][i] = 1.

### 1.3 Girth ≥ 6

如果 graph 有 4-cycle ⇒ iterative decoding 收敛 degraded. 设计 standard require girth ≥ 6.

---

## 二、Encoding (linear time)

```python
import numpy as np
def ldpc_encode(H, data):
    m, n = H.shape
    k = n - m
    parity = np.zeros(m, dtype=np.uint8)
    for i, bit in enumerate(data):
        if bit:
            for j in H[:, i].nonzero()[0]:
                parity[j] ^= 1
    return list(data) + list(parity)
```

---

## 三、Belief Propagation 解码 (Min-Sum)

工程 min-sum 简化版本:

```python
def ldpc_decode(llr, H, max_iter=50):
    m, n = H.shape
    v2c = np.zeros_like(H, dtype=float)
    c2v = np.zeros_like(H, dtype=float)
    for j in range(n):
        for i in H[:, j].nonzero()[0]:
            v2c[i, j] = llr[j]
    for it in range(max_iter):
        for i in range(m):
            for j in H[i].nonzero()[0]:
                others = [v2c[i, j2] for j2 in H[i].nonzero()[0] if j2 != j]
                c2v[i, j] = np.sign(others[0]) * min(abs(o) for o in others)
        for j in range(n):
            for i in H[:, j].nonzero()[0]:
                v2c[i, j] = llr[j] + sum(c2v[i2, j] for i2 in H[:, j].nonzero()[0] if i2 != i)
        h = [1 if llr[j] + sum(c2v[:, j])[j] < 0 else 0 for j in range(n)]
        if all(check_ok(H, h)):
            return h
    return h
```

Note: 实工程师用 log-domain + numerical stabilization trick (`normalized min-sum` `offset min-sum`).

### 3.2 Performance characteristics

- Stays within 0.x dB of Shannon limit for long blocks (n ≥ 10⁴).
- Code rates tunable providing range from 1/3 to 9/10.
- Iterations count around 10-50 in production.

---

## 四、5G NR 选择

3GPP RAN1 选 LDPC for 5G NR **eMBB data channels**:
- 数据 长 block sizes 一般 8000+ bits.
- Multi-edge type LDPC design by Qualcomm 提供 fine-grained rate matching.
- LDPC code rate 1/5 to 8/9, robust for many SNR regimes (cell edge to center).

5G physical channel 决策 summary:
- Turbo codes (4G) → 慢且 sub-optimal at short block.
- Polar codes (选 control channel) → deterministic short-block advantage.
- Convolutional codes → suboptimal long.

---

## 五、Compare LDPC vs Turbo vs Polar

| 维度 | LDPC | Turbo | Polar |
|------|------|-------|-------|
| Decoding | Min-sum / BP | BCJR MAP | Successive Cancellation |
| 最优 block size | 长 (~10 KB) | 中 (≤ 8K) | 短 (32-2048) |
| 距 Shannon 限 | ~0.5 dB | ~0.8 dB @ 4G | ~0.5 dB @ short |
| 解码复杂度 | O(n) parallel | O(n) 串行 | O(n log n) |
| 5G NR 应用 | data channel | 4G LTE only | control channel (PDCCH, PBCH) |

---

## 六、桥梁

- **capacity.md prev**: LDPC approaches Shannon limit ⇒ coding gain.
- **reed-solomon.md prev**: similar cyclic code; LDPC is much weaker for burst error → must interleave.
- **distributed/fault/erasure.md**: ratch chain datacenter maintenance solution.
- **os/lock/lockfree.md**: parallel SVE workers Belief propagation resembles.

---

下一节 → [Polar 码](polar.md)
