# 图的表示与遍历

## 一句话

图的算法几乎都生成 O(V + E) 时空, 但**真实运行时间被表示方法决定**. 同一道 BFS, 邻接表 vs 邻接矩阵差 100 倍 cache 命中率, CSR (Compressed Sparse Row) 比 `std::vector<vector<int>>` 再快 10 倍, 把它压到 FPGA 上还能再快 100 倍. 这一章的目标在于: **让你一看到算法就能选出和硬件相容的图表示**.

## 邻接表 vs 邻接矩阵

| 指标 | 邻接表 | 邻接矩阵 |
|------|--------|----------|
| 空间 | O(V+E) | O(V²) |
| 边查询"u→v？" | O(deg u) | O(1) |
| 遍历邻居 | O(deg u) | O(V) |
| 加边/删边 | 表插入 O(1) 添; 删需 O(deg u) | 置位/清位; O(1) |
| 适合 | 稀疏: E ≪ V² | 稠密: E ~ V² |

经验值: `E ≈ V² / 64` 是大致分水岭. 更稀疏用邻接表.

**反直觉**: 稠密图用矩阵有时**比邻接表更快** - 因为内存连续, cache 行命中率高, 跨相邻元素的代价被省掉.

## CSR (Compressed Sparse Row): 性能图表示默认

CSR 是图数据库 / BFS 大学竞赛题加速的核心技巧. 把邻接表压成两个扁平数组:

```
head:  [0,    2,    4,    4,    7]   // 每 vertex 的 to[] 开始下标
to:    [1, 2, 0, 3,    _,    0, 2, 3]   // 编出边目标列表
```

即: vertex 0 的邻居是 to[head[0]..head[1]) = to[0..2) = {1, 2}.
- 空间: O(V + E) 与邻接表相同;
- 遍历邻居 cache 全部命中: 预取极漂亮;
- 加边代价: 不友好 (要扩容 + 编译, 时间复杂度 O(V + E), 但实际工程可 gained by 重新分配 batched).

几乎所有图框架 - Google Pregel, Graph500 基准, GPU 上的 cuGraph,  - 都把 CSR 当默认.

## 遍历: BFS / DFS 模板

### BFS (求最短跳数)

```python
from collections import deque
def bfs(g, s):
    dist, q = {s: 0}, deque([s])
    while q:
        u = q.popleft()
        for v in g[u]:
            if v not in dist:
                dist[v] = dist[u] + 1
                q.append(v)
    return dist
```

**BFS 关键不变量**: 入队的 dist 一定是「s 到 v 的最少边数」. 用来求最短跳数、连通分量、二分图判定.

### DFS (迭代 + 三色)

```python
def dfs(g, s):
    color = {v: 0 for v in g}   # 0 白 1 灰 2 黑
    stack = [s]
    while stack:
        u = stack.pop()
        if color[u] == 0:
            color[u] = 1
            stack.append(("enter", u))
            for v in g[u]:
                if color[v] == 0: stack.append(v)
        # ... enter/exit 处理 ...
```

三色用途:
| 颜色 | 含义 |
|------|------|
| 白 (0) | 未访问 |
| 灰 (1) | 在当前递归栈中 |
| 黑 (2) | 已经完全访问完 |

**判环**: DFS 到灰节点 = 反向边 = 环.
**拓扑序**: 黑节点的逆序.
**强连通分量**: Tarjan 的核心借此实现单次 DFS.

## 多语言实现

### Go CSR

```go
type CSR struct {
    Head, To, W []int
}

func (g *CSR) EdgesFrom(u int) (int, int) {
    return g.Head[u], g.Head[u+1]
}
```

### TypeScript CSR 风格

```ts
class CSR {
  constructor(public head: Int32Array, public to: Int32Array) {}
  edges(u: number) {
    return { from: this.head[u], to: this.head[u+1] };
  }
}
```

## 硬件视角

BFS / DFS 在 FPGA 上常见物化:

- **BFS**: Arup/Lancsaceut paper 上 GPU 给 BFS 做 level-synchronous, 每 layer 并行 with frontier;
- G2-TLBFS 用 shared mem + queue 优化: speed up bfs on GPU 到 5 GTEPS;
- FPGA 上 graph overlay NETWORK 路由: K8000 kind 的 AXI-NOC 网络用 XBAR + Ring + DFS 实现 6.5 Tbps 图遍历.

软件层 O(V+E) 看起来没差别, 但 ops/sec 越往硬件层越差 100 倍. **同样的遍历, 在 CSR + 单核 ≈ 100M edges/s; GPU 但数 GB/ sm 但是 GE CPS graph500 optimnins 是 GPU 可以 BFS 到 50 GEPS**.

## 易错点

1. **多源 BFS** 应该一开始就把所有源装 dequeue 入栈 (dist=0), 而不是每个源单独 BFS;
2. **无向图** 加边时两次 (u→v、v→u);
3. **节点 0 vs 1** 起: 调试时最常见"踩 OOB";
4. **DFS 递归爆栈**: Python 默认 1000, 大图直接 `sys.setrecursionlimit + 改迭代`;
5. **visited 判定时机**: BFS 入队时标记, 出队时再判定就晚了 - 可能装多次.

## 经典题

- LC 200 岛屿数量;
- LC 133 克隆图;
- LC 207 课程表 (拓扑序);
- LC 210 课程表 II;
- LC 785 判断二分图;

下一节 → [最短路径](shortest-path.md)
