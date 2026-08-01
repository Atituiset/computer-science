# 内存分配器：ptmalloc / jemalloc / tcmalloc / mimalloc

## 一句话

`malloc(64)` 这行代码，你以为是 OS 给你 64 字节。**不是。** 它实际是从用户态一段叫做 arena 的虚拟地址块里切下一个 64 字节的"运行时管理单元"，OS 在 99% 的情况下根本没被惊动。这一章把四个主流分配器拆到底层，让你看清 `malloc` 背后的 fast path / slow path / size class / slab / 线程 cache / 大页对齐，最后你会发现：**分配器是 OS 在你程序里偷偷延伸的二级 cache**。

## 1. 为什么必须有用户态分配器

OS 给你分配内存的两个 syscall 是 `brk` 和 `mmap`，最小粒度都是页 (4 KB)。如果你每次 malloc 64B 都向 OS 要一页：

- 1 GB 申请要 262144 次 syscall = ~26M cycle；
- 地址空间被切成 524288 个 4 KB 不可回收碎片；
- page fault 触发再 + 再 1 倍延迟。

**这根本不工程可行**。所以每个语言运行时都有自己的"用户态分配器"，在已映射的页上自己切片，OS 只看"页的进出"，看不到字节进出。

这就引出一个分层抽象：

```
用户代码:   malloc(64)
   ↓
语言运行时 (ptmalloc / jemalloc / glibc): 在 arena 内切 64B
   ↓
OS syscalls (brk/mmap/munmap): 按页申请 / 释放
   ↓
memory controller 按页映射到 DRAM row/col
```

每跨层都付出一次"页" 大小的代价. 所以 **分配器的核心职责是减少 syscall 次数 + 减少 cache miss + 减少碎片**——这就是为什么它是 OS 在用户态的二级 cache。

## 2. 分配器要解决的三件事

不管哪个分配器，都要同时回答这三个问题：

1. **快路径**：常态 `malloc(n)` 必须几 ns 内返回——基本是 thread local cache 命中;
2. **碎片控制**：长期跑不能把堆越分越碎，让 2 GB 进程吃成 4 GB 虚拟;
3. **多核伸缩**：多线程竞争不能让吞吐降级——必须 thread-local 优先，central path 兜底.

整本书里反复出现的"摊还 vs 最坏"和"thread-local vs 共享"在分配器里**完美同构**。

## 3. size class：分配器的核心数据结构

`malloc(n)` 总要选一种合理大小返回。但你不能为每个 n 维护一个独立的"空闲链"——会爆炸。所以主流分配器都先做 **size class** 分桶：

```
size class:    8, 16, 32, 48, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 640, 768, 896, 1024, ... 
直到 page run 上限 (~32 KB)
```

> [!NOTE]
> size class 不是完全等比增长的，是经过实测后调出来的工程最佳值——确保每种 class 的对齐 / 滑动损耗 < 12.5%。tcmalloc 用了 80 多个 class，jemalloc 的 psizes[][] 表是编译期常量数。

举几个例子：

- `malloc(7)` → 8 字节 class
- `malloc(13)` → 16 字节 class
- `malloc(48)` → 48 字节 class
- `malloc(50)` → 64 字节 class

所有权 class 决定你实际花掉 8/16/64 字节之一——这就是"分配内的内碎片"——internal fragmentation。**好的 size class 表让平均浪费 < 12%**.

## 4. Slab / page / run / heap：四层结构

主流分配器结构都长这样：

```
heap        ─── 给某个线程 / CPU
 ↓
arena       ─── 一个 slab 群组, 共享给多个 threads
 ↓
page run    ─── 一组连续 page, 整体属于某一个 size class
 ↓
slot        ─── 一次 TLB 友好切出的实际用 chunk
```

每个分配器的命名略不同 (thread cache 是 tc / slab 是 run / span 是 page run)，但抽象同源。

## 5. ptmalloc (glibc)

业内最广用、也是最被诟病的分配器。原理是 Doug Lea 的 dlmalloc 加 Intel 维护的多线程 arena 扩展。

