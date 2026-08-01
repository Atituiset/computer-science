# 7. Tokenizer 与 Embedding: BPE / WordPiece / SentencePiece / 位置编码

## TL;DR

大模型"第一公里"和"最后一公里"都是**字符串 ↔ 向量**：文本进来要先切成 token 再查 embedding 表，模型输出 logits 又要映射回文本。tokenizer 决定了词典怎么建、词怎么切、OOV（未登录词）怎么兜底——**它的质量直接影响模型能表达什么**。这一章把 tokenizer 三剑客（BPE / WordPiece / SentencePiece）+ 位置编码三大家族（Learned / ALiBi / RoPE）讲到能自己写一个、能看懂任何开源模型配置。

读完应能：
1. 手工跑一遍 BPE 合并，说出 vocab size、训练语料、单 token 最长切分。
2. 区分 char-level / word-level / subword-level 三档，说明为什么大模型全用 subword。
3. 给一个 `tokenizer_config.json` 能判断它是什么算法、special token 有哪些、`bos/eos/pad/unk` 的 id。
4. 解释 RoPE 的复数旋转几何、为什么能外推、ALiBi 为什么只需加 bias 不占参数。
5. 会算"一个 batch 的 token 数 → 显存 / 训练吞吐"的粗估。

---

## 一、为什么需要 tokenizer

### 1.1 模型吃的是整数 id，不是字符

Transformer 的输入是 `[B, T, d]` 的 embedding 张量，`T` 是 token 数。所以原始文本必须先切成**词元（token）**，每个 token 查 embedding 表（`[vocab_size, d]`）拿向量。

### 1.2 三个层级

| 层级 | 切法 | 词典大小 | 例子 | 问题 |
|------|------|---------|------|------|
| char-level | 按字符 | ~100-200 | `h-e-l-l-o` | 序列太长（无词义聚合） |
| word-level | 按空格/标点 | 10⁵~10⁶ | `hello world` | OOV 严重；变形多 |
| subword-level | 字节/子词合并 | 10⁴~10⁵ | `hello`、`ing`、`##ed` | 平衡；主流选择 |

> [!WARNING]
> 中文没有空格分词，word-level 直接失效。所以中文模型（BPE 跑在字节上）天然用 subword，每个汉字常被切成 1-2 个 byte-token。

### 1.3 三个性质

一个合格的 tokenizer 要：
- **可逆**：能 decode（id → 文本），能 encode（文本 → ids），不丢信息。
- **定长友好**：切分后平均 token/字 稳定（决定序列长度预算）。
- **子词覆盖**：新词可用已有子词拼出来（OOV 兜底靠 UNK 或字节 fallback）。

---

## 二、BPE (Byte Pair Encoding)

### 2.1 思路

从**字符表**出发，反复把"出现频率最高的相邻对"合并成一个新符号，直到达到目标 vocab size。名字来自 Gage 1994 的"字节对压缩"。

### 2.2 算法

```
1. 把语料拆成单词（word → 内部字符序列 + 词频）
2. 初始 vocab = 所有字符（+ </w> 词尾标记）
3. 循环直到 vocab 到目标大小:
     统计所有相邻字符对的频次
     选出最高频的一对 (a, b)，合并为新符号 ab
     vocab 加入 ab，语料里替换所有 a b → ab
4. 输出 vocab 与 merges 表
```

**关键**：BPE 是无监督的，只需频次统计；"要合并到什么粒度"由 vocab size 控制。更大的 vocab → 更长的 token、更少的序列步数，但 embedding 表更大。

### 2.3 Python 实现（教学版）

