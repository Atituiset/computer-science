# 2. 线性代数: 向量空间 / 矩阵 / 谱 / SVD / 张量

## TL;DR

线性代数是**计算机里所有"高维空间"的总称**——一份 1B 参数权重、一帧图像的像素张量、一次 attention 的 $Q K V$ 矩阵、PageRank 的转移矩阵, 在数学上**完全等价于一组线性变换**. 这一篇覆盖六件工具:

1. **向量空间**: 集合 + 加 + 数乘; 列向量是 $\mathbb{R}^n$ 的元素.
2. **矩阵 = 线性变换**: 乘法、秩、迹、行列式.
3. **特征分解**: $A v = \lambda v$; 不变子空间.
4. **SVD**: 任意 $m \times n$ 矩阵的"正交对角"分解, 几乎是工程 (PageRank / PCA / 推荐系统 / LoRA) 的瑞士军刀.
5. **正定矩阵与范数**: 几何度量 / 内积 / 投影.
6. **张量**: 从向量到矩阵到 3 阶 4 阶; Transformer 里 $\mathrm{softmax}, \text{attention}$ 全是张量收缩.

目标: 看论文里 `$Q K^\top \in \mathbb{R}^{n \times n}$` / `softmax over axis=-1` / `rank-$r$ approximation` 不再绕路查.

---

## 一、向量空间

### 1.1 定义

向量空间 $V$ 在域 $\mathbb{F}$ (默认 $\mathbb{R}$) 上: 元素 $u, v \in V$ 满足加法+数乘封闭, 且遵循 8 条公理 (加法系 Abelian 群 + 数乘结合/分配).

工程直觉: $\mathbb{R}^n$ 是最熟悉的实例; 一张 $28 \times 28$ 图像是 $\mathbb{R}^{784}$ 的一个点; 一个 768 维 embedding 也是.

### 1.2 线性无关 / 维数

- 一组向量 $\{v_1, \ldots, v_k\}$ 线性无关: $\sum c_i v_i = 0 \iff c_i = 0$.
- 极大无关组叫**基**; 基的大小叫**维数** $\dim V$.
- 子空间 $W \subseteq V$: 自身成空间.

### 1.3 四个核心子空间 (任意矩阵)

矩阵 $A \in \mathbb{R}^{m \times n}$ 自动定义四个子空间:

| 子空间 | 维数 | 含义 |
|--------|------|------|
| 列空间 $\mathcal{R}(A) = \operatorname{col}(A) \subseteq \mathbb{R}^m$ | $r = \operatorname{rank} A$ | $A x$ 能取到的所有 $y$ |
| 行空间 $\operatorname{row}(A) \subseteq \mathbb{R}^n$ | $r$ | $A^\top x$ 的取值范围 |
| 零空间 $\mathcal{N}(A) \subseteq \mathbb{R}^n$ | $n - r$ | $Ax = 0$ 的解集 |
| 左零空间 $\mathcal{N}(A^\top) \subseteq \mathbb{R}^m$ | $m - r$ | $A^\top y = 0$ 的解集 |

> [!NOTE]
> 任意 $Ax = b$ 有解 $\Leftrightarrow b \in \mathcal{R}(A)$. 解唯一 $\Leftrightarrow \mathcal{N}(A) = \{0\}$. 这是数据库查询系统解线性约束的根.

### 1.4 内积与范数

内积 $\langle u, v \rangle = \sum u_i v_i = u^\top v$. 诱导范数:

$$ \|u\|_2 = \sqrt{\langle u, u\rangle}, \quad \|u\|_1 = \sum |u_i|, \quad \|u\|_\infty = \max |u_i| $$

- 柯西-施瓦茨: $|\langle u, v\rangle| \leq \|u\|_2 \|v\|_2$.
- 三角不等式: $\|u + v\| \leq \|u\| + \|v\|$.
- 余弦相似度: $\cos \theta = \frac{\langle u, v\rangle}{\|u\| \|v\|}$, 这是 embedding 检索的核心度量.

