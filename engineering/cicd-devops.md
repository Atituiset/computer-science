# 3. CI/CD 与发布工程: 管线 / 镜像 / 蓝绿金丝雀 / IaC

## TL;DR

CI/CD 是把代码从提交到生产的一条**自动化流水线**。CI（持续集成）保证每次提交都能构建+测试通过；CD（持续交付/部署）把通过的产品可靠地发布出去。这一章讲的不是某个平台（GitHub Actions/GitLab CI/Jenkins）的教程，而是**发布工程的通用模型**——管线怎么设计、产物怎么管理、发布怎么无痛、基础设施怎么管理。

读完应能：
1. 画出 CI/CD 管线的完整阶段（提交 → 构建 → 测试 → 产物 → 部署 → 验证 → 回滚）。
2. 理解镜像/不可变产物与"代码即配置"的区别。
3. 讲清蓝绿、金丝雀、滚动、重建四种部署策略的取舍。
4. 知道 IaC（Infrastructure as Code）怎么做、为什么必须。
5. 设计一个"小步快速失败"的发布流程。

---

## 一、CI/CD 是什么

### 1.1 CI：持续集成

每次提交（或 PR 合并）自动执行：

```
提交 → 检出 → 构建 → 单元测试 → Lint → 集成测试 → 产物 → 报告
```

**目的**：尽快暴露"集成问题"。核心指标：**合并到主干的 commit 到 CI 变绿的时间**，应该以分钟计。

### 1.2 CD：持续交付/部署

- **持续交付**：通过 CI 的产物随时可以发布到生产（但发布是人为按钮）。
- **持续部署**：通过所有关卡后**自动发布**到生产。

区别就是"要不要人按发布键"。

### 1.3 为什么重要

- 发布频率越高、每次改动越小 → 故障定位越容易 → 回滚越简单。
- 反例：半年发一次大版本，一次带 500 个 commit，出事无法定位。

> [!NOTE]
> 核心心智：**"小步快速失败"**。让失败发生在 CI 的早期阶段（快测试），而不是生产（用户看到）。

---

## 二、管线设计：一个标准流水线

```
┌────────────────────────────────────────────────────────────┐
│ Stage 1: 检出 + 依赖                                       │
│   git checkout; install deps (go mod / npm ci / pip)       │
├────────────────────────────────────────────────────────────┤
│ Stage 2: 静态检查                                          │
│   lint / 类型检查 / 格式 / 依赖漏洞扫描 (govulncheck/npm audit)│
├────────────────────────────────────────────────────────────┤
│ Stage 3: 测试（快）                                        │
│   单元测试 + 覆盖率（diff coverage 门槛）                    │
├────────────────────────────────────────────────────────────┤
│ Stage 4: 构建产物（不可变）                                 │
│   编译 → 生成镜像/二进制 → 打上唯一 tag (git sha) → push    │
├────────────────────────────────────────────────────────────┤
│ Stage 5: 测试（慢，可并行）                                 │
│   集成测试 / 契约测试 / E2E 冒烟                            │
├────────────────────────────────────────────────────────────┤
│ Stage 6: 部署到 staging                                    │
│   预览环境 → 人工/自动验收                                  │
├────────────────────────────────────────────────────────────┤
│ Stage 7: 发布到生产                                         │
│   蓝绿 / 金丝雀 / 滚动 → 健康检查 → 观察指标 → 完成          │
│   失败 → 自动回滚                                          │
└────────────────────────────────────────────────────────────┘
```

**关键设计原则**：
- **每一 stage 的输入是上一 stage 的产物**，不是重新构建（保证测试的就是要部署的）。
- **产物不可变 + 唯一可追溯**（tag = git sha + 时间），"代码可复现到任意发布版本"。
- **快失败前置**：慢的测试永远排在快的后面。

---

## 三、产物与镜像

### 3.1 不可变产物（Immutable Artifact）

> "你测试的东西，就是你要发布的东西。一旦构建，永不改变。"

