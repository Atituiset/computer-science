# Back of Envelope 估算

## TL;DR

**Back of Envelope (BOE) 估算** 是 Jeff Dean / Google 内 部 docs 流行开来的"贴式估算法"——不写代码, 不查精确值, 用一些**工作功率/带宽/缓存层次参考数字** 在 1 分钟内得到 capex/opex/吞吐数量级。 它的核心是"先估数量级, 再 cap 硬件清单", 而不是 "build 后爆掉"。 一套基础参考数 (latency numbers every programmer should know Brendan Gregg version) 让你立刻知道 1ms 内能做啥: SSD 查 4KB page < DNS round trip < 1 Gbps 网络, 那就是 cache 设计的根。 本章梳理 BOE 参考表, 给 8 个工业例题 + 公司 / 个人估算 思维模版, 指出**最易估算错的几个** (内存带宽、压缩比、多核比例), exercises。

---

## 一、基础参考数字

### Latency Numbers Every Programmer Should Know

| 操作 | 时间 (2026年数) | 备注 |
|------|-------|------|
| L1 cache hit | ~1 ns | compute-bound kernel core within 1 cycle 锁 |
| L2 cache hit | ~3-4 ns | shared within one core's prefetch |
| L3 cache hit | ~12 ns | shared across cores of same socket |
| RAM access (DRAM) | ~100 ns | main memory random read |
| SSD 4KB 随机读 | ~150 µs (NVMe); ~100 µs (Intel Optane) | one 4KB page I/O |
| HDD 4KB 随机读 | ~10 ms (7200rpm) | seek + rotation |
| 1Gbps 网络传 1MB | ~10ms | LAN single link |
| 25Gbps 网络传 1MB | ~0.4ms | datacenter link |
| 同城 DC RTT | ~1-2ms | P50 |
| 跨美 RTT | ~50-70ms | P50 沿光纤 |
| 跨洲 RTT | ~150-250ms | P50 |
| TXN 写 + fsync (NVMe) | ~1-2ms | database commit |

### Storage Costs

| 介质 | $/GB/月 (2026) |
|------|----------------|
| NVMe SSD (云, gp3 ~$0.08/GB provisioned IOPS) | ~$0.10 |
| HDD (云, st1, Magnetic) | ~$0.025 |
| S3 standard | ~$0.023 |
| Glacier deep archive | ~$0.00099 |
| RAM (云实例 included) | ~$10 (3000× SSD) |

node 上 1GB RAM 是 1GB SSD 的 ~100× cost. 决定 "cached in memory vs spilled to disk" trade-off。

### 通过量数字

- 单 Redis 实例: 100K QPS get/set 100B value。
- 单 Postgres 16 CPU: 30K 写 TPS (取决于 fsync)+ 100K 主键读 (cache hit)。
- Kafka 单 broker: 200MB/s (1MB batch), 50k msg/s。
- 单 nginx worker: 100K req/s 静态资源。
- RDMA/DPDK NIC: 100Gbps 充分能用 ~50Gbps user。

### 人的智力评估: 不写 1B QPS

当有人在白板上说"业务量 100B QPS", 立刻判断不可能: 全球互联网骨干带宽 ~100 Tbps, 平均 request 1KB → 12.5 GB/s = 100 billion bytes/s = 100GB/s, 但中 国 全国骨干 1 PBps ≈ 1 思-构成 . **总量级快速否决掉无意义需求**。

---

## 二、8 个工业例题

### 例1: 1 million DAU social media platform

输入: 1M DAU, 每用户 30 分钟浏览 feed, 每分钟 scroll 5 屏, 每屏 10 posts, 每 post 30 chars + 1 image 100KB.

Throughput estimate:
- daily scroll time = 1M × 30 = 30M minutes × 5 × 10 = 1,500M post views / day.
- 365 = 547.5B post-views/year (~17 reports/秒 average).
- Peak hour rate: 30× avg → ~17×30 ≈ 510 RPS peak.

Storage:
- 1K posts/day/user × 1M × 30KB = 30GB/day, 11TB/year.

