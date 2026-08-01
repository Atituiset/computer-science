# 拓扑排序与强连通分量

## 一句话

拓扑排序处理的是 **DAG** (有向无环图) 上"做事先 X 再做事 Y"的依赖排序; 强连通分量 SCC 处理的是任意有向图上"互相可达的极大子集". 二者各自有两种主流实现, 工程界默认 **Kahn** + **Tarjan**, 因为它们都是单 pass、紧凑实现.

## 拓扑排序 (DAG)

### 题目

给 DAG, 列出所有节点使得 v 出现在所有指向 v 的边之前.

### Kahn 算法 (BFS 入度剥洋葱)

```python
from collections import deque
def topo(g, n):
    indeg = [0]*n
    for u in g:
        for v in u: indeg[v] += 1
    q = deque([i for i, d in enumerate(indeg) if d == 0])
    order = []
    while q:
        u = q.popleft()
        order.append(u)
        for v in g[u]:
            indeg[v] -= 1
            if indeg[v] == 0: q.append(v)
    return order if len(order) == n else None  # None 表示有环
```

### DFS 后序逆序 (三色)

```python
def dfs_topo(g, n):
    color = [0]*n
    order = []
    def visit(u):
        if color[u] == 1: raise Exception("cycle")
        if color[u] == 2: return
        color[u] = 1
        for v in g[u]: visit(v)
        color[u] = 2
        order.append(u)
    for i in range(n):
        if color[i] == 0: visit(i)
    return order[::-1]
```

## SCC: 强连通分量

任意两点互相可达, 且极大. 三个主流算法:

| 算法 | DFS 次数 | 空间 | 实现复杂度 |
|------|----------|------|-------------|
| Kosaraju | 2 次 | O(V) | 简单, 最易读懂 |
| Tarjan | 1 次 | O(V) 栈 | 中等 |
| Gabow | 1 次 | 双栈 | 中等 |

### Kosaraju

```
1) 在 G 上跑 DFS, 记入栈顺序 (看"离开"时间);
2) 反转所有边得到 G^T;
3) 按 (1) 中栈的逆序在 G^T 上跑 DFS, 每次"开新 DFS 树即一个 SCC".
```

### Tarjan

```
维护 (lowlink, dfn):
- u 的 dfn 是首次访问时间.
- u 的 lowlink = min(dfn[u], dfn[v] for v in back/descendant edges).
若 lowlink[u] == dfn[u], 弹出栈直到 u 即为一个 SCC.
```

## 应用

- **DAG 调度 /pipeline**: 课程表、CI 任务图、增量编译;
- **2-SAT**: 把每个变量拆成两个 vertex、用 SCC 模型判定可满足性;
- **Dataflow analysis / 增量计算**: 编译器控制流图、SSA;
- **PageRank**: 边 SCC 收敛划分极大强连通集合.

## 硬件视角

- 拓扑排序在 GPU/FPGA 上的 streaming 实现: **DAG 的 SIMD 并行执行** = TornadoOS 等 task-graph acceleration;
- Tarjan 在 FPGA 上常用来识别 page rank 子图 - 用栈硬件 BRAM 实现栈结构;
- **NPU / 计算图编译器**: ML 计算图是 DAG, 拓扑排序配合 fusion / 内存 reuse.

## 经典题

- LC 207/210 课程表;
- LC 802 找到最终安全状态 (颜色 BFS);
- LC 1192 临界边 (边双连通分量).

下一节 → [网络流入门](flow.md)
