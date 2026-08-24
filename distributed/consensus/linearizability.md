# ZooKeeper / etcd / Linearizability

## TL;DR

**ZooKeeper** (Yahoo! 2008 → Apache) 与 **etcd** (CoreOS 2013 → CNCF) 是分布式系统协调 (coordination service) 的工业 fact 标准。共同形态: 一个 small consistent KV/znode 存储 + 复制原语 + 通知/watch API + 配置中心 + 服务发现 + leader election + 分布式锁 + 元数据存储。ZooKeeper 用 ZAB (ZooKeeper Atomic Broadcast, Paxos 派生), etcd 用 Raft。 本章梳理 ZAB 对 Paxos 的关键优化、ZK 数据模型 (znode / ephemeral / sequential / watch) 与 session 机制、etcd 数据模型 (flat KV + lease + watch stream + compaction)、二者的 linearizability 实现(以及为什么默认 ZK 读不是 linearizable, etcd 默认是)、典型误用 (double-watch, ephemeral session reset) 与生产事故。

---

## 一、ZooKeeper 架构

### ZAB 协议

**ZAB (ZooKeeper Atomic Broadcast)** 是 Flavio Junqueira 2008 设计的 Atomic Broadcast (Total Order Broadcast) 协议, 类 Paxos 但为 "log replication" 优化. 两个阶段:

1. **Phase 1: Discovery + Synchronization (Leader Election)**: 
   - FastLeaderElection 选 leader (bully algorithm 派生)
   - 与所有 follower 同步: leader 把自己 last zxid 上所有 entries 复制到 followers /**/**,** 部分写到的 followers truncate divergent suffix**, 落后 followers 拉补议 missing entries.
2. **Phase 2: Broadcast (Multi-Paxos-style log replication)**:
   - leader 接收 client write → 生成 zxid (单调增) → broadcast PROPosal 到所有 followers → majority 收到 → commit → broadcast commit.

### zxid

zxid 是 64-bit 全序 monotonically-increasing id 由 epoch + counter 合成:

```
zxid = (epoch << 32) | counter
```

epoch 是 每次 leader 切换自增一次; counter 每个 transaction 自增 1。 让 follower 通过 `zxid` 比较"在 log 哪里", 也让 client 记 session last seen zxid 用作 failover recovery.

### ZNode 数据模型

ZK 是 **hierarchical tree**, 路径如 `/app/services/api-1/config`:

| 节点类型 | 行为 |
|---------|------|
| **Persistent** (持久) | 直到显式 delete, 客户端 disconnect 不删 |
| **Ephemeral** (临时) | 客户端 session 结束自动删 (session timeout default 30-40s) |
| **Sequential** (顺序) | 创建时 ZK 在路径尾追加 monotonic counter, /leader-elec/node → /leader-elec/node00001 |
| **Container** (容器, 3.5.6+) | 子节点全删后自动 delete, 避免 ephemeral 留 stale parent |
| **TTL** (3.5.6+) | 在一段时间无被修改+无子节点时自动 delete |

### Watch 机制

```python
zk.exists("/lock", watch=True)  # 一次性回调, 节点变化触发

# 3.6+ 引入 persistent watcher: 注册后持续触发直到移除
zk.addWatch("/foo", persistent=True)
```

**坑**: 旧一次性 watch 在事件触发与 client register next watch 之间存在 race window, 可能 miss 中间变化。 Best practice: register 再 getData/getChildren (这是 "double register" 模式). 3.6+ PersistentWatcher 是正确做法.

### Session 机制

每个 client 连接有一个 **session**, 标识 session_id + 64bit password。 session timeout 配置(e.g., 30s). client 与 server 之间周期 ping, 任**一 server** 看到 session 客户端活动延长 session 的 expiry。

若 client 与 majority server 长时间断连超 timeout → session expired → 所有 ephemeral node delete → watches trigger → 业务层若用 ephemeral 模拟占锁就**释放锁**。 这是 ZK distributed lock 模式核心。

### 读取 Type

- **Default read** from **任何 follower**: NOT linearizable, may return stale.
- **Sync() before read**: follower 先发 SYNC RPC 让 leader 告诉它 last committed zxid, 等 follower apply 到该 zxid 再回复 client → linearizable read。代价 ~1 extra RTT。

---

## 二、etcd 架构

### Raft + BoltDB

etcd v3 用 Raft (基于 etcd-raft lib, contributors 后抽出来为 hashicorp/raft) 复制所有 KV 写到 multi-replica log, 应用组 raft log 之后 commit 到 BoltDB(纯 Go kV store, 内存 + mmap)。 etcd 存储模型是 **flat KV** (不是树), key 是 string, value 是 protobuf-encoded struct。

### Lease + TTL

etcd v3 引入 **Lease**: 客户端 grant 一个 lease(分配 64-bit lease_id, TTL 例如 30s), 然后将 keys 绑到该 lease。 lease 与 ZK session 行为相似—— lease TTL 到期 no keepalive → 该 lease 上所有 keys 自动 expire。

