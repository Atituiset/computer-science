# 9. 云原生发布与 GitOps: K8s 应用 / Helm / ArgoCD / Flux / 服务网格

## TL;DR

上一章讲了 GitHub Actions 把代码变成镜像；这一章讲**镜像怎么进 K8s、怎么可靠发布、怎么用 GitOps 管理**。核心是把"部署"也变成**声明式 + 可 review + 可回滚**的代码。

读完应能：
1. 看懂 K8s 的 Deployment / Service / ConfigMap / Secret，知道发布流程。
2. 用 Helm 打包/升级应用，理解 values 与 chart 结构。
3. 理解 GitOps（ArgoCD/Flux）：git 是唯一真相，集群自动收敛。
4. 了解 service mesh（Istio/Linkerd）解决的发布问题。
5. 设计"镜像构建 → git 更新 → GitOps 自动发布 → 观察 → 回滚"的闭环。

---

## 一、K8s 应用发布基础

### 1.1 核心对象

| 对象 | 作用 |
|------|------|
| **Deployment** | 无状态应用：副本数 / 滚动更新 / 回滚 |
| **Service** | 稳定访问入口（ClusterIP / NodePort / LB） |
| **ConfigMap** | 非敏感配置 |
| **Secret** | 敏感配置（base64，最好用外部密钥管理） |
| **Ingress** | 域名 → Service 的路由 |
| **HPA** | 自动扩缩容 |

### 1.2 Deployment 发布模型（滚动）

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
      maxUnavailable: 25%    # 最多 25% 不可用
      maxSurge: 25%          # 最多多 25% 新副本
  selector:
    matchLabels: { app: app }
  template:
    metadata:
      labels: { app: app }
    spec:
      containers:
        - name: app
          image: registry/app:v1.2.3     # ← 更新 image = 发布
          ports: [{ containerPort: 8080 }]
          readinessProbe:
            httpGet: { path: /healthz, port: 8080 }
            initialDelaySeconds: 5
          livenessProbe:
            httpGet: { path: /healthz, port: 8080 }
            periodSeconds: 10
```

**发布 = 改 `image:` 字段**。K8s 自动滚动：起新副本 → 就绪后删旧副本。

### 1.3 探针（Probe）

- **readinessProbe**：就绪才进 Service 流量（没它就"流量打向没准备好的 pod"）。
- **livenessProbe**：活着的才留，否则重启（防止死锁僵尸）。
- 一定要区分二者：就绪失败 ≠ 重启，存活失败 = 重启。

### 1.4 回滚

```bash
kubectl rollout undo deployment/app            # 回滚到上一个版本
kubectl rollout history deployment/app         # 看历史
kubectl rollout status deployment/app          # 看发布状态
```

> [!WARNING]
> **image 用不可变 tag**（`v1.2.3` / `git-sha`），不要用 `latest`。`latest` 会让 `kubectl rollout` 分不清"改没改"，且不可追溯。

---

## 二、ConfigMap 与 Secret

### 2.1 ConfigMap（非敏感配置）

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: app-config }
data:
  LOG_LEVEL: info
  MAX_CONNECTIONS: "100"
```

```yaml
# Deployment 里注入
envFrom:
  - configMapRef: { name: app-config }
```

### 2.2 Secret（敏感配置）

```yaml
apiVersion: v1
kind: Secret
metadata: { name: app-secret }
type: Opaque
stringData:        # 用 stringData, K8s 自动 base64 存储
  DB_PASSWORD: "s3cr3t"
```

```yaml
env:
  - name: DB_PASSWORD
    valueFrom:
      secretKeyRef: { name: app-secret, key: DB_PASSWORD }
```

> [!WARNING]
> K8s Secret 只是 base64，不是真加密。**生产用 External Secrets Operator / Sealed Secrets / Vault**，把真密钥放外部管理，K8s 里只放引用。Secret 进 git 前必须加密。

---

## 三、Helm：K8s 的包管理

### 3.1 为什么 Helm

