# NUMA 与 CXL 内存池

## 一句话

你看过 64 核的服务器跟普通桌面机 CPU 长得一样，**但物理上 64 个核分成 2-8 个 socket，每个 socket 自己独享 1-4 TB 内存，跨 socket 访问那条"QPI/UPI / Infinity Fabric"链要 100-200ns 等 — 比本机内存慢两到四倍**。这就是 NUMA。在 NUMA 机器上跑一个不知道 NUMA 概念的服务（如 Redis），P99 可能比理论值高 3 倍。理解了 NUMA 后，再看 CXL 这种新硬件，本质是"把 NUMA 横向伸到机柜"——同一个抽象在网络层重新物化。

## 1. UMA → NUMA 的物理演进

岁月静好 UMA 模型：

```
所有 CPU 共享一条前端总线 → 同一条 DRAM 总线 → 所有 CPU 看内存延迟一致
```

但当 CPU 核数从 4 → 16 → 64，总线带宽抢不过来了，**必须分簇**：

```
Socket 0: 32 核 + 1 TB DRAM  ─ hyperlink ┘
                                │       ← 100-200 ns cross-socket
Socket 1: 32 核 + 1 TB DRAM  ─ hyperlink ┘
```

每个 socket 自己内存达"近"，跨 socket 远。这就是 **NUMA = Non-Uniform Memory Access**.

## 2. 物理延迟常数表

```
本地 DRAM 访问      80-100 ns
跨 socket UPI      + 100-150 ns
跨 2 跳 NUMA       + 200 ns
HBM (本地 fusion)   50-100 ns
CXL.mem 直连        170-250 ns (新一代 < 200 ns)
RDMA 同机柜         2-5 μs
```

跨 socket 延迟接近**翻倍**——这就是 NUMA 不被知道的代价。

## 3. Linux NUMA 工具入口

```bash
# 查 NUMA 拓扑
numactl --hardware
lscpu = NUMA node(s):
# 一般 1-socket systems: NUMA nodes = 1
# 2-socket servers: 2 NUMA nodes
# AMD Epyc: 4 / 8 NUMA nodes per socket (NPS4)

# 进程当前 NUMA 分布
cat /proc/<pid>/numa_maps
numastat -p <pid>
```

在 SYstemD 里:

```bash
# 启动绑到第一个 node
numactl --cpunodebind=0 --membind=0 ./yourapp

# 或更精细, bind CPU list:
numactl --physcpubind=0-15 --membind=0 ./yourapp
```

## 4. NUMA 调优真实工程模式

### 模式 1：进程隔离

32 核服务器跑两个高内存服务，绑两个 NUMA node：

```bash
numactl --cpunodebind=0 --membind=0 service_a &
numactl --cpunodebind=1 --membind=1 service_b &
```

每个服务仅用本地节点内存，跨 socket 0 次。

### 模式 2：NUMA-aware 分配 libnuma

```
#include <numa.h>
struct bitmask *mask = numa_allocate_nodemask();
numa_bitmask_setbit(mask, 0);
numa_set_membind(mask);
void *p = numa_alloc_onnode(1024*1024, 0);
```

C / C++ 应用直接 libnuma 控制内存位置.

### 模式 3：线程 + CPU 共同绑定

更近一步: 用 pthread_setaffinity_np 把线程粘在 CPU 上, 同时把内存放本地 node. 这个组合通常能拿到 P99 1/3 的延迟下降 — 这一招是高频交易 / 大数据服务的标配.

### 模式 4：avoid remote alloc

Linux 默认 `first-touch` policy: 第一次写入页的 CPU 决定页落在哪. 所以初始化大数组时**写它的线程就决定了它的 NUMA 归属**. 程 service startup 时有个 worker 提前 touch 全部内存, 后面 worker 共享该内存经常跑跨 socket :

```c
#pragma omp parallel for
for (int i = 0; i < N; i++) a[i] = 0;        // 每线程 touch 局部 → 跨 NUMA 拆分
```

**默认 OpenMP 有 first-touch 也是这种语义**. 但手动管理时容易踩坑.

## 5. Redis 案例: NUMA 不知道就 1.5-3× 慢

实验对比 (8-socket 服务器, 200 GB Redis Cache):

- 默认启动 Redis: QPS ~ 220k, P99 ~3 ms;
- numactl → 单 node 绑核: QPS ~ 450k, P99 ~ 1 ms;
- 双 NUMA 分两个 Redis 实例 + 路由: QPS ~ 900k 加起来, P99 ~0.5 ms.

**在不改 Redis 源码的情况下**, 仅用 NUMA 工具拿到的 1.5-3× 加速. 这是工程上"懂得硬件 = 直接升职" 的 Classic.

## 6. 多线程同步原语在 NUMA 下的代价

