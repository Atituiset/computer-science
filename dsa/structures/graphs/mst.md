# 最小生成树 (MST)

## 一句话

给定带权无向连通图 G = (V, E), 找一棵跨 V 的子图, 权值和最小. 两个经典算法 **Kruskal** (贪心边 + 并查集) 和 **Prim** (堆扩张切点集) 都用贪心 - **MST 的贪心性训练了所有"无后效 + 局部最优 → 全局最优"模型**.

## Kruskal 算法

```
将所有边按权升序排序;
依次取最小权边, 若两端不在同一集合 → 加入 MST, 并查集合并;
否则跳过;
直到 |V| - 1 条边加入.
```

复杂度 `O(E log E)`, 主导是排序.

并查集 + 路径压缩让 union/find 接近 O(1).

## Prim 算法

```
任选起点 s; 维护"已加入"集合 S;
每步从所有 (u ∈ S, v ∉ S) 中选最小权边 (u,v), 把 v 并入 S;
不停直到 V 个点全部加入.
```

复杂度:
- 邻接矩阵朴素: O(V²)
- 邻接表 + 堆: O((V+E) log V) = O(E log V)

稠密图时朴素矩阵版好. **稀疏图 Kruskal 占优**.

## C++ 实现 Kruskal

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

## C++ 实现 Prim 朴素版

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

## 工程案例

- **道路规划 / Power grid**: 经典应用;
- **生物学: 单链接层次聚类**: 从距离矩阵出发, 按权从小到大 Kruskal, 直到一族 cluster 数;
- **NetworkX minimum_spanning_edges**: 用 Kruskal 默认实现.

## 进阶

- **Boruvka 算法**: 每步对所有连通块同时找最小出边, 把块数减半直到整体为 1. 复杂度 `O(E log V)`. Mongo / 分布式 MST 的好选择;
- **MST 唯一性**: 等价于所有边边权实现上的边都能被另一条同权边替换等价.

## 易错

1. **重复边 / 自环** 必须在数据组织时处理或图建立时跳过;
2. **稀疏 vs 稠密的选型搞反**: 稠密图上 Kruskal 排序代价 = E log E;
3. **并查集未初始化**: 父亲数组用 `iota`.

下一节 → [拓扑排序与强连通分量](topo-scc.md)