```python
from collections import Counter
from typing import List, Tuple, Dict

def get_stats(seqs: List[List[str]]) -> Counter:
    pairs = Counter()
    for s in seqs:
        for a, b in zip(s, s[1:]):
            pairs[(a, b)] += 1
    return pairs

def bpe_corpus(corpus: List[str], num_merges: int, vocab_size_goal: int) -> Tuple[Dict[Tuple[str,str],int], set]:
    # 1. 分词为字符序列（空格用 _ 表示，词尾加 </w>）
    seqs = [list(" ".join(w) + " </w>") for w in corpus]
    vocab = set(ch for s in seqs for ch in s)
    merges: Dict[Tuple[str, str], int] = {}
    # 2. 迭代合并
    for _ in range(num_merges):
        pairs = get_stats(seqs)
        if not pairs: break
        best = max(pairs, key=pairs.get)
        merges[best] = _ + 1
        vocab.add(best[0] + best[1])
        # 3. 替换
        new_seqs = []
        for s in seqs:
            out, i = [], 0
            while i < len(s) - 1:
                if (s[i], s[i+1]) == best:
                    out.append(best[0] + best[1]); i += 2
                else:
                    out.append(s[i]); i += 1
            if i < len(s): out.append(s[i])
            new_seqs.append(out)
        seqs = new_seqs
    return merges, vocab
```

### 2.4 GPT 系用的 byte-level BPE

GPT-2 之后用 **byte-level BPE**（Radford 2019）：先按 UTF-8 把文本编码成字节序列（256 个基础字节），再跑 BPE。好处：

- 所有 Unicode（含 emoji、中日韩）都能无损表示 → **零 UNK**。
- vocab 里混有字节 token（如 `Ġ` 表示空格前缀，`Ċ` 表示换行）。

这就是为什么 tokenizer 词典里常见 `Ġ`、`Ĩ`、`Ċ` 这类怪字符——它们是 UTF-8 字节的可见化。

### 2.5 一句话评价

**优点**：简单、快、无监督、可逆。**缺点**：合并只取频次，不感知语言边界（`t h` 也会合并），同词变形仍会切碎。

---

## 三、WordPiece

### 3.1 与 BPE 的差别

WordPiece（Schuster & Nakajima 2012，BERT 用）合并准则不是"最高频对"，而是**最大化合并后语言模型似然增益**：

$$\text{score}(a, b) = \frac{\text{freq}(ab)}{\text{freq}(a) \cdot \text{freq}(b)}$$

- 分子：合并后符号频次；分母：两符号单独频次之积。
- 选 score 最高的对合并 → 更偏向合并"一起出现显著多于随机"的片段。

### 3.2 与 BPE 对比

| | BPE | WordPiece |
|---|---|---|
| 合并准则 | 最高频对 | 最高似然比 score |
| 实现复杂度 | 低 | 中（需先训 LM 计数） |
| 代表模型 | GPT 系、LLaMA 系（byte-level） | BERT、DistilBERT |
| 特殊标记 | `Ġ` 空格前缀 | `##` 子词前缀 |

### 3.3 应用细节（BERT）

- 编码时：`tokenizer.tokenize("unhappiness")` → `['un', '##happiness']`（`##` 表示非词首子词）。
- decode：去掉 `##` 前缀拼接。
- 词表：30,522（BERT-base），含 `[CLS] [SEP] [PAD] [MASK] [UNK]` 等 special token。

---

## 四、SentencePiece

### 4.1 为什么再需要一个

BPE/WordPiece 都**依赖空格分词**——这对中文、日文、泰文等无空格语言是硬伤。SentencePiece（Kudo & Richardson 2018）把 tokenizer 和语言解耦：

- **直接吃原始文本**（含标点、空格），内部用 Unicode 码点/字节。
- 空格本身作为一个字符 `_` 参与 BPE/Unigram 合并，训练后 `decode` 再把 `_` 还原为空格。
- 自带 **Unigram** 算法（用 EM 学 subword 概率分布，可做采样训练）。

### 4.2 Unigram 语言模型

Unigram（Kudo 2018）不是"贪心合并"，而是对每个 subword 学一个概率，句子的概率是所有切分的概率和：

$$P(\text{sentence}) = \sum_{\text{seg} \in S(\text{sentence})} \prod_{w \in \text{seg}} P(w)$$

训练用 EM：先给个超集词表，反复剔除"贡献最小的" subword，直到目标大小。**优势**：可做 subword 正则（训练时按概率采样不同切分）。

### 4.3 代表模型

- **T5 / ALBERT / XLM-RoBERTa / LLaMA 系**（sentencepiece-unigram 或 -bpe）
- 中文 T5 / mT5 直接跑原始文本，不预分词。

### 4.4 对比总结

