# 总线与互联：PCIe / CXL / NVLink / RDMA

## TL;DR

2024 年的数据中心里，CPU、GPU、内存、存储、网卡之间的互联，已经取代了处理器核数成为系统性能的第一瓶颈。PCIe 是系统内部的"高速公路"（x16 Gen5 = 64 GB/s），NVLink 是 GPU-to-GPU 的"专用铁路"（H100 900 GB/s/link），InfiniBand/RoCE 是跨机架的"洲际航班"（NDR 400 Gbps），而 CXL 正在把三者编织成一张**可组合的、缓存一致的互联网络**（cache-coherent fabric）。理解它们之间的层次、延迟和拓扑差异，是读懂任何一份 GPU 集群架构文档的前提。

```
                  ┌────────────────────────────────────┐
                  │            CPU Socket              │
                  │  ┌─────┐  ┌─────┐  UPI/IF ──────┐ │
                  │  │Core │  │Core │  (CPU-CPU)    │ │
                  │  └──┬──┘  └──┬──┘               │ │
                  │     │ PCIe Root Complex          │ │
                  │     └──────┬─────────────────────┘ │
                  └────────────┼───────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                 │
         ┌────▼────┐     ┌────▼────┐      ┌────▼────┐
         │  GPU 0  │     │ NVMe    │      │ NIC     │
         │  PCIe   │     │ SSD     │      │ (IB/RoCE)
         │  x16    │     │ x4      │      │ x16     │
         └────┬────┘     └─────────┘      └────┬────┘
              │                                │
    NVLink (GPU-GPU)                    InfiniBand/RoCE
    1-7 links each                       (Cluster network)
```

**四个核心数字：** PCIe 5.0 x16 → 64 GB/s，NVLink 4 (H100) → 900 GB/s bidirectional，InfiniBand NDR → 400 Gbps per port，CXL.mem → ~300ns 延迟比 NUMA 快一倍。

---

## 一、PCIe：系统内部的"高速公路"

### 从并行总线到串行点对点

PCIe（Peripheral Component Interconnect Express）的名字里带着"buse"这个词是历史遗产——老式 PCI 确实是共享总线（shared bus），所有设备挂在同一根总线上，任何一个设备占用总线时其他设备就得等着。PCIe 彻底抛弃了这个架构，改用**串行点对点（serial point-to-point）**：每一条链路（link）只能连接两个设备，带宽通过增加并行通道（lane）来扩展。

```
Shared bus (PCI)              vs.       Point-to-point (PCIe)
                                        
 CPU ──┬──┬──┬──┬──┬── BUS            CPU ── Switch ──┬── EP A
       │  │  │  │  │                                  ├── EP B
       A  B  C  D  E                                  └── EP C
       
 一次只能一个设备传输              每个设备有独立的带宽
 bandwidth shared               bandwidth dedicated
```

### Lane 与带宽：x1, x4, x8, x16

PCIe 的带宽单位是 **lane**（通道）。每个 lane 包含 4 根物理线：一对差分信号发送（TX+ / TX-），一对差分信号接收（RX+ / RX-）。一条 lane 可以**同时**收发——全双工。

| 代数 | 速率 (GT/s) | 编码 | 有效带宽/lane/dir | x16 总带宽/dir |
|------|------------|------|------------------|---------------|
| Gen 1 (2003) | 2.5 | 8b/10b | 0.25 GB/s | 4 GB/s |
| Gen 2 (2007) | 5.0 | 8b/10b | 0.50 GB/s | 8 GB/s |
| Gen 3 (2010) | 8.0 | 128b/130b | 0.985 GB/s ≈ **1 GB/s** | ~16 GB/s |
| Gen 4 (2017) | 16.0 | 128b/130b | 1.969 GB/s ≈ **2 GB/s** | ~32 GB/s |
| Gen 5 (2019) | 32.0 | 128b/130b | 3.938 GB/s ≈ **4 GB/s** | **~64 GB/s** |
| Gen 6 (2022) | 64.0 | PAM4 + FEC | 7.87 GB/s ≈ **8 GB/s** | **~128 GB/s** |
| Gen 7 (spec 2025) | 128.0 | PAM4 + FEC | ~15.75 GB/s | **~256 GB/s** |

> **GT/s vs GB/s**：GT/s（GigaTransfers per second）是物理层符号速率。从 Gen3 开始使用 128b/130b 编码（每 128 位数据只产生 2 位开销 → 开销 ~1.5%），而 Gen1/2 用的 8b/10b 编码（每 8 位数据产生 2 位开销 → 开销 20%）。所以 Gen3 "标称" 8 GT/s 的有效带宽是 8 × (128/130) / 8 = 0.985 GB/s/lane。

**Gen6 的关键变化：PAM4 调制。** Gen5 及以前使用 NRZ（Non-Return-to-Zero），每个符号周期传输 1 bit（0 或 1）。Gen6 升级到 PAM4（Pulse Amplitude Modulation 4-level），每个符号周期传输 2 bit（00, 01, 10, 11）——相当于在同样的 32 GHz 物理信道上翻倍速率。代价是信噪比下降，需要前向纠错（FEC, Forward Error Correction）来保证误码率。

```
NRZ (Gen5):                     PAM4 (Gen6):
  1 bit/symbol                    2 bit/symbol

V ──┐     ┌──  "1"            V ──┐     ┌──  "11" (3)
    │     │                        │     │
    └─────┘  "0"                   ├──┐  ├──  "10" (2)
                                   │  │  │
                                   │  └──┤  "01" (1)
                                   │     │
                                   └─────┘  "00" (0)
```

### 常见的链路宽度

| 设备 | 典型 lane | 原因 |
|------|----------|------|
| NVMe SSD | x4 | 消费级 7 GB/s 够用；企业级也有 x8 |
| GPU (消费级) | x16 | 需要 64 GB/s（Gen5）加载纹理 |
| GPU (企业级 A100/H100) | x16 | Gen5 ×16 = 64 GB/s 成瓶颈，NVLink 补上 |
| 网卡 (100GbE/200GbE) | x16 (Gen4) | 200 GbE ≈ 25 GB/s，Gen4 x8 = 16 GB/s 不够 |
| FPGA 加速卡 | x8 或 x16 | 视加速任务而定 |

### PCIe 协议栈：三层模型

PCIe 协议像网络协议栈一样分为三层：

