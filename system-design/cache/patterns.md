# 缓存模式 (Cache Patterns)

## TL;DR

常用的应用层 cache 与持久存储互动模式:
1. **Cache-Aside**: app 先查 cache; miss 才查 DB; 同时填 cache.
2. **Read-Through**: cache 自动从 DB load (cache service transparent block)
3. **Write-Through**: write 同步到 DB + cache, 同时更新. 
4. **Write-Behind / Write-Back**: write 进 cache; async flush to DB. **可能丢数据**
5. **Refresh-Ahead**: cache 提前 refetch before expiry

每种 pattern 有适用场景与风险, 必须理解 trade-off. 本章也讲述 cache key naming (namespaced + tier-specific names), TTL 设计 (10s-7d), 但 biz 望(source-pattern instructions patterns not deep needed)。

---

## 一、Cache-Aside (Lazy Loading)

### 算法

```python
def get(key):
    val = cache.get(key)
    if val is None:    # cache miss
        val = db.query(key)
        if val:
            cache.set(key, val, ttl=60)
    return val

def set(key, val):
    db.update(key, val)
    cache.delete(key)      # 也可 cache.set(), 但 stale 风险 with concurrent
```

### 优点

- App 控制 cache decision (不一 transparent)
- TTL 控制 stale window
- Old version 不被 setDate; cache fals returned next miss should fetch 刷新
- 适合 read-heavy, write-low

### 弱点

- Cache miss 后多重 client 同时 miss = thundering herd (multi-thread/few-client + same key 缓存 stampede) — mitigation: 互斥锁 / single-flight fetch.
- Write-through override 时 cache delete 仅不 invalidating writes disk to in ensure 別点 冰 hot path not-base + perator.
- TTL 必 must set  balancing staleness 与 cache pressure.

### Best Practice

- Use **lock+mset**: each miss 先 acquire lock (SETNX), single worker fetches 持中 cache kills 后讀 + 讀 ensure write errors be escaped.
- Set short TTL + jitter 当防止 synchronous expiry → stampede to DB.
- 监控 cache hit ratio 与 miss latency; alert on hit ratio < 95% over 5 min.

---

## 二、Read-Through

### 算法

```python
class ReadThroughCache:
    def __init__(self, cache_backend, loader_fn):
        self.cache = cache_backend
        self.loader = loader_fn
    def get(self, key):
        return self.cache.get(key, loader=self.loader)
```

Cache 类内部自动 miss 时 call loader function (database) + fill cache + 返 result。

### 优点

- App 不 用 handle miss logic; cache 透明处理.
- Multiple clients 经过 cache layer 一次 fetch — single-flight reduces stampede.
- Cache layer 集中 复杂 logic 跨 services reuse.

### 弱点

- Cache layer 全故障 ⇒ crash clouding (must have fallback + circuit breaker).
- Loader fn 同步含 disk call; cache 故障 ⇒ service down.
- "Single flight" usually not auto implemented. Must be explicit in cache library (e.g., Etsy/statsd, singleflight golang).

### 用例

- Twitter fatcache (origin Redis + loader goes to backend 集中 in-process) 缓存 image metadata.
- Memcached + libketama for transparent read-through clients.

---

## 三、Write-Through

### 算法

```python
def write(key, val):
    db.update(key, val)         # commit first
    cache.set(key, val, ttl=...)
```

同步 落 database + cache. 客户不 ack 直到 both write 成功.

### 优点

- Cache immediately fresh, no stale window.
- DB 缺 cache loss仍是 correct.
- Write-heavy 细节 确保 cache 更新及时.

### 弱点

- Write latency = DB write time + cache time. 比 cache-aside write 慢 (write 直接 DB 然后 cache delete).
- Cache 与 DB 暂 死锁 race if invalidations burst between transaction.

### 用例

- Inventory management, financial transaction log
- User preferences (mutated from any client; cache must be coherad).
- Object status (e.g., order status pipeline).

---

## 四、Write-Behind / Write-Back

### 算法

```python
# Write-Behind
def write(key, val):
    cache.set(key, val)     # only cache update
    queue.put("write_to_db", key, val, due=immediate)
    # async worker reads queue + flushes to db periodically
```

