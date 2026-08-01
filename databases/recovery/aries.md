# WAL 协议、ARIES

## TL;DR

详细 WAL 原理参考 [relational/wal-2pl.md](../relational/wal-2pl.md)。本节重点恢复流程的执行时序、CLR 链表、checkpoint 配置、长事务对恢复时间影响。生产 PG/MySQL 调优实战：`checkpoint_timeout` / `max_wal_size` / `innodb_max_dirty_pages_pct`、崩溃后 30 分钟起不来根因分析。

---

## 一、WAL 协议核心三条

1. **commit 前**：所有 redo record 必须 fsync 到 stable storage
2. **脏页 flush 前**：该页对应的最新 WAL LSN 必须先持久化（WAL before data）
3. **commit record 写入+fsync OK** → 事务视为已提交

```
DB begin
T1 insert R → WAL append "UPDATE R new value"
                WAL buffer (in memory)
T1 commit:
   → WAL append "COMMIT T1"
   → fsync(WAL)     ← 这里 block 直 to platter
   → return ok to client
T1 picked as durable
later:
   buffer flushes modified page R to disk (不必 fsync，WAL 已保证)
```

`fsync(WAL)` 是 commit 慢的根因。

---

## 二、恢复三阶段 (ARIES)

### 2.1 Analysis

从 last_checkpoint LSN 开始扫描 WAL：
- 建 dirty page table：每个脏页的最早修改 LSN (rec_lsn)
- 建 active txns 表：begin/update/abort/commit 读出未完成事务
- 找到所有未 commit / abort 的事务

```c
analysis(state):
    cp = read_checkpoint()
    redo_start = MAX_REDO_LSN
    rec_lsn_buf = {}
    for rec in scan_wal_from(cp.redo_lsn):
        match rec {
            UpdateRec(lsn, txn, page_id) => {
                if rec_lsn_buf.find(page_id) == None:
                    rec_lsn_buf[page_id] = lsn
                state.active_txns[txn] = lsn
            }
            CommitRec(lsn, txn) => state.active_txns -= txn
            AbortRec(lsn, txn)  => state.active_txns -= txn
            CLRec(lsn, txn, undo_next) => state.active_txns[txn] = lsn
        }
    state.dirty_pages = rec_lsn_buf
```

### 2.2 Redo

从 dirty_pages 中最小 rec_lsn 开始回放所有 redo 记录：

```c
redo(state):
    redo_start = state.dirty_pages.min_rec_lsn()

    for rec in scan_wal_from(redo_start):
        if rec is UpdateRec(page_id, after_image):
            page = load_from_disk(page_id)
            if page.LSN < rec.LSN:                  ← idempotent 检查
                apply(page, after_image)
                page.LSN = rec.LSN
                write_back_to_buffer(page)
```

幂等性靠 `page.LSN < rec.LSN` 检查：page 已经被后续 LSN 改过则跳过；只 apply 还未应用的 redo。

### 2.3 Undo

从最新 LSN 倒着扫 active_txns 列表：

```c
undo(state):
    active = sort_by_last_lsn_desc(state.active_txns)
    for txn in active:
        lsn = txn.last_lsn
        while lsn != None:
            rec = read_rec_from_wal(lsn)
            apply_undo(rec, get_old_image(rec))
            write_CLR_to_wal(rec, undo_next_lsn=rec.prev_in_txn)
            lsn = rec.prev_in_txn
        write_final_abort_record(txn)
```

CLR 写到 WAL 防再次 crash 导致重复 undo。

---

## 三、CLR 详细

```
Normal Record: UPDATE T row R new value = N
CLR:           Undo T row R old_value = O; undo_next_lsn = PREV_LSN
```

CLR 是 **REDO-only**——重放时只 redo 该 undo 操作（即把 page 修改回 O），不需要 undo CLR 本身。

```
Undo pass 真正工作：
1. WAL record LSN=100: T1 R=N (new)
2. undo → 写 CLR LSN=105: T1 undo R=O; undo_next_lsn=99 (上一个 T1 的事)
3. ... 持续 undo T1
4. final abort record LSN=110
```

如果 redo 阶段读取 page.LSN=105（CLR 被改），就跳过原 redo LSN=100——幂等性。

---

## 四、Checkpoint 配置实战

### 4.1 PostgreSQL

```bash
checkpoint_timeout = 5min              # 默认 5 min；production 5-10 min
max_wal_size = 1GB                     # 默认 1GB；大业务 4-20GB
min_wal_size = 80MB                    # 保留 wal
checkpoint_completion_target = 0.9     # 100% checkpoint 时间内平稳写
checkpoint_flush_after = 256kB         # 强制 OS page cache 清出
wal_compression = on                   # WAL gzip/lz4
wal_buffers = 16MB
max_wal_senders = 10                   # 物理复制
```

checkpoint 频率 trade-off：
- 太频：bgwriter 持续占 I/O
- 太稀：崩溃后 replay 100GB WAL → 几小时宕机

### 4.2 MySQL InnoDB

