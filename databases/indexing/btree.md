# B+ 树索引与覆盖索引

## TL;DR

B+ 树是关系数据库的索引默认数据结构：所有叶节点在同一层、通过双向链表连接范围扫描、中间节点只存路由信息 → 出度极大、深度浅。本节从 page 字节布局讲到 B+ 树插入分裂、删除合并、explain output 上的覆盖索引判定、二级索引 lookup 的回表代价、PG vs InnoDB 的索引差异、写放大公式 (WAF) 与 neighborhoodhtable 修改导致的 page 移动。

---

## 一、B+ 树结构

```
[Root]    +-----+
          | K1 K3 |
          +-+---+-+
            |   |
   +--------+   +--------+
   |              |
[Internal] /+   K1/   K3\   /
         +--+--+ +--+--+ +--+--+
         | L1 |->| L2 |->| L3 |  chain (双向链表)
         +----+   +----+   +----+
```

特性：
- 所有叶子在同一层 → O(log_d N) 高度小
- 中间节点只存 (key, child pointer) → 出度 d 大（PG d≈200 for 8KB page）
- 叶节点含 (key, RID/heap pointer) → 双向链表支持范围扫描
- 空 B+ 树高 log_200 (10^9) = ~4

### 1.1 B+ 与 B 树区别

| 维度 | B 树 | B+ 树 |
|------|------|-------|
| 节点存内容 | key + value | 内节点只 key；叶 key + value |
| 范围扫描 | 难（遍历内部 + 叶） | 叶链表直接连续扫 |
| 出度 | 小（带 value） | 大（只 key） |
| 高度 | 高 | 浅 |

数据库实际存储次序：B+ Tree 占绝对主流。B Tree 仅出现在 niche 专用存储（Mongodb MMAPv1、LMDB 等）。

---

## 二、PostgreSQL page 字节布局

PostgreSQL 8K page：
```
+----------------------------------+
| PageHeaderData (24 B)           |
+----------------------------------+
| ItemId array (4 B per item)      |  ← line pointers (point to tuples)
+----------------------------------+
| Free space                       |
+----------------------------------+
| Tuples (inserted from end)       |
+----------------------------------+
| Special section (typically 0)    |
+----------------------------------+
```

PageHeader 24 字节：
```c
typedef struct PageHeaderData {
    PageXLogRecPtr pd_lsn;       // 8B - last WAL LSN modifying this page
    uint16 pd_checksum;
    uint16 pd_flags;
    LocationIndex pd_lower;      // offset to start of free space
    LocationIndex pd_upper;      // offset to end of free space
    LocationIndex pd_special;    // offset to start of special
    uint16 pd_pagesize_version;
    TransactionId pd_prune_xid;  // oldest xid needing prune
    ItemIdData pd_linp[1];       // line pointers grow forward
} PageHeaderData;
```

每 ItemId 4 字节指 `(offset_in_page, length, flags)`. Tuples 末→头逆增长，free space 中间。

### 2.1 B+ 树索引 entry 字节布局

B-tree index entry (~16-32B per entry)：
```
| ItemId (4B) | TupleHeader (23B) | IndexTupleData (~8B) |
              | key_data + NULL bitmap |
```

每 8K page 容纳约 200-400 个 key/value entry。

---

## 三、B+ 树插入与分裂

### 3.1 Insert

```
INSERT key=K into B+ tree:
1. tree.root.find_path(K) → leaf_L
2. if leaf_L 内 has free slot → INSERT K at sorted pos
   else → SPLIT leaf_L into leaf_L + leaf_L2
3. push_median up to parent with route key
4. recurse if parent also full
5. (worst case) root 分裂 → new root above → tree 高度 + 1
```

分裂方法：
- **left-to-right split (50/50)**：直接中分（Lehman-Yao）
- **split-at-insertion point**：在插入位置附近分（适合热点 key）
- **border split**：把 9:1 比例分（PostgreSQL 用）

### 3.2 删除与 merge

