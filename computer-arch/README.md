# 第八部分 · 计算机组成原理

## 一句话

**计算机组成原理** 是软件工程师的第二语言——理解 CPU 流水线、缓存一致性协议、GPU SM/warp、HBM、NVLink、TPU 脉动阵列之后，你写的代码才能真正"touch metal"。所有第一部分到第七部分的高层抽象最终都 bind 到硬件：B+ tree 的 page 大小 16KB 是因为 x86 页表粒度为 4KB、SSD 擦除块是 16KB；LSM-tree 的 compaction 必须考虑 DRAM 带宽和 SSD 写入放大；分布式系统的 fsync 延迟上限取决于 NVMe 控制器 NAND 写延迟。

## 思想链

```
[SQL Query]
  └─> B+ tree index lookup → 2-3 level page read
      └─> OS page cache / shared_buffers check
           └─> If miss: NVMe SSD read → NAND flash read
                 └─> SSD controller → PHY → PCIe lane → CPU cache
                      └─> CPU L1 cache hit (1ns) → compute result

[Training loop: GPT model]
  └─> NVIDIA H100: matmul on Tensor Core (989 TFLOPS FP8)
       └─> Warp scheduler: 32 threads / warp, 64 warps / SM
            └─> Shared memory async copy (TMA unit) from HBM
                 └─> NVLink → NVSwitch → 8-GPU node
                      └─> InfiniBand/RoCE → 10K GPU cluster
```

## 章节

- [CPU 流水线与指令级并行](cpu-pipeline.md) — 5-stage pipeline / hazards / forwarding / branch prediction
- [超标量 / OoO / Tomasulo](cpu-superscalar.md) — 多发射 / 记分板 / Tomasulo / ROB / 寄存器重命名
- [存储层次：Cache / DRAM / HBM](memory-hierarchy.md) — L1/L2/L3 / 替换策略 / MESI / DRAM 时序 / HBM3
- [MMU / TLB / DMA / IOMMU](mmu-dma.md) — 虚拟内存硬件、TLB 结构、IOMMU / SMMU、DMA 引擎
- [GPU 架构：SM / CUDA Core / Tensor Core](gpu-architecture.md) — SIMT / warp / 共享内存 / Tensor Core 内部
- [AI 加速器：TPU / NPU / FPGA](ai-accelerators.md) — 脉动阵列 / 数据流架构 / FPGA 推理 / Cerebras/Groq
- [总线与互联：PCIe / CXL / NVLink / RDMA](interconnects.md) — PCIe 拓扑、CXL.mem/cache、NVSwitch、InfiniBand
- [存储硬件：NAND / SSD FTL / 写入放大 / NVMe](ssd-storage.md) — SLC-TLC/QLC、磨损均衡、GC、TRIM、OP、队列模型
- [指令集架构：x86 / ARM / RISC-V](isa-design.md) — RISC vs CISC、SIMD 扩展、微码、解码器

读完应能回答:

1. 为什么 C 代码 `int sum = a + b` 在 CPU 上要经过"取指→译码→执行→访存→写回" 5 阶段
2. Zen 5 vs Golden Cove vs Apple M3 微架构的核心差异（解码器宽度、ROB 大小、执行端口数）
3. L1 cache 为什么只有 32-64KB？为什么 L2 要大？为什么 MESI 协议需要 4 种状态？
4. Tensor Core 一个 cycle 做 4×4 FP16 FMA 意味着什么？为什么 HBM3 带宽是 3.35 TB/s 但 GPU 算力是 989 TFLOPS？
5. CUDA warp 为什么是 32 个线程？divergent branch 的代价是什么？
6. NVLink 5 为什么是 900 GB/s per GPU？NVSwitch 如何让 8 GPU 全互联？
7. x86 的 `rep movsb` 和 ARM SVE 的 `ld1d` 各在什么场景下有效？

---

## 历史

1945 von Neumann 提出 stored-program concept；1965 Tomasulo 算法解决 float 指令依赖问题；1995 DEC Alpha 21264 是第一个 4-way superscalar OoO 的王者；2007 NVIDIA Tesla 用 unified shader model 开创 GPU 计算；2013 Google 发表 TPUv1 论文用 systolic array 做 inference；2016 Pascal P100 首次引入 HBM2；2022 Apple M1 Ultra 用 UltraFusion 把两芯片无缝接合；2023 Grace Hopper GH200 用 CXL 共享 CPU/GPU 内存。

---

下一节 → [CPU 流水线与指令级并行](cpu-pipeline.md)
