# 拓扑排序与强连通分量

## 一句话

拓扑排序处理 **DAG** 上"先做 X 再做 Y"的依赖排序, 强连通分量 (SCC) 处理任意有向图上"互相可达"的极大子集。二者由一个动作连接: **把图缩成 SCC 后一定得到 DAG**, 于是任何有向图的问题都可以拆成"分量内部 (SCC) + 分量之间 (DAG)"两层。主流实现各两个——拓扑序用 Kahn 或 DFS 三色, SCC 用 Kosaraju (两次 DFS, 最易读) 或 Tarjan (一次 DFS + lowlink, 最快)——工程界默认组合是 **Kahn + Tarjan**。

读完应能：

1. 用入度剥离与 DFS 后序逆序两种方式求拓扑序, 并说出各自适合的场景；
2. 写出 Kosaraju 与 Tarjan 的 Python / Go 实现, 并解释 lowlink 的含义；
3. 说清两种 SCC 算法的对照与取舍；
4. 把 2-SAT 归约到 SCC, 并写出无解判定与方案构造。

---

## 思想链

```
问题 A: 一堆任务有依赖关系, 给出安全执行顺序?
  └─► 有环 = 死锁/循环依赖, 无解; 无环(DAG)才有拓扑序
        ├─ Kahn: 入度为 0 的先出队, 删边后新 0 入度继续     → 天然给出并行分层
        └─ DFS: 按"离开时间"逆序即拓扑序                    → 三色标记判环

问题 B: 任意有向图, 求"互相可达"的极大子集?
  └─► SCC 是等价类; 缩点后得到 DAG (无环!)
        ├─ Kosaraju: G 上记后序 → 反图上按逆后序再 DFS      → 2 次 DFS, 最好懂
        ├─ Tarjan:   一次 DFS 维护 dfn/lowlink + 栈          → 1 次 DFS, 更快
        └─ 应用: 2-SAT / 编译器数据流 / 缩点 DP / 死锁检测
```

## 形式化定义

**拓扑序**: DAG $G = (V, E)$ 的顶点线性序列 $\pi$, 使得每条边 $(u, v)$ 都满足 $\pi(u) < \pi(v)$。

- **存在性定理**：$G$ 有拓扑序 $\iff$ $G$ 无环。必要性显然 (环上首尾互相要求先后); 充分性由 Kahn 构造性给出;
- 拓扑序一般**不唯一**; 需要字典序最小时把 Kahn 的队列换成小根堆 ($O((V+E)\log V)$)。

**强连通分量**: 有向图中极大点集 $C$, 使任意 $u, v \in C$ 互相可达。"互相可达"是等价关系, 所以 SCC 恰是按此等价关系的划分; 把每个 SCC 收成一个点、保留分量间边, 得到的**缩点图 (condensation) 必是 DAG**——否则分量还能继续合并。

## 拓扑排序

### Kahn 算法 (BFS 入度剥洋葱)

```python
from collections import deque


def topo_kahn(g: list[list[int]], n: int) -> list[int] | None:
    """g[u] = 出边列表. 返回一个拓扑序; 有环返回 None. O(V+E)."""
    indeg = [0] * n
    for u in range(n):
        for v in g[u]:
            indeg[v] += 1
    q = deque(i for i in range(n) if indeg[i] == 0)
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in g[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    return order if len(order) == n else None    # 输出不满 n 个 ⇒ 有环
```

### Go

```go
// TopoKahn 返回一个拓扑序; 有环返回 nil. O(V+E).
// 队列换小根堆(container/heap)可得字典序最小拓扑序.
func topoKahn(g [][]int, n int) []int {
	indeg := make([]int, n)
	for u := 0; u < n; u++ {
		for _, v := range g[u] {
			indeg[v]++
		}
	}
	q := []int{}
	for i := 0; i < n; i++ {
		if indeg[i] == 0 {
			q = append(q, i)
		}
	}
	order := make([]int, 0, n)
	for len(q) > 0 {
		u := q[0]
		q = q[1:]
		order = append(order, u)
		for _, v := range g[u] {
			if indeg[v]--; indeg[v] == 0 {
				q = append(q, v)
			}
		}
	}
	if len(order) != n {
		return nil // 剩下的点都在环里或被环挡住
	}
	return order
}
```

