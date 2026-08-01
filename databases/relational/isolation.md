# 事务、ACID、隔离级别与现象

## TL;DR

事务是数据库把"原子执行一段状态变更"封装的最小单位。ANSI SQL-92 给了 4 个隔离级别 (RU/RC/RR/SER)，Berenson 1995 论文指出 ANSI 漏了 3 个 不能被 4 级别覆盖的异常 (写偏斜 / 读偏斜 / 丢失更新)。本节从 ACID 到锁矩阵、2PL（growing/shrinking phase）、S2PL/SS2PL、MVCC 实现的 Snapshot Isolation、PostgreSQL 的 SSI、CockroachDB 的 Serializable-only、Spanner 的 TrueTime 外部一致性——这是任何分布式数据库设计的必经课。

---

## 一、ACID

| | 含义 | 实现机制 |
|---|------|----------|
| Atomicity | 全或无（commit 或回滚整体） | undo log + commit marker |
| Consistency | 应用层不变量保持 | constraints / FK / unique / trigger |
| Isolation | 并发事务互不干扰 | 2PL / MVCC / SSI / TS |
| Durability | commit 后即使断电数据不丢 | WAL（redo log）fsync + commit record |

> [!NOTE]
> C **不由 DB 保证**——DB 只保证约束 / FK / unique 检查通过；A.I.D 是数据库机制。任何业务 invariant（"账户余额≥0"）必须 app 层 enforce。

---

## 二、ANSI SQL-92 4 隔离级别

| 级别 | Dirty Read | Non-repeatable Read | Phantom |
|------|----|----|----|
| READ UNCOMMITTED | 允许 | 允许 | 允许 |
| READ COMMITTED | 不允许 | 允许 | 允许 |
| REPEATABLE READ | 不允许 | 不允许 | 允许 |
| SERIALIZABLE | 不允许 | 不允许 | 不允许 |

3 现象定义：

| 现象 | 描述 |
|------|------|
| Dirty Read | T1 读到 T2 未提交的数据；T2 abort → T1 看到的数据从未存在 |
| Non-repeatable Read | T1 内两次读同 row 得不同值（T2 提交了修改） |
| Phantom | T1 内 `WHERE` 范围两次得到不同 row set（T2 插入了新 row） |

## 三、Berenson 1995 critique

`A Critique of ANSI SQL Isolation Levels` 论文指出 ANSI 4 级别的**formal definition**有漏洞，且**实用中漏了 3 个异常**：
- **Dirty Write**：T2 写 over T1 未提交写 → cascading abort
- **Lost Update**：T1 读 v1，T2 commit v2，T1 写 v3 commit → v2 被丢
- **Read Skew**：T1 读 row A 后（A 已被 T2 改 B），再读 B → 看到 T2 前的 A 与 后的 B，invariant 被破
- **Write Skew**：两 tx 基于同一 SELECT 判定，写不同 row commit → 整体 invariant 失效
- **Cursor Lost Update / Read-then-Write Lock** 等

Berenson 提出 **Snapshot Isolation (SI)**：每事务开始时分配 snapshot（timestamp），所有 SELECT 都从 snapshot 看，所有 write 在 commit 时检测 − write-write conflict（如果两事务写同一 row → 后提交 abort）。

| 异常 | SI 是否防护 |
|------|---|
| Dirty Read | 是 |
| Non-repeatable | 是 |
| Phantom | 是（snapshot 是只读的） |
| Dirty Write | 是 |
| Lost Update | 是（write-write conflict abort） |
| Write Skew | **否** |
| Read Skew | 是 |

→ **SI 比 RR 更强但弱于 SERIALIZABLE**。SI 不能防 write skew 是它的最大缺陷。

---

## 四、典型 write skew 案例

```
Two-doctor on-call invariant: 至少一医生 24/7 当班

T1                            T2
BEGIN                          BEGIN
SELECT count(*) FROM on_call   SELECT count(*) FROM on_call
  WHERE name IN ('Alice','Bob')  WHERE name IN ('Alice','Bob')
=> 2 (Alice + Bob 都当班)         => 2

UPDATE on_call SET on_call=FALSE   
  WHERE name='Alice'              UPDATE on_call SET on_call=FALSE
                                    WHERE name='Bob'
COMMIT                         COMMIT

→ 现在 0 医生当班，invariant 被破
```

PostgreSQL SSI 能检测到 rw-anti-dependency（read-write conflict），abort 其中一个事务。

---

## 五、锁矩阵与 2PL

### 5.1 锁模式

