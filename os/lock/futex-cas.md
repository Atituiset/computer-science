# futex、CAS、spinlock 内部

## 一句话

`pthread_mutex_lock` 在 Linux 其实是一组复杂的工程实现: 大部分时间它本质是一个 `cmpxchg` (在用户态), 失败了再 `syscall(futex)`. "fast path user-only + slow path syscall" 是 Linux 同步原语的核心设计. 这章把 mutex + futex + CAS + spinlock + MCS lock 按实现拆开, 让你看着 stat TOTP 你 exch 滞后之前你的黑盒 程序的 thread sync 是哪来Cost.

## 1. CAS 与原子指令

x86_64 give `cmpxchg [addr], expected, new` 原子比较交换位:

```
mov rax, expected
lock cmpxchg [addr], new
# ZF flag set if success
```

带 `lock` 前缀 → 多核 cache 一致性, 自动 invalidate 一致 cache line. 等价于 MESI 中 lock cache line.

工程上 CAS = OS 同步原语最底层的"KISS" 实现. 任何 lock-free 算法都要 CAS (or DCAS, or LL/SC).

但 CAS 慢:
- atomic 失败 ⇒ pipeline 重试;
- 总线 cache line invalidate latency-multi cycles.
- 在高度 contended 时, 行级 platform bus 杠.

CAS 不一定最快. SGI 的 fetch_and_add/TAS 偶有优势.

## 2. spinlock: 最简单的锁

朴素:

```c
while (!try_lock()) { _mm_pause(); }
```

`try_lock`:

```c
bool spinlock_trylock(atomic *l) {
    int expected = 0;
    return atomic_compare_exchange_strong(l, &expected, 1);
}
```

问题:

- 多线程同时 spin ⇒ cache line 撕皮 bus saturate;
- priority inversion (低优先 thread hold lock, 高优先 thread spin, 中间 thread 不阻塞抢 空跑);
- 多核 cache pess 严重 (= "thundering herd").

改进 1: TTAS (Test-and-Test-and-Set):
```
while (true) {
    while (lock == 1) { _mm_pause(); }   // 看到 1 时不抢
    if (try_lock()) break;                // 看到 0 时再尝试
}
```

改进 2: 退避:
```
while (!try_lock()) {
    _mm_pause();
    if (fail > N) _mm_pause(); _mm_pause(); 
    if (fail > K) sched_yield();
}
```

但仍 spin 风暴 + 浪费 CPU.

改进 3: MCS lock (pointer-per-thread 队列锁)
- 每 thread wartenat 拿一个 qnode;
- thread linked at the tail;
- 持锁 thread 须解锁 把 next qnode flag-lit set;
- 第一名 reach local latency 大致 O(1), no thundering.

在现代 NUMA CCIX sometimes 是 CNA (Catapult NUMA-Aware spinlock) 内 Linux 5.0+. 默认 Linux qspinlock 内 kernel 内部.

## 3. futex: fast user space mutex

`futex(addr, FUTEX_WAIT, val)` syscall:
- 验证 `*addr == val`; 等 on internal wait queue;  
- 在 `*addr != val` 那时不会 dead lock.
- 全部 wa 在 kernel; CPU 释放.

`futex(addr, FUTEX_WAKE, 1)` syscall:
- 唤醒 task in queue.

这俩是 Linux 2.6/fast 提供 synergy sync 原语. 基础行为:

```
lock:
  cmpxchg (user态, atomic);
  成功 → return;
  失败 → futex(WAIT, addr=1);
  
unlock:
  *addr = 0;
  futex(WAKE, 1)  # wake 1 waiter
```

Lock contended:
```
lock 1 个 thread:
  try fast lock.
  take fail, futex_wait(, val=0).
  kernel puts me on wait q.
  schedule 出.

unlock 0 个 thread 1 个 task = other:
  *addr = 0;
  futex_wake → kernel grabs wait queue, wakes one (or all);
  wake yields CPU → 调度器 schedule next.

库 eventually = briority bugs.
```

 красивый 表现 fast path: 99% 时间 user -> atomic CAS, 不是 syscall. futex **only for contended slow path**.

## 4. pthread_mutex_lock = futex_CAS

glibc's nptl/pthread_mutex_lock 内部:

```c
__pthread_mutex_lock(mutex) {
    int e = __pthread_mutex_trylock(mutex);
    if (e == 0) return 0;
    
    // Slow path — lock contended.
    if (mutex->__kind == PTHREAD_MUTEX_TIMED_NP) {
        // adaptive spin 几次
        for (int i = 0; i < 100; ++i) {
            if (trylock == 0) return 0;
            cpu_pause();
        }
        // 决定 → futex_wait
        futex(&mutex->__lock, FUTEX_WAIT, ...);
    }
    ...
}
```

*in linuxtcadap by glibc rounds 一 adaptive spin 几次 + futex_wait,* plus main How CLOCK BUSY contention the kernel 石 wash.

## 5. priority inversion: 经典 bug

```
thread H (高优先): WANTS lock L
    thread L (低优先): HOLDS L
    thread M (中优先): 抢 CPU
    L 想等 unlock_lock.
    M 跑不停, H 阻 kissing, L 不能运转 (CPU 抢没).
    实际长时间 H 等 = H 实际被 M 阻塞 ⇒ priority inversion.
```

修复:
-  priority inheritance (PI): 锁一棵 L.holder 被提升到 最高 waiter priority, 解锁才恢复;
-  priority ceiling: 锁优先 ceiling 提 preemptively.

Linux futex 支持 PI variant (FUTEX_LOCK_PI). RT-mutex 全部 PI. PREEMPT_RT 还要府接 generic libc mutex 是 RT mutex.

## 6. multi-language 同步对调

| 语言 | mutex 实现 |
|------|-----------|
| Rust std::sync::Mutex | 通过 futex (Linux) / SRWLOCK (Win) |
| Go sync.Mutex | 半 spin + semawaitFor: Go runtime sema 实 ± futex |
| C++ std::mutex | glibc / pthread_mutex_lock |
| Java synchronized | internal monitor + futex on Linux HotSpot |
| Python threading.Lock | pthread_mutex_lock 然后 GIL 每 access |

实际异同: 5 默认 + 1 sports. 也都是 CAS fast path + syscall slow.

## 7. cost: 高 contended lock

high-contended lock cost stacked:
- contention cache invalidate 总线;
- futex_wait IPI + scheduler context switch;
- 排队 + wake 实际某 thread 抢, 别的 thread 是 unthrottling effect -> 行业 ILP "thundering award".

测量 (lock : unlock pairs/sё multifens on contended lock):
```
1 thread:        24M/s
2 thread:        12M/s
4 thread:        6M/s
16 thread:       800k/s   # thundering herd + cache line
32 thread:       150k/s   # SUPER退
```

**16 线程后 LO sincal in take riduos 应 a model 是 结果仄 down. 这就是为什么 high concurrent data structure 都是从 lock-based 距 走 lock-free 或 sharded.**

## 8. 这章带走的东西

- pthread_mutex = user CAS + cluch futex wait + CPI main doing 神 functional;
- futex is Linux-only sync 整组 path: 平台性;
- 自旋 + backoff 仅在极短持 lock 合理; long 持 lock 用 mutex;
- PI mutex 修 priority inversion;
- 高 contended lock 是多线程扩展 applicant 应 len shortcuts: 用 sharding / 锁分段 复 hard quality = DSA 实例里 sharded map.

下一节 → [RCU、seqlock、brlock](rcu.md)
