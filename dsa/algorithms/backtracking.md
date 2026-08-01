# 回溯与剪枝

## 一句话

回溯本质是带"撤销"功能的 DFS. 真正考验工程师的从来不是写出回溯 - 而是用**剪枝**把回溯从指数纷飞优化到一次能跑完. 一道 N 皇后纯回溯能在 n=20 跑出几亿年, 加剪枝后秒级结束.

## 模型

```
solve(state):
  if terminal(state): record(state); return
  for choice in choices(state):
    if valid(choice):
      apply(choice)
      solve(new_state)
      undo(choice)
```

剪枝技巧:
1. **可行性剪枝**: 当前已不满足基本约束 (如剩余预算不足);
2. **最优性剪枝**: 当前最优已不可能优于迄今最好 ⇒ 返回;
3. **重复等价剪枝**: 相同层用过的"形状"不再用: `for i in range(start, n)` 而不是 `for i in range(n)`;
4. **下界 (与分支限界共享)**: 估一个下界, 大于当前上界就剪.

## 经典问题

- N-Queens、子集枚举、组合枚举、排列枚举、数独求解、解表达式.
- LC 51 N 皇后、LC 39 组合总和、LC 46/47 全排列、LC 22 括号生成、LC 79 单词搜索.

## 易错

1. **撤销 side effect 不完整**: `path = path + [x]` 创建新对象不需要 undo; `path.append(x)` 必须 `path.pop()`.
2. **重复元素处理**: 含重复元素的子集/组合, 一定要先排序后 `i > 0 && a[i] == a[i-1] && used[i-1]==false` 跳过.
3. **大数据下 TLE**: 没做剪枝 → 复杂度峰爆炸; 先加可行性剪枝.
