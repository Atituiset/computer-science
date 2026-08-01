# 1. 离散数学: 逻辑 / 集合 / 关系 / 图 / 组合 / 递推 / 代数结构

## TL;DR

计算机里几乎所有"结构"——状态、链接、调度、协议、类型、密钥——都是**离散对象 + 关系**。这一篇覆盖 7 个相互串接的核心:

1. **命题与谓词逻辑** — 程序不变式、Hoare 三元组的语言.
2. **集合** — 元素 + 隶属; 一切数据结构的最朴素的容器.
3. **关系与函数** — `git rebase`、外键、MRO 看似无关其实同构.
4. **图** — DSA 第 5 章、OS 调度、Compiler CFG、Distributed 一致性都靠它.
5. **组合计数** — $\binom{n}{k}$、$\sum$、容斥; DSA 与概率论的中间地带.
6. **递推与生成函数** — 复杂度主定理、Fibonacci、Catalan 的统一视角.
7. **代数结构: 群环域** — Crypto 全部、信息论 BCH/RS 编码的硬基础.

目标: 让你看 `DFA`、`git merge-base`、` FOREIGN KEY`、`ECDSA over secp256k1`、`Master Theorem` 时不再"知道但说不清".

---

## 一、命题与谓词逻辑

### 1.1 命题联结词

| 联结 | 符号 | 真值表 |
|-----|------|--------|
| 非 | $\neg P$ | 翻转 |
| 与 | $P \land Q$ | 同真 |
| 或 | $P \lor Q$ | 至少一真 |
| 蕴含 | $P \Rightarrow Q$ | "若 P 则 Q"; 只在 P 真 Q 假时为假 |
| 等价 | $P \Leftrightarrow Q$ | 同真假 |
| 异或 | $P \oplus Q$ | 不同真 |

工程翻译:

- `if (P) {...}` 的前置条件是 $\neg P$ 表示"程序不变式未维护".
- `&&`, `||` 短路求值 ($P \land Q$ 在 P 假时 Q 不必算) ⊆ 严格命题逻辑.
- 异或 $\oplus$ 是密码学奇偶检验、`FEC parity`、`CRC` 的核心.

### 1.2 关键恒等式

$$ P \Rightarrow Q \;\equiv\; \neg P \lor Q \;\equiv\; \neg Q \Rightarrow \neg P \quad (\text{逆否}) $$

$$ \neg(P \land Q) \;\equiv\; \neg P \lor \neg Q \qquad \text{(De Morgan)} $$

$$ \neg(P \lor Q) \;\equiv\; \neg P \land \neg Q $$

$$ (P \Rightarrow Q) \land (P \Rightarrow R) \;\equiv\; P \Rightarrow (Q \land R) $$

### 1.3 谓词逻辑: 量词

加入"对所有 / 存在":

- $\forall x \in S: P(x)$ — 对所有 $x$ 满足.
- $\exists x \in S: P(x)$ — 至少一个满足.

否定翻转量词 (这是最容易出错的):

$$ \neg \big( \forall x: P(x) \big) \;\equiv\; \exists x: \neg P(x) $$
$$ \neg \big( \exists x: P(x) \big) \;\equiv\; \forall x: \neg P(x) $$

**例**: $\forall T \in \text{Threads}: \text{safe}(T)$ 的反面是"$\exists T$ 不safe", 即"有 bug 时的反例".

### 1.4 与程序的不变式

Hoare 三元组 $\{P\}\ S\ \{Q\}$: 若执行前 $P$ 真, 则 $S$ 终止后 $Q$ 真.

最弱前置条件 $\mathrm{wp}(S, Q)$ 是所有使 $S$ 终止后满足 $Q$ 的最弱前置. Dijkstra 用它做了**程序演算**, 把程序证明转为公式演算.

> [!NOTE]
> 在 Compiler 章节 ( SSA / CFG / 支配树) 里你会反复看到"边和分支谓词"; RISC-V `beq`/`bne` 指令对应谓词逻辑上的原子命题比较.

---

## 二、集合

### 2.1 基本定义

- 元素 $a \in A$, 空集 $\emptyset = \{\}$.
- 子集 $A \subseteq B$: $\forall x \in A \Rightarrow x \in B$.
- 真子集 $A \subsetneq B$: 子集且 $A \neq B$.
- 集合大小 $|A|$, 幂集 $\mathcal{P}(A) = 2^A$, $|2^A| = 2^{|A|}$.

