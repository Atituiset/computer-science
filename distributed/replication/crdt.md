# CRDT：无冲突数据类型

## TL;DR

**CRDT (Conflict-Free Replicated Data Type)** 是 Marc Shapiro et al. 2011 (INRIA) 提出的"分布式数据结构数学统一理论"——在最终一致性系统里, 只要每个操作具备**commutativity (可交换)** + **associativity (可结合)** + **idempotency (幂等)**, 多节点任意顺序应用 op 最终都收敛到同一状态, 不需要协调或共识。CRDT 让无主/多主复制免 vector clock sibling 选择, 让 collaborative editing 不走 OT 的复杂 transformation matrix。 例: Riak DataType (counters/sets/maps), Redis CRDT, Automerge, Yjs, SoundCloud Roshi, Figma 的多人编辑都靠 CRDT。 本章梳理 state-based vs op-based CRDT, 加入常见类型 (G-Counter / PN-Counter / G-Set / 2P-Set / OR-Set / LWW-Register / LWW-Map / RGA / Text), 收敛证明与"为什么需要 tombstones 而非简单 delete", typical 生产事故 + 协同编辑器对比 (Automerge vs Yjs vs Google Docs OT)。

---

## 一、问题:Conflict Resolution Without Central Coordinator

### Vector Clock Sibling 的问题

Dynamo / Riak default vector clock 让 user / application resolve conflict: 看到 `siblings = [VC1: A=1,B=0 ; VC2: A=0,B=1]`, application 必须给出 merge function. 写 application-level merge 复杂且易错:

```js
// shopping cart 复制抖镖 – 用户加 不同 — difference in conflict resolve
cart_NY = {apple, banana}
cart_SF = {apple, cherry}
merge_elems = cart_NY ∪ cart_SF = {apple, banana, cherry}  // OK!
```

但若 `delete` 也需要支持, 简单 union 不能反"deleted"——计数 set deletion 需要 tombstone.

CRDT 解决这个: 让 data structure 本身的 merge function 是数学上 associative + commutative + idempotent, 则 replicas 任顺序收敛。

---

## 二、State-based vs Op-based CRDT

Shapiro et al. 定义两种 CRDT:

### State-based (CvRDT: Convergent Replicated Data Type)

- 每节点独立持本地 state。
- 节点不发送 op, 只发送整个**state** (或 delta-state) 给其他 replica。
- merges: `join(s1, s2) = s1 ⊔ s2`必须 **commutative, associative, idempotent**。

最终收敛条件 (bounded semilattice): join 算子构成 partial-order semilattice (有 least upper bound), 所有 join 都单调 = 收敛后状态。

### Op-based (CmRDT: Commutative Replicated Data Type)

- 节点不传整个 state, 直接传 op。
- 每个 op 必须是 commutative + idempotent (因为 message may re-arrive or arrive more than once)。
- **!) requirement**: Casual broadcast——若 op a 因果先 op b, a 必须先到达所有 replica。

Op-based 节省带宽、时延, 但需 underlying casual broadcast (vector clock)。 Riak DT 与 Yjs/Automerge mixed state-based 优点 + delta-state 优化。

工业一般用 state-based + delta-state, 因为 op-based 需要 casual 顺序保障开销。

---

## 三、常见 CRDT 类型

### 1. G-Counter (Grow-only Counter, 单调不减)

State: 每节点 i 维护独立 counter `c_i`, 初始 0.
Op `inc()`: `c_i++` at local node i.
Query `value()`: `Σ c_i` over all i.
Merge: `c_i = max(c_i_a, c_i_b) for each i`.

```
node A: c_A=5, c_B=0  value=5
node B: c_A=0, c_B=3  value=3
after merge on A: c_A=5, c_B=3, value=8
```

`max` + idempotent ⇒ CRDT。

### 2. PN-Counter (Positive-Negative Counter)

不能直接复用 G-Counter 因为 counter decrements 是非 commutative matching monotonic increases. 解决方法:

State: 两 G-Counter, `P` (positive) + `N` (negative).
Op `inc()`: `P_i++`;  Op `dec()`: `N_i++`.
Query `value()`: `Σ P_i - Σ N_i`.
Merge: per-node max on each of P and N.

### Riak Counters

Riak DT Counter = PN-Counter。 性能警告: 内部 vector clock chain 增 large, ops 100k+ 之后 operation tensor 膨胀 + potential 性能下降 — Riak pin 自动"GC + archive"措施.

### 3. G-Set (Grow-only Set, 加入只)

只支持 `add(e)`, 不允许 remove.
State: Set S.
Op `add(e)`: `S = S ∪ {e}`.
Merge: `S = S_a ∪ S_b`.

### 4. 2P-Set (Two-Phase Set, 加追删)

支持 add 与 remove, 但每 element 最多 add 一次 + remove 一次。

