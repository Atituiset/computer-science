# 图的表示与遍历

## 一句话

图算法的渐进复杂度都写在纸上——BFS/DFS 是 $O(V+E)$——但**真实运行时间由表示方法决定**: 同一次邻居遍历, 邻接矩阵是顺序扫描、预取器最爱; 邻接表的 `vector<vector<int>>` 是两级指针跳转、cache miss 成串; 把同样的信息压成 CSR (Compressed Sparse Row) 扁平数组, 单核每秒就能推数亿条边。所以选表示不是语法偏好, 而是在回答两个问题: **你的算法按什么模式访问边** (查一条边? 还是迭代整个邻接表?), 以及 **$E$ 和 $V^2$ 差多少个量级**。

读完应能：

1. 给定 $V, E$ 与查询模式, 在邻接矩阵 / 邻接表 / CSR 三者间做有依据的选择;
2. 手写 CSR 的构建与遍历 (Python + Go), 说清两个扁平数组各自的语义;
3. 写出 BFS 的关键不变量 ("入队时距离即最终") 并解释为什么标记必须发生在入队时;
4. 用三色法讲清 DFS 如何一次性判环、求拓扑序、找强连通分量。

---

## 思想链

```
问题: 内存里怎么摆下"谁和谁相连"?
  └─► 访问模式只有两种:
        ├─ "u→v 相连吗?" —— 随机单点查询 ─► 邻接矩阵 O(1) 直接命中
        │     └─► 稀疏时空间爆炸 O(V²) ─► bitset 压缩: V²/64 位, 顺带缓存友好
        └─ "u 的所有邻居挨个来" —— 遍历模式 ─► 邻接表 O(deg(u))
              └─► 但 vector<vector> 是指针追逐, cache 不友好
                    └─► 静态图终极形态: CSR 两个扁平数组
                          ├─ offset[V+1]: 每个点的邻居区间起点
                          └─ to[E]: 邻居目标连续存放 ─► 顺序扫描 + 硬件预取
                                └─► Pregel / Graph500 / cuGraph 的默认格式
                                    └─► 动态加边的代价是全量重建 ─► batched 更新
```

## 形式化定义

**图** $G = (V, E)$: $V$ 是顶点集 ($|V| = n$), $E \subseteq V \times V$ 是边集 ($|E| = m$)。三个决定表示选择的量：

- **度** $\deg(u)$: 与 $u$ 相连的边数;
- **稀疏性**: 真实世界的图几乎都是稀疏的——社交网络、网页链接、依赖关系图的 $m$ 通常在 $O(n)$ 到 $O(n \log n)$ 之间, 远小于上界 $n(n-1) \approx n^2$;
- **静态性**: 构建后是否还频繁增删边。这是 CSR 是否适用的分水岭, 与稀疏性正交。

> [!NOTE]
> 图论语言速查见 [离散数学 · 图](../../../math/discrete.md)。本章只关心"怎么存", 存下来之后的四大经典问题 (最短路 / 生成树 / 拓扑与 SCC / 流) 各有专章。

## 三种表示的取舍

| 维度 | 邻接矩阵 | 邻接表 (`vec<vec<int>>`) | CSR |
|------|----------|--------------------------|-----|
| 空间 | $O(V^2)$ | $O(V+E)$ + 每点一个 vector 头 | $O(V+E)$, 无 per-node 开销 |
| 查询 "$u \to v$?" | $O(1)$ | $O(\deg u)$ | $O(\deg u)$ |
| 迭代 $u$ 的邻居 | $O(V)$ | $O(\deg u)$ | $O(\deg u)$ |
| 局部性 | 极好 (连续) | 差 (指针追逐) | 极好 (两段连续区间) |
| 加边 | $O(1)$ | 均摊 $O(1)$ | 全量重建 $O(V+E)$ |
| 适用 | 稠密 / 频繁查边 | 原型开发 / 动态图 | 静态图性能敏感场景 |

经验法则：

