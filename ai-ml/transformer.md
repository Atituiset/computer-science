# 3. Transformer: self-attention / MHA / FFN / LayerNorm / 残差 / Encoder-Decoder / 训练损失

## TL;DR

Transformer (Vaswani et al. 2017) 把 NLP 主流从 RNN 转向**纯 attention** + **前馈 + 残差 + 层归一化** 的堆叠栈. 这一章把可调组件拆到逐节点, 每个**给出公式 / 形状 / 反向梯度 / 工程坑**:

1. **Scaled Dot-Product Attention** — softmax + $\sqrt{d_k}$ 缩放的本质.
2. **Multi-Head Attention (MHA)** — 并行多头 = 多视角线性映射.
3. **FFN** — 两层 + 激活, 提供"逐 token 的非线性动量".
4. **LayerNorm + 残差** — 训练稳定的真因.
5. **Encoder / Decoder 差异** — Cross-attention 与 mask.
6. **位置编码** — Sinusoidal / ALiBi / RoPE 的差异 (概览, 详见 tokenizer-embedding 章节待补).
7. **训练损失** — next-token CE + label smoothing; 入门 RLHF 接口.

读完应能: 读《Attention Is All You Need》原文逐行不卡, 在 NumPy 上写出可前向反向的 attention + softmax + MHA.

---

## 一、Scaled Dot-Product Attention

### 1.1 公式

$$ \mathrm{Attention}(Q, K, V) = \mathrm{softmax}\left(\frac{Q K^\top}{\sqrt{d_k}}\right) V $$

形状: $Q \in \mathbb{R}^{T_q \times d_k}, K \in \mathbb{R}^{T_k \times d_k}, V \in \mathbb{R}^{T_k \times d_v}$.

- $Q K^\top \in \mathbb{R}^{T_q \times T_k}$: 每对位置的内积 = 相似度.
- softmax 沿 $T_k$ 轴 (键) 归一化 → 每行是 attention 权重.
- 乘 $V$: 加权平均 → 输出 $\in \mathbb{R}^{T_q \times d_v}$.

> [!NOTE]
> 这其实是**信息检索**的 soft 版本: $Q$ 是 query (查询), $K$ 是 key (索引), $V$ 是 value (内容). 硬版本是 $\arg\max$ 找最相似 key; 这里改成 softmax 加权, 以致可微 + 可微 + 反向传播.

### 1.2 为什么除 $\sqrt{d_k}$?

如果 $q, k \in \mathbb{R}^{d_k}$ 各分量 iid $\sim \mathcal{N}(0, 1)$, 那么点积 $q^\top k \sim \mathcal{N}(0, d_k)$, 方差与 $d_k$ 同阶. 当 $d_k = 64$ 时 dot 可达数十. 与 softmax 远大于 1 的输入 → 梯度极小 (饱和小区域), 训练不动.

除 $\sqrt{d_k}$ 让 $\mathrm{Var}(q^\top k / \sqrt{d_k}) = 1$, 等价让 softmax 工作在线性变化区间, 训练可启动.

> [!TIP]
> 进一步的解释是: softmax 的雅可比是 $J = \mathrm{diag}(s) - s s^\top$. 当 $s$ 近 one-hot (因为分数差很大) 时 $J \approx 0$ → 反向传不动.

### 1.3 反向梯度

已知 $\partial \mathcal{L}/\partial \mathrm{out} = G \in \mathbb{R}^{T_q \times d_v}$.

记 $S = QK^\top / \sqrt{d_k}$, $A = \mathrm{softmax}(S)$, $O = A V$.

公式 (用第零部分 §2.3 softmax 雅可比 + 几何):

```
∂L/∂A = G Vᵀ                 (T_q × T_k)
∂L/∂V = Aᵀ G                 (T_k × d_v)

dsoftmax 反向: ∂L/∂S = A ⊙ (∂L/∂A - (∂L/∂A · A.sum(axis=-1, keepdim=True)))

∂L/∂Q = (1/√d_k) (∂L/∂S) K   (T_q × d_k)
∂L/∂K = (1/√d_k) (∂L/∂S)ᵀ Q  (T_k × d_k)
```

NumPy 朴素实现:

