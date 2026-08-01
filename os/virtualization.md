# 虚拟化与容器: VM / KVM / namespaces / gVisor

## TL;DR

"一台物理机跑多个隔离的 OS"和"一个内核跑多个隔离的应用"是两个不同的问题。**虚拟机**（VM）用 hypervisor 虚拟出完整硬件（CPU/内存/设备），客户机里跑独立内核；**容器**不虚拟硬件，只复用宿主机内核 + 用 **namespaces** 隔离视图 + **cgroups** 限制资源。这一章把 KVM 的 CPU/内存虚拟化原理（VT-x、EPT）、设备虚拟化（virtio、SR-IOV）、容器的隔离边界（为什么 namespaces 挡不住内核漏洞）、以及 gVisor/Kata/Firecracker 这些"安全容器"的取舍讲透。

读完应能：
1. 说清 trap-and-emulate 为什么行不通，VT-x/AMD-V 的 VMX root/non-root 模式怎么解决。
2. 解释 EPT（二级页表）让"虚拟机内存"不经过软件影子页表的原理，以及为什么 EPT 下 MMIO 要特殊处理。
3. 说出容器隔离的是"视图"不是"资源边界"：namespaces 管什么、cgroups 管什么、共享内核的逃逸面在哪。
4. 对比 gVisor（用户态内核）vs Kata/Firecracker（微型 VM）vs 普通容器在不同威胁模型下的取舍。
5. 在 K8s 场景说出"什么时候必须上 VM 级隔离（多租户/不可信负载），什么时候容器够了（可信负载）"。

---

## 一、虚拟化要解决的三个问题

1. **隔离**：故障/攻击不能跨租户传播；
2. **复用**：物理资源（CPU 核、内存、带宽）在多个租户间弹性分配；
3. **迁移**：工作负载与硬件解耦，可热迁移。

三条路线的隔离强度递减、密度递增：

| | 隔离强度 | 密度/开销 | 典型 |
|---|---|---|---|
| 裸机 | 最强 | 最低 | 物理机独享 |
| 虚拟机 | 强（独立内核） | 中（每 VM 一个内核） | 云主机、Kata/Firecracker |
| 容器 | 弱（共享内核） | 高 | 微服务、Serverless |

## 二、CPU 虚拟化: 从 trap-and-emulate 到硬件辅助

### 2.1 朴素思路为什么不行

让客户 OS 直接跑在 CPU 上，遇到特权指令时陷入 hypervisor（trap-and-emulate）。问题：x86 有约 17 条**敏感但不特权**的指令（如 `POPF`、`SGDT`），在低特权级下不触发陷阱、行为却和裸机不同——客户 OS 会静默出错。这是 x86 虚拟化的历史难题，直到 2005-2006 年 **Intel VT-x / AMD-V** 在硬件上解决。

### 2.2 VT-x: 两种模式

```
VMX root (hypervisor 跑这里)     VMX non-root (客户 OS 跑这里)
        ▲                                    │
        │ VM exit (特权操作/中断/异常)        │
        └────────────────────────────────────┘
        VM entry (resume)
```

- 客户 OS 运行在 **non-root** 模式，特权操作（`CPUID`、`WRMSR`、`HLT`、访问 CR3 等）**自动 VM exit** 回 hypervisor；
- 用 **VMCS（VM Control Structure）** 描述每次 exit 的原因和 guest 状态，exit 后 hypervisor 处理完再 VM entry；
- 频繁 exit 很贵（几千 cycles），所以 KVM 会**让大部分中断直接注入客户机**，只有必要事件才 exit。

### 2.3 中断虚拟化

- 物理中断由宿主内核收，KVM 把它**注入** guest（`vmcs` 的 event injection）；
- APICv / posted interrupts：物理中断直接投递到正在跑 guest 的 vCPU，**不 exit**——这是高 IO 虚拟机的关键优化。

## 三、内存虚拟化: 影子页表 → EPT

客户机认为自己在管物理内存，但那是"客户物理地址（GPA）"，还要再映射到宿主的"机器物理地址（HPA）"。早期做法是**影子页表**：hypervisor 维护一份"客户虚拟地址 → 宿主物理地址"的页表，guest 每次改 CR3/页表都要 exit 同步——开销大、实现复杂。

硬件辅助（**EPT**，AMD 叫 NPT）：

```
客户虚拟地址 GVA ──guest 页表──► 客户物理地址 GPA
                                    └─EPT 页表──► 宿主物理地址 HPA
```

- 客户机照常管理自己的页表，**不需要 exit**；CPU 硬件自动走两级页表翻译；
- 代价是 TLB 需要同时缓存两级翻译（EPT 使 TLB miss 变贵），所以有 `ept` + `VPID`（虚拟处理器 ID，避免切换 vCPU 时刷 TLB）。

> [!WARNING]
> EPT 不是免费的：两级翻译的 TLB miss 开销比裸机高。大数据集虚拟机（如 Redis 类大页内存）要配合 **HugeTLB/hugepages**，否则页表遍历会吃掉可观的 CPU。

## 四、设备虚拟化: 全虚拟 → virtio → SR-IOV

