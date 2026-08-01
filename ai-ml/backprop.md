# 2. Backpropagation: 计算图 / 反向模式 AD / 雅可比链式 / 梯度检查

## TL;DR

反向传播不是一种"特殊算法", 它是**多变量链式法则在计算图上沿拓扑逆序执行**的形式, 配上"中间结果缓存"就成 O(参数数) 的反向模式自动微分 (reverse-mode AD). 数学已在 [第零部分微积分 §2 雅可比链式](../math/calc-opt.md) 准备好, 这里把它落到工程:

1. **计算图** — 把网络表成 DAG, loss 在根, 参数在叶.
2. **正向 AD vs 反向 AD** — 一阶 O(n) vs 一阶乘 O(1) 评估全部参数.
3. **链式法则矩阵化** — 雅可比的链式 + softmax / CE / 线性 / 卷积的逐节点局部雅可比.
4. **梯度检查** — 解析梯度 vs 数值有限差分, 工程上线性传第一件事.
5. **常见坑** — 梯度消失/爆炸, checkpoint, mixed precision, 反向 release 顺序.

读完应能: 给一个网络能徒手画计算图、写每个节点的局部雅可比形状, 并在 NumPy 上跑通 `grad_check()`.

---

## 一、为什么"反向"而不是"正向"

### 1.1 数值导数直接定义

$$ \frac{\partial f}{\partial x_i} = \lim_{h \to 0} \frac{f(x + h e_i) - f(x)}{h} $$

对 $\boldsymbol x \in \mathbb{R}^n$: 算全部梯度需要 **$n$ 次** $f$ 评估 (扰一维 ($e_i$), 评估 $f$). 神经网络参数 $n \sim 10^9$, 显然不可行.

### 1.2 前向模式 AD (dual numbers)

每变量携带一阶梯度 $(v, \dot v)$, $\dot v$ 沿计算传播. 一次前向算出 $f$ 与 $\nabla f$ 在**一个方向** $\dot{\boldsymbol x}$ 上的方向导数 $\nabla f \cdot \dot{\boldsymbol x}$.

→ 算**全梯度**需要 $n$ 次前向 AD, 与数值差分同阶. 适合 $f: \mathbb{R}^n \to \mathbb{R}^m$ 且 $m \gg n$ (雅可比列方向少).

### 1.3 反向模式 AD (链式法则逆序)

**核心**: 链式法则可写为 $\dfrac{\partial \mathcal{L}}{\partial \boldsymbol x} = J_g(\boldsymbol x)^\top \dfrac{\partial \mathcal{L}}{\partial g(\boldsymbol x)}$.

一次反向**算出 loss 对所有参数的梯度**, 与参数数量同阶 (节点的入边数之和). 适合 $f: \mathbb{R}^n \to \mathbb{R}$ (深度学习损失正是这种).

| 维度 | 前向 AD | 反向 AD |
|------|---------|---------|
| 一次算什么 | 1 个方向导数 $\nabla f \cdot v$ | 全部 $\nabla f$ ($n$ 个分量) |
| 算全部梯度开销 | $O(n)$ 次前向 | **$O(1)$ 次反向** |
| 中间结果保存 | 不必 | **必须** (前向激活值) |
| 适合 | $n \ll m$ | $m \ll n$ ✓ 深度学习 |

> [!NOTE]
> PyTorch / TensorFlow / JAX 默认都是反向模式. 这也是为什么前向计算必须做 cache (`x.requires_grad_(True)` 后激活保留)、`torch.no_grad()` 跳过 cache 节省显存.

### 1.4 简短历史

- 1970 Seppo Linnainmaa 硕士论文第一次写出自适应反向 AD.
- 1974 Paul Werbos 博士论文描述反向传播用于神经网络.
- 1986 Rumelhart, Hinton, Williams 在 *Nature* 推广为现代深度学习训练基础.
- 1991-1992 Schmidhuber 与 Hochreiter 实证证明可解 vanishing gradient, 推出 LSTM.

---

## 二、计算图

### 2.1 网络的 DAG 表示

