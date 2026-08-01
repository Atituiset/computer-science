# 网络流入门

## 一句话

最大流 = 给定有向带容量图 G、源点 s、汇点 t, 求一条最大可输送流量. 经典算法 **Ford-Fulkerson** (DFS 增广) / **Edmonds-Karp** (BFS) / **Dinic** (建分层图). **最小割 = 最大流量** (最大流-最小割定理).

工程意义 (理由此处归入 DSA): 图像分割 / 二分图匹配 / 任务调度 / 路径复用.

## 最大流模型

给定有向带容量图 G、s、t, 求一条流函数 f: E → R 满足:
1. 容量约束: `f(u,v) ≤ c(u,v)`
2. 流量守恒: 除 s, t 以外每个节点 `Σin = Σout`

目标: `Σf(s, ·)` 最大.

## 关键三步

1. **残量图 (residual graph)**: 原图 + 反向边. `r(u,v) = c(u,v) - f(u,v)`; 同时 `r(v,u) = f(u,v)` 表示可"撤销".
2. **增广路径 (augmenting path)**: 残量图上 s→t 的简单路径, 流量等于路径最小 `r`.
3. **迭代**直到无增广路径.

## Ford-Fulkerson 框架

```python
def ford_fulkerson(c, s, t):
    f = defaultdict(int)
    while True:
        path = find_aug_path(c, f, s, t)
        if not path: break
        # 堵量 = min r 沿路径
        delta = min(c[u,v]-f[u,v] for u, v in path)
        for u, v in path:
            f[u, v] += delta
            f[v, u] -= delta  # 反向边
    return f
```

复杂度: `O(E · max_flow)`, 对**整数容量**有限; 用 BFS 找路径 = Edmonds-Karp, 复杂度 `O(V·E²)`.

## Dinic: 分层图

每轮 BFS 构造"距离图", 再 DFS 沿层次并发 augment. 复杂度 `O(V²·E)`, 单位容量网络可达 `O(min(V^{2/3}·E, E^{3/2}))`.

## 二分匹配 = 最大流的特例

二分图 (L, R) 加 s→L (cap=1)、R→t (cap=1) 后跑最大流即为最大匹配.

经典: **匈牙利算法** 直接 O(V·E), 更易写且常数小.

## 最小割

最大流 = 最小割 (max-flow min-cut theorem). 求出 max-flow 后残量图上从 s **不可达**的顶点构成 S 集, 其余为 T 集, 割 = {(u,v) : u ∈ S, v ∈ T} 之和.

工程用途: 图像分割 (Boykov-Kolmogorov 算法)、软件包依赖最小冲突修复等.

## 进阶

- **最小费用最大流 (MCMF)**: 每次找费用最短增广路. SPFA / Bellman-Ford / Dijkstra + Johnson 反复重;
- **Gomory-Hu 树**: 所有点对的最大流压缩成一棵 n-1 边的树;
- **Stoer-Wagner 最小割**: 直接求图整体最小割, 适合无向图.

## 易错

1. **反向边容量计算**: 增广时反边容量也被推进, 并入残留图里;
2. **暂停条件**: 找不到增广路 (path) ≠ 残量图断开, 要按"接入路径"判定;
3. **f[u,v] 初值** 反向边初始化 0, 避免漏加.

## 经典题

- POJ 1273 / 洛谷 P3376 最大流模板;
- 洛谷 P3381 最小费用最大流;
- LC 460 LFU 缓存 (聚合优先级流式排序思路);
- Hopcroft-Karp 二分图匹配;
- POJ 1149 猪调度 (混合流建模).
