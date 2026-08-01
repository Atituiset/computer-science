# 3. 概率统计: 分布 / 贝叶斯 / MLE / MAP / 极限 / KL

## TL;DR

工程里的"概率"是**刻画不确定性的语言**: 你不知道这台机器 next minute 崩不崩, 但你能给一个分布; 你不知道 key 碰撞概率, 但你能算 bound; 你不知道 transformer 学到的 embedding 集中在哪儿, 但你能用 KL 散度告诉它"靠近分布 $P$ 别乱漂". 这一篇覆盖:

1. **概率空间与随机变量** — PSPACE / 离散 vs 连续 / pmf vs pdf / CDF.
2. **期望 / 方差 / 协方差** — 随机变量的"代数".
3. **核心分布家族** — Bernoulli / Binomial / Geometric / Poisson / Uniform / Exponential / Normal / Categorical / Multinomial.
4. **联合、条件、贝叶斯** — $\Pr(A|B) = \Pr(B|A)\Pr(A)/\Pr(B)$; 一句话逼回去重写不少系统.
5. **MLE / MAP / EM** — 数据 → 参数的反推; ML 训练就是 MLE 大写版.
6. **极限定理: LLN / CLT / 大偏差** — "为什么 N=30 够了 / 为什么 4-sigma rarely".
7. **熵 / 交叉熵 / KL 散度** — 信息论与 ML 的最小公因子, 见信息论章节.
8. **万一线性 GC 不可解的不确定**: Concentration inequalities — Markov / Chebyshev / Hoeffding.

目标: 看到 "$\arg\max_\theta \prod_i p(x_i|\theta)$" 与 "$\arg\max_\theta \mathbb{E}_{z \sim q}[\ldots]$" 不再绕路查.

---

## 一、概率空间与随机变量

### 1.1 三件套 (Kolmogorov 公理)

概率空间 $(\Omega, \mathcal{F}, \Pr)$:

- $\Omega$ = 样本空间 (一切可能结果).
- $\mathcal{F} \subseteq 2^\Omega$ = 事件 $\sigma$-代数 (对补、可数并封闭).
- $\Pr: \mathcal{F} \to [0, 1]$ 满足:
  1. $\Pr(\Omega) = 1$.
  2. $\Pr(E) \geq 0$.
  3. 可数可加: 不相交 $E_i$ ⇒ $\Pr(\bigcup E_i) = \sum \Pr(E_i)$.

**随机变量** $X: \Omega \to \mathbb{R}$, 它把"实验结果"映射成数值. $X$ 决定概率分布 $\Pr_X(S) = \Pr(X^{-1}(S))$.

### 1.2 离散 vs 连续

- 离散: 概率质量函数 (pmf) $p_X(x) = \Pr(X = x)$.
- 连续: 概率密度函数 (pdf) $f_X$; $\Pr(a \leq X \leq b) = \int_a^b f_X(x) dx$; pdf 可 > 1.

**累计分布 (CDF)**: $F_X(t) = \Pr(X \leq t)$. 单调非降, 右连续, $\lim_{t\to-\infty}F=0$, $\lim_{t\to\infty}F=1$.

### 1.3 联合 / 边缘 / 条件

- 联合 pmf/pdf: $p_{X,Y}(x, y)$ 或 $f_{X,Y}(x, y)$.
- 边缘: $p_X(x) = \sum_y p_{X,Y}(x, y)$ (离散) 或 $\int f_{X,Y}(x, y) dy$ (连续).
- 条件: $p(x | y) = p(x, y) / p(y)$.

---

## 二、期望与方差

### 2.1 期望

$$ \mathbb{E}[X] = \begin{cases} \sum_x x \, p(x) & \text{离散} \\ \int x \, f(x)\, dx & \text{连续} \end{cases} $$

**线性性** (无论是否独立): $\mathbb{E}[aX + bY] = a \mathbb{E}[X] + b \mathbb{E}[Y]$.

**乘积**: $\mathbb{E}[XY] = \mathbb{E}[X]\mathbb{E}[Y]$ 仅当 $X, Y$ 独立.

