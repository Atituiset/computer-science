# 第二部分 · 操作系统

## 一句话

操作系统把硬件"驯化"成你可以写代码的虚拟机：它把 CPU 时间切成片让多个程序同跑、把内存切成页让进程互不踩脚、把磁盘抽象成字节流让 IO 透明、把进程间冲突变成锁与同步原语——**你写 hello world 时调用的每个 printf、每个 malloc、每个 epoll 都至少穿过这两层抽象**。理解 OS 就是理解你写的代码底下被自动做了什么、什么时候会失效、失效的代价。

## 这一部分的章节

- [内存](memory/index.html)
- [文件系统](fs/index.html)
- [进程与线程调度](sched/index.html)
- [锁与同步原语](lock/index.html)
- [虚拟化与容器](virtualization.md)
- [IO 与网络栈](net/index.html)

## 阅读策略

读完这一部分，你得能回答：
- `malloc(1M)` 实际返回到 use 之前 Linux 内核做了什么？
- 为什么线程间抢占的 cache line 是性能杀手？
- 为什么 epoll 边沿触发要配 O_NONBLOCK？
- 为什么用 fsync 也可能丢数据？
- BBR 比 Cubic 收益在哪？

每个问题都串多个抽象层：
- 用 **strace / perf / ftrace** 看实际系统调用；
- 用 **eBPF / bpftrace** 看内核态内部；
- 拓到 **CPU cache / NUMA / NVMe** 物理层；
- 必要时引到 **FPGA / SmartNIC** 上的 bypass 路径。

OS 的故事是硬件 + 抽象 + 工程现实反复折中。读完这一部分，看回去 DSA 里的 cache-friendly 那一段你会更顺，因为 OS 把那些底层都编程化了。
