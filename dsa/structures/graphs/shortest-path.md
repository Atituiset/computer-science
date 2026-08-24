# 最短路径: Dijkstra / Bellman-Ford / Floyd

## 一句话

最短路径的算法选择不是"背复杂度表", 而是看清**每个算法到底在利用图的什么结构**: Dijkstra 利用"非负权 ⇒ 弹出的点不会再变短"这一贪心不变量; Bellman-Ford 放弃贪心, 改用"逐轮松弛"的动态规划, 从而容忍负边; Floyd-Warshall 把问题定义成"只许经过前 k 个中间点"的区间 DP, 用 $O(V^3)$ 换全源答案; Johnson 再用一次 Bellman-Ford 给边重加权, 把负权图改造成非负权图让 Dijkstra 合法; A\* 在 Dijkstra 上加"可采纳启发函数", 少扩展没希望的节点。选错算法的代价是数量级, 选对的关键只有一个问句——**图里有没有负边? 要单源还是全源?**

读完应能：

1. 说出 Dijkstra 贪心不变量的精确表述, 并构造负边反例证明它为什么必须非负；
2. 解释 Bellman-Ford "第 $k$ 轮结束至少确定了 $k$ 条边的最短路", 以及第 $V$ 轮仍能松弛为何等价于存在负环；
3. 默写堆优化 Dijkstra (Python + Go), 说清懒删除为什么不影响正确性与复杂度;
4. 推导 Johnson 重加权公式 $w'(u,v) = w(u,v) + h(u) - h(v)$ 为什么不改变最短路结构。

---

## 思想链

```
问题: 带权图上 s→t 总代价最小的路径?
  └─► 图里有负边吗?
        ├─ 没有
        │    └─► 不变量成立: 从优先队列弹出的点距离已最终化
        │          └─► Dijkstra: 贪心 + 懒删除堆  O((V+E) log V)
        │                ├─► 有好的下界估计 h? ─► A* 只扩展有希望的节点
        │                └─► 稠密图 E≈V² ? ─► 朴素 O(V²) 版反而更快 (省 log V 与堆开销)
        ├─ 有 (但无负环)
        │    └─► 贪心失效: 弹出后还能被负边再缩短
        │          └─► Bellman-Ford: 松弛全部边 V-1 轮  O(VE)
        │                ├─► 队列只入改进点 = SPFA (均摊快, 最坏仍 O(VE))
        │                └─► 第 V 轮还能松弛 ⇔ 存在负环 (套利 / 死锁检测)
        └─ 全源都要?
             ├─ 稠密小图: Floyd-Warshall 中间点 DP  O(V³), 常数极小
             └─ 稀疏大图: Johnson = BF 重加权 → V 次 Dijkstra  O(VE + VE log V)
```

## 形式化定义

给定带权图 $G = (V, E)$, 权函数 $w: E \to \mathbb{R}$。路径 $p = \langle v_0, v_1, \dots, v_k \rangle$ 的权重是 $w(p) = \sum_{i=0}^{k-1} w(v_i, v_{i+1})$。**最短路径**就是 $w(p)$ 在所有 $u \leadsto v$ 路径中取最小的那条, 记 $\delta(u, v)$ 为最短距离。

两个前提值得显式写出：

1. **最优子结构**：最短路的任何前缀也是最短路——否则把更优的前缀拼上来就得到矛盾。这是一切 DP / 贪心解法的合法性来源;
2. **无负环前提**：只要图中存在总权为负的环路, "最短路径"本身就不存在 (绕一圈更便宜, 可以无限绕)。所以负权算法的全部工作都隐含一件事: **先检测或先排除负环**。$\delta(u,v) = -\infty$ 当且仅当 $u, v$ 都在某负环上可达/可达自。

> [!NOTE]
> 三角不等式 $\delta(u, v) \le \delta(u, x) + w(x, y) + \delta(y, v)$ 是所有松弛操作的共同灵魂:**松弛 (relax)** 就是检查这条不等式是否严格成立, 成立则用右边更新左边。Dijkstra / Bellman-Ford / Floyd 的差异只在"按什么顺序松弛哪些不等式"。

## Dijkstra: 贪心的边界在哪里

