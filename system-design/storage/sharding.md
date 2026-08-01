# Sharding

## TL;DR

**Sharding** 把数据按某 key hash/range 分散到多台机器上, 让写入 throughput 随机器数线性扩展. 核心难关:
1. **Shard Key 怎么选**: 重写 index 经常 painful, 选错 hot shard。
2. **路由 mechanism**: client 直知 shard 还是 coordinator 转?
3. **Rebalance 算法**: 加机器 / 减机器需要 move 多少 data?
4. **Cross-shard transactions**: ACID 跨 shard 难, eventual 与 2PC 之间取 trade-off.
5. **Hot shard (long-tail load)**: 单 shard 60% traffic 因 celebrity / 明星 key.

本章梳理 4 类主要 sharding 模式 (hash / range / directory / consistent hashing), rebalance 数据迁移代价, classic story (Instagram 2014 12-shard, Imgur unkeyed shard, Twitter tweepy snowflake hot shard) + modern automation (Vitess, Vitess, Spilo, Aurora auto-shard)。

---

## 一、Hash-based Sharding

### 算法

```
shard_id = hash(mod, partition_key) % N_shards
```

例: `user_id % 1024`。 简单, 路由直接 calc hash, 不需 meta-store lookup。

### 优点

- 分布均匀 (假设 hash 函数好, e.g., FNV1a / MURMUR3)
- 路由 O(1), client 端可算

### 缺点

- **加机器需 rehash**: N 增加 → 几乎所有 keys 重新 mapping, 大 move。
- **Range query 无效**: 相邻 user_id 可能落不同 shard。
- **Hot key 仍存在巨大单 hot shard**: hop-key hashed 仍 al 热足中 shard 中 (上 fine 一 hot instance)。

### 修复 (consistent hashing)

见后节。

---

## 二、Range-based Sharding

### 算法

```
range mapping: [(min, sh1), (a, sh2), (b, sh3), ..., (max, shN)]
```

适用于**按 key 顺序扫描的查询**:
- 时序数据 by timestamp range
- 用户 ID by alphabetical range
- 主键范围 scan query

### 优点

- **范围查询高效**: shards 在 同 range 内, query 落单一 shard。
- **Rebalance 低成本**: split a range × 2, half the keys migrate. Less than full rehash。
- **自然 co-locating**: 相关 keys 同 shard (e.g., 同 user_id 的所有 events)。

### 缺点

- **Hot range**: 单 range (e.g., 过去 1 小时写入) 高写 traffic. recent writes 全到一个 shard。
- **Add Shard**: 切 range 的 split 影响, multiple shard keys moved 可以轻量但  cross-middle high  brief 因为前缀 hot range.

### Real Example

HBase region is by row-key range. Amazon DynamoDB Streams 同时也是. Range 说 timestamp 正好 natural range.

Spanner interleaved tables: parent + child share shard (key prefix). child placement near parent for join optimization。

---

## 三、Directory-based Sharding

### 算法

```
key → lookup mapping table → shard_id
```

有一 central directory service (metadata DB) 指 key 到 shard 映射. dynamic shard mapping.

### 优点

- **灵活**: 如果某 shard 太热, 手动 split 单 key 到新 shard. update directory.
- **Migration 灵活**: 客户端不经 hash, 经 directory service, 整体栈 decoupled.

### 缺点

- **Directory service是瓶颈 + 单点风险**: 所有 request 都过目录. RAID multi-replic service + cache + hot-shard rebalance for scale.
- **High latency**: 一 extra network lookup; directory cache 引入 stale risk (与 shard split timing mismatch).

### Real example

Vitess MySQL uses **vtgate** as a router to MySQL shards. **vttablet** per MySQL instance. vtgate lookup global topology in etcd.

Apache ShardingSphere, PostgreSQL 通过 Citus 提供类似 dynamic sharding.

---

## 四、Consistent Hashing

### 算法思想

```
环 ring 模型:
   node hashes random fixed position in ring (0 ... 2^32-1)
   key hashes to position in same ring
   路由到 first node clockwise from key position
```