### 结构

- arena: 一个全局 + 多线程用 thread arena;
- chunk 头部 16/32 字节 (size + flags + prev size);
- 主交付 path: bins——按 size 组织的链表 / tree。
- thread cache (tcache) 自 2.26 加入，单线程情况极大改善。

### 实测痛点

- chunk header 8 B / 16 B, 小对象的 overhead 25%~50%;
- arena 间锁争激烈，多核 32-core 机器上 malloc contention 常被 flamegraph 看到;
- mmap 上界 128 KB，超过则直接走 mmap;
- free 后做 merge 是"立即合并"，与传统 TCMalloc 倾向"central cache returned" 不同。

实际项目中 Go runtime / Java / Rust 不用 ptmalloc 是这个原因。C++ 写后端如果用 libstdc++ + ptmalloc 默认栈，高 QPS 服务 P99 经常掉。直接换 jemalloc 或 mimalloc 是工程"一行 LD_PRELOAD"。

## 6. tcmalloc (Google)

Google 内部写来变的分配器，给所有第一方 Google 服务用。核心两点：

### thread cache (TC)

- 每 CPU (实际上是每线程) 持有独立 cache，命中走 O(1) 无锁;
- 多线程 malloc 之间几乎零竞争。

### central free list + span

- thread cache 上限到了就 batch 归还;
- central 维护 page heap + 由 spans (一个 page run) 组成;
- 大对象直接 mmap + 一次 size-to-heap lookup.

**整体结构是 per-thread TC + 中央 page heap**：现在也是 prometheus / envoy 等基础设施默认走的 (链接 tcmalloc_minimal).

## 7. jemalloc (Facebook, FreeBSD)

Facebook 给 Redis / jemalloc 默认, 如果 Linux 用户 apt 装 redis-server 默认就用 jemalloc. 整体建模差异：

### 三级 cache: TC → cache → arena

```
线程本地 tcache: 8B-32KB 的小对象，存现成的 slab 槽位;
tcache 满则归还到 arena-level cache;
arena 持有 extents (page runs) 集群;
atop: huge page / mmap/purge madvise.
```

### extent / run / arena

- **arena 数**默认 = 4 × ncpu，希望线程通过 thread hash 接到不同 arena，避免同一 arena 锁链路;
- **extent** 是逻辑 page run, 在活跃与空闲之间转移;
- **purge** 通过 `MADV_DONTNEED` 主动归还 OS, 减少内存长尾增长.

### 实测优势

- 小对象分配高峰极快（TC ~ 10 ns）;
- arena 数大，多线程 contention 远低于 ptmalloc;
- 短期 / 长期均衡, 碎片率 < 5%.

这就是为什么 Redis、Rust std 编译默认 jemalloc / mimalloc 二选一，业务上 high QPS 服务**默认建议替换 glibc 的 ptmalloc**.

## 8. mimalloc (Microsoft)

更现代的版本。和 tcmalloc 类似但减少一些 tradeoff：

- 每 CPU 而不是每线程 cache (减少 GC pause + 减少 reset thread state);
- segmented heaps (便于 massively parallel GC);
- low-fragmentation 算法基于"延迟合并 free"——deferred merging is similar to LFU local 防抖.

mimalloc 在 C / C++ 大量 short-lived allocation 上实测比 ptmalloc 快 7×, 比 jemalloc 快 1.5×. Rust 1.7+ 把 jemalloc 改成 mimalloc 模型 (具体视平台).

## 9. Rust 与 Go 的运行时自实现

Rust / Go 不用 glibc 的 malloc. 它们自己写了分配器.

### Rust