---

## 二、矩阵与线性变换

### 2.1 矩阵 = 线性变换

矩阵 $A \in \mathbb{R}^{m \times n}$ 表示 $\mathbb{R}^n \to \mathbb{R}^m$ 的线性变换: $x \mapsto A x$.

**叠加性**: $A(u + v) = A u + A v$; $A(c u) = c A(u)$ 一旦满足即线性.

**关键矩阵**:

| 类型 | 形式 | 性质 / 用途 |
|------|------|-------------|
| 单位 $I$ | $\delta_{ij}$ | 任何矩阵的幺元 |
| 对角 $D$ | $d_i \delta_{ij}$ | 缩放; 特征值全在 $d_i$ |
| 对称 $S$ | $A = A^\top$ | 特征值全实, 可正交对角化 |
| 正交 $Q$ | $Q^\top Q = I$ | 旋转/反射, 保范数 |
| 三角 $U, L$ | 上下三角 | LU 分解, 回代求解 |
| 置换 $P$ | 每行恰一 1 | 决定行/列顺序 |
| 投影 $P^2 = P$ | 幂等 | $P^\top = P$ 即正交投影 |

### 2.2 矩阵运算

$$ (AB)^\top = B^\top A^\top, \quad (AB)^{-1} = B^{-1} A^{-1}, \quad \operatorname{tr}(AB) = \operatorname{tr}(BA) $$

$$ \det(AB) = \det(A) \det(B), \quad \det(A^{-1}) = 1/\det(A) $$

**迹性质**: $\operatorname{tr}(A) = \sum_i A_{ii} = \sum \lambda_i$ (任意方阵特征值和).
**行列式**: $\det A = \prod \lambda_i$; 几何意 = 列向量张成平行多面体体积.

### 2.3 秩与可逆

$\operatorname{rank} A$ = 列空间 (行空间) 维数.

- $A$ 可逆 $\Leftrightarrow$ 满秩; $A^\top A$ 正定 $\Leftrightarrow A$ 列满秩.
- **秩-零度定理**: $\operatorname{rank} A + \dim \mathcal{N}(A) = n$.

### 2.4 矩阵分解速查

工程上"求逆/解方程"通常先做分解:

| 分解 | $A = $ | 用途 |
|------|---------|------|
| **LU** | $L U$ (可能加 $P$ 行置换) | 解线性方程, 一次分解多解 |
| **Cholesky** | $L L^\top$ ($A$ 正定) | 比 LU 省一半; ML Hessian |
| **QR** | $Q R$ (正交 × 三角) | 最小二乘, 稳定 |
| **特征分解** | $Q \Lambda Q^{-1}$ ($A$ 对角化) | 当 $A$ 对称易 |
| **SVD** | $U \Sigma V^\top$ | 任意矩阵; **永不动摇** |
| **Schur** | $Q T Q^\top$ (上三角 $T$) | 一般矩阵稳定特征分解 |

```python
import numpy as np
A = np.random.randn(5, 3)
U, s, Vt = np.linalg.svd(A)            # 任意 A 都是 U Σ V^T
print(U.shape, s.shape, Vt.shape)        # (5,5) (3,) (3,3)
# 列空间 = U[:, :3] 张成; 奇异值 = s
# 奇异值越大 → 该方向越"重" → 用于压缩
```

---

## 三、特征值与特征向量

### 3.1 定义

$$ A v = \lambda v \quad (v \neq 0) $$

$\lambda$ 称 $A$ 的特征值, $v$ 对应特征向量. 组合起来 $\{(\lambda_i, v_i)\}$ 即 $A$ 的**谱**.

特征值几何意: 在 $v$ 方向上, $A$ 只缩放 (不改变方向); 矩阵的整体"行为"分布在各方向上的缩放因子.

### 3.2 关键性质