### DFS 后序逆序 (三色)

```python
def dfs_topo(g: list[list[int]], n: int) -> list[int]:
    """DFS 三色版: 按"离开时间"逆序输出. 遇到灰点 = 回边 = 有环."""
    WHITE, GRAY, BLACK = 0, 1, 2
    color = [WHITE] * n
    order = []

    def visit(u: int) -> None:
        color[u] = GRAY                          # 进入递归栈
        for v in g[u]:
            if color[v] == GRAY:
                raise ValueError("cycle")
            if color[v] == WHITE:
                visit(v)
        color[u] = BLACK                         # 离开: 所有后继已输出在前? 不——在后
        order.append(u)

    for u in range(n):
        if color[u] == WHITE:
            visit(u)
    return order[::-1]
```

> [!NOTE]
> 为什么"离开时间的逆序"是拓扑序？DFS 结束 $u$ 时, 它的所有后继都已结束且更早进入 `order`, 所以逆序里每个 $u$ 都排在它指向的点之前。同一个不变量在 SCC 里会再次出现——Kosaraju 正是靠它找到"反图上的正确起点"。

### 关键性质与延伸

- **并行分层**：Kahn 中同一轮出队的点互不依赖, 可同时执行——CI 流水线、增量编译的任务并行度就是"每层宽度";
- **DAG 上 DP**：拓扑序天然是合法的计算顺序, 沿序转移即可求最长路/路径计数。工程对应物是**关键路径 (CPM)** 与 ML 计算图的内存复用分析 (见 [动态规划](../../algorithms/dp.md));
- **判环**：Kahn 输出不足 $n$ 个、或 DFS 撞到灰点, 都是 $O(V+E)$ 判环。

## SCC: 两种主流算法对照

| | Kosaraju | Tarjan |
|---|---|---|
| DFS 次数 | 2 次 (原图 + 反图) | 1 次 |
| 需要反图 | 需要 (额外 $O(V+E)$ 存储) | 不需要 |
| 核心机制 | 后序逆序 = 反图上正确遍历序 | dfn/lowlink + 显式栈 |
| 实现难度 | 低, 十行可写 | 中, 细节多 (onStack 判断) |
| 递归深度 | 同为 $O(V)$, 大图需迭代化 | 同左 |
| 分量编号顺序 | 无特殊保证 | 恰为**逆拓扑序** (对 2-SAT 至关重要) |

### Kosaraju

```
1) 在 G 上 DFS, 按离开时间压栈;
2) 所有边反向得 G^T;
3) 从栈顶往下取未分配的点, 在 G^T 上 DFS, 一次遍历收拢的点集 = 一个 SCC.
```

直觉: 原图中"最早离开"的点属于汇型分量 (没有出边去别处), 它在反图上变成源型, 从它出发恰好只能走遍自己的分量。

### Go 实现

```go
// Kosaraju: 两次 DFS, O(V+E). 返回 comp[] 分量编号 (0..k-1).
func kosaraju(g [][]int, n int) []int {
	visited := make([]bool, n)
	order := make([]int, 0, n)
	var dfs1 func(int)
	dfs1 = func(u int) {
		visited[u] = true
		for _, v := range g[u] {
			if !visited[v] {
				dfs1(v)
			}
		}
		order = append(order, u) // 按"离开时间"记录
	}
	for u := 0; u < n; u++ {
		if !visited[u] {
			dfs1(u)
		}
	}

	gt := make([][]int, n) // 反图
	for u := 0; u < n; u++ {
		for _, v := range g[u] {
			gt[v] = append(gt[v], u)
		}
	}

	comp := make([]int, n)
	for i := range comp {
		comp[i] = -1
	}
	c := 0
	for i := n - 1; i >= 0; i-- { // 逆后序
		u := order[i]
		if comp[u] != -1 {
			continue
		}
		stack := []int{u} // 反图上迭代 DFS 收拢一个分量
		comp[u] = c
		for len(stack) > 0 {
			x := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, v := range gt[x] {
				if comp[v] == -1 {
					comp[v] = c
					stack = append(stack, v)
				}
			}
		}
		c++
	}
	return comp
}
```

### Tarjan

一次 DFS 同时维护：

- $dfn[u]$：首次访问的时间戳;
- $low[u]$：$u$ 及其在栈中后代能回溯到的最小 $dfn$;

