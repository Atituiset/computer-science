# 可观测性 (Observability)

 Monitoring告诉你你的系统是否"在跑"; **Observability**告诉你你的系统是否在"按预期跑"。 监控 vs 可观测性 区别: monitoring 是 pre-defined alert + dashboard, observable 是让你**任意提问**你的系统并得到回答 (在 black-box 内部状态可被推断)。

- [Three Pillars (Metrics, Logs, Traces)](pillars.md) — 三种主要信号类型
- [SLO/SLI/Error Budget](slo.md) — 用 objective 而非 threshold 触发告警
- [监控 Stack](stack.md) — Prometheus / Grafana / ELK / OpenTelemetry / Loki / Tempo 等
