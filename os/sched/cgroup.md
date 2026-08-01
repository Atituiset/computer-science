# Cgroup v2、CPU 迁移与亲和

## 一句话

OS 调度物理硬共享 CPU, 但工程上我们需要在**逻辑子单元**(进程 / 容器 / 子系统)上"重量计 + 资源隔离". 这就是 cgroup 出现的理由. cgroup v2 整合解决了 v1 时代几十个独立 controller 的混乱, 现代容器调度 (k8s / docker) 都基于本. 你在 K8s yaml 写 `resources.requests.cpu=2`, 你实际启的是 cgroup v2 的 `cpu.weight=8192`(或 `cpu.max=quota/period`). 这章把 cgroup 物理 + 与 OS scheduler 同一抽象.

## 1. cgroup 是什么

cgroup = control group = Linux 提供把任意 进程组 绑定到资源限制层. 资源包括: cpu / memory / IO / network / pid / freezer 等.

**配上 namespace (type-of 系统看到的隔离)**, 它们加起来叫容器.

```
namespace: 让 看到
cgroup:     让 用 / 减少
```

这俩 abstractly 说一下"same" 差在: namespace 改 client 对 kernel state 的视角, cgroup 改 scheduler 给你多少.

## 2. cgroup v1 vs v2

v1 (Linux 2.6.24-2017): 每控制器一棵独立树, 多控制器混用易出问题 (e.g. 在 cpu hierarchy 上挂 memory 子树不一致).

v2 (Linux 4.5+ unified hierarchy): 一棵树, 所有进程只在一个 cgroup, 单点 unified 一份. 控制器在 internal nodes 启用, 是 `+/resume`.

```bash
# v2 mount
mount -t cgroup2 none /sys/fs/cgroup

# 新建 cgroup
mkdir /sys/fs/cgroup/mygroup
echo $$ > /sys/fs/cgroup/mygroup/cgroup.procs
echo "max 100000 100000" > /sys/fs/cgroup/mygroup/cpu.max  # 100ms quota / 100ms period = 1 CPU
```

## 3. cpu.weight / cpu.max: 软限 vs 硬限

```
cpu.max:   "<quota> <period>" hard limit. quota=200000, period=100000 ⇒ 2 CPU.
cpu.weight: 1-10000, CFS shares 静配比例.    软限 (guarantees 最小份额).
```

工程如何选:

- **soft (weight)**: 容器间可以互相 借, 没用就拿所以. 适合 K8s request.
- **hard (max)**: 不能跑超, 量化 fixed 资源. 适合 K8s limit.

K8s `requests.cpu` 配 cpu.weight, `limits.cpu` 配 cpu.max. 这就是 GKE/EKS clone 在容器里 看到的 resource 分配.

## 4. Cpu 迁移 + cgroup cpu.max

把 task 从 cgroup A 迁 cgroup B:

```bash
echo pid > /sys/fs/cgroup/B/cgroup.procs
```

迁移本质是修改 task 的 `cgroup->subsys[]` 指针; CPU 资源调整在 task tick 时重算 vruntime / weight.

cgroup CPU bandwidth control:

```
每次 task_tick: 递减它的 quota;
quota 用完 ⇒ throttled, 放入 throttled-rb, 等下一 period 重新填充 quota;
被 unthrottled 时回到 rq.
```

实测:
- container cpu.max = "1 1" (1 ms / 1 ms) ⇒ 1 个容器节流 → 99% utilization throttled点 single cpu 的 30% 拒绝. **K8s + limit CPU 偶 small 容易 掉到 throttle = P99 worst**.
- 设 cpu.max 时尽量让 quota>=100ms 以避免 catch-effect.

## 5. memory cgroup + OOM

```bash
echo 1G > /sys/fs/cgroup/x/memory.max
cat /sys/fs/cgroup/x/memory.current   # 当前使用
```

cgroup 内存超 memory.max 时, 触发 cgroup OOM killer:

- 选最大 memory 的 root task, kill;
- 不会 panic, 不会杀其他 cgroup 任务.

URL +  OOM 在 container =  排查  ⇒ 位 进程 kill + 应 heap chunked events to detect restartability.

## 6. io 字节级 controller

```
io.max:  "8:16 rbps=50000000 wbps=10000000 riops=200 wiops=200"
        # major:minor + bytes/sec + iops/sec
io.weight: 1-10000 类似 cpu.weight
```

cgroup v2 io controller 是 blk-mq 级; 通过 CFQ-替换 bfq-scheduler 控制 实队列.

> 注意: blk 级 IO controller 在 NVMe 上 (因NVMe 不上 CFQ / BFQ) 走 `blk-iocost` (Linux 5.0+ 配置 cost model). 配置较复杂, 工业大 cluster 一般最好对 IO 加 weight priority.

## 7. cgroup + Pid 隔离

```
echo 1000 > /sys/fs/cgroup/x/pids.max
```

PID 数量限制, 防止容器 fork-bomb. K8s Pod `podPidsLimit` 内部走 cgroup pids.max.

## 8. 多语言 + runtime 起容器

| 语言 | runtime 与 cgroup 是否协调 | 经验 |
|------|--------------------------|------|
| Java | G1 默认会看 cgroup 内存限制 | JDK 11+ ( atol after 11.0.+) |
| Go runtime | GOMAXPROCS 自 1.22 看 cgroup cpu.max | 修复 runtime 能 看到 quota 不 自己 be 默认 ncpu |
| Rust std | 不 let火箭 std 看 cgroup 限于 runtime | 必须 cgroup 静 allow |
| Python | 例如 多 默认不看 | 因 PyPy 内 alloc 是紧 几不错的作为先夏 |
| Node |  V8 默认 max-oldSpace + size 4 GB | 不 默认 + cgroup 需 优 |

特别: `GOMAXPROCS=go1.22+` 才读 cgroup; 早期 Go 看不到 cgroup cpu quota, 你 K8s limit 1 CPU + 但 GOMAXPROCS=64 ⇒ scheduler 充分运行但 throttle 严重, 资源利用率差.

修复 runtime "搞容器感度" 在 2022-2024 时代逐 Gengr成  be more cost friendly 是现代 OS + language 跨层读完.

## 9. K8s 的 cgroup 关系

```
Pod / Container  ⇒  cgroup
requests.cpu=1   ⇒  cgroup.cpu.weight=512
limits.cpu=2     ⇒  cgroup.cpu.max=200000/100000
limits.memory=2G ⇒  cgroup.memory.max=2147483648
```

**Pod 的 cgroup 是从父 QoS 类派生**: BestEffort / Burstable / Guaranteed, K8s 通过 G 父级 cgroup resources 决定是否 OOM (Guaranteed 优先) 防止 best-effort 抢 machine.

## 10. 这一章带走的东西

- cgroup v2 unified ai 主控制器 同层级, 现代 container 行; 
- cpu.max 是 hardlimit硬 资源命. cpu.weight 软限;
- K8s limit 当小 quota +  small period ⇒ potential P99 throttle 避免;
- 自适应工具 kubelet config + cpu + memory + io + 关注 cgroup-adapt runtime;
- 设 / Standalone Go 经济; K8s recomms runtime GOMAXPROCS default `min(ncpu, cpu.max / period)`.

下一节 → [锁与同步原语](../lock/index.html)