当 $low[u] = dfn[u]$ 时, $u$ 是分量根, 弹栈到 $u$ 为止就是一个 SCC。关键细节: 回边更新用 $dfn[v]$ 且仅当 $v$ **还在栈里** (在栈里 = 与 $u$ 同分量或尚未定论), 否则会把已完成的分量错误地接回来。

### Python 实现 (供 2-SAT 复用)

```python
def tarjan_scc(g: list[list[int]]) -> list[int]:
    """一次 DFS 求 SCC, O(V+E). 返回 comp[], 分量按逆拓扑序编号 0..k-1.
    注意递归深度可达 V; 大图请改显式栈版本."""
    import sys
    sys.setrecursionlimit(max(sys.getrecursionlimit(), len(g) + 100))
    n = len(g)
    dfn = [0] * n                              # 时间戳, 0 = 未访问
    low = [0] * n
    on_stack = [False] * n
    comp = [0] * n
    stk: list[int] = []
    timer = cnt = 0

    def dfs(u: int) -> None:
        nonlocal timer, cnt
        timer += 1
        dfn[u] = low[u] = timer
        stk.append(u)
        on_stack[u] = True
        for v in g[u]:
            if dfn[v] == 0:
                dfs(v)
                low[u] = min(low[u], low[v])   # 树边: 继承孩子
            elif on_stack[v]:                  # 只看还在栈里的横/回边
                low[u] = min(low[u], dfn[v])
        if low[u] == dfn[u]:                   # u 是分量根: 弹栈收拢
            while True:
                x = stk.pop()
                on_stack[x] = False
                comp[x] = cnt
                if x == u:
                    break
            cnt += 1

    for u in range(n):
        if dfn[u] == 0:
            dfs(u)
    return comp
```

### Go 实现

```go
// Tarjan: 一次 DFS, O(V+E). comp 编号为逆拓扑序 (2-SAT 直接可用).
func tarjan(g [][]int, n int) []int {
	dfn := make([]int, n) // 时间戳, 0 表示未访问
	low := make([]int, n)
	onStack := make([]bool, n)
	comp := make([]int, n)
	stk := []int{}
	timer, cnt := 1, 0
	var dfs func(int)
	dfs = func(u int) {
		dfn[u], low[u] = timer, timer
		timer++
		stk = append(stk, u)
		onStack[u] = true
		for _, v := range g[u] {
			if dfn[v] == 0 {
				dfs(v)
				if low[v] < low[u] {
					low[u] = low[v]
				}
			} else if onStack[v] && dfn[v] < low[u] {
				low[u] = dfn[v]
			}
		}
		if low[u] == dfn[u] { // u 是分量根
			for {
				x := stk[len(stk)-1]
				stk = stk[:len(stk)-1]
				onStack[x] = false
				comp[x] = cnt
				if x == u {
					break
				}
			}
			cnt++
		}
	}
	for u := 0; u < n; u++ {
		if dfn[u] == 0 {
			dfs(u)
		}
	}
	return comp
}
```

## 缩点: 把任意有向图变成 DAG

拿到 `comp[]` 后, 遍历所有边 $(u, v)$, 若 $comp[u] \neq comp[v]$ 则缩点图中有一条边。之后所有"DAG 才能做的事"都适用:

- **可达性/传递闭包**: bitset 按 DAG 序合并;
- **缩点 DP**: 点权取分量内权之和 (最大半联通子图、最长链);
- **死锁检测**: 操作系统资源分配图中存在非平凡 SCC (或自环) 即潜在死锁。

## 2-SAT 归约

**问题**: $m$ 个布尔变量, 每条约束形如"$a$ 与 $b$ 至少一真" (析取子句), 问是否存在赋值满足全部子句。

**建模**: 每个变量拆两个点 $x_i$ (真) 与 $\lnot x_i$ (假), 编码上用 `i` 和 `i^1` 互为相反。子句 $(a \lor b)$ 等价于两条蕴含 $\lnot a \to b$、$\lnot b \to a$——"选了一边就必须连锁另一边"。整张蕴含图中:

$$\text{有解} \iff \forall i,\ x_i \text{ 与 } \lnot x_i \text{ 不在同一 SCC}$$

