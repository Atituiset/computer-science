# 5. 全书地图: 14 部分与导论的交叉索引

## TL;DR

导论卷最后一篇, 把书中 **14 个部分** (导论卷 + 第零部分数学 + 13 主题) 全部丢到一套二维矩阵上, 让读者**一眼定位"我读这章它在讲什么 / 在哪一站 / 在历史和抽象层级哪一格"**, 同时给出四类读者画像的纵贯走法、按"查新资料归属"的 SOP、以及每章入口建议.

读完应能:
1. 不再在"现在我读哪章"上犹豫 — 用三张矩阵给任意新资料归位.
2. 凭四个典型读者画像 (后端工程师 / 移动 App 工程师 / ML 工程师 / 硬件 / 嵌入式工程师) 各自挑通缩短到对应章节.
3. 看到"我现在缺什么"立刻找书必看哪章.

---

## 一、合成的四视图

导论把全书骨架按 **4 个相互正交的视图** 抽出, 每视图各答一个问题:

| 视图 | 章节 | 答的问题 |
|------|------|---------|
| **时间轴** | [history](history.md) | 这东西什么时候出现? 出现那一年的"硬件 + 软件 + 用户"三联状态是什么? |
| **抽象层级** | [abstraction-layers](abstraction-layers.md) | 它在哪一层? 给上层什么契约? 依赖下层什么不变式? |
| **形态演进** | [mainframe-xpu](mainframe-xpu.md) | 它服务于哪类用户群? 用什么芯片 + 什么软件范式? |
| **承接链** | [standing-on-shoulders](standing-on-shoulders.md) | 它的上一站契约是谁? 它对下一站指挥谁? |

本页 (map) 再把上面 4 视图按"14 部分 × 4 视图"**二维矩阵化**, 让你能在矩阵里点一个格, 知道这格的全部上下文.

---

## 二、14 部分 × 抽象层级 矩阵

| 部分 / 抽象层 | 1 物理 | 2 模拟 | 3 RTL | 4 microarch | 5 ISA | 6 内核 | 7 POSIX | 8 运行时 | 9 应用 | 10 AI |
|---|---|---|---|---|---|---|---|---|---|---|
| **导论** | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ |
| **0** 数学 | — | — | — | 工具 | — | — | — | — | — | 工具 |
| **1** DSA | — | — | — | — | — | — | — | ● | ○ | — |
| **2** OS | — | — | ○ | ● | ● | ◯ | ◯ | ○ | — | — |
| **3** 网络 | — | — | — | ○ | — | ● | ● | ○ | ◯ | — |
| **4** DB | — | — | — | ○ | — | ● | ● | ○ | ◯ | — |
| **5** 编译 | — | — | — | ○ | ◯ | ○ | ○ | ● | ◯ | — |
| **6** 分布式 | — | — | — | — | — | ○ | ● | ○ | ◯ | ○ |
| **7** 系统设计 | — | — | — | ○ | — | ○ | ● | ○ | ◯ | ○ |
| **8** 组成原理 | ● | ● | ● | ● | ◯ | ○ | — | — | — | ○ |
| **9** 计算理论 | — | — | — | — | — | — | — | — | ● | ○ |
| **10** 密码学 | ● | ○ | ● | ● | — | — | ○ | ● | ◯ | ○ |
| **11** 信息论 | ● | ● | ● | ★ | ○ | — | ○ | ● | ◯ | ★ |
| **12** AI/ML | — | — | — | ○ | ○ | ○ | ○ | ○ | ◯ | ● |
| **13** 元抽象 | — | — | — | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

**符号说明**:
- `●` 该部分**主线章节**在这层
- `◯` 强相关 (但非主线)
- `○` 触及但不深入
- `★` 跨层桥接专项 (e.g. 信息论的 Shannon 容量把第 3 层 RTL 与第 10 层 AI 用同一组数学串起来)
- `⤴` 导论卷贯通所有层
- `—` 不涉及

**怎么用这张表**:

- **横看一行**: 一个部分主要钻研哪些层.
  例: 第 2 OS 横跨 4-7 层 (microarch + ISA + kernel + POSIX); 第 8 组成原理横跨 1-5 (硬件视角); 第 12 AI/ML 纵跨 4-10 (训练靠 GPU + PyTorch 运行时 + 模型本身).