每个操作 $f = \mathrm{op}(x, y)$ 是图中的节点, 变量 $x, y, f$ 是边. 叶子是输入 / 参数, 根是 loss.

**例: $L = (\sigma(Wx + b) - y)^2$**

```
        L = ||e||^2            (root)
            │
           (e)^2  → (e)        (e = p - y)
                       │
                      (p = σ(z))
                              │
                           (z = Wx + b)
                              │
                ┌─────────────┴────────┐
              (Wx)   b                x, W
```

反向 (即拓扑逆序):

```
∂L/∂e = 2 e
∂L/∂p = ∂L/∂e · 1         (因为 e = p - y)
∂L/∂z = ∂L/∂p · σ'(z)     (链式 + 局部雅可比)
∂L/∂W = ∂L/∂z · x^T       (因为 z = Wx, J = x^T 见 §3.1)
∂L/∂x = ∂L/∂z · W         (对输入的梯度, 如要链下层)
```

### 2.2 形状规则速记

设上游梯度 (loss 对当前 op 输出的梯度) 形状为 $G$, 则:
- $z = W x$ ($x \in \mathbb{R}^d, z \in \mathbb{R}^h, W \in \mathbb{R}^{h \times d}$):
  - $\partial \mathcal{L}/\partial W = G \cdot x^\top$ 形状 $h \times d$
  - $\partial \mathcal{L}/\partial x = W^\top \cdot G$ 形状 $d$
- $z = X W$ ($X \in \mathbb{R}^{n \times d}, W \in \mathbb{R}^{d \times h}$, $z \in \mathbb{R}^{n \times h}$):
  - $\partial \mathcal{L}/\partial W = X^\top \cdot G$ 形状 $d \times h$
  - $\partial \mathcal{L}/\partial X = G \cdot W^\top$ 形状 $n \times d$

→ "丢掉与目标不同的轴, 再配上另一输入的转置"是工程上速记.

### 2.3 PyTorch 计算图实战

```python
import torch
x = torch.randn(8, requires_grad=True)        # 输入
W = torch.randn(4, 8, requires_grad=True)     # 参数
b = torch.randn(4, requires_grad=True)
z = W @ x + b                                  # 正向 → 4 维
p = torch.sigmoid(z)                           # 同形
y = torch.tensor([1.0, 0.0, 1.0, 0.0])
L = ((p - y) ** 2).sum()
L.backward()                                   # 反向; 隐式拓扑逆序

print(x.grad.shape)   # torch.Size([8])
print(W.grad.shape)    # torch.Size([4, 8])
print(b.grad.shape)    # torch.Size([4])
```

> [!WARNING]
> PyTorch 默认 reverse-mode AD + 即时执行 (eager). 计算图每次 `forward` 重构, `backward()` 后释放. 用 `torch.compile` (PT 2.0+) 才会做算子融合 + 持久图优化.

---

## 三、逐节点的局部雅可比

### 3.1 仿射变换 $z = W x + b$

回忆 $\partial \mathcal{L} / \partial z = g$ 已传到.

$$ \frac{\partial \mathcal{L}}{\partial W} = g \cdot x^\top, \quad \frac{\partial \mathcal{L}}{\partial x} = W^\top g, \quad \frac{\partial \mathcal{L}}{\partial b} = g $$

### 3.2 Sigmoid / Tanh

| 前向 | 反向局部梯度 |
|------|-------------|
| $\sigma(a)$ | $\sigma(1 - \sigma)$ |
| $\tanh a$ | $1 - \tanh^2 a$ |
| $\mathrm{ReLU}(a)$ | $\mathbb{1}_{a > 0}$ |
| $\mathrm{GELU}(a) = a\Phi(a)$ | $\Phi(a) + a \phi(a)$ |
| $\mathrm{SiLU}(a) = a \sigma(a)$ | $\sigma(a) + a \sigma(a)(1 - \sigma(a))$ |

### 3.3 Softmax + 交叉熵 (合算)

前向: $z \xrightarrow{\mathrm{softmax}} s \xrightarrow{\mathrm{CE}_y} \ell$.

反向 (链式 + 第零部分 §2.3):

