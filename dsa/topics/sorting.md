# 排序: 从朴素到极致

## 一句话

排序的价值不在"会背十个算法", 而在看清**两条根本不同的路线**: 只用"比较"这条路被决策树下界 $\Omega(n \log n)$ 锁死, 于是只能在"平均常数、最坏保证、稳定性、空间、缓存友好"之间做折中——所以工业界才有 introsort (C++)、pdqsort (Go)、Timsort (Python/Java) 三种不同答案; 而一旦你愿意利用键的内部结构 (值域、位数、分布), 计数 / 基数 / 桶就能绕过下界做到线性。选错路线的代价是数量级的。

读完应能:

1. 手写 Lomuto / Hoare / 三路三种分区, 解释 Hoare 为什么平均少换 3 倍、全等元素下一个 O(n²) 一个 O(n log n)。
2. 证明 build-heap 是 O(n) 而非 O(n log n), 并说出堆排为什么只配当"兜底"。
3. 按值域 / 位数 / 分布选择计数、基数、桶, 说清稳定性在其中扮演的角色。
4. 复述 introsort 与 pdqsort 的完整防御链: pivot 选择 → 小数组插入 → 深度超限堆排 → 熵减 break patterns。

---

## 一、思想链

```
问题: 把 n 个可比大小的元素变成全序
  ├─ 路线 A: 只用"比较"这一种信息
  │    └─► 决策树下界 Ω(n log n) ─► 目标只剩: 常数最小 + 最坏不退化
  │          ├─ 快排: 平均最快, 生死于 pivot 选择 ─► 分区策略 + 多层兜底
  │          ├─ 归并: 稳定 + 最坏 O(n log n), 但要 O(n) 辅助 ─► 外排序 / 稳定需求的主力
  │          └─ 堆排: 最坏 O(n log n) + O(1) 空间, 但跳跃访问 cache-hostile ─► 只当兜底
  └─ 路线 B: 利用键的内部结构 (值域 / 位 / 分布)
       └─► 绕过比较下界: 计数 O(n+k) / 基数 O(d(n+b)) / 桶期望 O(n)
            └─► 代价: 需要稳定的辅助排序 + 对数据分布有假设
```

## 二、形式化定义与比较下界

**排序问题**：输入 $a_0, \dots, a_{n-1}$, 求排列 $\pi$ 使 $a_{\pi(0)} \le a_{\pi(1)} \le \cdots \le a_{\pi(n-1)}$。

**稳定性**：若 $a_i = a_j$（$i < j$）, 稳定排序保证输出里 $i$ 仍在 $j$ 前。业务排序（先按金额再按时间）大多隐式要求稳定。

**比较排序的下界**：任何只靠比较的算法, 其执行轨迹是一棵决策树; $n$ 个元素有 $n!$ 种可能排列, 树高至少

$$\log_2(n!) \;\approx\; n\log_2 n - 1.44n \;=\; \Omega(n \log n)$$

两个推论：

- $O(n \log n)$ 就是路线 A 的天花板, 不存在"通用更快的比较排序";
- 计数 / 基数 / 桶**没有违反下界**——它们不做比较, 用的是"键的位结构"这条额外信息, 下界的前提已经不成立。

## 三、分区: 快排的心脏

快排的一切性能差异都浓缩在一个函数里: 给定 pivot, 如何把区间切成两半。

### 3.1 Lomuto: 好写但换得多

```
partition(a, lo, hi):            # pivot = a[hi]
  i = lo                         # i 左边全是 < pivot 的
  for j in lo..hi-1:
    if a[j] < pivot: swap(a[i], a[j]); i++
  swap(a[i], a[hi]); return i    # pivot 落到最终位
```

- 单向扫描, 逻辑一目了然, 但**每个小于 pivot 的元素都触发一次交换**, 平均交换 $(n-1)/2$ 次;
- **全等元素的灾难**: 所有比较都为假, 区间只缩小 1 → $O(n^2)$;
- pivot 直接进最终位 → 递归 `(lo, i-1)` 和 `(i+1, hi)`。

### 3.2 Hoare: 双向扫描的原版

```
partition(a, lo, hi):            # pivot 值 = a[lo] (必须!)
  i, j = lo-1, hi+1
  loop:
    do i++ while a[i] < pivot
    do j-- while a[j] > pivot
    if i >= j: return j          # 注意: 返回 j, 不是 i
    swap(a[i], a[j])
  # 递归边界: (lo, j) 和 (j+1, hi)  ← 与 Lomuto 不同!
```

