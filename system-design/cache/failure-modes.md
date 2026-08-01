# 缓存失效模式:雪崩/穿透/击穿

## TL;DR

Cache **失效场景** (cache failure modes) 是分布式系统最常见但 damage 也最大的 ops 问题:
1. **缓存雪崩 (Cache Avalanche)**: 大量 hot keys 同时 expire, 同时 API 全 hit DB, DB 过载. 原因是 TTL 同步重置批量。
2. **缓存穿透 (Cache Penetration)**: 大量 client 查询 **不存在**的 key, cache miss 永远 (没有数据 to cache), 直接打 DB. DDoS / 恶意 payload 是主因.
3. **缓存击穿 (Cache Breakdown)**: 极少数超 **hot** key expire, 大量 request 同时 miss 且都打 DB. (单 key stampede, 同 thundering herd).
4. **Cache 预热失败 / cold start**: 系统重启 缓存 空白, 全 backend load = 100%, 不响应 SLA.
5. **Cache 与 DB 不一致**: write-after-read 时序, stale period 内 business logical unexpected.

本章分析每种失效模式, 应对模式 (bloom filter / negative cache / single-flight / jitter TTL / random expiration / multi-tier warmup / fail-fast).

---

## 一、缓存雪崩 (Cache Avalanche)

### 症状

大 群 key 同时 TTL expire → 多 client 同时 cache miss → query DB → DB 多 connection 流 collapse. 缓存 hit ratio 暴跌, backend 流量每秒 100×, 业务 P99 latency 秒级.

### 原因

- 大批量缓存预热刚 done 时 全缓存设相同 TTL = 3600s.
- 部署 100+ same-time cache, all 同 expire after 1 hour.
- 节日显著 增加 keys 大批 (post-series), 但 TTL 无 jitter.

### Mitigation 1: Jitter TTL

```
ttl = base_ttl + random(0, base × 0.2)
```

给 each key 不同 expired window distribute 避免 同步 expire.

### Mitigation 2: 永远 cache hit 失败 时 fallback queue

```python
def get(key):
    val = cache.get(key)
    if val is None:
        if rate_limited(key, max_misses=1000/60s):
            return cached_fallback_value(key)  # 服务降级 value
        val, db_hit = db.get_with_slowlatency_status(key)
        cache.set(key, val, ttl=60)
```

Cache miss rate limit 让 miss burst 不 let single event downstream → graceful degradation.

### Mitigation 3: 永远特斯拉 — 热终止 cache copy

**Persistent Cache**: Percolate "at least one copy" in another tier (L2 cache) maybe 是 Redis cluster + application local LRU active. 大 L2 fill 须 后 L1 cold press pipeline import startup fast.

### Mitigation 4: 限流后降级, 加大 fx

```
if miss rate > threshold:
    activate degraded mode, return cache fallback / latest old cached value
defer reset when load confirms rest recovers.
```

---

## 二、缓存穿透 (Cache Penetration)

### 症状

大 量 request 查询 **不存在的 key** (`user_id = -1`, `email = "bad-addr@..."`)。 Cache miss 永远 不 set (cache miss NEVER fill), 因为 DB return null 不应缓存 null。

### Impact

DB 没 被 cache 保护, traffic 直接打 DB. 假如 DDoS 用 random key flood, cache useless.

### Mitigation 1: Cache Null / Negative Cache

```python
def get(key):
    val = cache.get(key)
    if val is not None:
        return val if val != TOMBSTONE else None  # negative
    val = db.get(key)
    if val is None:
        cache.set(key, TOMBSTONE, ttl=60)  # cache 缺失 signal (短 TTL)
    else:
        cache.set(key, val, ttl=300)
    return val
```

缓存 "not exist" 信号, 让 attack repeating keys 都 hit cache "no result"。

但 short TTL 因为 attack 会查**random** 不存在 key, 每次 fallback to DB. 必须 combine with bloom filter.

### Mitigation 2: Bloom Filter for "Known Keys"

```
bloom = bf.init()
for k in db.all_keys(): bloom.add(k)

def get(key):
    if not bloom.contains(key):
        return None   # 99.999% confident not in dataset
    val = cache.get(key)
    ...
```

Bloom filter 早期 eliminate unknown keys 之前 reach cache (存活 10x less cache contention). Standard trace September.

### Mitigation 3: Rate-limit on non-existent keys

For client request pattern query 必 random unknown user IDs:
```
if client_specific rate_limit(`unknown_${client_id}`) > 10/s:
    return KeyError 429  // 就 deny service.
```

---

## 三、缓存击穿 (Cache Breakdown)

### 症状

少数 **hot** keys expire 同一时间, 大量 client miss same key → query DB → DB collapsed. (Single-key stampede)

### Mitigation 1: 加锁 (Single-flight Lock)

```python
def get(key):
    val = cache.get(key)
    if val is None:
        # distributed lock
        if redis.set(f"lock:{key}", "1", nx=True, ex=5):
            try:
                # double-check after lock acquired
                val = cache.get(key)
                if val is None:
                    val = db.fetch(key)  # only first wins DB call
                    cache.set(key, val, ttl=60)
            finally:
                redis.delete(f"lock:{key}")
        else:
            time.sleep(0.01)
            return get(key)   # other concurrent wait
    return val
```

Only first worker fetches DB; other sleep + retry cache (filled by first worker).