- **S (shared)** read lock
- **X (exclusive)** write lock
- **IS (intent shared)** 父表级 hint
- **IX (intent exclusive)**
- **SIX** shared + intent exclusive
- **gap lock** (MySQL InnoDB RR 防 phantom)
- **next-key lock** = record + gap before
- **insert intent lock**

### 5.2 锁矩阵

| 请求 \\ 持有 | S | X | IS | IX | SIX |
|---|---|---|----|----|-----|
| S  | ✓ | ✗ | ✓  | ✗  | ✗  |
| X  | ✗ | ✗ | ✗  | ✗  | ✗  |
| IS | ✓ | ✗ | ✓  | ✓  | ✓  |
| IX | ✗ | ✗ | ✓  | ✓  | ✗  |
| SIX| ✗ | ✗ | ✓  | ✗  | ✗  |

### 5.3 两阶段锁定 (2PL)

```
1. Growing phase: T 加锁，no release
2. Shrinking phase: T 释放，no acquire
```

- **S2PL（Strict 2PL）**：X 锁保留到 commit。防 cascading abort（其他事务不会用某个未 commit 的写）。
- **SS2PL（Strong Strict 2PL, Rigorous 2PL）**：所有锁（S+X）保留到 commit。主流数据 库默认。

### 5.4 SS2PL + MVCC 组合

读通过 MVCC 走 snapshot（无锁），写通过 SS2PL（X 锁到 commit）→ 避免读阻塞写、写阻塞读。这是 Oracle / SQL Server default，PostgreSQL RC 也类似。MySQL InnoDB RR 用 SS2PL + gap lock + MVCC。

---

## 六、Snapshot Isolation (SI) 实现机制

每事务分配 snapshot_id：
- PostgreSQL: `xmin = current_txid` at `BEGIN`
- InnoDB: `read_view = active_txns set snapshotted`
- SQL Server: `READ_COMMITTED_SNAPSHOT`

```c
// PostgreSQL snapshot admission
HeapTupleSatisfiesMVCC(tuple, snapshot):
    if (tuple.xmin >= snapshot.xmax) return false;  // insert after snapshot
    if (tuple.xmax is committed && tuple.xmax < snapshot.xmin) return false;  // deleted before snapshot
    if (tuple.xmax == CurrentRunningXid) return false;
    return true;
```

写：在 commit 时检测 write-write conflict（PostgreSQL 与 SI 等价 RR，InnoDB 也 SI 等价）。

---

## 七、SSI (Serializable Snapshot Isolation)

PostgreSQL 9.1 起支持 SSI（论文 *"Serializable Snapshot Isolation"*, Cahill 2008）。**核心思想**：

检测 **rw-anti-dependency**：T2 写的 row 被 T1 SELECT 过 → 如果两事务都 commit，可能产生 write skew → abort 其中一个。

实现：每行被 SELECT 时记 SIREAD lock（实际上是个 predicate lock），commit 时检查这个 lock 是否被某 transaction 后续的 X 操作破坏。

PostgreSQL 内部维护两个 graph：
1. **rw-dep graph**：节点 = 事务；边 = (T1 read → T2 write)
2. **dangerous structure** 检查：T1 → T2 → T1 形成环 → abort circle 中"youngest" txn

**性能代价**：SIREAD locks 大量内存，PG 通过 SIREAD lock partition 优化 + 仅检测 SELECT 命中 index 的 case（无 index 走 fallback 等价 boost）。

CockroachDB / Spanner / FoundationDB 都是 SERIALIZABLE only。

---

## 八、各 DB 隔离级别默认与策略

| DB | default 默认 | SERIALIZABLE 实现 |
|----|--------------|-------------------|
| PostgreSQL 9.1+ | READ_COMMITTED | SSI（abort 重试） |
| MySQL InnoDB | REPEATABLE_READ (gap lock 防 phantom) | 强 2PL + gap lock |
| Oracle | READ_COMMITTED (with snapshot) | SERIALIZABLE（实际 SI，无 write skew 防护） |
| SQL Server | READ_COMMITTED | SERIALIZABLE（真 2PL） |
| SQLite | SERIALIZABLE (writer-locks-all，无 MVCC) | 单写者 |
| CockroachDB | SERIALIZABLE only | SSI + abort retry |
| Spanner | external consistency (TrueTime) | TS + 2PL hybrid |
| FoundationDB | SERIALIZABLE only | optimistic + OCC abort retry |
| MongoDB WiredTiger | snapshot (≈ SI) | 没原生 SERIALIZABLE |
| Redis (单 thread) | - 不并发，无 isolation 问题 | - |
| etcd | SERIALIZABLE + lease strong read | raft log |

---

## 九、Spanner 的 external consistency

