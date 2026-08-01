# 5. Generative Models: VAE & ELBO / 扩散模型 / AR 采样 / speculative decoding

## TL;DR

"生成模型"是把概率分布 $p(x)$ 当学习目标的一类模型. 直接学高维 $p(x)$ 不估计动, 所以四套主流方案分别走不同路:

1. **Autoregressive (AR) / GPT 风** — $p(x) = \prod_t p(x_t | x_{<t})$.
2. **Flow / Normalizing Flow** — 用可逆变换把简单高斯推向复杂数据分布.
3. **VAE** — 引入隐变量 $z$, 最大化 ELBO (等价最小化 reverse-KL).
4. **扩散模型 (Diffusion)** — 加噪声 + 学去噪; ELBO 推到 Gaussian NLL 简化为 $(\epsilon - \epsilon_\theta)^2$.

本章把这四类原理 + ELBO 数学一气讲透, 并补上**采样加速工程**: KV cache、temperature/top-k/top-p、speculative decoding.

读完应能: 读 VAE 原 paper (Kingma 2013) / DDPM (Ho 2020) / Speculative Decoding (Leviathan 2022) 不再卡数学, 在 NumPy 上写出最简 VAE 与扩散训练循环.

---

## 一、统一视角: 生成模型 = 概率分布拟合

### 1.1 真实目标

数据集 $\{x_i\}_{i=1}^n$ 视为某未知分布 $p_{\text{data}}(x)$ 的样本. 训练目标:

$$ \arg\max_\theta \mathbb{E}_{x \sim \mathcal{D}} [\log p_\theta(x)] $$

即**最大似然**, 回顾第零部分概率 §5.

### 1.2 为什么 MLE 不够?

对复杂数据 (图像 / 文本), 直接定义 $p_\theta(x)$ 并求它是难事. 解决方案:

- **AR**: 把 $p(x)$ 分解为 $\prod p(x_t | x_{<t})$, 每一项可参数化为神经网络输出.
- **Flow**: 通过可逆变化把 $x \sim p_\theta \Leftrightarrow z \sim \mathcal{N}(0, I)$, 用 change-of-variables.
- **VAE**: 引隐变量 $z$, 学一个 encoder $q_\phi(z|x)$ 与 decoder $p_\theta(x|z)$, 联合似然 = ELBO.
- **Diffusion**: 让 $z$ 有层级意义 ($x_0, x_1, \ldots, x_T$ 渐噪化), encoder 是固定 forward process, decoder 是学 reverse process.

---

## 二、Autoregressive (AR) 采样

### 2.1 概率链

$$ p_\theta(x_{1:T}) = \prod_{t=1}^{T} p_\theta(x_t | x_{<t}) $$

每项参数化 = transformer decoder 的下一个 token 分布; 损失 = next-token CE (回顾 §3 Transformer).

### 2.2 与 NLL 的等价

每步的负对数似然 = $\log V - \log p_\theta(x_t | x_{<t})$. **perplexity = $\exp(\mathrm{avgNLL})$**, 一个常报指标.

### 2.3 采样

```python
def sample(model, prompt, n=64, temperature=1.0, top_p=0.9):
    ids = list(prompt)
    for _ in range(n):
        logits = model(ids)            # 取 last position logits
        logits = logits[-1] / temperature
        # top-p / nucleus
        sorted_l = np.sort(logits)[::-1]; cumprobs = np.cumsum(softmax(sorted_l))
        cutoff = np.searchsorted(cumprobs, top_p)
        kept = sorted_l[:cutoff + 1]
        probs = softmax(kept); next_id = np.random.choice(kept.shape[0], p=probs)
        ids.append(next_id)
    return ids
```

### 2.4 采样超参的数学含义

| 超参 | 行为 | 直觉 |
|------|------|------|
| $T \to 0$ | argmax | 贪心 / 确定输出 |
| $T = 1$ | 原分布 | 真样本 |
| $T \to \infty$ | 均匀 | 创造性最满 |
| Top-k | 留 k 个最高 logits 余归一 | 限制样本在常见 token |
| Top-p (nucleus) | 累积概率到 p 的最少 token | 动态阈值 |

> [!TIP]
> 经验上 LLM 任务: $T = 0.7 \sim 1.0$, top-p = 0.9 ~ 0.95, 适合开放式对话; 代码生成更低温 $T = 0.1 \sim 0.4$. 不随意把 $T$ 提高 → 让 LLM 像随机 token generator.

### 2.5 KV cache: 自回归推理加速

L 步推理: 第 $t$ 步每将 $x_t$ 与所有 $x_{<t}$ 算 attention, $k_t, v_t$ 不变 → **缓存 KV 矩阵** 仅计算新一步.

显存: 一卡 LLM 推理主要被 KV 占 (而非权重), 故 PagedAttention / MLA / 量化 KV 成工业核心.

