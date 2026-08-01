# CAP / PACELC / BASE

## TL;DR

CAP 定理 (Brewer 2000 假说、Gilbert-Lynch 2002 证明): 异步网络下，分布式系统在 Consistency (C, 线性化)、Availability (A, 每个请求最终响应)、Partition-tolerance (P, 容忍消息丢失) 三者中**最多满足两个**。由于真实网络必分区 (P 必选)，实际选择是 **CP vs AP**。PACELC (Abadi 2010) 进一步补充: 即使无分区时也需在 Latency vs Consistency 间权衡——给完整取舍空间。BASE (Basically Available + Soft State + Eventually Consistent) 是 ACID 反面、AP 系统的设计风格。这章的目标是区分**理论形式化** (CAP 是定义严格的定理)、**工程实践** (CAP 是开发者口中的"标签")、**常见误读** ("CP 永远不可用"、"AP 永远不准")。

---

## 一、CAP 形式化 (Gilbert-Lynch 2002)

### 三性质的定义

| 性质 | 形式化定义 |
|------|-----------|
| Consistency | 线性化 (linearizability) : 所有操作看上去都在某个*全局实时顺序*上原子完成, 任何 read 返回最近一次 write 的值 |
| Availability | 每个对**非故障节点**的请求最终**收到非错误响应** (无超时限制) |
| Partition tolerance | 网络可能丢失任意数量消息 (一对节点间任意方向丢包), 系统仍工作 |

定理: 这三者**不能同时**满足。证明核心: 一个 system 假设满足三者, 考虑两节点 A 和 B 被网络分区、客户端向 A 写 "x=1"、向 B 读 x——A 必须响应 (availability), 但 B 不能与 A 同步 (partition), 于是 B 返回旧值——违反 consistency。

### 关键细节: 异步网络 + 总能完成

证明依赖**异步网络** (消息延迟无上限) + **总能完成** (liveness 强定义)。若系统允许在分区时**无限封住**请求直到分区恢复 (即 不严格保证 availability, 只 guarantee eventual), 那 CP 就成立——etcd / ZooKeeper 实际是这种"partition 时 best-effort block"。

### Consistency 等级

CAP 中 C 严格指 **线性化** (Linearizability), 是**最强**形式一致。更弱:

1. **Linearizability**: 单对象强一致。
2. **Sequential Consistency** (Lamport 1979): 所有进程看到的操作序列**全局同一序**, 但不要求与 real-time 一致。
3. **Causal Consistency**: 有 causality 关系的操作各进程看到的序一致; 无 causality 的并发操作可不同序。
4. **Eventual Consistency**: 给足时间无新写入时所有副本会收敛。

CAP 中的 C 严格只指 1。现代系统如 Spanner 是 Linearizable, Dynamo 是 Eventual, MongoDB 是 Sequential (默认), Cassandra 是可调 ( LOCAL_QUOURM → 介于, CL=ALL → linearizable)。

---

## 二、CP vs AP 实例

### CP 系统

分区时**拒绝服务**保证 consistency:

- **etcd**: Raft + WAL persistent。Quorum 不可达时写入阻塞。
- **ZooKeeper**: ZAB (Paxos 变种) + 5 节点 quorum。Leader 仅一个, leader died 重新 elect ~200ms, 期间不可写。
- **HBase**: HMaster 单点 + RegionServer副本 backed by HDFS NameNode (单点 HA via QJM)。强一致 but 单点 fail-stop.
- **Spanner**: TrueTime + Paxos groups。TrueTime 不确定窗口期间 commit wait, 保证 external consistency。

几乎所有 CP 系统并不是"分区时 unavailable"——只是"分区时**降低可用性**"——决策都是"是否抛弃本次请求"。

### AP 系统

分区时**继续服务**保证 availability, 用 eventual consistency 收敛:

- **Cassandra**: Dynamo 架构, W+R 可调一致性。Quorum 不可达也可降级写。读到的可能 stale (但 eventually converges)。
- **DynamoDB**: AWS Dynamo 论文基础, Eventually consistent reads 是默认, 但 2018 起支持强一致 read ($R=W+1=N$ 在最新副本).
- **Riak**: Vector Clock + hint handoff + active repair。
- **CouchDB**: Multi-master + MVCC。

AP 系统**关键**的代价: 用户可能读到 stale data。需要业务层**接受这窗口**——Twitter timeline、Amazon shopping cart acceptable, 银行账户一般 not。

### 工程实现的 nuanced: CA 真的存在吗?

理论上: **CA 系统 = 单机**。在单进程数据库 (PostgreSQL 运行在一台机), 无网络分区概念。一旦跨网络或跨物理机, 就有分区风险, 就必须**容忍 P**——即放弃 CA。生产中常说 "CA 系统"不严谨——他们实际指 "高可用 CP" 而非真正不要 P。

---

## 三、PACELC (Abadi 2010)

### 公式

```
if (P) then {A vs C}
else       {L vs C}
```

即使无分区时 (Normal case), 系统仍需在 **延迟 (L)** 与 **一致性 (C)** 间选——更高一致性通常需要更多确认、跨节点的延迟。

### 系统分类

