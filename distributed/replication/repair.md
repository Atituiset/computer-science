# 读修复 / 反熵 / hinted handoff

## TL;DR

AP 系统 (Cassandra / Riak / Dynamo / Voldemort) 在 partition 或 transient node failure 时, **W=quorum** 未达成全副本复制, 一些副本持有 stale 版本。 复制差异最终必须**修复 (anti-entropy repair)**, 让所有副本最终收敛一致 state。 三种主流修复路径:

1. **读修复 (Read Repair)**: read 时若发现副本返回 stale value, 立即推 修复—— 顺路修复, 不消耗额外 background IO。 高频 read key 友好, 但 cold key 收敛慢。
2. **反熵修复 (Anti-Entropy Repair)**: 后台周期性扫, 用 Merkle Tree 算"diff 副本它们不同 range", 只推 missing / newer ranges。 跨大副本 / 数据量大时必备, 代价是后台 IO 与 CPU。
3. **Hinted Handoff**: 副本 unavailable 时, coordinator 把 write 暂存本地 (hint), 该副本回来后 coordinator 转发 hint。 短期 outage 的 hot-path repair。

---

## 一、读修复 (Read Repair)

### 算法

Cassandra 等 Dynamo-style AP 存储 default path:

1. Client `get(key)` → coordinator。
2. coordinator 选 R replicas (R = read consistency level, 比如 LOCAL_QUORUM=2 / ALL=3)。
3. 各副本回 value + 写 timestamp (或 vector clock)。
4. coordinator 比较所有 R 回响应, detect stalest replicas。
5. coordinator **(异步 / 同步)** 推 修复 write 给 stalest replicas (read repair)。
6. coordinator 给 client 返回 newest value。

### Cassandra 配置项

- **`read_repair='BLOCKING'`** (3.x): coordinator 等 read repair ack → reply client; 一致性最严 + 延迟长 (slowest replica 的 latency 影响 P99)。
- **`read_repair='NONE'`** (4.0 default): 不修复, 立刻 reply client, 假设 background anti-entropy 修复 staleness。
- **`read_repair='BACKGROUND'`** (3.x 有些版): reply client 立刻, async 修复。
- **`speculative_retry`**: if first R-1 副本 50ms 内未回 → speculative 再发 RTT 触发额外 read; 提升 P99 latency 避开慢副本。

### Riak Default

Riak 设 bucket property `allow_mult=true` 时返回 vector clock siblings 给 client, 客户端要 resolve + push back 来修复 (推荐 pattern)。 `last_write_wins` mode 下 Riak 自动 LWW 决定, read repair 写 newest value 到 stalest replica。

### Read Repair Cost

- **Hot path 延迟**: 同步模式 = slowest replica latency (可能 +50-200ms)。
- **Bandwidth**: 重要 read data ~500B + 写回 stale replica ~500B 每修复。
- **Effectiveness**: 高频 read / popular keys 修复 fast; **cold keys** 从未被 read → read repair 不触发 → 必须靠 anti-entropy。

### 适用场景

- 小 / 中等 key 高频 read (e.g., 用户 profile, session data)。
- replicas 基本同步, 偶发 divergence。
- 不适场景: archive, 写冷数据 → cold-key cover 需 anti-entropy。

---

## 二、反熵修复 (Anti-Entropy Repair) 与 Merkle Tree

### 原理

定期 / on-demand 后台扫各 replica, 找出 range 内 data differences, 推送 missing writes 给 stale replica. Brute force 不行——拷贝几 TB data 比较 byte 不现实。 **Merkle Tree** 是分布式 hash 树:

```
                  [root hash]
                  /     |     \
           [h_a]   [h_b]   [h_c]
           /  \    /  \    /  \
       [leaf] [leaf] ...
       hash(key1+val1)
```

- 叶子 leaf = hash(key + value + timestamp + vclock)。
- 内部 node = hash(子哈希)。
- root hash 字符串拷贝便宜; 若两副本 root 相同 → range 不需 repair。
- 子树深度递归下钻, 直到找出 diverged leaves, transcribe 仅 missing keys。