- 每次构建生成唯一可追溯产物（`app-<gitsha>-<timestamp>`）。
- 构建一次，测试、部署、回滚都复用同一产物。
- 反例：生产上重新 `go build` / `npm install`（每次结果可能不同）→ 不可复现。

### 3.2 容器镜像

- 镜像 = 运行环境 + 代码 + 依赖的**快照**，跨环境一致（这是为什么 Docker 火）。
- 生产部署 = 拉镜像 → 跑容器，**不再有"本地能跑线上不能跑"**。

```dockerfile
# 多阶段构建：build 阶段产二进制，run 阶段只带二进制（小镜像）
FROM golang:1.22 AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o app .

FROM gcr.io/distroless/static
COPY --from=build /app/app /app
EXPOSE 8080
ENTRYPOINT ["/app"]
```

### 3.3 镜像仓库与版本

```
app:v1.2.3                          # 语义化版本
app:git-abc1234                     # git sha（唯一可追溯）
app:latest                          # ❌ 避免：不可追溯，别用生产
```

> [!WARNING]
> 生产部署**禁止用 `latest`** 或可变 tag。一旦不可追溯，"这个版本是什么代码"就说不清，回滚也找不到目标。

---

## 四、部署策略

### 4.1 四种主流

```
滚动 (Rolling):       逐个替换旧实例 → 新实例，不停机
蓝绿 (Blue-Green):    两套环境 (blue 旧, green 新)，切流量到 green
金丝雀 (Canary):      先给 5-10% 流量，观察没问题再全量
重建 (Recreate):      先停旧的再起新的（有停机窗口）
```

### 4.2 对比表

| 策略 | 停机 | 回滚 | 适用 | 复杂度 |
|------|------|------|------|--------|
| 重建 | 有 | 快（重部署旧版） | 批处理、无状态 | 低 |
| 滚动 | 无 | 滚回 | 无状态微服务（默认） | 中 |
| 蓝绿 | 无 | 秒切回 | 有状态、不能混跑 | 中高 |
| 金丝雀 | 无 | 切回 | 高风险、新特性 | 高 |

### 4.3 蓝绿 vs 金丝雀实战

**蓝绿**（K8s 手动版）：
```
blue (v1)  ← 生产流量
green (v2) ← 新部署，验证健康
流量切换: 把 LB 指向 green（秒级）
异常: 切回 blue（秒级回滚）
```

**金丝雀**（K8s 渐进式）：
```
canary (v2) 接 5% 流量 → 观察错误率/延迟
指标健康 → 升到 50% → 100%
指标异常 → 自动切回 (自动回滚)
```

> [!TIP]
> 金丝雀的正确姿势是**指标驱动自动决策**（错误率超过阈值自动扩大/回滚），而不是"人盯着 dashboard 手动加比例"。

### 4.4 K8s 部署示例

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 1        # 最多同时不可用 1 个
      maxSurge: 1              # 最多多起 1 个
  selector: { matchLabels: { app: app } }
  template:
    metadata: { labels: { app: app } }
    spec:
      containers:
      - name: app
        image: registry/app:git-abc1234   # 不可变 tag
        readinessProbe: { httpGet: { path: /healthz, port: 8080 } }
```

---

## 五、IaC（Infrastructure as Code）

### 5.1 为什么必须

手工配置服务器 = 状态不可知、不可复现、漂移。IaC 把基础设施当代码管理：**版本控制、可 review、可回滚、可复现**。

### 5.2 两派

| 派 | 工具 | 心智 |
|----|------|------|
| 声明式（声明目标状态） | Terraform / Pulumi / CloudFormation / Kubernetes YAML | "我要什么"，工具 diff 并 apply |
| 命令式（描述步骤） | Ansible / 脚本 | "怎么做"，逐步执行 |

声明式是主流：`terraform plan` 显示 diff，`apply` 收敛到目标状态。

### 5.3 Terraform 示例

```hcl
# main.tf
terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

