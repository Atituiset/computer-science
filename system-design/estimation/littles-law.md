# Little's Law

## TL;DR

**Little's Law** (John D.C. Little, 1961, MIT Sloan) 是排队论中最常用、最被广泛引用的定理:

$$L = \lambda W$$

- **$L$** = 系统中平均实体数 (concurrent occupations, queue + service)
- **$\lambda$** = 到达率 (arrival rate, 实体/unit time)
- **$W$** = 平均逗留时间 (实体在系统中停留的总时间)

它跨**任意**到达分布 + **任意**服务分布 + **任意**队列情形都成立. 是 back-of-envelope 估算 threadpool size、queue depth、worker count 的 first principle. 本章推导公式、应用例 (限流器、池容量、API P99)、与经典 counter-example (non-stable 系统如何破坏 validity)、Little's Law 在工业 ops 的应用 (SRE pool sizing)。

---

## 一、直觉与形式化

### 直觉

如果:
- 1 秒 来 1 个 客人 (λ=1/s)
- 每个客人在店里待 5 秒 (W=5s)
- 那么店里 "steady state" 平均同时有 1×5=5 个客人 (L=5)

或说: 每秒进来 1 个客人, 每个客人占用 5 个细秒-slot (resource), 总 steady state 占用是 5 个 slots = 5 同时客人.

### 形式化

证明 (simplified version, stable M/M/1): 

设稳态到达率 λ, 服务率 μ (μ>λ 稳定). Little's Law 在任意 markov chain stationary distribution 中 apply. 完整 proof 需要 ergodic average argument.

### 三变量 + 推论

| 变量 | 稳态关系 |
|------|---------|
| 未来到达 rate λ 与系统稳定性 要求 λ < μ (μ 是服务率) | stability condition |
| L = λ × W | Little's Law |
| 若 system is FIFO 单 server: 等待时间 W_q = L_q / λ (queue 内 L_q, 等 average time in queue only) | 同公式 |
| Conflict ratio ρ = λ/μ | 单 server 利用率 |
| ρ → 1 ⇒ L → ∞ (queue 长度→∞, latency→∞) | "Bottleneck saturation" |

---

## 二、工业应用例

### 例 1: Thread Pool Sizing

API server 突发到达: λ = 1000 req/s, 平均 per-request 服务时间 W = 50ms. 

应用 Little's Law:
$$L = 1000 \text{req/s} × 0.050 \text{s} = 50 \text{reqs concurrent}$$

需要 ≥ 50 工作线程(每 worker 一次处理 1 个 request). 否则 queue 涨 ⇒ W 涨 ⇒ P99 latency 涨.

### 例 2: Database Connection Pool

PostgreSQL 平均 query 5ms, 突发 30K queries/s:
$$L = 30K × 0.005 = 150 \text{connections concurrent}$$

设 NB PG max=100, queue 50 等待 ⇒ W 边界 queue add ≈ queuing delay 即 50/30K = 1.7ms; 这是 backpressure. DBA set pool=200 → connection far exceeds max=100 throughput cap → connection refused. Pool=150 是 sweet spot.