CockroachDB / Spanner 用 **timestamp oracle + commit wait**：
1. 全局单点 timestamp oracle 给事务 start_ts
2. 写后 commit_ts = start_ts + commit_wait（保证 commit 后 ts 真正超过 TS）
3. 读时用 ts 给 snapshot—— 因 commit_wait 保证 commit 之前 ts 都已发布
4. 真 SERIALIZABLE 不靠 SI 检测，靠"GLOBAL monotonic ts"

但这要求 **GPS + atomic clock**（TrueTime API）。CockroachDB 用 NTP，commit_wait = 100ms+，写延迟变高。

---

## 十、产线事故

### 10.1 银行 write skew 致 100 万转账复式记账不平衡

**症状**：A 与 B 共享账户余额 100 万；T1 把 50 万转给 C，T2 检查余额剩 60 万，又把 50 万 transfer 给 D，**两操作 commit 后账户余额 = -50**。

**根因**：业务用 SI 隔离级别，没察觉 write skew 检测。

**修复**：业务加 `SELECT ... FOR UPDATE` 显式行锁；或者 PostgreSQL 把 `default_transaction_isolation = serializable`，让 SSI 自动检测并 abort。

### 10.2 MySQL gap lock 死锁

```sql
T1: SELECT * FROM orders WHERE user_id = 5 FOR UPDATE   # 在 user_id=5 范围上加 X gap
T2: SELECT * FROM orders WHERE user_id = 5 FOR UPDATE   # 等 T1 释 X 锁
T1: INSERT INTO orders(user_id, ...) VALUES (5, ...)    # 需要 insert intent lock
    # 等 T2 的 X gap lock
T2: INSERT INTO orders(user_id, ...) VALUES (5, ...)
    # 等 T1 的 X gap lock
→ deadlock; InnoDB abort one
```

**修复**：改成 SERIALIZABLE 显式 acquire lock / 用 `INSERT ... ON DUPLICATE KEY UPDATE` 或业务上悲观锁全段。

### 10.3 PostgreSQL SSI abort 风暴

业务读热 key 后写不在 read set → 但 SIREAD lock 大量占据 + abort 频。

**修复**：业务改 RR（无 SSI 监控）；或减小 read set（用 `WHERE id = $` 而非 `WHERE created_at > $`，hit index 直接 pass predicate lock）。

### 10.4 Redis "set if not exists" 是 OCC，不是 SERIALIZABLE

新手用 `GET → check → SET` 做"unique create"——多个并发都 GET 到 null → 都 SET → 都成功。

**修复**：用 `SET key value NX` 原子操作 或 Lua 脚本 atomic CAS。

---

## 十一、易错清单

1. **REPEATABLE_READ 不是 SI**——MySQL RR 实质 SS2PL+gap lock，PostgreSQL RR 实质 SI
2. **MySQL gap lock 在 RC 关闭**——`innodb_locks_unsafe_for_binlog` 或隔离级别 RC
3. **SELECT FOR UPDATE 不受 MVCC**——总是拿 X 锁
4. **`default_transaction_isolation`** 在 PostgreSQL 没锁表会出 RR fallback if 分片— GC 默认是 RC，业务要 explicit
5. Postgres SERIALIZABLE abort 后业务**必须 retry**——常见 API 不带 retry 链路
6. InnoDB RR 下 `UPDATE ... WHERE non_index_col` 会全表 next-key lock，单 UPDATE 卡全表
7. `LOCK IN SHARE MODE` (MySQL) 或 `FOR SHARE` (PG 9.5+) 是显式 S 锁
8. Redis / DynamoDB / MongoDB 都**没有 SERIALIZABLE**，文档不要骗自己

---

## 十二、这一章带走的东西

1. ACID 是property，2PL / MVCC / SSI / TS 都是实现手段
2. ANSI SQL-92 4 级别漏了 write skew / lost update / read skew 3 异常，Berenson critique 补足
3. SI 防 dirty/non-repeat/phantom + lost update，**不能**防 write skew
4. SSI 用 rw-anti-dep 检测 write skew，PostgreSQL/CockroachDB/FoundationDB 全部 SERIALIZABLE only
5. MySQL RR = SS2PL + gap lock + MVCC，PG RR = SI + write conflict abort
6. Spanner external consistency 靠 TrueTime GPS+atomic clock，CockroachDB 用 NTP + commit_wait
7. 业务关键 invariant 应贴 SSI 或显式 FOR UPDATE，不要依赖默认隔离

## 下一节 →

[MVCC 原理：PostgreSQL vs InnoDB](mvcc.md) — tuple header 字段、visibility rules、update = insert + mark、undo log history list、vacuum/purge 机制