resource "aws_instance" "web" {
  ami           = "ami-1234"
  instance_type = "t3.micro"
  tags = { Name = "web-prod" }
}
```

```bash
terraform init    # 初始化
terraform plan    # 显示将要做什么（diff）
terraform apply   # 执行
terraform destroy # 删除
```

### 5.4 K8s 的 IaC（GitOps）

GitOps = **git 是唯一的真相源**，集群状态持续收敛到 git 里的声明：

```
git (期望状态) → 拉取 → 对比集群 → 应用差异 → 汇报
```

工具：ArgoCD / Flux。价值：**代码 review 即基础设施 review**；回滚 = git revert；审计 = git log。

> [!WARNING]
> 不要"git 一套、线上手改一套"。一旦漂移（drift），IaC 的收敛（reconcile）要么覆盖手改要么报错——GitOps 强制"git 是唯一真相"。

---

## 六、发布与回滚流程设计

### 6.1 发布清单（Checklist）

一个可靠的发布流程应有：

```
[ ] 测试全绿（单元/集成/契约/E2E 冒烟）
[ ] 产物不可变 + 可追溯（git sha tag）
[ ] 数据库迁移安全（向前兼容 / 可回滚）
[ ] 配置项有默认值且向后兼容
[ ] 健康检查 / 就绪探针就位
[ ] 监控指标有基线（错误率/延迟/P95）
[ ] 回滚计划写好了（不是事故时才想）
[ ] 金丝雀/蓝绿的流量切换步骤
```

### 6.2 数据库迁移（发布最大风险）

发布中最常"卡住回滚"的是 DB schema 变更。原则：

- **向前兼容**：新代码能读旧 schema，旧代码也能读新 schema（兼容窗口）。
- 分两步：先加列/放宽约束（兼容）→ 部署新代码 → 再删旧列（不兼容改动）。
- 工具：Flyway / Liquibase / golang-migrate，迁移文件进版本控制。

```
不兼容改动必须拆分：
Step1: 加新列 (兼容)  → 部署新代码
Step2: 迁移数据
Step3: 删旧列 (不兼容, 代码已不用)
```

### 6.3 回滚策略

```
发布后观察期 (10-30 分钟):
  - 错误率 / 延迟 / 5xx 超阈值 → 触发回滚
回滚方式:
  - 金丝雀/蓝绿: 切回旧版本 (秒级)
  - 滚动: 重新部署旧镜像 (分钟级)
  - DB: 若 schema 有破坏性变更, 需要先回滚迁移 (所以迁移要可逆)
```

---

## 七、CI/CD 平台示例（GitHub Actions）

```yaml
name: CI
on:
  pull_request:
  push: { branches: [main] }

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: go build ./...
      - run: go test ./... -race -count=1
      - run: golangci-lint run

  deploy:
    if: github.ref == 'refs/heads/main'
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build & push image
        run: |
          docker build -t registry/app:git-${{ github.sha }} .
          docker push registry/app:git-${{ github.sha }}
      - name: Deploy
        run: kubectl set image deployment/app app=registry/app:git-${{ github.sha }}
```

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **CI** = 每次提交构建+测试；**CD** = 可靠发布（持续交付=按钮，持续部署=自动）。
> - **核心心智**：小步快速失败，让失败发生在 CI 早期而非生产。
> - **管线**：检出 → 静态检查 → 快测试 → 构建不可变产物 → 慢测试 → staging → 生产。
> - **不可变产物**：构建一次复用到底，tag = git sha，测试的就是要部署的。
> - **部署策略**：滚动（默认无状态）/ 蓝绿（秒切）/ 金丝雀（指标驱动渐进）/ 重建（停机）。
> - **IaC**：声明式（Terraform/K8s）> 命令式；GitOps = git 是唯一真相源。
> - **DB 迁移**：先兼容后破坏，分步走，可回滚。
> - **回滚**：观察期 + 自动回滚；破坏性 schema 变更要提前计划。
> - **生产禁 `latest` tag**。

---

下一篇: [4. 性能工程: profiling / 火焰图 / 缓存与批处理方法论](performance-engineering.md).
