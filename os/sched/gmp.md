# goroutine GMP 模型

## 一句话

Go runtime 的核心创新不是语法 / 多线程抽象 / GC 而是它的调度器 `GMP` (Goroutine / Machine / Processor). 它把用户态 goroutine + OS thread + 逻辑 P 三层抽象叠在一起, 让用户写 10 万个 goroutine 仍能在 64 核机器上 O(N_top) 不退化协力. 内核不感知有 goroutine, 它只看到一个进程跑很少几条 OS 线程. 而这层抽象实现背后是同一个抽象一直在反复出现: thread local + work stealing + central 稀释 — DSA "lock-free work queue + ring buffer" 的工程化.

## 1. G / M / P 各自什么

- **G** (Goroutine): 一个用户态 task. 大小仅 8 KB 栈可起步, 不绑死固定 OS thread.
- **P** (Processor): 一个逻辑 "执行权". 全局 `GOMAXPROCS` 个 (默认 = ncpu). 每个 P 有自己的本地 runqueue 装 G. 实际上 P 是一个虚拟资源"票据".
- **M** (Machine): 一个真 OS 线程. M 必须 attach 到某个 P 才能跑对应的 G.

```
                  ┌─ P0 local runq: [G1, G2, G3]\
                  ├─ P1 local runq: [G4, G5]     |  ┐
GOMAXPROCS=4  →   ├─ P2 local runq: [G6]         |  ├ M0..M_k = OS threads attached
                  └─ P3 local runq: [G7, G8, G9] ┘   
                  
                  global runq: (overflowed goroutines)
                  netpoller: (waiting-on-IO goroutines)
```

任何时刻, 多个 M 上各自的核上跑 G. 不需要 G 在核心之间迁移, 也少 lock 争.

## 2. work stealing: 关键性能技巧

P 的 local queue 空了想拿新 G ⇒ 它会:

1. 尝试自己 P 的 local queue;
2. work steal — 从别的 P 的 queue 里 steali 一半;
3. 拿 global runqueue;
4. 拿 netpoller ready 任务.

work stealing 的算法详 + Go runtime 自内调度器 = 论文 Anderson et al. 2010 之类的 *work-stealing deques*. 高级实现加 chase / pop / steal 各有 lock-free 实现 (e.g. treiber stack with bounded queue 加 bins).

**实测 work stealing 关键收益**: 在 GOMAXPROCS=Ncpu 下, G uniform 分配到 P 上, cross-P queue 大致 O(no lock) ⇒ N 个 P 一齐 100 个并发任务.

## 3. G 的状态机: 接管 syscall

一般 user code 在 goroutine 上跑:

```
G: runnable → running → syscall → blocked
   ↑                       ↓
   └───── 调度重新分配 ──────┘
```

"M1 正在跑 G1, G1 syscall 阻塞", runtime 会:

1. 把 M1 我想 briefly detach (在 lock, FS syscall, ...)
2. 当 P0 引 syscall block too long: 想办法抢 P0 给另一个 M
3. 新 M2 接管 P0, 继续从 local runq 拿新 G 跑

**实际效果**: 你的 Go 服务在 Lua-like IO syscall 时 ( 1 ms, 10 ms ) 都不会因 syscall 阻塞丢 CPU 调度. 这是 KB 模式 (大约 = nginx work 共享 NGINX/GPU 由于 共享阻塞).

```
M0 + P0 + G1 — syscall 阻塞 → 此 M0 与 P0 的解绑
                                   ↓
P0 配新 M1 继续跑 G_x (本地 queue 中下个工)
M0 等 syscall 完成 ⇒ G1 重新 runnable 进 global runq or P0 local
```

## 4. network poller: epoll 直接接管

Go 5.x+ runtime 在 Linux socket IO 用 epoll + nonblock fd. 一个后台线程 (netpoller M) 长期 epoll_wait. 当 fd 可读就解析 fd-event 反查 G, 把它标 runnable.

```
G1 想 socket.Read(fd)
   ↓
syscall nonblock + epoll_ctl(ADD fd)
   ↓
runtime park G1 with 当G1变 runnable callback
   ↓
Go runtime netpoller M定期 epoll_wait → 当 fdk可读就叫 G1 校 runnable
```

_epoll_ in `_thread_run*` is device same shape Ever 用 epoll + java 或 nginx: 的 same. Go runtime 只是把是用户 user reverse-detect G **multiple G + open-ended M** 配上 independent 其实是**脱 roll abstraction**.

## 5. 抛弃 blocked M 和 G 的 soft timer

一个 M 阻塞 syscall 太久 (e.g. > 10-20 ms) ⇒ retassined P 给别的 M. 这个 handoff 的特殊性是 **handoff 不再杀 M** — 让 M 继续 run syscall完成  G1 ⇒ 在 syscall tail G 想重attach 到任何 P.

但 What if Go runtime 完全用 OS sysc copy 或 block too long (比如 > 10 ms syscall)? **SYS 要求 ca (sysmon) 起出现 ⇒ P handoff**.

这个 abstraction 与 Linux smpaffinity 跨 node migration 同构: **apps (及)kernel times prefer core local handoff 在考虑 cache locality**.

## 6. 实测: CFS / 调度延迟 / output

在 default GOMAXPROCS=Ncpu:

- 黄报 goroutine create 1 个 ~ 1 μs / 8 KB stack;
- thread create 1 个 ~ 30 μs / 1-2 MB stack;
- sysmon monitor syscall block + steal 抢 ~ 10-20 μs.

goroutine 比 thread 更轻 → 高并发场景可 trivial 高 günstig manager concurrency size.

## 7. 多语言对照

| 语言 runtime | 协程调度器 | 配置 |
|------|------|------|
| Rust tokio | multi-thread runtime + work steal | `#tokio::main(worker_threads=N)` 默认 CPU 数 |
| Java Project Loom | virtual thread + FFI scheduler | `Executors.newVirtualThreadPerTaskExecutor()` |
| Erlang BEAM | preempt scheduler, priorities | 也可以多个 per CPU |
| Python asyncio | 单线程 cooperative scheduler | `asyncio.run_until_complete()` |
| Kotlin coroutines | 更 dispatcher 由 runtimes | `Dispatchers.IO/Default` |

抽象叠出: **goroutine scheduler is actually a user-level thread scheduler**. 它 work stealing + per-P local queue + syscall 抢救 + epoll netpoller 是工程核心 learning.

## 8. 这一章带走的东西

- G: 用户态 task; P: 执行票据; M: OS thread; 三层分离配上 caching/调度;
- work stealing 拿到线性扩展 (DSA lock-free deque 实例);
- syscall haoffee 阻塞 P 抢等 handoff 不仅 mask 与 opt code, 避 full 愚服务;
- netpoller = epoll 实际 scheduling= async IO 用于附 internal;
- 抽象同构造 (tokio, java virtual threads 也有同 abstract):
