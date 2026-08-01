# 一致性、线性化与序

## TL;DR

分布式系统里"一致性"是多义词——本节梳理**三套区分**:
1. **线性化 (Linearizability):** 单对象最强的实时一致性——任何看到"前面写入"的客户端都看到该写入, 现代"实时一致"通用代称。
2. **一致性等级体系:** 从强到弱——Strict(单 processor)→ Linearizable (real-time global)→ Sequential (single global order) → Causal (causally-related ordered)→ Eventual (eventually converges)→ Read-your-writes (per-client)。
3. **顺序与因果:** Lamport defines `happens-before` (`→`) partial order, 由"消息发送/接收, 同进程内序"构造; Vector clock 用一组计数器在 N 节点上捕捉 `happens-before`, 检测并发但非 total order; HLC (Hybrid Logical Clock) 把 wall clock + logical clock 合一, 兼顾分布式因果和人读时间戳。
   理解这后面 Paxos/Raft/CRDT 的取舍能显性化。

---

## 一、线性化 (Linearizability)

### 定义 (Herlihy & Wing 1990)

并发操作 (operations on a single object) 总可看作一个**全序** (a total order), 且该 total order 满足:
1. **Real-time order**: 若 op1 完成在 op2 开始之前 (real-time), 则 total order 中 op1 必须排在 op2 之前。
2. **Sequential spec**: total order 是一个**合法的 sequential history**——即, 是单机串行执行的一种可能结果 (e.g., 就是普通读写的语义)。

### 直观例子

```
Client A: write(x, 1) at t=10, ack at t=20
Client B: read(x) at t=15, response at t=25  → 必须返回 1 (因为 A 的 read 已 ack)
Client C: read(x) at t=18, response at t=22  → 可返回 0 (因 A 尚未 ack)
```

线性化的承诺是: 当 A 收到 ack 后, 任何后续 B 的 read 都看到 A 的写。

### 线性化 vs Serializability

- **Linearizability**: about 单对象并发; 实时保证。
- **Serializability**: 多对象事务; **无**实时保证——只要等价于某个 serial 事务序列即可。

一个 system 可以是 linearizable 但 non-serializable (空 if use multi-object transactions). 一个 system 可以是 serializable 不 linearizable (e.g., 一个 read-only transaction 可以看到 t=15 写但 t=20 位先 ack 也 OK)。

Spanner 提供的是 both—— linearizable + serializable together call "strict serializability" 或 "external consistency"。

### 测试线性化: Jepsen Knoss

Jepsen 大杀器: 把某次 run 收集全 client operation 的**invocation-completion** pairs, 喂 Knoss 算法——枚举所有可能的 total order 检查是否存在合法的 (线性化)*。 这是 exponential worst case, 但实战上小 model 能验千次 ops.

---

## 二、Sequential Consistency (Lamport 1979)

弱化线性化——**取消 real-time 约束**, 只要求一个"看上去各 node 共享的 total order"。

```
A: write(x, 1) at t=10, ack at t=15
B: read(x) at t=12, return 0
C: read(x) at t=20, return 1
```

合法: total order `B read → A write → C read` 各进程看到的序一致, 但 B 的读在 A 的写之前完成 real-time——违反了 linearizability 但 sequential OK.

Sequential 比 linearizable 弱, 但比 causal 强 (因强加 total order). 现代 CPU memory model 通常仅保证 sequential consistency (且大多是 weak model—— TSO, ARM relaxed).

### CPU Memory Model 类比

- x86: TSO (Total Store Order) — 大部分 sequential, 但 store-load 可重排。
- ARM: relaxed — almost any reordering, only data/control deps enforced。
- Java JMM / C++11 memory_order_seq_cst = 严格 sequential consistency。

线性化是 distributed systems 强一, sequential 是硬件 memory order 强一——同概念不同领域。

---

## 三、Causal Consistency

### Partial order 形式化

定义 happens-before `→`:

- 同进程: `e1 → e2` if `e1` happens before `e2` in same process.
- 跨进程: `send(m) → recv(m)` (发出 before 收到)。
- 传递: `e1 → e2 ∧ e2 → e3 ⟹ e1 → e3`。
- 否则 concurrent: `e1 || e2`.

Causal consistency: 所有 nodes 看到的因果关系**保持序**, 但并发可任任意序。

### Vector Clock

N 个 nodes vector clock `VC_i` 维护 N-element count:

```
on send: VC_i[i]++ then send VC
on recv(m, VC_m): VC_i[j] = max(VC_i[j], VC_m[j]) for all j; VC_i[i]++.
```

