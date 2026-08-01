# 虚拟内存与地址翻译

## 一句话

你不是直接写 RAM——你写的地址是进程的"虚拟地址"。从 `mov rax, [0x7ffe]` 到 DRAM chip 收到字节，要经过 **MMU + 页表 + TLB + cache + memory controller + DRAM row activate + column** 这几层抽象。每跨一层都加一个常数。这一章把翻译链拆开，让你看到 `mov` 这一句汇编后面到底经历了什么。

## 虚拟地址到底"虚拟"什么

进程地址空间是 OS 给的"幻觉"：

```
进程 A：
  0x0000-0x7fff 代码 + 数据 + 堆
  0x7ffe-0x8000 栈

进程 B：
  0x0000-0x7fff 代码 + 数据 + 堆
  0x7ffe-0x8000 栈
```

两个进程都用 0x400000，独立，互不见对方的内存。**这是虚拟内存唯一目的：进程隔离 + 让程序以为自己独占机器**。

实现上靠 Page Table：

```
进程虚拟地址 0x7fec_1234
        ↓
    [页表映射]
        ↓
   物理页帧号 + 页内偏移
        ↓
       DRAM 地址
```

每条 `mov` 都要 MMU 走一遍页表翻译——如果不缓存就一次翻译要 5 次内存读，IO 拖到几百 ns，CPU 跑不动。这就是为什么 TLB 是 MMU 必备的缓存。

## 地址翻译链路

```
虚拟地址 (VA)
  = VPN(高 bit)  + PageOffset(低 12 bit, 4 KB page)
        ↓
[ L1 TLB → L2 TLB → Page table walk ]
        ↓
物理页帧号 (PFN)
        ↓
PA = PFN · PAGE_SIZE + PageOffset
        ↓
[ L1 cache → L2/L3 → DRAM ]
```

每一步都"可能 miss"。TLB miss 称"地址翻译 stall"；cache miss 称"data stall"。一次访存 if 都 miss 可能 100-200 ns. CPU 看到的 `mov rax, [x]` 这种简单操作在最坏情形可消耗 200 倍 cycle.

## 三级/四级页表的真正原因

页表本身大；按 ridged 32-bit 系统：

- 4 KB page × 32-bit 虚拟地址 = 2^20 个 page = 1 M entry × 8B = 8 MB / proc

**进程 4 GB 虚拟空间页表全表 = 8 MB. 一个 64 GB 内存机器最多跑 8192 个 4GB 进程就炸**——还是没算 OS 自己内存. 这就是"flat page table 不行".

多级页表的核心思想: **未使用的虚拟地址范围不需在内存里建中间节点**.

64-bit x86 long mode 使用 4 级页表 (CR3 + 4 · 9-bit index，每级 512 项):

```
9 bit  9 bit  9 bit  9 bit  12 bit
PML4   PDPT   PD     PT     Page offset
```

5-level paging (LA57) 加一级 + 9 bit = 支持 57 bit VA.

中间表项不存在就直接 "page fault"——不分配 page. 这让一个进程的页表绝大多数并未物化. **这是多级页表的"课"：稀疏内容的物化使用"懒"的精神**.

类比 DSA：B 树与多级页表的根同源 —— **i级索引稀疏, leaf 真物理**. 这就是分隔中大幅降低空间复杂度的同一思想。

## TLB: 把"翻译本身"也加 cache

CPU 内部 L1/L2 TLB 缓存最近几条 VA→PA 翻译：

- L1 DTLB: 64-128 entry, ~1 cycle 全命中
- L2 STLB (shared TLB): 1K-4K entry, ~7 cycle
- OS 上下文切换时 invalidate 整个 TLB（旧架构）

5-level LA57 后, working set 翻译加深的概率大幅上升 —— **TLB miss 已经不再是 small CPU 内部常数**, 而是内存级 (几十 ns) 浪费. 现代 Intel CPU 把 TLB 全部 keep in L2/L3 一致, "process-context id (PCID)" 让切换时不 invalidate TLB —— 节省 1-3% 系统时间.

## 虚拟内存的 5 个 ease 用

1. **进程隔离**: 每个进程独立 VA.
2. **懒载入**: `mmap` 后不实际加载, 真用时 page fault 触发 IO.
3. **COW (copy-on-write)**: `fork()` 不复制整个父进程内存, 只把所有页标 readonly, 写时再复制.
4. **swap**: 内存压力大时把不活跃页换到磁盘.
5. **mmap files**: 把文件按页映射到虚拟空间, "读文件" = 读内存.

每一个 ease 用都是"懒 + cache" 的同一抽象: 实际上不立即做事，等真触发了再做。

## 性能上要关心的事

### TLB shootdown 的代价

当某个进程页表项被修改（如 munmap、用户主动改保护位），所有可能持有这条 TLB 项的 CPU 都要 invalidate. 这是 IPI (inter-processor interrupt)，**单机下微秒级**, 在 100 核机器上 shootdown 可达 50+ μs.

解决方案：
- PCID: 减少跨进程切换全 invalidate;
- Lazy shootdown: 延迟到该 CPU 再次访问;
- 大页 / huge page: 减少需要缓存的 TLB 项数量。

### 大页的对比

```
4 KB page、1 GB 内存 = 2^18 个 page.
1 GB huge page、1 GB = 1 个 page.
```

TLB 容量小但 huge page 占一项就 hardware 抑制了 1 GB. **hotspot 应用开 huge page 通常 P99 抖动立刻降 30-50%**。但需要注意 huge page 容易 fragment，不建议完全 global 启用。

## 调试技巧

```
检查别墅页表 (PID=1234)
cat /proc/1234/maps              # 用户态 VA 布局
pmap -x 1234                     # 进程内存布局
sudo cat /proc/1234/smaps        # 每段 VMA 详情
```

```
检查 page table walk 性能
perf stat -e page-faults,minor-faults,major-faults ./yourapp
perf stat -e dTLB-load-misses,iTLB-load-misses ./yourapp
```

## 这章带走的东西

- 虚拟内存 = 进程隔离 + 懒加载 + COW + swap + mmap 五件套;
- 4 级页表 = 用稀疏内容让物化内存变小;
- TLB miss 是常被忽略的性能杀手, huge page 是工程上 mitigations;
- 一次 `mov rax,[0x7ffe]` 最坏 200+ cycle, 因为翻译通路要全走一遍;
- /proc/<pid>/{maps,smaps} 是入口起点.

下一节 → [分页、TLB、Huge Page](tlb-hugepage.md)
