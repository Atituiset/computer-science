# 12. 多模态: 跨注意力 / Flamingo / LLaVA / BLIP-2 / 扩散多模态

## TL;DR

 Transformer 让语言有了统一的"token → embedding → attention"骨架，多模态只剩两件事：**把别的模态编码成向量序列**、**想办法把它和语言对齐**。这一章把三大代表路线讲透：(1) ** reservation-based**（ViT 把图像切块当 token 直接进 LLM，LLaVA）；(2) **cross-attention**（在 LLM 中插额外 K/V 接图像特征，Flamingo / BLIP-2）；(3) **diffusion-based**（文本→图像/视频/音频，Stable Diffusion / DiT）。它们是 GPT-4V / Gemini / Claude-V / Claude-3.5-Sonnet / 多模态 RAG / Sora / 语音模型背后的同一组抽象。

读完应能：
1. 区分 reservation-based（拼接）vs cross-attention（旁路）两种多模态接入方式，并说出各自取舍。
2. 讲清 ViT 怎么把图像变成"token 序列"，CLIP 已在 §10 学过，知道它怎么给多模态做对齐。
3. 说清 LLaVA / BLIP-2 / Flamingo 的训练数据分布（预训练 + 指令微调）和各自的选择。
4. 看 Stable Diffusion 的 `文本 → UNet → 去噪图像` 能说清它和纯扩散的差别在哪，DiT 即 diffusion-on-Transformer 是当前主路。
5. 给一个产品场景（VQA / 多模态 RAG / 视频理解 / TTS+ASR）选合适的架构。

---

## 一、为何"多模态"变成一个问题

### 1.1 语言 vs 视觉信号的张力

- 语言：高度离散 + 强语义 + 序列天然。一个 token ≈ 一个语义单元。
- 视觉：连续 + 弱语义 + 二维空间关系强。一个像素 ≈ 几乎没语义。
- 音频：一维时间序列 + 频域分析友好，每 10-20 ms 一个 frame。

把视觉塞进 LLM 的本质问题：**用什么粒度切？怎么映射到 embedding？怎么让 LLM 愿意去"读"它？**

### 1.2 三条主路

| 路线 | 代表 | 怎么接 |
|------|------|--------|
| **Reservation-based / 早期融合** | LLaVA, Qwen-VL, Intern-VL | 图像切成 patch → 编码 → 当作额外 token **拼在文本 prompt 前面** |
| **Cross-attention / 旁路** | Flamingo, BLIP-2 | LLM 不动，**在 Transformer block 之间插一层 cross-attn** 接图像特征 |
| **Diffusion-based** | Stable Diffusion, DiT, Sora | 文本做 conditionUNet/DiT 的去噪过程，反向过程生成图像 / 视频 / 音频 |

> [!NOTE]
> 还存在第四条更激进的「tokenizer 路线」: 用 VQ-VAE 把图像/音频 диск化成一个真正的离散词表（如 VQGAN），直接套 LLM 自回归——ESLM / AudioLM / VQGAN-Transformer / Parti 走这条。它统一但训练数据贵，本章末尾会点一下。

---

## 二、ViT：图像 → token 序列

### 2.1 Patchify

ViT（Dosovitskiy 2020）做了一件极简的事：**像 NLP 切 token 一样切图像块**。

```
原图 H × W × C
   └─ 切 P×P 的 patch
       → 数量 N = (H/P) × (W/P)
       → 每个 patch 拉平 (P*P*C) 维向量
       → 线性映射到 D 维
       → 加上位置编码 (sin/cos 或 RoPE)
       → 进 Transformer Encoder (就是 BERT 那一套)
```

示例：224×224 图，P=16，得到 14×14 = 196 个 patch，每个 768 维 → 一个长度 196 的"图像句子"。

### 2.2 与 §3、§10 的接

- ViT 的 self-attention 与 [§3 Transformer](transformer.md) 完全同构，只是把"token = word"换成"token = image patch"。
- 与 [§10 CLIP](contrastive-learning.md) 配合：ViT 是 CLIP 视觉分支，CLIP 训练确保 ViT 输出的 embedding 与文本对齐。

### 2.3 spot 问题：分辨率与序列长度

- 图像切完细粒度 patch，token 数随分辨率二次方涨：448×448 → 28×28 = 784 patch；高分辨率图 token 列完后轻易几千。
- 高分辨率方案：
  - **动态切片 / AnyRes**：只在物体所在的格子切 patch，整体 token 数下降。
  - **token 聚合 / pooling**：把 4 个相邻 patch 合一个。
  - **读懂的 adapter**：如 Q-Former（BLIP-2）把 256patch 摘要到 32 个 query token。

---

## 三、reservation-based 路线：LLaVA

### 3.1 最小骨架

