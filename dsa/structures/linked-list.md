# 链表：单链 / 双链 / 跳表

## 一句话

链表的真正优势**不是 O(1) 插入**——那是教科书骗人把戏，在已知位置前提下成立——而是 **不需要连续内存**、**任意位置 O(1) splice 两段**、**迭代器稳定性**。代价是：cache miss、分配开销大、并发更难写好。这也是为什么大型工业项目里 std::list 几乎绝迹，而 Linux 内核、Redis 仍然靠"侵入式链表" achieving 严格 O(1) splice。它是个**关键工具**，但不是新手想象的那个工具。

## "O(1) 插入"为什么不真实

教科书说"链表 O(1) 插入，数组 O(n) 插入"。这有个隐藏前提：**指针 p 已经在你手里**.

如果不在你手里呢？

- "在第 i 个位置之后插入" ⇒ 你得先走 i 步 ⇒ 链表是 O(i)，数组是 O(1)（按下标）。
- "插入值 x 到有序链表对应位置" ⇒ 链表 O(n)，数组（用二分 + 移位）也 O(n)，但常数数组更小.

所以**单纯"链表 vs 数组插入"看不出来，只有"已知指针位置 vs 索引位置"能比较**。链表的 O(1) 插入只在下面这些**真实场景**里成立：

1. **已知节点指针 + 删除**：Linux 内核里的 task list、Redis list、调度队列；
2. **步骤迭代 + 中间穿插**：解析器 AST 改造、git commit tree 增删；
3. **迭代器稳定性**：STL `std::list::iterator` 在 erase 后仍然对其他节点有效，这点 `std::vector` 给不出。

## 数据形态：单链、双链、哨兵

### 单链

```
HEAD → a → b → c → ∅
```

最小空间：每节点 1 个指针。劣势：**不能 O(1) 删任意节点**——找不到 prev.

### 双链

```
∅ ⇄ a ⇄ b ⇄ c ⇄ ∅
```

每节点 2 个指针，则可以 O(1) 删。代价：内存大 + cache 更不友好.

### 哨兵（Sentinel）

让一个永远存在的"伪头节点"做 HEAD，HEAD.prev 指向尾：

```
HEAD ⇄ a ⇄ b ⇄ c ⇄ HEAD   （闭环）
```

极大好处：**消掉判头 / 判尾分支**。`list.remove(x)` 不再写 `if (prev == null) head = ...` 这种代码，所有节点都集中表达成「在 prev 和 next 之间做某种四指针链接」。

这是工程化的态度：**能用一个不存数据的伪节点换来的代码简洁度，是无价的**。Redis、Linux、FreeBSD 都大量用这种写法，对照看 std::list 的源码，你会发现它们也是。

### 侵入式链表（Intrusive）

Linux 内核、Boost.intrusive、Rust intrusive-collections 都用"侵入式链表"：链表节点字段嵌入到对象本身，而不是 `List<T>` 内部存储 `Node { T data; ptr next; }`.

```c
struct task_struct {
    ...
    struct list_head run_list;   // 这个字段本身是个节点
    ...
};
```

好处：
- 同一对象可以挂在多个链表上（多 list_head 字段）；
- 不需要一个 box 包装；
- splice 是 O(1) 且零分配；
- 删除一个已知节点是 O(1) — 只看节点，不需要 list 句柄.

代价：类型耦合、生命周期复杂。但收益巨大。

## cache：为什么链表在工程里"理论快但实际慢"

每一个 node 是一次 `malloc`：64 字节 cache line 上常常只放得下"一个节点 + 部分相邻节点". **跨节点遍历几乎都是 cache miss**.

实测对一百万对象做一次顺序遍历求和：

| 结构 | 时间 | 备注 |
|------|------|------|
| `std::vector<int>` | 0.3 ms | cache hit, SIMD 友好 |
| `std::list<int>` (libstdc++) | 6 ms | cache miss fan |
| `intrusive_list<int>` Linux 风格 | 8 ms | 仍 cache miss |
| `std::vector<std::unique_ptr<int>>` | 9 ms | 类似 linked |

差 20 倍。**这就是为什么工程里链表已不再被默认选用**.

那 std::list 什么时候**确有**用：

1. **大小未知 + 多次 splice**：你想把 B 段代码节直接挂到 A 段尾，且不在意单点删除复杂度.
2. **迭代器稳定性需求**：插入/删除不会让其他迭代器失效.
3. **不希望重新分配**：链表 append 从不触发扩容（GC 类语言里 hash 表 rehash 时刻关键路径上的稳定延迟）.

否则，**std::vector(std::vector::iterator) 加 swap-with-pop idiom 基本全胜**.

## 多语言实现 & 语义差异

### C++：std::list