```
┌──────────────────────────────────────┐
│       Transaction Layer (TL)         │  ← TLP 包，读/写请求
│  - TLP (Transaction Layer Packet)    │     Address, Data, Completion
│  - 内存读/写、IO 读/写、配置读/写   │
│  - Message (中断、电源管理等)        │
├──────────────────────────────────────┤
│       Data Link Layer (DLL)          │  ← DLLP 包，可靠传输
│  - ACK / NAK 机制                    │     Sequence Number + CRC
│  - 流控信用 (Flow Control Credits)   │
│  - DLLP (Data Link Layer Packet)     │
├──────────────────────────────────────┤
│       Physical Layer (PHY)           │  ← 电气 + LTSSM 状态机
│  - 8b/10b 或 128b/130b 编码         │
│  - LTSSM (Link Training & Status     │
│    State Machine)                     │
│  - 链路训练、均衡 (Equalization)     │
└──────────────────────────────────────┘
```

**Transaction Layer (TL)** 是核心：它产生 TLP（Transaction Layer Packet）。一个 TLP 包含：

```
┌───────┬────┬─────────┬──────┬──────┬────────────┬──────┐
│Header │ Seq#│ Address │Attrib│Length│   Data     │ ECRC │
│12-16B │    │ 32/64b  │      │ 10b  │ ≤ 4096B    │ 32b  │
└───────┴────┴─────────┴──────┴──────┴────────────┴──────┘
```

TLP 穿过 Data Link Layer 时会加上 Sequence Number（用于 ACK/NAK 重传）和 LCRC（Link CRC），到了 Physical Layer 还会加上 Framing 和物理层开销。

**Data Link Layer 的 ACK/NAK 机制**：每个设备为发送的每条 TLP 分配一个 Sequence Number。接收方设备检查 LCRC——如果正确，回复 ACK DLLP（携带 Sequence Number）；如果 CRC 错误，回复 NAK DLLP，发送方重传。这保证了所有 TLP 要么成功投递，要么链路中断（此时 LTSSM 会触发链路恢复）。

**Flow Control（流控）**：发送方不会超过接收方 buffer 容量。接收方定期发布 FC（Flow Control）信用更新 DLLP，告诉对方"我还能再接收 X 个 Posted/Non-Posted/Completion 数据单元"。信用耗尽 → 发送方暂停。

**LTSSM（Link Training & Status State Machine）** 管理物理链路的生命周期：

```
                  +-- Link Down (reset) <-+
                  |                       |
  Detect ──→ Polling ──→ Configuration ──→ L0 (active data transfer)
     ↑                                ↓    ↓
     └── Recovery ←── L1/L2 (low power sleep)
```

- **Detect**: 检测对端设备是否插入
- **Polling**: 交换 Bit Lock、Symbol Lock，训练 PHY
- **Configuration**: 协商链路宽度（x1/x4/x8/x16）和速率（Gen1→Gen5→Gen6）
- **L0**: 正常工作，数据可以自由流动
- **L1/L2**: 功耗管理状态（增加恢复延迟以换取节能）

### DMA 与 BAR：设备如何读写内存

设备不是"看到"了处理器地址空间——它通过 **BAR（Base Address Register）** 声明自己的地址窗口。

```
CPU 侧：Root Complex 管理全局地址映射
   CPU 物理地址 0x1000_0000 → 可以路由到 PCIe 设备 X 的 BAR 2

设备侧：设备发起 DMA 读/写
   GPU (PCIe EP) 发送 TLP：Memory Write, Address=0x2000_0000, Data=[...]
   → Root Complex 查地址映射表 (IOMMU 页表) → 翻译到 DRAM 物理地址
   → 写 DRAM
```

**BAR 机制详解**：

```
BIOS/UEFI 枚举过程:
1. 扫描 Root Port → Switch → 每个 Endpoint
2. 对于每个 Endpoint，读取 BAR 配置寄存器
3. 设备说自己需要 X MB 地址空间（e.g., GPU 256MB BAR）
4. BIOS 在全局地址空间中分配一段连续范围
5. 写入 BAR 寄存器，设备知道自己的地址空间
6. CPU 通过 load/store BAR 范围内的地址 ↔ Root Complex 转为 TLP
```

现代的 GPU 通常有 3-6 个 BAR：BAR0（256MB，内存映射寄存器）、BAR1（256MB，内存映射寄存器）、BAR2/BAR3（16GB+，芯片上显存映射，支持 Resizable BAR / AMD SAM）。

---

## 二、PCIe 拓扑：树形结构

### Root Complex、Switch、Endpoint

PCIe 拓扑是一棵以 **Root Complex** 为根节点的树：

```
                    ┌──────────────────────┐
                    │    CPU Die / SoC     │
                    │  ┌────────────────┐  │
                    │  │  Root Complex  │  │
                    │  │  (多个Root Port) │  │
                    │  └──┬──┬──┬──┬───┘  │
                    └─────┼──┼──┼──┼──────┘
                    ┌─────┘  │  │  └─────┐
                    │   ┌────┘  └────┐    │
               ┌────▼─┐ │     ┌────▼──┐ │
               │PCIe  │ │     │ NVMe  │ │
               │Switch│ │     │ SSD   │ │
               └──┬─┬─┘ │     └───────┘ │
              ┌───┘ └──┐│               │
         ┌────▼─┐ ┌───▼▼┐         ┌────▼──┐
         │ GPU0 │ │ GPU1│         │  NIC  │
         └──────┘ └─────┘         └───────┘
```

**Root Complex（RC）**：连接 CPU 和 PCIe 世界的桥梁。在 x86 系统里，RC 集成在 CPU die 上。每个 Root Port 可以独立配置——带宽分配、错误处理、电源管理都是 per-port 的。

**Switch**：让根端口下挂更多的 Endpoint。Switch 有 1 个 Upstream Port（连向 RC）和多个 Downstream Port（连向各 EP）。它不是路由器——没有地址学习、没有动态路由——TLP 的路由是由 switch 根据 TLP header 里的总线号/设备号/功能号（BDF）来做的。

**Endpoint**：叶子节点——GPU、NVMe SSD、网卡、FPGA。Endpoint 通过 Function（每个设备最多 8 个 Function）来分割功能。例如一张 Mellanox CX-7 网卡，可能 Function 0 = 网卡控制器、Function 1 = RDMA 引擎、Function 2 = NVMe-oF 控制器。