关键性质（可证）：返回的 $j$ 满足 $lo \le j < hi$, 且 $a[lo..j] \le pivot \le a[j+1..hi]$; **pivot 不一定落在最终位**。

- **双向扫描, 平均交换只有约 $n/6$ 次**——是 Lomuto 的 1/3, 这是它实测更快的主因;
- 全等元素时两个指针在每个位置都停, 从两侧均匀推进 → 分裂平衡, $O(n \log n)$;
- **安全锚点**: pivot 必须取自区间内（工程上取三者中位数后换到 `lo`）, 否则扫描会越界或死循环。

### 3.3 三路分区 (荷兰国旗): 重复元素的终极答案

```
quicksort(L, R):
  while L < R:
    pivot = median3(a[L], a[(L+R)/2], a[R])   # 中位数换到 L 后取 a[L]
    [lt, gt] = threeWayPartition(a, L, R, pivot)
    # a[L..lt-1] < pivot == a[lt..gt] < a[gt+1..R]
    if lt-L < R-gt: quicksort(L, lt-1); L = gt+1   # 先递归小的, 大的进循环
    else:           quicksort(gt+1, R); R = lt-1   # (尾递归消除, 栈 O(log n))
```

等于 pivot 的整段直接**排除在递归之外**, 重复度越高越快; 全部相同时一遍扫描结束, 总复杂度 $O(n)$。

> [!NOTE]
> 工业实现的共同套路 = **三数取中（大数组九数取中）防有序输入 + 三路防重复 + 小数组转插入排序 + 深度超限转堆排**。每一层都在堵一种退化, 缺一层就有对抗样本打穿你。

### 3.4 三种分区对比

| 维度 | Lomuto | Hoare | 三路 |
|------|--------|-------|------|
| 扫描方向 | 单向 | 双向 | 双向 |
| 平均交换次数 | $\approx n/2$ | $\approx n/6$ | 更少（重复越多越少） |
| 全等元素 | $O(n^2)$ | $O(n \log n)$ | $O(n)$ |
| pivot 最终位 | 是 | 不一定 | 等值带整体确定 |
| 递归边界 | `(lo,i-1),(i+1,hi)` | `(lo,j),(j+1,hi)` | `(lo,lt-1),(gt+1,hi)` |
| 适用 | 教学 / 短代码 | 通用默认 | 重复键多的数据 |

## 四、堆排: 最坏有保障, 但只配当兜底

```
siftDown(a, i, n):              # 下沉: 与较大的孩子比, 直到不违反堆序
  while 2i+1 < n:
    c = 2i+1; if a[c+1] > a[c]: c++
    if a[i] >= a[c]: break
    swap(a[i], a[c]); i = c

buildHeap:  for i = n/2-1 downto 0: siftDown(i, n)     # 自底向上, O(n)!
sort:       for end = n-1 downto 1: swap(a[0], a[end]); siftDown(0, end)
```

**为什么 buildHeap 是 $O(n)$**: 高度为 $h$ 的节点至多 $\lceil n/2^{h+1}\rceil$ 个, 每个下沉代价 $\le h$, 求和

$$\sum_{h=0}^{\lfloor \log n\rfloor} \frac{n}{2^{h+1}} \cdot h \;\le\; n \sum_{h\ge 0} \frac{h}{2^{h+1}} \;=\; 2n$$

**为什么不配当主力**: 每次 `siftDown` 在堆的相邻层之间跳（下标 $i \to 2i$, 物理距离指数增长）, 缓存命中率远低于归并的顺序访问; 所以它是 introsort / pdqsort 的"最坏情况保险丝", 而不是日常路径。见 [heap.md](../structures/trees/heap.md)。

## 五、归并: 稳定与外排序的地基

- **自顶向下**递归分半, 或**自底向上**按 width = 1, 2, 4, ... 两两合并（免递归栈）;
- 合并时**左边相等优先** → 稳定性由此而来;
- 一个共享缓冲区反复使用, 空间 $O(n)$; 顺序访问 → cache 友好;
- **自然归并**（先扫出已有序的 run 再合并）是 Timsort 的直系祖先;
- **外排序**：数据远大于内存时, 分块排序落盘, 再做 k 路合并（败者树 / 堆, k 可达数百）。**MapReduce 的 shuffle sort phase 本质就是这个**。

> [!TIP]
> 口诀: **"快排求快, 归并求稳, 堆排求保底, 线性求特例。"**

