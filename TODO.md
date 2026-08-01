# TODO — 待补充模块

> 当前导论卷 + 工程化实践轴 + 第零部分 + 13 主题 + 形式化卷 + 量子卷，构建通过，~57.6K 行 / 281 个 .md。

## 已完成

- [x] **形式化方法卷**（独立卷）
  - 模型检查与 TLA+: 规格语言 / 不变量 / Safety-Liveness / TLC / Raft-Paxos 实战
  - 定理证明: Coq / Lean / 依赖类型 / Curry-Howard / CompCert-seL4
  - 程序验证: Hoare 逻辑 / 最弱前置条件 / 符号执行 / 形式语义
- [x] **量子计算卷**（独立卷）
  - 基础: Dirac 记号 / qubit / 量子门 / 测量 / 纠缠
  - 算法: Deutsch-Jozsa / Grover / Shor / 量子模拟
  - 纠错: 逻辑 qubit / surface code / 阈值定理 / Y2Q 现实
- [x] **第十二部分 AI/ML 补充**（第 9 章）
  - 表示学习与对比学习: SimCLR / CLIP / InfoNCE / 自监督
- [x] **第十二部分 AI/ML 再补充**（共 13 章）
  - 经典机器学习与树模型: 决策树 / 随机森林 / GBDT / XGBoost / SVM / 核技巧
  - LLM 推理与部署: KV cache / PagedAttention / 连续批处理 / 投机解码 / W4A16 量化 / PD 分离
- [x] **网络补充**：DNS（递归/权威分层、TTL 与 CDN 调度、DNSSEC / DoH / HTTPDNS）
- [x] **数据库补充**：倒排索引与全文检索（Lucene segment / BM25 / ES 分布式搜索）
- [x] **分布式补充**：分布式事务（2PC / 3PC / Saga / TCC / Outbox / Spanner）
- [x] **操作系统补充**：虚拟化与容器（KVM / EPT / namespaces+cgroups / gVisor / Kata / Firecracker）
- [x] **计算机组成补充**：存储硬件（NAND SLC-TLC/QLC / FTL / 写入放大 / NVMe / ZNS）
- [x] **DSA 深度重写**：贪心（交换论证 + Go/Python 实现）、回溯（四类剪枝 + 去重语义）
- [x] **工程化实践轴 · 让代码真正跑进生产**（独立轴，11 章）
  - Git 与版本控制: 对象模型 / 分支模型 / 合并策略 / 回滚恢复 / 团队协作
  - 测试工程: 测试金字塔 / 单元/集成/契约/E2E / mock / flaky 治理 / 覆盖率
  - CI/CD 与发布工程: 管线 / 不可变产物 / 蓝绿金丝雀 / IaC / DB 迁移
  - 性能工程: profiling / 火焰图 / 缓存与批处理 / 并发 / 性能反模式
  - 应用安全: OWASP Top 10 / 认证授权 / 数据安全 / 供应链 / 安全头
  - 代码质量: 重构 / code review / 复杂度治理 / DDD 落地
  - 可观测性实操: metrics/logs/traces / OpenTelemetry / SLO / 告警
  - GitHub Actions 实战: workflow / expression / 缓存 / 矩阵 / reusable / 自托管
  - 云原生发布与 GitOps: K8s 应用 / Helm / ArgoCD / Flux / 服务网格
  - SRE 工程: 错误预算 / 容量 / 变更 / 事件响应 / 生产就绪
- [x] **第零部分 · 工程数学与离散数学基础**（前置）
  - 离散数学: 逻辑 / 集合 / 关系 / 图 / 组合 / 递推 / 代数结构（群环域）
  - 线性代数: 向量空间 / 矩阵 / 谱 / SVD / 正定 / 张量 / softmax 雅可比
  - 概率统计: 分布家族 / 贝叶斯 / MLE / MAP / EM / 极限定理 / KL
  - 微积分与优化: 链式法则 / 雅可比 / Hessian / 凸优化 / 一阶优化器谱系 / 信息几何
