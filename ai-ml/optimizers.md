# 4. Optimizers & Training Dynamics: Adam/AdamW/二阶 + 初始化/LayerNorm/warmup/checkpoint

## TL;DR

训练 = 让损失下降, 但**怎么走每一步**比"走对方向"更重要. 这一章把第零部分微积分与优化 §5 一阶优化器谱系落到 ML 训练现实中, 覆盖:

1. **SGD → Momentum → RMSProp → Adam → AdamW** — 算法谱与各自"在哪个病上多了一手".
2. **二阶与拟牛顿** — Newton / L-BFGS / K-FAC / Sophia, 为什么在 Transformer 训练里几乎不用.
3. **学习率调度与 warmup** — cosine / linear / 多阶段、为什么 Transformer 必须有 warmup.
4. **权重初始化** — Xavier / He / 0.02 std / μP; σ 与 $\sqrt{d_k}$ 的呼应.
5. **LayerNorm vs RMSNorm vs DeepNorm** — 稳定深 stack 与大规模训练的实际替代.
6. **梯度裁剪 / 梯度累积 / ZeRO 概览** — 跨多卡的实践要点.
7. **梯度累积梯度检查激活 checkpoint** — 一卡跑大 batch 的"显存魔术".
8. **训练动力学诊断** — learning curve 健康度 / weight watch / glow / NaN 排查.

读完应能: 从零组合一个 Transformer 训练 config 知道 lr 怎么取 / warmup 多少步 / 用什么优化器 / 何种 init, 出 NaN 时能定位.

---

## 一、一阶优化器谱 (回顾 + ML 落地)

第零部分微积分与优化 §5 已列谱系, 这里聚焦每个在 ML 现实里的"为什么".

### 1.1 SGD 与小批量

$$ \theta_{k+1} = \theta_k - \eta \cdot \hat g_k, \quad \hat g_k = \frac{1}{B}\sum_{i \in \text{batch}_k} \nabla_\theta \ell(f_\theta(x_i), y_i) $$

**关键性能**:

- 收敛率: 凸 $\mathcal{L}^*$ → $O(1/k)$; 强凸 → $O(\exp(-k/L))$; 非凸 → $O(1/\sqrt{k})$ (到 stationary point).
- 实际: 全 batch 太慢; $B = 32 \sim 2048$ 在 GPU 上高效; 大 $B$ ($\geq 4M$ tokens) 多卡下需 LARS / LAMB.

### 1.2 Momentum (Polyak 1964 / Nesterov 1983)

$$ v_{k+1} = \beta v_k + \hat g_k, \quad \theta_{k+1} = \theta_k - \eta \, v_{k+1} $$

- $\beta = 0.9$ 标配; 等效"惯性滑动"沿一致梯度方向加速, 抑制样本噪声.
- Nesterov 加速: $\hat g_k = \nabla f(\theta_k - \eta \beta v_k)$, 看一眼下一刻位置再求梯度. 凸情形最优 $O(1/k^2)$ 收敛率.

### 1.3 RMSProp (Hinton 2012, 未发表讲义)

$$ \mathbb{E}[g^2]_k = \alpha \mathbb{E}[g^2]_{k-1} + (1 - \alpha) \hat g_k^2;\quad \theta_{k+1} = \theta_k - \eta \cdot \frac{\hat g_k}{\sqrt{\mathbb{E}[g^2]_k + \epsilon}} $$

**解决了什么**: 不同参数维度梯度量级不同, 大角度看各自的二阶矩自适应学习率. RNN 经典, 但 Transformer 几乎不单独用.

### 1.4 Adam (Kingma & Ba 2014)

回顾公式 (已在第零部分微积分与优化 §5 写过):

$$ m_k = \beta_1 m_{k-1} + (1 - \beta_1) g_k $$
$$ v_k = \beta_2 v_{k-1} + (1 - \beta_2) g_k^2 $$
$$ \hat m_k = m_k / (1 - \beta_1^k), \quad \hat v_k = v_k / (1 - \beta_2^k) $$
$$ \theta_{k+1} = \theta_k - \eta \cdot \frac{\hat m_k}{\sqrt{\hat v_k} + \epsilon} $$

