# RCU、seqlock、brlock

## 一句话

并不是所有读取都需要加锁——在**读超多写特少**的场景，用锁做读保护本身就把 cache line 撕成碎片、把总线刷爆。Linux 在 2002 年由 Paul McKenney 提出 **RCU (Read-Copy-Update)**，把读端做得近乎零开销：读不拿锁，写复制新版本原子替换，旧版本等"宽限期"过去才回收。同 seqlock、brlock 这组原语背后的同一思想是：**让读路径走快道，让写路径做 dity work**。这组抽象跟 DSA persistent data structure 在抽象上同构——你写的时候永远是改"私人副本"，读者要么看旧要么看新，不会看到中间态。

## 1. RCU: 一个不用读锁的同步原语

核心三件套：

- 读不拿锁，只持 RCU read side critical section；
- 写时 **copy + modify + atomic pointer swap**，旧结构仍被旧读者引用；
- 旧结构等所有"曾进入 RCU 读端的读者都走出" 之后才被回收 → **grace period**。

```c
// reader side
rcu_read_lock();
node *p = rcu_dereference(shared_list);
while (p) { do_something(p); p = p->next; }
rcu_read_unlock();

// writer side
new = kmalloc(...);
old = rcu_dereference(shared_list);
*new = *old;
new->field = X;
rcu_assign_pointer(shared_list, new);   // 原子指针替换
synchronize_rcu();                       // 等 grace period
kfree(old);
```

`rcu_dereference / rcu_assign_pointer` 内部加了 memory barrier，确保读者看到的指针和数据都一致——下一节 memory barrier 会展开。

读端 "= 几条普通访 + 一个 `rcu_read_lock` (本质只是 preempt_disable)"，**没有原子、没有自旋、没有 cache invalidate** — 这就是 RCU 读路径几乎免费的原因。Linux 内核 **路由表、namespace 链表、perf event ring、文件系统 mount 元数据**全靠 RCU，几万行内核代码主要就靠这一原语支撑读多写少场景。

切 grace period 的两个 API：
- `synchronize_rcu()`: 阻塞调用者直到所有读者离开 → 同步慢，几 ms 级；
- `call_rcu(callback, ...)`: 异步排队，下个 grace period 后回调 → 异步 + 队列。

## 2. seqlock: 无锁 + read retry

适用：**单写多读 + 不想 copy**。

```c
seqcount_t seq = SEQCNT_ZERO(seq);

// writer side (writer 须互斥, e.g. 用 mutex)
write_seqcount_begin(&seq);
shared.value = X;     // 修改 in-place
write_seqcount_end(&seq);

// reader side (无锁)
unsigned s;
do {
    s = read_seqcount_begin(&seq);
    v = shared.value;        // possibly torn read
} while (read_seqcount_retry(&seq, s));
```

`seq` 是个 unsigned int：
- writer 起手时 `seq++` (变奇数)，结束 `seq++` (变偶数)。
- reader 看到偶数 = 无人写 → 复制 → 完后 `seq` 仍开始看到的偶数 = 数据有效；
- 若 reader 在读到一半 seq 被 writer 撞了 (奇数或不同偶数) ⇒ retry。

代价: **_writer 之间要互斥**（不是无锁在内）, RCU 是 read free + write expensive, seqlock 是 read retry free + write must be exclusive.

Linux 用 seqlock 的地方：
- jiffies 全局时钟；
- /proc 文件 stats 数字；
- 设备级 stat counters.

## 3. brlock: 大读者锁

brlock = Big Reader Lock。90 年代后期 Linux 上的某阶段用过：每 CPU 维护一个 reader 版本，reader 只动自己 CPU 的本地版本（cache line 私有），writer 必须 invalidate 所有 CPU 的本地版本。

```
read_lock():
    this_cpu_inc(lr->cnt);     // 只动本地 cache line
read_unlock():
    this_cpu_dec(lr->cnt);
write_lock():
    for_each_cpu(c): spin until lr[c].cnt == 0  // 写者极慢
write_unlock():
    (no-op)
```

读路径 = 单 CPU 本地 increment，**零 cache invalidate** —— 比 rwlock 读路径快一个量级。写路径必须遍历每 CPU 协调，写一次慢到几十 μs。

**brlock 早被 RCU 取代**：RCU 写路径也是 expensive，但读路径**真的"不持锁"** 而且 O(1) 字段访问。这就是为什么 RCU 是现代同步原语里 "大读者" 的真正替代品。

## 4. 用户态 RCU (liburcu)

`liburcu` 把 RCU 引到用户态。原理类似但 grace period 判定要靠 per-thread 的"准 simstate" mailbox；典型用法：

```c
rcu_register_thread();
rcu_read_lock();
struct foo *p = rcu_dereference(glob);
use(p->x);
rcu_read_unlock();

// writer
new = malloc(); *new = *glob; new->x = X;
rcu_set_pointer(glob, new);
synchronize_rcu();
free(glob);   // 真安全, 所有 readers 已离开
```

用户态 RCU 因为 grace period 检测要"thread 自报"，几乎只适合 thread 模型稳定的程序（不动态创建/销毁线程）。适合 long-running 高性能 server，不适合 hobby project。

## 5. RCU 与持久化数据结构（DSA 同构）

DSA 树那一段讲过 pure functional / persistent tree：每次"修改"返回新版的根、旧版用旧 child 共享不变。这种"写时构建新副本 + 读者可读旧版"的模型与 RCU **同构**：
- 读者只知道一个引用根，访问何版本由读取瞬间决定；
- 多版本可同时存在；
- 旧版本回收靠"无引用后才能 free"（持久化结构里靠 GC；RCU 里靠 grace period）。

**Haskell / Clojure 的 persistent data structure 是 RCU 抽象的 GC 化变体**：用 GC 替代 grace period，用 immutable 替代 atomic pointer swap。但是抽象骨架完全一致。

类似同构在 **git** 也存在：每次 commit 是 immutable snapshot，branch 指针在 commit 间移动，老 snapshot 在 reflog / remote 仍存。

## 6. RCU 与 GC 的关系

| 抽象 | 读者保护 | 旧版本回收 |
|------|----------|------------|
| RCU | rcu_read_lock/unlock + preempt_disable | synchronize_rcu / call_rcu |
| Java GC (concurrent mark + sweep) | 持 ref 即可 | concurrent trace of live set |
| Rust `Arc<T>` / `Weak<T>` | 持 Arc 即可 | last Arc drop |
| Haskell STM | 持 TVars 引用 | GC 根扫描 |

四种实现都是"读路径轻、回收靠专门阶段"。GC 是隐式 RCU，RCU 是显式 GC。这一组同构让你看 Java/Go GC 设计与 RCU 设计时不慌——它们都在解决 "读不阻塞 + 回收安全" 这同一问题，物化形式不同。

## 7. 这章带走的东西

- RCU 读路径几乎零开销，靠 copy + atomic pointer swap 实现写；
- grace period 是 RCU 的核心安全网（类似 GC root scan）；
- seqlock 是单写多读 + 不想 copy 时的极简方案；
- brlock 已被 RCU 取代；
- liburcu 把 RCU 引到用户态（适合 stable thread 模型）；
- RCU / persistent data structure / Git 是 "写副本 + 读多版本" 这一抽象在不同物化层的同构。

下一节 → [内存模型与 memory barrier](memory-barrier.md)
