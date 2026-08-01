# TrueTime / HLC / attestation

## TL;DR

Google Spanner (2012 OSDI) 是全球第一个跨数据中心实现 **External Consistency** (linearizability + serializable + real-time 顺序) 的数据库——靠 **TrueTime API** `TT.now() returns [earliest, latest]` 区间, 配合 **commit-wait** (等至 latest > commit_ts 才 reply client) 避免 stale read。 TrueTime 通过 **GPS + Atomic Reference Clock** 在数据中心每几 ms 同步物理时间, 给 [earliest, latest] 区间不确定性 ~7ms。 CockroachDB / YugaByte 用 HLC 替代 TrueTime, NTP-bound skew 250ms。本章梳理 TrueTime API 形式, commit-wait 算法, Spanner Paxos group + 2PC 的分布事务流程, TrueTime 的硬件 attestation (GPS/原子钟故障检测), 与 HLC 的对比。

---

## 一、物理时钟的 distributed problem

### Wall clock skew

NTP 同步精度跨数据中心 ~50-100ms (粗), PTP 同步 ~1ms (严谨), GPS ~100us-1ms (条件好), 原子钟 ~微秒-nanosecond。任何方式都会**引入 skew**, 必须 bounded 才能用 commit-wait algorithm。

### 同步为什么不可能 perfect

特殊相对论 + 信号传播 (光速 30 cm/ns) + 量子 noise 让 oracle clock 实现困难。 Google Spanner 用 GPS + 原子钟两种 independent source, 不信任单一源 (任一可失败)。 TrueTime 实际 skew bound ~1-7ms。

### HLC 软 bound

HLC 假设 NTP skew bounded by `max_offset` (CockroachDB 默认 250ms)。 Tolerate 较大 skew 但 commits 是 predictable bounded skew 而非 hard guarantee, 用 HLC + monotonic counter 维 happens-before。

---

## 二、TrueTime API

### 函数签名

```go
type TrueTime struct {
    earliest, latest time.Time
}

func TT.now() TrueTime         // {earliest, latest}
func TT.after(t) bool          // t < earliest
func TT.before(t) bool         // latest < t
```

`now()` 返回一个区间, 真实 wall clock 在 `[earliest, latest]` 内。`after(t)` 表示 t 已绝对过去 (`t < earliest`), `before(t)` 表示 t 已绝对未到 (`latest < t`)。

### Commit-Wait 算法

Spanner 写事务 commit:

```
1. coordinator picks commit_ts = latest of TT.now()
2. Paxos group replicate log entry with commit_ts
3. coordinator waits until TT.after(commit_ts) returns true
   (即 earliest > commit_ts, 真实时间已过 commit_ts)
4. reply client "commit ok"
```

这 wait window 称 **commit-wait**: 大约等于 `latest - earliest` (~7ms)。等待期间保证任何 future transaction (real-time 在 commit-wait 完成后开始) 都看到 commit_ts strictly smaller than own ts → external consistency。

### External Consistency 形式化

若事务 T1 commit 在 T2 begin 之前 (按 real wall clock), 则 T1 commit_ts 必 < T2 begin_ts。 这让 Spanner snapshot isolation 提供 "stale read with explicit timestamp" 始终正确:
- read at ts=t 看到所有 commit_ts ≤ t 的事务修改, 不会看到 commit 在 t 之后的修改。

---

## 三、Spanner 架构

### Paxos Groups

Spanner 把数据 sharded 到 tablets, 每 tablet 由一个 **Paxos group** (5 副本跨 DC) 复制。 每 group 自有 leader 与 log。

跨 tablet 事务用 **2PC**:
- Coordinator = 写锁持的 tablet group leader.
- Participants = 所有被 update 的 tablet groups.
- Coordinator prepare → all participants prepare → coordinator commit → all participants commit.

2PC 在 Paxos group 内部 acquires Paxos commit per participant, 保证 per-tablet durability.

### 写流程

