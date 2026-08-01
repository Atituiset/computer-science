# 7. 可观测性实操: metrics/logs/traces 打点 / OpenTelemetry / SLO

## TL;DR

"能上线"不等于"能 debug"。可观测性（Observability）是让**生产系统的行为可以被理解**的能力——不是单指监控，而是 metrics（数字）/ logs（事件）/ traces（链路）三件套。system-design 部分讲了理论（SLO/SLI 框架），这一章落到**怎么打点、怎么选指标、怎么用 OTel、怎么把 SLO 和告警接起来**。

读完应能：
1. 区分 metrics/logs/traces 各自适合什么、怎么协同。
2. 给自己的服务打上正确的指标（RED/USE 方法）。
3. 用 OpenTelemetry 做跨服务链路追踪。
4. 设计合理的 SLO/SLI 并接到告警上，避免告警疲劳。

---

## 一、三件套（Pillars）

### 1.1 各自是什么

| | Metrics | Logs | Traces |
|--|---------|------|--------|
| 本质 | 聚合的数值 | 离散的事件 | 跨服务的调用链路 |
| 回答 | "现在多快/多忙/多少错误" | "出了什么事" | "一次请求经过了哪些服务" |
| 维度 | 高维标签 | 结构化字段 | 时间跨度 + 服务节点 |
| 工具 | Prometheus / Grafana | ELK / Loki | Jaeger / Tempo |
| 粒度 | 聚合 | 单条 | 单请求 |

### 1.2 三件套的关系（经典示例）

```
问题: "下单变慢了"
  Metrics: 下单 P99 从 200ms → 2s (发现问题)
  Traces:  链路显示 80% 时间花在「库存服务」调用 (定位)
  Logs:    库存服务日志显示连接池耗尽报错 (根因)
```

> [!NOTE]
> **三件套要关联起来**才有用：trace 带 trace_id，log 也带 trace_id，metric 挂 trace 的标签——这样从"数字异常" → "链路定位" → "日志根因"一条龙。

---

## 二、Metrics：怎么选指标

### 2.1 两种经典方法论

**RED（服务层，微服务）**：

| 指标 | 含义 |
|------|------|
| **R**ate | 请求速率（QPS） |
| **E**rrors | 错误率（5xx/业务错误） |
| **D**uration | 延迟分布（P50/P95/P99） |

**USE（资源层，基础设施）**：

| 指标 | 含义 |
|------|------|
| **U**tilization | 利用率（CPU/内存/磁盘%） |
| **S**aturation | 饱和度（队列长度/等待） |
| **E**rrors | 错误数 |

### 2.2 必须有的基础指标

```text
# 服务层 (RED)
http_requests_total{method,path,status}
http_request_duration_seconds{le=...}      # histogram
http_errors_total

# 资源层 (USE)
cpu_usage_ratio
memory_usage_bytes
disk_io_bytes
connection_pool_usage

# 业务层 (视系统)
order_created_total
checkout_duration_seconds
```

### 2.3 用 Histogram 看分位数

P99 不能直接存（要排序），用 **Histogram**（分桶计数）：

```python
from prometheus_client import Histogram

request_duration = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration",
    buckets=[0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],  # 桶边界
)

@request_duration.time()
def handler():
    ...
```

PromQL 查 P99：

```promql
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```

### 2.4 打点要点

- **cardinality 控制**：标签维度不能太散（path 带 user_id 会爆炸）。URL 要先归一化成 `GET /orders/:id`。
- **rate 而非 counter 裸值**：counter 要 `rate()` 看变化率。
- **histogram 比 summary 好**：可聚合、可跨维度求分位。

---

## 三、Logs：结构化日志

### 3.1 结构化（JSON）而非散文本

```json
{"ts":"2026-01-01T12:00:00Z","level":"error","msg":"db timeout",
 "service":"orders","trace_id":"abc123","user_id":42,"db_latency_ms":5200}
```

**为什么 JSON**：可被工具（Loki/ES）索引、可按字段查询、可加 context。

### 3.2 日志级别与采样

```
DEBUG < INFO < WARN < ERROR < FATAL
```

- **生产默认 INFO**，DEBUG 开在调试时。
- 高流量路径（每请求多行）要**采样**（记 1%），否则日志系统崩。
- **错误日志要带上下文**（trace_id + 关联 id），不然无法关联。

### 3.3 别打敏感信息

日志会长期保存，**不打 token/密码/手机号/身份证**（见应用安全章节）。用掩码。

---

## 四、Traces：链路追踪

### 4.1 什么是 span / trace

```
trace_id: 4bf92f3577b34da6a3ce929d0e0e4736
┌─ root span (HTTP GET /checkout)
│   ├─ span: 认证服务  (200ms)
│   ├─ span: 订单服务  (1500ms)
│   │    └─ span: 数据库查询 (1200ms)  ← 热点在这
│   └─ span: 库存服务  (300ms)
```

- **trace** = 一次完整请求。
- **span** = 一次服务调用（有 parent-child 关系）。
- 每个服务在入口创建/接收 trace，传播 `trace_id` + `span_id`。

### 4.2 传播（Propagation）

跨服务要传 trace 上下文（HTTP header）：

```
X-Trace-Id: 4bf92f3577b34da6a3ce929d0e0e4736
X-Span-Id: 1f2e...
```

