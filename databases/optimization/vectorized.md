# 向量化执行、列存

## TL;DR

行存到列存是 from row-major 到 column-major 的存储与执行范式转变。列存让分析查询只加载相关列，减少内存带宽浪费；向量化执行让 CPU 每条指令处理一批数据，发挥 SIMD 潜力。ClickHouse / DuckDB / Snowflake 都靠这两点实现 100-1000× OLAP 性能。本节走完列存字节布局、向量化 vs 火山算子的根本区别、SIMD 与 cache locality、PG 12+ 列存储 SQL、ClickHouse 的 vectorized engine 源码路径。

---

## 一、行存 vs 列存

### 1.1 物理布局

```
行存 (Postgres / MySQL):
┌────────────────────────────────────────┐
│ (id=1, name='Alice', age=25)           │
│ (id=2, name='Bob', age=30)             │
│ (id=3, name='Carol', age=22)           │
└────────────────────────────────────────┘

列存 (ClickHouse / DuckDB):
┌────────┬────────────┬──────────┐
│ id: [1, 2, 3]                      │
│ name: ['Alice', 'Bob', 'Carol']    │
│ age:  [25, 30, 22]                 │
└────────────────────────────────────┘
```

### 1.2 优势

| 维度 | 行存 | 列存 |
|------|------|------|
| 单行 INSERT | 快 (page append) | 慢 (多列 page 修改) |
| 单行 SELECT | 快 (1 page) | 慢 (多列多 page) |
| 聚合全表 (1-2 列) | 慢 (扫不必要的列) | 快 (仅扫描需要的列) |
| SIMD 加速 | 难 (row layout 缓行) | 强 |
| 压缩率 | 一般 (列内重复少) | 高 (列内同类型) |

OLTP 业务通常需要行存（指 OLTP 操作 单行/少量行 多）；OLAP 业务（聚合、扫全表）用列存。

### 1.3 双 hybrid (HTAP)

- Oracle In-Memory Column Store：在内存中维护列存镜像
- SQL Server Columnstore Index：表 + 单独 columnar index
- MySQL HeatWave：在 MySQL 上加 column store cluster

---

## 二、向量化执行 vs 火山模型

### 2.1 火山模型（行处理 Iterator）

每个算子有 `next()` 接口，逐行产出：

```python
class FilterOp:
    def __init__(self, child, predicate):
        self.child = child
        self.predicate = predicate
    
    def next(self):
        while True:
            row = self.child.next()
            if row is None: return None  # DONE
            if self.predicate(row): return row

class Scan:
    def next(self):
        # 读一行 yield
        return next_row_from_disk
```

特点：每行 next() 调用 1 次 → vtable + func call overhead per row → 大表 multi 亿行 cost is *enormous*.

PG / MySQL InnoDB executor 默认走火山模型。

### 2.2 向量化模型（批处理 Iterator）

每算子 yield 一批 batch (e.g. 2048 行)：

```python
class VectorizedFilterOp:
    def __init__(self, child, predicate):
        self.child = child
        self.predicate = predicate

    def next(self) -> Vector:
        while True:
            batch = self.child.next()  # Vector of 2048 rows
            if batch is None: return None
            mask = self.predicate.evaluate(batch)  # SIMD 比较
            if mask.any():
                return batch.select(mask)
```

batch size 通常 1024-8192 行 → vtable 调用开销摊薄 1000×。

### 2.3 性能差来源

| 维度 | 火山 | 向量化 |
|------|------|--------|
| Iterator overhead | per row 7-10 ns | per batch 50 ns / batch_size |
| SIMD | inefficient (one elt) | full SIMD |
| Cache | prefetch low | cache blocking |
| Branch prediction | bad (per if) | good (vector mask) |
| Compiler vectorization | no | yes |

实测同等硬件上 vectorized 比 volcano 10-100×。

---

## 三、SIMD + 列存合体

### 3.1 SIMD 例子

```c
// 8 32-bit 比较 (AVX2)
__m256i v1 = _mm256_loadu_si256(&col_a[i]);
__m256i v2 = _mm256_set1_epi32(18);
__m256i mask = _mm256_cmpgt_epi32(v1, v2);  // 1 if a[i] > 18
_mm256_maskstore_ps(&result[i], mask, output);
```

AVX2 = 256 bit = 8 × int32 / float32 / char × 32
AVX-512 = 512 bit = 16 × int32

### 3.2 Processor 计算 throughput

- CPU 总指令 / 秒：2 GHz × issue width (4-8 → 8-16 IPC) → 约 10-50 GIPS
- 内存 bandwidth：DDR4-3200 = 25 GB/s, DDR5-6400 = 50 GB/s
- L1 / L2 / L3 cache hit：1 / 5 / 30 cycle

→ hotspot 必 fit L2 cache 才能压满 CPU。

### 3.3 列压缩

```c
struct ColumnData:
    type: enum (INT32, FLOAT64, STRING, BOOL)
    encoding: enum (RAW, DICT, RLE, DELTA_BYTE, FOR, BITPACKED)
    values: bytes

# e.g. boolean → 1 bit/row (vs 1 byte row store)
# 字典编码 string 列 → uint32 (0-65535 distinct string) → 4 bytes/row
# delta 编码 timestamp → varint 1-2 bytes/row (vs 8 bytes)
```