---

## 三、Flow / Normalizing Flow (概览)

### 3.1 Change of variables

设 $f: \mathbb{R}^d \to \mathbb{R}^d$ 可逆, $z \sim \mathcal{N}(0, I)$, $x = f(z)$. 则:

$$ p_X(x) = p_Z(f^{-1}(x)) \cdot \left| \det \frac{\partial f^{-1}}{\partial x} \right| = \frac{p_Z(z)}{|\det J_f|} $$

### 3.2 训练

$$ \log p_X(x) = \log p_Z(f^{-1}(x)) - \sum_i \log s_i $$

其中 $s_i$ 是各 step 的雅可比行列式的 log abs. 需要 $f$ 形状让雅可比 close-form 易算, 例如:

- NICE / RealNVP: affine coupling layer.
- Glow: invertible 1×1 conv + actnorm + affine coupling.

### 3.3 ML 中位置

不如 VAE / 扩散主流; 但在密度估计 / audio (WaveGlow) / 概率科普文中常见. 第零部分线代 §2 SVD/§5 行列式工具.

---

## 四、VAE: ELBO = reverse KL

### 4.1 模型

设隐变量 $z$, 含 $p_\theta(x, z) = p(z) p_\theta(x|z)$. **真实后验** $p_\theta(z | x)$ 不可积, 用近似 $q_\phi(z | x)$:

$$ \log p_\theta(x) = \log \int p_\theta(x, z) \, dz $$

Jensen 不等式 + 加 form:

$$ \log p_\theta(x) = \mathbb{E}_{z \sim q_\phi(z|x)} \left[ \log \frac{p_\theta(x, z)}{q_\phi(z|x)} \right] + \mathrm{KL}(q_\phi(z|x) \| p_\theta(z|x)) $$

第一项是 **ELBO** (Evidence Lower Bound), 第二项 $\geq 0$. 最大化 ELBO ⇔ 最小化 $\mathrm{KL}(q_\phi \| p_\theta(z|x))$.

ELBO 拆开:

$$ \mathcal{L}_{\text{ELBO}} = \mathbb{E}_{z \sim q_\phi(z|x)} \big[\log p_\theta(x|z)\big] - \mathrm{KL}\big(q_\phi(z|x) \,\|\, p(z)\big) $$

- 第一项 = **重建项** (decoder likelihood).
- 第二项 = **KL 正则项** (encoder 不偏离 prior 多少).

> [!NOTE]
> 这就是 VAE 训练目标: max ELBO. 第零部分概率 §7 KL 不对称很关键 — 通过 reverse-KL ($q \| p$) 让 $q$ 倾向 mode-seeking, 但在多模态真实后验下会缺一些质量.

### 4.2 重参数技巧 (reparameterization)

直接采 $z \sim \mathcal{N}(\mu, \sigma^2)$ 不可反传 (随机节点). 改写:

$$ z = \mu + \sigma \odot \epsilon, \quad \epsilon \sim \mathcal{N}(0, I) $$

→ $\mu, \sigma$ 变 deterministic, 蒙特卡洛用同一 batch 多次采样.

### 4.3 VAE 训练循环 (PyTorch 简版)

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class VAE(nn.Module):
    def __init__(self, d_x=784, d_z=20, d_h=400):
        super().__init__()
        self.enc = nn.Sequential(nn.Linear(d_x, d_h), nn.ReLU())
        self.fc_mu = nn.Linear(d_h, d_z); self.fc_logvar = nn.Linear(d_h, d_z)
        self.dec = nn.Sequential(nn.Linear(d_z, d_h), nn.ReLU(), nn.Linear(d_h, d_x), nn.Sigmoid())

    def encode(self, x):
        h = self.enc(x); return self.fc_mu(h), self.fc_logvar(h)

    def reparam(self, mu, logvar):
        std = (0.5 * logvar).exp()
        return mu + std * torch.randn_like(std)

    def decode(self, z): return self.dec(z)

    def forward(self, x):
        mu, logvar = self.encode(x); z = self.reparam(mu, logvar)
        return self.decode(z), mu, logvar

def vae_loss(x_recon, x, mu, logvar):
    BCE = F.binary_cross_entropy(x_recon, x, reduction='sum')     # -E[log p(x|z)]
    KLD = -0.5 * torch.sum(1 + logvar - mu.pow(2) - logvar.exp())  # KL(N(μ,σ²) || N(0, 1))
    return BCE + KLD