- $A$ 对称 ⇒ 特征值全实 + 特征向量可正交选取.
- $\det A = \prod_i \lambda_i$; $\operatorname{tr} A = \sum_i \lambda_i$.
- $A^k$ 的特征值 = $\lambda_i^k$; 一句话推出 PageRank 一致收敛.
- **谱半径** $\rho(A) = \max |\lambda_i|$; 决定 $A^k$ 是否发散.

### 3.3 谱定理 (实对称矩阵)

对称矩阵 $A$ 永远正交对角化:

$$ A = Q \Lambda Q^\top, \quad Q^\top Q = I, \quad \Lambda = \operatorname{diag}(\lambda_i) $$

**含义**: 对称矩阵只是"沿正交方向独立缩放"。这是 PCA、谱聚类、协方差分析的根; 也解释为什么 `np.cov` 是对称的.

### 3.4 应用: Markov 链 + PageRank

设 $A$ 是行随机矩阵; $\lambda_1 = 1$ 是最大特征值, 对应特征向量是平稳分布. PageRank 即:

$$ r = \alpha S r + (1 - \alpha) \frac{\mathbf{1}}{n} $$

幂迭代 $r_{k+1} = \alpha S r_k + \cdots$ 收敛到唯一平稳分布, 由 Perron-Frobenius 保证.

---

## 四、SVD: 通用瑞士军刀

### 4.1 定理

任意 $A \in \mathbb{R}^{m \times n}$ 可分解为:

$$ A = U \Sigma V^\top, \quad U \in \mathbb{R}^{m \times m}, V \in \mathbb{R}^{n \times n}, \Sigma = \operatorname{diag}(\sigma_1, \ldots, \sigma_{\min(m,n)}) $$

- $U, V$ 正交, $\Sigma$ 唯一对角奇异值 $\sigma_1 \geq \ldots \geq 0$.
- $\sigma_i = \sqrt{\lambda_i(A^\top A)} = \sqrt{\lambda_i(A A^\top)}$.
- $\operatorname{rank} A = $ 非零奇异值个数.

### 4.2 低秩近似 (Eckart-Young)

$$ A_k = \sum_{i=1}^k \sigma_i u_i v_i^\top $$

是所有秩-$k$ 矩阵中最佳 (Frobenius 与 $L_2$ 范数) 近似 $A$.

**应用**:

- **PCA**: 把协方差矩阵做 $A U$ 投影到主分量, 数据压缩 $k \ll n$.
- **LSA**: 搜索引擎把词-文档矩阵 SVD 取 top-$k$ 维.
- **推荐系统** (collaborative filtering 的 baseline): 评分矩阵 SVD.
- **LoRA**: $W = W_0 + B A$, $A, B$ 低秩 → 参数省至 $r \cdot (m + n)$.

### 4.3 数值秩与极大秩近似的工程直觉

奇异值衰减快 ⇒ 矩阵"近似秩"小 ⇒ 可被低秩参数化压缩; 衰减慢 ⇒ 信息等分布在各方向.

→ 这就是 HuggingFace 上 LoRA 试不同 $r$ (通常 8 / 16 / 32) 的根源: $r$ 取多大决定能拟合多少"低秩修正".

---

## 五、正定矩阵与范数

### 5.1 正定矩阵

对称矩阵 $A \succeq 0$: $\forall x \neq 0: x^\top A x \geq 0$.

$A \succ 0$ (正定): $x^\top A x > 0$ 对任意 $x \neq 0$.

**等价条件**: 特征值全正; $A = L L^\top$ (Cholesky 存在); 行列式、主子式全正.

**用途**:

- 协方差矩阵是正定; KL 散度在海森度量下表现.
- 优化: Hessian 正定 ⇒ 局部极小是凸.
- Mahalanobis 距离 $d(x, \mu) = \sqrt{(x - \mu)^\top \Sigma^{-1}(x - \mu)}$ ⇒ 协方差逆度量.

### 5.2 矩阵范数

