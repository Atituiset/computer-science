# WAL、fsync、崩溃一致性

## 一句话

工程上 90% 的"数据丢失 bug" 都因为误以为 write 成功就持久了, 误以为 fsync 一定成功就持久了. 这一章把 Linux + ext4 + NVMe 下的崩溃一致性模型拆开, 让你看到**write / fsync / fdatasync / 终端 cache / 设备电池** 这五层覆盖在 CRIT between user app 与 NVM 实际写完之间.

## 1. 五层缓存

让我们从用户 `write(fd, buf, n)` 把字节真正落到 NVME cell 之间拉一次完整路径:

```
1. user 写 page cache: write 调用 → mark dirty
2. fsync(fd) 等 page cache 实际 writeback
3. writeback → block layer → 组 bio → submit
4. NVMe driver → submission queue → 设备
5. NVMe controller 实际 NAND write + flush + checkpoint
6. NAND cell 物理 charge 写入完成 ack 
```

**每层都是一个 cache**, 每层都可丢失. 这就是为什么 fsync 也不 100% 安全:

```
ext4 fsync → journal commit → 块层 write → NVMe cache → NAND.
```

如果 NVMe 设备有 cache 而 fsync 提交需求没 pass through NVMe cache flush, **fsync ack 但 cache 没到 NAND, 断电仍丢**. 这是真实硬件隐患.

## 2. fsink 提交语义

ext4 / XFS / Btrfs 三种 fs 主流方式:

```
ext4 default data=ordered:
  - dirty pages 先 flushed to data area,
  - journal commit 中写 metadata commit block,
  - fsync 等 journal commit 完成才 return.

ext4 data=writeback:
  - 仅 metadata journal;
  - data 可能 metadata 之后写 → 看到 stale block.

ext4 data=journal:
  - 全部 data journal;
  - 安全但写放太严重 2× overhead.

XFS 默认 delay-write:
  - 类 ordered, 但数据 first delayed write then block flush.

Btrfs:
  - 每 fsync 触发 transid++ commit CoW;
  - 同 XFS 类性能.
```

主要不同: 默认 ext4 `data=ordered` 保证了 **data 不会比 metadata 先丢**——避免 commit metadata 后看到 stale block. 这就是早期 Linux 2.4 NFS 比 ext3 data=journal 用 5 年才改的原因: 写 + crash 后 fs state 一致.

## 3. fdatasync 卷语义

`fdatasync` 不强制 metadata 中 atime/mtime 写盘, 但**强制 data 写盘**. 对 append-only log 是 fdatasync 性能更好.

原因:
```
fsync:
  ## 必等 metadata (size, mtime 等) 写盘
  ## 强制 journal commit

fdatasync:
  ## data 写盘
  ## 仅在 size 改变时 fs 元数据也 stdsync flush
```

**append-only log 上**: 强制 size metadata 也 flush 当且仅当最后大小必须被下次 fs 状态读取. 否则 fdatasync 安全.

## 4. NVMe Force Unit Access (FUA) 与 Volatile Write Cache (VWC)

NVMe 命令支持 bit:
- FUA = Force Unit Access. 命令绕 device cache 直接到 NAND;
- 只 NVM 终端 fdatasync 是不够的 —— 内核驱动通过 IO command `Flush` 给设备写盘.

**SCSI 类硬盘 / 部分 NVMe** 有 volatile write cache. 设备自我 ack fast 但吸收在 device buf. 断电时 buf dump. Linux `write cache = write through` 与 `write back` 区分:

```
hdparm -W0 /dev/sda   # 关闭 write cache
```

关掉 write cache = performance drop 30-50% 但 fsync ack 即感真持久化. HRT / database 推荐.

## 5. 崩溃一致性概念

**durability**: 一次 fsync 后数据一定持久化 ⇒ ack 后断电也能 find.

**atomicity**: 写 multi-block 全完成或全未.

**isolation**: 在崩溃之后看到的 fs state, 等同 某个 in-order 之前完成 fsync 的快照.

ext4 ordered 默认满足: durability (fsync 等到 commit) + atomicity (journal) + isolation (transid).

