# 多级缓存 (Multi-Level Cache)

## TL;DR

实际生产系统几乎不只用一层 cache, 而是**5+ 层 cache 串联**: CPU L1/L2/L3 → OS page cache → 进程内 (Caffeine/Ristretto) → Redis cluster (remote) → CDN edge (Cloudflare/CloudFront) → Origin。 每一层 cache hit 一毫秒以内代价指数降低; 但每 miss 后 代价上一级。 本章梳理 multilevel cache 的常见层, 各 cache layer 性能与特点, ttl / strict-least-recently / random 策略, 主要 cap-trade-off——最终一篇案例: "Twitter fanout on billion line per day 用多大 cache 层"。

---

## 一、缓存金字塔结构

```
┌─ CPU L1/L2/L3 cache (~1-12ns) ── atomic CPU hardware
├─ OS Page Cache (Linux readv, mmap) (~100ns-1µs)
├─ In-process cache (Caffeine / Ristretto / LRU) (~50ns-500ns)
├─ Remote Redis (Redis cluster ~0.5-2ms)
├─ Search/Service 全局 cache (Elasticsearch query cache)
├─ CDN edge cache (Cloudflare edge POP) (~5-30ms from edge)
└─ Origin (database 真实fetch ~5-50ms)
```

查一次请求 path:
1. CPU 操作进程 in-memory → 加一个值 cache hit ~50ns
2. OS page cache buffer → 加几百 ns
3. Network round trip 去 remote Redis → 0.5-2ms

每一层 cache hit 前一层的同形, 代价 ,故障 window (cache 一失效) 影响 数据轮询.

---

## 二、Process-Internal Cache

### Caffeine / Ristretto

- Java Caffeine (Bench 2018): Window-TinyLFU eviction policy + AMQ (启发最优 LRU) 还有命中率 比 LRU 高 29% in traces.
- Ristretto (Go): similar TinyLFU eviction, high concurrent map-based concurrency access native 支撑.

### Use Cases

- API server 缓存最近 hot 文件 / user_dst_data 共享。
- Code-dec lookup (e.g., country list, color tokens) — almost immutable on minor changes.
- Post metrics / 验证 token Blacklist (短期)
- High-availability 计数器 (rate limiter)

### Trade-offs

- Cache size 受进程 RAM 限制, single process 不 persistentent. ** process 多副本 迫使 cache 不 fully coherent replicated, 负 cache 是sof
  consistency**.
- 保护 process startup time。 e.g., fresh JVM 启动 cache 大都会 empty, hot load must warm up.
- 内 cache size 多 GB (e.g., 4GB CPU-bound serve), 整 heap 4GB cache 包 single holder. («still allow graceful test»).

### Eviction Policies

| Policy | 算法 | Use Case |
|--------|------|---------|
| LRU | 淘最长时间没访问的 | 大多数 case; simple |
| LFU (Least Frequently Used) | access 频率低 out, 小概率 useParamsLruBut disfrSg little futurist. | longterm stable data feed |
| W-TinyLFU (Caffeine default) | window admission + count-min sketch frequency tracking | 综合最佳 balance, popular access |
| ARC (Adaptive Replacement Cache) | dual LRUs cache demand  subtle 动态 lurking | cache, e redirects |
| Random Replacement | randomly eviction | Acad, non-cond. Yes actual 留 still奇 |
| FIFO | 时序 first-in-out | queue-based (Memcached simple) |

### Persistent Cache vs In-process-only

persistent to disk 留流 SQLite intermediate map from/to serialize— but 是 capable container/useful AWS Memcached Elasticache persistent AOF.

---

## 三、OS Page Cache (Page Cache, Filesystem Cache)

Linux 内核 transparent cache aggressive: every read() / mmap() 在 文件内容在内存 (空闲 RAM) 保留. Subsequent 念重读到 cache.

- DB WAL ddl 生效, page cache 确被部分数据 buffer 上启平台 no fsync.很多时候商业先软件 reference fsync 只保存 WAL. fsync 时 数据 page cache  flushed.
- Postgres RAM-based shared_buffers 尽 25% RAM 配. OS page cache 又填 75%, DB cache + OS cache 可叠加 metricsutors 经典是 老陈正常 4 Ghetto cache.

### Direct IO bypass

```c
open(path, O_DIRECT | O_SYNC);
```

PostgreSQL 9.6+ supports cheap. 用 O_DIRECT 与 raw I/O ok DB cache table magic no OS drive.(Buffer Pool).