```
DELETE key=K from B+ tree:
1. find leaf_L
2. mark entry as DEAD → page 内 slot-free
3. if leaf 上 entries < (max/2) → 取 sibling merge 或 redistribution
4. (recursive 上层)
5. (worst case) root empty → tree 高度 - 1
```

PostgreSQL 的实现：
- 死 leaf entry 不立即 free slot，等 vacuum reclaim
- `n_dead_tups` 显示表 bloat；索引同样 bloat
- vacuum 走 `btvacuumscan`清死 tuple 同时 shrink page

---

## 四、写放大 (WAF)

每次 1 行 INSERT 触发：
1. 1 WAL record (data + FPI ~8KB on first modify)
2. **每个含所修改列的索引** 1 WAL record (~数百字节) + page modify
3. 若 page full 触发 split，附加整 page copy + redo

公式（粗略）：
```
WAF (Write Amplification Factor) = N_index × 1 + 1
```
→ 有 4 个二级索引的表，单 INSERT = 5 个 page 改动。

性能调优：减少二级索引（每次新增业务，问真的需要 index？"加索引 = 写慢 N 倍"）。

---

## 五、覆盖索引 (Covering Index)

### 5.1 回表代价

普通二级索引 SELECT `id, name` from index on (name):
1. lookup (name='Alice') in index → hit 叶 entry → get heap RID (page, offset)
2. 找 heap page → 1 I/O (可能 cache hit) → get row data
3. 二级索引 entry 不含 `id`，回 heap 取 `id`

→ "回表" = secondary index + heap = 2 I/O。

### 5.2 覆盖索引消回表

```sql
-- InnoDB
CREATE INDEX idx_name_id ON users(name, id);
SELECT id, name FROM users WHERE name = 'Alice';
-- 索引含 name + id → 不回表 → 1 I/O
```

PG 12+ 引入 INCLUDE 语法：
```sql
CREATE INDEX idx_name ON users(name) INCLUDE (id);
SELECT id, name FROM users WHERE name = 'Alice';
```

INCLUDE 列**不参与 B+ tree 排序**（只存在叶），不影响 split 位置与 SELECT WHERE 性能，但支持 covering scan。

### 5.3 PG 与 InnoDB covering 差异

| 引擎 | 二级索引 stem | covering 实现方式 |
|------|--------------|--------------------|
| PostgreSQL | (key) → line pointer (heap RID) | INCLUDE (12+)；或主 INDEX (key, covered_cols) |
| InnoDB | (key) → primary key | 复合 INDEX (key, ID)；或 index key + cover |

InnoDB PK 在 secondary index entry 中**自动**作为 key 的一部分（隐含），不需 explicit cover。

---

## 六、PG 与 InnoDB 索引差异

| 维度 | PG | InnoDB |
|------|-----|--------|
| Clustered | 无（heap + secondary 都指 line ptr） | 主键 = clustered B+ tree |
| 二级索引 lookup | 1 I/O (heap page) | 2 I/O (clustered page) |
| covering index | INCLUDE clause | composite (col1, col2,...) |
| Index organized table | NOAST | `tbl ENGINE=InnoDB` 默认 |
| Hash index | Hash 不支持范围；GIN/GiST 仅 special | InnoDB 内存 adaptive hash index |
| Index-only scan | PG 9.2+ | MySQL 5.6+ |
| index bloat | vacuum 必清 | online drop |

### 6.1 InnoDB 主键列定关键

InnoDB secondary index entry = `(key, primary_key)`。所以 SELECT `id` from `index(name)` 不需回表：因为 id 是 PK 自动在索引 entry 中。

但 SELECT `name, age` from `index(name)` **仍需回表**：age 不在 secondary index entry 内。

---

## 七、partial / expression index

### 7.1 Partial Index

```sql
CREATE INDEX idx_active_users ON users(name) WHERE active = TRUE;
SELECT name FROM users WHERE active = TRUE AND name = 'Alice';
-- 仅扫描 active=true 子集，索引降大 90%
```

适合大部分 row 不满足条件的场景。

### 7.2 Expression / functional index

```sql
CREATE INDEX idx_lower_name ON users(lower(name));
SELECT * FROM users WHERE lower(name) = 'alice';
-- 索引命中
```

