# 栈与队列

## 一句话

栈和队列不是数据结构——它们是**两种思维工具**:一种是「**我能撤回的**」（DFS、调用栈、撤销），一种是「**我要按序的**」（BFS、调度、流水线）。具体用什么底层实现（数组、链表、ring buffer）是 SECONDARY 的选择，但**思维模型一旦匹配错，代码再漂亮也错**.

## 栈的五种典型用法

### 1. 括号匹配 / 表达式求值

最直接的栈用法：进栈遇 `)` 反弹。

### 2. DFS

递归本质 = 系统栈。深搜大图改迭代版必出"显式栈"，这步也是后文石墨遍历图论的直接半步。

### 3. 撤销撤销栈

文本编辑器、数据库 undo log、git reflog 都是栈。每次操作 push 一份 inverse op，撤销就 pop.

### 4. 单调栈（monotonic stack）

**最难、最经常被忽略的一种栈**. 求每个元素的「右边第一个更大元素」：

```python
def next_greater(arr):
    stack = []          # 严格递减
    res  = [-1] * len(arr)
    for i, x in enumerate(arr):
        while stack and arr[stack[-1]] < x:
            res[stack.pop()] = i
        stack.append(i)
    return res
```

O(n)：每个元素入栈、出栈各一次。

为什么这个模板在哪里反复出现？因为**未来时刻一旦看到更大的新元素就立马让旧元素失能**，符合这种处理类型的题（"右边第一个更大 / 更小 / 上一个更优 / 比我小但更早"）全部可以套单调栈. 柱状图最大矩形、接雨水、Daily Temperature、最小子序列统统其变体.

### 5. 调用栈本身

所有递归都可以机械化为带显式栈的迭代.

## 队列的三种现实形态

### 1. FIFO 队列

调度、BFS。但有一个**关键不变量**：BFS 保证第一次到达某点的距离是最短路跳数。这是 BFS 第一个被记住的"模型性质"——很多算法要靠它.

### 2. 双端队列（Deque）

- 工作窃取队列（work-stealing）：fork-join 框架底;
- 滑窗最大值（sub-window max）;
- 缓冲区切片切分（操作系统 page cache LRU 实现）.

### 3. Ring buffer

环形数组，固定容量，O(1) 入队出队、零分配。生产者-消费者杀手锏.

## 环状缓冲：把它写到硬件层

朴素实现（带 count 字段）：

```c
typedef struct { int buf[N]; int head, tail, size; } Ring;

int push(Ring *r, int x) {
    if (r->size == N) return -1;
    r->buf[r->tail] = x;
    r->tail = (r->tail + 1) % N;
    r->size++;
    return 0;
}
int pop(Ring *r) {
    if (r->size == 0) return -1;
    int x = r->buf[r->head];
    r->head = (r->head + 1) % N;
    r->size--;
    return x;
}
```

但 **lock-free ring** 通常使用**一个 slot 浪费**的版本：

```c
typedef struct { int buf[N]; int head, tail; } RingLF;
bool isEmpty(RingLF *r) { return r->head == r->tail; }
bool isFull (RingLF *r) { return (r->tail+1) % N == r->head; }
```

为什么这个版本更受欢迎？因为**没有共享变量 size** ——多线程下，`size++` 和 `--` 需要 atomic CAS 或锁，而"读 head/tail" 与"读自己控制的 idx"只在各自一侧，**生产者只改 tail，消费者只改 head**，跨线程的读取就是 atomic load，写就是 atomic store. 这种特性让生产者 / 消费者天然可以独立推进，**对应到内存屏障使用也少**.

### FPGA 视角下的 ring buffer

在 FPGA 上 ring buffer 用 **BRAM** 实现，head/tail 是寄存器，buf 读写是同步访问位宽任选. 没有锁，写读可同时身后者 ⇒ 单 cycle 同时入队/出队. 旯 FPGA 上的端云存储、雷达信号处理、网络数据包 buffer 都是这一模式.

这就是「软件 lock-free ring」与「FPGA 数据缓存」在抽象层是**同一种东西**.

## 双端队列 + 滑窗最大值