**默认**: $\beta_1 = 0.9, \beta_2 = 0.999, \epsilon = 10^{-8}$.

**特性**:
- 一阶 + 二阶自适应: 每参数签名 (precision) 调整步长.
- bias correction 让初期 $m, v$ 不被初始化 0 拉住.

> [!WARNING]
> Reddi et al. 2018 "On the Convergence of Adam" 证 Adam 在一些简单凸问题上不收敛, 给出 **AMSGrad** 修补 ($v_k \leftarrow \max(v_k, v_{k-1})$) 防步长反向放大. 但实际 LLM 训练里主流仍用 Adam 类变体, 因为样本噪声远超此问题.

### 1.5 AdamW (Loshchilov & Henter 2017/2019)

AdamW 把 weight decay **解耦**:

$$ \theta_{k+1} = \theta_k - \eta \cdot \left( \frac{\hat m_k}{\sqrt{\hat v_k} + \epsilon} + \lambda \theta_k \right) $$

- Adam 把 weight decay 写入梯度 $\hat g_k + \lambda \theta$, 与自适应冲突.
- AdamW 把 $\lambda \theta$ 直接乘 $\eta$ 外加, **不进 $m, v$**, 保留自适应对方向精度.

**ML 实践**: LLM 训练首选 AdamW. weight decay $\lambda = 0.01 \sim 0.1$; Bert-Base wd=0.01; LLaMA-2 wd=0.1.

### 1.6 谱系总结

```
SGD
  └─ Momentum (Polyak/Nesterov): 沿一致方向加速
      └─ RMSProp: 用二阶矩做按维度学习率
          └─ Adam: 一阶+二阶组合
              ├─ AMSGrad: 修 Adam 不收敛
              ├─ NAdam: Nesterov + Adam
              └─ AdamW: 解耦 weight decay ←── Transformer / LLM 主流
```

| 任务类型 | 配方 |
|---------|------|
| CV (ResNet/ViT 默认 SGD) | SGD+Momentum 0.9, weight decay 1e-4 |
| CV 加 augmentation | 有时 SGD 比 Adam 更好 generalization |
| RNN | RMSProp / Adam |
| NLP / Transformer | AdamW + warmup + cosine |
| Pretraining 大模型 | AdamW + cosine + warmup + bf16 + ZeRO |
| Fine-tune | AdamW wd=0.0 或 0.01, 较小 lr |
| 强化学习 | Adam (PPO) |

---

## 二、二阶方法: 为什么在深度学习中少见

### 2.1 Newton 法回顾

$$ \theta_{k+1} = \theta_k - H^{-1}_k g_k $$

**理论优点**: 二次局部收玫; 极值附近极快.

**ML 障碍**:

1. **$H^{-1}$ 太贵**: $n$ 维 → $O(n^3)$ 反演. GPT-3 $n = 175B$ 不现实.
2. **$H$ 在非凸鞍点附近不**正定, 反向更可能下冲.
3. **Mini-batch $H$ 是噪声估计**, 方差大.
4. **二阶自适应 learning rate** 与一阶迭代式不易混合.

### 2.2 拟牛顿 (L-BFGS)

不存 $H^{-1}$, 用最近 $m$ 步迭代差来近似 $\rho H^{-1}$.

**ML 应用**: 几乎只在小数据全 batch 优化里 (naive logistic regression / 非凸优化如 Deep Equilibrium Models 偶尔). 深度学习主流不用.

### 2.3 K-FAC (Martens & Grosse 2015)

Kronecker-Factored Approximate Curvature: 用 Kronecker 分解近似 Fisher 信息矩阵. 在 Transformer 训练里少数研究组尝试 (DeepSeek-1 略用), 但工业上仍主流一阶.

### 2.4 Sophia / Shampoo / Muon (2023-2024)

- **Shampoo** (Gupta 2018): 用层结构做块对角 Preconditioner.
- **Sophia** (Liu et al. 2023): 用 Hessian 估计的对角做曲率, 比 Adam 2× 收敛; LLaMA-scale 实验通过.
- **Muon** (Keller Jordan 2024+): 用 Newton-Schulz iteration 做 GPU 友好的正交化梯度, 进一步加速 Qwen-class 训练.