Cache update write first, **DB writes batched / async** to improve throughput.

### 优点

- Write latency = cache latency only, super fast.
- 适合 write-heavy OLTP 入高 QPS (Telemetry, log, IoT).
- DB writes batched 减少 IO 操作; amplification reduce.

### 弱点

- **数据丢失 risk**: cache 故障后 queue 等丢失; DB 有未写数据 史 lost + fatigue 倁 is preventing.
- Cache + DB 不 strictly consistent; cache mirr stop concurrent read 看 stale
- queue 长不满 = DR confirmation consistency 又 使 测试 errors latency
- 必须 at-least-once semantics with idempotent retry.

### 用例

- Telemetry/log ingestiong
- IoT 设备 sensor reading (容忍丢样品 1s)
- Heartbeat / cloudmetric updates
- APM deger (Datadog spies writes to local buffer agent before engineering upload)

---

## 五、Refresh-Ahead (Proactive Caching)

### 算法

Cache 配合 "Predictively refresh" 基于老 TTL inredictions:
```python
def get(key):
    val = cache.get(key)
    if val.is_near_expiry:
        # 异步 refresh
        sched_async_reload(key)
    return val
```

cache 体外 让忠 客 elsewhere task
miss. Scala. Most unjamat 白 州 大  上 那 is 多 thread whose variant processing DIC 流 满中 load 都一致.

### 用例

- 高 current cache with long compute (image rendering, ML inference).
- 主动预热cache for hot news events.
- Periodic refresh strategy = 模опримечCum Usage.

### 弱点

- Refresh worker too aggressive = load backs, DB unavailable 失败 risk。
- require configure with pro-active TTL Predicted; Tier bindings
- Not 支持一般 cache system; 需要 实验中 显 explicit code.

---

## 六、Cache Stampede & Single-Flight

### Cache Stampede

许多 clients 同一时间 miss + 同 call DB → thundering herd, DB overloaded. 触发场景: 大 popular hot key TTL expire 同时, 导致所有 client miss same time.

### Mitigation 1: Mutex / Lock

```python
def get(key):
    val = cache.get(key)
    if val is None:
        if distributed_lock.try_acquire(key, ttl=10s):
            try:
                val = cache.get(key)
                if val is None:
                    val = db.query(key)
                    cache.set(key, val, ttl=60)
            finally:
                distributed_lock.release(key)
        else:
            time.sleep(50ms)
            return get(key)   # retry cache
```

Only first worker fetches DB; others sleep, retry cache (fill by first worker).

### Mitigation 2: Two-Layer Cache (L1 + L2)

L1 = local process cache (1s TTL, light)
L2 = Redis (longer TTL, sharing)

请求先 L1; L1 miss → L2; L2 miss → DB。

### Mitigation 3: Probabilistic Early Refresh

```python
def get(key):
    val, expire = cache.get(key)
    if expire - now < jitter(0.5, 50s):
        # 5% probability to refresh early (spread-out 多 clients)
        if random() < 0.05:
            cache.refresh(key)
    return val
```

XFetch algorithm (Vattani et al. 2015): 每个 client random 决定 pre-fetch + 后 TTL expiry.  Distributed refresh bash 95-99% clients refresh before expiry → low pressure on DB.

---

## 七、TTL 设计

| TTL | 适用场景 |
|------|---------|
| ~5-15s | highly transactional data (inventory 与 price) |
| 30-60s | user data 可能 stale (user profile) |
| 5-15min | tags, categories (relatively static) |
| 1 hour | product catalog 配置 |
| 24 hours | static content (styles) |
| Permanent | immutable data with versioned key (asset files) |

### Plus-Jitter (避 expire 同步)

```python
def set_with_jitter(key, val, base_ttl):
    jitter = random(0, base_ttl * 0.1)
    cache.set(key, val, ttl=base_ttl + jitter)
```

避免 cache miss storm when same key expires simultaneously.

---

## 八、Cache Key Design

### Naming Convention

`{app_name}:{entity}:{id}:{version}`

例: `shopcart:user:42:v3`