```python
import numpy as np

def softmax_lastaxis(x):
    x = x - x.max(axis=-1, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)

def attention(Q, K, V, mask=None):
    d_k = Q.shape[-1]
    S = Q @ K.transpose(-2, -1) / np.sqrt(d_k)
    if mask is not None:
        S = np.where(mask, S, -1e9)
    A = softmax_lastaxis(S)
    O = A @ V
    return O, (S, A)             # 缓存以供反向

def attention_backward(grad_O, cache, Q, K, V, mask=None):
    S, A = cache
    d_k = Q.shape[-1]
    grad_A = grad_O @ V.transpose(-2, -1)                  # ∂L/∂A
    grad_V = A.transpose(-2, -1) @ grad_O                   # ∂L/∂V

    # softmax 反向 (沿 last axis)
    grad_S = A * (grad_A - (grad_A * A).sum(-1, keepdims=True))
    if mask is not None:
        grad_S = np.where(mask, grad_S, 0.0)

    grad_Q = grad_S @ K / np.sqrt(d_k)                      # ∂L/∂Q
    grad_K = grad_S.transpose(-2, -1) @ Q / np.sqrt(d_k)    # ∂L/∂K
    return grad_Q, grad_K, grad_V

# sanity shape 检查
T, d = 8, 64
Q = np.random.randn(T, d); K = np.random.randn(T, d); V = np.random.randn(T, d)
O, cache = attention(Q, K, V)
print(O.shape)              # (8, 64)
grad_Q, grad_K, grad_V = attention_backward(np.ones_like(O), cache, Q, K, V)
print(grad_Q.shape, grad_K.shape, grad_V.shape)   # (8,64) (8,64) (8,64)
```

### 1.4 Causal mask 与 padding mask

两类 mask 同时作用在 Decoder:

- **Padding mask**: 处理变长 batch padding, 把 padding 位 score = $-\infty$, 不让 attention 看到.
- **Causal mask**: 自回归生成时, 位置 $i$ 只能用到 $\leq i$ 的 key, 防"看未来". 上三角 $-\infty$.

**实现: 0/1 二值 mask, `S = S.masked_fill(~mask, float('-inf'))`**.

```typescript
// 教学版 attention (TypeScript)
export function softmaxLastAxis(x: number[][], axis = -1): number[][] {
  return x.map(row => {
    const m = Math.max(...row);
    const e = row.map(v => Math.exp(v - m));
    const Z = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / Z);
  });
}

export function attention(
  Q: number[][], K: number[][], V: number[][], mask?: boolean[][]
): number[][] {
  const T_q = Q.length, T_k = K.length;
  const d_k = Q[0].length;
  const S: number[][] = Array.from({ length: T_q }, () => Array(T_k).fill(0));
  for (let i = 0; i < T_q; i++)
    for (let j = 0; j < T_k; j++) {
      let s = 0;
      for (let k = 0; k < d_k; k++) s += Q[i][k] * K[j][k];
      S[i][j] = mask ? (mask[i][j] ? s / Math.sqrt(d_k) : -Infinity) : s / Math.sqrt(d_k);
    }
  const A = softmaxLastAxis(S);
  const d_v = V[0].length;
  const O: number[][] = Array.from({ length: T_q }, () => Array(d_v).fill(0));
  for (let i = 0; i < T_q; i++)
    for (let j = 0; j < T_k; j++) {
      const a = A[i][j];
      for (let k = 0; k < d_v; k++) O[i][k] += a * V[j][k];
    }
  return O;
}
```

---

## 二、Multi-Head Attention (MHA)

### 2.1 把单头分裂成 H 头

把 $Q, K, V$ 分别线性投影到 $d_k = d_v = d / H$ 维, 跑 **$H$ 个并行 attention**, 拼回 $d$ 维:

$$ \mathrm{MHA}(Q, K, V) = \mathrm{Concat}(\mathrm{head}_1, \ldots, \mathrm{head}_H) W^O $$
$$ \mathrm{head}_h = \mathrm{Attention}(Q W_h^Q, K W_h^K, V W_h^V) $$

### 2.2 工程缩撑

- 输入 $x \in \mathbb{R}^{T \times d}$.
- $W^Q, W^K, W^V \in \mathbb{R}^{d \times d}$. 一举投影出每头, 形状变换 `[B, T, H, d/H]` + transpose → `[B, H, T, d/H]`.
- 每头 attention 形状 `[B, H, T, T]` × `[B, H, T, d/H]` = `[B, H, T, d/H]`.
- 拼回 `[B, T, d]`, 再乘 $W^O \in \mathbb{R}^{d \times d}$.

### 2.3 为什么多头?

- 每头学不同关联模式: $H = 8$ 意味着并行学 8 路模式 (短距离 / 长距离 / 因果 / 等).
- 单头要表达多模式需 $\sqrt{d}$ 倍记忆, 多头等数存参但表达灵活度更高.

