# WAL / LSM / B-tree 内部

## TL;DR

存储引擎内部差异: **WAL (Write-Ahead Log)** + **B-Tree** vs **LSM-Tree** 是 OLTP 数据库两个最重要建树。
- **B-tree**: 经典 O(log N) 平衡树—每个 page 大小固定 (16KB), 写路径需 in-place update + WAL。适合读多写少。Postgres heap、MySQL InnoDB、MongoDB WiredTiger (built-in LSM 选项)、SQLite 都用 B-tree。
- **LSM-tree (Log-Structured Merge Tree)** 由 Patrick O'Neil 1996 提出: 写入先 append 到 WAL + MemTable (in-memory sorted), 后台 compaction 到 SSTables on disk, 不 in-place update 旧数据, 删除 = tombstone marker。 Cassandra RocksDB HBase LevelDB RocksDB Bigtable Spanner 都用 LSM。
- **WAL** 是保证 durability 的"日志式"机制——所有修改先 fsync 到 log, 再 in-memory update 后台 flush; crash 后 WAL replay recovery。 

本章梳理 B-tree page 结构、LSM compaction level、Write Amplification vs Read Amplification 故事、典型 RocksDB / InnoDB / WiredTiger 调参, 与决策树。

---

## 一、WAL (Write-Ahead Log)

### 原理

**A (Atomicity)** + **D (Durability)** of ACID 要求事务的修改先记录 log 一旦 commit 后, 即使 crash 后重启数据文件未刷盘 也恢复。 WAL 顺序 append, fsync 1ms, sequential write fast。

### Protocol (Steal-No-Force)

NO-FORCE: DB commit 后 buffer pool 中 dirty pages 不必立刻 fsync to disk。脏页可能停留几 sec 或更长。
STEAL: 一个事务的修改可能在 commit 前被写入 data file (buffer eviction)。

WAL 保证:
- Commit 已经进入 WAL (fsync-ed) ⇒ 可 replay + redo。
- 未 Commit 的事务 ⇒ undo (用 WAL 中早期 undo log).

### STEAL vs NO-STEAL / FORCE vs NO-FORCE

| 策略 | 含义 | 性能 |
|------|------|------|
| STEAL | 事务未 commit 可被 stolen (脏页 flush) | 高 buffer 复用率, 但 需 undo log |
| NO-STEAL | 仅 commit 后的脏页可 flush | 低 buffer 用率, 简化 recovery |
| FORCE | Commit 后 force ALL 数据 page to disk | 高 commit latency, 无 redo log 必需 |
| NO-FORCE | Commit 后 buffer 可能 keep 脏 | 低 commit latency, 必 redo log |

工业 InnoDB/Postgres/BerkeleyDB 都是 STEAL-NO-FORCE 跑, 学术 80+ 论文最多的研究范式。

### Log Structure

```
LSN | prev_lsn | txn_id | type | page_id | redo/undo data
1   | 0        | t1     | UPDATE | page-5 | before: ..., after: ...
2   | 1        | t1     | COMMIT
3   | 2        | t2     | UPDATE | page-7 | ...
```

### Checkpoint

定期点 maintained necessary future redo, 让 log truncation. ~5 between checkpoints.

```
sharp checkpoint: pause writes, flush all dirty pages, write "checkpoint LSN" to log start; simple.
fuzzy checkpoint: lock-free flush dirty pages gradually before checkpoint marker; modern DB.
```

### 写入 flush + fsync details

- 写入 buffer pool → mem + logical update.
- WAL append → +1 entry to memory + fsync to OS。
- async 后台写 (double buffer pool pages flush to data files).
- Commit confirmation: 客户收 ack 在 WAL fsync 完成之后.

`fsync_latency` 一般 1ms NVMe, 10ms SATA SSD, 30-50ms 5400 rpm HDD.

---

## 二、B-Tree

### 结构

每 node 一个 page (P) — 在内部 node 存 (K... keys + P page pointers), 叶子 node 存真实 (key, value) pairs。

```
                    +--- ROOT ---+
       [k1 | k2 | k3 | ...]
        |   |   |   |
        +----+-----+-----+
             |
       +--- LEAF ---+
       (k1,v1)|...|(k3,v3) + next_leaf指针
```

