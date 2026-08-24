# 10. 表示学习与对比学习: SimCLR / CLIP / InfoNCE

## TL;DR

有监督学习需要大量标注；**表示学习（Representation Learning）**目标是无标注或弱标注地学到"有用的特征向量"——让相似内容距离近、不相似内容距离远。**对比学习（Contrastive Learning）**是其中最强的方法：不学"这是什么"，而学"这两个是不是同一个东西"。这一章把 InfoNCE 损失、SimCLR、CLIP 讲透——它们是自监督（SSL）、多模态（图文）、向量检索（embedding 搜索）的基础。

读完应能：
1. 理解对比学习的三要素（锚点 / 正样本 / 负样本）和 InfoNCE 损失。
2. 讲清 SimCLR 的流程（增广 → 编码 → 投影 → InfoNCE），知道它为什么有效。
3. 讲清 CLIP 怎么把文本和图像拉进同一个空间，以及怎么用它做 zero-shot。
4. 说清对比学习和生成式/判别式的区别，以及各自局限。
5. 在代码里实现一个最简 SimCLR / InfoNCE。

---

## 一、从"识别"到"表示"

### 1.1 问题

- 分类学"狗"需要大量"狗"标签。
- 现实数据大多无标签（海量图片/文本/视频）。人工标注贵。

### 1.2 核心想法

> **不学"这是狗"，而学"这两张图是同一只狗 / 不同物体"。** 拉近正样本对、推开负样本对，让网络学会"什么内容相似"——得到的 embedding 可以直接迁移到下游（分类/检索/检测）。

### 1.3 三要素

```
Anchor  (锚点):   一张图 x
Positive (正):    x 的另一个增广/同语义样本 x+
Negative (负):    随机其他样本 x-
目标: anchor 与 positive 距离近, 与 negative 距离远
```

- 对比学习 = **在 embedding 空间里做"聚同斥异"**。
- 数学上是一个**度量学习**（metric learning）问题。

---

## 二、InfoNCE 损失（对比学习的心脏）

### 2.1 公式

$$ \mathcal{L}_{\text{InfoNCE}} = -\log \frac{\exp(\mathrm{sim}(z_a, z_+)/\tau)}{\sum_{i} \exp(\mathrm{sim}(z_a, z_i)/\tau)} $$

其中：
- $z_a, z_+, z_i$：anchor / 正样本 / 负样本（含正）的 embedding。
- $\mathrm{sim}(u,v) = \frac{u^\top v}{\|u\|\|v\|}$：余弦相似度。
- $\tau$：温度（temperature），控制分布的"锐度"。

### 2.2 直觉

- 分子：anchor 与正的相似度（要越大越好）。
- 分母：anchor 与"正 + 所有负"的相似度总和。
- 最小化损失 = **让正的相对相似度最大** → 等价于一个多分类 softmax，"正样本"是一类，负样本是其他类。

> [!NOTE]
> InfoNCE 本质是** softmax 分类**：给定 anchor，从"1 个正 + N 个负"里挑出正样本。它和 §1 逻辑回归 / softmax 分类是同一族——只是"类别"被定义为"样本对的正负"。

### 2.3 温度 τ 的作用

- $\tau$ 小 → softmax 更尖（只认最相似的）→ 对难负样本敏感，但容易过拟合。
- $\tau$ 大 → 更平滑 → 允许更多样本有贡献。
- 经典值：0.07 ~ 0.1。

### 2.4 为什么叫 NCE

- **NCE**（Noise Contrastive Estimation，Gutmann & Hyvärinen 2010）：把"估计密度"转化为"区分真实样本和噪声样本"的二分类。
- **InfoNCE**（Oord 2018，CPC）是 NCE 在表示学习里的应用：用互信息下界作为目标。

---

## 三、SimCLR（2020，视觉自监督代表作）

### 3.1 流程

```
原始图 x
  ├─ 增广 t1 → x1
  └─ 增广 t2 → x2        (同一个 x 的两种视角)

编码器 f: x → h          (ResNet, 提取特征)
投影头 g: h → z          (小 MLP, 映射到对比空间)

InfoNCE 在 batch 内:
  对每个样本 i: anchor=z_i¹, 正=z_i², 负=其他所有样本的 z (2N-2 个)
   → 一个 batch 天然提供 2N 个"视图", 组内互为负样本
```

### 3.2 关键设计决策