| 算法 | 语言假设 | 训练 | 主要使用者 |
|------|---------|------|-----------|
| BPE (byte-level) | 无（靠 UTF-8 字节） | 贪心频次 | GPT-2/3/4, LLaMA, Qwen, DeepSeek |
| WordPiece | 需空格 | 似然比 | BERT, DistilBERT |
| SentencePiece | 无（空格作为字符） | BPE 或 Unigram+EM | T5, mT5, LLaMA (sp), XLM-R |

---

## 五、Embedding 与特殊 token

### 5.1 Embedding 表

token id → 向量：`E ∈ R^{V × d}`，`V` = vocab size，`d` = hidden dim。embedding 行是**可学习参数**，初始化为小随机（~N(0, 1/d)），训练中更新。

**绑定（weight tying）**：很多 LM 让输出 logits 层复用 embedding 转置 `W_out = E^T`，省 `V×d` 参数、且常提升效果。

### 5.2 special token 三件套

| token | 作用 | 注意 |
|-------|------|------|
| `[BOS]` / `<s>` / `[CLS]` | 序列开头标记 | 部分模型不用（纯 decoder 可从任意处开始） |
| `[EOS]` / `</s>` / `<eos>` | 序列结束标记 | 生成停止条件之一 |
| `[PAD]` / `<pad>` | batch 内对齐 | 训练时 attention mask 掉 |
| `[UNK]` / `<unk>` | 未知 token | 现代模型尽量零 UNK |
| `[SEP]` / `[MASK]` | BERT 专用 | 双句分隔 / 掩码 |

**id 稳定**：special token 的 id 在词典开头（0-2 常见），不可随意重排，否则模型权重错位。

### 5.3 中文的 tokenizer 实践

- 中文无空格，常见方案：
  - **byte-level BPE**：每个汉字 ≈ 2-3 个 byte-token（压缩率低但零 UNK）。
  - **加字表**：把高频单字/双字作为 pre-seg 再跑 BPE。
  - **PaddleNLP / 哈工大方案**：jieba 预分词 + BPE。
- LLaMA/千问/Qwen 直接字节级，对中文按 UTF-8 字节切，所以中文 token 数略多于字符数。

---

## 六、位置编码：让 Transformer 知道顺序

Transformer 无 RNN 的时间结构，attention 本身置换不变。必须显式注入位置信息。三大家族：

### 6.1 Learned Positional Embedding（BERT）

可学参数 `P ∈ R^{T_max × d}`，`pos` 行与 token embedding 相加。

```python
# BERT 风格: x = token_emb + pos_emb
class LearnedPE(nn.Module):
    def __init__(self, d, max_len=512):
        super().__init__()
        self.pe = nn.Parameter(torch.zeros(1, max_len, d))  # 可学
        nn.init.normal_(self.pe, std=0.02)
    def forward(self, x):  # x: [B, T, d]
        return x + self.pe[:, :x.size(1)]
```

**缺点**：`max_len` 硬上限（BERT=512，外推需改表重训）；无相对距离几何。

### 6.2 Sinusoidal（原版 Transformer）

$$PE_{t, 2k} = \sin\left(\frac{t}{10000^{2k/d}}\right),\quad PE_{t, 2k+1} = \cos\left(\frac{t}{10000^{2k/d}}\right)$$

- 每个维度一个频率 `10000^(2k/d)`，位置 t 由各频率的相位表示。
- 性质：`PE_{t+δ}` 可写成 `PE_t` 的线性组合（旋转）→ 模型隐含学到相对位置。

### 6.3 RoPE（Rotary Positional Embedding，Su 2021）

**现状主流**（LLaMA、Qwen、DeepSeek、GPT-NeoX 都用）。

**核心**：不把位置加到 embedding 上，而是**旋转 Q、K 向量**——对每对 `(q_{2k}, q_{2k+1})` 按位置 t 的角度 `θ_k = t / 10000^{2k/d}` 做 2D 旋转：

$$R_{\theta_k}(t) = \begin{pmatrix} \cos\theta_k & -\sin\theta_k \\ \sin\theta_k & \cos\theta_k \end{pmatrix}, \quad q'_{2k} = q_{2k}\cos\theta_k - q_{2k+1}\sin\theta_k$$