### 现代服务器的典型 PCIe 布局

一台配备 2 颗 Intel Xeon Sapphire Rapids（每颗 80 条 PCIe 5.0 lane）的服务器：

```
Socket 0 (CPU 0) - 80 PCIe 5.0 lanes
├── Root Port 0: x16 → GPU 0 (H100)
├── Root Port 1: x16 → GPU 1 (H100)
├── Root Port 2: x16 → GPU 2 (H100)
├── Root Port 3: x16 → GPU 3 (H100)
├── Root Port 4: x8 → NIC 0 (ConnectX-7)
├── Root Port 5: x4 → NVMe SSD 0
├── Root Port 6: x4 → NVMe SSD 1
└── Root Port 7: UPI → Socket 1

Socket 1 (CPU 1) - 80 PCIe 5.0 lanes
├── Root Port 0: x16 → GPU 4 (H100)
├── Root Port 1: x16 → GPU 5 (H100)
├── Root Port 2: x16 → GPU 6 (H100)
├── Root Port 3: x16 → GPU 7 (H100)
├── Root Port 4: x8 → NIC 1 (ConnectX-7)
├── Root Port 5: x4 → NVMe SSD 2
├── Root Port 6: x4 → NVMe SSD 3
└── Root Port 7: UPI → Socket 0
```

**关键观察**：GPU 0-3 直接挂在 Socket 0 下面。GPU 0 要给 GPU 4 传数据 → 必须通过 RDMA（经过 NIC 0 → 交换机 → NIC 1 → GPU 4）或通过 NVLink（如果有 NVSwitch 的话），或者绕过——直接不支持通过 PCIe/UPI 跨 Socket 做 GPU 间 P2P 传输。这就是为什么 DGX 系统把 8 个 GPU 全挂在同一颗 CPU 下，并用 NVSwitch 取代 PCIe 走 GPU 间流量。

### Resizable BAR (ReBAR) / AMD SAM

传统 PCIe BAR 只能映射最多 256MB 的显存给 CPU（因为 32-bit BAR 兼容性）。这意味着 CPU 每次只能"看到" GPU 显存的一个小窗口，必须通过地址重映射来翻窗口——翻一次窗口就是一次 PCIe TLP round-trip。

Resizable BAR 允许协商更大的 BAR 窗口（2GB / 4GB / 16GB），让 CPU 一次性映射 GPU 的全部或大部分显存。这对纹理加载和 DirectStorage 这类技术有巨大帮助——`memcpy(vram, ssd_buffer, 16GB)` 不再需要翻 64 次 256MB 窗口。

---

## 三、CXL：基于 PCIe 的缓存一致性互联

### CXL 是什么、为什么

CXL（Compute Express Link）解决的问题很简单：**PCIe 没有缓存一致性（cache coherency）**。在一台标准的 PCIe 服务器上：

- 网卡通过 DMA 写了数据到 DRAM → CPU cache line 可能还是旧的（stale）。你需要"手动"flush cache line 或使用不可缓存的（uncacheable）内存区域。
- GPU 不能缓存（cache）CPU 页表——即使 GPU 和 CPU 共享物理内存，GPU 只能通过 MMIO/ATB 查询 CPU 的页表，延迟巨大。

CXL 在 PCIe 物理层之上加了三个新协议，把 PCIe 从"你传你的，我存我的"升级为"我们共享同一个缓存一致域"。

### CXL 的三层协议

```
┌───────────────────────────────────────┐
│             CXL Transaction           │
├───────────┬───────────┬───────────────┤
│  CXL.io   │ CXL.cache │   CXL.mem     │
├───────────┴───────────┴───────────────┤
│         CXL Link Layer                │
├───────────────────────────────────────┤
│    PCIe 5.0 / 6.0 Physical Layer      │
└───────────────────────────────────────┘
```

**CXL.io**：功能上和 PCIe 几乎相同——用于设备发现、配置空间、DMA、中断。任何 CXL 设备至少支持 CXL.io。可以理解为"标准 PCIe 的部分直接复用"。

**CXL.cache**：让设备可以**持有主机内存的缓存副本**（coherent cache）。协议使用标准 MESIF 或 MOESI 协议，设备发 Cache MemRd / Cache MemWr 请求，Host 负责响应和 snoop 已有的 cache line。典型场景：GPU 缓存 CPU 的页表和数据结构，访问延迟从 µs 级降到 ns 级。

```
没有 CXL.cache（标准 PCIe）:
  GPU 需要读 CPU 页表
  → BAR MMIO 读 (uncacheable) → PCIe TLP → RC → DRAM → TLP 返回
  → 每次 ~500ns

有 CXL.cache:
  GPU 发 Cache MemRd 请求
  → RC 查 CPU L3/L2/L1 → hit in L3 → 直接回传 cache line
  → ~80-150ns（省去了 DRAM 往返）
  GPU 还把这个页表 line 缓存在自己的 cache 里，后续访问 ~ns 级
```

**CXL.mem**：反向——让**主机 CPU 可以把设备上的内存当系统内存用**。Host 发 MemWr/MemRd TLP 到设备，设备返回数据并维护自己的 cache 状态（如果设备上有 cache 的话）。典型场景：CXL Type-3 内存扩展卡——一个你插进 PCIe 插槽就能让服务器多出 512GB DDR5 内存的设备。

CPU 看到的物理地址空间：
```
[ 0 - 256GB ]      本地 DDR5 (DRAM, ~100ns)
[ 256 - 768GB ]    CXL Type-3 内存扩展卡 0 (~300ns)
[ 768 - 1280GB ]   CXL Type-3 内存扩展卡 1 (~320ns)
```

每个地址范围通过 **Host Physical Address (HPA) decoder** 路由到本地 DRAM 或 CXL 设备。操作系统通过 ACPI SRAT/HMAT 表了解到这些区域的性能和延迟差异，从而做 NUMA-aware 的内存分配。

### CXL 设备类型

| Type | 协议支持 | 典型设备 | 说明 |
|------|---------|---------|------|
| **Type 1** | CXL.io + CXL.cache | 智能网卡 (SmartNIC)、DPU | 设备可以缓存主机内存，加速 packet buffer 和数据面处理。不能附加自己的内存 |
| **Type 2** | CXL.io + CXL.cache + CXL.mem | GPU (如 Intel Ponte Vecchio)、FPGA | 双方互相共享内存。GPU 可以缓存 CPU 页，CPU 可以直接访问 GPU HBM——双方都在同一个 cache coherent 域里 |
| **Type 3** | CXL.io + CXL.mem | 内存扩展卡、持久内存 | 纯内存设备。把 DRAM/持久内存挂在 CXL 链路上，主机操作系统看到的就是新的 NUMA node |

