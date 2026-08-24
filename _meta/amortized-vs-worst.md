# 2. 摊还 vs 最坏: 工程常数与硬实时的张力

## 一句话

"摊还 O(1)" 并不等于 "每一次都是 O(1)" —— 它只承诺**一个足够长的操作序列总和是 O(n)**, 而序列里的某些单次操作本身代价是 O(n). 在一般算法教科书里这个区别无关痛痒, 但在工程中**摊还分析隐含了"操作序列会连续执行下去"这一前提**. 一旦场景是硬实时 (HFT、AVB/TSN、游戏 tick、音视频 P99), **摊还的最坏情况就会被无限放大成一次事故**.

## 思想链

```
工程问题: 平均 1 cycle 的 push, 为什么 P99 会炸出 500 μs?
  └─► 摊还分析把"偶尔一次的 O(n)"平摊进长序列
        └─► 前提1: 操作序列长时间运行 (∞ 极限下才成立)
        └─► 前提2: 批次之间没有外部 deadline
        └─► 前提3: 失败可重试, 尖刺不传染给别的请求
  └─► 任一前提被打破 (硬实时 / 有界 deadline / 尖刺传染)
        └─► 摊还退化成最坏: malloc + memset + copy 全部落在一个请求上
              └─► 工程解法: 固定容量 + 环形复用, 摊还 O(1) 变严格 O(1)
                    └─► 硬件早就这么干: DMA descriptor ring / NVMe SQ-CQ
```

## 把摊还误读的代价

考虑一个具体场景:

```
HFT tick 数据流, 每秒 500 万个 tick. 用 std::vector 缓冲.
- 平均每次 push 约 1 cycle;
- 第 2^23 次 push 触发扩容: malloc 16MB (syscall), memset 写一遍,
  再把旧数据 copy 过去 —— 单次耗时 200~800 μs.
```

平均 1 cycle ≈ 0.3 ns, 但 P99 ≈ 500 μs. 只看平均值的监控完全无感, 但 500 μs 的抖动在 HFT 上已经超过一个 tick interval——直接丢一帧. 这一类 bug 工程上叫**摊还 bug**, 排查时只能靠 strace / ftrace 抓到那次隐藏的 syscall; 平均延迟曲线上看起来一切完美.

> [!WARNING]
> 只看平均值 (甚至只看 P95) 的监控会系统性掩盖摊还尖刺. 判断服务是否吃了摊还亏, 直接看 max / P99.9 与 GC/alloc 日志的相关性; 性能方法论见 [性能工程: profiling / 火焰图](../engineering/performance-engineering.md).

## 摊还成立的前提

摊还分析假设:

1. 操作序列长时间运行 (∞);
2. 批次之间没有 deadline;
3. 失败回滚不影响别人.

如果其中任何一条被破坏, **摊还就等于最坏**.

> [!NOTE]
> 摊还分析的严格定义与聚合法 / 记账法 / 势能法三种证明工具, 见 [摊还分析入门](../dsa/algorithms/complexity/amortized.md); 本章关心的是它作为工程假设什么时候失效.

## 工程上的"反摊还"模式

工程师在硬实时场景下本能地选**最坏可预测的结构**:

| 场景 | 通常的摊还结构 | 改造为最坏可预测 |
|------|--------------|------------------|
| HFT 订单簿 (order book) | `std::vector` | 定容 ring buffer + 对象池 |
| 高频网络收包缓冲 | `std::vector<Packet>` | `boost::lockfree::queue` 或定容 ring |
| 视频采集缓冲 | `std::vector<Frame>` | SPSC ring + 双/三缓冲 |
| 极低延迟哈希表 | `std::unordered_map` | 定容开放寻址 (open addressing) + spinlock |
| 数据库日志缓冲 | `std::vector` | page 对齐 ring + WAL 顺序化 |

**核心模式**: 用**固定容量 + 环形复用**替代"动态扩容", 把扩容成本一次性付清. 摊还 O(1) 就变成了严格 O(1).