> [!NOTE]
> 这些二阶近似优化器进展是真正多工业尝试, 但仍未取代 AdamW 的主导地位, 主要因为 GPU/H100 上的优化 kernel 都为 AdamW 写. 但 Muon 这个新进展值得关注.

---

## 三、学习率调度

### 3.1 固定 LR 的问题

- 太大: 损失震荡或 NaN.
- 太小: 训练慢.
- 沿途: 不同阶段不同最优 LR.

### 3.2 常见调度

| 调度 | 形式 | 用例 |
|------|------|------|
| **Constant** | $\eta_k = \eta_0$ | Baseline, 小数据 |
| **Step decay** | 每 $K$ 步乘 0.1 | CV 经典 (e.g. SGD step 30/60/90) |
| **Exponential decay** | $\eta_k = \eta_0 \gamma^k$ | 罕用 |
| **Cosine annealing** (Loshchilov 2017) | $\eta_k = \frac{\eta_{\min}}{2} + \frac{\eta_0 - \eta_{\min}}{2}(1 + \cos(\pi k/T))$ | LLM 训练默认 |
| **Cosine + warmup** | 见下 | LLaMA、GPT 风格 |
| **Linear warmup → linear decay** | 大批训练 | BERT |
| **OneCycle** (Smith 2018) | LR 与 momentum 各反相位 | 找极限 |

### 3.3 Warmup: 为什么 Transformer 必要

- **Post-LN Transformer** 的不稳定性根在: 初期参数随机初始化, attention 输出均值方差与训练末期差大; $\partial \mathcal{L}/\partial W$ 早期量级大 → "Adam 二阶矩估计 $v$ 累积慢", 大步引起不稳.
- Pre-LN 缓解这点 (所以 LLaMA 之类可以短 warmup), 但仍推荐.

**经典 cosine + warmup**:

```python
import math

def lr_schedule(step, warmup_steps, total_steps, base_lr, min_lr):
    if step < warmup_steps:
        return base_lr * step / warmup_steps           # linear warmup
    progress = (step - warmup_steps) / (total_steps - warmup_steps)
    progress = min(max(progress, 0.0), 1.0)
    return min_lr + 0.5 * (base_lr - min_lr) * (1 + math.cos(math.pi * progress))
```

> [!TIP]
> LLaMA-1/2/3 配方 (粗略): 基础 LR `3e-4` Pretrain, `2e-5` SFT, `1e-5` DPO. warmup 2000 steps, cosine decay 到 10%, weight decay 0.1, gradient clip 1.0, β1=0.9, β2=0.95.

### 3.4 Restart (SGDR) 与 Compound

**SGDR** (Loshchilov 2017): cosine 多次 restart 让跳出局部. 现代大模型少用, CV 小数据实战用.

### 3.5 LR 与 Batch Size 的 linear scaling rule

**经验法则**: batch $B \to kB$ 时 lr 也 $\eta \to k \eta$ (good up to a critical $B^*$, ~ 8K-16K tokens for GPT-style, 超过需要 sqrt scaling). 在 [Goyal et al. 2017] 的 ImageNet 工作里证实. LARS / LAMB 当超过 critical $B$ 时仍稳.

---

## 四、权重初始化

### 4.1 为什么不能全 0

全 0 (或全常数) ⇒ 同层所有神经元同梯度同更新 → 退化为单 neuron → 永远学不动. 必须打破对称.

### 4.2 Xavier (Glorot) init - 针对 $\tanh$

对 $y = W x$, $x, W$ iid $\sim \mathcal{N}(0, \sigma^2)$. $\operatorname{Var}(y) = d \sigma^2 \cdot \operatorname{Var}(x)$, 想 $\operatorname{Var}(y) = \operatorname{Var}(x)$ ⇒ $\sigma^2 = 1/d$.

→ 经典 Xavier: $W_{ij} \sim \mathcal{N}(0, 1/d_{\text{in}})$ 或 $U(-\sqrt{6/(d_{\text{in}} + d_{\text{out}})}, \ldots)$.