```
LLM (Vicuna / LLaMA / Qwen) ── 标准 Transformer
   ▲
   │ 图像 token 拼在前面
   │
ViT (CLIP 视觉分支) → projection MLP → image tokens
```

伪代码：

```python
def llava_forward(image, text_prompt):
    img_feat = vit(image)                       # [N_patch, D_v]
    img_tok  = projector(img_feat)              # [N_patch, D_llm]
    txt_tok  = tokenizer(text_prompt)           # [T, D_llm]
    seq      = cat([img_tok, txt_tok, ...], 0)  # 拼成一条
    return llm(seq)                             # 标准 LLM
```

### 3.2 训练两阶段

1. **预训练对齐**（projection MLP）：用图文对（如 LAION-CCN / CC3M），**冻结 LLM 和 ViT**，只学 projection——目标 next-token CE，让 LLM 学会读 image token。
2. **指令微调**（LLM + projection）：用 GPT-4 生成的视觉指令数据（LLaVA-Instruct），解冻 LLM，让模型学会"看图答题"。

### 3.3 取舍

- ✅ 极简、复用已有 LLM（不动 attention 结构）、贡献就是 projection + 数据。
- ✅ 指令微调几乎和纯文本 SFT 同构 → 工程上友好。
- ❌ 图像 token 占主上下文（高分辨率图成千 token），挤占有效文本长度。
- ❌ 对视频、长序列（数千帧）不友好 → 后续 Qwen-VL / Intern-VL 加分辨率自适应 + token 聚合。

---

## 四、Cross-attention 路线：Flamingo / BLIP-2

### 4.1 思路：LLM 不动，加旁路

```
LLM block (decoder-only)
   ├─ self-attn (原有)
   └─ cross-attn (新加一层)
         K, V ← image features
         Q    ← self-attn 输出的 hidden
```

每 N 个 block 插一层 cross-attn，让 LLM "看一眼图像特征"。

### 4.2 Flamingo（2022）

- Perceiver Resampler：把任意形状的视觉特征（几千 patch）压成 32 个 latent token——这就是 §5.3 那一类 token 聚合更彻底版本。
- Gated cross-attn：cross-attn 的输出去 zero-init + gated，**训练开始时纯走 LLM 不被噪声拉偏**，再逐渐打开 gate——同一思想也用在 [§3 残差初始化](transformer.md)。
- 用 Interleaved image-text 数据训练（图文交错，比 paired 多得多）。

### 4.3 BLIP-2（2023）：Q-Former

BLIP-2 的"Q-Former"是一个小 Transformer，**32 个可学习的 query token 去抽 image feature**——可类比 retrieval 的 query，但是是 token-level。

```
Frozen image encoder (ViT-G)
        │
        ▼
Q-Former (32 learnable queries)
        │
        ▼
32 个 image token → projection → 拼到 LLM prompt 前面 OR 喂 cross-attn
        │
        ▼
Frozen LLM (OPT / FlanT5)
```

Q-Former 两阶段训练：(1) 一阶段 vision-language 对比 + 生成 +图文匹配；(2) 接 LLM 学生成。

### 4.4 Cross-attn vs Reservation 取舍

| 维度 | Reservation (LLaVA) | Cross-attn (Flamingo / BLIP-2) |
|------|---------------------|--------------------------------|
| 改 LLM 结构 | 不改 | 加层 |
| 上下文消耗 | 占主窗口（图越多越挤） | 几乎不挤 |
| 训练成本 | 高（LLM 要微调） | 可冻 LLM |
| 灵活性 | 全参数微调，迁移性强 | 多任务接入要重新设计 gate |
| 视频/多图 | 不友好 | 更友好（Perceiver Resampler） |

> [!TIP]
> 选型口诀：**要 zero-shot 多模态、上下文压得紧 → cross-attn 路线；要全力微调下游任务、不在乎 token 数 → reservation 路线。** 实际生产里两者越来越融合，例如 Qwen-VL 在 reservation 基础上加 dynamic patch + 摘要，把 cross-attn 的"省 token"优点偷了过来。

---

## 五、扩散多模态：Stable Diffusion / DiT / Sora

### 5.1 复习 §5 扩散模型

回顾 [§5 generative](generative.md)：扩散模型 = **加噪 → 学反向去噪**。生成时从纯噪声开始，一步步去回原图。

### 5.2 文本条件怎么进

**Conditioning**：把文本编码后注入 UNet 的去噪过程。三个层次：

| 层次 | 做法 |
|------|------|
| 全局 cond 向量 | 把 CLIP 文本 embedding `c` 加到 UNet 的中间层（class-conditional 那套） |
| Cross-attention | 文本 token 作为 K/V，图像 feature 作为 Q——和 §4 Flamingo 一模一样 |
| T5 / CLIP 双 stack | SDXL / SD3 用两个文本 encoder 拼出更丰富的 condition |