### 2.2 集合运算

| 运算 | 记号 | 内涵 |
|------|------|------|
| 并 | $A \cup B$ | 至少其一 |
| 交 | $A \cap B$ | 都在 |
| 差 | $A \setminus B$ | A 中但不在 B |
| 对称差 | $A \triangle B$ | 恰在一个; $= (A \setminus B) \cup (B \setminus A)$ |
| 笛卡尔积 | $A \times B$ | 有序对 $(a, b)$ |

$$ |A \cup B| = |A| + |B| - |A \cap B| \quad (\text{容斥}) $$

### 2.3 与类型的关系

类型系统里的 `Set<T>` / `Option<T>` / `&'a T` 都可视为带约束的集合:

- `Option<T>` ≡ $\{\bot\} \cup T$.
- `enum` ≡ 不相交并 (tagged union).
- `struct { A, B }` ≡ 笛卡尔积.
- `&'a T` ≡ $T$ 受 lifetime `'a` 约束子集.

> [!TIP]
> Curry-Howard: 命题 = 类型, 证明 = 程序. $\land$ ↔ `tuple`, $\lor$ ↔ `enum`, $\Rightarrow$ ↔ 函数类型. Rust 的 `Result<T, E>` 就是命题"$T$ 或 $E$".

---

## 三、关系与函数

### 3.1 关系 (二元关系)

$R \subseteq A \times B$ 是一个二元关系. 当 $A = B$, 称 $R$ 是 $A$ 上的关系. 记 $a R b$ 表 $(a, b) \in R$.

**五大性质**:

| 性质 | 定义 | 工程例子 |
|------|------|----------|
| 自反 | $\forall a: a R a$ | $=$、$\leq$、$\to$ 自闭包 |
| 反自反 | $\forall a: \neg(a R a)$ | $<$, 严格偏序 |
| 对称 | $a R b \Rightarrow b R a$ | "朋友" / 无向边 |
| 反对称 | $a R b \land b R a \Rightarrow a = b$ | $\leq$, $\subseteq$ |
| 传递 | $a R b \land b R c \Rightarrow a R c$ | $<$, $\to$, $\sqsubseteq$ |

### 3.2 三种关键关系

- **等价关系**: 自反 + 对称 + 传递 → 把集合拆成不相交等价类. 商集 $A / R$ 即等价类集合.
  - 例: 整数模 $n$ 的同余 $\equiv_n$ → $\mathbb{Z}/n\mathbb{Z}$.
  - 例: Rust `Hash + Eq` 把同一桶当成等价类.
- **偏序 (partial order)**: 自反 + 反对称 + 传递. 记 $\leq$.
  - 例: `git` commits 的祖先关系 ($\text{merge-base}$ 是下确界).
  - 例: 多继承 MRO (C3 linearization) 即偏序的拓扑序.
  - 例: 集合包含 $\subseteq$.
- **全序**: 偏序 + 任两元素可比. 例: $\leq$ on $\mathbb{Z}$.

### 3.3 闭包

最小扩 $R$ 以满足某性质的**最小关系**:

- 自反闭包: 加 $\{(a, a) : a \in A\}$.
- 对称闭包: 加 $\{(b, a) : (a, b) \in R\}$.
- 传递闭包: $R^+ = \bigcup_{k \geq 1} R^k$ (关系合成 $k$ 次).

> [!NOTE]
> Warshall 算法 (Floyd-Warshall 的"非加权版") 求传递闭包 $O(n^3)$. 在 Compiler 的可达分析里这是 SSA 的 phi 节点注入候选计算.

### 3.4 函数

$f: A \to B$ 是 $A \times B$ 的特殊关系: 每一 $a \in A$ 恰有一个 $b = f(a) \in B$.

- 单射 (injective): 不同 $a$ 映到不同 $b$.
- 满射 (surjective): $f(A) = B$.
- 双射 (bijective): 单 + 满; 存在逆 $f^{-1}$.

**例**: 哈希函数 `h: Key → Slot` 不是单射 (满射/碰撞), 退化为多值; 完美哈希才是双射.

> [!WARNING]
> `Map<K, V>` 内部哈希函数 $h$ 不是数学意义的函数吗?
> 是, 严格定义 $h$ 在给定 key 上确定地映射到某 slot (确定性). 但**碰撞**让它退化为"多对一"——单射失败的来源. 后果在 [hash-table 章节](../dsa/structures/hash-table.md) 详细讨论.

