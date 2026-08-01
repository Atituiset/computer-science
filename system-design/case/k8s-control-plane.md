# Kubernetes Control Plane 设计剖析

## TL;DR

Kubernetes (Google 2014, CNCF) control plane 是分布式的 "操作系统 for 容器"。 API Server / etcd / Controller Manager / Scheduler / CoreDNS / kubelet 构成 K8s 的组件。 它经 10 年 evolved 到 1.30+ 成功能 —— 从 Borg 学到 lessons: declarative API (desired state)+ control loop (reconcile) 是最本质 design。本章解析每个组件, controller pattern, etcd consistency guarantees, scheduler scoring, 与大规模 cluster 的 局限 (5000 node, etcd 2GB)。 经典事故 (API server overload, etcd bottleneck, OOM)。

---

## 一、Kubernetes 是为什么设计

### Borg (Google 内部 2004-2015) 的 Lessons Learned

Kubernetes 由 Google Borg 团队设计, 重新构建时放弃 Borg 部分设计:
1. **Declarative 代替 imperative**: submit pod spec as "desired state", control loop reconcile → state。
2. **Labels 代替 indexed job name/ID**: free form label enable dynamic grouping.
3. **Cell-less** (no big cluster master): Pods 可在任何 node 调度, 不可 on dedicated server block.

Key Borg insight: 用户**declaration intent** and platform resolves how.

---

## 二、Control Plane Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Control Plane                      │
│                                                      │
│ kube-apiserver ←→ etcd (Raft cluster)               │
│      ↑↓                                              │
│ kube-controller-manager   (Replication, Deployment,  │
│                             Service, HPA controllers)│
│ kube-scheduler            (filter+score nodes→ pod)  │
│ cloud-controller-manager  (cloud LB/node lifecycle)  │
└─────────────────────────────────────────────────────┘
          ↓                ↑
    Node1: kubelet + kube-proxy
    Node2: kubelet + kube-proxy
    ...
    NodeN: kubelet + kube-proxy
```

### kube-apiserver

- REST endpoint for all operations (kubectl→ API); validate + auth + RBAC + admission webhooks.
- Stateless, multi-replica scale; backed by etcd for all state.
- Watch API: long-running connection 推送 event changes to clients (controller-kubelet watches).
- Admission webhooks (mutating + validating) 插 入 custom logic.

### etcd

- Strongly consistent (Raft) singleton datastore for all cluster state.
- `watch` API to push changes to controllers, scheduler, kubelets.
- **Limits**: 2GB total DB (default `quota-backend-bytes`); 需 compaction 防止磁盘满.

### kube-controller-manager

二进制 包含 20+ controllers 在一个 single process (bin packing). 最值 controller 类:

| Controller | 做什么 |
|-----------|--------|
| ReplicationController (RC) | pods 数 保持在期望 |
| ReplicaSetController | 新一代 RC (select label match) |
| DeploymentController | 滚动更新 replicaset 的策略 |
| StatefulSetController |  order/persistent/identity |
| DaemonSetController | 每个 node 跑 一个 pod |
| HPA Controller | scale deployment via CPU/memory/ custom metric |
| Service Controller | 映射 endpoints to service VIP |
| Namespace Controller |  lifecycle (terminating gap 清) |
| Job/CronJob Controller |  batch jobs |

每个 controller 都是 watch-inform-cache (list/watch) + reconcile loop.

### kube-scheduler

- Watch new pods with `nodeName==''`, 选合适 node.
- 2 step: **Filter (feasibility)** → **Score (ranking)**.
- Scoring: `NodeResourcesLeastAllocated` (spread defaults) 或 `NodeResourcesMostAllocated` (bin-pack compact).
- `affinity, anti-affinity, taint/tolerations` → constraint-aware。

### kubelet

Per-node  agent: sync pod spec <-> container，通过 CRI (Container Runtime Interface):
- Docker (deprecated), containerd, CRI-O.

### kube-proxy

iptables / IPVS rules for service ClusterIP/NodePort load-balancing; endpoint watch service logic endpoint.

---

## 三、Declarative & Reconcile Loop

K8s concept: "Tell me desired state, I make it so".

### Controller Pattern

```go
for {
    desired := getDesiredState()    // from API server
    current := getCurrentState()    // from 监控
    if current != desired {
        makeChanges(desired - current)
    }
}
```

每个 controller 做 reconcile:
- Deployment controller: 若 current_replicas != desired_replicas →  create/delete pod.
- Node controller:  monitor node's health; 条件 down, 驱逐 pod.

### Watch vs Polling: Caching informers

K8s client-go informer: list-and-watch pattern holds local cache synchronized to API server via Watch API updates. Reduce API server load.

---

## 四、K8s 扩展 (Admission Webhooks, CRDs)

### Custom Resource Definitions (CRDs)

```yaml
apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: myresources.mycompany.io
spec:
  group: mycompany.io
  versions:
    - name: v1
      served: true
      storage: true
  scope: Namespaced
  names:
    plural: myresources
    singular: myresource
    kind: MyResource
