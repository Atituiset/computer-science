# Multi-Region 部署

## TL;DR

Multi-region = 让服务在**多个地理区域**运行, 目的:
1. **Lower latency**: 同区域用户 < 5ms RTT (vs 跨洋 100-300ms)
2. **Disaster Recovery**: 一区全毁, 另一区扛
3. **Data residency**: 数据合规 (GDPR: EU 用户 数据在 欧盟)

但代价: data replication latency higher, consistency 降级, cost 增加 1.5-2×。本章梳理 multi-region architecture patterns, trade-off (latency vs consistency vs cost), 典型实现 (CockroachDB multi-reg, DynamoDB Global Table, Spinaker Active-Passive vs Active-Active, CDN + DNS routing)。

---

## 一、Core Pattern

### Active-Passive (冷战)

- 活跃在 one region, hot failover 到 standby on other.
- 数据从 active → passive sync replication (async); RPO > 0.
- failover time 5-60 minutes (DNS change).
- 成本 1 replica cost.

### Active-Active (热站)

- 多 region 同时 accept writes.
- Multi-master replication 双写同步。
- Conflict resolution: LWW (timestamp), vector clock, or merge function.
- latency ~ local区域 <5ms, cross region ~100ms multi write.

### Read-Replica global

- 写 在 single primary region, 各地只读 (RPO=0 for writes within primary region).
- 延迟: local (primary region <5ms write) + cross-region reads locally fast (~200ms behind).
- 适合 read-heavier landscape (content, social feeds).

---

## 二、CDN + DNS based Routing

### Route53 Latency-based Routing

```
User → DNS request
Route53 → 根据 user latency choose nearest healthy region IP
CDN (CloudFront / Cloudflare) cache fronting.
```

- DNS 基于 延迟路由, 不要 user pick.
- 高 failover: TTL 60s, health check DNS → switch user.
- CDN serve static content, dynamic path origin 回到 region.

### Global Load Balancer (anycast IP)

Google Cloud anycast IP 一个 IP 全球 consistent,  data 同 region 分发: 任何请求 route 到 nearest backend. AWS Global Accelerator 提供 similar.

### Application Consistency

同一 user's **session** 可能 sticky to one region via cookie. 若 region 崩, session 迁移其他。

---

## 三、Data geo-partitioned

### Shard by Region

```
user_id → region hash.
table REGIONAL BY ROW in CockroachDB: userid → us-east region.
```

### Cross-region global tables

某些表 global (e.g., legal terms, universal catalog). replicas 全球, cross-region 写 重 过多个 区域, weak consistency.

### CockroachDB Multi-region SQL

```sql
ALTER DATABASE mydb PRIMARY REGION "us-east1";
ALTER DATABASE mydb ADD REGION "us-west1";
ALTER DATABASE mydb ADD REGION "eu-west1";
ALTER TABLE users SET LOCALITY REGIONAL BY ROW; -- each row belong to chosen region
ALTER TABLE catalog SET LOCALITY GLOBAL; -- replicated to all regions
```

CockroachDB 使用 HLC, multi-region 读 有限 延迟.

### Spanner Multi-region

```
CREATE TABLE Users (...) PRIMARY KEY (UserId),
  INTERLEAVE IN PARENT ...;
-- Configure replication across us-east1,us-west1, europe-west9
```

Spanner TrueTime 保证 external consistency across regions.

---

## 四、Data Residency (GDPR)

用户 地域 数据必须留在同区域:
- EU 用户 数据 必 EU 区  replica。
- 法律 metric 靠 region-sharding forced local table replicas only allowed.

Multi-region 可能涉及 cross-region commit queue, data protection by region local dataset.

---

## 五、Consistency in Multi-Region

| 目标 | 技术 | Latency | Cost |
|------|------|---------|------|
| Strong consistency (linearizability) | Paxos/Raft cross-DC with commit-wait (TrueTime) | 100-200ms per write | 高 (全球多数派 ack) |
| Causal consistency | HLC / Vector Clock, cross region read replicas | 10-200ms 写本地, read ≤ 1s lag | 中 |
| Eventual consistency | Async replication + < 1s read latency possible | <5ms local writes, cross-region 读 几百 ms 以上 update | 低 |

Multi-region 强一 需 majority 跨 DC 复制 → latency cross DC 至少 50-150ms.

---

## 六、Case Studies

### Netflix Active-Active Multi-Region

Netflix 三 AWS region (us-east-1, us-west-2, eu-west-1). 采用  multi-region active-active with **ultra-strong event-based** CDC sync + CDN + always routed DNS/anycast.

业务 使用 stale 容忍读 (轻微  delay user profile won't break UX).

### Google Spanner Multi-Region

Google Ads 系统 跨 continent 数据 true external consistency TrueTime—— commit-wait ~14ms 两 DC roundtrip guarantee. Costs higher but worth billions revenue ads.

### CockroachDB by Cloud Company to Europe

某金融服务公司 用 CockroachDB multi-region cluster `us-east-1` + `eu-central-1`, 分区化的 user 数据  (region by row). Cross region user data 不能 legal cross-region move.

---

## 七、Multi-Region Failover Mechanics

### Active-Passive Failover

- Health check 持续: DNS 停止 active region.
- 异步 replication sync 保证 RPO min (5s to 0s replay).
- Traffic migration = route switch DNS / BGP → replay underway.

### Active-Active Failover

Remove 故障 region from routing — 其他 区域 自动承担 all traffic. 无需 failover 过程。

### Disaster Recovery planning

Periodic DR test: Chaos engineering Netflix Simian Army random kill regions, read verify others pick up.

---

## 八、典型事故

### AWS us-east-1 regional outage Feb 2017

某 S3 区域损 几小时服, 多于 netflix 用 multi-region 避免 但广大依赖 区 services 遭受 二 接 down。

### Apple iCloud multi-region 2015

iCloud 服务 outage 于 multi-region replication sync loop, bug 导致 数据 replication 环 直 塞 满 网络, 需 全 shut off.

### Spotify EU region outage

Spotify 欧 区 改 DNS failover wrong → unintended burst US-East cluster → impact US users; failback 触 跳 multi-region capacity overflow.

---

## 九、易错清单

1. **Strong consistency cross-region: 50-200ms latency unavoidable** — accept for true consistency pay latency tax.
2. **Async replication RPO > 0 须 明确 SLA**:  tell business acceptable data loss.
3. **Data residency compliance = region shard 不能 cross-region replicated**: legal advice before deployment advice.
4. **DNS failover TTL default > 60s** means stale routing post-failover; minimize TTL with active health checks.
5. **Active-Active conflict resolution: key not model**: LWW conflict resolution bias; must design per entity.

---

## 十、这一章带走的东西

1. Active-Passive (standby) vs Active-Active (accept writes in all) vs Read-Replica multi-reg.
2. Data geo-partitioning: REGIONAL BY ROW / GLOBAL 表 in CockroachDB + Spanner.
3. Consistency spectrum: strong (Paxos cross-DC, 100ms) → causal (HLC) → eventual (async <1s).
4. CDN + DNS latency routing 解决 read,  write 走向 origin region.
5. Multi-region DR: active health check + DNS + failover 测试.

---

下一节 → [Resilience Patterns](resilience.md)