```python
from collections import deque
def maxs(a, k):
    dq, res = deque(), []
    for i, x in enumerate(a):
        while dq and a[dq[-1]] <= x: dq.pop()
        dq.append(i)
        if dq[0] == i - k: dq.popleft()
        if i >= k - 1: res.append(a[dq[0]])
    return res
```

思路有 "战阶" 意味：维持单调递减索引序列，每次入窗让"过时"的一端被弹掉。**指针不需要扔掉**：所有"新值一进来，比它小的旧值就再不可能成为答案"。

在硬件层中，类似的"递减 FIFO" 是 DSP 中的 median 滤波器：

- 雷达信号处理时把滑动窗作为 SP 阶户;
- 视频流的滑动剔除（live video late frame drop 比当前更好用一个关于同等非线性中位数脉冲 tvHD filter）.

单调队列、median filter、Sliding Window Aggregator 全部是同一抽象.

## 实现选型

栈/队列可以用动态数组实现，也可以用链表。**99% 时候应该用数组/deque**：

| 类型 | 推荐 |
|------|------|
| `std::stack` / `std::queue` | 默认是 `std::deque`，正确选择 |
| Go | 自己循环数组或用 `container/list` 通用版 |
| Java | `ArrayDeque` 优于 `LinkedList`（已 by JDK 文档警示）|
| Python | `list` 作栈；`deque` 作队列 / 双端 |
| TS | `Array<T>` 作栈；自实现 ring 当队列（性能敏感） |

## 多线程下的 popping 易错点

```cpp
// 朴素栈不能并发 pop
T pop() { 
    if (stack.empty()) return {};   // 数据竞争
    T x = stack.top(); stack.pop();  // 这俩没原子性
    return x; 
}
```

写入/弹出之间有 TOCTOU 窗口——两个线程都能进 if 通过判断，但其中一个 pop 后另一个 top 会未定义行为.

无锁栈可用 Treiber Stack: `compare_exchange` 在 `head` 上.

```cpp
bool push(T x) {
    Node* n = new Node{std::move(x), head.load()};
    while (!head.compare_exchange_weak(n->next, n));
    return true;
}
bool pop(T& out) {
    Node* n;
    while ((n = head.load()) && !head.compare_exchange_weak(n, n->next));
    if (!n) return false;
    out = std::move(n->val);
    delete n;  // 实际有 ABA 隐患，需 hazard pointer 或 epoch reclamation
    return true;
}
```

ABA 问题：A 出栈后被释放内存正好被分配给新节点 C，head 又被重新设回 C 的地址 ⇒ `compare_exchange` 通过了——实际栈头变了，发生丢节点. 解决：

- Tagged pointer （ptr + counter 在 16 字节 CAS）;
- Hazard pointer / epoch-based reclamation;
- 退回 mutex 加锁.

这就是 lock-free 队列设计如此困难的原因——**真问题是 memory reclamation 而不是数据结构本身**.

## 易错清单

1. 递归爆栈：Python 默认 1000，必要时 `sys.setrecursionlimit` 或改迭代；
2. DFS 用 stack 模拟递归时忘"返回点"，要自己显式管理 frame；
3. ring buffer 的「empty vs full」——两种判断都有人用，**选一种，全局只一种** ；
4. 单调栈严格性：相邻相等元素是否要弹完全决定语义，务必想清题意；
5. lock-free 缺 ABA fix：不写就别上生产。

## 经典题

- LC 155 最小栈：双栈 / 单栈 + 差值；
- LC 739 Daily Temperatures：单调栈；
- LC 84 Largest Rectangle in Histogram：单调栈母题；
- LC 239 Sliding Window Maximum：单调 deque；
- LC 32 Longest Valid Parentheses：栈 + 索引 merge；
- LC 224 / 227 Calculator：典型 mark-二元运算 / token 解析栈。

## 这一章带走的东西

- 栈/队列的本质是思维模型: 撤回 vs 排序;
- ring buffer 是软硬通用的同构模型，软件看 cuda / numba lock-free，硬件看 BRAM;
- 单调栈 = 把"未来发生即失能"统一化的工具;
- lock-free 不实现 ABA guard 在工程上不是 lock-free.

下一节 → [哈希表：从原理到工程](hash-table.md)
