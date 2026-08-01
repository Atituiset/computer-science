# 复制 (Replication)

复制是分布式系统的"心脏"——把一份数据放 N 副本, 让 N 节点都持有"看似同一份数据"。复制的三大 axis:

1. **拓扑**: 单主 (primary-backup, leader-follower) / 多主 (multi-master) / 无主 (leaderless)
2. **持久性 vs 可用性**: N、同步 vs 异步、quorum 大小
3. **冲突解决**: 更新顺序、last-writer-wins、向量时钟 + merge、CRDT

工业实现:

- **单主** = MySQL replication、PostgreSQL streaming replica、Kafka partition、etcd raft。
- **多主** = CouchDB、DynamoDB Global Table、Cassandra multi-DC、MySQL grouping row。
- **无主** = Dynamo,Cassandra, Riak, Voldemort(Sticky optional LWW)。
- **CRDT** = Riak (counters, sets), Redis (CRDT data types), Automerge, Yjs 文档协同。

- [主从 / 多主 / 无主复制](topologies.md)
- [CRDT：无冲突数据类型](crdt.md)
- [读修复 / 反熵 / hinted handoff](repair.md)