- **Frobenius**: $\|A\|_F = \sqrt{\sum a_{ij}^2} = \sqrt{\operatorname{tr}(A^\top A)}$.
- **谱范数** (2-范数): $\|A\|_2 = \sigma_{\max}(A)$.
- **1 范数**: 列求和最大.
- **$\infty$ 范数**: 行求和最大.

> [!NOTE]  
> Transformer 自注意力里 $\mathrm{softmax}(Q K^\top / \sqrt{d_k})$, 除以 $\sqrt{d_k}$ 就是控制 $\|Q K^\top\|$ 量级 (注意 $K$ 的列向量范数期望 $\sqrt{d_k}$).

---

## 六、张量: 从 2 阶到 N 阶

### 6.1 定义

张量 (此处指多维数组, 物理学晶格张量定义同源不同语境) 是矩阵的推广:

- 0 阶张量: 标量 $a$.
- 1 阶: 向量 $v \in \mathbb{R}^n$.
- 2 阶: 矩阵 $A \in \mathbb{R}^{m \times n}$.
- 3 阶: $T \in \mathbb{R}^{m \times n \times k}$ — 例如 batch × token × embedding.
- 4 阶: batch × channel × height × width (CNN 卷积核).

**Transformer 维度速查**:

| 张量 | 阶 | 形状典型 |
|------|----|----|
| Token embedding $x$ | 3 | `[B, T, d]` (batch × seq × emb) |
| 权重 $W_Q, W_K, W_V$ | 2 | `[d, d_h]` (head dim) |
| Query $Q = x W_Q$ | 3 | `[B, T, d_h]` |
| Attention scores $Q K^\top$ | 3 | `[B, T, T]` (query × key) |
| After softmax: $\alpha$ | 3 | `[B, T, T]`, 行和=1 |
| Output $\alpha V$ | 3 | `[B, T, d_h]` |

### 6.2 张量收缩 (contraction)

矩阵乘法 $\sum_k A_{ik} B_{kj} = (AB)_{ij}$ 是 2 阶张量沿 $k$ 阶的收缩. 高阶张量收缩 = 在 N 阶任意选定一对轴求和.

**例** (Self-attention 核心):

$$ \mathrm{Att}(Q,K,V) = \mathrm{softmax}\left(\frac{Q K^\top}{\sqrt{d_k}}\right) V $$

- $Q K^\top$: `[B, T, d_h] × [B, d_h, T] → [B, T, T]` (batched matmul).
- softmax 沿 last axis: $[\sum_j e^{s_{ij}} = 1]$.
- 再 $\times V$ → `[B, T, d_h]`.

工程上 PyTorch / JAX 的 `torch.einsum('btd,bhd->bth', X, W)` 就是把任意张量收缩按 Einstein 求和约定写出来.

```python
import torch
# Multi-head self-attention 的核心一步
# X: [B, T, d]; Wq/Wk/Wv: [d, H, d_h]
def attention(X, Wq, Wk, Wv):
    Q = torch.einsum('btd,dhs->bhts', X, Wq)    # [B, H, T, d_h]
    K = torch.einsum('btd,dhs->bhts', X, Wk)
    V = torch.einsum('btd,dhs->bhts', X, Wv)
    scores = Q @ K.transpose(-2, -1) / (Q.shape[-1] ** 0.5)  # [B,H,T,T]
    alpha = scores.softmax(dim=-1)
    return alpha @ V                              # [B, H, T, d_h]
```