| 系统 | else (无分区) | then (分区) |
|------|---------------|-------------|
| Cassandra | latency-priority (LOCAL_ONE 等) | availability-priority |
| Spanner | consistency-priority (TrueTime 保证) | consistency-priority |
| DynamoDB RC | latency-priority | availability-priority |
| DynamoDB StrongRead | consistency-priority | consistency-priority |
| MongoDB | consistency-priority (write concern=majority) | consistency-priority (writes 阻塞)   |
| Riak | latency + tunable | availability-priority |
| PNUTs (Yahoo) | consistency-priority (write master) | consistency-priority |

### 工程含义

SLA: Amazon 对 DynamoDB 写承诺 P99 < 10ms——要满足这条, 写入必须**不强同步 quorum 全确认**, 故放弃 strong consistency。Spanner P99 write ~100-200ms 跨数据中心——Google 同意付这延迟, 换取 linearizability。

### 为什么 CAP "三选二"是误读？

PACELC 更精确:
- "三选二" 把 else-then 全混在一起。
- 实际工程系统是**双维度**: 平常常 L vs C, 分区时 A vs C。CAP 只描述后者。

---

## 四、BASE (Basically Available / Soft State / Eventually Consistent)

Pritchett 2008 eBay 提出。BASE 是 ACID 反面:

| ACID | BASE |
|------|------|
| Atomic (原子) | Basically Available (基本可用) |
| Consistent (一致) | Soft State (软状态) |
| Isolated (隔离) | Eventually Consistent (最终一致) |
| Durable (持久) | — |

BASE 工程方法:

1. **Compensating Transaction**: 业务层补偿不 XA。如电商扣库存失败、后续 saga 回滚之前的支付。
2. **Saga Pattern**: 长事务拆成 N 步、每步带补偿函数; 失败时反向 undo 各步。
3. **Idempotency**: 所有 retry 必须幂等。eventId 去重, payment id client-generated。
4. **Eventually Consistent**: 接受 inconsistency window, 用 task queue + retry 收敛。
5. **Read Repair**: 读时发现不一致就此修复。

### 与 CAP 关系

BASE 大多对 AP 系统而言。 BASE 系统不放弃可用性, 牺牲一致性 → AP+ELC。 但 Spanner 这种 CP+EC 的工程 BASE 就不用——Spanner 是 ACID-distributed 的事务路线, 严格 linearizable。

---

## 五、常见误读清单

| 误读 | 纠正 |
|------|------|
| "CP 系统永远不可用" | 只在分区时阻塞, 平常是 5 个 9 可用性 |
| "AP 系统永远不一致" | 分区结束后会收敛, eventually 一致 |
| "三选二" (CA, CP, AP) | P 必选, 实际只有 CP vs AP; 更完整是 PACELC |
| "MongoDB 是 CP" | 取决于 write concern — w=1 时基本 AP, w=majority 时 CP |
| "Spanner 是 CA 因为是强一致" | 仍然 P- tolerant, 是 CP+EC, 跨数据中心分区时暂停写 |
| "CAP 是 100% 教科书定理" | 实际证明确立前提是异步网络, 同步网络可绕开 (practical 同步不存在) |
| "BASE = 最终一致 就行" | BASE 还要 idempotent retry + compensating + 业务级 invariant 维护 |

---

## 六、易错清单

1. **CAP 中 C 不是 transactional consistency**。它是 linearizability (单对象强一致)。 提到"CP+ 事务"是另一层 (linearizable + serializable)。
2. **PACELC 中 else 是"常态"、then 是"分区"**:
   - 文章常错写 "在 P 后选 A or C, 否则普通工作"。 实际 else 描述的是平常也要选 L 或 C。
3. **CAP Availability ≠ 高可用性定义**: 形式化 A 是"每个请求都有响应", 不是"5 个 9 上线率";
   后者更宽, 可以容忍 leader election 期间 1-2 秒不可用, 前者需要"任意时刻有响应"。
4. **partition tolerance 不是"网络分区扛住无停机", 实际是"网络分区时仍能维持 promise"**:
   partition 时当然会 loss 一些功能, 但**不能协议错乱**。 CP 系统在此正确"宁可停写不可二心"。
5. **Brewer 反思**: 2017 Brewer 自己写 "CAP 十二年" 撤回"三选二" 提法, 提倡 PACELC。

---

## 七、这一章带走的东西

1. CAP 是 **asynchronous + 总能完成** 假设下的定理, 真实系统都放宽 (eventual completion);
2. CP 不是"always available minus partition"; 是"分区时牺牲可用性、让一致性 promise 保护数据"。
3. PACELC 把"常态也要选 L vs C"加进来, 完整画像就清晰。
4. BASE 是 AP 系统工程模式: idempotency、补偿事务、saga、eventual consistency。
5. 业务层根据场景选 CP vs AP:
   - 银行 = CP, component 牺牲延迟换 strict 强一;
   - shopping cart 消息、日志 = AP, 用户体验优先。
6. Tunable consistency (Cassandra、Riak) 是后 CAP 时代的和解——让调用者决策, 而非系统专制。

---

下一节 → [一致性、线性化与序](ordering.md)