网关/入口生成 trace_id，每个服务把自己作为子 span 挂上去。

### 4.3 OpenTelemetry（业界标准）

OTel = 统一的遥测采集 + 传播标准（SDK + API + 协议），兼容 Prometheus/Jaeger/云平台。

```go
// Go OTel 初始化
import (
    "go.opentelemetry.io/otel"
    "go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
    "go.opentelemetry.io/otel/sdk/trace"
)

func initTracer() {
    exporter, _ := otlptracehttp.New(context.Background(),
        otlptracehttp.WithEndpoint("otel-collector:4318"))
    tp := trace.NewTracerProvider(trace.WithBatcher(exporter))
    otel.SetTracerProvider(tp)
}
```

```python
# Python: 自动埋点 HTTP + DB + 框架
from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor

provider = TracerProvider()
trace.set_tracer_provider(provider)
FlaskInstrumentor().instrument()
RequestsInstrumentor().instrument()
```

### 4.4 采样策略

- **头部采样（head-based）**：进网关时按概率决定整条链路采不采（1-10%）。
- **尾部采样（tail-based）**：先全采、后端按需（错误链路全采）——贵但准。
- 高流量系统：默认 1% + 错误 100% 采样。

---

## 五、SLO / SLI / 告警

### 5.1 SLI / SLO / Error Budget

```
SLI (Service Level Indicator): 怎么量 — 可用性% / 延迟P99 / 错误率
SLO (Service Level Objective):  目标值 — P99 < 500ms / 可用性 99.9%
Error Budget (错误预算):       100% - SLO — 一年可犯错的量（3 个九=8.7小时/年）
```

### 5.2 设计 SLI/SLO

```
SLI 示例: 请求成功率 = 成功请求 / 总请求 (可用性 SLI)
         latency SLI = 满足延迟阈值(如 500ms)的请求比例
SLO 示例: 99.9% 的请求 < 500ms (按月评估)
```

### 5.3 告警：别告警疲劳

**坏告警**：告警比处理速度快、告警没有 actionable 信息、全部 p0。

**好告警原则**：
- **只告警可行动的事**：告警了你要能做事，否则就删掉。
- **用错误预算驱动**：Error Budget 没耗尽 → 不告警（SLO 内波动是正常的）。
- **burn rate 告警**：按"预算消耗速度"告警——30 分钟内烧完 2% 预算 → p1；烧 14.4% → 严重。

```
SLO 99.9% (月预算 43min):
  burn rate 1  = 每月 30 天正好烧完
  burn rate 14.4 = 2 小时内烧 14.4% → p1 立即响应
```

- 告警必须带**runbook**（怎么排查/怎么处理）。

---

## 六、完整落地架构

```
应用 (服务 A/B/C)
  │  OTel SDK (自动埋点 HTTP/DB/gRPC)
  ▼
OTel Collector (统一采集: metrics/logs/traces, 采样, 脱敏)
  ├─▶ Prometheus (metrics 存储 + 查询)
  │       └─▶ AlertManager (告警 → 通知)
  ├─▶ Loki (logs 存储, 关联 trace_id)
  └─▶ Tempo/Jaeger (traces 存储)
         │
         └─▶ Grafana (统一 Dashboard + 关联查询)
```

**关键组件职责**：
- **OTel Collector**：统一入口，做采样、标签、脱敏、路由。
- **Prometheus**：pull 模型抓 metrics，PromQL 查询。
- **Loki**：标签索引日志，低开销。
- **Tempo/Jaeger**：trace 存储与搜索。
- **Grafana**：三件套统一可视化 + 告警。

---

## 七、生产排查实战流程

```
1. 收到告警 (metrics 异常: 错误率↑ / P99↑)
2. 打开 Grafana: 看 RED 指标确认范围 (哪些 path/service)
3. 看 Traces: 找到异常 trace, 定位到哪个服务哪次调用慢
4. 下钻到该服务: 看 span 里 DB/网络/外部调用耗时
5. 看 Logs: 按 trace_id 过滤, 找根因 (错误堆栈/超时/连接池)
6. 修复 → 部署 → 观察指标回落 → 关闭告警
```

这套流程把"系统乱成一锅粥时的救火"变成"有据可依的排查"——这就是可观测性的价值。

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **三件套**：Metrics（数字）/ Logs（事件）/ Traces（链路），要能互相关联（trace_id）。
> - **RED**（服务）：Rate / Errors / Duration。
> - **USE**（资源）：Utilization / Saturation / Errors。
> - **Histogram 查分位**：分桶 + `histogram_quantile`；控制 cardinality。
> - **日志**：结构化 JSON + 级别 + 采样 + 带 trace_id + 不打敏感。
> - **Trace**：span/trace 层级，OTel 自动埋点，HTTP header 传播 trace_id。
> - **采样**：头部 1% + 错误 100%；高流量别全采。
> - **SLO/Error Budget**：99.9% → 月 43min 预算；burn rate 告警。
> - **告警原则**：只告警可行动的；预算内不响；告警带 runbook。
> - **架构**：OTel Collector → Prometheus/Loki/Tempo → Grafana。

---

回主目录: [工程化实践轴 README](index.html).
下一篇系统正文: [导论卷回到主目录](../prologue/index.html) 或任选下面章节。