> [!NOTE]
> 多模态扩散里文本不是模型"输入"，而是**去噪过程的 condition**——文本和图像通过 cross-attn 在每一步去噪时交互。这和 LLaVA 的"拼在前面"是不同的耦合方式。

### 5.3 DiT：用 Transformer 替代 UNet

DiT（Diffusion Transformer, Peebles & Xie 2023）的核心改动：**把 UNet 的卷积块换成 Transformer block**——self-attn 处理 latent patch + cross-attn 接文本。

- 训练好的 scaling：DiT-XL/2 在 ImageNet 给出比 UNet 更好的 FID/CLIP。
- 是 **Sora** 的底座：视频被编码成 latent 的 时空 patch 序列，DiT 一次性生成。

### 5.4 Latent Diffusion（Stable Diffusion 的"latent"含义）

不在像素空间去噪（512×512×3 太大），而是在 `VAE encoder` 把图像压到 64×64×4 的 latent，去噪过程在 latent 上进行，最后 VAE decoder 还原像素。

```
image ──VAE-enc──► latent z (64×64×4)
                       │
              diffusion 在 z 上做去噪
                       │
                   z_clean
                       │
                  VAE-dec
                       │
                     image
文本 condition 通过 cross-attn 注入去噪网络
```

### 5.5 失败模式与对策

| 现象 | 原因 | 对策 |
|------|------|------|
| 多手多脚 | 长文细编码不足 + 采样 step 太少 | 增加 text encoder 容量、用 SDXL 的 dual encoder、提高 sampling step |
| 文本不跟随 | CLIP 文本 embedding 抽象级别太高、condition 强度低 | 用 T5 + classifier-free guidance 提高 condition 权重 |
| 构图坏 | 无 spatial 约束 | ControlNet / layout-to-image 加空间条件 |
| 视频时间不稳 | 各帧独立去噪 | 加时间维度的 3D DiT + 视频专用 dataset |

---

## 六、视频 / 音频 / 跨模态生成

### 6.1 视频

- **Sora / Video Diffusion**：DiT 在 时空 latent patch 上做去噪，关键设计：spatial-temporal tokenizer 把视频 cron 化为三维 latent，attention 同时跨空间 + 跨时间。
- **长视频一致性**：靠"前 N 帧作为 condition 短去噪出后续几帧"（rollout-conditioned），与 [AR 采样](generative.md) 的 cache 一个道理。
- **运动 controlled 生成**：Motion Brush / DragNUWA 等用关键点作为额外 condition。

### 6.2 音频：TTS / ASR 互为孪生

- **TTS**（文字 → 音频）：现代系统用 `audio codec`（EnCodec / SoundStream）把音频变成离散 token，然后**用 LLM 自回归地预测下一 audio token**——VALL-E / SpearTTS / Voicebox。
- **ASR**（音频 → 文字）：whisper 用 encoder-decoder Transformer，encoder 处理音频的 mel-spectrogram，decoder 出 token；它就是 §3 的 Encoder-Decoder 派。
- **统一语音对话**：GPT-4o / Gemini Live 把 TTS + LLM + ASR 联合训，让端到端语音对话不像"先用 ASR → LLM → TTS 三段管线"那样延迟过大。

### 6.3 跨模态检索：CLIP 已经做了一半

CLIP 把图文塞进同一空间。同理可以做"音频-文本"（CLAP）、"视频-文本"（VideoCLIP）、"code-自然语言"（Byteword embeddings）。核心都是 §10 InfoNCE + 配对数据。

---

## 七、多模态训练数据：从配对到指令

### 7.1 三类数据

| 类别 | 用途 | 代表 |
|------|------|------|
| **配对**（image-caption） | 对齐预训练 | LAION-5B / CC3M / CC12M |
| **交错**（interleaved image-text） | 学会"在文本中插图像"的语境 | OBELICS / Multimodal-C4 |
| **指令 / VQA**（problem-solution） | 学任务感 | LLaVA-Instruct / VQAv2 / OK-VQA |

### 7.2 数据质量决定上限

- **caption 噪声大**：网页爬的 alt-text 不一定描述图——多模型自蒸馏（用 LLaVA 生成生成 caption 训新 LLaVA）。
- **指令数据少**：人工造贵 → 让 GPT-4 / Claude 看图生问答对。
- **极长尾概念**：罕见场景（医学影像、工业缺陷）需要领域微调，不是通用模型能搞定的。

### 7.3 与 §8 RLHF 的接

- **多模态 RLHF**：用人类偏好对 (image, prompt, response_chosen / response_rejected) 做 DPO/PPO，和文本 RLHF 完全同构（参考 §8 DPO 公式）。
- **RLHF-Curious**：让 VLM 主动选 informative 图像生成，类似 Active Learning。

