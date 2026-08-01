# MVCC 原理：PostgreSQL vs InnoDB

## TL;DR

MVCC = Multi-Version Concurrency Control，让"读不阻塞写、写不阻塞读"。PostgreSQL 选择 **append-only heap + t_xmin/t_xmax** 模型，InnoDB 选择 **原 in-place modify + undo log chain** 模型——两者都在实现 SI/RR，但 weight 在 heap bloat / undo log 增长上完全不同。本节带你读完两者的 tuple header 真实字节、visibility test rules、为什么 PostgreSQL 强依赖 vacuum，InnoDB 强依赖 purge thread，什么业务在哪个 DB 上开销更大。

---

## 一、为什么需要 MVCC

如果只用 2PL：读者拿 S 锁，写者拿 X 锁，互斥。一个交易系统下午跑 `SELECT count(*) FROM orders` 会卡死所有 INSERT。

MVCC 改成：每事务分配 snapshot（一组 active_txns 或 timestamp），读老 snapshot 看旧版本，写也只写新版本 → 直接并发不互锁；只有在两事务**write same row**时通过 mutex 串行化。

---

## 二、PostgreSQL MVCC：append-only heap

### 2.1 HeapTupleHeader 字节布局（PG 14+）

```c
typedef struct HeapTupleFields {
    TransactionId t_xmin;     // 4B - inserting xid
    TransactionId t_xmax;     // 4B - deleting/updating xid
    union {
        CommandId t_cid;      // 4B - command id within txn
        uint32    t_xvac;
    } t_field3;
} HeapTupleFields;

typedef struct DatumTupleFields {
    int32   datum_len_;
    int32   datum_typmod;
    Oid     datum_typeid;
} DatumTupleFields;

typedef struct HeapTupleHeaderData {
    union {
        HeapTupleFields t_heap;
        DatumTupleFields t_datum;
    } t_choice;
    ItemPointerData t_ctid;   // 6B - row pointer to current/next version
    uint16 t_infomask2;       // num attrs + flags
    uint16 t_infomask;        // xmin/xmax committed/aborted flags
    uint8  t_hoff;            // header len
    bits8  t_bits[FLEXIBLE];  // null bitmap
    // ... data follows ...
} HeapTupleHeaderData;
```

每 tuple header 固定 23 字节（外加 null bitmap / OID 等）。`t_ctid`（ItemPointer）是 `(block_number, offset_number)` 双 32-bit 字段。

### 2.2 三层 visibility 算法

```c
HeapTupleSatisfiesMVCC(tuple, snapshot, cid):
    let xmin = tuple.xmin
    let xmax = tuple.xmax

    // 1) "Is xmin visible to my snapshot?"
    if XidInvisibleToSnapshot(xmin, snapshot): return Invisible
    if XidCommittedPostSnapshot(xmin, snapshot): return Invisible

    // 2) "Was xmin in-flight when snapshot was taken?"
    if XidInProgressAtSnapshot(xmin, snapshot):
        if xmin != current_xid: return Invisible  // 别人的未提交
        // 是我自己写过的
        if cid > snapshot.cid: return Invisible   // snapshot 前没看到的
        // 这条是我自己 visible

    // 3) "Has xmin been aborted?"
    if XidAborted(xmin): return Invisible
    
    // OK, tuple was visible to snapshot unless:
    // 4) "Is xmax committed (or mine later than snapshot)?"
    if xmax != InvalidXid:
        if XidInProgressAtSnapshot(xmax, snapshot) and xmax == current_xid:
            if tuple.t_ctid == self.t_ctid: return Visible  // UPDATE by myself still ok
            else: return Invisible
        if XidCommittedPreSnapshot(xmax, snapshot): return Invisible  // already deleted
    
    return Visible
```

> [!NOTE]
> `XidInvisibleToSnapshot` 用 `snapshot.xip` (active xids array) + `snapshot.xmin` (oldest active) + `snapshot.xmax` (next xid) 三组数据作 O(1) 判定。

### 2.3 Update = INSERT new + UPDATE old.xmax

PostgreSQL `UPDATE` 永远是**写新 tuple + 标记旧 tuple 的 xmax**：

```sql
UPDATE users SET name = 'Bob' WHERE id = 5;
```

实际：
1. 找到旧 tuple (xmax InvalidXid)，line pointer `t_ctid` 指向自己
2. 新 tuple inserted in heap (xmin=current xid，xmax=Invalid)
3. 旧 tuple `t_xmax = current xid`，`t_ctid` 改为指向新 tuple 的 block+offset
4. （commit 后 - infomask 加 XMAX_COMMITTED）

→ **旧 tuple 一直在 heap 中占空间**，直到 vacuum。

### 2.4 vacuum 机制

- **autovacuum launcher** 周期运行：
  - 老表 dead tuple 比例 ≥ `autovacuum_vacuum_scale_factor (default 0.2)` 触发
  - 大表改成 `autovacuum_vacuum_threshold` + scale factor 配合