---

## 四、图

### 4.1 形式化

图 $G = (V, E)$, $E \subseteq V \times V$ (有向) 或 $E \subseteq \binom{V}{2}$ (无向). 加权则 $w: E \to \mathbb{R}$.

**几种特殊图**:

| 名 | 性质 | 出现在 |
|----|------|--------|
| DAG | 有向无环 | Compiler CFG (含回边不同步), `git`, `npm deps` |
| 树 | 连通无环 | 决策树、AST、DOM |
| 二部图 | $V = A \cup B$, $E \subseteq A \times B$ | 匹配、二分图最大流 |
| 完全图 $K_n$ | 所有边 | DNS 全连接集群 |
| $k$-正则 | 每点度 $k$ | Tornado (mixer)、P2P |

### 4.2 关键概念

- **度**: $d(v)$ = 邻接边数; $\sum_{v \in V} d(v) = 2|E|$. (握手引理)
- **路径与环**: 路径不重复边 = trail; 不重复点 = simple.
- **连通分量**: 无向图的最大连通子图.
- **生成树**: 连通图的极小连通子图; $|T| = |V| - 1$.
- **强连通分量 (SCC)**: 有向图里每两点互达; Tarjan $O(V+E)$.
- **入度/出度**: 有向图; $d_{\text{in}}(v), d_{\text{out}}(v)$.
- **拓扑序**: DAG 上 $\forall (u, v) \in E: u <_{\text{topo}} v$.

### 4.3 图表示与遍历

按工程取舍选择:

| 表示 | 空间 | 邻接查询 | 适合 |
|------|------|-----------|------|
| 邻接矩阵 | $\Theta(V^2)$ | $O(1)$ | 稠密图, Floyd, 传递闭包 |
| 邻接表 | $\Theta(V + E)$ | $O(d(v))$ | 稀疏, social, web |
| 边表 | $\Theta(E)$ | $\Theta(E)$ | Kruskal |
| CSR (compressed sparse row) | $\Theta(V + E)$ | $O(d(v))$ 缓存友好 | GPU, 大图计算 |

**遍历**:

- **DFS** 用栈 / 递归; 可判连通、拓扑序、SCC. $\Theta(V + E)$.
- **BFS** 用队列; 给最短路 (无权) 与层序. $\Theta(V + E)$.

> [!NOTE]
> Tarjan 的 SCC、Dijkstra 的 lazy-pop、A* 的 priority queue 都把"图遍历 + 谓词顺序"统一为同一框架. 这是 DSA 第 5 章的核心.

### 4.4 经典定理: 欧拉回路判定

**判定**: 连通图存在欧拉回路 $\Leftrightarrow$ 每点度偶数; 存在欧拉路径 $\Leftrightarrow$ 恰 0 或 2 点奇度.

**应用**: DNA 片段拼接 (de Bruijn graph)、LeetCode "reconstruct itinerary".

### 4.5 二部图与匹配

- 二部图判定: BFS / DFS 二着色 (无奇环).
- 最大匹配在二部图 = Hopcroft-Karp $O(E \sqrt V)$; 无向一般图 = Edmonds blossom $O(V^2 E)$.
- 最大流模型统一 matches、assignment、Hall 婚姻定理.

---

## 五、组合计数

### 5.1 四大基本法则

| 法则 | 公式 | 用法 |
|------|------|------|
| 加法法则 | $\|A \cup B\| = \|A\| + \|B\|$ ($A, B$ 不交) | 不同 case 计数 |
| 乘法法则 | $\|A \times B\| = \|A\| \cdot \|B\|$ | 组合状态 |
| 包含-排除 (容斥) | $\|\cup_i A_i\| = \sum \|A_i\| - \sum \|A_i \cap A_j\| + \cdots$ | 错排、棋盘 |
| 鸽巢原理 | $|A| > k \cdot |B| \Rightarrow \exists$ 桶 $\geq k+1$ | 必然碰撞 |

### 5.2 排列与组合

- **排列** (有顺序): $A_n^k = P(n, k) = \dfrac{n!}{(n-k)!}$.
- **组合** (无序): $\binom{n}{k} = \dfrac{n!}{k!(n-k)!}$.
- **$k$-可重组合** (放回抽样): $\binom{n+k-1}{k}$.
- **全排列**: $n!$; **$k$-可重排列**: $n^k$.

**重要恒等** (Pascal):