**核心不变量**：每次从优先队列弹出距离最小的未定节点 $u$ 时, $\text{dist}[u] = \delta(s, u)$ 已经是最终答案。

**为什么需要非负权**——归纳论证的最后一步依赖它: 设弹出 $u$ 时存在更短路径 $P$, 则 $P$ 必须经过某个尚未弹出的点 $y$; 取 $P$ 上第一个未弹出点 $y$, 其前缀已经确定且 $\ge \text{dist}[y] \ge \text{dist}[u]$ (堆按最小弹出)。到这里都没问题; 但要完成"$P$ 比 $\text{dist}[u]$ 短"的推理, 需要 $\text{dist}[y] + (\text{后续路径}) \ge \text{dist}[y]$, 即**后续路径权非负**。一旦允许负边, "$y$ 之后还能一路减下去", 不变量当场失效。

```text
反例:      s --2--> a --(-3)--> b
Dijkstra:  弹 s(dist 0) → 弹 a(dist 2, 标记最终) → 弹 b(dist inf? 或 2-3=-1?)
若 b 经 s 直达不存在, 正确答案是 dist[b] = -1, 但 a 已被"最终化",
b 的真实路径必须回头穿过已最终化的 a —— 贪心序被负边破坏。
```

### Python (堆优化 + 懒删除)

```python
import heapq


def dijkstra(g: dict[int, list[tuple[int, int]]], s: int) -> dict[int, int]:
    """g[u] = [(v, w), ...]. 返回 {v: δ(s,v)}. O((V+E) log V), 仅限非负权."""
    dist = {s: 0}
    pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, float("inf")):
            continue                       # 过期条目: 同一点被更好副本替代过
        for v, w in g[u]:
            nd = d + w
            if nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))  # 不删旧条目, 弹出时跳过即可 (懒删除)
    return dist


if __name__ == "__main__":
    # CLRS 经典算例: 顶点 0=s,1=t,2=x,3=y,4=z
    g = {
        0: [(1, 10), (3, 5)],
        1: [(2, 1), (3, 2)],
        2: [(4, 4)],
        3: [(1, 3), (2, 9), (4, 2)],
        4: [(0, 7)],
    }
    assert dijkstra(g, 0) == {0: 0, 1: 8, 2: 9, 3: 5, 4: 7}
```

### Go

```go
package main

import (
	"container/heap"
	"fmt"
	"math"
)

type item struct{ node, dist int }

type priorityQueue []item

func (pq priorityQueue) Len() int           { return len(pq) }
func (pq priorityQueue) Less(i, j int) bool { return pq[i].dist < pq[j].dist }
func (pq priorityQueue) Swap(i, j int)      { pq[i], pq[j] = pq[j], pq[i] }
func (pq *priorityQueue) Push(x any)        { *pq = append(*pq, x.(item)) }
func (pq *priorityQueue) Pop() any {
	old := *pq
	n := len(old)
	it := old[n-1]
	*pq = old[:n-1]
	return it
}

type edge struct{ to, w int }

// Dijkstra 返回从 s 出发的单源最短距离. 仅限非负权. O((V+E) log V).
func Dijkstra(g [][]edge, s int) []int {
	dist := make([]int, len(g))
	for i := range dist {
		dist[i] = math.MaxInt
	}
	dist[s] = 0
	pq := &priorityQueue{{s, 0}}
	for pq.Len() > 0 {
		it := heap.Pop(pq).(item)
		if it.dist > dist[it.node] { // 过期条目: 懒删除
			continue
		}
		for _, e := range g[it.node] {
			if nd := it.dist + e.w; nd < dist[e.to] {
				dist[e.to] = nd
				heap.Push(pq, item{e.to, nd})
			}
		}
	}
	return dist
}

func main() {
	g := make([][]edge, 5)
	add := func(u, v, w int) { g[u] = append(g[u], edge{v, w}) }
	add(0, 1, 10)
	add(0, 3, 5)
	add(1, 2, 1)
	add(1, 3, 2)
	add(2, 4, 4)
	add(3, 1, 3)
	add(3, 2, 9)
	add(3, 4, 2)
	add(4, 0, 7)
	fmt.Println(Dijkstra(g, 0)) // [0 8 9 5 7]
}
```

