# 故障检测、failure models

## TL;DR

分布式算法建立在**故障模型 (failure model)** 假设上——节点会怎么死、网络会怎么丢。**核心区分**:
- **Crash-stop**: 死了永远不回来。Paxos 经典模型。
- **Crash-recovery**: 死后能重启但是稳定存储 OK, Scribe / GFS master replication 用这个。
- **Omission**: 消息可能丢, 但节点本身能"接收其他节点" (重新传达)——网络层故障。
- **Byzantine**: 节点可任意行为 (撒谎、串改、应该发 5 但发 9), 需 Byzantine Fault Tolerance (BFT) 算法。

不存在能容忍"所有故障、又有 5 个 9 可用"的算法——这是不可能的。设计分布式系统从**选 failure model** 开始——决定后面用什么算法。本章梳理各 model、failure detector、heartbeat、phi-accrual 算法、asynchronous vs synchronous 网络的根本限制。

---

## 一、Failure Models

### Crash-stop (Fail-stop)

节点一旦死,**永远不再发任何消息**。 系统中越简单故障模型, 算法越容易写:
- 节点之间互相发心跳; N 秒无心跳 → mark dead; leader 选举只看 evidence。
- 一旦不准 recovery, 重启就是新身份 (新 node id)。

**Paxos 多副本经典**模型。 zookeeper-3.x ZAB acceptors 假设 crash-stop (但应用程序 failrecovery may restart state).

### Crash-recovery

节点死后可重启, 稳定存储 (persistent state) 保留 (e.g., Raft log fsync-ed)。这是真实工业系统的常态。

**关键**: 不能区分"crash恢复后" 与 "缓慢但已活"的节点——所以算法 need **stable leader election** + log **commit 后**注意 re-sync (at-least-once or exactly-once semantics).

### Omission

网络丢消息, 但节点本身正常。 分:
- **Send omission**: 节点发送丢, 接收正常。
- **Receive omission**: 节点接收丢, 发送正常。

Omission 看似温和, 但要**至少 strong failure detector** (Chandra-Toueg 1996) 才能 solve consensus。

### Byzantine (Lamport-Shostak-Pease 1982)

节点可任意行为——撒谎、伪造、不响应、发出非协议消息。 Byzantine Generals Problem 假设至多 f 个 byzantine 节点, 算法需 N ≥ 3f+1 (i.e., 备用超过 fault)。**N≥3f+1 是 lower bound**;PBFT (Practical BFT, Castro-Liskov 1999) 是经典 BFT 算法。

**现代 BFT 应用**:
- **区块链**: Bitcoin PoW 算非典型 BFT (treat 作算力 majority); Tendermint、HotStuff、DiemBFT v1 是经典 BFT 算法。
- **集群 servers**: 银行系统少量使用 PBFT 派生。
- **Spanner 复制组**: 用 Paxos (crash-stop), 非 BFT。

工程代价: BFT 比 crash-stop replication 算法负载 N=3f+1, 通信复杂 O(N²), 故都在 ≤20 replica 时用。

### Hybrid Model

工程上**多种 model 混合**:
- Spanner Paxos group 假设 crash-stop + omission (message can be delayed indefinitely);Scribe 协议处理 omission。
- BFT 区块链常 evidence treat extra Byzantine + crash-recovery 处理 by epoch leader rotating fast.

---

## 二、Failure Detector 形式化 (Chandra-Toueg 1996)

### Completeness vs Accuracy

A failure detector 是 oracle 给每个 process 提供"怀疑其他 process 已死"的列表。 评估四个性质:

| 性质 | 含义 |
|------|------|
| **Completeness (strong)** | 所有 eventually crash 节点 eventually 被某 process 怀疑 |
| **Completeness (weak)** | 所有 crash 节点 eventually 被某 correct process 怀疑 |
| **Accuracy (strong)** | correct process **永远**不被怀疑 (无 spurious marking) |
| **Accuracy (eventual)** | eventually, correct process 不再被怀疑 |
| **Accuracy (weak)** | 部分 correct process 不被怀疑 |
| **Accuracy (monotonic)** | 一旦不再怀疑 correct, 永远不再怀疑 |

### Detector 分类

| 类型 | Completeness | Accuracy |
|------|--------------|----------|
| Perfect (P) | Strong | Strong |
| Strong (S) | Strong | Weak + eventual |
| Eventually Strong (◇S) | Weak + strong | Weak + eventual |
| Eventually Perfect (◇P) | Strong | Eventual |

