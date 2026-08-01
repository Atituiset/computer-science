# 8. GitHub Actions 实战: workflow / expression / 缓存 / 矩阵 / reusable / 自托管

## TL;DR

GitHub Actions 是 CI/CD 的事实标准之一（尤其开源项目）。上一章 CI/CD 讲了通用管线模型，这一章**手把手落到 GitHub Actions**：语法、环境、expression、缓存、矩阵构建、可复用 workflow、自托管 runner、安全（权限/secret）。看完能自己搭一条生产级 pipeline。

读完应能：
1. 读懂任意 `.github/workflows/*.yml` 并写出自己的。
2. 用 expression、条件、矩阵、缓存优化 CI 速度和正确性。
3. 用 reusable workflow 消除跨仓库重复。
4. 正确配置权限和 secret，不踩常见安全坑。

---

## 一、核心概念

### 1.1 三要素

```
event (触发器) → job (任务, 独立 runner) → step (步骤, 同一 runner 顺序执行)
```

- **workflow**：一个 `.github/workflows/xxx.yml` 文件。
- **job**：workflow 里的一个任务，跑在独立 runner 上（可并行）。
- **step**：job 里的一步（一个命令或一个 action），顺序执行、共享 shell。

### 1.2 关键文件路径

```
.github/
  workflows/
    ci.yml            # 每个文件 = 一个 workflow
```

### 1.3 最小 workflow

```yaml
name: CI
on: push           # 触发：push 到任何分支

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4    # 检出代码
      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'
      - run: go build ./...
      - run: go test ./...
```

---

## 二、触发器（Event）

### 2.1 常用触发

```yaml
on:
  push:
    branches: [main]            # 只推 main
    paths:
      - 'src/**'                # 只当 src 变化时（避免无关触发）
      - 'go.mod'
      - '!docs/**'              # 排除 docs
  pull_request:
    types: [opened, synchronize, reopened]   # synchronize = 新提交
  schedule:
    - cron: '0 2 * * *'        # 每天 2 点（UTC）
  workflow_dispatch:            # 手动触发（必须加这个按钮才会出现）
```

### 2.2 触发规则要点

- `push` 和 `pull_request` 常搭配（PR 阶段 + 合并后各跑一遍）。
- `paths` 过滤器避免"只改 README 也跑全量 CI"。
- `workflow_dispatch` + `inputs` 可做手动参数化触发。

```yaml
on:
  workflow_dispatch:
    inputs:
      environment:
        description: '部署环境'
        required: true
        default: 'staging'
        type: choice
        options: [staging, prod]
```

---

## 三、上下文与 Expression

### 3.1 关键上下文（Context）

| 上下文 | 内容 | 例子 |
|--------|------|------|
| `github` | 事件/仓库/actor | `github.sha`, `github.ref`, `github.actor` |
| `env` | workflow/job/step 级 env | 自定义环境变量 |
| `secrets` | 仓库 secrets | `secrets.GITHUB_TOKEN` |
| `vars` | 仓库变量 | `vars.REGION` |
| `job` | job 状态 | `job.status` |
| `needs` | 依赖 job 的输出 | `needs.build.outputs.ver` |
| `matrix` | 矩阵参数 | `matrix.go-version` |

### 3.2 Expression 语法

```yaml
# 表达式用 ${{ }} 包裹，在字符串里也可插值
- run: echo "sha is ${{ github.sha }}"
- if: ${{ github.ref == 'refs/heads/main' }}
- if: ${{ !cancelled() }}       # 前序失败也跑（清理用）
- if: ${{ success() }}          # 默认: 全成功才跑
- if: ${{ failure() }}          # 失败才跑
```

### 3.3 条件操作符

```
==  !=  &&  ||  !  ( )  contains()  startsWith()  endsWith()
```

```yaml
- name: 只在 PR 且改动 src 时跑集成测试
  if: github.event_name == 'pull_request' && contains(github.event.pull_request.files.*.filename, 'src/')
```

---

## 四、Job 依赖与并行

### 4.1 needs（依赖）

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
  deploy:
    needs: test                  # 等 test 成功后
    runs-on: ubuntu-latest
