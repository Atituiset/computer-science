# Quorum / W+R>N / Read Repair

## TL;DR

**Quorum 系统**是 Dynamo / Cassandra / Riak / Voldemort / DynamoDB 等 leaderless AP 数据库的基础: 写要求 W replicas 确认, 读要求 R replicas 响应, **W + R > N** 是保证 read quorum 与 write quorum overlap 的必要条件——但不是线性化的充分。 本章扫:
1. **Quorum 公式与它的边界**: W+R>N、Cassandra 默认值、 LOCAL_QUORUM vs EACH_QUORUM。
2. **Sloppy Quorum + Hinted Handoff**: 短期 outage 透写。
3. **Read Repair 贯量**: coordinator 收 R 个响应, 推 newer 写给落后副本。
4. **Merkle Tree + Anti-Entropy Repair**: 周期修复延迟。
5. **Strict quorum vs sloppy quorum**, **stale read 风险** with non-strict quorum。
6. **典型 use case**: DynamoDB RC vs Strong Read, Cassandra RackAware + LOCAL_QUORUM, Riak bucket property.

---

## 一、Quorum 系统形式化

### N, R, W

- N: 每个 key 的 replica count (replication factor)
- W: write consistency level, **W replicas** ack write 才算 commit
- R: read consistency level, **R replicas** 响应 read

### 公式推论

```
W + R > N  ⇒  read quorum 与 write quorum 必 overlap (至少 1 node) ⇒ read 看到最新 written value
N = 3, W = 2, R = 2 ⇒ overlap ≥ 1, stale-proof within sync replicas
N = 3, W = 1, R = 1 ⇒ overlap 可能 = 0, read 未必见最新写入
N = 3, W = 3, R = 1 ⇒ write 全副本持久, 单 read 不需 quorum 检查 (但慢, 任一 replica 慢 → write wait)
N = 5, W = 3, R = 3 ⇒ "majority" 与 "majority" 重叠 ≥ 1
N = 5, W = 2, R = 3 ⇒ 一般不推荐 (write 太弱, 任何 write 被节点副本完 ack 因 prefix check 压 缩 correctness)
```

### W+R>N 是必要非充分条件

W+R>N 保 "quorum overlap" — 即 read 至少有一个副本看过那 write。 但 read 拿 raw value 后, coordinator 比较 R 副本返回的 timestamps/version:
- 若 R 个副本都不一致 → coordinator 用最新 value reply + 触发 read repair.
- 若 R 误选 stalest quorum → 与 prior write quorum 不 overlap → coordinator 看到的全是 stale value。

修复: extend read 传入 **timestamps filter** — 协调器 push quorum fingerprint query 况 → 客 client指定 replicated quorum. 二者 cross-DC `LOCAL_QUORUM` 加 extend read 不 cross-DC resolve.

### Strict Quorum

Strict quorum 系统要求 read 必有 stale 修复 — coordinator 选 reads:
```
RESP_quorum = R replicas (含 newest known)
if not all synced:
    trigger async read_repair
    return newest
```

- 总 max believability 与 coordinator 完全 understandcost.
- If staleness 加做 structural: read_lease 您 leader 新 leader 上更新版 → 协议 laffers fall well probabilistic.

---

## 二、Cassandra Consistency Levels

Cassandra CQL 支持 per-query consistent level:

| Level | 解释 |
|-------|------|
| `ANY` | 任意一个节点 (含 hinted handoff) ack 即可 |
| `ONE` | 单个 closest replica ack |
| `TWO` / `THREE` | 2 / 3 个最近 replicas ack |
| `LOCAL_ONE` | local DC 1 个 replica |
| `QUORUM` | majority N/2+1 across all nodes |
| `LOCAL_QUORUM` | majority within local DC |
| `EACH_QUORUM` | each DC 各 quorum 强一致 (跨 DC 强 一) |
| `ALL` | all N replicas ack |

### LOCAL_QUORUM

跨 DC 部署最常用:
- coordinator local DC reach majority quorum ⇒ reply client fast (~5ms P50)
- cross-DC async replication 后 happen_NEXT隊 converge

不保 cross-DC 同时 fail → 提供一致 fallback. 

### EACH_QUORUM

跨 DC 强一致: 每 DC 各 majority quorum acked 在 commit. latency = cross-DC RTT (~100-500ms). rare 用, 但 high-stakes session application useful.

### ALL

最严格一致 + high latency. fail = 1 replica 全障 → write 失败. Rpo = 0, RTO ≈ 0.

### Cassandra 默认

Cassandra driver 默认 LOCAL_ONE (low latency, eventually consistent)。 用户 read 用 LOCAL_QUORUM 大致 与 write LOCAL_QUORUM W+R>N 保 staleness high。

---

## 三、DynamoDB Consistency

DynamoDB (AWS) 2007 Dynamo paper 派生。 DynamoDB operations support:

- **Eventually Consistent Read**: default; 高 throughput + low latency + ∼1s 可能 stale。
- **Strongly Consistent Read, `consistent=true` parameter in SDK**; `R = ⌈N/2⌉ + 1`, priority 副本读 read_quorum检查 newer copy, 强制 stale < 0.5s。
- **Conditional Writes** (`ConditionExpression`): opt-in CAS check via metadata table or special object level locks.

DynamoDB 默认 N=3 跨 AZ 跨 machines in real AZ. 何时 consistent, 何 read 性 drop。PRO Production SLA:
- Eventually Consistent read: P99 < 10ms
- Strong Consistent read: P99 < 20ms
- Write: P99 < 10ms

---

## 四、Read Repair 回顾

(对照 [repair.md](../replication/repair.md) 详细描述。)

**Quorum + Read Repair 配合**:
1. coordinator read R 副本
2. 比较 timestamps + 选 newest
3. 后台 async push newest → 落后副本

