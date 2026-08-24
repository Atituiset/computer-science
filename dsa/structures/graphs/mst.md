# 最小生成树 (MST)

## 一句话

给定带权无向连通图 $G = (V, E)$, 找一棵包含全部点、只有 $|V|-1$ 条边、权值和最小的树。两个经典算法 **Kruskal** (按边贪心 + 并查集判环) 和 **Prim** (按点扩张切分) 是同一个定理——**切性质**——的两种实现顺序: 一个把边排序后全局扫描, 一个从一点出发局部生长。MST 是"可证明的贪心"最干净的教学样本 (见 [贪心](../../algorithms/greedy.md)): 每一步局部最优都永远不会被推翻。

读完应能：

1. 写出并证明 cut property, 再由它一步推出 Kruskal 与 Prim 的正确性；
2. 用 Python / Go / C++ 三语言写出 Kruskal (并查集) 与堆优化 Prim;
3. 说出瓶颈生成树与 minimax 路径性质, 并知道它们解决什么问题；
4. 按稠密/稀疏/分布式三种场景选对算法。

---

## 思想链

```
问题: n 个点连成一体的最小代价?
  └─► 树 = 无环 + 连通, n-1 条边
        └─► 核心引理: cut property —— 任一切的最小横切边必在某棵 MST 里
              ├─ 按"边"用: 全部边排序, 从小到大试, 并查集防环   → Kruskal O(E log E)
              ├─ 按"点"用: 维护已连集合 S, 每次取跨 S 的最小边   → Prim    O(E log V)
              └─ 所有块同时取最小出边                            → Boruvka O(E log V), 天然并行
                    └─► 推论: MST 也是最小瓶颈生成树 → minimax 路径 / 聚类
```

## 形式化定义

**生成树**：无向连通图 $G$ 的一个无环连通子图 $T$, 恰含 $|V|-1$ 条边且覆盖所有顶点。**最小生成树**是其权值和 $\sum_{e \in T} w(e)$ 最小者。

- 生成树存在 $\iff$ 图连通 ($n-1$ 条边的连通图必为树);
- **权互不相同 $\Rightarrow$ MST 唯一**; 有相同权时 MST 可能不唯一, 但**所有 MST 的权值和相同**, 且各 MST 的边权多重集也相同。

## 切性质: 一切正确性的来源

**Cut property**: 设 $(S, \bar{S})$ 是任意一个把顶点分成两半的非空切, $e$ 是横跨该切的权最小边, 则**存在**一棵包含 $e$ 的 MST。

**证明 (交换论证)**：任取一棵 MST $T$。若 $e \in T$ 已完成；否则把 $e$ 加入 $T$, 得到唯一的环 $C$。环上两点 $u \in S, v \in \bar{S}$ 从一侧走到另一侧必然再跨越切一次, 故 $C$ 上存在另一条横切边 $f \neq e$。由 $e$ 是最小横切边知 $w(f) \ge w(e)$。令 $T' = T - f + e$: 仍是生成树, 且 $w(T') = w(T) + w(e) - w(f) \le w(T)$。$T$ 本是最优, 所以 $T'$ 也是 MST 且包含 $e$。$\blacksquare$

两个直接推论：

1. **Cycle property**: 环上权最大的边不属于任何 MST (权互异时)。因为把它换掉只会更优——这是 Kruskal "跳过成环边" 的合法性证明;
2. **Prim/Kruskal 正确性**: Kruskal 每次选的边都是"已选集合 vs 其余"这个切的唯一最小横切边; Prim 每次选的是 "$S$ vs $\bar{S}$" 的最小横切边。两者都在 cut property 保证下工作。

> [!NOTE]
> 注意结论只是"**存在**含 $e$ 的 MST", 不是"每棵 MST 都含 $e$"。当有并列最小权时两种选择都可能最优——这就是次小生成树只差一条边的根源。