### Consensus 可解的 Algebra

Chandra-Toueg 证明: **◇S** (eventually strong) failure detector + asynchronous 网络 + N ≥ 2f+1 nodes → consensus 可解。 这是 Paxos 的本质——◇S 是 Paxos 隐式假设的 detector (任何节点, eventually 不再怀疑正确的 leader)。

但**纯异步网络** 无假设时, FLP (Fischer-Lynch-Paterson 1985) 证明 consensus **不可解**——任意 consensus 算法都可能"indefinitate" due to one process can be  forever uncertain → 死锁。

工程绕开 FLP: 引入**随机化** (Paxos proposer timeout + 随机 backoff); 引入◇S detector (heartbeat phi-accrual) eventually 结论。

---

## 三、Heartbeat 与 Phi-Accrual 检测

### 简单 Threshold Heartbeat

```
node A 每 1s 给 B 发 PING。
B 间隔 5s 没收到 PING → 怀疑 A 挂了。
```

threshold fixed → 太大延迟检测, 太小误报。

### Phi-Accrual (Hayashibara 2004, Cassandra 用)

**Accrual** 含义: 给每个 nodes 出"故障 suspicion level", 是连续值, 而非二值 (alive/suspect)。 算法:

1. **统计历史 arrival time**。 维护最近 N 个心跳到达间隔的滑动均值。
2. 假设 arrivals 服从正态分布 (实际用 exponential), 计算"since last heartbeat, 经过大空隙 X 自此没来的概率"是 phi 值。
3. phi '越大, 越怀疑该节点死。

```
Phi(t) = -log10(P(t_now - t_last > Δ | x drawn from past arrival distribution))
```

### Cassandra 用法

```
phi_threshold = 8
every tick:
  for each node peer:
    phi = compute_phi(peer)
    if phi > threshold:
       mark peer DOWN
    else:
       mark peer UP
```

Cassandra 默认 threshold = 8——对应 ~99.99999% 确认死。 **Phi-accrual 减少 false-positive** 比固定阈值好——网络抖动带来短 delay 不会直接 mark down。

### Swarm/Etcd/Gossip Failure Detection

许多系统用 Gossip 协议扩散状态:
- SWIM (Scalable Weakly-consistent Infection-style Process Group Membership): 多节点联合加直; 每节点 round-robin ping 一个 random member; ping 失败, random K 间接 ping; 仍 fail 加直suspect。
- Consul, Serf 用 SWIM 派生 implementation。
- etcd 用 Raft heartbeat + lease (3s timeout) 是 RAFT-style; 比 SWIM 更强的 consensus-detector.

---

## 四、Lease vs Heartbeat-based

### Lease

Leader lease 是分布时间"硬 lease": leader 获 lease 后 lease 期内**保证没人挑战**。 lease 过期必须 renew, 否则下 leader 接管。

```
grant lease to L1 valid [t0, t0+T_lease]
if lease expired, no other leader can be elected in [t0+T_lease + ε] (给予 grace period buffer)
```

用于:
- **Chubby lease**: 60s lease + renewal 30s, write 决策 on lease.
- **etcd Raft leader lease**: defaulted 1s, upgrade per cluster config.
- **MongoDB multi-doc transactions lease**: writes acquire 事务 timestamp within replica lease.

### Lease 与 FLP 不冲突原因

Lease 引入了**时间维度**——必同步式 + bound: 由于 bounded lease ⇒ bounded halting ⇒ exit FLP indefinite halting trap.

### 安全性要求

**Clock skew 不能让 lease 过期时间误判**: 系统必须给出统一 lease 时间-source。 实际工程: 给每节点 NTP 同步 + lease renew 用 Raft majority write 多副本 sync leader 的话同一 cluster time.

---

## 五、FLP 不可能性 (Fischer-Lynch-Paterson 1985)

### 定理

**纯异步网络** (消息延迟无上限) 下, **如果有 1 个节点可能 crash**, 那 deterministic consensus 算法无法保证 termination (eventually all correct 都 AGREE).

### 证明 sketch

构造一个 initial configuration `C0` 是 bivalent—— 可 decide 0 or decide 1 (depend on 内部 schedule). 算法必须转 `C0` into a `0-valent` 或 `1-valent` state——但我们可以**streer schedule** 让一个**关键步骤** (e.g., 某个 message deliver) 在 system 处于 bivalent 时 crash 那么 node。去掉那个 message → system stays bivalent forever—— 阻止 termination.

