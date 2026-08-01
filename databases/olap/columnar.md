# ClickHouse / DuckDB / Snowflake 设计

## TL;DR

三个新一代 OLAP 引擎代表了三种架构方向：MPP shared-nothing（ClickHouse）、单机嵌入式向量化（DuckDB）、存算分离云原生（Snowflake）。各自取舍反映了不同规模与 workload 下的工程权衡。本节带你看完三个引擎的 storage layout、metadata server / consensus decision sequence、compression format、query execution path、最近 5 年客户群对比。

---

## 一、ClickHouse (Yandex 2016)

### 1.1 架构

```
+---+    +---+
| N | <-> | N |  (replica via ZooKeeper / Keeper)
+---+    +---+
Shard 1       Shard 2
```

特点：
- shared-nothing：每个 shard 一个节点，replication via cluster.xml + ZooKeeper
- mergeTree 引擎，每分钟一批 part 合并
- vectorized batch processing (1024-8192 rows per batch)
- 跨 shard query 用 native protocol 解读

### 1.2 MergeTree

```
Table storage = parts:
  part_001:
    - columns file (one per column)
    - primary.idx (sparse index every 8192 rows)
    - skip idx file (lightweight: min/max/null)
    - checksums
  
  part_002 ...
  
INSERT INTO t VALUES (...)
  → 创建 new part on disk (default part_size ~ 150MB)
  → background merge: 多 part → 大 part (10GB+)
```

skip index 算法：
- `minmax`：极值索引
- `set`：value 集合
- `bloom_filter`：等值 filter
- `ngrambf_v1` (ngram bloom)：模糊匹配 LIKE

### 1.3 Replication

- `ReplicatedMergeTree` 引擎：每 part 增/删在 ZooKeeper 同步
- multi-master：每 replica 独立读；写入 trigger 复制 log
- 不像 Raft/Paxos：ClickHouse 复制是 eventually + part 级别
- 新版 ClickHouse Keeper 替代 ZooKeeper（Raft 实现）

### 1.4 性能与限制

性能：
- vectorized aggregation，全 table scan 1 PB query < 1 hr
- 拥抱 JSON / Map / Tuple 等 polymorphic 数据
- 没有 transaction overhead

限制：
- 没 OLTP：UPSERT 仅 batch mutation (background)
- DDL 修改表难（ALTER 引擎 Class Hang），需 mutations
- replication ZK 长期持有，高故障

---

## 二、DuckDB (CWI 2019)

### 2.1 架构

- **in-process OLAP**：无 server, 一 (`libduckdb.so`) dll 直接链接
- Python `import duckdb; duckdb.query("...")` 即 work
- 用 embedded StorageContext, 本地 file
- vectorized engine (1024-row batches)

### 2.2 设计哲学

- OLAP 不需要 "ACID" 全弱化，仅 "no consistency issues"
- 不锁表，写 insert 加 incremental row (Morsel 固定大小 batch)
- 跨 platform: Windows / macOS / Linux / WSL / ARM
- 单机 (desktop scale) 通常 100 GBs OK，1+TB memory pressure 大

### 2.3 性能

实测：
- TPC-H SF1 (1 GB) 10 秒 vs PG 5 分钟
- TPC-H SF100 (100 GB) 5 分钟 vs Snowflake 2 分钟
- SF1000 (1 TB) DuckDB benchmarks → 60 min (single-machine)

### 2.4 优势与限制

优势：
- 部署极简：无服务部署
- 适合 streamlit / pandas-area workflow
- 高内存 (machine 32GB+) work 好

限制：
- 不真正 ETL：OLTP 后快流处理 dump file
- 没 distributed：单机 max CPU / RAM SIMD 只能 region-based
- 不支持多用户并发写

---

## 三、Snowflake (2014)

### 3.1 架构

```
+---+---+---+----+
| Cloud Services (metadata) |
|   - metadata server
|   - query optimizer
|   - authentication
|   - access control
+---+---+---+----+
       ↓
+---+---+---+----+
| Compute (Virtual Warehouse) |
|   MPP cluster, 每节点 local SSD cache
+---+---+---+----+
       ↓
+---+---+---+----+
| Storage (Object) |
|   S3 / GCS / Azure Blob
+---+---+---+----+
```

- "$/TB-scanned" 计费：用户付 query 数据量
- 微 partitions (16MB block) + Stripe 索引
- MPP 状态 serverless，autonomous 弹性

### 3.2 微分区

- 16 MB 一个微 partition (slice)
- 每微 partition 存 column subset + min-max cutoff
- SELECT 谓词在 metadata server 通过 column min/max → 跳分区
- 压缩 SNAPPY / LZ4 / 专用 (DELTA / STRING_DICTIONARY)

### 3.3 Result Cache

