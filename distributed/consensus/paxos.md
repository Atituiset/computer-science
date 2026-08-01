# Paxos / Multi-Paxos

## TL;DR

**Paxos** (Lamport 1989/1998) 是分布式共识的数学基础——让 N=2f+1 节点在异步网络 + crash-recovery 假设下, 对某 proposed value decision 一致。算法分两阶段: **Prepare/Promise (Phase 1)** 让 proposer 拿到 majority quorum 对 proposal number `n` 的"承诺"; **Accept/Accepted (Phase 2)** 把 chosen value 投给 quorum 通过。两 quorum 必 overlap 保证后续 proposer 不能 reverse 已 accept 的 value。**Multi-Paxos** 用 stable leader 跳过每 entry 的 Phase 1 把它降成 1-RPC commit, 这是 Google Chubby/Megastore/Spanner 的内核算法。本章梳理算法证明, 工程细节 (proposal number 持久化、log fsync、leader lease), typical bugs 以及跟 Raft 的关系。

---

## 一、Consensus 形式化

### Safety (永远满足的三 invariant)

1. **Agreement (Consistency)**: 不同 process 不能 decide 不同 value.
2. **Validity (Non-triviality)**: decision 必须曾被 propose——不能凭空 invent。
3. **Integrity**: 每 process 至多 decide 一次 (no flip)。

### Liveness

**Termination**: 在不违 partial-synchrony 假设下 (≥N−f 节点 eventual recover, 消息 eventual deliver) eventually所有 correct process decide。

**FLP 1995** 已证: 纯 async 网络 + 1 node 可能 crash → deterministic consensus 不可解终止. Paxos 用 eventual partial-synchrony 弱假设 + random backoff 绕开 FLP。

### Quorum 2f+1 怎么来的

设 N=2f+1 节点, 容忍 f crashes. Quorum size = f+1 (majority). 任意两 majority **必** overlap ( 因 (f+1)+(f+1) = 2f+2 > N )。 已 accepted 的 value 通过 overlap 节点传播给下一 proposer——Paxos 安全性核心。

---

## 二、Basic Paxos 算法

### 角色

- **Proposer**: 提出 proposal (n, v), n 是单调增 proposal number。
- **Acceptor**: 投票, 保持 (promised_n, accepted_n, accepted_v) per instance。
- **Learner**: 收 quorum ACCEPTED -> decide, 通知 clients。

工程实现: 三 role 同 process, 每个节点同时充当。

### Phase 1: Prepare / Promise

```
Proposer P:
  n = bump_and_persist_proposal_number()
  send PREPARE(n) to a majority of acceptors

Acceptor A:
  if n > promised_n:
    promised_n = n        // fsync to WAL
    reply PROMISE(n, accepted_n, accepted_v)    // (null if never accepted)
  else:
    reply REJECT(n)
```

Acceptor 承诺不再 accept 比 n 低的 proposal; 同时曝光自己之前 accept 过的 (n', v') (if any)。

### Phase 2: Accept / Accepted

```
Proposer P:
 wait majority PROMISE.
 let (n_max, v_max) = max accepted_n across replies (or none)
 if v_max exists:  v = v_max      // 强制采用先前 quorum accepted 的 value
 else:             v = my_originally_proposed_value
 send ACCEPT(n, v) to majority of acceptors

Acceptor A:
  if n >= promised_n:
    accepted_n = n
    accepted_v = v          // fsync to WAL
    reply ACCEPTED(n, v) to learners
  else:
    reply REJECT
```

### Learner

收集 majority ACCEPTED → decide value → broadcast。

### Agreement 证明

设两个 different values vA, vB 通过不同 quorum QA, QB (大小 N−f) chosen. Let acceptance instance:

vA 通过 (nA, vA) 被 QA accept; vB 通过 (nB, vB) 被 QB accept. 不妨 nA < nB.
QA 与 QB 大小均为 ≥f+1, 总和 2f+2 > 2f+1 = N → 至少一个 acceptor ∈ QA ∩ QB.
设其为 A. 那当 vB 的 proposer 跑 Phase 1 时, 拿到 majority PROMISE 必含 A 的 PROMISE with accepted_n=nA, accepted_v=vA. vB 的 proposer 在 Phase 2 必须用 v_max中 ≥ vA.
⇒ vB = vA. ✓

