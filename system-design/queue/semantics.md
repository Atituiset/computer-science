# 消息队列语义

## TL;DR

**"Exactly Once Delivery" 是不可能由消息队列** 单独保证 (除非队列做单 consumer 组合 + idempotent 处理)。 三 fantasy:

1. **At-most-once**: producer 发出而 没收到 ack, message 可能未送达 consumer; consumer 可能没收到; **可能丢失**。
2. **At-least-once**: producer 必重试 **直到 acked**, consumer 必重认. **可能收多次重复消息**, idempotent processing 必可 bear.
3. **Exactly-once**: 应用层保证 — consumer 幂等 + dedup, queue 提供单 partition ordering + offset commit.

工业实际至少 是 **at-least-once + idempotent consumer**. 标语 "exactly-once" 实际是 "exactly-once *effects*" through client-side deduplication. 本章扫 三种语义的协议细节, Kafka/Pulsar/NATS/SQS 公布的语义, 端到端 idempotency 设计 (idempotency key + dedup table + outbox pattern), 与典型事故 (双 at-least-once linked transfer 双扣款)。

---

## 一、形式化三种语义

### At-most-once (丢消息容忍)

```
producer.send(msg):
   发出 -> 没 ack (fire-and-forget).

consumer.receive(msg):
   process(msg); ack;
   network fail -> 不重试来 → msg lost (MOST- ONCE 上限 receive一次。
```

- 用例: telemetry, events log, real weather readings, fire-and-forget 通知 push 通知 (无 critical).
- 实现: UDP 或 应用层 no ack. SQS exposes this 不 默认.

### At-least-once (有 duplicates 可能)

```
producer.send(msg):
   if no ack in timeout -> retry.

consumer.receive(msg):  
   process(msg); ack;
   if crash before ack -> 重新 deliver to consumer/broker。
```

- 用例: 大多 工 业 message queues (Kafka, RabbitMQ, Pulsar, NATS).  default.
- duplicate 要求 consumer 端是 **idempotent**.

### Exactly-once (效果上)

- Producer side: 不 重 复 (**idempotent producer**) Kafka 0.11+ `enable.idempotence=true`. 每个 batch 由 producer_id+seq_no 去重.
- Consumer side: **transactional消费 + commit一 offset**, Kafka transactions 进 offset write 与 log append在同一事务. consumer `read_committed` 后 only see committed.
- Effects: consumer 必 **idempotent** + queue 提 供 idempotence + transactional support.

**This is the practical exactly-once 定义** — actual 1 time delivery 不保证, 但 1 time effects 保证. Network partition can still cause consumer to process twice in failure recovery; idempotency ensure action 一次.

### "True once vs effective once"

Layer 1 delivers at-least-once + Layer 2 (consumer-side idempotency) ⇒ effective once:
- idempotency key (unique business id)
- dedup store (Redis SETNX with TTL or DB unique key constraint)
- transactional update to multiple systems (projection update)

---

## 二、Kafka 语义

### Producer 配置

- `acks=0`: at-most-once (fire and forget).
- `acks=1`: leader writes 后 ack; if leader fail before ISR 同步 → msg lost.
- `acks=-1 / all`: leader + 全 ISR 同步 后 ack; RPO ≈ 0 with min.insync.replicas=2 + replication factor=3. **At-least-once** default since Kafka 3.0.
- `enable.idempotence=true` (Kafka 3.0+ default): producer 内分配 `producer_id` + sequence number per partition, broker side 去重. **Exactly-once send** (无 duplicate).

### Consumer

Kafka consumer 提供 "**at-least-once**" delivery: per-partition offset commit:
- `enable.auto.commit=true` + `auto.commit.interval.ms=5000`: 自 commit 后 consumer crash 之前 实际 processing 可能 never finish干, 但 commit 已 send → loss.
- `enable.auto.commit=false` + manual-sync  commit After processing: duplicates possible if crash 后 process 后 before commit. ** Idempotent consumer required.**

### Transactions (Kafka 0.11+)

Producer 以 transactional `initTransactions()` 在 Kafka注册 `transactional.id`, 与 read-process-write transactional pipeline:

```
producer.beginTransaction()
producer.send(topic_a, msg_out_1)
producer.send(topic_b, msg_out_2)
producer.sendOffsetsToTransaction(consumer_offsets)         # commit consumer offsets in same Txn
producer.commitTransaction()
```

让 consumer 链路 transaction 与其 read commit offset 都在一个 Kafka事务 中. 两件事原子。下 consumer `isolation.level=read_committed` 不见未 commit 数据 → 不重复读取。

### Kafka Stream / kTable

Kafka Streams 内部用 transactions + 实际流处理 + state stores + offset commit 一事务 atomic → exactly-once processing **guaranteed** by lib. 没 idempotent library (像 plain client apps) 必须 ID 也自行 dedup.

---

## 三、Pulsar / RabbitMQ / SQS / NATS 对比

### Pulsar

- BookKeeper ledger 提供 ledger-level ensemble write 投统一, end-to-end shared storage, 加序号, acked message 可recovered.
- "At-least-once" 默认; "exactly-once" 可以 subscribe unique consumer (shared subscription with name) + dedup at 正确.
- **Dedup** with `producer_name` + `sequence_id` (Vue 系列 ...)  üyes 直接支持

### RabbitMQ

- 默认 at-least-once, consumer ack manual.
- message TTL, queue-level max size.
- **Generally not idempotent** dedup, broker doesn't store 已处理 IDs. Application must dedupe.
- supports dead-letter exchange 来 without retry with TTL delay.

### AWS SQS