State: 两个 G-Set, `A` (added), `R` (removed).
Op `add(e)`: `A = A ∪ {e}`.
Op `remove(e)`: 必须先 add, `R = R ∪ {e}` (但 transient add-remove-proof: tombstone)。
Query `contains(e)`: `e ∈ A ∧ e ∉ R`.

风险: 添加 remove 后无法 re-add——同 e 再 add 仍 contains=false (因 R 已有 e). 适合 "tag collective" 使用, 不适合 dynamic add/remove 反复 use case.

### 5. OR-Set (Observed-Remove Set) — 工业常用

状态稳定 (与2P-Set 对比): 每次添加生成 **唯一 tag** (uuid), 删除只删 add 中见过的 tag.

```
add(e): generate new tag t, A = A ∪ {(e, t)}
remove(e): collect all (e, t) seen locally, R = R ∪ observed_tags
contains(e): ∃ t such that (e, t) ∈ A ∧ (e, t) ∉ R
merge: A_merged = A_a ∪ A_b ; R_merged = R_a ∪ R_b
```

加后再删可再 add — 新 tag 条件唯一 (** remove only affects observed tags**.

工业 use case: Riak DT Set, Figma multi-collaboration shared states.

### 6. LWW-Register (Last-Writer-Wins Register)

State: value v + timestamp t.
Op `set(v_new, t)`: if t > t_current → set local v to v_new.
Merge: choose side with larger t.

** 注意**: timestamp 比较 wall clock 不安全 (clock skew) — 必须用 monotonic + hybrid clock (HLC)。

### 7. LWW-Map

LWW-Map 不 commute on per-key bases in general. var `m[k] = LWW-Register` for each k. 各 key 之间可并行 update, 同 key 内以 LWW-Register 内部 timestamp 比较——但是 Map.remove + Map.add 同对应 key 时钟对间 race 复杂. Yjs 与 Automerge 都不直接使用 LWW-Map, 而是 nested OR-Set + OR-Map 的变种.

### 8. RGA (Replicated Growable Array) — 协同编辑

RGA 是文字/列表顺序的核心 CRDT, 用 unique ID per element + `after` reference:

```
char id = (timestamp, replica_id), parent_id (前一个 char 的 id)
insert((content, id, parent_id)):
  if parent_id 已在 list:
     insert new entry 在 parent_id 之后, 维护 tie-breaker desc 顺序 by id
remove(id):
  mark tombstone
```

merge: 同时维护所有 insertions + tombstones, 各 replica 收敛 by ID lexicographic compare for siblings.

### Yjs 优化

Yjs 的 YText/RGA 实现 internal “block” skip-list。 每用户写时记录 origin id 但 leaf reading 延 through skip-list 子 BLOCK = O(1) lookup instead of O(N) treewalk. Yjs 是 2017 Kevin Jahns built; Figma 之类 collaborate 编辑器常见路径. 比 Google Docs OT 更 distributed.

---

## 四、CRDT 收敛性证明

### Semilattice

定义: 部分序关系 `≤` 且 任何两元素有 least upper bound (lub) `a ⊔ b`. 

CRDT 状态空间 S 上, `join : S × S → S` 取 lub. `join` 满足:

1. Commutativity: `a ⊔ b = b ⊔ a`
2. Associativity: `a ⊔ (b ⊔ c) = (a ⊔ b) ⊔ c`
3. Idempotency: `a ⊔ a = a`

### 收敛定理

若 op 满足 **commutativity + idempotency** (state-based 中 via join), 则无论 op 顺序, 最终所有 replica 收敛到 `lub(initial_state, all_ops)`。

证明: 每节点最终都 join 所有 ops. 因 join 单调增 + 上界存在 + lub 唯一 ⇒ 各 replica 终态一致。

**关键**: remove ops 如何收敛——simple remove 不 commute (`add a; remove a; merge` ≠ same as `remove a; merge; add a`)。 tombstones 与 OR-Set 都是这个 limitation 的解法。

---

## 五、应用例

### Riak DT

Basho Riak 2.0+ 提供 built-in types:

- `counter`: PN-Counter
- `set`: OR-Set
- `map`: nested CRDT map (counter, set, register, flag per key)
- `register`: LWW-Register
- `flag`: boolean CRDT

bucket API:
```
riak.update_bucket_type("counters", ...)
riak.bucket("counts").update("likes", increment=1)
```

避免了 application 自己组织 sibling merge。

### Automerge

Automerge (2017, Ink & Switch) 是纯 JS library CRDT + JSON documents. JavaScript 的 `automerge.from(initial)` 创 doc, `.change(doc, m => m.todos.push({...}))` 修改. 内部是 OR-Set + RGA + LWW-Map nested.

Atrium, Habit, rtags —— family collaborative paper tool。 Notion-like data stores. 生产环境 slow broadcast presence ensured 跨 DC collaborative editing. 

### Yjs

Yjs 是 Kevin Jahns 写 (2017), 体积小 (60KB JS) + 性能 peak (100+ users simultaneously). 应用: Notion Quip-like collab editor, Atlassian Trello-like product collaborative viewer.

### Redis CRDTs (Redis Enterprise Active-Active)

Redis Enterprise 提供 server-side CRDTs: counters, sets, hashes, strings all sync replicate across 多个 region (active-active). Counter for inventory increments monotone tests no lost update.

### Figma

Figma 的多人实时协作没有直接套用现成 CRDT：文档是嵌套的图形树，通用 CRDT 在其上开销过高。实际做法是**中心服务器定序 + 增量操作流**（类 OT 的简化）：客户端把属性修改作为增量 op 发给服务器，服务器以单一权威顺序广播给其他客户端。每个对象属性对用 last-writer-wins 语义合并，删除与插入用自定义的混合规则处理。配合 CDN 延迟广播降低带宽峰值——**当存在可信中心节点时, 简单定序往往优于分布式收敛协议**, 这是与 CRDT 适用边界的重要对照。

---

## 六、典型问题

### CRDT Tombstone 膨胀

G-/OR-Set delete operation 不真删——保 tombstones for concurrent merge. 长时间 set 加入 + 删除, 数 MB 内存占用. 解决 = GC: 只在所有 replica 都知道 tombstone 存在这之后删—— causal tracking 要 vector-clock GC.

### OR-Set Tag Exponential

Each `add(e)` 生成 new tag. Repetitive add/remove 写 ~100k ops/set 之后, A 与 R set 元素 count baptized millions.

Figma 修复:  used delta-state CRDTs (delta-CRDTs, Almeida et al. 2018) 只广播增量状态.

### LWW with Clock Skew

NTP skew 10ms: client A `set x=A` at T100, client B `set x=B` at T100— inconsistent order ⟹ B not always wins on all replicas.

Fix: HLC + monotonic local count. Riak default uses vclock + wall_ms.

### Concurrent Modes Drops

CRDT Map 的 `remove(k)` + 并发 `set(k, v)`: 一个想 remove k + 但下次 add 想被合并—— 定义文档 differ 不总可predict. Riak DT Map 用 OR-Map "element context" tracking 解决: remove 只 mark "remove removed at observed states", 后加 v 在不同 OR-Set tag, 决战必然附加. 但同时复现 users 见 "k 存在" + "k 不存在" 是 widely ambiguous. 文档 mention this in [ordering](../concepts/ordering.md).

---

## 七、易错清单

1. **CRDT ≠ 任意 sequence 状态兼容**: op 必须 commutative + idempotent, 写 sequence ops (list.append; list.reverse + append; ...)
2. **LWW-Register timestamp mismatch**: 必须 hybrid clock (HLC) + monotonic counter per-node — wall clock alone 不可。
3. **CRDT Map.remove + concurrent Map.set(k, v)** → if not using OR-Set with causal state tracking, 设置 (v) 可能 silently dropped.
4. **Tombstones 必 GC**: OR-Set remove 写 tombstones add up; 必须 GC 与 vector clock 因果跟踪同步.
5. **CRDT 序列化膨胀**: 远远多于 update state after上百 bytes data; 大 apps 需要 delta-CRDTs include 编码驱动的 delta-state ship优化.
6. **协同编辑器要 Carefully handle "anchor"** — 共同 characteristic seed 根 character 0 anchor records to insert下一个 char的位置—— if all char removed, top is not 0 anchor, 而是 deleted anchor with tombstones on the root.
7. **CRDT ≠ Strong consistency**: CRDT 保证 eventual converge + 不会丢更新但 promise 不是 Stale-Snap "see client writes own writes for business" — 保 防epoch: branch sessions need combine with sessionconfig to ensure RYW.

---

## 八、这一章带走的东西

1. CRDT 用 join-semilattice 让免 merge function conflict-free; commutativity + idempotency 是设计原点.
2. 工业常用 CRDT 类型: G-Counter, PN-Counter, G-Set, 2P-Set, OR-Set, LWW-Register, OR-Map, RGA (Text).
3. OR-Set 用 unique tag per add 是正确处理 add-after-remove 的关键, 避开 2P-Set "remove forever" 处理.
4. RGA (Replicated Growable Array) 是协同编辑器的基础 CRDT (Figma Yjs Notion-like).
5. CRDT 的代价: tombstone accumulation + GC complexity; delta-state broadcast 是性能修案.
6. CRDT ≠ strong consistency. only eventual. 与 linearizability (Spanner) 与 RYW (Dynamo) 不同, 财务线 transaction 推荐仍 Paxos + serial.

---

下一节 → [读修复 / 反熵 / hinted handoff](repair.md)