$$ \binom{n}{k} = \binom{n-1}{k-1} + \binom{n-1}{k} $$

**Vandermonde**:

$$ \binom{m+n}{k} = \sum_{i=0}^k \binom{m}{i}\binom{n}{k-i} $$

### 5.3 高级工具

- **生成函数**: 数列 $\{a_n\}$ 的普通生成函数 $G(x) = \sum_n a_n x^n$. 组合恒等可代数推导.
- **指数生成函数**: $E(x) = \sum_n a_n \dfrac{x^n}{n!}$; 排列场景.
- **容斥原理**: 子集加减交错, 解决 "恰 k 个性质" 问题.

### 5.4 重要组合数

| 数列 | 闭式 / 递推 | 用途 |
|------|------|------|
| Catalan $C_n = \frac{1}{n+1}\binom{2n}{n}$ | $C_{n+1} = \sum_{i+j=n} C_i C_j$ | AST 计数、合法括号 |
| Stirling (无符号) ${n \brace k}$ | $n$ 元素分 $k$ 不空子集 | Partitions |
| Stirling (有符号) $[n \atop k]$ | $n$ 元素分 $k$ 圈 | Permutations |
| Bell $B_n = \sum_k {n \brace k}$ | 全集划分 | 等价关系总数 |

### 5.5 朴素思路估复杂度

| 形式 | 量级 |
|------|------|
| $n!$ (permute all) | $n=10$ → $10^7$, $n=20$ → $10^{18}$ |
| $2^n$ (subset) | $n=20$ → $10^6$, $n=40$ → $10^{12}$ |
| $n^2$ | $n=10^4$ → $10^8$ (1s), $n=10^5$ → $10^{10}$ (太慢) |
| $n \log n$ | $n=10^6$ → $\sim 2 \times 10^7$, 1 s 内 |
| $n$ | $n=10^8$ 仍 $<1$s |

> [!WARNING]
> 看见题目 brute force $\geq 2^{40}$, 现实机器 1s = $10^8$ ops, 必须剪枝或转 DP/归约. 这是 DSA `branch-bound` 章节的存在理由.

---

## 六、递推与生成函数

### 6.1 解递推的三大工具

| 形式 | 适用 | 方法 |
|------|------|------|
| **主定理 (Master)** | $T(n) = a T(n/b) + f(n)$ | 比较 $f$ 与 $n^{\log_b a}$ |
| **Akra-Bazzi** | $T(n) = \sum_i a_i T(n/b_i + h_i) + g(n)$ | 求解 $p$ 使 $\sum a_i b_i^{-p} = 1$ |
| **生成函数** | 任意线性常系数递推 | $G(x) = P(x) / Q(x)$ 取系数 |

### 6.2 主定理 (记忆版)

设 $T(n) = a T(n/b) + f(n)$, $a \geq 1, b > 1$, 定义 $n^{\log_b a}$:

1. $f(n) = O(n^{\log_b a - \epsilon}) \Rightarrow T(n) = \Theta(n^{\log_b a})$ — 叶子主导.
2. $f(n) = \Theta(n^{\log_b a} \log^k n) \Rightarrow T(n) = \Theta(n^{\log_b a} \log^{k+1} n)$ — 同阶.
3. $f(n) = \Omega(n^{\log_b a + \epsilon})$ 且正则条件 $\Rightarrow T(n) = \Theta(f(n))$ — 根主导.

**查表(熟记即可秒定)**:

| 算法 | $a$ | $b$ | $f(n)$ | $T(n)$ |
|------|-----|-----|--------|--------|
| 二分查找 | 1 | 2 | $O(1)$ | $\Theta(\log n)$ |
| 归并排序 | 2 | 2 | $O(n)$ | $\Theta(n \log n)$ |
| Karatsuba | 3 | 2 | $O(n)$ | $\Theta(n^{\log_2 3}) \approx n^{1.585}$ |
| Strassen 矩阵乘 | 7 | 2 | $O(n^2)$ | $\Theta(n^{\log_2 7}) \approx n^{2.807}$ |
| 普通快排最坏 | 1 | $n-1$ | $O(n)$ | $\Theta(n^2)$ |

### 6.3 通过生成函数解 Fibonacci

设 $F_0 = 0, F_1 = 1, F_n = F_{n-1} + F_{n-2}$. 生成函数:

$$ G(x) = \sum_n F_n x^n = \frac{x}{1 - x - x^2} $$

