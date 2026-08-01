# SLO / SLI / Error Budget

## TL;DR

Google SRE (Site Reliability Engineering) 团队在 2016 年提出的**服务可靠性工程**核心 framework:

1. **SLI (Service Level Indicator)**: 服务可用性的 **量化 metric** — "对用户来说什么是好的" (e.g., availability = 200 OK success rate, latency P99 < 100ms)。
2. **SLO (Service Level Objective)**: 对 SLI 设置的 **目标值** — "我们希望 99.9% 的请求在 100ms 内成功"。
3. **Error Budget**: 允许的"失败空间" = `1 − SLO`. 如果 error budget 花光, 必须 freeze 新 feature release 稳定平台。

这三者是非主观的、**数据驱动的 reliability roadmap** — 不再是"系统要快而稳", 而是"系统 P95 < 100ms in 99.9% windows" measurable 的 roadmap。本章深入 SLI 设计、SLO 设定 (30 天 / 7 天 rolling windows) , Error Budget 管理与 burn rate, 经典事故 (Netflix startup error budget runout) 。

---

## 一、SLI (Service Level Indicator)

### 必须量化

| SLI 类型 | 度量 | 说明 |
|----------|------|------|
| **Availability** | `success_count / total_requests` | 200/2xx HTTP, gRPC OK, 业务定义成功 |
| **Latency** | `histogram_quantile(0.99, request_latency_seconds)` | P99 延迟 |
| **Throughput** | `rate(requests_total[1m])` | 容量用度 |
| **Durability** | `writes_committed / writes_accepted` | 储存器持久性 |

### 选 SLI 的两个维度

- **用户面 (User-Facing)**: 直接影响 UX —— API 返回、页面渲染、搜索页面 latency
- **关键面 (Critical)**: 服务 health — CPU allocation, QPS,  disk IO > 90%

**规则**: Alert 只设定于用户面 SLI, 不 alert 于基础设施面 SLI (除非是 capacity接近 cap)。

### Critical Path Breakdown

```
User: POST /api/order
SLI 1: API availability = (200||201 responses)/(total requests)
SLI 2: P99 latency < 500ms (checkout response time)
SLI 3: checkout error rate < 0.1% (order failure/non-retryable)
```

### SLI Granularity

Don't 整体统 一 每 endpoint? 区分:

- `pages/`: 首页 P99<200ms, 商品列表 P99<300ms, 搜索 P99<1000ms?
- `critical/`: checkout API P99<500ms, availability 99.9% 以上

若 critical SLI 的 错误预算烧得很快, 整个生产速度必须下降 直至 稳定。

---

## 二、SLO (Service Level Objective)

### 目标值

SLO = SLI 达到目标 **probability over time window**:

$$
P_{SLI} \geq P_{target}, \quad \text{over 30 days}
$$

例: "checkout API availability SLI = 99.9% over 30 days".

### 定义 Window (滚动)

- **30 days**: 稳定测量, 忽略短暂 spikes
- **7 days**: 快速反馈 (适配 fast iterations)
- **1 day**: 基本上 用于 reactive hotfix

实际常用 rolling 30 day for quarterly reliability review; 7 day for burn rate monitoring.

### 典型 SLO 数

| 服务 | 可用性 SLO | 年度误差预算 |
|------|-----------|-------------|
| 关键金融交易 | 99.99% ("four nines") | ~52 分钟/y |
| 电商 checkout | 99.9% | ~8.8 小时/year |
| 社交 feed | 99.5% | ~1.6 天/y |
| 新闻 feed | 99% | ~3.65 天/y |
| 内部 工具 / admin | 99% | ~3.65 天/year |
| Dev/测试 | no SLO | 不要 SLO; just 容忍 down time |

**定 SLO 高于 99.9% (~44min/m) 每一额外 nine costs $100K+ per 服务业 is realistic budget no matter.**

规则: **不高于 99.99% 除非你 真正 花 钱 operation 花到 T5 teams. **

### "99.9%" 误解

99.9% = 0.1% 不可用 over window = 43.2 min / month.

实际运作 服务 可 99.5-99.9 range; most internal services never above 99.9% because chronic change speed compromises stability.

---

## 三、Error Budget

### 定义

$$\text{Budget} = (1 - SLO\_{target}) \times \text{total\_time\_window}$$

例: SLO=99.9%, window=30 days, Budget = 0.1% × 30 × 24 × 60 = 43.2 min 可 down window.

每 30 天 roll. 但 SLI burn rate shows speed consuming budget.

### 什么时候 Burn?

- 每 failed 请求 count. e.g., non-200 status.
- 每 timeout 响应 time.
- SLI metric 计算 burn rate.

### Burn Rate 阈值

Google SRE 建议 6 倍 burn rate triggering **immediate incident alert**:

| Severity | Burn rate | 时间 to exhaust budget |
|----------|-----------|------------------------|
| Critical (immediate page) | 14.4× (budget consumed ~6h) | ~6 hours |
| High alert (almost exhausting) | 6×  | ~24 hours |
| Medium (warning) | 1× | ~7 days |
| Low (tracking) | < 0.2x | long, not urgent |

### Freeze Policy

若 当前 month的 error budget 接近 exhausted, must 对 "新feature release" 施加 freeze: 只接受 bug fix + reliability project, 直到 budget 恢复 (next window smooth). 这利地 forcing teams spend time on reliability over features.

"If you always burning error budget, you are in feature-debt vs reliability debt."

### Error Budget Recovery

恢复:
- idle window 自动 recover; 30 天 rolling 后 新 start.
- Service after problem fixed 可用增加 allowance: SLI observation critical.
- Manual reset 不推荐; data driven only.

---

## 四、如何先设定 SLO？

