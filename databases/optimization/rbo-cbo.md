# 基于规则 / 基于代价优化 (RBO/CBO)

## TL;DR

Planner = 规则改写 (RBO) + 代价估算 (CBO) + plan 搜索。RBO 做无成本的重写（谓词下推、子查询展开、常量折叠）；CBO 基于统计（MCV、histogram、n_distinct、selectivity）做 cost 模型选最低 cost plan。本节从 SQL 文本走到 plan tree：parser → rewriter → planner → executor 完整结构、世界各国主流 DB 的 planner 差异、Cascades 框架（SQL Server / Apache Calcite）与火山模型 vs 向量化的根本区别。

---

## 一、Pipeline 全流程

```
SQL Text
  ↓ lexer / parser (PG: scan.l + gram.y, MySQL: yacc++)
Query Tree (AST)
  ↓ Rewriter (RBO) — view expansion, constant folding, predicate simplification 
Logical Plan Tree
  ↓ Planner (CBO) — selectivity estimation, cost model, search engine (DP / Cascades)
Physical Plan Tree
  ↓ Executor — pipelined / vectorized
Result rows
```

PG 14+ planner 直接重写为 physical operator，把 transformation 与 cost 估计混合迭代。Apache Calcite（Hive、Flink、Beam 等）用 Cascades-volcano 风格，可 set-based 规则搜索。

---

## 二、RBO 变换清单

| 规则 | 作用 |
|------|------|
| View expansion | 视图合并 |
| Constant folding | `1+1 > 2` → TRUE/FALSE |
| Predicate pushdown | `∏(σ(p(R)))` → `σ(p(∏(R)))` |
| Sub-query flattening | `WHERE x IN (SELECT ...)` → SEMI-JOIN |
| Sub-query decorrelation | `Correlated EXISTS` → `SEMI JOIN` |
| OUTER → INNER simplification | `L JOIN A ON ... WHERE A.x NOT NULL` → INNER |
| Common subexpression elimination | 重复表达式去重 |
| OR → UNION ALL | `WHERE a=1 OR b=2` 不可走两个 index → UNION ALL 走 |
| CTE inline | PG 12+, MATERIALIZED marker |
| Dead code removal | `SELECT * WHERE 1=0` → EMPTY |
| Distinct pushdown | DISTINCT 在 JOIN 中推下 |

RBO 是 deterministic——不依赖 statistics，只做正确变换。然后给 CBO 优化。

---

## 三、CBO 核心模块

### 3.1 Statistics

PG `pg_statistics` (per-column):
- `most_common_vals` / `most_common_freqs` — 高频值分布
- `histogram_bounds` — 等频直方图 (default_statistics_target 100 buckets)
- `n_distinct` — 唯一值数（负数表示比例）
- `null_frac` — NULL 比例
- `correlation` — 物理排序 vs 列值相关度 (用于 BRIN 与 ORDER BY index seek)

```sql
SELECT * FROM pg_stats WHERE tablename = 'users';
```

MySQL 8.0+ 也类似：`ANALYZE` 拿 histogram (`information_schema.column_statistics`)。

### 3.2 Selectivity Estimation

等值 sel：
```
sel(col = value) =
  if value in MCV → MCV freq
  else 1 / max(n_distinct, 1)
```

范围 sel：
```
sel(col between a and b) =
  if histogram available → [a,b] 内 bucket count
  else default 1/3 (rough)
```

JOIN sel：
```
sel(R.a join S.b) = 1 / max(ndistinct(a), ndistinct(b))
                   if both unique (1:1) → 1 / max
                   if FK (1:N) → 1 / N_unique_of_major
```

复合 sel：
```
sel(p1 AND p2) = sel(p1) × sel(p2) × dependent_factor
sel(p1 OR p2) = sel(p1) + sel(p2) - sel(p1 AND p2)
```

PG `AND` 默认 `sel(p1) × sel(p2) × 0.5`（不可独立时）。

### 3.3 Cost Model

```
cost = seq_page_cost × num_seq_pages
     + random_page_cost × num_rand_pages
     + cpu_tuple_cost × num_rows
     + cpu_index_tuple_cost × num_index_rows
     + cpu_operator_cost × num_ops
     + parallel_setup_cost × 1 (if parallel workers)
     + parallel_tuple_cost × num_tuples
```

PG 默认 (postgresql.conf):
- `seq_page_cost = 1`
- `random_page_cost = 4` (机械盘合适；SSD 应调 1.1-1.5)
- `cpu_tuple_cost = 0.01`
- `cpu_index_tuple_cost = 0.005`
- `cpu_operator_cost = 0.0025`
- `parallel_setup_cost = 1000`
- `parallel_tuple_cost = 0.1`
- `effective_cache_size = 4GB` ← planner 假设 cache 大小（不分配），影响规划偏向

调小 effective_cache_size → planner 偏 seq scan。
SSD 极推：`random_page_cost = 1.1, effective_cache_size = RAM × 0.7`。

---

## 四、Plan Search

### 4.1 Bottom-up DP (System-R 风格)

```
DPsize 1 = base_tables optimal plan
DPsize k = min(DPsize k-1 join new base_table)
       考虑所有连接顺序 × join 算法 (hash/merge/loop)
       cost = already_seen_cost + new_join_cost
```

复杂度 O(3^N) — join reorder，N 表少时 fast (N<15)。

### 4.2 PostgreSQL: GEQO

`geqo_threshold = 12` (default)，N ≥ 12 表时切遗传算法：
- join order 编为 permutation
- 模拟进化 = mutation + crossover + selection 数千代
- 100-1000 倍快但非最优

BI 工具跑出 N 表 join → query 性能差。临时关：`SET geqo = off`。

