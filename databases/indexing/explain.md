# 执行计划：explain analyze 怎么读

## TL;DR

EXPLAIN 显示 PostgreSQL/MySQL planner 算出来的计划；EXPLAIN ANALYZE 真执行 + 实测；EXPLAIN ANALYZE BUFFERS 显示 IO 与 cache hit。学会读这三件套是数据库调优的关键。本节带你读完 PostgreSQL 与 MySQL EXPLAIN 的所有字段、planner cost 估计模型、loops/time aggregate 含义、Hash Join vs Nested Loop vs Merge Join 触发条件、覆盖索引判断 (Heap Fetches)、并行执行 worker 路径——你能直接诊断生产慢查询的根因。

---

## 一、PostgreSQL EXPLAIN 字段基础

```sql
EXPLAIN ANALYZE SELECT name, age FROM users WHERE age BETWEEN 18 AND 25;

Seq Scan on users (cost=0.00..95.50 rows=1700 width=12) (actual time=0.025..2.830 rows=1695 loops=1)
  Filter: ((age > 18) AND (age < 25))
  Rows Removed by Filter: 8305
Planning Time: 0.150 ms
Execution Time: 3.180 ms
```

字段含义：

| 字段 | 含义 |
|------|------|
| `Seq Scan` | 全表扫描的物理算子 |
| `cost=0.00..95.50` | planner 估计 (startup..total)；95.50 是 random_page_cost × N 的代价单位 |
| `rows=1700` | 估计行数 |
| `width=12` | 平均行宽 (字节) |
| `actual time=0.025..2.830` | 实测启动..总耗时 (ms) |
| `loops=1` | 该节点被调用 1 次 |
| `Filter` | 触发 WHERE 不过滤的谓词 |
| `Rows Removed by Filter` | seq scan 中被 filter 过滤掉的行 |
| `Planning Time` | planner 用的时间 |
| `Execution Time` | 总执行时间 |

`Buffers` 选项看 I/O：
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT name FROM users WHERE age BETWEEN 18 AND 25;
Seq Scan on users (cost=0.00..95.50 rows=1700 width=12)
                (actual time=0.025..2.830 rows=1695 loops=1)
  Filter: (age BETWEEN 18 AND 25)
  Rows Removed by Filter: 8305
  Buffers: shared hit=84 read=2 dirtied=0
```
- `hit=N`：buffer pool cache 命中
- `read=N`：cache miss 落 disk
- `dirtied=N`：本 query 修改页面
- `written=N`：本 query 触发 flush

`shared / local / temp`：临时表/磁盘 temp 与 ring buffer 分别。

---

## 二、PostgreSQL cost model

`postgresql.conf` 中的关键常量：

```bash
seq_page_cost = 1                # 默认；顺序读一页 cost 1
random_page_cost = 4             # 随机读一页 cost 4
                                # SSD 改到 1.1 或 1.05
cpu_tuple_cost = 0.01            # 处理一行 cost
cpu_index_tuple_cost = 0.005     # 索引里取一条 cost
cpu_operator_cost = 0.0025       # 单 op 比较 cost
parallel_setup_cost = 1000       # 起 worker pool 固定 cost
parallel_tuple_cost = 0.1        # worker 取一行 cost
default_statistics_target = 100 # column 直方图 buckets
effective_cache_size = 4GB       # planner 假设的 cache 大小（不分配）
```

公式：
```
seq scan cost = pages × seq_page_cost + rows × cpu_tuple_cost
index scan cost = pages_hit_estimate × random_page_cost + rows × cpu_index_tuple_cost
bitmap scan cost = index pages × random_page_cost × 0.5 + heap pages × random_page_cost × 0.5 + recheck cost
```

调 random_page_cost = 1.1 (SSD) → planner 更偏向 index scan。调小 effective_cache_size → planner 更偏向 seq scan（因估计 cache miss 多）。

---

## 三、EXPLAIN 上常见算子字典

| 算子 | 含义 | 常见上下问 |
|------|------|----------|
| `Seq Scan` | 顺序扫整表 | 行数大 / 无索引 |
| `Index Scan` | 走索引 + 回表 | 索引命中少量结果 |
| `Index Only Scan` | 走索引不回表 | 覆盖索引 ok |
| `Bitmap Index Scan + Bitmap Heap Scan` | bitmap 标页批量读 | 索引命中多页 |
| `Index Scan Backward` | 反向扫索引 | ORDER BY DESC |
| `Nested Loop` | 笛卡积+过滤 | 内表有索引，N1×inner_cost 不太大 |
| `Hash Join` | hash 内表 + 扫外表 | 两组规模大、内存能 fit |
| `Merge Join` | 排序后双指针合并 | 索引已排序，或 commit large sort |
| `Sort` | 显式排序 | ORDER BY 无索引 |
| `HashAggregate` | hash bucket 聚合 | GROUP BY 算法 |
| `GroupAggregate` | 排序后顺序聚 | GROUP BY 已 sort |
| `Limit` | 取 N 行 | LIMIT 子句 |
| `WindowAgg` | 窗口函数执行 | OVER PARTITION BY |
| `Aggregate` | 总聚合 | count/sum/avg |
| `Subquery Scan` | 子查询包装 | 派生表 |
| `Append` | 表 + UNION | UNION ALL 或分区表 |
| `Merge Append` | 排序归并 | partitioned + ORDER BY |
| `Gather / Gather Merge` | 并行执行编排 | parallel worker |
| `Materialize` | 物化中间 | 重复 scan 时 |
| `CteScan` | 老 PG 版 CTE materialize | PG 11 的 CTE |
| `ProjectSet` | set returning function | unnest / regexp_match global |
| `Unique` | 去重 | DISTINCT |
| `SetOp` | INTERSECT / EXCEPT | 集合运算 |

---

## 四、loops、time、rows aggregation

每个 plan node `actual time` / `rows` 都是 **per loop**。

```sql
EXPLAIN ANALYZE
SELECT a.id, count(b.id)
FROM a JOIN b ON b.aid = a.id
GROUP BY a.id;

