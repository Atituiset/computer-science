# Lakehouse：Iceberg / Delta / Hudi

## TL;DR

Lakehouse = ACID transactions + open storage format + query engine optionality. 取代之前 Hadoop HDFS + Hive metastore 架构。三个主流格式: **Iceberg** (Netflix)、**Delta Lake** (Databricks)、**Hudi** (Uber)。本节走完三者入库的 metadata 层差异、time travel、Z-order、partition evolution、merge-on-read vs copy-on-write 的权衡、生产迁移案例。

---

## 一、Lakehouse 是什么

旧有的大数据 stack（Hadoop+Hive+HDFS）有两大痛点：
1. **没有 ACID** → ingest + query 同时不可保证 snapshot
2. **Hive metastore 锁住** → engine lock-in

Lakehouse 设计点：
- 底层：cloud object store (S3/ADLS/GCS)
- 上层：open table format (Iceberg / Delta / Hudi metadata)
- Query engine：Spark, Trino, Flink, Snowflake 等都 read 同一 table

---

## 二、Iceberg (Netflix 2017, Apache 2020)

### 2.1 Metadata 层

```
table/metadata/v3.metadata.json (snapshot)
table/data/00001-file-abc.parquet
table/data/00002-file-def.parquet

v3.metadata.json:
    - current-snapshot: s2
    - snapshots: s0 / s1 / s2
    - snapshots[s2]: 
        - manifest-list: manifest-xxx.avro
        - manifests[0]: list of data files
        - data file: path + stats (record_count, min/max per col)
```

- 每次 commit 新 metadata.json
- version history tiden fasta → time travel 基础

### 2.2 Snapshot isolation

- 不修改 file，每 commit 加一行新文件 + manifest
- query 走 manifest + select 当前 snapshot 看到的 file → snapshot 一致
- writer 不锁 reader

### 2.3 Partition Evolution

旧 Hive partition schema 隐式有 -> data 目录路径 (`/dt=2024-01-01/`)
- 改 partition schema 必重写历史 → 灾难

Iceberg partition 是 hidden：
- partition spec 写 metadata
- 改 spec → 新 commit → 后 只新 file 用新 spec
- old file 仍走老 spec
- query 引擎同时读多 spec → hidden partitioning

### 2.4 Z-Ordering

```sql
ALTER TABLE events REORDER BY zorder(user_id, region_id);
```

Iceberg v2+ 支持 Z-order multi-column。Z-curve 让多维 locality 集中在相同 data file，query 时多 group by 列 min/max skip 大。

### 2.5 Iceberg 流式 streaming

```java
DataStream.of(...)
    .write(new IcebergSink(events_table, new StreamingWriteOptions()));
```

支持 per-micro-batch commit；Flink / Spark streaming embedded。

---

## 三、Delta Lake (Databricks 2017, OSS 2019)

### 3.1 Metadata

```
_delta_log/00000000000000000000.json
_delta_log/00000000000000000001.json
...
```

每 commit 一个 JSON:
```json
{
  "add": {"path": "part-abc.parquet", ...},
  "remove": {"path": "part-def.parquet", ...},
  "metaData": {...}
}
```

checkpoint JSON 每 N commit 压成 parquet 加速 large。

### 3.2 特点

- 进入 Databricks ecosystem 主
- ACID + MERGE / UPDATE / DELETE 的 first class
- 比 Iceberg 稍slow metadata read (每 commit JSON，没 manifest)
- Time travel 传统 `SELECT * FROM table VERSION AS OF 12`
- 也可 PySpark read + write 非 Databricks cluster

### 3.3 优势

- Databricks 版有 Optimize + ZOrder 命令一键 ops
- 启 `<schedule OPTIMIZE>` 后台 merge 小 file 大
- `VACUUM` 旧文件回收

### 3.4 open sourcing

Delta OSS (Delta 0.x) 与 Databricks Runtime 版本分；
社区 patched Iceberg 加 cross-compatible Delta-Iceberg connector。

---

## 四、Apache Hudi (Uber 2017, OSS 2018)

### 4.1 设计目标

Hudi 来自 Uber 业务：每秒 1 mil taxi trip ingest + update（CRUD），需要 亚 second consistency snapshot. 答案：upsert 大量 raw key + 状态 metadata.

### 4.2 两种 mode

**Copy-on-Write (CoW)**:
- 每写更新 re-write 包含该 key 的 file
- 适合 read-only 小的 update freq