$$ \frac{\partial \ell}{\partial z_i} = s_i - \mathbb{1}[i = y] $$

→ 一条公式就是 logistic 二元版的推广 (二类时 $s_i - \mathbb{1}[i = y]$ 与 $\hat p - y$ 同).

> [!TIP]
> 反向 AB 工程惯例: **softmax 与 CE 在 backward 里合算** (不显式 $J \cdot \hat{s}$), 因为 $s_i - \mathbb{1}$ 可一步出. 这就是为什么 PyTorch `F.cross_entropy(logits, y)` 而不是 `F.cross_entropy(F.softmax(logits), y)` —— 前者数值稳定 (含 log-sum-exp 防 exp overflow) 且 backward 简洁.

### 3.4 残差 $y = x + f(x)$

$$ \frac{\partial \mathcal{L}}{\partial x} = g + \frac{\partial \mathcal{L}}{\partial y} \cdot \frac{\partial f(x)}{\partial x} $$

即"两边梯度都加到 $x$". 这是 ResNet / Transformer 残差链 (深网络可训) 的数学根.

### 3.5 Layer Normalization

$y_i = \gamma \cdot \frac{x_i - \mu}{\sqrt{\sigma^2 + \epsilon}} + \beta$, $\mu = \overline{x}, \sigma^2 = \overline{(x - \mu)^2}$.

反向雅可比较繁 (因 $\mu, \sigma^2$ 都依赖 $x$ 的所有维). 工程上 PyTorch 已有 `nn.LayerNorm` 优化算子. 数学上记住"反向后 $g_{\text{in}} = \frac{\gamma}{\sigma} \cdot (g_{\text{out}} - \mathrm{proj}_{\text{norm 方向}})$"的存在即可.

### 3.6 卷积

$(I * K)[i, j] = \sum_{a, b} I[i + a, j + b] \cdot K[a, b]$. 反向梯度即为"互相关". 速记: 卷积的反向是扩边后的"恢复原输入与卷积核各自梯度".

工程上 cuDNN 用 winograd / FFT 加速, 反向与前向共享 kernel 配置.

---

## 四、梯度检查 (Gradient Checking)

### 4.1 何时必须

- 自己写自定义算子或损失: **上线前必做**.
- 调通训练前 sanity check, "loss 不降" 第一定位手段.
- 论文复现, attention/autoregressive mask 容易错位.

### 4.2 工程标准

数值中心差分:

$$ g_i^{\text{num}} = \frac{f(\theta + h e_i) - f(\theta - h e_i)}{2 h} $$

取 $h = 10^{-5}$ (float64 必需), $\epsilon = 10^{-7}$:

$$ \text{rel-error} = \frac{\|g_{\text{num}} - g_{\text{ana}}\|}{\|g_{\text{num}}\| + \|g_{\text{ana}}\|} $$

阈值: < $10^{-7}$ 通过, < $10^{-4}$ 警告, $\geq 10^{-3}$ 失败.

### 4.3 实现 (NumPy)

```python
import numpy as np

def grad_check(f, theta, analytic_grad, h=1e-5, eps=1e-7, num=10):
    # 抽样若干维 (避免全维度 O(n) 太贵)
    rng = np.random.RandomState(0); idx = rng.choice(theta.size, size=num, replace=False)
    g = analytic_grad(theta).ravel()           # 解析
    max_rel = 0.0
    for i in idx:
        t1 = theta.copy().ravel(); t1[i] += h
        t2 = theta.copy().ravel(); t2[i] -= h
        g_num = (f(t1.reshape(theta.shape)) - f(t2.reshape(theta.shape))) / (2 * h)
        rel = abs(g_num - g[i]) / (abs(g_num) + abs(g[i]) + 1e-12)
        max_rel = max(max_rel, rel)
    print(f"max rel error = {max_rel:.2e}")
    return max_rel < eps

# 示例: 验证 softmax + CE 反向
def softmax_ce(logits, y):
    z = logits - logits.max(axis=-1, keepdims=True)
    e = np.exp(z); s = e / e.sum(axis=-1, keepdims=True)
    return -np.log(s[..., y] + 1e-12).sum()

def softmax_ce_grad(logits, y):
    z = logits - logits.max(axis=-1, keepdims=True)
    e = np.exp(z); s = e / e.sum(axis=-1, keepdims=True)
    s[..., y] -= 1
    return s

logits = np.random.randn(8, 10)
y = np.random.randint(0, 10, size=8)
ok = grad_check(lambda L: softmax_ce(L, y), logits, lambda L: softmax_ce_grad(L, y))
print(f"grad check passed: {ok}")
```

