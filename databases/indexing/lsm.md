# LSM-Tree 与 SSTable

## TL;DR

LSM-Tree (O'Neil 1996) 把随机写转换成 sequential write，让写入吞吐比 B+ tree 高 10-50×。代价是读放大（多 level lookup）+ compaction 抢 I/O。LevelDB / RocksDB / Cassandra / HBase / CockroachDB / TiKV 都基于 LSM。本节走完 Memtable → SST L0 → L1 → ... Ln 的数据流、compaction 算法 (size-tiered / level / FIFO / TWCS)、WAF/RAF 公式、bloom filter、block cache、WiscKey KV-separation、RocksDB 配置实战、compaction storm 事故现场。

---

## 一、LSM 与 B+ tree 对比

| 维度 | B+ tree | LSM-Tree |
|------|---------|----------|
| 写入 | 随机 I/O：找 page + modify | 顺序 I/O：append WAL + memtable |
| 读出 | 1 I/O（命中索引） | 多次 I/O（memtable + 各 level）+ bloom filter |
| 放大 | 几乎无 | WAF & RAF 与 level 有关 |
| Compaction | 不需要 | 必须，否则 RAF 爆 |
| 空间 | 紧凑 | 临时 2x 实施 compaction |
| 适用 | OLTP 读多 | 写多 (logs / time series / event stream) |

---

## 二、数据流

```
Write (key=k, value=v):
   ↓
   append to WAL (顺序写 disk)
   ↓
   insert into MemTable (in-memory sorted: skiplist / red-black tree)
   ↓
(+ async) MemTable 满后 → flush to L0 SST (顺序写 disk)
   ↓
L0 SST 文件可重叠 (键可重复)
L0 → L1 compaction → L1 SST 不重叠
L1 → L2 → ... → Ln
```

删除 = tombstone 记录（仍走 WAL+Memtable+SST）；读取时合并查找最新版本。

---

## 三、Compaction 算法

### 3.1 Size-tiered (STCS) — Cassandra 默认

每 level 4 个 SST；4 个满 → merge 进下一 level 4 个更大 SST。

特点：
- WAF 小（不重 compaction）
- RAF 大（每 level 4 文件并列）
- 空间放大最大（合并期临时 2x）
- 适合**单纯写多** workload (log-only)

### 3.2 Leveled (LCS) — RocksDB 默认

- L0 = 几个文件允许重叠
- L1+ 大小 10x 递增（L1 10MB、L2 100MB...）
- Lk 满触发 → 1 SST 与下一 level overlap SST 合并
- L1+ 任何 key 在该 level 只出现一次

特点：
- RAF 最小（每 level 仅 1 文件命中 key）
- WAF 大（多次 compaction）
- 空间局限固定 ~10% overhead
- 适合**读重视点**

### 3.3 Time-window (TWCS)

Cassandra 3.8+。每时间窗口（如 1 小时）合 1 SST，相互不合并。
- 适合事件流 / 时序数据
- 老 timestamp 不被 OVERWRITE → 不浪费 I/O

### 3.4 FIFO
HBase 2.0+ 用。仅按时间过期，不合并。适合 cache-like workload。

### 3.5 Hybrid — RocksDB Universal

RocksDB: L0 size-tiered, L1+ leveled:

```cpp
opts.compaction_style = rocksdb::kCompactionStyleUniversal;

opts.compaction_options_universal.size_ratio = 1;
opts.compaction_options_universal.min_merge_width = 4;
opts.compaction_options_universal.max_size_amplification_percent = 200;
```

---

## 四、WAF & RAF 公式

定义：
- WAF = (总写入字节数 / user 写入字节数)
- RAF = (读一个 key 时触发的磁盘 I/O 次数)

### 4.1 Leveled WAF

```
WAF ≈ L × 2
  L = level 数 = ceil(log_10 (总数据 / max_bytes_L1_base))
示例 100GB, L1 base = 10 MB:
  L = log_10(100GB / 10MB) = log_10(10240) ≈ 4
  WAF = 4 × 2 = 8
```

每 byte user-write → 8 byte 写 disk。

### 4.2 Size-tiered WAF

```
WAF ≈ T  (=size ratio, typically 4)
```

### 4.3 RAF

```
RAF = L0 文件数 (4) + (L - 1) levels
Leveled: L=4 → RAF = 7
Bloom filter 命中后 RAF ≈ 1
```

Bloom filter 让大多数 lookup 不需读 SST 文件 → RAF 逼近 1。

---

## 五、Bloom Filter

LSM 每个 SST 文件另附 bloom filter：
- 插入 key k → 在 m-bit bloom array set hash_1(k), ..., hash_n(k)
- 查询 k → 计算所有 hash；若全 set 才可能 present；否则 100% absent

参数：
- m/n = 10 bits/key → FPR ~1%
- m/n = 7 bits/key → FPR ~5%

100万 key → ~1MB filter 全 cache 可行，命中后跳 disk I/O。

RocksDB `bloom_bits_per_key = 10` 默认。

---

## 六、SSTable 字节布局

RocksDB SST:
```
+---------------------+
| Data Block          |  ← (key, value) pairs sorted, compressed
+---------------------+
| Meta Block (filters)|
+---------------------+
| Meta Index Block    |
+---------------------+
| Index Block         |  ← B+ tree locate: key range per data block
+---------------------+
| Footer (magic 8B)   |
+---------------------+
```

Data block 4KB (default), key sorted, prefix compression + Snappy / LZ4 / ZSTD compression。

Block cache LRU 8-64GB + OS page cache 2x backup。

---

## 七、KV-separation (WiscKey)

传统 LSM：key + value 都同表，compaction 把大 value 重 copy 大量字节 → WAF 巨大。

WiscKey 思路：分离 key index 与 value store。
- LSM 只存 (key, value pointer)
- value 在独立 value-log

→ LSM 极小（~30B per entry vs 100KB value），compaction 不动大 value，WAF 降数倍。

PingCAP TiKV 用 RocksDB，但 MVCC 让 key 大。生产做法：
- 大 value：external object storage (S3)，DB 仅存 metadata
- 小 value：RocksDB 原生

---

## 八、RocksDB 配置实战

```cpp
rocksdb::Options opts;
opts.create_if_missing = true;
opts.write_buffer_size = 64 * 1024 * 1024;       // 64MB per memtable
opts.max_write_buffer_number = 3;
opts.max_background_flushes = 4;
opts.max_background_compactions = 8;

opts.level0_file_num_compaction_trigger = 4;
opts.level0_slowdown_writes_trigger = 20;
opts.level0_stop_writes_trigger = 36;
opts.target_file_size_base = 64 * 1024 * 1024;   // 64MB SST
opts.max_bytes_for_level_base = 256 * 1024 * 1024;
opts.max_bytes_for_level_multiplier = 10;

rocksdb::BlockBasedTableOptions tb;
tb.block_size = 4 * 1024;
tb.cache_index_and_filter_blocks = true;
tb.pin_l0_filter_and_index_blocks_in_cache = true;
tb.filter_policy.reset(rocksdb::NewBloomFilterPolicy(10, false));
tb.block_cache = rocksdb::NewLRUCache(8LL * 1024 * 1024 * 1024);  // 8GB
opts.table_factory.reset(NewBlockBasedTableFactory(tb));

opts.compression = rocksdb::kLZ4Compression;
opts.compression_per_level = {
    rocksdb::kNoCompression,    // L0
    rocksdb::kLZ4Compression,  // L1
    rocksdb::kLZ4Compression,  // L2
    rocksdb::kZSTDCompression,  // L3+
};
```

---

## 九、产线事故

### 9.1 RocksDB compaction 跑死

某服务 100GB RocksDB，max_background_compactions=2，L0 file 堆 1000 → 写入 stop (level0_stop_writes_trigger=36)。

**修复**：8 background compaction thread + SSD。让 L0 compaction 跟上 ingest rate。

### 9.2 读长尾放大 50ms

Cassandra p99 从 5ms 升到 50ms。

**修复**：STCS → LeveledCS；bloom bits_fp_per_key 12。

### 9.3 Compaction 临时 2x disk

某 RocksDB 8 月数据增到 800GB，compaction 临时 footprint 1.6TB > SSD 1TB → 写报错。

**修复**：Universal Compaction `max_size_amplification_percent=25`；加 SSD 到 2TB；老数据冷备移 S3。

### 9.4 HBase compaction storm

HBase region server 多 region compaction 同时跑 → IOPS 占满、CPU 100%。

**修复**：限制 `hbase.regionserver.thread.compaction.small = 1, large = 1` + `hbase.hstore.compaction.max = 3`。

### 9.5 bloom bits 太小

RocksDB 1 bit/key → 误命中率 30% → RAF 接近 5 → p99 200ms。

**修复**：bump bits_fp_per_key 到 12，p99 跌回 30ms。

---

## 十、易错清单

1. **WAF + RAF 是 tradeoff**: size-tiered WAF 小 RAF 大; level 反之
2. **Bloom filter bits < 7** 误命中率 > 10% 必踩
3. **删除不是真删除** —— 必走 tombstone，等 compaction 真清
4. **level0_file_num_compaction_trigger** 太大 → L0 堆 → RAF 增大
5. **Compaction thread** 数必须匹配 N 路盘 + CPU
6. **WiscKey**: 大 value 走 KV-separation 避免 LSM 大
7. **RocksDB compaction_style = kCompactionStyleLevel** 不是 LMS 压缩 default

---

## 十一、这一章带走的东西

1. LSM 把随机写转 sequential write，10-50× 比 B+ tree 写吞吐高
2. WAF vs RAF tradeoff：size-tiered WAF 小 RAF 大；leveled 反之；TWCS 适 event stream
3. Bloom filter 让 RAF 接近 1（典型 10 bits/key, FPR 1%）
4. compaction thread 与磁盘、CPU 必须匹配，否则 stop writes
5. WiscKey KV-separation 解决"大 value 引 LSM compaction 大"
6. 大 value 应去 external object storage，DB 仅存 metadata pointer
7. production 监控 RocksDB STAT (`rocksdb.ldb.compaction_pending` / `level0_file_count`)

## 下一节 →

[Hash index、GIN、GiST、BRIN](specialized.md) — 多次查询需要选择 specialized index 的关键 case