### CXL 内存池化与可组合基础设施

CXL 最具颠覆性的用法不是单个设备的连接，而是**把多个主机的内存需求集中到 CXL 交换机后面的共享内存池**。

```
        Host 0    Host 1    Host 2       ...    Host 15
          │         │         │                     │
          └─────────┼─────────┼─────────────────────┘
                    │
            ┌───────▼───────┐
            │  CXL Switch   │   (multi-host switch)
            └───┬───┬───┬───┘
                │   │   │
        ┌───────┘   │   └───────┐
        ▼           ▼           ▼
   ┌─────────┐ ┌─────────┐ ┌─────────┐
   │ CXL Mem │ │ CXL Mem │ │ CXL Mem │
   │ 512GB   │ │ 512GB   │ │ 512GB   │
   └─────────┘ └─────────┘ └─────────┘
```

**动态容量分配**：Host 2 现在只需要 128GB，但 Host 5 需要 1TB——CXL 池化管理器可以热重配置：从 pool 里分配 768GB 给 Host 5，256GB 给 Host 2——**不需要重启、不需要物理插拔**。数据中心的内存利用率从传统的 50-60%（每台服务器有大量闲置但无法转移的 DRAM）跃升到 80-90%。

**Multi-Logical Device (MLD)**：一个物理 CXL 内存设备可以切成多个逻辑分区，每个分区分配给不同的主机。一个 512GB 的 CXL Type-3 设备可以同时被 4 台主机"看到"为各 128GB 的独立内存。

---

## 四、NVLink：NVIDIA 的 GPU 互联帝国

### 为什么需要 NVLink

先把问题摆清楚：一张 H100 GPU 的计算能力是 1979 TFLOPS (FP8)，但 PCIe 5.0 x16 的带宽只有 64 GB/s。一个 LLM 训练梯度的 all-reduce 步骤，如果走 PCIe — 假设每 GPU 要互相传 16GB 梯度 — PCIe 就需要 16 GB / (64 GB/s / 2) ≈ 0.5 秒。NVLink 4 (900 GB/s) 则是 16 GB / (900 / 2) ≈ 35 毫秒。差 14 倍。

对 NVIDIA 来说这不是"优化"，而是"训练可行与否的物理边界"——任何 8 卡训练 PCIe x16 全互联（full-mesh 需要 7 条双向链路 × 64 GB/s = 448 GB/s，但物理上做不到，因为 PCIe 是树形结构）都不可能达到需求。

### NVLink 代际演化

| 代 | 产品 | 速率/link | 每 GPU links | 总双向带宽 | 关键创新 |
|----|------|----------|-------------|-----------|---------|
| NVLink 1 | P100 (2016) | 20 GB/s | 4 links | 160 GB/s | 首次 GPU-GPU 直连 |
| NVLink 2 | V100 (2017) | 25 GB/s | 6 links | 300 GB/s | 拓扑更密 |
| NVLink 3 | A100 (2020) | 50 GB/s | 12 links | 600 GB/s | NVSwitch 支持 all-to-all |
| NVLink 4 | H100 (2022) | 50 GB/s | 18 links | 900 GB/s | NVSwitch 3 (64 ports) |
| NVLink 5 | B200 (2024) | 100 GB/s | 18 links | **1.8 TB/s** | 更高速率，NVSwitch 4 |
| NVLink-C2C | Grace Hopper (2023) | 450 GB/s | 专用 | 900 GB/s | CPU-GPU coherent link |

**NVLink 不是"总线"**。每条 NVLink 是两个 GPU 之间的**专用点对点链路**（dedicated point-to-point link）。H100 有 18 条 NVLink 4，意味着它可以同时连接多达 18 个不同的对端设备（实际在 DGX 中是连到 8 颗 H100 的互连，每对之间用多条 link）。

### NVSwitch：突破 All-to-All 瓶颈

上面的 18 条 NVLink 全部连到 GPU 本身——但如果你想 8 个 GPU 全互联（任意两个 GPU 之间都有对应的 NVLink），需要多少条链路？答案是 7 条 per GPU × 8 = 56 条（双向）。物理上 H100 做不到直接全互联——PCB 布线只是理由之一，真正的瓶颈是芯片上只能放有限数量的 NVLink 单元。

NVSwitch 解决了这个问题。它像一个 crossbar 交换机：

```
                ┌────── NVSwitch 0 ──────┐
                │  Port 0  Port 1  ...  Port 7  │
                └───┬───────┬────────────┬─┘
                    │       │            │
   GPU0 NVLink─────┘       │            └───── GPU7 NVLink
   GPU1 NVLink─────────────┘             ...
```

H100 DGX 系统有 4 个 NVSwitch 3（每个 64 端口），8 个 GPU × 18 条 NVLink ÷ 4 个 NVSwitch = 每个交换机的每个端口连一个 GPU（实际上每个 GPU 通过多条 NVLink 连接到每个 NVSwitch，保证 full bandwidth）。

```
H100 DGX 全互联带宽：
  任何一个 GPU → 另一个 GPU = 7 条 NVLink 4 × 50 GB/s = 450 GB/s
  8 GPU all-to-all = 8 × 7 / 2 × 50 = 1400 GB/s = 7.2 TB/s 全局双向带宽
```

**NVSwitch 的交换方式**：NVSwitch 内部使用的是 cut-through switching（热土豆交换）——收到数据包头就开始转发，不需要缓存整个报文。这比 store-and-forward 的延迟低不少（<100ns switch latency）。

### Grace Hopper：CPU-GPU 一致互联

2023 年 NVIDIA 发布的 Grace Hopper Superchip 将 ARM CPU（Grace，72 核 Neoverse V2）和 H100 GPU 通过 **NVLink-C2C** 直接连接。

```
┌──────────────┐       NVLink-C2C        ┌──────────────┐
│  ARM Grace   │  ←──450 GB/s ×2──→     │ H100 GPU     │
│  72-core     │     (双向 900 GB/s)      │ 80 GB HBM3   │
│ CPU          │                          │              │
│              │  ┌── Coherent ───────────│──────────┐   │
│   LPDDR5X    │  │                      │  HBM3    │   │
│   up to 480GB│  │ Shared address space │ 80GB     │   │
└──────────────┘  └──────────────────────└──────────┘   │
                  CPU 和 GPU 共享同一个物理地址空间
```