PG 8.10+ 用 `INCLUDE` 不能用在 expression 上。MySQL 8 用 functional index 同效果。

---

## 八、产线事故

### 8.1 PG index bloat 致 vacuum 跑不动

10 GB `orders` 表频繁 DELETE+INSERT → INotifyIndex `idx_user_id` bloat 5x。autovacuum 跑索引 vacuum 并发扫页面慢，业务 QPS 跌 50%。

**修复**：
- `REINDEX INDEX CONCURRENTLY idx_user_id`（PG 12+）
- 调 autovacuum_work_mem 大用 maintenance_work_mem
- 长期方案：业务冷热表分离（active 表小+冷表 append-only）

### 8.2 InnoDB auxiliary index duplicate primary key 大头

某表 PK `(uid, dt, id)` 16 字节，secondary 100 万行 → 索引 size 比 small 表大 50 倍。

**修复**：拆 PK 减少 PK 字段，用 `id BIGINT AUTO_INCREMENT` PK + UNIQUE (uid, dt) 让 secondary 索引小。

### 8.3 covering index 误用

某业务 SELECT 包含非索引列 → planner 走 index scan → 90% 行回表 → 比 seq scan 慢 5x。

**修复**：用 `EXPLAIN (BUFFERS)` 看 `Heap Fetches` 数：若 high，需 INCLUDE 加列或直接 seq scan。

### 8.4 PG partial index 不被命中

```sql
CREATE INDEX idx_no_archived ON events(name) WHERE archived_at IS NULL;
SELECT * FROM events WHERE archived_at > '2024-01-01';
-- 索引不被命中 (predicate 不匹配)
```

**修复**：PG planner 必须 SELECT 的 WHERE condition imply 索引 predicate。改业务 SQL `WHERE archived_at IS NULL`。

### 8.5 索引膨胀后顺序变态 + cache miss

10 GB 表 + 10 GB 大索引，原本命中 cache 100%，更新业务以后 cache miss 多 → I/O 暴增。诊断：
```sql
SELECT relname, pg_size_pretty(pg_relation_size(relid))
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_relation_size(relid) DESC;
```

**修复**：REINDEX + VACUUM + 检查 cache size vs working set。

---

## 九、易错清单

1. **覆盖索引回表**：必须 SELECT 全列都在 INDEX (key, INCLUDE) 中才能 index-only scan
2. **PG INCLUDE** 在 12+ 才支持；MySQL 仅 composite INDEX
3. **partial index predicate 必被 SELECT WHERE imply** 才命中
4. **InnoDB PK 长**：会让所有 secondary 索引跟着膨胀，会影响全表
5. **REINDEX 必 CONCURRENTLY**（PG 12+）：否则锁表
6. **autovacuum 调小 threshold**：大表否则 vacuum 间隔太大 → 累死 bloat
7. **EXPLAIN ANALYZE BUFFERS**：看 actual fetch vs buffers hit 才能看到 cache 行为，仅 ANALYZE 看不到
8. **expression index 不支持 INCLUDE**：functional index 仍可 INCLUDE，但 expression 部分不算 key

---

## 十、这一章带走的东西

1. B+ 树所有叶同层 + 叶链表，深度 O(log_d N) 通常 ≤4
2. PostgreSQL index row 通过 line pointer → heap；InnoDB secondary index 通过 PK → clustered
3. 覆盖索引消回表：PG 用 INCLUDE；InnoDB 索引 entry 隐含 PK，仍需 composite
4. partial/expression index 在 5x 业务量能用 1/10 索引 size 命中
5. index bloat 是 vacuum 落后的 PG 必查项；REINDEX CONCURRENTLY 5x 收益
6. WAF = N_index + 1，每个新增二级索引 = INSERT 慢 N 倍
7. EXPLAIN ANALYZE BUFFERS + Heap Fetches 判断 covering 是否真实

## 下一节 →

[LSM-Tree 与 SSTable](lsm.md) — LevelDB/RocksDB/Cassandra/CockroachDB 选 LSM 为啥、写放大、读放大、compaction
