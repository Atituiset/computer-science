# Snowflake 数仓

## TL;DR

**Snowflake** (2012 founded, 2020 IPO = "BIGTIME revenue growth" story) 重新定义了 cloud data warehouse 即 架构——**shared-data architecture**: storage (S3 / Blob) separated from compute (virtual warehouses), 每个算力弹性 增长 / 缩小秒级。 传统 on-prem Teradata/Hive 是 shared-nothing 计算+本地盘, 扩展弱。 Snowflake 强调 self-tuning, zero-copy clone, Time Travel, data sharing, seamless scale-out 并发 也 可以。 本章梳理 Snowflake architecture, storage internal (micro-partitions + hybrid columnar), services 层, 查询优化, 与 BigQuery / Redshift 对比, 典型 use (ETL, BI, ad-hoc analytics) 与事故 (clone cost 爆炸)。

---

## 一、Architecture (Three-tier Shared-Data)

```
┌─────────────────────────────────┐
│   Cloud Services Layer          │
│ (metadata, auth, optimizer,    │
│  query compiler, security)      │
└─────────────────────────────────┘
         |              |
┌─────────────────────────────────┐
│   Query Processing Layer        │
│ (Virtual Warehouses: elastic   │
│  compute clusters MPP)         │
└─────────────────────────────────┘
         |
┌─────────────────────────────────┐
│   Storage Layer (Cloud Object)  │
│ (S3/Azure Blob/GCS)            │
│ micro-partitions +     				 |
│ hybrid-columnar compressed     │
└─────────────────────────────────┘
```

### Cloud Services

- Metadata management (catalog)，access control(RBAC), query optimizer, 管理 virtual warehouses
- **Always-on, 多租户**, 但 不 query 处理 (无  算力)

### Query Processing