Hash Join (...)
   Hash Cond: (a.id = b.aid)
   -> Seq Scan on a (actual time=0.01..5.00 rows=10000 loops=1)
   -> Hash (...)
        Buckets: 16384  Batches: 1  Memory Usage: 512kB
        -> Seq Scan on b (actual time=0.02..12.18 rows=50000 loops=1)
```

如果节点 `loops=10`：
```
   Nested Loop Left Join (actual time=0.1..15.0 rows=20000 loops=10)
   → 实际总行数 = 20000 × 10 = 200000
   实际总时间 = 15.0 × 10 = 150 ms
```

子节点 inner of Nested Loop 是 loops=N1（外每行扫一次）：
```
Nested Loop
  -> Seq Scan outer (loops=1)
  -> Index Scan inner (loops=N1_outer_rows)
```

inner loops 真实数据 → 看 child 时间 × child loops = 总耗时。

---

## 五、Hash Join vs Nested Loop vs Merge Join

### 5.1 Nested Loop

```
for r1 in outer:
    for r2 in inner where match:
        emit (r1, r2)
```

cost = N_outer × N_inner 平均 lookup cost。

适合：
- outer 小 (e.g. 100 行)
- inner 有 index 一应命中 (< 10 行)

 противопоказания：
- 双表都大 (10k+) → X OK 太慢
- 没 inner index → 内表每次全 scan

### 5.2 Hash Join

```
# phase 1: build hash table on inner (smaller)
for r2 in inner:
    htab[hash(r2.joinkey)].append(r2)

# phase 2: probe
for r1 in outer:
    bucket = htab[hash(r1.joinkey)]
    for r2 in bucket:
        if r1.joinkey == r2.joinkey: emit
```

适合：
- 双表大 (10k+)
- join key 不排序
- 内存能含 hash bucket

work_mem 限制：太大 batch 到磁盘 → 多次 pass → cost 爆炸
```sql
SET work_mem = '64MB';
```

### 5.3 Merge Join

```
# 双方已按 joinkey 排序
for r1 in outer, r2 in inner:
    if r1.key < r2.key: advance outer
    elif r1.key > r2.key: advance inner
    else: emit (r1, r2)
```

适合：
- 双方都有索引（自然 sort），避免显式 sort
- 实际大表大、merge 内不需 hash mem
- ORDER BY + JOIN

---

## 六、覆盖索引判断

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT id, name FROM users WHERE name LIKE 'A%';
   Index Scan using idx_name on users (...)
       Index Cond: (name ~~ 'A%'::text)
       Heap Fetches: 0    ← 0 = index-only successful
       Buffers: shared hit=4 read=0
```

`Heap Fetches = 0` → index-only scan 成功，全 columns 都在索引中。
`Heap Fetches = N` → 索引不覆盖，回表 N 次。

注意点：PG index-only scan 还要求 **visibility map** 显示 page 全部 commit。autovacuum 后 page VM 才得 set → 又一理由 vacuum 要勤跑。

---

## 七、并行执行 (parallel query)

