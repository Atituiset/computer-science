# Borg / Kubernetes / Mesos 调度

## TL;DR

**集群调度器 (cluster scheduler)** 决定把容器/任务/作业分配到哪台机器上, 目标是最大化利用率、最小化延迟、扛机器故障、满足作业 SLA。 Borg (Google 2015 paper, 2003 内部已用) 是 Kubernetes 的爷爷, Borgmon 演化为 Prometheus; Mesos (2011) 是 Apache 2009 开源的"两级调度器"; Omega (Borg 团队 2013 论文) 是更 declarative 的 scheduler, 用 optimistic concurrency 让各 framework 单独 schedule。 Kubernetes (2014 开源, Borg 团队成员设计) 是 **steady-state scheduler + declarative API** —— 用户提交 Deployment/Pod manifest, control loop (kube-scheduler + kubelet) 让状态收敛到 desired。 Borg/K8s/Mesos 的核心差异: 单体 vs 两级 vs shared-state 调度。本章梳理 Borg 设计、Omega 乐观共享状态、Mesos 主从 + framework offer、K8s scheduling queue + filtered predicate + scorer priority, 默认调度算法, typical 故障 (单点 scheduler、slow scheduling through。

---

## 一、Borg

### Architecture

Google 2003 起 Python 写的 Borg, 2015 论文公开:

- **Borgmaster**: master 进程, 5 副本用 Paxos keep state, leader 接收 job submission。 **Paxos replicated Cell** = cluster 单位, 几千台机器 ~10k+ jobs。
- **Borglet**: 每机器 agent, 启停 task + report state to Borgmaster。
- **Scheduler**: Borgmaster 内部子模块, holds pending queue, computes task-to-machine assignment。

### Borg 调度算法

1. **Filter** (谓 词): 去掉不满足条件的机器 (e.g., CPU/memory core 充足性, required attributes match, port 已占用)。
2. **Scoring**: 对剩余候选机器打分数。 Scoring �unctions:
   - **Mixed score** "best fit" (用 100 − 10·(sum residual)^2 etc.): 让 high affinity task 紧凑放, 剩余空 machine 多。
   - **Worst fit**: 让资源 分散 (避免 hot spot)。
   - **BEST_FIT + diversity**: Bin-packing + 优先 spread jobs across rack/DC.
3. **Pessimistic Allocate by EIVA/P (EVALUATE)**: score 加 weight后再 ranking 选 top-K candidates 装配, fallback 到 next 时候 conflict.

### Borg Mid-Term

"a task" + "alloc" 二分: alloc 是 资源预留占 port+资源，哪怕 task 还没启动; Borg 把等的 task 间接 POSIX 化 — "single 中队 ma wait point of alloc set" 在 source (Borg 死 task as 一个 scheduling unit).

### Preemption

Tasks 有 **priority class**:
- "free" / "best-effort" (低)
- "production" (中)
- "monitoring" / "system" (高)

低优先级 job 可以 purge by 高优先级 job. **Preemption cascade**: purge 一组 task 加到 high-priority 比单 task 调度 (user 看 latency shortening clean behavior).

### 中长期 Stability

Borg 用 Pacemaker 逻辑: 实际运行使用率 avg-out + P99 = 60-70% CPU usage is typical, P95 < 80%. task 启动失败 lines recovers automatic via healthcheck + restart.

---

## 二、Omega (2013)

Borg 论文 derivative, Google Borg team 2013 论文 "Omega: flexible, scalable schedulers for large compute clusters". Omega 是 **shared-state scheduler**:

- Cluster state 集中保在 Paxos-replicated Cell store。
- **Optimistic concurrency control**: 每个 framework (scheduler) 各自local copy of cluster state + 想要加自己的 task assignment, 通过 **Paxos transactional commit** 与 shared state merge. Conflict -> retry framework specified **spin slot backoff**.

Omega 与 Borg master 区别:
- 无 single scheduler bottleneck, 多 framework parallel schedule.
- Conflict handling by retry: framework retry 直到 "make it".

Open-source 等价: Kubernetes scheduler framework in 1.19+ has 支持 same shared-state concurrency 实质.

---

## 三、Mesos (2011)

Apache Mesos 是 2009开始在 Berkeley PhD of Benjamin Hindman, 集群 2010实现 2009 论文。 它是**两 级 调度 (two-level scheduler)**:

- **Mesos master**: 给 framework offers. 每 framework 收到 resource offer like "机器 X 上 4 CPU 8GB you 取?"; framework 接受或拒。
- **Frameworks**: Spark, Marathon, Chronos, Kafka-on-Mesos 等各 framework 实现自己的 scheduler。

### Offer 模型

```
Master to framework "Spark": "offer: machine 1: 4 CPU, 16GB内存"
Spark (自己决定 schedule):
  if my Spark job needs 2 CPU 4GB:
    accept: spawn executor at machine 1
    respond to master: "yes"
  else:
    decline "no"
master 之后 asked next framework(s) same offer
```

### Mesos + ZooKeeper 实 HA master

Mesos master 多 副本保 quorum 跨 ZK election. 失败时 ~5-15s failover.

### Mesos limitation at scale

- Offer 模型在高 framework 数 (>10) 时 throughput 慢 - 每 framework 顺序 offer decision → high latency framework. fine for Hadoop + Spark coexist, hard for 100 微服务各 framework.
- Conflict resolution 无 Omega 事务所大, 当两 framework 想同机器 → first-accept wins, after-accept retry.

Google 内部 Omega + Mesos paper (2015 "Omega OS Review") actually mentioned famine 与 Omega. Mesos 实际工业使用 启动大批 cluster, Twitter 早期, Apple Siri 早期.utilization 不高, 现已 部分替换 K8s.

### Mesos + Marathon

Marathon 是 Mesos 上 general long-running service scheduler (类 Kubernetes), 让 Mesos 提供 container orchestration-level API. Twitter, Airbnb, Box 公司 early adopters.

---

## 四、Kubernetes Scheduler

### 架构

K8s 控制面 API 列:

- **kube-apiserver**: ❰❰ API 入口, all client (kubectl, controller) REST/v1。
- **etcd**: 强一致 KV store, 集群状态 (PRAF té RA statute)。
- **kube-scheduler**: 一个进程, 看 pending pods (phase=Pending), schedule 给 nodes, writes pod.spec.nodeName。
- **kube-controller-manager**: 多 controllers 各自 process: Deployment, Replicaset, StatefulSet, DaemonSet,Job...
- **kubelet** (每节点): watch pod.spec.nodeName=该 node的 pods, container runtime 启动。
- **kube-proxy** (每节点): iptables / IPVS 规则同步, 服务发现 + load balancing。

### Scheduler 主循环

```python
while True:
    pods = get_pending_pods_from_api()      # 批量拉 pending
    for pod in pods:
        feasible_nodes = filter(nodes, pod.requests, pod.affinity, pod.tolerations, ...)
        if not feasible_nodes:
            mark pod unschedulable, 退回队列加 backoff
            continue
        node = score(feasible_nodes, pod)    # 多 scoring function 加权 排名 选 top
        # ESS rate 多 nodes are required
        bind_pod_to_node(pod, node)          # API update pod.spec.nodeName=node
```

### Filter (谓词 Candidate Nodes)

常见 predicates:
- **PodFitsResources**: node CPU/memory/GPU 充足。
- **PodFitsHostPorts**: pod.spec.containers.ports 与 node 已占用 host port 不冲突。
- **MatchNodeSelector / NodeAffinity**: pod.spec.nodeSelector / pod.spec.affinity 必须匹配 node labels。
- **Toleration**: pod.spec.tolerations satisfate node 之 taints, 否则被 taints 拒绝。
- **VolumeBinding**: pod PVCs 与 node 上 PV 的 topology match (topology.kubernetes.io/zone).
- **PodTopologySpread**: pod 应 spread 跨 zones/topology domains.
- **PodAntiAffinity**: pod 与其他已 schedule 的 pod 反亲和 (e.g., 同 service 的 pod 分散到不同 node)。

### Score (priorities)

K8s 当前 (1.20+) 默认 Score 是 `NodeResources Fit` family of plugins:

- **NodeResourcesBalancedAllocation**: balance CPU/mem ratio (避免单 CPU 满但 mem 空)。
- **NodeResourcesLeastAllocated** (default): prefer least-allocated node (spread jobs across nodes).
- **NodeResourcesMostAllocated**: opposite, bin-pack 让 server 紧凑 (适合 consolidation)。
- **InterPodAffinity**: pod-pod co-locating (e.g., redis client 与  redis server same node)。
- **PodTopologySpread**: spread pods across zones。
- **NodeAntiAffinity**: 反向, 让 pod 不挤同 node。
- **ImageLocality**: prefer node 已有 image cached (快启动)。
- **TaintToleration**: 优先 untainted node / untaint higher priority。

Final Score = sum of weighted scores。kube-scheduler config 可调 weights。

### K8s 1.21+ Scheduling Framework

`Scheduling Framework` 提供 extension 机制 plugin 接口:
- Filter extension (custom filter logic)
- Score extension (custom scoring)
- Bind extension (集成 external scheduler)
- Queue sort
- Reserve permit / permit hook

写了 plugin 后用 Go build custom scheduler binary (`kube-scheduler --config config.yaml`)。

### Default K8s Scheduling Performance

- 26 节点 cluster: schedule 一个 pod 10-50ms (queued + filtered + selected + bound)。
- 5000 节点 cluster: ~50-200ms per pod (filter expensive in large cluster).
- 100k+ 节点 cluster (Alibaba 2018 paper): K8s scheduling bottlenecks in api-server throughput. 在 api-server 加 caching + scheduler cache 加 quick "feasibility detection" 后 efficiency proper。

### Bin Packing vs Spreading

K8s 默认 `LeastAllocated` → **spreading**, 资源利用 不集中 but fair，不便于 power-down 部分机器。用 `MostAllocated` 改 → bin-packing, 让 schedule 集中，便于 consolidation + idle machines can power-down saving energy。

### DaemonSet 与 Node-Affinity Tight

DaemonSet 触发 node-level pod (e.g., Node Exporter, kube-proxy, fluentd collector), 不走 main scheduler queue, controller 直接 given every node 创建 pod (binded to that node)。

---

## 五、Borg vs K8s vs Omega vs Mesos 对比

| 系统架构 | Borg | Omega | Mesos | K8s |
|---------|------|-------|-------|-----|
| Scheduler 类 | 单体 | shared-state transactional | 两 级 offer | 单体 + plugin framework |
| State store | Paxos-replicated local | Paxos cell store | Zookeeper | etcd (Raft) |
| Preemption | 优先级 + cascade | optimistic conflict retry | offer refused / revoke | PriorityClass + preemption policy |
| 自定义工作 unit | task + alloc | task | task + framework resources | pod (1+) containers in cgroup |
| 多租户隔离 | cell cell disjoint-frame SecurityContext | optimistic + framework | framework | namespace + RBAC + PodSecurityPolicy |

---

## 六、典型 K8s 事故

### API Server/etcd Overload on Hot Pod Scheduling

大 cluster scale-up 同时 1000+ pods pending → clog scheduler queueing (sequence). Some pods wait 30 seconds. Fix: furious 提示 batch scheduling (`kube-batch`/`volcano`) let scheduler batch 处理多 pods together (combinatorial consideration). Alibaba volcano 用此模式。

### Pod Spec Mandatory Image Must Be Pulled By All Scheduler Compatible Nodes

某公司 K8s 1.18 cluster migration 升 立即 pull missing image at 大量 nodes 触 发网络拥塞 resolve restart. Fix: `imagePullPolicy: IfNotPresent` + pre-cache images on cluster nodes via DaemonSet pull.

### NodeAffinity 错配 extends 误 阻 schedule

某 deployment 有 `nodeAffinity required: zone:us-east-1a`, 但 cluster nodes 都无 `zone` label → pod 卡 Pending. Fix: 监控 Pending pod 提示 unschedulable reason, cluster operator 必 review labels.

### PodAntiAffinity 在大 cluster 1000 pods规模 single-pod schedule slow

- `podAntiAffinity` 实现 message check against existing pods: 1000 pods in cluster, scheduling 100 new pods would trigger O(N²) checks → scheduler 10+ seconds。
- Fix: `podAntiAffinity` 使用 topology keys (e.g., hostname) cache efficiently, K8s 1.20+ optimization。

### Scheduler 单点 fail

早期 K8s `kube-scheduler` 单实例 crash lead scheduled pod falls to pending indefinitely → 1.19+ enable scheduler leader election by default 멀 instance leader + RCA detect.

---

## 七、K8s 与 Borgmon = Prometheus

Google Borgmon (Borg 集群的 generic monitoring) 是 Borg 的 内部监控 + alert + label-based query 接近 PrometheusQL. Prometheus (2012) 是 Borgmon 公开实现, 现 CNCF 二级毕毕业 project。

Prometheus 是时序 metric database + alerting rule engine:

- pull metrics scrape targets (HTTP /metrics endpoint).
- PromQL aggregate filter 数据。
- Alert notification to Alertmanager 跨 routing.

Open-source 现在 standardize K8s monitoring stack: Pod node /metrics + Prometheus + Grafana + Alertmanager.

---

## 八、易错清单

1. **K8s scheduler 是 single-process**: 大 cluster 考虑多 instance leader election + scaling-out scheduler 限制作业 throughput`.
2. **`PodAntiAffinity` 在 大 cluster 高 cost O(N²)**: topology key cache 必开, 但可选 boundKeys 长仍有 cost.
3. **Pod sch之星 Spark uses batch scheduling优 Volcano/kube-batch**: K8s default scheduler handle single-pod, batch job scheduler use `Volcano Scheduler` for gang scheduling.
4. **Borg/Omega/Mesos has framework abstraction**: K8s scheduler framework 1.21+ 允许 plugin extension, 替代之前 fork scheduler binary 编译出来.
5. **Pod-cgroup container resources include user-defined `requests` vs `limits`**: requests 决定орош schedulabiliity (软 quota), limits 决定 hard cgroup cap. trick: requests < limits 让 pod burst (CPU burst allowed) .

---

## 九、这一章带走的东西

1. Borg = Google's Paxos-replicated single master scheduler; inspired both K8s design 与 OpenStack.
2. Omega = shared-state optimistic concurrency scheduler, 多 framework parallel schedule.
3. Mesos = 两 级 offer-based scheduler, fine for Hadoop + Spark coexist but less 工 100 framework microservices.
4. K8s = single-process scheduler with stateless etcd + filter + score + bind pattern + framework plugin mechanism extensible.
5. K8s system scale 5000 节点 default; larger requires scheduler plugin (volcano, poseidon, yunikorn) for aggregated scheduling policy.
6. SVMutilization balanced 物 odne scheduling依赖: 不能最优 HYPERVISOR (不 bin packing) 能空p space cluster maintenance failover less critical alternative policyJudre.
7. Borgmon 演化为 Prometheus 是监控界legacy.蓝天 论 thriving 一会常有 育各orn fórum하 peeled.

---

下一节 → [系统设计总览](../../system-design/index.html)