**Jensen 不等式**: $\varphi$ 凸 ⇒ $\mathbb{E}[\varphi(X)] \geq \varphi(\mathbb{E}[X])$.

### 2.2 方差与协方差

$$ \operatorname{Var}(X) = \mathbb{E}[(X - \mu)^2] = \mathbb{E}[X^2] - (\mathbb{E}[X])^2 $$

$$ \operatorname{Cov}(X, Y) = \mathbb{E}[(X - \mathbb{E}X)(Y - \mathbb{E}Y)] = \mathbb{E}[XY] - \mathbb{E}X\mathbb{E}Y $$

$$ \operatorname{Cov}(aX, Y) = a \operatorname{Cov}(X, Y), \quad \operatorname{Var}(X \pm Y) = \operatorname{Var}X + \operatorname{Var}Y \pm 2\operatorname{Cov}(X, Y) $$

独立 ⇒ 协方差为 0 (逆命题不成立). 反例: $Y = X^2$, $X$ 取 ±1.

**相关系数** $\rho = \mathrm{Cov}/(\sigma_X \sigma_Y) \in [-1, 1]$.

### 2.3 标准化与 z-score

$$ z = \frac{X - \mu}{\sigma} $$

→ 标准化的 $z$ 期望 0, 方差 1. Six-Sigma / Grubbs 检验 / 异常点检测都基于这个.

---

## 三、核心分布家族

### 3.1 离散

| 名称 | pmf | 期望 / 方差 | 用法 |
|------|-----|------|-----|
| **Bernoulli** $B(p)$ | $p^x(1-p)^{1-x}$ | $\mu = p$, $\sigma^2 = p(1-p)$ | 一次试验 / 一行二分 |
| **Binomial** $\mathrm{Bin}(n,p)$ | $\binom{n}{k} p^k (1-p)^{n-k}$ | $\mu = np$, $\sigma^2 = np(1-p)$ | $n$ 次独立, count |
| **Geometric** $\mathrm{Geom}(p)$ | $(1-p)^{k-1} p$ | $\mu = 1/p$ | 首次成功次数 |
| **Poisson** $\mathrm{Poi}(\lambda)$ | $e^{-\lambda} \lambda^k / k!$ | $\mu = \sigma^2 = \lambda$ | 单位时间事件数 |
| **Negative Binomial** | $\binom{k+r-1}{k} p^k (1-p)^r$ | | 直到 r 次成功 |
| **Categorical** | $p_1, \ldots, p_K$ | — | 似 1-of-K, softmax 输出 |
| **Multinomial** | $\frac{n!}{\prod x_i!}\prod p_i^{x_i}$ | $\mathbb{E}[X_i] = n p_i$ | 多类计数; transformer 词频 |

**Poisson 公式直觉**: 当 $n \to \infty, p \to 0, np \to \lambda$ 时, $\mathrm{Bin}(n, p) \to \mathrm{Poi}(\lambda)$. 这就是网络中"罕见事件计数"为何都用 Poisson.

### 3.2 连续

| 名称 | pdf | 期望 / 方差 | 用法 |
|------|-----|------|-----|
| **Uniform** $U(a,b)$ | $\frac{1}{b-a}$ | $\mu = \frac{a+b}{2}$, $\sigma^2 = \frac{(b-a)^2}{12}$ | 假设为先验 / 随机采 |
| **Exponential** $\mathrm{Exp}(\lambda)$ | $\lambda e^{-\lambda x}$ | $\mu = 1/\lambda$, $\sigma^2 = 1/\lambda^2$ | 无记忆性, 排队论/MTBF |
| **Normal** $\mathcal{N}(\mu, \sigma^2)$ | $\frac{1}{\sqrt{2\pi\sigma^2}} e^{-(x-\mu)^2/(2\sigma^2)}$ | $\mu$, $\sigma^2$ | CLT 产物 |
| **Gamma** $\Gamma(\alpha, \beta)$ | $\frac{\beta^\alpha}{\Gamma(\alpha)}x^{\alpha-1}e^{-\beta x}$ | $\alpha/\beta$, $\alpha/\beta^2$ | Exp 推广; 等待时间和 |
| **Beta** $\mathrm{Beta}(\alpha, \beta)$ | $\frac{x^{\alpha-1}(1-x)^{\beta-1}}{B(\alpha,\beta)}$ | — | $[0,1]$ 上概率的先验 |
| **Chi-sq** $\chi^2_k$ | $\Gamma(k/2, 1/2)$ | $k$, $2k$ | 统计检验 |
| **Student's t** | — | — | 小样本, 未知方差 |