### Cassandra `nodetool repair`

- **`-pr` (partitioner range)**: 仅本地 token 范围, 减少跨节点做 work (Cassandra 4.0+ default)。
- **`-seq` / `-full`**: 整 ring 全检, 慢但 comprehensive。
- **`-inc` (incremental)**: 增量修复, 只修上次修复后变化的 range; 4.0+ recommended。
- **`-local`**: 只本 DC repair 节点。

predicted 量: 100GB incremental ~30 min; full 5-8 hours。

### Riak Active Anti-Entropy (AAE)

Riak 1.4+ 全自动 AAE:

- 后台 process 周期 (per vnode, 默认每 1 小时) 扫各 vnode Merkle Tree。
- Hot key Index: hash index 键 + bucket 时间, quick detect diff。
- difference detected → 自动 parallel read_repair per vnode。

### Dynamo 2007 — Anti-Entropy Origin

Amazon Dynamo 2007 paper 提了 anti-entropy + read repair 作为修复机制。 Dynamo 用 Merkle Tree per replication group, 周期 + on-demand 调用。

---

## 三、Hinted Handoff

### 算法

如果 coordinator 应该 write 给 replica B, 但 B unavailable:
- Coordinator 把 write 暂存本地 "hint", 配置 hint TTL (Cassandra `max_hint_window_in_ms=3h` default)。
- B 回来 → coordinator 把所有 hint 转发给 B, 顺序应用。
- Hint 在 coordinator 重启后也持久化保不丢。

```python
def handle_write(key, value):
    live_replicas = []
    for r in target_replicas:
        if write_to(r, key, value).ok:
            live_replicas.append(r)
        else:
            store_hint(locally, r, key, value, expire_at=now + 3h)
    if len(live_replicas) >= W:
        return OK        # quorum met
    return WRITE_FAILURE

# 后台 loop periodically retry hint:
for hint in local_hints:
    if hint.target_node.alive:
        send hint to target_node
        if send.ok:
            delete local_hint
        if hint.expired:
            delete      # 警告: hint expired = RPO 可能丢数据
```

### Cassandra Hinted Handoff

- 持久化 hint 到本地 commit log + hint file。
- `max_hint_window_in_ms` 默认 3h; 超过窗口不用 hinted handoff, 等下次 anti-entropy repair。
- Beta 4.0+ 提供 `hinted_handoff_throttle` 限速, 防 hint replay 风暴打 target CPU。
- Hint 重启后读 hint 文件 replay。

### Dynamo 2007 Hinted Handoff

Dynamo 用 hinted handoff + Merkle 周期性 sweep 同时修复 + 客户端 put / get 继续走 quorum — 短期 outage 透明。

### Riak / Voldemort 类似

Riak 与 Voldemort 类似 hinted handoff: Coordinator 写给某 replica fail → store locally; Later node 回来 → forward。

---

## 四、何时用哪种修复

| 修复 | 触发 | 修复时间 | 修复范围 | 用例 |
|------|------|---------|---------|------|
| Read Repair | client read 时 | 立即 (on read path) | 仅该 read 的 key | 高频 read key 修, 突发 partition 短断 |
| Hinted Handoff | target replica unavailable 时 write | 节点恢复后 | 仅 temporarily down node 的 keys | 短期网络 partition / 滚动 rolling restart |
| Anti-Entropy | 后台周期 sweep | minutes-hours | 整 token range merkle tree diff | cold-key 修, 长期 divergence 收敛, node add/drop 后 re-balance |

工业 best practice:
- 短期 outage: Hinted Handoff (小时级别)。
- 持续 divergence (cold keys, compaction 后 stale): anti-entropy scheduled 每周 (+ incremental repair)。
- 高频 read popular: Read Repair (自动)。

三种修复不冲突——并行 run。

---

## 五、Merkle Tree 实现细节

### Sub-Range Hashing

Cassandra: Merkle Tree per token-range (默认 16-256MB per range)。