### 4.3 Cascades / Volcano

Cascades (Goetz Graefe, 1995) 是 top-down 规则驱动的 plan 搜索：
- 任务栈：transform goal, implement goal, optimize goal
- 引用替代 copy：低内存开销
- memo 数据结构存储所有 plan choices
- 规则集可扩展

应用：
- SQL Server optimizer (微软内部 Cascades)
- Apache Calcite (Hive、Flink、Beam)
- CockroachDB (Moruit/Go 版本)
- Spark Catalyst (类似 Cascades 模式)

Cascades vs DP：
- DP 仅 join reorder，Cascades 可带所有物理算子选择
- Cascades 慢但灵活 → 大数据业务偏好

---

## 五、特殊情况

### 5.1 Partition Pruning

分区表查询时只扫匹配分区：
```sql
CREATE TABLE events (created_at timestamptz, ...) 
  PARTITION BY RANGE (created_at);

CREATE TABLE events_2024_01 PARTITION OF events
  FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

SELECT * FROM events WHERE created_at = '2024-01-15';
-- 仅扫 events_2024_01
```

PG 11+ 也支持运行时 execution-time pruning：动态 `parameter` 时也能 prune。

### 5.2 Parallel Query

PG 9.6+:
```
Gather
  → Parallel Seq Scan on t
```

worker 数：
- `max_parallel_workers_per_gather = 4`
- `max_parallel_workers = 8`
- `min_parallel_table_scan_size = 8MB`

大表 ≥32GB → 启用并行；小表 seq 一次比启动 worker 启动还快。

### 5.3 Adaptive Query Optimization

Oracle 12c+ / SQL Server adaptive join：plan tree 留分支，runtime 测 join 选择，动态选 hash vs loop。PG 14+ Partial.

### 5.4 MPP Join Distribution

Greenplum / Spark：
```
SELECT * FROM A JOIN B ON A.user_id = B.user_id;
```

策略：
- **Broadcast**：小表 (e.g. < 100MB) 广播到所有节点
- **Redistribute**：双表按 join key hash 重分布
- **Co-located**：表已按同 key 分布 → 本节点直接 join

PG Partitioned + Distributed 扩展 (Citus、CockroachDB) 也用类似策略。

---

## 六、产线事故

### 6.1 估 rows 不准导致 hash join 跑爆

`ANALYZE` 长时间没跑 → 统计陈旧 → `rows=1` 估而实际 100 万 → planner 选 nested loop 跑数小时。

**修复**：启用自动 autovacuum + `analyze_scale_factor = 0.02`；手动 `ANALYZE careful_table` 每次 ETL 后强刷。

### 6.2 多表 join GEQO 选坏

BI 工具 18 表 join → GEQO 随机 plan；某些组合 100s 执行。

**修复**：`SET geqo = off` + `SET join_collapse_limit = 50`；业务侧汇总预聚合表降 N 表。

### 6.3 random_page_cost 误设 → 全 seq scan

某评价改 `random_page_cost = 1` 走 idx scan 但机械盘上 random IO 慢 → query 1000ms up to 100ms 他选，但实际原 seq 50ms。

**修复**：机械盘 keep 4；SSD 1.1-1.5。

### 6.4 partial index predicate 不命中

partial index `WHERE active = TRUE` 但 SELECT `WHERE active IS TRUE` 不 match → index not used。

**修复**：PG planner 要求 SELECT predicate logic-imply index predicate，否则不命中。改业务 SQL `WHERE active = TRUE`。

### 6.5 join_collapse_limit 触发 suboptimal

PG `join_collapse_limit = 8` (default)，业务写 12 表 join，写顺序入 planner collapse → planner 不重排。

**修复**：`SET join_collapse_limit = 50` 或 unlimited `join_collapse_limit = 0`。

---

## 七、易错清单

1. **EXPLAIN cost 不能直觉说"应该是多少 ms"**：dimensions less；仅相对 join 排序规划
2. **EXPLAIN ANALYZE 实际 vs EXPLAIN 估计巨大 gap** = 统计陈旧/未刷新
3. **random_page_cost SSD 设 1.1** 不是 4
4. **default_statistics_target** 大值 (1000+) 让 plan 准确，但 ANALYZE 耗时长
5. **多表 join ≥ 12 → GEQO**：业务表太多 force off 或 BI 用预聚合 mview
6. **`enable_*` planner 开关** 禁 hash join/merge：业务调试时慎用
7. **`prepare_threshold`** 在 PG 中复 plan：但 plan 准确性 shaky，需 `plan_cache_mode = auto` (PG 16+)
8. **Subquery decorrelation 不是 always optimal** — 取决于实际数据分布

---

## 八、这一章带走的东西

1. RBO 是 deterministic transformation (pushdown, constant folding, view expansion)、CBO 是 statistics-based search
2. PG statistics MCV + histogram + n_distinct 决定 selectivity 估计准确度
3. cost model 由 6 个 cpu + page cost 组成，random_page_cost SSD 上必调 1.1
4. Plan search = bottom-up DP (System-R) join reorder，N≥12 切 GEQO；大数据用 Cascades
5. Cascades (SQL Server, Apache Calcite, CockroachDB, Spark Catalyst) 比单一 DP 强很多
6. MPP join: broadcast (小表) / redistribute (大表) / co-located (同分布)
7. partition pruning + execution-time pruning 让 1 year partition 12 月表数据 query 走 1 segment
8. Planner adaptive join (Oracle/SQL Server 还有 PG partial) 让 runtime 决定 hash vs loop

## 下一节 →

[Join 顺序、hash join vs nested loop](join.md) — pros cons，Hash Join 临时落盘