| 组件 | 为什么 |
|------|--------|
| **随机增广**（裁剪/翻转/颜色扰动/模糊） | 提供"同一物体不同视角"，是正样本的来源 |
| **投影头 g（非线性 MLP）** | 去掉它性能大降——投影空间里做对比，特征空间保持表达力 |
| **batch 内负样本** | 免负样本挖掘；batch 越大效果越好 |
| **温度 τ** | 控制难负样本权重 |

### 3.3 为什么有效（直觉）

- 增广制造"必须忽略表面变化、保留语义"的任务：模型被迫学"不变特征"。
- InfoNCE 让表示在"同一物体 → 近，不同物体 → 远"上对齐。
- 学到的表示**迁移性好**：拿去分类只需少量标注即可微调出高性能。

### 3.4 局限

- 依赖**强增广**（视觉成立，语言/图结构难做）。
- **负样本质量**关键：batch 太小负样本不够 → 效果差；需要大 batch（SimCLR 用 4096）。
- 对比学习的"捷径"：模型可能靠"颜色/背景"区分正负，不学语义。

---

## 四、CLIP（2021，图文多模态）

### 4.1 核心想法

把**文本和图像拉进同一个 embedding 空间**，用配对数据（图像-描述文本）做对比学习。

```
图像 x   → 图像编码器 → z_i
文本 t   → 文本编码器 → z_t
目标: 配对的 (x, t) 距离近, 非配对距离远 (InfoNCE, 对称)
```

### 4.2 流程（对比图文对）

```
一个 batch 有 N 对 (图像, 文本)
图像编码: z_img = f_img(x)      (ViT / ResNet)
文本编码: z_text = f_text(t)    (Transformer)
对比: 对称 InfoNCE
  L_img = -log exp(sim(z_i, t_i)/τ) / Σ exp(sim(z_i, t_j)/τ)
  L_text = 同理(以文本为 anchor)
  L = (L_img + L_text) / 2
```

- 配对（diagonal）是正样本，batch 内其他都是负样本。
- 用大规模网络爬虫图文对（4 亿对）训练。

### 4.3 Zero-shot 分类（CLIP 的杀手锏）

```
要分类"猫/狗/鸟":
1. 造文本模板: "a photo of a cat", "a photo of a dog", "a photo of a bird"
2. 图像编码: z_img
3. 文本编码: z_cat, z_dog, z_bird
4. 预测 = argmax sim(z_img, z_class)
```

**不需要任何训练样本**——因为文本描述和图像被拉进了同一空间，图像和"正确的类名文本"自然最接近。

### 4.4 价值与应用

- **多模态对齐**：图像检索文本 / 文本检索图像。
- **zero-shot 分类 / 检测 / 分割**（CLIP 做 backbone）。
- **生成模型对齐**：Stable Diffusion 的文本编码器用的就是 CLIP 文本分支。
- 缺点：对抽象/罕见概念弱；对增广不鲁棒；训练要海量图文对。

---

## 五、与其他范式的对比

### 5.1 三种学习范式

| | 判别式（分类） | 生成式（VAE/扩散/AR） | 对比式（InfoNCE） |
|---|---|---|---|
| 目标 | P(y|x) | P(x) | 相似/不相似 |
| 需要标签 | 需要 | 不需要 | 不需要（自监督） |
| 学到什么 | 分类边界 | 数据分布 | 相似性表示 |
| 代表 | ResNet 分类 | DDPM / GPT | SimCLR / CLIP |
| 优点 | 简单 | 能生成 | 表示迁移性好 |
| 局限 | 标签贵 | 训练贵、难控制 | 依赖增广/负样本 |

### 5.2 与自监督的关系

```
自监督 (Self-Supervised Learning): 无标签，用数据自身构造监督
  ├─ 对比式: InfoNCE (SimCLR / CLIP)     ← 本章
  ├─ 生成式: MAE (mask 重建) / 扩散
  └─ 预训练式: 自回归 (GPT 的 next-token)
```

---

## 六、代码实现（最简 SimCLR / InfoNCE）

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

def info_nce_loss(z1, z2, temperature=0.1):
    """z1, z2: [N, D] 同 batch 的两组增广 embedding"""
    z1 = F.normalize(z1, dim=-1)
    z2 = F.normalize(z2, dim=-1)
    N = z1.size(0)

    # 拼接: [2N, D], 每对 (i, i+N) 是同一图像的两个视图
    z = torch.cat([z1, z2], dim=0)                 # [2N, D]
    sim = z @ z.T / temperature                    # [2N, 2N] 相似度矩阵
    mask = torch.eye(2 * N, dtype=torch.bool)      # 自己 vs 自己

    # 对每个 i: 正样本是它的另一个视图
    labels = torch.cat([torch.arange(N, 2*N), torch.arange(0, N)])  # i 的正 = i+N
    sim[..., mask] = -float("inf")                 # 排除自身
    return F.cross_entropy(sim, labels)