Lease 比 session 轻——一个 client 可同时持多个 lease，把不同语义的 keys 隔离 (e.g., service discovery keys vs config keys 各一 lease)。

### Watch stream

etcd v3 watch 用 **gRPC server streaming**:

```go
watcher := cli.Watch(ctx, "/foo/", clientv3.WithPrefix())
for resp := range watcher {
    for _, ev := range resp.Events {
        // ev.Type == PUT/DELETE
        // ev.Kv.Key, ev.Kv.Value, ev.Kv.ModRevision
    }
}
```

watch 是 **persistent stream** (不像 ZK 一次性), 触发不会 stream 中间 watch reset, 避免一次性 watch 的 race window。 stream 内 events 包 `ModRevision` (全局 revision 单调增), client 用 `store.Revision` 收齐 previous events 至 current revision.

### MVCC + Compaction

etcd 是 **MVCC (multi-version)**——每次 key 写入保存历史 revision(类似 Spanner 用 ts)。 这让 watch 能从任意历史 revision 开始 replay events。 Compaction 是后台 GC—— `cli.Compact(ctx, rev)` 删除所有 < rev 的旧版本, 释放磁盘。

### Linearizable vs Serializable Read

```go
// 默认 Linearizable: 通过 leader / ReadIndex / Lease Read 实现
cli.Get(ctx, "/key")

// WithSerializable: 走 follower 本地 read, 不 consensus check, 可 stale
cli.Get(ctx, "/key", clientv3.WithSerializable())
```

默认 linearizable = etcd 用 leader + ReadIndex (1 RTT) 确认仍是 leader, 等本地 state machine apply 到 read index, 返回 client。若客户端跟 leader 不在同一集群需 follower forward 读则产生 ~3-5ms latency。

---

## 三、ZK vs etcd 工程比较

| 维度 | ZooKeeper | etcd |
|------|-----------|------|
| 协议 | ZAB (Paxos variant) | Raft |
| 存储模型 | znode tree (hierarchical path) | flat KV (但 prefix range query) |
| API | 自定义 binary, Java primary | gRPC + protobuf, multi-language |
|Watch 模型 | 一次性 callback (3.6+ persistent watcher) | gRPC streaming, persistent by default |
| Session 模型 | TCP session | lease + TTL |
| Read 默认 | Follower local read (stale) | Linearizable leader read |
| 客户端代码 | Java/Python/C client, ZK lib per ecosystem | Go/Java/Python/etc., gRPC stubs everywhere |
|典型部署 | ~5 node cluster, JVM heap ~4GB | ~3-5 node cluster, 默认 2GB data disk |
| 工业用 | Hadoop, Kafka 旧版本, Solr, HBase leader | Kubernetes (1.20 之前) , TiKV, TiDB, Rook,不少 CNCF project |

### 为什么 K8s 换成 etcd

ZK 用 JVM 内存大, 升级 JVM GC pause 长(~500ms), 导致 watch 重连, 偶发 5-10s service disruption. etcd 用 Go ~5MB binary + mmap 持久存, GC pause <100ms, 适合 latency-sensitive Kubernetes control plane。 K8s 调用 etcd 平均不到 5ms, 远好于 ZK 的 30-100ms cluster median.

但 ZK 在 **大数据生态** (Hadoop、Kafka 老 / Solr Cloud / HBase master election) 仍占主流——因为生态已建立在 znode 树之上, migration 成本高, 性能也 ok。

---

## 四、Linearizability in Practice

### 形式 reminder

Linearizability (Herlihy-Wing 1990): 所有操作可被嵌进一个 total order, 使 (1) 顺序是 sequential-legal, (2) 与 real-time order 相符(若 op1 完成 before op2 开始)。

### ZK 与 etcd 的实现策略

**ZK**: **default read 不是 linearizable**, 走 follower local state。 要 linearizable 必须 client 主动 `zk.sync()` 然后 `zk.get()` (1 extra RTT)。 多数 SDK wrapper 自动调 sync, 但 client 直 ZK API 时常忘记 → "短暂读到旧值"是误用常态。 ZK 3.4+ 已有线 negative caching + 非正式 linearizable read 但**不**AMLRT.

**etcd**: default read **linearizable**, 通过 ReadIndex 实现. 代价 1 RTT (~5ms local, 30-100ms cross-DC).If client opt-in `WithSerializable()` 可走 follower read 但放弃 linearizable。

### Distributed Lock with Linearizability

如果不 linearizable, distributed lock 实现 broken:

```
client A: acquire lock
client A: GC pause 10s
client B: 超时 acquire lock (skip expired A lock)
client B: 进入 critical section
client A: GC resume, 仍以为持有 lock
→ 两个 client 同时 critical section。
```

修: ZK 与 etcd 都通过 **fencing token** + 各 critical section 端用 token dispose 查: 后到者 violates token order, server reject write。 这种 token 在 ZK 用 ephemeral-sequential child znode 的 seqnum, etcd 用 lease + ModRevision。