### 3.3 正态分布皇冠属性

$$ \mathcal{N}(\mu, \sigma^2): X = \mu + \sigma Z, Z \sim \mathcal{N}(0, 1) $$

- **68-95-99.7 法则**: 1/2/3-sigma 范围内概率.
- 标准 $Z = (X - \mu)/\sigma$.
- $\mathrm{Poi}(\lambda), \lambda \to \infty$ 渐近 $\mathcal{N}(\lambda, \lambda)$.
- 独立正态之和仍正态 (稳定性).

### 3.4 多元正态 (MVN)

$$ X \sim \mathcal{N}(\boldsymbol\mu, \Sigma), \quad f(\boldsymbol x) = \frac{1}{(2\pi)^{d/2}|\Sigma|^{1/2}} e^{-\frac{1}{2}(\boldsymbol x - \boldsymbol\mu)^\top \Sigma^{-1}(\boldsymbol x - \boldsymbol\mu)} $$

- $|\Sigma|$ 是协方差矩阵行列式.
- $\Sigma$ 正定 ⇒ 可写为 $\Sigma = L L^\top$, $X = \mu + L Z$ (采样技巧).
- 边缘任意正态也是正态; 条件正态也是正态 (Bayesian inference 的便利).

---

## 四、贝叶斯定理与全概率

### 4.1 三段式

$$ \Pr(A | B) = \frac{\Pr(B | A) \Pr(A)}{\Pr(B)} $$

展开 $\Pr(B) = \sum_i \Pr(B | A_i) \Pr(A_i)$ 即**全概率公式**, 用于把"原因"$A_i$ 关联到"观察"$B$.

### 4.2 语言版图

| 名称 | 公式 | 名号 |
|------|------|------|
| 后验 | $\Pr(\theta | x)$ | posterior |
| 似然 | $\Pr(x | \theta)$ | likelihood |
| 先验 | $\Pr(\theta)$ | prior |
| 证据 | $\Pr(x)$ | evidence |

$$ \text{posterior} \propto \text{likelihood} \cdot \text{prior} $$

> [!NOTE]
> 这是 ML 里 Bayesian 的根基; 也是 Crypto "概率可忽略函数"与 Secure Sketch、Distributed 系统里"phase king""Byzantine agreement"的概率推理木骨架.

### 4.3 经典例: 罕见病阳性

发病率 $0.1\%$, 检测阳性准确率 $99\%$ (sensitivity=specificity=0.99). 你阳, 真病概率?

$$ \Pr(\text{sick} | +) = \frac{0.99 \cdot 0.001}{0.99 \cdot 0.001 + 0.01 \cdot 0.999} \approx \frac{0.00099}{0.010989} \approx 9\% $$

> [!WARNING]
> 朴素直觉是"99% 检测准 ⇒ 真 99%". 实际是 9%——因为 prior 极稀疏. 这类 base-rate fallacy 在 ML 不平衡数据 / 监控告警 / IDS 系统里反复咬人.

### 4.4 共轭先验速查

| 似然 | 共轭先验 | 后验 |
|------|---------|------|
| Bernoulli | Beta | Beta |
| Poisson | Gamma | Gamma |
| Normal (已知 $\sigma$) | Normal | Normal |
| Multinomial | Dirichlet | Dirichlet |
| Exponential | Gamma | Gamma |

→ LDA / 主题模型几乎全在这张表上演, 见后续 ML 章节.

---

## 五、MLE / MAP / EM

### 5.1 最大似然估计 (MLE)

给定 i.i.d. 观测 $x_1, \ldots, x_n$, 取 $f(x; \theta)$ 的参数 $\theta$ 使观察到的数据**最有说服力**:

