# lock-free / wait-free 数据结构

## 一句话

"lock-free" 这词被用滥了。很多人把它当成"无锁 = 快=好"的玄学。实际上：
- **lock-free**：保证**至少有一个线程**在做进展 (system-wide progress);
- **wait-free**：保证**每个线程**在有限步内完成 (per-thread progress);
- 朴素互斥既非 lock-free 也非 wait-free;

工程上做 lock-free 的代价主要不是数据结构本身, 而是 memory reclamation (ABA / Hazard Pointer / epoch reclamation). 这一章把 Treiber Stack / Michael-Scott Queue / Hash Map 这些经典骨架拆到一次看完, 让你动手写不踩坑.

## 1. 朴素无锁栈 (Treiber Stack)

```c
struct Node { Node *next; T value; };
atomic<Node*> top;

void push(T x) {
    Node *n = new Node{x, top.load(memory_order_relaxed)};
    while (!top.compare_exchange_weak(n->next, n,
                                       memory_order_release,
                                       memory_order_relaxed)) ;
    // CAS 失败: 重试 (n->next 被 top 新值刷新)
}

T pop() {
    Node *top_old;
    top_old = top.load(memory_order_acquire);
    while (top_old && !top.compare_exchange_weak(top_old, top_old->next,
                                                  memory_order_acquire,
                                                  memory_order_acquire)) ;
    if (!top_old) return {};
    T val = top_old->value;
    delete top_old;  // 这里有 ABA 隐患
    return val;
}
```

Lock-free: 任何一次成功 push/pop (system-wide progress). 但 **ABA 风暴**在 pop 中出现.

ABA: thread A pop 后立刻 delete N0, 又有 malloc reuse same address 给 N1 同址. 此时 thread B 还停在 CAS: 看到 top=N0 没变化, 跑 CAS top=N0→next=N0.next, CAS 成功 — 但 N0 已被回收 → 数据结构空链 break.

## 2. ABA 的几个修复

- **Tagged pointer**: ptr + counter 16 字节, 16 字节 CAS. ARMv8 / x86 (cmpxchg16b)支持. Python / Rust 的 crossbeam_epoch 都支持;
- **Hazard pointer**: per-thread 一组"正在用"指针, 在回收前检查所有 hazard 槽, 没人持有才回收;
- **Epoch-based reclamation**: 每 thread 在 epoch, 全 thread 离 epoch N ⇒ 回收 epoch N 之前垃圾. crossbeam / Java / Linux RCU 都类 epoch 模型.

工程上 epoch-based 最快且代码量可控. Hazard pointer 简单但慢 (每 access 检查 hazard). Tagged 用 CAS-double 内存对齐要求严.

## 3. 无锁队列 (Michael-Scott Queue)

```c
struct Q {
    atomic<Node*> head;
    atomic<Node*> tail;
};

void enqueue(T x) {
    Node *n = new Node{x, nullptr};
    Node *t;
    while (true) {
        t = tail.load(memory_order_acquire);
        Node *next = t->next.load(memory_order_acquire);
        if (t == tail.load(memory_order_relaxed)) {      // tail 没变
            if (next == nullptr) {
                if (t->next.compare_exchange_weak(next, n, release, relaxed)) {
                    // 关键 step 1 完成
                    break;
                }
            } else {
                // 别人 advance tail 一半, 帮 advance
                tail.compare_exchange_weak(t, next, relaxed, relaxed);
            }
        }
    }
    // 关键 step 2: 把 tail advance 到新 node
    tail.compare_exchange_strong(t, n, release, relaxed);
}
```

Michael-Scott Q 是经典无锁队列, 实现要点:
- 两个 step 不是原子: tail 不一定立即 advance, 别的 thread 可帮忙 advance (这就是 "helping" 模式);
- helping 对 lock-free 算法非常关键 (保证 progress).

## 4. 无锁 hash map (e.g. Folly AtomicHashMap)

开放地址 + atomic CAS:

```
find bucket by hash;
linear probe: 
   if slot empty → CAS empty → new entry;
   if slot key matches → return;
   if marked tombstone → continue;
直到找到空 slot insertion / 找到 key.
扩容呢?
  这就是难处:
    扩容需要新 array, 但同时旧 reader 仍在用;
    解决: 用两个 hashmaps同 时存在 (转 move 期间), reference count 决定 free 旧的;
```

**实际 lock-free hash map 远没有 lock-free stack / queue 那么干净**. Folly AtomicHashMap 只支持单写多读, 不真完全 concurrent. Java ConcurrentHashMap v8 是 segment 锁 + CAS, 不算严格 lock-free.

## 5. lock-free 数据结构 benchmark 实测

Lockfree 不一定比 mutex 快:
```
1 thread stack mutex / Treiber Stack  20M ops/s, 两者一样
2 thread contended mutex   3M ops/s,  Treiber 4M ops/s
8 thread contended mutex   500k ops/s Treiber 1.5M ops/s
32 thread contended mutex  50k ops/s  Treiber 400k ops/s
```

lockfree 在高 contended 略好(2-3×), 但 epoch reclamation 加入后实际只快 1.5-2×. 并发到极端时 (64 thread+) epoch reclamation 也变成为 bottleneck; 实际 CSP (e.g. Go channel) 并不一定输;

## 6. wait-free 是不是必须

wait-free: 严格 stronger. 任何 thread 在限步内完成 → 一般上在生产代码中**几乎从不实现**, 因为常数远大于 lock-free, 在 cache-friendly 算法里反而更慢.

实际工程: "lock-free + benchmark 比 wait-free 多数 5-10× 快, 实际业务上没人强求 wait-free". Linux kernel 与标准库都 lock-free 不 wait-free.

## 7. 性能杀手: ABA 中的 memory reclamation cost

**实际 lock-free 工程成本句号是内存回收**:

- hazard pointer 每访问需要 atomic store + thread-shared visibility; 对 hot path 加 5-15ns;
- epoch reclamation 每隔 ~200us 才回收; 长时间 running 后退推进 epoch, 需要所有 thread 上报 → borderline throughput spiral;
- crossbeam epoch V8 弱内容 fast but requires Rust async 不来 adwait.

## 8.这章带走的东西

- lock-free = 至少 one thread 进展; wait-free = 每 thread 限步进展;
- ABA 是 lock-free 第一个 wall: tagged pointer / hazard pointer / epoch reclamation 三路修;
- Michael-Scott Queue 的 helping pattern;
- lock-free **不一定比 mutex 快**: 高 contended 多核下 1.5-2×, 低 contended 反而慢;
- 工程上 lock-free 复杂度集中在 memory reclamation, 不在数据结构本身.

下一节 → [IO 与网络栈](../net/README.md)
