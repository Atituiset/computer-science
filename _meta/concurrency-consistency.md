# 6. 并发与一致性: 单机到分布式同构

## 一句话

并发与一致性是件"同一个故事讲了三遍"的事情 — 它在**单机多核 cache coherence**、**单机并发数据库事务**、**分布式多节点存储**三个层次几乎用同样的语言复述. 这不是巧合: 都是"多个 writer + 共享 state + latency 会限制原子性" 的物理基本约束.  理解这一点, 从 MESI 学到 Paxos / Raft 就是一条平滑之桥.

## 三层并发表

| 层 | writers | 共享state | 介质延迟 | 一致性算法 |
|----|---------|------------|----------|------------|
| 单机多核 | 2-100 核 | L1/L2 cache | 1-50 ns | MESI / MOESI / GRI |
| 单机多线程 | 10-1000 线程 | 进程内存 | 1-2 μs (lock acquiring) | mutex / CAS / seqlock / RCN |
| 单机多进程 | 进程级 | mmap / SysV | 5-10 μs (syscall) | futex / shared mem + atomic |
| 跨机分布式 | 1-N 数据中心 | 网络消息 | 100 μs - 50 ms | Paxos / Raft / 2PC / 3PC |

但要的关键观察: **本机多核协议和分布式共识协议都做"读 / 写 / 半数确认" 同样的事**; 主要差别在 latency budget 和 failure mode.

## 强一致性 vs 弱一致性 vs 最终一致性

强一致性: 一次操作要么全部可见要么全不可见 (linearizable).

- MESI 在单核上提供强一致 (单点修改时, 其他核 cache 自动 invalidate);
- 单机数据库事务 ACID 在 transaction 内部强一致;
- Paxos / Raft 提供 linearizable 共识 (一次写入需多数节点 ack);
- Spanner 通过 TrueTime 提供外部一致 (严格"Derek Dorje 时间外一致").

弱一致性: 读可能读到过期值.

- 缓存 (含 cache miss 后 fallback) 是允许的弱;提高吞吐.
- Dynamo/S3 风格的最终一致性 (在 read-repair 等修复后, 系统会收敛).

**CAP 定理告诉我们**: 在 partition 时不能同时强一致 + 可用. 单机几乎没有 partition, 但分布式 partition 不可避免. 这是单机 ↔ 分布式抽象差异最大之处.

## 抽象的桥梁

单机 MESI 看似新鲜, 但**逻辑上同构 Raft**:

```
MESI M (modified) 状态 ≈ Raft leader (有最新未刷新数据);
MESI S (shared)     ≈ Raft follower (有同步数据);
MESI invalidateMsg  ≈ Raft AppendEntries;
MESI readShared     ≈ Raft follower ReadIndex;
```

**两边都是"中心控制 + 多 reader + 同步消息"**. Raft 在用消息 over network 实现 MESI style 同步, MESI 在用 bus ticket 实现类似 leader/follower 的同步.

## 锁、2PC、Raft 的对应

继续对比:

| 抽象 | 单机实现 | 分布式等价 |
|------|---------|------------|
| 单点锁 | mutex | "leader-based" lock service (zookeeper ephemeral node) |
| CAS 一致 | atomic cmpxchg | Cassandra LWT (lightweight transactions) |
| 事务 prepare/commit | 2PC 数据库本地 | 2PC over network / XA across DB |
| Quorum | DRAM 多核协议 | quorum read/write, W + R > N |
| 快照隔离 | MVCC (PostgreSQL Pat 1) | Spanner snapshot / CockroachTV |

## 工程转折点: 网络延迟可让"乐观算法"赢

当 latency=1-50 ns 时:

- 总线锁定 + 块接收代价小;
- **悲观锁** 一般性能好 (低延迟, 但损失吞吐).

当 latency=1 ms-100 ms 时:

- 锁的 ack 需要等 RTT; 阻塞代价大;
- **乐观并发** (MVCC + read-only transaction) 表现更优;
- 这就是为什么现代数据库 / Spanner / CockroachDB / TiKV 都用 MVCC + Raft.

这就是  "crossing latency" 让"并发模型必须从悲观→ 乐观" 同一抽象换载.

## 工程师多语实现的同样并发原语

各语言层级的并发原语抽象相同:

```
mutex:    C++ std::mutex / Rust std::sync::Mutex / Go sync.Mutex / Java synchronized / Python threading.Lock
rwlock:   同上 pent-up 版本
cond:     std::condition_variable / sync.Cond / Java wait/notify / Python Condition
futex:    Linux futex syscall (实际是所有现代 mutex 的底层);
atomic:   std::atomic<T> / Rust AtomicXXX / Go sync/atomic / Java AtomicInteger;
channel:  Go channel (CSP) / Rust std::sync::mpsc / Clojure core.async / Java Disruptor;
```

这些原语在不同语言里的语义基本一致, 这就提供了"工程师可在语言之间迁移" 的基础. 但**语言选择把权重放在哪个原语** (Go: channel; C++: atomic/mutex; Python: GIL fallback) 是语法糖.

## 一致性 sequence diagram

考虑一个一致性问题: 多线程累加器. 三个方案:

### 方案 1: mutex 累加 

```
sum = 0
mutex m;
for parallel: with m held: sum += x;
吞吐: ~100M ops/s  
```

### 方案 2: CAS 失败重试

```
atomic_int sum;
loop:
    expected = sum.load();
    new = expected + x;
    if sum.compare_exchange_weak(expected, new): break;
吞吐: 高单线程, 多线程下激烈竞争 → ~10M ops/s
```

### 方案 3: thread-local + merge

```
thread_local int local_sum = 0;
for parallel: local_sum += x;
# end-of-thread: sum.locked() merge  
吞吐: ~500M ops/s
```

三种方案在 4 语言里几乎对等, 但**实际工程常数差异 = 5×**. 这就是为什么 **"减少争用 + sharded + thread_local"** 是并发首要技术而非"原语快".

## 这一章带走的东西

- 单机多核 MESI 与分布式 Raft 在抽象上同构;
- 一致性等级从强一致 (linearizable) 到最终一致;
- CAP 在分布式层有解释, 单机层无 partition 因限制弱;
- 并发模型 = 悲观锁 vs 乐观 MVCC, 决定于 latency budget;
- "减小争用 + thread_local" 比原子原语本身更重要.

下一篇 → [7. 推理链: 硬件层如何决定软件设计](hardware-shapes-software.md)