- 高度 h (h = log_d (N) where d 是 branching factor)
- 每 node B+ 树 (variant) 都有 key + pointer (中间也可有 key for 插入导航)
- 叶子 pointer 构成 "internal linked list" → 范围 scan 顺序高效.

### Search

```
search(key):
  for each level from root:
    line-bisect keys for next page pointer
    page := child.page
  leaf search key within linear (assume sorted leaf) keys.
```

读时间复杂度是 O(log_d N) + O(1) disk page read (assuming worst case cache miss).

### Insert

1. Find leaf (从根到 leaf).
2. Insert key into leaf.
3. If leaf overflow (full page), split leaf + bubble up new key to parent.
4. Repeat until no split need. Root may split ⇒ new root increase height.

### Overhead of Insert / Update

- Page lock (并发控制): 读 / 写 in-page latch.
- Buffer pool eviction + dirty page write-back. 
- WAL append fsync.
- Index updates 同步 (二级索引 all updated on primary key change).

### Performance Characteristics

| 维度 | Performance |
|------|-------------|
| Random read | O(log_d N) page access (1-4 page read typical) |
| Range scan | Sequential page read after find start key |
| Random write | O(log_d N) + WAL fsync + index update; CPU + IO |
| Sequential write | 类似 random write, NOT optimize 的 sequential log |
| Compression | row-format + page-level compression; less than col-based |
| Write Amplification | 大约 1-2 (WAL 1x + page 1x) |
| Read Amplification | 1-4 page reads per query |

### B+ tree 是 B-tree 的 variant

主流数据库 (InnoDB, PG heap indices, SQLite B-Tree) 用 B+ tree:
- B+ tree data 都在 leaves (vs B-tree 在 internal 级)
- Leaf-to-leaf pointer for range scan
- Internal pure key pointer "index" navigation

---

## 三、LSM-Tree

### Architecture

```
          MemTable        SSTable (L0) → SSTable (L1) → SSTable (L2) → ...
                |             merge + compaction
   WAL → 还再响回 i  log al-perfectlyシクce 探讨 ringnier friskleaf nodes level + HMS Drac nos. 
```

- **MemTable**: in-memory sorted table, 同时 WAL 持久化. (skip list or Red-black tree)
- **SSTable**: on-disk sorted table, immutable after field force into disk. file sorted by key.
- **Compaction**: 周期 run "merge sort" 几 SSTables, dedup keep latest value, output lower-level merged SSTable.
- **Levels**: L0 SSTables overlap keys (range overlap). L1+ SSTables within level cover 不重叠 ranges.
- **Bloom Filter** per SSTable, fast reject missing key.

### Write Path

```
insert(key, value):
  WAL.append(InsertEntry)  fsync
  MemTable.put(key, value)
  if MemTable.size > threshold:
    swap MemTable → immutable MemTable → flush to disk as L0 SSTable
    new MemTable created.
```

### Compaction

Size-tiered vs Leveled:

- **Size-tiered** (Cassandra defaults): N 个 SSTables same size bucket merge into 1 SSTable of N× size. 写放大低, 读放大高 (many SSTables).
- **Leveled** (RocksDB defaults): L1 has files ≤ X MB total, L2 ≤ 10× L1, L3 ≤ 10× L2. Each level 是 的 ranges partitioned. 写放大 高 (multi-level rewrite) 但读 only 1 SSTable per level per key check.
- **Hybrid** (RocksDB tiered+leveled): Tunable.

### Read Path

```
get(key):
  snapshot MemTable + immutable MemTables checked first
  For each L0 SSTable (newest first):
    if bloom filter accept:
      read block, lookup key
  For each level L ≥ 1, find 1 overlapping SSTable per level via manifest, check bloom+index then read.
  If tombstone hit → return "deleted".
```

### Compaction Triggering

- L0 file count > L0_threshold (default 4): trigger L0 → L1.
- Level size > target_size: trigger L_i → L_{i+1}.
- background threads parallel compact diff levels.

### Performance Characteristics

