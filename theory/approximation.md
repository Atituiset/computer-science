# 8. Approximation Algorithms、Hardness of Approximation

## TL;DR

承认 NPC, 不代表放弃工程实现. **近似算法 (approximation algorithm)** 在多项式时间给出可证近似比 (approximation ratio) 的解. PTAS / FPTAS / APX-hard / PCP theorem 把"是否可近似"也分级——例如 set cover 不可能近似比 $\ln n$ 内, 这条下界由 PCP 定理 (Feige 1998) 给. 本章给你 4 个经典近似例 + 近似下界工具包.

---

## 一、定义与记号

### 1.1 Approximation Ratio (min/max)

对最优问题 (minimization):

- 算法 $A$ 的近似比 $\rho_A(n) = \max_{|I| = n} \frac{A(I)}{\text{OPT}(I)}$.

对 max:

- $\rho_A(n) = \max \frac{\text{OPT}(I)}{A(I)}$ (亦即最小 $r$ 使 $A \geq \text{OPT}/r$).

$\rho = 1$ 即精确 (VPN optimum); $\rho = 2$ 即 "至少一半好".

### 1.2 PTAS / FPTAS

- **PTAS** (Polynomial Time Approximation Scheme): 对任意 $\epsilon > 0$, 算法 $A_\epsilon$ 给 $\leq (1+\epsilon)\text{OPT}$, 时间多项式 $n^{O(1)}$ 但可指数于 $1/\epsilon$.
- **FPTAS**: time poly in $n, 1/\epsilon$. 强, 罕见.
- **EPTAS**: poly $n$, exp $1/\epsilon$ but constant (semi-strong).

---

## 二、经典近似算法

### 2.1 Vertex Cover: 2-approximation

贪心匹配: 任取未匹配边 $(u, v)$, 加入 $u, v$到 cover, 删 $u, v$ 关联边. 重复.

```python
def vertex_cover_2approx(edges: list[tuple[int, int]]):
    cover, used = set(), set()
    for u, v in edges:
        if u in used or v in used:
            continue
        cover.update([u, v])
        used.add(u); used.add(v)
    return cover
```

**正确性**: 每取一条边 ⇒ 加入 2 个顶点 → cover 终 ≥ 实最优取至少其中一 (因最 OPT 必含 $u$ or $v$, else 边未 cover); matched edges 全 disjoint ⇒ OPT ≥ matched count.
$\rho \leq 2$.

注: 设 20+ 年界 1.3606 下界非常 necked; Håstad 2001 证**: 不可能 (在 P≠NP) ratio < 2-o(1). Dinur-Safra 2002 把下界推到 1.36. 二者间 1.36–2 间开放. **2-approximation 20 年无人飞跃**——这就是 NP approximation 困难的实证.

### 2.2 Set Cover: ln-approximation

```python
import math

def set_cover_ln(universe, sets):
    cover = []
    U = set(universe)
    while U:
        s = max(sets, key=lambda s: len(s & U))
        cover.append(s)
        U -= set(s)
    return cover
```

**贪心比**: 每个 step 添 ≥ $1/k$ of remaining optimum-cover. 总步骤 ≤ $H_n \cdot \text{OPT}$ ($H_n$ 为调和数 ≈ $\ln n$). 故 ratio $\leq \ln n$.

**Hardness**: PCP theorem 后 Feige 1998 证 $\rho > (1-o(1))\ln n$ ⇒ NP $\not\subseteq$ DTIME($n^{O(\lg\lg n)}$).

→ 当前理论与实际上下界几乎重合, ln-set cover 是"不可超越"的算法.

### 2.3 TSP- Metric: 2-approximation and 1.5 Christofides

**2-approx**: 求最小生成树 (MST), DFS 一遍复制为 tour; 因 MST ≤ OPT, DFS 两次 MST ≤ 2 OPT.

**Christofides (1.5)**: 求奇度 vertex 集 (MST 内偶数 vertex 节点, 数 = even), 用 perfect matching 给奇度配对, 加这些边到 MST → Eulerian 图; 经 Euler tour → shortcut 经三角不等式 → $\leq 1.5\text{OPT}$.

工程值得: TSP (metric) 用作实际物流工具 H 后 lecele; dynamic programming $O(n^2 2^n)$ 给精确 OPT 还能跑 $n \leq 20$ instances.

### 2.4 Knapsack: FPTAS

```python
def knapsack_fptas(weights, values, W, eps):
    n = len(weights)
    Vmax = max(values)
    scale = max(1, int(eps * Vmax / n))
    sv = [v // scale for v in values]
    
    # DP on reduced value
    dp = {0: 0}     # reduced_value → min total weight
    for i in range(n):
        ndp = dict(dp)
        for rv, tw in dp.items():
            nr = rv + sv[i]
            nw = tw + weights[i]
            if nw > W:
                continue
            if nr not in ndp or ndp[nr] > nw:
                ndp[nr] = nw
        dp = ndp
    
    best_rv = max(dp)
    return best_rv * scale
```

舍入 $\epsilon V_{\max}/n$ ⇒ values range $\leq n \cdot \frac{V_{\max}}{\text{scale}}$, DP table O(n²V_max/scale), 误差 $\leq n \cdot \text{scale} \leq \epsilon V_{\max}$. FPTAS.

