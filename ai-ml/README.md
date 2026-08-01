# 第十二部分 · 人工智能与机器学习

## 一句话

机器学习是一类**用数据替换显式规则**的程序写法: 当规则写不出来、但能定义"做对/做错"时, 让数学优化自动从样本里把函数拟合出来. 70 年路线从**线性回归 (Legendre 1805 / Gauss 1809)** 演到 **MLP (1986)** → **反向传播自动求导 (1970/1986)** → **CNN/RNN (1998/1997)** → **Attention/Transformer (2017)** → **扩散模型 (2020)** → **RLHF 对齐 (2022)**. 我们抽主干 5 章把它一气讲通, 全部数学已在 [第零部分](../math/README.md) 准备好, 本部分直接引用.

## 思想链

```
[一堆 (sqft, price) 房价数据]
  └─> 最小二乘线性回归 (Legendre/Gauss): y = X β, 解 β = (XᵀX)⁻¹Xᵀy
        └─> 加非线性可表达性 → MLP: ŷ = W₂ σ(W₁ x + b₁) + b₂
              └─> 怎么训? → 反向传播 = 链式法则 × 计算图 (1970 Linnainmaa, 1986 Rumelhart)
                    └─> 怎么算众多样本有效? → SGD + mini-batch + Adam (2014)
                          └─> 序列怎么处理? → Transformer (2017): softmax(QKᵀ/√d) V
                                └─> 生成式怎么学? → VAE & ELBO (2013) / 扩散模型 (2020)
                                      └─> 与人类偏好对齐? → RLHF (2022): PPO 约束下的 policy gradient
                                            └─> 数学尽头都是四个: 线代 / 概率 / 链式法则 / 凸优化 → 全在第零部分
```

每一步**出现的数学**都能在线代、概率、微积分四篇里找到对应小节, 这就是为何把数学前置.

## 你将带走什么

读完应能:

1. 看到任意 ML 损失函数 $\mathcal{L}(\theta)$ 能立刻判断它属于哪个家族 (回归 / 分类 / 排序 / 对比 / 生成), 知道对应输出层激活 (identity / sigmoid / softmax) 与损失 (MSE / CE / contrastive / ELBO).
2. 给一个网络能徒手画出**计算图**并标每个节点的局部雅可比, 用反向模式 AD 算出参数梯度; 用数值差分校验自己的解析梯度.
3. 看到 `Attention(Q, K, V) = softmax(QKᵀ/√d)V` 能立刻在脑子里展开它的张量形状、forward/backward 的 FLOPs 与显存, 知道为什么除 $\sqrt{d_k}$, 为什么 MHA 比单头更稳.
4. 看到 `Adam → AdamW + cosine warmup` 知道为何 warmup 防止初期方差爆炸, 为何 Adam 比 SGD 在Transformer 上更稳, 为何 Hessian 是 Adam 的隐式近似.
5. 看到 VAE 的 $\mathcal{L} = \mathbb{E}_q[\log p(x|z)] - \mathrm{KL}(q(z|x) \| p(z))$ 知道它是 reverse-KL 的最大化, 看到 diffusion 的 $\mathcal{L}_t = \mathbb{E}_q\| \epsilon - \epsilon_\theta(x_t, t)\|^2$ 知道它是 ELBO 的等价化简.
6. 读 "Attention Is All You Need" / "Denoising Diffusion Probabilistic Models" / Adam 原 paper 不再卡在数学记号处.

## 章节

- [开篇: 从线性回归到 Transformer 的 70 年](README.md) ← 当前
- [1. Foundations: 线性回归 → 逻辑回归 → MLP → 损失函数谱 → 泛化与正则](foundations.md)
- [2. Backpropagation: 计算图 / 反向模式 AD / 雅可比链式 / 梯度检查](backprop.md)
- [3. Transformer: self-attention / MHA / FFN / LayerNorm / 残差 / Encoder-Decoder / 训练损失](transformer.md)
- [4. Optimizers & Training Dynamics: Adam/AdamW/二阶 + 初始化/LayerNorm/warmup/checkpoint](optimizers.md)
- [5. Generative Models: VAE & ELBO / 扩散模型 / AR 采样 / speculative decoding](generative.md)
- [6. Tokenizer 与 Embedding: BPE / WordPiece / SentencePiece / 位置编码](tokenizer.md)
- [7. 强化学习与 RLHF: MDP / Bellman / Q-learning / Policy Gradient / PPO / RLHF](rl.md)
- [8. 大模型训练工程: DP/PP/TP/ZeRO/FSDP/Checkpoint](training-at-scale.md)

