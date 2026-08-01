# 分支限界 (Branch & Bound)

## 与回溯的关系

- 回溯目标是"找到所有/任一组解";
- 分支限界目标是"找最优解", 多了一个**下界估计**: 当某个分支的"乐观估计已经差于当前最优"立刻剪.

## 模板

```
best = INF
Q = heap of (state, lowerBound)   # 优先队列按 lowerBound 升序
push (initial_state, lowerBound(initial_state))
while Q:
  state, lb = pop Q
  if lb >= best: continue       # 剪枝
  if terminal(state):
    if cost(state) < best: best = cost(state)
    continue
  for sub in expand(state):
    lb = lowerBound(sub)
    if lb < best: push(sub, lb)
```

## 不同的搜索策略

- **DFS + B&B**: 内存小, 深度优先; 只保留当前路径. 常用于 TSP 大输入.
- **BFS + B&B** (=Best-First Search): 优先队列里挑 lb 最小的, 类似 A* 思想.
- **iterative deepening**: 迭代加深, 结合 DFS 内存友好与 BFS 完备性.

## 下界设计的艺术

下界越紧、剪枝越狠、运行越快. 例: TSP 一个简单紧的下界是 MST 权值 + 两条最小边修正; 0/1 背包下界是"剩余容量用最优单价物品填满".

## 经典应用

- TSP: Held-Karp / B&B / cutting-plane;
- 0/1 KP: 分支限界 + 上界 (部分 KP);
- 整数规划: CPLEX / Gurobi 内部其中一类算法.

## 易错

1. **下界不松不紧**: 完全松 = 退化为回溯; 太紧 = 计算 lb 自己贵到不值得.
2. **best 初始化**: 用贪心算法跑出一个上界作为 best 初值, 极大加速.
3. **优先队列操作过度**: 复杂 heap 操作可能让常数翻倍.