1. **先看访问模式再选结构**。Floyd-Warshall 这类"到处问 $i \to k$ 相连吗"的算法天然配矩阵; BFS/Dijkstra 这类"展开当前点邻居"的算法配表式结构;
2. **稠密图用矩阵反而更快**: $E \approx V^2$ 时矩阵的空间代价不再吃亏, 而连续内存让每次扫描都是 cache 行级命中;
3. 分水岭大致在 $E \approx V^2/64$: 用 bitset 存矩阵 (每行 $V/64$ 个字), 空间压到 $O(V^2/64)$ 且能按字并行 (Floyd 传递闭包、三角计数都靠它加速);
4. **CSR 是"读密集 + 静态"的最优解**, 但它不支持就地改图——工程上的标准答案是攒一批边批量重建 (batched update), 或者用"分块 CSR"把新边挂在增量块里。

## CSR: 性能图的默认格式

把邻接表"拍平"成两个数组。设 4 个点、边为 $0\to1,\ 0\to2,\ 1\to3,\ 3\to0,\ 3\to2,\ 3\to3$:

```text
offset (长度 V+1): [0, 2, 3, 3, 6]
to      (长度 E):  [1, 2, 3, 0, 2, 3]

点 u 的邻居 = to[ offset[u] .. offset[u+1] )
  点 0 → to[0..2)  = {1, 2}
  点 1 → to[2..3)  = {3}
  点 2 → to[3..3)  = {}          (空区间 = 出度为 0)
  点 3 → to[4..6)? 不对, 是 to[3..6) = {0, 2, 3}
```

语义一句话: `offset` 是**前缀和** (累计到每个点为止有多少条边), `to` 是按源点排序后的边目标列表。带权图再加一个平行数组 `w[E]` 即可。

### Python: 构建 + BFS

```python
from collections import deque


def build_csr(n: int, edges: list[tuple[int, int]]) -> tuple[list[int], list[int]]:
    """边表 → CSR. 两遍扫描: 先桶计数做前缀和, 再按源点散布目标."""
    offset = [0] * (n + 1)
    for u, _ in edges:
        offset[u + 1] += 1               # 桶计数: offset[u+1] = u 的出度
    for i in range(1, n + 1):
        offset[i] += offset[i - 1]       # 原地前缀和
    to = [0] * len(edges)
    fill = offset[:]                     # fill[u] = 点 u 的下一个空槽位
    for u, v in edges:
        to[fill[u]] = v
        fill[u] += 1
    return offset, to


def bfs_csr(offset: list[int], to: list[int], s: int) -> list[int]:
    """CSR 上的 BFS: 返回 dist 数组 (-1 = 不可达). O(V + E)."""
    n = len(offset) - 1
    dist = [-1] * n
    dist[s] = 0
    q = deque([s])
    while q:
        u = q.popleft()
        for i in range(offset[u], offset[u + 1]):   # 顺序扫一段连续内存
            v = to[i]
            if dist[v] == -1:
                dist[v] = dist[u] + 1               # 入队时标记 = 距离即最终
                q.append(v)
    return dist


if __name__ == "__main__":
    edges = [(0, 1), (0, 2), (1, 3), (3, 0), (3, 2), (3, 3)]
    offset, to = build_csr(4, edges)
    assert offset == [0, 2, 3, 3, 6] and to == [1, 2, 3, 0, 2, 3]
    assert bfs_csr(offset, to, 0) == [0, 1, 1, 2]
    assert bfs_csr(offset, to, 3) == [1, 2, 1, 0]   # 自环 (3,3) 天然被 visited 挡掉
    assert bfs_csr(offset, to, 2) == [-1, -1, 0, -1]
```

### Go

