# Linux CFS 调度器

## 一句话

"完全公平调度器" `CFS = Completely Fair Scheduler` 是 2.6.23-2007 引入的 Linux 默认调度类. 名字叫"完全公平" — 它真的试图做到**任何任务的机会都按 weight 加权 fair share CPU 时间**.  但 CFS 的物理实现是**红黑树 + vruntime**, 而不是朴素 weighted round-robin. 这章把红黑树和 vruntime 这两个抽象放在一起, 让你看清"50-char 算法选择到 OS 内核"的真实工程.

## 1. 需要调度的本质

5000 个线程抢 64 个核. 每线程不一定"想" 跑多久:

- 一个 web server 处理一个请求大概 100 μs;
- 一个 ML 训练线程每次 inference ~30 ms;
- 一个 daemon wake up 处理 ping ~1 ms;

调度器的工作是: **每核每 1-10 ms 内, 选一个最有权获得 CPU 的 runnable thread 跑**, 然后定期 preempt, 让下一个 thread 跑.

传统 Unix Unix 调度器 (2.4 / 2.5 之前): 是 priority + timestep (类似 priority RR). 但 priority RR 有几个问题:

- "nice" 的 metric 是糟糕的 ( nice 0 的 vs nice 10 不是平沙发, 实际差距 +10-12 临界);
- 多核不友, 对称 boom lock;
- 不能 account actual cpu time (虚拟化场景里真实 CPU 和真实 wall clock 偏差).

**CFS 用 vruntime 取代 priority RR**: 把"已经多跑过 CPU" 累计起来, 让多跑的退后让位.

## 2. vruntime: 公平的核心数据

定义:

```
vruntime = ∑ (实际运行时间 × 优先级权重倒数)
```

- 跑得多的 thread 累计 vruntime 大;
- vruntime 小的 thread 表示"等待 CPU 已久"或"曾经被偷走过 budget";
- CFS 试图选 vruntime 最小的 runnable thread.

