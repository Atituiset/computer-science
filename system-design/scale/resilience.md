# Resilience Patterns (弹性模式)

## TL;DR

**Resilience** = 系统在部分组件失效时仍提供 acceptable service 的能力。不靠 "完美系统没有故障" 的幻想, 而靠 **degradation + fallback + circuit breaking + retry + timeout + bulkhead + rate limit** 等工程师组合拳。Netflix Hystrix / Resilience4j 是把这些抽象 成 lib 的原型。本章梳理 8 个核心 resilience pattern, 实现方式 (Go / Java / Rust), 调参注意事项, 与典型事故 (circuit breaker too sensitive → 全部请求 reject, retry storm → self-DoS)。

---

## 一、Timeout

### 为什么重要

每个下游 call 必须有 timeout。 无 timeout → 线程无限 wait → 资源耗尽 → cascade failure。

### 什么值

- 下游 service P99 latency (假设) ~200ms
- 设 timeout = P99 * 2 = 400ms (够 99.9%)
- 对于 分 bucket service: 设 adaptive timeout: dynamic observe recent P99 + buffer.

### Adaptive Timeout (Google gRPC)

```go
ctx, cancel := context.WithTimeout(ctx, 800 * time.Millisecond)
```

### Connect vs Request timeout

| Timeout | 影响 |
|---------|------|
| connect timeout | TCP握手 e.g. 50ms |
| request timeout | full call inclu data e.g. 2s |

---

## 二、Retry

### 幂等必须

所有 retry 要求 **idempotent operations**: 不 double-pay. Use `Idempotency-Key` header in HTTP/gRPC.

### Retry策略: 固定间隔 / exponential backoff / 抖动

```
retry_1: delay 500ms
retry_2: delay 1s
retry_3: delay 2s (cap 5s)
```

避免 retry storm: 限制 max retry to e.g. 3。

### Retry Budget

同一 service 同时 retry 有限 (e.g., max 1000 concurrent retry)。 否则 retry 让问题更坏。

---

## 三、Circuit Breaker

### 状态机

```
CLOSED → (failure count > threshold) → OPEN → (wait timeout) → HALF-OPEN
  ↑                                                   ↓ success
  └─────────────────────────────────────────────────────┘
          ↓ failure again: re-OPEN
```

- CLOSED: 正常请求, 记录 failure.
- OPEN: 短路 request, 快速返回 fallback (不 调用下游).
- HALF-OPEN: 尝试 1-N probes; 成功 to CLOSED; 失败 to OPEN.

### Java Resilience4j 示例

```java
CircuitBreakerConfig config = CircuitBreakerConfig.custom()
    .failureRateThreshold(50)            // 50% 失败开闸
    .slowCallRateThreshold(50)           // 50% too slow also
    .slowCallDurationThreshold(Duration.ofSeconds(2))
    .minimumNumberOfCalls(10)            // 最少 10 calls before open能 estimate
    .waitDurationInOpenState(Duration.ofSeconds(30))  // 半开 30s
    .permittedNumberOfCallsInHalfOpenState(3)
    .build();
```

### 切换 fallback

```java
@CircuitBreaker(name = "inventory", fallbackMethod = "getFallback")
String getInventory(String productId) { ... }

String getFallback(String productId, Exception e) {
    return cache.getOrDefault(productId, "OUT_OF_STOCK");
}
```

---

## 四、Bulkhead

### 定义

把 系统 资源 分 池: 每个池 限制最大 concurrency, 防止 某 path resources 耗完 → other paths starved。

### 例子 (Java线程池)

```
Inventory pool: max 20 threads
Orders pool:    max 30 threads
Search pool:    max 10 threads
```

如果 Inventory 高峰, 只有 20 thread耗尽, orders 仍通过。

### Semaphore vs thread pool

- **semaphore bulkhead**: limit concurrent calls but reuse same thread
- **thread pool bulkhead**: full thread pool resource, heavyweight.

---

## 五、Rate Limiter

### 目的

保护 被调 服务: 单 user/clients call 不能 exceed limit (e.g., 10 req/s for `search` API).

### 算法

| 算法 | 适用 |
|------|------|
| Token Bucket | 通 bursty traffic; 每 1s refill N tokens max N burst |
| Leaky Bucket | 流出率固定, 队列满 drop |
| Fixed Window | 1s window 内 count 限制 |
| Sliding Window | 更好的精确度 (Redis Sorted Set) |