> [!WARNING]
> cut property 要求**非空两侧**。若把切取成 $(\emptyset, V)$ 或 $(V, \emptyset)$, "横切边"根本不存在, 定理空洞成立但不能用来推理任何算法步骤。

## Kruskal: 按边贪心 + 并查集

```
所有边按权升序排序;
从小到大扫: 若两端不在同一连通块 → 选入 MST, 并查集合并; 否则跳过;
选满 n-1 条即停.
```

复杂度 $O(E \log E)$, 主导是排序; 并查集 + 路径压缩让每次 union/find 摊还 $O(\alpha(n))$ (细节见 [字典树与并查集](../trees/trie-union.md))。"跳过成环边"正是 cycle property: 该边已是所在环的最大边。

### Python

```python
def kruskal(n: int, edges: list[tuple[int, int, int]]) -> tuple[int, list]:
    """edges: [(u, v, w)]. 返回 (权和, 选中的边). O(E log E).
    图不连通时返回最小生成森林 (选不满 n-1 条), 需自行检查 len(chosen)."""
    parent = list(range(n))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]        # 路径折半压缩
            x = parent[x]
        return x

    total, chosen = 0, []
    for u, v, w in sorted(edges, key=lambda e: e[2]):
        ru, rv = find(u), find(v)
        if ru == rv:
            continue                             # 已连通: 此边会成环, 跳过
        parent[ru] = rv
        total += w
        chosen.append((u, v, w))
        if len(chosen) == n - 1:                 # 早停: 凑齐即止
            break
    return total, chosen


assert kruskal(4, [(0, 1, 1), (1, 2, 2), (0, 2, 3), (2, 3, 4)])[0] == 7
```

### Go

```go
package main

import "sort"

type mstEdge struct{ u, v, w int }

func find(parent []int, x int) int {
	for parent[x] != x {
		parent[x] = parent[parent[x]]
		x = parent[x]
	}
	return x
}

// Kruskal: O(E log E). 返回总权与选中边数; cnt < n-1 说明原图不连通.
func kruskal(n int, edges []mstEdge) (total, cnt int) {
	sort.Slice(edges, func(i, j int) bool { return edges[i].w < edges[j].w })
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	for _, e := range edges {
		ru, rv := find(parent, e.u), find(parent, e.v)
		if ru == rv {
			continue
		}
		parent[ru] = rv
		total += e.w
		if cnt++; cnt == n-1 {
			break
		}
	}
	return total, cnt
}

func main() {
	total, cnt := kruskal(4, []mstEdge{{0, 1, 1}, {1, 2, 2}, {0, 2, 3}, {2, 3, 4}})
	println(total, cnt) // 7 3
}
```

### C++ (原版保留)

```cpp
struct Edge { int u, v, w; };
vector<int> p;
int find(int x) { return p[x]==x ? x : p[x]=find(p[x]); }

int kruskal(vector<Edge>& E, int n) {
    sort(E.begin(), E.end(), [](auto& a, auto& b){ return a.w<b.w; });
    p.resize(n); iota(p.begin(), p.end(), 0);
    int total = 0, cnt = 0;
    for (auto& e: E) {
        int ru = find(e.u), rv = find(e.v);
        if (ru==rv) continue;
        p[ru]=rv; total += e.w;
        if (++cnt==n-1) break;
    }
    return total;
}
```

## Prim: 按点扩张

```
任选起点 s; 维护已在树中的集合 S;
每步从所有横切边 (u ∈ S, v ∉ S) 中取最小权边, 把 v 并入 S;
直到 n 个点全部加入.
```

实现上等价于"以起点为源的最短入树距离"版本 Dijkstra:

- 邻接矩阵朴素版: 每轮线性找最近未入树点, $O(V^2)$ —— **稠密图首选**;
- 邻接表 + 二叉堆: $O((V+E)\log V) = O(E \log V)$ —— 稀疏图可用;
- 与 Dijkstra 的区别只有一个符号: 松弛取 `min(d[v], w)` 而不是 `d[u] + w`——每个点到树的距离只看**自己那条边**, 不累加路径。