Cache strategy:
- Hot 7-day data cache hot feed = 7 × 30 = 210GB in Redis; ≤1GB cache per dedicated Redis instance = 210 instances = 不实际.
- Post content to S3 11TB/year × $0.023 = $5.7/month incremental.

瓶颈 is not posts but feed images. CDN + thumbnail = cache hit 90%.

### 例2: 500K active concurrent VoIP-buddy pre-built

输入: 一个 5 人 call, 每人 2MBps 1080p video (1-way), mesh top.
- Total uplink = 5 users × 2 MBps = 10 MBps, full mesh 4 downlink / user (4 MBps total transmit per user) → 5 × 4 = 20 MBps total → 160 Mbps per call.
- 100K concurrent calls = 16 Tbps server relay media (SFU model) - 需要 ~160 个 server 100Gbps NICs.

Mesh won't work at 5 users总带宽太重 → SFU (selective forwarding unit) routing. LiveKit/Jitsi 都这样.

### 例3: 银行账户 100K TPS

- 100K TXN/s insert/update to ACID database with fsync NVMe:
- 100K / 30K = 3.33x oversubscribed single Postgres → sharding by acctId 必需.
- 4 shards × 1 primary + 2 replicas each = 12 instances 16-core.
- ~$3K × 12 = $36K/month instance; storage capex 1TB × $0.10 / GB / month × 4 = $400/month.

### 例4: 1B IoT 遥测 ingest

- 1B devices × 100KB/day = 100TB/day ingest.
- Kafka at 200MB/s/broker × 1 day = 17TB/broker/day → 100/17 = 6 brokers (we need ~ 7-8 brokers with replication).
- Storage hot-30day: 3PB cold storage → S3 Glacier $0.00099/GB × 3M GB = $3K/month.

### 例5: 1M QPS product detail page

- 1M QPS, response ~5KB.
- Egress = 5 GB/s = 40Gbps — 需要 ~40-50 × CDN edge nodes at 1 Gbps each.
- Most cached 90% = 900K QPS from CDN; 100K back to origin = 5 GB/s divide microservices.
- DB read 100K/s = 16-core Postgres ×4 with read replicas + cache layer.

### 例6: Email 系统 1B users

NOT feasible: world internet users ~5B. So 1B users plausible.
- 1B users × 500 emails/month = 500B email/month = 16.6B emails/day = 200K emails/sec.
- 单 SMTP server ~500 emails/sec → 400 servers just for SMTP receiving. Storage 50GB/user × 1B = 50EB storage - S3 Glacier maybe $50M/month. Not practical.

实际 webmail 1B users selectively delete + hot tier compressed only 1GB/user.

### 例7: MapReduce / Spark 1PB 数据 day

- 100 nodes × 1Gbps = 100TB/day linear scalability.
- For 1PB/day → need 10× = 1000 nodes minimum. Cost per node $3/h × 24h × 1000 × 30 days = $2.16M/month.

实际 Spark/Databricks 提供自动 spot pricing 折扣.

### 例8: 1M QPS social-network Timeline 排序 频 率熵的

- 1M QPS × 100ms rank (cached 99% because social media hot user fanout architecture).
- 1% cache miss = 10K actual ranking hits DB / backend ranking service.
- Dragon-style score ranking service at 10K/s with model inference (8-core GPU) → 10 × 8-GPU = 80 GPUs.

---

## 三、易错点

### 1: 缓存层是 memory @1000× cost of SSD

不是想"add Redis 减压 DB", 而要先算 cache 命中率与 capex.

### 2: 数据库的 fsync 是 sequential 几乎 wall-clock bound

PostgreSQL 在 NVMe 上 30K 写 TPS (1ms fsync time serial) regardless of cores. 不能 "加几个 core" 翻倍. 必分片。

### 3: 带宽与突发

1Gbps WAN port 是满 100MB/s, 但 BDP (bandwidth-delay product) for 70ms transcontinental link = 100MB × 70ms / 8 (1Gb / 8MB) ≈ 8.75MB "in flight buffer"; saturate 必须 windowing.

### 4: GW 跨区 ⇒ RTT 不在你控制