分母 $1 - x - x^2 = (1 - \varphi_+ x)(1 - \varphi_- x)$, 其中 $\varphi_\pm = \dfrac{1 \pm \sqrt 5}{2}$.

部分分式 → 闭式 (Binet):

$$ F_n = \frac{1}{\sqrt 5}\left(\varphi_+^n - \varphi_-^n\right), \quad F_n = \Theta(\varphi_+^n) \approx \Theta(1.618^n) $$

**工程含义**: 普通递归 Fibonacci 是指数级. 用 memoization / DP 后 $O(n)$; 用矩阵快速幂 $O(\log n)$.

```python
def fib_fast(n: int) -> int:
    # 矩阵快速幂: [[1,1],[1,0]]^n = [[F_{n+1}, F_n],[F_n, F_{n-1}]]
    def mul(A, B):
        return [[A[0][0]*B[0][0] + A[0][1]*B[1][0],
                 A[0][0]*B[0][1] + A[0][1]*B[1][1]],
                [A[1][0]*B[0][0] + A[1][1]*B[1][0],
                 A[1][0]*B[0][1] + A[1][1]*B[1][1]]]
    def pow_mat(M, k):
        R = [[1,0],[0,1]]
        while k:
            if k & 1: R = mul(R, M)
            M = mul(M, M); k >>= 1
        return R
    return pow_mat([[1,1],[1,0]], n)[0][1]

# 复杂度: 乘法 O(M(大数位数)) → 总 O(n 位 · log n)
# 这里 n 是步数, 内部 M(数字位数) 可视为常数
```

```typescript
export function fibFast(n: number): number {
  // 同上矩阵快速幂;BigInt 在 n 较大时必需
  type Mat = [bigint, bigint, bigint, bigint];
  const mul = (A: Mat, B: Mat): Mat => [
    A[0]*B[0] + A[1]*B[2], A[0]*B[1] + A[1]*B[3],
    A[2]*B[0] + A[3]*B[2], A[2]*B[1] + A[3]*B[3],
  ];
  let R: Mat = [1n, 0n, 0n, 1n];
  let M: Mat = [1n, 1n, 1n, 0n];
  let k = n;
  while (k > 0) {
    if (k & 1) R = mul(R, M);
    M = mul(M, M); k >>= 1;
  }
  return Number(R[1]);
}
```

### 6.4 生成函数速查

| 递推 | 生成函数 | 渐近 |
|------|----------|------|
| $F_n = F_{n-1} + F_{n-2}$ | $\frac{x}{1 - x - x^2}$ | $\Theta(\varphi^n)$ |
| $C_n = \sum_{i+j=n} C_i C_j$ | $\frac{1 - \sqrt{1-4x}}{2x}$ | $\Theta(4^n / n^{3/2})$ |
| 二叉树数 | Catalan 同上 | $\Theta(4^n / n^{3/2})$ |

> [!NOTE]
> DSA `complexity.md` 章节里所有"递推式 → 渐近"的解读, 本质就是这一节的工具反复应用. 看见 $T(n) = 2 T(n/2) + n\log n$ 立刻报 $n \log^2 n$.

---

## 七、代数结构: 群 / 环 / 域

这一小节是 **Crypto 第十部分** 与 **信息论 BCH/RS** 的硬前置.

### 7.1 三层结构

| 结构 | 公理 | 例 |
|------|------|-----|
| **半群** $(S, \cdot)$ | 结合律 | 字符串拼接; 字母表 |
| **幺半群** ($+$ 有幺元 $e$) | $e \cdot a = a \cdot e = a$ | $\mathbb{N}$ 与 $+$, $e = 0$; Rust 类型类 `Monoid` |
| **群** $(G, \cdot, e, {}^{-1})$ | 幺元 + 逆 + 结合 | $(\mathbb{Z}, +)$; $(\mathbb{Z}_p^*, \cdot)$; 椭圆曲线点加法 |

**群的四条公理**:

1. 封闭性: $\forall a, b \in G: a \cdot b \in G$.
2. 结合律: $(a \cdot b) \cdot c = a \cdot (b \cdot c)$.
3. 幺元: $\exists e: a \cdot e = e \cdot a = a$.
4. 逆元: $\forall a: \exists a^{-1}: a \cdot a^{-1} = e$.

可交换群 (Abelian): $\forall a, b: a b = b a$.

### 7.2 子群 / 陪集 / Lagrange

子群 $H \leq G$: $H \subseteq G$ 且自身成群. 陪集 $a H = \{a h : h \in H\}$.