> [!TIP]
> 复杂度里的 $\log$ 因子是可以"买断"的: 稠密图 $E \approx V^2$ 时, 用数组扫描代替堆的朴素 Dijkstra 是 $O(V^2)$, 优于堆版 $O(V^2 \log V)$; 反过来稀疏图 $E = O(V)$ 时堆版的 $\log$ 因子几乎白拿。**先估 $E$ 和 $V$ 的量级, 再决定要不要堆。**

## Bellman-Ford: 放弃贪心, 换取负边容忍

**核心思想**：不再假设"弹出即最终", 而是**无差别地松弛所有边**, 重复 $V-1$ 轮。

**正确性关键引理**：第 $k$ 轮结束时, 所有用**至多 $k$ 条边**能达到的点, 其距离已是正确的 $\delta$。归纳可得: 无负环时任何最短路至多 $V-1$ 条边, 所以 $V-1$ 轮必然收敛。这也解释了负环检测——**第 $V$ 轮仍有边可松弛, 说明存在"越走越短"的环**, 因为一条合法最短路永远不需要重复顶点。

```python
def bellman_ford(edges: list[tuple[int, int, int]], n: int, s: int):
    """edges = [(u, v, w), ...]. 返回 (dist, ok); ok=False 表示存在负环. O(V·E)."""
    INF = float("inf")
    dist = [INF] * n
    dist[s] = 0
    for _ in range(n - 1):
        updated = False
        for u, v, w in edges:
            if dist[u] + w < dist[v]:      # 松弛: 三角不等式当前不成立
                dist[v] = dist[u] + w
                updated = True
        if not updated:                    # 提前收敛: 后续轮次全是空转
            break
    for u, v, w in edges:
        if dist[u] + w < dist[v]:
            return dist, False             # 第 V 轮仍能松弛 ⇒ 负环
    return dist, True


if __name__ == "__main__":
    # CLRS 经典算例: 顶点 0=s,1=t,2=x,3=y,4=z
    edges = [(0, 1, 6), (0, 3, 7), (1, 2, 5), (1, 3, 8), (1, 4, -4),
             (2, 1, -2), (3, 2, -3), (3, 4, 9), (4, 2, 7), (4, 0, 2)]
    dist, ok = bellman_ford(edges, 5, 0)
    assert ok and dist == [0, 2, 4, 7, -2]    # 负边让绕路更便宜
    neg = [(0, 1, 1), (1, 2, -3), (2, 0, 1)]  # 0→1→2→0 总权 -1: 负环
    assert bellman_ford(neg, 3, 0)[1] is False
```

**SPFA** (Shortest Path Faster Algorithm) 是 Bellman-Ford 的队列版: 只把"本轮距离真的变了"的点重新入队。平均表现接近 $O(E)$, 但**最坏仍是 $O(VE)$**, 且竞赛中存在专门卡 SPFA 的构造数据 (网格套菊花图)。工程结论: 负权场景直接写 Bellman-Ford 更稳, SPFA 的均摊承诺不可依赖。

> [!WARNING]
> 1. **负环检测要求全图可达**: 若负环不与源连通, 以 $s$ 为源的 Bellman-Ford 测不出来; 全图检测需加超级源点连向所有点 (边权 0);
> 2. **SPFA 判负环用 cnt[v] ≥ V** (入队次数) 比"第 $V$ 轮松弛"更常用, 二者等价但前者实现更简单;
> 3. **浮点权重的"相等"判断**: 松弛条件 `<` 在浮点下可能因舍入震荡不收敛, 关键场景给 $\epsilon$ 容差。

## Floyd-Warshall: 中间点集合上的区间 DP

换一个状态定义, 问题瞬间变成经典 DP:

$$d^{(k)}[i][j] = \text{只允许以} \{0..k\} \text{中的点作为中间点时, } i \to j \text{ 的最短距离}$$

转移只有一行: $d^{(k)}[i][j] = \min(d^{(k-1)}[i][j],\; d^{(k-1)}[i][k] + d^{(k-1)}[k][j])$ —— 要么不经过 $k$, 要么恰好经过一次。因为 $d^{(k)}[\cdot][k]$ 与 $d^{(k)}[k][\cdot]$ 不会因加入 $k$ 而变化 (中间点是 $k$ 自身没有意义), **滚动掉第一维**后得到著名的 $k \to i \to j$ 三层循环顺序——注意 **$k$ 必须在最外层**, 写错循环顺序是这个算法唯一的坑。

