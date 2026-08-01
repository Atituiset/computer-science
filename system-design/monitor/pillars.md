# Three Pillars (Metrics / Logs / Traces)

## TL;DR

可观测性"三大支柱" 是工业界共识的三种信号类型:

1. **Metrics**: 二进制 numeric time-series data (CPU util, RPS, error rate, latency).prometheus exposition format, aggregation makes efficient (无 per-event record)。
2. **Logs**: 事件级 records (annotated text/JSON)用于 deep-diagnose. 所有微小事件可查 (debug log) → 节省开销 batch.
3. **Traces**: 跨 service call path + span timing — 让你看到 request 从 user 到 DB + many microservices 的传递链.

每类信号有 purpose:
- Metrics: 大尺度状态、告警
- Logs: 单事件诊断
- Traces: 端到端 latency breakdown

现代 stack: **OpenTelemetry** 统一收集的 formats. 数据 pipeline. 与 alerting via Prometheus/Grafana / Loki / Tempo / Jaeger 组合.

本章扫每类信号特点 + Trade-offs (cardinality cost), Performance implication (不惜 log per request for 高 throughput), 与防护舆 typical.

---

## 一、Metrics

### 形式

Metrics 是 "聚合数值时间序列数据" — 每 series 由一组label set 维 identify (e.g., `http_requests_total{method=POST, status=200}`) 。 Prometheus exposition format 典型:

```
# HELP http_requests_total Number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",status="200"} 124851
http_requests_total{method="POST",status="500"} 12
```

### 4 种 metric type

| 类型 | 用途 |
|------|------|
| **Counter** (单调增): 累计计算 e.g. `requests_total` |
| **Gauge** (可增减): 瞬时数 e.g. `current_connections` |
| **Histogram** (bucket): latency distribution (P50/P90/P99 大量计算 bucket with retention金: `_bucket`, `_sum`, `_count`) |
| **Summary** (客户端 quantile): 客户端 实时 P50/P99 但 unsuited aggregation across instances |

### Cardinality 风险

Metrics 的 label cardinality — number unique combinations like →  memory. Prometheus storage cost near-linear in cardinality over time;

- Label `user_id` (1M users): 1M 系 Featolder
- Label `URL` (含`:id`): 100K URL lines per second → 跨 kill storage
- Label `trace_id`

Rule of thumb: any label with cardinality > 1000 应 simplif or rollup INCLUDING to avoid explosion.

### Prometheus metric exposition

每 service ishould expose `/metrics` endpoint with Prometheus exposition format. Prometheus **scrape** (default 15s). 存储 点向 metrics backends: M3DB, VictoriaMetrics, Cortex, Thanos for scale.

---

## 二、Logs

### Levels

```
TRACE | DEBUG | INFO | WARN | ERROR | FATAL
```

Production 通常 INFO+; DEBUG log 仅在故障时启用 (cross debug 调查). Tools: loom long-term retention + 结构化 logging for searchability.

### Structured vs Unstructured

**Unstructured**: `printf("Error at file ... ")` — 可 grep 但 not machine-parseable.

**Structured** (JSON for tools): `{"level":"error","ts":"...","msg":"checkout","user_id":42, "cart_id":"abc"}` — ELK 加 indexing on fields.

### 高 throughput logging cost

- 企业应单机 1 GB/day log limit easily 2500 USD/month. 推荐sampling.
- "all access logs kept 7 years合法 不首通用 optimizations keep origin proj纳入 access log snapshot + sample tail info 「 金 network cost 持 abog".

### 典型 stack

```
Application
  ↓ structured log (JSON / logfmt)
Filebeat / Vector / Fluent Bit
  ↓ agent obtains
Kafka log streams
  ↓ async producer backend
Loki / Elasticsearch / OpenSearch / ClickHouse / S3
  ↓ query
Kibana / Grafana
```

### 性能开销

- 单 INFO log 每 5KB → agent 服务 / 后端 indexing 加序列化 json extra 50-100us.
- 高吞吐 log load 会 server process thread pool + disk IO. consider async logger (e.g. log4j 2.x async logger 或 source klog V8 flush).

---

## 三、Traces

### OpenTracing / OpenTelemetry

OpenTracing 与 OpenCensus 2019 合并 → OpenTelemetry (OTel)。 提供 language-agnostic API for traces context propagation。 HTTP/gRPC header injection让 trace_id 跨medration services传递.

### Span / Trace

- **Trace**: 完整 end-to-end path lifecycle 的 unique trace_id.
- **Span**: 一个服务 node的 single sub-process timing + tags.
- 父 span → child span; siblings → concurrent calls.

```
Trace: trace_id=abc, total 800ms
  Span1: HTTP /api/checkout, 800ms [parent]
    Span2: db.query SELECT order, 50ms [child]
    Span3: call shipping service, 200ms [child]
       Span4: shipping DB query, 150ms [child]
    Span5: redis cache get user, 5ms [child]
    Span6: payment service call, 500ms [child]
```

### Distributed context propagation

- HTTP `traceparent` header W3C standard format: `00-{trace_id}-{span_id}-{flags}`.
- OTel auto-instrumentation: agents attach to popular libraries (e.g. JDBC, gRPC, Spring) 自动 emit spans.