```
T1: BEGIN
  read_lock a (tablet A_paxos_group)
  read_lock b (tablet B_paxos_group)
  write a, write b
T1 commit:
  commit_ts = s = TT.now().latest
  prepare on A, B (Paxos group log entries with ts s)
  prepare ack on A, B (majority each)
  wait commit-wait (TT.after(s))
  commit ack to participants
  return client OK
```

**关键点**: commit-wait 不阻塞 lock (因为 prepare 已 hold locks), 仅阻塞 ack-to-client。在下 epoch 开始时, prepare 已 pile in Paxos log, 其他事务的 prepare 已 release pending locks with commit-ready state.

### 读流程

```
T2 read at ts t:
   find tablet group(s) holding data
   select replica (any with t-applied log) — leader or sufficiently-replicated follower
   wait until that replica's log has applyed up to ts t  (Paxos group leader 告知)
   return state at ts t
```

读不需要 2PC, 单 RTT (or local from follower if log applied). 牺牲略 latency/cross-DC = read throughput 高。

### Lock Table

Spanner 用 **2PL** (two-phase locking) per transaction: read locks + write locks by row。 Deadlock 检测实际至 abort 其中一个事务 (wound-wait 算法)。

---

## 四、TrueTime 硬件 Attestation

### 时间源

每 DC 一组时间 reference (GPS 接收器 + 原子钟), multiple sources redundant. 若 GPS 信号短暂失, 原子钟提供 tick; 若原子钟失 (rare), GPS 提供同步; 若两都失, machine 上报 "unsynchronized" → fail-shut.

### Attestation

TrueTime API 不仅给你时间, 还伴随 **trust signal**: every `now()` call 米conly "Trusted" 时 cache time, 否则 reporting fail-shut. Shielded hardware 验证流程: GPS signal → machine encryption log → 安全 monitor 验 GPS signal 来源可信 → publish trusted node info.

### 故障 Scenarios

- **GPS signal loss**: 原子钟持相对正确时间, skew drift 累 -> 30 minutes 后 fail-shut cluster. 故áo 重 human operator catch alarm.
- **Atomic clock failure**: GPS 出 stand-alone, 实际 never happens (因为 GPS 触校正 over time). Carring.....
- **All timing failures**: cluster 主动 shutdown, reject transactions. Paxos election 暂停, 防 stale time stamp commit.

### 与 HLC attestation 比较

HLC 没硬件 attestation, 仅 NTP 提供, 软件 monitor 必须主动检测 skew, 节点 fail exit. Spanner is strict in this sense — admin-level hardware redundancy necessary.

---

## 五、HLC vs TrueTime 对比矩阵

| 维度 | TrueTime (Spanner) | HLC (CockroachDB) | HLC (YugaByte) |
|------|-------|---------|---------|
| 时间源 | GPS + atomic clock | NTP | NTP |
| 同步精度 | ≤ 7ms | ≤ 250ms (max_offset) | ≤ 250ms |
| Commit-wait cost | ~7ms (wait latest > commit_ts) | 不需 commit wait | 不需 wait |
| External consistency | yes | no, but bounded staleness | no |
| 硬件依赖 | GPS 接收器 + atomic clock per DC | NTP only | NTP only |
| 部署成本 | 高 | 低 | 低 |
| 适用场景 | 大型 cloud vendors | 中型企业 | 中型企业 |
| Stale read 防御 | TrueTime API 自然防御 | HLC ts invariant + read-at-ts filter | 同 CockroachDB |

### HLC commit-wait 不必要原因

HLC ts 已经是 monotonic (lt counter monotonic) + bounded pt skew, prepare 在 bgot commit time ts; 不需 commit-wait。但 HLC 让 Spanner external consistency missing — 客户端可能看到 future ts commit (newer than read at ts).

### CockroachDB 与 YugaByte 区别

CockroachDB: HLC + MVCC 在 Postgres SQL 架构。
YugaByte: PostgreSQL frontend, 但 storage 是 doc-store + Raft group, HLC 提供 Mohamed API bounds.

---

## 六、Other Systems 与时间

### Calvin (Yale 2012)

