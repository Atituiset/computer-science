# 网络流：最大流 / 最小割 / 二分图匹配

## 一句话

网络流回答的是"一张带容量的管道网络, 从源点 $s$ 到汇点 $t$ 最多能送多少流量". 所有经典算法共享同一个框架——**在残量网络上反复找增广路**——差别只在"怎么找路": 任意 DFS 是 Ford-Fulkerson ($O(E \cdot |f^*|)$, 仅整数容量保证终止), BFS 找最短路是 Edmonds-Karp ($O(VE^2)$), BFS 分层 + DFS 多路增广是 Dinic ($O(V^2E)$). 框架停止的那一刻还免费送出一个线性规划对偶: **最大流 = 最小割**, 于是项目选择、图像分割、二分图匹配都被统一进这一个模型.

读完应能：

1. 说清反向边的语义——它是算法的"反悔权", 也是正确性的全部来源；
2. 默写 Dinic (分层 BFS + 当前弧 DFS), 并指出每一处优化到底在省什么；
3. 在残量图上求出具体的最小割点集划分, 并用"流必穿割"讲出对偶直觉；
4. 把二分图匹配归约为最大流, 写出 König 定理的三连等式。

---

## 思想链

```
问题: 管道网络上 s→t 的最大输送量?
  └─► 直接贪心挑路径会错: 先走的路可能挡住更优的组合
        └─► 解法: 给算法"反悔权" —— 残量网络 + 反向边
              └─► 框架: 残量图上还有 s↝t 路就继续推流
                    ├─ 任意找路:   Ford-Fulkerson  O(E·|f*|)
                    ├─ 最短路优先: Edmonds-Karp     O(V·E²)
                    └─ 分层 + 多路: Dinic           O(V²·E)
                          └─► 终止时 t 在残量图上不可达
                                └─► S = {s 可达}, 割(S,T) 容量 = 流值
                                      └─► 最大流 = 最小割 (LP 对偶)
                                            └─► 归约: 二分图匹配 / 闭合子图 / 图像分割
```

## 形式化定义

**流网络**是有向图 $G = (V, E)$, 每条边有容量 $c(u, v) \ge 0$, 指定源点 $s$ 与汇点 $t$. 一个**流**是函数 $f: E \to \mathbb{R}_{\ge 0}$, 满足：

1. **容量约束**：$f(u, v) \le c(u, v)$；
2. **流量守恒**：除 $s, t$ 外, $\sum_{u} f(u, v) = \sum_{w} f(v, w)$。

目标是最大化**流值** $|f| = \sum_v f(s, v) - \sum_v f(v, s)$。

**残量网络** $G_f$ 在原边上保留剩余容量 $r(u, v) = c(u, v) - f(u, v)$, 同时为每条边引入反向边 $r(v, u) = f(u, v)$——它表示"已经送出去的流量可以撤回"。**增广路**是 $G_f$ 上一条 $s \to t$ 的路径, 可推送量为路径上最小的 $r$。

**整数性定理**：容量全为整数时, 必存在整数最大流 (每步增广整数即可)。这条定理是后面一切"归约成匹配"的合法性基础。

> [!NOTE]
> 反向边为什么合法？沿路径推 $\delta$ 流量的同时, 给反向边注入 $\delta$ 的"撤销额度"。之后任何一次增广走过反向边, 等价于把早先某条路上的一段流量改道。所以 Ford-Fulkerson 不是普通贪心——它是**带撤销的贪心**, 无论中间走了多少冤枉路, 最终都能变换到全局最优的形状。这正是它与"不可撤销所以会翻车"的普通贪心 (见 [贪心](../../algorithms/greedy.md)) 的本质区别。

## Ford-Fulkerson 与 Edmonds-Karp

框架只有三步：

1. 在残量图上找一条 $s \to t$ 增广路；没有则停止；
2. 取路径瓶颈 $\delta = \min r(u, v)$；
3. 正向边减 $\delta$, 反向边加 $\delta$, 流值累加 $\delta$。