---

## 八、多模态 RAG：让 VLM 用上"图像知识库"

```
query (text)
   │
   ▼
retriever (跨模态 embedding, CLIP-based)
   │ 从 image+text 库检索 K 个最相关候选
   ▼
VLM 读 K 张图 + 原文 → answer
```

- 与文本 RAG 唯一的区别：retriever 是 CLIP / BLIP-2 这种跨模态 embedding。
- 工程挑战：图像 embedding 大、索引要在 [pgvector](../databases/optimization/vectorized.md) / Milvus / Qdrant 这种高维索引上做。
- 适用：医学问答、技术文档检索（带图表）、法务合同扫描件检索。

---

## 九、Benchmark 与评估

### 9.1 视觉理解 benchmark

| 名字 | 测什么 |
|------|--------|
| VQAv2 | 通用视觉问答 |
| GQA | 推理 + 关系 |
| OK-VQA | 需要外部知识的 VQA |
| MMMU | 多学科、本科难度的多模态 |
| MathVista | 数学题带图表 |
| MMBench / MME | 多维度 VQA 综合 |
| DocVQA | 文档 OCR + 推理 |

### 9.2 生成评测

- **FID**（Fréchet Inception Distance）：生成图像分布 vs 真实图像分布的距离（用 Inception-V3 抽 feature）。
- **CLIP Score**：生成图 + 提示文本的 CLIP 相似度。
- **人类评测**：DALL-E / Midjourney 论文标配的人类 preference 比较。
- **Video metric**：FVD（Fréchet Video Distance），跟 FID 同思路但捕捉时序。

### 9.3 陷阱：VLM 的 hallucination

- **虚假对象**：VLM"看到"图里没有的物体（POPE benchmark 专测这个）。
- **固执偏置**：图里只有一只猫，VLM 说"两只猫在玩"——LM 强先验压过视觉。
- **位置推理差**：左右、上下、前后极易错，研究者故意造 hard benchmark（GQA spatial）。

---

## 十、与前面章节的接口表

| 接口 | 提供什么 | 本部分怎么用 |
|------|---------|--------------|
| [§3 Transformer](transformer.md) | self-attn / cross-attn / MHA / encoder-decoder | ViT、cross-attn 路线、ASR/TTS 端到端 |
| [§5 generative](generative.md) | 扩散 / ELBO / AR | 多模态扩散、视频生成 |
| [§10 contrastive](contrastive-learning.md) | InfoNCE / CLIP zero-shot | 多模态对齐预训练、跨模态 retrieval |
| [§7 tokenizer](tokenizer.md) | BPE / VQ 离散化 | audio codec / VQ-VAE 把图像/音频 token 化 |
| [§9 training-at-scale](training-at-scale.md) | 长 context / 大 batch | ViT 大分辨率训练、视频 diffusion 训练显存 |
| [§11 agents](agents.md) | tool use / code interpreter | 多模态 agent（看网页图、生成图、读图表） |
| [info-theory](../info-theory/entropy.md) | 互信息 / 率失真 | latent diffusion 的 VAE 率失真 + 多模态对齐的互信息下界 |
| [DB vector](../databases/optimization/vectorized.md) | pgvector / vector 索引 | multimodal RAG 的 retrieval |
| [crypto/zkp](../crypto/zkp.md) | 隐私计算 | medical multimodal RAG 隐私 + 隐私审计 |

---

## 十一、速查表 / 结束

> [!TIP]
> 一页快速唤回：
>
> - **ViT**：图像切成 N 个 patch → 768 维 embedding → 进 Transformer（和 NLP 同构）。
> - **reservation based (LLaVA)**：image token 拼在 prompt 前 → 改动少 + 训练简单。
> - **cross-attn (Flamingo / BLIP-2)**：LLM 不动 + 旁路 cross-attn → 省上下文 + 可冻 LLM。
> - **Q-Former / Perceiver Resampler**：把上千 image feature 摘要成 32 个 token。
> - **Stable Diffusion**：latent diffusion + 文本做 condition（cross-attn）在 UNet/DiT 去噪。
> - **DiT**：把 UNet 换 Transformer block，scaling 友好，Sora 的底座。
> - **TTS/ASR**：audio codec 把音频 token 化 → LLM 自回归；whisper 是 encoder-decoder。
> - **多模态 RAG**：CLIP 系 retriever + VLM reader；和文本 RAG 只差 retriever。
> - **数据三件套**：配对 caption → 对齐；交错 image-text → 语境；VQA 指令 → 任务。
> - **评估**：FID/CLIP-Score（生成），VQA/MMMU/MathVista（理解），POPE（防幻觉）。

---

下一篇: [元抽象卷 · 跨章节大主题](../_meta/index.html).