## 六、绕过比较下界: 计数 / 基数 / 桶

| 算法 | 前提 | 复杂度 | 空间 | 稳定? |
|------|------|--------|------|-------|
| 计数排序 | 值域 $[0,k]$ 小 | $O(n+k)$ | $O(k)$ | ✅（逆序回填实现） |
| 基数 LSD | 定长 $d$ 位、基 $b$ | $O(d(n+b))$ | $O(n+b)$ | ✅（每一位必须稳定） |
| 基数 MSD | 字符串 / 变长键 | 同上, 常更早停 | 同上 | 递归桶内自然处理 |
| 桶排序 | 键近似均匀分布 | 期望 $O(n)$, 最坏 $O(n^2)$ | $O(n)$ | 取决于桶内排序 |

三个要点：

1. **计数排序的前缀和就是名次表**：`cnt[x]` 累计后表示"≤ x 的元素个数", 逆序回填保证稳定;
2. **基数排序每一位都必须用稳定排序**（通常就是计数排序）——低位排好的相对次序要在高位相同的时候保留下来;
3. **基数的最优选择**: $d = \lceil \log_b W \rceil$ 趟, 总代价 $O\big(\frac{W}{\log b}(n+b)\big)$, 取 $b \approx n$ 得 $O(nW/\log n)$——这是"字 RAM 模型下整数排序能突破 $n\log n$"说法的来源。负数要先平移或翻转符号位。

## 七、稳定性矩阵

| 算法 | 平均 | 最坏 | 额外空间 | 稳定 | 一句话点评 |
|------|------|------|----------|------|-----------|
| 插入 | $O(n^2)$ | $O(n^2)$ | $O(1)$ | ✅ | 近乎有序时 $O(n)$, 所有工业排序的小数组底层 |
| 冒泡 | $O(n^2)$ | $O(n^2)$ | $O(1)$ | ✅ | 教学用 |
| 选择 | $O(n^2)$ | $O(n^2)$ | $O(1)$ | ❌ | 远距离 swap 破坏稳定 |
| 希尔 | $\sim O(n^{1.3})$ | 依增量序列 | $O(1)$ | ❌ | Ciura 序列实测很强 |
| 归并 | $O(n\log n)$ | $O(n\log n)$ | $O(n)$ | ✅ | 稳定需求的默认答案 |
| Timsort | $O(n)$ 最好 | $O(n\log n)$ | $O(n)$ | ✅ | 真实世界数据的王者 |
| 快速 | $O(n\log n)$ | $O(n^2)$（未加固） | $O(\log n)$ 栈 | ❌ | 平均最快的原地排序 |
| 三路快排 | $O(n\log n)$ | $O(n\log n)$ | $O(\log n)$ 栈 | ❌ | 重复键场景最优 |
| 堆排 | $O(n\log n)$ | $O(n\log n)$ | $O(1)$ | ❌ | 最坏保证 + 最省空间, cache 差 |
| Introsort / pdqsort | $O(n\log n)$ | $O(n\log n)$ | $O(\log n)$ | ❌ | C++ / Go 的工业答案 |
| 计数 / 基数 | 线性 | 线性 | $O(n+k)$ | ✅ | 值域 / 定长键专属 |

## 八、工业实现: 它们在防什么

### 8.1 C++ `std::sort` = Introsort (libstdc++ 骨架)

```
depth_limit = 2 * log2(n)
introsort_loop(lo, hi, limit):
  while hi - lo > 16:                      # 小于阈值留给收尾的插入排序
    if limit-- == 0: heap_sort(lo, hi)     # 深度耗尽 → 堆排接管, 最坏 O(n log n)
    cut = partition(median_of_3)           # 三数取中防有序输入
    introsort_loop(cut, hi, limit)         # 递归一半
    hi = cut                               # 另一半进循环 (尾递归消除)
final_insertion_sort(lo, hi)               # 整体几乎有序, 收尾近 O(n)
```

`std::stable_sort` 则是归并: 内存够就用缓冲区合并, 分配失败退化为就地旋转合并。

### 8.2 Go `sort` / `slices` = pdqsort (Go 1.19+)

pdqsort (pattern-defeating quicksort) 在 introsort 的基础上加了两层"模式识别":