任意找路的 Ford-Fulkerson 复杂度为 $O(E \cdot |f^*|)$——与容量数值相关, 且实数容量下增广量可能几何衰减导致**永不终止**。改用 BFS 找"边数最短"的增广路即 Edmonds-Karp: 可以证明每条边作为关键边 (瓶颈边) 至多饱和 $V/2$ 次 (其两端在残量图中的距离只会单调增加), 总增广轮数 $O(VE)$, 每轮 BFS 花 $O(E)$, 合计 $O(VE^2)$——与容量数值无关的多项式界。

```python
from collections import deque


def edmonds_karp(g: dict[int, dict[int, int]], s: int, t: int) -> int:
    """g[u][v] = 剩余容量. 返回最大流. O(V E^2), 与容量数值无关."""
    flow = 0
    while True:
        parent = {s: None}                       # BFS 找最短增广路
        q = deque([s])
        while q and t not in parent:
            u = q.popleft()
            for v, c in g[u].items():
                if c > 0 and v not in parent:
                    parent[v] = u
                    q.append(v)
        if t not in parent:
            return flow                          # 残量图断开: 结束
        path, v = [], t
        while parent[v] is not None:             # 回溯路径
            path.append((parent[v], v))
            v = parent[v]
        delta = min(g[u][v] for u, v in path)
        for u, v in path:
            g[u][v] -= delta
            g[v].setdefault(u, 0)                # 反向边可能原本不存在, 补 0
            g[v][u] += delta
        flow += delta
```

## Dinic: 分层图完整实现

Dinic 在 Edmonds-Karp 上做两个优化：

1. **分层图**：每轮 BFS 求出 $level[v]$ = 残量图上 $s \to v$ 的最短边数, 之后 DFS 只允许走 $level$ 加 1 的边——所有增广路都自动是最短的, 且一轮分层可以推多条路；
2. **当前弧优化**：每个点记录"下一条待尝试边"的下标。一条边一旦被证实走不通 (下游已断), 本轮不再看它第二次。

两者合起来把复杂度压到 $O(V^2 E)$; 单位容量网络 (如二分图匹配) 上是 $O(E\sqrt{V})$——这正是 Hopcroft-Karp 的界。

### Python

```python
from collections import deque


class Dinic:
    """最大流 O(V^2 E). 点编号 0..n-1; 边成对存储 (正向 + 自动建立的反向边)."""

    def __init__(self, n: int):
        self.n = n
        self.g = [[] for _ in range(n)]          # g[u] = [[to, cap, rev], ...]

    def add_edge(self, u: int, v: int, c: int) -> None:
        """加容量 c 的有向边; 反向边必须由这里自动创建, 手工调用会打乱 rev 配对."""
        self.g[u].append([v, c, len(self.g[v])])
        self.g[v].append([u, 0, len(self.g[u]) - 1])

    def _bfs(self, s: int, t: int) -> bool:
        """分层: level[v] = 残量图上 s→v 的最短边数; t 不可达则整体结束."""
        self.level = [-1] * self.n
        self.level[s] = 0
        q = deque([s])
        while q:
            u = q.popleft()
            for v, cap, _ in self.g[u]:
                if cap > 0 and self.level[v] < 0:
                    self.level[v] = self.level[u] + 1
                    q.append(v)
        return self.level[t] != -1

    def _dfs(self, u: int, t: int, f: int) -> int:
        """沿 level+1 的边向上推流, 返回本轮实际推送量."""
        if u == t:
            return f
        while self.it[u] < len(self.g[u]):
            e = self.g[u][self.it[u]]
            v, cap, rev = e
            if cap > 0 and self.level[v] == self.level[u] + 1:
                d = self._dfs(v, t, min(f, cap))
                if d > 0:
                    e[1] -= d                    # 正向边扣容量
                    self.g[v][rev][1] += d       # 反向边加"反悔额度"
                    return d
            self.it[u] += 1                      # 当前弧: 此边已死, 本轮跳过
        return 0                                 # 该点在本层已榨干

    def max_flow(self, s: int, t: int) -> int:
        flow = 0
        while self._bfs(s, t):
            self.it = [0] * self.n               # 新一轮分层, 重置当前弧
            while True:
                f = self._dfs(s, t, float("inf"))
                if f == 0:
                    break
                flow += f
        return flow

    def min_cut_side(self, s: int) -> list[bool]:
        """必须在 max_flow 之后调用: 残量图上 s 可达的点集即 S 侧."""
        seen = [False] * self.n
        seen[s] = True
        stack = [s]
        while stack:
            u = stack.pop()
            for v, cap, _ in self.g[u]:
                if cap > 0 and not seen[v]:
                    seen[v] = True
                    stack.append(v)
        return seen


if __name__ == "__main__":
    # CLRS 经典算例: 最大流 23, 最小割 {1→3, 4→3, 4→5}
    din = Dinic(6)
    for u, v, c in [(0, 1, 16), (0, 2, 13), (1, 3, 12), (2, 1, 4), (2, 4, 14),
                    (3, 2, 9), (3, 5, 20), (4, 3, 7), (4, 5, 4)]:
        din.add_edge(u, v, c)
    assert din.max_flow(0, 5) == 23
    side = din.min_cut_side(0)
    assert side == [True, True, True, False, True, False]   # S = {0,1,2,4}
```

