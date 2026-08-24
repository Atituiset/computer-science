# 4. 微积分与最优化: 链式法则 / 雅可比 / Hessian / 凸优化 / 信息几何

## TL;DR

优化是计算机科学里"反向"的一面: 用前向 (compiles 哪些到哪些) 算"loss", 再用反向 (链式法则) 算"该怎么改参数让 loss 更小". Transformer、信息论容量推导、调度器最短作业先选、HP 计算代价模型本质都是同一件事: **在光滑空间里取梯度**. 这一篇覆盖:

1. **极限与导数** — 微分与差分的连续 / 离散切换.
2. **链式法则 + 多元函数 + 雅可比矩阵** — Transformer 反向传播的硬公式.
3. **Hessian + 泰勒展开 + 二阶方法** — 极值附近的曲率信号.
4. **凸函数 / 凸优化** — 优化领域的"快 + 全局最优"区间.
5. **梯度下降 / Stochastic / Momentum / Adam** — 工业优化器谱系.
6. **拉格朗日 + KKT** — 带约束优化的标准框架.
7. **信息几何** — 用 KL / Fisher 度量把"分布空间"做成流形, 推出自然梯度与变分推断.

目标: 看到 `Adam`、`EM`、`$\nabla_\phi \mathbb{E}[\ldots]$`、`$\Lambda \succeq 0$` 不再卡.

---

## 一、极限、连续、可导

### 1.1 极限

$\lim_{x \to a} f(x) = L$ 表任意 $\epsilon > 0$, 存在 $\delta$ 使 $0 < |x-a| < \delta \Rightarrow |f(x) - L| < \epsilon$ (Cauchy-Weierstrass 定义).

工程上**渐近等价**记号 $f(x) \sim g(x)$: $\lim_{x \to \infty} f/g = 1$. 与 DSA 中 $O/\Theta/\Omega$ 同根.
例如 $n! \sim \sqrt{2\pi n} (n/e)^n$ (Stling 公式) 是计算组合数 log 的钥匙.

### 1.2 导数

$$ f'(x) = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h} $$

几何含义: 切线斜率. 物理含义: 瞬时速率.

**关键四件**:

- 链式: $(g \circ f)' = g'(f(x)) \cdot f'(x)$.
- 乘法: $(fg)' = f'g + fg'$.
- 商: $(f/g)' = (f'g - fg')/g^2$.
- 反函数: $(f^{-1})'(y) = 1/f'(x)$ where $y = f(x)$.

> [!NOTE]
> 自适应学习率优化 (Adam, RMSprop) 本质是用 $f' / \sqrt{\mathbb{E}[f'^2] + \epsilon}$ 而不是 $f'$ 是因为第二个额度依赖反函数的梯度的"曲率方向", 详见 §4-5.
> 自适应瞬间看, 这是 Newton 法用 $H^{-1} g$ 的近似, 用反方向升级.

### 1.3 几个重要函数的导数

| $f$ | $f'$ |
|-----|------|
| $x^n$ | $n x^{n-1}$ |
| $e^x$ | $e^x$ |
| $\ln x$ | $1/x$ |
| $\sin x$ | $\cos x$ |
| $\cos x$ | $-\sin x$ |
| $\sigma(x) = \frac{1}{1+e^{-x}}$ | $\sigma(1 - \sigma)$ |
| $\tanh x$ | $1 - \tanh^2 x$ |
| $\mathrm{ReLU}(x)$ | $\mathbb{1}_{x > 0}$ (在 0 处不可导; 工程上常设 0) |
| $\mathrm{softmax}_i(\boldsymbol x)$ | $\sigma_i(1 - \sigma_i)$ (对 $x_i$), $-\sigma_i \sigma_j$ (对 $x_j$) |

**softmax 雅可比尤其重要**, 见 §2.

### 1.4 积分