$$ \hat\theta_{\text{MLE}} = \arg\max_\theta \prod_{i=1}^n f(x_i; \theta) $$

工程上取 log 化为 sum:

$$ \hat\theta_{\text{MLE}} = \arg\max_\theta \sum_i \log f(x_i; \theta) $$

### 5.2 几个经典 MLE

**Bernoulli**: $\hat p = \frac{1}{n} \sum x_i$ (样本均值).

**Normal** (未知 $\mu, \sigma^2$): $\hat\mu = \bar x$, $\hat\sigma^2 = \frac{1}{n}\sum (x_i - \bar x)^2$.

**Uniform** $U(0, \theta)$: $\hat\theta = \max x_i$. 注意 MLE 有偏 ($\mathbb{E}[\max] = \frac{n}{n+1}\theta$).

### 5.3 MAP = MLE + Prior

$$ \hat\theta_{\text{MAP}} = \arg\max_\theta \; \prod f(x_i | \theta) \cdot p(\theta) $$

MLE 即先验均匀的 MAP. 加入先验等同于**正则化**:

- 似然 $\mathcal{N}(\bar x, \cdots)$ + 先验 $\theta \sim \mathcal{N}(0, \tau^2)$ ⇒ $\arg\min_\theta \|y - X\theta\|^2 + \frac{\sigma^2}{\tau^2} \|\theta\|^2$, 即 ridge regression.
- Laplacian 先验 ⇒ L1 = LASSO.

> [!NOTE]
> 这就是机器学习里"为什么 L1 稀疏, L2 平滑"的数学根源——直接看先验的形状就行.

### 5.4 EM 算法 (Expectation-Maximization)

数据有隐变量 $z$ 时, 直接解 MLE 解不出. EM 迭代:

1. **E 步**: 写完整似然关于当前隐变量后验的期望
   $$ Q(\theta | \theta^{(t)}) = \mathbb{E}_{z | x, \theta^{(t)}}[\log p(x, z | \theta)] $$
2. **M 步**: $\theta^{(t+1)} = \arg\max_\theta Q(\theta | \theta^{(t)})$.

应用: GMM (高斯混合), HMM (Baum-Welch), K-means (硬分版本).

### 5.5 ELBO 与变分下界

$$ \log p(x) = \log \int p(x, z) dz \geq \mathbb{E}_{z \sim q}[\log p(x, z)] - \mathbb{E}_{z \sim q}[\log q(z)] $$

右侧即 **ELBO** (Evidence Lower Bound), 见后续变分推断与 VAE. 最大化 ELBO ⇔ 最小化 $\mathrm{KL}(q \| p)$.

---

## 六、极限定理

### 6.1 大数定律 (LLN)

样本均值 $\bar X_n = \frac{1}{n}\sum X_i$ 几乎处处收敛到期望 $\mu$:

$$ \bar X_n \xrightarrow{\text{a.s.}} \mu $$

实践: Monte Carlo 取样本越多越逼近. **没有"无法估计方差 → 我就多采样"的工程路径就靠它**.

### 6.2 中心极限定理 (CLT)

i.i.d. 期望 $\mu$ 方差 $\sigma^2$:

$$ \sqrt n \cdot \frac{\bar X_n - \mu}{\sigma} \xrightarrow{d} \mathcal{N}(0, 1) $$

**含义**: 无论原分布, 样本均值经标准化渐近正态. 这就是正态分布"伞覆盖了一切"的成因; 也是 Bayes 不能免先验的 freq 默认.

**例**: 一枚硬币 $100$ 次, 头数近似正态, $\mu = 50, \sigma = 5$. 大概率落在 $[40, 60]$.

### 6.3 大偏差 (Chernoff / Hoeffding)

LLN 说"最终到 $\mu$". 但要量化"偏离 $\epsilon$ 的概率多小":

**Hoeffding 不等式** (有界 $X_i \in [a_i, b_i]$):

$$ \Pr\left[ \bar X_n - \mu \geq t \right] \leq \exp\left(-\frac{2 n^2 t^2}{\sum (b_i - a_i)^2}\right) $$

