# 第四部分 · 数据库系统

## 一句话

数据库是把"对状态的可恢复变更"这件事以最强形式封装起来的产品——从存储引擎 (B+ tree / LSM) 到查询优化 (RBO/CBO)，从 ACID 隔离 (2PL/MVCC/SSI) 到崩溃恢复 (WAL/ARIES)，从单机 (Postgres/MySQL) 到分布式 (Spanner/CockroachDB)，从 OLTP 到 OLAP 列存 (ClickHouse/Snowflake/DuckDB)。理解数据库 = 理解工程理想与现实约束的对撞。

## 这一部分的结构

### 1. SQL 与关系模型
关系代数是 SQL 的内核，planner 把 SQL 解析为代数表达式再做 rule-based + cost-based 转换。理解 NULL 三值逻辑、CTE decorrelation、window sort/agg、子查询代数变换是阅读 query plan 的前提。

- [关系代数、SQL semantics](relational/relational.md)
- [事务、ACID、隔离级别与现象](relational/isolation.md)
- [MVCC 原理：PostgreSQL vs InnoDB](relational/mvcc.md)
- [WAL / redo / undo / 2PL](relational/wal-2pl.md)

### 2. 索引与存储结构
B+ tree 与 LSM 是两条主流路径：B+ tree 适合读多写少（OLTP），LSM 适合写多读少（time series, ClickHouse-ish SST）。两者都有写放大、读放大、空间放大的折中。

- [B+ 树索引与覆盖索引](indexing/btree.md)
- [LSM-Tree 与 SSTable](indexing/lsm.md)
- [Hash index、GIN、GiST、BRIN](indexing/specialized.md)
- [执行计划：explain analyze 怎么读](indexing/explain.md)

### 3. 日志与崩溃恢复
WAL（redo log）+ undo log 让数据库在崩溃后能 redo 重做已提交、undo 回滚未提交。ARIES 是工业级 WAL 协议设计，被 Postgres/MySQL/SQL Server/Oracle 全部遵守。

- [WAL 协议、ARIES](recovery/aries.md)
- [Checkpoint、Point-in-time 恢复](recovery/checkpoint.md)

### 4. 查询优化
planner 选择 join 顺序、join 算法（hash/merge/nested loop）、向量化执行、列存格式——是数据库"不写代码也跑得快"的核心。

- [基于规则 / 基于代价优化](optimization/rbo-cbo.md)
- [Join 顺序、hash join vs nested loop](optimization/join.md)
- [向量化执行、列存](optimization/vectorized.md)

### 5. OLAP 与现代数据栈
列存 + 向量化执行 + 物化视图 + Lakehouse (Iceberg/Delta/Hudi) 是过去十年数据栈演进总结。

- [ClickHouse / DuckDB / Snowflake 设计](olap/columnar.md)
- [预聚合、物化视图、Cubes](olap/materialized.md)
- [Lakehouse：Iceberg / Delta / Hudi](olap/lakehouse.md)

---

## 读完你应该能回答

- 为什么不能把 MVCC tid 直接当 row id
- InnoDB 与 PostgreSQL MVCC 的 vacuum 性能差异
- LSM Tree 与 B+ Tree 在 update 吞吐与读放大上的权衡
- ARIES 的 redo-only undo 设计到底是为了什么
- 列存为什么对 SIMD + cache 友好
- 为什么 Postgres 不用 MySQL 的 gap lock 防止 phantom (改用 SSI)
- DuckDB 与 Postgres 在 OLAP 100GB 查询上的 100x 性能差来源
- Iceberg 在大数据生态里到底解决了什么——为什么取代 Hive Metastore 是平滑过渡
