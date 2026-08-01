# 消息队列与异步

异步 + 队列让 services **跨进程解耦**: producer 不需等 consumer, 只需 publish event. 系统 throughput 升, 跨服务失败延迟宽容 (retry/重投)。常见反例: 用 webhook 同步调用上游 service, 慢一 service 拖垮整个链。 用 message queue 改"at-least-once + idempotent"是核心 ID 化防止重复消费。

- [消息队列语义](semantics.md) — at-most / at-least / exactly-once
- [Outbox Pattern](outbox.md) — DB transaction + queue atomically
- [Kafka 内部与生产实践](kafka.md)
