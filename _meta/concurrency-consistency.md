# 6. 并发与一致性: 单机到分布式同构

## 一句话

并发与一致性是"同一个故事讲了三遍"的事情——它在**单机多核 cache coherence**、**单机并发数据库事务**、**分布式多节点存储**三个层次用几乎同样的语言复述. 这不是巧合: 它们都受同一组物理约束支配——**多个 writer + 共享 state + 延迟会限制原子性的可见范围**. 理解这一点, 从 MESI 学到 Paxos / Raft 就是一座平滑的桥.

## 思想链

```
工程问题: 为什么学完 MESI 再看 Raft 会觉得似曾相识?
  └─► 三层并发表由同一组物理约束生成
        └─► 多个 writer + 共享状态 + 延迟决定原子性可见范围
              └─► 单机多核:    共享 L3/内存, 1-50 ns     → MESI/MOESI
              └─► 单机多线程:  进程内存,   μs 级        → mutex/CAS/RCU
              └─► 跨机分布式:  网络消息,   100 μs-50 ms → Paxos/Raft/2PC
  └─► 角色逐行对应
        └─► MESI Modified ≈ Raft leader   (唯一的可写最新副本)
        └─► MESI Shared   ≈ Raft follower (只读同步副本)
        └─► Invalidate 消息 ≈ AppendEntries 复制
  └─► 两者的全部差异来自信道可靠性
        └─► 铜互联不丢包、延迟确定 → 协议可以极简
        └─► 网络会丢包、分区、乱序 → 必须加 quorum / term / 选主
```

## 三层并发表

| 层 | writers | 共享 state | 介质延迟 | 一致性机制 |
|----|---------|------------|----------|------------|
| 单机多核 | 2-100 核 | L1/L2/L3 cache | 1-50 ns | MESI / MOESI / MESIF |
| 单机多线程 | 10-1000 线程 | 进程内存 | 1-2 μs (lock 获取) | mutex / CAS / seqlock / [RCU](../os/lock/rcu.md) |
| 单机多进程 | 进程级 | mmap / SysV shm | 5-10 μs (syscall) | futex / shared memory + atomic |
| 跨机分布式 | N 台机器 | 网络消息 | 100 μs - 50 ms | Paxos / Raft / 2PC / 3PC |

最关键的观察: **本机多核协议和分布式共识协议做的是同一件事——读、写、半数确认**; 主要差别在 latency budget 和 failure mode.

> [!NOTE]
> 单机侧的原语实现见 [futex、CAS、spinlock 内部](../os/lock/futex-cas.md) 与 [lock-free/wait-free 数据结构](../os/lock/lockfree.md); 分布式侧见 [Paxos / Multi-Paxos](../distributed/consensus/paxos.md) 与 [Raft 详解](../distributed/consensus/raft.md). 对照着读, 你会发现术语表几乎可以逐行翻译.

## 强一致性 vs 弱一致性 vs 最终一致性

强一致性: 一次操作要么全部可见, 要么全不可见 (linearizable).

- MESI 在单机上提供强一致: 一个核修改时, 其他核的副本被 invalidate;
- 单机数据库事务在 transaction 内部强一致;
- Paxos / Raft 提供 linearizable 共识 (一次写入需多数节点 ack);
- Spanner 通过 TrueTime 提供外部一致性 (external consistency).

弱一致性: 读可能读到过期值.

- 缓存允许短暂不一致, 以换取吞吐;
- Dynamo/S3 风格的最终一致性: 在 read repair 等反熵修复后系统收敛.

**CAP 定理告诉我们**: 分区发生时不能同时强一致 + 可用 ([CAP / PACELC / BASE](../distributed/concepts/cap.md)). 单机几乎没有 partition, 但分布式里 partition 不可避免——这是单机 ↔ 分布式抽象差异最大之处.

## 抽象的桥梁

单机 MESI 看似陌生, 但**逻辑上与 Raft 同构**:

```
MESI M (modified)   ≈ Raft leader   (持有最新未下刷数据)
MESI S (shared)     ≈ Raft follower (持有已同步数据)
MESI invalidate msg ≈ Raft AppendEntries
MESI BusRd / snoop  ≈ follower 的 ReadIndex 读请求
```

**两边都是"中心控制点 + 多 reader + 状态同步消息"**. Raft 用网络消息实现 MESI 式的同步; MESI 用总线仲裁实现类似 leader/follower 的同步.

> [!WARNING]
> 同构有助于理解, 但不要把工程参数也照搬. MESI 的 invalidate 在芯片内是纳秒级且不会丢失, 所以硬件敢用"广播 + 等待确认"; 分布式系统的消息会丢、会延迟抖动, 所以必须补上任期号、多数派和幂等日志——把 MESI 直译成网络协议, 得到的是一个会被一张乱序报文打崩的系统. 不可靠信道带来的额外机制见 [Raft 详解](../distributed/consensus/raft.md).

## 锁、CAS、事务的对应

继续对比:

