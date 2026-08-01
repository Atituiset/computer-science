# 锁与同步原语

## 一句话

锁是 OS 里**最抽象、最细颗粒、最 kernel 硬件协同**的层。每个语言 runtime 都会重新发明它一遍, 但内核里锁的实现细节涉及到 atomic 指令、cache 一致性协议、NUMA 拓扑、cqbarrier, 把锁一直拓到指令流水线和 DRAM 的 MESI 协议. 这章把 mutex 内部、RCU/seqlock、memory model、lock-free 数据结构拆开, 让你看到用 std::mutex `lock()` 后面真正发生了什么.

- [futex、CAS、spinlock 内部](futex-cas.md)
- [RCU、seqlock、brlock](rcu.md)
- [内存模型与 memory barrier](memory-barrier.md)
- [lock-free / wait-free 数据结构](lockfree.md)