Cloud Services 内 cache：query 同 hash 数秒内返回相同结果。
- 90 second TTL
- 数据 vacuum 后 cache invalid

### 3.4 性能与限制

性能：
- local SSD cache layer: hot micro partitions cache 命中
- tiered storage: 热数据 local SSD / S3 cold
- vectorized query execution, 每 batch 8K-64K rows

限制：
- 没真正 MERGE ON primary key UPSERT
- "Time travel" 90 天历史数据访问

---

## 四、对比表

| 维度 | ClickHouse | DuckDB | Snowflake |
|------|------------|--------|-----------|
| 部署 | server, MPP | in-process lib | SaaS cloud |
| Scale | 1 PB | 100 GB-1 TB | >1 PB |
| 隔离 | multi tenant 慢 (server) | 单 user 嵌入 | virtual warehouse isolation |
| 价格 | 自 deploy + OSS | free OSS | pay-per-TB scanned |
| 延迟 | ms-s 短 query | ms-秒 | sec-min query |
| 写 update | 不擅长 | 一般 | 一般 |
| Replication | ZK based | 无 (本地文件) | S3 eventually + cache invalid |
| ACID | 无 | MVCC on local file | metadata transactional |
| Compression | LZ4+RLE+dict | col + RLE + dict | micropartition + multi compression |

---

## 五、其他 OLAP Engine

### 5.1 Apache Druid
- kafka → historical node + deep storage
- sub-second query 5 PB streaming-fed
- 适合 实时分析高可用 metrics

### 5.2 Apache Pinot
- LinkedIn design 类 Druid
- 多 STM 模式 speed-up ingestion

### 5.3 Apache Kylin
- Hadoop + HBase + OLAP cube precomputation
- 5 PB 但 阶段失效（low freshness）

### 5.4 Databricks SQL
- 类 Snowflake，但用户自管 Delta Lake
- Spark vectorized engine

### 5.5 Firebolt
- 列存 + skip + f0 vectorized + indexing
- 类 Snowflake，新型 data ingest

### 5.6 SingleStore (MemSQL)
- HTAP 一体
- 列 + row combo
- OLTP + analysis 同表

---

## 六、产线案例

### 6.1 ClickHouse 写入瓶颈
业务 100k INSERT/sec 单机磁盘 IO 占满。ClickHouse merge 跑死 → 5+ days backlog。

**修复**：bulk insert batch 1M rows / `max_insert_block_size=1M`；多 shard 分写；turbo 编码 mode 极致压缩。

### 6.2 Snowflake small query 高 cost
业务 dashboard 每 30 秒每 user query 小 → warehouse cost $30/hour。

**修复**：启 result cache hit + auto-suspend 60s → $10/hour。

### 6.3 DuckDB embedded OOM (notebook)
pandas `read_csv` 64 GB → DuckDB driver alloc all 数据 → memory > RAM 几次 kill。

**修复**：`PRAGMA memory_limit='2GB';` `SET threads=1;` + swap file。

### 6.4 ClickHouse replication ZK 故障
ZK → 部 partition lag → ClickHouse spinning.

**修复**：升 Raft ClickHouse Keeper 替代 ZooKeeper。

### 6.5 Snowflake mark forced UPSERT slow
SaaS UPSERT primary key 模式 metadata mark 但 render slow。

**修复**：业务夜里全压 merge batch (insert + part override)。

---

## 七、易错清单

1. **ClickHouse 没 OLTP**：UPSERT 走 mutations 后台 async
2. **Snowflake cost = query byte scanned**：主成本驱动
3. **DuckDB**：不可服务 model，每 user 嵌自
4. **ClickHouse mergeTree replication**：古老 ZK 不能多 ZK cluster，升 ClickHouse Keeper (Raft)
5. **DuckDB `PRAGMA threads`** 设高 可 OOM
6. **ClickHouse Hybrid Log-Structured Merge Trees**：老 MergeTree → 改 ReplicatedMergeTree
7. **Snowflake warehouse 大 T-shirt size**：scaling 是 fixed（不 size 算每 warehouse 工资源）

---

## 八、这一章带走的东西

1. ClickHouse: shared-nothing MPP + mergeTree + Vectorized 是 PB scale 自部署 OLAP
2. DuckDB: in-process + 8192-row vectorized + 单机性能比 PG 10-100×
3. Snowflake: micro-partitions + multi-tier (S3 + local SSD) + 云原生 + pay-per-byte
4. 三选: 部署自控选 CH, embedded analytics 选 DuckDB, managed cloud 选 Snowflake
5. 性能取决于：列压缩、batch size、SIMD 命中、缓存 localily
6. 物化视图 + Rollup 是必要的，不是 optional

## 下一节 →

[预聚合、物化视图、Cubes](materialized.md) — Cube / Materialized View / Star Schema / Druid rollup
