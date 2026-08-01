# 时钟与顺序

时钟与顺序是分布式系统的走廊——"在分布式系统中, you cannot totally order events without coordinating" 是 Lamport 1978 的奠基论断。 多节点无 wall clock 同步, 还能**怎么知道谁先, 谁后, 谁并发**？ 三大轴心:

1. **逻辑时钟 (Lamport Clock)**: 单调自增 + 消息捎带, 给 events 一个 transitive partial order。Lamport 1978。
2. **向量时钟 (Vector Clock, Mattern 1989 / Fidge 1988)**: N 维 count array 在节点间传播, 精确检测 concurrency vs causal order。
3. **混合时钟 (HLC, Kulkarni 2014) + 物理时钟 (TrueTime, Spanner 2012)**: 给"事件"带上 wall-clock-approximate 时间, 同时保持因果序。 CockroachDB / YugaByte / TiDB 用 HLC; Google Spanner 用 GPS+原子钟提供 TrueTime。

DAG (有向无环图) 是顺序的另一种一般化: git commit / blockchain / IPFS DAG / Bitcoin block chain 都隐含 partial order, 用 hash chaining + tip selection 算法给出 consensus view.

- [逻辑时钟、向量时钟、HLC](logical.md)
- [TrueTime / HLC / attestation](physical.md)
- [DAG、git、blockchain 的序](dag.md)