$$ \int_a^b f(x)\, dx = \lim_{n \to \infty} \sum_{i=0}^{n-1} f\left(a + i \frac{b-a}{n}\right) \cdot \frac{b-a}{n} $$

微积分基本定理:

$$ \int_a^b f(x)\, dx = F(b) - F(a), \quad F' = f $$

- **分部积分**: $\int u\, dv = uv - \int v\, du$.
- **换元**: $\int f(g(x)) g'(x) dx = \int f(u)\, du$.
- 概率积分 $\int e^{-x^2} dx$ 全空间 = $\sqrt{\pi}$, 这是 Gaussian 归一化常数.

---

## 二、多元与链式法则 (Transformer 必备)

### 2.1 偏导数与方向导数

$f: \mathbb{R}^n \to \mathbb{R}$ 的偏导 $\partial f / \partial x_i$. 梯度:

$$ \nabla f(\boldsymbol x) = \left(\frac{\partial f}{\partial x_1}, \ldots, \frac{\partial f}{\partial x_n}\right)^\top $$

方向 $\boldsymbol v$ 上的方向导数 = $\nabla f \cdot \boldsymbol v / \|\boldsymbol v\|$; 沿梯度方向取最大. 即"梯度下降合理性"的数学.

### 2.2 复合与雅可比

设 $g: \mathbb{R}^n \to \mathbb{R}^m$, $f: \mathbb{R}^m \to \mathbb{R}$. 复合 $h = f \circ g: \mathbb{R}^n \to \mathbb{R}$:

$$ \frac{\partial h}{\partial \boldsymbol x} = \underbrace{\nabla f(g(\boldsymbol x))^\top}_{1 \times m} \cdot \underbrace{J_g(\boldsymbol x)}_{m \times n} $$

$J_g$ 即雅可比矩阵, $[J_g]_{ij} = \partial g_i / \partial x_j$.

**Transformer 反向传播就是矩阵化 + 反序的链式法则**: 每一层的"loss 对输入梯度"= 该层输出梯度乘该层权重梯度.

### 2.3 softmax 雅可比

$\boldsymbol s = \mathrm{softmax}(\boldsymbol z)$:

$$ \frac{\partial s_i}{\partial z_j} = \begin{cases} s_i (1 - s_i) & i = j \\ -s_i s_j & i \neq j \end{cases} $$

向量形式 $J_{\mathrm{softmax}} = \mathrm{diag}(s) - s s^\top$.

工程意义: 反向传 $(\boldsymbol{ds}) = J \cdot \boldsymbol{dz}$ 即 $\boldsymbol{ds} = s \odot (\boldsymbol{dz} - (s^\top \boldsymbol{dz})\mathbf{1})$.

### 2.4 反向传播 (autograd 模式)

```python
import numpy as np
# 简化的两层数值梯度校验
def softmax_ce(logits, y):
    z = logits - logits.max(axis=-1, keepdims=True)
    e = np.exp(z); s = e / e.sum(axis=-1, keepdims=True)
    return -np.log(s[y] + 1e-12)

def grad_softmax_ce(logits, y):
    s = np.exp(logits - logits.max()) / np.exp(logits - logits.max()).sum()
    g = s.copy(); g[y] -= 1
    return g    # 简化: 对 logit 的导数 = (σ - onehot)
```

**关键观察**: 交叉熵 + softmax 的反传结果是 $(s - \mathbf{1}_y)$, 这条公式出现在每个 softmax 分类器里. 记下来一辈子省试错.

### 2.5 数值方法: 自动求导

- 前向模式 AD: 一个变量求偏导链, O(n) 算一个分量.
- 反向模式 AD: 一次反向跑出所有偏导, O(1) 算 loss 对所有参数 (gradient). 这就是 PyTorch 默认反向 (TensorFlow `tf.GradientTape`).

> [!TIP]
> 反向 AD 是 1970 Linnainmaa 发现 + 1986 Rumelhart-Hinton-Williams popularized. 现代 DL 能训参数 $10^{11}$ 都是它的功劳. 写"反向传播"不是推每个 dot; 而是按计算图节点按拓扑逆序局部求导.

