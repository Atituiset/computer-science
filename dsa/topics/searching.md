# 搜索: 二分与三分

## 二分前提

- **答案空间单调 / 具备可分性**.
- 写错了边界 / 输出, 常见 bug 集中地.

## 三种二分模式

```
寻找精确目标                 (左闭右闭 [L, R])
寻找左边界 (找第一个 >= x) (半开 [L, R) 或 [L, n))
寻找右边界 (找最后一个 <= x)
```

### 模板一: 精确找

```python
def binary_search(a, x):
    L, R = 0, len(a) - 1
    while L <= R:
        M = L + (R - L) // 2
        if a[M] == x: return M
        if a[M] < x: L = M + 1
        else:        R = M - 1
    return -1
```

### 模板二: 第一个 >= x

```python
def lower_bound(a, x):
    L, R = 0, len(a)        # 半开 [L, R)
    while L < R:
        M = L + (R - L) // 2
        if a[M] < x: L = M + 1
        else:        R = M
    return L                # L == R, 可能是 len(a) 表示无合适位置
```

### 模板三: 最后一个 <= x

```python
def upper_bound(a, x):
    L, R = 0, len(a)
    while L < R:
        M = L + (R - L) // 2
        if a[M] <= x: L = M + 1
        else:        R = M
    return R - 1
```

记忆口诀: "`lb`/`ub` 都是 `[L, n)` 半开, 比较中点选 L 或 R 的依据决定收缩方向".

## 二分答案 (求最大/最小)

```
"能满足条件 X" 的范围单调 →
  二分答案 ans, 每步 check(ans) 是纯判定,
  收敛到合法最大/最小.
```

经典: m 次切分问题 (LC 410)、旅行配送天数 (LC 1011)、最小幅度最大距离 (LC 1552).

## 三分: 单峰函数找极值

```python
def ternary_search(f, L, R, eps=1e-9):
    while R - L > eps:
        m1 = L + (R - L) / 3
        m2 = R - (R - L) / 3
        if f(m1) < f(m2): L = m1
        else:             R = m2
    return (L + R) / 2     # 最大值点
```

适用: 单调单峰/单谷的连续函数极值. 要求能求值、对不一定光滑.

## 经典题

- LC 33/81 搜索旋转排序数组 (二分查找变形).
- LC 153/154 旋转数组最小值.
- LC 4 寻找两个正序数组中位数 (O(log(m+n)) 二分到分割点上).
- LC 410 / 1011 / 875 二分答案三连.
