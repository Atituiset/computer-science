# 4. 性能工程: profiling / 火焰图 / 缓存与批处理方法论

## TL;DR

性能优化最怕两件事：**不看证据瞎猜**，和**为了优化而优化**。这一章给一套科学的方法论——先测量、再定位、后优化、最后验证，并给出实际工具（pprof / perf / async-profiler / flamegraph）与常见优化手段（缓存、批处理、索引、并发）的适用场景。

读完应能：
1. 用"测量 → 定位 → 优化 → 验证"四步走完一次性能优化，不靠猜。
2. 读懂火焰图，知道 CPU / 内存 / IO / 锁四种瓶颈怎么看。
3. 判断该用缓存 / 批处理 / 索引 / 并发哪个，而不是全上。
4. 识别最常见的性能反模式（N+1 查询、循环里做 IO、没缓存重复计算）。

---

## 一、性能工程的科学方法

### 1.1 四步循环

```
1. 测量    —— 量化现状（基线）：latency / throughput / 资源利用率
2. 定位    —— 找到瓶颈（profiling）：是 CPU? 内存? IO? 锁? 网络?
3. 优化    —— 针对根因下手（改算法/缓存/批处理/并发/索引）
4. 验证    —— 对比优化前后，确认有效且没引入新问题
```

> [!WARNING]
> 跳过"定位"直接"优化" = 赌博。没有 profile 就去改代码，90% 改错地方。**"过早优化是万恶之源"**不是"别优化"，而是"别在不测量时优化"。

### 1.2 关键度量

| 度量 | 含义 | 看什么 |
|------|------|--------|
| Latency（延迟） | 单个请求耗时 | 均值、P50/P95/P99（比均值重要） |
| Throughput（吞吐） | 单位时间请求数（QPS） | 峰值 / 饱和点 |
| Saturation（饱和度） | 资源利用率 | CPU/mem/IO/连接池是否到顶 |
| Errors（错误率） | 5xx/超时占比 | 性能劣化的直接信号 |
| 资源利用 | CPU/内存/磁盘/网络 | 找瓶颈在哪类资源 |

### 1.3 P50 vs P95 vs P99

- 均值会骗人（99% 快 1ms，1% 慢 10s，均值还是 1.1ms）。
- **P99** 代表"最差用户体验"——很多"系统挂了"其实是 P99 爆表。
- 优化目标常是"P95/P99"，不是均值。

---

## 二、定位瓶颈：四大类

### 2.1 CPU 瓶颈

**现象**：CPU 100%、吞吐上不去、延迟随负载线性涨。

**手段**：CPU profiler（采样），找热函数。

```
pprof 火焰图
  顶部 = 实际执行中的函数（宽 = 占比高）
  向下 = 调用栈
  最宽的那条 = 热点
```

**工具**：
- Go: `pprof`（`net/http/pprof` 或 benchmark）
- C/C++/Rust: `perf record` + `perf report`
- JVM: `async-profiler` + flamegraph
- Python: `cProfile` / `py-spy`（生产无侵入采样）

```go
// Go: 开启 pprof 端点
import _ "net/http/pprof"
// 然后: go tool pprof http://localhost:6060/debug/pprof/profile
```

### 2.2 内存瓶颈

**现象**：内存飙高、GC 频繁、OOM、Swap。

**手段**：内存 profiler + heap 分析。

```
Go:  go tool pprof -inuse_space   # 当前驻留内存
     go tool pprof -alloc_space   # 累计分配（找分配热点）
JVM: jmap + MAT / async-profiler alloc
```

**常见内存反模式**：
- 大对象反复创建（没复用 buffer）
- 切片/数组预分配不足导致反复扩容
- 缓存无上限（LRU 缺失）
- 逃逸分析失败导致频繁堆分配

### 2.3 IO 瓶颈（磁盘/网络）

**现象**：CPU 不高但慢、`io wait` 高、吞吐低。

**手段**：IO profiler + 观察系统层。

```
iostat -x 1        # 磁盘利用率 / await / svctm
pidstat -d 1       # 每进程 IO
sar -n DEV 1       # 网络吞吐
```

**判断**：`await` 高 = 磁盘慢；`%util` 100% = 磁盘饱和。

### 2.4 锁 / 并发瓶颈

**现象**：核多但用不满、延迟随核数先降后升（争用）、CPU 有 idle 但吞吐低。

**手段**：锁 / 阻塞 profiler。

```
Go:  pprof mutex / block profile
JVM: async-profiler -e wall 看阻塞线程
```

**判断**：火焰图里很多 `sync.Mutex.Lock` / `parked` → 锁争用。

---

## 三、读懂火焰图

### 3.1 火焰图怎么读

```
      ____________
    __| funcC      |__      ← 最宽的横条 = 占 CPU 最多
  _|__| funcB      |___
 _|___| funcA      |______
|  main()          |       ← 栈底 = 入口
```

- **横轴** = 采样时间占比（宽度），**纵轴** = 调用栈深度。
- 最宽处 = 瓶颈。顺最宽路径往上，就是"为什么这么慢"的根因链。
- 看**自己代码**而不是库函数——如果最宽是 `memcpy`/`json.Marshal`，说明热点在被调用的库上。

### 3.2 四种典型形态

| 形态 | 含义 |
|------|------|
| 尖顶（一个函数很宽） | 单个热点，改这个函数 |
| 平顶（很多函数窄） | 均匀分布，别微调，该换架构（批处理/缓存） |
| 山丘（高层很宽） | 调用栈深，函数频繁被调，可能 N+1 |
| 锯齿（大量短窄条） | GC / 频繁小分配 |

### 3.3 生成火焰图