**经验公式**: pool size = avg_request_time × peak_qps (Little's law) **+ safety headroom 20%**, 网络 spare capacity.

### 例 3: API Gateway Rate Limit

Token bucket 风格 rate limit:
- 100 RPS token refill
- each request consumes 1 token
- burst 5 token initial bucket

$$L_{tokens} = refill × burst refill period$$

通常 Little's Law 应用于"waiting queue":
- 到达 λ=200/s, 服务 μ=100/s ⇒ unstable ⇒ L → ∞
- 必须配 `Bounded Queue with Backpressure` (限流器)

### 例 4: Queue, Talk Code

Kafka topic 承接 1M events/s produce rate, consumer 处理 0.2M/s → consumer lag:
- L_lag = (λ_producer - λ_consumer) × time
- 1 hour lag = 1M-0.2M = 0.8M × 3600 = 2.88B events.

→ 必须加消费者 (subscribing 同 group). 9 more consumers × 0.2M/s each = 1.8M/s consume, lag decreases.

### 例 5: Pinning worker pool for cron tasks

K8s 集群 running 1000 concurrently active CronJobs, 平均 job runs 5min:
$$L = expected \_arrival × W = how many CronJobs/sec × 300 sec$$

若 scheduled frequency 总和 10/sec入 enqueued:
$$L = 10 × 300 = 3000 \text{ concurrent Pods}$$

### 例 6: Cache capacity planning

Redis cache:
- 到达: 100K QPS read calls.
- 平均响应时间: 0.5ms (sub-ms cache hit).
- $L = 100K × 0.0005 = 50$ concurrent connections.
- Redis pipelining: 1 connection handles 50 ops (pipeline batch) → reduce to 1 concurrent connection (per worker thread pool).

### 例 7: Connection static: 关闭 delay reverse

Server 5K QPS with persistent HTTP/2 connection work from clients:
$$L = 5K × W = 5K × 1s (keep-alive default) = 5K open connections$$

must bump fd-max limit to 65535.

### 例 8: Storage Write Throughput

PostgreSQL 1MB writes 要 1ms (fsync bound).

100MB/s write rate = 100 concurrent 1MB writes in flight = 100 fsyncs concurrent → but fsync 1ms 串行化 → actually max 1000 fsync/sec → max ~1MB × 1000 = 1GB/s.

反推 bound:
- $W_{fsync} = 1ms$
- 服务率 $μ = 1000/s$
- arrived $λ = 50K/s$ if each is a 1KB write batched 50K → unstable.
- batched to 1ms 一 fsync with 100 batched writes per fsync → effective λ=500/s sat at μ. Sweet spot is batched with `synchronous_commit=off` + `wal_writer_delay=10ms` aggregation.

---

## 三、Counter-Examples: Little's Law 失效情形

### 不 稳态

队列只在 λ<μ (稳定条件)才 stable. λ>μ ⇒ 无限增长, Little's Law 仍可用 $L = L(0) + λt - μt$ for transient (t时间), 但 steady-state 极限定理不成立. industrial example: 流量激增引发 backpressure.

### 突发 vs 平均

平均 λ=10/s但 突发 100/s for 1 second:
- Little's Law 用平均算 $L=10×W$, 但 burst 期间 W trajectory 可能短暂超 stable W 估计 → P99 latency 实际 spiking. 平均不制约P99 致命.

修: bursty service 自配超额 worker 处理 burst. 类似 batch 可以 concurrent 突发的 100+ tasks.

### Priority Queue 不 道

Priority queue 可能 starve 低 priority. λ<=μ 总稳态, 但低 priority class 的 effective μ→ 0, 它的 W → ∞. Little's Law 仍适用 per class — one for low priority stretch.

### State-Dependent 服务率

服务率 μ dependent on system state (state-aware 算数据 增 mark)(和一个 load shedding 算法): $\mu \ne$ const.  Little's Law 只算 stable expected average λ & W, 不描述 transient + state dependent dynamics.

### Closed Loop (Network)

用户 reply-driven retry 给系统再加 load (closed-loop), 客户端 λ 实际interface-dependent on observed latency (e.g., if server slow, user lowers its issue rate, "throttling"). Little's Law formula still works in expectation, but λ self-feedback depends on W ⇒ not externally regulated model.

类似 example: HTTP client with finite pool (50 connection threads); individual request thread blocks ⇒ users don't issue new ones until release ⇒ instantaneous λ dynamically bounded.

---

## 四、Little's Law 边界应用

### Queueing Theory 推论 Kingman 公式

单 server M/M/1 queue:

$$W_{total} = \frac{1}{\mu - \lambda}$$

即 delay explodes 1/(μ-λ) when arrival → capacity. P99 latency 公式 (金海 method):

$$W_{P99} \approx \frac{ln(100)}{\mu - \lambda}$$

→ 1% overload → P99 latency 4.6× mean.

应用: never run server at λ/μ > ~80%. Always leave μ 20% headroom. P99 latency is very sensitive to saturation point.

### Universal Scalability Law (USL, Neil Gunther)

$$X(N) = \frac{λ N}{1 + α(N-1) + β N(N-1)}$$

- N = 并发数
- α = contention cost (锁竞争, 锁开销)
- β = coherency cost (consensus coordination)

β=0 (no coherency): Amdahl scaling. With coherency increasing, throughput 比 retrograde past N*.

USL 是 Little's Law 的 capacity scaling 推广, 用于 capacity planning 实际 SRE work.

---

## 五、工业 Best Practice

### Pool Sizing 公式

```
pool_size = peak_QPS × avg_response_time_seconds × safety_factor
```

where `peak_QPS` is 业务 peak (考虑 5-10× diurnal 突发); `avg_response_time_seconds` 实测含 cache miss P50; `safety_factor = 1.2 - 1.5`.

### Connection Pool Cap

PostgreSQL / MySQL connection pool max:
$$pool_{max} = \frac{max(TPDB\_tps)}{QPS\_per\_pool}$$

但是 DB max connections 实际受 shared_buffers RAM; 100 connection 20MB each = 2GB shared buffer. Diminishing returns 在 connection >50.

### K8s HPA Based on Queue Depth

HPA scaling on Kafka consumer `queuelag` 比 CPU 利用率更精确——stability 与 queue depth 显著关系. `Sharded Queue Lag = lag/consumers/60` → if lag/consumer > 60s需要加消费者.

### SLO with Little's Law

SRE SLO: target availability 99.9% = 8.6 sec/min deficit budget. 

$$budget = (total \_time) × (1 - SLI\_{target})$$

Throughput stable under nominal arrival rate. SLO violation triggers autoscale/degrade.

---

## 六、典型事故

### Netflix SpotInstance Queue Backlog 2009

某 auto-scaling based on CPU fanout: λ=N req/s consumers consume once CPU done; but CPU 相 throughput saturated → lag grows → Little's Law predicts sustained queue grows linearly. Fix: HPA metric on queue depth (Kafka consumer `lag`).

### Twitter Kestrel Queue Transient Stack 2011

Kestrel原始的 Little's Law not fully digestible — burst λ not stable. Queue overflow caused OOM. Fix: strict bounded queue + immediate backpressure to producer (Twitter internal Scala).

### Slack 2019 connection drops

Slack WebSocket connection pool capped at 10K, 然而 Little's Law pred L=20K concurrent stable state. Result: dropped 5K connections every 5min. Fix: bump Linux ulimit + net.core.somaxconn, deploy larger泓 worker pool.

---

## 七、易错清单

1. **Little's Law 是 stable state**: λ<μ req'd. λ>=μ → unbounded growth, 公式 temporarily得不到 pull L 不 steady.
2. **顿 mean time vs Juan99**: Little's Law 只 defend 平均; P99 的 interp 通过 Kingman formula 的人际必借extra.
3. **Connection pool 大不总好**: DB max_connections 制限 RAM, 每 connection消耗 ~5-20MB. Postgres 最多 推荐几一百, 超过风险 OOM.
4. **Thread pool sizing必算 cache hit ratio**: cache miss 让 W 增大⇒ L 增大, 现在 pool 突然over-subscription。 测试 службу best worst-case scenario。
5. **Backpressure based on queue depth 不是 CPU**: queue depth 是 lateness (queue内等待时间) directly → better autoscale signal.
6. **Burst arrival 能 找 transient overload**: λ average 1×10/s, but 1秒内 1000 réqs; 服务者正有效 only stable at slow rate ⇒ 1秒内设 queue 暴发 → transient P99 bad.
7. **Rate limiters 不 是 little's law in themselves**: token bucket 是幼儿建立 model on variation of μ, 上 limit λ to <= 50%. SaaS rate limit 关系 setting the μ - λ 整 stability rules.

---

## 八、这一章带走的东西

1. Little's Law $L = \lambda \times W$ 是 stable system 的稳态不变量, 适用于生死意毛任何queue with stable regime.
2. 工业 best practice: pool size = peak QPS × avg响应 时 × 安全 factor(1.2-1.5).
3. 不能 oversubscribe μ: 必须 leave 20% 容量 headroom以避免 P99 latency blow up.
4. Kingman formula: 单 server M/M/1 queue $W = 1/(\mu-\lambda)$, P99 latency $≈ W × ln(100)$. α=0.95 → latency 20× backof 2.9. ring.
5. Universal Scalability Law 购机 capacity scaling, Better than Amdahl, 包含 coherency term β for cluster contention.
6. **Coherency cost** increases quadratically with N, which is 是 why shared read-only cache 离线 nodes can use simple sharding 不 rehashable.



---

下一节 → [负载模式](load-patterns.md)