### Go

```go
package main

import (
	"fmt"
	"math"
)

type flowEdge struct{ to, cap, rev int }

type Dinic struct {
	g     [][]flowEdge
	level []int
	it    []int
}

func newDinic(n int) *Dinic {
	return &Dinic{
		g:     make([][]flowEdge, n),
		level: make([]int, n),
		it:    make([]int, n),
	}
}

// AddEdge 加容量 c 的有向边, 自动配对反向边 (初始容量 0).
func (d *Dinic) AddEdge(u, v, c int) {
	d.g[u] = append(d.g[u], flowEdge{v, c, len(d.g[v])})
	d.g[v] = append(d.g[v], flowEdge{u, 0, len(d.g[u]) - 1})
}

// bfs 分层: level[v] = 残量图上 s→v 的最短边数.
func (d *Dinic) bfs(s, t int) bool {
	for i := range d.level {
		d.level[i] = -1
	}
	d.level[s] = 0
	queue := []int{s}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		for _, e := range d.g[u] {
			if e.cap > 0 && d.level[e.to] < 0 {
				d.level[e.to] = d.level[u] + 1
				queue = append(queue, e.to)
			}
		}
	}
	return d.level[t] != -1
}

// dfs 只沿 level+1 的边增广; it 是当前弧, 已证死的边本轮不再看.
func (d *Dinic) dfs(u, t, f int) int {
	if u == t {
		return f
	}
	for ; d.it[u] < len(d.g[u]); d.it[u]++ {
		e := &d.g[u][d.it[u]]
		if e.cap <= 0 || d.level[e.to] != d.level[u]+1 {
			continue
		}
		if fl := d.dfs(e.to, t, minInt(f, e.cap)); fl > 0 {
			e.cap -= fl
			d.g[e.to][e.rev].cap += fl
			return fl
		}
	}
	return 0
}

// MaxFlow 返回 s→t 最大流. O(V²E); 单位容量网络 O(E√V).
func (d *Dinic) MaxFlow(s, t int) int {
	flow := 0
	for d.bfs(s, t) {
		for i := range d.it {
			d.it[i] = 0
		}
		for {
			f := d.dfs(s, t, math.MaxInt)
			if f == 0 {
				break
			}
			flow += f
		}
	}
	return flow
}

// MinCutSide 在 MaxFlow 之后调用: true = 该点属于 S 侧.
func (d *Dinic) MinCutSide(s int) []bool {
	seen := make([]bool, len(d.g))
	seen[s] = true
	stack := []int{s}
	for len(stack) > 0 {
		u := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, e := range d.g[u] {
			if e.cap > 0 && !seen[e.to] {
				seen[e.to] = true
				stack = append(stack, e.to)
			}
		}
	}
	return seen
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func main() {
	d := newDinic(6)
	for _, e := range [][3]int{
		{0, 1, 16}, {0, 2, 13}, {1, 3, 12}, {2, 1, 4}, {2, 4, 14},
		{3, 2, 9}, {3, 5, 20}, {4, 3, 7}, {4, 5, 4},
	} {
		d.AddEdge(e[0], e[1], e[2])
	}
	fmt.Println(d.MaxFlow(0, 5)) // 23
	fmt.Println(d.MinCutSide(0)) // S = {0,1,2,4}
}
```