### Python

```python
import heapq


def prim_heap(n: int, g: list[list[tuple[int, int]]], start: int = 0) -> int:
    """堆优化 Prim: O(E log V). g[u] = [(v, w)] 双向邻接表.
    返回 MST 权和; 图不连通返回 -1."""
    in_tree = [False] * n
    heap = [(0, start)]                          # (到已建部分的最短距离, 点)
    total, cnt = 0, 0
    while heap and cnt < n:
        d, u = heapq.heappop(heap)
        if in_tree[u]:
            continue                             # 懒惰删除: 过期条目作废
        in_tree[u] = True
        total += d
        cnt += 1
        for v, w in g[u]:
            if not in_tree[v]:
                heapq.heappush(heap, (w, v))
    return total if cnt == n else -1
```

### Go

```go
type edgeW struct{ to, w int }

type minHeap []primItem
type primItem struct{ v, d int }

func (h minHeap) Len() int            { return len(h) }
func (h minHeap) Less(i, j int) bool  { return h[i].d < h[j].d }
func (h minHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *minHeap) Push(x any)         { *h = append(*h, x.(primItem)) }
func (h *minHeap) Pop() any {
	old := *h
	n := len(old)
	it := old[n-1]
	*h = old[:n-1]
	return it
}

// Prim 堆优化: O(E log V). 返回 MST 总权; 不连通返回 -1.
func primHeap(g [][]edgeW, n int) int {
	inTree := make([]bool, n)
	h := &minHeap{{v: 0, d: 0}}
	total, cnt := 0, 0
	for h.Len() > 0 && cnt < n {
		it := heap.Pop(h).(primItem)
		if inTree[it.v] {
			continue
		}
		inTree[it.v] = true
		total += it.d
		cnt++
		for _, e := range g[it.v] {
			if !inTree[e.to] {
				heap.Push(h, primItem{v: e.to, d: e.w})
			}
		}
	}
	if cnt < n {
		return -1
	}
	return total
}
```

(需要 `import "container/heap"`。)

### C++ 朴素版 (稠密图, 原版保留)

```cpp
int prim(vector<vector<int>>& g, int n) {
    vector<int> d(n, INT_MAX), in(n, 0);
    d[0]=0; int total=0;
    for (int i=0; i<n; ++i) {
        int u=-1;
        for (int v=0; v<n; ++v)
            if (!in[v] && (u==-1 || d[v]<d[u])) u=v;
        in[u]=true; total += d[u];
        for (int v=0; v<n; ++v) if (!in[v]) d[v]=min(d[v], g[u][v]);
    }
    return total;
}
```

## 瓶颈生成树与 minimax 路径

**阈值视角**：只用权 $\le W$ 的边, 图连通 $\iff$ MST 的最大边权 $\le W$。(两边都与"删掉 MST 中权 > W 的边后是否仍连通"等价。)

由此立刻得到两个免费结论：

1. **MST 是最小瓶颈生成树**: 在所有生成树里最小化"最大边权"。所以"让最差的那条路尽量好"这类问题直接跑 MST;
2. **Minimax 路径性质**: MST 上 $u \to v$ 路径的最大边权 = 全图 $u$ 到 $v$ 所有可能路径中最小的最大边权。于是"两点之间最少要多宽的路才能通过"可以离线建一次 MST 后在树上查询 (倍增/LCA), 或者在线二分阈值 + DSU 判连通。

延伸: **Kruskal 重构树**——按 Kruskal 合并顺序建新树 (每次合并建成一个权为边权的新父节点), 把"阈值连通性"变成子树查询, 是 NOI 级别题目的常用工具。

## 选型与进阶