- Virtual Warehouses (VW): user-provisioned independent compute clusters (size: XS~6X-Large)
- 每个 VW run 在 provisioned cluster, elastic auto-suspend/resume within seconds (warehouse's empty usage 挂 停).
- 多 VW 并行 isolation (ETL loading VW 与 用户 BI VW 独立 cluster), 不 concurrency 竞争。

### Storage

- All data in cloud object (S3) as **micro-partitions**: compressed, columnar, immutable blocks (~50-500MB compressed).
- Micro-partition metadata (min/max per column, bloom filter by zone maps, stretch) in service layer.
- Columnar, compressed (自动选择 compression algorithm Zstandard/gzip etc).
- **Time Travel & Fail-safe**: at any point recover table state prior with up to 90-day retention。

---

## 二、Micro-Partition Internal

- 每 table data 分 immutable micro-partitions; auto clustered by natural order.
- Per micro-partition: min/max per column, bloom filter null count etc. metadata 存在 cloud services.
- Query 扫描的时候,  prune 不需要 scan micro-partition > 用 metadata 知 不需要 读 => significantly less I/O.

### Hybrid Columnar + Partition

Stored as columnar 用  PAX (Partition attributes across): each micro-partition 是 PAX layout within block (columnar inside partition). Cross-partition query stitch columns for needed rows.

### Zero-Copy Clone

Clone table instantly without data copy: copy metadata entries pointing to same micro-partitions; only later data modification trigger new micro-partitions (Copy on Write). 秒级 零成本 test env.

### Time Travel

Restore table at past state up to 1-90 days (according edition). Data not deleted at drop (micro-partition kept with retention). Similar time travel retention changes for GDPR data erasure.

---

## 三、Virtual Warehouses Multi-Cluster

- Cluster count = "maximum concurrency concurrency is dynamic cluster auto-scale". User query concurrent set lock in mult处理 (compute for big cluster).
- Auto-suspend after N min idle → cost savings (cloud money).
- Multi-cluster warehouse ~concurrent heavy BI.

### Auto-Scaling

Load queue ~decide VW instance check; spin up 'added cluster to reduce queue depth'. Max cluster = 10 (default).

### Resource monitors & Budgets

Set monthly credit budget per VW to block runaway cost.

### Data Sharing

- Share data cross accounts with read-only views; zero copy of actual data (point to same micro-partitions). 
- Enables "publisher / subscriber" model; live data sharing 内部 and external.

---

## 四、Query Optimizer (CBO)

### Snowflake 优化器

- Cost-based optimizer (CBO) use statistic on micro-partition (per column distribution, histogram).
- Automatic clustering: see heavy query and create clustering key which 聚簇 微 分区 好 prune; no user DBA 手 index.
- Search space for join order:   stats derived from micro-partitions 让 内存 估算 大数据 join 量 成本。

### Query Acceleration Service

Cloud service external run queries in **Serverless Compute** when VWS are cold or stopped: 5-10s latency fast start.

---

## 五、比较: Snowflake vs BigQuery vs Redshift

| 维度 | Snowflake | BigQuery | Redshift Spectrum |
|------|-----------|----------|-------------------|
| 架构 | shared-data multi-cluster | full serverless distributed Dremel | shared-nothing clustered (RA3 nodes) |
| Storage | cloud object (S3, Blob) | Colossus/GCS (capacity store) | S3 / local SSD for hot data |
| Compute | provisioned VW clusters elastic | serverless **slots** auto-scale  | provisioned cluster nodes (DC2 / RA3) |
| Scaling | virtual warehouse resize (secs) | automatic (serverless) | resize cluster (minutes) |
| Concurrency | Multi-cluster warehouses 分 离 | high concurrency auto | limited by cluster size queue |
| Price model | per-second credit per warehouse | on-demand per query data processed or slot reservation | per node/hour |
| SQL standard | ANSI SQL + extension | SQL:2011 + extensions | PostgreSQL-based |
| Semistructured data | VARIANT column (JSON auto-discovery) | JSON natively | Redshift Spectrum JSON parse |

Snowflake 能 fine-grained 控制 VWS for ETL + BI isolation. BigQuery simpler auto-provision by slots. Redshift 原 形 上 更 针对 closed complex transactions + column 化 tables.

---

## 六、典型使用

### ETL pipeline

```
S3 Event → Snowpipe (continuous ingest) → stage table  → transform via task + streams (CDC inside Snowflake) →  gold table
BI query against gold table via BI tools (Tableau, Looker).
```

### Data Sharing Marketplace

Publisher publish data set (e.g. COVID stats) →  sub-live query across Snowflake accounts.

### ADP Analytics + Machine Learning

Leverage internal SQL, external functions (ML models via  cloud Function URL)。

---

## 七、典型事故

### Snowflake "Zero-Copy Clone Dropped CD 巨 费"

Clone large table (1PB) share micro-partitions; user run heavy transformation on clone but keep clone long-time. Micro-partitions 修改 分 离 copy (CoW) accumulated massive extra storage charge. Fix: drop clone promptly, monitor, use time-limited 批。

### Virtual Warehouse Auto-Suspend off → 🎹 单月 $50K bill

某 team 误 set `AUTO_SUSPEND=0` on 4XL VW. Not used 3 weeks but ran continuous billed = ~$50K extra. Fix: always enable auto-suspend = 60s (default 10 min).

### Snowpipe 输入 burst -> backlog

High continuous file load  via Snowpipe, which  queue 累积 → large delay  up 30 min for data to be visible. Fix: larger warehouse for COPY inline + Snowpipe increased pipe count.

### Multi-Cluster Warehouse Burst not Activated

Concurrency 高, but VW `MAX_CLUSTER_COUNT=1` — cannot auto-scale beyond 1.  Some queries queued 15 sec.  Fix: set `MAX_CLUSTER=5` multi-cluster.

---

## 八、易错清单

1. **AUTO_SUSPEND 必设 (data warehouse 不是 always-on service)**: default 10 min, budget-safe.
2. **Clone 共享 micro-partitions + 改 事 become separation**: 大量 改 增 storage cost.
3. **Time-travel data 超过 retention, fail-safe = still 保障**:  bill retention (0-7 days enterprise). Know GDPR 清除.
4. **Multi-cluster warehouse 必须 配 MAX_CLUSTER_COUNT > 1**: other 定 async with long queue.
5. **Snowpipe ingest latency is 1-3 min**: real-time needs streaming (Kafka + Snowpipe Streaming) 直接.

---

## 九、这一章带走的东西

1. Snowflake = shared-data, 分离 Storage (Object) + Compute (virtual warehouse) + Services 三层.
2. Micro-partitions = PAX 存储 + metadata prune + columnar compression; zero-copy clone / time travel 用 分区。
3. Virtual warehouse: auto-suspend  + 多集群 elastic scale, per-second billing, multi-concurrency 让 BI + ETL 隔离。
4. 核心 trade-off: multi-cluster warehouse = compute 隔离, serverless auto-suspend reducing cost.
5. Semi-structured data native `VARIANT` type (JSON) parse 高效 比 Redshift Spectrum JSON 解析、 BigQuery 原生 JSON.
6. 事故: 忘 关 auto-suspend = 数万美 monthly bill.

---

下一节 → [Kubernetes Control Plane](k8s-control-plane.md)
