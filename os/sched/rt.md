# 实时调度：SCHED_FIFO / RR / EDF

## 一句话

CFS / EEVDF 是 **尽力而为** 调度，没硬延迟保证. 工业 / 安全 / 媒体 / 控制系统有更严的要求:**必须 K 个可调度任务每 100 μs 内 ack 完成一次**, 必须把抖动盯死在硬指标上. 这就是 real-time scheduling 存在的意义. 这一章把 Linux 的 SCHED_FIFO / SCHED_RR / SCHED_DEADLINE 三个实时类拆开看，再讲业界控制领域使用的 EDF (Earliest Deadline First) — 实时抽象把它带回到硬件层 (看 ARM Cortex-R / 安全岛 automotive).

## 1. SCHED_FIFO / SCHED_RR：POSIX 实时类

Linux 把调度类按 priority 排叠:

```
[实时类 0-99] → 优先于 [CFS / EEVDF]
```

两个 rt 类:
- SCHED_FIFO: FIFO 顺序, 跑到自愿让出;
- SCHED_RR: 同 FIFO 但时间片 = 100 ms 后抢;

进入配 rt priority 也能跨核 migration, 但 FIFO 是 panic-level "不再被迫让位": 1 个 SCHED_FIFO 99 thread 跑 while(1) infinite ⇒ 其他线程全饿死. **Linux 没默认 watchdog over FIFO thread**.

## 2. SCHED_DEADLINE：Linux EDF policy 引入

Linux 3.14+ 引入 SCHED_DEADLINE（基于 EDF 算法）. **EDF** (Earliest Deadline First):

```
每任务的三元组 (runtime, period, deadline):
  每周期 period 内, 须够 runtime μs CPU, 期限 deadline μs.
```

Example: 任务 A (10 ms runtime, 100 ms period, 50 ms deadline):
```
每 100 ms 开始: 任务 A 必须在 deadline 50 ms 内跑完 10 ms CPU.
EDF: 每次调度只要流内 runtime < deadline 的 task (内 runnable 中最早 dl 优先)
```

调度器在 admit 时用 utilization check: 
```
Σ (runtime_i / period_i) ≤ min(1, total_cores)
```

单调 EDF 是最低可行算法 CPU utilization 上界 (Liu & Layland 1973). SCHED_DEADLINE 是 Linux 给硬实时打 的 framework. 

## 3. PREEMPT_RT: kernel 自己 rt 化

Linux 默认不少 critical section (e.g. spinlock) 还不可抢占. PREEMPT_RT 是主支工程, kernel spinlock 换 raw_spinlock + rt_mutex + rcu_rrn 等让" kernel 自己 rt friendly". PREEMPT_RT 已经渐进 mainline 多年并在 Linux 6.12 后全部 upstream.

打开 PREEMPT_RT 后:
- spinlock 改 rt mutex, 不能 thread 抢死;
-IRQSOFT聋DDevice handler 变成 kernel thread (ksoftirqd);
- 大多数关键 path preempt-safe ⇒ max latency ~ 100 μs (默认 10 ms+).

PREMPT_RT 用例: automotive (electric vehicle 中 BlueZ, ROS), industrial control, audio lowest latency.

## 4. Real-time 延迟常数

```
CFS (stock kernel): 50 μs -> SECENDUST script best-but-p99 ~ 10 ms;
PREEMPT_RT kernel: ~ 100 μs p99 ~ 200 μs 配 CPU isolation;
PREMPT_RT + CPU isolation (isolcpus + nohz_full): ~ 20 μs p99;
Xenomai / RTAI co-kernel: < 5 μs;
ARM Cortex-R / FPGA 双核 RT: < 1 μs.
```

工业 automotive sensor fusion / motor control 设置一般要 < 100 μs. Linux PREEMPT_RT 可达成. 1 μs 级要 FPGA co-processor / Cortex-R.

## 5. 时延抖动来源

1.irq 创建 periodic timer tick;
2. tabnentiated m -burst time latch (CPU isolation).
3. spinlock hold time;
4.smp guest VM hypervisor exit cost;
5.内存管理 hot path cache miss / swap-in;
6.GPUAdditionally resource scheduler.

工程通过将实时任务**完全无中断跑**

```
isolcpus=2-3      # 在 boot 让 CPU 2-3 不接 irq, 永不会被 scan balance
nohz_full=2-3     # 不定时 tick
rcu_nocbs=2-3     # RCU callback 不在这 CPU
tuned-adm profile realtime
preempt=full
```

process 上: 
```bash
chrt -f 99 ./my_realtime_task
chrt -d -t 10000 -p 100000 ./sdl_task   # SCHED_DEADLINE 10 ms / 100 ms
```

CPU affinity:
```c
cpu_set_t set;
CPU_ZERO(&set); CPU_SET(2, &set);
pthread_setaffinity_np(pthread_self(), sizeof(set), &set);
```

## 6. ARM Cortex-R / 调度器硬件最后形态

车规 / electrical 调速控电磁机 < 1 μs 延迟不能轮. ARM Cortex-R / RISC-V 上的 MT (motor timer) ISR Direct interrupt classification < 100 ns open + deliver to register to rt5 chip actuator. 这是 Linux PREEMPT_RT 击退卸交硬件 RT core.

代码模式:
```c
// 裸金属 Cortex-R 上
__attribute__((interrupt("IRQ"))) void timer_handler() {
  // bare-metal handler
  ...
}
```

eBPF + 嵌入式 Linux 用 BLabs + 专用 RT core. Sisoft follow 上 hardware RT 类同构 = 抽象在硬件层就是"timer ISR 直接跑 with 跟 lane bandwidth".

## 7. 这章带走的东西

- SCHED_FIFO/RR 是有危险可饿死, 须小心;
- SCHED_DEADLINE 基于 EDF + utilization 健康 check;
- PREEMPT_RT 让 Linux kernel RT, 自 Linux 6.12+ mainline;
- 配 CPU isolation + nohz_full 时 接 < 100 μs;
- 真硬 < 1 μs RT 只能 Cortex-R / FPGA co-processor / Xenomai.

下一节 → [GMP 模型](gmp.md)
