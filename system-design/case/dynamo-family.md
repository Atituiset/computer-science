# Dynamo Family: Cassandra / Riak / DynamoDB

## TL;DR

Amazon Dynamo (2007 SOSP) 论文是 AP 键值系统的 圣经——**永远可写, 最终一致, 让服务 (shopping cart) 总可用**。 Cassandra / Riak / Voldemort / DynamoDB 是 Dynamo 概念的 工业 实现。Cassandra 成为 Facebook → Apache 的 分布式 wide-column store; Riak 由 Basho 设计为 eventually-consistent Dynamo-style with CRDT; DynamoDB 是 AWS managed 版本, 带 optional strong consistency。本章分析 Dynamo paper 核心: consistent hashing + virtual nodes + hinted handoff + anti-entropy + sloppy quorum + vector clock — 以及它们如何演化到 Cassandra 与其他派生。

---

## 一、Dynamo 纸核心架构 (2007)

### 前提: "总是可写" (AP)

一个 Amazon shopping cart 必须**always add item** 即便部分节点 down。 不能 block write => availability pick over consistency。 网络分区 持续 仍写 => AP system。

### Consistent Hashing

```
key hash(key) → position in ring [0, 2^160-1]
每个 node 分配 N 个 virtual positions (vnodes)
写入 N 个 replicas walking clockwise.
```

每个 key 的 replication set = 首 node + next (N-1) clockwise nodes。

### Sloppy Quorum

若 preferred N 节点部分 down, Dynamo 选次邻 node (no strict ring)。 保证 write 完成;  use hinted handoff 暂存本地, 转给 real owner after recovery。

### W, R, N Consistency Levels

- N=3 (replication factor)
- client configurable W (write quorum), R (read quorum)
- W+R > N for quorum overlap => stale-proof

案例: Amazon's shopping cart: N=3, R=1, W=1 (快速, 但可能 stale)

### Vector Clock + Sibling

Each version of data has vector clock [[node:counter]] from last update. Coordinator  see sibling when vector clock incomparable → return all client for resolution (e.g., shopping cart merge by application)

### Hinted Handoff

当 write target replica unavailable, coordinator store hint (包括 key+value) locally。 节点回来后 push hint => data.

### Anti-Entropy with Merkle Tree

Background 比较 副本 differ range 推 specific missing keys。 Merkle Tree lazy periodic sync, ensure cold keys  converge。

### Gossip Protocol

Cluster membership via random peer gossip (no 集中 config server). 每个节点 每 1s 跟 random peer exchange membership info。

---

## 二、Cassandra (Facebook 2008 → Apache)

### 混合 Dynamo + BigTable

Cassandra 在 Dynamo's partition + replication model 上 加 BigTable 列模型。

每 table = partition key + clustering columns:

```sql
CREATE TABLE user_activity (
    user_id UUID,
    timestamp TIMESTAMP,
    event TEXT,
    PRIMARY KEY (user_id, timestamp)
);
```

每 partition 内 (secondary key) 多个 row, 语义类似 sparse wide-row.

### Gossip, hinted handoff, read repair, anti-entropy — all inherited from Dynamo

Cassandra adds:
- **Thrift/Native CQL protocol** (not Dynamo simple interface)
- **Tunable consistency (LOCAL_ONE / LOCAL_QUORUM / EACH_QUOURM)**
- **SSTable + compaction (stcs / lcs / twcs)**
- **Lightweight transactions (LWT via Paxos)**

### Implementation differences

- Virtual nodes (vnodes) default 256 per node, ring mapping load balance auto.
- LSM-tree: memtable + commitlog flush to SSTable → compaction merge.
- Token-aware driver: clients aware of partition mapping reduce extra hop to coordinator.

### Scaling

- Linearly scalable writes by adding nodes; data re-distribute via vnodes migration (move half token ranges).

---

## 三、Riak (Basho 2009)

### Pure Dynamo

Riak close follow Dynamo paper:
- `consistent hashing (ring)` 配 vnodes (default 64);
- **Sloppy quorum + hinted handoff**
- vector clock sibling return `allow_mult=true`
- anti-entropy (active AAE background Merkle Tree sync)
- gossip membership

### Data Types (CRDT since Riak 2.0)

Riak DT: counters, sets, maps, flags (Conflict-free). 免 application merge by making data type converge according to CRDT.

### Trade-offs

- No SQL query model; KV with bucket type CRDT;  rich map/reduce-based query (JSON)
- Eventual consistency / strong via `R=quorum`

### 现状态

Basho shut down 2017 (company gone), Riak open source 停 更新 但 派生 项目 继续: Riak KV (Bet365 financial use).

