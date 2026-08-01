# Hash index、GIN、GiST、BRIN、SP-GiST

## TL;DR

PostgreSQL 默认 B+ tree 之外提供 5 类 specialized secondary index。各适合不同访问模式：Hash O(1) 等值、GIN 倒排、GiST 空间/范围/不平衡、SP-GiST 非平衡树 (radix/quadtree)、BRIN 块范围摘要 (大表顺序列)。本节看完应该知道何时该选 specialized index 替代 B-tree（或反之），以及 PG 14/15/16 的改进。

| 类型 | 适合 |
|------|------|
| Hash | 等值 only |
| B-Tree | 范围 + 等值 + 排序（最常用） |
| GIN | 倒排 JSONB / 全文 / 数组 |
| GiST | 空间 / 范围 quadtree / 重边 (SET) |
| SP-GiST | 非平衡树 (radix / quadtree) |
| BRIN | 块范围摘要 (大表顺序列) |

---

## 一、Hash Index

O(1) 等值索引：
```sql
CREATE INDEX idx_email ON users USING HASH (email);
SELECT * FROM users WHERE email = 'a@b';
SELECT * FROM users WHERE email LIKE 'a%';   -- 不可用
```

PG 10+ Hash 才支持 WAL → crash-safe。可用 Buket Pattern + Overflow Page: bucket ID = hash(key) mod N。

局限：
- 仅等值（no range, no sorting）
- 不能作为 unique constraint (PG 21 内不强制)
- 比 B-tree 在低基数列优势不大

实战：B-tree 通常已够；用 Hash 100% 仅等值且 key 长度大 (+20 byte) 时考虑。

---

## 二、GIN (Generalized Inverted Index)

倒排索引：把"复合列"分解为元素 → 单元素 → posting list (含哪些 row)。
- 数组 `INT[]` / `TEXT[]`
- JSONB 字段
- 全文 `TSVECTOR`

```sql
CREATE INDEX idx_tags ON posts USING GIN (tags);
SELECT * FROM posts WHERE tags @> ARRAY['pg'];
SELECT * FROM posts WHERE tags && ARRAY['pg','mysql'];

CREATE INDEX idx_data ON events USING GIN (jsonb_col);
SELECT * FROM events WHERE jsonb_col->>'action' = 'click';

CREATE INDEX idx_fulltext ON articles USING GIN (to_tsvector('english', body));
SELECT * FROM articles WHERE to_tsvector('english', body) @@ to_tsquery('database & index');
```

### 2.1 GIN 优势
- 查询时间 O(#key) 而非 O(rows)
- 支持 `@>` `<@` `&&` `?` `@?` JSONB 操作
- 全文搜索不依赖外部 Elasticsearch (中小 workload)

### 2.2 GIN 缺陷
- 索引生成慢（每元素加 posting list 操作）
- 索引 update 慢 → 高频写场景用 `fastupdate=on`（pending list 暂存)
- 不支持 UNIQUE constraint
- 空间开销大 (单位 row 量)

`fastupdate = on` (`gin_pending_list_limit = 4MB`)：在 pending list 中累积 update → 后台批量刷。`gin_pending_list_limit` 大收益取决于写压力。

### 2.3 GIN 险, PG 14+
- PG 14 引入 JSONB path expression GIN
- PG 15 引入 multirange column
- PG 16 改进 sort + bitmap scan 与 GIN 整合

---

## 三、GiST (Generalized Search Tree)

允许定义自定义 split 函数 → 可实现不同数据结构：R-tree (空间)、range 类型、 SET (e.g. `ltree`, `seg`, `pg_trgm`).

```sql
-- btree_gist extension: GiST ops for common types
CREATE EXTENSION btree_gist;
CREATE INDEX idx_range ON events USING GiST (ts during tsrange);

-- 全文搜索 trigram
CREATE EXTENSION pg_trgm;
CREATE INDEX idx_name_trgm ON users USING GIN (name gin_trgm_ops);  -- OR GIST
-- pg_trgm GIN ok: "name LIKE '%bob%'"

-- 空间
CREATE INDEX idx_geom ON landmarks USING GIN (geom);  -- or GIN
```

### 3.1 GiST 用例
- 时间范围 (`tsrange`, `daterange`)
- 空间矩形/点 `<->`、`<#>`、`&&` 等
- 不等/相对位置 取代 B+ tree 的 = / > 比较

### 3.2 GiST vs B-tree
| 维度 | GiST | B-tree |
|------|-------|--------|
| 顺序 | 自定义 partition function | 单调 key 比较排序 |
| 优势 | 范围 overlap / 空间 | 等值 / 范围 |
| 性能 | 通常 O(log N) + 维度 overhead | O(log N)，简单、紧凑 |

---

## 四、SP-GiST (Space-Partitioned GiST)

