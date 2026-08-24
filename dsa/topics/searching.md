# 搜索: 二分与三分

## 一句话

二分的难点从来不在"取中点", 而在两件事: **把问题翻译成"单调谓词上的分界点", 以及把循环不变式写对**。只要你能把题目改写成"存在位置 $k$, 使得 $P(0..k-1)$ 全假、$P(k..n-1)$ 全真", 剩下的就是一个模板; 有序数组、旋转数组、二分答案、双数组中位数全是同一件事的换皮。三分则是它的近亲: 单调性换成单峰性, 求的是极值点。

读完应能:

1. 用循环不变式证明 lower_bound 的正确性, 并解释为什么半开区间写法几乎不出 bug。
2. 从一个 lower_bound 推导出 upper_bound、存在性、计数、前驱后继的全部模板。
3. 处理旋转数组的四道题（LC 33/81/153/154）, 并说清含重复时为什么必然退化到 $O(n)$。
4. 把"最小化最大值 / 最大化最小值"类问题套进二分答案框架, 写出纯判定的 check。

---

## 一、思想链

```
暴力线性扫描 O(n)
  └─► 数据有序 / 谓词单调: 每次比较扔掉一半 → O(log n)
       └─► 统一视角: 在布尔函数 P 上求第一个 true 的位置 (分界点 k)
             ├─ 有序数组:   P(i) = (a[i] >= x)          → lower_bound
             ├─ 计数:       count(x) = ub(x) - lb(x)
             ├─ 旋转数组:   分段单调 → 先用端点判断哪半有序
             ├─ 二分答案:   P(cap) = "容量 cap 可行" (可行域单调) → 答案空间上二分
             └─ 浮点/实数域: 固定迭代次数代替 eps
                  └─ 单峰函数求极值: 单调性没了 → 三分法
```

## 二、形式化定义: 循环不变式

**单调谓词**: $P$ 满足 $P(i) \Rightarrow P(j)\ (\forall j > i)$, 即形如 `false...false true...true`。二分求的是第一个 `true` 的下标 $k = \min\{i : P(i)\}$（不存在则为 $n$）。

以 lower_bound 为例, 半开区间写法 `[lo, hi)` 的不变式:

```
前提 L: 所有 i < lo 都有 a[i] <  x
前提 R: 所有 i >= hi 都有 a[i] >= x
初始: lo=0, hi=n —— 两个前提都平凡成立
保持: mid 处 a[mid] < x  → 由单调性 mid 左边全 < x → lo = mid+1 不破坏 L/R
      否则              → hi = mid 不破坏 L/R
终止: lo == hi, 两前提拼接 ⇒ a[lo] 是第一个 >= x 的位置
```

这就是半开区间几乎不出 bug 的原因: **不变式两端各有明确含义**, 且 `lo = mid + 1` 保证每轮严格前进, 不存在停滞状态。

> [!WARNING]
> 闭区间写法 `[lo, hi]` 里若收缩方向是 `lo = mid`, 中点必须**向上取整** `(lo+hi+1)/2`, 否则两元素区间里 `mid` 永远等于 `lo`, 死循环。两种写法选一种背熟, 不要现场混搭。

另一个工程细节: 中点一律写 `mid = lo + (hi-lo)/2`, `(lo+hi)/2` 在 32 位整型下会溢出（下标超过 $2^{31}/2$ 就可能触发）。

## 三、模板族: 一个 lower_bound 派生一切

```python
def lower_bound(a, x):
    """第一个 >= x 的下标; 不存在则 len(a)。不变式见上文。"""
    lo, hi = 0, len(a)
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if a[mid] < x:
            lo = mid + 1
        else:
            hi = mid
    return lo


def upper_bound(a, x):
    """第一个 > x 的下标。只改一个比较符。"""
    lo, hi = 0, len(a)
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if a[mid] <= x:
            lo = mid + 1
        else:
            hi = mid
    return lo
```

其余需求全部是这两个的组合:

| 需求 | 表达式 |
|------|--------|
| 插入位置（保持有序） | `lb = lower_bound(a, x)` |
| x 是否存在 | `lb < n and a[lb] == x` |
| 最后一个 `< x` | `lb - 1`（需判 `lb > 0`） |
| 第一个 `> x` | `ub = upper_bound(a, x)` |
| 最后一个 `<= x` | `ub - 1`（需判 `ub > 0`） |
| x 出现次数 | `ub - lb` |
| x 的区间 `[first, last]` | `[lb, ub-1]` |

### 各语言标准库对照