## 最小割定理与对偶直觉

**最大流-最小割定理**：$\max_f |f| = \min_{(S,T)} c(S, T)$, 其中割 $(S, T)$ 是把点分成 $s \in S$、$t \in T$ 的划分, 割容量 $c(S, T) = \sum_{u \in S, v \in T} c(u, v)$ (只算 $S \to T$ 方向)。

三个层次的理解：

1. **弱对偶 (夹逼)**：任何流都要从 $S$ 净流出才能到达 $t$, 而净流出量不可能超过 $S \to T$ 的总容量, 所以"任何流值 ≤ 任何割容量"。两边分别取最大、最小, 就被夹住了；
2. **强对偶 (相等)**：算法终止时残量图上 $t$ 不可达。令 $S$ = $s$ 可达集, 则所有 $S \to T$ 的边都满流 (否则对面可达), 所有 $T \to S$ 的边都零流, 于是 $c(S, T) = |f|$——这个具体的割就是最优割。**求法：跑完最大流后在残量图上从 $s$ 做一次 DFS/BFS**；
3. **LP 对偶视角**：把最大流写成线性规划, 其对偶问题的变量恰好对应"每条边是否被割"+"每个点属于哪侧", 对偶最优解就是一个最小割。最大流-最小割是 LP 强对偶在最经典组合结构上的实例化。

> [!TIP]
> 建模三问: 谁是**点**? 谁是**边**? **容量到底在限制什么**? 想清楚第三问通常就完成了整道题——例如"每个工人每天最多干一件活"是点容量 (拆点: 入点→出点连容量 1 的边), "两个任务不能同时"才是边容量。

**典型归约**：

- **最大权闭合子图 (项目选择)**：选项目 $p$ 获利 $v_p > 0$, 但依赖设备 $q$ 需付费 $v_q < 0$, 选了就必须连带选。建图: $s \to p$ 容量 $v_p$, $q \to t$ 容量 $|v_q|$, 依赖关系连 $\infty$ 边。答案 = $\sum v_p - $ 最小割；
- **图像分割**：像素为点, $s$/​$t$ 分别连"前景/背景"的数据项代价, 相邻像素之间连平滑项 (惩罚割裂), 最小割即能量最小分割 (Boykov-Kolmogorov)；
- **最小路径覆盖**：DAG 上 $n -$ 最大匹配。

## 二分图匹配归约

左部 $L$、右部 $R$ 的二分图, 求最多匹配对数。加超源超汇: $s \to l$ 容量 1, $r \to t$ 容量 1, $l \to r$ 容量 1 (或 $\infty$)。由整数性定理, 每条 $s \to l$ 要么满流要么零流, 所以整数最大流与匹配一一对应, **最大流 = 最大匹配**。

单位容量网络让 Dinic 达到 $O(E\sqrt{V})$——这就是 Hopcroft-Karp 的复杂度; 而朴素的匈牙利算法 (逐个左点找增广路, 本质是"一次一条增广路"的特例) 是 $O(V \cdot E)$, 常数极小, 左部规模小时反而更快。

**König 定理** (二分图三连等式, 全部由最大流-最小割推出):

$$\text{最大匹配} = \text{最小点覆盖}, \qquad \text{最大独立集} = n - \text{最小点覆盖}$$