1. **best case $O(n)$**: 检测到近乎有序时, 用受限次数的插入排序直接收尾, 不再递归;
2. **break patterns (熵减)**: 发现连续两次分区都不平衡时, 说明 pivot 策略被输入的模式针对了——随机抽元素换进 pivot 位置、并打散部分数据, 让对抗样本失效;
3. 其余同 introsort: 小数组（阈值 ~12）插入排序、深度上限 $\log_2 n$、超限堆排兜底、重复元素切三路。

结果: 最好 $O(n)$、平均 $O(n\log n)$、**最坏也有 $O(n\log n)$**, 不稳定、无额外内存。Go 的 `sort.Sort` / `sort.Slice` / `slices.Sort` 都是它; `sort.SliceStable` 用的是插入 + SymMerge 的稳定归并。

### 8.3 其它语言的答案（各有理由）

- **Python `sorted` / Java 对象排序 = Timsort**: 抓真实数据里天然有序的 run（`minrun` 32-64）, 合并时维持栈不变量并用 galloping 加速; 最好 $O(n)$（已序 / 逆序输入）; CPython 3.11 起合并策略升级为 powersort;
- **Java `Arrays.sort(int[])` = 双轴快排**: 原始类型没有稳定性诉求, 双 pivot 减少数据趟数、对 cache 更友好;
- **Rust**: 1.81 前不稳定排序就是 pdqsort, 之后换成同门的 ipnsort / 稳定 driftsort, 思路一脉相承。

> [!NOTE]
> 这些选择的共同逻辑: **语言标准库不知道你的数据长什么样**, 所以必须同时押注"平均快"（快排系）和"最坏不崩"（堆排兜底）; 而 Python/Java 面向的对象排序更常遇到"部分有序的真实数据", 所以押注 Timsort。

## 九、多语言实现

### Python: 三路快排 + 计数 + 基数

```python
def three_way_partition(a, lo, hi):
    """返回 (lt, gt): a[lo:lt] < p == a[lt:gt+1] < a[gt+1:hi+1]。O(hi-lo)。"""
    pivot = a[(lo + hi) // 2]
    i, lt, gt = lo, lo, hi
    while i <= gt:
        if a[i] < pivot:
            a[i], a[lt] = a[lt], a[i]; lt += 1; i += 1
        elif a[i] > pivot:
            a[i], a[gt] = a[gt], a[i]; gt -= 1   # i 不动: 换过来的还没看过
        else:
            i += 1
    return lt, gt


def quicksort(a, lo=0, hi=None):
    """三路 + 中位数三取 + 尾递归消除。平均 O(n log n), 栈 O(log n), 就地, 不稳定。"""
    if hi is None:
        hi = len(a) - 1
    while lo < hi:
        lt, gt = three_way_partition(a, lo, hi)
        if lt - lo < hi - gt:                    # 先递归较小的那一半
            quicksort(a, lo, lt - 1); lo = gt + 1
        else:
            quicksort(a, gt + 1, hi); hi = lt - 1
    return a


def counting_sort(a):
    """值域非负整数。O(n+k) 时间 / O(k) 空间, 稳定。k = max(a)。"""
    if not a:
        return a
    k = max(a)
    cnt = [0] * (k + 1)
    for x in a:
        cnt[x] += 1
    for i in range(1, k + 1):
        cnt[i] += cnt[i - 1]                     # 前缀和 => "≤ i 的名次"
    out = [0] * len(a)
    for x in reversed(a):                        # 逆序回填 => 稳定
        cnt[x] -= 1
        out[cnt[x]] = x
    return out


def lsd_radix_sort(a, bits_per_digit=8):
    """非负整数。O(d(n+b)), d=字长/8, b=256。每一位都是稳定计数排序。"""
    if not a:
        return a
    mask, shift = (1 << bits_per_digit) - 1, 0
    buf = list(a)
    while max(buf) >> shift > 0:
        cnt = [0] * (mask + 2)
        for x in buf:
            cnt[(x >> shift) & mask] += 1
        for i in range(1, mask + 2):
            cnt[i] += cnt[i - 1]
        nxt = [0] * len(buf)
        for x in reversed(buf):
            d = (x >> shift) & mask
            cnt[d] -= 1
            nxt[cnt[d]] = x
        buf = nxt
        shift += bits_per_digit
    return buf
```

### Go: 堆排 + 归并 + 简化版 pdqsort

