# 基础概念

基础概念部分铺分布式术语：CAP / PACELC 定理告诉你**什么是不可能的**；一致性等级 (Linearizability / Sequential / Causal / Eventual) 告诉你**可以选择什么强度**；故障模型 (Crash-stop / Crash-recovery / Omission / Byzantine) 告诉你**算法在什么假设下成立**。读完这部分，后续 Paxos/Raft/CRDT 的设计就**变成必然**——它们的取舍都能在这些坐标里被讲清。

- [CAP / PACELC / BASE](cap.md)
- [一致性、线性化与序](ordering.md)
- [故障检测、failure models](failure.md)