```python
def floyd(n: int, edges: list[tuple[int, int, int]]):
    """返回 (dist, has_neg_cycle). O(V³), 稠密小图的全源首选."""
    INF = float("inf")
    d = [[INF] * n for _ in range(n)]
    for i in range(n):
        d[i][i] = 0
    for u, v, w in edges:
        d[u][v] = min(d[u][v], w)          # 重边取 min
    for k in range(n):                     # k 必须最外层!
        for i in range(n):
            for j in range(n):
                if d[i][k] + d[k][j] < d[i][j]:
                    d[i][j] = d[i][k] + d[k][j]
    has_neg_cycle = any(d[i][i] < 0 for i in range(n))
    return d, has_neg_cycle


if __name__ == "__main__":
    d, has_neg_cycle = floyd(4, [(0, 1, 5), (0, 3, 10), (1, 2, 3), (2, 3, 1)])
    assert not has_neg_cycle
    assert d[0][3] == 9 and d[0][2] == 8            # 0→1→2→3 优于直达 10
    _, bad = floyd(2, [(0, 1, 1), (1, 0, -2)])      # 0⇄1 总权 -1: 负环
    assert bad
```

三个免费的副产品，让它成为 $V \le$ 几百时的瑞士军刀：

- **传递闭包**：把 $\min$ 换成逻辑 or (`reach[i][j] |= reach[i][k] & reach[k][j]`), 就是 Warshall 原始算法; bitset 加速后每轮 $O(V^2/64)$;
- **无向图最小环**：在 $k$ 外层、$ij$ 内层更新**之前**, 用 $d[i][j] + w(j,k) + w(k,i)$ 尝试更新全局最小环 (环上最大编号点恰为 $k$);
- **负环判定**：跑完后 $d[i][i] < 0$ 即存在。

> [!NOTE]
> Floyd 与矩阵乘法同构: 把 $(\min, +)$ 看作半环上的"乘法", Floyd 就是在算图的邻接矩阵的 $V-1$ 次幂——和快速幂加速线性递推是同一个代数结构 (见 [离散数学 · 代数结构](../../../math/discrete.md))。

## Johnson: 让 Dijkstra 在负权图上合法

既要全源、又想用 Dijkstra (稀疏图), 办法是**重加权**:

1. 加超级源点 $q$, 连边 $q \to v$ 权 0, 跑一遍 Bellman-Ford 得 $h(v) = \delta(q, v)$ (同时完成负环检测);
2. 定义新权 $w'(u, v) = w(u, v) + h(u) - h(v)$。由三角不等式 $h(v) \le h(u) + w(u,v)$ 得 $w'(u,v) \ge 0$;
3. 对每个源跑 Dijkstra。

**为什么不改变最短路结构**: 任意路径 $p: u \leadsto v$ 的重加权总增量是望远镜级数——

$$w'(p) = w(p) + h(u) - h(v)$$

中间项全部相消, 每条 $u \leadsto v$ 路径都被加上**同一个常数**, 大小关系不变。总复杂度 $O(VE + VE\log V)$, 对稀疏图远优于 Floyd 的 $O(V^3)$。这正是 [网络流 MCMF](flow.md) 里"Dijkstra + 势函数"的原型: 势函数 $h$ 一旦求出, 后续每次费用流增广只需维护它, 不必重新 Bellman-Ford。

## DAG 与 A*: 两类"结构红利"

**DAG 上的单源最短路**: 按拓扑序松弛一遍即可, $O(V+E)$, 且天然支持负权 (无环 ⇒ 无负环)。这是 [拓扑排序](topo-scc.md) 直接变现的场景——关键路径 (CPM/PERT 工期)、依赖图上的累计成本都是它。**记住这个特例: 只要图是 DAG, 别碰堆。**

**A\***: Dijkstra 的目标导向版。优先队列键从 $g(u)$ (已走距离) 改成 $f(u) = g(u) + h(u)$ ($h$ = 到目标的估计下界):