| 场景 | 推荐 | 复杂度 |
|------|------|--------|
| 稀疏图, 要输出边列表 | Kruskal | $O(E \log E)$ |
| 稠密图, 邻接矩阵在手 | Prim 朴素 | $O(V^2)$ |
| 稀疏图 + 堆 | Prim | $O(E \log V)$ |
| 分布式 / 外存 / 并行 | Boruvka | $O(E \log V)$ |

- **Boruvka**: 每轮对所有连通块同时找各自的最小出边并合并, 块数至少减半, 共 $O(\log V)$ 轮。天然并行、边数可流式处理, 是分布式 MST 和外存算法的基础构件;
- **次小生成树**: 枚举每条非树边 $(u,v,w)$, 加上后成环, 删除环上最大边 (或严格次大边, 用于求"严格次小")。树上倍增维护路径最大/次大边可做到 $O(E \log V)$;
- **MST 唯一性判定**: 权全互异 ⇒ 唯一; 否则检查每条非树边是否与环上某条同权树边可互换。
- **单链接聚类**: 单链接层次聚类 = 在完整图上跑 Kruskal, 停在第 $k$ 小的合并处, 恰好得到 $k$ 个簇。

> [!TIP]
> 口诀: "**Kruskal 排边并查集, Prim 抓点堆里挤; 稠密矩阵走朴素, 分布式上 Boruvka**。" 以及判断类问题先想阈值: "权 ≤ W 连通吗?" 就是 MST 最大边 ≤ W 吗?

## 工程案例

- **电网 / 光纤 / 道路规划**: 经典成本最小连通问题;
- **单链接层次聚类**: 见上, NetworkX 的 `minimum_spanning_edges` 默认就是 Kruskal;
- **图像分割 / 区域合并**: 以像素相似度为边权做 MST, 再剪掉大边得到分割;
- **近似算法组件**: 度约束生成树、TSP 的 2-近似 (先 MST 后前序遍历) 都以 MST 为第一层。

## 易错清单

1. **自环与重复边**: 自环永不入选; 平行边保留最小的一条即可 (其余是环上的更大边, cycle property 直接淘汰);
2. **稠密图选错算法**: $E \approx V^2$ 时 Kruskal 要排 $V^2 \log V$ 条边, 朴素 Prim 只有 $O(V^2)$——选型搞反会慢一个数量级;
3. **并查集忘记初始化 `parent[i] = i`** (Go 里记得 for 循环赋值, C++ 用 `iota`);
4. **不连通图**: Kruskal 结束时 `cnt < n-1`, 应报告"最小生成森林"而不是当作答案输出; Prim 版本要显式返回 -1;
5. **负权边完全没问题**: MST 只关心权的大小序, 负权照常工作——这与最短路不同。

## 经典题

- LC 1584 连接所有点的最小费用 (MST 模板, 曼哈顿距离建边);
- LC 1489 找到 MST 里的关键边和伪关键边 (枚举 + 并查集, 考 cut/cycle 性质的应用);
- LC 778 水位上升的泳池游泳 (minimax 路径 = 阈值 + DSU 或直接 MST);
- LC 1168 水资源分配优化 (虚拟源点建边);
- POJ 1258 Agri-Net (稠密图 Prim 朴素版)。

## 一页速查

```
定义:    连通无向图, n-1 条边, 权和最小; 权互异 ⇔ MST 唯一
引理:    cut property (任一切最小横切边在某 MST 内) + cycle property (环上最大边不在内)
Kruskal: 边排序 + DSU, O(E log E); 稀疏图 / 要边列表
Prim:    点扩张, 朴素 O(V²) 稠密图, 堆 O(E log V); 与 Dijkstra 差一个 "+d[u]"
Boruvka: 各块同时取最小出边, O(E log V), 天然并行
瓶颈:    MST = 最小瓶颈树; u→v 最小最大边权 = MST 上路径最大边 (阈值+DSU 可替代)
坑:      自环跳过 / 平行边留最小 / 不连通要报森林 / 负权无影响
```

下一节 → [网络流](flow.md)。