```

> [!TIP]
> VAE 的"模糊"问题 — 重建项用 BCE/MSE 对应 Bernoulli/Gaussian decoder; 模糊因为高斯 decoder 平均多个模态. 加 GAN 判别器 / 改输出分布变 mixture / 改扩散走法解决.

### 4.4 与第零部分接口

- ELBO = KL 反向最小化, 等价概率 §7.4 交叉熵 = 熵 + KL, 微积分 §6.3 信息几何 KL 局部 = Fisher 矩阵二次型.

---

## 五、扩散模型 (DDPM)

### 5.1 核心思想

把数据 $x_0$ 在 $T$ 步里逐步加高斯噪声:

$$ q(x_t | x_{t-1}) = \mathcal{N}(x_t; \sqrt{1 - \beta_t} x_{t-1}, \beta_t I) $$

联合的有 closed-form:

$$ q(x_t | x_0) = \mathcal{N}(x_t; \sqrt{\bar\alpha_t} x_0, (1 - \bar\alpha_t) I), \quad \bar\alpha_t = \prod_{s=1}^t (1 - \beta_s) $$

→ 任意 $t$ 可从 $x_0$ 一步采样 (训时常用).

### 5.2 反向过程 (用网络学)

$$ p_\theta(x_{t-1} | x_t) = \mathcal{N}(x_{t-1}; \mu_\theta(x_t, t), \Sigma_\theta(x_t, t)) $$

### 5.3 ELBO 推到简化形式

DDPM 原 paper 推导完整 ELBO, 设 $\Sigma_\theta = \beta_t I$ 固定得到项:

$$ \mathcal{L}_{t-1} = \mathbb{E}_q \left[ \frac{\beta_t^2}{2 \sigma_t^2 \alpha_t \beta_t} \|\hat\mu_\theta(x_t, t) - \mu_q(x_t, x_0)\|^2 \right] $$

进一步 reparameterize 让网络预测"原始噪声" $\epsilon$ 而非 $\mu$:

$$ \mathcal{L}_t^{\text{simple}} = \mathbb{E}_{x_0, \epsilon, t} \big\| \epsilon - \epsilon_\theta(\sqrt{\bar\alpha_t} x_0 + \sqrt{1 - \bar\alpha_t} \epsilon, t) \big\|^2 $$

> [!NOTE]
> 工业训练: 输入网络 $x_t = \sqrt{\bar\alpha_t} x_0 + \sqrt{1 - \bar\alpha_t} \epsilon$ (前闭式), 预测噪声 $\epsilon$ 与真 $\epsilon$ 做 MSE. 这就是为什么所有"扩散训练循环"看起来这么朴素.

### 5.4 训练循环 (PyTorch 简版)

```python
import torch.nn as nn

class Diffusion(nn.Module):
    def __init__(self, model, T=1000, betas=None):
        super().__init__()
        self.model = model                      # ε_θ(x_t, t)
        self.T = T
        if betas is None:
            betas = torch.linspace(1e-4, 0.02, T)
        alphas = 1.0 - betas
        self.register_buffer('alphas_cumprod', torch.cumprod(alphas, 0))

    def forward_loss(self, x0):
        B = x0.shape[0]
        t = torch.randint(0, self.T, (B,), device=x0.device)
        eps = torch.randn_like(x0)
        a_bar = self.alphas_cumprod[t].view(B, 1, 1, 1)
        x_t = a_bar.sqrt() * x0 + (1 - a_bar).sqrt() * eps
        eps_pred = self.model(x_t, t)
        return nn.functional.mse_loss(eps_pred, eps)
```

### 5.5 采样: 慢的分步去噪

```python
@torch.no_grad()
def sample(self, shape):
    x = torch.randn(shape)
    for t in reversed(range(self.T)):
        eps_pred = self.model(x, torch.full((shape[0],), t))
        alpha = self.alphas[t]; alpha_bar = self.alphas_cumprod[t]
        x0_pred = (x - (1 - alpha_bar).sqrt() * eps_pred) / alpha_bar.sqrt()
        x = alpha.sqrt() * x0_pred + (1 - alpha).sqrt() * torch.randn_like(x) if t > 0 else x0_pred
    return x