**这是 CXL.cache + CXL.mem 的 NVIDIA 专属实现**。CPU 和 GPU 使用 MOESI 缓存一致性协议共享地址空间——GPU 可以直接 cache CPU 的 LPDDR5X 页面（不再需要通过 PCIe BAR 做地址映射），CPU 也可以直接访问 GPU 的 HBM。对应用开发者来说，`cudaMallocManaged()` 变得几乎零成本——底层硬件自动维护一致性，没有 driver 层面的 page fault 和 migration 延迟。

这与 AMD 的 MI300A 形成了直接竞争：AMD 把 24 个 Zen4 核心和 CDNA3 GPU 放在同一个 Package 上，用 Infinity Fabric 走 in-package 互联——思路一样，但实现完全不同。NVIDIA 选择 Chip-to-Chip（C2C）物理层，AMD 选择 Infinity Fabric 扩展。

---

## 五、InfiniBand 与 RDMA：跨机架的 DMA

### InfiniBand 基础

InfiniBand 是 Mellanox（现 NVIDIA Networking）设计的 HPC/AI 集群专用互联。它是**基于信用流控的、无损的、远程 DMA 的链路层协议**：

| 代 | 每 lane 速率 | 4x (HDR/NDR 常用) | 12x | 延迟 (switch + PHY) |
|----|-------------|-------------------|-----|---------------------|
| SDR | 2.5 Gbps | 10 Gbps | 30 Gbps | ~5µs |
| DDR | 5 Gbps | 20 Gbps | 60 Gbps | ~3µs |
| QDR | 10 Gbps | 40 Gbps | 120 Gbps | ~2µs |
| FDR | 14 Gbps | 56 Gbps | 168 Gbps | ~1.5µs |
| EDR | 25 Gbps | 100 Gbps | 300 Gbps | ~1.2µs |
| HDR | 50 Gbps | 200 Gbps | 600 Gbps | ~1µs |
| NDR | 100 Gbps | **400 Gbps** | 1.2 Tbps | <1µs |
| NDR200 | 100 Gbps (SHARP) | 400 Gbps | — | <1µs |
| XDR | 200 Gbps | **800 Gbps** | — | <1µs |

InfiniBand 使用 **链路层流控（Link-Layer Flow Control）**，而非以太网的 PAUSE 帧或 PFC。发送方在发送每个包之前必须拥有足够的"信用"——这是接收方 buffer 空间的一种保证。这使得 InfiniBand 在满载时保持零丢包，而不需要像 TCP 那样重传。

### RDMA 的工作原理

**RDMA（Remote Direct Memory Access）** 是 InfiniBand 最强大的能力：网卡可以**直接读写远程机器的内存，不经过远程 CPU 参与**。

```
传统网络 (TCP):
  Sender App → buffer → kernel TCP stack → NIC → wire
  → remote NIC → kernel TCP → buffer → App (CPU wake + copy)

RDMA:
  Sender App → buffer (registered MR) → NIC reads buffer via DMA → wire
  → remote NIC → DMA writes directly into remote MR → completion
  → remote App poll CQ → 数据已经在那里了
  
  省掉了: 两次 kernel 穿越 + 两次 copy + remote CPU 中断
```

**RDMA 的 Verbs API**：

```c
// 1. 注册内存区域 (Memory Region) — 锁住物理页，不要被 swap
struct ibv_mr *mr = ibv_reg_mr(pd, buf, size,
    IBV_ACCESS_LOCAL_WRITE | IBV_ACCESS_REMOTE_READ |
    IBV_ACCESS_REMOTE_WRITE | IBV_ACCESS_REMOTE_ATOMIC);

// 2. 创建 Queue Pair (QP) — 发送/接收队列对
struct ibv_qp *qp = ibv_create_qp(pd, &qp_init_attr);

// 3. 发送 RDMA Write (本地 → 远程，不需要远程 CPU 参与)
struct ibv_sge sge = { .addr = (uintptr_t)local_buf,
                       .length = size, .lkey = mr->lkey };
struct ibv_send_wr wr = { .wr_id = 1, .opcode = IBV_WR_RDMA_WRITE,
                           .sg_list = &sge, .num_sge = 1,
                           .wr.rdma.remote_addr = remote_addr,
                           .wr.rdma.rkey = remote_rkey,
                           .send_flags = IBV_SEND_SIGNALED };

ibv_post_send(qp, &wr, &bad_wr);

// 4. 轮询 Completion Queue
struct ibv_wc wc;
int n = ibv_poll_cq(cq, 1, &wc);
if (n > 0 && wc.status == IBV_WC_SUCCESS) {
    // 发送成功，远程内存已经被写了
}
```

**RDMA 的核心模式**：

| 操作 | CPU 参与 (发送方) | CPU 参与 (接收方) | 用途 |
|------|------------------|------------------|------|
| **RDMA Write** | 是 (post send) | **否** | 单向数据传输（gradient push）、存储写入 |
| **RDMA Read** | 是 | **否** | 单向读取远程数据（gradient pull）、存储读取 |
| **RDMA Send/Recv** | 是 | **是** (pre-post recv) | 双向消息、控制面（metadata exchange） |
| **RDMA Atomic** | 是 | **否** | Compare & Swap、Fetch & Add——分布式锁、barrier |

**GPU Direct RDMA (GDR)**：把 RDMA 的 DMA 引擎直接对接 GPU 显存。

```
无 GDR:
  GPU 0 HBM → (PCIe read by CPU/memcpy) → system DRAM → NIC read (DMA)
  → IB → remote NIC → DMA to remote DRAM → memcpy → GPU 1 HBM

有 GDR:
  GPU 0 HBM → NIC read by DMA (直接通过 PCIe 读 GPU BAR)
  → IB → remote NIC → DMA directly to GPU 1 HBM (通过 PCIe 写 GPU BAR)

  全程 GPU HBM → NIC → IB → remote NIC → GPU HBM
  CPU 和系统 DRAM 完全 bypass
```

在 H100 训练集群中，不带 GDR 的 all-reduce 每个 step 要花 200ms，带 GDR 只要 45ms。这对万个 GPU 的千亿参数模型训练是生死线。