```

### 4.2 并发控制（防止重复发布）

```yaml
concurrency:
  group: deploy-${{ github.ref }}   # 同 ref 的任务互斥
  cancel-in-progress: true          # 新任务顶掉旧任务
```

### 4.3 超时与失败容错

```yaml
jobs:
  test:
    timeout-minutes: 10          # job 级超时
    steps:
      - run: sleep 100000
        timeout-minutes: 2       # step 级超时
  cleanup:
    if: ${{ always() }}          # 无论成败都跑
    runs-on: ubuntu-latest
    needs: [test, deploy]
```

---

## 五、矩阵构建（Matrix）

### 5.1 多版本/多平台

```yaml
jobs:
  test:
    strategy:
      matrix:
        go: ['1.21', '1.22']
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/setup-go@v5
        with: { go-version: ${{ matrix.go }} }
      - run: go test ./...
```

→ 自动生成 `2 × 2 = 4` 个并行 job。

### 5.2 排除组合

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest]
    go: ['1.21', '1.22']
    exclude:
      - os: windows-latest    # windows 只测一个版本
        go: '1.21'
```

### 5.3 include（加额外组合）

```yaml
matrix:
  include:
    - os: ubuntu-latest
      go: '1.23'    # 额外加一个
```

### 5.4 矩阵产物汇总

多个 OS 的产物要上传再合并：

```yaml
- name: Upload artifact
  uses: actions/upload-artifact@v4
  with:
    name: dist-${{ matrix.os }}
    path: dist/

# 汇总 job
publish:
  needs: build        # 等所有矩阵 job
  steps:
    - uses: actions/download-artifact@v4
      with: { pattern: dist-* }
```

---

## 六、缓存与提速

### 6.1 缓存依赖

```yaml
- name: Cache go modules
  uses: actions/cache@v4
  with:
    path: ~/.cache/go-build
    key: go-cache-${{ runner.os }}-${{ hashFiles('go.sum') }}
    restore-keys: |
      go-cache-${{ runner.os }}-
```

- `key` 变化（依赖变了）才重新缓存。
- `restore-keys` 提供"找不到精确 key 时用相近的"。

### 6.2 各生态缓存

```yaml
# Go
actions/cache  →  ~/.cache/go-build,  key=hashFiles('go.sum')

# Python
actions/setup-python@v5 自带 cache: pip
  with: { python-version: '3.12', cache: 'pip' }

# Node
actions/setup-node@v4
  with: { node-version: 20, cache: 'npm' }

# Rust
Swatinem/rust-cache@v2    # 自动处理 target/
```

### 6.3 加速技巧

- 用 `actions/setup-*` 的 `cache` 参数（自动）。
- 只装依赖不改就复用层（Docker layer caching）。
- 矩阵并行 > 单 job 里并行步骤。
- 慢测试拆分到独立 job 并行。

---

## 七、可复用 Workflow（Reusable）

### 7.1 为什么

多仓库重复 CI 配置 → 抽成一个可复用 workflow，改一处全生效。

### 7.2 定义（被复用方）

`.github/workflows/test-reusable.yml`（必须 `workflow_call`）：

```yaml
name: Reusable Test
on:
  workflow_call:
    inputs:
      go-version:
        required: true
        type: string
    secrets:
      token:
        required: true
    outputs:
      test-passed:
        value: ${{ jobs.test.result }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: ${{ inputs.go-version }} }
      - run: go test ./...
```

### 7.3 调用（使用方）

```yaml
jobs:
  test:
    uses: ./.github/workflows/test-reusable.yml   # 同仓库
    with:
      go-version: '1.22'
    secrets:
      token: ${{ secrets.GITHUB_TOKEN }}
```

> [!NOTE]
> 跨仓库复用：`uses: owner/repo/.github/workflows/xxx.yml@main`。可复用 workflow 里的 secrets 必须显式 `secrets:` 传，不能用 `${{ secrets }}` 全局。

---

## 八、环境与 Secrets

### 8.1 环境（Environment）——部署隔离

```yaml
jobs:
  deploy-prod:
    environment: production        # 绑定到仓库的 environment
    runs-on: ubuntu-latest
```