- 把分配器作为 trait `Alloc`，全局 `#[global_allocator]` 可替换;
- 标准的 `System allocator` 是 malloc (e.g., libc 还是 ptmalloc;
- 实战推荐链接 `jemalloc-sys` 或 `mimalloc` 作为 global allocator;
- 这是 rust-lang / Firefox / Linux 性能改造的第一步.

### Go runtime

- runtime 自己写 allocator, mlockless + tcmalloc 风格 TC + central;
- 每 P 都有一个 mcache, 每 P 加一个 mcentral;
- 大对象 (large > 32KB) 直接 mmap + central heap;
- GC 后 mark phase + sweep phase，sweep 时实际 free;
- 在 stop-the-world (STW) 边界看像 read-only scan.

Go 实际上把自己和别人都搞到自己 runtime 里 —— allocator + GC + 协程栈一起做调度. 简化程序员心智的同时, GC pause 上的工程一长尾常见痛点.

## 10. fragmentation：内部 / 外部

碎片是 allocator 失败的本质结果. 两种:

- **Internal frag**: size class 把 n 字节进给 16 字节一边际, 浪费的几 B;
- **External frag**: 已 free 的 chunk 不连续, 64 MB 总 free 但 1 MB 连续段切不出来.

外部碎片是**长期内存增长的主因**. 举例: 业务不停申请不同大小 16/24/40/8 malloc 后, 大 free 后处理时合并 algorithm **but** 周围仍然在使用, 导致一个 internal 大块没法回收. 主流缓解:

- arena 分 bin sized, 同 size 集中同一 bin 形成线性可回收 (tcmalloc 思路);
- 用 page split / coalesce by size class (jemalloc, mimalloc);
- indirect_addr 让 free immediately defered 到 GC metaphore (Rust 的 mimalloc).

## 11. 大页与分配器协同

在 huge page 开了后, 分配器都应该 page-aligned 2 MB malloc 给 huge page friend. 没做就导致 huge page fragmentation:

- 4 KB 的 page 在 1 GB 级别 alloc, 中间被 OS swap-out 一些 → 启 1 GB huge page segment across mess.
- 

jemalloc 启用 `--with-lg-page=21` 编译, 1 GB huge page (`MADV_HUGEPAGE`) 是工程最佳实践.

## 12. 调优现场

```bash
# perf record arena contention
perf record -e cache-misses,context-switches ./程序

# 分配器行为 trace
export MALLOC_CONF="stats_print:true,lg_sample:19"
./程序 1>/dev/null  # 程序退出时 jemalloc 输出 layout 报告

# C 临时替换:
LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libjemalloc.so ./your_app
```

## 13. 多语言同一抽象

把 OS allocator 与语言 runtime GC 抽象同源:

| 语言 | 用户态分配器 | 默认 / 推荐 |
|------|-------------|-------------|
| C     | ptmalloc (glibc) | LD_PRELOAD jemalloc/mimalloc |
| C++   | 同上 | 同上 |
| Rust  | std::alloc::System (默认 malloc) | web 通常替换为 mimalloc/jemalloc |
| Go    | runtime 全自实现 GC 整合 | 不能换 |
| Java   | JVM 内嵌 allocator, TLAB per-thread | G1/ZGC/Shenandoah |
| Python | pymalloc + PyObject arena | 不能换 |
| V8 (JS) | V8 Heap 持有 = 分代 GC |

所有现代语言的分配器都用 thread-local cache / size class / 中央 page heap 这同构骨架. 区别只是"是否带 GC + GC pause". 这就是 DSA 的"摊还 vs 最坏" 在工程层**又一次同构**.

## 14. 这章带走的东西

- `malloc` 是由用户态分配器决定的, 不是 sys 调用;
- size class 是分配器"短小 + 内碎片可控" 的核心数据结构;
- tcmalloc / jemalloc / mimalloc 共通形态: TC → central → page heap;
- arena 数多 + thread cache 是平s-sp-2 thrashing anti-contention 的关键;
- 业务 high QPS 服务**第一线优化**就是替换 ptmalloc → jemalloc/mimalloc;
- 与运行时 GC 配合看到是同构, "摊还 + thread-local" 是同一抽象在分配器 / GC 中的不同物化.

下一节 → [NUMA 与 CXL 内存池](numa.md)