Calvin 离线 batch transactions, 总铁 ordering before 执行. 测 toschematically boolean balls; Kalvin时间 user-side TD-error tolerance 我 wait no, 我oracle actually per write 暂.
Calvin pseudo offline 通过 batch locked a start_commit presumably use so this is awkward SAS postman now direct 性union mechan general application pins strict on 完 全 static data snapshot real-time gone 是 trans it.

### FoundationDB

FoundationDB resolve clock issues by **sequencer**: 一个全局 sequencer 接收 transaction 提交 timestamp monotonic. 各 client direct API 是 `transaction.commit()`: callee 拿序号顺序, 不依赖 wall clock. Linearizability 单 serializalman泽. 但是 clock-free 用 集中 bottleneck.

### HBase 与 Accumulo

HBase timestamp 默认 wall clock. 已知潜在 out-of-order commit if skew; 应避免 depends on. Accumulo 同样。

### MongoDB ClusterClock

MongoDB coordination node iterates' logs all dependent uncommitted used 完.sequencer 含 logical 时间 integrating with physical timestamp in mingshi.

---

## 七、典型事故

### Spanner GPS Loss

2015 Google 曾 talk 提到某 DC 一 GPS天线短暂失联 (暴风雨). 原子钟 hold 时间正确, 但 skew 渐累. Spanner 5 minutes 后上inia 类 fail-fast alert, operator 处理恢复 GPS.

### CockroachDB NTP Skew Storm

2018 用户报告 CockroachDB cluster slow queries 因为 3 节点 NTP skew 超过 max_offset (250ms), cluster nodes 拒⚭ 异 relation offset rejected; team修改 cron ntpdate to keep drift < 50ms.

### MongoDB Clock Skew 写丢失

MongoDB replica set wall-clock-based timestamp 排序 commit, 某 node skew 后写 后 损 ye叙述 丢失现象. 多个 issue reported in MongoDB Jira (2016); fix: use logical timestamp in replication log。

---

## 八、易错清单

1. **TrueTime 不是 oracle**: 你必须 commit-wait 第三方 before reply。 没 commit-wait, external consistency违反。
2. **Spanner 不只 TrueTime**: 还有 Paxos + 2PC + Lock table + 4PL, TrueTime 给时间戳正确性.
3. **HLC commit-wait 是 optional**: HLC upper bound 不 wait, 但 staleness bounded by max_offset。 业务可接受 weak consistency 才用 HLC。
4. **CockroachDB 写入突然不再 单一 well ordered**: HLC across region 可能违反 real-time order, 仅 per transaction opertion的关系保 happens-before.
5. **GPS 必须 multi-source**: 单 GPS source 故障 → cluster unsynced, 多源故障 fail-shut. Spanner 至少 2 GPS + 2 原子钟 per DC。
6. **Clock 政府 aware NTP 与ictschronous 数据 Illegal**: NTP 可以 使 节点 clock backward. HLC 算法若 都 没 caught backward clock navigate 上 partial 可能 导致 Haremix ts broken; cockroach supports NTP sane 版本 with proper monotonous rate.

---

## 九、这一章带走的东西

1. TrueTime 给 [earliest, latest] uncertainty API, commit-wait 让 commit_ts guarantee strictly 小于 future begin_ts ⇒ external consistency。
2. Google Spanner 是 industrial 实现的 Paxos group + 2PC + commit-wait + TrueTime。
3. HLC 是 software-only fallback, NTP skew bounded; 但 external consistency 仅近似, 真正实时保证仍硬件 sync 需要.
4. Clock attestation (GPS + atomic) 让硬件 fail-shut 安全; 没建 monotonic hardware 就 not safe.
5. CockroachDB / YugaByte 用 HLC 取代 TrueTime, 同十字低部署成本 不保 external consistency strict 2PL-fence  only serializable + bounded staleness.
6. FoundationDB 用 sequencer 节约 wall clock 量 importance; 中央 sequencer serializing 是车另 第四百 srullt. 用 distributed 省ariesle clock alternative.

---

下一节 → [DAG、git、blockchain 的序](dag.md)