Environment 支持：**分支保护规则 + 审批者**（生产部署需人工 approve）+ 独立 secrets。

```yaml
environment:
  name: production
  url: https://api.example.com    # 显示在 GitHub UI
```

### 8.2 Secrets 安全要点

```yaml
- name: Deploy
  env:
    DB_PASSWORD: ${{ secrets.DB_PASSWORD }}   # 从 secret 读，不硬编码
  run: |
    curl -H "Authorization: Bearer $DB_PASSWORD" ...
```

> [!WARNING]
> **绝不要** `echo "${{ secrets.X }}"` 打印 secret（会进日志/缓存）。用 env 传，运行时通过环境变量取。secret 不能在 `if:` 条件里比较（会泄露值到日志）。

### 8.3 GITHUB_TOKEN 权限最小化

```yaml
permissions:
  contents: read              # 默认最小: 只读
  pull-requests: write        # 需要写 PR 时才加
  packages: write
```

> [!WARNING]
> `permissions: write-all` 是全开——Dependabot/PWN 攻击直接拿到写权限。**永远最小权限**。合并 PR 的 workflow（`pull_request_target`）尤其危险（运行在基础分支上下文，别 checkout 攻击者代码）。

### 8.4 密钥扫描

```yaml
- uses: gitleaks/gitleaks-action@v2   # 扫描提交里的密钥
```

---

## 九、自托管 Runner（Self-hosted）

### 9.1 什么时候需要

- 需要特定硬件/GPU、私有网络、容器环境。
- 比 GitHub 托管便宜（大量 build）。

### 9.2 配置

```bash
# 在仓库 Settings → Actions → Runners 获取 token
./config.sh --url https://github.com/owner/repo \
            --token <token> --labels my-runner
./run.sh
```

### 9.3 安全警告

> [!WARNING]
> **自托管 runner 在 public 仓库 = 远程代码执行**。任何人都能开 PR 让 runner 跑代码。除非绝对信任 PR 来源，否则 public 仓库别用自托管 runner。保护办法：只在 `pull_request_target` + 手动触发用，或跑在隔离 VM。

### 9.4 Runner 分组与标签

```yaml
runs-on:
  group: my-group      # 指定 runner group
  labels: [gpu, linux] # 按标签选 runner
```

---

## 十、完整生产级示例

```yaml
name: CI/CD

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: golangci/golangci-lint-action@v6

  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        go: ['1.21', '1.22']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: ${{ matrix.go }}, cache: true }
      - run: go test ./... -race -count=1

  build:
    needs: [lint, test]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build & push image
        run: |
          docker build -t ghcr.io/${{ github.repository }}:${{ github.sha }} .
          docker push ghcr.io/${{ github.repository }}:${{ github.sha }}

  deploy-staging:
    needs: build
    if: github.ref == 'refs/heads/main'
    environment: staging
    runs-on: ubuntu-latest
    steps:
      - run: kubectl set image deployment/app app=ghcr.io/${{ github.repository }}:${{ github.sha }}
```

---

## 十一、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **结构**：event → job（独立 runner）→ step（顺序共享 shell）。
> - **触发**：`push` / `pull_request` / `schedule` / `workflow_dispatch`；用 `paths` 过滤。
> - **expression**：`${{ }}`，`github` / `env` / `secrets` / `needs` / `matrix` 上下文。
> - **条件**：`if: success() / failure() / always() / cancelled()`。
> - **矩阵**：`strategy.matrix` 多版本多平台，`exclude` / `include`。
> - **缓存**：`actions/cache` 或 `setup-*` 自带 cache；key 用 `hashFiles`。
> - **可复用**：`workflow_call` / `uses: owner/repo/.github/workflows/x.yml@main`。
> - **环境**：`environment:` 绑定审批 + 独立 secrets；**生产部署加审批**。
> - **安全**：`permissions` 最小化；secret 用 env 传不打印；**public 仓库别用自托管 runner**。
> - **并发**：`concurrency.group` 防重复发布。

---

下一篇: [9. 云原生发布与 GitOps: K8s / Helm / ArgoCD / Flux](gitops-k8s.md).
