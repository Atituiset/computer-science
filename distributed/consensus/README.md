# 共识

共识 (Consensus) 是分布式系统的"原子核" — **让 N 个节点对一个值/序列达成一致 (agreement), 并且该相同决定 forever 不变 (validity / integrity / non-triviality), 同时保证非故障节点 eventually 决定 (termination)**.

围绕 consensus 形式化的工程算法三巨:

- **Paxos / Multi-Paxos**: Lamport 1989/1998, 是分布式共识数学上最通用语言。 难读, Google Chubby 把它跑生产实现。
- **Raft**: Ongaro-Ousterhout 2014, 同 crash-stop model 但 leader-log 形式 simple.
- **ZAB**: Yahoo! ZAB (ZooKeeper), "Atomic Broadcast" 是 total-order broadcast consensus.

其他实践中:

- **HotStuff** (VMware 2018): BFT-friendly pipeline blocks, 现代区块链一派 core.
- **EPaxOS**: leaderless, 通信 O(N) — 实际依赖 conflict-graph dependency。
- **PBFT**: 经典 BFT consensus。

- [Paxos / Multi-Paxos](paxos.md)
- [Raft 详解](raft.md)
- [ZooKeeper / etcd / Linearizability](linearizability.md)