Martin Kleppmann 2016 "How to do distributed locking" 论证 fencing token 是关键, 没 token distributed lock 不安全。

---

## 五、典型误用与事故

### ZK Double-Register Watch Event Loss

```python
def watch_callback(event):
    # 处理事件
    pass

zk.exists("/lock", watch_callback)
zk.get("/lock", watch_callback)
```

两次注册同时 watch, 触发只 fire 一次, 中间 event 可能 miss (callback 内 "执行业务" 然后 register next watch, 但 register 期间 ZK 触发新 event 已发出但本地 callback 没 hook)。

Fix: persistent watcher (3.6+) 或 callback 同步 register。

### etcd Watcher Notification Loss

etcd v3 watcher 有 `compacted revision` check —— client 启动 watch 时指定 `rev=N`, 但若 server 已 compact rev > N → server returns `compactionRev > N` 错误 → client 必须处理. 没处理 → silent miss events.

Fix: client 监控 compaction event, 加 rewatch from currentRev + 业务级 reconciliation。

### ZK Session Reset Storm during GCP Maintenance

2021 GCP 维护期间 ZK leader 重启且 follower 网络抖动, 多个 client session 触发 reset, ephemeral nodes 大批 delete, leader election 触发 stampede——服务 dev machine 不在平分钟 de Leader elect expon为 backoff 后 渡过. Fix: client SDK 加 randomized election retry + jitter.

### etcd mvcc: database space exceeded

etcd 默认 2GB data backend, 长期写入但**没定期 compaction** → 满磁盘 → 拒收 new writes → cluster 进入 paused 状态. Fix: cron compaction (`etcdctl compact $rev; etcdctl defrag`), 或 `-auto-compaction-retention=1h` 自动 compact.

### K8s API Server "STW: timeout waiting for etcd"

etcd cluster quorum 失(2 of 3 down) → K8s API server 阻塞所有写(Pod schedule、ReplicaSet 都 stop)。 多个 K8s 集群挂报告有关 etcd 的 root cause, 推荐**低 fsync latency NVMe** disk + **足够大 heap / high net bandwidth** + **不要在 low-IOPS disk 上跑 etcd**—— disk IO 是 etcd 实际 P99 latency 决定因.

---

## 六、易错清单

1. **ZK read 默认是 follower-local stale, 不是 linearizable** — 必须 `sync()` 再读, 多数业务 case 不在意 stale 才可弊。 一定业务用 fenced.
2. **ZK ephemeral session 不是客户端 single conn** — session 跟 ZK quorum 持久, client 切 connection 不 reset session; 直到真 timeout(默认 30-40s)才 expire。
3. **etcd 默认 KV 是 MVCC** — Watch 必须 catch compaction 错误(`<rev compacted`), 否则 silent miss。
4. **etcd lease 续租必须 heartbeat ignore failure** — gRPC client 必须周期 `lease.KeepAlive()`, 超过 TTL lease 自动 expire + keys 删, 业务回滚。
5. **Distributed lock 没 fencing token 不安全** — even with linearizability, long GC pause 仍可双 client 进 critical。 fencing token (znode seq / ModRevision) + critical section side verify 是 must.
6. **ZK watch 一次性** — 旧 API trigger 后必须 re-register, re-register 与新 event 间有 race; 用 3.6+ persistent watcher 或 careful double-register。
7. **etcd linearizable read 不是 0-RTT** — 默认是 1 RTT leader check, cross-DC 部署时必算这个进 SLA。
8. **multi-region ZK/etcd 慎重** — 跨洲 ping 200-300ms, leader lease renew 需要 cross-DC heartbeats, 业务抖动会触发不必要 election。可用 multi-cluster + cross-replicate (MirrorMaker-like) 不直接 multi-DC ZK。
9. **ZK 5 节点不是"5个 9 可用"** — true availability 取决于 election timeout、客户端 retry、long GC pause → client sessionId. 5 节点让你忍受 2 节点死但仍写。

---

## 七、这一章带走的东西

1. ZK 用 ZAB (类 Paxos), etcd 用 Raft; ZK-生态大数据为主、 etcd-生态 CNCF/K8s 为主。
2. ZK 数据是路径树 + ephemeral + sequential + watch; etcd 是 flat KV + lease + persistent watch stream + MVCC。
3. ZK default read 是 follower-local(stale, 需 `sync()`), etcd default linearizable (1 RTT ReadIndex)。
4. etcd MVCC: watch 必须 handle compaction error, 否则 silent event lost。
5. Distributed lock 必带 fencing token (ZK ephemeral-sequential seq num / etcd ModRevision) 防止双 client 因 GC pause 同时进 critical section。
6. Linearizability 是默认承诺(etcd) vs 外加承诺(ZK)的工程取舍, 影响测试用例 baseline。
7. 集群 quota / disk IO / GC pause 是 etcd 在 P99 下破裂的根本; ZK 是 JVM 重启损失.

---

下一节 → [复制](../replication/README.md)