```typescript
// 纯 TS 教学版: 单头注意力, 假装 d=64, T=16
function softmaxRows(M: number[][]): number[][] {
  return M.map(row => {
    const m = Math.max(...row);
    const e = row.map(x => Math.exp(x - m));
    const Z = e.reduce((a, b) => a + b, 0);
    return e.map(x => x / Z);
  });
}
function attention(Q: number[][], K: number[][], V: number[][]): number[][] {
  // Q, K, V 皆为 [T, d]
  const d = Q[0].length;
  const T = Q.length;
  const scores: number[][] = Array.from({ length: T }, () => Array(T).fill(0));
  for (let i = 0; i < T; i++)
    for (let j = 0; j < T; j++) {
      let s = 0;
      for (let k = 0; k < d; k++) s += Q[i][k] * K[j][k];
      scores[i][j] = s / Math.sqrt(d);
    }
  const alpha = softmaxRows(scores);          // [T,T], 行和=1
  const out: number[][] = Array.from({ length: T }, () => Array(d).fill(0));
  for (let i = 0; i < T; i++)
    for (let j = 0; j < T; j++) {
      const a = alpha[i][j];
      for (let k = 0; k < d; k++) out[i][k] += a * V[j][k];
    }
  return out;
}
```

### 6.3 广播 (broadcasting)

NumPy / PyTorch 的广播规则:

1. 形状从右往左对齐.
2. 缺轴视为 1; 维度 1 沿该轴复制.
3. 不同维且 >1 ⇒ 报错.

> [!WARNING]
> Transformer 代码里 `W[:, None, :]` 这种加轴操作背后的数学本质就是 reshape; 跟张量阶数 +1 等价, 不影响内容.

---

## 七、四个工程界必备"小公式"

### 7.1 ML / Optimization 反复出现的恒等

$$ \frac{\partial}{\partial X} \mathbf{1}^\top X \boldsymbol{w} = \boldsymbol{w} \boldsymbol{1}^\top $$

$$ \frac{\partial}{\partial W} (X W) = X^\top \cdot (\text{梯度对 } XW) $$

记忆法: "**梯度比原式少一个 W 的轴, 求导后留下 X 转置**". 这是反向传播 (§4 微积分) 的本质.

### 7.2 矩阵微分三件套

```text
forward                          backward (相同链路反向)
X -> XW -> P = softmax(XW)  -> loss   P - y   (对 score 的梯度)
                               ^^^
 W 的梯度 = X^T @ (P - y)        (链式法则的"收缩")
```

### 7.3 列 / 行视图相同

$Ax = b$ 可视为:

- **列视图**: $b$ 是 A 列的线性组合, 权重 = $x$ 的对应元素.
- **行视图**: 每行是一个超平面方程, 解 = 所有超平面交点.

→ 在 ML 里 **列视图** 是特征聚合, **行视图** 是样本边界判别. 这是 SVM 与 PCA 的对偶视角.

### 7.4 投影

正交投影到列空间 $\mathcal{R}(A)$ 的矩阵:

$$ P_A = A (A^\top A)^{-1} A^\top $$

最小二乘解 $x = (A^\top A)^{-1} A^\top y$ 给出"投影后的坐标".

> [!NOTE]
> 数据库代价估计 / ML 线性回归 / 任何拟合直线的最小二乘都用这个公式. 它是 §4 微积分篇推导"梯度下降等价于迭代投影"的入口.

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **矩阵 = 线性变换**: $\det A = \prod \lambda_i$, $\operatorname{tr} A = \sum \lambda_i$.
> - **秩-零度**: $\operatorname{rank} A + \dim \mathcal{N}(A) = n$.
> - **正定**: ⇔ 对称 + 特征值全正 ⇔ $A = L L^\top$.
> - **谱范数** $\|A\|_2 = \sigma_{\max}(A)$; Frobenius $\|A\|_F = \sqrt{\operatorname{tr}(A^\top A)}$.
> - **SVD**: 永远存在, $A = U \Sigma V^\top$; Top-k 奇异值是最佳 low-rank 近似.
> - **Cauchy-Schwarz**: $|\langle u, v\rangle| \leq \|u\| \|v\|$.
> - **正交投影**: $P = A(A^\top A)^{-1} A^\top$.
> - **张量总收缩**: $\sum$ along 对应轴, softmax 维 -1 在最后一轴归一.

---

下一篇: [3. 概率统计: 分布 / 贝叶斯 / MLE / MAP / 极限 / KL](prob.md).