```python
import torch
import torch.nn as nn

class MultiHeadAttention(nn.Module):
    def __init__(self, d_model, n_heads):
        super().__init__()
        assert d_model % n_heads == 0
        self.h, self.dk = n_heads, d_model // n_heads
        self.WQ = nn.Linear(d_model, d_model, bias=False)
        self.WK = nn.Linear(d_model, d_model, bias=False)
        self.WV = nn.Linear(d_model, d_model, bias=False)
        self.WO = nn.Linear(d_model, d_model, bias=False)

    def forward(self, x, mask=None):
        B, T, D = x.shape
        # 把 D 拆 H × dk, 转为 [B, H, T, dk]
        Q = self.WQ(x).view(B, T, self.h, self.dk).transpose(1, 2)
        K = self.WK(x).view(B, T, self.h, self.dk).transpose(1, 2)
        V = self.WV(x).view(B, T, self.h, self.dk).transpose(1, 2)
        S = Q @ K.transpose(-2, -1) / (self.dk ** 0.5)    # [B, H, T, T]
        if mask is not None:
            S = S.masked_fill(~mask[:, None, None, :], float('-inf'))
        A = S.softmax(dim=-1)
        O = A @ V                                          # [B, H, T, dk]
        O = O.transpose(1, 2).contiguous().view(B, T, D)   # concat
        return self.WO(O)
```

> [!WARNING]
> 常见 bug: **忘了把维度 `.transpose` 把 head 维移到 batch 维**, `Q @ K.T` 会错认 T 维. PyTorch 用 `key_padding_mask` / `attn_mask` 双轴, 工程上要小心区分.

### 2.4 MHA 变体 (前沿, 仅概览)

| 名 | 出现年 / 出处 | 核心 |
|----|------|------|
| **MHA** (经典) | 2017 | 上面 |
| **MQA** (Multi-Query) | 2019 Shazeer | K/V 只共享一组, 推理快显存省 |
| **GQA** (Grouped-Query) | 2023 Ainslie | K/V 多头分组共享, MHA 与 MQA 折中 |
| **MLA** (Multi-head Latent) | 2024 DeepSeek-V2 | KV 压缩到 latent 向量再展开, 进一步省 KV cache |
| **FlashAttention** | 2022 Dao | 块化计算, 中间矩阵不物化在 HBM, 训练显存降一个数量级 |

> [!WARNING]
> FlashAttention **不改变数学公式**, 只改变 IO 访问: 把 $S = QK^\top$ 切块, softmax 在共享内存做 row-naive, 中间 intermediate 不写回 HBM. 这是工程上 LLM 训练从忍到可的关键.

---

## 三、Feed-Forward Network (FFN)

### 3.1 公式

两层 MLP, 升维再降维:

$$ \mathrm{FFN}(x) = \mathrm{Dropout}(\sigma(x W_1 + b_1) W_2 + b_2) $$

$$ W_1 \in \mathbb{R}^{d \times d_{ff}},\quad W_2 \in \mathbb{R}^{d_{ff} \times d},\quad d_{ff} \approx 4 d $$

- $\sigma$ 经典 ReLU, 现代 GELU / SwiGLU.
- 对每个位置独立应用 (无 T 维交互); attention 负责跨 token, FFN 负责单 token 加工.

### 3.2 SwiGLU 变体

$$ \mathrm{SwiGLU}(x) = \mathrm{Swish}(x W_1) \odot (x W_3) \cdot \mathbb{1}_{W_2} $$

LLaMA / PaLM 用 SwiGLU 把 FFN 变成 3 个权重矩阵 (而非 2 个), 实验报告 +性能. 实际工程通常 $d_{ff} \approx \frac{2}{3} \cdot 4d$ 以保持总参数相同.

### 3.3 FFN 在反向上的处理

就是经典 MLP + 矩阵 + 非线性, 反向用第零部分 §6 张量收缩 + §2 链式. 工程核心是 cuBLAS / cuDNN 的 GEMM 调优.

---

## 四、LayerNorm + 残差

### 4.1 LayerNorm 公式

$$ \mathrm{LN}(x) = \gamma \odot \frac{x - \mu}{\sqrt{\sigma^2 + \epsilon}} + \beta, \quad \mu = \overline{x}, \sigma^2 = \overline{(x - \mu)^2} $$

沿**特征维** (而非 batch 维) 归一化. 这就是 LayerNorm vs BatchNorm 的核心差.

