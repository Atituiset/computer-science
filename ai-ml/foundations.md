# 1. Foundations: 线性回归 → 逻辑回归 → MLP → 损失函数谱 → 泛化与正则

## TL;DR

机器学习的入口几乎都是**最小二乘线性回归**的某种变体: 从把输出层加个 sigmoid 就成二分类, 把单层 perceptron 堆成多层 → 多层感知机 (MLP), 把损失从 MSE 换成 CE / contrastive / ELBO 就成各种生成模型. 这一章把这个家族谱铺好:

1. **线性回归** — 最小二乘的闭式解; 几何 = 投影; 概率 = Gaussian MLE.
2. **逻辑回归** — sigmoid + 交叉熵 = Bernoulli MLE; 凸.
3. **MLP** — 加一层非线性就够表达任意函数; 迭代优化替代闭式解.
4. **损失函数谱** — 回归 / 分类 / 排序 / 对比 / 生成 各家损失都是 MLE 的不同形式.
5. **泛化与正则** — 经验风险 vs 真实风险, 偏差-方差, L1/L2/dropout.

读完应能: 给一个任务 (分类 / 回归 / 排序 / 生成) 立刻报出对应的输出激活、损失家族、对应概率假设, 并知道该不该上正则、上哪种.

---

## 一、线性回归: 一切的起点

### 1.1 问题与最小二乘

给定训练集 $\{(x_i, y_i)\}_{i=1}^n$, $x_i \in \mathbb{R}^d, y_i \in \mathbb{R}$. 模型 $\hat y_i = \boldsymbol \beta^\top x_i$. 损失为残差平方和:

$$ \mathcal{L}(\boldsymbol \beta) = \sum_i (y_i - \boldsymbol\beta^\top x_i)^2 = \|\boldsymbol y - X \boldsymbol\beta\|_2^2 $$

其中 $X \in \mathbb{R}^{n \times d}$ 行为样本. 令梯度为 0:

$$ \nabla_\beta \mathcal{L} = -2 X^\top (\boldsymbol y - X \boldsymbol\beta) \overset{!}{=} 0 \;\Rightarrow\; X^\top X \,\boldsymbol\beta = X^\top \boldsymbol y $$

**正则方程**: $\boldsymbol\beta^* = (X^\top X)^{-1} X^\top \boldsymbol y$ (列满秩时).

```python
import numpy as np

def ols(X, y):
    # 闭式最小二乘 (注意数值稳定性: 推荐 lstsq 而不是直接求逆)
    return np.linalg.lstsq(X, y, rcond=None)[0]

# 等价的几何视角: 残差正交于 X 的列空间
X = np.random.randn(100, 3); beta_true = np.array([1.0, -2.0, 0.5])
y = X @ beta_true + 0.1 * np.random.randn(100)
beta_hat = ols(X, y)
residual = y - X @ beta_hat
assert np.allclose(X.T @ residual, 0, atol=1e-10)  # 残差 ⊥ 列空间
```

### 1.2 三种等价视角

| 视角 | 内容 |
|------|------|
| **几何** | $\hat{\boldsymbol y} = X \boldsymbol\beta^* = P_X \boldsymbol y$, $P_X = X(X^\top X)^{-1}X^\top$ 是列空间正交投影; 残差 $\perp$ 列空间 |
| **概率 (MLE)** | 假设 $y_i = \boldsymbol\beta^\top x_i + \epsilon_i$, $\epsilon_i \sim \mathcal{N}(0, \sigma^2)$. 似然 $\prod \mathcal{N}(y_i; \boldsymbol\beta^\top x_i, \sigma^2)$; 取 log 最大化 ⇔ 最小化残差平方和 |
| **贝叶斯** | 加先验 $\boldsymbol\beta \sim \mathcal{N}(0, \tau^2 I)$ ⇒ MAP = ridge 回归 $\arg\min \|\boldsymbol y - X\boldsymbol\beta\|^2 + \frac{\sigma^2}{\tau^2}\|\boldsymbol\beta\|^2$ |