```go
package main

import (
	"fmt"
	"math/bits"
)

func insertionSort(a []int, lo, hi int) { // 闭区间; 小数组之王
	for i := lo + 1; i <= hi; i++ {
		for j := i; j > lo && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

func heapSortRange(a []int, lo, hi int) { // 闭区间; introsort/pdqsort 的兜底
	n := hi - lo + 1
	var sift func(root, size int)
	sift = func(root, size int) {
		for {
			c := 2*root + 1
			if c >= size {
				return
			}
			if r := c + 1; r < size && a[lo+r] > a[lo+c] {
				c = r
			}
			if a[lo+root] >= a[lo+c] {
				return
			}
			a[lo+root], a[lo+c] = a[lo+c], a[lo+root]
			root = c
		}
	}
	for i := n/2 - 1; i >= 0; i-- {
		sift(i, n) // 自底向上建堆: O(n)
	}
	for end := n - 1; end > 0; end-- {
		a[lo], a[lo+end] = a[lo+end], a[lo]
		sift(0, end)
	}
}

// MergeSort: 稳定, 最坏 O(n log n), O(n) 缓冲; 顺序访问, 外排序的内核
func MergeSort(a []int) {
	n := len(a)
	buf := make([]int, n)
	merge := func(lo, mid, hi int) {
		i, j, k := lo, mid, lo
		for ; i < mid && j < hi; k++ {
			if a[j] < a[i] { // 相等取左 => 稳定
				buf[k] = a[j]
				j++
			} else {
				buf[k] = a[i]
				i++
			}
		}
		for ; i < mid; i, k = i+1, k+1 {
			buf[k] = a[i]
		}
		for ; j < hi; j, k = j+1, k+1 {
			buf[k] = a[j]
		}
		copy(a[lo:hi], buf[lo:hi])
	}
	for w := 1; w < n; w *= 2 {
		for lo := 0; lo+w < n; lo += 2 * w {
			hi := lo + 2*w
			if hi > n {
				hi = n
			}
			merge(lo, lo+w, hi)
		}
	}
}

// medianToLo: 三数取中并把中位数换到 lo —— pivot 停在 lo 是 Hoare 扫描不越界的锚点
func medianToLo(a []int, lo, hi int) {
	mid := lo + (hi-lo)/2
	if a[mid] < a[lo] {
		a[mid], a[lo] = a[lo], a[mid]
	}
	if a[hi] < a[mid] {
		a[hi], a[mid] = a[mid], a[hi]
	}
	if a[mid] < a[lo] {
		a[mid], a[lo] = a[lo], a[mid]
	}
}

// hoarePartition: 返回 j, a[lo..j] <= pivot <= a[j+1..hi]; 递归边界是 (lo,j)/(j+1,hi)
func hoarePartition(a []int, lo, hi int) int {
	pivot := a[lo]
	i, j := lo-1, hi+1
	for {
		for i++; a[i] < pivot; i++ {
		}
		for j--; a[j] > pivot; j-- {
		}
		if i >= j {
			return j
		}
		a[i], a[j] = a[j], a[i]
	}
}

// pdqsort 骨架: 完整版还含 breakPatterns(对抗输入熵减)、重复元素三路、近乎有序提前退出
func pdqsort(a []int, lo, hi, limit int) {
	for hi-lo > 12 { // 小于阈值交给插入排序
		if limit == 0 { // 深度耗尽 -> 堆排兜底, 保证最坏 O(n log n)
			heapSortRange(a, lo, hi)
			return
		}
		limit--
		medianToLo(a, lo, hi)
		m := hoarePartition(a, lo, hi)
		if m-lo < hi-m {
			pdqsort(a, lo, m, limit) // 只递归较小的一半
			lo = m + 1               // 较大的一半留在循环里: 栈深 O(log n)
		} else {
			pdqsort(a, m+1, hi, limit)
			hi = m
		}
	}
	insertionSort(a, lo, hi)
}

// PdqSort: 最好 O(n) / 平均 O(n log n) / 最坏 O(n log n), 不稳定
func PdqSort(a []int) {
	pdqsort(a, 0, len(a)-1, bits.Len(uint(len(a))))
}

func main() {
	a := []int{5, 2, 9, 1, 5, 6, 0, 3, 8, 7, 4, 2, 6}
	PdqSort(a)
	fmt.Println(a) // [0 1 2 2 3 4 5 5 6 6 7 8 9]

	b := []int{3, 1, 4, 1, 5, 9, 2, 6}
	MergeSort(b)
	fmt.Println(b) // [1 1 2 3 4 5 6 9]
}
```

### C++: introsort 骨架（示意, 非 drop-in）