```

### 5.6 加速采样 (DDIM, 2020)

DDPM 1000 步采样太慢, **DDIM** (Song 2021) 用非 Markov 跳步采样 50 步质量近似. 进一步:

- **DPM-Solver** (Lu 2022): 10-25 步高质量采样.
- **Consistency Models** (Song 2023): 1 步采样.
- **Latent Diffusion** (Stable Diffusion 2022): 在 VAE latent 上扩散, 而非像素 → 大幅省算工程盈利.

### 5.7 与第零部分接口

- 5.1 前向过程 ⇐ 概率 §3.2 连续分布高斯家族.
- 5.3 ELBO 简化 ⇐ 概率 §5.5 + §7.2 KL + 信息论 §1 / 熵链式.
- 5.6 DDIM / DPM-Solver 等 ⇐ 微积分 §1 数值方法 (ODE 求积).

---

## 六、Speculative Decoding (LLM 推理加速)

### 6.1 动机

LLM 生成时每 token 一次 forward pass, GPU 利用率低. 用一个**草稿小模型**先猜 $k$ 个 token, 再用大模型一次 forward 验证.

### 6.2 算法

1. draft model $M_d$ 自回归生成 $k$ 个候选 token $x_{1:k}$.
2. target model $M_t$ 用 **同一 prompt + $k$ token** 做一次 forward, 得到各位置分布 $p_{1:k}^t$.
3. 对每位置 $i$, 比较 $x_i$ 在 $p_i^t$ 与 $p_i^d$ 的概率:
   - 若 $p_i^t(x_i) \geq p_i^d(x_i)$: accept.
   - 若 $p_i^t(x_i) < p_i^d(x_i)$: 以 $\left(1 - \frac{p_i^t(x_i)}{p_i^d(x_i)}\right)$ 概率拒绝, 拒绝则从残余概率 $\propto p_i^t - p_i^d$ 重采一个新 token.
4. 拒后丢弃后续.

### 6.3 数学保证

分布与原 target model 严格相同 (rejection sampling correctness). 因此生成不变, 只是更快 (草稿准 → 接受多 → 每 forward 吐多 token).

### 6.4 工程增益

- accepted fraction 0.5-0.7 时 2-3× speedup.
- 与 KV cache 兼容: draft 与 target 共用 KV cache 接口, 同步多条 path.
- 与 Medusa / EAGLE / Lookahead 等扩展思路是不同分支预测方案.

> [!WARNING]
> speculative decoding 的核心是**概率分布一致性**而非单纯接受率. 工程上仔细处理 `torch.distribution.Independent`、rejection 不能简化成 `argmax == argmax`, 否则会漫游偏离原分布.

---

## 七、统一对比

| 模型 | 训练目标 | 直接 / 间接 | 模式覆盖 |
|------|---------|-------------|----------|
| AR (GPT) | next-token NLL | 直接 MLE | mode-covering (但通过 CE 隐式规约) |
| Flow | $\log p_X = \log p_Z - \log \|\det J\|$ | 直接 MLE | 精确匹配 |
| VAE | ELBO max = reverse-KL min | 间接 (下界) | mode-seeking (可能漏一些) |
| Diffusion | $\|\epsilon - \epsilon_\theta\|^2$ (ELBO 简化) | 间接 (下界, 等价 reverse-KL) | 等价 NLL, 全模式 |
| GAN | minimax adversarial | 间接 | implicit, 隐式匹配 |

> [!NOTE]
> VAE 与扩散同属"反向 KL 最大化 ELBO"; 扩散其实是 Hierarchical VAE 的连续时间极限 (Score-based 视角). 把 VAE 弄懂以后, 扩散只是"用更大量级别的噪声扰动 + 设 encoder 完全固定"而已, 不需新数学.

---

## 八、与第零部分的全面接口

| 本部分 | 第零部分章节 |
|--------|-------------|
| 1 MLE 视角 | 概率 §5 |
| 2 AR / next-token CE | 概率 §3 + §7 + 微积分 §2.3 softmax |
| 3 Flow / change of var | 线代 §2 行列式 + 微积分 §2 雅可比 |
| 4 VAE / ELBO / reverse KL | 概率 §7 (KL 不对称, 交叉熵 = H + KL) |
| 5 Diffusion | 概率 §3 + §5.5 + 信息论 (熵链) |
| 6 Speculative decoding | 概率 §3.6 (acceptance sampling) + 概率 §4 (Bayes 全概率) |

---

## 九、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **生成模型 = 拟合 $p_\theta(x)$ 的 MLE**; 直接 AR / Flow, 间接 VAE / 扩散 (ELBO 上界).
> - **AR 训练**: $-\sum \log p(x_t | x_{<t})$; per-token CE; 反向 $s - \text{onehot}$.
> - **Flow**: change-of-variables, $\log p_X = \log p_Z - \log |\det J|$.
> - **VAE**: $\mathcal{L} = \mathbb{E}_q[\log p(x|z)] - \mathrm{KL}(q(z|x) \| p(z))$; reparam trick; mode-seeking.
> - **Diffusion**: ELBO 推到 $\|\epsilon - \epsilon_\theta(x_t, t)\|^2$ 简化; forward 有闭式采样到任意 $t$.
> - **DDIM**: 非马尔可跳步; DPM-Solver 10-25 步; Consistency Models 1 步.
> - **采样超参**: $T$ 控创造; top-k/p 留高概率 mass.
> - **KV cache**: 推理时省重算, 长上下文显存主占.
> - **Speculative decoding**: 草稿 + target 验证, 严格保持原分布, 2-3× 速度.

---

回主目录: [第十二部分 · 人工智能与机器学习 README](index.html).
下一篇系统正文: [第十三部分 · 元抽象: 跨章节大主题](../_meta/index.html).
