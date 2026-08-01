# 第六部分 · 分布式系统

## 一句话

分布式系统 = N 台独立计算机通过通信协作**表现为一个整体**。核心挑战：部分故障 (partial failure)、不可靠网络 (unreliable network)、无共享时钟 (no shared clock)、并发控制 (concurrency)。无数论文在解决同一个问题：**怎么让不同机器对一个值"达成共识"**。

## 思想链

API 高层：用户 `POST /api/order`，看似一个简单 RPC 调用——

```
[ HTTP 请求 ]
    └─ 网络 → 负载均衡 → API gateway (无状态) → Order Service (无状态)
           └─ 强一致状态机 Raft 复制组 (5 节点，多数派持久化)
                  └─ Paxos 协议选出一个 leader
                         └─ 所有写入串行化进 Multi-Paxos 实例
                                └─ WAL 落盘 fsync
                                       └─ 此时才返回 200 OK 给客户端
```

请求每一次成功 commit 都涉及：网络多跳、consensus 算法、持久化、leader election / membership change。这一层是**字面意义决定高可用或永久数据丢失的关键**——李飞飞团队 2017 Spanner 论文证明了 CRDT 不足以做银行账户；Apple WebObjects 2007 事故证明了 Paxos 错误实施可直接让集群锁死 30 小时。理解分布式系统不是"加更多机器让事务变快"，而是"在 partial failure 下证明你的 promise 仍 hold"。

## 5 个章节

- [基础概念](concepts/index.html) — CAP / PACELC / BASE / 一致性等级 / 故障模型
- [共识](consensus/index.html) — Paxos / Multi-Paxos / Raft / ZAB
- [复制](replication/index.html) — 主从 / 多主 / 无主 / CRDT
- [时钟与顺序](clock/index.html) — Logical Clock / Vector Clock / HLC / TrueTime / DAG
- [分布式存储与容错](fault/index.html) — Quorum / Erasure Coding / 调度器

读完应能回答：

1. Paxos vs Raft vs ZAB 的核心差异（leader election、log replication、membership change）
2. Quorum 为什么 W+R>N 是必要而非充分条件
3. CRDT 如何无 conflict merge，与 serializability 的代价
4. Vector clock 怎么检测并发写、HLC 怎么无 GPS 提供 causal consistency
5. Erasure code RS(10,4) vs 3 副本在存储与可用性的折中
6. Google Spanner 用 TrueTime 实现 external consistency 的代价 (commit wait)

## 历史 1：1978 Lamport "Time, Clocks"

奠定整个领域基础——"分布式系统中事件顺序不能靠 wall clock，要靠 happens-before"。Lamport 之后所有 paper 都假设这个 partial order 是基础事实。

## 历史 2：1989 Paxos, 1998 Lamport 拖了 9 年才发

1989 Lamport 发现 Paxos 但写成希腊神话式 paper "The Part-Time Parliament"，没人懂；1998 重写 "Paxos Made Simple" 才被 Google 采纳成 Chubby。Raft 2014 由 Diego Ongaro 在 Stanford 写完为了"比 Paxos 更易懂"。

## 历史 3：AWS Dynamo (2007)

Berkley Amazon Dynamo 论文发表，业界第一个大规模 AP + Vector Clock + Hinted Handoff 的工业系统。Cassandra、Riak、Voldemort 都跟。

## 历史 4：Google Spanner (2012)

第一次工业实现 external consistency —— 靠 GPS / 原子钟 TrueTime API 实现跨数据中心线性化。Sharding + TrueTime + 2PC 让 Google Ads 全球任意节点写入都能 audit。Apple、CockroachDB 都跟 SR 树。

---

下一节 → [基础概念](concepts/index.html)
