# 2. 测试工程: 测试金字塔 / 单元/集成/契约/E2E / mock / flaky 治理

## TL;DR

测试不是"写几个 assert"，而是**一套控制回归风险的系统**。这一章把测试从"会写"提升到"会设计"：知道测什么、在哪一层测、用什么替身、怎么让测试不 flaky、怎么用覆盖率做决策（而不是当指标）。

读完应能：
1. 说清测试金字塔为什么是对的，以及它不适用时的例外。
2. 区分单元 / 集成 / 契约 / E2E 四种测试的职责与成本。
3. 正确使用 mock/stub/fake/spy，知道"过度 mock"的病。
4. 诊断并治理 flaky 测试。
5. 用测试覆盖率的**正确用法**辅助重构决策。

---

## 一、测试金字塔

### 1.1 分层与成本

```
        / E2E \           数量少（几十）
       /  契约  \         数量中（几百）
      /   集成    \       数量多（几千）
     /    单元      \     数量最多（几万）
    /________________\
```

| 层级 | 速度 | 成本 | 稳定性 | 隔离度 | 测什么 |
|------|------|------|--------|--------|--------|
| 单元 | 毫秒-秒 | 低 | 高 | 高 | 一个函数/类 |
| 集成 | 秒-分 | 中 | 中 | 中 | 模块间、DB/网络 |
| 契约 | 秒 | 中 | 高 | 高 | 服务间接口 |
| E2E | 分-时 | 高 | 低 | 低 | 整条用户路径 |

**原则**：越往上数量越少。金字塔的几何形状就是最优成本结构——把多数测试放在快而稳定的底部。

### 1.2 反模式

- **倒金字塔**：全 E2E，慢、flaky、难定位 → 是测试最贵且最没用的形态。
- **冰淇淋筒**：上面 E2E 多、中间少、底部 mock 一堆 → 单元测试全是 mock，集成空缺。
- **无测试**：靠手动 QA → 回归全靠人肉，无法持续发布。

### 1.3 覆盖策略（Test Pyramid 的落地）

每个功能改动的理想测试分布（Google 实践）：

```
单元: 70-80%   — 覆盖所有分支/错误路径（快、密集）
集成: 15-20%   — 覆盖模块组合、真实 DB/依赖
E2E : 2-5%     — 关键 happy path 冒烟
契约: 按服务边界补 — 微服务间接口防破坏
```

---

## 二、四种测试的职责

### 2.1 单元测试（Unit）

- 测**一个函数/类的单一行为**，不跨模块、不碰 IO。
- 目标：逻辑正确、边界处理、错误路径、性能敏感函数。
- 关键：**测行为不测实现**（改实现不该破坏测试）。

```go
// Go 单元测试示例
func TestCalculateTotal(t *testing.T) {
    items := []Item{{Price: 10, Qty: 2}, {Price: 5, Qty: 1}}
    got := CalculateTotal(items)
    if got != 25 {
        t.Errorf("got %v want 25", got)
    }
}
```

```python
# Python 单元测试
def test_calculate_total():
    assert calculate_total([("a", 10, 2), ("b", 5, 1)]) == 25

def test_empty_cart():
    assert calculate_total([]) == 0
```

### 2.2 集成测试（Integration）

- 测**模块之间的真实协作**，包括真实 DB、真实网络、真实文件系统。
- 捕获的问题：API 签名不匹配、类型/编码转换、事务边界、并发竞态。
- 手段：真实依赖（Testcontainers 起真实 DB/redis）+ 少用 mock。

```python
# 用 Testcontainers 起真实 Postgres
def test_user_persistence():
    with Testcontainers("postgres:16").running() as pg:
        repo = UserRepo(pg.get_connection_url())
        repo.create(User("alice"))
        assert repo.find("alice").name == "alice"
```

### 2.3 契约测试（Contract）

- 微服务间：**消费方**（consumer）与**提供方**（provider）各持一份契约，独立验证。
- Pact 思路：consumer 生成契约（它期望的请求/响应），provider 验证自己满足契约。
- 价值：**两端独立部署也不会悄悄破坏接口**——比 E2E 快得多，且精准定位是哪端破坏。

