# 进程与线程调度

## 一句话

OS 调度器是工程上最被低估的 OS 子系统。一台 64 核服务器同时跑 5000 个线程，**谁先跑谁等谁抢核全靠 scheduler**. 它决定了你 P99 抖动来自哪里。这一节把 CFS / 实时调度类 / GMP / Cgroup v2 都拆到底层，让你看清楚**每种调度模型的物理形态**——而更重要的是看出"为什么 Linux 5.x 后的 EEVDF 调度器替换了 CFS"，背后是同一组抽象层升级.

- [Linux CFS 调度器](cfs.md)
- [实时调度：SCHED_FIFO / RR / EDF](rt.md)
- [goroutine GMP 模型](gmp.md)
- [Cgroup v2、CPU 迁移与亲和](cgroup.md)