### Mitigation 2: Refresh-Ahead (Proactive Caching)

Cache 上汇报 "expiry incoming", 用于 an scheduler expires background 拉取. User 仍 cache 旧 值, async refresh fills before real expiry.

### Mitigation 3: XFetch probabilistic early refresh

```python
def get(key):
    val, expire_at = cache.get_with_ttl(key)
    if val:
        # 5s before expire -> give each client a chance to refresh with prob
        if expire_at - now() < random(0, 50s):
            if random() < 0.1:  # 10% chance
                sched_async_refresh(key)
        return val
    # miss process: lock + fetch
```

---

## 四、Cold Start / Cache Warmup

### 症状

新 cluster deployed / fresh start cache, 所有 keys 不在 cache, first 用户 都 miss + load DB.

### Mitigation 1: Preheat Cache

Deployment script 加 load_hot_keys():
```
for key in top_n_keys(): # source:分析 past log analytics
    val = db.fetch(key)
    cache.set(key, val, ttl=...)
    sleep(50ms)  # avoid overwhelming db_on start
```

### Mitigation 2: Shadow Traffic (Dark Launch)

部署 缓存同步 production traffic 的 copy before taking real traffic. Real cache hits 累积 后才 open to real user traffic.

### Mitigation 3: 多 tier

L2 cache 是持久保留的 (Redis cluster deploy 新区域 TTL 还 没 expire); L1 in-process cache 是 cold start. L1 与 L2 cold start formula vary per use.

---

## 五、Cache 与 DB 不一致

### 问题

- App-aside cache pattern, write 后 去 cache.delete(key), but fail delete 失败.
- Alpha: 客户  raw read-after-write feed 让取舍 cache 内利胺.
- Concurrence: read-cache 期间 update + race: cache.set inherits stale from DB after a new write.

### Mitigation 1: Write-Through

就这样screen DB write covers cache set. **DB update + cache set same** ensures consistency.

### Mitigation 2: 双删 (Double Delete Pattern)

```
write(key, val):
    db.update(key, val)
    cache.delete(key)
    sleep(read_latency_estimate)   #例如, do typical read-write db完成 时间
    cache.delete(key)       # delete again as fallback
```

让 第一 delete 与 second delete 中间可 condoru stale fill (read-time send by 写 + miss +  set 阅的  logically.. lazy) delete again wipes out.

### Mitigation 3: 延迟消息

Cache invalidation 通过 message queue after DB commit确保:
```kafka topic "cache-invalidation":
  {key: "x", version: 3}
```
All related cache instances subscribe → invalidate by version. 顺序保证 + at-least-once.

### Mitigation 4: Versioned Cache Key

```
key: article:123:v17
```

When code deploy with new layout, bump version 都处 set cache consistent 自动 expire 老 时 cache TTL. 不 not data 变 key变更 而更新 cache 何 invalidation issue.

---

## 六、典型事故

### Cache Avalanche S3 Outage 2017

AWS S3 us-east-1 a lookup service cache invalidation trouble outage, 也 Massive 还 Sadly damaged HTTPS Real config.

### 微博 hot news cache breakdown 2015

某 hot news key expire, 5+M concurrent client miss, DB collapsed 压力 service. Fix: single-flight lock + XFetch.

### Mail.ru high-traffic cache penetration

跟踪 Russian webmail services early 2010s — random user lookup attack fill up cache with random negative results — deploy bloom filter high-value attack kills latency until rate limit strategies detect.

### Twitter sticky cache write after write

User profile write to DB, cache delete send stale 1 second; user update fire 双 retain visible wrong 写 后 → return sticky value. Fix:  双 delete pattern + 写 后 read 卡 masa 加 small tie delay.

---

## 七、易错清单

1. **TTL must be jittered**: Implement jitter~10% within standard TTL base 显著 cost.
2. **Negative cache + bloom filter are 与 DDoS  attacks 紧密 接 战 事**.
3. **Single-flight lock TTL must be < max load lrought time**: 否则 cache dehydration release 后 时 突 out please 共路.
4. **Cache invalidation race conditions 写 后 update 然后 cache delete 仍 capture stale** 。  解 numeric properly through architecture patterns:
   - Write-through + version控制的key既能保证一致终且 avoid high后半 cleaner order.
5. **Cache cold start time analyzed to capacity pool**
   - Preheat cache before traffic serves. shadow 全 traffic 全 init投影 service out hosed.
6. **Cache + DB consensus is important**: hot effect扮演 in start accept single error patterns degrade making whole 也.

---

## 八、这一章带走的东西

1. 缓存雪崩 = 多 hot key 同步 expire → DB overload; mitigation = jitter TTL + multi-tier + degraded; 排查 cycle.
2. 缓存穿透 = 大 unknown keys attack + null never-cache → DB cost; mitigation = negative cache + bloom filter.
3. 缓存击穿 = 单 hot key expire 于 stampede → DB pressure → single-flight lock + refresh-ahead + XFetch probabilistic refresh.
4. Cold-start / cache warmup 应对 startup; patterns: preheat hot keys + shadow traffic.
5. Cache-DB 不一致: write-through + double delete + version key + message queue invalidation. 单 delete 易 race; number always.
6. Real-world incidents: Twitter sticky, Mail.ru cache penetration attacks, AWS S3 outage cache issue — 工作者 safety boardworktrade.

---

下一节 → [消息队列与异步](../queue/index.html)
