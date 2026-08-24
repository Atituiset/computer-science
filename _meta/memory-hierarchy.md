# 4. 缓存层级: 从 L1 到 CDN 的全栈同构

## TL;DR

一个硬件工程师、一个内核开发者、一个 DBA 和一个 SRE 坐在一起争论"谁的 cache 最聪明"。结果发现所有人的 cache 都是一个模板出来的: **hit/miss 二分判定 → 按块取数据 → 替换策略淘汰 → 一致性协议同步多副本 → 写策略决定脏数据何时落下一层**。从 1ns 的 L1 到 50ms 的 CDN edge，延迟跨越 7 个数量级，但**抽象模型完全不变**。整个计算机的体系结构是一部递归的 cache 层次模型——你学透一层，就学透了所有层。

---

## 一、全栈延迟光谱: 一张表看尽所有 cache 层

先把这个宇宙摊开。从 CPU 管芯内到地球对面的 CDN POP，每一层都在玩同一个游戏: "用空间换时间，用高一层的小容量低延迟，缓存下一层的大容量高延迟数据"。

| 层级 | 容量 | 延迟 | 单位块大小 | 替换策略 | 一致性协议 | 详述章节 |
|------|------|------|-----------|---------|-----------|---------|
| 寄存器 | ~16 KB 全 CPU | <1ns | 8B (x86) / 16B (SIMD) | 编译器分配 (graph coloring) | 无需 (单消费者) | [isa-design.md](../computer-arch/isa-design.md) |
| L1 D-cache | 48-128 KB | ~1ns (4-5 cycle @ 4GHz) | 64B line | PLRU / RRIP (硬件) | MESI/MOESI/MESIF | [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) |
| L2 cache | 256KB-16MB | ~4-16ns | 64B line | PLRU / RRIP (硬件) | MESI/MOESI/MESIF | [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §三-五 |
| L3 cache | 4-96MB | ~12-50ns | 64B line | BRRIP / Adaptive (硬件) | Directory-based (硬件) | [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §七 |
| TLB (L1/L2) | 64-1536 项 | 1-7 cycle | 4KB / 2MB / 1GB page | LRU (硬件) | TLB Shootdown (IPI) | [mmu-dma.md](../computer-arch/mmu-dma.md) §3 |
| 3D V-Cache | 额外 64MB L3 | ~40ns (+4 cycle penalty) | 64B line | 同 L3 | 同 L3 | [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §十 |
| DRAM (DDR5) | 8-256GB | ~80-100ns | 64B (cache line fill) / 8Kb (row buffer) | 无 (主存储; OS 换页时做) | 无 (单 master: mem ctrl) | [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §八 |
| HBM3e | 24-36GB / stack | ~50-80ns | 64B / 1024-bit 宽通道 | 无 (同 DRAM) | 无 | [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §九 |
| CXL Type-3 内存池 | 512GB-2TB | ~250-350ns | 64B / cache coherent | OS NUMA 调度 | CXL.cache (MESI 扩展) | [interconnects.md](../computer-arch/interconnects.md) §三 |
| NVMe SSD | 1-30TB | ~50-100µs | 4KB page | FTL firmware (vendor-specific) | 无 (单 master) | [os/fs/filesystems.md](../os/fs/filesystems.md) |
| OS Page Cache | 可用 DRAM 的 80-90% | DRAM hit (~100ns); miss 走 IO | 4KB page | Linux: 双链表 LRU (active/inactive) | 无 (单 OS instance) | [os/fs/inode-pagecache.md](../os/fs/inode-pagecache.md) |
| InnoDB Buffer Pool | 可配 (典型 80% RAM) | DRAM hit (~100ns); miss 走 IO | 16KB page (默认) | 改进 LRU (midpoint insertion) | WAL + doublewrite (crash safety) | [wal-lsm-btree.md](../system-design/storage/wal-lsm-btree.md) |
| RocksDB Block Cache | 可配 (典型 4-64GB) | DRAM hit; miss 走 SSTable | 4-32KB data block | LRU / Clock (Hyper Clock Cache) | LSM compaction (tombstone) | [wal-lsm-btree.md](../system-design/storage/wal-lsm-btree.md) |
| 进程内 Cache (Caffeine) | ~1-8GB (per process) | ~50-500ns | Object-level (variable) | W-TinyLFU (window + count-min sketch) | 无 (多进程不共享, 最终一致性) | [multilevel.md](../system-design/cache/multilevel.md) |
| Redis LRU | ~数 GB-百 GB (per cluster) | ~0.5-2ms (网络 RTT) | Key-level (variable) | allkeys-lru / volatile-lru / LFU | 主从复制 (async, eventual) | [multilevel.md](../system-design/cache/multilevel.md) |
| Memcached | ~数 GB-百 GB (per pool) | ~0.5-2ms | 1MB slab class (per-page) | Per-slab LRU | 无 (无复制, 无持久化) | [multilevel.md](../system-design/cache/multilevel.md) |
| CDN Edge Cache | ~TB per POP | ~5-50ms (从 edge 取); origin miss ~50-300ms | Object-level (HTTP cache) | LRU / 2Q / Hyperbolic (基于 cost) | Purge + TTL invalidation (push/purge) | [multilevel.md](../system-design/cache/multilevel.md) |
| 远端网络 (RDMA) | 跨机 DRAM | ~1-5µs (IB) / ~5-10µs (RoCE) | MTU ~1.5KB / 4KB (RDMA) | 远端内存管理 (pre-registered MR) | IOMMU 隔离 + 单边操作 | [interconnects.md](../computer-arch/interconnects.md) §五; [topologies.md](../distributed/replication/topologies.md) |

这张表的核心信息: **每一层往上走 1-2 个数量级延迟, 往下一层走 1-2 个数量级容量。每一层都有: 命中判定 (hit/miss)、按块传输 (block/line/page/object)、替换 (eviction)、一致性 (多副本同步)、写策略 (write-through / write-back)。** 这五行是 cache 宇宙的"基本力"。

---

## 二、同构性证成: 五个维度逐一展开

### 2.1 命中 / 缺失: 从 TAG 比较到 key lookup

L1 cache 如何判断命中?——把地址拆成 `{tag, index, offset}`, 取 index 找到 set, 比较所有 way 的 tag 位是否匹配 (见 [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §三)。这是纯硬件的 CAM/SRAM 并行比较, 一个 cycle 出结果。

Redis 如何判断命中?——客户端发 `GET user:12345`, Redis 对 `user:12345` 做 hash → 找到 slot → 在 dict 里 key lookup → 返回 value 或 `nil`。延迟从 1ns 变成 0.5ms, 但本质上还是同一个模式: **用 key (地址/字符串) → 查目录 (index/slot) → 比较 tag/键 → 命中了拿数据, 没命中 report miss**。

每次 L1 cache miss 触发一次 DRAM 访问 (见 [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §二: tRCD + tCL + tRP ≈ 45ns 的 DRAM 随机读流程)。每次 Redis miss 触发一次 DB query → 网络 RTT → SQL parse → buffer pool lookup → IO (如果也不在 buffer pool 里)。抽象上这两个流程的形状完全一致: **miss → 下一层按块取 → 填回本层 → 返回数据**。

TLB 的命中判定是这个模式的又一实例: TLB 是一张极小的全相联/组相联 SRAM (见 [mmu-dma.md](../computer-arch/mmu-dma.md) §3.2), 以 `{VA, ASID/PCID}` 为 key, `{PA, permissions}` 为 value。TLB miss 触发硬件页表遍历 (page table walk)——逐级读 PML4E → PDPTE → PDE → PTE (见 [mmu-dma.md](../computer-arch/mmu-dma.md) §2.2), 每级一次 DRAM 随机读, 共 4 次 × 100ns = 400ns。这和一次"Redis miss → 查 Postgres → 回填 Redis"的流程在逻辑结构上完全没有区别——TLB 就是一个物理地址的 cache, 页表遍历就是 cache miss 的 penalty path。

### 2.2 替换策略: 从 PLRU 到 W-TinyLFU 的同构演化

硬件 cache ([memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §五) 受限于硅面积和功耗预算, 只能在 PLRU、RRIP、BRRIP 等接近但非精确的 LRU 近似上做文章。L1 用简单的 PLRU (一个 per-set 的小状态机), L3 用 BRRIP (扫描行插入时直接给"即将淘汰"的优先级以保护常驻热数据)。

软件 cache 拿到了更充裕的算力预算, 于是可以在 Caffeine 里跑 W-TinyLFU——Window 小队列处理 burst access, Count-Min Sketch 做频率统计, SLRU 主队列根据频率 + 最近性做淘汰 (见 [multilevel.md](../system-design/cache/multilevel.md))。这个算法比 BRRIP 聪明, 但它和 BRRIP 要解决的问题是同一个: **"怎么区分一次扫描 (永远不会再访问) 和真正的热点 (会反复访问)"**。硬件用 re-reference interval 预测, 软件用 count-min sketch 计数——手段不同, 问题同构。

Linux page cache (见 [os/fs/inode-pagecache.md](../os/fs/inode-pagecache.md) 和 [os/memory/replacement.md](../os/memory/replacement.md)) 用双链表 LRU: active list (刚被访问或访问过两次) 和 inactive list (上次访问距今较远)。当 inactive list 中的 page 被再次访问, 它 promote 进 active list。这实质上是 ARC (Adaptive Replacement Cache) 的一个简化版本: **维护两个队列, 动态调整两者之间的平衡, 以自适应"扫描"和"热点"两种 workload**。

InnoDB Buffer Pool (见 [wal-lsm-btree.md](../system-design/storage/wal-lsm-btree.md)) 也用了改进版 LRU: midpoint insertion——新读入的 page 不放在 LRU 头部, 而是放在 5/8 位置 (midpoint)。这样一次全表扫描不会把真正的热点全部挤出 LRU (扫描到的 page 从 midpoint 开始, 很快被淘汰; 反复访问的 page 自然晋升到头部)。这是 BRRIP 的软件版本: 扫描行以"即将淘汰"的起点入场, 避免污染热数据。

替换策略的同构: **无论硬件 cache 还是软件 cache, 算法的核心矛盾都是"保护热数据不被扫描冲走"**。硬件用 RRPV, 软件用 midpoint insertion / W-TinyLFU / ARC——本质都是给新进来的数据一个"试用期", 只有证明自己是热的才能留下来。

### 2.3 一致性协议: MESI ↔ Paxos/Raft 的深层同构

这是全章最核心的洞察。重新审视 [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §六和 [paxos.md](../distributed/consensus/paxos.md) 之后, 你会发现 **MESI 就是硬件尺度的 Paxos**。

```
MESI (4 个 core 共享一个 cache line):
  - Core 0 有 line 在 Modified 状态 (dirty, exclusive owner)
  - Core 1 想读同一 line → 发 snoop 请求
  - Core 0 必须响应: 把脏数据转发给 Core 1 (或写回 DRAM), 自己降到 Shared
  - Core 2 想写同一 line → 发 RFO (Read For Ownership)
  - 总线广播 invalidate → 所有其他 core 的 Shared copy 失效 → Core 2 得到 Exclusive → 提升到 Modified

Paxos (5 个节点对一个 log entry 达成共识):
  - Leader (Proposer) 有 proposal n, value v
  - Phase 1 (Prepare): 发 proposal number n 到 majority, 收集 promise (承诺不再接受 <n 的 proposal)
  - Phase 2 (Accept): 让 majority accept (n, v)
  - 任何新的 Proposer 发起更高 n' 的 Prepare → 必须从前一轮的 accepted value 中学习已决定的 v
  
同构点:
  - MESI 的 Modified → Exclusive 的"写回/转发" ≈ Paxos 的"新 proposer 学习已 accepted 的 value"
  - MESI 的 invalidate 广播 ≈ Paxos 的 Quorum overlap (任意两个 majority 必相交)
  - MESI 的 directory protocol (精确发送 invalidate 给持有者) ≈ Multi-Paxos 的"只需要稳定 leader 与 followers 通信"
  - MESI 的 MOESI Owned 状态 (转发脏数据但不写回 DRAM) ≈ Raft 的 leader 向 follower 复制 log entry, 然后 commit
```

这两个协议的核心机制几乎逐行对应:

| 概念 | MESI (硬件) | Paxos/Raft (软件) |
|------|-----------|-------------------|
| 状态机 | 4 状态: M/E/S/I → 5/6/7 状态 (MOESI/MESIF) | Follower/Candidate/Leader → log state machine |
| 排他权获取 | RFO (Read For Ownership) 总线事务 | Leader election (RequestVote) |
| 数据传播 | Snoop 广播 / Directory 精确发送 | Leader AppendEntries → followers |
| 脏数据写回 | eviction 时 write-back 到下一层 | follower commit 后 ack leader |
| 冲突解决 | 总线仲裁 (priority) / Directory 顺序化 | Term number 单调递增 (高 term 胜) |
| 共享态降级 | Invalidate 广播 → 所有 S 变为 I | Leader 切换 → 旧 leader 降级为 follower |
| 一致性边界 | 单个 cache coherence domain (socket/CCD) | 单个 Raft group / Paxos instance |

同样的性质也体现在分布式缓存中: Redis 主从复制 (见 [multilevel.md](../system-design/cache/multilevel.md)) 是 MESI Shared 状态的软件化——主节点持有 writable copy (≈ Modified), 从节点持有 read-only copy (≈ Shared)。主节点写入后异步传播到从节点 → 这和 write-back cache 的"先改本地, 延迟传播到下一层"逻辑一致。CDN 的 purge/invalidation 机制 (见 [failure-modes.md](../system-design/cache/failure-modes.md)) 则是 MESI Invalidate 的全网版本: 源站更新了对象 → 发 PURGE 请求到所有边缘节点 → 边缘节点把旧副本标记为 invalid → 下一次请求触发 miss 回源。

**为什么分布式一致性算法的 paper 那么难读?** 因为它在软件层重新发明了 MESI 已经在硬件层做过的事情——但多出了网络分区、消息丢失、时钟不可靠这些物理约束, 导致协议多了好几层复杂度。MESI 的通信介质是芯片内铜互联 (确定性延迟, 总线不丢包, 电压信号无歧义), Paxos 的通信介质是 UDP/IP 网络 (不确定性延迟, 丢包, 拜占庭行为可能)——**同样是分布式一致性, 底下的信道的可靠性差异决定了上层协议的复杂度差异**。

### 2.4 查找结构: TLB → 页表 → 数据库索引

这组同构更直接, 但也更容易被忽略。看 [mmu-dma.md](../computer-arch/mmu-dma.md) §1-3 和 [os/memory/virtual-memory.md](../os/memory/virtual-memory.md), 再对比 [wal-lsm-btree.md](../system-design/storage/wal-lsm-btree.md) 的 B-tree 索引结构:

```
TLB          = 虚拟地址 → 物理地址 的 cache
页表         = 虚拟地址 → 物理地址 的完整映射表 (存在 DRAM 里)
B-tree 索引  = key → row location 的完整映射表 (存在磁盘上)
```

TLB 对页表的关系, = Buffer Pool 对 B-tree 索引的关系。**TLB 是页表的 cache, Buffer Pool 是 B-tree 索引的 cache。** 一次 TLB miss 触发 page walk (4 次 DRAM 读, 见 [mmu-dma.md](../computer-arch/mmu-dma.md) §2), 一次 buffer pool miss 触发 B-tree 遍历 (从 root page 一路 seek 到 leaf page, 若干次 IO)。命中时都是 O(1) 的直接查找, miss 时都要走完整的索引遍历——然后**把翻译结果 (PTE / leaf page) 缓存回高速结构中以备后用**。

更大的同构: 即使是 DNS (域名 → IP) 也是一种 cache 层次——`/etc/hosts` 是 L1 (本地, 1µs), local DNS resolver cache 是 L2 (本机, ~1ms), upstream DNS 是 L3 (网络, ~10-50ms), 权威 DNS 是 origin (从 zone file 查, 最慢)。递归查询的流程和 TLB miss → page walk → 填回 TLB 的流程一模一样。

### 2.5 宽总线 vs 窄快速: HBM / NVLink / RDMA 的同一模式

从 [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §九 (HBM3 的 1024-bit 宽总线 + TSV 堆叠) 到 [interconnects.md](../computer-arch/interconnects.md) §四 (NVLink 4 的 900 GB/s 点对点宽带) 再到 [interconnects.md](../computer-arch/interconnects.md) §五 (RDMA 的远程内存直接访问), 它们在解决同一个问题:**延迟不能降, 就加宽通道, 用并行换吞吐**。

```
HBM3:   1024-bit bus × 6.4 Gbps = 819 GB/s per stack
        TSV 堆叠 12 层 DRAM die → 物理距离 mm 级 → 延迟 ~50ns
        "既然 DDR5 DIMM 的 64-bit 太窄, 我直接把 1000 根线铺过去"

NVLink 4: 50 GB/s per link × 18 links per H100 = 900 GB/s
        点对点专用链路 → 不共享, 不仲裁 → 延迟 ~100ns
        "既然 PCIe x16 = 64 GB/s 不够, 我直接把 18 条独立链路放上去"

RDMA:    400 Gbps InfiniBand NDR = 50 GB/s per port
        单边操作绕过远端 CPU → 延迟 ~1µs
        "既然 kernel TCP stack 延迟太大, 我让网卡 DMA 引擎直接读写远端 HBM"
```

这三个技术的共同模式可以抽象为:**"你感觉延迟高, 不是因为信道传输慢, 是因为串行化、协议栈、共享仲裁在吃掉你的时间。把通道变宽、把协议变薄、把仲裁去掉, 延迟自然降下来。"** HBM 用物理堆叠和极宽总线去掉 DDR DIMM 的封装/走线/仲裁延迟; NVLink 用专用点对点链路去掉 PCIe 树形拓扑的 switch 延迟; RDMA 用单边动词 (RDMA Write/Read) 去掉远端 CPU 中断 + 内核协议栈延迟。三者在不同尺度上, 实现的是同一个工程原则。

---

## 三、Memory Wall: 一个概念贯穿所有层级

"Memory Wall"(Wulf & McKee, 1995) 的原始含义是: **CPU 算力每年增长 55%, 而 DRAM 延迟每年只改善 7%**。25 年后, 这个趋势不仅没有收敛, 反而扩散到整个栈:

### 每层 Memory Wall 的表现

| 层级 | 计算侧 | 存储侧 | Wall 表现 |
|------|--------|--------|----------|
| GPU SM / Tensor Core | 1979 TFLOPS (H100 FP8) | HBM3e 3.35 TB/s | **每 FLOP 只有 ~1.7 字节带宽**。一个 matmul 如果数据重用不够, 算力根本吃不饱。 |
| CPU core | 5-6 IPC × 4GHz = ~20 B ops/s | DDR5 100 GB/s | **每操作 ~5 字节带宽**。pointer chasing (链表/树/图遍历) 是 MLP=1 的串行 miss, 带宽被闲置。 |
| 数据库 scan | SIMD 扫描 64B/cycle | NVMe 7 GB/s | **PCIe 4.0 x4 = 7 GB/s。CPU 的 scan 速度是 NVMe 的 ~10 倍**——列存压缩 + 下推 filter 就是为了"不让 IO 成为瓶颈"。 |
| 分布式训练 | 8 GPU × 1979 TFLOPS | NDR 400 Gbps = 50 GB/s per GPU | **跨节点 all-reduce 梯度同步的带宽只有 GPU 内部带宽的 1/70**。TP 必须在 NVLink 域内, PP/DP 才跨 InfiniBand。 |
| Redis 集群 | 单节点 100K QPS (单线程) | 网络 10-25 Gbps = 1.25-3.125 GB/s | **算力充足但网络带宽是瓶颈**——Redis 集群的规模上限由网卡带宽和延迟决定, 不是由 CPU 决定。 |

### 量化 Wall: 从参数看鸿沟

以 NVIDIA H100 (2022) 为例:
- **计算**: 1979 TFLOPS (FP8) = 每秒 1.979 × 10^15 次乘加
- **HBM3e 带宽**: 3.35 TB/s = 每秒 3.35 × 10^12 字节
- **每 FLOP 可用字节**: 3.35 × 10^12 / 1.979 × 10^15 ≈ **1.7 字节/FLOP**

一个 FP8 matmul 需要: 每输出元素读 A 的 1 行 + B 的 1 列 = O(N) 个元素, 写 O(N) 个元素。如果 N 很大, **带宽根本跟不上算力**——这是为什么 FlashAttention 要通过 block-wise tiling 把数据块留在 SRAM 里循环用, 而不是反复读 HBM。HBM 3.35 TB/s 听起来很大, 但除以 1979 TFLOPS 后少得可怜。

把同样比例拉到 CPU 侧:
- **AMD Zen 5 core**: 4 ALU + 3 AGU, 4GHz, 每周期可 issue 8 条微指令
- **DDR5-5600 单通道**: 44.8 GB/s = 每秒 4.48 × 10^10 字节
- **每操作可用字节**: 约 1.4 字节/操作 (假设 8 IPC × 4GHz = 32G ops/s)

顺序访问 (row buffer hit) 时可以达到 ~40 GB/s, 但随机访问 (每次换 row → tRCD + tRP) 时吞吐只有 ~1.4 GB/s per channel (见 [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §二)——**实际的带宽可用率在随机 workload 下坍缩到标称的 3%**。

### Wall 驱动了哪些工程决策

- **HBM ([memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §九)**: 既然 DRAM 延迟降不下去, 就用 TSV 堆叠把内存物理搬到离计算 die 0.1mm 以内的距离 + 1024-bit 宽总线把带宽硬顶上去。**代价是 $15-20/GB vs DDR5 的 $3-4/GB。**
- **3D V-Cache ([memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §十)**: 既然去 DRAM 太慢, 就在计算 die 正上方再焊一层 64MB SRAM。**加 4 cycle 跨层延迟, 省掉 400 cycle 的 DRAM miss。**
- **CXL 内存池化 ([interconnects.md](../computer-arch/interconnects.md) §三)**: 既然 Memory Wall 导致很多服务器的 DRAM 闲置 (利用率 50-60%), 就用 CXL 把闲置内存动态分配给需要的节点。**~300ns 的 CXL.mem 延迟比本机 DRAM 的 100ns 高一倍, 但比 swap/SSD 的 100µs 快 300 倍。**
- **NVLink ([interconnects.md](../computer-arch/interconnects.md) §四)**: 既然 PCIe 5.0 x16 = 64 GB/s 远不够 GPU all-reduce 的带宽需求, 就自建 7× 带宽的专用链路。**NVLink 护城河的本质是 Memory Wall 护城河——没有 NVLink 就无法做 TP, 不做 TP 就无法训练大模型。**
- **LSM Compaction ([wal-lsm-btree.md](../system-design/storage/wal-lsm-btree.md))**: Memory Wall 迫使 LSM-tree 以 MB 为单位做后台 compaction——不是"这么做更优雅", 是"不批量 IO 的话每次随机读 100µs, Level 4 → Level 5 的 compaction 跑一个月也跑不完"。**Compaction 的单位 (MB) 由 SSD 的带宽/延迟比决定。**
- **Redis 集群 sizing ([multilevel.md](../system-design/cache/multilevel.md))**: Memory Wall 解释了为什么 Redis 集群的容量上限不是 RAM 大小, 而是"单节点的网络带宽 ÷ 平均 key size"。一台 25 Gbps 网卡的 Redis 节点, 对小 key (100B) 的理论 QPS 上限是 25Gbps / 8 / 100B ≈ 31M QPS (实际受单线程限制 ~100K), 对大 key (1MB) 的上限是 ~3K QPS。

---

## 四、工程洞察: cache 的五边形通用模型

任何 cache 层都可以被这五个维度的参数完整描述:

```
         Hit/Miss 判定
              │
              ▼
┌─────────────────────────────┐
│  Key → 查找 → Value 或 MISS │
└─────────────────────────────┘
              │
    ┌─────────┼─────────┐
    ▼         ▼         ▼
   命中      缺失       预取
  (1ns~ms) (惩罚延迟) (可选)
    │         │
    │    ┌────▼─────┐
    │    │ 块管理     │ ← 按什么粒度取/填? (64B / 4KB / object)
    │    │ 替换策略   │ ← 满了淘汰谁? (LRU / LFU / ARC / RRIP)
    │    │ 一致性协议 │ ← 多副本怎么同步? (MESI / Raft / purge)
    │    │ 写策略     │ ← write-through 还是 write-back?
    │    └───────────┘
```

**所有 cache 层都是这个五边形的不同实例化。** 硬件 cache 把这五行烧录在硅片上, OS page cache 把这五行实现在内核 C 代码里, Redis 把这五行实现在用户态 `server.c` 里, CDN 把这五行实现在边缘节点的反向代理 (NGINX/Varnish) 里。**理解了这张五边形图, 你就理解了计算机系统中"记忆"的本质。**

### 五维度在每一层的实例化对比

| 维度 | L1 Cache (硬件) | OS Page Cache | InnoDB Buffer Pool | Redis LRU | CDN Edge |
|------|----------------|---------------|-------------------|-----------|----------|
| Hit/Miss 判定 | Tag 比较 (1 cycle) | Radix tree / 哈希查 page | Hash table (page_id → frame) | Hash table (key → robj) | URL + headers → cache key |
| 块大小 | 64B (cache line) | 4KB (page) | 16KB (page, 可调) | Key-value (variable) | HTTP object (variable) |
| 替换策略 | PLRU / RRIP / BRRIP | 双链表 LRU (active/inactive) | Midpoint LRU (5/8 split) | allkeys-lru / allkeys-lfu | LRU / cost-based |
| 一致性协议 | MESI/MOESI/MESIF (bus/dir) | 无 (单 OS kernel) | WAL (crash recovery) + buffer pool mutex | 主从 async replication | Purge / TTL-based invalidation |
| 写策略 | Write-back + write-allocate | Write-back (dirty page → 定期回写) | Write-back (dirty page → checkpoint/WAL) | Write-through (写同时更新 DB/cache) | 源站写 → edge 被动失效或主动 purge |
| 预取 | Next-line / stride / AMPM | readahead (顺序访问检测) | Linear read-ahead (预取 64 pages) | 无 (按需加载) | Pre-warm (主动推热资源到 edge) |

这张对比表是本章所有论点的物证。**同构不是类比, 是严格的 engineering convergence: 面对相同的约束 (容量/延迟/成本之不可能三角), 不同层级的工程方案收敛到了同一组设计模式。**

---

## 五、预取与预热: 另一个跨层同构

cache 不只是"被动地等人来查"。每一层都有主动提前拉取数据的机制, 在硬件叫 **prefetching**, 在软件叫 **cache warming / pre-warming**:

| 层级 | 预取/预热机制 | 原理 |
|------|-------------|------|
| L1/L2/L3 (硬件) | Next-line / Stride / AMPM prefetchers ([memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §十二) | 检测访问模式, 提前发 miss 请求填 line |
| OS Page Cache | readahead (顺序访问检测): `posix_fadvise(POSIX_FADV_WILLNEED)` | 检测到顺序读 → 后台预读后续页面到 page cache |
| InnoDB Buffer Pool | Linear read-ahead: 连续访问 56 个 pages → 预取 64 pages | 和硬件 next-line prefetch 逻辑完全一致 |
| Redis | 无内置 prefetch; 冷启动时用 `--rdb` 或 `DEBUG RELOAD` 从持久化文件恢复 | 恢复本质上是一次性大批量"填 cache" |
| CDN | Pre-warm: 主动推送热文件到 edge POP, 或 `stale-while-revalidate` 在后台刷新 | 等价于"软件 prefetch": 预期会 miss 的对象提前拉 |

**预取的本质矛盾**: 预取太多 → 浪费带宽 + 污染 cache; 预取太少 → miss penalty 无法隐藏。硬件 Stride prefetcher 通过跟踪地址间距来区分"该预取"和"不该预取"的访问流; OS readahead 用 access pattern detection (顺序流的 sequential ratio 判断); CDN pre-warm 用业务先验 (即将上线的大促海报)。三种手段解决的是**同一个带噪声的信号检测问题**: 从历史访问模式中推断未来访问概率。

---

## 六、易错清单

1. **"cache 就是快内存"**: cache 的本质不是"快内存", 是"小内存 + 淘汰算法 + 一致性协议"。把 cache 当成"更快的内存"来用是初学者最常见的错误——实际上 cache 能加速你, 是因为你访问的数据满足时间/空间局部性。如果你用 cache 装随机访问的数据, cache 不但不会加速, 还会因为频繁淘汰和协议开销变得更慢 (见 [memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §十四 §2 false sharing, 以及 [failure-modes.md](../system-design/cache/failure-modes.md))。

2. **"多一层 cache 一定更快"**: 每一层 cache 都加一个 lookup 开销。L1 花了 1ns, L2 花了 4ns, L3 花了 12ns——加上去不是为了让你全走一遍, 是为了 miss 的时候不用直接摔到 100ns 的 DRAM。如果你在软件栈里加了一层 Redis, 但 90% 的请求都是 miss 还回源查 DB, 那你加的不是 cache 加速器, 是延迟累加器。**cache hit rate < 80% 的 cache 层应该被移除或重新设计。**

3. **"一致性协议可以靠最终一致性省掉"**: MESI 的"强一致"代价是总线广播和 directory lookup。Paxos 的"强一致"代价是两轮 RPC + 多数派确认。所以你发明了"最终一致性"——Redis 主从异步复制, CDN TTL 过期后回源。但最终一致性不意味着"没有一致性协议"——它意味着**你把"不一致窗口"的代价转移到了应用层** (见 [failure-modes.md](../system-design/cache/failure-modes.md) §一-三)。缓存雪崩、穿透、击穿本质上都是"一致性协议不够强"时应用层爆炸的表现。

4. **"替换策略不重要, LRU 够用了"**: 如果你的 workload 是固定 hot set (如社交网络的热门帖子), LRU 确实够用。但如果你的 workload 是混合的——90% 的流量来自 10% 的 key, 但每隔 10 分钟有一个批量任务扫过所有 key——LRU 会在扫描过程中把整个热点集合全部刷掉。这就是为什么 W-TinyLFU、ARC、BRRIP、midpoint insertion 要存在: **它们保护的不是"个别的热数据", 而是"热点集合的结构完整性"**。

5. **"Memory Wall 是硬件问题, 软件不用管"**: 正因为 Memory Wall 是物理性的 (光速限制物理距离 → 电容充放电速度限制 DRAM→ 成本限制 SRAM 面积), 软件才必须管。LSM-tree 选择顺序写而不是随机写、列存选择压缩 + late materialization 而不是行存、RocksDB 选择 block-aligned SSTable 而不是按行存——这些软件决策的根因全在 Memory Wall。不明白 DRAM 的 bank/row/column 结构 ([memory-hierarchy.md](../computer-arch/memory-hierarchy.md) §八), 你就不知道为什么 compaction 的 stride 要和 SSD page 对齐。

6. **"TLB 跟我写应用没关系"**: 见 [mmu-dma.md](../computer-arch/mmu-dma.md) §4。一次 TLB miss 的成本是 ~400ns (4 次 DRAM 读做 page walk)。如果一个进程有 256MB working set, 用 4KB 页就需要 65,536 个页表项——远超任何 CPU 的 TLB 容量。用 HugePages (2MB) 则只需 128 个表项, 全部可装入 L2 TLB。PostgreSQL 和 JVM 的生产调优里, `huge_pages = on` 和 `-XX:+UseTransparentHugePages` 能带来 5-15% 的吞吐提升, 这本质上就是把 lookup structure 从"TLB 装不下"改成"TLB 装得下"——和调整 Redis 的 `maxmemory` 保证热数据集全在内存里是同一回事。

---

## 七、这一章带走的东西

1. **整个计算机系统是一部递归的 cache 层次模型。** 寄存器 → L1 → L2 → L3 → DRAM → SSD → 网络 → CDN 的每一层都服从同构的五边形模型: hit/miss 判定 → 按块传输 → 替换 → 一致性 → 写策略。

2. **MESI cache coherence ≈ 硬件尺度的 Paxos。** 状态转换 (M→E→S→I vs Follower→Candidate→Leader)、排他权获取 (RFO vs Leader Election)、数据传播 (snoop multicast vs AppendEntries)、冲突仲裁 (总线仲裁 vs term number)——在硬件域和软件分布式域之间逐行对应。区别仅在于"信道的可靠性": 铜互联不会丢包, UDP 会。

3. **TLB 是页表的 cache, Buffer Pool 是 B-tree 的 cache, `dcache` 是 inode 表的 cache。** 这三个 lookup structure 的 cache 关系是完全同构的: 命中时 O(1) 返回映射, miss 时逐层遍历 → 把结果填入高速结构 → 重试命中。理解了这个模式, DNS、ARP table、路由表、LSM bloom filter——所有 lookup structure 的 cache 机制都统一了。

4. **HBM (宽总线 + TSV)、NVLink (多链路点对点)、RDMA (单边绕过 CPU) 是同一个工程模式:** "延迟降不下去, 就加宽通道、减薄协议栈、去仲裁——用并行和近邻克服物理极限。"

5. **Memory Wall 是终极约束。** 算力每年 55% 增长, 存储延迟每年 7% 改善。这个剪刀差驱动了 HBM、3D V-Cache、CXL 内存池化、NVLink、LSM compaction 策略、Redis 集群 sizing——从硅片到 CDN, 每一层工程决策的根因都归结到 Memory Wall。

6. **Master 一个 cache 层, 你就 master 了所有 cache 层。** L1 cache 工程师转行做 Redis 调优、做 CDN 架构、做数据库 buffer pool 设计, 只需要翻译术语表:"cache line" → "page" → "object", "MESI" → "主从复制" → "purge propagation", "write-back" → "dirty page flush" → "lazy invalidation"。**底层抽象是相同的, 上层只是实例化的参数差异。**

---

下一篇 → [5. 编程语言运行时: 四种实现语义](runtime-semantics.md)
