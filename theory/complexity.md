# 6. Complexity Classes: P / NP / NPC / co-NP / PSPACE

## TL;DR

"可计算"分水岭只是 0/1 (停不停);"可高效计算"则是另一道连续谱. 把"高效"形式化为**多项式时间**, 得到最经典的一条链:

$$ \text{L} \subseteq \text{NL} \subseteq \text{P} \subseteq \text{NP} \subseteq \text{PSPACE} \subseteq \text{EXPTIME} $$

谁知道哪些包含关系是真/假, 哪些是著名的开放问题——**P vs NP** 是七大千禧难题之首, 而一系列等价关系 (NPC = NP 的"最难点") 把具体"自家问题难不难"的判断简化为一次归约测试.

---

## 一、复杂度模型基础

### 1.1 输入大小 $n$

复杂度按输入**长度** $n = |\langle x \rangle|$ 度量. 用笛卡尔编码即可 (例如 $n$ 个 vertex 的 graph 编码长 ≈ $n^2$).

### 1.2 多项式 = "可行性"

Cobham-Edmonds thesis (1964–1965): "**多项式时间** = 现实可行". 理由:
- 多项式 → 随硬件 doubling, 解题规模积极涨幅 polynomial 多项.
- 阶不影响 too much: n³ 比 n⁵ 提速 2 个数位也不致 broke.
- 算法稳定: 多项式复合仍多项式.

实践冲淡: $n^{10}$ 还是炸. 但学界平均**固定边界**, 目标投篮统一照 polynomial. 这是 NP-complete 论文体系所有结构性的来源.

### 1.3 TM (理论) vs RAM (工程)

实际 CPU 不会按单带 TM 跑. RAM 模型 (单位操作 → O(1)) 与 TM ≥ 多项式 diff (RAM 上 O(n log n) sort ⇔ TM 上 O(n log² n)); 但 polynomial 边界不一致, Cobham-Edmonds thesis 跨模型 robust.

---

## 二、类 P

$P = \bigcup_{k \geq 0} \text{TIME}(n^k)$. 现成例子:

| 问题 | 复杂度 |
|------|--------|
| 排序 | $O(n \log n)$ |
| 最短路 (Dijkstra) | $O((n+m)\log n)$ |
| 2-SAT | $O(n+m)$ |
| 线性规划 (Interior Point) | $O(n^{3.5} \log \epsilon^{-1})$ |
| 最大匹配 | $O(n^{2.5})$ |
| 素数判定 (AKS) | $O(\log^{7.5} n)$ |
| Matrix 矩乘 | $O(n^{2.373})$ (理界); 工程用 $O(n^3)$ |

工程经验: P 的问题不要直接套 NPXX horror 实装——必定有 P 算法没找出. (DSA 章节帮你)

---

## 三、类 NP: 验证的多项式等价

### 3.1 两种等价定义

**(E1) NDTM**: NTM 接受的语言 (存在接受 computation branch), 且多项式 step 内必停.

**(E2) 多项式可验证**: $L \in \text{NP}$ iff 存在 DTM $V$ 与多项式 $p$, $x \in L \Leftrightarrow \exists c, |c| \leq p(|x|)$ 使 $V(x, c) = 1$ 在 poly 时间. 这里 $c$ 叫**证书 (certificate)**.

二者等价 (NTM 路径作为 certificate).

### 3.2 经典 NP 成员

| 问题 | 证书 | 验证式 |
|------|------|-------|
| SAT (满足性) | 真值指派 | substitute & check |
| 3-coloring | 着色方案 | 检查每条边两端异色 |
| TSP decision | 路径顺序 | 长度 ≤ k? |
| Hamiltonian cycle | 顶点序 | check 每邻接 + 起终相同 |
| Subset-sum | 子集 | sum 检查 |
| Integer programming | 整数解 | 验证 $Ax = b, x \geq 0$ |
| Clique | 顶点集 | 检查子集内全连边 |

### 3.3 验证是 poly; 搜索是 exp

```python
def verify_sat(formula, assignment) -> bool:
    return formula.subs(assignment) is True   # O(|formula|)

def solve_sat(formula, n_vars):
    for asg in itertools.product([False, True], repeat=n_vars):
        if verify_sat(formula, asg):
            return asg
    return None                                # worst: 2^n 次 verify
```

这就是 NP "比 P 多了一个 verify-polynomial" 的核心.

---

## 四、NPC: NP 的"最难点"

### 4.1 定义

$A$ NPC iff:
- $A \in \text{NP}$;
- 对任意 $B \in \text{NP}$, $B \leq_p A$ (多项式归约).

### 4.2 Cook-Levin (1971)

**定理**: SAT is NPC.