> [!WARNING]
> float32 下中心差分只到 $10^{-4}$ 量级. 验证时一律先 `dtype=np.float64`, 否则会以为自己代码错误但实际只是数值精度.

### 4.4 常见误差来源

1. **softmax 数值溢出**: 没 `logits - logits.max()` 时 $e^{1000} \to \infty$.
2. **mixing dtypes**: `int8 * float32` 在 numpy 自动降到 float, 梯度 dtype 突然不一致.
3. **batch/seq 维错位**: attention mask 把 padding 当真位反向.
4. **non-differentiable points**: ReLU 在 0 不可导, $|x|$ 在 0 也是; 数值与解析都会卡 subgradient 不唯一.
5. **in-place ops**: NumPy 的 `arr += 1` 改原数组会破坏 PyTorch 自动版本追踪.

---

## 五、内存与显存: checkpoint

### 5.1 反向 AD 的代价

必须保存前向中间激活, 才能反向算雅可比. 深网络激活 ≈ `层数 × 隐维 × 序列长`. 显存成为瓶颈.

**例**: GPT-3 175B 推理单序列, 单 batch, fp16: 权重 350 GB (Google TPU pod), 激活与 KV cache 又数十 GB.

### 5.2 Gradient Checkpointing (Chen 2016)

舍激活重新计算: 仅在分块边界保存激活, 反向时重新前向子段. 节省 $\sim 30-50\%$ 显存, 多 30-50% 计算. 大模型训练 + 微调默认开.

```python
# PyTorch API: torch.utils.checkpoint
from torch.utils.checkpoint import checkpoint

class TransformerEncoderLayer(nn.Module):
    def forward(self, x):
        return checkpoint(self._inner, x, use_reentrant=False)
```

### 5.3 激活重计算 vs KV cache

训练时: 激活与梯度都需, 反传必须; checkpoint 用来 trade 计算换显存.

推理 (自回归生成) 时: 上一 token 的 K, V 要保留供下一 token 注意力复用, 这就是 **KV cache**. 这是 LLM 推理显存的主要占用, 量化压缩的入口.

---

## 六、混合精度

### 6.1 fp16 / bf16 / fp8

| dtype | bits(mantissa/exp) | 范围 | 精度 | 用法 |
|-------|------|------|------|------|
| fp32 | 24/8 | $10^{\pm 38}$ | 7 位 | 默认训练 |
| fp16 | 10/5 | $10^{\pm 5}$ | 3 位 | 范围窄, 易溢出; 需 loss scaling |
| bf16 | 7/8 | $10^{\pm 38}$ | 2 位 | 范围同 fp32, 精度低; A100/H100 推荐 |
| fp8 (H100) | 4/3 (E4M3) / 5/2 (E5M2) | | | 跨厂商变体, 训练小心翼翼 |

### 6.2 混合精度套路

- 主权重 fp32 存, 计算转 fp16/bf16:
  ```python
  scaler = torch.cuda.amp.GradScaler()
  with torch.autocast(device_type='cuda', dtype=torch.bfloat16):
      y = model(x); loss = criterion(y, t)
  scaler.scale(loss).backward(); scaler.step(optimizer); scaler.update()
  ```
- bf16 不需 loss scaling, fp16 需要 (防小梯度下溢).

### 6.3 数值陷阱

- softmax 必须用 fp32 计算 (log-sum-exp 内部, 跨指数差大).
- 累加归一化 (Layer Norm 的方差累加) 用 fp32 防 trip.
- 损失反向梯度常用 fp32 综合.