**关键性质**：

$$\langle R_{\theta_k}(m)\, q, \, R_{\theta_k}(n)\, k \rangle = \langle q, R_{\theta_k}(n-m)\, k \rangle$$

即 **点积只依赖相对位置差 (n−m)**，且旋转是线性、可反向（无额外参数）。→ 长程外推比 learned 好，训练时自然学到相对位置归纳偏置。

**外推技巧**：超过训练长度时，把频率除以 scale 或用 `NTK-aware` / `YaRN` 插值频率，避免位置角过密导致 attention 塌陷。

### 6.4 ALiBi（Attention with Linear Biases，Press 2021）

完全不学位置编码，直接在 attention score 上加一个线性距离偏置：

$$S_{ij} \xrightarrow{+} S_{ij} - |i - j| \cdot m_h$$

- `m_h` 是每 head 的斜率（`2^(-8/h)` 之类，head 数越深斜率越小）。
- 零新增参数、推理快、**外推极好**（训练 1024 可跑到几万）。

**缺点**：不编码绝对位置，对某些任务（绝对位置敏感）略弱。

### 6.5 对比表

| 方案 | 参数 | 相对位置 | 外推 | 代表 |
|------|------|---------|------|------|
| Learned PE | V 大 | 隐含 | 差（硬上限） | BERT |
| Sinusoidal | 0 | 可线性表达 | 中 | 原版 Transformer |
| **RoPE** | 0 | **显式旋转** | **好**（+插值更好） | LLaMA, Qwen, DeepSeek |
| ALiBi | 0 | bias 近似 | **极好** | 部分 BLOOM 变体 |

> [!TIP]
> 判断一个开源模型能不能上长上下文：先看它用什么位置编码。RoPE + 插值（YaRN/LongRoPE）→ 可扩到 1M；Learned PE → 基本锁死训练长度。

---

## 七、实操：读一个 tokenizer_config.json

以 `llama-3` 系为例：

```json
{
  "add_bos_token": false,
  "add_eos_token": false,
  "bos_token": "<|begin_of_text|>",
  "eos_token": "<|end_of_text|>",
  "model_max_length": 131072,
  "tokenizer_class": "PreTrainedTokenizerFast",
  "tokenizer_file": "tokenizer.json",
  "unk_token": "<|unk|>"
}
```

读法：
- `tokenizer_class` = `PreTrainedTokenizerFast` → SentencePiece 或 HF 字节 BPE。
- `bos/eos/unk` 都是 `<|...|>` → LLaMA 风格 special tokens（不是 `[CLS]`）。
- `add_bos_token=false` → 纯 decoder，不强制加序列头标记。
- `model_max_length=131072` → 128K 上下文 → 配的是 RoPE + YaRN 外插。

```python
from transformers import AutoTokenizer
tok = AutoTokenizer.from_pretrained("meta-llama/Llama-3.1-8B")
ids = tok.encode("Hello, world!", add_special_tokens=False)
print(ids)                      # [9906, 11, 1917, 0]
print(tok.decode(ids))          # "Hello, world!"
print(len(tok))                 # 128256 (vocab size)
```

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **subword 三剑客**：BPE（贪心最高频，GPT/LLaMA 用 byte-level）；WordPiece（似然比 score，BERT 用 `##`）；SentencePiece（空格当字符，支持中文无空格，T5/mT5/LLaMA 用，Unigram 用 EM）。
> - **byte-level BPE**：UTF-8 字节做底 → 零 UNK、任意 Unicode 无损。
> - **embedding**：`V×d` 可学表；weight tying 让输出复用 `E^T`。
> - **位置编码**：Learned（BERT，硬上限）、Sinusoidal（原版）、**RoPE（旋转 Q/K，点积=相对位置，主流）**、ALiBi（加 bias，外推极好）。
> - **看模型能否长上下文**：先看位置编码是不是 RoPE + 插值。
> - **special token**：`[PAD]/[BOS]/[EOS]/[UNK]` id 靠前且不可重排。

---

下一篇: [8. 强化学习与 RLHF: MDP / Bellman / Q-learning / Policy Gradient / PPO / RLHF](rl.md).