### 4.3 He (Kaiming) init - 针对 ReLU

ReLU 半数置 0, $\operatorname{Var}(\mathrm{ReLU}(y)) = \frac12 d \sigma^2 \operatorname{Var}(x)$ ⇒ 修 $\sigma^2 = 2/d_{\text{in}}$.

PyTorch:

```python
nn.init.kaiming_normal_(W, mode='fan_in', nonlinearity='relu')
```

### 4.4 Transformer 默认 $N(0, 0.02)$

原版 Vaswani 2017 用 $\sigma = 0.02$ 对所有权重 (除 embeddings, LayerNorm $\gamma = 1, \beta = 0$). 实测用 $d^{-1/2}$ scaling 或 He 等价.

### 4.5 μP (Yang 2022) - 让超参免调

最大痛点: pretrain 时一组 hyperparams 在 small model 上调好, 放到 70B 上 LR 不通适; μP (Maximal Update Parameterization) 设 init scale 与 lr 让"small → huge"不重新搜超参. LLaMA-2 70B 一些训练用 μP 思想.

### 4.6 Embedding init

- Embedding 通常 $\sim \mathcal{N}(0, 1/d)$, 让 token表示初始内积分布方免饱和.
- 输出 logits 一般 transpose embedding (`weight tying`), 减少 params + 改善训练.

---

## 五、训练稳定: 诊断 + 修复

### 5.1 健康的 loss 曲线

- **Pretrain LM**: 早期 loss 急降 (perplexity 从 30 → ~5); 中段慢降; 后期 plateau.
- **SFT**: loss 起步 low (因 instruction format → few-shot fine-tune), 微降.
- **值得警惕**: loss NaN 突跳 / loss 不降 / loss discrimination.

### 5.2 常见 NaN 排查

| 现象 | 可能原因 | 修复 |
|------|---------|------|
| 一启动就 NaN | init scale 太大 / softmax 没 log-sum-exp | 降 init $\sigma$ / 用 `F.cross_entropy` |
| Warmup 后 NaN | lr 跳太大 | 加 warmup; 减少 base_lr |
| 跨若干步偶 NaN | bf16 underflow / 数据混入 nan | 检查 data; 切 fp32-bf16 混合 |
| Loss 突跳几百 | gradient clip 没开 / step 过大 | clip 1.0; 降 batch 或 lr |
| 序列长升 NaN | RoPE 复频 overflow / KV cache quant error | patch position id, 用 fp32 |

### 5.3 梯度裁剪

实际 LLM 训练必开:

```python
torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
```

按全局 $L_2$ 范数裁剪: $g \leftarrow g \cdot \min(1, \tau / \|g\|)$. 防 batch 异常梯度爆炸.

### 5.4 梯度累积

显存不足 → 用累积模拟大 batch:

```python
optimizer.zero_grad()
for i, (x, y) in enumerate(loader):
    loss = model(x, y) / accum_steps
    loss.backward()
    if (i + 1) % accum_steps == 0:
        clip_grad_norm_(...)
        optimizer.step()
        optimizer.zero_grad()
```

效果等同 batch = `accum_steps × physical_batch`, 但训练时间 $O(\text{accum})$.

### 5.5 激活 checkpoint (回顾 backprop 章 §5)

trade 显存 vs 计算, 30-50% 显存换约 ~30% 时间. 大模型默认开.

### 5.6 EMA / SWA

- EMA: 存一份"权重指数滑动平均"用于评估, 训练用原参数. 提升稳定性.
- SWA (Stochastic Weight Averaging): 训练后周期负荷平均几 weights, 改善 final test acc.

---

## 六、分布式训练 (概览)

详见 TODO 的"大模型训练工程"章节, 这里只点关键事实:

### 6.1 数据并行 (DP)

每 GPU 持整模型, 各跑自己 batch, 反向后 all-reduce 平均梯度. 限制: 模型必须装下每卡.

### 6.2 ZeRO (Rajbhandari 2019) 三个阶段