最小点覆盖的构造也来自割: 跑完最大流后, 用 $s$ 不可达的左部点 + 可达的右部点组成覆盖。DAG 上另有 $\text{最小路径覆盖} = n - \text{最大匹配}$ (拆点成二分图)。

> [!WARNING]
> 1. **反向边必须由 `add_edge` 成对创建**: 自己手工加两条独立边会破坏 `rev` 互指, 增广时写穿别人的容量;
> 2. **实数容量 + 任意找路 = 可能永不终止** (Zwick 反例), 生产代码一律用 BFS/Dinic 或保证整数容量;
> 3. **求最小割的 DFS 必须发生在 max_flow 之后**, 顺序反了得到的是垃圾划分;
> 4. **Python 版 DFS 递归深度 = 路径长度 $\le V$**: 大图要么改显式栈, 要么调大 `sys.setrecursionlimit`;
> 5. **点容量要拆点**: 直接在点上设上限不是标准流网络的约束。

## 复杂度对照

| 算法 | 找路方式 | 复杂度 | 备注 |
|------|----------|--------|------|
| Ford-Fulkerson | 任意 DFS | $O(E \cdot \|f^*\|)$ | 仅整数容量保证终止 |
| Edmonds-Karp | BFS 最短路 | $O(VE^2)$ | 与容量数值无关 |
| Dinic | 分层 + 当前弧 | $O(V^2E)$ | 单位容量 $O(E\sqrt{V})$ |
| ISAP / HLPP | 预流推进 | $O(V^2\sqrt{E})$ | 竞赛中常数更小 |

## 进阶

- **最小费用最大流 (MCMF)**：每条边再加单价 $w$, 在最大流前提下最小化 $\sum f \cdot w$。做法: 增广路改成"费用最短路"——SPFA 或 Dijkstra + 势函数 (Johnson 思想, 见 [最短路径](shortest-path.md));
- **Gomory-Hu 树**：$n$ 个点所有点对的最小割可以压缩成一棵 $n-1$ 条边的树, 树上边权即两端点对的最小割;
- **Stoer-Wagner**：无向图**整体**最小割 (不指定源汇) 的专用算法, $O(V^3)$;
- **预流推进 (Push-Relabel)**：放弃"守恒随时成立"的不变量, 允许超额再回流, HLPP 是理论最好的实用实现之一。

## 易错清单

1. **找不到增广路 ≠ 图断了**: 判定终止的唯一标准是"BFS 分层时 $t$ 的 level 为 -1";
2. **重边与自环**: 重边直接累加容量即可, 自环永远不该出现在增广路上 (Dinic 分层天然排除);
3. **无向图**: 拆成两条方向的边时, 两条边共享同一对正反向边 (容量都设 $c$), 而不是各配一对;
4. **输出流方案**: 某条边实际流量 = 原容量 − 残量, 别去读反向边。

## 经典题

- 洛谷 P3376 【模板】最大流 (Dinic);
- 洛谷 P3381 【模板】最小费用最大流;
- POJ 1273 Drainage Ditches (EK 入门);
- POJ 1149 PIGS (经典"合并猪圈"建模);
- 洛谷 P2764 最长不下降子序列 / 最小路径覆盖 (匹配归约);
- Hopcroft-Karp 二分图匹配模板 (洛谷 P3386)。

## 一页速查

```
模型:    f: E→R+, 容量约束 + 守恒; 目标 max 流值
残量图:  r(u,v) = c-f, r(v,u) = f; 反向边 = 反悔权 = 正确性来源
算法:    FF 任意增广 O(E·|f*|) / EK 最短路 O(VE²) / Dinic 分层 O(V²E), 单位容量 O(E√V)
最小割:  终止后 s 可达集为 S, 割容量 = 流值; 直觉 "任何流必穿任何割"
匹配:    s→L(1), L→R(∞), R→t(1); König: 最大匹配 = 最小点覆盖
建模:    闭合子图 = Σ正权 - 最小割; 图像分割 = 数据项 + 平滑项; 点容量要拆点
```

回到章首: [图](README.md)。