### Distributed Trace Storage

- Backend: Jaeger / Tempo / OpenSearch / Datadog / Honeycomb / New Relic.
- Sampling 控制 retention cost (e.g., 100% sampling at low流量, 1% at high RPS).

### Sampling

- Head sampling: collector 概率性 drop traces before processing. e.g. 1% records.
- Tail sampling: collector 全采集; lifestream 完成后决定保留 (e.g., keep >= P99 latency or error status). resource-limited.

---

## 四、三者关系

```mermaid
flowchart LR
    A[Application<br/>signals] --> M[Metrics: aggregate]
    A --> L[Logs: per-event records]
    A --> T[Traces: span breakdown]
    M --> P[Prometheus]<br/>/ alerting
    L --> E[Loki / Elasticsearch]
    T --> J[Jaeger / Tempo]
    P --> G[Grafana dashboards]
    E --> G
    J --> G
```

- alerting migrations look for 用 Metrics.
-incident 调试从 Logs + Traces = # behavior回到 stack-grained origin.
-Traces 给 spans 转 Metrics events, logs 引记录 trace_id扰动 curation 快 lookup.

### Exemplars (Prometheus 2.26+)

**Exemplar** = "Metric point + trace_id 引用 ". 让 Grafana 中点 P99 latency 节点 → click → 引言含 trace_id → jump to Jaeger/Tempo看具体 trace. 桥接 metrics与 traces.

---

## 五、典型 Architectural Patterns

### Pattern 1: Service Stack with OpenTelemetry

```
App code (OpenTelemetry SDK)
  ↓ OTLP / Prometheus
[OpenTelemetry Collector] (dep role-forwarding/log累积/data aggregation/sampling)
  ↓ forked
Prometheus (metrics) | Loki (logs) | Tempo (traces)
  ↓
Grafana (unified view)
```

### Pattern 2: Cloud Native Observability (Datadog / Honeycomb / New Relic)

提供 hosted solution, 多 SDKs (e.g. dd-agent on each pod), agent forwards. Trade-off: high volume cost-per-GB. Vendor lock 注意.

### Pattern 3: ELK Stack Logs + Prometheus Metrics + Jaeger Traces

Self-hosted stack 经典 选择. ELK (现在 "OpenSearch"—fork of ElasticSearch 2021) Logs + Prom Metrics + Jaeger Traces.

---

## 六、典型 Use Cases

###triggerance 1: Diagnose High Latency Report

1. Alert: "checkout API P99 latency 5s" 触发 from metrics
2. Grafana dashboard 看 P99 derivation of recent checkout success rate
3. Exemplar link to specific trace / 导致 Trace ID range.
4. Jaeger 看 trace: "shipping service 500ms" + "db query  300ms".
5. Span detail: sql query atement + SQL timings + Service specific span ID.
6. logs by trace_id = （SQL plan + Postgres query log）
7. resolve query.

### Triggerance 2: Error Spike Diagnostic

-alerts 监测 error rate metric 是 spike.
-Watch战 back dashboard, failed request spans 找;
- Look at logs filtered by `status=500`;
-Restart跑 server app 看行 exception.

---

## 七、典型事故

### Elasticsearch Cluster OOM 大量 Object High Cardinality

某公司 ES logstorage 组 tagged with `user_id` as a field. multi-CO者 ES hop heap 充 ~100GB/天 overwhelmed cluster. Fix: user_id 在 long-term retention 跳 low index + aggregated per user_id 游 实际 lookup.

### Datadog Cold-Card Trick

某 team通过 trace "every" 学校 DNS error: named 只 100 RPS, but  e.g Develop 拒tring  count all latency loader data incurred over-time $买 100MB month + DEMos rule 权. Fix:

### Loki cards Decrease storage cost

某公司 Loki query (~10×less cost than ES) for logs,  substitution  / success.

---

## 八、易错清单

1. **Don't use `user_id`, `session_id`, `trace_id` as metric label** — cardinality爆炸 storage cost。
2. **Trace sampling must include all errors**: tail sampling keeps 100% errors + 1% success, 重要性数据采集.
3. **OpenTelemetry MUST support all service tiers** (HTTP/gRPC/db/cache)
4. **Set alerting on user-facing metrics, not behind infrastructure-only**
5. **High-cardinality log fields**: avoid to give ś user_id as part of indexed log key.
6. **Trace 爆炸 over service mesh 重在 hist 纕 keep sample-server-side samples by path.**

---

## 九、这一章带走的东西

1. 三大支柱 Metrics + Logs + Traces 是观测分布式系统的 entry point.
2. Metrics aggregate- numeric格式上 cost-aware labelsetdecount的 cardinality problematic.
3. Logs structured JSON 让 query/filter 不过 cost-per-event 的处理; sampling retains large. febyterianik.
4. Traces span breakdown 让 latency decoupled visible; OpenTelemetry sets of standards.
5. Exemplars 锵 metrics 与 traces bridges Grafana links point.
6.用 Prometheus + Graphana; Loki or ES for logs; 真Jaeger/Tempo 您 traces distribution. Currently "slotel collector" emerging best 埋持 alternative.

---

下一节 → [SLO/SLI/Error Budget](slo.md)
