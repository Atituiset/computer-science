# 最短路径: Dijkstra / Bellman-Ford / Floyd

## 一句话

最短路径是最经典图算法之一. 选择哪个算法取决于**图的形态**:

| 算法 | 适用 | 复杂度 | 不能处理 |
|------|------|--------|----------|
| **Dijkstra** | 非负权单源 | `O((V+E) log V)` 堆版 | 负边 |
| **Bellman-Ford** | 含负权单源 | `O(V·E)` | 负环 (可用来检测) |
| **SPFA** | 平均 O(E) 的 Bellman 优化 | 均摊 O(E), 最坏 O(VE) | 比 Bellman-Ford 还慢 |
| **Floyd-Warshall** | 全源点对 | `O(V³)` | 负环 (可途中检测) |
| **A\*** | 单对 / 有启发 | 取决于启发函数 | 启发函数不可采纳时退化为 Dijkstra |

## Dijkstra

**核心**: 贪心扩展最短确认距离的节点, 类似 BFS + 堆.

```python
import heapq
def dijkstra(g, s):
    dist = {s: 0}
    pq = [(0, s)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist.get(u, float('inf')): continue
        for v, w in g[u]:
            nd = d + w
            if nd < dist.get(v, float('inf')):
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return dist
```

**关键不变量**: 从堆 pop 出的节点距离已最终化. 这要求**边权非负**, 否则后续可能再缩短.

> [!WARNING]
> 有负权时直接用 Dijkstra 会得错误结果. 请改 Bellman-Ford 或 SPFA.

## Bellman-Ford

**核心**: 松弛所有边 V-1 次.

```python
def bellman_ford(edges, n, s):
    INF = float('inf')
    dist = [INF] * n
    dist[s] = 0
    for _ in range(n - 1):
        updated = False
        for u, v, w in edges:
            if dist[u] + w < dist[v]:
                dist[v] = dist[u] + w
                updated = True
        if not updated: break
    # 检查负环
    for u, v, w in edges:
        if dist[u] + w < dist[v]: raise Exception("negative cycle")
    return dist
```

第 V 轮还能 relax = 存在负环.

## SPFA

Bellman-Ford 队列入队策略优化: 仅对有 distance 改进的节点重新入队.

平均 O(E), 但卡过的题面里 SPFA 经常被构造数据搞到 O(VE).

## Floyd-Warshall

**核心**: DP. `d[i][j][k] = 仅经过 {1…k} 的中间节点时 i→j 的最短路径`.

```python
def floyd(g, n):
    d = [[float('inf')] * n for _ in range(n)]
    for i in range(n): d[i][i] = 0
    for u in range(n):
        for v, w in g[u]: d[u][v] = w
    for k in range(n):
        for i in range(n):
            for j in range(n):
                d[i][j] = min(d[i][j], d[i][k] + d[k][j])
    return d
```

复杂度 `O(V³)` 对小图 (V ≤ 200) 非常实用. 是闭包、文件传递、最短路径检测的瑞士军刀.

## A* : 带启发的 Dijkstra

加入预估函数 `h(u)` (到目标的可采纳下界):

```
f(u) = g(u) + h(u)
优先队列里 pop f 最小.
```

如果 h 可采纳 (不超估), 结果最短. 游戏地图、路径规划、Word Ladder 都用.

## 硬件视角: GPU 上的 SSSP

Dijkstra 在 GPU 上不是 trivial - 优先队列难以并行. 改进策略:

- **Bellman-Ford 的 GPU 化很简单**: 每条边在 GPU 上一次并行松弛;
- 实测 1000 万顶点, 2000 万边: CPU Dijkstra ~2s, GPU Bellman-Ford SIMD ~50 ms;
- OpenMP / CUB / HMPP 都给 SSSP 提供了 swap-friendly 实现.

## 经典题

- LC 743 网络延迟时间 (Dijkstra);
- LC 787 K 站中转内最便宜的航班 (Bellman-Ford 限制边数版);
- LC 1334 阈值距离内邻居最少的城市 (Floyd);
- LC 1631 最小体力消耗路径 (类 Dijkstra 网格).

下一节 → [最小生成树](mst.md)
