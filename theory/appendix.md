# 附录: 常见判定问题分类速查表

> 编程现场/面试/代码评审的快速参考. 按字母与域分别罗列.

---

## A.1 — 自动机与文法层级

| Chomsky Type | 文法 | 自动机 | 例子 |
|------|------|------|------|
| 0 | unrestricted grammar | TM | "任意程序计算的语言" |
| 1 | context-sensitive | LBA (Linear Bounded Automaton) | $\{a^n b^n c^n\}$, $\{ww\}$ |
| 2 | context-free | PDA | $\{a^n b^n\}$, balanced parens, JSON |
| 3 | regular | DFA / NFA / ε-NFA | atom regex `^[ab]*$`, IP match |

## A.2 — 经典 RE / CFL 反例

| 语言 | 类别 | 证度 |
|------|------|------|
| $a^n b^n$ | CFL 非 RE | pumping |
| $a^n b^n c^n$ | sensit-context 非 CFL | pumping |
| $\{ww\}$ | CSG 非 CFL | pumping |
| $\{ww^R\}$ (回文) | CFL | construct CFG |
| Dyck language (balanced parens) | CFL | standard |
| $\{a^* b^* c^*\}$ | regular | trivial |
| $a^*$ | regular | trivial |
| $\{a^p \mid p \text{ prime}\}$ | 非 CFL | pumping |

## A.3 — NP 问题速查表

### A.3.1 NP-Complete 经典

| 问题 | 起点归约 | 在第一部分对应章节 |
|------|------|------|
| SAT | Cook-Levin | — foundational — |
| 3-SAT | SAT | — |
| Clique | 3-SAT | 见 reductions |
| Vertex Cover | Clique via IS | reductions |
| Independent Set | Clique (补图) | reductions |
| Hamiltonian Cycle | 3-SAT | reductions |
| TSP decision | Ham Cycle | reductions |
| 3-Coloring | 3-SAT | reductions |
| Subset Sum | 3-SAT | reductions |
| 0/1 Knapsack | Subset Sum | dsa/topics/dp |
| Partition | Knapsack | dsa/topics/dp |
| Bin Packing | Partition | — |
| Job Scheduling | Partition | — |
| Longest Path | Hamiltonian | dsa/topics/graphs |
| SAT for Circuit | SAT | — |
| Planar 3-SAT | SAT | — |
| Set Cover | Vertex Cover | approximation |
| Steiner Tree | SAT | graph chapter |
| Hitting Set | Set Cover | reductions |
| Integer Programming | Subset Sum | reductions |
| Job-shop Scheduling | SAT | — |

### A.3.2 NP-Intermediate (conjectured, unproven if P≠NP)

| 问题 | 推荐 |
|------|------|
| FACTOR | Shor's (BJP 算) crypto assumption |
| Graph Isomorphism | Babai quasi-poly |
| Discrete Log | crypto assumption |

### A.3.3 PSPACE-Complete

- QBF (Quantified Boolean Formulae)
- Generalized Geography
- Sokoban decision problem

## A.4 — Undecidable (not even RE)

| 问题 | 证明 tool |
|------|------|
| 停机问题共形式 | 对角线 |
| Total TM 是否对所有输入必停 ("Tot") | 用 Rice ($\Pi_2$) |
| Post Correspondence | Turing config 归约 |
| Hilbert's 10th | PCP 归约 |
| Wang tiles 平面铺 | TM tape 归约 |
| Word problem for groups | Boone-Novikov |
| 判断 TM 输出多项式函数行数 | Rice |
| $\mathcal{RE} \neq \mathcal{R}$ | 停机 |

## A.5 — Crypto 困难假设对照

| 假设 | 所属类 | 推论 |
|------|------|------|
| $P \neq NPC$ | complexity theory | Cook-Levin 后仍未证 |
| Integer factoring hard | FACTOR not in P (假设) | RSA 安全 iff factoring hard |
| Discrete log hard | DLOG not in P (假设) | ECDLP / 椭圆曲线安全 |
| LWE (Learning-with-errors) hard | worst-case lattice problem (Regev) | 后量子 crypto 基础 |
| BQP 不含 NP-complete | quantum complexity | Shor 不能解 NP |
| Quad-SVP approximation | lattice problem | 已知 NP-hard (under random reduction) |

## A.6 — Approximation Class 速查

| Class | 含义 |
|------|------|
| APX | ratio ≤ constant (存在 c-approx) |
| PTAS | $\forall \epsilon$ poly → $(1+\epsilon)$-approx |
| FPTAS | time poly in $n, 1/\epsilon$ |
| APX-hard | 不可能 PTAS (unless P=NP) |
| APX-complete | 在 APX 类且其 reduction preserve ratio |

例:
- Vertex Cover: APX-complete, $(2-\theta)$ open.
- TSP-metric: APX-complete, gap 1.5 ⇔ 1.3606.
- Set Cover: log-approx, APX-hard 推 hard of approx.
- Knapsack: FPTAS.

## A.7 — 与项目其他章节交叉索引

- DSA 部分的 [数论与模运算](../dsa/topics/number-theory.md): 给 pow-mod, CRT, RSA 路径.
- DSA [数论](../dsa/topics/number-theory.md) Miller-Rabin: PRIMES ∈ NP_proof.
- 编译原理 [LR/LALR 文章](../compilers/parser/lr.md): 学习 DCFL.
- 编译原理 [type-system.md](../compilers/sema/type-system.md): HM 类型推断可判定.
- [分布式 cap / flp](../distributed/concepts/failure.md): 异步共识 FLP 不可能 = 不可判定在网络层。
- 系统设计 [snowflake](../system-design/case/snowflake.md): 弱序交易 ID 系统设计连续 IDs.
- [compilers/sema](../compilers/sema/type-system.md): 类型推断代价 (Hindley-Milner O(n²) 转置 mgu).

---

下一节 → [密码学与安全 README](../crypto/README.md)