**性质**: 0/1 Knapsack 在 input binary 编码下是 weak-NP-hard, partition variant 是 strong-NP (即使数值 unary 仍 NPC). 0/1 非强 NPC → FPTAS.

### 2.5 MAX-SAT: 7/8-approximation

随机指派: 每文字 1/2 chance. 期望 satisfied clause 数 ≥ 7m/8.

**Karlin-Williams 7/8 lower bound (1997)**: 任何 $\epsilon$ better → P=NP. **Random rounding ratio 上界与此 close**.

→ Randomized algorithms 不只好看, 还是 MAX-SAT 实践上最佳.

---

## 三、Approximation Hardness

### 3.1 PCP Theorem (Arora-Lund-Motwani-Sudan-Szegedy 1992)

PCP (Probabilistically Checkable Proofs) 的语言形式: NP = PCP($O(\log n), O(1)$). 

工程化叙述: NP 任何证明都可被改成一种协议, verifier 仅读 3 个 random bit (consistency 局部) 即可知 $\geq 1-\epsilon$ 确信. 这条定理也是 ∈ IP=PSPACE breakthrough 后果.

### 3.2 Gap Amplification

PCP 把 "证明错误 1 位" 放大到 "\epsilon 错误位 使验证 reject" ⇒ 把 exact problem 转 gap problem "$\text{OPT} \geq c$ vs $\text{OPT} \leq s$".

例 (MAX-3SAT): GAP versions:

- YES: 可满足全 clause.
- NO: 满 ≤ 7/8 clause.

若 poly algorithm distinguishes ⇒ P=NP. 故 MAX-3SAT 7/8-approximation **tight**.

### 3.3 Inapproximability Results

| 问题 | Inapproximability | Bound |
|------|------|------|
| MAX-3SAT | ≥ 7/8 ≤ 1 (Håstad 2001) | tight |
| Set Cover | $\geq (1-o(1))\ln n$ | tight to ln-greedy |
| Vertex Cover | $\geq 1.3606$ | gap vs 2-approx |
| TSP-metric | $\geq$ 123/122 (Karpinski-Lampis-Schmied 2015) | ⇒ 1.5 appears close 但 gap 仍 |
| Independent Set | $\geq n^{1-\epsilon}$ for any $\epsilon$, assuming NP $\neq$ ZPP | huge; = NP-hard to $O(2^{\log^{1-\epsilon} n})$-approx. |
| Coloring | NP-hard to color n²^ε 但 actually coloring-3 always NP-hard | matches algor if |
| Metric Min Multi-Cut-Clique | logarithmic hard. |  |

**Unique Games Conjecture (UGC, Khot 2002)**: 假设更强约束使某些 hardness 更紧. 现 Vertex Cover 2-approx 等价 UGC. 成熟立但 unverified.

---

## 四、Practice 接口

近似算法的"实现 - 经验" 关键标准:

| 工具 | 目标问题 | 接口 |
|------|---------|------|
| Gurobi / CPLEX | ILP (incl. TSP, scheduling, bin packing) | LP-relaxation + cut branch |
| OR-Tools / SCP parsers | Vehicle Routing | 调 2-OPT, 3-OPT, savings |
| LocalSolver | 高维 mixed | simulated annealing + tabu |
| Concorde | TSP 精确 | cut ILP |

工程心法: 先写伪多项式 fallback, 再写 approximation lie+ 输出 ratio; 再 fallback heuristic, 比较实践. 给极少数 instances exact DP 实际秒杀 (n ≤ 20), register数万行 ins 何必实际 listen to theory.

---

## 五、Parameterized Complexity (旁支)

适合"难度取决于结构参数"问题. FPT (fixed-parameter tractable) for parameter $k$ ⇒ $O(f(k) \cdot \text{poly}(n))$ 算法.

经典例子:
- Vertex Cover $k$: $O(1.2738^k + k n)$ (Chen-Kanj-Xia 2010).
- Feedback Vertex Set $k$: $O(3^k \cdot k n^2)$.
- Planarity: $O(2^{O(k)} n)$ on planar graphs.

W-hierarchy 把 hard-beyond likely FPT (W[1], W[2], ...). Hilbert–Laut issue of clique unlikely FPT under ETH.

**ETH (Exponential-Time Hypothesis)**: 3-SAT 不在 SUBEXP. ⇒ $n$-variable 3-SAT requires $2^{\Omega(n)}$ time ⇒ clique ≥ $n^{O(k)}$ 等约束. ETH 已成 21st 世纪 P≠NP 替代.

---

## 六、与前面章节的桥

- **DSA / dp**: 0/1 Knapsack DP O(nW) vs NP-hard. 这是为什么 DSA terms 算法 often 直接 pseudo-poly, populated by big-W 输入可能爆.
- **DSA / greedy**: MST prime-Kruskal 用 subset perspective 看最优子集下 ZIP; approximating 用 MST = TSP 案例.
- **第七部分 system-design / estimation**: 当客户问"再便宜的 routing path", 你回"硬 NPC, 但 Christofides 1.5×"; 看下面 capacities good estimate is right-algorithm but not only.
- **DB查询优化器**: join order selection is QCQ NPC; commercial systems approximate via DP on left-deep trees, polynomial then exact.
- **compiler 内联 inline**: optimal inline planning; heuristics (call frequency profiling) 多冲突. (DSA graph scheduling complexity ref.)

---

下一节 → [附录](appendix.md)