> [!NOTE]
> "为什么不直接 $X^{-1} y$?" 因为 $X$ 几乎从不是方阵; $X^\top X$ 在列满秩时才是 $d \times d$ 可逆. 这条公式把"$n \neq d$"的方程组变成正则方程, 也是投影矩阵的根基. 回顾线代 §1.3 四个子空间: 残差必须落在 $X$ 的**左零空间**中.

### 1.3 概率视角的延伸

如果残差不服从 Gaussian 而服从 Laplace $\frac{1}{2b}\exp(-|e|/b)$, MLE 推出的是**绝对值损失** (LAD):

$$ \mathcal{L}_{\text{LAD}}(\boldsymbol\beta) = \sum_i |y_i - \boldsymbol\beta^\top x_i| $$

这就是"为什么 LAD 比 OLS 鲁棒": Laplace 先验有更长尾, 拟合时不太被异常点拉走.

| 残差分布 | MLE 损失 | 鲁棒性 |
|---------|----------|--------|
| $\mathcal{N}(0, \sigma^2)$ | 平方 $\|\cdot\|^2$ | 对离群敏感 |
| Laplace | 绝对 $|\cdot|$ | 鲁棒 |
| 混合 (Huber) | $\rho_c(r) = \begin{cases} \frac12 r^2, & |r|\leq c \\ c|r| - \frac12 c^2, & |r| > c\end{cases}$ | 平衡 |

### 1.4 正则化: ridge / lasso / elastic net

加先验等价正则:

- **Ridge** ($L_2$): $\mathcal{L} = \|y - X\boldsymbol\beta\|^2 + \lambda \|\boldsymbol\beta\|_2^2$ ⇒ Gaussian 先验; 解 $\boldsymbol\beta^* = (X^\top X + \lambda I)^{-1} X^\top y$ 永远存在 (即使 $X^\top X$ 奇异).
- **LASSO** ($L_1$): $\mathcal{L} = \|y - X\boldsymbol\beta\|^2 + \lambda \|\boldsymbol\beta\|_1$ ⇒ Laplacian 先验; 产生稀疏解 (许多 $\beta_i = 0$).
- **Elastic net**: $L_2 + L_1$ 加权混合, 高度相关特征群组选择.

> [!TIP]
> $L_1$ 比 $L_2$ 更稀疏的几何直觉: 在等高线接触约束区域时, $L_1$ 球的"尖角" (坐标轴) 比光滑 $L_2$ 球更易触到. 严格的凸优化解读见第零部分 §4.2 凸函数与 KKT.

---

## 二、逻辑回归: 从回归到分类

### 2.1 二分类的 MLE

设 $\Pr(y=1 | x) = \sigma(\boldsymbol\beta^\top x)$, $\sigma(a) = \frac{1}{1+e^{-a}}$. 数据似然:

$$ \prod_i \sigma(\boldsymbol\beta^\top x_i)^{y_i} (1 - \sigma(\boldsymbol\beta^\top x_i))^{1-y_i} $$

取 $-\log$ 得**二元交叉熵**:

$$ \mathcal{L}_{\text{logistic}}(\boldsymbol\beta) = -\sum_i \big[ y_i \log \hat p_i + (1 - y_i) \log(1 - \hat p_i) \big], \quad \hat p_i = \sigma(\boldsymbol\beta^\top x_i) $$

### 2.2 关键性质

- $\sigma'(a) = \sigma(a)(1 - \sigma(a))$ → 反向传播极简: $\partial \mathcal{L}/\partial a_i = \hat p_i - y_i$.
- 凸函数 (Hessian 半正定), 但**非强凸** (当数据完全可分时 $\|\boldsymbol\beta\| \to \infty$ 收敛), 这时需要正则.
- 极大熵角度: 在 $\mathbb{E}[y | x] = \sigma(\boldsymbol\beta^\top x)$ 约束下, Bernoulli 极大熵分布 = logistic; 见第零部分 §4.7.