**Chernoff bound** (Bernoulli): $\Pr[\bar X_n \geq (p + \epsilon) n] \leq e^{-2 n \epsilon^2}$.

→ 这就是"为什么 100 次抛硬币正反偏离 0.5 不超过 0.1 是 ~5%".

> [!TIP]
> 6-sigma (`Six Sigma`) 标准 = $6\sigma$ 容差 ⇒ defect rate < 3.4 ppm = Hoeffding 直接给. 这是工业质检、A/B test 显著性、SLA 错误预算的概率骨架.

### 6.4 Markov / Chebyshev / 推导链

```
Markov (最弱):    P[X ≥ a] ≤ E[X] / a               (X ≥ 0)
Chebyshev:        P[|X - μ| ≥ t] ≤ Var X / t²
Hoeffding:        exp(-2 n t²/(b-a)²)                 (i.i.d. 有界)
Chernoff:         exp(-2 n ε²)                          (Bernoulli)
```

工程代码: 越往下用, 越用得上紧 (依赖越强 → bound 越松).

### 6.5 Concentration 在 ML / Distributed 的使用

- ML 中"经验风险 vs 真实风险" gap 用 Hoeffding 量化 (generalization).
- Distributed 中 quorum W+R>N 的"读到最新写"概率 = majority 经 Chernoff 上界.
- 测算 hash 冲撞概率 = birthday bound (鸽巢变体).

---

## 七、信息论三件: 熵 / 交叉熵 / KL

### 7.1 熵 (重申信息论章 §1)

$$ H(X) = -\sum_x p(x) \log p(x), \quad H(X, Y), \quad H(X | Y), \quad I(X; Y) = H(X) - H(X | Y) $$

**链式法则**: $H(X, Y) = H(X) + H(Y | X)$.

### 7.2 KL 散度

测两个分布 $p$ 与 $q$ 的"差异":

$$ \mathrm{KL}(p \| q) = \sum_x p(x) \log \frac{p(x)}{q(x)} $$

- $\mathrm{KL} \geq 0$, 等 0 当且仅当 $p = q$ a.s.
- **不对称**: $\mathrm{KL}(p \| q) \neq \mathrm{KL}(q \| p)$. 选择方向决定 forward / reverse mode.
- **Forward** $\mathrm{KL}(p \| q)$: $q$ 必须覆盖 $p$ 全支撑; 倾向 mode-seeking 忽略低概率区.
- **Reverse** $\mathrm{KL}(q \| p)$: $q$ 倾向 mass-covering (mean-seeking), VAE 用这个.

### 7.3 交叉熵 = 熵 + KL

$$ H(p, q) = H(p) + \mathrm{KL}(p \| q) $$

由于 $H(p)$ 对 $\theta$ 常量, **最小化交叉熵 ⇔ 最小化 KL**, ML 分类损失几乎全部用这个:

$$ \mathcal{L}_{\text{CE}} = -\sum_i y_i \log \hat y_i $$

### 7.4 JS 散度 = 对称化 KL

$$ \mathrm{JS}(p \| q) = \frac{1}{2}\mathrm{KL}(p \| m) + \frac{1}{2}\mathrm{KL}(q \| m), \; m = (p+q)/2 $$

GAN 的原始损失 = JS 的反向最大化.

---

## 八、随机过程初步

### 8.1 Markov 链

状态空间 $S$, 转移 $P_{ij} = \Pr(X_{t+1} = j | X_t = i)$. **无记忆性**:

$$ \Pr(X_{t+1} | X_t, \ldots, X_0) = \Pr(X_{t+1} | X_t) $$

平稳分布 $\pi$: $\pi P = \pi$. 不可约+非周期 ⇒ 唯一, $P^k \to \mathbf{1}\pi^\top$.

**应用**: MCMC (Metropolis-Hastings / Gibbs), PageRank, HMM, 强化学习 (MDP 基础).

### 8.2 Poisson 过程

事件到达速率 $\lambda$, 间隔 $\sim \mathrm{Exp}(\lambda)$ i.i.d.. 计数 $N(t) \sim \mathrm{Poi}(\lambda t)$.