**Lagrange 定理**: $|G| = |H| \cdot [G : H]$, 即子群大小整除群大小.

→ 推论: 素数阶群无非平凡子群; 元素的阶整除群阶。

### 7.3 环与域

**环** $(R, +, \cdot)$: $(R, +)$ 是 Abelian 群, $(R, \cdot)$ 半群, 分配律.

**域** $(\mathbb{F}, +, \cdot)$: $(\mathbb{F}^*, \cdot)$ 也是 Abelian 群 (非零元可逆). 即"能做加减乘除".

**关键例**:

- $\mathbb{Q}, \mathbb{R}, \mathbb{C}$ 无限域.
- $\mathbb{F}_p = \mathbb{Z}/p\mathbb{Z}$ ($p$ 素): 最常用的有限域.
- $\mathbb{F}_{p^k}$ (扩展域): BCH / RS 码用 $\mathbb{F}_{2^8}$.
- 椭圆曲线 $\mathbb{F}_p$ 上点的加群.

### 7.4 模运算

$\mathbb{Z}_n = \{0, 1, \ldots, n-1\}$ 加法模 $n$. 它是环; $\mathbb{Z}_p$ ($p$ 素) 是域.

**重要定理** (Fermat 小定理): $a^{p-1} \equiv 1 \pmod p$ ($a \not\equiv 0$).

```python
def mod_pow(base: int, exp: int, mod: int) -> int:
    # 平方乘: O(log exp) 次乘法, 全程 mod
    result = 1
    base %= mod
    while exp > 0:
        if exp & 1:
            result = result * base % mod
        base = base * base % mod
        exp >>= 1
    return result

# Crypto 中 RSA 取 d 使 ed ≡ 1 (mod φ(n));
# 这把 pow(x, ed, n) → x 还原 RSA
```

### 7.5 离散对数 = Crypto 的硬假设

**定义**: 给定 $g$ 与 $h = g^x$ in 群 $G$, 求 $x$ = **DLP**.

- 在 $\mathbb{Z}_p^*$ 上, $x$ 大 (e.g. $p = 2^{256}$) 时, DLP ~ $O(\sqrt p)$ (Pollard rho), 仍硬.
- 在椭圆曲线群 $\mathbb{F}_p$ 上, DLP ~ $O(\sqrt N)$; 无 sub-exponential 算法 → 同长更安全 → secp256k1, Curve25519.

> [!WARNING]
> RSA / ECDSA / Ed25519/DH 全部依赖这个"看似可逆但实际不可逆"的指数化. 这就是 Crypto 第十部分的核心. 你之后看出"群 + 离散对数难"就立刻把整条 TLS 1.3 链路看穿.

### 7.6 与"离散"和"传统"的对比

| 传统 (连续) | 离散 |
|-----|------|
| $\mathbb{R}$ 实数, 无限小数 | $\mathbb{Z}, \mathbb{F}_p$ |
| 微积分, 极限 | 数论, 取模 |
| 物理 (Newton-Leibniz) | 计算 (Turing) |
| 信息论连续: 微分熵 | Shannon 离散熵 |

计算机世界本质就是"离散为主, 连续为辅"——但优化、信号处理某些处需要"连续数学版" (见 §2 线代 §3 概率 §4 微积分).

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **逻辑**: $\neg \forall \equiv \exists$. $P \Rightarrow Q \equiv \neg P \lor Q \equiv \neg Q \Rightarrow \neg P$.
> - **集合**: $|A \cup B| = |A| + |B| - |A \cap B|$. 幂集大小 $2^{|A|}$.
> - **关系**: 等价 = 自反对称传递; 偏序 = 自反反对称传递.
> - **图**: 握手引理 $\sum d = 2|E|$; DAG 有拓扑序; 二部图无奇环.
> - **组合**: $\binom{n}{k} = \binom{n-1}{k-1} + \binom{n-1}{k}$; Catalan $C_n = \frac{1}{n+1}\binom{2n}{n}$.
> - **递推**: $T = aT(n/b) + f$ → 比 $f$ 与 $n^{\log_b a}$.
> - **代数**: 群 =幺元+逆+结合; 域 = 可加减乘除; $\mathbb{F}_p$ 与 $\mathbb{F}_{p^k}$; DLP 难.

---

下一篇: [2. 线性代数: 向量空间 / 矩阵 / 谱 / SVD / 张量](linalg.md).