| 语言 | API | 备注 |
|------|-----|------|
| Python | `bisect.bisect_left` / `bisect_right` | 返回插入点, **不判存在性**, 要自己查界与查等 |
| Go | `sort.Search(n, f)` / `slices.BinarySearch` / `slices.BinarySearchFunc` | `f` 就是谓词, 返回第一个 true 的 i |
| C++ | `lower_bound` / `upper_bound` / `equal_range` | 迭代器, 减 `begin()` 得下标 |
| Java | `Collections.binarySearch` | 找不到返回 `-(插入点)-1` |

> [!NOTE]
> Go 的 `sort.Search` 把二分抽象到了极致: 它不要求有序数组, 只要求你给一个单调谓词 `f(i) bool`, 返回最小的使 `f(i)==true` 的 `i ∈ [0,n)`。二分答案直接用它, 连循环都不用写——这是"二分 = 单调谓词分界点"这个观点最直接的库证据。

## 四、旋转数组族: 分段单调的处理

数组在某个未知点被旋转过（如 `[4,5,6,7,0,1,2]`）。它不再全局单调, 但有一个关键观察:

> **任意切一刀 mid, 至少一半是完全有序的。**

于是每轮先判断哪半有序, 再判断 target 是否落在那个有序区间内:

```
搜索 LC 33 (无重复):
  if a[lo] <= a[mid]:            # 左半 [lo..mid] 有序 (注意等号!)
      if a[lo] <= target < a[mid]: hi = mid - 1   # target 在左半
      else:                        lo = mid + 1
  else:                          # 右半 [mid..hi] 有序
      if a[mid] < target <= a[hi]: lo = mid + 1
      else:                        hi = mid - 1
```

找最小值（LC 153）更简单, 只需要和右端点比:

```
if a[mid] > a[hi]:  最小值在 (mid, hi]  → lo = mid + 1
else:               最小值在 [lo, mid]  → hi = mid     (mid 可能就是答案)
```

含重复（LC 81 / 154）时会出现 `a[lo] == a[mid] == a[hi]`, 此时**无法判断哪边有序**, 只能收缩一步（`hi--` 或 `lo++`）, 最坏退化到 $O(n)$。

> [!WARNING]
> 这个退化是**信息论意义上不可避免的**: `[1,1,1,...,1]` 里找一个藏在中间的 `2`, 任何算法都必须检查每个元素。所以面试答"含重复最坏 O(n)"要补上这句理由, 这才是得分点。

## 五、二分答案: 在答案空间上二分

当题目问"最小的满足 X 的容量 / 速度 / 天数"且**可行域随参数单调**时, 对参数本身二分, 每步用一个 $O(n)$ 的纯判定函数 `check(mid)`:

```
最小化最大值 (LC 410 切分数组): P(s) = 能否切成 m 段、每段和 ≤ s
                                s 越大越容易 → 找第一个 true; 下界 max(a), 上界 sum(a)
最大化最小值 (LC 1552 放磁铁): P(d) = 能否放 m 个球、间距 ≥ d
                                d 越小越容易 → 找最后一个 true = 第一个 false 的前一个
吞吐型     (LC 875 吃香蕉): P(k) = 以速度 k 能否在 h 小时内吃完
```

三个纪律：

1. `check` 必须**只做判定**, 返回 bool; 在里面偷偷构造完整方案通常意味着你想复杂了;
2. 整数答案用闭区间 `[lo, hi]` 收缩, 终止于一点; 浮点答案不要用 `while r-l > eps` 硬卡精度, 固定迭代 ~100 次（每次区间折半, 精度指数收敛）更稳;
3. 上下界必须**覆盖解所在的范围**: 下界太松只是多跑几轮, 上界太紧直接漏解。

## 六、双数组中位数 (LC 4): 分割线视角

在两个有序数组里找中位数, $O(\log\min(m,n))$ 的推导:

$$\text{在短数组 } A \text{ 上二分分割点 } i,\quad j = \frac{m+n+1}{2} - i$$

分割合法当且仅当两侧互不越界地满足:

$$A_{i-1} \le B_j \;\wedge\; B_{i-1} \le A_j$$

- 若 $A_{i-1} > B_j$: $i$ 太大 → 左移;
- 若 $B_{i-1} > A_j$: $i$ 太小 → 右移;
- 合法时: 总数为奇数取 $\max(A_{i-1}, B_{j-1})$, 偶数取与 $\min(A_i, B_j)$ 的平均。

边界用哨兵处理: $i=0$ 时左半没有 A 元素, 视 $A_{i-1} = -\infty$; $i=m$ 时视 $A_m = +\infty$（B 同理）。这题的价值在于示范: **二分的对象可以是"分割方案"而不一定是数组元素**。

