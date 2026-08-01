# Outbox Pattern

## TL;DR

服务做两件事: (1) 更新数据库, (2) 发消息队列. 但是**两件事跨进程 atomic 不可能——没有 in-process 两阶段 commit**（即让 DB commit 与外部 message queue send 在同一原子单元同步）。 如果 DB 先 commit + queue send 失败, downstream 永远没消息; 如果 queue 先 send + DB fail, downstream 看到消息但 DB 未更新。 都是数据不一致。

**Outbox Pattern**: 业务 transaction 内 → 同事务 insert outbox table → DB commit 后异步 worker poll outbox table 把 events send 到 queue + mark as sent。 "Outbox 表与业务表在同一 DB transaction → 它们 atomic". 单 service 内 consistency + 跨 service availability 解耦。

---

## 一、Pattern

```
应用 transfer(from_id, to_id, amt, event_id):
    # begin DB transaction
    UPDATE accounts SET balance = balance - ${amt} WHERE id = ${from_id};
    UPDATE accounts SET balance = balance + ${amt} WHERE id = ${to_id};
    INSERT INTO outbox (event_id, event_type, payload)
        VALUES (${event_id}, "Transfer", {...});
    # commit (atomic)
```

后台 worker:

```
loop:
    rows = SELECT * FROM outbox WHERE sent_at IS NULL LIMIT 1000;
    for row in rows:
        try:
            queue.send(topic, row.payload, idempotency_key=row.event_id)
            UPDATE outbox SET sent_at = now() WHERE event_id = row.event_id;
            COMMIT;
        except:
            backoff() retry
```

外部效果:
- 不丢失 (DB 与 outbox 同事务 atomic)
- 不重复 (queue 发送 idempotent — idempotency_key 防重复 send)
- 至少一次 (worker 持续 poll 直到 success)

---

## 二、CDC (Change Data Capture) 变体

经典 outbox 用 application-level background worker poll outbox table. 现代 push-based CDC 用 DB transaction log 监听实时事件流。

### Debezium

- 实时监听 PostgreSQL WAL / MySQL binlog / MongoDB oplog, 写入 Kafka Connect
- 应用只需写业务表 + outbox 表; Debezium 自动把 outbox row 变成 Kafka event
- 满足 lower latency + better robust

### Pros vs manual worker

- **No application code changes**: worker 不在 application 中, CDC engine 自动处理
- **Lower latency**: binlog tail 实时, 比 poll 接近实时
- **Robust**: binlog replay from any LSN 恢复避免丢; worker crash 不丢 job

### Cons

- 依赖 Debezium platform (Kafka Connect 部署 + 维护成本)
- 复杂事务 log (binlog interpretation 需要理解 row + 关系)
- coupling with DB engine: WAL / binlog format changes with版本, Debezium 需跟随升级

### Kafka Connect DLQ

CDC source connector 配置 `errors.deadletterqueue.topic.name` 后 CDC failures 上 DLQ topic, 让 DLQ monitor/根 analysis。

---

## 三、At-Least-Once Worker

Worker 必须 strict + idempotent.

```python
loop polling:
    rows = SELECT event_id, payload FROM outbox
           WHERE sent = false
           FOR UPDATE SKIP LOCKED
           LIMIT 100;
    -- PostgreSQL: FOR UPDATE SKIP LOCKED 让多 workers 并发处理不同 row
    foreach row in rows:
        try:
            queue.send(topic, payload, key=row.event_id)
        except Exception:
            log("queue down, retry later")
            continue        # 不标 sent=true, 下次 iter 再发
        UPDATE outbox SET sent=true WHERE event_id = row.event_id
        COMMIT
```

`FOR UPDATE SKIP LOCKED` 是 PostgreSQL 9.5+ 并发 select pattern 让多 worker concurrent grab 不同 rows. MySQL 8.0+ 同; Oracle 与 SQL Server 也有 equivalent (`READPAST`)。

---

## 四、Idempotency Key + Ordering

发送 ID 等业务 event_id, queue 端去重:

- Kafka 通过 `producer_id` 提供 produce-side sequence dedup, application-level event_id 是更业务级的 idempotency key
- 发送时用 event_id 作为 partition key 路由 Kafka partition: 同一 entity (e.g. user_id) 的 events 全落同 partition → Kafka ordering within partition 保
- 同 entity 必 serial (用户 account transaction 序)

跨多 partitions 排序不 保证. 若业务需要全序则单 partition 限制 throughput.

---

## 五、常见 5 种 worker

### 1. In-process background thread (simple)
- 同 server 程序内一个 worker 定时 poll outbox
- 弱点: 重启 server 时 worker停 ～

### 2. 独立 worker pool (high availability microservice)
- deploy 单独服务 worker pool 并发消费 outbox
- 每个 Pod 用 `SKIP LOCKED` 抢 work item
- 限 worker 数 = max DB connection (e.g. 10 connections)

### 3. CDC (Debezium / Kafka Connect)
- 独立服务 attach DB binlog → emit Kafka topic
- 满足 lower latency + better robust
- external deploy

### 4. Cloud platform: EventBridge / SQS / Lambda
- AWS Lambda 定时 poll outbox 自动 send 到 EventBridge / SQS
- 原生 cloud support with failover

