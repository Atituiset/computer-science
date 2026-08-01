# 第九部分 · 计算理论（Formal Languages / Automata / Complexity）

## 一句话

**计算理论**回答两个根本问题：**(1) 什么是"可计算"？**(2) **什么是"高效可计算"？** 前者把所有"能算的事情"用形式化机器（自动机、图灵机）框死，并给出绝对不可逾越的边界（停机问题、Rice 定理）；后者把"高效"形式化为复杂度类 P / NP / PSPACE，告诉你哪些问题注定无法在多项式时间内解。所有工程上的"优化是 NP-hard"、"这条正则匹配不上"、"语言不可判定"——都源自这里。它是把 DSA、编译原理、密码学（基于 NP 困难）连接起来的那一层。

## 思想链

```
[正则匹配 /^(a|b)*ab$/ on "aaaab"]
  └─> 正则 → ε-NFA → 子集构造 → DFA → 状态机驱动 (常数时间每字符)
       │       (字典树 / AC 自动机 / ReDoS 防护都建立在这里)
       └─> 但是 (a^n b^n) 正则匹配不上 → 需要更高层级: PDA
             └─> PDA ⇔ CFG ⇔ 上下文无关 → parser 用的 LR/LALR
                   └─> 但 (a^n b^n c^n) PDA 也匹配不上 → 需要 TM
                         └─> TM 能算所有"可计算"问题
                               └─> 但是停机问题不可判定: 没有算法能判断任意程序是否会停
                                     └─> Rice 定理: 任意非平凡语义性质都不可判定
                                           └─> P vs NP: 多项式可验证 ≠ 多项式可解?
                                                 └─> NPC 归约: 3-SAT → Clique → Vertex Cover...
                                                       └─> 现代密码学 (RSA / 椭圆曲线) 假设 factoring/NP 不在 P
```

## 章节

- [开篇：从正则到不可判定，计算的四级爬升](index.html) ← 当前
- [1. 自动机：DFA → NFA → ε-NFA → 子集构造 → DFA 最小化](automata.md)
- [2. 正则语言与泵引理](regular.md)
- [3. 下推自动机（PDA）与上下文无关文法（CFG）](cfg-pda.md)
- [4. 图灵机：deterministic / non-deterministic / Church-Turing](turing-machine.md)
- [5. 不可判定性：停机问题、Rice 定理](undecidability.md)
- [6. Complexity classes：P / NP / NPC / co-NP / PSPACE](complexity.md)
- [7. Polynomial-time reduction：3-SAT → Clique → Vertex Cover](reductions.md)
- [8. Approximation algorithms、hardness of approximation](approximation.md)
- [附录：常见判定问题分类速查表](appendix.md)

读完应能回答：

1. 为什么 `^(a|b)*ab$` 可以用 DFA 常数空间匹配，但 `^(a^n)(b^n)$` 必须用栈?
2. 子集构造最坏情况会让 N 状态的 NFA 爆成 2ⁿ 状态的 DFA——这个下界是怎么构造的?
3. Pumping lemma 是必要非充分条件，那"非正则"的常规证法是什么? Myhill-Nerode 怎么给充要?
4. 为什么 LR(1) 比 LL(1) 强但 parser 都更爱 LL? Chomsky 层级是怎么对应自动机层级的?
5. 停机问题怎么用对角线法证明? Rice 定理为什么让"程序是否 malware"也变得不可判定?
6. P=NP 是七大千禧难题之一，为什么密码学家假设 NPA≠P? 如果 NPA 在 P，RSA 会立刻崩盘吗?
7. 3-SAT 是 NPC 完备问题的"Mona Lisa", 怎么从 3-SAT 归约到 Clique、Vertex Cover、TSP、Subset Sum?
8. 什么问题在 PSPACE 但估计不在 NP? QBF / generalized geography / 围棋盘面判定
9. PTAS、APX-hard、Inapproximability ratio：为什么 set cover 估计比只能到 (ln n) 因子?

## 历史 1: 1936 Turing 与 Church 各自独立

Turing 发表 "On Computable Numbers", 用假想机器 (Turing Machine) 给出"可计算"的形式化; Church 同年用 λ-calculus 给出同样结论. 二者等价, 史称 **Church-Turing Thesis**——任何"算法"都能用 TM 表达。这是计算理论的奠基.

## 历史 2: 1956 Kleene / 1959 Rabin-Scott

Kleene 给出正则语言定理; Rabin-Scott 1959 引入 DFA/NFA, 证明二者等价, 诞生子集构造法。1968 Thompson 把 NFA 编译成汇编, 这就是今天 grep / sed / RegEx 的源头（Thompson 构造法，第一部分 dsa/topics/string 里有提及）.

## 历史 3: 1936 Gödel / 1931 不完备

Gödel 不完备定理先于 Turing 5 年: 任何强到包含 PA 的形式系统必有不可证真命题. 直接启发 Turing 的停机问题.

## 历史 4: 1971 Cook-Levin / 1972 Karp

Cook-Levin 证明 SAT 是 NP-complete (第一个 NPC 问题); Karp 1972 列出 21 个经典 NPC 问题 (TSP / 3-SAT / Clique / Vertex Cover ...), 把"对一个个具体问题找算法"变成"识别 NPC 后就停止找多项式算法"——这是工程上最实用的一面.

## 历史 5: 1977 Garey & Johnson

"Computers and Intractability: A Guide to the Theory of NP-Completeness" 出版, 成为 NPC 问题的"红宝书", 至今仍是工程师面对新问题的第一查询对象.

---

下一节 → [自动机：DFA → NFA](automata.md)