`pthread_mutex` 不是公平的: 不是 FIFO, 不是 LIFO, **Linux 内核 futex 是 task-fair spinlock, 但 lock handoff across NUMA 拥有时间成本**:

```
同 socket thread 互相抢: ~ 100 ns (L3 hit)+ wakeup;
cross-socket thread 抢: 200-500 ns (UPI latency) + wakeup;
```

NUMA topology-aware spinlock/sh mutex 在 Linux 上叫 `NUMA-aware lock`, 各种 lock ticker 包括 futex 改造能用 `MCS lock`, `TTAS w backoff`, `CNA lock` 之类减少 cross-socket. Linux `qspinlock` 加强 num-aware since 5.x.

业务代码 → 拆线程 → 一致在 socket 内做 sync. SHard data → per-socket storage.

```c
// 反例：
static mutex m;
void run() {
    lock_guard<mutex> g(m);
    ...                                  // 多线程从 2 个 socket 同时进入 = 跨 socket 抢锁
}

// 正例：
per_socket mutex m[N_SOCKETS];
void run(int s) {
    lock_guard<mutex> g(m[s]);
    ...                                  // 同 socket 线程抢同 / 同 socket 锁
}
```

## 7. PGAS / DSM 的历史

把"跨 NUMA 内存" 推到极致就是 DSM (Distributed Shared Memory) — 用网络硬件支持 CPU 远程访问其他机内存. 90 年代 Stanford DASH / Flash (Dash-Flash), MIT Alewife 都是这条路. 但网络延迟微秒级远超 DRAM 纳秒级, 实操成本高, 商业上 JPG.

但 GPU 一脉/CXL 一脉把这条路拖回来了：

- NVLink 4.0 → 400 GB/s GPU-GPU direct peer access;
- CXL 2.0 → CPU ↔ device 一致缓存, host peer memory;
- CXL.mem → 远地 DRAM 当作本地但延迟 ~170-250 ns, 类似 cross-socket NUMA.

## 8. CXL: 在同一台机柜里的 NUMA 延伸

CXL 是基于 PCIe 5 的 cache-coherent 互连协议, 看上去是 NUMA 的延续：

```
传统 NUMA:   CPU A ↔ UPI ↔ CPU B (本地 DRAM)
CXL:         CPU A ↔ CXL.mem ↔ 远端内存池
CXL.cache:   CPU ↔ CXL device (NIC / 加速器) 共享 cache 一致性
```

CXL.mem 让一台 4 TB 内存的服务器把"远端 1 TB 内存池"视为远端 NUMA node 4. ** numa 工具、 `numactl --cpunodebind` 全都直接适用**.

工程意义:
- 内存池化 → 多台 server 共享一个 DRAM pool, 业务 server 内存按需扩 out. 冷启动快几十 GB;
- 持久内存 → 把 PMem/NVDIMM 放到远端;
- 加速器互连 (如 GPU 内存) 借助 CXL 互通, 互访延迟 ms 级 → μs 级.

这个时代从 2024-2025 开始部署最早, GC + Redis + KV 仓库陆续适配. NUMA 知识直接迁移过去.

## 9. NUMA 与分配器的协同

`jemalloc` 内置 NUMA 感知: arena 数 = NUMA nodes × 4, 内部 init 时绑定 arena → node. 这是分配器与 NUMA 同源工程示例:

- arena 0-N 在 Node 0 上 alloc 页;
- arena N-2N 在 Node 1 上 alloc 页;
- thread x → arena hash → 选择本地 node;

这是 NUMA + allocator 的"两个抽象层共同优化 cache 行为" 的同构案例.

## 10. 多语言同一抽象

| 语言 | NUMA 触达 | 备注 |
|------|----------|------|
| C / C++ | libnuma + first-touch | 最底层 |
| Rust | libnuma-bind + jemalloc | 高度可定制 |
| Go | runtime.LockOSThread + cgo libnuma | 没有 first-touch 自动 |
| Java | `-XX:+UseNUMA` + JEP 369 (Hotspot, GCCore) | JVM 把 heap per node |
| Python | 多进程 + numactl | 默认单核绑核 |

所有语言在 NUMA 机器上都有办法适配, 但需要**显式配置, 否则默认行为不 NUMA-aware**.

## 11. 这章带走的东西

- NUMA 是 multi-socket 服务器的常态, 默认行为不优化, 跨 socket 延迟翻 2-4×;
- 思维: 同 socket 内 才应该共享 data / lock; 跨 socket 用分多实例 / partition / NUMA-aware 数据结构
- 工具链: numactl + libnuma + numastat 直接可用, 不需修改 language runtime;
- CXL 是 NUMA 互连在网络层扩展, 同抽象可拓到机柜级;
- allocator (jemalloc) 内嵌 NUMA arena 是 OS 层 + 运行时层共同优化的同构示例.

下一节 → [文件系统](../fs/index.html)