```

```python
# 应用示例: 简单图像编码器 + 投影头 (PyTorch)
class SimCLRHead(nn.Module):
    def __init__(self, d_in=512, d_proj=128):
        super().__init__()
        self.proj = nn.Sequential(
            nn.Linear(d_in, d_proj),
            nn.ReLU(),
            nn.Linear(d_proj, d_proj),
        )
    def forward(self, h):          # h: [N, d_in]
        return self.proj(h)        # [N, d_proj] 投影后做对比
```

```typescript
// 教学版 InfoNCE (TypeScript, 数值近似)
export function infoNCE(
  z1: number[][], z2: number[][], temperature = 0.1,
): number {
  // 归一化 + 算余弦相似度 → cross-entropy
  const norm = (v: number[]) => {
    const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map(x => x / n);
  };
  const A = z1.map(norm), B = z2.map(norm);
  const sim = (u: number[], v: number[]) =>
    u.reduce((s, x, i) => s + x * v[i], 0);
  let loss = 0;
  for (let i = 0; i < A.length; i++) {
    const positives = [sim(A[i], B[i]) / temperature];
    const negatives = [];
    for (let j = 0; j < A.length; j++) {
      if (j !== i) {
        negatives.push(sim(A[i], A[j]) / temperature);
        negatives.push(sim(A[i], B[j]) / temperature);
      }
    }
    const all = positives.concat(negatives);
    const max = Math.max(...all);
    const exps = all.map(x => Math.exp(x - max));
    const denom = exps.reduce((a, b) => a + b, 0);
    loss += -(exps[0] / denom) * Math.log(exps[0] / denom) ? -Math.log(exps[0] / denom) : 0;
    loss += -Math.log(exps[0] / denom);   // NLL of positive
  }
  return loss / A.length;
}
```

---

## 七、进阶与前沿（概览）

| 方向 | 代表 | 思路 |
|------|------|------|
| 负样本 free | BYOL (2020) / SimSiam (2021) | 去掉负样本，只对齐正对，靠 stop-gradient 防崩溃 |
| 弱正样本 | MoCo (2019) | 动量编码器 + 队列维护大量负样本 |
| 多模态 | CLIP / ALIGN / SigLIP | 图文对对比，zero-shot 强 |
| 语言对比 | Sentence-BERT / SimCSE | 句子 embedding 对比（dropout 作增广） |
| 图对比 | GraphCL / GCC | 图增广（删边/掩码） |
| 音频/时序 | CPC / wav2vec | 预测未来/掩码段的对比 |

> [!NOTE]
> BYOL / SimSiam 证明"对比"甚至可以没有负样本——关键是**正对的对齐 + 防表示坍缩**（stop-gradient）。这说明 InfoNCE 的"推开负样本"是充分非必要，对齐本身更重要。

---

## 八、与第零部分 + 前章的接口

- InfoNCE = softmax 多分类 → 概率 §3（multinomial）+ foundations §2（softmax CE）。
- 温度 τ / 相似度 → 线代 §1（余弦/内积）。
- embedding 空间 → 线代 §1（向量空间）+ tokenizer §5（embedding 表）。
- 与自监督/GPT next-token → generative §2（AR）。
- 与对比损失在推荐/检索 → 可用在 RAG 向量检索（DB vector）。

---

## 九、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **表示学习**：学"什么相似"而非"这是什么"；embedding 迁移到下游。
> - **InfoNCE** = 1 正 N 负的 softmax；`-log exp(sim(a,+)/τ) / Σexp(sim(a,i)/τ)`。
> - **三要素**：anchor / 正 / 负；负样本质量 + 数量关键。
> - **SimCLR**：增广 → 编码 → 投影头 → batch 内 InfoNCE；投影头必不可少。
> - **CLIP**：图像+文本进同一空间；配对对对比；zero-shot 分类 = 文本模板对比。
> - **温度 τ**：小更锐（难负敏感），经典 0.07-0.1。
> - **无负样本**：BYOL/SimSiam 靠 stop-gradient 防坍缩。
> - **对比 vs 生成**：对比学相似性（好迁移）、生成学分布（能生成）。

---

下一篇: [形式化方法卷 README](../formal/README.md).