- [x] 第一部分 · DSA
- [x] 第二部分 · OS
- [x] 第三部分 · 计算机网络
- [x] 第四部分 · 数据库
- [x] 第五部分 · 编译原理
- [x] 第六部分 · 分布式系统
- [x] 第七部分 · 系统设计
- [x] 第八部分 · 计算机组成原理
- [x] 第九部分 · 计算理论（Formal Languages / Automata / Complexity）
- [x] 第十部分 · 密码学与安全
- [x] 第十一部分 · 信息论与编码
- [x] **第十二部分 · 人工智能与机器学习**（主干 5 章 + README）
  - Foundations: 线性回归 → 逻辑回归 → MLP → 损失函数谱 → 泛化与正则
  - Backprop: 计算图 / 反向模式 AD / 雅可比链式 / 梯度检查
  - Transformer: self-attention / MHA / FFN / LayerNorm / 残差 / Encoder-Decoder / 训练损失
  - Optimizers & Training Dynamics: SGD/Momentum/Adam/AdamW/二阶 + 初始化/LayerNorm/warmup/checkpoint
  - Generative: VAE & ELBO / 扩散模型 / AR 采样 / speculative decoding
- [x] 第十三部分 · 元抽象（原第十二部分，重号；仍作为全书收束）

## 第零部分的设计意图

把后续十三部分反复出现的同一组数学抽到一处讲透:

| 数学块 | 解锁的后续章节 |
|--------|---------------|
| 离散 · 图 / 关系 / 偏序 / 代数结构 | DSA、Compiler (CFG / 支配树 / SSA)、Crypto (群环域 / 有限域)、Distributed (因果序) |
| 线代 · 矩阵 / 谱 / SVD / 张量 | DB 列存向量化、AI/ML 全部（attention / 反向传播）、PCA、LoRA |
| 概率 · 贝叶斯 / MLE / 极限定理 | OS 排队论、DB 代价估计、Distributed 选举、信息论熵 / 互信息、贝叶斯网络、VAE / 扩散 |
| 微积分与优化 · 链式 / Hessian / 凸 | OS 控制论、Compiler strength reduction、信息论容量、ML 反向传播与 SGD |

每篇都标明"喂给后面哪一章", 不做教材复读机, 只讲工程够用的下限 + 直觉.

## 第十二部分设计意图

把分散在零部分(数学)、第八部分(计算机组成 GPU/AI 加速器)、第十一部分(信息论 KL/熵)、第十部分(密码学 ZKP 中的多项式承诺)的"积木", 在 ML 这一处集大成:
- 数学预备 → 第零部分线代 / 概率 / 微积分与优化已就位, 本部分直接引用.
- 反向传播 / 注意力本质是张量雅可比的链式法则 → 引 §2 §3.
- VAE / 扩散的 ELBO / 反向 KL → 引概率 §7 与微积分 §6 信息几何.
- 训练硬件 → 引第八部分 GPU 架构与 AI 加速器.

主干 5 章, 不做教材复读机, 目标: 读完能读 "Attention Is All You Need" / "Denoising Diffusion Probabilistic Models" / Adam 原 paper 不再卡在数学记号处.

## 未来可继续扩展方向

- [x] ~~第十二部分 AI/ML 主干之外的子主题~~ → 已补 3 章:
  - [x] Tokenizer 与 Embedding 详解（BPE / WordPiece / SentencePiece / 位置编码 RoPE / ALiBi）→ `ai-ml/tokenizer.md`
  - [x] 强化学习基础与 RLHF（MDP / Bellman / Q-learning / Policy Gradient / PPO / RLHF / DPO / GRPO）→ `ai-ml/rl.md`
  - [x] 大模型训练工程（DP / PP / TP / ZeRO / FSDP / checkpoint / 量化）→ `ai-ml/training-at-scale.md`
