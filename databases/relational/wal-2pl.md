# WAL / redo / undo / 2PL

## TL;DR

WAL（Write-Ahead Logging）是数据库所有持久性保障的基础。Mohan 1992 ARIES 是工业级 WAL + recovery 标准协议（Postgres/MySQL/Oracle/SQL Server 全变体于此）。本节把 WAL 原则、物理 vs 逻辑日志、ARIES 三阶段（analysis / redo / undo + CLR）、fuzzy checkpoint、S2PL 防 cascading abort、2PC 协议、fsync 真实行为（FS + SSD cache）一次走通。理解 WAL = 理解数据库"为什么 commit 这么慢" + "为什么崩溃不丢" + "为什么 2PC 阻塞无法避免"。

---

## 一、WAL 原则

> "Before any modified data page can be flushed to disk, the WAL record describing that modification must be persisted (fsync) to durable storage."

术语：
- data page：B+ tree 的叶节点 / heap 块 / index 叶子
- WAL redo log：append-only 文件 (segment 通常环形)
- buffer pool / page cache：内存中的 data page 副本
- LSN (Log Sequence Number)：WAL 每条 record 的单调 ID

修改流程：

```
1. T1 begins
2. T1 INSERT row → mutate page P_x in buffer pool
3. WAL redo log append: "LSN=100, txn=T1, page=P_x, after-image"
4. T1 UPDATE → mutate page P_y
5. WAL redo log append: "LSN=101, txn=T1, page=P_y"
6. T1 COMMIT → append "LSN=102, txn=T1, commit" → fsync(WAL)
7. commit returned to client
8. checkpoint 或 replacement 策略 flush data pages P_x, P_y to disk
```

WAL 原则：步骤 8 flush data page 前必须保证 LSN 100/101 都已在 disk WAL。否则 page 写盘后 disk 上 data 是 modified 内容，但 WAL 没有 → 崩溃时无法重放。

PostgreSQL：data page 每页都存 LSN (page LSN = max WAL record affecting this page)。flush page 前比 WAL flush 到 LSN ≥ 该页 page LSN → 强 consistency。

---

## 二、redo log 与 undo log

### 2.1 redo log

记录"动作发生了什么"——崩溃后 replay 重做：
- **物理 redo**："page id=0x1000 byte offset 0x10 = value 0xCAFE"
  - 重放简单（保证 page ID 不变 → 重做不会破）
  - 跨版本 page layout 兼容差
  - MySQL InnoDB / SQL Server 用物理 redo
- **逻辑 redo**：在 row 语义层面记录
  - "INSERT row id=5 to users, columns={name='Alice'}"
  - 重放复杂：需要"找 users 表 / 找合适位置"
  - 跨版本 page layout 兼容强
  - PostgreSQL redo 是逻辑记录（page-level：覆写整页的 column value）

PostgreSQL 还保留 **FPI（Full Page Image）**：第一次修改某 page 时把整页 snapshot 到 WAL，保证 redo 之前 page 状态完整可验。

### 2.2 undo log

记录"如何反向操作"——rollback 用：
- **物理 undo**："page id=0x1000 byte offset 0x10 = value 0xBEEF"（旧值）
- **逻辑 undo**："INSERT row id=5 的反向 = DELETE row=5"

InnoDB undo log 同时用来：
1. rollback 事务
2. MVCC history chain（旧版本数据存在 undo log）

PostgreSQL 不使用 undo log——旧版本永远在 heap 中。rollback 只需把 commit marker 改成 aborted 即可，heap 中的旧 tuple 被 vacuum 清。

### 2.3 各引擎对比

| 引擎 | redo 类型 | undo 类型 |
|------|----------|----------|
| PostgreSQL | 物理 + 逻辑混合（带 FPI） | 仅有 abort marker 在 heap |
| MySQL InnoDB | 物理（page-level） | 逻辑记录 + 物理 row image |
| Oracle | 物理 (LGWR) | 物理 (undo segments) |
| SQL Server | 物理 (TL) | 逻辑 (delete/insert 反) |
| DB2 | 物理 + 逻辑 | 物理 |

---

## 三、ARIES 三阶段

### 3.1 阶段图

```
崩溃
   ↓
[Analysis] 扫描 WAL 从 last_checkpoint LSN
   - 列出 active_txns (未 commit 未 abort)
   - 列出 dirty_page_table
   - 找到 redo_start = earliest dirty page LSN

↓
[Redo] 从 redo_start 顺序扫 WAL
   - apply each record again（idempotent）
   - 完成后所有 disk page 与 crash 前一致

↓
[Undo] 从 highest_LSN 的事务倒着扫
   - 对 active_txns 中的每个 txn
   - 顺序 reverse 该 txn 的 update record
   - apply undo action
   - 写 CLR (Compensation Log Record) "已 undo"
   - 写 final abort record
```

### 3.2 CLR（Compensation Log Record）

ARI 创新： undone 动作 也是有恢复性的——如果 undo 操作时再 crash，重启后不应该 re-undo（会重复作用）。