### 2.3 多分类: softmax + 交叉熵

$K$ 类: $\Pr(y = k | x) = \mathrm{softmax}(W^\top x)_k = \frac{e^{w_k^\top x}}{\sum_l e^{w_l^\top x}}$.

$$ \mathcal{L}_{\text{CE}}(W) = -\sum_i \log \frac{e^{w_{y_i}^\top x_i}}{\sum_l e^{w_l^\top x_i}} $$

反向梯度 (回顾第零部分 §2.3 softmax 雅可比): $\partial \mathcal{L} / \partial a_l = \mathrm{softmax}(a)_l - \mathbb{1}[y = l]$. 一行公式就是 logistic 二元版, 也是 Transformer LM head 的损失.

### 2.4 multinomial 与共轭先验

- 似然 multinomial + 共轭先验 Dirichlet ⇒ 后验仍是 Dirichlet. 这就是 LDA 主题模型与 transformer 词频建模的根基. 见第零部分概率 §4.4 共轭先验速查.

---

## 三、MLP: 单层到多层

### 3.1 XOR 问题: 单层 perceptron 学不动

| $x_1$ | $x_2$ | $y$ |
|------|------|----|
| 0 | 0 | 0 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

直线 $\boldsymbol\beta^\top x + b = 0$ 无法分对角点; 1969 Minsky-Papert 一书指出, 推动感知机第一次寒冬.

### 3.2 多层感知机 (MLP)

两层 + 非线性激活:

$$ f(x) = W_2 \,\sigma(W_1 x + \boldsymbol b_1) + \boldsymbol b_2 $$

- $W_1 \in \mathbb{R}^{h \times d}$, $\sigma$ 逐元素非线性, $W_2 \in \mathbb{R}^{k \times h}$.
- $h$ 充分大 ⇒ 万能近似器 (Cybenko 1989 for sigmoid, Hornik 1991 一般化).
- 但**训练需要反向传播**, 这是下一章主题.

### 3.3 激活函数谱

| 激活 | 公式 | 反传导数 | 特点 |
|------|------|---------|------|
| **Sigmoid** | $\frac{1}{1+e^{-x}}$ | $\sigma(1-\sigma)$ | 输出 [0,1]; 饱和时梯度消失, 早期流行, 现主要用作门 / 输出 |
| **Tanh** | $\tanh x$ | $1 - \tanh^2 x$ | 输出 [-1, 1]; 仍饱和, RNN 经典 |
| **ReLU** (2010 Nair-Hinton) | $\max(0, x)$ | $\mathbb{1}_{x > 0}$ | 不饱和, 计算快; 但负输入"死神经元" |
| **Leaky ReLU / PReLU** | $\max(\alpha x, x)$ | $\alpha$ or $1$ | 防 dead neuron |
| **GELU** (2016) | $x \cdot \Phi(x)$ | $\Phi(x) + x \phi(x)$ | Transformer 默认; 平滑近 ReLU |
| **SwiGLU** (2022) | $\mathrm{SwiGLU}(a, b) = \mathrm{Swish}(a) \odot b$ | — | LLaMA / PaLM 用, FFN 替代品 |
| **SiLU / Swish** | $x \sigma(x)$ | $\sigma(x)(1 + x(1 - \sigma(x)))$ | 自门控; 在深处稳定 |