**Merge-on-Read (MoR)**:
- update 进 row log file 合并 read 时 merge
- 写吞吐高，read 有 merge overhead
- 适合 high-ingest + 后台 async merge

### 4.3 metadata

```
.hoodie/timeline/commit_<ts>.deltas / log file refs

> key -> record info
> Ingest-time 状态 / partitioner / Merge
```

sources：Hudi 0.10+ 可建成 integration Iceberg metadata compatibility (Iceberg-Hudi (one project))。

---

## 五、三者对比

| 维度 | Iceberg | Delta Lake | Hudi |
|------|---------|-------------|------|
| 起源 | Netflix | Databricks | Uber |
| metadata | manifest + avro | JSON log | timeline |
| Streaming | Flink / Spark Sql | native Databricks | whim primary use |
| Z-order | ✅ table | ✅ OPTIMIZE ZORDER | insert partition layout |
| Update | ✅ COPY-then-rewrite | ✅ MERGE INTO | ✅ CoW / MoR |
| Time travel | ✅ AS OF | ✅ VERSION AS OF | ✅ Time-travel |
| Engine lock | open | open (OSS + ver) | open |
| 大规模更新 | 有改造 | 最稳自 |
| 实时 ingest | streaming Flink native  | streaming Databricks 优 | 最舒适  Streaming |

---

## 六、产线案例

### 6.1 Iceberg 1PB 评个大 query
Presto / Trino 查 PB Iceberg：metadata 在 manifest 一边 → query 中 filter min/max 绝 most skip + collection aggregate。
1 PB Iceberg query：30 sec metadata + ~5 sec per scan region。

### 6.2 Delta OPTIMIZE ZORDER 后 30x quicker
业务 Spark 500TB 表 GROUP BY (col1, col2, col3) 100 keys，delta optimize ZORDER 后 skip ratio 90% 从 10% → query 100 sec 跌 3 sec.

### 6.3 Hudi MoR high ingest + slow read
Taxi trip 50k/s 写 Hudi MoR，read 5 min lag。但 daily ingestion compaction saga 没跑 → file 数 bolting → read slow 乘 10x.

**修复**：autoclean 配 sync compaction jobs，每 hour compaction。

### 6.4 Hive metastore 迁 Iceberg
业务千表 Hive metastore 数 + hadoop 长期 scare → migrate。

**修复**：用 `migrate_table` 采 `spark.catalog.sanityCheck` 与 `migrate_hive_table` 路径 → 1 week 工立迁 → table metadata Iceberg 替代 hive metastore → 不影响 query。

### 6.5 Delta 1B small file problem
业务每分钟 INSERT small file, 30 天 → 30k+ files under partition 目录。Spark scan 起 metadata overhead 5 SEC. 

**修复**：启 `OPTIMIZE` 定期跑 + `AUTO COMPACT`; 后设置 `targetFileSize` = 256MB。

---

## 七、易错清单

1. **Iceberg partition evolution** 改后 old files 仍按老 spec，必 query engine 兼容多 spec
2. **Delta versions** JSON 1 0 commit json `+` 仅在 delta-log；checkpoint 帮助中 in query 过 metadata best load
3. **Hudi MoR** async compaction scheduled ring - 加 search log compaction not 裡 Slat. 
4. **Cross-engine compat **: e.g. Snowflake Iceberg support (早期) read only, write 需 Spark+  
5. **ZORDER 非对 single col** query 用户 hit 用 5 col 同时快； 单 用 col 不如 sortedtable)
6. **Lakehouse not Lake+wheart** 非 hadoop lake — 是 ACID 加 复 jedno 非 即用

---

## 八、这一章带走的东西

1. Lakehouse = cloud storage + open table format metadata + engine optionality
2. Iceberg = manifest tree + hidden partition + Z-order; Netflix/Apple 等大批 adopt
3. Delta Lake = JSON log + Databricks 适配; Spark 主用
4. Hudi = MoR/CoW + streaming primary; Uber 设计
5. Optimize ZORDER 极大增益 multi-col GROUP BY/BY WHERE  query
6. Migration from Hive Metastore 到 Iceberg 通常 1 周, 业务影响 | Δ critical gate
7. Snowflake + BigQuery 都有 Native Iceberg Support; 跨 engine 阅读 Lambda OLAP 没有 lock-in project

## 下一部分 →

[第五部分 · 编译原理](../../compilers/index.html) — 从 lexer→parser→sema→opt→codegen 一线 pipeline
