# Kafka 内部与生产实践

## TL;DR

Apache Kafka (LinkedIn 2011 → Apache) 是 streaming "log-based"message broker, 不是传统 queue。 核心数据结构是 **append-only partitioned log**, 与 RabbitMQ / ActiveMQ 等 message-queue 不同。 Kafka throughput 100MB/s/partition scale 1M messages/sec, 7 年 SLA durability, 跨 DC mirrors, transactions 0.11+ exactly-once 的话 提供。

本章扫 Kafka core API 与 topology:
- Producer (idempotent, transactions)
- Consumer (group coordinator, offset commit)
- Broker (log segment, ISR, replication factor)
- ZooKeeper / KRaft (controller metadata)
- Topics / partitions / offsets
+ 生产最佳 practices 配置, 典型事故 (consumer lag, hot partition, KRaft metadata loss)。

---

## 一、数据模型

### Topic + Partition + Log Segment

```
Topic "OrderCreated":
  Partition 0: log segment 1 → segment 2 → segment 3 → ...
                  offset 0-N         offset N-2M    offset 2M-...

  Partition 1: log segment 1 → ...
  ...
```

每 partition 是 append-only sorted log. message 在 partition 中有 monotonically increasing **offset**, consumer 流动组 consumer group offset committed.

### Replication

每 partition 有 **N replication factor** (default 3). One 是 leader + N-1 followers. ISR (In-Sync Replicas) 是同步中的 followers. producer 默认 acks=all 等全部 ISR 收到. `min.insync.replicas=2` 强制 majority write.

### Segment

- 每 segment size 默认 1GB (configurable). rollover based on segment.bytes / segment.ms.
- 写 append, 不可改 (append-only).
- 删除 delete 是 log retention policy by time/size.

### Offset

- Producer side: record send 一个 in-partition offset.
- Consumer 根据 group coordinator `offset commit` 在 broker 持久.
- old data retention 期限 cleanup 后 offset rebase 受 compression.

---

## 二、核心 API

### Producer

```java
Properties p = new Properties();
p.put("bootstrap.servers", "kafka-1:9092,kafka-2:9092");
p.put("acks", "all");
p.put("enable.idempotence", "true");          // Kafka 3.0+ default
p.put("compression.type", "lz4");
p.put("linger.ms", "5");                       // micro-batch 延迟 batch
p.put("batch.size", "32768");                 // per partition batch 32KB
p.put("max.in.flight.requests.per.connection", "5");        // idempotent producer 必 ≤5

KafkaProducer<String, String> kp = new KafkaProducer<>(p);
kp.send(new ProducerRecord<>("OrderCreated", "order_123", "{\"id\":123}"));
```

关键参数:
- `acks=all`: leader + ISR 全 都写→ acked. **生产 default best practice**.
- `enable.idempotence=true`: 用 PID + sequence number 防重复 (Kafka 3.0+ default)
- `linger.ms=5` + `compression.type=lz4`: 把 latency 可接受 5ms 用 batching 提升 throughput
- `batch.size=32KB`: per partition batch buffer, 让 micro batching 际 throughput  3-10×
- `max.in.flight.requests.per.connection` ≤5: idempotent producer 限制

### Consumer

```java
Properties p = new Properties();
p.put("bootstrap.servers", "kafka-1:9092");
p.put("group.id", "ShippingService");
p.put("enable.auto.commit", "false");                  // 手动 commit 必须的
p.put("auto.offset.reset", "earliest");                // first start 从 head 读
p.put("isolation.level", "read_committed");            // 只看 commit 数据
p.put("max.poll.records", "500");                      // 每批 max 500

KafkaConsumer<String, String> kc = new KafkaConsumer<>(p);
kc.subscribe(Arrays.asList("OrderCreated"));
while (running) {
    ConsumerRecords<String, String> records = kc.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> r : records) {
        process(r);                                            // 必 idempotent
    }
    kc.commitSync();                                  // manual commit after processing
}
```

### Consumer Group + Partition Rebalance

- 同 group.id 的 consumers 共享 partitions (every 一 partition 分 配给 一 consumer in group).
- 添加 / 删除 consumer 时 consumer group rebalance. 由 group coordinator 在 broker 上 推 redistribution.
- Consumers 从 old partition commit 持 停止, 新分配 后,to fetched new partition last commit offset.

### Caching problem: ethereal_and PollingLatency