加 new node N:
- 仅 keys 在 (key_pos_in ring, N_pos) 选 reassign to N.
- 其他 keys 不变.

平均 N = ring中所有 keys, 期望贡献比例 = 1/(nodes_count). 在新 node 加入, 转 $1/N$ 不重.

### Virtual Nodes (Vnodes)

Single hash position 可能让一些 node 拥有过 multiple 区段. 用 **N virtual node per physical node** 让分布更均匀:
- each physical node mapped to ~150 virtual positions on ring
- 给均匀 hash distribution

Cassandra, Scylladb, Riak 默认 vnodes = 256 per physical node. Redis Cluster 沿 0-16384 hash slots.

### 优缺点

- **加机器 only 1/N 数据 move**: 总 key 数据量 × (1/N) move. Add 10th node to 9-node cluster → 1/(=N) data = ~10% keys rehash。Perfect.
- **Range query 仍无效**: range queries cross multiple shards (no range locality)
- **Hash ring + cache invalidation**: hot shard if multiple hot keys to same virtual node — 仍然 issue。

---

## 五、Cross-shard 事务

事务跨多 shards 是 distributed systems hard problem. 几种方案:

### Two-Phase Commit (2PC)

```
Coordinator:
1. 联系所有 participants "准备".
2. 各 participants hold lock + ready, ack.
3. Coordinator 收齐 ack → "commit" to all.
4. participants commit + release lock.
```

- linearizable + atomic + cross-shard transactional。
- 但 blocking coordinator fail, lock waiting time long
- 取舍: latency 高; 性能不佳。

### Saga (Compensating Transactions)

```
Stage 1 (svc1): WRITE → commit.
Stage 2 (svc2): WRITE → commit.
if Stage 2 fail: emit "undo Stage 1 (Compensate)".
```

- eventual consistency
- Business-level compensation
- 多 for distributed transactions where 2PC 不行

### Eventual consistency + idempotent retry

```
Service 1 update + emit event → topic. Service 2 consumes event + 更新 local。
```

- High throughput, async, basicallySaga.
- 不 strict atomic.

### CockroachDB / Spanner cp Atomicity 2PC across shards

内部 2PL + Paxos replica + 2PC 跨 shard:
- Performance ~80ms per transaction (compared to 5ms single shard)
- Strict serializable + linearizable + cross-shard ACID

Trade-off is large; only used when must.
Ÿ

---

## 六、Rebalance & Migration

### Range Sharding Split

```
shard 负载 > threshold → split: shard_a takes [0, 50] shard_a_new takes [50, 100]
move keys [50, 100] to new shard。
```

期间:
- **Dual-write**: client dual-write new + old shard 期间 migration window.
- **Read from new shard after migrate complete**

### Hash Sharding Rebalance

非 consistent hashing:
- 增 N → rehash几乎所有 keys.
- 多数 production hash-based sharding 用 consistent hashing 解决.

consistent hashing:
- 同 vnode count per node 加 new node reassign vnode slot.
- multiple vnodes per physical node 容易 load balance.

### Coordinator-assisted migrations (Vitess)

Vitess vreplication engine 让 migration while serving:
1. vstream capturing changes on source.
2.Keeping vstream 同 starting point shard migration pulls.
3. After catch-up, swap-over write traffic.
4. tear down old.

Migration **draining binary** flip client routing — full hot migration, no downtime.

---

## 七、Hot Shard mitigation

### Read Replica

读写 hot key → route read to replica → DB 主几 复 flash reserved for replica。 
Cassandra Naturally多个 replica. 实际流量分布 across multiple replicas + read repair。

### Caching Hot Key (Redis local tier)

If hot-key data fits in Redis, server-side cache each local Redis 实例 hit reduce DB load 99%.

### Celebrity Problem + Pre-compute at cache-layer

Twitter fan-out a Coulter during "Kardashian post".PropTypes: pre-detected celebrity + "fanout reduction" — write celebrity timeline read instead of pushing all his//her posts to followers' inbox. Real engineering pattern.

### Cache Replication