| 抽象 | 单机实现 | 分布式等价 |
|------|---------|------------|
| 单点锁 | mutex | leader 租约锁服务 (ZooKeeper ephemeral node) |
| CAS 一致 | atomic cmpxchg | Cassandra LWT (lightweight transactions) |
| 事务 prepare/commit | 数据库本地 2PC | 跨库 XA / Saga |
| Quorum | 多核总线仲裁 | quorum read/write, W + R > N |
| 快照隔离 | MVCC (PostgreSQL) | Spanner snapshot / CockroachDB |

## 工程转折点: 延迟预算让"乐观算法"赢

当 latency = 1-50 ns 时:

- 总线锁定与阻塞等待代价小;
- **悲观锁**通常性能更好 (低延迟, 但牺牲吞吐).

当 latency = 1-100 ms 时:

- 锁的 ack 要等一个 RTT, 阻塞代价巨大;
- **乐观并发** (MVCC + 只读事务不阻塞) 表现更优;
- 这就是为什么现代数据库 Spanner / CockroachDB / TiKV 都选 MVCC + Raft.

这就是"跨越延迟量级后, 并发模型必须从悲观切换到乐观"——同一抽象在不同 latency budget 下换载体. 单机侧的 MVCC 实现对照见 [MVCC 原理: PostgreSQL vs InnoDB](../databases/relational/mvcc.md).

## 各语言的同构并发原语

各语言层级的并发原语抽象基本相同:

```
mutex:   C++ std::mutex / Rust std::sync::Mutex / Go sync.Mutex / Java synchronized / Python threading.Lock
rwlock:  各语言的 shared_mutex / RWMutex 对应版本
cond:    std::condition_variable / sync.Cond / Java wait-notify / Python Condition
futex:   Linux futex syscall —— 现代几乎所有用户态 mutex 的底层
atomic:  std::atomic<T> / Rust AtomicXxx / Go sync/atomic / Java AtomicInteger
channel: Go channel (CSP) / Rust std::sync::mpsc / Clojure core.async / Java Disruptor
```

这些原语在不同语言里的语义基本一致, 这是"工程师可以在语言之间迁移"的基础. 但**语言选择把权重放在哪个原语上** (Go 押 channel; C++ 押 atomic/mutex; Python 受 GIL 制约) 只是侧重不同, 不是语义差异. 内存序层面的坑则统一由 [内存模型与 memory barrier](../os/lock/memory-barrier.md) 兜底.

## 一致性实验: 多线程累加器

考虑一个最小一致性问题: 多线程累加. 三个方案:

### 方案 1: mutex 累加

```
sum = 0; mutex m;
并行循环: 持有 m 后 sum += x;
吞吐: ~20M ops/s (4 核激烈争用下锁成为串行点)
```

### 方案 2: CAS 失败重试

```
std::atomic<long> sum;
循环: expected = sum.load();
      if (sum.compare_exchange_weak(expected, expected + x)) break;
吞吐: 高竞争下重试风暴 → ~10M ops/s, 且延迟方差更大
```

### 方案 3: thread-local + 结束时合并

```
thread_local long local_sum = 0;
并行循环: local_sum += x;          // 无共享, 无争用
线程结束时: 加锁一次性合并进全局 sum
吞吐: ~500M ops/s
```

三种方案语义等价, 但**实测常数差出 25× 以上**. 这就是为什么 **"减少争用 + 分片 + thread-local" 是并发的第一技术**, 而"换更快的原子原语"只是第二梯队.

> [!TIP]
> 判断并发优化方向先看争用面, 再换原语: 先问"这份数据能不能变成 per-thread / per-shard", 再问"锁能不能换成 CAS", 最后才轮到"换个更快的锁". 内核里把这套思路推到极致的是 RCU——读者完全无锁, 见 [RCU、seqlock、brlock](../os/lock/rcu.md).

## 这一章带走的东西

- 单机多核 MESI 与分布式 Raft 在抽象上同构;
- 一致性等级从强一致 (linearizable) 到最终一致;
- CAP 只在分布式层咬人: 单机没有 partition, 弱约束不构成威胁;
- 并发模型选悲观还是乐观, 由 latency budget 决定;
- "减小争用 + thread-local"比原子原语本身的快慢更重要.

## 一页速查

| 维度 | 单机多核 (MESI) | 单机多线程 (锁/MVCC) | 分布式 (Paxos/Raft) |
|------|-----------------|----------------------|---------------------|
| 共享介质 | cache line / 总线 | 进程内存 | 网络 RTT |
| 延迟量级 | 1-50 ns | 1-10 μs | 100 μs - 50 ms |
| 排他权获取 | RFO 总线事务 | mutex / cmpxchg | 选主 (RequestVote) |
| 数据传播 | snoop / directory 广播 | 直接读写共享内存 | AppendEntries 复制 |
| 冲突仲裁 | 总线优先级 | 锁队列 | term 单调递增 |
| 故障模型 | 不丢消息, 无拜占庭 | 线程崩溃需进程兜底 | 丢包 / 分区 / 时钟漂移 |
| 典型妥协 | 性能核心绑定 | MVCC 快照隔离 | 最终一致 + read repair |

下一篇: [7. 推理链: 硬件层如何决定软件设计](hardware-shapes-software.md)
