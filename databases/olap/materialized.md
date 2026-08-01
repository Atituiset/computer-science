# 预聚合、物化视图、Cubes

## TL;DR

聚合查询全量 scan 太贵 → 用预聚合 + 物化视图 + 数据 cube 提前算好 → 查询时查小表。代价：构建 + 维护 + 一致性。本节覆盖 ROLLUP / CUBE / GROUPING SETS、PostgreSQL / Materialize 物化视图、Apache Druid auto-rollup、Cube.js semantic layer、ClickHouse AggregateFunction、Star Schema vs Snowflake Schema。

---

## 一、Star Schema vs Snowflake Schema

### 1.1 Star Schema

- 中心是 fact 表（事件）
- 周围是 dim 表（用户、商品、时间）
- fact 表大（亿+ row），dim 表小（k-row）
- fact 表外键链接 dim
- 物理上 星状 → 简单 join 顺序 planner 容易优化

```
       dim_user    dim_product    dim_time
            |          |             |
            +----------+-------------+
                       |
                  fact_sales
                 (10^9 rows)
```

适合：BI、报表、阳 reporting。

### 1.2 Snowflake Schema

- dim 表进一步 normalized → 多层 dim 表
- 节省存储，但 join 复杂
- 现代 OLAP 罕用（存储已不贵）

---

## 二、预聚合模型

### 2.1 Rollup Table

每次 INSERT fact + 1 row 写汇总表：
```sql
CREATE TABLE sales_by_day (
    dt DATE,
    product_id BIGINT,
    total_amount DECIMAL, n_sales INT);

INSERT INTO sales_by_day
SELECT created_at::DATE, product_id, SUM(amount), COUNT(*) 
FROM sales_raw 
WHERE created_at::DATE = '2024-10-22'
GROUP BY created_at::DATE, product_id;
```

查询变小：
```sql
SELECT dt, SUM(total_amount)
FROM sales_by_day
WHERE dt BETWEEN '2024-10-01' AND '2024-10-31'
GROUP BY dt;
```

100x 加速（30 days × 1000 products = 30k row → 替代 1亿 raw row）。

### 2.2 Materialized View (PostgreSQL)

```sql
CREATE MATERIALIZED VIEW sales_daily AS
    SELECT 
        date_trunc('day', created_at) AS dt, 
        product_id,
        SUM(amount) AS total, 
        COUNT(*) AS n
    FROM sales
    GROUP BY dt, product_id
    WITH DATA;

REFRESH MATERIALIZED VIEW sales_daily;
-- PG 9.4+ 支持 REFRESH CONCURRENTLY 不阻塞 SELECT
```

PG 14+ `WITH NO DATA` + lazy refresh；9.3+ 已有 incremental refresh on `CONCURRENTLY`。

### 2.3 ClickHouse AggregateFunction State

```sql
CREATE TABLE sales (
    dt Date,
    product_id UInt32,
    amount AggregateFunction(sum, Decimal)
) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(dt) ORDER BY (dt, product_id);

INSERT INTO sales SELECT dt, product_id, sumState(amount) FROM sales_log GROUP BY dt, product_id;
SELECT dt, sumMerge(total) FROM sales GROUP BY dt;
```

AggregateFunction state：聚合为 part merge 时（不重 row，是 state 合并）→ 单 INSERT 1 row/组。

---

## 三、Cube.js Semantic Layer

```
cube Sales {
  measures: [totalAmount, count]
  dimensions: [createdAt, product, user]
  joins: Products ON id = product_id
  
  preAggregations: {
      salesByDay: {
          type: rollup
          measures: [totalAmount]
          timeDimension: createdAt
          granularity: day
      }
  }
}
```

Cube.js 在 query time 选 pre-aggregation rollup → 流 SQL 改写 → 后台刷新 + cache。

Cube.js 部署：
- Cube.js server (Node.js)
- Backend 查 PG / Snowflake / BigQuery
- Frontend RESTful API
- pre-aggregations 可存自己 store (e.g. PG 表 + cube refresh worker)

---

## 四、Apache Druid Rollup

Druid ingest 阶段做聚合：
- ingestion spec 中 metrics 计 `aggregators` (sum, count, hyperUnique etc.)
- 同 timestamp bucket + dimensions group 一组 → 1 row
- 用户既不查 raw 只查 rollup