## 硬件层: DMA ring 是"反摊还"的物化

理解 DMA 的工作方式:

```
PCIe TLP 一次搬运 128B / 256B;
异步 + 中断链路;
DMA descriptor 排成 ring queue;
内核与网卡各维护 RX ring 与 TX ring, 各含 N 个 descriptor,
生产者/消费者沿环形推进.
```

这个 ring 的工作模式就是一个 lock-free ring buffer. **网卡和 SSD 控制器都按 ring 设计**: DMA 写 head, 内核读 tail, 两边互不改写对方的指针, 各自只 atomic 推进自己负责的那一个. 这种 lock-free ring 是硬件层对"摊还问题"给出的最彻底答案——运行期永远没有分配和搬移, 所有容量在初始化时一次付清.

> [!NOTE]
> NVMe 把这套 ring 思想直接暴露给了主机软件: 64K 个 Submission Queue / Completion Queue 对, 无锁提交 + 可选 polling. 队列模型细节见 [存储硬件: NAND Flash / SSD FTL](../computer-arch/ssd-storage.md); 用户态等价物见 [epoll / kqueue / io_uring 对比](../os/net/epoll-iouring.md).

## FPGA 层

FPGA 上几乎所有数据通路都是 streaming 的, 没有"扩容"概念. AXI-Stream 的 valid/ready 握手要求双方每一拍都能给出决定; 一旦某一拍没有数据, 流水线就 stall, 整条 pipeline 出现一个 bubble.

所以 FPGA 设计 = 把全部容量与缓冲预算放在 init / configuration / reconfiguration 阶段完成, **运行时永远不走 O(n) 操作**. 这是 FPGA 项目高可靠的关键: 同步时钟模型一旦部署运行就是**强确定性的**.

## 多语言视角下的摊还差异

| 语言 | 默认行为里的摊还尖刺 | 显式缓解手段 |
|------|---------------------|---------------|
| Go | `append` 扩容 + GC 停顿 | `make(T, 0, n)` 预分配 + GOGC/GOMEMLIMIT 调参 |
| Java | HashMap rehash | `ConcurrentHashMap` 或预估容量构造 |
| Python | dict resize 一次性重建 | 无法显式预留; 大表改用 list 下标或预估规模建大 |
| C++ | `vector::push_back` 扩容 | `reserve` + 内存池 |
| Rust | `Vec::push` 扩容 | `Vec::with_capacity` + `Box` |

各家都提供了缓解手段, **但缓解永远是显式的**: 默认行为里藏着惊吓. 写高 QPS 服务的工程师必须形成反射: **预分配容量是第一习惯**.

## 这一章带走的东西

- 摊还 = 平均, 不等于最坏. **硬实时场景必须按最坏做预算**;
- 网络 ring、DMA ring、FPGA stream 都是硬件层"消灭摊还尖刺"的物化;
- 各语言的默认容器都带摊还尖刺, 必须**显式预分配 / 上 lock-free 结构**;
- 平均值告诉你吞吐, P99 告诉你抖动——**衡量实时性只能看尾部**.

## 一页速查

| 维度 | 摊还视角 | 最坏视角 |
|------|----------|----------|
| 典型结构 | 动态数组 / 均摊哈希表 | 定容 ring buffer / 定容开放寻址哈希 |
| 承诺强度 | 序列总和 O(n) | 每一次操作都有界 |
| 尖刺来源 | 扩容 malloc+copy / rehash / GC | 无 (成本在初始化时一次付清) |
| 适用场景 | 吞吐优先的后台与批处理 | HFT / 游戏 tick / 音视频 / 控制 P99 |
| 工程动作 | 不用管 | `reserve` / `with_capacity` / `make(T,0,n)` |
| 监控指标 | 平均延迟 | P99 / P99.9 / max |

下一篇: [3. 分治 vs 贪心 vs DP: 什么是"最优子问题分解"](decomposition-strategies.md)