- **`VACUUM`**：标记 dead tuple space 在 page 内 FREE (line pointer 保留) → 可重用，**不返磁盘 OS**
- **`VACUUM FULL`**：锁表 → rebuild compact → return space to FS。**表锁期间读写阻塞**
- **`VACUUM (PARALLEL N)`** PG 13+ 启用多 worker 并发 vacuum

### 2.5 Bloat

PostgreSQL 老死数据堆积：
```
n_dead_tup  : 888M   (来自 pg_stat_user_tables.n_dead_tup)
n_live_tup  : 120M
→ bloat ratio = 7x bloat
```

诊断工具：
- `pgstattuple` 扩展给精确 bloat estimate
- `pg_stat_user_tables` 看 dead/living ratio
- 监工 Prometheus 检 `pg_table_bloat_size`

修复：
- 调 `autovacuum_vacuum_scale_factor = 0.05`
- 大表 setting 独立 `ALTER TABLE t SET (autovacuum_vacuum_scale_factor = 0.02)`
- 启 `pg_repack` 在线 rewrite table

### 2.6 PostgreSQL 没有 clustered index

PG 表是 **heap**：line pointer 在 `pg_attribute` 列里，二级索引的 item pointer 直接指向 heap `(block, offset)`。clustered index 通过 `CLUSTER` 一次性 reorder heap by 某 index，但**不能自动维护**（更新后 heap 不 reorder）。

→ 二级索引 lookup：1 I/O 索引叶 + 1 I/O heap page。InnoDB 相比需要 3 I/O（二级索引 + 主键 + row data）。

---

## 三、InnoDB MVCC：in-place + undo log

### 3.1 Clustered index = primary key B+ tree

InnoDB 表的主键是 **clustered B+ tree**，叶子节点直接存 row data：
```
PRIMARY KEY (id):
    [1, ...row data]
    [2, ...row data]
    ...
    
secondary index (user_id):
    [user_id=10, primary_key=1]
    [user_id=10, primary_key=2]
    ...
```

hidden fields（每 row 7+6+6+ = ~22 bytes）：
```
DB_TRX_ID      6 bytes - last modifying trx_id
DB_ROLL_PTR    7 bytes - pointer to undo log
DB_ROW_ID      6 bytes - 内部 row id (only if no PK)
```

### 3.2 Update 模型：in-place modify + undo record

UPDATE 一次：
1. 读 cluster index leaf row
2. 把**旧版本整 row 写到 undo log segment**（roll_ptr 指向 undo log entry）
3. cluster index page 原地写新版本 row
4. commit undo log access → 后可解析

### 3.3 旧版本访问（rollback chain）

```c
// pseudo-code
Tuple ReadConsistentRec(query_snapshot, row):
    // start with cluster row (newest version)
    let rec = row
    while rec.trx_id > snapshot_visible(rec.trx_id):
        // 新 trx 不属于我的 snapshot
        rec = reconstruct_from_undo_log(rec.roll_ptr)
    return rec
```

undo log 在 **回滚段**（undo tablespace）中存；如果没人需要旧版本 → purge thread 可释放。

### 3.4 purge thread

MySQL 启动后台 purge thread：
- 检查每个 undo log 是否所有 active snapshot 都 ≥ 新表
- 是 → 该 undo log entry 可释放
- 释放 undo page

调参：
```sql
innodb_max_purge_lag = 0              # 默认无限制 (越高让 INSERT 自动慢)
innodb_max_purge_lag_delay = 0          # 不延迟 insert
innodb_purge_batch_size = 300           # purge batch 量
innodb_undo_log_truncate = ON           # truncate undo tablespace
```

### 3.5 bloat 与 vacuum 对比

| 维度 | PostgreSQL | InnoDB |
|------|-------------|--------|
| 旧版本位置 | heap 中（占主数据空间） | undo log（独立 segment） |
| 回收 | vacuum/FULL 锁表 | purge thread 自动 |
| 高频 update 行 | bloat 大 | undo log 增长大 |
| 长事务 panic | 长事务持有的 snapshot 阻 vacuum | dominated undo log 迅猛长 |
| 二级索引 lookup | line pointer → 1 I/O heap | PK ≥ 1 I/O → cluster leaf 1 I/O = ≥ 2 I/O |
| Clustered PK | 无原生 | 默认主键 |
| 索引覆盖 | 直接 from secondary | 仅当 SELECT 列被 idx + PK covers 可跳 cluster |

---

## 四、为什么 InnoDB purge 不锁表，PG 看死锁

**PostgreSQL 缺陷**：vacuum 必须扫全表 dead tuples 释放空间——10 TB 表 vacuum 单线程几小时。autovacuum 触发慢 → bloat 急升。

**InnoDB 缺陷**：原 in-place modify 修改 page → 必须先写 undo log → page 改完后才能 commit → 写放大比高；且**所有 active snapshot 必须 ≥ undo log min trx_id**，否则不能 purge → 长事务会让 undo log gobble 100 GB。

业务推荐：

