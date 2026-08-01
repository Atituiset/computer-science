# Join 顺序、hash join vs nested loop

## TL;DR

Join 是多表查询核心。三种基本算法：Nested Loop（小表 + 索引）、Hash Join（大表等值连接 + 在内存 fit）、Merge Join（已排序）。本节走完三种 join 的 inner structure、planner 选择的 cost 估算、work_mem 与 hash join 落盘、Semi / Anti / Cross join 的语义、PostgreSQL 与 MySQL 的不同 join 实现（PG 9 加 hash join 后 8 没有原生直到 8.0.18）。

---

## 一、Nested Loop Join

```python
def nested_loop(outer, inner):
    for r1 in outer:
        for r2 in inner:
            if r1.joinkey == r2.joinkey:
                emit(r1, r2)
```

O(N_outer × N_inner_per_outer)；不含 IO，包含 IO 时 inner 通常 index lookup：

```
cost = N_outer × cost_of_lookup_for_one_outer
cost_of_lookup = random_page_cost × depth(index) + cpu_tuple_cost
```

适合：
- outer 小（≤ 1000 行，量级）
- inner 有 index 可以 joinkey 快速 lookup
- 没 index 且 inner 小 → bnl (block nested loop) 块 buffer

PG 默认走参数化 index scan：每 outer 行传 joinkey 给 inner index scan：
```
Nested Loop
  -> Seq Scan on outer        (loops=1, rows=N)
  -> Index Scan on inner      (loops=N, rows=inner_avg_per_key)
       Index Cond: (inner.fk = outer.id)
```

inner 的 `loops = N_outer`，每 loop 是一次 index lookup。

---

## 二、Hash Join

### 2.1 算法

```python
def hash_join(outer, inner):
    # build phase: 把 inner (smaller) 塞 hash table
    htable = {}
    for r2 in inner:
        htable[hash(r2.joinkey)].append(r2)
    
    # probe phase: 走 outer，每行查 hash table
    for r1 in outer:
        for r2 in htable.get(hash(r1.joinkey), []):
            if r1.joinkey == r2.joinkey:
                emit(r1, r2)
```

cost = N_inner × (cpu_tuple + hash_op) + N_outer × (cpu_tuple + hash_op + avg_bucket_scan)

适合：
- 双表都大 (1k+)
- joinkey 等值 (`=`)
- work_mem ≥ N_inner_hash_size

### 2.2 Grace Hash Join（落盘）

work_mem 不够时：
1. 把 inner 与 outer 都 hash 分 N bucket (e.g. 8)
2. 把 bucket 都 flush 到 disk
3. 逐 pair bucket (inner_i, outer_i) 进内存跑 hash join → spilled buckets 取一对一对处理

PG 用 "hybrid hash join"（保留 `Hybrid` memory，但 spill 部分），实践中 bucket 数适 N。调 `work_mem`：

```sql
SET work_mem = '64MB';
SET maintenance_work_mem = '512MB';
```

`work_mem` 越大 hash join 越可能 1 batch 完成 → 避免 disk batch → query 快 10×。

### 2.3 Skew

inner 表 joinkey 分布 skew：
- 99% row 都 joinkey=NULL → 全入 NULL bucket → huge bucket 落盘
- hash table 中某 bucket 万元素，probe 时 O(N) → 退化为 nested loop

PG 13+ hash join 加 skew bucket 识别 + 单独处理。Oracle 也类似 "skew-aware hash"。

### 2.4 bloom filter 加速

CockroachDB / Spark：probe 前用 bloom filter 看 outer row 的 joinkey 是否在 inner——免 hash lookup 80% 不命中的 row 立即丢。

---

## 三、Merge Join

```python
def merge_join(outer, inner):
    outer_iter = sorted_iter(outer)
    inner_iter = sorted_iter(inner)
    while outer_iter.has() and inner_iter.has():
        r1 = outer_iter.peek()
        r2 = inner_iter.peek()
        if r1.key < r2.key:
            outer_iter.next()
        elif r1.key > r2.key:
            inner_iter.next()
        else:
            emit(r1, r2)
            # 多个 key 等输出
            advance_both_with_group()
```

cost = sort_cost(outer) + sort_cost(inner) + N_outer × cpu_tuple + N_inner × cpu_tuple

适合：
- 双表已按 joinkey 排序（有索引或自然 sorted）—— 避免 sort cost
- 大表 + ORDER BY 同时需要的查询
- LONG range join 比较省 mem

PG 内部 sort work_mem 不够 → 临时 file sort merge。

---

## 四、Semi Join / Anti Join

```sql
-- Semi Join: outer 行在 inner 出现就 emit 一次 outer
SELECT u.* FROM users u WHERE u.id IN (SELECT user_id FROM orders);

-- Anti Join: outer 行没在 inner 出现就 emit
SELECT u.* FROM users u WHERE NOT EXISTS (SELECT 1 FROM orders WHERE user_id = u.id);

-- Cross Join (Cartesian product)
SELECT u.*, o.* FROM users u, orders o;
```

PG 实现：
- Semi Hash：build hash on inner subquery 唯一 keys，probe outer
- Anti Hash：同但 emit outer when no match
- Anti Nested Loop：每 outer 行 tech 内 index lookup，没命中则 emit
- Anti Merge：sorted merge，没匹配则 emit