```
消费者 (consumer)                     提供者 (provider)
   └─ 期望: GET /user/1 → {id:1}       └─ 验证: 我确实返回 {id:1}
        生成契约文件 pact.json ──────→  provider 测试跑契约
```

### 2.4 E2E 测试

- 模拟真实用户完整路径：登录 → 操作 → 结果，跑在**完整部署**上（浏览器/真实 API）。
- 工具：Playwright / Cypress / Selenium。
- 定位：**冒烟**（关键路径别挂）+ 少量核心流程，不是全覆盖。

```typescript
// Playwright E2E
import { test, expect } from '@playwright/test';

test('用户能下单', async ({ page }) => {
  await page.goto('/');
  await page.getByText('添加购物车').click();
  await page.getByRole('button', { name: '结算' }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await expect(page.getByText('订单成功')).toBeVisible();
});
```

---

## 三、测试替身（Test Double）：mock / stub / fake / spy

### 3.1 四种替身

| 替身 | 作用 | 何时用 |
|------|------|--------|
| **Stub** | 返回预设数据，不含逻辑 | 提供依赖返回值 |
| **Mock** | 验证"方法被调用且参数正确" | 验证交互行为 |
| **Fake** | 简化实现（内存版 DB） | 替代重依赖 |
| **Spy** | 记录调用供断言 | 检查是否被调用 |

### 3.2 过度 mock 的问题

```python
# ❌ 过度 mock：测试的是 mock 自己，不是代码
def test_order(mocker):
    db = mocker.patch("app.db.query")      # mock 了 DB
    cache = mocker.patch("app.cache.get")  # mock 了缓存
    notify = mocker.patch("app.notify")    # mock 了通知
    # ... 三个全 mock 后，测的其实是胶水，业务逻辑没测到

# ✅ 更真实：保留逻辑层，mock 只在 IO 边界
def test_order_flow(test_db):
    repo = UserRepo(test_db)              # 真实 DB（fakeredis / testcontainers）
    result = place_order(repo, cart)
    assert result.status == "paid"
```

**判断标准**：如果 mock 掉的东西越多、断言越细，测试就越脆。**只在"边界 IO"（外部服务、时间、随机）处 mock**，业务逻辑用真实实现。

### 3.3 依赖注入让测试容易

```python
# 设计上支持替换依赖
def send_notification(sender: Notifier, msg: str):   # 传入接口
    sender.push(msg)

# 测试时传 Fake
class FakeNotifier(Notifier):
    def __init__(self): self.sent = []
    def push(self, msg): self.sent.append(msg)

def test_send():
    fake = FakeNotifier()
    send_notification(fake, "hi")
    assert fake.sent == ["hi"]
```

> [!TIP]
> "**依赖注入 + 接口**"比"全局 mock 补丁"更干净。可测性是最被低估的架构属性——代码可测，通常意味着解耦良好。

---

## 四、Flaky 测试治理

### 4.1 什么是 flaky

同一份代码，跑两次结果不同——一次过一次挂。Flaky 是持续交付的最大敌人：**它让 CI 信号不可信，开发开始忽略红**。

### 4.2 常见根因

| 根因 | 例子 | 解法 |
|------|------|------|
| **时序/竞态** | 断言在异步回调前执行 | 轮询等待而非 sleep；用 `eventually` |
| **随机性** | 测试依赖随机数/时间 | 注入确定性种子 / fake clock |
| **共享状态** | 测试间共享 DB/静态变量 | 每测试独立隔离（truncate/txn rollback） |
| **环境依赖** | 依赖网络/外部服务 | 契约测试替代；本地 stub |
| **顺序依赖** | 测试依赖前一个测试留下的状态 | 每测试自含 setup/teardown |

### 4.3 反例：`sleep` 是罪魁