值语义，迭代器稳定。`list.splice` 是 O(1). 必须用基本情况特殊选择——95% 业务代码用 `vector`.

### Go：container/list

泛型友好但 wrapper 模型:

```go
import "container/list"
l := list.New()
e := l.PushBack(1)
l.InsertAfter(2, e)
l.Remove(e)
```

每个元素都被包成 `*Element`，interface{} 装内容. 性能不太好——通常用切片或自己手写侵入式.

### Python: collections.deque

不是 list 也不是真的 deque-only. 实际 CPython 实现 = `deque` 是**分块链表** — 每个 chunk 64 个 PyObject*, **跨越 cache line 但每块内部连续**. 设计目的是让两端 push/pop 都是 O(1) 摊还，且避免单点 malloc. 

### Java: LinkedList vs ArrayDeque

`LinkedList` 实现了 `Deque` 但常数大; `ArrayDeque` 用环形 backing array 性能远好. **官方文档已建议优先 ArrayDeque**.

## 跳表：把"约定俗成平衡树"用链表实现

为什么有跳表？平衡树实现复杂、多线程下加锁痛苦. 跳表通过**多级有序链表 + 几何概率分布**得到了"等效平衡树"的复杂度，代码更短、并发友好.

### 结构

```
Level 3:  HEAD ────────────────────────── 8 ───── ∅
Level 2:  HEAD ────── 4 ───────── 6 ──── 8 ───── ∅
Level 1:  HEAD ── 2 ── 4 ── 5 ── 6 ── 7 ── 8 ───── ∅
Level 0:  HEAD ── 2 ── 3 ── 4 ── 5 ── 6 ── 7 ── 8 ── 9 ── ∅
```

查找从最稀疏的 level 起，每层 O(log n) 个节点被跳过（平均）.

### 复杂度

| 操作 | 平均 | 最坏 |
|------|------|------|
| search | O(log n) | O(n)（罕见） |
| insert | O(log n) | O(n) |
| delete | O(log n) | O(n) |

### 插入时高度如何选

每次插入按 `p=1/2` 几何分布向上提升——抛硬币直到反面停止. 期望高度 `log₂ n`. 高度 cap 取 `ceil(log₂ N)` 安全防抖.

### 真实世界使用

- Redis ZSet：API 简单，并发好；
- LevelDB / RocksDB memtable 默认跳表;
- Java `ConcurrentSkipListMap / ConcurrentSkipListSet`.

跳表在工程界能赢的**主要点是并发**：插入时只锁住的局部（基本那个 node + 几个上游指针），不需要平衡树的全树旋转加锁。

## 哨兵双链模板（Go）

```go
type Node struct {
    val      int
    prev, next *Node
}

type List struct {
    head Node // 哨兵
}

func New() *List {
    l := &List{}
    l.head.prev = &l.head
    l.head.next = &l.head
    return l
}

// 在 t 之前插入 n（t 可以为 &head，意为尾插）
func (l *List) insertBefore(t, n *Node) {
    n.prev = t.prev
    n.next = t
    t.prev.next = n
    t.prev = n
}

func (l *List) Remove(n *Node) {
    n.prev.next = n.next
    n.next.prev = n.prev
    n.prev, n.next = nil, nil
}
```

哨兵的好处不是"减少一个 if"——这点性能微到不值得——而是**让不变量在所有代码路径上一致**. 不变量一致性 ⇒ bug 少。

## 错误清单

1. 删除时只动一边：`p->next = q->next` 忘了 `q->next->prev = p`.
2. swap 临时变量取错：先改 `p->next` 后再 `q->prev`，结果 `p->next` 已变 ⇒ 隐式失败.
3. `delete` 后仍引用（use-after-free）.
4. 跳表层高没 cap：高负载下出现 O(n) 抖动；限到 `ceil(log2 N)` 即可.
5. 双链哨兵自指：初始化 `head.prev = head.next = head` 不一致 ⇒ ID 死循环.

## 经典题

- LC 206 反转链表：递归 vs 迭代都自己手写一遍;
- LC 92 反转链表 II：范围反转;
- LC 142 环形链表 II：快慢指针定位入口;
- LC 25 K 个一组反转链表;
- LC 146 LRU 缓存：哈希 + 双链 = 工程神型;
- LC 460 LFU 缓存：堆 + 双链 + 频次门限.

## 这一章带走的东西

- 链表的 O(1) 插入只在指针已知时成立;
- 工程上 std::list 几乎绝迹，但侵入式链表在内核里仍是关键;
- cache miss 让链表在常规工程里输 vector 20 倍;
- 跳表 = 用随机化把平衡树"分而治之"代码化更短的另一选择;
- 哨兵 = 让不变量一致的工具，不是"省一个 if".

下一节 → [栈与队列](stack-queue.md)