### 5. Multi-instance + consistency
- partition by entity_id 让同 entity processed serially; but multi instances 仍并行 between entities
- 复制 worker into partitioned jobs with consistent hashing for backlog entities

---

## 六、典型使用例

### Order Service -> Shipping Service

订单 service 创建 order commit; outbox row emit "OrderCreated" event; Shipping service consumes + 创建 shipping record. Idempotent on order_id.

### User Account -> Email Service

User signup commit; outbox row emit "WelcomeEmail" event; email service consumes. Idempotent on user_id + skip duplicates.

### Twitter Tweet Created -> Followers Fanout

Tweet service commit; outbox row "TweetCreated" event; Fanout service consumes 推到 followers' timeline cache. Idempotency on tweet_id; partition by author_id for ordering.

### Stripe Webhook -> Billing Update

Stripe sends webhook to customer billing system. Billing system insert outbox "Stripe.Event.WebhookReceived" event → 后台 worker persist state, detect idempotency via Stripe event_id + skip duplicates.

### Paypal Payment -> Fraud Detection Service

在 PayPal commit + outbox event; fraud detection 仅 idempotency (after analysis 避双 score revert).

---

## 七、典型事故

### Worker crash, messages lost

某公司 worker thread embedded in app process; deployed new build → container kill worker mid send with outbox row marked unprocessed. 后台 not recovered, lost ~ 50 messages in flight. Fix: `transactional outbox status` 的 flow diagram + worker 状态 mask 处理 commit-后 , 并让 update outbox `sent=true` 操作精确 reflect queue deliver ACK。

### Outbox grows huge

某用户 outbox retention 太长 (30 天保留) 导致 outbox 表数百 GB; worker 跟不上 batch send 量. Fix: outbox 在 row sent 后 brand job TTL preserve shorter,定期 cleanup 表 + 压 较 archive 表 之的政策.

### Repeat consume duplication in Kafka 消费者 未用 idempotency key

消费 log 不 dedup 设置; duplicate events 导致 后端 subscribe 收到 500+ emails duplicated.

Fix: 客户端 insert idempotency unique key in row → INSERT ignored. Stripe webhook: `event_id` unique index防重复入.

### Worker 处理过慢 outbox 饱和

某公司 orders service high peak during 11.11 holiday, outbox worker 跟不上发 send rate → outbox rows accumulated → outbox 表 disk 满. Fix: worker 数量按 peak 5× capacity scaling + binlogs CDC 取代 poll-based.

### Race Duplicate Enqueue

```python
worker1.poll(): gets row 5
worker2.poll(): gets row 5      # worker1 crash before SKIP LOCKED OR predates SKIP LOCKED patch
worker1 recovers → sends row 5
worker2 sends row 5             # duplicate send
```

Fix: SKIP LOCKED 是 required ALWAYS; worker 必有 `FOR UPDATE SKIP LOCKED` SQL clause.

---

## 八、易错清单

1. **worker 必须 idempotent**: 不能简单发包; `event_id` 作为 idempotency key + queue dedup  (e.g. `MessageDeduplicationId` 在 Amazon SQS)。
2. **`FOR UPDATE SKIP LOCKED` 是 PostgreSQL 9.5+ / MySQL 8.0+ feature**: 句不能在 older DB 上安全跑; 必使用 `SELECT ... LOCK IN SHARE MODE` 或 row-version  二次检查.
3. **`SELECT FOR UPDATE SKIP LOCKED` 必 required**: multiple workers 并发 unblocking concurrent 参数 set 跳避免 双 worker 处理同 row。
4. **Sent at / marked sent 不 atomic with outside queue send**: queue send 后才 mark sent; 在未 mark sent 前 send 成功与 mark sent 之间 crash → 重发故 mark `sent=true` **POST send ack** 后立刻 `UPDATE`.
5. **Outbox 表保留 太长必爆炸**: 实践 30天 archive 后 cleanup. 配置 retention 持续 monitor。
6. **Multi-partition 跨序业务**: Kafka ordering 是单 partition; cross-partition 全序顺序 非 guarantee. 业务依赖全序必 single partition （限制 throughput).
7. **Use event_id作 partition key**: 不要 user_id+timestamp 自乱 partition distribution partitioning 或 partition reliable。

---

## 九、这一章带走的东西

1. Outbox Pattern 让 DB + queue **transactionally atomic** in single-service setup. CIIC 接受用 polling + worker + SKIP LOCKED pattern。
2. CDC (Debezium) trend: 流式 emit binlog → Kafka (低 latency, transactional robust, complexity).
3. **`FOR UPDATE SKIP LOCKED`** 让 multi-worker concurrent polling 不冲突, PostgreSQL/MySQL/SQL Server 都支持。
4. **Idempotency Key on `event_id` 是必须的**: 让 consumer idempotent dedup, queue `MessageDeduplicationId` 支持 AWS SQS FIFO, Kafka producer_id 提供应用层 dedup。
5. Kafka partitions + ordering: 同 entity events 同 partition 保序; cross-entity 不序需业务iidempotency。
6. 典型工程: order service → shipping; user signup → email; tweet → fanout; payment → fraud——所有这些需要 outbox pattern 与 idempotency 保证 consistent + reliable fan-out 之服务架构 correctness.

---

下一节 → [Kafka 内部与生产实践](kafka.md)
