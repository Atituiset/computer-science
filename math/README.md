# 第零部分 · 工程数学与离散数学基础

## 一句话

这份笔记剩下十二部分——从 DSA 的复杂度、OS 的排队论、DB 的概率代价模型、Compiler 的图论支配点, 到 Crypto 的数论/有限域、信息论的 Shannon 熵、未来 Transformer 章节的张量微积分与反向传播——**反复在用同一组数学**: 离散结构 + 线性代数 + 概率统计 + 微积分/优化. 把这四件工具抽到一处讲透, 后面每章节用到时只管引用, 数学再也不是瓶颈. 本部分不做教材复读机, 只覆盖**读后面 CS 主线 + 读 Transformer / 信息论 / 密码学原论文必需的下限**, 每个概念都标明喂给哪一章.

## 思想链

```
[你在 DSA 章里看到 "Master Theorem: T(n) = a T(n/b) + f(n)"]
  └─> 这是递推 + 指对数变换 → 离散数学篇的 "递推与生成函数" 讲透
        └─> [在 Compiler 章看到 "支配树 (dominator tree) 是 DAG"]
              └─> 图论 + 偏序集 → 离散数学篇的 "图与关系" 讲透
                    └─> [在 DB 章看到 "选择度cardinality estimation 用 sampling"]
                          └─> 概率分布 + 估计理论 → 概率篇讲透
                                └─> [在 Crypto 章看到 "椭圆曲线群上的离散对数难"]
                                      └─> 群/环/域 + 模运算 → 离散代数 → 离散篇讲透
                                            └─> [在信息论章看到 "I(X;Y) = H(X) − H(X|Y)"]
                                                  └─> 期望 + 凸函数 → 概率篇讲透
                                                        └─> [你将来读 Transformer 原文]
                                                              └─> softmax · 雅可比 · 链式法则 · KL 散度
                                                                    └─> 张量 · SVD · Hessian · 凸优化
                                                                          └─> 全部在本部分四篇里
                                                                                └─> 读完此部分, 后续数学不是瓶颈
```

## 你将带走什么

读完应能:

1. 看到任意递推式 (Master / Akra-Bazzi) 立刻报出复杂度; 看见 $\sum$/$\prod$/$\binom{n}{k}$ 不再卡.
2. 把"集合 / 关系 / 函数 / 等价类 / 偏序 / 闭包" 当作同一组离散对象操作; 一条 SQL join、一个 `git rebase` 的偏序图、一个 type hierarchy 在你眼里是同构的.
3. 看到任意矩阵 $A \in \mathbb{R}^{m \times n}$ 能立刻说: 它的秩 / 列空间 / 零空间 / SVD / 谱范数是什么; 看见 "$A$ 是正定" 就知道所有几何与优化推论.
4. 给一个概率模型能直接写: 似然 $\mathcal{L}(\theta)$、MLE 闭式解、MAP 的先验怎么选、KL 散度方向. 大数定律、中心极限定理不背书能推.
5. 拿一个 loss 函数能徒手做反向传播: 链式法则 → 雅可比 → 梯度. 看到 Hessian 知道曲率与收敛速度, 看到 KL 知道信息几何度量.
6. 看见论文里的 $\nabla_\theta \mathcal{L}$, $\mathbb{E}_{z \sim q_\phi}$, $\arg\max$, $\mathrm{softmax}(x_i) = \frac{e^{x_i}}{\sum_j e^{x_j}}$ 不再绕路查, 直接进语义.

## 章节结构

- [开篇: 工程数学 + 离散数学为什么放最前](index.html) ← 当前
- [1. 离散数学: 逻辑 / 集合 / 关系 / 图 / 组合 / 递推 / 代数结构](discrete.md)
- [2. 线性代数: 向量空间 / 矩阵 / 谱 / SVD / 张量](linalg.md)
- [3. 概率统计: 分布 / 贝叶斯 / MLE / MAP / 极限 / KL](prob.md)
- [4. 微积分与最优化: 链式法则 / 雅可比 / Hessian / 凸优化 / 信息几何](calc-opt.md)

## 一句话定位各篇

| 篇 | 读完即解锁后面 |
|----|----------------|
| **离散数学** | DSA 全部 / Compiler 的 CFG 与支配树 / Crypto 的群环域 / OS 的偏序调度 / Distributed 的逻辑时钟与序 |
| **线性代数** | OS page rank / DB 列存向量化 / Info-theory 的信道矩阵 / Transformer 的 QKV 矩阵与多头注意力 / PCA |
| **概率统计** | OS 排队论 / DB 代价估计 / Distributed 选举与 quorum / Crypto 语义安全 / Info-theory 熵与编码 / Bayesian 网络 |
| **微积分与优化** | OS 控制论 / Compiler 的 strength reduction / Info-theory 容量优化 / ML 反向传播与 SGD / 信息几何 |

## 与后续各部分的接口表