---

## 五、Joer 加速 tips

### 5.1 joinkey 索引化

```sql
-- A JOIN B ON A.user_id = B.user_id; 外 B.user_id 上 index
CREATE INDEX idx_b_uid ON B(user_id);
```

→ nested loop 适用、cost = N_A × log N_B 但实际 1 index lookup。

### 5.2 减少回表 (projection pushdown)

```sql
SELECT u.name, COALESCE(o.amount, 0)
FROM users u LEFT JOIN orders o ON u.id = o.user_id;
```

只取 USER_ID + NAME 给 join，再加 amount 从另一索引 plus — 取 B tree index on (user_id, amount) 让 read 不回表。

### 5.3 转换为 pre-aggregated 表

星型 schema：fact table (10^9 row) + dim table (10^3 row)，常常 group join → pre-aggregated table 跑 OLAP 查询快。

### 5.4 Partition-wise join

PG 13+：把 tables partition 重排，每 partition join（避免 shuffle all）。

```sql
SET enable_partitionwise_join = on;
SELECT * FROM orders_p1 JOIN users_p1 ON ...
UNION ALL
SELECT * FROM orders_p2 JOIN users_p2 ON ...;
```

MPP databases (Snowflake / Greenplum) 内置支持 distributed join。

---

## 六、PG vs MySQL vs MemSQL/Spark 对比

| 引擎 | Hash Join | Merge Join | Nested Loop |
|------|-----------|------------|--------------|
| PostgreSQL | 9+ 主流 | 主流 | 主流 |
| MySQL InnoDB | 8.0.18+ 默认 | 主流 | 主流（5.7 唯一算法） |
| Oracle | Hybrid hash | Adaptive | Adaptive |
| SQL Server | In mem/spilled | 默认 | 默认 |
| ClickHouse | Direct join algorithm | Direct | Skip |
| Snowflake | Hash + Bloom | Sort + Merge | rare |

MySQL 5.7 没 hash join，大表等值 join 跑 8 小时；MySQL 8 hash join 默认后才赶上。

---

## 七、产线事故

### 7.1 MySQL 5.7 没 hash join 大表 join 灾难得

`orders` 1 亿 + `users` 1 千万 JOIN 时间 6 小时（nested loop + index 走深）

**修复**：升 MySQL 8 + 临时把 `JOIN` 子表 over-tion → hash join 推 plan。

### 7.2 PG hash join work_mem 64MB 不够 spill 8 batches 慢 50×

work_mem 默认 4MB → 大表 hash join multi-batch → 50 秒 query。

**修复**：业务 session-level `SET LOCAL work_mem = '256MB'`，让 hash join 1 batch → 5 秒。

### 7.3 Oracle skew hash bucket 行 hang

业务 list JOIN 用 enum type 极少 high card 时单 bucket 90% row → hash join 卡 hours。

**修复**：显式 Hash Join 启用 skew detection hint `/*+ HASH_JOIN(司 SKEW) */`。

### 7.4 NULL joinkey 失败 join 漏行

```sql
SELECT * FROM a JOIN b ON a.x = b.x;   -- x=NULL 的 row 不 emit
SELECT * FROM a LEFT JOIN b ON a.x = b.x;  -- a.x=NULL 仍 emit (NULL_after_jokk 失配)
```

修复：业务若需 NULL = NULL considerate，用 `a.x IS NOT DISTINCT FROM b.x`。

### 7.5 Partition-wise join 调优没生效

PG `enable_partitionwise_join=on` 但 planner 没选 → 因 joinkey 数据类型与分区 key 不匹配。

**修复**：让 partition expr 与 joinkey 类型一致；或子查询 cast hint。

---

## 八、易错清单

1. **Nested Loop cost** 是 outer × inner_index_lookup_cost；inner 没 index → 灾难
2. **Hash Join** 需要 work_mem ≥ inner_total_size；不够 spill → 100ms 跌 session
3. **Merge Join** 必排序；已 sort(从 index 直接) 可省 sort phase
4. **Semi/Anti** 不会重复 outer 行（emit 一次）
5. **NULL = NULL** 在 SQL 中是 UNKNOWN，不 join → `IS NOT DISTINCT FROM` 解决
6. **MySQL hash join** 8.0.18+ 才默认；老业务上不能 assume
7. **Partition-wise join** PG 13+ 但要 `enable_partitionwise_join=on` + 类型对齐

---

## 九、这一章带走的东西

1. Nested Loop 适合 small outer + inner index；双大 + no index 灾难
2. Hash Join 适合双大 + 等值 + work_mem fit；不够 spill 走 hybrid hash
3. Merge Join 适合已 sort + ORDER BY 同时
4. Semi/Anti join 用 EXISTS/NOT EXISTS 一次 emit；不要重复 LEFT JOIN row
5. NULL row 被 `=` join 排除；用 `IS NOT DISTINCT FROM`
6. MySQL 8.0.18+ 才有 hash join；Oracle/PG 默认都有；ClickHouse 极简直接 merge
7. PG `work_mem = 64MB+` + partition-wise join 调参 + 已 sort 表走 merge join = 大表 OLAP 大杀器

## 下一节 →

[向量化执行、列存](vectorized.md) — 列存 vs 行存、SIMD + 超标量、Volcano vs vectorized executor