```sql
innodb_flush_log_at_trx_commit = 1                  # 每次 commit fsync
innodb_flush_method = O_DIRECT                       # 避 OS write cache 双写
innodb_max_dirty_pages_pct = 90                      # 90% after 进 checkpoint
innodb_max_dirty_pages_pct_lwm = 10                  # lower water mark
innodb_adaptive_flushing = ON                        # 自适应 flushing
innodb_adaptive_flushing_lwm = 10
innodb_checkpoint_max_age = 28800                    # max WAL age (秒 30K)
```

InnoDB 的 redo log 大小由 `innodb_log_file_size` × `innodb_log_files_in_group` 决定；MySQL 8.0.30 起用单 variable `innodb_redo_log_capacity`。

---

## 五、长事务影响 undo 时间

PostgreSQL 不做真 undo（旧版本永远在 heap），但 commit marker 改 aborted：
- 速度快
- 数据 waste——直到 vacuum 才清

MySQL InnoDB 真 undo 翻全 active txns 倒扫 log：
- 长事务 → undo chain 长
- 阻 purge thread 持续
- 启动后 undo replay 30-300 秒

监控：
```sql
SELECT @@innodb_buffer_pool_pages_dirty / @@innodb_buffer_pool_pages_total;
-- 应 < 30%
```

---

## 六、恢复性能优化方向

恢复时间与 checkpoint 后 WAL 体积线性：
```
recovery_time ≈ (WAL_size_after_checkpoint / WAL_apply_throughput)
              + (active_txns_undo_time)
```

优化方向：
1. **缩短 checkpoint 间隔**：`checkpoint_timeout=5min` (PG)、`innodb_max_dirty_pages_pct=75` (MySQL)
2. **减少长事务**：避免 idle_in_transaction（`idle_in_transaction_session_timeout=60s`）
3. **并行 redo apply**：MySQL 8.0 functional redo、Oracle parallel recovery
4. **PG incremental checkpoint**（11+）：周期刷页 base on LSN
5. **Standby replay 多线程**（PG logical replication worker）

---

## 七、产线事故

### 7.1 40 GB WAL → 20 分钟启动恢复
某 PG 业务 8 GB max_wal_size + 30 分钟 checkpoint_timeout → crash 时 30 GB WAL pending → 启动恢复 25 分钟。

**修复**：`max_wal_size=2GB`、`checkpoint_timeout=5min`、启 `checkpoint_completion_target=0.9` 让检查点平滑。

### 7.2 2 PC prepared 事务 led restart 30 分钟
PG `max_prepared_transactions=100` 业务忘 commit → restart 时所有 prepared 需要„rollback permit"，hold X lock 阻塞启动 → fail-over 二次。

**修复**：autovacuum 监控 prepared age；precondition 后 `ROLLBACK PREPARED 'txn_id'`。

### 7.3 InnoDB undo 长
长事务 (10 min SELECT) → undo tablespace 增长到 80 GB。重启 undo replay 时长 25 分钟。

**修复**：`innodb_max_purge_lag = 65536`，超 lag 阻新 INSERT；读副本或 read replica 统计查询。

### 7.4 FPI massive on first dirty page
某 PG 业务 dirty page 一遍没刷，更新第二次 FPI 写一份 →那时的 WAL 是双倍。

**修复**：`full_page_writes = off` (ZFS / Btrfs fsync 的人可用)；或启 `wal_compression = on`。

### 7.5 MySQL log file swap on restart
8 GB log file，commit 等慢 50ms。

**修复**：log 简化，`innodb_log_file_size = 1GB` (8 文件)，`innodb_buffer_pool_size = RAM × 0.6`。

---

## 八、易错清单

1. **`fsync() != real durability`**：硬件 PLP 才有保证
2. **checkpoint 太稀导致恢复长**：默认 5 分钟不够，30 分钟太夸张
3. **PG `full_page_writes=off`** 节省 WAL 但要求 FS 真做 fsync（zfs/btrfs ext4 data=journal 安全）
4. **MySQL 5.7 log file change** 必须 slow shutdown；MySQL 8 dynamic
5. **2PC prepared 长 hold lock**：业务必监控 prepared age
6. **PG logical replication** 走 logical WAL，没参与 crash recovery
7. **recovery 完成后才进入 archive mode**：startup 阶段不接受查询

---

## 九、这一章带走的东西

1. WAL 原则：先写日志再写数据，commit = fsync WAL
2. ARIES = Analysis → Redo → Undo 三阶段，幂等性靠 `page.LSN < rec.LSN` 与 CLR
3. CLR linked list 通过 undo_next_lsn 指之前要 undo 的 record
4. PG 不真 undo，commit marker 改 aborted 即可
5. checkpoint 频率 = I/O 平面 vs recovery 时间 tradeoff
6. 长事务 → undo chain 长 → 启动后恢复慢
7. 监控 `n_prepared_xacts`、`innodb_buffer_pool_pages_dirty`、`pg_stat_progress_vacuum`

## 下一节 →

[Checkpoint、Point-in-time 恢复](checkpoint.md) — physical standby / logical replication / base backup / WAL archive / pgBackRest / 恢复到任意时刻