PG 9.6+ 并行 query：
```sql
EXPLAIN ANALYZE SELECT count(*) FROM big_table;

Finalize Aggregate (...)
  -> Gather (...)
       Workers Planned: 4
       Workers Launched: 4
       -> Partial Aggregate (...)
             -> Parallel Seq Scan on big_table (...)
```

并行 plan node：
- `Gather`：拉 worker → leader 数据合并
- `Gather Merge`：worker 已 sort，merge sorted stream
- `Partial Aggregate`：每 worker 算部分 sum/count
- `Parallel Seq Scan`：worker 间分 page

best practices：
- `max_parallel_workers_per_gather = 4`（默认 2 太保守）
- `max_parallel_workers = 8`（CPU 核）
- `parallel_setup_cost` 决定 planner 是否选 parallel
- 数据太少 (< 10k 行) 不走并行

---

## 八、MySQL EXPLAIN

```sql
EXPLAIN FORMAT=JSON SELECT ...;
```
关键字段：
- `type`：access type (`system`, `const`, `eq_ref`, `ref`, `range`, `index`, `ALL`)
- `key`：实际使用索引名
- `key_len`：使用的索引长度（字节）
- `rows`：估计行数
- `filtered`：%WHERE 过滤后剩余比例
- `Extra`：`Using index` (覆盖)、`Using filesort` (排序)、`Using temporary` (临时表)
- `possible_keys`：planner 可考虑的索引

`EXPLAIN ANALYZE` (MySQL 8.0.18+) 类似 PG 实测。

```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 5;
-> Index lookup on orders using idx_user_id (user_id=5)
    (cost=12 rows=100) (actual time=0.05..0.5 rows=100 loops=1)
```

---

## 九、产线事故

### 9.1 ESTIMATE 与 actual 差太大
某 query `rows=1` 估但 actual 1M 行 → hash join chosen，跑爆 work_mem。

**修复**：`VACUUM ANALYZE big_table` 刷新统计；或加 `ANALYZE (col)` 显式 raise default_statistics_target。

### 9.2 三表 join planner 选错算法
默认 GEQO `geqo_threshold = 12` 表。13 表 join 走遗传算法，结果 plan 极坏。

**修复**：调高 `geqo_threshold=20`；或 SQL 用 `SET geqo=off`。

### 9.3 parallel query 不触发
大表 seq scan 5 秒耗 leadership 估 cost 小于 parallel_setup_cost。
- `parallel_setup_cost = 100` → 太高
- 调 `parallel_setup_cost = 50`、`parallel_tuple_cost = 0.05` → 并行触发

### 9.4 Index Scan 比 Seq Scan 慢
random_page_cost 默认 4 → planner 偏 seq scan。SSD 应改 1.1。 indexes 才会被选。

### 9.5 Work_mem 不够 Hash Join 磁盘 batch
大表 hash join 6 batches → 6 次 disk read 100ms。`work_mem=64MB` 单次 batch 完成 → 50ms。

---

## 十、易错清单

1. cost 단位是 dimensionless 不unit，不能直接说"cost X = 毫秒"；仅可记 startup vs total 比例
2. time 是 per loop，必须乘以 loops 比真相
3. `EXPLAIN` 不 ANALYZE 仅估计；不能完全反映真实执行（如 cache)
4. `EXPLAIN ANALYZE` 真执行 → DML/locks 都生效
5. PG random_page_cost 4 仅适合机械盘；SSD/NVMe 调到 1.1
6. effective_cache_size 必须与机器 cache 大小匹配；调小规划器更偏 seq scan
7. Block nested loop vs hashed nested loop：MySQL 8 之前主要 blocking nested join；MySQL 8 hash join
8. EXPLAIN ANALYZE 跑长时间的 query 慢时长;不要跑 AV业 SLA 核心 query。

---

## 十一、这一章带走的东西

1. EXPLAIN ANALYZE BUFFERS 三层看全：算法选择 + 估行行数 + cache hit
2. planner cost model 是 seq_page_cost / random_page_cost / cpu_* × pages + rows
3. loops × time = 实际总时间；inner loops = outer 行数
4. Nested Loop vs Hash Join vs Merge Join：outer 小 + index → NL；双大 + work_mem fit → HASH；表已 sort or idx ordered → MERGE
5. 覆盖索引 Index Only Scan 仍依赖 visibility map (vacuum)
6. SSD 必调 random_page_cost = 1.1、effective_cache_size = 物理内存 75%
7. parallel query 大表 4 workers 默认、parallel_setup_cost 太高 → 调小 触发

## 下一节 →

[日志与崩溃恢复](../recovery/README.md) — ARIES、fuzzy checkpoint、CLR、Point-in-time 恢复、PITR