判定: `VC_a < VC_b iff VC_a[k] ≤ VC_b[k] for all k AND strictly < for some k`.

并发: `VC_a || VC_b`(不 ≤ 也不 ≥)。

工程用: Dynamo, Riak 用 vector clock 检测 concurrently writes。 每个 update 加上 client-side VC; read 时高 VC → 覆盖旧 VC; concurrent VC 全保留 → siblings + merge function。

### Version Vector, Dotted Version Vector, Interval Version Vector

演进路径:
- **Version Vector (VV)**: N 维, 简单, 但每 writer 必须同步协调 N= nodes 数。
- **Dotted VV (DVV)**: 解决 VV 假设全 writer 持有当前 VV, 否则假 sibling; 引入 (dot, cluster) 表达精细化。
- **Interval Version Vector (IVV)**: 适应 dynamic membership 变化, when node failure/ add, vector interval 而不是 count。

Riak 现版用 DVV, Cassandra 用 VV + LWW (Last-Write-Wins) 简化算法。

---

## 四、Read-Your-Writes Consistency (Session Guarantees)

Terry et al. 1994, Bayou 系统。session 是一个 client 的"使用上下文", 在 (possibly sticky-load-balancer) 单 server 或一个 quorum 对读写的关联。

四种 session guarantee:

| Guarantee | 含义 |
|-----------|------|
| **Read-Your-Writes (RYW)**: client 看到自己写入 | Web 用户体验基本——购物车追加后看到新项目 |
| **Monotonic Reads**: 后续 reads **看到更近期**的数据 | 单调, 不"看到 back-in-time" |
| **Monotonic Writes**: 一个 client 的**写入的 serializable 总顺序**与自己 process 内一致 | 避免 undo user 感受 |
| **Writes-Follow-Reads**: 同一 session 之前读到的值, 后续 writes 在该值基础上 | 锁/版本更安全 |

工程实现:
- Sticky load balancer 保障 session 一定打到同一副本 (常见但是 bad failover path)
- Read 时含 **client_last_seen_vclock**, server 检查 last-VC 后有的 update 都同步到自身后再响应 client (synchronous read-repair).

---

## 五、Eventual Consistency

最弱: 给足**无新写入** 时间, 所有副本最终 converge (e.g., VC 等效)。**不**提业务可接受的 "时间长度"。AP 系统是 eventual consistency 的如下根源:

- 无 quorum: W=1 R=1 N=3 — 允许 client 写出现在另一副本
- gossip/Anti-entropy 同步最终传播
- merkle tree 加速 read repair (Riak/Cassandra)

### Eventual 不意味着 "等同 linearizable":

Dynamo 测试中, eventual consistency 与 linearizability**绝对不等**——client user 看到 timeline 已 push 后改用旧 timeline 反向 replica, insider sees LWW 取舍了 user complex about time.

### SLO 上 eventual: window 多长?

DynamoDB Eventually Consistent Read: <1s window 在集团内。Cassandra (~minutes if no read-repair 默认) wallclock 设置 `gc_grace_seconds` 默认 10 days。

---

## 六、HLC (Kulkarni 2014)

### Problem of pure LC

Lamport Clock 单调 64bit count; 平常很快但**与 wall clock 无关**——读 `2024_05_01 10:23:00` 看 clock "5" 很反直觉。

### HLC

```
HLC = (physical_ts, logical_count)
init: HLC = (wall_now, 0)
on_send/recv:
  if wall_now > HLC.physical:
     HLC = (wall_now, 0)
  else:
     HLC.logical += 1
```

Vector style 同 vector clock 维护 N 个 HLC——cockroachdb、yugabyte、 mongo cluster 都用 HLC 替代 wall clock 在事务上做 ordering。

HLC 提供:
1. **causal consistency** (类似 LC, 自然支持)
2. **timestamp stability**: 不知道因果, 可以用 PH.ts vs PH'.ts 直接比较
3. **debug 友好**: timestamp 是 wall clock 大致时间, 排查 bug 容易

### TrueTime

Spanner 是 Google 一个跨越——不等 HLC, 直接用 GPS/原子钟提供 TrueTime API `TT.now() = [earliest, latest]` 区间 + commit-wait until upper-bound 确保每 commit 的 ts 严格小于后续 begins。
TrueTime 不是 HLC, 但基础 wall clock 保证 external consistency——这是 Google 的工程极限。

---

## 七、一致性选择光谱