### 工程绕开

绕开 FLP:
1. **Randomized consensus**: 算法随机。 Paxos 用 randomized proposal number; Ben-Or 1983 也是 randomized. 阻止 indefinite 死锁.
2. **Failure detector with ◇S**: eventual weak detector 允许 eventually "skip crashed"—— disconnect indefinite bivalent.
3. **Partial synchronous assumption**: 实际 assumption "eventual message delivery"——一段 indefinite 第 phase 后总收得到 message。这与 eventual detector 一致.

工程区间 distributed consensus algorithms 都 mix 这三种 trick.

---

## 六、不可靠故障检测的应用

### Eureka (Netflix) AP Failover

Eureka server 之间的 replication 用 AP + eventual converge — 单 server crash (- circuit b/c lapsed -active); clients 调用 target 多 target 多 server 走 best-effort. Eureka heartbeat 每 30s lease 90s. **可用性优先于一致**, 默认 eventual heartbeat may show stale.

### Cassandra Phi-Accrual Adjustment

Cabbandra 默认 phi = 8. Failure with spiking traffic chatter: heartbeat delay 短 preservation phi=4 时小哥显 高但 adjust phi=12 reduce false-positive, 但 increase detection delays (慢) — SLA trade-off.

---

## 七、故障模型与算法选表

| Failure Model | Consensus 算法 | Storage 算法 | 例 |
|---------------|----------------|--------------|-----|
| Crash-stop | Paxos, Raft, Multi-Paxos | Primary-Backup, Chain Replication | Chubby, etcd |
| Crash-recovery | Paxos+log, ZAB | 同上 + log replay | Zookeeper |
| Omission + crash | Paxos+◇S detector | 同上 + retransmit | TCP, Cassandra |
| Byzantine | PBFT, HotStuff, Tendermint | Blockchains, some bank liveness | Bitcoin, Cosmos Hub |
| Hybrid | BFT hybrid Paxos 多副本 to Byzantine 内 | 集群 in/out cross-datacenter 太 | 跨云金融 system |

---

## 八、易错清单

1. **Pure async network + 1 crash impossible → 找绕** : 算 deterministic consensus 必须 0 个 crash. 工程用 random + detector + bound message 释出 FLP.
2. **Lease 是 explicit 时间 grant, 不是 implicit structure**: lease 没理清导致 leader skaring cluster extra; 心 延迟 timeout abide by overlap of 2+ lease. detected Oversize g超 leaked Trasure.
3. **Phi value vs fixed threshold**: 不要 混用 "5 秒 没心跳" 与 phi, 前者 fail over war 不 平稳. 自动后 finalize entry process SQL form.
4. **Byzantine ≠ 不诚实硬件 BTC smart contract Byzantine** : byzantine 假设攻击者不能 break cryptographic signature, 工程实际 alleviate 难度. BC store multi node crypto.
5. **FLP "impossible" ≠ 现实不能 consensus**: FLP 论证 existence of  indep scheduling let never choosing . 但实际 scheduled clock times 不知 form partial synchoronus path 
6. **Crash recovery ≠ state must flush to disk**: 没 fsync WAL 的 crash recovery 系统是 NOT crash-safe (new replica 读 data corruption state.consensus on false commit).
7.  **leader lease + externalizing duree certain手机**: 调度器 必 包含 grace time wait os difference treat。

---

## 九、这一章带走的东西

1. Failure model 是 distributed algorithms 的底层假设——crash-stop 比 crash-recovery 简单, byzantine 最复杂。
2. Paxos/Raft 等 crash-stop consensus 上 exist in real-world via crash-recovery (用 fsync log).
3. Chandra-Toueg ◇S failure detector + asynchronous → Consensus 可解. Raft heartbeat + lease 是 implicit ◇S detector。
4. Phi-accrual failure detector 提供 continuous suspicion, configurable threshold, less false-positive。
5. FLP 不能解决 in purely asynchronous model. 工程 evasion: randomization + DETECTOR + partial synchronous assumption.
6. BFT 需要 3f+1 nodes 与 O(N²) communication, 工程上限定 budget ≤20 nodes 块 . 

---

下一节 → [共识](../consensus/README.md)