```bash
# Go
go tool pprof -raw http://localhost:6060/debug/pprof/profile > cpu.raw
go tool pprof -proto http://localhost:6060/debug/pprof/profile > cpu.pb.gz
# 用 https://speedscope.app 或 flamegraph.pl 可视化
```

---

## 四、常见性能反模式（先自查这些）

| 反模式 | 问题 | 修复 |
|--------|------|------|
| **N+1 查询** | 循环里每项查一次 DB | JOIN / IN / 批量加载 |
| **循环内做 IO** | 每次迭代网络/磁盘 | 批处理 + 缓冲区 |
| **重复计算** | 同一结果每次重算 | 缓存 / memoization |
| **未索引查询** | 全表扫描 | 加索引 / 覆盖索引 |
| **无界内存增长** | 缓存无限大 / 切片反复扩容 | LRU 上限 / 预分配 |
| **大 JSON 全量** | 一次加载整个大对象 | 流式 / 分页 |
| **同步串行调用** | 无关请求顺序执行 | 并发 / 扇出 |
| **频繁小请求** | 大量小包 | 批处理 / 复用连接 |
| **日志风暴** | 每条请求打十几条 log | 采样 / 降噪 |
| **死锁/超时无上限** | 依赖未设 timeout | 设超时 + 熔断 |

> [!TIP]
> **先扫描反模式清单，再上 profiler**。很多"性能问题"其实是显而易见的代码问题（N+1、循环 IO），一眼看到就不用 profile 了。

---

## 五、优化手段：什么时候用哪个

### 5.1 缓存（Cache）

**适用**：同一结果被反复读取、数据变化不频繁、读远多于写。

**代价**：一致性（stale）、失效复杂度、内存占用。

**关键决策**：
- 本地缓存（单进程，LRU）vs 分布式缓存（Redis，跨节点）
- 失效：TTL / 主动失效 / 版本号
- 缓存一致性：cache-aside / write-through（见系统设计 §cache）

```go
// Go: 简单 LRU 缓存（sync.Map 或 bigcache）
var cache = make(map[string]*Entry)  // 生产用 lru 库
func Get(key string) *Entry {
    if e, ok := cache[key]; ok { return e }  // hit
    e := loadFromDB(key)                      // miss → 加载
    cache[key] = e
    return e
}
```

### 5.2 批处理（Batching）

**适用**：大量小操作（网络请求、DB 写入、消息发送）、往返延迟占主导。

**代价**：延迟增加（凑批要等）、错误影响面变大。

```python
# ❌ 逐个发送（N 次网络往返）
for msg in messages:
    send(msg)

# ✅ 批量（1 次往返）
send_batch(messages)
```

### 5.3 索引（数据库）

**适用**：查询慢、全表扫描。

**关键**：
- WHERE/JOIN/ORDER BY 用到的列建索引
- 覆盖索引（列都包含）避免回表
- 复合索引的列序（最左前缀）
- 见数据库 §indexing

### 5.4 并发（Concurrency）

**适用**：多个独立任务可并行、有闲置资源、IO 等待为主。

**代价**：锁争用、调度开销、复杂度。

```go
// Go: 扇出 + WaitGroup
var wg sync.WaitGroup
results := make([]Result, len(urls))
for i, u := range urls {
    wg.Add(1)
    go func(i int, u string) {
        defer wg.Done()
        results[i] = fetch(u)
    }(i, u)
}
wg.Wait()
```

> [!WARNING]
> 并发不是银弹：如果瓶颈是 CPU（已经 100%），并发只会更糟（调度开销）。**只有 IO 等待为主的场景，并发才有效**。

### 5.5 算法/数据结构

- 从 O(n²) 改 O(n log n)（哈希表替代线性查找）
- 见 DSA 全部——这是"性能工程"的底层工具箱。

---

## 六、性能优化的优先级判断

### 6.1 80/20 法则

- 通常 20% 的代码占 80% 的时间。**只优化 hot path**，别优化冷路径。
- 先 profile 找到那 20%，再动手。

### 6.2 先确认瓶颈在"该层"吗

```
延迟高 → 是应用慢? 网络慢? DB 慢? 还是依赖服务慢?
  - 应用慢 → 上 profiler
  - DB 慢 → EXPLAIN + 索引
  - 网络慢 → 测 RTT、看是不是跨区域
  - 依赖慢 → 看上游 P99, 加超时熔断
```

> [!TIP]
> 用 **"分层归因"**（类似 prologue 抽象层级的调试法）：先把"慢"归到 应用/DB/网络/依赖 哪一层，再进该层细化。省大量走弯路。

### 6.3 优化后验证

```bash
# 优化前后对比 (Go benchmark)
go test -bench=. -benchmem ./...
# 观察 P99 变化: 从 500ms → 80ms, 就是有效
```

---

## 七、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **四步**：测量 → 定位 → 优化 → 验证（先 profile 再改代码）。
> - **看 P95/P99**，不是均值。
> - **瓶颈四大类**：CPU（profiler）/ 内存（heap）/ IO（iostat）/ 锁（mutex profile）。
> - **火焰图**：横轴 = 时间占比，纵轴 = 调用栈，最宽 = 热点；看自己代码不看库。
> - **先扫反模式**（N+1、循环 IO、重复计算、未索引）再上 profiler。
> - **缓存**：读多写少、允许 stale；失效策略要设计。
> - **批处理**：小操作多、往返占主导。
> - **索引**：WHERE/JOIN/ORDER BY 列。
> - **并发**：只有 IO 等待为主才有用；CPU 瓶颈并发更糟。
> - **分层归因**：先把慢归到 应用/DB/网络/依赖，再细化。

---

下一篇: [5. 应用安全: OWASP Top 10 / 认证授权 / 数据安全 / 供应链](app-security.md).