(同分量意味着 $x_i \Rightarrow \lnot x_i$ 且反向也成立, 自相矛盾。) 方案构造利用 Tarjan 分量的逆拓扑序: 取 $comp[x_i] < comp[\lnot x_i]$ 时令 $x_i$ 为真——编号小表示在缩点 DAG 中更靠"下游", 下游的选择不会被上游推翻。

```python
def two_sat(m: int, clauses: list[tuple[int, int]]) -> list[bool] | None:
    """clauses[k]=(a,b): 字面量 a,b 为变量下标, 负数表示否定 (如 -3 = ¬x_3).
    返回一组可行赋值; 无解返回 None. O(V+E)."""
    lit = lambda x: 2 * (x - 1) if x > 0 else 2 * (-x - 1) + 1
    g = [[] for _ in range(2 * m)]
    for a, b in clauses:
        la, lb = lit(a), lit(b)
        g[la ^ 1].append(lb)                     # ¬a → b
        g[lb ^ 1].append(la)                     # ¬b → a
    comp = tarjan_scc(g)
    assign = []
    for i in range(m):
        if comp[2 * i] == comp[2 * i + 1]:
            return None                          # x_i 与 ¬x_i 同分量: 无解
        assign.append(comp[2 * i] < comp[2 * i + 1])
    return assign


assert two_sat(2, [(1, 2), (-1, -2), (1, -2)]) is not None
assert two_sat(2, [(1, 2), (-1, 2), (1, -2), (-1, -2)]) is None   # x1 ↔ ¬x1
```

> [!TIP]
> 口诀: "**拓扑剥洋葱, SCC 双 DFS; Tarjan 一个 low, 2-SAT 选下游**。" 另外记住缩点后的世界永远是 DAG——遇到"有环没法 DP"的第一反应就该是缩点。

> [!WARNING]
> 1. **Tarjan 的回边判断必须带 `onStack[v]`**: 漏掉会把已弹出的分量算进 lowlink, 得到错误的合并;
> 2. **大图递归爆栈**: Python 默认上限 1000, Go 协程栈虽可增长但闭包递归仍建议改显式栈; Kosaraju 第二次遍历用迭代写法可以规避一半深度;
> 3. **拓扑序 ≠ 字典序**: 要字典序最小必须显式用小根堆, 普通 deque 只是"某个"合法序;
> 4. **2-SAT 的字面量编码** (`i` 与 `i^1`) 写错一处, 全部结论作废——先用 2 个变量的小例子自测。

## 应用

- **构建系统 / CI**: Makefile、Bazel 的依赖图求值顺序; 循环依赖报错就是判环;
- **编译器**: 控制流图的支配树预处理、SSA 构造中的数据流迭代 (SCC 加速收敛)、模块循环引用检测;
- **包管理器**: pip/npm/cargo 的安装顺序解析与版本冲突环检测;
- **2-SAT 实战**: 排班约束 ("A 和 B 不能同时值班")、芯片布线的极性选择、游戏谜题求解;
- **PageRank / 图分析**: 大规模网页图的 SCC 先行收缩, 把迭代计算限制在巨分量内。

## 经典题

- LC 207 / 210 课程表 I & II (拓扑序模板);
- LC 802 找到最终安全状态 (反向图 + 拓扑/三色);
- LC 1192 查找集群内的关键连接 (Tarjan 割边, 同族思想);
- LC 851 喧闹和富有 (反图 + 拓扑 DP);
- 洛谷 P2812 校园网络 ([USACO] 缩点 + 入度/出度统计);
- 洛谷 P4782 【模板】2-SAT。

## 一页速查

```
拓扑序:   存在 ⇔ 无环; Kahn 剥入度 O(V+E) 给并行分层; DFS 后序逆序; 字典序要小根堆
SCC:      Kosaraju 2 次 DFS + 反图, 最易写; Tarjan 1 次 DFS, dfn/lowlink + onStack
缩点:     comp[] 不同才连边 → 得 DAG → 一切 DAG 技巧可用 (DP/闭包/关键路径)
2-SAT:    子句 → 2 条蕴含边; 有解 ⇔ x 与 ¬x 异 SCC; Tarjan 序下选编号小的为真
坑:       Tarjan 回边必须判 onStack / 大图递归爆栈 / 拓扑序不唯一
```

下一节 → [网络流](flow.md)。