```go
package main

import (
	"fmt"
)

// CSR 以两个扁平数组存图; 只适合静态图, 改边需整体重建.
type CSR struct {
	Offset []int // 长度 V+1, Offset[u]..Offset[u+1] 是 u 的邻居区间
	To     []int // 长度 E, 按源点排序的边目标
	W      []int // 可选: 平行权重数组
}

// BuildCSR 从边表构建; 两遍: 先计数前缀和, 再散布目标.
func BuildCSR(n int, edges [][2]int) *CSR {
	offset := make([]int, n+1)
	for _, e := range edges {
		offset[e[0]+1]++
	}
	for i := 1; i <= n; i++ {
		offset[i] += offset[i-1]
	}
	to := make([]int, len(edges))
	fill := append([]int(nil), offset...)
	for _, e := range edges {
		to[fill[e[0]]] = e[1]
		fill[e[0]]++
	}
	return &CSR{Offset: offset, To: to}
}

// BFS 返回从 s 出发的跳数 (-1 不可达). O(V+E).
func (g *CSR) BFS(s int) []int {
	n := len(g.Offset) - 1
	dist := make([]int, n)
	for i := range dist {
		dist[i] = -1
	}
	dist[s] = 0
	queue := []int{s}
	for len(queue) > 0 {
		u := queue[0]
		queue = queue[1:]
		for i := g.Offset[u]; i < g.Offset[u+1]; i++ {
			if v := g.To[i]; dist[v] == -1 {
				dist[v] = dist[u] + 1
				queue = append(queue, v)
			}
		}
	}
	return dist
}

func main() {
	g := BuildCSR(4, [][2]int{{0, 1}, {0, 2}, {1, 3}, {3, 0}, {3, 2}, {3, 3}})
	fmt.Println(g.Offset) // [0 2 3 3 6]
	fmt.Println(g.To)     // [1 2 3 0 2 3]
	fmt.Println(g.BFS(0)) // [0 1 1 2]
}
```

为什么快：内层循环 `to[offset[u]..offset[u+1])` 是**一段严格连续的内存**, 硬件预取器可以完美工作; 而 `vector<vector<int>>` 每换一个点要跳两次指针 (外层 vector → 内层 vector → 元素), 三次访存三次潜在 miss。这就是 Graph500、Pregel、cuGraph 等图基础设施全部以 CSR 为核心格式的理由。

## BFS: 不变量与多源变体

**关键不变量**：队列里的点按距离分层递增, 且**入队那一刻写入的 `dist` 就是最终答案** (边权全为 1 时 BFS 就是 Dijkstra, 见 [最短路径](shortest-path.md))。

由此推出两条铁律：

1. **标记必须在入队时做**。等出队才标记, 同一点会被多个父节点重复入队, 队列膨胀到 $O(E)$;
2. 队列的单调性使任何时刻队列最多两层混合——这是"01-BFS"(0/1 边权双端队列) 与分层并行的理论基础。

**多源 BFS**: 所有源点一起以 `dist=0` 入队, 一趟跑完得到"到最近源的距离"。火灾蔓延、腐烂橘子、"01 矩阵每个点到最近的 0"全是它——比逐个源跑 BFS 再取 min 便宜一个 $V$ 因子。

## DFS: 三色法与它的三大产出

递归版最直观, 但生产代码用显式栈防爆栈 (Python 默认递归深度 1000):

```python
def dfs_iter(n: int, adj: dict[int, list[int]], s: int) -> tuple[list[int], bool]:
    """迭代 DFS + 三色. 返回 (黑节点完成序, 是否有环).
    color: 0=白(未访问) 1=灰(在当前栈上) 2=黑(已完成)"""
    color = [0] * n
    order, has_cycle = [], False
    color[s] = 1                                   # 入栈即灰
    stack = [(s, iter(adj.get(s, ())))]
    while stack:
        u, it = stack[-1]
        for v in it:
            if color[v] == 0:                      # 树边: 白 → 灰, 下钻
                color[v] = 1
                stack.append((v, iter(adj.get(v, ()))))
                break
            elif color[v] == 1:                    # 指向灰 = 反向边 = 有环
                has_cycle = True
        else:                                      # 迭代器耗尽: 邻居全试完
            color[u] = 2                           # 变黑并记录完成序
            order.append(u)
            stack.pop()
    return order, has_cycle


if __name__ == "__main__":
    # 0 → 1 → 2 → 0: 有环; 完成序 [2, 1, 0]
    assert dfs_iter(3, {0: [1], 1: [2], 2: [0]}, 0) == ([2, 1, 0], True)
    # DAG 0→1, 0→2, 1→2: 无环; 完成序 [2, 1, 0], 逆序即拓扑序
    assert dfs_iter(3, {0: [1, 2], 1: [2]}, 0) == ([2, 1, 0], False)
```