## 与各部分的接口表

| 接口部分 | 提供什么 | 本部分怎么用 |
|----------|----------|--------------|
| [第零部分 · 线代](../math/linalg.md) | 向量 / 矩阵 / 张量 / softmax 雅可比 / SVD | MLP/attention 的 forward 与 backward 表达, shape 推导 |
| [第零部分 · 概率](../math/prob.md) | MLE / MAP / 贝叶斯 / KL / 共轭先验 | MLE = 大多数 ML 损失的本质; VAE / 扩散用 reverse-KL |
| [第零部分 · 微积分与优化](../math/calc-opt.md) | 链式法则 / 雅可比 / Hessian / 凸优化 / 一阶优化器谱系 / 信息几何 | 反向传播; Adam/AdamW/二阶; 自然梯度 TRPO |
| [第八部分 · GPU/AI 加速器](../computer-arch/ai-accelerators.md) | Tensor Core / SM / bf16 / NVLink | 大模型训练的 FLOPs / 显存估算与并行 |
| [第十一部分 · 信息论](../info-theory/entropy.md) | 熵 / 互信息 / KL | 交叉熵损失; VAE ELBO; 扩散 ELBO 等价化简 |
| [第九部分 · 计算理论](../theory/complexity.md) | P / NP 与不可判定 | 学习理论的 PAC 框架与不可学性问题 |

## 不在本部分讲什么

- **传统 ML (SVM / 决策树 / 随机森林 / Boosting / k-means / PCA)**: 这些是金融/推荐系统/统计 ML 的入口, 但与深度学习主线相对独立, 本部分默认读者已通过基础课熟悉, 不展开; MLE/MAP 与 SVM 的 KKT 推导见第零部分 §4 凸优化.
- **形式化方法 / 程序验证**: Coq / Lean / TLA+ 见 TODO 未来方向.
- **量子计算**: Deutsch–Jozsa / Shor / 量子纠错见 TODO 未来方向.

## 历史 1: 1957 - 1986 三起三落

- **1957 Rosenblatt** perceptron: 第一个可学习的二分类器; 但只能学线性可分数据, 1969 Minsky-Papert 一书指其不能学 XOR, 神经网络跌入第一次寒冬.
- **1986 Rumelhart-Hinton-Williams** 反向传播重新发现并推广: 解决了多层训练问题, XOR 不再是问题. **同期 Linnainmaa 1970** 在芬兰硕士论文里已写出反向 AD, 但论文未广泛传播.
- **1998 LeCun LeNet** 卷积网络做手写数字; **1997 Hochreiter LSTM** 解决长序列; 2006 Hinton "deep belief net" 让"deep learning"成为术语; 2012 AlexNet ImageNet 一举破纪录, 深度学习时代起.

## 历史 2: 2017 Transformer 一统江湖

2017 Vaswani et al. "Attention Is All You Need": 抛弃 RNN/CNN 用**纯 attention** 做序列建模, 关键好处:

1. **并行**: 整个序列同时算, 不需 RNN 时间步串联 → GPU 友好.
2. **长程依赖**: 任意两 token 直接 attention, 不必经过隐藏状态传递.
3. **scaling law**: 参数 / 数据 / 算力 ↔ 性能呈 power-law (Hoffmann 2022 Chinchilla), 推动大模型时代.

衍生路线: BERT (2018 编码器派) / GPT (2018 解码器派) / ViT (2020 视觉) / DALL-E (2021 多模态) / ChatGPT (2022 RLHF 对齐) / diffusion (2020-2022) / LLaMA / Qwen / DeepSeek 系列 (2023+) → 主流基础模型几乎全是 Transformer.

## 阅读路径建议

```
对 ML 完全陌生:           §1 → §2 → §3 → §4 → §5
只想懂 Transformer:       第零部分线代 §6 → §2 → §3
只想懂训练工程:            §4 → §8 (并行/显存)
只想懂生成模型:            第零部分概率 §5/§7 → §5
准备读 RLHF / 对齐:        §3 → §7 (RLHF/DPO/GRPO)
想读懂开源模型 config:      §6 (tokenizer) → §7 → §8
```

---

下一篇: [1. Foundations: 线性回归 → 逻辑回归 → MLP → 损失函数谱 → 泛化与正则](foundations.md).