## 七、三分法: 单峰函数的极值

单调性换成单峰性后二分失效——中点两侧无法比较出"方向"。三分法在区间内取两个对称点, 用它们的函数值排除掉一段:

```python
def ternary_min(f, lo, hi, iters=200):
    """实数单谷函数 f 的极小值点。O(iters), 与 eps 无关的固定迭代。"""
    for _ in range(iters):
        m1 = lo + (hi - lo) / 3
        m2 = hi - (hi - lo) / 3
        if f(m1) <= f(m2):          # 谷底不可能在 m2 右侧
            hi = m2
        else:                       # 谷底不可能在 m1 左侧
            lo = m1
    return (lo + hi) / 2
```

整数版把 `(m1, m2)` 改成三等分点并小心处理 `f(m1) == f(m2)`（保留两侧都含极值的那个收缩方向即可）。

适用条件与坑:

- 要求严格单峰（或单谷）; **平台（相等的一段平地）会让三分失明**——`f(m1)==f(m2)` 时谷底可能在平台两端之间任意处;
- 凸函数更稳的做法是对导数（差分）二分, 或直接凸优化;
- 多峰函数必须先分段（如抛物线拟合 / 分治）再逐段三分。

## 八、多语言实现

### Python: bisect 应用 + 二分答案

```python
from bisect import bisect_left, bisect_right


def search_rotated(a, target):
    """LC 33: 旋转数组找 target。O(log n), 无重复元素。"""
    lo, hi = 0, len(a) - 1
    while lo <= hi:
        mid = lo + (hi - lo) // 2
        if a[mid] == target:
            return mid
        if a[lo] <= a[mid]:                      # 左半有序
            if a[lo] <= target < a[mid]:
                hi = mid - 1
            else:
                lo = mid + 1
        else:                                    # 右半有序
            if a[mid] < target <= a[hi]:
                lo = mid + 1
            else:
                hi = mid - 1
    return -1


def split_array_min_max(nums, m):
    """LC 410: 切成 m 段使最大段和最小。二分答案 + 贪心判定, O(n log sum)。"""
    def pieces_fit(cap):                         # 纯判定: 每段和不超过 cap 最少几段
        cnt, cur = 1, 0
        for x in nums:
            if cur + x > cap:
                cnt += 1
                cur = x
            else:
                cur += x
        return cnt <= m

    lo, hi = max(nums), sum(nums)                # 解必在 [max, sum] 内
    while lo < hi:
        mid = lo + (hi - lo) // 2
        if pieces_fit(mid):
            hi = mid                             # 可行 → 试更小的
        else:
            lo = mid + 1
    return lo


def count_in_sorted(a, x):
    """x 的出现次数: ub - lb, O(log n)。"""
    return bisect_right(a, x) - bisect_left(a, x)

from bisect import bisect_right as _br  # noqa: E402  (演示用别名)
bisect_left, bisect_right = bisect_left, _br
```

### Go: 泛型 lowerBound + sort.Search 二分答案 + 旋转数组

```go
package main

import (
	"fmt"
	"sort"
)

// LowerBound: 泛型版, 半开区间 [lo, n); 返回第一个 >= x 的下标
func LowerBound[T ~int | ~float64 | ~string](a []T, x T) int {
	lo, hi := 0, len(a)
	for lo < hi {
		mid := lo + (hi-lo)/2 // int 溢出在此写法下安全; 大数场景用 big.Int
		if a[mid] < x {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo
}

// SplitArrayMinMax: LC 410, 二分答案; sort.Search 直接吃单调谓词
func SplitArrayMinMax(nums []int, m int) int {
	feasible := func(capacity int) bool {
		cnt, cur := 1, 0
		for _, x := range nums {
			if cur+x > capacity {
				cnt++
				cur = x
			} else {
				cur += x
			}
		}
		return cnt <= m
	}
	sum, maxV := 0, 0
	for _, x := range nums {
		sum += x
		if x > maxV {
			maxV = x
		}
	}
	return sort.Search(sum+1, func(c int) bool { return c >= maxV && feasible(c) })
}

// SearchRotated: LC 33, 旋转数组
func SearchRotated(a []int, target int) int {
	lo, hi := 0, len(a)-1
	for lo <= hi {
		mid := lo + (hi-lo)/2
		switch {
		case a[mid] == target:
			return mid
		case a[lo] <= a[mid]:
			if a[lo] <= target && target < a[mid] {
				hi = mid - 1
			} else {
				lo = mid + 1
			}
		default:
			if a[mid] < target && target <= a[hi] {
				lo = mid + 1
			} else {
				hi = mid - 1
			}
		}
	}
	return -1
}

func main() {
	fmt.Println(LowerBound([]int{1, 2, 2, 3}, 2))            // 1
	fmt.Println(SplitArrayMinMax([]int{7, 2, 5, 10, 8}, 2))  // 18
	fmt.Println(SearchRotated([]int{4, 5, 6, 7, 0, 1, 2}, 0)) // 4
}
```