| 后续部分 | 用到的本部分章节 | 典型概念 |
|--------|------------------|----------|
| 第一 · DSA | 离散 4/5/6 (图/组合/递推) | 复杂度主定理, 排列组合计数, 图遍历 |
| 第二 · OS | 概率 5 (极限) + 离散 4 (偏序) | 排队论, 调度 DAG, working set |
| 第三 · 网络 | 概率 4 (Bayes) + 离散 5 | 网络流, 拥塞控制微分方程 |
| 第四 · DB | 概率 3 (估计) + 离散 6 (关系) | 关系代数, cardinality sampling, MVCC 序 |
| 第五 · Compiler | 离散 3/4/6 + 线代 | 图可达性, 支配树, SSA, 寄存器图着色 |
| 第六 · 分布式 | 离散 4 (偏序) + 概率 3 | 因果序, FLP 不可能, quorum 概率 |
| 第七 · 系统设计 | 概率 5 + 线代 5 | Little's Law, 幂律分布, Cache 命中率 |
| 第八 · 组成原理 | 线代 4 + 离散 5 | 流水线冒险的布尔逻辑, DMA |
| 第九 · 计算理论 | 离散 1 + 5 | 形式语言, 归约, 复杂度类 |
| 第十 · 密码学 | 离散 6 (代数) + 概率 4 | 有限域, 离散对数, 语义安全 |
| 第十一 · 信息论 | 概率 1/2/5 + 微积分 3 | 熵, 凸函数 Jensen, 容量优化 |
| 未来 · ML/Transformer | 线代 6 (张量) + 微积分 2/3/4 | softmax Jacobian, attention 矩阵, 反向传播, 各类优化器 |

## 数学记号约定

本部分及后续章节统一:

| 记号 | 含义 |
|------|------|
| $\mathbb{N}, \mathbb{Z}, \mathbb{Q}, \mathbb{R}, \mathbb{C}$ | 自然 / 整数 / 有理 / 实 / 复数集 |
| $\mathbb{R}^n, \mathbb{R}^{m \times n}$ | $n$ 维实列向量 / $m \times n$ 实矩阵 |
| $\mathbf{1}_A, \mathbb{1}\{P\}$ | 集合 $A$ 的指示函数 / 事件 $P$ 的指示变量 |
| $\|x\|_p$ | $L_p$ 范数; $\|x\|_2$ 欧式, $\|x\|_1$ 曼哈顿, $\|x\|_\infty$ 无穷 |
| $\langle x, y\rangle$ | 内积 (默认标准内积) |
| $A^\top, A^{-1}, A^+, \det A, \operatorname{tr} A$ | 转置 / 逆 / 伪逆 / 行列式 / 迹 |
| $\lambda_{\max}(A), \sigma_{\max}(A)$ | 最大特征值 / 最大奇异值 |
| $\Pr[E], \mathbb{E}[X], \operatorname{Var}(X)$ | 概率 / 期望 / 方差 |
| $X \sim \mathcal{N}(\mu, \sigma^2)$ | $X$ 服从正态分布 |
| $\nabla f, \nabla^2 f$ | 梯度 / Hessian |
| $O(\cdot), \Theta(\cdot), \Omega(\cdot), o(\cdot)$ | 渐进上/紧/下/严格低界 |
| $\equiv, \Leftrightarrow, \Rightarrow$ | 等价 / 充要 / 推出 |
| $\sum, \prod, \int$ | 求和 / 求积 / 积分 |

## 历史 1: 数学从「展演」到「工具」

直到 19 世纪末, 数学主要被看作「展演正确性」的几何 (Euclid, Hill-bert纲领). 转折来自:

- **Cantor (1874)** 集合论, 把"对象"抽象成元素归类, 离散与连续统一描述.
- **Boole (1847)** 把命题逻辑符号化; **Frege (1879)** 量词引入谓词逻辑.
- **Galois (1832)** 把方程根的对称性抽象成"群", 开启代数结构时代.
- **Shannon (1937)** 在硕士论文用 Boole 描述电路, 把逻辑与硬件从此打通.
- **von Neumann (1945)** 用矩阵描述量子; 后续与 Turing/Gödel 把可计算性数学化.

几乎所有"现代"概念——状态机、加密、调度、神经元——本质都是上述四个抽象在不同语境的复用.

## 历史 2: 计算机"故意"用最少的数学

计算机绕开重数学的几次关键:

- Dijkstra 把分布算法从微积分里抽出来, 用 `==` 不变式与最弱前置条件证明.
- Turing 把"计算"压成纸带符号集, 所以 TM 用最基本集合+函数即可定义.
- Curry-Howard 把逻辑证明和程序等价, ML 派系不需要范畴论也能用.
- Cloud Native 用声明式 schema (YAML/HCL) 把不变式显式化, 无需要证.

→ **结论**: 本部分讲解数学, 不为「让你在每行注释里推演」, 而为「让你看懂前面十二部分为何能这样设计, 并在未来读论文时不在记号处卡住」.

## 阅读路径推荐

按背景三选一:

1. **DSA 已熟 + 看论文吃力**: 先看 [2 线性代数](linalg.md) 与 [3 概率统计](prob.md), 再看 [4 微积分](calc-opt.md).
2. **应用背景 + 没系统学过理论**: 从 [1 离散数学](discrete.md) 入, 它最贴近 DSA 与 Compiler.
3. **学习 Transformer 优先**: 走 [2 → 3 → 4](linalg.md) 这条线, 离散可以暂时跳过.

## 与 TODO 的关系

`TODO.md` 中列的"未来可继续扩展方向 **AI/ML 理论与实践（含 attention/Transformer 数学）**"的前半——attention 数学——的预备知识全在本部分. 未来 ML 章节直接引用本部分 §2/§3/§4 即可, 不再重头讲线代与反向传播.

---

下一篇: [1. 离散数学: 逻辑 / 集合 / 关系 / 图 / 组合 / 递推 / 代数结构](discrete.md).