裸 YAML 管理问题：
- 环境差异（dev/staging/prod 配置不同）没法复用。
- 升级/回滚要手工 kubectl。
- 一个应用 20 个 YAML 难维护。

Helm = **模板化 + 版本化 + 升级/回滚**。

### 3.2 Chart 结构

```
mychart/
  Chart.yaml          # 元数据 (name/version)
  values.yaml         # 默认配置（用户覆盖）
  templates/          # Go template 渲染的 YAML
    deployment.yaml
    service.yaml
    _helpers.tpl      # 公共模板
  .helmignore
```

### 3.3 使用

```bash
helm create myapp
helm install myapp ./mychart              # 安装
helm upgrade myapp ./mychart -f prod-values.yaml   # 升级
helm rollback myapp 1                     # 回滚
helm list
```

### 3.4 values 覆盖

`values.yaml`（默认）：
```yaml
replicaCount: 3
image:
  repository: nginx
  tag: stable
resources:
  limits: { cpu: 500m, memory: 512Mi }
```

`prod-values.yaml`（覆盖）：
```yaml
replicaCount: 10
image:
  tag: v1.2.3
resources:
  limits: { cpu: 4, memory: 8Gi }
```

```bash
helm upgrade myapp ./mychart -f prod-values.yaml
```

### 3.5 模板示例

```yaml
# templates/deployment.yaml (片段)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ .Chart.Name }}
spec:
  replicas: {{ .Values.replicaCount }}
  template:
    spec:
      containers:
        - name: app
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          resources:
            limits:
              cpu: {{ .Values.resources.limits.cpu }}
```

### 3.6 安全与版本

- Chart 版本与 App 版本分开（`version` vs `appVersion`）。
- 用 `--atomic`：升级失败自动回滚。
- Helm 仓库（OCI Registry / ChartMuseum）统一管理 chart。

---

## 四、GitOps：git 是唯一真相

### 4.1 核心思想

> **git 仓库里的声明 = 集群的期望状态。有 agent 持续把集群收敛到 git 状态。**

```
开发者: 改 git (YAML/image tag)
  ↓
ArgoCD/Flux 检测到 git 变化
  ↓
比较集群当前状态 vs git 期望状态 (diff)
  ↓
不一致 → 应用/回滚到期望状态
  ↓
报告状态 (Healthy / OutOfSync / Degraded)
```

### 4.2 为什么比"CI 直接 kubectl"好

| | CI 直接部署 | GitOps |
|---|---|---|
| 真相源 | CI 脚本 + 手动操作 | **git** |
| 可 review | 难 | 部署即 PR 可审 |
| 回滚 | 手工 | git revert |
| 审计 | 差 | git log 即审计 |
| 漂移处理 | 无 | agent 自动收敛/告警 |

### 4.3 ArgoCD

- **声明式**：一个 Application 指向 git repo 里的路径。
- **App of Apps**：用一个 App 管理所有 App。

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp
  namespace: argocd
spec:
  destination:
    server: https://kubernetes.default.svc
    namespace: prod
  source:
    repoURL: https://github.com/org/app-config.git
    path: prod
    targetRevision: main
  syncPolicy:
    automated:
      selfHeal: true      # 集群被手动改 → 自动纠正回 git 状态
      prune: true         # git 里删了 → 集群里也删
```

```bash
argocd app sync myapp          # 手动同步
argocd app rollback myapp 2    # 回滚
```

### 4.4 Flux（另一个主流）

- 与 ArgoCD 同思路，更偏"GitOps Toolkit"（Kustomize 优先）。
- `ImageAutomation` 可自动更新 image tag → 全自动发布流水线。

### 4.5 发布闭环（GitOps + CI）

```
CI (GitHub Actions): 构建镜像 → push → 更新 app-config repo 的 image tag (PR)
        ↓
GitOps agent (ArgoCD): 检测 app-config 变化 → 应用 → 健康检查
        ↓