---

## 三、Hessian 与二阶

### 3.1 二阶偏导

$$ H_f(\boldsymbol x)_{ij} = \frac{\partial^2 f}{\partial x_i \partial x_j} $$

$H$ 是对称矩阵 (若 $f$ 充分光滑). 在 stationary $\nabla f = 0$ 处:

- $H \succ 0$ ⇒ 局部最小.
- $H \prec 0$ ⇒ 局部最大.
- 不定 ⇒ 鞍点.
- 半正定/半负定 ⇒ 二阶检验不足, 需高阶.

### 3.2 泰勒展开 (2D 局部)

$$ f(\boldsymbol x + \boldsymbol h) \approx f(\boldsymbol x) + \nabla f(\boldsymbol x)^\top \boldsymbol h + \frac{1}{2} \boldsymbol h^\top H_f(\boldsymbol x) \boldsymbol h $$

**含义**: 沿一阶方向线性近似; 二阶项表达曲率. 这就是 Newton 法、Trust-region、CG、BFGS 的全部来源.

### 3.3 Newton 迭代

$$ \boldsymbol x_{k+1} = \boldsymbol x_k - H_f^{-1}(\boldsymbol x_k) \nabla f(\boldsymbol x_k) $$

**优点**: 二次收玫 (近最优时极快). **缺点**: 求 $(n \times n) H^{-1}$ 太贵, $H$ 可能 ill-conditioned. 工程变体:

- 拟牛顿 BFGS / L-BFGS: 用历史梯度更新 $H^{-1}$ 近似.
- 共轭梯度 CG: 只需 $H$ × 向量乘法.

### 3.4 为什么深度学习不用 Newton?

- 参数维度 $n \sim 10^9$, $H \in \mathbb{R}^{10^9 \times 10^9}$ 显然太贵.
- 非凸+随机性 ⇒ 一阶 SGD 经验反而更好+可 scale.
- 反向传播比求逆便宜太多.

→ 这就是 Adam 之类一阶方法的现实位置.

---

## 四、凸优化

### 4.1 凸函数

凸集 $S \subseteq \mathbb{R}^n$: $\forall \boldsymbol x, \boldsymbol y \in S, \lambda \in [0, 1]$: $\lambda \boldsymbol x + (1-\lambda) \boldsymbol y \in S$.

凸函数 $f: S \to \mathbb{R}$:

$$ f(\lambda \boldsymbol x + (1-\lambda)\boldsymbol y) \leq \lambda f(\boldsymbol x) + (1-\lambda)f(\boldsymbol y) $$

判定: 一阶 (凸) $\nabla^2 f \succeq 0$.

**凸优化强**:

- 任何局部最小 = 全局最小.
- KKT 条件充要 (约束情形).
- 多项式时间可达 $\epsilon$-optimal (Interior Point).

> [!NOTE]
> 即使损失非凸, 工程上常见"局部凸": 在 good init 周围 Hessian 半正定, Newton / GD 仍可以收敛到本地区的最优. 这是 NTM、LoRA fine-tune 的"为什么调一调就 OK".

### 4.2 典型凸损失

| 损失 | 形式 | 类 |
|------|------|-----|
| **平方** $(y - \hat y)^2$ | 强凸 | Gauss 似然 + 方差常量 |
| **绝对** $|y - \hat y|$ | 凸但非光滑 | Laplace 似然, 鲁棒回归 |
| **Huber** | 平方绝对拼接 | robust to outliers |
| **Logistic** $\log(1 + e^{-y\hat y})$ | 凸、光滑 | 二项式 MLE |
| **Softmax CE** | 凸 (在权重) | 多项式 MLE |
| **Hinge** $\max(0, 1-y\hat y)$ | 凸但非光滑 | SVM |
| **exp-convex** | 凸 | boosting |