解决：每次 undo 写 CLR：
- CLR 与原 record LSN 不同（新 LSN）
- CLR 描述"the undo of record @old_lsn is applied"
- CLR 自带 undo_next_lsn，指向之前应该 undo 的下一条 LSN

→ undo 时即便再次 crash，analysis 看见 CLR 可跳过。

### 3.3 fuzzy checkpoint

```
1. write "begin_checkpoint" record to WAL
2. (短时间内) 收集 buffer pool dirty_pages + active_txns 快照
3. write "end_checkpoint" record + metadata + fsync
4. update master_checkpoint_ptr to end_checkpoint_LSN
```

Between begin/end，其他 transactions 仍可正常工作 → fuzzy。Analysis 时 begin/end 间的 active txn 可能再变化，但 end 已 store 实际值即可。

### 3.4 PostgreSQL 与 ARIES 差异

PostgreSQL **不做**真 undo（startup recovery 阶段中没有 undo pass）：
1. PG 没有 undo log，旧版本永远在 heap 中不需 undo
2. 崩溃后直接把 aborted txn 的 tuple 完成 commit marker 改成 aborted → vacuum 后清理
3. redo pass 重放 WAL → 把所有 committed 数据重做到 page；uncommitted 的 tuple 后 mark aborted

简化 implementation，但 FPI 让 WAL record 量更大。

---

## 四、S2PL 与 commit ordering

### 4.1 Cascading Abort

```
T1: write row A
T2: read row A (T1 未 commit，持 S 锁)
T1: abort → rollback row A
T2: read 是垃圾数据 → T2 也要 abort → cascading abort
```

RC 下 + 普通锁会 cascading abort。

### 4.2 S2PL 给解决

严格 2PL（Strict 2PL）：**X 锁保留到 commit**。S 锁可 mid-txn release，但 X 锁不能。

→ T2 拿不到 S 锁等 T1 commit / abort 之后。

### 4.3 SS2PL（rigorous 2PL）

**所有锁（S+X）保留到 commit**。主流数据库默认 SS2PL：

```
T1: BEGIN
T1: write A, X-lock(A)
T1: commit → release X-lock(A), S-lock(A), ...
```

---

## 五、2PC（两阶段提交）

跨分片 commit：

```
                     coordinator
                           │
                           │ prepare
                           ↓
participant_1                    participant_2
   prepare → vote YES            prepare → vote YES
                           ↓
                  coordinator 决定 commit (若都 YES)
                           ↓
   commit + ack                    commit + ack
                           ↓
                     coordinator complete
```

每个参与者：
- prepare：在本地 WAL 写 "prepared" record + fsync 该 record + 持 X 锁
- 收 coordinator commit / abort：写相应 record + 释放 X 锁 + ack

**严重阻塞点**：coordinator crash 后，participants 必须**无限阻塞**——不能单方面 abort（可能 coordinator 已发 commit 给某个 alive participant）。

### 5.1 heuristics

如果 coordinator 长时间无应答，参与者可用启发式：
- `heuristically_rollback`：假设 abort，本地 rollback（可能误）
- `heuristically_commit`：假设 commit，本地 commit（可能不一致）

→ 一旦用了启发式 → **可能数据不一致**。所有厂商强烈不推荐。

### 5.2 三阶段提交（3PC）

3PC 避免 coordinator crash 阻塞，但 requires timer + 三阶段通信 + 额外 RPC。实际部署：
- DB 层不用 3PC
- 分布式事务一律 2PC + 超短 wait
- 业务层 saga / TCC 等补偿模型代替长持有

### 5.3 PostgreSQL prepared transaction

```sql
BEGIN;
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
PREPARE TRANSACTION 'transfer_to_dba';
-- 此事务阻塞，直到 COMMIT/ABORT PREPARED
COMMIT PREPARED 'transfer_to_dba';
```

`max_prepared_transactions` 默认 0（禁用）。灾难点：遗忘 prepared → long-held X lock → 阻塞下游写。监控 `pg_prepared_xacts` 列表：

```sql
SELECT age(now(), prepared) FROM pg_prepared_xacts;
-- > 5 min 应该告警
```

### 5.4 MySQL XA

```sql
XA START 'transfer1';
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
XA END 'transfer1';
XA PREPARE 'transfer1';
XA COMMIT 'transfer1';
```

MySQL XA 与 PG prepared 一样有阻塞点。运维必须监控 XA prepared 超时审计。

---

## 六、fsync 行为的玄学

```
client app: writes (data page) to buffer
kernel: data in page cache
write(fd, buf) → 仅 copy 到 page cache
fdatasync(fd) → 内核 require write I/O → SSD controller → SSD cache → NAND
fsync(fd) → 同上 + 文件 metadata sync
open(O_DIRECT) → 跳过 page cache 直写
```

### 6.1 fsync 没保证

- 如果 `fsync(file_a)` 后，磁盘控制器 NVRAM buffer 仍 cache：断电后部分 write 没到 NAND → durability 没保证
- 部分型号 SATA SSD "假装" fsync 完成——bug 名："silent data loss"
- `md-raid` `writecache` 作 promiser - 不可知

### 6.2 内核 panic