生产就绪; 失败 → 自动回滚/告警
```

> [!NOTE]
> **镜像仓库和配置仓库分开**是常见最佳实践：代码 repo 构建镜像，`app-config` repo 只声明"这个 tag 部署到哪"。这样"代码变了"和"部署了"是两个可独立回滚的决策。

---

## 五、Kustomize：另一个配置管理

Helm（模板 + 逻辑）vs Kustomize（纯覆盖，无逻辑）：

```bash
# Kustomize: base + overlay
base/
  deployment.yaml
overlays/
  prod/
    kustomization.yaml    # 覆盖 image/replicas
```

```yaml
# overlays/prod/kustomization.yaml
resources:
  - ../../base
patches:
  - path: patch.yaml
images:
  - name: nginx
    newTag: v1.2.3
```

```bash
kubectl apply -k overlays/prod
```

**对比**：Helm 强在模板复用；Kustomize 强在无学习成本、无逻辑、纯声明。ArgoCD/Flux 两者都支持。

---

## 六、服务网格（Service Mesh）

### 6.1 解决什么

微服务间通信的可观测性 / 流量控制 / 安全（mTLS）横切每个服务——不想每个服务都写重试/超时/追踪代码 → 用 sidecar 代理统一注入。

### 6.2 核心能力

- **流量管理**：灰度/金丝雀（按 header/百分比路由到 v2）。
- **可观测**：自动指标/追踪（无需改业务代码）。
- **安全**：服务间 mTLS 自动加密。
- **可靠性**：超时/重试/熔断/限流注入。

### 6.3 Istio 示意

```yaml
apiVersion: networking.istio.io/v1beta1
kind: VirtualService
metadata: { name: myapp }
spec:
  hosts: [myapp]
  http:
    - match:
        - headers:
            x-canary: { exact: "true" }
      route: [{ destination: { host: myapp, subset: v2 } }]   # 按 header 走 v2
    - route:
        - destination: { host: myapp, subset: v1 }
          weight: 95        # 95% v1
        - destination: { host: myapp, subset: v2 }
          weight: 5         # 5% v2  (金丝雀)
```

### 6.4 什么时候用/不用

- **用**：微服务规模大、跨服务流量控制/安全/可观测需求强。
- **不用**：服务少（< 10）、单体、控制面复杂度不值得（每个 pod 多一个 sidecar）。

---

## 七、发布安全与生产就绪清单

```
[ ] image 用不可变 tag (git-sha), 不用 latest
[ ] readiness + liveness 探针配置正确
[ ] resources.limits/requests 设置 (防止吃垮节点)
[ ] Secret 用外部管理 (Vault/External Secrets)
[ ] GitOps: 部署变更走 git PR (可 review 可回滚)
[ ] 滚动更新策略 (maxUnavailable/maxSurge) 合理
[ ] 金丝雀: 先 5% 再全量, 指标驱动
[ ] 数据库迁移与发布解耦 (先兼容后破坏)
[ ] 回滚演练过 (kubectl rollout undo / argocd rollback)
[ ] HPA 配置 (弹性)
[ ] 网络策略/命名空间隔离
```

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **发布 = 改 image tag**；用不可变 tag；`kubectl rollout undo` 回滚。
> - **探针**：readiness（就绪才进流量）/ liveness（存活才留）；一定分开。
> - **ConfigMap**（非敏感）/ **Secret**（敏感，K8s 里只是 base64，生产用 Vault）。
> - **Helm** = 模板 + 版本 + 回滚；`values.yaml` 覆盖环境差异；`--atomic` 防失败留半。
> - **GitOps**：git 是唯一真相，ArgoCD/Flux 自动收敛；自愈 + prune。
> - **CI vs GitOps**：CI 建镜像，GitOps 管部署（镜像 repo 与配置 repo 分离）。
> - **Kustomize**：纯覆盖无逻辑；Helm 有模板有逻辑。
> - **Service Mesh**：sidecar 注入做灰度/mTLS/重试；服务少别用。
> - **生产就绪**：探针 + 资源限制 + 不可变 tag + Secret 外部化 + 金丝雀。

---

下一篇: [10. SRE 工程: 错误预算 / 容量 / 变更 / 事件响应 / 生产就绪](sre-engineering.md).