| 维度 | Performance |
|------|-------------|
| Random write | O(1) WAL fsync + O(log N) MemTable insert; very fast |
| Sequential write | Same as random, equality |
| Random read | O(L) disk reads (L = level count, ~7 with bloom filter quick reject) |
| Range scan | Multi-SSTable merge; could be 提升 (lower levels) but compaction affects throughput |
| Compression | 各 SSTable block compress独立, ~10x ratio |
| Write Amplification | O(level count) ≈ 30-50x for leveled compaction |
| Read Amplification | O(level count) with bloom, plus per-SSTable IO |

---

## 四、Write Amplification vs Read Amplification

### B-Tree

- ONE random write: WAL (1×) + data page update (1× for in-place) + index updates (1× per index).
- 总 ≈ 2-3× 实际 bytes writes per user write.
- Read 1-4 page reads.

### LSM-Tree Leveled

- ONE random write goes MemTable + WAL, eventually多次 compaction rewrite lower levels.
- For 4 GB work 单 write 走过 L0 → L1 → L2 → ... L6 = 多次rewrite. Total WA ≈ 30-40×.
- Read O(L) ≈ 7 disk reads (with bloom filter quick reject).
- B-tree read 不一定省 IO, 但写 Lsm 比 B-tree 多 10-30× overhead.

### Optimized LSM (LSM-Tree-Trie / Dostoevsky 等)

Modern LSM (e.g., Dostoevsky et al. paper 2017, "Dostoevsky: Better Space-Time Trade-offs..."), Lazy Leveling 与 Hybrid LSM-Trie 减少 write amplification.

Default RocksDB leveled compaction config:
- L0 — 4 files
- L1 — 10MB
- L2 — 100MB
- ...
- L6 — 10TB

但 L6 写放大极高 (each L1 → L2 rewrite L0 data + update L1 + ... up to L6).

### Hot vs Cold 工业例

Cassandra + RocksDB Spanner (Colossus FS + LSM) 有典型:
- Hot 写入: L0 + L1 保留 ~1 hour recent writes. Read mostly these.
- Cold数据: 经过 7+ compaction 进 L6, 几乎不可变.

---

## 五、典型引擎调参

### InnoDB (MySQL)

| 参数 | 默认 | 调优效果 |
|------|------|----------|
| `innodb_buffer_pool_size` | 128MB | 标配 50-75% system RAM。越大 cache 优异 |
| `innodb_flush_log_at_trx_commit` | 1 (fsync per commit) | =2 = OS buffer flush (1s crash lose some) =0 = 不要 fsync (重启丢数) |
| `innodb_log_file_size` | 48MB | 大文件 less checkpoint pressure. 太大 recovery slow. |
| `innodb_file_per_table` | ON | True 方便单表物理隔离, 一表 drop 不损整体; |
| `innodb_flush_method` | O_DIRECT | bypass OS page cache, 防 memory/page buffer doubles |
| `innodb_io_capacity` | 200 | NVMe 推 5000-20000; HDD 推 200-2000 |

### PostgreSQL

| 参数 | 推荐值 |
|------|--------|
| `shared_buffers` | 25% system RAM |
| `effective_cache_size` | 75% system RAM |
| `wal_buffers` | 16MB (default -1 auto) |
| `checkpoint_completion_target` | 0.9 (smooth IO) |
| `max_wal_size` | 64GB+ (high write) |
| `synchronous_commit` | on (default) |
| `wal_compression` | on (节省 IO) |
| `random_page_cost` | 1.1 (NVMe) - disable seq vs random cost estimation |

### RocksDB

| 参数 | 用途 |
|------|------|
| `write_buffer_size` | memtable size, 64-256MB |
| `max_write_buffer_number` | 并 memtable (写 burst cache) |
| `level0_file_num_compaction_trigger` | L0 SSTable count trigger L1 compaction |
| `max_bytes_for_level_base` | L1 target size, 256MB |
| `max_bytes_for_level_multiplier` | 10 default |
| `target_file_size_base` | L1 SSTable file size, 64MB |
| `compaction_style` | leveled (default) / tiered / universal |

### WiredTiger (MongoDB)

- `storage.wiredTiger.engineConfig.cacheSizeGB`
- `storage.wiredTiger.collectionConfig.blockCompressor` (snappy / zlib / zstd)
- `storage.wiredTiger.indexConfig.prefixCompression`