### RoCE：以太网上的 RDMA

**RoCEv2 (RDMA over Converged Ethernet version 2)** 把 RDMA 传输层封装在 UDP/IP 报文中，使 RDMA 可以在标准以太网上运行。

```
RoCEv2 封装:
  ┌──────┬──────┬──────┬──────────┬────────┬──────┐
  │ Eth  │ IP   │ UDP  │ IB Trans.│ IB Payload │ CRC │
  │ Hdr  │ Hdr  │ Hdr  │ Port Hdr │ (RDMA data)│     │
  └──────┴──────┴──────┴──────────┴────────┴──────┘
```

**RoCE 和 InfiniBand 的区别**：

| 维度 | InfiniBand | RoCEv2 |
|------|-----------|--------|
| 物理层 | IB 专用 (HDR/NDR) | 以太网 (100/200/400G) |
| 交换设备 | IB 交换机 (~$12K per port) | 以太网交换机 ($3-8K per port) |
| 延迟 (小型消息) | ~1µs | ~5-10µs |
| 损失 | 零丢包 (credit-based) | 需要配置 PFC/ECN (lossless Ethernet) |
| 可路由 | 子网管理器 (SM) | 标准 IP 路由 |
| 生态系统 | NVIDIA/Mellanox 锁定 | 多厂商 (Broadcom, Cisco, Arista) |

**DCQCN (Data Center Quantized Congestion Notification)** 是 RoCEv2 的拥塞控制核心。当交换机 buffer 开始拥塞，交换机会在数据包上标记 ECN 位。接收方收到 ECN 标记的包后，向发送方发送 CNP（Congestion Notification Packet）。发送方根据 CNP 的频率调整发送速率（AIMD 式加性增乘性减）。这使 RoCE 能在以太网上维持"接近无损"的语义。

但这是有代价的——DCQCN 的收敛时间 ~50-100µs，而 InfiniBand 的 credit-based 流控是即时生效的。所以 RoCE 在拥塞时延迟抖动比 InfiniBand 大得多。

---

## 六、AI 训练集群的互联拓扑

### 现代 LLM 训练集群的网络架构

以 Meta 的 24K GPU 集群（训练 Llama 3 405B）为例：

```
┌────────────────────────────────────────────┐
│                  Front-End Network          │
│         Ethernet (数据加载、checkpoint)      │
│         100 / 200 GbE, RoCEv2              │
└──────────────────┬─────────────────────────┘
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
┌───────┐     ┌───────┐     ┌───────┐
│Server │     │Server │     │Server │
│ GPU0..│ ... │ GPU0..│ ... │ GPU0..│
│ GPU7  │     │ GPU7  │     │ GPU7  │
└──┬──┬─┘     └──┬──┬─┘     └──┬──┬─┘
   │  │          │  │          │  │
   │  └────── Rail-Optimized Topology ──┘  │
   │  ┌───────────────────────────────────┘
   ▼  ▼  ▼  ▼  ▼  ▼  ▼  ▼
 ┌──────────────────────────────┐
 │       Back-End Network       │
 │  InfiniBand / RoCE (scale-out)│
 │  梯度 all-reduce, 参数同步    │
 │  三层 Fat-Tree 拓扑           │
 └──────────────────────────────┘
```

**Front-end vs Back-end 网络分离**：

- **Front-end (前端)**：标准以太网。处理的流量是数据加载（从 storage cluster 读取训练数据）、checkpoint 保存（定期 dump 模型权重到持久存储）、日志/监控。
- **Back-end (后端)**：高带宽、低延迟的 InfiniBand 或 RoCE。专门负责 **梯度同步（gradient synchronization）**。每次训练 step，所有 GPU 各自计算完梯度后，必须通过 all-reduce 集合通信操作交换并聚合梯度——如果用前端网络做这件事，网络拥塞会直接阻塞所有 GPU 的训练进度。

### Rail-Optimized 拓扑

**Rail 拓扑** 是 Meta 提出的一种降低 all-reduce 网络拥塞的设计。思想是：每台 8 GPU 服务器对 8 个独立交换机（每个交换机一个 "rail"），每个 GPU j 连接到 Rail Switch j：

```
Server 0:                 Rail 0       Rail 1  ...  Rail 7
  GPU0 NIC0 ──────────→  Switch 0
  GPU1 NIC1 ───────────────→          Switch 1
  ...                                           ...
  GPU7 NIC7 ───────────────────────────────→          Switch 7

Server 1:
  GPU0 NIC0 ──────────→  Switch 0
  GPU1 NIC1 ───────────────→          Switch 1
  ...

Server N-1:
  GPU0 NIC0 ──────────→  Switch 0
  ...
```

**为什么这样做？** 标准的 all-reduce 算法（如 ring all-reduce）中，每个 GPU 只与相邻 GPU 通信。如果让一个服务器的所有 GPU 都通过同一台交换机通信，交换机内部的 buffer 承受所有 8 个 GPU 的全带宽压力。而 rail 拓扑确保任一交换机的流量都是来自不同服务器的不同 GPU j——把流量均匀地分配到 8 个独立交换机上，消除了交换机级别的拥塞点。

### GPU 间通信层次总结

在一台 DGX H100 上：

```
Level 0: SM 内共享 L1 / Shared Memory (NVLink 无法替代的带宽)
Level 1: HBM3 内 (GPU internal, 3.35 TB/s)
Level 2: NVLink 4 (NVSwitch, GPU-to-GPU, 900 GB/s/link)
Level 3: InfiniBand NDR (跨节点, 400 Gbps/port = 50 GB/s)
```

每一层带宽跳降约 **10-20 倍**。Tensor Parallelism 通常限制在 `Level 0-2` 内（同一个节点，NVLink 互联），Pipeline Parallelism 才跨节点（NDR）。这是分布式训练的最基本硬件约束。

---

## 七、CPU-CPU 互联：UPI 与 Infinity Fabric

多颗 CPU 之间也要互联，不用 PCIe：

### Intel UPI（Ultra Path Interconnect）

| 代 | 速率 | 每 link 带宽 | 条数 | 产品 |
|----|------|------------|------|------|
| QPI 1.1 | 6.4 GT/s | 12.8 GB/s | 1-2 | Nehalem ~ Broadwell |
| UPI 1.0 | 10.4 GT/s | 20.8 GB/s | 2-3 | Skylake-SP ~ Cooper Lake |
| UPI 2.0 | 10.4 GT/s | 20.8 GB/s | 3-4 | Sapphire Rapids |
| UPI 3.0 | 16 GT/s | ~32 GB/s | 3-4 | Granite Rapids (传闻) |