```python
# ❌ sleep 猜测时序
response = api.start_async_job()
time.sleep(5)                     # 5 秒后应该完成了
assert response.done

# ✅ 显式等待直到条件满足
def wait_until(predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate(): return True
        time.sleep(0.1)
    raise TimeoutError()

assert wait_until(lambda: api.job_status(job_id).done)
```

### 4.4 治理流程

```
1. 复现：用 --count=100 反复跑（pytest: --count, go test: -count=100）
2. 隔离：找到 flaky 的最小复现
3. 定位：加日志 / 用 go test -race / pytest-timeout
4. 修复：消除根因（上面表）
5. 防再发：把修复用例留成回归；加 CI 的 retry 是最后手段，不是解法
```

---

## 五、覆盖率：正确使用

### 5.1 覆盖率不是目标

- 覆盖率**高 ≠ 测试好**：可以 100% 覆盖而全是无效断言。
- 但覆盖率**低几乎总是坏**（除非是新代码区）。
- 正确用法：**辅助发现"没测的路径"**，而不是 KPI。

### 5.2 有用的度量

| 度量 | 含义 | 用途 |
|------|------|------|
| Line coverage | 行覆盖 | 基本体检 |
| Branch coverage | 分支覆盖（if/else/switch） | 比行覆盖更准 |
| Mutation testing | 改代码看测试会不会红 | 验证测试质量 |
| Diff coverage | 只统计这次改动覆盖 | **重构/新功能最该看** |

> [!NOTE]
> **Diff coverage（新增/改动代码的覆盖率）比总量覆盖更有意义**。它回答"我这次改动有没有测到"。很多团队用工具（如 coveralls/sonar）把 diff coverage 卡在阈值（如 80%），效果远比总量阈值好。

### 5.3 覆盖率的正确决策流

```
写代码 → 写测试 → 看 diff coverage
  ↓ 低分支覆盖
  → 补分支：错误路径 / 边界 / 空值
  ↓ 高覆盖但测试很脆
  → 检查：是否在测实现细节？是否需要重构测试？
```

---

## 六、测试策略落地（团队层面）

### 6.1 CI 里的测试分层执行

```
PR 阶段（快，必跑）:
  - 单元测试（毫秒级，全部跑）
  - Lint + 类型检查
  - 变更文件的 diff coverage 检查

合并后（慢，异步）:
  - 集成测试（Testcontainers）
  - 契约测试（Pact）
  - E2E 冒烟（部署到 staging）
```

### 6.2 测试金字塔的健康检查

- 单元测试跑 < 1 分钟 → 正常；> 5 分钟 → 该拆测试或并行。
- E2E 占总量 > 5% → 危险，该下移。
- 大量测试需要 mock 数据库 → 架构耦合问题。
- 测试常"修一下就好"（改断言不测逻辑）→ 测试在测实现，不是行为。

### 6.3 先写测试 vs 后写测试

- **TDD**（先写失败测试）：适合纯逻辑、算法、规则引擎。
- **后写测试**：适合探索性代码、UI、集成层。
- 关键不是"谁先"，而是**每段代码离开手前都要有测试覆盖**。

---

## 七、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **测试金字塔**：单元（多快稳）> 集成 > 契约 > E2E（少慢脆）。
> - **单元**：测行为不测实现；一个函数一类行为。
> - **集成**：真实 DB/依赖，Testcontainers 起真实服务。
> - **契约**：consumer/provider 各持契约，微服务防接口破坏。
> - **E2E**：关键路径冒烟，不是全覆盖。
> - **替身**：Stub（返回数据）/ Mock（验证交互）/ Fake（简化实现）/ Spy（记录调用）；只在 IO 边界 mock。
> - **可测性** = 依赖注入 + 接口，是最好的架构属性。
> - **Flaky 根因**：时序/随机/共享状态/环境/顺序依赖；用 wait_until 不用 sleep。
> - **覆盖率**：diff coverage 比总量有意义；测行为不测行数。
> - **CI 分层**：PR 跑快测，合并跑慢测。

---

下一篇: [3. CI/CD 与发布工程: 管线 / 镜像 / 蓝绿金丝雀 / IaC](cicd-devops.md).