- **纵看一列**: 某抽象层被哪些部分讲解.
  例: 第 4 层 microarch 主要由第 8 部分讲, 第 10 与第 11 部分做硬件级桥接 (Spectre 在第 10 侧信道里用, 第 11 LDPC/Polar Tanner 图里涉及微架构并发结构).
- **空白诊断**: 你接到一份任务, 想"我不熟第 X 层", 纵列扫立刻找到对应部分.

---

## 三、14 部分 × 形态演进 矩阵

| 部分 / 形态 | Mainframe | Mini | PC | MCU | Mobile/ARM | Cloud/Web | AI/XPU |
|---|---|---|---|---|---|---|---|
| 导论 | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ |
| 0 数学 | — | — | — | — | — | — | 工具 |
| 1 DSA | — | ○ | ○ | ○ | ○ | ○ | ○ |
| 2 OS | ● | ● | ● | ◯ | ○ | ◯ | ○ |
| 3 网络 | ○ | ○ | ● | ● | ◯ | ◯ | ○ |
| 4 DB | ● | ● | ◯ | — | — | ◯ | ○ |
| 5 编译 | ○ | ● | ● | ○ | ● | ◯ | ◯ |
| 6 分布式 | — | — | ○ | — | ○ | ● | ○ |
| 7 系统设计 | — | — | — | — | ○ | ◯ | ◯ |
| 8 组成原理 | ● | ● | ● | ● | ● | ● | ◯ |
| 9 计算理论 | — | — | — | — | — | — | ○ |
| 10 密码学 | ◯ | ○ | ○ | — | ● | ◯ | ○ |
| 11 信息论 | ● | — | — | — | — | — | ○ |
| 12 AI/ML | — | — | — | — | ○ | ○ | ● |
| 13 元抽象 | ○ | ○ | ○ | ○ | ○ | ○ | ○ |

**怎么用**:

- 一行告诉你这部分笔记**主要面向哪种形态设计**.
- 例: 第 4 DB 在 Mainframe / Mini 时代主战, Cloud/Web 时代仍是后端核心; 第 12 AI/ML 几乎只在 AI/XPU 段才出现 (其前身可追到 1957 Rosenblatt perceptron, 但没 XPU 算力就上不了规模).
- DSA / 计算理论 / 元抽象与硬件形态弱关联, 它们是"平台无关的抽象研究".

---

## 四、14 部分 × 历史年代 矩阵

| 部分 / 年代 | 1936-44 | 45-70 | 71-90 | 91-06 | 06-15 | 16-23 | 24-26 |
|---|---|---|---|---|---|---|---|
| 导论 | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ | ⤴ |
| 0 数学 | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| 1 DSA | — | ● | ● | ● | ◯ | ◯ | ○ |
| 2 OS | — | ● | ◯ | ◯ | ○ | ○ | ○ |
| 3 网络 | — | ARPANET | ● | ◯ | ○ | QUIC | XDP/DPDK |
| 4 DB | — | ● | ● | NewSQL | NewSQL | Vector | Vector DB |
| 5 编译 | — | ● | ● | GCC/LLVM | JIT | — | MLIR |
| 6 分布式 | — | — | — | ● | ◆ | ◆ | ◆ |
| 7 系统设计 | — | — | ○ | ● | ◆ | ◆ | Operator+MCP |
| 8 组成原理 | ● | ● | ● | ● | ● | ◆ | XPU+HBM4 |
| 9 计算理论 | ● | ● | ○ | ○ | ○ | — | — |
| 10 密码学 | ○ | ● | ● | ○ | ECC/ZKP | TLS 1.3 | PQC |
| 11 信息论 | ● | ● | ○ | ◆ | LDPC/Polar | — | 深化 |
| 12 AI/ML | — | ○ | ○ | ○ | ● | ● | ◆ |
| 13 元抽象 | — | — | — | — | — | ● | ○ |

符号: `◆` 该年代此部分是其最热的研究方向之一.

**怎么用**:

- **纵看一列**告诉你"在那个年代里跟上主流要读哪几章".
- 例 2024-26 列: 主线 8 (XPU+HBM4) + 12 (AI/ML 大模型推理) + 7 (Operator+MCP) + 6 (分布式训练) + 5 (MLIR) 各章合 AI 故事; 11 (信息论深化) + 10 (PQC 抗量子) + 13 (元抽象) 给补底.
- **横看一行**告诉你"这部分在哪几段是 hot, 哪几段是支撑".

---

## 五、四类典型读者画像的纵贯走法

不同背景的人读完导论, 推荐的"主线缩短" 路径不同. 这里给 4 个画像 + 各自 4 视图的"主题必看" 与 "纵贯加速":

### 5.1 画像 A: Web 后端工程师

- 你已熟: HTTP / SQL / Docker / K8s / 微服务
- 你要补:
  - **横切主线**: 第 3 网络 (`networking/README.md`) — 隧道深入 TCP/QUIC; 第 4 DB (`databases/README.md`); 第 6 分布式 (`distributed/README.md`); 第 7 系统设计 (`system-design/README.md`)
  - **AI 主轴**: 第 0 数学 → [线代](../math/linalg.md) → [概率](../math/prob.md) → 第 12 AI/ML (`ai-ml/README.md`) (训练 + 推理服务)
  - **纵贯加速**: 第 2 OS (`os/README.md`) — linux 内核 epoll / io_uring 会让你 RPC / DB 性能提升
  - **形态演进**: 第 8 组成原理里的 [interconnects](../computer-arch/interconnects.md) / [memory-hierarchy](../computer-arch/memory-hierarchy.md) — 知道 AWS Nitro / 阿里 CIPU 与 NVMe-of 在数据中心怎么排布
- **预估时间**: 上述 4 部主学科加 2 部辅助 ≈ 30-40 小时

### 5.2 画像 B: 移动 / App 工程师