| Stage | 分片 | 显存省 |
|-------|------|--------|
| ZeRO-1 | optimizer states (AdamW: $2n$ extra) | 4-8× |
| ZeRO-2 | + gradients | 8× |
| ZeRO-3 | + model weights | 到 N_devices 倍 |

ZeRO-3 让 >100B 训练在 8 × A100 = 640 GB 系统可行.

### 6.3 Pipeline / Tensor 并行

- **Pipeline**: 把层切分到 N 个 GPU, 跑 micro-batch + 1F1B schedule.
- **Tensor**: 在某一层内把矩阵乘切分 (列切 / 行切); Megatron-LM 经典.
- **Sequence Parallel**: 把 seq 维切成多 GPU 共跑 attention; Flash+长 context 共同用.

**Megatron-style** (3D parallel): 数据并行 + 流水线 + 张量并行组合, 大模型 pretrain 通用.

---

## 七、与第零部分的接口

- §1-2 优化器 ⇐ 第零部分微积分与优化 §5 (一阶优化器谱系), §3 (Newton/Hessian).
- §3 warmup ⇐ 第零部分微积分 §3 Hessian (初期二阶矩估计不稳), 概率 §2 方差累积慢的 variance of sample mean.
- §4 init ⇐ 第零部分线代 §5 范数 + 概率 §2 variance of linear combination.
- §5 NaN 排查 ⇐ 第零部分概率 §1 离散 / 连续与 fp 数值表示.
- §6 ZeRO ⇐ 与数学关系浅; 与 OS 并发 / 网络带宽 trade-off 更深.

---

## 八、最小可跑训练循环 (PyTorch)

```python
import torch
import torch.nn as nn
import math

def train_step(model, batch, optimizer, scheduler, accum_steps=1, max_grad=1.0):
    model.train()
    x, y = batch
    with torch.autocast(device_type='cuda', dtype=torch.bfloat16):
        logits = model(x)
        loss = nn.functional.cross_entropy(logits.view(-1, logits.size(-1)), y.view(-1),
                                            ignore_index=-1) / accum_steps
    loss.backward()
    if ((scheduler.steps + 1) % accum_steps == 0):
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_grad)
        optimizer.step()
        scheduler.step()
        optimizer.zero_grad(set_to_none=True)
    return loss.item() * accum_steps

class CosineWarmup:
    def __init__(self, optimizer, warmup, total, base, min_lr=0.0):
        self.opt, self.warmup, self.total = optimizer, warmup, total
        self.base, self.min_lr = base, min_lr; self.steps = 0
    def step(self):
        self.steps += 1
        if self.steps < self.warmup:
            lr = self.base * self.steps / self.warmup
        else:
            p = (self.steps - self.warmup) / (self.total - self.warmup)
            p = min(max(p, 0.0), 1.0)
            lr = self.min_lr + 0.5 * (self.base - self.min_lr) * (1 + math.cos(math.pi * p))
        for g in self.opt.param_groups: g['lr'] = lr
```

---

## 九、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **AdamW**: $m, v$ 二阶矩 + bias correction + 解耦 weight decay; LLM 默认.
> - **Sofia/Muon**: 近期研究方向, 尚未取替 AdamW.
> - **Warmup**: 初期二阶矩估计未稳, 必须避免大 step; Pre-LN 可短 warmup.
> - **Cosine + warmup + decay-to-min** 是 Llama 系列默认配方.
> - **init**: $\sigma^2 = 1/d_{\text{in}}$ (Xavier) for $\tanh/\sigma$; $2/d_{\text{in}}$ (He) for ReLU; Transformer $N(0, 0.02)$ or He 等价.
> - **LayerNorm** (Pre-LN): 现代默认, 防深 stack 梯消失.
> - **clip_grad_norm 1.0** 几乎必开.
> - **accumulation**: 显存不足时模拟大 batch.
> - **Checkpoint**: trade 计算换激活显存.
> - **NaN**: 查 init / softmax 数值 / RoPE / bf16 / 数据.
> - **ZeRO-3**: >100B pretrain 的标配.

---

下一篇: [5. Generative Models: VAE & ELBO / 扩散模型 / AR 采样 / speculative decoding](generative.md).
