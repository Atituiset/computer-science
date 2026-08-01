# Google BigTable / Spanner / Chubby

## TL;DR

Google 三驾马车论文 (2003-2012) 奠定了 modern cloud infrastructure 的基础:
1. **GFS (2003) / Colossus**: 分布式文件系统, append-only large files, chunk server + master
2. **BigTable (2006)**: sparse, distributed, persistent multi-dimensional sorted map (like wide-column store before Cassandra); Google's structured data platform
3. **Chubby (2006)**: distributed lock service (Paxos-based), 提供 small files + locks, 创始人后来演化 Spanner
4. **Spanner (2012)**: Google's globally-distributed SQL database 实现 external consistency (TrueTime+2PL).

这些 paper 跨 10 年发展, 从 GFS 到 Spanner 逐步打磨。本章概述每系统架构, trade-off, 工程师教训。

---

## 二、GFS / Colossus (存储层)

### 架构

```
Client → GFS Master (in-memory metadata) 
   → multiple Chunk Servers (Linux x86 with local disk)
```

- Files 分成 64 MB chunks, replication 3 (default).
- Master: single for metadata (name space, chunk mapping) — with persistent log + checkpoint recovery.
- Chunk Server: only store data, heartbeats to master.

### Design

- **Optimized for large streaming reads + append writes**. Not random writes. No byte-range locking.
- **Append-only log** to files: multiple clients concurrently append; GFS guarantees at-least-once append with record boundary, Application must handle duplicates.
- **Single master** for metadata; Chubby later Paxos replace master.

### 关键教训

- Single master bottleneck: bandwidth master ~1M ops/sec manageable, but failover  long.
- Record append: can have duplicate bytes; application padding or checksum.

### 后继: Colossus / D

GFS 演进到 Colossus (distributed, no single metadata server, real-time replication,  high usage in Google storage stack). Spanner 及 BigTable sit on Colossus.

---

## 三、BigTable (2006) — Wide-column Store

### 数据模型

```
(row, column_family:column, timestamp) → cell value
Sorted by row lexicographically.
```

Sparse: each row can have different columns, for web crawl data.

### 架构

```
Client → BigTable Master (lightweight)
Tablet servers (serve data + Paxos-based replication)
Backed by GFS for storing SSTables + WAL.
Chubby lock service for master election.
```

- Tablets: contiguous row-range (dynamic split). ~100MB each.
- SSTables: immutable, LSM-tree compaction (compaction merges + delete tombstone).
- WAL on GFS + MemTable scan.

### Design decisions

- Locality group per column family: can group frequently accessed columns together in memory (e.g., `content` family vs `metadata` family).
- Bloom filter per SSTable, reduce random reads.
- Single-row transaction (atomic read-modify-write) within a row.

### 关键教训

- tablet split/rebalance 用 Chubby lock 调整; 运行中建复 杂 拆分 成本 高。
- tablet server crash 需 WAL replay (from GFS) 重启, recovery time minutes.

---

## 四、Chubby (2006) — lock service

### 目的

Paxos-based library for distributed coordination (like a small Zookeeper) for master election + locking.

### API

```
Open(file), Close(file), GetContents(), SetContents()
Lock(file), TryLock(file), GetSequencer()
```

- 文件 小 (< 256KB) — not file system, but lock + config store.
- Session lease: client lease 60s, renew each 30s heartbeat.
- Client 拿到 sequencer 后 lock 保证 顺序.

### 复制

5 instances Paxos group, majority quorum; leader 选 持 有 60s lease.

### 关键教训

- Chubby 不可用于 高吞吐 性 —— lock contention 单 leader; 只 hold metadata.
- 之后 引入 基于 于 Chubby 的 Spanner Paxos groups replication.

---

## 五、Spanner (2012) — Google's globally-distributed SQL

### 关键特性

1. **External Consistency**: strict serializable + linearizable across the world (TrueTime + commit-wait).
2. **SQL** (not just KV), rich query + interleaved tables.
3. **Sharded into Paxos groups** (one group per data tablet ~100-1000 rows).
4. **2PC across Paxos groups** for cross-shard transactions.
5. **TrueTime**: {earliest, latest} API + commit-wait to ensure commit_ts is strictly in the past.

