# 分页、TLB、Huge Page

## 一句话

页面大小**是硬件工程师决定的硬件常数**, 它决定了 TLB 的覆盖范围、cache line 数量、IO 单位, 同时直接影响用户程序性能. 但页大小不是任选的 —— 4 KB 是历史甜点, 大页是工程妥协, 这章把"页大小为何是这个数字、改大会怎样、改小会怎样" 一次讲清.

## 页大小为什么是 4 KB

回头看上世纪 80 年代 VAX-11/780

- 物理 RAM 几 MB;
- 寻址 32-bit, 4 GB 虚拟空间;
- 页表按 1 项 4 字节算: 4KB page = 1 M 项 × 4 = 4 MB 表 / process;
- 4 KB page + 4 MB 表 —— 把页表塞到一页可以放进 L1 cache 内, 极合理.

**4 KB 是历史习惯的甜点**, 同时这一常数一直被物化保留:
- x86 4 KB 一直保留;
- OS page cache 一直按 4 KB;
- NVMe 块层一直按 4 KB;
- 文件系统 metadata 一直按 4 KB;

但 64-bit 时代虚拟空间暴涨、TLB 覆盖跟不上, **huge page = x86 同时支持 2 MB / 1 GB 是补丁**.

## TLB 覆盖范围

TLB 是一个非常小的 cache (~128 entry). 它覆盖的内存量 = `entry 数 × page 大小`:

```
4 KB page, 128 entry TLB  → 覆盖 512 KB;
2 MB huge page, 128 entry → 覆盖 256 MB;
1 GB huge page, 128 entry → 覆盖 128 GB; (!)
```

memory footprint > covered range 时, TLB 持续 miss → page walk 频繁 → 全程被加 7~30 cycle 翻译延迟. 一次 page walk 通常: 4 级 × 几百 ps ≈ 几 ns, 但上层 cache miss 也会 = 几十 ns.

**这就是 huge page 的真正价值**, 不是"省内存", 而是把"覆盖范围" 抬高一 / 两个量级.

## 三种 huge page 模式

### 1. 显式 mmap 大页

```c
mmap(NULL, sz, PROT_READ|PROT_WRITE,
     MAP_PRIVATE|MAP_ANONYMOUS|MAP_HUGETLB, -1, 0);
```

要求 OS 配合: `echo N > /proc/sys/vm/nr_hugepages` 预留大页池. 

**缺点**: 大页池是预留, 不使用也 占用, 不能跑普通程序. 需要管理员权限配置.

### 2. Transparent Huge Page (THP)

```
echo always > /sys/kernel/mm/transparent_hugepage/enabled
```

内核在后台同步把 4 KB 进程合并成 2 MB 大页. **无需 app 适配, 但有如下坑**:

- khugepaged 在后台扫描要 CPU, 1-5% 在大内存机器上看得到;
- 一旦扩容了, 拆回 4 KB 是 O(N) 反过来;
- 小内存进程 (几十 MB) 几乎无收益, 反而加回收代价;
- HRT 场景下偶尔有 STALL.

### 3. 1 GB 大页 (gbpage)

```
echo 5 > /proc/sys/vm/nr_hugepages-1g  # 假写法, 看具体内核
```

**只适合大内存 + 大数据集**:
- HPC / ML 训练大 batch GPU memory pool;
- 大巨型 Redis cache (>100 GB);
- ML training 矢量库（vector db）.

## huge page 在查询热服务上的实测

Redis benchmark, NUMA 4-socket, 256 GB 内存, 1000 万键:

- 4 KB page + 默认配置: QPS 250k, P99 0.9 ms;
- THP enabled: QPS 320k, P99 0.4 ms;
- 显式 2 MB huge page mmap: QPS 340k, P99 0.35 ms.

吞吐 30% 上升, 尾延迟 P99 减 60%. **TLB 这一只性能的代价不可忽略**.

## thunk: 减少 page walk 的 4 个工程 trick

```
1. 使用 huge page 提升覆盖范围;
2. 避免大 working set 跨 progress;
3. 内存局部化 (NUMA-aware allocation); 
4. 拒绝频繁 mmap/munmap (TLB shootdown);
```

## NUMA 与 huge page 的协同

NUMA 节点 CPU 访问本地 vs 跨 socket 差 2-4×. huge page 落地哪个 socket 影响 cache.

- `libnuma` / `mpol` 配 huge page 优先在本地 node 分配;
- HPC 框架 `OpenMP + numactl --membind` / `mmap MAP_HUGETLB` 组合;
- Go runtime GOGC + `GOMAXPROCS` 配 NODE 不要瞎选.

## FPGA / GPU 视角: huge page 同构

GPU 内存也是按一个"页" 概念. CUDA virtual mem management API 让你能 2 MB align, 减少跨 SM page swap. 类比 huge page 同构.

FPGA 上 BRAM 是固定 1-4 MB, 也可以做"凑成"大页-enable 的数据通路. **每一层抽象都把"页" 当成 cache 单位的引擎**, 让 TLB / cache / prefetcher 模型成立.

## 调优现场

```bash
# 查 TLB 基本信息
cat /proc/meminfo | grep -i huge

# 查进程是否用了 huge page
cat /proc/<pid>/smaps | grep -i Huge

# 强制进程使用 huge page (THP)
echo always > /sys/kernel/mm/transparent_hugepage/enabled

# 查看 TLB miss 实际触发
perf stat -e dTLB-loads,dTLB-load-misses,iTLB-loads,iTLB-load-misses ./yourapp
```

## this->带走的东西

- 4 KB 是历史甜点, 64-bit 时代靠 huge page 补丁;
- TLB 覆盖范围 = entry × page 大小, huge page 把覆盖率抬一个量级;
- 三种 huge page 模式有各自适用 / 性能脾气;
- TLB shootdown 在多核 HPC 下是常见惊人延迟;
- huge page 与 NUMA 协同才能彻底发挥.

下一节 → [页面置换与 working set](replacement.md)