### C++: 标准库姿势与自定义谓词

```cpp
#include <algorithm>
#include <vector>

bool exists(const std::vector<int>& a, int x) {
    auto it = std::lower_bound(a.begin(), a.end(), x);
    return it != a.end() && *it == x;
}

int countInRange(const std::vector<int>& a, int loVal, int hiVal) {
    // equal_range 一次拿回 [first, last): 区间长度即出现次数
    auto r = std::equal_range(a.begin(), a.end(), loVal);   // 单点示例
    (void)r;
    return int(std::lower_bound(a.begin(), a.end(), hiVal) -
               std::lower_bound(a.begin(), a.end(), loVal));
}

// 自定义谓词: 在递减数组里找最后一个 >= x —— 谓词翻转即可复用 lower_bound
auto lastGE = std::lower_bound(a.rbegin(), a.rend(), x, std::greater<int>{});
```

## 九、边界测试清单

二分是 bug 密集区, 交付前过一遍这张表:

1. 空数组 / 单元素 / 两元素（最容易暴露死循环的规模）;
2. 全部元素相同（检验等号方向）;
3. target 是首元素 / 尾元素 / 不存在但小于全部 / 大于全部;
4. `lower_bound` 返回 `n`（越界）时的下游访问是否防护;
5. 32 位下标溢出: `(lo+hi)/2` vs `lo+(hi-lo)/2`;
6. 谓词恒真 / 恒假时返回值是否符合约定（Go `sort.Search` 返回 n）;
7. 浮点二分的迭代上限与相对误差（大数量级下绝对 eps 会失效）。

## 十、易错清单

1. **闭区间模板配 `lo = mid` 却向下取整** → 死循环; 取整方向必须与"谁原地不动"匹配;
2. **`bisect_left` 返回值当存在性用**: 它是插入点, 可能等于 `len(a)`, 也可能指向不同值;
3. **check 里做完整构造**: 判定函数应 $O(n)$ 贪心判定, 构造方案属于找到答案之后的第二阶段;
4. **可行域不单调硬二分**: 先论证"参数越大越可行（或反之）"再用二分, 否则结果是垃圾;
5. **旋转数组忘了等号**: `a[lo] <= a[mid]` 的 `=` 决定两元素区间 `[lo, lo+1]` 是否正确归类;
6. **含重复仍声称 $O(\log n)$**: 正确答案是均摊最坏 $O(n)$ 并说明原因;
7. **无序数据上二分**: 局部有序 ≠ 全局有序; 先排序（$O(n\log n)$）或换哈希表。

## 十一、经典题

- LC 704 二分查找 / LC 35 搜索插入位置（lower_bound 直译）;
- LC 34 在排序数组中查找元素的第一个和最后一个位置（lb/ub 组合）;
- LC 33 / 81 搜索旋转排序数组（变形 + 含重复退化分析）;
- LC 153 / 154 寻找旋转排序数组中的最小值;
- LC 4 寻找两个正序数组的中位数（分割线二分, $O(\log\min(m,n))$）;
- LC 410 分割数组的最大值 / LC 1011 运送包裹 / LC 875 吃香蕉 / LC 1552 磁力（二分答案四连）;
- LC 162 寻找峰值（局部单峰即可二分, 注意与三分的区别）;
- LC 69 x 的平方根 / LC 50 Pow(x, n)（数值域二分与快速幂, 见 [number-theory.md](number-theory.md)）。

## 一页速查

```
统一视角: 二分 = 单调谓词 P 上求第一个 true (分界点 k)
模板:    半开 [lo, n): a[mid]<x ? lo=mid+1 : hi=mid; 终止 lo==hi 即答案
派生:    存在=lb==x | 个数=ub-lb | 前驱=lb-1 | 后继=ub
纪律:    mid=lo+(hi-lo)/2 | 闭区间 lo=mid 必须向上取整 | 判界防 n
旋转:    一刀至少半边有序 → 先判哪半有序; 含重复必然退化 O(n)
答案:    最小化最大值→第一个true | 最大化最小值→最后一个true | check 只判定
浮点:    别卡 eps, 固定迭代 ~100 次
三分:    单峰求极值; 平台会失明; 多峰先分段
```

下一篇: [字符串: KMP / Z / Rabin-Karp / AC 自动机](string.md)。