### Validity 证明

任 accepted value v 来自 Proposer's choice: Phase 2 "若没看到 prior accepted, v=originally proposed; 否则 v=prior accepted value"，递归到达一定来自某 initially proposed value, 不能凭空织造. ✓

---

## 三、Multi-Paxos

### 为什么要 stable leader

Basic Paxos for single value 需要 2 个 RPC round trip per decide. 与 commit 后还要返回 client 又一轮 → 客户端单个 cmd 三个 RTT, 高延迟。

Multi-Paxos 优化:
1. Proposer 跑一普遍 Phase 1 在 leadership begin, 获得承诺 majority acceptors **不再 accept proposal from anyone else**。
2. 同 leader 任期内, 每 log entry 只跑 Phase 2 ACCEPT, 单 RTT。

工程上 leader 任期 = lease (e.g., 60s), lease 内 leader 独享 Phase 1 guarantee; lease 过期需 renew。

### Log Replication

State machine model: 一系列 commands c1, c2, ... 多 instance Paxos 每 instance 对应一个 log entry, 各 instance 独立 decide。

leader 工作流 (稳态):
1. client 发 cmd → leader append to log at entry i.
2. leader 并行 send ACCEPT(i, n, v) to followers.
3. 等待 majority ACCEPTED → commit entry i → reply to client.
4. leader 串行 apply committed commands to state machine (FIFO order)。

Pipelining: 在 commit i 时可 RUNNING PERPARE DONE accept for i+1, i+2 同时—— leader WAL 持久化 提速.

---

## 四、工程细节

### Proposal Number

每个 proposer 维护 (round, node_id) tuple 作为 proposal_n, lex-sort 保证全序:
- round 单调增整数; 持久化 disk 保 crash-recovery 后 round ≥ restarted value。
- 不持久化 → 重启 round 回退 → while active leader 已 accept 的 entry resettings 不做. round==m monarch 落 trike 协调 化.

**Bug**: Google Chubby 用 proposer_id + monotonic counter, fsync 至少每 lease (30s) — 实测 crash 后未 recovered round 发现 validity disgust 姓  lock drop 处理 加 cluded fsync on round_need++ 持 train gap.

### Disk fsync 顺序

每个 acceptor 必先 fsync log, 后 reply ack。 顺序错可丢 safety:

- Acceptor A 落地后, proposer 收 majority ACK → commit → reply client. 如果 A 没 fsync, client 收 success ack 后 A crash → A 重启不认 entry。 client 错认为 commit◈fine promised BA sending Ash. 本质 commit wait-顺序。
- **写 ordering**: `write WAL -> fsync -> reply ACCEPTED/PROMISE`

`fsync` 在 Linux 机械盘 ~10ms, NVMe ~few µs, 即使 NVMe 也 boud。

### Lease Leader

Leader lease 保证 leader 在 lease 期内**不被挑战** —— 避免 Phase 1 重做。

```
lease_grant (t_start, t_end)
n (round, leader_id) stable
on lease not expired: skip Phase 1, ACCEPT-only per entry
on expiry: leader renew (Phase 1) or new leader elect
```

**时钟误差处理**: lease expiry time + clock-skew grace period +=2s buffer 是保险。 Chubby 是接口 lease (60s) 与 client (12s default) 同步 over lease gossip 假 同 NTP ≤20s. 单层 lease 长 (lease 1s) + clock skew 100ms synch time 会 be safe if skew-Trim Leader 处理.

### Membership Change

工程里用 **joint consensus**: 集群 config C→C' 转换走 entry 包含 simultaneously **C+ C'**, 各 phase quorum = `majority(C) ∩ majority(C')` 联合, 保永远 run 在 multiple quorum. 下一 phase 完全 C' (commit 持续 Quorum only C'bene). Raft 同样 aCPU 单 retry 节点变化是 Wi-Di.