nice 值从 -20 → 19, default nice=0. 它对应一个 weight (kernel/sched/sched.h 中 `prio_to_weight`:

```c
static const int prio_to_weight[40] = {
 /* -20 */     88761,    71755,   56483,   46273,    36291,    29154,    23254,    18705,
 /* -12 */     14949,    11916,    9548,    7620,     6100,     4904,     3906,     3121,
 /*  -4 */      2501,     1991,    1586,    1277,     1024,      820,      655,      526,
 /*   4 */       423,      335,     272,     215,      172,      137,      110,       87,
 /*  12 */        70,       56,      45,      36,       29,       23,       18,       15,
};
```

每个 nice 调一挡差 ~25% (注意: 多挡差是几何递降). nice 19  vs nice -20 差距 ~88761/15 ≈ 5900×.

这意味着:
- nice 0 weight=1024 (default), 1 sec 跑后 vruntime 增 1 sec;
- nice 19 weight=15, 1 sec 跑后 vruntime 增 1 sec × 1024 / 15 = ~68 sec.

**vruntime 增长率反比 weight** —— nice 高的 (低优先) vruntime 增长快, 几秒就排到最后. CFS 即用 nice 但 fail ACL 不公平.

## 3. 红黑树: 维护 vruntime 有序集

每 CPU 自己一个运行队列, 是一颗红黑树 ( per-cpu rq.cfs_timeline ), key = vruntime:

- 每次选下一个 thread 跑: 树最左 = vruntime 最小;
- red-black trees 提供插入 / 删除 O(log N) 保证.

N (runnable thread 数)在一台 server 上可到几千. 每毫秒重新挑下个 thread O(log N) = <15 步 非常便宜.

> [!NOTE]
> 这里是 DSA 章节红黑树 + 红黑写入旋转 ≤ 3 在 OS 内核里的真实物化. 行业里你极少直接手写 red-black tree, 但你天天用它.

## 4. preempt: 节拍 + tick

```
每次 thread 进入 kernel mode (syscall),
 或 被 interrupt (timer / I/O completions → IPI),
scheduler_tick() 减当前 thread 的 time slice 余额;
当 残额 ≤ 0, set TIF_NEED_RESCHED flag.
中断返回用户态前点 schedule() → 选下一个 thread.
```

CFS 默认 time slice = `sysctl_sched_latency / N`, 一般 sched_latency=6 ms, N=runnable 数.

- N=10: 每 thread ~600 μs 跑一片;
- N=100: 每 thread ~60 μs, 但 min granularity floor (sched_min_granularity = 0.75 ms default) 强制 ≥ 0.75 ms.

保证每个 thread 至少跑够 min_granularity, 不被抢过快导致 cache trashing.

## 5. EEVDF: Linux 6.6+ 后的新模型

CFS 用 15 年后, Linux 6.6 引入 EEVDF (Earliest Eligible Virtual Deadline First) 替换 CFS.

核心:
- vruntime 演化 = eligible lag = actual_cpu - weight_cpu. lag > 0 表示欠 CPU, lag < 0 表示多跑了;
-eligible = lag ≥ 0 才可被调度;
- 在 eligible 集合中用 deadline (按 nice weight 计算的虚拟 deadline) 排序.

EEVDF 解决的问题:
- CFS 在 weight 不齐负载下偏 GAINS 高优先 thread, latency 不一致;
- CFS 没显式 latency bound, 不能保 哈高优先低延迟个bit EEVDF;
- EEVDF 在 ML inference 训练 (动态调整 nice)+ 高低优先混合好.

EEVDF 仍 vruntime-based, 仍 per-cpu rq 队列, 仍红黑树 — 工程实现 90% 类似 CFS. 替换只把挑选算法换成 deadline first + eligibility check.

## 6. 多核负载均衡

每核有自己的 rq, scheduler 必须 lazy 把 task 在核间移动:

```
周期性 load_balance():
  每隔 sched_period 一次 (e.g. 100 ms);
  比较各 CPU 的 load (sum weight);
  找最忙与最闲 CPU;
  把一定数 task 从忙 → 闲, 但考虑 cache locality + NUMA 复位.
```

`numa_balancing` 是 NUMA 自动迁移支持: `echo 1 > /proc/sys/kernel/numa_balancing`. 默认 on 在 NUMA 系统.

**坑**: 任务边界可能 cross-socket. 线程 A 在 socket 0, 任务切到 B 在 socket 1, B 找内存 在 socket 0 ⇒ 跨 NUMA. 解决: pthread_setaffinity_np (cpu affinity) 锁住.

## 7. 实测影响

(由于历史 CFS 上, 高低优先混) 现在主流 Linux 早就 5.x+ / 6.x, EEVDF 也是好, 但仍:

- 32 核 机器跑 1000 低 nice 容器 + 100 通常次 nice 守护 = latencies maintained sched_normal 排队 > 6 ms / 守护.
- gig niced web server thread = bad path = potential starvation.
- nice 单值差异 工程上 5 次 ≈ ~2× 差距, 10 次 ≈ ~5×, 多次叠加几乎无法归还.

补丁 nice RR.  fix -20 (nice 0) vs nice 0 (nice 0) 之间差 6× 可竞争抛入跑. 工程上 nice 不再使用很好. **建议 cgroup + cpu.shares / cpu.max 替代 nice**.

## 8. 多语言 / 多运行时

| 语言 | user 调度 | kernel 看见什么 |
|------|----------|----------------|
| C pthread | kernel thread | 1:1 M:N kernel thread |
| Java Thread (1:1) | kernel thread | 同上 |
| Go goroutine | runtime 自己 scheduler (GMP) | M less than G, M 是 OS thread |
| Erlang process | BEAM scheduler | 同 M:N |
| Rust tokio | 自己 scheduler | runtime over M threads, async fn |

kernel 只看 OS thread. 用户态协程是 runtime 中 scheduler 自 mange. 这就是"用户态调度器" 与"OS 调度器" 是同构dispatcher抽象 在不同本身 layer.

## 9. 这章带走的东西

- vruntime + nice weight 让 CFS "更公平" 视觉对比 + nice 弱化主线;
- 红黑树是 OS 内 kernel 里数据结构魔抗现实 (你们 feedback 1 thread 5000 个选呢);
- EEVDF 6.6+ 替换 CFS, 同 vruntime + eligible lag + deadline first;
- Linux 多核负载均衡 自然 + NUMA affinity 控制位置;
- 高 nice 实际可调范围 

下一节 → [实时调度](rt.md)