**证明直觉**: 任 NP 问题等价存在 NTM M 接受 $x \in L$. M 跑多项式 step 内停 ⇒ computation tableau 的网格能用 polynomial-size formula 描述 (每格"前一邻格 → 当前格"由 M 的转移函数确定的局部 constraints). 公式大小 poly, 满足 ⇔ M 接受. 故 NP 语言全部归约到 SAT.

这是 Cook-Levin 模板, 一切 NP 完备性的"种子".

### 4.3 第二个 NPC: SAT → 3-SAT

引入"clauses-of-3"标准形式. 配合 **Karp reduction** (真多项式), 把 SAT 的 SAT $\to$ 3-SAT 把"任意 clause 长度" 整成等长 3 clauses. 进 1972 Karp 论文: 21 个独立 NPC 问题.

### 4.4 NPC 验证清单

证 $A$ NPC:
1. $A \in \text{NP}$ (给证书 + 验证器).
2. 取已知 NPC 的 $B$, 构造多项式 $f$ 使 $x \in B \Leftrightarrow f(x) \in A$.

工程抒发: 看到 NPC 问题意味着"暂时不要花时间找 poly 算法, 因为如果找到, P=NP".

> [!WARNING]
> NPC 不等于"无解" — 也不表示"必指数级". 一些 NPC 实际有"sub-exp"满足算法 (3-SAT 可以到 $1.31^n$ 而不是朴素 $2^n$). 工程关心参数化 (FPT)、近似 (PTAS) 等. (见 approximation.md)

---

## 五、co-NP

### 5.1 定义

$L \in \text{co-NP}$ iff $\overline{L} \in \text{NP}$.

直觉: 答案是"否"拥有多项式可验证的证书. 例:
- UNSAT ("这个公式不可满足") ∈ co-NP. 证书: ... 没有任何简洁证书, hence 普遍认为 co-NP ≠ NP, 但虽未证.
- TAUT ("所有真值指派都使公式真") ∈ co-NP.

### 5.2 P 显然在 NP ∩ co-NP

任何 P 问题, 答案是/否都可直接计算. 故 $P \subseteq NP \cap co-NP$. 反向开放.

### 5.3 重要成员: FACTOR

整因式分解语言:
$$ \text{FACTOR} = \{(n, k) \mid n \text{ 含因子 } d, 1 < d \leq k\} $$

属于 NP (证书: $d$; 验证 $d | n$) 也属于 co-NP (证书: 素因式分解全部证明 factor; 验证 $d \cdot e = n$ 与 PRIMES ∈ P). 因此 FACTOR ∈ NP ∩ co-NP.

→ 业内大量证据支撑 **FACTOR ∉ NPC**, 因为若 FACTOR NPC, 则 NP = co-NP (推出一系列遭遇). 这恰好 crypto 安全假设: **RSA 困难假设 factoring 困难**, 但不能是 NPC; 否则密码学界塌缩.

### 5.4 交叉层关系

```
co-NP
   ↑       NP
   \      /
    \    /
  NP ∩ co-NP
      |
      P
```

---

## 六、PSPACE: 内存多寡

$PSPACE = \bigcup_k SPACE(n^k)$. 包容关系:
$$ P \subseteq NP \subseteq PSPACE, \quad P \subseteq co\text{-}NP \subseteq PSPACE $$

### 6.1 QBF 是 PSPACE-complete

量词布尔公式 (Quantified Boolean Formula): 形如 $\exists x \forall y \exists z\, \phi(x, y, z)$. PSPACE-complete by alternating TM 等价 (Chandra-Kozen-Stockmeyer 1981).

### 6.2 PSPACE 典问题

- QBF decision
- generalized chess (n×n 棋盘) — EXPTIME-complete (略超 PSPACE).
- generalized Go (n×n) 含 no-pass 规则 — EXPTIME.
- million-step planning in STRIPS — PSPACE-complete.

工程: PSPACE 经常表示"完整棋/puzzle 类" — 把 backtracking 但要保留 path 信息完整.

### 6.3 PSPACE ⊆ EXPTIME

实际严格 less: PSPACE ⊆ EXPTIME 已证, PSPACE = EXPTIME 未知. 已知 P ⊊ EXPTIME (Time Hierarchy Theorem).

---

## 七、其它经典层级

### 7.1 L / NL (log-space)

- L: $O(\log n)$ 工作带 TM 决定问题. 解 ST-connectivity ($u \to v$ 在有向图上可走?) 实际 NL-complete. Reingold 2004 证 ST connectivity in undirected graph ∈ L.
- NL ⊆ P: 因 config 总共 $n^{O(1)}$ 个所以可仿真整图.

### 7.2 Savitch 定理