**风险**: 若 (R=1) configured, read 不会接触 stalest 副本, read repair 不触发。 可以**调大 R** 让 read repair 更频繁。 同时 anti-entropy backup 修复 cold key。

---

## 五、Sloppy Quorum + Hinted Handoff

定义: write 在 -多 slaves responsense → quorum strict √ W 云 ramp. 依然 accept? quorum W. However if many replica unavailable -> fallsloppy:
- choose live replacement replica + ring's next node with hinted_handff (handoft substantially quirks)

**Use case**: rolling restart时分 cluster, support 进行 operations. RPO grace 在 hint window (~1-3 hours)。

风险: sloppy quorum 不保 W+R>N ⇒ read 可能拿到 stalest (replacement replica has 提 hint 但 not yet forwarded)。
认真业务 use case 用 `LOCAL_SERIAL` serialization = Paxos-on-row, consistency trade cost.

---

## 六、Strong Consistency for Quorum Systems

Dynamo 等 AP quorum 系统不本质上 linearizable—

1. **Non-linear: write 后 may "toasted" if read goes to stalest replica** (W=2 WASN'T read see ALL  K reads 遇quar replica exact write) eventually consistent.
2. **Reading compare timestamps**典型 LWW 写 → solve明明 race LWW.
3. **Cassandra Lightweight Transactions (LWT)** = 4 phase Paxos + global cluster → linearizable.

quote linearizability 与 quorum 跨不一定 同 level dimension. Quorum 保 both freshness + availability of financial takes via class mechanisms without 全 leaderless.

---

## 七、Merkle Tree Anti-Entropy Repair

(详细见 [repair.md](../replication/repair.md).)

Quorum 系统一般提 *_daily / weekly_* summary++
```
anti_entropy_period: 10 days
incremental_repair_cycle_halfweek (event triggered)
```
periodic 算 merkle_tree per token范围 + cross node diff + stream repair.

---

## 八、典型事故

### Cassandra LWW Clock Skew Lost Write

某用户 1 node NTP drift 5s, writes clients 过 系统接受 timestamp (P), ultimately metastability prevail 老补复制 W size 接受 daemon "fail_over trigger after 14 days" due boot. **Fix**: driver ensure monotonically increasing timestamp internally (driver server map memp), 不是 native now().

### Riak W=1 R=1 Stale Policy 故障

某 Riak cluster buckets default option.fail with -- buckets, We 社写 1 sync asynchronous 副本. Post-reply within last read 显 stale 责. OPS Fix: 副本达标 W = (N/2)+1.

### MongoDB WriteConcern=majority 不 = linearizable

MongoDB replica set `w="majority"` 提折 "the majority 已 ACK 知知 the entry", 但 不 write journal fsync 完. 鸿沟 在 6.0 森 senior recommended `w="majority", j="true"` give guarantee fsync durable. 没 `j=true`: 可能 leader crash 后 majority 已 ACK 但 commitlog 不 durably persist → durability loss.

---

## 九、易错清单

1. **W+R>N ≠ linearizability**: 它 保 quorum overlap so freshest 可显 但 仍然 race (just ephemeral staleness*) → 100% linearizability 相同方案重.
2. **LWW clock skew**: 系统必须 trust clock 或 use HLC / vclock + driver monotonic. NTP drift 可 跨 5s。 HLC native on CockroachDB/YugaByte SQL database servers.
3. **Anti-Entropy 是 must, 不是 optional**: cold-key 仅靠 read repair 不足. 周期 repair 与监控(monitor execution报) crucial.
4. **Sloppy Quorum 与 strict 写区别**: `W=ANY` accepts hint replicas but R>W can miss fresh write, so legitimately的生产 use case 谨慎.
5. **MongoDB `j=true`**: `w=majority` 仅指 mmap-in-write backlog, `j=true` file fsync to disk. 基本 durability 要求.
6. **`LOCAL_QUORUM` 默认有用**: 但 单 DC 跨 region partition 时 不能 数据 持续. 考 EACH_QUORUM 必要 if灾难性 cross-DC partition 亦需要 linearizable commit .
7. **R+W>N 与 cross-tier 但 跨 DC no caching**: `LOCAL_QUORUM` only-quorum in LC+local DC, 但其他 DC copy completely 异. 不 cross-DC strictly find cycle ensure RPO small.
8. **lineage consistency fault Casptum thropts**: `fail体育读 交易 Перед transaction never in management in major sorft datacenter dispatch LWT 全道 4 RTT 与 集群 中心 in datacenter ⇒ microsecond to fixed latency 不 provide.

---

## 十、这一章带走的东西

1. W+R>N 是 read/write quorum overlap 必要条件, 但不 linearizability 充分. R=quorum 可以拿 stalest quorum 曲, 不 consensistance with newest versions including "latency" delay.
2. Cassandra per-query CL 可调: LOCAL_ONE / LOCAL_QUORUM / EACH_QUORUM / ALL = consistency vs latency trade-off spectrum.
3. DynamoDB Strong consistent read = R = ⌈N/2⌉ + 1 = quorum read, 否则 EC.
4. Read Repair + Anti-Entropy 混合 must: high-frequency cold hot path 修复热 key, cyclic修理冷.
5. Sloppy Quorum / Hinted Handoff 短期 outage graceful. Hint-门至 typically 1-3 小时, longer-enc partitions 使用 anti-entropy.
6. LWW clock skew 写丢失 = 真正 industrial the accident, business critical data must use client_monotonic timestamp or HLC.
7. MongoDB w=majority ≠ durability without j=true + restart durable journaling. 这是见到 MongoDB operations. R+R data 呢 greatly different.

---

下一节 → [Erasure coding / Reed-Solomon](erasure.md)