```cpp
#include <cmath>

constexpr int kThreshold = 16;

void introsortLoop(int* lo, int* hi, int limit) {
    while (hi - lo > kThreshold) {
        if (limit-- == 0) { heapSort(lo, hi); return; }   // 兜底
        int* cut = unguardedPartition(
            lo + 1, hi,
            medianOf3(*lo, *(lo + (hi - lo) / 2), *(hi - 1)));
        introsortLoop(cut, hi, limit);   // 递归右半
        hi = cut;                        // 左半进循环
    }
}

void sortImpl(int* lo, int* hi) {
    introsortLoop(lo, hi, 2 * int(std::log2(double(hi - lo))));
    finalInsertionSort(lo, hi);          // 收尾: 此时几乎有序, 近 O(n)
}
```

## 十、工程现实速览

- Python 默认 `sorted` = Timsort（稳定, 对部分有序数据近乎线性）;
- Go `sort.Slice` / `slices.Sort` = pdqsort（不稳定, 最坏有保证）; 要稳定显式用 `sort.SliceStable`;
- C++ `std::sort` = introsort（不稳定）; 要稳定用 `std::stable_sort`;
- Java 对象 = TimSort, 原始类型数组 = 双轴快排;
- 业务排序需要二级键时, 要么写复合比较器, 要么"先按次键稳定排、再按主键稳定排"（两次稳定排序）。

> [!WARNING]
> C++ 里比较器写成 `a <= b`（违反严格弱序）是**未定义行为**, 可能越界崩溃; Go 会 panic。比较器必须是严格的 `<` 语义: 相等时返回 false。另外中点计算用 `lo + (hi-lo)/2` 防 `(lo+hi)` 溢出——32 位下百万级下标就可能踩雷。

## 十一、易错清单

1. **Hoare 的递归边界写成 `(lo, j-1)`**: 正确是 `(lo, j)` 和 `(j+1, hi)`——pivot 不一定在最终位, 写错会丢元素或死循环;
2. **Lomuto 遇全等元素 $O(n^2)$**: 重复键多的数据必须三路;
3. **buildHeap 误以为 $O(n\log n)$**: 自顶向下逐个插入才是 $O(n\log n)$, 自底向上下沉是 $O(n)$;
4. **计数排序忘了逆序回填**: 前缀和名次表配正序回填会把稳定性丢掉, 连累基数排序一起错;
5. **基数排序处理负数**: 直接移位会把符号位当数值, 先平移或翻转符号位;
6. **拿堆排当主力**: 它赢在最坏情况和空间, 输在 cache; 大数据量顺序访问的归并系反而更快;
7. **Top-K 问题用全排序**: 只要前 k 个用快速选择（平均 $O(n)$）或大小为 k 的堆（$O(n\log k)$）, 别全排。

## 十二、经典题

- LC 912 排序数组（手写快排 / 归并的试金石, 卡常必练）;
- LC 215 数组中第 K 大（快速选择平均 $O(n)$; 进阶: 中位数的中位数 $O(n)$ 最坏保证）;
- LC 75 颜色分类（荷兰国旗, 三路分区裸题）;
- LC 23 合并 K 个升序链表（k 路归并 + 小根堆）;
- LC 315 计算右侧小于当前元素的个数（归并排序副产物 / 树状数组）;
- LC 164 最大间距（鸽笼 + 桶, 要求线性时间）;
- LC 179 最大数（自定义比较器 `a+b > b+a`, 注意严格弱序）;
- LC 56 合并区间（排序后线性扫描）。

## 一页速查

```
下界:   比较排序 Ω(n log n); 计数/基数/桶靠键结构绕过
分区:   Lomuto 好写换得多 | Hoare 换少 3 倍, 边界 (lo,j)/(j+1,hi) | 三路治重复
堆排:   buildHeap O(n); 最坏 O(n log n) + O(1) 空间; cache 差 → 只当兜底
归并:   稳定的来源; 顺序访问 → 外排序 / k 路合并的内核
线性:   计数 O(n+k) 前缀和逆序回填 | 基数 O(d(n+b)) 每位必须稳定 | 桶看分布
工业:   introsort(C++) / pdqsort(Go): 取中+插入+深度限制堆排兜底(+熵减)
        Timsort(Python/Java 对象): 抓天然 run, 最好 O(n)
坑:     Hoare 边界 | 全等元素 | 严格弱序比较器 | (lo+hi)/2 溢出 | 负数基数
```

下一篇: [搜索: 二分与三分](searching.md)。