CPU 间的 UPI 使用 home snoop 或 source snoop 模式维护跨 socket 的缓存一致性。当一个 socket 上的 core 访问另一个 socket 的 DRAM 时 → UPI 请求 → remote Home Agent → remote DRAM → UPI 回传。延迟 ~140-200ns（比本地 DRAM 100ns 高 ~50%）。

### AMD Infinity Fabric

AMD 的 Infinity Fabric 是更通用的互联架构——它不只是 CPU-CPU 互联，也用于：

- CPU-CPU 跨 socket 互联（2 路 / 4 路服务器）
- Chiplet 互联：Zen 核心 CCD（Core Complex Die）和 IOD（I/O Die）之间
- GPU-GPU 互联：MI250X 和 MI300X 加速器之间
- CPU-GPU 互联：MI300A APU 内 Zen4 + CDNA3 的协同

```
Ryzen 9 7950X (单 Socket，无需 CPU-CPU InF):
  ┌──────CCD0──────┐  ┌──────CCD1──────┐
  │ 8× Zen4 Core   │  │ 8× Zen4 Core   │
  │ 32MB L3        │  │ 32MB L3        │
  └───Inf. Fabric──┘  └───Inf. Fabric──┘
              │                │
         ┌────▼────Inf. Fabric──▼────┐
         │          IOD             │
         │  PCIe 5.0 ×28 lanes     │
         │  DDR5 controllers ×2    │
         │  USB, SATA, etc.       │
         └──────────────────────────┘
```

Infinity Fabric 的带宽通常在 32-64 GB/s/方向（取决于代与链路宽度），延迟极低（in-package 模式 <10ns）。

---

## 八、UALink：NVIDIA 互联垄断的公开挑战

2024 年 5 月，AMD、Broadcom、Intel、Google、Microsoft 和 Cisco 联合宣布 **UALink（Ultra Accelerator Link）**，目标是为不同厂商的 AI 加速器（GPU、FPGA、ASIC）建立一个开放的、高速互联标准。

### UALink 1.0 技术参数

| 参数 | 值 |
|------|-----|
| 每 lane 速率 | 200 Gbps |
| 通道数 | 可聚合多 lane |
| 拓扑 | 支持 all-to-all（类似 NVSwitch 的 crossbar） |
| 一致性 | 支持 cache coherent memory sharing（类似 CXL.cache + CXL.mem） |
| 目标产品 | AMD MI400, Intel Falcon Shores, Broadcom AI ASIC (2026+) |

UALink 本质上是 CXL 的超集——在 CXL 的缓存一致性基础上加了 NVLink 级别的高带宽 GPU 间直连。如果成功，UALink 将允许 AMD MI400、Falcon Shores 和自研 ASIC 在同一个服务器内共享缓存一致的内存并高带宽互联——打破 NVIDIA NVLink 和 NVSwitch 的生态锁定。

但有个残酷的事实：NVIDIA NVLink 已经迭代了 5 代（6 年），UALink 还在规范定义的初期。NVIDIA 每年把 NVLink 带宽翻 1.5-2 倍，而 UALink 的开放标准需要通过多厂商共识——这样的速度差，让 UALink 在短期内永远追不上 NVLink。

---

## 九、工程事故与教训

### CXL 互通性问题 (2023)

Intel 和 AMD 的 CXL 实现在 2023 年初互不兼容。根本原因在于 CXL 规范虽然在物理层复用 PCIe 5.0，但在 timing budget、电压容差和 CXL.cache 的精确事务语义上有足够的 gray area 让实现差异变成不兼容：

- **Timing violation**：Intel Sapphire Rapids CXL 控制器的 `CXL.io` 启动时序比 AMD Genoa 严格 4 个 cycle。一个 CXL Type-3 内存设备被两边的 BIOS 分别训练后，在 Intel 上工作正常，但在 AMD 上 LTSSM 链路训练在 Configuration 阶段超时。
- **Cache state transition**：CXL.cache 的 DIRTY → INVALID 状态转换在 Intel 和 AMD 对 forward progress（前进保证）的解读不同。Intel 允许 Home Agent 延迟 invalidation ACK，而 AMD 在 256 cycle 内未收到 ACK 则报 Fatal Error。

这些问题的最终结果：数据中心不能混插 Intel 和 AMD 的服务器共享一个 CXL 内存池——每条 CXL 链路在部署前必须做厂家兼容性认证。

### NVIDIA vs AMD 的互联锁

```
NVIDIA 生态：
  CUDNN, CUDA, NCCL, NVLink, NVSwitch, InfiniBand
  ↑  端到端的纵向整合，每个组件互相依赖

AMD 生态：
  ROCm, RCCL, PCIe 5.0, Infinity Fabric, 以太网 (RoCE)
  ↑  依赖开放标准，但生态碎片化
```

NCCL（NVIDIA Collective Communication Library）迄今只在 NVLink 和 InfiniBand 上经过仔细优化。AMD 的替代品 RCCL 支持 PCIe 和以太网，但 8 GPU 的 all-reduce 带宽只有 NCCL + NVLink 的 40-60%。这不是因为 AMD 代码写得烂——而是因为 PCIe 5.0 的树形拓扑本身不适合做 GPU 间全局通信。NVIDIA 的互联护城河不只是硬件，还有 NCCL 这个一层优化过的软件层。

### RoCE 拥塞崩溃案例 (2022)

某 AI 实验室的 1024 GPU 训练集群在从 InfiniBand 迁移到 RoCEv2 后，all-reduce 延迟从 60ms 跳变为 300-600ms（方差极大）。根因分析：

1. 所有 1024 GPU 在每个 step 同时开始 all-reduce（同步屏障效应）
2. RoCE 网络没有配置 PFC headroom buffer（缓冲区太小）
3. 所有 GPU 同时爆发 RDMA Write → 所有交换机 buffer 同时溢出
4. DCQCN 开始降低所有 GPU 的发送速率 → 全局降速
5. 降速后 all-reduce 完成时间变化 → GPU step 同步变慢 → burst 周期变长 → 恶性循环

