# 逻辑时钟、向量时钟、HLC

## TL;DR

分布式系统**无全局 wall clock**——你不能用一个普通的 timestamp 来判定两事件先后。Lamport 1978 提出 **Lamport Clock**: 每节点维护单调自增 count, message 携带 count → 接收方更新成 max(local, msg_count)+1, 给事件一个**全序但仅保因果 partial order** 后将并发事件任意排序。Fidge 1988 与 Mattern 1989 各自独立发现 **Vector Clock**: N 节点维 N 维 count array 在节点间传播, 精确刻画 `happens-before`, 区分 concurrent vs causal-ordered pair。**HLC (Hybrid Logical Clock, Kulkarni 2014)** 融合 physical wall clock 的高位 + logical counter 低位, 给事件同时**人友好的时间戳 + 因果关系** —— CockroachDB / YugaByte / TiDB 都用 HLC 做事务 timestamp。本章梳理算法细节, 收敛条件, 用例 (Dynamo siblings, CockroachDB snapshot isolation), 与 typical bug (Lamport clock 单调 但并发 events 任意序 不区分)。

---

## 一、Lamport Clock (1978)

### 算法

每节点维护 monotonic counter `LC_i`, 初始 0:

```
on event e at node i (send / receive / local): LC_i = LC_i + 1
on send(m): attach LC_i to m
on receive(m, LC_m): LC_i = max(LC_i, LC_m) + 1
```

### 性质

- **happens-before**: 若 `a → b` (同进程序 + send/recv + 传递闭包), 则 `LC(a) < LC(b)`。
- **逆否命题不成立**: `LC(a) < LC(b)` 不蕴含 `a → b`——它们可能 concurrent。
- **全序扩展**: 把 Lamport Clock + (process_id) lex 排, 得到 total order (任两个事件都可比), 但这是任意扩展, 不是 happens-before 原 partial order 的忠实反映。

### 用例

- **Mutual Exclusion via Lamport Clock**: Lamport 1978 论文里给出 distributed mutex 算法, 提议临界区请求带 LC + process_id, 节点色 total order 排队。O(N²) messages, 严谨 but 低效; 不工业用 (因 Paxos/Raft 都更高效更好)。
- **DynamoDB (AWS) Order Stream**: DynamoDB change stream 用 LC-style 时间戳排序 events 在 短时间窗内。

### 局限

Lamport Clock **不能** 区分因果序与并发序:

```
A: send m_A (LC_A=5)
B: send m_B (LC_B=5)        concurrent with A
```

两 event LC 相同, 看上去"同时间发生"; 真实它们 concurrent (不是 causally related)。

vector clock 解决这 limit。

---

## 二、Vector Clock (Fidge 1988, Mattern 1989)

### 算法

每节点 i 维护 N 维 vector `VC_i = (c_0, c_1, ..., c_{N-1})`, 初始全 0:

```
on local event at i: VC_i[i] += 1
on send(m) at i: VC_i[i] += 1; attach VC_i to m
on receive(m, VC_m) at i:
    for all j: VC_i[j] = max(VC_i[j], VC_m[j])
    VC_i[i] += 1
```

### 关系比较

`VC_a ≤ VC_b` iff `∀ k: VC_a[k] ≤ VC_b[k]`
`VC_a < VC_b` iff `VC_a ≤ VC_b ∧ ∃ k: VC_a[k] < VC_b[k]`

- `VC_a < VC_b` ⟹ `a → b` (happens-before)
- `VC_a || VC_b` (即不 ≤ 也不 ≥) ⟹ `a` 与 `b` concurrent

### 用例

**Dynamo / Riak siblings**: writes 带 VC, replica merge 给出 vector clock 比较:
- 若 `VC_a < VC_b` → discard `a` (newer overrides)
- 若 `VC_a || VC_b` → 两个都保留为 sibling, 应用层 merge

```python
def merge(replica_a_value, replica_b_value, VC_a, VC_b):
    if VC_a < VC_b:
        return replica_b_value, VC_b
    elif VC_b < VC_a:
        return replica_a_value, VC_a
    else:
        # siblings; 应用层 merge function (or list all)
        return [replica_a_value, replica_b_value], max(VC_a, VC_b)
```