### 4.3 拉格朗日对偶

原问题 $\min f(\boldsymbol x) \text{ s.t. } g_i(\boldsymbol x) \leq 0, h_j(\boldsymbol x) = 0$:

$$ \mathcal{L}(\boldsymbol x, \boldsymbol\lambda, \boldsymbol\nu) = f(\boldsymbol x) + \sum_i \lambda_i g_i(\boldsymbol x) + \sum_j \nu_j h_j(\boldsymbol x) $$

对偶函数 $g(\lambda, \nu) = \inf_x \mathcal{L}$. главная trick: 最大化对偶 ⇒ 上界原问题最优. 弱对偶恒, 强对偶凸+slater 条件.

### 4.4 KKT 条件

最优 $\boldsymbol x^*$ 满足:

1. **Stationarity**: $\nabla f + \sum_i \lambda_i \nabla g_i + \sum_j \nu_j \nabla h_j = 0$.
2. **Primal feasibility**: $g_i \leq 0, h_j = 0$.
3. **Dual feasibility**: $\lambda_i \geq 0$.
4. **Complementary slackness**: $\lambda_i g_i(\boldsymbol x^*) = 0$.

→ SVM 的推导从这里来; 因凸, KKT 充要.

### 4.5 LP / QP / SDP

```
LP:  min c^T x  s.t. Ax = b, x ≥ 0            (单纯形 / interior point)
QP:  min (1/2)x^T Q x + c^T x  s.t.  linear  (Q ≥ 0 ⇒ 凸)
SDP: min c^T x  s.t. F_0 + Σx_i F_i ⪰ 0      (矩阵半正定约束)
```

**应用**: LP 调度/路由; QP 投资组合 / SVM; SDP 控制论 / PhyLayer 检验扩展 Lyapunov.

---

## 五、迭代一阶优化器谱系

### 5.1 梯度下降 (GD)

$$ \boldsymbol x_{k+1} = \boldsymbol x_k - \eta \nabla f(\boldsymbol x_k) $$

- $\eta$ 小 ⇒ 慢但稳; 大 ⇒ 震荡可能发散.
- 收敛分析: $\eta \leq 1/L$ 时凸 $L$-smooth ⇒ $f_k - f^* = O(1/k)$.

### 5.2 SGD (Robbins-Monro 1951)

每次用 mini-batch 估计 $\nabla f \approx \hat g_k$:

$$ \boldsymbol x_{k+1} = \boldsymbol x_k - \eta_k \hat g_k $$

学习速率 schedule: $\sum \eta_k = \infty, \sum \eta_k^2 < \infty$ ⇒ a.s. 收敛 (Robbins-Monro).

### 5.3 Momentum / Nesterov

Momentum 在梯度方向添加"惯性":

$$ v_{k+1} = \beta v_k - \eta \nabla f(\boldsymbol x_k), \quad \boldsymbol x_{k+1} = \boldsymbol x_k + v_{k+1} $$

Nesterov 加速: 先用 $\boldsymbol x_k + \beta v_k$ 评估梯度.

直觉: 沿一致方向加速, 沿高频噪声阻尼. 凸情形 Nesterov 给最优 $O(1/k^2)$ 速率.

### 5.4 RMSProp

$$ \mathbb{E}[g^2]_k = \alpha \mathbb{E}[g^2]_{k-1} + (1-\alpha) g_k^2, \quad \boldsymbol x_{k+1} = \boldsymbol x_k - \frac{\eta}{\sqrt{\mathbb{E}[g^2]_k + \epsilon}} g_k $$

**关键观察**: 不同参数维度, 不同尺度梯度自适应 → Adam 接近 "1 个 axis 1 个步长".

### 5.5 Adam (Kingma & Ba 2014)