实测压缩比：
- ints：1.5-2×
- 字符串 (dict)：5-20×
- 时间戳 (delta)：5-10×

---

## 四、ClickHouse Vectorized engine

架构：
```
Block (columnar batch) = head + MemArena-allocated columns
AggregatingOp:
    for block in input:
        for col in block.cols:
            aggregate(col)  # SIMD
    emit finalize
```

特点：
- batch aggregation (8k rows/block)
- partial aggregation + later merge
- group-by key 用 stored hash table (复杂 key)
- 没有事务 overhead，纯 OLAP

列存 + SIMD + 高压缩 → 1000× OLAP 比 PG row-based。

### 4.1 实测 SQL

```sql
SELECT user_region, sum(amount)
FROM ad_events
WHERE event_date BETWEEN '2024-01-01' AND '2024-10-01'
GROUP BY user_region;
```

实测 1 PB 数据 query：
- PG row-store：10 hours
- ClickHouse：30 秒

差 = cache locality + SIMD + aggregation vectorized + 列裁剪 + skip idx。

---

## 五、DuckDB / Snowflake 设计差异

### 5.1 DuckDB

- in-process OLAP DB（嵌入式，无需 server）
- vectorized engine (1024-row batches)
- morsel-driven parallelism
- columnar storage with light compression
- 适配 in-Python / R / 流水

### 5.2 Snowflake

- cloud-native OLAP
- 微 partitions (16MB) + columnar
- vectorized engine 类似 ClickHouse
- 缓存多 layer (local SSD + cloud object store)

### 5.3 PG + columnar (cstore / Citus columnar)

早期 `cstore_fdw` 1.0 columnar 但向量化不足量 → PG 性能仍 10× 慢 ClickHouse。Citus columnar (PG 13+) 更好但没真 vectorized engine。

---

## 六、产线事故

### 6.1 100GB stats 表 PG vs ClickHouse 100× 差

E-commerce analytics 100 GB sales 表，PG 跑 group-by query 5 分钟；迁 ClickHouse 30 秒。

**结论**：OLAP workload PG 不应首选；ClickHouse / DuckDB 远胜。

### 6.2 PG Citus columnar 插入瓶颈

业务 INSERT 100k/秒 亡 Citus columnar，因为列存 INSERT 多列 page modify。

**修复**：OLTP 列 → 行存表 + ETL 流式 转列存表 → 冷 到最近 24h 列存表。

### 6.3 Snowflake 按 query byte rate fairness

业务大 query 跑 1h 占 warehouse 全 slots → 小 query SLA 漂。

**修复**：业务 query suspend 多阶段：结果集块 → business cache 行  / 按 user isolation 多 warehouse。

### 6.4 ClickHouse 单 server 内存爆

GROUP BY key 基数 极高 → hash table 50 GB > RAM → killed。

**修复**：调 `max_memory_usage` + `max_bytes_before_external_group_by`；业务降 基数 (e.g. bucket by day)

### 6.5 DuckDB serverless crash

某 notebook 跑 64 GB DuckDB query，OOM 杀。

**修复**：`PRAGMA memory_limit='2GB';` 配 swap file 容忍 spill。

---

## 七、易错清单

1. **列存 INSERT 慢**：OLTP 不可全列存（行存+列存 hybrid）
2. **PG 行存对 OLAP 极劣**：100 GB query 5 min 不奇怪
3. **ClickHouse 没有 things deleted deletes right away**：等 mutations 后台
4. **Snowflake cost** by query byte scanned 是主; 按 query 日 firma feel 福利
5. **DuckDB 内嵌可分** in server；但是 site 后 vs OLAP cloud 压不齐
6. **Simd verifier** Vectorize 不-catching DB int handle complex types/variants 性能 ≠ magic
7. **Aggregation BASE UNNECESSARY COL**：必 SELECT 多 → really narrow cols → 好优
8. **Cache-local 必块状**：batch 全批 ካ must be cacheable in L2 → 才有 SIMD benefit

---

## 八、这一章带走的东西

1. 行存适合 OLTP；列存适合 OLAP；HTAP 表 (Oracle IM/MemSQL/MySQL HeatWave) 双幅存
2. 火山模型每行 next() → 高 overhead；向量化模型每 batch (1024-8192) overhead摊薄 1000×
3. SIMD AVX2 = 8 int32 一指令；AVX-512 = 16 int32 → 16× 单 issue IPC
4. 列压缩 dict/run-length/delta/bitpack；时间戳 5-10× 压缩；字符串 5-20×
5. ClickHouse vectorized + 列裁剪 + 聚合 SIMD → 1000× 比 PG row-based
6. DuckDB in-process 性能仍 stroke 10-100× vs PG on OLAP
7. Citus columnar 适合大表 ANALYTICAL pruning + 跳行 + 部分向量化，但 not full vectorized
8. Hotspots 必 fit L2/L3 cache 才能压满 SIMD IPC

## 下一节 →

[OLAP 与现代数据栈](../olap/index.html) — ClickHouse / DuckDB / Snowflake 设计
