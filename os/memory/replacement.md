# 页面置换与 working set

## 一句话

物理 RAM 比 disk 大、但不是无限. 一旦进程需求量超过物理内存, 必须把不活跃的页 swap 到 disk. **选哪页淘汰决定了"无限工作负载"下的有效吞吐和尾延迟**. 这一章讲 LRU/LFU/ARC、working set 假说和 Linux 内核的 actual active list 机制——你会发现 DSA cache 章节里的 LRU/ARC 在 OS 层重新长出来.

## 工作集 working set 假说

Denning 1968 提出: 

> 每个程序在时间 t 内访问的页面集合 W(t, Δ) 决定它能否常驻物理内存而不被 swap 频繁打扰.

直觉:
- W 大 → 太多页竞争物理内存, 必然 thrashing;
- W 小 → 程序在自己的话空间里跑得很好.

**90% 的"内存 thrashing" 都是 W > 物理内存**. 这事单堆更物理 RAM 解决, 软件优化代码也会减少 W (e.g. 把循环重排到 row-major, 把指针跳改成数组扫描).

## LRU 选页

经典 LRU: 维护"最近访问时间 t", 选淘汰 t 最小者.

- 优势: 通用, 多数负载下接近最优;
- 问题: **被一次性扫过的 cold data 会把热点洗掉**.

这是 OS 内核 cache 的老问题. Linux 内核的 page cache 通过 `active` / `inactive` 两张链表 + 第二次机会算法减缓这种污染.

## Linux 内核的"双链表第二次机会"

```
所有可回收 page 在 inactive 或 active 链表上:

  inactive 双链表 ← 多数新页
  ↓ 第二次访问 with referenced bit
  active 双链表 ← 热点页
  ↓ 内存压力时 move down
  inactive → 由回收线程 scan 决定是否踢出
```

**"第二次机会"**: 一次性扫描的 cold 页访问 first time → inactive 但 (在 cache 上) referenced bit 置, 但仍然 inactive; 第二次访问才 active. 这让"扫一遍大数据" 不会污染 active 列表.

这个模型优化点: **让热点更难进**, **让冷点更易被踢**. `mm/vmscan.c` 的复杂度很高, 因为它要适应各种工作负载.

### 多代 LRU (MGLRU): 6.1+ 的新答案

active/inactive 双链表在大内存机器上暴露两个问题: 链表操作要拿全局锁 (跨 NUMA 扩展差), 且"只看最近一次访问"无法区分"一分钟前"和"一小时前"的冷度。Linux 6.1 合入的 **MGLRU (multi-gen LRU)** 把页按访问时间分到多个"代"(generation), 用**访问位 + 时间分桶**近似 LFU:

```text
generation n (最老/最冷) ← ... ← generation 0 (最新)
回收从最老的 generation 开始扫; 页被再访问则晋升到新 generation
```

- 每个 generation 是一次"批量老化", 链表遍历换成世代轮转, 锁竞争和扫描开销都下降;
- 对"流式扫描污染热点"的防护由分代自然获得——一次性扫过的页留在同一代里被优先回收;
- Chrome OS / Android 上为低内存设备设计, 后进入服务器内核; 开关 `/sys/kernel/mm/lru_gen/enabled`.

工程含义: 调优老文章里的 `swappiness` 单旋钮之外, 现在还要知道 MGLRU 是否启用——两者的回收行为差异足以改变 P99 表现。

## LRU 派生变种比较

| 算法 | 思想 | 问题 | 实际用法 |
|------|------|------|---------|
| LRU | 最近最久未用 | 扫一遍污染热点 | Linux page cache baseline |
| LFU | 最少使用频次 | 老 hot 永不出去 | 一般结合 LRU |
| ARC (Adaptive Replacement Cache) | 维护 LRU+LFU 双链表 | 实现复杂 | ZFS, IBM DB2 |
| LRU-K | 根据过去 K 次访问时刻 | K 选择 | Postgres buffer |
| W-TinyLFU | LRU + 频次窗口分级 | 实现复杂 | Caffeine (Java) |

Linux 内核大致是 "LRU + 第二次机会 + 频次 hint"; Postgres buffer 采用 Clock sweep (LRU-K 的简化); Java Caffeine 用 W-TinyLFU.

**这部分 DSA cache 章节也是同构**: cache replacement 算法在 OS、DB、应用层、CDN 反复出现.

## swap 与 anon page

Linux 页分两类:

1. **Anon (匿名)页**: stack/heap 这类没有文件后备的内存, 回收必须写入 swap 分区/文件;
2. **File-backed 页**: mmap 出来的文件内容, 直接丢弃 → 下次访问再从文件拉.

file-backed page 比 anon page 回收更快 (干净页直接丢弃即可, 无需写 swap). 写 workload 持续 fsync 时, page 走 clean → dirty → writeback; dirty 积压太多会逼 kswapd 高速运转, 回收路径上的锁与 IO 直接打穿 P99 尾延迟。

## thrashing 监测

```
vmstat 1
watch cat /proc/vmstat | grep 'pgsteal\|pgscan'

# 真实 working set size 测
sar -B 1   # 看 pgscank/s, pgscand/s, pgsteal/s
```

`pgsteal` 增加 = 在淘汰; `pgscank` 增加 = 在扫 active list.

## page reclaim 与"水线"

Linux 内核维护三道水线 (`/proc/sys/vm/min_free_kbytes` 等):

```
high water  ─ ─ ─  ────  free < high → kswapd 启动 pre-clean
low water   ─ ─ ─  ────  free < low  → kswapd 进入忙碌
min water   ─ ─ ─  ────  free < min  → 任何分配都直接同步回收
```

direct reclaim = 进程自己牺牲 CPU 做回收, 损失 P99. **避免 direct reclaim 是高 QPS 服务的关键技巧**: 用 cgroup limit mem + 提前 warning / overcommit_ratio 合理配置.

## 这章带走的东西

- working set 是软件特性, 让 OS 减低它的 W 是工程爆发点之一;
- LRU / LFU / ARC 在 OS / DB / CDN 都同构;
- Linux 内核 second-chance 是 LRU+hint;
- 双链表 active/inactive 减少 cold-scan 污染;
- avoid direct reclaim 是高 QPS 服务 P99 友好的硬指标.

下一节 → [内存分配器 ptmalloc/jemalloc/tcmalloc/mimalloc](allocator.md)