$\text{NSPACE}(s(n)) \subseteq \text{SPACE}(s(n)^2)$. 直觉: DTM 用递归子调用, 每层记录分叉 config $s(n) \cdot \log$ 栈 → 总二次.

→ NPSPACE = PSPACE. (把非确定性的代价翻平方成确定性的空间)

### 7.3 NC / AC (parallel)

$NC^k$ = poly-size depth $O(\log^k n)$ Boothlean circuits 输出. NC = ⋃. 例子: $\text{sort} \in NC$ (parallel radix sort) ; $\text{Circuit Value} \in P$-complete 是 "inherently sequential" 证据.

### 7.4 随机化类

| Class | 含义 |
|-------|------|
| RP | "若 x ∈ L, 算法有 ≥ 1/2 概率接受; 若 x ∉ L, 必 reject" |
| coRP | 对称 |
| BPP | "无论 x ∈ L 与否, 算法有 ≥ 2/3 概率给正确答案" |
| ZPP | RP ∩ coRP, "Las Vegas: 一直正确, 可能花更多时间" |

广为猜测: $P = BPP$ (Adleman 证明 BPP ⊆ P/poly, Impagliazzo-Wigderson 1997 给出在合理 hardness 假设下的 derandomization ).

### 7.5 量子类

- BQP: 量子 poly-time > 2/3 概率正确.
- Shor's algorithm 把 FACTOR ∈ BQP. Grover 把 unstructured search 从 $O(n)$ 到 $O(\sqrt n)$ (建议 NP 任何问题 $\Omega(\sqrt n)$ 是下界).
- BQP ⊆ PSPACE, 与 NP 关系不明朗 but plausible: **NP ⊄ BQP** (intellectual Q-computing 界主流观点), 否则整个 Computational Geometry 现代 crypto unraveling.

---

## 八、Oracles 与 relativization 障碍

为理解 P vs NP 为何难, Baker-Gill-Solovay 1975: 存在 oracle $A$ 使 $P^A = NP^A$, 又存在 oracle $B$ 使 $P^B \neq NP^B$.  ⇒ "对角线论证"这种"证明停机问题"的工具**单独** 对 P vs NP 不够 (relativizing barrier).

其后 Barrington et al. 给出 **arithmeticization** + **natural proof** barrier (Razborov-Rudich 1994) — 简化证明 attempt 全部 fall short of P vs NP.

2010s 主流方法: algebraic geometry + Geometric Complexity Theory. 至今未破屏障.

工程经验: **不要**自己宣称 "我证了 P=NP"; 几乎一定有错. 像 Deolalikar 2010世纪以来影响最大的尝试以非现实 locality 假设而失败.

> [!NOTE]
> 业界假设 P ≠ NP 是 Cryptography RSA / 椭圆曲线安全的底座. 严格说, RSA 安全只假设 factoring 困难; **factoring 困难 ≠ NPC难**, 它属 NP ∩ co-NP. 真正"NP 困难"被假设需要 whole-NP 拼反抗数十亿亚马逊实例才行, 不严格满足 NP 困难, 但就 Showstopper 角度锲般.

---

## 九、工程应用两路径

### 9.1 看到 NP-hard 时怎么办

承认事; 不要"找多项式算法"; 大致三个出路:
- **近似**: 给 $\epsilon$ 提出可证 $|OPT| \cdot (1+\epsilon)$ 内 PTAS.
- **参数化**: 引参数 $k$, 找到 $O(2^k \cdot \text{poly}(n))$ 算法 (FPT).
- **启发式 + 局部搜索 / 遗传算法 / 强化学习**: 无证明但经验例: vertex cover 用 LDS 在 5% 实例达 optimum.

### 9.2 看到 NPC 时甚至要先识别

把新问题简化到 NPC 标准范式后, 用 8 个经典 NPC 文题本查询 (Garey-Johnson 红宝书)。常见:
- 0/1 Knapsack (weak-NP): 实际可做 FP, $O(n \cdot W)$
- TSP (decision form): strong-NP, 不友边权巨数.
- Set cover: 强 NPC 且 inapproximation barrier $\Omega(\ln n)$.

---

## 十、桥梁

- **下一章 reduction**: 给例: 3-SAT → Clique → Vertex Cover → Hamiltonian → TSP. 当你看新问题想"是不是 NPC", 直接用 reduction 链横立.
- **第八章 approximation**: NPC 之后, 转手看 PTAS, APX-hard, hard-of-approximation.
- **第六部分 distributed**: Paxos/Raft 在异步系统**≠ PSPACE/EXPTIME** 问题, 而是 **FLP impossibility** — 异步网络含 crash failure, 共识无确定算法. 这是另一维"不可解" (区别于本章语义解码).

---

下一节 → [Polynomial-time Reductions](reductions.md)