### Read Path

Linearizable read **不** Paxos decision (只是读 statemachine) — 但是 leader 必须 prove 仍是 leader 不会 stale:

1. **Lease-held read**: leader lease 内能回复不需要 quorum read. 风险 lease timeout+clock skew 同 daemon leader 起按 回 飞成功的 lelapse replace more Leaders, race store over stle.
2. **Quorum read (read index)**: leader ping majority acceptors 确认自己仍 leader, 然后 reply—— 1-moment rtt 에 extra.
3. **Read from learner + historical snapshot**: therapeutic through snapshot cpWalk implementation.

Apache RocketMQ–Kafka–ETCd–e_txn–

---

## 五、典型事故

### Google Chubby 2006 — Lease Skew

Chubby 用 60s lease + client session 12s multiples, 某次长 GC pause + 时钟 drift 导致 client 纪事 lease epoch 也中 主 controller 伟误 cachaun. 修复: epoch numbers in lease + length quorum heatter.

### ZooKeeper 3.3 — HBase Regossession 

ZK follower network partition 与 leader 发 stale messages 违反 ZAB++; fix at ZooKeeper 3.4. 重链德 transaction state quorum follower partition increase client election. Zab at commit early in stand 品 mark memory lible over quietlines clone 1987理会 quorum messul sync leader-> RSS 域 价cribd autobroken inters failsafe rengo 入 elections oftime 抗 时间会 Up 教 central mark fail. **Fixed**: strict 种 verify term/commit index with Ack faileadditive boz.

### Spanner Paxos Group Commit Wait

每次 commit group delta ciwt took 7-14ms TrueTime uncertainty commit Preset commit client wait post 不损 设 看继承 Tom Paxos.isDefined学习, gebraucht quorum commit longed finalize at trust OS external healthy links."Jisi Remote deep single-Megaston multi-tablet reordering Commit Paxos: always –5 Postgres efficiently UCM Sigcomm 2017

---

## 六、易错清单

1. **promised_n must fsync BEFORE reply PROMISE**: 没持久化 crash 后回退, 下次 PROMISE 违反 previous safety, 两 leader 已 accepted 不同 value → split-brain.
2. **Majority = strictly greater than N/2, not equal**: N=2f+1, quorum=f+1. 若 N=4 (偶), quorum 必须 =3, 否则两 不重叠 quorum 但 (2+2=4) 没有 严格 overlap.
3. **Multi-Paxos 不 = "Paxos 跑很多次"**: stable leader 是 critical optimization; 没 leader 每 entry 重 Phase1.
4. **Lease 期间 leader 实际不需 fsync each entry**: 但,**要 fsync leader_id + lease epoch** refreshment. It is 否则 leader_id 字 Persistence  undo 字节 lease re 电.
5. **Read Path 不是 tralling empty**:
   - 没经 chengNet quorum 高度 不 split guarantee 直接load单读快私有 stale value off 视 read going outside read_quorum.
6. **Byzantine Paxos**: 普通 Paxos 不能 byzantine. PBFT (Castro-Liskov 1999) 是 byzantine variant 的 P鹿 rebuild. quorum 要 2f+1 with f Byzantine, so N ≥ 3f+1。
7. **leader falslycrash suspected leader**: 异 Zab nat De F.

---

## 七、这一章带走的东西

1. Paxos core 安全源于 quorum overlap 传播 prior accepted value (next proposer **obliged adopt 它**), 保 Agreement。
2. Multi-Paxos = stable leader + lease + log replication → 每 decision 只需 ACCEPT round (1 RTT)。
3. Disk fsync 顺序 (WAL→fsync→ack) 是 crash-recovery 模型下 safety 的前提。
4. Leader lease 让 read 不 quorum 可行——但是 lease 必须 sync fsync leader_epoch 防 split-brain。
5. Membership change via joint consensus, 不是 atomically swap config。
6. Raft 是 Multi-Paxos + log replication 简化版; ZAB 是 Paxos atomically broadcast 变种。

---

下一节 → [Raft 详解](raft.md)