| 方案 | 原理 | 性能 | 使用 |
|---|---|---|---|
| **软件模拟**（QEMU 模拟网卡/磁盘） | 每个 IO 都 exit + 模拟寄存器 | 低 | 兼容性兜底 |
| **virtio** | 前端驱动 + 共享环形队列，hypervisor 批量处理描述符 | 中高 | 云主机默认 |
| **SR-IOV**（VF 直通） | 物理网卡切成多个虚拟功能，guest 直接 DMA | 最高 | 高性能网络/存储 |
| **VFIO/直通**（GPU/NVMe） | 整个物理设备给一个 guest | 最高 | GPU 透传、NFV |

virtio 的关键是**减少 exit**：guest 驱动把一批 IO 描述符放进共享内存的 virtqueue，hypervisor（vhost）批量消费，一次 kick 处理一批。`vhost` 把 virtqueue 处理搬进宿主内核，进一步避免每次退出用户态。

## 五、容器: 不是虚拟化，是"切视图"

容器共享宿主内核，靠两套内核机制：

### 5.1 namespaces: 隔离"我看到什么"

| namespace | 隔离内容 | 安全含义 |
|---|---|---|
| PID | 进程号（容器内 PID 1 = 容器主进程） | 看不到其他容器的进程 |
| Mount | 挂载点视图 | 配合 chroot/pivot_root 限制文件系统 |
| Network | 网卡/IP/路由/防火墙 | 每个容器独立网络栈 |
| UTS | hostname | — |
| IPC | SysV/Posix 消息队列 | — |
| User | UID/GID 映射（root 在容器内 ≠ 宿主 root） | 非特权容器关键 |
| Cgroup | 资源视图（`/sys/fs/cgroup` 只读呈现自己） | — |

### 5.2 cgroups: 限制"我能用多少"

v2 的控制器：

```
cpu.max     = 配额 (比如 2 核 / 4 核共享)
memory.max  = 内存上限 (超限 OOM-kill 容器内进程)
io.max      = 磁盘带宽/IOPS
pids.max    = 进程数
```

### 5.3 隔离 ≠ 安全边界

namespaces/cgroups 是**内核对象视图的分隔**，不是内核自身的安全边界：

- 容器内 `unshare`/mount 操作仍受宿主内核控制，**内核漏洞（如 Dirty Pipe、OverlayFS 提权）可跨容器**；
- 共享宿主内核 = 共享崩溃域：宿主 OOM 可能波及所有容器；
- 特权容器（`--privileged`、挂载 `/proc`、宿主机 PID namespace）等于放弃隔离。

> [!WARNING]
> 容器默认的 root 在 User namespace 未启用时就是宿主 UID 0（只是视野受限）。**多租户场景绝不能用普通 Docker 容器承载不可信代码**；单租户/可信负载（自己的微服务）容器隔离足够，这是云厂商与自用 K8s 的分水岭。

## 六、安全容器: 把 VM 的隔离拿回来

| 方案 | 原理 | 代价 | 场景 |
|---|---|---|---|
| **gVisor**（Google） | 在用户态实现一个"应用内核"（Sentry），系统调用被拦截翻译 | 兼容性差（部分 syscall 不支持）、性能损耗 | 不可信但偏 CPU 的代码 |
| **Kata Containers** | 每个容器 = 一个微型 VM（QEMU/cloud-hypervisor + 轻量内核） | VM 开销、启动慢 | 多租户强隔离 |
| **Firecracker**（AWS） | 极简微 VM，砍掉 BIOS/ACPI，内存 5MB 起 | 设备支持少 | Lambda/Fargate 的沙箱底座 |

选型逻辑：

```
可信负载(自研微服务)        → 普通容器 (namespaces+cgroups)
半可信(第三方二进制/插件)    → gVisor 或 Kata
不可信(多租户代码/公共函数)  → Firecracker/Kata + 严格网络策略
```

## 七、云上工程实践

- **KVM + QEMU 是 Linux 虚拟化事实标准**；libvirt/OpenStack 之上，云厂商再套一层 SR-IOV/DPDK 网络；
- K8s 运行时三层：`runc`（普通容器）→ `containerd-shim`（Kata）→ Firecracker（Fargate 类）；
- 热迁移的前提是**共享存储 + CPU 特性掩码一致**（否则迁移后 CPU 指令集漂移崩溃）；
- 超卖纪律：`memory` 超卖会触发宿主 swap/OOM 抖动，CPU 超卖要配 cgroup 配额而非放任抢；
- 排查顺序：guest 慢先看 **steal time**（`/proc/stat` 的 st），宿主 CPU 争抢直接体现在 st 上——这是"云上延迟毛刺"的第一现场。

## 八、一页速查

```
VM:     独立内核, hypervisor 虚拟 CPU(VMCS)/内存(EPT)/设备(virtio,SR-IOV)
KVM:    内核态 hypervisor, 客户 OS = non-root 模式, 中断注入/APICv
容器:   namespaces(视图) + cgroups(资源), 共享内核 → 不是安全边界
逃逸面: 内核漏洞 / 特权容器 / 共享崩溃域
安全容器: gVisor(用户态内核) / Kata(微型VM) / Firecracker(微VM)
运维:    steal time 查宿主争抢 / 大页配 EPT / 热迁移要特征掩码一致
```

下一篇: [锁与同步原语](lock/index.html)。
