# 第七部分 · 系统设计

## 一句话

系统设计 = 把"业务需求 + 流量规模 + 可用性目标 + 预算"翻译成**架构图 + API contracts + 存储 + 队列 + 缓存 + 监控的具体取舍**。 不是堆 slogan, 而是在**真实分布式 SLA、capex 预算、ops 复杂度**中给一个**可以跑 10 年不重写**的设计——并解释每个组件的选择与淘汰路径。

## 思想链

API 高层: 用户 / API 客户端 —— LB / CDN —— API gateway —— 业务服务群 (stateless) —— 缓存 Redis/Memcached —— 主库 (强一致 KV / RDBMS) —— OLAP 副本 / 数仓 —— 备份 / 异地灾备

```
Client
  ↓ HTTP / gRPC
[ Edge CDN (Fastly / Cloudflare / Akamai) ]
  ↓
[ LB (L4 NLB / L7 ALB) ]
  ↓
[ API Gateway (Kong / Envoy / Nginx / internal OAuth + rate limit) ]
  ↓
[ Stateless Microservices (K8s deployment) ]
  ├─ Redis cluster (cache + distributed locks)
  ├─ Kafka/Pulsar (异步事件流)
  ├─ Primary DB (PostgreSQL / MySQL / Spanner / CockroachDB)
  ├─ OLAP store (Snowflake / BigQuery / ClickHouse / Doris)
  └─ Object storage (S3 / GCS / OSS)
```

每一跳都有取舍——CDN 让主页快 10× 但增加 invalidation 复杂度; cache 让 read 5ms 但 stale risk 提高; message queue 让 service 解耦 但 at-least-once 必须 idempotent; 主备 DB 让事务强一致但 leader failover 5-10s 写阻塞。 真正的设计师在**这套取舍的尖点中**画最优弧线。

## 8 个章节

- [负载与容量估算](estimation/index.html) — back-of-envelope、Little's Law、负载模式
- [存储选型与内部](storage/index.html) — 选什么数据库 (KV / 关系 / 列存 / 文档 / 时序) + WAL/LSM/B-tree 内部
- [缓存](cache/index.html) — 多级 cache、常见 pattern、failure modes (缓存雪崩、缓存穿透、缓存击穿)
- [消息队列与异步](queue/index.html) — Kafka/Pulsar/SQS + Outbox pattern + semantics (at-most/at-least/exactly-once)
- [可观测性](monitor/index.html) — Three pillars (metrics/logs/traces)、SLO/SLI、监控 stack
- [扩展与可用性](scale/index.html) — sharding + replication + multi-region + resilience
- [经典系统案例](case/index.html) — Google Bigtable/Spanner/Chubby + Dynamo family + Snowflake + K8s control plane

读完应能回答:

1. 100K QPS 电商秒杀: back-of-envelope 快速决定热点 key cache + 静态化页 + 异步下单 + 限流降级
2. PostgreSQL vs DynamoDB vs ClickHouse 选型的真实 SLA 矩阵
3. Cache hit ratio / 命中率 / evict policy / dogpile effect 在 P99 latency 上贡献
4. Kafka vs Pulsar 的语义差异与重复消费 idempotent 设计
5. multi-region 容灾或 AP 数据库分别在不同业务 SLA 下的选择
6. SLO 三要件: SLI 定义、error budget、automation burn rate alerts

---

下一节 → [负载与容量估算](estimation/index.html)