```

then people write controllers for CRDs (operator pattern). e.g., etcd-operator, prometheus-operator, istio-operator。

### Admission Webhooks

- Mutating: 修改资源 (inject sidecar, default toleration)
- Validating:  reject 非法 requests

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingWebhookConfiguration
...
```

### Service Mesh (Istio / Linkerd)

Pods 获 sidecar `envoy` (injected via mutating webhook), intercept traffic for mTLS, retry, circuit breaking, telemetry.

---

## 五、Scaling K8s

### Saturation Limits (up to 1.29)

| 维度 | 限制 |
|------|------|
| Nodes per cluster | 5000 |
| Pods per node | 110 (default) |
| Total pods in cluster | 150,000 |
| etcd DB size | max 8 GB (default `quota-backend-bytes`) |
| API server QPS | ~2K-5K sustained |

Beyond 5000 node → multi-cluster (Kubernetes Federation v2 / Karmada ).

### 单 cluster 大 node 事故

- etcd 2GB 限额 打满; 定期 compaction + auto defragmentation.
- API server info too heavy →  ert-pas  watch demand overload; split-load: apiserver replica shard by labels/namespaces.

---

## 六、典型事故

### API Server overload by Watch storm

Large cluster 1000+ nodes 同时 watch pods; API server OOM after simultaneous polling retries after etcd timeout. Solution: increase `max-requests-inflight` + apply priority & fairness to 限 watch.

### etcd database OOM

默认 2GB quota． etcd 连 写 高但 没 compaction, 磁盘 增长 超 2GB → master-alarm 无新写, all CRUD control plane stale. Fix: auto-compaction period=30m.

### Scheduler queue jam at 1000 pending pods

During scale-down + replicaSet reconcile, 2000+ pods instantly pending. Scheduler filter/score per pod O(N) nodes significant blocking, and queue 退后分钟. Fix: take batch scheduling extension (volcano, coscheduling) 让 批 pods 同时 评 分。

### CNI not ready → all pods stuck ContainerCreating

New cluster, Calico CNI missing  `tolerations` & `nodeSelector`． All pods pending → network plugin not found on node. Fix: DaemonSet CNI taint 同补。

---

## 七、易错清单

1. **etcd 总量 必  ≤ 8GB**, periodically `compaction` + `defrag` to avoid `mvcc: database space exceeded`.
2. **Watch 不要用 label 过滤 → all registered filter fallback to API server** slow; use fieldSelector 防 watching all pods.
3. **Mutating webhook timeout 必 ≤10s**, else API server reject requesting pod admission.
4. **Resource limits 不可 `requests` > `limits`**: CPU burst OK, but mem request must = mem limit (or risk OOM kill).
5. **`kube-proxy` mode `iptables` vs `IPVS`** : IPVS is  recommended for 1000+ services, better throughput + load balance distribution.
6. **kubelet configuration rotation**: node restart 或 证书 到期 短路径 kerberos internal admin cert handling rotate.

---

## 八、这一章带走的东西

1. K8s control plane = etcd store + API server +  controllers + scheduler + kubelet 代理.
2. Declarative desired state + controller reconcile loop 是核心设计。
3. Scale limit ~5000 nodes + 150K pods; multi-cluster beyond.
4. Key controllers: Deployment / ReplicaSet / HPA / StatefulSet / DaemonSet / CronJob.
5. CRD + operator pattern extend K8s to manage any resource type.
6. etcd quota 2GB frequently hits; must compaction + monitoring graceful.
7. K8s Scheduler: filter → score → bind; multi-scheduler extension 支持 batch scheduling via coscheduling plugin.

---

下一节 → [回到总览](../../README.md)
