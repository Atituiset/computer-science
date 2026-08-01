# 堆与优先队列

## 一句话

堆是少数同时被理论和工程"普遍接受"的数据结构：**完全二叉树 + 父子关键字序约束 + 用数组表示**. 三个限制合起来让它在 cache 上友好、在常量上小、在 O(log n) 上稳定、在内存上零分配。Heap 的"完全二叉树用数组表示"是工程上**用代数关系代替指针**的最佳教学例子之一。

## 三种限制合一

```
完全二叉树: 除最后一层外全填, 且最后一层从左往右排;
父子关序:     parent.key ≥ child.key (最大堆) 或 parent.key ≤ child.key (最小堆);
数组表示:      层序编号, a[i] 的子是 a[2i+1] / a[2i+2], 父是 a[(i-1)/2].
```

为什么这三种限制合一能给出重大性能优势？

- **完全二叉树** ⇒ 树高恰是 `⌈log₂(n+1)⌉`, **没有退化空间**.
- **父子不严格要求左右子孰大孰小** ⇒ 平衡是最紧的, 增删不触发旋转动作。
- **数组表示** ⇒ cache 友好 + 零指针开销 + 零 node malloc.

## 数组索引公式

```
索引从 0 开始:
  parent(i) = (i - 1) / 2  (整除下取)
  left(i)   = 2·i + 1
  right(i)  = 2·i + 2
索引从 1 开始:
  parent(i) = i / 2
  left(i)   = 2·i
  right(i)  = 2·i + 1
```

1 起点比 0 起点快: `2·i` 是单条左移指令, 而 `2·i+1` / `2·i+2` 仍是单条左移加常量 add. 工程上不少教科书选 1 起点, 这就是原因.

## 基本操作: push / pop / heapify

**sift_up** (push 入堆):

```python
def sift_up(a, i):
    while i > 0 and a[(i-1)//2] < a[i]:
        a[(i-1)//2], a[i] = a[i], a[(i-1)//2]
        i = (i-1)//2
```

**sift_down** (替换根的情形, 用于 pop_max):

```python
def sift_down(a, i, n):
    while True:
        l, r = 2*i+1, 2*i+2
        largest = i
        if l < n and a[l] > a[largest]: largest = l
        if r < n and a[r] > a[largest]: largest = r
        if largest == i: return
        a[i], a[largest] = a[largest], a[i]
        i = largest
```

## heapify 为什么是 O(n), 不是 O(n log n)?

按直觉: heapify 调用 ~n/2 次 sift_down, 每次最坏 O(log n) ⇒ O(n log n).

但代价更精算: 保留下层叶子无需 sift (它们高为 0), **叶子层 sift_down 是 O(0)**, 上层才贵.

```
总代价 = Σ_k (n/2^(k+1)) · k
       = n · (Σ k/2^(k+1))
       = n · 1 = Θ(n)
```

**堆化整个数组 O(n)**. 这是工程里 `container/heap.Init` / `make_heap` 的复杂度. 想快速把一个流变成一个堆时, 直接 Init 比 push 每个元素小 30%.

## 工程变体

| 类型 | 用途 |
|------|------|
| **binary heap** | 默认用途, Dijkstra / Huffman / Top K |
| **d-ary heap** | Dijkstra cache-aware, D = 4 或 8 常用 |
| **Fibonacci heap** | 理论最优, 实操零优势 |
| **Pairing heap** | 实操简洁、平均近最优 |
| **左偏树 / Skew heap** | 可并堆 |
| **索引堆 (Indexed heap)** | Dijkstra 中要 O(log n) 减边 |
| **Brodal queue** | Fibonacci 的可并发实现 |

## 索引堆: Dijkstra 的真正关键

标准堆只能 pop 最小. 但 Dijkstra 中需要对已入堆的节点 **降低距离再下沉**. 要做这一步, 堆必须支持 `decrease_key`:

```
pos[v] = 节点 v 在堆数组里的下标
decrease_key(v, new_dist):
  heap[pos[v]] = new_dist
  sift_up(pos[v])
```

**每 swap 一次就必须同时更新 pos**: `pos[heap[i]] = i`. 否则 Dijkstra 不能在 O(E log V), 而是退化为 O(EV).

## d-ary 堆为什么在 Dijkstra 上更好

四叉堆、八叉堆在实践中比二叉堆更快, 为什么？

- **更浅**: log_d n vs log_2 n, **树高减半-三分之一**;
- **更宽**: 即每次 sift_down 要比 d 个孩子 (而不是 2 个), **常数更大**;
- **cache locality 更好**: 数组的横切面被 cache line 覆盖时, 一个 cache line 同时有 d 个孩子.

**实测**: Dijkstra 在四叉堆上比二叉堆略快; 但 16 叉以上反而退化——因为 d 太大让 sift_down 的 compare 开销超过 cache 收益.

这就是为什么 cpp `boost.heap` 等默认 d = 4 而不是 d = 2.

## Go 的 heap 接口实现

```go
type IntHeap []int
func (h IntHeap) Len() int           { return len(h) }
func (h IntHeap) Less(i, j int) bool { return h[i] < h[j] }
func (h IntHeap) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *IntHeap) Push(x any)        { *h = append(*h, x.(int)) }
func (h *IntHeap) Pop() any {
    n := len(*h); x := (*h)[n-1]
    *h = (*h)[:n-1]
    return x
}
// 调用: heap.Init(&h); heap.Push(&h, 3); heap.Pop(&h)
```

Go 标准库 `container/heap` 完整支持索引堆的写法: 在 Swap 里同时更新 pos[v]. 这是工程中 Dijkstra 类问题最常见的代码骨架.

## 多语言对比

```python
import heapq
h = []
heapq.heappush(h, 1)
heapq.heappop(h)
```

```cpp
#include <queue>
std::priority_queue<int, std::vector<int>, std::greater<int>> h;  // 最小堆
h.push(1); h.top(); h.pop();
// 注意 priority_queue 不支持 erase 任意元素 - 需要自定义 + 墓碑
```

```ts
// TS 没有内置, 自实现:
class Heap<T> { /* ... siftdown, siftup ... */ }
```

## 经典题

- LC 215 Kth Largest (最小堆 vs sort 取小 k);
- LC 347 Top K Frequent;
- LC 295 数据流的中位数: 双堆 - 左最大 + 右最小;
- LC 23 合并 K 个有序链表;
- LC 502 IPO: 贪心 + 堆.

## 软件/硬件视角

- 中位数维护双堆=对 cache line 同时友好: 双 Heap 数组 cache 常驻;
- 堆在 FPGA 上是 streaming-friendly sort: 每 cycle push 一个 / pop 一个 = pipeline pattern;
- 堆在 persistent memory 里要注意: 太多 in-place 改 → 顺序写坏. Google 关注 "consistent heap" 是这个方向.

## 易错

1. **维护 pos[v] 时忘更新**: sift 中 swap 后必须同步更新 `pos[heap[i]] = i`;
2. **d-ary 堆 sift_down 的比较循环搞反**;
3. **continue 条件位置错了**: 堆会退化;

## 这一章带走的东西

- Heap = 完全二叉树 + 父子序 + 数组表示;
- heapify O(n) 不是 O(n log n) - 数学推导;
- 索引堆 = Dijkstra 必备;
- d-ary 在 cache 现实下 ≈ 4 最佳;
- 堆在 FPGA 是 streaming pattern 同构.

下一节 → [字典树与并查集](trie-union.md)
