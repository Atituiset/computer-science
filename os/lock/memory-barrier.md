# 内存模型与 memory barrier

## 一句话

你以为下面这段代码"不可重排" —— **它真的可被重排**：

```c
a = 1;
b = 2;
```

**CPU、编译器、SSD 控制器都有权把它们写成 `b = 2; a = 1;`**，只要在**单线程视角下**看起来一致。这就是语言内存模型："单线程可观察的行为"。要约束它，必须插 memory barrier。这一章把 x86 弱/强内存模型、ARM 弱内存模型、C11 atomic order、Java volatile、Go sync/atomic 的语义都对齐到同一抽象，让你不再把 memory barrier 当玄学。

## 1. 三种 memory 重排来源

```
源码:
    a = 1; b = 2;
编译器:
   - register allocation: 让 a 走 stack 不优先;
   - 优化重组: 看上去单线程行为相同的指令可以乱序.
CPU:
   - store buffer: 写发出 CPU 顺序不一定 = 实际到 cache 顺序;
   - invalidate queue: CPU 收到的 invalidate 可能 wait 一个忙指令才被处理;
cache/NUMA 互连:
   - 多 socket 的 cache 一致性 message 顺序不可控.
```

每跨一层都可能是"reordering source"。所以**多线程下 instruction order 在所有 CPU 上的全局序是不可观察的、不可假设的、不可依赖的**。除非用 memory barrier。

## 2. 经典反例： Peterson's lock 失效

```c
flag[0] = true;  turn = 1;
while (flag[1] && turn == 1) ;
// critical section
flag[0] = false;
```

```c
flag[1] = true;  turn = 0;
while (flag[0] && turn == 0) ;
// critical section
flag[1] = false;
```

单线程看对；多核 CPU 没有逻辑屏障的话，因为 flag[0]=true; turn=1 可能被重排到 turn=1 先 → turn=0 写入了；两个都看到对方 flag=true 但 turn 是自己 → 双双进 critical section，peterson 失败。

**修复**：flag/turn 的写必须配 store-store barrier，turn 的读必须配 load-load barrier。

## 3. x86 内存模型: TSO

TSO = Total Store Order. x86 相对不算太弱：

- Load-Load 不重排 (但 load 可看到 older store);
- Load-Store 不重排；
- Store-Store 不重排 (但是发出 store buffer 可能延迟);
- **Store-Load 可重排** ⇒ 这就是 x86 唯一需要的 barrier。

`mfence` 指令强制 store-load barrier。`lock cmpxchg` 等原子指令本身也强 带 fence 等价的语义。所以 x86 上写 lock-free 算法比 ARM 友好得多。

x86 弱点例子:
```c
a = 1;     // store
r = b;     // load
// 在 x86 上, 可能 r 看到 b 的旧值，但 a 的 store 也可能在 r 完成后才发 cache。
// 因为 store buffer。
```

## 4. ARM 内存模型: weak / RMO

ARM 是弱内存模型——**所有 4 种 reorder 都被允许**：

- Load-Load；
- Load-Store；
- Store-Store；
- Store-Load。

ARM 处理器为了一致性，需要显式 `dmb sy / dmb ish / dmb nsh` (DSB/DMB/ISB) 等屏障。这就是为什么 ARM code 的 lock-free 代码充斥 barrier, 而 x86 几乎不需要.

弱内存模型给硬件设计师更多自由（指令级并行 + cache pipeline 更深），但给软件工程师更难调 - C++ std::atomic 在 ARM 上比 x86 多了几条 `dmb` 指令。

## 5. C11 memory order

C11 atomic 提供一组细粒度语义：

```
memory_order_relaxed    不要求 ordering, 只有 atomic
memory_order_consume    像 acquire 但 dependency chain only (实用不被建议, 一般 compiler downgrades 到 relaxed)
memory_order_acquire    前续 read/write 必须在 load 完后
memory_order_release    后续 read/write 必须在 store 完前
memory_order_acq_rel    acquire + release (compare_exchange 同时)
memory_order_seq_cst    顺序一致, 默认最强
```

常见用法：