- 你已熟: Swift / Kotlin / Flutter / iOS / Android, app 架构
- 你要补:
  - **横切主线**: 第 8 组成原理 (`computer-arch/README.md`) — ARM v9 / NPU; 第 12 AI/ML (`ai-ml/README.md`) — 端侧推理 / Apple Intelligence / NPU 模型
  - **AI 主轴**: 第 0 数学概率 + 微积分 (训练后小程序); 第 12 foundations/transformer (端侧推理)
  - **纵贯加速**: 第 2 OS (`os/net/README.md`) — 移动 OS 实际是 Linux + libc / Apple Darwin; 第 5 编译 (`compilers/codegen/jit.md`) — V8 / HotSpot / Swift runtime
  - **形态演进**: 第 5 节 [mainframe-xpu §6 ARM/移动](mainframe-xpu.md#六阶段-5-arm--移动-2007-)
- **预估时间**: 30-50 小时

### 5.3 画像 C: ML 工程师

- 你已熟: PyTorch / Transformer / 模型 fine-tune
- 你要补:
  - **横切主线**: 第 0 数学 ( пора → 已具备则 skip); 第 8 组成原理 (GPU SM / NPU / Tensor Core / HBM / 互联); 第 12 AI/ML 全部
  - **纵贯加速**: 第 2 OS (NCCL / RDMA / GPU 隔离); 第 6 分布式 (ZeRO / Megatron / Pipeline 并行); 第 7 系统设计 (推理服务 + KV cache + 限流)
  - **承接链**: 看 [standing-on-shoulders §AI 主轴](standing-on-shoulders.md#五编译器--高级语言让机器可读变成人可写) — AI 训练不靠 Deng 基础承接链跑不动
  - **形态演进**: AI/XPU 段全看 (`mainframe-xpu.md#八阶段-7-ai--xpu-异构时代-2012-`)
- **预估时间**: 50-80 小时 (这条最长, 因为 ML 是横切最广的方向)

### 5.4 画像 D: 硬件 / 嵌入式工程师

- 你已熟: Verilog / RTL / MCU / 时序约束
- 你要补:
  - **横切主线**: 第 8 组成原理 (cpu-pipeline / superscalar / memory-hierarchy / gpu / ai-accelerators 全部); 第 2 OS (`os/README.md`) 看到硬件 / 内核 / 驱动的对接; 第 10 密码学 (`crypto/sidechannel.md`) Spectre / Meltdown; 第 11 信息论 (`info-theory/README.md`)
  - **AI 主轴**: 第 0 数学线代 + 概率 → 第 12 AI/ML (要知道 attention 张量形状如何映射到 Tensor Core / NPU)
  - **纵贯加速**: 第 5 编译 (`compilers/sema/ssa.md`) MLIR / SSA 是硬件描述顶层; 第 9 计算理论 (`theory/automata.md`) DFA / FSM 与 RTL 状态机对偶
  - **形态演进**: 全段都看, 你要纵串了
- **预估时间**: 60-80 小时

---

## 六、独立主线地图

### 6.1 横切 (按学科)

每部分一句话定位 + 入口页 + 推荐阅读时长:

| 部分 | 一句话 | 入口 | 估读时长 |
|------|------|------|-----|
| 0 数学 | 离散+线代+概率+优化, 喂全书全部 | [math/README](../math/README.md) | 8-12h |
| 1 DSA | 数据形态 × 性能空间的设计空间 | [dsa/README](../dsa/README.md) | 20-30h |
| 2 OS | 把硬件封成可写代码的虚机器 | [os/README](../os/README.md) | 15-25h |
| 3 网络 | 协议分层 + 拥塞 + modern stack | [networking/README](../networking/README.md) | 15-20h |
| 4 DB | 并发 / 故障下状态一致 | [databases/README](../databases/README.md) | 15-20h |
| 5 编译 | 把人话变机器码的流水线 | [compilers/README](../compilers/README.md) | 15-20h |
| 6 分布式 | 让 N 台机器表现得像 1 台 | [distributed/README](../distributed/README.md) | 12-18h |
| 7 系统设计 | 反推 + 分解 = 工程师能力核心 | [system-design/README](../system-design/README.md) | 12-18h |
| 8 组成原理 | 从晶体管到 XPU 的硬件栈 | [computer-arch/README](../computer-arch/README.md) | 20-30h |
| 9 计算理论 | 什么是可计算 / 高效可计算 | [theory/README](../theory/README.md) | 10-15h |
| 10 密码学 | 把对抗难度转移为协议设计目标 | [crypto/README](../crypto/README.md) | 12-18h |
| 11 信息论 | Shannon 极限的工程化 | [info-theory/README](../info-theory/README.md) | 12-15h |
| 12 AI/ML | 数据替代显式规则的程序写法 | [ai-ml/README](../ai-ml/README.md) | 15-25h |
| 13 元抽象 | 把 1-12 横通, 上钻一层 | [_meta/README](../_meta/README.md) | 6-10h |

**总计**: ≈ 200-280 小时通读全书完整深度 ≈ 11-15 周 (周 20 小时). 但你不必通读, 各画像只读对应 4-6 部即可入门.

### 6.2 纵贯线: 不同形态的"一台设备走通 14 部分"

形态演进每个段都给出"在那段你手中, 这套抽象层级怎么落下来":

#### A. Large-scale 训练集群 (2026 H100/H200/B200/GB200 pod)

```
物理 (1)       HGx 中心机房供电 200 MW; 水冷闭环; HBM4 stack 工艺
模拟 (2)       SRAM cell 在 SRAM cache bank
RTL  (3)       NVIDIA SM 内部 RTL; NV-HBI 双 die 互连; CXL 3.0 PHY
microarch(4)   SM + Tensor Core + Warp scheduler + 内存 pool; HBM3e/4
ISA   (5)      PTX + SASS; host x86-64 / ARM / GPU kernel
kernel(6)      Linux + NCCL 2.x + MOFED + eBPF + io_uring
POSIX (7)      GPU driver + RDMA verbs + epoll + io_uring_setup
运行时(8)      PyTorch (Python+Triton) + CUDA  + cuDNN + cuBLAS
应用 (9)       Megatron + DeepSpeed + Ray + Wandb 监控
AI   (10)      Transformer 训练 / 扩散 / VAE / 推理优化
```

涉及的本书部分: 8 + 2 + 5 + 6 + 7 + 12. 这条线就是 [standing-on-shoulders §AI 主轴](standing-on-shoulders.md#八ai-状态机的高维模式化) 的硬件对照版.

#### B. 你口袋的 iPhone / Android 手机 (2026)

```
物理 (1)       A18 / Snapdragon 8 Elite 3nm 工艺
模拟 (2)       LPDDR5X + PMIC + PMU + OMAP
RTL  (3)       Apple P-core + E-core + GPU + NPU RTL
microarch(4)   OoO + 深流水 + 共享 L2 + imprecise branch pred
ISA   (5)      ARM v9 / SVE2
kernel(6)      Darwin XNU / Linux 6.x + Android
POSIX (7)      bionic libc + Mach-O + libdispatch + ulib
运行时(8)      Swift / Kotlin / JNI + ART JIT + WebKit JIT
应用 (9)       iOS App / Android App; WebGPU in browser
AI   (10)      Apple Intelligence / Google Gemini Nano 端侧推理
```

涉及的部分: 8 + 2 + 5 + 12 + (3 网络部分, 因 app 都用 HTTPS). 这就是 [mainframe-xpu §6 ARM/移动](mainframe-xpu.md#六阶段-5-arm--移动-2007-) 一个具体例子.

#### C. 你公司后台的云原生服务 (2026)

```
物理 (1)      云数据中心; SSD / nvme-of
模拟 (2)      HBM on cache-LLC; DRAM
RTL  (3)      (N/A 该层工程几乎不接触)
microarch(4)  x86 / Graviton / Xeon-D 多核 + AVX-512 / AMX
ISA   (5)     x86-64 / ARM v9
kernel(6)     Linux + cgroup v2 + io_uring + eBPF
POSIX (7)     rsyscall + epoll_wait; gVisor / Firecracker
运行时(8)     Go runtime + Java Hot + V8 + containerd
应用 (9)      K8s + envoy + prometheus + gRPC + DB
AI   (10)     LLm tool use + RAG + 推理服务 + observability
```

涉及的部分: 2 + 3 + 4 + 6 + 7 + 12. 这是大多数 Web 后端工程师日常的纵贯.

#### D. 智能家电 / IoT 端节点 (2026)

```
物理 (1)    55nm MCU / 22nm RF SoC
模拟 (2)    ADC + DAC + LDO + RF front-end
RTL  (3)    Cortex-M33 RTL + BLE 控制器
microarch(4) 2-4 stage pipeline + FPU + TCM + NVIC
ISA   (5)   ARMv8-M / RISC-V RV32
kernel(6)   Zephyr / FreeRTOS / 无 OS
POSIX (7)    (部分实现 POSIX 子集)
运行时(8)   MicroPython / Rust no_std + embassy
应用 (9)    sensor 驱动 + MQTT 客户端; edge ML 推理
AI   (10)   小模型 on TFLite Micro / CMSIS-NN / NPU
```

涉及的部分: 8 + 2 + 5 (轻) + 12 (轻). 形态见 [mainframe-xpu §5 单片机](mainframe-xpu.md#五阶段-4-单片机与嵌入式-1976-).

### 6.3 AI 主轴 (2024-2026 这三年最热路径)

```
0 数学 ─→ 8 组成原理 (GPU/NPU/HBM/互联) ─→ 2 OS (io_uring/RDMA)
                                                     │
                                                     ↓
5 编译(MLIR) ←─ 4 DB (vector DB) ←─ 6 分布式(ZeRO/Pipeline)
                                                     │
                                                     ↓
                          7 系统设计(推理服务) ─→ 12 AI/ML (训练+推理)
                                                     │
                                                     ↓
                                          13 元抽象 (hardware → software)
```

任意一段 missing 都读不下去. 这条线已经实际超过其他横切主线单条的总人数 (2024+ LLM / GenAI 工程师数 ~500 万 vs 传统 web 后端 ~1500 万, 但 AI 主轴增长更快).

---

## 七、看新资料归位的 SOP

下面是**用这页矩阵给任意新文档归位**的 5 步操作:

```
Step 1. 看"它讲的是什么主概念" → 在 §2 横切里挑 1-3 个匹配部分
Step 2. 看"它针对哪种设备 / 用户" → 在 §3 形态里挑 1-2 个匹配
Step 3. 看"它大致什么时代出现 / hot" → 在 §4 年代里挑 1 个匹配
Step 4. 看主要部分字:
  - "GPU/NPU/HBM/CXL"  → §8 + §12
  - "kernel / syscall / io_uring / eBPF" → §2
  - "TCP / QUIC / TLS / HTTP" → §3
  - "schema / SQL / WAL / MVCC / LSM" → §4
  - "AST / IR / SSA / register alloc" → §5
  - "Paxos / Raft / quorum / CRDT" → §6
  - "cache / queue / sharding / rate limit" → §7
  - "transistor / IS pipeline / SIMD" → §8
  - "DFA / PDA / P vs NP / Turing" → §9
  - "AES / RSA / ECC / ECDHE / ZKP" → §10
  - "entropy / capacity / LDPC / Polar" → §11
  - "softmax / Transformer / VAE / diffusion / Adam" → §12
  - "amortized vs worst / 为什么 deep net 可训" → §13
Step 5. 在矩阵上行+列打个 ●; 读完这页就画上 ●.
```

**示例**: 给你一份"Groq LPU 推理 7B 模型 benchmark 白皮书". 走完 5 步:

1. 主概念 = 推理 ASIC + LLM → §8 + §12
2. 设备 = XPU 数据中心 → §3 形态 AI/XPU
3. 时代 = 2024-26 → §4 年代号
4. 关键字 = "LPU / Tensor Core / 互联带宽" → §8
5. 矩阵定位 = (§8, §12 行 vs AI/XPU 列 vs 2024-26 列).

→ 立刻知道你**必须先读第 8 组织原理响应章节 + 第 12 transformer 章节**, 才不再卡白皮书里 "macro-op fusion vs VLIW" 类词.

---

## 八、阅读模型

读完导论 5 章, 你应该形成如下"心智图":

- 看一份新文档 / 论文 / 白皮书, 你能在 30 秒内:
  1. 把它的主题归类到某些部分 (横切)
  2. 把它的硬件代归类到某段形态 (纵贯)
  3. 把它入口处的定义对应到某个抽象层
  4. 识别它依赖的契约以及可能泄漏源

这就是"计算机基础知识体系"的本质 — 任何进步的动作都是"在一层抽象里看到一个新机制", 而不是凭着名词链条不停换字眼.

---

## 九、与导论各章的接口

| 导论章节 | 它给本页提供什么 |
|---------|-------------------|
| [history](history.md) | 时间轴内容 → 填 §4 年代矩阵 |
| [abstraction-layers](abstraction-layers.md) | 10 层金字塔 → 填 §2 抽象层级矩阵 |
| [mainframe-xpu](mainframe-xpu.md) | 7 段形态演进 → 填 §3 形态矩阵 |
| [standing-on-shoulders](standing-on-shoulders.md) | 承接链 → 填 §6.2 不同形态纵贯 |
| [本页 map](map.md) | 把上述 4 视图**对齐到 14 部分**, 给查表 SOP |

---

## 十、给导论一份结束

- [history](history.md): 时间轴 1936 → 2026
- [abstraction-layers](abstraction-layers.md): 抽象层 10 层
- [mainframe-xpu](mainframe-xpu.md): 形态演进 7 段
- [standing-on-shoulders](standing-on-shoulders.md): 承接链
- [本页 map](map.md): 交叉索引

读完导论 5 章, 你应该能在矩阵的 56 格 (14 部分 × 4 视图) 中**为任意一份新材料归位**, 再下钻各主题时不再"信息孤岛". 这就是这套笔记"由导论到 13 主题" 的阅读模型.

---

## 十一、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **三张矩阵**: 14 部分 × (抽象层级 / 形态演进 / 年代). 一行 = 一个部分的"在哪几个轴有重心"; 一列 = 一个轴上"哪几个部分热门".
> - **四类读者画像**: web 后端 / 移动 app / ML / 硬件嵌入式 — 四条缩短的纵贯路径.
> - **AI 主轴** (2024-26): 0 → 8 → 2 → 5 → 4 → 6 → 7 → 12 → 13 — 是当前最热的工程栈.
> - **SOP**: 看一份新文档 5 步归位 (主概念 → 形态 → 年代 → 关键词 → 矩阵 ●).
> - **全书读完时**: 用矩阵把每格都打 ●, 你就完成了"计算机基础知识体系"的入门.

---

回主目录:
- [导论 README](README.md)
- [全书 README](../README.md)