随机 ingest 1 PB raw → 1 TB rollup → 1000× storage 节省。

最终 consistency：Druid 数据源有 granularity (minute/hour/day)； query 时合并 rollup grain。

---

## 五、Apache Pinot 的 Real-time / Hybrid Tables

- offline segment: 历史 batch push
- realtime segment: Kafka stream 持续 ingest → realtime 0-day data
- Hybrid: 同 table 合一来自 realtime + offline

聚合：Star-Tree Index (Pinot 1.0+) → 子集维度 + sub-set 聚合 → skip 数据，比 Druid rollup 更显增量。

---

## 六、Snowflake search optimization + materialized view

```sql
CREATE MATERIALIZED VIEW sales_daily_mv AS
SELECT date_trunc('day', created_at) AS dt, product_id,
        SUM(amount) AS total, COUNT(*) AS n
FROM sales
GROUP BY dt, product_id;

SELECT * FROM sales_daily_mv WHERE dt = '2024-10-01';
```

Snowflake 自动改写 query 命中可视物化视图 (用 metadata 找 cover)；后台 asynchronous refresh。但 $/byte 计算 → cost 主要 storage。

---

## 七、Hyperloglog / approximation

```sql
-- PG 默认 count 是 O(N), 大 OLAP 用 approximate HLL
CREATE EXTENSION hll;
SELECT hll_cardinality(hll_agg(user_id)) FROM logs;

-- ClickHouse uniq / uniqExact / uniqCombined
SELECT uniq(user_id), uniqExact(user_id) FROM logs;
```

HLL ~3% error，1KB filter ~10^9 distinct items → saves memory + 时间。

---

## 八、产线案例

### 8.1 大表 group-by 几小时 → 加 rollup 后 几秒
100亿 sales group by (day, product) → 30 分钟 → rollup 30k row → 3 sec 查询。

### 8.2 Druid rollup 不频繁导致 query 加爆
旧数据 1 day rollup 100% raw 仍 → ETL job 频率没达到 30 min 一夜 → query 引擎 scan 6× 数据 reduced 到自然 limit

**修复**：Druid `indexRealtime` 提高聚合 ingest 次数 + bend at hour rollup ingest 1 min batch.

### 8.3 物化视图未刷新误以为 query 旧
PG 9.3 没 `REFRESH CONCURRENTLY`，刷新锁表 → 业务误以为慢，业务 skip → 数据漂移。

**修复**：升 PG 9.4+ + `REFRESH CONCURRENTLY` + cron 30min 刷新。

### 8.4 Cube.js pre-aggregation 大规模膨胀
某 dashboard pre-agg 30k row × dims 5 但 D **= 100 × 7 × 1000 = 700k 组** → quota 大。

**修复**：pre-agg dims 减 3 + 引 high cardinality 单独 cube (用户 specific 减 K use approximate)

### 8.5 Snowflake materialized view 全 table 1 TB 加倍钱
MV storage 双副本 fact + MV → 业务调 15+ MV → 总 cost storage 30 TB 给 10 TB raw

**修复**：MV 5 同时舍弃 + HLL 不是 raw count。

---

## 九、易错清单

1. **Rollup 后 history retention**：rollup 不消耗 raw → 仅到 30 days；rollup 长期保留
2. **MV refresh 后 query 实时一致**：MV 是 snapshot + 故业务报表万物万 now feature
3. **HLL approximation**：3% 误差是多少 → 直播 report 通常接受；财务一定需 native
4. **Insert on rollup table 业务必向**：业务 INSERT batch 慢慢 with raw row 一古
5. **Star schema joins 一定简化**：均匀 planner join，uniform 接口 select 横向 输料

---

## 十、这一章带走的东西

1. Star Schema + rollup + MV 让聚合查询 O(N) 变 O(N/group)
2. PG 9.4+ REFRESH CONCURRENTLY，老 PG 难升
3. Druid / Pinot ingestion 时聚合 → 体积 1000× 缩
4. ClickHouse AggregateFunction state + AggregatingMergeTree 是 OLAP 黑 magic
5. Cube.js semantic layer 让前端不害怕 rollup 设计
6. HLL / T-digest 让 distinct count 内存搏 5KB → billions items

## 下一节 →

[Lakehouse：Iceberg / Delta / Hudi](lakehouse.md) — metadata server 中关键 cap, potential 优化 storage