```c
// 单生产者单消费者
atomic_store_explicit(&ready, 1, memory_order_release);
while (!atomic_load_explicit(&ready, memory_order_acquire)) ;
// acquire 之后看到的旧 store 都已可见
```

x86 上 release = 普通 store；acquire = 普通 load 加上 compiler barrier (因为 TSO 不重排)；ARM 上 release = `dmb ish st` / acquire = `dmb ish ld`。

## 6. Java volatile / Go sync/atomic

Java volatile 等价 `seq_cst`：写后读可见且跨线程同步顺序一致。JMM 用 happens-before 关系建模。

```java
volatile boolean ready = false;
// thread 1: a = 1; ready = true;
// thread 2: while (!ready); int r = a;  // r 必为 1
```

Go sync/atomic 提供 C11 风格 API：

```go
atomic.StoreInt64(&ready, 1)  // seq_cst 默认
atomic.LoadInt64(&ready)
```

Go 内存模型用 happens-before 关系，channel send / sync.Mutex.Unlock / atomic 都建立 happens-before 边。

## 7. 实战模式: 单生产者单消费者 SPSC queue

SPSC 是 lock-free 最经典模式:

```c
struct SPSC {
    atomic<size_t> head;  // producer writes
    atomic<size_t> tail;  // consumer writes
    T buf[N];
};

void push(T x) {
    size_t h = head.load(memory_order_relaxed);
    size_t t = tail.load(memory_order_acquire);    // 同步 consumer 已消费
    if (h - t == N) return;                         // full
    buf[h % N] = x;
    head.store(h + 1, memory_order_release);        // 同步 consumer 看见 data
}

T pop() {
    size_t t = tail.load(memory_order_relaxed);
    size_t h = head.load(memory_order_acquire);    // 同步 producer 已生产
    if (t == h) return {};                          // empty
    T x = buf[t % N];
    tail.store(t + 1, memory_order_release);        // 同步 producer 看见 data
    return x;
}
```

acquire / release 是"消息传递"的关键:
- producer 用 release store: "我已写好数据 + 你能读";
- consumer 用 acquire load: 我读完你的 head 才能读 buf 中数据.

否则: consumer 看到 head 推进了, 但 buf[i] 仍是旧数据 — 经典 bug.

## 8. ARM 上的实测代价

```c
// ARM Cortex-A76 @2.4 GHz
 acquire load：~ 3 ns (dmb-ish ld)
 release store：~ 5 ns (dmb-ish st)
 seq_cst store + load：~ 10 ns
 没 barrier 包: 1 ns 提议
```

x86 类似 ~ 1-2 ns. ARM 弱内存模型 + cache 让 atomic 操作比 x86 配置更深.

## 9. 调试重排 bug

memory reorder bug 特征:
- 偶尔出现, 不稳定;
-v 单线程 debug 不复现;
- valgrind / helgrind 不一定能抓 (但 tsan 抓 more then);
- 改成 `_acq/order_seq_cst` 后 OK ⇒ 大概率是 reorder.

Google ThreadSanitizer 处理这个, 它 modeling happens-before 关系并报 race. **谛走 lock-free 必备 tsan**.

## 10. 多语言同一操作

| 语言 | acquire / release 表达 |
|------|------|
| C/C++11 | atomic_load/store_explicit |
| Rust | Ordering::Acquire / Release / SeqCst |
| Go | atomic.Load/Store + sync |
| Java | volatile, final, synchronized |
| Python | (单线程, 无意义) |

抽象一致: **同一组 happens-before 概念在不同语言里换名字重物化**.

## 11. 这章带走的东西

- 内存重排来源: 编译器优化 + CPU store buffer + invalidate queue;
- x86 TSO 仅允许 store-load 重排, ARM 全部允许;
- C11 memory_order_acquire/release 是 SPSC "消息传递"基本;
- ARM dmb 加 2-5 ns, x86 1-2 ns 默认 seq_cst 默认;
- tsan 必须: lock-free + 缺 barrier bug 几乎肯定测不到的 silent.

下一节 → [lock-free/wait-free 数据结构](lockfree.md)
