# Sharding + Replication 实践

## TL;DR

Scale 的 two axes: **write scalability (sharding)** + **read scalability (replication)**. 本章以 concrete 案例讲解 怎么拆一个单机 Postgres 到 100 节点 cluster:
- **Sharding**: 按 hash / range 切 data, 跨多 instances, 让写 throughput 线性增长.
- **Replication**: 每个 shard 多副本 (leader + followers) 承载 read traffic, 热备 failover.
- **Combined**: CockroachDB / Spanner / Yugabyte / TiDB 是 sharding + replication natively.
- **Caching + CDN**: 加 读 cache (Redis + CDN) further 降 read load.

本章以 Twitter / Instagram 为实例, 讲 shard key 为何是 user_id, 不 `hash(ad_id)`. 与 pitfalls: reshard migration, 跨 shard transaction, hot shard。

---

## 一、单机到 Sharded 集群

### 路径

```
Phase 1: 单机 Postgres (16 core, 256GB RAM) 
  → 5000 write TPS, 50K read QPS OK

Phase 2: + read replicas (1 primary + 2 replicas)
  → reads go to replicas, write still bottleneck at primary

Phase 3: + Redis cache layer
  → cache hit 95%, write 仍是瓶颈

Phase 4: Sharding by user_id (12 shards)
  → 写 60K TPS, 读 600K QPS shared across scaling
```

Instagram 走完 12 shard, 为什么 user_id 是 shard key:
- Most queries = per-user feed / profile / timeline
- user_id  sharding → single-user data co-located on same shard
- Cross-user join (rare) → cross-shard read async 后合并

---

## 二、Shard Key 选型 checklist

| 考虑 | Hash 随机分布 | Range 按序分 | Directory 自由映射 |
|------|-------------|-----------|-------------------|
| 均匀分布 | ✅ | ❌ hot range at 最新 | ✅ manual rebalance |
| 范围查询高效 | ❌ cross shard | ✅ 同 shard | ✅ depends on mapping |
| Hot key | ⚠ single hot key hits one shard | ❌ latest time hits same shard | ✅ manual split hot key |
| Add node | ❌ rehash all data (no consistent hash) | ✅ split range 迁移少 | ✅ directory 重 map 轻 |
| Consistent hashing | ✅ 仅 迁移1/N data | ❌ 必须 有 cohesive mechanism | ✅ |

### 实际选型:

- **Twitter timeline**: `user_id % 4096` — hash shard, scale via 4K shards.
- **HBase region**: range by row key — 时限扫 批量 efficient.
- **Vitess**:  auto-shard, directory-based (vtgate lookup route).

---

## 三、Replication / Topology

### 单主模式 (leader-follower)

单 shard 内 leader + 2+ followers。 leader 承载 write, followers 承载 reads.
- 若 leader down → Raft/Paxos elect new leader (5-10s).
- RPO = ack to client after fsync+半数. replication lag reads maybe stale.

### 多主多 region

CockroachDB **multi-region 表**:
- `PRIMARY REGION "us-east"`  all table 在 该区域
- `REGIONAL BY ROW`: each row across regions based region key
- `GLOBAL` 表: table 跨 all regions 一致 replicas

### 链式复制 Chain Replication

Head → middle → tail (写入顺序, 仅 tail 可读). 低 latency reads, 单 tail throughput bottleneck. 用于 strong consistency read 线.

---

## 四、跨 shard transaction

### 2PC via XA (2 Phase Commit)

```sql
XA START 'tx1';
UPDATE accounts_1 SET balance = balance - 100 WHERE user_id = 42;
UPDATE accounts_2 SET balance = balance + 100 WHERE user_id = 99;
XA END 'tx1';
XA PREPARE 'tx1';
XA COMMIT 'tx1';
```

Pros: Strict ACID; Cons: latency ~10-50ms, 2PC 阻塞 coordinator 崩 死锁。

### Saga Pattern

每个 shard update is local transaction + 补偿 undo event.

```
Service A deduct (shard 1). commit event.
Service B add (shard 2). commit event ∈ kafka.
if B fails, emit compensation event to A.
```

### CockroachDB cross-shard serializability

HLC + Paxos replication + 2PC (internally impl), 应用不用手写 2PC; ~80ms serially.

---

## 五、Reshard / Rebalance

### Hash-Based With Consistent Hashing

```
consistent hashing ring + virtual nodes (150 vnodes per node per Riak).
add node → move ~1/N data.
```

### Range Split

```
Shard starts [0, MAX]; 当 shard 负载 > threshold → split.
new shard hot until cache prewarm.
```

### Vitess VReplication

1. vreplicate双写 + binlog capture.
2. 等到 slave caught up → 切新 shard 全读.
3. remove old shard.

---

## 六、典型事故

### Instagram 2014 reshard

Originally 12-postgres shard by user_id % 4096. 随着 user 增长, 单 shard 接近 max capacity. Upgrade 12→24 requires a massive data migration; Instagram did it via logical replication + 临时读写两 方案。  migration took 6 months planning.

### Uber Schemaless / Holodeck Sharding

Uber 的 early 阶段 used hash sharding 后 由于 shard 数少 hot shard 叠加 让 drivers available 数写 慢。 created custom shard: partitioned by `city_id + user_id` 双 层 shard.

### Figma: no sharding at all

Figma uses single PostgreSQL instance (2021 blog) for up to 1B+ objects, relying heavily on Nginx + Redis cache + heavy horizontal read replicas. Write stayed moderate because most user actions generate **local state** that 未 persist each micro gesture.

---

## 七、易错清单

1. **Shard key 选择 必 基于 query pattern**: 不能随便 `hash(random)` — 以后 查 单 user 跨 shard 太贵.
2. **Reshard 的 migrate cost 巨大**: plan for "scale 2-4× what you need now" to avoid immediate migration.
3. **Cross-shard transaction is hard: 2PC 才 linearizable, Saga eventual, eventual 是 path correct 但 业务 onus 大**.
4. **Read replica can become stale and cause user to see old data**: 控制 replication lag; read-after-write consistency 必须.

---

## 八、这一章带走的东西

1. Sharding = hash / range / directory; 选 key 基于 query pattern.
2. Replication = leader-follower (单主) / 链 / 多主多 region.
3. Cross-shard tx = 2PC (ACID) vs Saga (eventual), trade latency and consistency.
4. Reshard with consistent hashing (move 1/N data) or range split (less data move).
5. Instagram / Uber / Figma patterns confirm shard design dictated by product use-cases.

---

下一节 → [Multi-region](multi-region.md)