三色的语义与产出：

| 颜色 | 含义 | 边指向该颜色意味着 |
|------|------|--------------------|
| 白 | 未访问 | 树边 (DFS 树的一部分) |
| 灰 | 在当前递归栈上 | **反向边 ⇒ 有环** (指向祖先) |
| 黑 | 已完成 | 横叉/前向边 (DAG 判定时无害) |

一次 DFS 免费送三样东西：**判环** (见灰即环)、**拓扑序** (黑节点完成时间的逆序, 见 [拓扑排序](topo-scc.md))、**强连通分量** (Tarjan/Kosaraju 的骨架)。无向图还有第四样: 桥与割点。

> [!WARNING]
> 迭代版最微妙的坑: 发现反向边后**不能 break**, 必须让当前迭代器继续耗尽, 否则该点的其余邻居被静默跳过。上面代码用 `for-else` 表达"迭代器自然耗尽才完成"——把 `else` 误写成循环体外的普通语句是这一模式的高频 bug。若只判环不要求遍历序, 用 Kahn 入度法更简单 (见 [拓扑排序](topo-scc.md))。

## 硬件视角: 遍历的吞吐阶梯

同一个 $O(V+E)$ 的 BFS, 换一层硬件差出一个数量级以上:

- **单核 CPU + CSR**: 顺序扫描 + 预取, 数亿边/秒是常态; 换 `vector<vector>` 指针追逐通常掉 5–10 倍;
- **GPU level-synchronous BFS**: 按"层"并行——当前 frontier 整体载入, 一步扩展出下一层。方向优化 (frontier 小用 push、大用 pull 翻转方向) 后, 现代 GPU 上可达数十至数百 GTEPS (十亿边/秒);
- **Graph500 基准**: 冠军系统 (超算级集群) 已达万 GTEPS 量级——差距不在算法 (都是 BFS), 在数据布局与通信。

共同规律: **越往硬件走, 越要把"指针结构"换成"扁平数组 + 分层批量处理"**。这与 CPU 分支预测、GPU SIMT 的偏好完全一致 (见 [存储层级](../../../computer-arch/memory-hierarchy.md))。

## 易错清单

1. **visited 标记时机**: BFS 入队时标, 不是出队时; 否则同一节点重复入队, 队列退化 $O(E)$;
2. **无向图加边两次**: `u→v` 与 `v→u` 都要建; 用 CSR 时边数组直接放两倍长;
3. **点编号 0/1 起点**: 读题先确认, "为什么 RE/OOB" 的头号来源;
4. **DFS 递归爆栈**: Python 默认 1000 层; 链状图 $10^5$ 点必炸, 改显式栈或迭代加深;
5. **空区间**: CSR 中出度 0 的点是 `offset[u] == offset[u+1]`, 循环自然跳过, 别写 `offset[u+1]-1`;
6. **动态图硬上 CSR**: 频繁加边请用邻接表攒批, 定期重建 CSR; 逐条重建是 $O(V+E)$ 每次。

## 经典题

- LC 200 岛屿数量 (网格隐式图 + flood fill);
- LC 994 腐烂橘子 (多源 BFS 标准题);
- LC 133 克隆图 (遍历时同步复制);
- LC 207 / 210 课程表 I/II (判环 + 拓扑序);
- LC 785 判断二分图 (二染色, BFS/DFS 均可);
- LC 542 01 矩阵 (多源 BFS)。

## 一页速查

```
选择:  查单边频繁/稠密 → 矩阵(bitset);  原型/动态 → vec<vec>;  静态+性能 → CSR
CSR:   offset[V+1]=前缀和, to[E]=按源排序的目标;  邻居=to[offset[u]..offset[u+1])
构建:  两遍: 度数前缀和 → 按源散布;  加权再加平行 w[E]
BFS:   入队即标记, dist 入队时即最终;  多源 = 全部源 dist 0 一起入队
DFS:   白灰黑; 见灰=有环; 黑的逆序=拓扑序; Tarjan/割桥全在这套状态机上
硬件:  扁平数组+分层批量 = 预取/SIMT 友好; 指针追逐是万恶之源
```

下一节 → [最短路径](shortest-path.md)
