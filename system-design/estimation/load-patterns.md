# 负载模式

## TL;DR

实际系统中的 **load 是有多种 pattern 的, 不是静态一串 RPS**:

1. **Diurnal (昼夜变化)**: 白天高夜低 (社交 feed, web search).
2. **Burst (突发)**: 10×~100× 短时流量 (秒杀, app store 上线, 巴黎奥运开幕式).
3. **Periodic Spikes (周期尖峰)**: 准点小时 minute / cronjob trigger (e.g., 月底报表生成, 准点开抢).
4. **Long Tail / Heavy Hitter**: 少数 key 占多数流量 (Kardashian 推文、热门商品).
5. **Read/Write Imbalance**: 读多于写 95:5 vs 写多于读 95:5 (遥测, audit log).
6. **Drill Switch to Disaster**: planned chaos engineering (Netflix Chaos Monkey) → burst truth test.

没识别 pattern → 过度 sizing buffer / under-prepare → 浪费钱 / 集群崩溃. 本章梳理每种 pattern + 决策 trade-off.

---

## 一、Diurnal Pattern

### 特征

```
   |        peak 60K QPS Beth 09:00-22:00
   |      /             \
Q  |     /                \
P  |    /                  \
S  | __/                    \__              
   |___________________________
     0  4  8  12  16  20  24  clock
```

- min/max ratio ~10x. social media.
- 80% 流量集中在 12 hours (8 am – 10 pm)。

### 容量规划

- 平均 QPS / peak QPS 平均大约 5x. **size for peak**, 而 not for average, 否则 80% 时间 peak 期 P99 高 latency.
- Spot instances / serverless for off-peak cheaper: bursty 突发 fits serverScale.
- Cache scale asynchronously: cache read 轴 line peak 4-5x average. Cache key TTL design to扫清流量变化.

### 业务举例

- Twitter/X timeline 推送
- GitHub repo reads
- Wikipedia viewer
- 网站主页、电商列表

### 有用 SRE

- configure业务有关 peak alerts.
- 中间 cache Redis 队列峰谷 ratio 4-5x design.
- scheduled maintenance 选择 凌晨, business 不敏感 非常 推荐.

---

## 二、Burst Pattern

### 特征

```
  |      peak
Q |    /||\
P |   / || \
S |  /  ||  \
  | /   ||   \___
  |__max___________
0 ____________________ time 30 sec
```

短时间 内百倍 上升, 必须有**circuit breaker + rate limit + degradation**保护机制。

### Causes

- "Second Kill" (秒杀) of products
- 上线产品公告 / 通知 push
- Mobile app launch day
- 黑色星期五 / 11/11促销; App store 上线
- "DDoS"

### 容量规划

- **backpressure / queue based**: accept 进入 queue, evaluate throughput stable. Queue full 阀值 reject.
- **rate limit client**: token bucket, leaky bucket; reject excess调博.
- **circuit breaker**: outbound failovers prevent cascading.
- **auto-scale**: 但 auto-scaling latency ~30s 跟不上秒级 burst. 必须有 buffer 在 normal scale.
- **degrade**: cache fallback, static file fallback, summarize partial results.

### 业务举例

- Reddit front page viral post
- Wikipedia主页上
- 不是秒杀必然的流量 spike (信用卡支付 burst)

---

## 三、Periodic Spikes

### 特征

```
   |       _
Q  |      | |    _      _
P  | _____| | __| |__ __| |__
S  | _     |_| |  | |_| |_| |_
   |______  3min 5min  ......
         clock-time 心跳
```

多次定期 dip. 因为是 cronjob-task launch, 每 hour 00:01, 月底 1 日 00:00 etc.

### 容量规划

- schedule 错峰 stagger: 间隔 5 min between two systems.
- 队列分批次: 大数据 report; 生成 2 hours queue ≠ 1 hour peak. Throughput.
- 提前预warm (35 min before) scale cluster.
- Cronjob retry backoff if previous cronjob still running.

### 业务举例

- 月底报表生成 (financial reports)
- push notification (scheduled time broadcasts)
- SLO watchdogs alerting cron jobs
- ICS calendar event notification

---

## 四、Long Tail / Heavy Hitter

### 特征

乆 帕累托分布 (Pareto), **少量 keys 贡献绝大多数 变负载**:

```
   |_
   ||        _|_           Other 慢热部分
Q  ||      _|
P  ||    _|
S  ||  _|
   ||_|_|__|__|____________
      hot  1% 10% 100% keys
```

分布偏斜:
- top 0.1% keys: 50% 流量
- next 1% keys: 30% 流量
- next 10% keys: 15% 流量
- rest: 5%.

### 容量规划

- **dedicated hot-tier cache**: Hot keys 单独 in-memory tier,城乡 单独 Redis cluster shard by key range.
- **CDN edge caching**: hot static (image, video) CDN 上, 让 origin 不被打.
- **Predictive precomputing**: business insight 预计算 (trending topic) 把 hot key 预先 cache.
- **ship to top tier**: Redis_cache cluster "的热 key" 超前 分布  优. 半 damping.

### 业务举例

- Kardashians's Instagram photo
- Ariana Grande new song
- 某明星宣布竞赛
- 主页 hero feature 
- holidays campaigns

### 典型事故

Twitter 2010 "Justin Bieber search" — 单一 celebrity tweet 引 大量需要 fanout to all followers 的 fetch load, 实际 response of a single user 量 lateral  within internal component services. Hot-key caching fixed smooth access.

---

## 五、Read/Write Imbalance

### 类型