```
Strong (低 throughput, 高延迟)
─────────────────────────────────
Strict Serializable        Spanner
Serializable + Lin        CockroachDB, YugaByte, FaunaDB
Serializable                PostgreSQL (单机)
Snapshot Isolation SI      PostgreSQL REPEATABLE READ, Oracle
                            ─────┘并行调度 easy
Read Committed              PostgreSQL READ COMMITTED, MySQL InnoDB
                            ─────┘Panicking jdbc 默认 — 单 statement - level checks
Causal Consistency          COPS, Bayesian Stores, TLA+ Casual storage
Read-your-writes            DynamoDB (consistent 当前 repo), Riak
Monotonic Reads
Eventual Consistency        Cassandra, Dynamo (no level tune)
─────────────────────────────────
Weak (高 throughput, 低延迟)
```

图中从上到下,*restrictiveness 下降*, *engineering 付出下降*。BAT-Ocelot-OTLP 也顿美事务 SLA 支持更价el noW"

---

## 八、一致性 vs 可用性 vs 延迟 — SR Trade-off 矩阵

| Consistency | N=3 R W | 例子 | 缺点 |
|-------------|--------|------|------|
| Linearizable | N=3, R=3, W=2 | Lock service | write 高延迟 |
| Strong | N=3, R=2, W=2 | Quorum with W+R>N | 大多 read OK |
| RYW | N=3, R=1+hint, W=2 | DynamoDB session | read 高延迟 |
| Eventual | N=3, R=1, W=1 | Dynamo RC | 时间不对 |

### Practical:R = ? 一般公式:

要保证**任意 quorum overlap 有最新复制**, 需 `R + W > N`; 若需要 `R = W = N` for linearizable 默认 + 通过 commit-token guarantee write 全部 replica 收件 → latency 高但 linearizable.

Quorum.customizable Cassandra _W = focal_.2 一_ .2 R = FOCAL_TENANT_R (=2 in standard configs). W+R=N+1+1 = 3+1=4 >= 3 = N; W+R=N (W=2,R=1)**不保证 overlap**——可能读到一个副本其 没 updated 该 write.

### Bounded staleness

CockroachDB / YugaByte / Spanner 都 limit staleness (e.g., 1-2s). through-put 与 linearizable close, read 行 cheaper:
1. read at a follower, talk 心跳 cluster timestamp, follower **等待** 直到 crdt helper exec tang t? +动手 gain 等到 its TS 在 read end; if read can not acquire past TS within staleness, fback to quorum.
2. **Time-travel query** 指定 past TS (MVCC), 取得 该 TS reader — strict replay 不 read_quorum

---

## 九、易错清单

1. **Linearizable ≠ Serializable**: 前者单操作 real-time; 后者多事务换序等价。 Spanner 是 "External Consistency" = 两者并存。
2. **HLC ≠ Vector Clock**: HLC 单 node 节 **PT+LC** 但 VC 多 N node **多 Counter 数组**。 HLC 取 VC portability friend + fast。
3. **Sequential Consistency: 不保证 real-time.** 没 HLC LC 与 VpC 的 total order-保证 二次 认 read your writes.
4. **Eventual ConsistencySLA 测** eventual: 工程师口 "eventually" 不要视为 unbounded by SLA. DynamoDB eventual RC < 1s, Cassandra 没默认 SLA。
5. **Causal Consistency 无 linearizability doesn't capture multi-version isolation 对** Gallery: そこ  read stale 老于因果分布 alternate ** causal Capture informacji crwrap doesn . Crummerish приемnoWfish wouldn't- solomono 判断 不能 li-nearable**.
6. **HLC cockroach-sync-action: actual necessary fixed** — 因分散不同 TS atomic, 同一 physical commit may伤心 ts skew with reader.

---

## 十、这一章带走的东西

1. 一致性是有等级的: linearizable → sequential → causal → RYW → eventual, 由强转弱, 代价由大变小。
2. Vector Clock 把"发生前个" 形式化为 N 维 counter array, 检测各种 concurrent writes.
3. HLC 把 wall clock 融入 Lamport clock, 给因果关系上保与 human-friendly timestamp 一起两个。
4. TrueTime/Spanner 是 GPS + commit-wait 实现 external consistency, 是 linearizable+serializable 的现实极限。
5. ObjectTunable consistency Quorum 公式 `R + W > N` 保 quorum overlap; `R = W = majority` 为最低保证 linearizable。
6. 业务依 SLA 分级: bank → linearizable, carno-shelf → causal/RYW/internet, logs/geo … → eventual。

---

下一节 → [故障检测、failure models](failure.md)