- **At-least-once** default; consumer 处理 + delete API; visibility timeout default 30s 后未 delete → message reap-appears。
- **FIFO queue** with deduplication: producer 提供 `MessageDeduplicationId` → 5 分钟内同 id 抑制 (exactly-once per 5min window). Good for low-volume critical events.
- **DLQ (Dead Letter Queue)**: max receive count exceeded → moved to DLQ for later analysis.
- 部署 large scale is best practice with FIFO queue + deduplication_id + visibility_timeout 决定.

### NATS

- **At-most-once** by default (no ack).
- NATS JetStream (newer) 提供 persistent + acks + at-least-once.
- High throughput + log library.

---

## 四、Outbox Pattern (→ [outbox.md](outbox.md))

外 trans actor 必须 update DB + send message queue atomic. 若 update DB 之后失败 ∈ queue delivery, 没 send. 若 send queue 之后 crash pre db commit, downstream 看到 event 但 DB 没 reflect, 是 service consistency break. 

Outbox pattern 解法:
- DB transaction 中既 插入 `_outbox` 表 一个 row = event, 与业务 row 同事务.
- 异步 worker poll `_outbox` 表 → 发到 queue → 标记为 sent.
- queue publish + outbox row delete 必须 idempotent (DB unique constraint `event_id`, queue dedup `event_id`).

也支持 CDC (Debezium 监 听 binlog + emit 到 kafka).

---

## 五、幂等 Consumer Pattern

幂等处理 是 at-least-once 工业基本 assume. Consumer 必记 processed event_ids / dedupe.

### DB Unique Constraint

```sql
CREATE TABLE processed_events (
    event_id VARCHAR(64) PRIMARY KEY,
    processed_at TIMESTAMP DEFAULT NOW(),
    payload JSONB
);

-- Process:
INSERT INTO processed_events (event_id, payload)
VALUES (?, ?)
ON CONFLICT (event_id) DO NOTHING
RETURNING (xmax = 0) AS was_inserted;
```

如果 insert returns `was_inserted=true`, 是 first processing. 否则, 已处理, **skip** 但允许 commit/consume.

### Redis SETNX With TTL

```python
def process_safe(event_id, business_func):
    if not redis.set(f"processed:{event_id}", "1", nx=True, ex=86400):
        return "already_processed"
    return business_func(event_id)
```

short dedupe window via Redis TTL. 适合 bank transfer events.

### Idempotency Key on Business Object

Use a stable business identifier as idempotency key:
```
transfer request: 
  idempotency_key = "Transfer|alice|bob|transfer_id_42"
  process:
    if key seen in records: return prior result
    else: perform transfer, store result
```

---

## 六、典型事故

### Stripe duplicate transfer (双扣款)

2018 某 Stripe webhook 失败重试一次 service, customer 写 了 paypal — ID错过了而是 一次性 completed trans del Declared result 充枣 高加! Escape 失败 had 时光. 但 hashing request hash 减少 duplicate check format 等配. Fix:  `Idempotency-Key` HTTPS required any writing API.

### Kafka exactly-once "向前 duplicate" 2016

Some Kafka business batches write to next downstream outside Kafka, 该 downstream RECEIVE 更多 program 复制 message. 应用 transform. Fix: process inside Kafka transactional commit.

### Twitter Fanout tail event dedupe

Each fanout event `event_id` 逐渐复杂性 同 actual server 引入 Redis SETNX. Hot spot.
Fix: hash 各 partition agent id 同 by id, partition placement stable.

### Event queue from processing fail 发送邮件 duplicate

发 user emails 后下 系统 处理回 callAck → consumer failures reassigned to worker duplicate.  Payment providers往往 3 retries in DLQ. Idempotency ID store 邮件 list 总筛 duplicate.

---

## 七、易错清单

1. **At-least-once 是默认**: 必 定 claim idempotency, 写 client + dedup 是 standard.
2. **Auto-commit 该 disable**: manual commit after processing 避免丢.  
3. **Kafka producer 的 idempotence + transactional stream** 提供支持 transaction; custom processing 必须应用 idempotency.
4. **Idempotency key  must be stable**: 不要 hash current time, use 业务级 unique  ID (e.g., order_id).
5. **Visibility timeout > max processing latency**: else broker re-deliver original message duplicate. SQS visibility deafault 30s often too short.
6. **DLQ 监控必**: failures 让 message autonomous bypass manual inspection; silent depute Significant old embed.
7. **Network partition**: 多 send batch deliverCLient 拉 出 ATTEMPT 船  Rector多种 一次 思成功 2次 首项 准备 likelyhood client下次 写 际修复 logical input 干.
8. **Ordering与delivery 重**: 实部分 ordering not scaling well. 一 个 partition 是强 order 多 partition 全局 sorted impossible guarantees (sync only).

---

## 八、这一章带走的东西

1. At-most-once (fire-and-forget), At-least-once (retry until acked), Exactly-once (idempotent + transactional).
2. 现实生产 多 **At-least-once + Idempotency ID dedup**; Exactly-once 通常 应用层自行实现.
3. Kafka producer idempotence + transactions + consumer offsets in transaction 提供 end-to-end true exactly-once.
4. SQS FIFO with `MessageDeduplicationId` + Visibility Timeout; RabbitMQ manual ack; NATS JetStream persistent.
5. **Outbox Pattern** 让 DB + queue 同 事务 并 atomic; CDC替代 outbox table.
6. 应用层 idempotency: 用户 + Event ID + Redis SETNX + DB unique constraint `event_id`.

---

下一节 → [Outbox Pattern](outbox.md)
