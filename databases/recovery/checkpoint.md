# Checkpoint 与 Point-in-Time 恢复 (PITR)

## TL;DR

Checkpoint 是数据库 crash recovery 的 "beacon"——把 buffer pool dirty pages 与 WAL active txns 同步 snapshot 到 disk + 控制 WAL replay window。PITR (Point-in-Time Recovery) = base backup + WAL archive → reconstruct 任意时刻数据库状态。本节覆盖 PG `pg_basebackup` + `pgBackRest`、MySQL `xtrabackup`、Oracle RMAN、跨云 DR 实战 archive 策略 + WAL GPO 限。

---

## 一、Checkpoint 流程

```
1. CHECKPOINT_BEGIN record → WAL
2. 收集 dirty_pages snapshot (fuzzy, 不锁 buffer pool)
3. 启 bgwriter + checkpointer workers flush dirty pages 到 disk
   其中关键:**每个 dirty page flush 前 WAL 必先 fsync 到 LSN >= page.LSN**
4. CHECKPOINT_END record → WAL + fsync
5. 更新 control file: last_checkpoint_lsn
```

PostgreSQL checkpointer 是独立进程（自 9.2），不阻塞前台 SQL。

恢复时：
- 启动 read control file → 拿 last_checkpoint_lsn
- WAL scan from that LSN → analysis → redo → undo
- recovery time ≈ checkpoint 之后的 WAL 体积

---

## 二、Fuzzy Checkpoint 优化

fuzzy checkpoint = "begin/end" 标记之间 dirty pages 与 active txns 仍可变。精细化 checkpoint：
- 不锁 buffer pool → 前台 throughput stable
- end_record 只 snapshot fuzzy state

PG 12+ `checkpoint_completion_target = 0.9`：
- 维持 elapsed_time_per_checkpoint = 0.9 × checkpoint_timeout 让检查点不最后一刻 hardcoded
- bgwriter 平稳 flush 而非最后 IOPS 飙

---

## 三、Point-in-Time Recovery (PITR)

### 3.1 全流程

```
T0: base backup 完成 (热备份, 物理 file copy + WAL rec offset)
T1: 数据正常写入持续 → WAL archive 到 S3/GCS 
T2: 人为删除表: DROP TABLE important_users; (营运误删)
T3: 第二天发现，想恢复到 T2-1s

操作:
1. 新建一个恢复 instance (不覆盖原 instance)
2. reload base backup at T0
3. setup restore_command (从 S3 拉 WAL)
4. recovery_target_time = T2 - 1s
5. 启动 → replay WAL from T0_lsn until T2-1s
6. promote 完成
```

### 3.2 PG `pg_basebackup` + `archive_command`

```ini
# Primary postgresql.conf
archive_mode = on
archive_command = 'wal-g wal-push %p'   # 或 pgBackRest, 自 push S3
archive_timeout = 60s                     # 没 INSERT 时强制 checkpoint 切 WAL file
wal_level = replica                       # or logical

# Restore side
restore_command = 'wal-g wal-fetch "%f" "%p"'
recovery_target_time = '2024-10-23 14:59:59'
recovery_target_action = 'promote'       # or pause, shutdown
```

启动后 1920+ 秒后空闲：
1. 先重放 base backup (冷数据)
2. 然后 fetching WAL from S3 顺序 replay 直到 recovery_target_time
3. promote：切断与原 primary 联系，本身 promote up

### 3.3 MySQL `xtrabackup` + binlog

```bash
# primary
xtrabackup --backup --target-dir=/var/backup/full-001

# restore
xtrabackup --prepare --target-dir=/var/backup/full-001
xtrabackup --copy-back --target-dir=/var/backup/full-001

# binlog replay until time T2:
mysqlbinlog --stop-datetime='2024-10-23 14:59:59' \
    /var/lib/mysql/binlog.001012 \
    /var/lib/mysql/binlog.001013 \
    | mysql -u root
```

MySQL 用 binlog 而非 redo log 做 PITR；binlog 写 commit，但更靠 logical。

### 3.4 Oracle RMAN

```rman
RMAN> RESTORE DATABASE UNTIL TIME "TO_DATE('2024-10-23 14:59:59','YYYY-MM-DD HH24:MI:SS')";
RMAN> RECOVER DATABASE UNTIL TIME "TO_DATE('2024-10-23 14:59:59','YYYY-MM-DD HH24:MI:SS')";
```

Oracle RMAN 提供 block-level incremental + image copy 模式。

---

## 四、WAL archive 策略

### 4.1 PG `archive_command` 模式

```ini
archive_command = 'test ! -f /mnt/s3-wal/%f && cp %p /mnt/s3-wal/%f'
archive_timeout = 60s        # 强制切 WAL
archive_cleanup_delay = 5min # primary vs replica 配 lag taste
```