Linux 5.x 的 `syncfs()` / `fsync()` 在 server-side 故障模式下静默返回成功 (Ref USENIX OSDI '14 Pillai)。生产必须 verify。

### 6.3 fsync 同 device 与 fsync 其他 file on same device

- ext4 / xfs 默认 journal order 全 file write → fsync 一种 file fsync metadata + data
- ext4 `data=journal`：所有 data 在 journal 中双写

### 6.4 PostgreSQL `wal_sync_method`

```bash
$ PG wal_sync_method
wal_sync_method = fsync      # 默认 Linux
wal_level = replica
```

选项：
- `fsync`：标准 fsync() syscall
- `fdatasync`：仅 data 不 metadata（PG 9.6+ Linux 大多数发行版）
- `open_sync`：open(O_SYNC) 每写入 fsync-like
- `open_datasync`：open(O_DSYNC) per write

性能差异通常：fdatasync ≈ open_datasync > fsync。

### 6.5 真"事务安全"验证

- `pg_test_fsync`：测试不同 fsync 方法延迟，写 8KB × N
- `sysbench fileio --file-fsync-flush=on --file-fsync-all=on`
- 严防 fake fsync：consumer SSD 标 "workstation" mode 有时会感觉换 cache

### 6.6 SAS NVMe SSD

- `nvme admin-passthru` 查 `volatile_write_cache` 状态
- enterprise NVMe 默认 power-loss protection → fsync 必真实
- consumer NVMe 必查 PLP；必要时禁用 `nvme_cache_enable=0`

---

## 七、产线事故

### 7.1 fsync 不真 → 崩溃丢已 commit 数据

PG 跑廉价 SATA SSD，断电后已 commit 数据消失。

**根因**：SSD 控制器 cache "battery-free" 假装 fsync 立即完成，NAND not yet fixed。

**修复**：enterprise SSD with PLP；启用 fsync 行为测试（pg_test_fsync）+ `wal_sync_method=fsync + synchronous_commit=on`。

### 7.2 长事务阻塞 InnoDB undo purge

业务 5 min 长查询 + 100 QPS 热点表 INSERT → undo tablespace 从 1 GB → 30 GB → 80 GB 警报。

**修复**：长查询走 read-only replica；调 `innodb_max_purge_lag = 65536` 让大 undo 阻塞新 INSERT。

### 7.3 2PC coordinator crash 30 分钟业务阻塞

微服务跨分片 2PC，coordinator crash → participants hold lock 30 min wait → 业务吞吐 0。

**修复**：业务换 Saga pattern：业务事件队列 + 接收方幂等消费，避免 in-database 2PC。

### 7.4 checkpoint 频率 vs recovery time

InnoDB `innodb_max_dirty_pages_pct = 75` 太低 → checkpoint 频繁 flush → I/O 占满 backup → 崩溃 recovery 时间 5 秒。但 production I/O 饱和。调到 90% + 双 buffer pool flushing → recovery 30 秒，业务延迟降 30%。

### 7.5 PG `synchronous_commit = off` 后崩溃丢信

某业务开 `synchronous_commit=off`（追求性能），断电后丢最近 5s 写入。

**根因**：PG commit 返回 client 时不等 fsync。fsync-sensitive 业务不可接受。

**修复**：核心交易路径 `synchronous_commit=on, local`（仍 commit）。

---

## 八、易错清单

1. **fsync 不是真物**——廉价 SSD / Linux FS 有许多 silent data loss path
2. **WAL 只能 fsync 不能 fsync-mixed**：必须先 fsync WAL 再 fsync data page
3. **PG 没有 undo pass**——与 ARIES 不同。简化实现，但 redo log 含 FPI 量更大
4. **MySQL `innodb_flush_log_at_trx_commit=2`** 是 fsync=每秒 → DB 可丢 last 1s 数据
5. **PG prepared transaction 必监控**——coordinator 长时间没决定 → lock 持有无上界
6. **SSD PLP** (Power Loss Protection) 是 production 必查项
7. **synchronous_commit=off** 仅性能场景可接受；交易系必须 on
8. **2PC 必有阻塞**——业务应 saga / TCC 替代

---

## 九、这一章带走的东西

1. WAL 原则：modified page flush 前 WAL record 必已 fsync 到 platter
2. ARIES 三阶段 analysis → redo → undo（含 CLR）；PostgreSQL 不做 undo pass
3. 物理 vs 逻辑 redo：PostgreSQL 选择逻辑 + FPI；MySQL 选择物理 page-level
4. SS2PL：所有锁保持到 commit 防止 cascading abort
5. 2PC coordinator crash → participants 无限阻塞，业务必须 saga / TCC 替代
6. fsync behavior 真实硬件 PLP 是 production 必查项；廉价 SSD 假装已完成 fsync
7. checkpoint 调优 = I/O 平面 vs recovery 时间 tradeoff；大 buffer pool + slow flushing 是 best practice

## 下一节 →

[索引与存储结构](../indexing/index.html) — B+ tree / LSM-Tree / Hash / GIN / GiST / BRIN / explain analyze 解读