修复方案：在所有交换机上启用 PFC deadlock detection + 增加 200MB headroom buffer，同时引入 GPU step 的随机微抖动 (jitter = ~5ms)，打破同步 burst。

---

## 十、易错清单

1. **"PCIe x16 = 64 GB/s 可用带宽"**：Gen5 x16 标称 64 GB/s 是物理层速率。去掉 128b/130b 编码开销、TLP header overhead（12-16B 每 4KB payload ≈ 0.3%）、Data Link Layer ACK/FC 开销——实际有效 payload 带宽约为 50-55 GB/s。别在链路预算表里做满打满算。

2. **"我插了 4 个 GPU 都是 x16，每个都有 64 GB/s"**：如果这 4 个 GPU 全挂在同一个 PCIe Switch 后面（Switch 只有一个 x16 上行端口连 Root Complex），那么 4 × x16 下行端的并发流量受上行端口的 x16 = 64 GB/s 制约——这叫 **oversubscription（超额订阅）**。检查你的主板 PCIe 拓扑：不是所有的 x16 物理插槽都有各自 x16 电气连接。

3. **"NVLink 是 bus，我可以随便加 GPU"**：NVLink 是点对点链路，不是多 device 的总线。H100 有 18 条物理 NVLink 接口——这些接口的数量在硅片设计时就固定了。你无法把 10 个 GPU 用 NVLink 直接连接（因为 H100 只有 18 个 NVLink 单元，而且 DGX 的 NVSwitch 拓扑是针对 8 卡优化的）。NVSwitch 帮你在 8 卡内实现了 all-to-all，不等于你可以无限扩展。

4. **"RDMA 可以直接读任意远程内存"**：RDMA 只能访问 **预先注册的 Memory Region (MR)**。注册 MR 时，网卡驱动调用 `pin_user_pages()` 把物理页锁住（防止 swap 或 move），并把物理地址告知 NIC。每注册一个 MR，NIC 的 I/O MMU (IOMMU) 会创建对应的页表映射。没有注册的地址 → IOMMU 拒绝访问 → RDMA 失败。注册本身就花费若干 µs 和数 KB 的页表空间。

5. **"CXL = 快一点的 PCIe"**：CXL.cache 和 CXL.mem 是完全不同的传输语义。标准 PCIe 使用 Non-Cacheable MMIO/TLP 访问远端内存，而 CXL.cache 允许设备在 cache 中持有映射，使用 MESI 一致性协议。一台 CXL 设备的 BIOS 支持包含主机方 Home Agent 的配置和 snoop filter 的大小——这些东西如果没有在 BIOS 中正确设置，CXL 设备只会在 CXL.io (即 PCIe) 模式下工作，cache 和 mem 协议不激活。

6. **"RoCE 和 InfiniBand 是一回事"**：RoCEv2 在 UDP/IP 上跑 RDMA 语义，但这不代表它有无损保证。InfiniBand 在链路层有 credit-based 流控 → 物理上不存在丢包。RoCEv2 在 IP 层没有流控，需要用 DCQCN + PFC 来避免丢包——而 PFC 会引发 head-of-line blocking 甚至 deadlock。生产部署 RoCE 需要网络工程师精心调整 PFC 阈值、ECN 标记率、DCQCN 参数（`rp_timer`, `g`, `alpha`），否则一个大 burst 就能引发拥塞崩溃。

7. **"CXL 内存池化可以让任何服务器用别人的内存"**：CXL multi-host switch 需要 CXL 规范 3.0+ 的支持，并且 switch 本身必须实现 multi-logical device (MLD) 和多域（multi-domain）隔离。2024 年大部分可用的 CXL switch 仅支持单主机模式。Multi-host CXL 池化生产就绪预计在 2025-2026 年。

---

## 十一、这一章带走的东西

1. **互联层次决定了性能天花板**：PCIe（500ns, 64GB/s）→ NVLink（100ns, 900GB/s）→ InfiniBand（1µs, 400Gbps）——每一层 10× 带宽/延迟的跳跃。分布式训练的 TP（Tensor Parallelism）只能在第一二层（NVLink 以内），PP（Pipeline Parallelism）和 DP（Data Parallelism）才跨 InfiniBand。选错了 TP/PP 的分界点，训练会被互联带宽卡死。

2. **PCIe 不是一条 lane 的事，是一棵整树**：Root Complex 的分支结构、Switch 的 oversubscription ratio、BAR 空间分配——这些决定了一个 PCIe 设备实际能拿到的可持续带宽。永远不要只看标签上的"x16"。

3. **CXL 是 PCIe 上长了"脑子"**：CXL.cache 和 CXL.mem 把 PCIe 从愚蠢的 DMA 管道升级成了缓存一致的共享内存总线。理解 CXL = 理解未来的服务器架构——可组合的、动态的、池化的。

4. **NVLink + NVSwitch = NVIDIA 的护城河**：NVIDIA 花了 8 年、5 代硬件来打磨完全的 GPU 互联栈（NVLink + NVSwitch + InfiniBand + NCCL）。任何竞争者不仅要追硬件规格，还要追这个软硬一体化的全部。UALink 走了正确的路（开放标准），但追赶时间会更长。

5. **RDMA 节省的不是带宽，是 CPU**：一次 all-reduce 如果没有 RDMA → 远程 CPU 被中断打断、copy 数据、再发 → 这些 CPU cycle 与 GPU 训练竞争 → 训练变慢。RDMA 直接把 DMA 引擎从本地 HBM 连到对端 HBM——CPU 一个 cycle 都不参与。

6. **RoCE 的拥塞控制比 InfiniBand 复杂一个数量级**：InfiniBand 是 credit-based 流控（无丢包），RoCE 是 PFC + DCQCN（避免丢包）。前者的行为确定性高得多——如果你在做 HPC 或大规模训练，这笔确定性值得你付 IB 交换机的溢价。

7. **AI 集群的物理布局决定了 all-reduce 的性能**：不是所有 GPU 之间的带宽都一样。GPU 0 和 GPU 1（同一节点，NVLink 直达）之间的通信比 GPU 0 和 GPU 500（跨节点，三层 IB switch）快 50-100 倍。Rail 拓扑、oversubscription ratio、PFC buffer 配置——这些硬件的物理现实直接塑造了训练代码中最底层通信原语的耗时。

---

下一节 → [指令集架构：x86 / ARM / RISC-V](isa-design.md)