要点：
- archive_command 成功返回 0；否则 PG 持续重试阻塞
- WAL file 名是 16MB 标准文件，按 hex 命名
- 太长 archive timeout 让 idle 段后没新 WAL 紧急 PITR 失败

### 4.2 pgBackRest / WAL-G

两个第三方工具都做：
- 异步 push WAL 至 S3/GCS/Azure
- full + incremental base backup
- compression + encryption
- restore_packet scaling support

```bash
pgbackrest --stanza=main --type=incr --archive-only backup
```

### 4.3 GPO 限与恢复性能

WAL 策略 mock 容量：
- daily WAL：`wal_keep_size=1GB` 让复制延迟容错时间
- archive 远端：60s 切 file，每 min 新 WAL pushed

PITR 时 24h replay 1GB WAL → typical 10 分钟。可并行：
- PG 14+ `recovery_prefetch`：standby 启 retry 后并行 prefetch WAL

---

## 五、Incremental Base Backup

传统 PG full backup 周末跑 10TB → 几小时。新版：
- PG 17+ `pg_basebackup --incremental` (RMAN 风格): 使用 page_lsn 对比，仅变 page 入 backup
- 也用 `pgBackRest incremental` 同方案

MySQL InnoDB `xtrabackup` 也支持 incremental by page LSN：

```bash
xtrabackup --backup --target-dir=/backup/base
xtrabackup --backup --target-dir=/backup/inc1 --incremental-basedir=/backup/base --incremental-lsn=LSN_FROM_BASE
```

---

## 六、产线事故

### 6.1 archive_command 失败 8h → PG 卡死

业务 S3 限速超 → cp 命令一直 timeout → archive_command 失败 8h 后 PG stop：
```sql
STATE: waiting for WAL segment to be archived
```

**修复**：
- 让 archive_command `aws s3 cp` 加 `--cli-read-timeout 30 --cli-connect-timeout 5` 限制
- 监控 `pg_stat_archiver.failed_count`，3 次失败就告警
- 紧急 `pg_switch_wal()` force 切新 WAL；emergency mode `archive_mode = off` + `archive_command = /bin/true` 让 PG 推进

### 6.2 重 WAL 写导致基线备份过慢

10 TB 数据 → `pg_basebackup` 5h → 业务 backup SLA 1h。

**修复**：启用 `pg_basebackup --incremental` (PG 17+) 或 pgBackRest cumul 备份。

### 6.3 误删表后 PITR 失败

```
T0 = yesterday base backup
T2 = 误 DROP TABLE important_users
T2 - 10s is planned recovery target
```

archive_command 在 T2 时 archive 失败（S3 上传中盘空间不足），导致 T2 前 WAL 不全，PITR 只能到 T1 → important_users 内容早就 OK 但其他表更新丢。

**修复**：
- archive 上传 success 验证 + retry 上传
- 加监控 archive success rate

### 6.4 binlog row event 错误
MySQL 5.7 → 8.0 升级 binlog row format 兼容性，部分 statement-unsafe statement（UUID()）导致 PITR replay 后数据偏差。

**修复**：强制 binlog_format=ROW (但兼容业务 sync_gateway)。

### 6.5 Restore 时 recovery_target_time 太精确
想恢复到 14:59:59 但 WAL 已切，PITR target 落 15:00:00 跨段 → 报错。

**修复**：
```ini
recovery_target_time = '2024-10-23 14:59:59+00'
recovery_target_inclusive = false
recovery_target_xid = '...';   # 或用 xid
recovery_target_lsn = '0/12345678';  # PG10+ 用 LSN
```

---

## 七、易错清单

1. **archive_command 失败后 PG 不推进新 WAL**：fanout archive 后检测
2. **base backup 期间 switch LSN**：恢复后 from base_lsn repeat WAL
3. **MySQL binlog_format STATEMENT**：PITR 后 row 数据可能偏差
4. **`recovery_target_time`** 必须含 timezone
5. **promote 之后切新 primary 不回滚**：promote is one-way
6. **archive_command sync 单 WAL** 超过 60s 阻塞 commit；用 async push (WAL-G async)

---

## 八、这一章带走的东西

1. Checkpoint 是 fuzzy snapshot；不锁 buffer pool；最后 control file 更新 last_checkpoint_lsn
2. PITR = base backup + WAL archive；恢复到 `recovery_target_time` / `recovery_target_lsn`
3. PG `archive_command` 设计要点：sync 限 60s、监控 failed_count
4. 增量 base backup (PG 17+ `--incremental`、pgBackRest、xtrabackup) 节省带宽
5. 严业务护航 standby：archive success rate、监控 S3 push 健康
6. MySQL PITR 主要靠 binlog，format 限制 ROW 防 PITR 后偏差
7. 跨云 DR：archive push 主流加 SSE + lifecycle policy 让老 WAL 归档 cold tier

## 下一节 →

[查询优化](../optimization/README.md) — RBO/CBO、join 算法、向量化执行