> [!WARNING]
> 为什么不用 $\sigma$ / $\tanh$ 当 MLP 的激活, 但 Transformer 输出层却常用 $\sigma$ / $\softmax$?
> 激活层堆多了梯度会消失 (反向连乘 $\sigma'(a_i) \leq 0.25$); 输出层只有一层, 且需要可解释的概率, 故保留 sigmoid/softmax. 内部一律用 ReLU/GELU/SwiGLU 防止 vanishing gradient.

### 3.4 逼近定理的工程含义

通用近似定理只是"存在性", 不教你"怎么找到那个权重". 深网比浅网**指数级更省参数**表达某些函数 (Telgarsky 2016): 把 $\mathcal{O}(2^k)$ 个 oscillation 拟合, 深度 $k$ 网用 $\mathcal{O}(k)$ 个参数, 浅网用 $\mathcal{O}(2^k)$. → "为什么深而不是宽"的数学根.

---

## 四、损失函数谱: 一张总表

绝大多数损失都是"输出激活 + 类似然负对数"的二元组合:

| 任务 | 输出激活 | 损失 | 概率假设 | 备注 |
|------|----------|------|---------|------|
| 回归 | identity | MSE $\|y - \hat y\|^2$ | Gaussian | 工程默认 |
| 鲁棒回归 | identity | Huber / L1 | Laplace / Huber | 异常值 |
| 二分类 | sigmoid | BCE $-[y\log\hat p + (1-y)\log(1-\hat p)]$ | Bernoulli | LR / 二元分类 |
| 多分类 | softmax | CE $-\log\hat p_y$ | Multinomial | NLP / 图像分类 |
| 多标签 | sigmoid 每维 | BCE sum | 多 Bernoulli | 标签独立 |
| 排序 | (隐) pairwise | BPR / hinge / LambdaRank | 各种 | 推荐 / 检索 |
| 对比学习 | L2 norm + 内积 | InfoNCE $-\log\frac{e^{s^+/\tau}}{\sum e^{s_i/\tau}}$ | softmax over negatives | SimCLR / CLIP |
| 生成 (AR) | softmax | next-token CE | Multinomial 自回归 | GPT 系列 |
| 生成 (VAE) | decoder 输出 + reparam. | $-\mathbb{E}_q[\log p(x\|z)] + \mathrm{KL}(q\|p)$ | ELBO 最大化 | 见 §5 |
| 生成 (diffusion) | 预测噪声 $\epsilon$ | $\|\epsilon - \epsilon_\theta(x_t, t)\|^2$ | Gaussian ELBO 简化 | 见 §5 |

> [!NOTE]
> 所有这些损失都是**MLE 在不同假设上的负对数似然**. 训练 = 最小化 NLL = 最大化数据似然. 第零部分概率 §5 框架解释了为什么.

### 4.1 对比损失详解 (SimCLR / CLIP)

$$ \mathcal{L} = -\log \frac{\exp(\mathrm{sim}(z_i, z_i^+)/\tau)}{\sum_{j} \exp(\mathrm{sim}(z_i, z_j)/\tau)} $$

其中 $z_i^+$ 是 anchor 正样本, $z_j$ 是 batch 内其它 (负) 样本, $\mathrm{sim} = \cos$. 这本质就是 softmax+CE, "类" = "正样本对 vs 负样本对".

→ 一行话打通 representation learning & classification.

### 4.2 排序损失: BPR 与 LambdaRank

**BPR** (Bayesian Personalized Ranking): 给正样本 $i$ 与负样本 $j$, 模型打分 $s_u(i), s_u(j)$, 损失

$$ \mathcal{L}_{\text{BPR}} = -\log \sigma(s_u(i) - s_u(j)) $$

→ 让正样本打分恒高于负样本.

**LambdaRank** 进一步在梯度上乘 $\Delta \text{NDCG}$ 让"高位置错位惩罚更重", 工业推荐系统标准.

---

## 五、泛化与正则

### 5.1 经验风险 vs 真实风险

设训练集 $\mathcal{D} = \{(x_i, y_i)\}_{i=1}^n$ 来自分布 $\mathcal{P}$. 经验风险 $\hat R(\theta) = \frac{1}{n}\sum \ell(f_\theta(x_i), y_i)$, 真实风险 $R(\theta) = \mathbb{E}_{(x,y)\sim\mathcal{P}}[\ell(f_\theta(x), y)]$.

学习目标是最小化 $R$, 但只能观测 $\hat R$. **泛化 gap** $|R - \hat R|$ 由 Hoeffding + Rademacher complexity 控制 (回顾第零部分概率 §6.3):

$$ R(\theta) \leq \hat R(\theta) + \mathcal{O}\left(\sqrt{\frac{\mathrm{complexity}}{n}}\right) $$

> [!NOTE]
> 这一条解释了: 模型复杂度太高 / 训练数据太少 → 估计 gap 大 → train loss 低但 test loss 高 = **过拟合**. 实践手段: 增数据 / 降复杂度 / 加正则 / dropout / 早停.

### 5.2 偏差-方差分解

平方损失下:

$$ \mathbb{E}[(y - \hat f(x))^2] = \underbrace{(\mathbb{E}[\hat f] - f)^2}_{\text{偏差}^2} + \underbrace{\operatorname{Var}(\hat f)}_{\text{方差}} + \underbrace{\sigma^2}_{\text{噪声}} $$

- 模型太弱 → 高偏差 (欠拟合).
- 模型太强 + 数据少 → 高方差 (过拟合).
- 同一容量下 ensemble (随机森林 / dropout) 减方差而不增偏差 → **为什么 ensemble 与 dropout 有效**的根源.

### 5.3 正则手段总表

| 手段 | 形式 | 数学依据 |
|------|------|----------|
| $L_2$ weight decay | $\lambda \|\theta\|_2^2$ 加在 loss | Gaussian 先验 (MAP = ridge) |
| $L_1$ | $\lambda \|\theta\|_1$ | Laplacian 先验; 稀疏 |
| **Early stopping** | 训到 val loss 上升就停 | 等价 implicit $L_2$ 正则 (Sjöberg 1995) |
| **Dropout** (2014 Srivastava) | 训练时随机零化 $p$ 比例神经元 | 等价 ensemble over 子网络; 防共适应 |
| **Batch Norm** (2015 Ioffe) | 每层激活按 batch 归一化 | 减小 internal covariate shift + 隐式正则 |
| **Layer Norm** (2016 Ba) | 沿特征维归一化 | Transformer 默认, batch 无关 |
| **Data augmentation** | 变换扩样 | 等价 inject 先验 ("图像可平移翻转") |
| **Label smoothing** | one-hot 改 $1-\epsilon$ / 各 $\epsilon/(K-1)$ | 防过度自信; 改善 calibration |
| **Weight averaging** (SWA, EMA) | 训后/训中平均权重 | 减方差 |
| **Distillation** (Hinton 2015) | soft target 来自 teacher | 集成思想 + 隐式标签平滑 |

### 5.4 双下降 (double descent, Belkin 2019)

经典偏差-方差 U 形是单一峰; 实际深度学习在过参数化时, "test 风险继续下降":

```
risk
  ↑
  │  ╲              ╱── over-parameterized → ↓
  │   ╲            ╱
  │    ╲      interp╱
  │     ╲     ●   ╱
  │      ╲   ╱│╲ ╱
  │       ╲ ╱ │ ╳
  │        ●  │ ╳──   (second descent)
  │            │
  └─────────────→ model capacity
   underfit  interp  over-param
```

数学解释: 当参数 $N \gg$ 样本 $n$ 时, 训练误差可达 0, 但在"最小 $L_2$ 范数解"附近的 implicit bias 让泛化仍良. 现代大模型在 right side of interp 训练.

> [!TIP]
> "Double descent" 解释了: 为什么 GPT-3 175B 不能用经典 U-shape 偏差方差解释, 但训练后实际很泛化. 大模型这件事不是真理错误, 而是用错了上界.

### 5.5 PAC 学习一瞥

Probably Approximately Correct (Valiant 1984): 一类 $\mathcal{H}$ PAC-可学 iff 存在算法 $A$, 多项式样本与时间, 以 $\geq 1 - \delta$ 概率输出 $h \in \mathcal{H}$ 使 $R(h) \leq \epsilon + \min_h R(h)$, 任给 $\epsilon, \delta$.

→ 把"学得动与否"形式化: 它不是"能否拟合", 而是"用什么样本复杂度能可证泛化".

复杂度上限样本数 (回 Hoeffding 第零部分 §6.3): $n \geq \frac{1}{2\epsilon^2}\log(2|\mathcal{H}|/\delta)$.

→ 直觉给了"快速高方差模型训练"应该重看 validation 的依据.

---

## 六、最小可跑的回归 + 分类 pipeline (NumPy only)

```python
import numpy as np

def sigmoid(z):
    return 1 / (1 + np.exp(-z))

def logreg_train(X, y, lr=0.1, epochs=500):
    n, d = X.shape
    W = np.zeros(d); b = 0.0
    for _ in range(epochs):
        p = sigmoid(X @ W + b)
        grad_W = X.T @ (p - y) / n   # 解析梯度: σ - y
        grad_b = (p - y).mean()
        W -= lr * grad_W; b -= lr * grad_b
    return W, b

def logreg_predict(X, W, b):
    return (sigmoid(X @ W + b) > 0.5).astype(int)

if __name__ == "__main__":
    from sklearn.datasets import make_moons
    X, y = make_moons(200, noise=0.1, random_state=0)
    W, b = logreg_train(X, y)
    acc = (logreg_predict(X, W, b) == y).mean()
    print(f"acc = {acc:.3f}")   # moons 非线性可分, 线性逻辑回归只能到 ~0.83
    # 升到 MLP + tanh 就能拟合月牙
```

```typescript
// 浏览器/Node 上的 toy logistic regression
export function sigmoid(z: number): number { return 1 / (1 + Math.exp(-z)); }

export function logregTrain(
  X: number[][], y: number[],
  lr = 0.1, epochs = 500,
): { W: number[]; b: number } {
  const n = X.length, d = X[0].length;
  const W = new Array(d).fill(0); let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gW = new Array(d).fill(0); let gb = 0;
    for (let i = 0; i < n; i++) {
      let s = b; for (let k = 0; k < d; k++) s += X[i][k] * W[k];
      const p = sigmoid(s); const r = p - y[i]; gb += r;
      for (let k = 0; k < d; k++) gW[k] += X[i][k] * r;
    }
    for (let k = 0; k < d; k++) W[k] -= lr * gW[k] / n;
    b -= lr * gb / n;
  }
  return { W, b };
}
```

---

## 七、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **线性回归**: $\beta^* = (X^\top X)^{-1} X^\top y$; 几何 = 投影; 概率 = Gaussian MLE.
> - **加 Gaussian 先验** → ridge; **Laplacian** → LASSO.
> - **逻辑回归**: $\hat p = \sigma(\beta^\top x)$; 损失 BCE; 反向梯度 $\hat p - y$.
> - **多类 softmax + CE**: 反向梯度 $s - \text{onehot}(y)$.
> - **MLP**: $W_2 \sigma(W_1 x + b_1) + b_2$; 万能近似 (但需训), 深比宽省参.
> - **激活**: 内部用 ReLU/GELU/SwiGLU (防饱和), 输出用 sigmoid/softmax (要概率).
> - **损失即 NLL**: 回归 MSE=Gaussian, 二元 BCE=Bernoulli, 多类 CE=Multinomial, 对比 NCE=softmax-negative, 生成 ELBO/扩散 noise-pred 都是.
> - **正则**: $L_2$ (ridge, 防过拟合, 平滑), $L_1$ (LASSO, 稀疏), Dropout (隐 ensemble), early stopping (隐 $L_2$), batch/layer norm (稳 + 隐正则).
> - **泛化**: $R \leq \hat R + \sqrt{\text{complexity}/n}$; double descent 解释过参模型仍泛化.
> - **PAC**: 多项式样本可证 $\epsilon$-optimal = "可学".

---

下一篇: [2. Backpropagation: 计算图 / 反向模式 AD / 雅可比链式 / 梯度检查](backprop.md).