| 维度 | 归一化轴 | 适合 |
|------|---------|------|
| Batch Norm | (batch, H, W) | CV, 固定 batch |
| Layer Norm | (hidden) | NLP, RNN, 变 batch |
| Instance Norm | (H, W) per instance | style transfer |
| Group Norm | (groups of channel) | 小 batch CV |

### 4.2 Pre-LN vs Post-LN

原版 Transformer 用 **Post-LN**: $y = \mathrm{LN}(x + \mathrm{Sublayer}(x))$.

现代 LLaMA / GPT-NeoX 用 **Pre-LN**: $y = x + \mathrm{Sublayer}(\mathrm{LN}(x))$.

> [!NOTE]
> Pre-LN 更易训深层, 因为残差路径上没 LN 减缓梯度. Post-LN 训超深需 warmup 谨慎 (易发散); Pre-LN 不需长 warmup.

### 4.3 残差为什么是必需的

第零部分 §7 反向 AD 中讲过: 残差留恒等通路使主梯度能跨多层回传. Transformer 堆叠 24-96 层, 没残差的话深到一定深度 loss 就停降 (类似 ResNet 早期遭遇的 plateau).

---

## 五、Encoder vs Decoder

### 5.1 Encoder (BERT 派)

- 双向 attention (没 causal mask).
- 模型目标: 上下文理解表示.

### 5.2 Decoder (GPT 派)

- 单向 causal mask.
- 模型目标: 自回归生成 $p(x_t | x_{<t})$.

### 5.3 Encoder-Decoder (原版 Transformer, T5 / BART)

附加 cross-attention:

$$ Q_d = W^Q_d \cdot H_d, \quad K_e = W^K_e \cdot H_e, \quad V_e = W^V_e \cdot H_e $$

decoder 的 query 与 encoder 的 key/value 相互注意力, 让 decoder 在每个生成步参考 encoder 全序列. 多用于机器翻译 / 总结.

---

## 六、位置编码

### 6.1 Sinusoidal (原版)

无位置 → attention 对输入顺序无感 (permutation-equivariant). 加位置:

$$ \mathrm{PE}_{t, 2k} = \sin(t / 10000^{2 k / d}), \quad \mathrm{PE}_{t, 2k+1} = \cos(t / 10000^{2 k / d}) $$

性质: $\mathrm{PE}_{t + \delta}$ 是 $\mathrm{PE}_t$ 的旋转, 可由线性投影组合 (sin $\to$ sin/cos 偏 shift).

### 6.2 Learned / ALiBi / RoPE (概览)

- **Learned**: 可学参数形状 `[T_max, d]` —— BERT 经典, 外推差.
- **ALiBi** (Press 2021): 没显式位置编码, 而是把"距离感"加在 attention bias 上, 偏置 $-|i - j| / \mathrm{head\_freq}$ —— 支持长序列外推.
- **RoPE** (Su 2021): 在复数空间旋转, 类 sinusoidal 但作为 query/key 的旋转; LLaMA / GPT-NeoX 默认, 外推好.
- **YaRN / LongRoPE**: RoPE 外插改进, 让 model 上 1M 上下文.

详见 tokenizer-embedding 章节 (TODO 待补).

> [!WARNING]
> 把 RoPE 只看作"加了位置的旋转"会错过细节: 它在 $d$ 维空间内 $d/2$ 个 2D 子空间各自不同频率. 反向时, RoPE 的反操作 (rotate by $-\theta_i$) 直接得回原 (无参).

---

## 七、训练损失与对齐入口

### 7.1 自回归语言模型损失

给定序列 $x_1, \ldots, x_T$, 对第 $t$ 步用前缀 $x_{<t}$ 预测 $x_t$:

$$ \mathcal{L}_{\text{LM}} = -\sum_{t=1}^{T} \log p_\theta(x_t | x_{<t}) $$

每个 $p_\theta$ 是从 logits 出来的 softmax, 反向梯度 = $s - \mathrm{onehot}(x_t)$ (第零部分 §3 softmax + CE 链式).

### 7.2 Label smoothing

把 one-hot $\to$ $(1 - \epsilon)$ 主类 + $\epsilon / (V-1)$ 其它. 工程意义: 防止 model 在 1.0 概率上撞晚, 改善 calibration. Perplexity 反会高一点点 (因 cross entropy 在非 one-hot 上变大), 但真实输出概率更可信.

### 7.3 Masked LM (BERT)

随机 mask 15% token, 在 mask 位预测. 让 encoder 单向变部分"完形填空". 训练效率更高 (一次训全部位置), 但不适合生成.

### 7.4 入口: SFT / RLHF (后面 RL 章会详谈)