- [x] ~~表示学习与对比学习（SimCLR / CLIP / contrastive loss)~~ → `ai-ml/contrastive-learning.md`
- [x] ~~形式化方法（Coq / Lean / TLA+ 模型检查与证明）~~ → `formal/` 独立卷
- [x] ~~程序验证与定理证明~~ → `formal/program-verification.md`
- [x] ~~量子计算基础（Deutsch–Jozsa, Shor, 基础量子纠错 surface code）~~ → `quantum/` 独立卷
- [x] ~~AI/ML Agent / 多模态~~ → 已补 2 章:
  - [x] LLM Agent: Tool Use / ReAct / Plan-Execute / Multi-Agent / Memory → `ai-ml/agents.md`
  - [x] 多模态: 跨注意力 / Flamingo / LLaVA / BLIP-2 / 扩散多模态 → `ai-ml/multimodal.md`

后续按需增补（无固定待办）：工程化的专项实操、形式化的更深工具链、量子的物理实现细节。

## 各部分章节大纲

### 第九部分 · 计算理论

- 自动机：DFA → NFA → ε-NFA → 子集构造 → DFA 最小化
- 正则语言与泵引理（Pumping Lemma）+ Myhill-Nerode 充要
- 下推自动机（PDA）与上下文无关文法（CFG）
- 图灵机（deterministic / non-deterministic / Church-Turing）
- 不可判定性：停机问题、Rice 定理
- Complexity classes：P / NP / NPC / co-NP / PSPACE
- Polynomial-time reduction：3-SAT → Clique → Vertex Cover 等
- Approximation algorithms、hardness of approximation

### 第十部分 · 密码学与安全

- 对称加密：AES（SubBytes / ShiftRows / MixColumns / AddRoundKey）、ChaCha20
- 操作模式：ECB / CBC / CTR / GCM（AEAD）
- 非对称加密：RSA（欧拉函数、CRT 加速）、ECC（secp256k1 / Curve25519）
- 密钥交换：Diffie-Hellman、ECDHE
- 数字签名：RSA-PSS、ECDSA、Ed25519
- 哈希：SHA-256、SHA-3（Keccak）、BLAKE3
- TLS 1.3 握手全流程
- 证书链：X.509、PKI、Certificate Transparency
- 零知识证明（ZKP）：zk-SNARKs / zk-STARKs / Bulletproofs
- 侧信道攻击：timing、power analysis、Spectre/Meltdown
- 安全最佳实践：constant-time、nonce 不重用、密钥轮转

### 第十一部分 · 信息论与编码

- Shannon Entropy（离散源熵、联合熵、条件熵、互信息）
- 信道容量：香农公式 C = B·log₂(1 + SNR)
- 无损压缩：哈夫曼、LZ77 / LZ78 / zstd、算术编码、ANS
- 汉明码（可纠 1-bit 错）
- Reed-Solomon (GF(2⁸))
- BCH 码 + 循环码 + CRC32C
- LDPC（5G NR 数据信道）
- Polar 码（Arikan 2008，5G NR 控制信道）
- Turbo 码（3G/4G BCJR 迭代）
- 调制：QPSK / 16-QAM / 64-QAM 星座图

### 第十二部分 · 人工智能与机器学习

- Foundations: 线性回归 → 逻辑回归 → MLP → 损失函数谱 → 泛化/正则
- Backpropagation: 计算图 / 反向模式 AD / 雅可比链式 / 梯度检查
- Transformer: self-attention / MHA / FFN / LayerNorm / 残差 / Encoder-Decoder / 训练损失
- Optimizers & Training Dynamics: SGD/Momentum/Adam/AdamW/二阶 + 初始化/LayerNorm/warmup/checkpoint
- Generative Models: VAE & ELBO / 扩散模型 / AR 采样 / speculative decoding

### 第十三部分 · 元抽象（从原第九部分挪到末尾，现重号收束前面十二部分）

- 顺序 vs 链接：CPU 视角下两种物理化
- 摊还 vs 最坏：工程常数与硬实时的张力
- 分治 vs 贪心 vs DP：什么是"最优子问题分解"
- 缓存层级：从 L1 到 HBM 到 RDMA 的同构
- 编程语言运行时：四种实现语义
- 并发与一致性：单机到分布式同构
- 推理链：硬件层如何决定软件设计