### Token Bucket 实现

```
Tokens per second: 10 (API key ABC)
bucket max capacity: 15
per second: add 10 tokens
```

### Distributed Rate Limiter: Redis + Lua script

```lua
local key = KEYS[1]
local rate = tonumber(ARGV[1])
local burst = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = 1

local bucket = redis.call('HMGET', key, 'tokens', 'last_time')
local tokens = tonumber(bucket[1]) or burst
local last = tonumber(bucket[2]) or now
local delta = math.max(now - last, 0)
tokens = math.min(burst, tokens + delta * rate)

if tokens >= 1 then
    redis.call('HMSET', key, 'tokens', tokens - 1, 'last_time', now)
    redis.call('EXPIRE', key, ttl)
    return 1
else
    return 0
end
```

---

## 六、Retry + Circuit Breaking + Rate Limiter 组合

最误导: circuit breaker OPEN 时, 触发 retry → return fallback clear over 半开 尝试. 避免 retry 绕过半开.

Good practice:
- Retry 一定 设在 circuit closed / half-open only.
- Circuit open → directly fallback (no retry).
- Rate limiter 高于 circuit breaker 前拦截.

---

## 七、Load Shedding

### 定义

当 收到  request > max capacity, 主动拒绝 (HTTP 503 vs 5秒 latent reply). preferable to 拒绝 快速 于 全超时。

### Distributed Limiting

```
Queue depth > threshold → reject.
Token-based or thread pool queue-limited.
```

### Netflix Concurrency Limits

Vegas 算法: 监视 RTT limit and dynamically adapt max concurrency.

---

## 八、Graceful Degradation & Fallback Closures

### 优先级 ordering

```
primary service  →  try

fallback 1:  Redis cache  (最新 stale)
fallback 2:  Static default
fallback 3:  empty response
```

### 静态 Fallback

- search server 故障: 返回 "search 不可用 稍后 return".
- recommendation 故障: 显示 global trending instead of personalized recommendations.

---

## 九、Chaos Engineering

Netflix Chaos Monkey, Chaos Kong (full region kill); random kill instances / regions, 系统 验证  resilience patterns self-heal。

### Example

- Netflix Simian Army: periodically kill region in production. Engineers 构建 tolerance.
- Gremlin, Chaos Mesh, Litmus 提供云 native 混沌.

---

## 十、典型事故

### Netflix "Circuit Breaker Open Lockout"

Hystrix config 过 激, 半开 一 failure (from cold start) → 长 open 20min. 实际 下游 早已 健康, 但 circuit breaker 持续 拒绝. Fix: `half_open_permitted=3` and 短 open duration.

### Retry Storm at Amazon

Internal service 故障 后, retry storm (2 retries max → de facto 3× load on healthy instances). instances 之后 全被 retry queue 淹没。 Fix: retry budget + adaptive concurrency limit.

### Rate Limiter too tight at Twitter/IP

Twitter API 限每 IP 15 requests / 15min, proxy users behind same nat 让 公共  WiFi 用户 blocked unknowingly. Fix: token-based rate limit based on user_id, not IP.

---

## 十一、易错清单

1. **Retry on non-idempotent function → double effects** (especially writes). Idempotency key  must be.
2. **Circuit breaker opening must have fallback**: else return `500` fast only - same as downstream dead.
3. **Retry burst: DoS downstream**: max allow retry budget + exponential backoff with jitter.
4. **Rate limit based on shared IP unreliably**: very limit users behind NAT; use auth token. 
5. **Bulkhead size too small ⇒ own lock**: monitor delay in bulkhead use reasonable capacity & 多.
6. **Timeout < request P99 ⇒ false positive**: adaptive timeout tracking.

---

## 十二、这一章带走的东西

1. 8 resilience patterns: Timeout / Retry + Exponential Backoff / Circuit Breaker / Bulkhead / Rate Limiter / Load Shedding / Fallback / Graceful Degradation.
2. Resilience4j / Hystrix 是 Java 标准 lib.
3. Rate limiter: Token Bucket per 用户, Redis Lua script distributed.
4. Circuit breaker state machine: Closed → Open → Half-open.
5. 组合: retry within closed/half-open; no retry open; circuit breaker higher priority.
6. Chaos engineering: Netflix / Gremlin / Chaos Mesh 验证。
7. Retry storm + Rate Limit shared IP 是 典型事故。

---

下一节 → [经典系统案例](../case/README.md)