- $h$ **可采纳** (admissible, 永不高估): 保证最优;
- $h$ **一致** (consistent, 满足 $|h(u) - h(v)| \le w(u,v)$): 弹出即最终, 无需重开节点。一致性蕴含可采纳性;
- $h \equiv 0$ 时退化为 Dijkstra; $h$ 越准剪得越多。地图寻路 (欧氏距离)、拼图 (曼哈顿距离错位数)、Word Ladder 都是标准应用。

## 工程视角: 协议与硬件里的最短路

- **路由协议就是这两个算法的地盘**: RIP 是分布式 Bellman-Ford ("距离向量", 邻居间交换整张距离表, 收敛慢且有"坏消息传得慢"的计数到无穷问题); OSPF 是 Dijkstra ("链路状态", 全网洪泛链路状态后各自独立计算)。对比细节见 [BGP 与 OSPF](../../../networking/ip/bgp-ospf.md);
- **GPU 上的 SSSP**: 优先队列难并行, 实战转向 Delta-Stepping (按 $\Delta$ 分桶, 轻边批量松弛) 或干脆并行 Bellman-Ford (每轮全边松弛天然数据并行); 数千万边的图上 GPU Bellman-Ford 常比 CPU 单线程 Dijkstra 快一个数量级以上。GPU 执行模型见 [GPU 架构](../../../computer-arch/gpu-architecture.md);
- **延迟敏感场景** (游戏匹配、CDN 调度): 常用"收缩层级 + 双向搜索" (Contraction Hierarchies), 预处理换毫秒级查询——又一次印证"预处理 vs 查询"的通用折中。

## 易错清单

1. **负边 + Dijkstra = 错误答案但不报错**: 结果看起来合理, 实际部分点偏大; 有负边嫌疑一律先 Bellman-Ford;
2. **Floyd 循环顺序**: $k$ 必须最外层, 内层 $i, j$ 顺序随意; 写错会用到"尚未引入 $k$"的错误中间值;
3. **懒删除堆积**: Python/Go 堆版不删旧条目, 极端稠密图堆大小 $O(E)$; 内存紧张时改用索引堆 (decrease-key);
4. **重边**: 邻接表存图时重边都保留即可 (松弛自然取 min); 邻接矩阵记得 `min`;
5. **负环 ≠ 有负边**: 有负边不一定有负环; 只有负环才让最短路无定义;
6. **A\* 用了不可采纳的 h**: 为了快而高估, 得到的只是"看起来合理"的次优路, 且无法察觉。

## 经典题

- LC 743 网络延迟时间 (Dijkstra 模板);
- LC 787 K 站中转内最便宜的航班 (限制边数 = Bellman-Ford 天然主场);
- LC 1334 阈值距离内邻居最少的城市 (Floyd 全源);
- LC 1631 最小体力消耗路径 (二分 + BFS / 类 Dijkstra max-min 变体);
- LC 1928 规定时间内到达目的地的最少花费 (状态分层 + Dijkstra);
- 洛谷 P3385 【模板】负环 (SPFA/Bellman-Ford 判负环);
- 洛谷 P4779 【模板】单源最短路径 (标准版 Dijkstra);
- POJ 1860 Currency Exchange (负环 ⇔ 套利)。

## 一页速查

```
判型:    有负边? → BF/SPFA/Johnson;  无负边? → Dijkstra(+A*)
         全源稠密小图 → Floyd O(V³);  全源稀疏图 → Johnson
         DAG → 拓扑序松弛 O(V+E), 支持负权
不变量:  Dijkstra 弹出即最终 ← 需要非负权 (反例: 2 → (-3) 回头路)
BF:      第 k 轮确定 ≤k 条边的最短路; 第 V 轮仍能松弛 ⇔ 负环
Floyd:   d[k][i][j] = min(d[k-1][i][j], d[k-1][i][k]+d[k-1][k][j]); k 在最外层
Johnson: w'(u,v)=w+h(u)-h(v) ≥ 0; 路径增量恒为 h(u)-h(v), 结构不变
A*:      f=g+h; h 可采纳保证最优, h 一致保证弹出即最终
工程:    RIP=分布式BF, OSPF=Dijkstra; GPU=Delta-stepping/并行BF; CH=预处理换查询
```

下一节 → [最小生成树](mst.md)。