但 ext4 writeback 不满足 atomicity (data 不 journal) ⇒ fsck 后你也许看到 partial data write + commit metadata.

## 6. WAL (Write-Ahead Log) 数据库的核心设计

数据库为了保证 ACID, **什么 dirty pages 都先写 WAL redo log** + fsync.

```
事务 commit 步骤:
1. 修改 buffer pool pool page (in-mem);
2. 写 WAL redo log append (in-mem);
3. fsync(WAL fd);      ← 等待 truly persistent;
4. ack 客户端 "commit ok";
5. 后台异步 flush dirty page buffer pool → disk (写 data file).
```

崩溃 ~ 准 back eventually: WAL fsync 后 ack 即持久, data file 后续 lazy flush 是 ok 的. crash 后, 启动读 WAL, redo 重做 final commit.

这就是 **InnoDB / PostgreSQL / RocksDB / CockroachDB 共同的 WAL 模型**. 核心思想: **持久化只需要 redo fsync 一次, data 落盘可以 amortized**.

## 7. 数据库的 group commit 优化

每 fsync ~ 100 μs - 5 ms, 不能每事务都做. → 组 commit: 多个事务的 WAL 一起进程, 一次 fsync 同时段 完成所有事务.

```
所有 commit_req 入队列,
线程 1 持有队列, 等待时间窗口 (e.g. 100 μs) 让 batch grow,
后 fsync 1 次, ack 全队员.
```

MySQL 5.7 提 `binlog_group_commit`, MySQL 8 后 Innodb redo log 也用 group commit, 单次 fsync 容纳 ~ 100+ 事务.

**P99 写延迟**: 1 个 commit ~ 5 ms (fsync overhead)→ group 100 个事务: ~  5 ms / 100 = 50 μs / commit. 

## 8. 数据库 + ext4 / XFS / Btrfs 调优建议

```
# ext4 database mount options
mount -o noatime,nodiratime,data=writeback,barrier=1 /dev/sda1 /data
# noatime: 不更新 atime (减少 metadata IO)
# data=writeback: 不 journal data (WAL 已经保证 atomicity)
# barrier=1: 关键 — 所有 metadata journal commit 必 flush device cache
```

**barrier=1 是关键**: 关闭 barrier 意味着 journalist commit 在 ext4 层完成 (in mem journal) 而设备 cache 没写. 断电破坏 fs ordering. 

## 9. 多语言 / 多 runtime 同一抽象

| 语言 / runtime | fsync / commit 模型 |
|---------------|--------------------|
| C / C++ std | explicit fsync + 一次 syscall |
| Go os.File | 同上 |
| Rust std::fs | File::sync_all → fsync |
| Java NIO | FileChannel.force(true) |
| Python | file.flush() + os.fsync(fd) |
| SQLite | default 通过 WAL + fsync |
| PostgreSQL | fsync + group commit + WAL |
| RocksDB | 别提了 + 每 wrapper fsync |
| Redis | 每 BGSAVE + RDB + AOF fsync (slow mode) |

所有持久化数据库都需要 fsync at least once per logical update. fsync 是 OS / 设备间义务.

## 10. 旋涡调试

```bash
# 强制清 cache
echo 3 > /proc/sys/vm/drop_caches

# 看 ext4 commit interval
cat /proc/mounts | grep data

# 看 NVMe cache 状态
nvme id-ctrl /dev/nvme0 | grep -i cache

# 关 write cache (warn: 性能降)
hdparm -W0 /dev/sda1

# 在 PG 里面 pgbench with synchronous_commit
pgbench -c 16 -j 4 -T 60 -M prepared --protocol=prepared mydb
```

## 11. 这一章带走的东西

- write 不保证持久化, fsync 才真持久化, 但仍依赖 device cache;
- ext4 data=ordered default 是历史正确选择, database 推荐 data=writeback + barrier=1;
- WAL 模型让 fsync 摊还到 commit batched (group commit);
- fsync P99 是数据库 commit P99 上界, group commit 拿到 100× throughput;
- NVMe cache / FUA / barrier=1 是 fsync 与 device 层的合作 contact.

下一节 → [进程与线程调度](../sched/index.html)