InnoDB `innodb_flush_method=O_DIRECT` 绕 page cache.

---

## 四、Redis Cluster (Remote Cache)

### Single Redis vs Redis Cluster

- **Standalone**: 单实例, RDB/AOF persistence, replication async to slave 主备
- **Sentinel**: 复 sentinel fa over
- **Cluster (3.0+)**: 自动 sharding 用 consistent hashing + Redis hash slots (0-16383) for hash-ring distribute. Multi-AZ HA: each hash slot 主 + N replicas.

### Architecture

```
client → route hash_slot = CRC16(key) % 16384 → which node primary
node forward lightweight (MOVED/ASK redirection)
minimum cluster = 3 nodes (3-primary + 3-replica)
```

Redis cluster 6 nodes 起 = 3 primary + 3 replica, 自动 fail-over (gossip protocol within cluster).

### Performance

- 单实例 100K+ QPS (单 thread, 6.0 IO threads allowed)
- Cluster horizontally scales, but cluster routing adds ~1ms for first MOVED operations.
- Sub-millisecond typical合理 hit ratio high.

### Weaknesses

- 集群 failure 窗口 直之 可写入 11 cold client。
- 异步复制 (master-ack client), 异 async makes synchronous feel 该 data lost 实现 rare. 5-10 秒 might不住.

### Redis Lua Scripting

Server-side scripting Redis (Lua语言): Atomic 历史&HUSE 的执行
- `EVAL script keys... args...`
- 原子 commands Lua single answer.
- Common patterns: rate limiter (token bucket), conditional update.

---

## 五、Memcached

相比 Redis, Memcached 多线程 + 性能 throughput 超单 Redis. dedicated.

| Dimension | Memcached | Redis |
|-----------|-----------|-------|
| Threads | Multi-threaded | Single-threaded (6.0 IO threads) |
| Persistence | NO | RDB + AOF |
| Data structures | Strings only | Many (strings, hashes, lists, sets, S-sets) |
| Replication | NO (无 native), 仅 client-side takes | Master-slave cluster, replication, sentinel |
| HA | Manual (tooling) | Sentinel + cluster failover aut |
| Cluster | 软 via consistent hash client | cluster protocol native |
| Memory | Slab allocator (no fragmentation) | jemalloc + eviction |
| Latency | sub-ms | sub-ms |
| Throughput | multi-threaded version ~1M+ QPS possible | single node 100K QPS |

Memcached 仍是 Wikimedia, Facebook, Twitter 使用重 cache service because multi-threaded throughput can be ~10x Redis (by Facebook they developed McRouter as client to consistent-hash shard Memcached cluster at scale).

---

## 六、HTTP Cache / CDN

### CDN Edge Cache

Cloudflare / CloudFront / Fastly / Akamai POP 提供 edge POP 缓存 user-facing static content. Latency from POP ~5-30ms depending user distance.

### Cache Headers

```
Cache-Control: max-age=3600, public
ETag: "..."
Last-Modified: ...
```

- max-age tells cache TTL.
- public/Private: public = shareable between users; private = browser only.
- ETag 强制条件请求 (`If-None-Match → 304 Not Modified`).

### TTL Strategy

- Pure static (logos, fonts): max-age=1 year
- JSON API responses: max-age=60s (eventual)
- HTML page dependent on user: private cache with max-age=0 (revalidate always)
- Web fonts require CORS (cross-origin resource sharing).

### CDN Bypass

`Surrogate-Capability` header 让 client 知可 CDN bypass:
```
Cache-Control: no-cache (always revalidate)
Cache-Control: no-store (never store)
Cache-Control: private (browser only)
```

### Stale-While-Revalidate

```
Cache-Control: max-age=600, stale-while-revalidate=86400
```

让 cache 在 max-age 过期后 还可 serve stale content 24h, async revalidate.

### CDN Surrogate-Control

Edge-specific cache头:
```
Surrogate-Control: max-age=86400
Surrogate-Key: article-12345
```

让 origin invalidate specific edge cache by key (`Surrogate-Key: article-12345`) without touching user browser cache.

### CloudFront Response Cache by Path

CloudFront cache by full URL path (path + query string) 可控:
- default: full URL
- multi headers: 防 cache dilution.

Cloudflare 类似.

---

## 七、Cache Hit Ratio 体系

### 计算:
$$\text{hit\_ratio} = \frac{\text{cache\_hits}}{\text{cache\_hits} + \text{cache\_misses}}$$

### Trade-off:

- 95% hit ratio 看 seems high; backend load 5% — much less than cache.
- 99% hit ratio reduce 99% load to 1% backend load, huge.
- 99.9% hit ratio = 0.1% backend = critical services;
- 99.99% hit ratio rare, requires extensive cache +精密 TTL + hot-key tuning.

### Inverse formula

$$\text{backend load} = (1 - hit \_ratio) × total \_traffic$$

心 SMELL 测试: backend load 更便宜 theta 性 平台latency I/O, must ensure hit ratio high enough 成 path capacity.

---

## 八、典型 Use Cases

### Twitter Hot Account Profile

1M live cache hits / sec cache behind nth latest profile read. 1.5GB working set current active million users (3 KB per profile).

### Netflix Open Connect

视频 content cache at CDN edge. ~100MB movie several CDN POP serve for trending cataloge. Bandth巾 ~ Petabytesserved. Cache edge = \(TB per\) POP. Origin not touched. CDN provider. 11/9 durability.

### E-Commerce Product Page

For each click, page composed of:
- Product info (redis cache TTL 60s);
- Inventory number (postgres read-through TTL=5s);
- Recommendations (cached batch in 1s + tag queries from storage)
- Reviews cached 60s

Typical page latency: ~20-50ms from subsystem caches 各 layer.

### GitHub repo page

cache ~ per repo info (your repo activity), 5min TTL. cache ready push back update invalidates + invalidate on push (webhooks 写 post-cache + push invalidation stack).

---

## 九、Capacity Planning

Cache size = working_set × budget_factor.
- working_set = active users / active items你需要 cache.
- budget_factor = 1.5 for 实际 write+read膨胀 not real working set.

Once growth exceeded cache size, evictions spike and hit_ratio drops abruptly.

### Monitoring Metrics

- `eviction_rate` — memory pressure
- `hit_ratio` per cache tier
- `latency_p99` per cache tier

---

## 十、典型事故

### Twitter 2012 cache failure storm

并没有 hot Twitter multipagecache size. Cache cluster auto 重启一次性失败 evicted all hot keys, 缓存miss → backend load倍 10×. Backpressure blocked cache fill from origin. Fix: gradual Redis cluster 加 extended TTL.

### GitHub Pages cache invalidation

GitHub 失不复 User Warehouse role 触 valid cache headers in past and als (actually legitimately re-attached) user repo access SSH pull before cache key. 缓存pre-shipment dict-configuration with Redis 配- hit旧 issue maintenance. cache-r地段 fixed.

### Facebook Memcached Thundering Herd

Facebook beam cache miss for single key contributions spawn deployment caches of same values = 1000 parallel computations of value. Fix: Token lease每 cache key, single 是 worker process recompute other wait.

---

## 十一、易错清单

1. **Cache 大不等于 hit ratio 大**: hit ratio 与 working_set 大小 ratio + 失效策略 + sequence access patterns 息息相关.
2. **不要把所有 keys 都放 in-process LRU+过期多**: memory size 8% of 进程 max is h大. Eviction spikes if abuse
3. **In-process cache + multi-instance issue: multi-replica divergent cache** — must include coherence layer (pub-sub to invalidate).
4. **Cache miss for large file triggers thundering herd** (multiple request simultaneously computing same value): Solutions: lock-and-fetch single worker pattern or use stale-while-revalidate.
5. **Redis Cluster size 5 nodes minimum for production HA**: lower than 3 primary 3 replicas (6 total) 风险 RPO > 0 after async replication lag.
6. **不要 cache "hot row" with infinite TTL**: hot content changes 偶尔变 so cache stale 会被 client 不要 把 always fresh extract e.g. always to fetch stored in raw.

---

## 十二、这一章带走的东西

1. Multi-level cache stack: CPU L1/L2/L3 → OS Page Cache → in-process (Caffeine) → Redis → Remote CDN → origin.
2. In-process cache 通常 LRU/Window-TinyLFU eviction; remote cache 通常 Redis single cluster + cluster replicate 写写入写异步.
3. CDN 缓存 hot static (images, fonts, video); edge POP 直接服务 user, 缓 backend 80-99% load.
4. Cache hit ratio exponential: ✅; 99% hit 比 95% hit 后端 load 减 5×, 99.9% 减 50× more. e. doubling a hit ratio reduces backend load by near factor.
5. Thundering herd: multiple 同时 miss = thundering herd; 同 1 worker fetch + others wait 应避免.

---

下一节 → [缓存模式](patterns.md)