非平衡树根 radix tree / quadtree / trie / kdtree 的实战设计。每节点 partition 函数可以非二分。

```sql
CREATE EXTENSION pg_trgm;  -- uses SP-GiST
CREATE INDEX idx_text_trgm ON articles USING SP-GiST (name gist_trgm_ops);

-- inet / cidr
CREATE INDEX ON bps_logs USING SP-GiST (ip inet_ops);

-- box 2D space
CREATE EXTENSION cube;
CREATE INDEX idx_cube ON records USING SP-GiST (cube field);
```

实战限用：仅当 key 自带刻度 (radix 前缀、坐标 spatial dim) 时唯一。

---

## 五、BRIN (Block Range Index)

每 ~128 个连续 page (1 MB 数据) 存 min/max + null count + count → index size 仅每 (128 × 8KB) ~50 B.

```sql
CREATE INDEX ts_brin ON events USING BRIN (timestamp);
```

### 5.1 BRIN 适用

- 时间列与物理顺序高度相关 → BRIN 极有效
- 大表 (`events`, logs) 顺序写入，旧数据不修改

### 5.2 BRIN 缺陷

- 仅做"block-level"过滤 → 必须扫 candidate blocks
- 等值查询仍可能扫多 block
- 不适合 ossified 插入模式 (e.g. UUID random insertion → 物理不按时间)

实战 100GB log table:
```
B-tree: 200MB index, 比 BRIN 50× 空间
BRIN:    5MB index, 时间 in 顺序文 → 99% block skip
```

### 5.3 BRIN pages_per_range

```sql
CREATE INDEX ts_brin ON events USING BRIN (timestamp)
    WITH (pages_per_range = 64);  -- 64 × 8KB = 512 KB per range
```

调小 (16 pages) 摘要精度高； 调大 (512 pages) 索引更小但 block-skip 概率降。

---

## 六、Postgres 仅 B+ tree 唯一约束 (15+

PG 15 之前 UNIQUE 约束只能用 B-tree。PG 15+ 让 UNIQUE 可被任何 "amcanunique" index 支持 (GiST with `amcanunique` 一部 GiST opclass 例子 (e.g. `range_ops`) 也支持 UNIQUE 重部分)。 

---

## 七、产线事故

### 7.1 Hash index 在 PG 9 是 silent crash unsafe
9 以前的版本，Hash index 坏不收→ 应改 B-tree。12+ 之后稳定。

### 7.2 GIN fastupdate update 异常慢
某业务 1000 行 / 测入 GIN (tags) → 平均慢 50ms。fixed by `gin_pending_list_limit = 32MB` + `autovacuum_vacuum_scale_factor = 0.02` 让 autovacuum 自动清 pending list 步调一致。

### 7.3 BRIN 时间不单调

旧业务 random update `events`，BRIN 时间 index 大多 blocks 都 min/max 全覆盖 → 全表扫描 hit 率 100%。 discovered bug 用 `BRIN (id)` 改用 B-tree。

### 7.4 GiST 范围 bloat

业务 tsrange all in 1 small segments 表 deite phenomen stats; GiST 1000 sub-block partial clustered large 因为 reorder by extend update 多越来越稀 → REINDEX needed every weekend.

### 7.5 SP-GiST trigram mismatch
业务用 SP-GiST (name gist_trgm_ops) 但 GIN trigram 真正更适 LIKE 全 第% 检…，后者 FTS-ùtrgram 更佳。

---

## 八、易错清单

1. Hash index 不能 UNIQUE constraint
2. GIN update 慢 — 必带 `fastupdate=on`
3. GiST ≠ 必适空间；OS 顺序 also 适 GiST 更慢 范围
4. BRIN 仅在时间与物理空间 高度相关时有用
5. SP-GiST 不默认支持 range / 全文 — 需 extension
6. trigram LIKE 查询 GIN > GiST; trigram stemmer 等 = 倒排索引模式

---

## 九、这一章带走的东西

1. PostgreSQL 6 类索引各有 access pattern 专长; B-tree 是默认且 50/50 各场景
2. Hash 只适合等值 + 已 长 enough → 95% 业务仍用 B-tree
3. GIN 倒排 → array / JSONB / 全文 在 DB 内可免除 Elasticsearch
4. GiST 范围 + 空间 / ltree 多专用; 索引 bloat 修 REINDEX
5. BRIN 极窄场景（时间物理高度相关）但小到 ~5MB，可表 100GB
6. SP-GiST 主要用于 radix tree + spatial quadtree (IP-prefix/网络) 仅 stationary cases tup-compoundable
7. PG 15+ UNIQUE 支持 non-B-tree — 让 ratio trange 做 unique possible

## 下一节 →

[执行计划：EXPLAIN ANALYZE 怎么读](explain.md) — PostgreSQL / MySQL 计划字段语义、Buffers/Planning Time/loops/time 均值