| 类型 | Read QPS | Write QPS | 典型例 |
|------|---------|-----------|--------|
| Read-Heavy 95:5 | 1M QPS read | 50K QPS write | twitter/x timeline, github repo reads, Wikipedia |
| Write-Heavy 5:95 | 50K QPS read | 1M QPS write | IoT telemetry, audit log, event log |
| 50/50 | 商务型 CRUD | - 各类 OLTP |
| Read-like calculations | delete heavy | OOCesscen | fallback retries |

### 决策

- **Read-heavy**: cache aggressively, replica reads, save DB.
- **Write-heavy**: partitioning writes by shard, async queues, batch writes.
- **Mixed 50/50**: serious consistency + not heavy duplication hard, sharding.

### Read-Heavy Strategies

```
- CDN cache static pages, Image CORS
- Redis / Memcached hotspot cache
- DB read replica pool
- Materialized views in cache (refresh period)
- TAG cache (cache invalidation)
```

### Write-Heavy Strategies

```
- Partition by time/bucket (按 writes shard)
- Append-only logs (Kafka topic)
- Capped history compaction + tiered storage (Hot 7-day, cold S3 Glacier)
- Batch + async writes
- Write-batching (pggather WAL blocks)
```

### 业务例

- IoT devices send telemetry: 1B devices x 1 msg/sec = 1M msgs/sec — system high
- Audit log + Ben's heartbeat (writes 持续, 没 read)
- Web crawler merge: write heavy
- Trading tps (股票交易 — read/write balanced, 99% read 又看当 filebanknoty)

---

## 六、Drill Switch + Disaster Recovery

### Plans

- Netflix ChaosMonkey - simulated AWS region outage. Daily chaos. 
- Disaster recovery (DR): **RPO 0 = syn sync across region**or RPO > 0 = acceptable data loss, replica或 跨 region.
- Regional multi-region cluster: 客 `leader-follower` 或 `multi-leader`.
- active-passive vs active-active.

### Historical Review

- AWS S3 12-day outage 2017 -- triggered major Northern Virginia cold wave transient lead to specific connection blowdown.
- Parisian tenant's issued deployment 实际 5-hour down 2016 due to live region downtime.
- company-level DR exercise quarter-year.

---

## 七、Auto-Scaling Trade-off HPA (Single Metric Queue Depth)

### HPA: CPU Utilization Above Threshold

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
```

Why 70 —— μ must 不 saturated (Kingman!); as soon as μ exceeds 70%, latency P99 slowdown exponential. leave headroom.

### HPA: CPU + Queue Depth (Lag)

```yaml
  metrics:
  - type: External
    external:
      metric:
        name: kafka_consumer_lag
      target:
        type: AverageValue
        averageValue: 100
```

Idea: queue-based load scaling:  when queue grows, callers can't catch up → add replicas. 比 CPU 更 sensitive to true load. for 长 queue 数 wonders.

### Vertical Pod Autoscaler VPA

Auto-test uso of Pod资源** requests** based on actual usage. useful 但 still experiments on pod restart. Limit: VPA cannot apply "vertical scaling" → pods.

### KEDA (Kubernetes Event-Driven Autoscaling)

Knative 第K相近的 KEDA  是 commonly used for scale-to-zero queue-based autoscaling +. Topic by autoscaling Kafka/lambdas cloud native installation: 0 incidents, 同时 dispatching burstynatured trigger spike vertical pattern — gaterns chelfor scaling interactions zero-HAZ显示出 cluster has consumsting infrastructure well by. 

---

## 八、典型 Load Pattern 事故

### Cyber Monday '18 Amazon retail

Cyber Monday 2018 - Amazon traffic 按 burst 5× pattern →. Real time query traffic support deman dlaunch-traffic 降 smaller day corner sstrike fixed by ad-hoc server spawn playback active recmist.

### Reddit Flooding Traffic

Reddit Top-of-front page Una documented cause cluster API fracas: "top-choice hot-fetcher a thread!" 2014 gram contibly 重 generating the issue 启 用 multiple HOT NUMs cached horizoned pipeline.

---

## 九、易错清单

1. **Auto-scale delay ~30s; burst must be buffered first**: rate-limit + queue + async backpressure before autoscale.
2. **HPA utilization >75% → P99 latency explodes** (Kingman). Must aim 60-70%, not 90%.
3. **Don't underprovision hot-key**: 1% hot key 可贡献 50% 流量; coming all single Redis shard 4 core hot node = saturation.
4. **Drill exercises 必不可少**: DR test 不定 CPL quarter.
5. **Long-tail caches over-polling a hot key with "1 significant" cache hit ratio**: Important to maintain 监 cache hit ratio 99%+ in hot, sagenames.
7. **Giving  & mental:** _bleachers_ Returns true depend on use 大量 parapacms 错误 models with generally very high scale test not relate prediction decany body new data!
8. **Circuit breaker if电 states rely actraoNavigable汉子 servo confusing upgrade life Recovery failure downstream**.
9. **实 product** only business-critical missing data is post clearly recognizable peek is order... pattern activation impacts paste 発炭LOW构 abundant.
10. **Finish todo & structured.**

---

## 十、这一章带走的东西

1. Load 是多种 pattern, 设计要容纳每种 model: diurnal, burst, periodic, long-tail, read/write imbalance.
2. **Burst must backpressure**, neither bursted (panic) nor silent/dropped.
3. **Auto-scaling latency~30s**: not for burst stream; ready buffer 2-3× headroom.
4. **HPA on CPU target ~65-70%; latency P99 explodes past 80%**.
5. **Heavy-tail load: dedicate a hot tier cache**; monitor hot key variation.
6. **Disaster Recovery drill must recovery practice chaos monthly; not just plans-on-paper**.

---

下一节 → [存储选型与内部](../storage/README.md)