**应用**: OS 排队论、CDN 缓存命中率、DB 连接池、限流桶.

### 8.3 排队论 (M/M/1)

到达 Poisson, 服务 Exp, 1 个服务台:

$$ \rho = \frac{\lambda}{\mu}, \quad L_q = \frac{\rho^2}{1-\rho}, \quad W_q = \frac{\rho/\mu}{1 - \rho} $$

→ 资源利用率 $\rho \to 0.8$ 时队列开始爆炸, 这就是 SRE 不敢 < 50% buffer 的原因.

---

## 九、采样与估计实践

### 9.1 Monte Carlo

要算 $\mathbb{E}[f(X)]$ 没闭式 → 采样: $\frac{1}{n}\sum f(X_i)$, LLN 保证收敛, Hoeffding 给误差.

```python
import numpy as np
def estimate_pi(n: int = 10_000_000) -> float:
    x = np.random.random(n); y = np.random.random(n)
    return 4 * (x*x + y*y < 1).mean()    # Naïve MC, σ ~ 0.5/√n
# n=1e6 → π ≈ 3.1416 ± 5e-4
```

### 9.2 重要采样 (Importance Sampling)

**问题**: 想算 $\mathbb{E}_p[f]$, 但只能从 $q$ 采样:

$$ \mathbb{E}_p[f] = \mathbb{E}_q\left[f(x) \cdot \frac{p(x)}{q(x)}\right] $$

→ 在 Off-policy RL / 罕见事件估计里必备. 也是 Transformer 推理"speculative decoding"的概率基础.

### 9.3 拒绝采样 + Metropolis

- 拒绝采样: 找一个易采的 envelope $M q(x) \geq p(x)$, 采 $x \sim q$ 接受概率 $p(x)/(M q(x))$.
- Metropolis-Hastings: 当前 $x$, 提议 $x'$, 接受概率 $\min(1, \frac{p(x')q(x | x')}{p(x)q(x' | x)})$.

---

## 十、结束 + 速查表

> [!TIP]
> 一页快速唤回:
> - **期望**: $\mathbb{E}[aX + bY] = a\mathbb{E}X + b\mathbb{E}Y$; 独立相乘: $\mathbb{E}[XY] = \mathbb{E}X\mathbb{E}Y$.
> - **方差**: $\operatorname{Var}(X \pm Y) = \operatorname{Var}X + \operatorname{Var}Y \pm 2\operatorname{Cov}$.
> - **方差-期望公式**: $\operatorname{Var}(X) = \mathbb{E}[X^2] - (\mathbb{E}[X])^2$.
> - **Bernoulli** $B(p)$: $\mu = p, \sigma^2 = p(1-p)$.
> - **Poisson** $\lambda$: $\mu = \sigma^2 = \lambda$; $\mathrm{Bin}(n,p_n) \to \mathrm{Poi}(np)$.
> - **正态**: $a + b Z \sim \mathcal{N}(a, b^2)$; 标准化 $(X-\mu)/\sigma$.
> - **共轭**: Beta-Bernoulli, Gamma-Poisson, Dirichlet-Multinomial.
> - **贝叶斯**: posterior ∝ likelihood × prior.
> - **MLE/MAP**: MLE = MAP-uniform; 联合类先验 Gaussian → ridge, Laplace → LASSO.
> - **极限**: $\bar X_n \to \mu$ (LLN); $\sqrt n (\bar X_n - \mu)/\sigma \to \mathcal{N}$ (CLT).
> - **熵**: $H(X) = -\sum p \log p$; 条件熵 $H(X|Y) = H(X, Y) - H(Y)$; 互信息 $I = H(X) - H(X|Y)$.
> - **KL**: $\mathrm{KL}(p \| q) \geq 0$, 不对称; 交叉熵 = $H(p) + \mathrm{KL}$.
> - **Markov 不等式 P[X ≥ a] ≤ E[X]/a**; **Hoeffding** $\exp(-2n t^2/(b-a)^2)$.

---

下一篇: [4. 微积分与最优化: 链式法则 / 雅可比 / Hessian / 凸优化 / 信息几何](calc-opt.md).