---

## 六、InnoDB 内部架构

InnoDB 是 MySQL 默认 storage engine (5.5+). 内部:

- 主键 = clustered index (叶 sons data, 中节点存主键指针)
- 二级索引 = standalone B-tree 节点存 primary key 与secondary key; secondary key must second花跳 primary key 找 value.
- buffer pool: 14+ GB 主存 cache-page evictions LRU 优化 (mid-LRU, 让 cold page out-入 secondary key 自动头部 + index 防止 full-scan blow up).
- **doublewrite buffer**: 让 write-half (50% permanent partial page write) crash 后可恢复.
- **change buffer**: insert second 跳 write to secondary index buffer 后台 merge.

---

## 七、典型事故与考量

### hat InnoDB double-write buffer;重要性

某用户 close disable `innodb_doublewrite=0`. 经历 partial page write (宕机 半写), 重启后 page 不可逆 corrupt, 数据修复 难 Failover. 推荐保持 ON; overhead ~10-15%.

### PostgreSQL checkpoint I/O 风暴

某用户 配 checkpoint_segments=300 + checkpoint_timeout=300s, write traffic 平稳但 checkpoint 期间 IOPS spike >10× avg, 业务 P99 暴增。Fix: `checkpoint_completion_target=0.9` 让 checkpoint 缓慢刷 IO over full interval; smooth IO spike。

### RocksDB L0 stall

某 Kafka-style high write use RocksDB, 配 64MB memtable 但 L0 compaction 跟不上, L0 ≥ 12 file 进入 stall (RocksDB 自动 backpressure:- stop write)。Fix: `level0_file_num_compaction_trigger=2`, + `max_write_buffer_number=4`.

### Cassandra TTL + compaction 膨胀

Cassandra `gc_grace_seconds=10 days` 默认—— TTL 过期 tombstone 必 wait until after gc_grace before dropping. tombstone accumulation 让查询必须扫所有 SSTable, read throughput 降。Fix: 启用 DTCS / ICS table compaction strategy。

---

## 八、易错清单

1. **WAL fsync 是 durability 的基石**: 关闭 `synchronous_commit` 或 `innodb_flush_log_at_trx_commit=0` 让 commit 1s 内丢失
2. **B-tree 适合读多, LSM 适合写多**: 不了 LSM 读 amplified. 必须 bloom filter + cache 弥补。
3. **Leveled compaction has 高 write amplification** (30-50x); tiered compaction 反之; 选 compaction strategy 应业务 burst traffic.
4. **memtable must fsync 到 WAL 跨 过 user**: MemTable.flush to SSTable normally takes seconds later; WAL fsync per commit is durable lemmas. except priorities: 加 .append-only 置 Abd事 fact  readable even if memory lost.
5. **LSM tombstone 是 another write**: deletion 不立即 free space, compaction 后才 release; storage modified over time. insufficient compaction = storage bloat + read slow.
6. **复合 indexes (e.g. PostgreSQL covering index)** 可减少 B-tree 没数据 索引扫; 但 增加 write amplification. 报 大写 frequently.

---

## 九、这一章带走的东西

1. WAL 是 OLTP 的 durability 与 atomicity 底根. **"write fsync then ack"** 是 database durability 协议。
2. B-tree 是 in-place 写 + 财 +读fast; LSM-tree 是 append-only 多 level 后台 compaction, 写 fast 读需 bloom + L step.
3. Write Amplification LSM 比 B-tree 30-50x 高, 这是为什么 RocksDB 的写throughput 越越大 cluster. Counter balance lookups 跪 lock過 head bump指数 wave act ossessions 喜用 prior.
4. Compaction: size-tiered (low WA, high RA) vs leveled (high WA, low RA); hybrid configuring to workload. Bloom Filter 是 LSM 读关键.
5. PostgreSQL + MySQL tuning: buffer pool + WAL fsync + checkpoint smoothing +  CPU IO capacity.
6. RocksDB/Cassandra: max_write_buffer_number, level_compaction_dynamic_level_bytes, target_file_size_base 与 SSTable count threshold.

---

下一节 → [Sharding](sharding.md)