- `app_name`: namespace 避开 conflict (use+cache)
- `entity`: data class 类, doesn't clutter the registry
- `id`: ttl oprumus
- `version`: schema version critical for cache invalidation after code changes (deploy new code + bump version → fresh cache)

### Hash Cache Key (Long-Term Keys)

For keys >250 chars (Redis max 512MB), 多 用 short content-addressed hash:
```
key = "feed:user:42:day:2024-05-01:" + sha1(query)[:8]
```

reduces key 大但是防 collision.

### Conditional Sweep With Collections

管理 key collection by prefix:
- `keys shopcart:user:42:*`
- (Redis keys * is O(N), slot ** SCAN 配 useARING 必 with count, production 上 is the careful our else)

---

## 九、典型 Use Cases

### Reddit vote caching (Cache-Aside + Lock)

```python
def get_vote(player):
    val = redis.get(f"vote:{player}")
    if not val:
        if redis.set(f"lock:{player}", "1", nx=True, ex=5):
            val = db.get_vote(player)
            redis.set(f"vote:{player}", val, ttl=60)
            redis.delete(f"lock:{player}")
        else:
            sleeps(50 ms)
            return get_vote(player)   # retry fill
    return val
```

### Booking.com catalog search cache (Refresh-Ahead)

预先 prefetch hot hotel之乡 cache 基于历史 search volume pattern; attenuate cache spikes; users see cache always with stable.

### Stripe cache write (Write-Through)

Each invoice create. 更新 cache (with TTL) and 同步写入 Postgres. Card 90+ minutes 检测 cache staleness + check coverage from DB.

### LinkedIn shared feed cache (Read-Through)

Read-through cache layer with loader function generating feed (expensive computation) once then cached; invalidation keyed RATED write 写 fly through更新 写 + read post eager since ttl+key align.

---

## 十、典型事故

### Cache Stampede Saleforce 2016

Cache 切 stampede after one shard was misconfigured with -1 TTL expiry. ~5K client miss same key 同 fetch DB → DB cluster overloaded ~30s. Fix: lock-based single flight + jitter TTL.

### Inconsistent Cache for Stale Read Reddit

Reddit 用 cache-aside 后,一会儿 update_post_metadata 直接 DB; cache + ttl 局 60s; 更新 时 缓存 中 stale. 用户 看 post metadata 60s 后 last 削减. Fix: 自动 update cache + 写后 "DEL key" pattern.

### Cache Invalidation storm US government hockey team site

"Balance updates" ⚠潜在 handle score update → 事件 200+ events invalidate local at thousands ton menu k "letter fui"- subscribe تشी invalidation list.  Invalidation delay thoroughly Tier 1 vs Dispatch bad. Fix: Write-through cache always use "data 一起 update DB + cache 依次 同步 rewrite exactly for data integrity)".

---

## 十一、易错清单

1. **Cache-Aside 必 想到 thundering herd**: single-flight lock, jitter TTL 防止 stampede。
2. **Write-Behind 必须接受 at-least-once + idempotent retry**: crash 时 data 可能重发 DB; DB upsert idempoton.
3. **Read-Through cache miss fallback**: cache layer fail 不应 kill service, must gracefully fall back to DB.
4. **Cache key version + invalidate on code deployment**: 旧 cache key 仍旧 craft 旧 data shape; version bump 强制 invalidate 全部.
5. **TTL 不能太短 (低 hit ratio) 或太长 (stale)**: 平衡; 5-60s 是常用短 TTL.

---

## 十二、这一章带走的东西

1. Cache-Aside: app 直接控制, lazy fetch; stampede risk ⇒ use single-flight lock.
2. Read-Through: cache layer transparent miss handling; single-flight native.
3. Write-Through: DB + cache 同步 update; consistency strong, write latency 高.
4. Write-Behind: cache first + async flush; 读写 fast but risk data loss on failure.
5. Refresh-Ahead: 提前 refresh before TTL; prevents hot leaves cold at expiry.
6. Single-Flight Pattern + Jitter TTL + XFetch prob refresh = best practice for 防止 stampede, 适用 high-scale cache.

---

下一节 → [缓存失效模式与雪崩/穿透/击穿](failure-modes.md)
