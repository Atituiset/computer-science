# 1. Shannon Entropy: 离散源熵 / 联合熵 / 条件熵 / 互信息

## TL;DR

熵 $H(X)$ = 信源 $X$ 的**平均**不确定度 (字 bit-by-bit 平 TG 系统 coap 联接中, 必分布在平均未发生" leagues 触少 MB; something. per second waiting ). 它是:

$$H(X) = -\sum_{x} p(x) \log_2 p(x)$$

扩展到联合 ($H(X, Y)$), 条件 ($H(Y|X)$), **互信息 $I(X;Y) = H(X) - H(X|Y)$** 即"因为我已知 $X$, $Y$ 的不确定减少了多少". 熵是所有后续章节 (压缩极限, 容量) 的源头.

---

## 一、为什么用 $-\log p$

Shannon 一开始提"信息量" $I(x) = -\log_2 p(x)$: 概率小的事件发生让我们"惊讶大", 信息量大. 几个 desirable properties 唯一确定:
1. $I(x) \geq 0$.
2. $I(x)$ 随 $p \to 0$  → $\infty$.
3. $I(x) = 0$ iff $p(x) = 1$.
4. 独立事件叠加: $I(x, y) = I(x) + I(y)$ if independent.

唯一 $f$ 满足所有: $f(x) = -\log_b x$ (任意对数底). 默认 $b = 2$ 取 bit.

**期望**: $H(X) = E[I(X)] = -\sum p(x) \log p(x)$.

---

## 二、Examples 起手

### 2.1 公平硬币 + 高度偏:

- Fair coin: $H = -2 \cdot (1/2) \log(1/2) = 1$ bit.
- Loaded coin $P(H)=0.99$: $H = -0.99 \log 0.99 - 0.01 \log 0.01 \approx 0.081$ bit.

→ 偏源册的熵远低 (实际每 toss 真正"惊喜"少).

### 2.2 ASCII 英文

英文 26 字母 (空格 + punctuation) variate 很多: empirical 熵 (字天然统计) $H \approx 4.5$ bit/char 但 raw 8 bit/char ⇒ 冗余 44%.

Shannon 1951 估 English word (条件 char-by-char) 实际熵 ≈1.3 bit/char ⇒ 总冗余 84%.

→ 这就是英文 真可压缩到 1/6 原文 size, 实现上 zstd / brotli 接到 1/4 ~ 1/5 之 size.

### 2.3 Python 计算

```python
from collections import Counter
from math import log2

def empirical_entropy(text: str) -> float:
    counts = Counter(text)
    n = len(text)
    return -sum(c / n * log2(c / n) for c in counts.values())

print(empirical_entropy("the quick brown fox jumps over the lazy dog"))
# ~4.4 bit/char
```

---

## 三、联合熵 $H(X, Y)$

$$H(X, Y) = -\sum_{x, y} p(x, y) \log p(x, y)$$

是, 即同时出现"X 取 $x$ 且 Y 取 $y$"的不确定度.

### 3.1 性质

- $H(X, Y) \leq H(X) + H(Y)$ (subj. 独立时取等).
- $H(X, Y) = H(Y, X)$ (对称).
- $H(X, Y) \geq \max(H(X), H(Y))$ (knowing 不会 make more uncertain).

---

## 四、条件熵 $H(Y|X)$

$$H(Y|X) = \sum_x p(x) H(Y|X=x) = -\sum_{x, y} p(x, y) \log p(y|x)$$

"已知 $X$ 的情况下 $Y$ 还剩多少不确定".

### 4.1 链式法则

$$H(X, Y) = H(X) + H(Y|X)$$

Example: $X$ = "今日天气", $Y$ = "明天天气". $H(X, Y) = H(X) + H(Y|X)$ = "今日不确定 + 已知今日的明日增量".

### 4.2 信息不在 $X$ 完美预测 $Y$

- 若 $Y = f(X)$ 确定性: $H(Y|X) = 0$.
- 反之 $X \perp Y$: $H(Y|X) = H(Y)$.

### 4.3 性质

- $H(Y|X) \leq H(Y)$ (knowing $X$ 不会增加 $Y$ 不确定).
- 此式 identificar:

---

## 五、互信息 $I(X;Y) = H(X) - H(X|Y) = H(Y) - H(Y|X)$

互信息是发现自己一个"用 $X$ 推 $Y$ 的相关程度"标准. 详细公式:

$$I(X; Y) = \sum_{x, y} p(x, y) \log \frac{p(x, y)}{p(x) p(y)}$$

直观: "X 与 Y 的实际联合分布与独立分布的 KL散度".

### 5.1 Properties

- $I(X; Y) \geq 0$.
- $I(X; Y) = 0$ iff $X \perp Y$.
- $I(X; Y) \leq \min(H(X), H(Y))$.

工程意义: $I(X; Y)$ 量化 channel throughput:
- channel $Y = X + N$, $N$ 高斯噪声 ⇒ $I(X; Y) = \frac{1}{2} \log\left(1 + \text{SNR}\right)$. 这就是**香农容量**的来源 (next chapter).

### 5.2 Python

```python
import numpy as np

def mutual_info(px: list[float], py: list[float], pxy: list[list[float]]):
    return sum(pxy[x][y] * np.log2(pxy[x][y] / (px[x] * py[y]) + 1e-12)
               for x in range(len(px)) for y in range(len(py)))

# example channel (BSC):
p = 0.1    # error prob
px = [0.5, 0.5]
py = [0.5, 0.5]   # marginal stays
pxy = [[0.95, 0.05], [0.05, 0.95]]
print(mutual_info(px, py, pxy))   # ~0.531 bit
```

---

## 六、KL divergence $D_{\text{KL}}(P||Q)$

$$D_{\text{KL}}(P \| Q) = \sum_x p(x) \log \frac{p(x)}{q(x)}$$

性质:
- $D \geq 0$.
- $D = 0$ iff $P = Q$.
- 不对称: $D(P||Q) \neq D(Q||P)$.

是**所有 generative model training** (VAE, GAN, language modeling "negative log likelihood" 训练) 损失函数 源 象 源 = minimize $D_{\text{KL}}(\text{model}||data)$.

키 chain:

$$I(X;Y) = D_{\text{KL}}(p(x, y) \| p(x)p(y))$$

---

## 七、Cross-entropy $H(P, Q)$

$$H(P, Q) = -\sum_x p(x) \log q(x)$$

性质: $H(P, Q) = H(P) + D_{\text{KL}}(P || Q)$. 即"我以为是 Q 但实际是 P 的不确定 = 真实熵 + 认知误差".

ML training: minimize $\theta$: $H(P_{\text{data}}, Q_\theta)$.  等价 minimize $D_{\text{KL}}(P_{\text{data}} \| Q_\theta)$ since $H(P_{\text{data}})$ 与 $\theta$ 无关.

---

## 八、Shannon 信源编码定理 (source coding theorem)

**定理**: 任何无损压缩的期望长 ≥ $H(X)$ bits/symbol. 且存在渐近可达 $H(X)$.

例: 给 $X$ = 6 个 outcome 频率 = {0.4, 0.2, 0.15, 0.1, 0.1, 0.05}.

```python
import math
H = -sum(p * math.log2(p) for p in [0.4, 0.2, 0.15, 0.1, 0.1, 0.05])
# H ≈ 2.286 bit/symbol
```

即最优 prefix code 长度 ~2.286 bit/symbol. Huffman (下一章) 取 ~2.30 (integer bit/char); 算术编码到 2.286 (分数 bit).

---

## 九、Differential entropy (logos continuous RV)

Continuou 随机变量 entropy _guide 严 ely differential:

$$h(X) = -\int p(x) \log p(x) dx$$

注意:
- **differential entropy 可负**: 与离散不同. uniform $[a, b]$ 给 $\log(b-a)$. 随 $b-a \to 0$ $\log\to-\infty$.
- 工程用**相对**意义: $D_{\text{KL}}$ 和 $I$ 全 retained identical for continuou.

高斯: $X \sim \mathcal{N}(\mu, \sigma^2)$ → $h(X) = \frac{1}{2}\log(2\pi e \sigma^2)$.

**关键论**: 在方差固定的连续分布中, **高斯分布是** maximize entropy** 的**. This is non-trivial. 证明用 Jensen 不等式.

---

## 十、Maximum Entropy Principle

给定约束 maximally entropic distribution 最不偏:

- 已知 mean + variance: $\mathcal{N}$ normal.
- 已知 mean only $[a, b]$: $\text{Uniform}[a, b]$.
- 已知 mean only $[0, \infty)$: Exponential.
- 已知 mean only in discrete space: Geometric.

工程论 model picking: "maximize entropy given known" ⇔ 乐 ISO科学 model ('doesn''t add bias not 宝 most-site given羁 BIND')

---

## 十一、Bridges

- **complexity.md** / **压缩极限**: 信息熵直接给 minimum 压缩长. H(X) ≤ log|alphabet| = log2 combinatorial 复杂;
- **compression.md next** 给 LZ + Huffman + ANS 走 theorem edges.
- **capacity.md** next: channel capacity 与 mutual information $C = \max_{p(x)} I(X; Y)$.
- **crypto**: weak cryptographic hash output 分析 compression resistance via Max entropy of the uniform distribution of $n$-bit outputs.
- **distributed/clock/dag**: information flow between nodes and within timing 相关 communication network.
- **crypto/hashes.md**: prefers hashes link.

---

下一节 → [信道容量](capacity.md)