$$ m_k = \beta_1 m_{k-1} + (1-\beta_1) g_k $$
$$ v_k = \beta_2 v_{k-1} + (1-\beta_2) g_k^2 $$
$$ \hat m_k = \frac{m_k}{1 - \beta_1^k}, \quad \hat v_k = \frac{v_k}{1-\beta_2^k} $$
$$ \boldsymbol x_{k+1} = \boldsymbol x_k - \eta \frac{\hat m_k}{\sqrt{\hat v_k} + \epsilon} $$

- 默认 $\beta_1 = 0.9, \beta_2 = 0.999, \epsilon = 10^{-8}$.
- 动量 + RMSprop 合一; bias correction 针对初始时刻.
- ML 中 99% 任务用 Adam 即可跑出 baseline.

```python
def adam_update(params, grads, m, v, t, lr=1e-3, b1=0.9, b2=0.999, eps=1e-8):
    for p, g in zip(params, grads):
        m[p] = b1 * m[p] + (1 - b1) * g
        v[p] = b2 * v[p] + (1 - b2) * g * g
        m_hat = m[p] / (1 - b1 ** t)
        v_hat = v[p] / (1 - b2 ** t)
        p -= lr * m_hat / (v_hat.sqrt() + eps)   # 高级 pseudocode
    return params, m, v
```

> [!WARNING]
> Adam 标准实现的"收敛证明" (Reddi et al. 2018) 发现初版收敛不严, 改进如 AMSGrad / AdamW 解决. 现代 Transformer 训练几乎全用 AdamW (decoupled weight decay), 不用 vanilla Adam.

### 5.6 Optimizer 速查

| 优化器 | 用途 |
|--------|------|
| SGD | CV 大模型 (ResNet), 带强 augmentation |
| SGD+Momentum | CV 稳态训 90% |
| RMSProp | RNN 经典 |
| Adam | 默认, including transformer |
| AdamW | Transformer (decoupled decay) |
| LAMB / LARS | 大 batch 稳定 (BERT scale) |
| Sophia / Shampoo | 二阶近似, 2-3× 加速, research-stage |

---

## 六、信息几何

### 6.1 分布空间作流形

参数族 $\{p_\theta: \theta \in \Theta\}$, 一个分布对应一个参数点. **Fisher 信息矩阵**:

$$ \mathcal{I}(\theta)_{ij} = \mathbb{E}_{x \sim p_\theta}\left[\frac{\partial \log p_\theta}{\partial \theta_i} \frac{\partial \log p_\theta}{\partial \theta_j}\right] $$

直觉: Fisher 信息 = "你能用数据区分参数变化的灵敏度". 实际 $\mathcal{I} = -\mathbb{E}[H_{\log p}]$ (期望负 Hessian).

### 6.2 KL 看作曲率

对参数 $\theta$ 微扰 $d\theta$, KL 散度局部展开:

$$ \mathrm{KL}(p_\theta \| p_{\theta + d\theta}) = \frac{1}{2} d\theta^\top \mathcal{I}(\theta) d\theta + o(\|d\theta\|^2) $$

→ Fisher 矩阵就是**分布参数空间的黎曼度量**.

### 6.3 自然梯度

普通梯度下降不看度量; 用 Fisher 修正:

$$ \theta_{k+1} = \theta_k - \eta \cdot \mathcal{I}_k^{-1} g_k $$

直觉: 让"参数行进一步"在分布空间等价 (而不是欧式). 在 KL 时 $\theta$ 的大变化不一定 = $p$ 的大变化, 自然梯度把它校正.

→-policy gradient 变体如 TRPO / PPO 的原理, 自然梯度约束 $\mathrm{KL} \leq \delta$.

### 6.4 ELBO = KL 反向最小

变分推断要找近似 $q_\phi$ 拟合 $p(z | x)$. 写 ELBO:

$$ \mathcal{L}(\phi) = \mathbb{E}_{q_\phi}[\log p(x, z)] - \mathbb{E}_{q_\phi}[\log q_\phi(z)] $$

最大化 $\mathcal{L}$ ⇔ 最小化 $\mathrm{KL}(q_\phi \| p_{z|x})$. VAE 解码器就是这么训.