Cache 多副本, local 反向 proxy cache cluster with consistent hash routing + replicate top	keys to multiple caches (Caffeine + Ristretto with bloom/cuckoo hot-key replication support).

### Multi-level One Machine Side Cache (read-through)

Application server in-process cache (Guava Caffeine / HashiCorp LRUdb / Ristretto) for hottest few thousand keys to shield multiple layers。

---

## 八、typical case

### Instagram 2014 Sharding by user_id

Migration from monolithic Postgres to 12+ Postgres instances by sharding user_id hash direct keys mod 4096:
```
shard = user_id % 4096
instance = shard / (4096 / 12) // 分配每 instance 多 shard key
```

purpose 选 4096 在 future scaling — 加 to 24 后 让粉 federations in half cost migration simple. cart 上 5 years after use ACTOR still 4096-shard model in Facebook 5 years 后.

### Twitter Snowflake + user_shard

Snowflake ID 是全球唯一 ID generated by:

```
timestamp_ms | datacenter_id | worker_id | sequence
```

Snowflake 让 social graph split 但 user_id_nés' 高 hit routing  +  caching - 每用户数据 co-resident (covidding share) keys 食均.

### Vitess - YouTube at scale

Vitess 自 2011 开始 at YouTube. toda y open source USED by Slack, Square Cash, GitHub multim. clusters with thousands of MySQL shards. Requirements: ACID transactions at cross-shard (Vitess vstream v2 plan), migration online, etc.

### Vitess + cross-shard transactions

Vitess VStream 提供 save point transaction across shards, **limited semantics as 2PC per-Vitess** at higher latency coin.

---

## 九、典型事故

### Shard Split Pain

某公司 host-based shard 加 scheduler, + 基础 directory table update split ranges hot shard, 实际 后 client 健康状态 stale cache split after → look up old shard 个 fail 5 seconds. Fix: dual-cycle served while directory cache propagates.

### Postgres Hot Table (Citus)

Citus cluster with 4 nodes, one node has 70% hashes hit based on user_id.一个人用户频繁 user_id 正好分布 region shard。 Redis local cache that hot user → 修复.

### Vitess vstream replication logs bit-drift race

Vitess retry-mode vcstream logic over long-table migrate pound wall causing 表 率 alerts.2018 vert spurious panic trov you. Fix batch vstream consensus.

---

## 十、易错清单

1. **Initial shard 第一步先 聚 集 hot-key range**: 数 dynamic user.  Need a factor of 4-10x margin.
2. **Hash-based range query cannot efficiently span shards**: 如果 业务优先 rаngе, 选 range-based sharding 不 hash.
3. **Vnodes ≠ guaranteed 热邓小平 distribution**: 即使 consistent hashing, **single hot key** hits one vnode, no help. Need cache + pre-compute.
4. **2PC cross-shard latency > 10× single-shard**: cross-shard ACID 不 should large throughput. Saga 或 eventual consistency preferred for hot path.
5. **Pre-balancing hot-key监控**: 偶尔 hot 单 key surge (e.g., download/hot news) 提 前见 re-route  critical. 
6. **Migration always dual-write during transition**: dual-caching key avoidance keeps safe availability.
7. **Shard key must not change**: if sharding key changes, row must re-homes.
8. **PostgreSQL primary key after split-over**: UNIVERSE has 棋 consensus key per table shards 平台 multi-tenant ideal first place.

---

## 十一、这一章带走的东西

1. Sharding 方式: hash O(1) 路由 + 写均匀但 range queries 无; range 自然 range + 子查询 efficient 但 hot 集中; directory-like metadata locator.
2. Consistent hashing 加 node 仅 1/N 数据迁移: 适合 dynamic cluster size.
3. Hot shard mitigation: pre-cache + 完美 celebrity special handling + multi-tier cache Layer.
4. Cross-shard transaction: 2PC 严哥latency 80ms+; Saga / eventual consistency 是 scalable path.
5. Migration **dual-write + read from new + final swap**, downtime free.
6. Practical: Instagram foreshadowed 4096-shard hash, well designed scalable without bottleneck 斚 10 years.

---

下一节 → [缓存](../cache/index.html)