### Vector Clock 变种

| 变种 | 区别 |
|------|------|
| **Version Vector (VV)** | 仅 update on write, 不 update on read; Dynamo 用 VV。简单但 N 写 parties 固定。 |
| **Dotted Version Vector (DVV)** | 引入 "dot" = (node_id, counter) 唯一标识一次 occurrence. 应用 client cluster anonymity (单 client 同 node)。 Riak 用。 |
| **Interval Version Vector (IVV)** | counter 改成 interval [start, end], 处理 dynamic membership, 节点 join/leave 不 reset。 |
| **DCVV (Dotted Cluster VV)** | DVV + cluster id, 高度 dynamic membership (Cassandra 内部曾用)。 |

### Vector Clock 内存代价

每 message 维传 N 维整数, O(N) per event; Cassandra / Riak 在 N=100 nodes 情况 VC serialize ~1KB 包过载。常见优化 **Dotted VV** + compact representation.

### 局限

Vector clock **检测** concurrency 但**不解决**conflict——应用层仍需 merge function. Riak DT (CRDT) 与 Riak siblings 都让 application 决定逻辑, vector clock 只是 procedure infrastructure.

---

## 三、HLC (Hybrid Logical Clock, Kulkarni 2014)

### 动机

Pure logical clock 与人读时间无关 ("这 event 是 timestamp 1000, 但何时真实发生")；pure wall clock 受 NTP skew 影响 + 不保 happens-before。 HLC 融合:

- 高位 = wall clock 时间 (`pt`)
- 低位 = 逻辑 counter (`lt`)
- (pt, lt) 元组保证 causal happens-before + timestamp 接近 wall clock 真实发生时刻

### 算法

```
each node init HLC = (wall_now, 0)

on local event at node i:
    if wall_now > HLC.pt:
        HLC = (wall_now, 0)
    else:
        HLC = (HLC.pt, HLC.lt + 1)

on send(m):
    bump HLC (above); attach HLC to m

on receive(m, HLC_m):
    new_pt = max(wall_now, HLC.pt, HLC_m.pt)
    if new_pt == HLC.pt == HLC_m.pt:
        HLC = (new_pt, max(HLC.lt, HLC_m.lt) + 1)
    elif new_pt == HLC.pt:
        HLC = (new_pt, HLC.lt + 1)
    elif new_pt == HLC_m.pt:
        HLC = (new_pt, HLC_m.lt + 1)
    else:
        HLC = (new_pt, 0)
```

### 性质

- `a → b` ⟹ `HLC(a) < HLC(b)` (lex by pt then lt)
- `HLC(a) < HLC(b)` ⟹ `a → b` (no false positives because counter monotonic)
- pt 接近真实 wall clock, 人读 HLC 时知道大致真实发生时刻

### 用例

**CockroachDB HLC**:
- 每 transaction 用 HLC timestamp。
- HLC 与 wall clock bound skew (max_offset 默认 250ms) → 同物理事件可 timestamp 偏移 < 250ms +1 logical tick.
- transaction read 是 snapshot isolation at HLC timestamp; 查 commit HLC > read HLC 排除 commit-on-after-read 的 row.

**YugaByte / TiDB** 与 CockroachDB 类似, 内置 HLC + bounded skew.

**MongoDB**: 但 MongoDB 没用 HLC, 用 wall clock + reverse_sbe seq for global timestamp cluster clock.

### Bounded skew

HLC 让各节点 wall_now **bounded** skew (默认 250ms in CockroachDB), 通过 max_offset 配置后 cluster know if wall clock drift > max_offset → 节点必须 fail exit.

否则 HLC 不保 happens-before—— wall clock 直跳, counter 才保证.

---

## 四、HLC vs TrueTime

| 维度 | HLC (CockroachDB) | TrueTime (Spanner) |
|------|-------------------|--------------------|
| 同步精度 | bounded skew ~250ms (NTP) | bounded skew ~7ms (GPS + 原子钟) |
| Commit-style wait | 不必 wait | commit-wait (wait until TT.now() latest > commit_ts) |
| 软实时? | PT-approx not real-time | cl实事实时 (commit-wait ~14ms) |
| Garbage-in short window? | ≤ max_offset | commit-waitカバー |
| 实现复杂度 | 适中 | expensive (timing hardware per datacenter) |

