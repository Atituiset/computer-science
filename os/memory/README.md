# 内存

- [虚拟内存与地址翻译](virtual-memory.md)
- [分页、TLB、Huge Page](tlb-hugepage.md)
- [页面置换与 working set](replacement.md)
- [内存分配器：ptmalloc/jemalloc/tcmalloc/mimalloc](allocator.md)
- [NUMA 与 CXL 内存池](numa.md)

> [!NOTE]
> 内存是这台机器上最复杂的一块抽象层级：
> - 进程看到的"内存" 是连续的；
> - 内核看到的"内存" 是页；
> - DRAM 控制器看到的"内存" 是行/列地址；
> - L1 cache 看到的是 cache line；
> - NVM 控制器看到的是 page / sector；
> - NUMA 互连图把 DRAM 看成跨节点。
> 
> 每经过一层抽象都要付一次延迟常数。