### Data Model

```sql
CREATE TABLE Users (
  uid INT64 NOT NULL,
  email STRING(128),
) PRIMARY KEY (uid);

CREATE TABLE Albums (
  uid INT64 NOT NULL,
  aid INT64 NOT NULL,
  name STRING(128),
) PRIMARY KEY (uid, aid),
  INTERLEAVE IN PARENT Users;
```

Interleaved tables: Albums stored in same Paxos group as parent Users — join free local reads.

### Architecture

```
Zone1 Master (with Paxos group)   Zone2   Zone3
    |                                |       |
   Colossus DFS <-- Paxos log
```

每 tablet Paxos group: 5 replicas per zone. Spanner driver knows about sharding and TrueTime.

### 关键教训

- commit-wait ~14ms (TrueTime uncertainty). Not cheap; but consistent across continents.
- Interleaved tables is mandatory for performance; without it 2PC cost 高。
- Automatic resharding: tablet split based on size + load.

### Spanner vs CockroachDB

| 对比 | Spanner | CockroachDB |
|------|---------|-------------|
| Time source | TrueTime (atomic clock+ GPS) | HLC (NTP, max offset 250ms) |
| External Consistency | ✅ Strictly | ❌ Not supported (bounded staleness) |
| SQL dialect | GoogleSQL | PostgreSQL |
| Interleaved tables | ✅ | ❌ (无) |
| Deploy model | Google Cloud only | open source, any cloud |
| License | Proprietary | Open Source (BSL now CDL) |

---

## 六、综合 Impact: Three Papers

这三 papers 变成 分布式系统 课程 必读, 同时 produce real products:
1. **BigTable → HBase** (Apache HBase is open source BigTable rewrite)
2. **GFS → HDFS** (Apache Hadoop HDFS inspired by GFS)
3. **Chubby → ZooKeeper / etcd**
4. **Spanner → CockroachDB / YugaByte / TiDB** (followers)

Google 内部 2003-2012 这 10 年间 实现了 分布式 infrastructure 几乎全部 基板。

---

## 七、典型事故与教训

### GFS Chunk server fail domino

GFS 早期 整 组 3 chunk server all 同 rack, when rack switch fail, data lost. Fix: cross-rack placement mandatory; ensure all replicas on different rack domains.

### BigTable Tablet Split Storm

Too rapid tablet dynamic split: 600 tablets 在一 table→ 2K+ after hours storm: routing overhead cluster slow. Fix: throttle tablet split rate -> background tasks.

### Chubby Paxos Leader Election Delay

Chubby master 崩溃 后 leader election 15s pause 因 lock quorum, clients with stale lease 认 still valid lock, double locking 可能. Fix: higher epoch lease numbers + client always check lease validity.

### Spanner 15ms commit-wait latency P99 spike

跨 zones 1% packet loss causes TrueTime outlier latency up 50ms commit-wait. Fix: network BBR TCP adds congestion control + retry.

---

## 八、易错清单

1. **GFS 不一致 append 乱字节**: record writer 写 需 checksum; ensure application know at-least-once.
2. **BigTable 单行事务 only**: cross-row multi-table 无 ACID; 必须 自己 embed 应用层 序 + cleanup.
3. **Spanner commit-wait 依赖 GPS/GPS loss**: 长时间 无 TrueTime = Spanner 暂停写 或 退 成 eventual。 多 GPS + 原子钟 mandatory.
4. **Interleaved tables 让数据局部 性 write**: 若 child table 高 write, parent group write hot。

---

## 九、这一章带走的东西

1. GFS/Colossus: 分布式文件系统 append-only optimized for large streaming.
2. BigTable: sparse wide-column store with LSM on GFS + Chubby coordination.
3. Chubby: Paxos-based lock service bring coordination + 服务 discovery.
4. Spanner: globally distributed SQL database — first external consistency implementation, TrueTime 是关键。
5. Google 三 papers 贯穿 分布式 infrastructure backbone; virtually every other distributed DB inspired by them.
6. "Why can't Spanner be everywhere cost is ~15ms commit wait, requires Google-level infrastructure".

---

下一节 → [Dynamo Family](dynamo-family.md)