| 业务 | 推荐 | 原因 |
|------|------|------|
| OLTP INSERT-heavy | PG / MySQL 都行 | 新数据 footer 增，前者 secondary 直接 line ptr |
| OLTP UPDATE-heavy | InnoDB 占优 | undo log + purge 自动，PG bloat 必须配 vacuum 调度 |
| 报表 SELECT 全表扫 | InnoDB 占优（clustered PK） | cluster 顺序 IO |
| Ad-hoc index 多 | PostgreSQL 占优 | secondary 索引直 line ptr，clustered 灵活 |
| Range scan (BETWEEN many rows) | InnoDB（clustered range I/O 友好） | / PG 二级索引扫需要回表多次随机 I/O |
| JSONB / typed | PostgreSQL（原 JSONB row type） | InnoDB 不擅长 json |

---

## 五、产线事故

### 5.1 PostgreSQL vacuum 滞后致 bloat 不可修

100 GB `orders` 表 7 天更新频繁，vacuum 跟不上 → bloat = 10x，但业务同时大查询 → I/O 满 → vacuum 跑慢 → 滚雪球到 80% bloat。

**修复**：
- `ALTER TABLE orders SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 10000000)`
- 加 `maintenance_work_mem = 4GB` 让 vacuum 用 memory 索引
- 升 PG 16+ 用 incremental sort 减 vacuum
- 最坏：窗口期 `VACUUM FULL` + 业务 SLA 60s 不可用

### 5.2 InnoDB undo tablespace 增长到 60 GB

业务跑超长 query（10 min SELECT）持有读 snapshot，purge thread 不能释放 undo log → undo tablespace 从 1 GB 增到 60 GB，磁盘告警。

**修复**：
- 业务让超长查询用 read replica（独立 undo 不涨，但这需要业务改造）
- 设 `innodb_max_purge_lag = 65536` → 65536 undo records 上限防 INSERT，让业务自慢、迫使有人释放长事务
- 启 `innodb_undo_log_truncate = ON`，定期 truncate undo tablespace

### 5.3 MySQL 转 PostgreSQL 业务"为啥 UPDATE 慢多了"

某团队迁 MySQL → PG：业务大量 UPDATE，发现 PG 中 throughput 比原 MySQL 慢 30%。

**根因**：PG UPDATE = NEW tuple + mark + 索引页也都要指针更新（每个 secondary index 都要 INSERT index entry）。InnoDB UPDATE in-place，仅 modified column 对应 secondary index 才改。

**修复**：
- 把 stable 字段与变动字段分离（`child` 表只存变化频繁字段，主表保留 stable）
- 改 hot column HOT（Heap Only Tuple） pattern，PG 13 + `fillfactor = 85` 让 update 不动 secondary index（如果改的字段不出现 index）

### 5.4 REPEATABLE READ 事务 + 长 vacuum block

PG 在长事务 commit 期间，autovacuum 阻塞释放该表 dead tuples（vacuum 是其他事务正常快照的 visibility-safe）。每小时事务慢一度，bloat 累加 1% / 周 → 几个月单表膨胀 50%。

**修复**：长事务哑改短批处理；ultrafast 应用 `idle_in_transaction_session_timeout = 60000` 让 60 秒空闲事务 abort。

---

## 六、易错清单

1. **PG secondary index 不会随 UPDATE in-place modify**：每 UPDATE 在二级索引插入新 entry，老 entry 标记 dead → 索引也 bloat
2. **InnoDB 二级索引 lookup 必回 clustered index**：除非覆盖索引 所有 SELECT 字段都在 idx 上
3. **PG vacuum 锁表？** 普通 vacuum 不锁；VACUUM FULL 锁
4. **InnoDB purge 比真空快很多**：但仍依赖短读事务
5. **`autovacuum_vacuum_scale_factor` 默认 0.2** 大表太宽松——总是 ≥ 调 0.05
6. **InnoDB = MySQL engine 唯一选项**：但有 RocksDB MyRocks、TokuDB，但在交易系我不推荐
7. `clustered index` 在 InnoDB 必须是主键；没声明主键选 unique not null column，再没有就用隐式 DB_ROW_ID

---

## 七、这一章带走的东西

1. PostgreSQL MVCC = append-only heap + `t_xmin/t_xmax` → 死堆需要 vacuum
2. InnoDB MVCC = in-place modify + undo log chain → 后台 purge thread 自动清理
3. PG secondary index lookup 1 I/O；InnoDB 2 I/O（→ cluster index）
4. PG `UPDATE` 让每个 secondary index 都加新 entry，InnoDB 主要是 modified column 改动 index
5. PG 大表 vacuum 必须调小 scale_factor + 大 maintenance_work_mem + 考虑 `pg_repack`
6. InnoDB undo tablespace 单独存放，长事务会让它暴涨——超长 SELECT 必须 read replica
7. HOT（Heap Only Tuple）让 PG `UPDATE` 不更新二级索引是性能救星，但需 fillfactor < 100 且改字段不出现在 index

## 下一节 →

[WAL / redo / undo / 2PL](wal-2pl.md) — ARIES 三阶段、fuzzy checkpoint、CLR、fsync 行为、2PC 阻塞点