---

## 四、DynamoDB (AWS, 2012)

### Managed Dynamo

- Full managed (no operations like Cassandra)
- API: `GetItem, PutItem, DeleteItem, Query, Scan`
- tables: partition key + optional sort key; 无 列模型; each item max 400KB
- capacity mode: on-demand or provisioned (RCU/WCU)

### Read consistency

- Eventually Consistent Read (default): 可能 stale; P99 < 10ms
- Strongly Consistent Read: R=⌈N/2⌉+1 读 quorum; P99 < 20ms; return most recent commit

### Global Table

Multi-region active-active; write any region, async 复制  → eventual convergence + regional durable

### DynamoDB Streams / DAX cache

- DynamoDB Streams: CDC for change events (KCL lambda trigger)
- DAX: in-memory accelerator cluster 缓 读

### Comparison with Cassandra

|维度 |Cassandra |DynamoDB |
|------|----------|---------|
| Hosting | self-managed / DataStax | AWS managed |
| Data model | rich wide-column + CQL | 简单 PK+SK |
| Write throughput | lin scalable nodes, more hardware | auto scale RW capacity w/ 升 |
| Data size limit | 100TB+ per node possible | 400KB per item max |
| Transactions | LWT (Paxos) | DynamoDB Transactions (serializable with 2PC) |
| Global Table | multi-DC replicas | global table replicas automatic |

---

## 五、Dynamo 家族对比总结

| 系统 | 年份 | 语言 | 数据模型 | 特色 |
|------|------|------|---------|------|
| Amazon Dynamo (Paper) | 2007 | Java (internal) | simple KV | origin, trade-off AP focused |
| Cassandra | 2008 | Java | wide-column + CQL | BigTable model + Dynamo replication |
| Riak | 2009 | Erlang | KV + CRDT | CRDT native,  ring成员 gossip |
| Voldemort | 2009 | Java | simple KV | LinkedIn rethought Dynamo + simple API |
| DynamoDB | 2012 | managed | 简单 (PK/SK) | managed, strongly consistent read + DAX |

---

## 六、典型事故与教训

### Cassandra  TTL + tombstone explosion

Cassandra 2.x 默认 TTL 了 **大量** 过期数据 + tombstones 保留 `gc_grace_seconds` 默认 10 days, create read 需要 scan tombstones 让查询 慢 10x。 Solution: 修 compaction strategy TWCS + 缩短 gc_grace

### Riak node flapping

Riak's gossip 处理 降 重 多 次 rejoin ring 当 node flapping, 导致 多 次 handoff storm. 修: Riak `ring_creation_size` 调 small + pre-join delay.

### DynamoDB RCU/WCU burst mode exploiting

User 持续 writing H/RW mode 大量 short-burst capacity > provisioned. 短暂 burst 允许, 但 sustained → throttling (ProvisionedThroughputExceededException). Solution: on-demand mode 或 autoscaling to absorb spikes.

### Cassandra LWT overwhelm

某 Cassandra cluster 过度使 LWT (Paxos based Conditional Updates), LWT 4 RTT latency 占 80% 的 QPS cause P99 高度 slow. Solution: redesign use conflict-free CRDT or Redis lock instead.

### DynamoDB Global Table conflict

Multi-region write 同时 same key, 后到达 version 用 LWW timestamp overwrite earlier. 某 系统 在 高 并发 下 丢 更新。 Solution: vector clock or merge function on application end.

---

## 七、易错清单

1. **Dynamo-style: never guarantee strong consistency without `W+R>N` + read repair 反复 staleness**.
2. **Cassandra LWT != scalable**: Paxos 最高 throughput  ~1K/s, not for hot path.
3. **GC_grace_seconds must set < TTL expire**: 否则 tombstone 聚;  must 缩短 window.
4. **Sloppy quorum can violate W+R>N shortcut**: 当 consistent 需要, must enforce strict quorum (non-sloppy).
5. **DynamoDB transactions cost 2x more latency**:  simple reads  prefer eventually.

---

## 八、这一章带走的东西

1. Dynamo (2007) = AP leaderless ring + consistent hashing + vnodes + vector clock + hinted handoff.
2. Cassandra = BigTable wide-column + Dynamo replication + CQL + tunable consistency.
3. Riak = pure Dynamo + CRDT types.
4. DynamoDB = managed AP KV + optional strong consistency + transactions.
5. 核心 trade-off: AP = always available writes, eventual consistency, 可 需要 client-side merge和read repair。 opposite of Spanner's CP+EC model。

---

下一节 → [Snowflake](snowflake.md)