Cassandra `nodetool repair` 流程:
1. coordinator 选 partner 节点, exchange Merkle root hashes per range。
2. 若 root 不等, 递归 exchange 子树 (e.g., 256KB sub-range, 16-level depth)。
3. 找到 diverged leaves, 仅传 missing keys。

### Compression 友好

Cassandra Memtable flushes 转换为 SSTable + bloom filter (range filter); compaction 阶段产 leaf hash derived from row-level hash per token; diff derived streams 转化成 "newest timestamp entries" pulled over stream replication。

### Full vs Incremental

- **Full repair**: 重新读整个 range, 重新算 Merkle Tree, 节点间交换。
- **Incremental repair** (Cassandra 4.x default): 监控表维护 `repaired_at` timestamp per range, 基于 sstable max timestamp 仅修 recent 改动。 性能 ≈ 增量 repair 坦率性更高。

Riak & Voldemort 也有类似概念。

---

## 六、典型事故

### Cassandra "Hinted Handoff 迟滞 死亡信封" 2014

某用户 9 节点 Cassandra cluster, 5 节点 rolling restart, 各累计 ~40 GB hints 等待 transfer。 重启节点承接 40GB hint replay 5 小时, throughput 降到 1/10。 Fix: `hinted_handoff_throttle_in_kb=1024` 限速 + `max_hint_window_in_ms=1h` 短保更大窗口原始 accumulation。

### Riak Active Anti-Entropy 后台 Memory Spike

Riak AAE 30 分钟扫 all keys build Merkle Tree, 100GB keys 内存写入 ~1GB Merkle Hash-tree, full spike 推 OOM。 Fix: 后台 AAE 限速 + 滚动 segment 设置 (`anti_entropy_slice_size` 调小)。

### Cassandra Full Repair Long Window

2018 NoSQL benchmark: full repair 5 hours 在 50M-key cluster, 期间流量被 backend read 争 IO 拖降 throughput。 Fix: incremental repair + 分批 parallel `-pr` 修 range。

---

## 七、易错清单

1. **Hinted Handoff 必须持久化至 disk**: coordinator crash 后重启才能 replay hints; Cassandra `hints_directory` 配置默认在 data 目录, 写满 disk 会拒绝新 hint。
2. **`max_hint_window` 不能太长**: 长时间 partition 累 hints 风暴; 超过窗口的 write 不再保, 必须靠 anti-entropy 修。
3. **Read Repair 不修冷 key**: 用 monitoring 看 read-throughput; cold-key 数据必跑定期 anti-entropy。
4. **Anti-Entropy repair 不要在峰值跑**: 它吃 IO + CPU + 网络带宽, 与 production 流量争资源, 通常选夜间 / weekend 窗口。
5. **Merkle Tree 内存代价**: 树大小与 range size + key count 成正比, 大 cluster 必须 range partition 加 incremental, 不能全 ring sweep。
6. **Anti-Entropy 加 token black-list**: 把 corrupt key 加入 quarantine, 不然 anti-entropy 让 corrupt 键 propagate 到 healthy replica → silent 数据丢失。
7. **Hint expired 不重写**: 超过 `max_hint_window` 后 write 未送, 客户端已收 ack → 默默丢失; retention SLA 必须明确接受多长 window。

---

## 八、这一章带走的东西

1. 读修复 在 read path 顺手修 stalest replica, 高频 read keys 收敛快但 cold-key 靠 anti-entropy。
2. Hinted Handoff 是 short-outage 透明写入 + 节点恢复 replay; TTL 受限不然 hint expire → 行 SLA 风险。
3. Anti-Entropy repair 用 Merkle Tree 计算 range diff, 增量修复 + 周期性 full repair 兼顾。
4. 三 修复路径不冲突——并行 run; 工程实践中 hint < hour outage, anti-entropy 每周 / 每 12 小时 incremental。
5. Merkle Tree 内存代价 + IO 代价是反熵约束, 大 cluster 用 range 分片 + incremental `[pr]` 模式修。
6. Anti-Entropy 必须 durability 检查; 否则 corrupt 键 propagate 到 healthy replica 是 silent 数据丢失最可怕的事故。

---

下一节 → [时钟与顺序](../clock/index.html)