### Step 1: Setup Base SLIs

选 2-4  SLIs for critical user journeys:
- checkout page api 可用性
- home page  P99 latency
- search query time P99

### Step 2: Collect baseline SLI

Record SLI for 2 weeks; compute current P99, current success rate → baseline.

### Step 3: Set SLO

SLO_initial = measured_baseline + headroom (15-30% improvement).

Avoid giving overly ambitious SLO that simply doesn't reflect actual capability; reduce in first week error budget catastrophically burn → teams switch to reliability **now**.

### Step 4: Monitor Burn Rate

Set 2 alert levels:
- burn rate 1x: warning, 让 on-call check
- burn rate 6x: page critical, must intervene

### Step 5: Hold SLO Reviews

Monthly SLO review: 检查: 满足 SLO (under budget), 讨论 "which new features 该 deploy?"

"When the error budget is gone, you are on a feature freeze."

---

## 五、Network / Infrastructure SLO 多层次

### Example: Netflix CDN SLO

- Netflix 视频 分发 by CDN (Open Connect appliance CDN), with target 99.99% delivery success for each ISP.
- Each POP also self-enforce SLO of 100% CDN bandwidth usage under load.
- Goal: 99.9% user sessions not affect by network pause.

### Google Cloud GCP Networking SLO

- Cloud Load Balancing ensures 99.99% 连通性 multi-region anycast IP.
- Compute Engine per instance uptime guarantee = 99.95%.

### AWS S3 Durability SLO

Durability objective 11 9 (don't lose data) even using EC; SLI is loss-probability per year 1E-11.

---

## 六、Error Budget 与 developer velocity

"Move fast & break things" vs "高 reliability commit":

- With error budget 未用: develop 大 feature, risk 允许 小 spike failure.
- With error budget 烧完: **feature freeze** develop 全面停止, 只做 reliability hardening. 一旦 新 feature deploy → 再 fail the SLO。

工具: feature flag + canary deployment + gradual rollout. 一旦 canary 触发 error spike, 停止 rollout.

### Example: Spotify — SLO & feature velocity

Spotify 模型 "SLO for each Squad". 每 team autonomy control service + SLO. If service within SLO, team 选择 部署 scale deploy; 若 跌破 SLO.冻结 features, hotfix + re 升.

### Google SRE process

每 季  monitoring data SLO — 提前 end of quarter 20% error budget 未 用 clean bill go deploy feat for next quarter.

---

## 七、Prometheus SLO / Burn rate 示例

```
# SLI: availability of orders API
sum(rate(http_requests_total{status=~"2..", path="/orders"}[30d]))
/
sum(rate(http_requests_total{path="/orders"}[30d]))

# Burn rate over 1h (~14.4x burn alert):
(
  sum(rate(http_requests_total{status!~"2..",path="/orders"}[1h]))
  /
  sum(rate(http_requests_total{path="/orders"}[1h]))
)
> 14.4 * (1 - 0.999)

# PromQL label 并告警:
- alert: HighErrorBudgetBurn
  expr: |
    sum(rate(http_requests_total{status!~"2.."}[1h]))
    / sum(rate(http_requests_total[1h]))
    > 14.4 * 0.001
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "Error budget burning fast on order service"
```

---

## 八、典型事故

### Netflix Error Budget Overturned

Netflix 在某 release 中, 部分 Netflix 公开影视的 SRT 渲染中断, 用户 interface 无响应。 Error budget 3 小时 burn rate 5x; 触发 页面 alarm pipeline 暂 停 red 支. 后续 server-level hotfix.

### Spotify mobile app SLO 过低设定

设定 "99% availability", 实际 meaning 24 hours/month allowed downtime. 体验差 but teams had budget unused because always within threshold. Upgrade SLO to 99.5% → burn faster => teams take reliability seriously.

### GCP Incorrect SLO Duration setting

某 Google Cloud service SLO 30 days; last 30 days averaged OK, but two days of severe downtime earlier month hidden over average. Fix: burn rate alert (短 window) 辅 30 day SLO 计算.

### Unused Downward Error Budget Shift

某 enterprise SaaS provider 通知 用 Slack meeting: "We have 3 days downtime within most LEA years". Moving error budget into that new month causes team always "behind". Fix: SLO start each batch rolling window not annual.

---

## 九、易错清单

1. **SLO 不要定太高**: start at current measurement + 5-10% buffer.
2. **SLO 必对用户有意义**: NOT infrastructure metric (CPU, memory, disk IO) — only user-experienced.
3. **Burn rate computed over multiple windows**: 1h for 14x burn alert, 6h for 3x burn w/ regression.
4. **不要在 downtime 后 reset error budget**: rolling window 自动 recover; avoid manual清除.
5. **要有 "错误预算用于 feature support"**: 分配一部分 to risk tolerance features deploy.
6. **Error budget must be visible to dev**: monitor and dashboard within dev's view (every PR into production links burn chart).
7. **Monthly SLI/SLO review meeting**: guaranteed reliability culture persists.

---

## 十、这一章带走的东西

1. SLI (量化 metric) + SLO (目标), Error Budget 是 允 许失败.
2. Error Budget 烧完 ⇒ 强制性 "stop feature, fix reliability".
3. Burn rate > 6× →  critical page; > 14.4× → within hours budget exhaustion.
4. Rolling window 30 days for SLO review; 1h/6h burn rate alert.
5. SLO should be user-facing; never infrastructure SLO only.
6. PromQL 例: burn rate alert with 14.4×(1-SLO) trigger.
7. Spotify/Netflix/Google SRE 实战 case all center around SLO+Error Budget: "Move fast unless you burn budget".

---

下一节 → [监控 Stack](stack.md)