> [!NOTE]
> 信息几何 + Bayesian 推断 + KL 散度是一件事的三个名: 在统计参数空间用 Fisher 内积做梯度下降,(reverse-)KL 是 Riemannian metric 赋值.

---

## 七、其他常用工具

### 7.1 Logistic 函数 vs Softmax

$$ \sigma(x) = \frac{1}{1 + e^{-x}} = \mathrm{softmax}_+[x, 0] $$

→ 二分类 softmax = Logistic; $K$-分类是 softmax.

### 7.2 SVD 协助 PCA (重申线代)

PCA = 数据协方差矩阵 $\Sigma = (X - \bar X)^\top (X - \bar X)/n$ 做特征分解. 取 top-$k$ 特征向量方向. 等价: 数据矩阵 SVD 左奇异向量.

→ 推荐用 svd 而非 eig (数值更稳).

### 7.3 对偶: 极大熵分布

满足某些矩约束 $\mathbb{E}_p[g_i(x)] = c_i$ 的所有 $p$ 中, **熵最大的** $p^*$ 是指数族:

$$ p^*(x) = \frac{1}{Z} \exp\left(\sum_i \lambda_i g_i(x)\right) $$

→ Logistic 回归就是均值给定下熵最大的伯努利. 这是 Logistic 给"伯努利 + 高斯先验 → 应用最广"的数学根.

### 7.4 重要公式速查

| 公式 | 形式 |
|------|------|
| **softmax** 导数向量化 | $(\boldsymbol{ds}) = s \odot (\boldsymbol{dz} - \mathbf{1}(s^\top \boldsymbol{dz}))$ |
| **Newton step** | $\boldsymbol x - H^{-1} \nabla f$ |
| **KL 局部展开** | $\mathrm{KL}(p_\theta \| p_{\theta+d}) = \frac{1}{2} d^\top \mathcal{I} d + o(\|d\|^2)$ |
| **链式** | $\frac{\partial (f \circ g)}{\partial \boldsymbol x} = J_g^\top \nabla f$ |
| **Jensen** (凸 $\varphi$) | $\mathbb{E}[\varphi(X)] \geq \varphi(\mathbb{E}[X])$, KL 是 Jensen 直推 |

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **链式**: $\partial(f \circ g) / \partial \boldsymbol x = J_g^\top \nabla f$.
> - **softmax 反向**: $\boldsymbol{ds} = s \odot (\boldsymbol{dz} - \mathbf{1}(s^\top \boldsymbol{dz}))$.
> - **CE+softmax**: 反传对 logit = $s - \mathrm{onehot}$.
> - **Hessian**: $\nabla^2 f$; 半正定 ⇒ 局部最小.
> - **Newton**: $-H^{-1} \nabla f$, 二次收敛, $O(n^3)$ 反演费.
> - **凸**: 集合 + 函数 / KKT 充要 / LP-QP-SDP 递增.
> - **Adam**: $\hat m / \sqrt{\hat v} + \epsilon$; Transformer 默认 AdamW.
> - **Fisher**: $\mathcal{I} = \mathbb{E}[\nabla \log p \cdot \nabla \log p^\top]$.
> - **自然梯度**: $\theta - \eta \mathcal{I}^{-1} \nabla$; TRPO/PPO.
> - **ELBO**: $\mathbb{E}_q[\log p - \log q]$, reverse-KL min.
> - **Taylor**: 局部 $f + \nabla^\top h + \frac12 h^\top H h$.
> - **Lagrange**: $\mathcal{L} = f + \lambda g + \nu h$; KKT 4 条件.
> - **极值极大熵** → 指数族 (Bernoulli → LR, Multinomial → Softmax).

---

回主目录: [第零部分 · 工程数学与离散数学基础 README](README.md).
下一篇系统正文: [第一部分 · DSA 开篇](../dsa/README.md).
