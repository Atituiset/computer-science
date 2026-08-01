# 2. 摊还 vs 最坏: 工程常数与硬实时的张力

## 一句话

"摊还 O(1) = 最坏 O(n) 的Hidden 形式" —— 即一个序列总和为常数 × n, 但**某些操作本身代价是 n**. 在 ES/在线 ETA 教科书里这区别不大, 但在工程中**摊还分析假设"操作序列连续执行"**. 一旦硬实时受限 (HFT、AVB/TSN、游戏 tick、音视频 P99 严格)—**摊还的最坏可被无限放大**.

## 把摊还误读的代价

考虑一个具体场景:

```
HFT tick 数据流, 每秒 5 M 个 tick. 用 std::vector 缓冲.
- 平均每 push 1 cycle;
- 第 2^23 次 push 触发扩容: malloc 16MB (syscall), memset 写下去,
                            copy. 200~800 μs.
```

平均 1 cycle = 0.3 ns, 但 P99 = ~500 μs. CI/CD 系统看平均完全没问题, 但 500 μs 抖动在 HFT 上 ≈ 大于 tick interval, 一帧 dropped. 这一类 bug 工程上叫**摊还 bug**, debug 时你只能靠 strace / ftrace 才能抓到 syscall. 平均 latency 看起来完美.

## 摊还成立的前提

摊还分析假设:

1. 操作序列长时间运行 (∞);
2. 不在批次之间有 deadline;
3. 失败回滚不影响别人.

如果其中之一被破坏, **摊还就等于最坏**.

## 工程上的"反摊还"模式

工程师在硬实时场景下本能上选**最坏可预测的结构**:

| 场景 | 通常摊还结构 | 改造为最坏可预测 |
|------|--------------|------------------|
| HFT ringorder book | `std::vector` | 固定容量 ring buffer |
| 高频 network buffer | `std::vector pkt` | `boost::lockfree::queue` 或固定容量 |
| 视频采集 buffer | `std::vector<Frame>` | `SPSC` + dual/triple buffering |
| 极低延迟 hash table | `std::unordered_map` | iCloud fixed-cap open-addressing + spin |
| 数据库 key buffering | `std::vector` | page-aligned ring + WAL ordering |

**核心模式**: 用**固定容量 + 环状替换** 替代"动态扩容". 摊还 O(1) 变成严格 O(1).

## 硬件层:DMA buffer 在工程层的物化

理解 DMA:

```
PCIe TLP 一次 128B / 64B;
async + interrupt链;
DMA descriptor 入 ring queue;
内核/网卡维护 RX ring 与 TX ring, 各 N 个 descriptor, 生产者/消费者环绕替换.
```

这个 ring 的工作模式 = lock-free ring buffer. **网卡 / SSD 控制器都是按 ring 设计**: DMA 写 ring 的 head, 内核读 ring 的 tail, 头尾互不修改对方, 只 atomic load 自己分配的指针. 这种 lock-free ring 在硬件层是工程界"摊还问题解决方式"的最 deep 答案.

## FPGA 层

FPGA 上几乎所有数据通路是 streaming, 没有"扩容" 概念. AxiStream 的 valid/ready 握手双方都要"≤1 cycle 出决定". 一旦有 "1 cycle 没数据" 就 stall, 整流 pipeline bubble 一帧.

所以 FPGA 设计 = 把摊还的全部压力预算在 init / config/reconfiguration 阶段, **运行时永远不走 O(n) 操作**. 这是工程项目上 FPGA 高可靠的关键: clocked 同步模型一旦确定运行后是**强确定性** 的.

## 多语言同时性的摊还差异

| 语言 | 隐含的摊还尖刺 | 显式 mitigation |
|------|----------------|-----------------|
| Go | `append` 扩容 + GC STW | `runtime.GCMaxStall` 控制 + `make` 预分配 |
| Java | HashMap rehash | ConcurrentHashMap 的 segment/sync |
| Python | dict resize | incremental rehash (3.6+), 但 GC 来时仍有 GC stop |
| C++ | `vector::push_back` 扩容 | `reserve` + 内存池 |
| Rust | `Vec::push` 扩容 | `Vec::with_capacity` + `Box` |

各语言都提供 mitigation, **但 mitigation 永远是 explicit**. 默认行为留给惊讶. 写高 QPS 服务的工程师必须形成反射: **预分配容量 = 第一习惯**.

## 这一章带走的东西

- 摊还 = 平均, 不 = 最坏. **硬实时场景必须考虑最坏**;
- Network ring、DMA ring、FPGA stream 都是工程层"判摊还杀掉最坏尖刺"的物化;
- 各语言默认行为都带摊还尖刺, 必须**显式预分配 / 上 lock-free**;
- "P99 是衡量工程抖动的唯一标准" — 摊还告诉你平均, P99 告诉你抖动.

下一篇 → [分治 vs 贪心 vs DP](decomposition-strategies.md)