- SFT (supervised fine-tune) = 在指令数据上继续 `next-token` CE 跑.
- RLHF (Reinforcement Learning from Human Feedback): 用 reward model + PPO 在 SFT 后对 generation 做策略优化, 让模型符合人类偏好. 详见今日待补的第 6 章 RL.

---

## 八、整体一张图

### 8.1 标准解码器层 (e.g. GPT-2)

```
        x (B, T, d)
        │
        ┌── Add & LN (Pre-LN)
        │     │
        │   [LN]
        │     │
        │   MHA (causal mask, RoPE 对应 Q,K)
        │     │
        │   Dropout
        │     │
        └── +  (residual)
              │
              x'
              │
        ┌── Add & LN
        │     │
        │   [LN]
        │     │
        │   FFN (GELU or SwiGLU)
        │     │
        │   Dropout
        │     │
        └── +  (residual)
              │
            输出 (B, T, d)
```

### 8.2 GPT 风格与 BERT 风格对比

| 维度 | BERT (encoder) | GPT (decoder) |
|------|---------------|---------------|
| attention | 双向 no mask | causal mask |
| 位置 | learned | learned / RoPE / ALiBi |
| 损失 | Masked LM + NSP | 自回归 LM |
| 用途 | 表示 / 分类 | 生成 |
| 训练 | 完形填空 | 预测下一 token |
| Tokenizer | WordPiece | BPE |

---

## 九、形状与显存速查

### 9.1 全 MLP + attention 的算量

GPT-3 规模: $L = 96, d = 12288, n_{heads} = 96, T = 2048$.

| 操作 | 计数 | FLOPs / token | 显存 |
|------|------|---------------|------|
| Attention $QK^\top$ | $L \cdot T \cdot d$ | $O(T d) = 25M$ | $O(T^2)$ = 4M bf16 = 8 MB |
| FFN (3 widen) | $L \cdot d \cdot d_{ff}$ | $O(d \cdot 4 d) = 600M$ | $O(d \cdot d_{ff})$ |
| 总 | ~$10^{11}$ params | ~ $10^{11}$ FLOPs / token | ~350 GB weights (bf16) |

### 9.2 flash 与 IO

- $S = QK^\top$ 物化到 HBM 显存 → $T^2$ 张量直写入 HBM, 大序列爆炸.
- FlashAttention 块化把 $T \times T$ 矩阵分块在 SRAM 计算与做 softmax 累加 (online softmax 从 running max + running sum 实现); 不物化中间 → 大 IO 节约.

---

## 十、与第零部分的接口

- §1 scaled dot-product ⇐ 第零部分线代 §7 余弦相似度 + §6 张量收缩.
- §1.2 $\sqrt{d_k}$ ⇐ 第零部分线代 §5 矩阵范数 + 概率 §2 方差.
- §1.3 反向 ⇐ 第零部分微积分 §3 Hessian + §2 雅可比.
- §2 MHA 形状 ⇐ 第零部分线代 §6 张量.
- §4 LayerNorm ⇐ 第零部分概率 §2 期望方差 + 线代 §1 内积.
- §3 / 5 / 6 是新内容, 几乎不依赖第零部分.

---

## 十一、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **核心公式**: $\mathrm{softmax}(QK^\top / \sqrt{d_k}) V$.
> - $\sqrt{d_k}$ 防 softmax 饱和, 让训练能启动.
> - **mask**: causal (下三角) + padding.
> - **MHA**: $H$ 个并行投影做 attention, concat + $W^O$; 错维度排错位置是常见 bug.
> - **FFN**: $d \to 4d \to d$, ReLU/GELU/SwiGLU; 对每个位置独立.
> - **Pre-LN**: $x + \mathrm{Sublayer}(\mathrm{LN}(x))$ (现代默认); Post-LN 需更长 warmup.
> - **残差**: 恒等通路把深可达梯度推回根.
> - **位置编码**: sinusoidal (原版) / learned / RoPE (现代 LLaMA, 长外推).
> - **训练损失**: next-token CE / masked LM; label smoothing 改 calibration.
> - **SFT/RLHF 入口**: SFT = CE 续训, RLHF = PPO 在 policy LM 上 (后面 RL 章).
> - **算量**: 注意力 $O(T d + T^2 d_k)$, FFN $O(d^2)$; FlashAttention 不改数学仅改 IO.

---

下一篇: [4. Optimizers & Training Dynamics: Adam/AdamW/二阶 + 初始化/LayerNorm/warmup/checkpoint](optimizers.md).