HLC 比 TrueTime 简单 (NTP 普及) 但 commit wait 长 (250ms worst case 把 commit fully serialized across events). TrueTime 直接 GPS 持 7ms skew → commit wait 14ms。

---

## 五、生产事故

### Riak Vector Clock Sibling 风暴

Riak 2.0 一度 1995 严格 VC 让 client 看 sibling list; but application 不设 merge fn → sibling list 中 5 个 values; 用户不 that 失潘 krebs写 fail 加 format. Fix: Riak DT (CRDTs) let user set bucket type  data_type = counter/set/map, 默认让 Riak 内置 merge logic.

### Cassandra LWW + Skew Lost Write

Cassandra 单一 timestamp 驱动 LWW。某写入 client NTP skew 5 秒晚, 其 timestamp 偏大 → 后写 user 可能有 της late timestamp > 中先existent。后写 overwrite 不合法 drifted NTP data wrote системы. Fix: 用 client_id + monotonic timestamp 而非 now(); 是Cassandra Java driver 自带。

### CockroachDB HLC 偏离 → Out-of-Order Read

CockroachDB HLC 假设 max_offset = 250ms。 某节点 NTP drift 超过 250ms 后, write ts 偏移 too far > 其他节点会读到 stale committed 数据. Fix: cluster 启动 + 周期 monitor NTP divergence, 超过 251ms 让节点自行 fail exit.

---

## 六、易错清单

1. **Lamport Clock 不能区分并发**: LC(a) < LC(b) 不能推 a → b, 因为 a 和 b 可能 concurrent. 要并发检测必用 Vector Clock。
2. **Vector Clock 不解决 conflict, 仅 detect它**: 应用层 merge function 必须好好设, 否则 sibling 无限堆积.
3. **Vector Clock 必须传整个 vector 而非只是 last counter**: 传 dot 而非 vector 就 lost causal info ⇒ DVV 设计 fixing 此。
4. **HLC 不有 external consistency**: HLC 假设 bounded skew, commit-wait 时达不到线性化世界的"real-time 一致"—— 上 bounded skew = 250ms CockroachDB commit-wait 不需 wait 直接发 ts, 因此 client 可能在 read 看到 future ts commit。 CockroachDB explicit `read_no_write_ahead` 处理。
5. **HLC `max_offset` 必须 monitor**: NTP drift 大会让 HLC invalid. cluster health dashboard 必须显示 skew。
6. **Wall clock not monotonic**: 重启或 NTP step 后 wall clock 可能跳 backwards. HLC 算法中 `if wall_now > HLC.pt` 检查保护, 但 NTP **stepping** 总需要 long-term installreboot aware.
7. **Vector Clock encoding 没用 delta compaction**: 100 node VC 数组大. 工业用 sparse + delta encoding (如果 4 节 domany-HashMap gas has compile 快).

---

## 七、这一章带走的东西

1. Lamport Clock 给 happens-before **保 inter-process ordering** 但不区分并发; vector clock 精确刻画并发但 N node cost.
2. Vector Clock 在 Dynamo / Riak siblings 上 detect concurrent writes, application merge function 解决 conflict.
3. HLC 融合 wall clock + logical counter, 给人友好的时间戳同时保 happens-before. CockroachDB / YugaByte / TiDB 内置。
4. TrueTime (Spanner) 通过 GPS+ atomic clock 直接给 7ms 内 skew, commit-wait 实现 external consistency。 与 HLC API 形式 似但 hardware 差异大。
5. Vector Clock vs Version Vector vs Dotted Version Vector vs Interval Version Vector 是 distributed stores 世代演进, 处理 client anonymity + dynamic membership。
6. Lamport Clock Total Order (LC + process_id) 是任意 tie-break; 不能用来推并发 events simultaneous.

---

下一节 → [TrueTime / HLC / attestation](physical.md)