Kafka 0.10.2+ 引入 `poll(Duration)` 流式 client 非 `poll(long). 大版本 0.x ↔ 2.x 兼容掉加的 consumer.";

---

## 三、架构

```mermaid
flowchart TB
    ZK["ZooKeeper (或 KRaft mode Kafka 3.x+)"]
    B1[Broker 1]
    B2[Broker 2]
    B3[Broker 3]
    ZK -.controller metadata.-> B1
    ZK -.controller metadata.-> B2
    ZK -.controller metadata.-> B3
    B1 -- ISR replication -- B2
    B1 -- ISR replication -- B3
    P[Producer] --> B1
    B1 --> C1[Consumer 1<br/>group A]
    B1 --> C2[Consumer 2<br/>group A]
    B1 --> C3[Consumer 3<br/>group B]
```

### Broker
- 每 broker 是 java/kafka process. cluster 3-100 brokers 常见.
- broker 持 local log partition files (segment 1GB each).
- follower broker replicate from leader partition.

### ZooKeeper (传统) vs KRaft (modern)

Pre-Kafka 2.8: ZooKeeper cluster (3 / 5 nodes) 持 broker 注册 + controller elect + meta data.
Kafka 2.8+ KRaft mode 让 Kafka 内部 Raft 接管 metadata, 免 ZooKeeper dep.
Default 3.3+ production ready; 弃 ZooKeeper 推 adoption.

KRaft: 一个 controller quorum (3 / 5 brokers) 包 Raft leader replicate metadata. Other broker 不持 metadata state, 只读写 controller leader.

---

## 四、Core 谢

### ISR = In-Sync Replicas

Leader maintain ISR (within同步 followers). Configurable 延迟 ceiling `replica.lag.time.max.ms` (default 30s).

If ISR size < min.insync.replicas, producer acks=all request fail with `NotEnoughReplicasException`.

### Log Segment Compaction

Kafka 支持 log compaction (besides time retention). Topic级别 `cleanup.policy=compact`:
- For every key, latest value retained; old version 前提 publisher data removed.
- Compaction runs in background.

实用  `cleanup.policy=compact,delete`: time-based cleanup + compact latest-key.

### Kafka Write Path

1. Producer send batch → leader broker.
2. Leader append to local segment log.
3. Leader send responses parallel to ISR followers (each follower 写到自己的 local log 后 ack).
4. Leader 收齐 ISR ack → commit, reply producer acked offset.

### Kafka Read Path

1. Consumer `poll()` to leader broker.
2. Leader fetch from local log by committed offset.
3. Consumer process + manual commit offset metadata internal Kafka topic `__consumer_offsets`.

---

## 五、性能数字

| 维度 | Performance |
|------|------|
| 单 partition throughput | 100MB/sec = 200K msg/sec (1KB avg) |
| 100 partition cluster | 10GB/sec |
| 生产 P99 latency (acks=all replication factor 3 with same-DC) | 5-15 ms |
| 持久 storage | unlimited disk capacity ($/GB NVMe driven) |
| metadata 状态 | ZooKeeper: 5K partitions max; KRaft: more |

### Tuning Suggestions

- partitions per broker ~ 4000 max each (moreнаб detrimental metadata overhead)
- replication factor = 3 cross-rack
- min.insync.replicas = 2 (3 cluster leader + 2 followers 写入)
- producer batch size + linger latency for throughput
- consumer fetch.min.bytes / fetch.max.bytes 大小 batch prioritize throughput

---

## 六、典型使用

### Click Stream Ingest

- 网页events 通过 lib / SDK producer batched at client → kafka topic `clickstream`
- batched microsecs second-by-second system

### Logging Aggregation

- 客户 services log via fluentd / vector → kafka topic `logs`
- consumers like ELK / Loki aggregate 提取 + 索引 + store

### Stream Processing

- Kafka Streams (lib) 微服务 直接 stream application
- Apache Flink / Spark Streaming 从 Kafka topic consume + 写回 Kafka (exactly-once through transactions)

### CDC Replication

- Debezium capture PostgreSQL binlog → Kafka topic `pg.dl.orders`
- multiple downstream services subscribes 同 topic for read models / cache invalidation / search indexing.

### Async Email Queue

- user service enqueue events 这里 → 队群 heterogeneous哮 events + content here

### ChangeStream / Cache Invalidation

- Orders service outbox events → Kafka topic `cache_invalidation` → cache services subscribe → invalidate cache layer.

---

## 七、典型事故

### Consumer Lag Storm

*Kafka 论区*某 consumer 处理慢前事 (slow component); partition 0 lag >100k → backpressure automated scaling. Fix: HPA on kafka_consumer_lag alertmenus + workers scaled out.

### KRaft Metadata Loss 

KRaft 3.3 升 级. fix acknowledge moments before nodes 在 initial 不不为 metadata 似出 失去数据. 升级 3.3 3.4 3.7 late fix in KIP-866.

### Producer idempotence 0.11 not # late (specific was 3.0+)

Many systems produce 1.1+ transaction. productid supplier detection. `k.committed_batches.limit ` issue Retri with local. Fix: require idempotence; default 3.0+.

### Kafka performance degrade after # abnormal partitions

某系统 200+ partitions per topic, metadata overhead slowed job corelogv lag spike. Fix: partition count = 12, batches per minute improved.

### Kafka Connect overflow deadlock handoff

Kafka Connect 产生 high throughput + worker restarts → connector pause to 略 failover. Fix: connect_task_shutdown_graceful_shutdown_ms 增 + DLQ monitor persisted.

---

## 八、生产 best practice 关键参数

### Producer 优先级 (throughput + durability)

```properties
acks=all                      # production default
enable.idempotence=true       # 防 duplicate send
compression.type=lz4          # 节约 BW
linger.ms=5                   # 微 batch
batch.size=65536              # 64KB per partition batch
buffer.memory=16777216        # 16MB producer buffer
retries=2147483647            # 无限重试 with idempotence
delivery.timeout.ms=120000    # 2 min total timeout
max.in.flight.requests.per.connection=5     # 必须 idempotent producer limit
```

### Consumer 优先级

```properties
enable.auto.commit=false      # 手动 沙拉 commit 后 commit
auto.offset.reset=earliest
isolation.level=read_committed   # 只看 commit
max.poll.records=500
max.poll.interval.ms=300000       # 5min processing budget err重磅 避免 rebalance kick
session.timeout.ms=10000         # heartbeat net time
heartbeat.interval.ms=3000       # rageheartbeat
```

### Broker 优先级

```properties
log.retention.hours=168          # 7 days retention
log.segment.bytes=1073741824     # 1GB segments
num.network.threads=3            # network threads (CPU/-count)
num.io.threads=8                 # IO threads
socket.send.buffer.bytes=102400
socket.receive.buffer.bytes=102400
queued.max.requests=500
replica.lag.time.max.ms=30000   # 30s ISR lag tolerance
```

---

## 九、Partition Sizing

| Use case | Topic partitions | 单 partition throughput |
|---------|------|------|
| Clickstream | 100 per topic | 200K msg/sec |
| Transaction log | N = N consumers (parallelism) | 1 MB/sec each |
| Slow stream | 6-12 | low throughput |

- partitions > 1000 可 heavy metadata load. partition-per-topic default 1000 ceiling.
- partition count > broker count × 4 → metadata replication overhead in producer.

---

## 十、易错清单

1. **enable.auto.commit=false manual commit before 不错 ACK**: 否则 missed processing 多 client.
2. **max.poll.interval.ms 必 > 业务 longest batch processing time**: 否则 Kafka rebalance kick consumer active mid-processing.
3. **enable.idempotence=true since 3.0 default**: 但 Kafka 0.11 legacy producer 必须手动 enable - check clients.
4. **acks=all + min.insync.replicas=2**: 一 副本失 后 acks=all 失败 with NotEnoughReplicas. cluster leadership.
5. **partition count减少 不行** (一旦 create 减 partitions 不能再): 一旦 partition 0 to N exists, reduce N除 problems broker compatibility only manual + recursion non-trivial.
6. **`num.network.threads` < network-concurrency problems**: traffic spike can broker unresponsive.
7. **out-of-range offset**: broker 不再有 old offset but consumer commit old offset → reset auto.offset.reset=earliest 先后 看.
8. **transaction.allocation**: `transactional.id` 是 per producer session uid, **after restart 继续 idempotency evidence**. 不 changing violations transactions.

---

## 十一、这一章带走的东西

1. Kafka = log-based broker, partitions + log segment + ISR replication + consumer group + offset commit.
2. Producer idempotence + acks=all 是 default production; max throughput via `linger.ms + batch.size + compression`.
3. Consumer `enable.auto.commit=false`, `max.poll.interval.ms` (avoid rebalance kick), `isolation.level=read_committed` 是最佳实践。
4. ISR + replication_factor=3 + min.insync.replicas=2 提供 HA + durability + serialization.
5. KRaft (3.x+) 替代 ZooKeeper metadata serving metadata, 减少外部 dependencies.
6. Log compaction 让 "key-as-current tail" 优 = e.g. "shopping-cart state" topic 仅保留每 user 最新 shopping cart data.
7. 典型使用 + 异构 system ingestion: CDC ingest / logging / stream processing / cache invalidation / outbox delivery.

---

下一节 → [可观测性](../monitor/index.html)