---

## 七、vanishing / exploding gradient

### 7.1 数学根

深网络反向: $\partial \mathcal{L}/\partial x_0 = \prod_{l=1}^{L} W_l^\top D_l$ 其中 $D_l = \mathrm{diag}(\sigma'(z_l))$.

- 乘积的谱 $\rightarrow 0$ (vanishing) ⇔ $\max |W \sigma'| < 1$ 典型: sigmoid $\sigma' \leq 0.25$.
- $\rightarrow \infty$ (exploding) ⇔ 反之.

### 7.2 工程对策

| 手段 | 解决 | 出处 |
|------|------|------|
| **ReLU / GELU** | 偏向大梯度 | Nair 2010 |
| **Xavier / He init** | 让 $|W\sigma'| \sim 1$ | Glorot 2010 / He 2015 |
| **Batch Norm / Layer Norm** | 归一化中间激活 | Ioffe 2015 |
| **残差连接** $y = x + f(x)$ | 梯度直接通路 $\partial y/\partial x \geq 1$ | He 2016 ResNet |
| **Gradient clipping** | clip 全局范数 $\|g\| \leq \tau$ | Pascanu 2013 |
| **LSTM / GRU** | 设记忆 cell 有加门 | Hochreiter 1997 |
| **Adam / RMSprop** | 学习率自适应 | Kingma 2014 |

> [!NOTE]
> Transformer 用了: (1) Layer Norm, (2) 残差, (3) GELU, (4) Adam + warmup, (5) Xavier init → **这套组合正是为了反抗深 stack 的 vanishing/exploding**.

### 7.3 残差连接的"梯度高速公路"

$y = x + f(x) \Rightarrow \frac{\partial \mathcal{L}}{\partial x} = g + J_f^\top g$. **至少有 "1" 的恒等通路**, 无论 $f$ 怎么退化, 主梯度仍能回传. 这就是为什么 ResNet-152 比经典 30 层 net 可训.

---

## 八、与第零部分的接口

- §1 反向 vs 前向 AD ⇐ 第零部分微积分 §2.5 自动求导.
- §2 形状规则 ⇐ 第零部分线代 §6 张量收缩 (Einstein 缩写).
- §3.3 softmax + CE ⇐ 第零部分 §2.3 softmax 雅可比.
- §3.4 残差 ⇐ 第零部分 §6 张量收缩 + 链式.
- §3.5 LayerNorm ⇐ 第零部分线代 §5 正定 + 概率期望.
- §5 checkpoint ⇐ 工程权衡, 无数学新内容.
- §6 mixed precision ⇐ 第零部分概率数值范围无直接, 这是硬件层.
- §7 vanishing ⇐ 第零部分线代 §3 谱半径.

---

## 九、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **链式**: $\partial(f \circ g)/\partial \boldsymbol x = J_g^\top \nabla f$.
> - **反向 AD**: 一次反传 = 全梯度, O(节点 + 边), 必须存激活.
> - **形状**: $z = xW \Rightarrow \partial\mathcal{L}/\partial W = x^\top g$, $\partial\mathcal{L}/\partial x = g W^\top$.
> - **softmax+CE**: $\partial \mathcal{L}/\partial \text{logits} = s - \text{onehot}$; PyTorch 用 `cross_entropy(logits, y)`.
> - **残差**: $y = x + f(x) \Rightarrow \partial\mathcal{L}/\partial x = g + \partial f/\partial x \cdot g$ (恒有 1 通路).
> - **梯度检查**: float64, $h=10^{-5}$, 中心差分 rel err < $10^{-7}$.
> - **mixed precision**: 主权重 fp32, 计算 bf16 (推荐); fp16 需 loss scaling.
> - **gradient checkpoint**: trade 显存 vs 计算; 大模型默认开.
> - **vanishing/exploding**: 改激活 (ReLU/GELU) + init (He/Xavier) + norm + 残差 + clip + Adam.

---

下一篇: [3. Transformer: self-attention / MHA / FFN / LayerNorm / 残差 / Encoder-Decoder / 训练损失](transformer.md).
