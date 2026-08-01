# 存储选型与内部

存储是系统 ground truth —— 决定 throughput、latency、durability、availability、运维成本和大半 capex。**别再"我加个数据库"了**——选 Redis / Postgres / ClickHouse / DynamoDB / Spanner / S3 各自解决什么问题、各自 cap 多大、各自 ops pain 是什么, 是系统设计章节最重要的章节之一。

- [选什么存储](which-store.md) — KV / 关系 / 列存 / 文档 / 时序 / 图 / 搜索 / Object storage / OLAP
- [WAL / LSM / B-tree 内部](wal-lsm-btree.md) — Postgres vs Cassandra vs RocksDB 谁快谁慢
- [Sharding](sharding.md) — hash / range / directory / consistent hashing