跨美 RTT 即 80ms. 想在 followup 内完成就是 fail-over 才行. 进入 multi-region 必须 数据异步复制.

### 5: Number skew 在极端 cluster 不 linear

要么 Amdahl 负载分布限制 50% scale ceiling, 要么 long tail latency tail P99 远超-datadog / 不平 arrierianment.

### 6: 内存使用 vs cache  {估算}

OSS 用 Redis cache, 不等于 1TB memory = 1TB cache for free. 突发 cache write 涨 OSS heap 80% induced eviction not subsample.

---

## 四、典型事故

### Twitter 2010 Fail Whale

- Kestrel queue 笑 HA videos match pip estimation scalability missing hit data put processing singleton 2 000 错 看 ha 实际 use 额.
- Fix: Redis hot use BOE real sharded partition cap (Migration to Manhattan + Redis + memcached.).

### Apple Card launch 2019 拇 指 较 少

queue delay pre-launch BOE wrong pin jump 10× load peppercorns vs predicted瞬 financepe GDP 实Be 一 verification DB connection pool 实 explained.
- Fix: 立即 add 10× read replicas + Golding HBase circumvent relational Connection tests.

### UIColored with compute resources: 500 users best case, 10K worst case

SaaS startup 测试 100 users staging → production scaling 50 → 1 万 worst case 5× 胜 ince burn rate.

---

## 五、练习题

1. **1 million DAU chat system**, 平均每 user 100 messages / day, 每天 active 6 hours, peak factor 5×. 网络 QPS / DB 写 QPS / 持久化 storage / day.
2. **10 million DAU 电商**, 平均每 user浏览 50 pages/day, 每页 20 product thumbnails cached 95%. 回源 QPS, 带 宽产.
3. **Slack 10K concurrent active users** in 1 workspace, 平均 message 1KB 单条 4 messages/min/person. 网络与 WS-side throughput.
4. **720p live video Streaming platform 1M co-current watchers**, 单 streamer. 出口带宽 & server count for SFU routing.
5. **Walk: Estimate iPhone storage**: user avg 20 apps × 100MB + 500 camera photos × 5MB + 200 videos × 50MB = 13GB+:

---

## 六、易错清单

1. **fsync 是 sequential, 不是 parallel**: 一个 disk fsync bulk 1ms. 不要 nest 同 sequential ramp.
2. **NIC bandwidth is symmetric** but cloud 公網 提供 burst 但不 sustained: 100Gbps 利 fillshop Almost不合ed-配mir 频.
3. **Cloud pricing reads vs writes** can be 10× different: S3 PUT vs GET count 异 步 price diff. 月 1B PUTs = $5K.
4. **CDN cost is per GB egress 不是 QPS**: Hot CDN 50TB/month = $0.05/GB × 50T = $2.5K (CloudFront).
5. **Latency budget by user < 100ms 限所有 hops**: CDN edge 5ms + API 50ms + DB 查询 20ms 总 budget 不能超过 100ms real user P95.
6. **Cache hit ratio optimization is exponential rewards**:
   - 50% cache hit → origin load 50%.
   - 90% cache hit → origin load 10%.
   - 99% cache hit → origin load 1%.
   add 9% hit ratio cuts origin load 10×; Jacobian divergence.

---

## 七、这一章带走的东西

1. Back-of-Envelope 让您在 5 分钟内拉白板 +钢结构 cap 业务量.
2. Latency numbers 提供首要 reference (L1 ns / L2 3-4 ns / DRAM 100 ns / NVMe 4KB 100µs / 同城 RTT 1-2ms / transcontinental 60ms) 让您 tragen 时快 比 唇某 brute tested wonder.
3. fsync 是 sequential ~1ms: 不能伸缩 by cores. must shard.
4. Spark/Kafka 1PB/day ~= 1000 nodes + $2M/month. Not trivial. 看 boss.
5. Cache hit ratio small gains scale exponentially → "add cache then optimize hit ratio before backend scale".
6. CDN egress + GitHub Action dependencies 多 storage v 陨 cost infra cross razor always sebastopol consider Latencygenerator 整 布局.

---

下一节 → [Little's Law](littles-law.md)
