# 3. 形态演进: 大型机 → PC → 单片机/ARM → 云 → Web → AI → XPU

## TL;DR

计算机 90 年史, 物理形态大致经过 **7 段** 演化. 每一段新形态不是上一段的"放大版/缩小版", 而是**新的契约 + 新的使用人群 + 新的工程师心智模型**:

1. **大型机 (mainframe)**: 5 大单位共用 1 台机器, 分时.
2. **小型机 (minicomputer)**: 实验室级, 关键用户开放.
3. **个人计算机 (PC)**: 桌面 1 人 1 机.
4. **单片机 (MCU) / 嵌入式**: 物联网之家家电、汽车、卡片电脑.
5. **ARM / 移动**: 口袋超算, RISC 一夜成反主流. 同时云计算也起飞.
6. **Web / 云原生**: 用户运行不再占设备, "数据在云上, 浏览器即终端".
7. **AI / XPU**: 数据中心向张量机倾斜, 在 N 年内 GPU / NPU + CPU 共生, 异构成为主流.

每段不仅硬件变, 软件 / 用户 / 商业模式也变. 我们把"形态学"这一节当作"硬件 + 软件 + 人的契约" 三联一起讲.

读完应能: 给一台新设备 (e.g. Groq LPU / Apple Vision / 某家国产 7nm 服务器芯片) 立刻判断它在哪一段 / 在异构谱系哪一端 / 它依赖上一段哪些遗产.

---

## 一、形态演进总图

```
1960.DataBindings
┌──────────────────────────────────────────────────────────────────┐
│ 1. Mainframe (IBM 360 / 370 / z)            单台 / 分时共享    │
│ 2. Mini (PDP-11 / VAX)                        实验室级          │
│ 3. PC (x86 / PC-clone)                     1 人 1 机, 平民化   │
│ 4. MCU / 嵌入式 (Arduino / Pi / 单片机)    几人franc块           │
│ 5. Mobile (ARM 手机 / 平板)                  口袋超算           │
│ 6. Cloud / Web (AWS / Azure / GCP)         1 服务 / N 用户      │
│ 7. AI / XPU (H100 / NPU / TPU / 量子预研)   分工化算力          │
└──────────────────────────────────────────────────────────────────┘
```

每一阶段, **单台算力 + 人数 + 软件范式** 这三条线互相带火. 表三条线随时间:

| 阶段 | 代表硬件 | 算力 (相对) | 用户数 (相对) | 软件范式 |
|------|----------|------|--------|---------|
| Mainframe | IBM 360/370 | 1 (基线) | 共享 100 量级 | 批 / 分时, COBOL / Fortran, 卡片 |
| Mini | PDP-11/VAX | 0.3 | 1000+ (研究) | Multics, Unix 雏形, C |
| PC | x86 + DOS/Win | 0.5-2 | 1 亿-10 亿 | 桌面 GUI, C++, JS |
| MCU | ATmega / stm32 | 10⁻³ | ─ (隐入背景) | baremetal / RTOS |
| Mobile | ARM64 SoC | 1-5 | 60 亿 (手机) | App Store / 触屏 |
| Cloud | x_a7 / Graviton | N × 大机架 | 数亿共享 | 容器 / IaC / 微服务 |
| AI / XPU | H100 / B200 / TPU / NPU | N × GPU × 100 | 数百万开发者 | 框架 (PT/JAX) + Agent |

---

## 二、阶段 1: 大型机 (1965-)

### 2.1 物理形态

- 一台 IBM S/360 = 几个机柜, 水冷, 卷磁带库, 集中管理. 当年 "data processing department".
- 操作系统 OS/360 (later MVS / VM / z/OS); 任务, JCL (Job Control Language).
- 编程范式: COBOL (商业), FORTRAN (科学), PL/I (混合), 后来 RPG, 汇编.

### 2.2 契约 / 不变式

- **批处理 + 分时 (TSO)**:
  - 批: 提脚本 → 等结果. 用 JCL 描述作业调度.
  - 分时: 写终端 (3270) 上 ISPF.
- **可靠为先**: 7x24 不停. RAS (Reliability/Availability/Serviceability) 重于性能.

### 2.3 至今大型机仍在使用

- IBM z15 / z16 用 5nm 工艺, 跑 z/OS, 在银行 / 航空 / 政府仍主力. 其工作负载大多是 COBOL 老 transaction 处理系统; 据估计全球 200K+ COBOL 程序员仍在岗.

> [!NOTE]
> 大型机最不常见的契约是 "**已知不停年数 70+**". 把银行核心交易移到云或 Kubernetes 等价要重建这套 SLA 的工程量. 这就是为什么 80 年代预言"大型机必死"至今没兑现.

---

## 三、阶段 2: 小型机 (1965-1985)

### 3.1 PDP/VAX

- **DEC PDP-8** (1965): 第一台 < $20K 的小型机 → 大学实验室都能买.
- **PDP-11** (1970): 决定性影响, 给 Ken Thompson & Dennis Ritchie 写 Unix 用. C 语言在此诞生.
- **VAX-11/780** (1977): 32 位, 单机虚拟内存, 标准 1 MIPS 性能基准.

### 3.2 关键遗产

- **Unix** 与 **C** 都在 PDP 上诞生 → 第一份与硬件解耦的 OS + 语言 (1973 C 重写 Unix kernel). → 后续 Linux / BSD / Solaris 全都站着.
- **分时系统 Unix** 让程序员直接交互式开发, 不再写卡片等一天.

### 3.3 1980 后逐渐让位 PC

- minicomputer 因 PC 在性能上赶上 (80486 一代) 而 vax 都被 Sun / SGI 工作站替代 → 进一步 PC / Linux 替代.

---

## 四、阶段 3: 个人计算机 (1981-)

### 4.1 形态定义

- 单台桌上机, 价格 $1000-5000, 1 人 1 机.
- **IBM PC 开放架构** (1981): IBM 只把 BIOS 留 copyright, 其它都让外面 chip 厂做; Compaq 等做 clean-room BIOS → PC clone 洪流 → x86 + DOS 标准.
- **Wintel 联盟** (Windows + Intel): 1990s 主导.

### 4.2 操作系统迭代

- MS-DOS 1.0 (1981) → 6.22 (1994).
- Windows 1.0 (1985) → 3.x (1990-1993) → 95 / 98 (1995-1998) → NT / 2000 / XP / 7 / 10 / 11.
- 终于 Windows + Office 成为商业上标准应用.

### 4.3 关键软件革命

- VisiCalc (1979 Apple II) 第一代 killer app; Lotus 1-2-3 → Excel 接力.
- Internet 同期借助浏览器从科研拉到家里 (Mosaic → Navigator → IE → Firefox → Chrome).

### 4.4 形态不变但内部 XPU 化

- 至 2024-2026, 校园 / 办公 PC 大多内含 NPU (Apple Neural Engine / 骁龙 Hexagon / Intel / AMD NPU); 传统桌面任务在 CPU, 视频处理在 GPU / NPU 媒体引擎, AI 推理在 NPU. 用户的"键盘手"完全感受不到分工, 但芯片任务被分配得像 Viking 时代分工一样精细.

---

## 五、阶段 4: 单片机与嵌入式 (1976-)

### 5.1 8-bit 单片机史

- Intel 8048 (1976)、8051 (1980) — 集成 CPU + RAM + ROM + IO 在一片, 既家电控制也打印机控制.
- Microchip PIC, Atmel AVR — 90 年代起家电 / 工业占比大.
- 32-bit ARM Cortex-M (2004+) — 给嵌入式加上 MMU-less 32 位 → MCU 进入位数升级时代; 现代智能家居系列用 STM32 / nRF52 / ESP32.

### 5.2 关键契约与约束

- 8/16-bit 单片机典型几十 MHz, 几 KB SRAM, 几十 KB Flash; 低功耗 (< mA @ 3.3V) 比性能重要.
- 程序循环 + 中断驱动, 裸跑或 RTOS (FreeRTOS / Zephyr).
- 适配硬件 IO 与外设协议 (I2C / SPI / UART / CAN), 这是 [操作系统 + 编译原理] 的下边界实践.

### 5.3 树莓派 / 嵌入式 Linux 与新形态

- Raspberry Pi (2012 起) = ARM 单片机 + Linux; 普通人可以 35 美元跑完整 OS + python.
- BeagleBone Black / Jetson Nano / Coral Dev Board — 边缘 AI 推理板, AI 工业应用入门.

> [!WARNING]
> 单片机不像服务器: 没虚拟内存、没 OS 保护、通常没 fork、可能没浮点单元、int 大小因编译器变. 把 X86 心智照搬过去会出错—这就是为什么 MCU 章节经常与"嵌入式 C"配套教.

### 5.4 物联网 (IoT) 与 MICRO-CLOUD 端

- IoT 设备峰值数十亿台 ↔ 几十亿 IP; 6LoWPAN / MQTT / CoAP / OPC UA 等协议.
- 数据汇总到边缘网关 → 上云 / 流式 → ML 推理再下沉到端 (端 NPU) 的"edge ML" 链路成主流.

---

## 六、阶段 5: ARM + 移动 (2007-)

### 6.1 ARM 历史

- **Acorn Archimedes + ARM1** (1985): Acorn Computers 设计的低功耗 32-bit RISC CPU.
- **ARM (公司) 1990 独立**, 商业模式 = **ISA 授权 + 核授权**: 谁都拿 ARM 设计 → Apple A 系列 / Snapdragon /Samsung Exynos / 联发科 Dimensity / 华为麒麟 / Google Tensor; 都按 ARM 几亿片付版税.
- **ARM 在 2007 iPhone 起进入手机主流**, 2010 iPad, 2020 Apple M1 桌面 / 笔记本, 2018 AWS Graviton 进数据中心, 2023 通 Microsoft Windows on ARM, 2024+ 自研车规级芯片 (Tesla / 高通 8295 / 联发科).

### 6.2 RISC 与 CISC 的胜负史

```
1980 x86 CISC 起 ← IBM PC 路线
1985 ARM1 RISC
1990 RISC 工作站死 (Sun/SGI 让位 PC)
2000 x86 由摩尔推往更快
2005 单核停 → x86 强向多核, 但功耗不行入手机
2007 iPhone ARM
2010 ARM Cortex-A 系打平 x86 性能/瓦
2020 Apple M1 在桌面都胜 x86
2024+ ARM 的 Neoverse V/N 与自研 (Graviton / XuanTie / 阿里 倚天)成型成为数据中心升
```

**关键**: RISC 并未在 1990 年工作站时代赢; 它是在 **mobile / 功耗 / 集成 SoC** 这一新形态上 2007+ 赢, 再逆向卷回桌面与数据中心.

### 6.3 形态新约: App + 触屏 + 推送

- 用户在触摸屏上手势/语音交互; 通知 / 推送代替弹窗; 后台 / 前台切换由 OS 自动; 电池结构作为合约 (energy budget per app).
- 操作系统 iOS / Android 主流, **沙箱 + 审核制 + 应用商店分发** 与 PC 时代相比完全变了软件商业模式.
- API 重心从 Linux 系统调用移到 Apple SDK / Android SDK; JNI/Swift/Flutter/React Native 跨平台层多样.

### 6.4 ARM 在 2024-2026 的姿态

- ARMv9 + SVE2 与 CXL / 一致性 / page table 多机架化扩展 (CCIX → CXL 4.0) 进一步强化数据中心能力.
- Apple M5 / 骁龙 X2 Elite / Nvidia Grace — 桌面 / PC / 服务器 ARM 都路线成熟; x86 走异构 + chiplet + AI 加速的 binary compatibility.
- 中国: 阿里平头哥 倚天 / 华为 昇腾 CPU + 鲲鹏 / 飞腾 / 龙芯 / 海光 — 在政企 / 信创 / 金融大批量部署.

---

## 七、阶段 6: Web 与云计算 (1995-)

### 7.1 Web 1.0 → 2.0 → 3.x

- **Web 1.0** (1991-2004): 静态 HTML + 链接 + 邮件; 浏览器看网页.
- **Web 2.0** (2004-): AJAX + UGC (User Generated Content); Wikipedia / YouTube / Facebook / Twitter 起势; JavaScript + CSS + DOM 成熟框架 (jQuery → React → Vue / Angular).
- **Web 3.0** (2014-): Blockchain + decentralized identity + 媒介原资产, 部分 industrial deployment 但仍是 experimental.
- **Web 与 LLM 时代** (2023-): 浏览器内嵌 LLM (Edge Copilot / Brave Leo), Browser-LLM 协议 (MCP, etc).

### 7.2 云原生态

- **AWS EC2** (2006) 起, 一切 on-demand; **S3** 对象存储; **RDS** 一键数据库. 资本支出从机房 → "API 一个 form".
- 容器化 (Docker 2013), Kubernetes (2014-2018), service mesh, GitOps, IaC (Terraform / Pulumi / Crossplane).
- "无服务器 (serverless)": Lambda / FaaS / EventBridge — 上层抽象更上一层, 工程师不接触实例.
- 2024+ 通 WebGPU / WebGPU compute API / WebAssembly 系统接口 (WASI) 让浏览器执行本地任务 (含 LLM 推理).

### 7.3 数据中心 "机房是社会"

云数据中心 (Google / AWS / Azure / 阿里 / meta / 字节 / 腾讯) 一般 10-100MW+, 需 50-100MW 风电 / 水电 / 核电配套. 在 2023+ AI 训练需求暴增, 单数据中心能力推到 1GW+ 接边; 核电 / SMR (small modular reactor) 直接进 Microsoft / Amazon 长约; 数据中心从"工程师资产"变"国家级能源政策", 是不可忽略的形态变化.

---

## 八、阶段 7: AI / XPU 异构时代 (2012-)

### 8.1 XPU 谱系

| 类 | 用途 | 当前主流 (2024-2026) |
|----|------|------|
| **CPU** | 控制流 + 低并发 | x86, ARM, RISC-V, Power |
| **GPU** | 大并行张量 | NVIDIA H100/H200/B200/GB200, AMD MI300/MI400, Intel Arc/Battlemage/Falcon Shores |
| **TPU** | 张量 ASIC | Google TPU v5p/v6 Trillium |
| **NPU** | 端侧 AI 推理 | Apple Neural Engine, 骁龙 Hexagon, MediaTek APU, Intel / AMD NPU, 华为 Ascend NPU |
| **DPU / IPU** | 网络与存储 off-load | NVIDIA Bluefield-3, Fungible / Pensando / 阿里 CIPU |
| **FPGA** | 可重配 / 小批量 | Xilinx Versal / Intel Agilex / 国产 |
| **ASIC** | 固定 workload | Groq LPU, Cerebras WSE-3 / SambaNova SN40L / Tenstorrent |
| **RAID / SmartNIC** | OS bypass | Broadcom Memory, Marvell, NVIDIA BlueField |
| **量子** | 特定子问题模拟 | IBM / Google / IonQ / Quantinuum / 国盾量子 / 本源量子 |

### 8.2 为什么 XPU 必然

- Dennard scaling 2005 止 → 单核不再提速 → 必须 SIMD / 多核 / 加速器.
- AI 训练 = 矩阵 × 矩阵 (GEMM) 大规模并发, CPU SIMD 的乱序调度远不如 GPU 的 SIMT.
- 推理 latency / 功耗关键, NPU 在 50-200 GOPS/W 比通用 CPU 5-10x 能效.
- 摩尔放缓 → 工程师换 vertical specialization: 每类算力做专门芯片 → 形成多 die + 互联 (NVLink 5 / CXL 3.0 / UALink / Infinity Fabric).

### 8.3 互联 (interconnect) 与 memory hierarchy 重塑

- 关键事实: 2024-2026 大模型训练, **算力不卡 GPU 而卡 GPU 间带宽 + HBM 容量**.
- HBM4 + CXL 3.0 + NVLink 5 / Infinity Fabric 让"memory pool" 成为单数据中心级资源.
- **背景**: 见 [第八部分 / interconnects](../computer-arch/interconnects.md) 与 [memory-hierarchy](../computer-arch/memory-hierarchy.md).

### 8.4 XPU 上的"用户" 是谁

| 类 | 用户群 |
|----|--------|
| CPU | 99% 程序员 (Linux, Python, Docker, ...) |
| GPU | ML 工程师 / 科研 / cinema render |
| TPU / 推理 ASIC | Google 内部 + Google Cloud 用户 |
| NPU | 几乎人人 (端 AI), 但不暴露编程接口 |
| DPU | 云厂商内部 + Smart NIC 工程师 |
| FPGA | 通信 / 金融高频 / 数据center 部分 |
| 量子 | 科研组与少量 crypto 实验室 |

**统一框架**: MLIR / OpenXLA / TorchTitan / SDAA — 让你写一份 PyTorch 在哪一 XPU 上都跑, 内部 dispatcher 把算子路由到对应芯片.

---

## 九、形态演进对工程师的影响

### 9.1 工程师"脑模型" 演化

- 1960 大型机时代: 排队作业 / 数据表 / 作业流 / COBOL 主导.
- 1980 PC 时代: 单人作业 / 文件 / GUI 桌面 / C / VB.
- 2000 Web 时代: client-server / DB / HTTP / PHP / Java Servlet / Spring.
- 2010 移动时代: app / 推送 / 通知 / 离线 cache / Swift / Kotlin / Flutter.
- 2020 云时代: container / K8s / IaC / GitOps / observability / micro-service.
- 2025 AI/Agent 时代: prompt + tool use + MCP + sub-agent orchestrator + model registry.

> [!WARNING]
> 这不是替代关系, 是**叠加**: 现在大型机仍有 / 单片机仍有 / PC 仍有 / 移动仍有 / 云 / AI 都仍是. 一个新的"全栈工程师"必须能在层之间切换语义, 不要总停留在写 web 后端的脑模型里.

### 9.2 形态与抽象层级的双重图

把 [abstraction-layers](abstraction-layers.md) 的 10 层叠加在这 7 段形态上, 每段形态都激活某些层:

```
形态              主要激活的抽象层级
─────────────────────────────────
Mainframe          1-7 (低层缺独立硬件锤)
Mini               3-7 (Unix 起来)
PC                 1-8 (高级语言运行时大众化)
MCU                1-5 (baremetal 与 ISA 露骨)
Mobile             1-9 (系统 → App → 触屏)
Cloud / Web        1-9 (容器 + 微服务 + 网络套接)
AI / XPU           1-10 (新增 LLM 层; 每层都革新)
```

→ 这就是为什么 AI 时代让人"压力大": 同时在 10 层里推 — 数学层 (第零部分) / 硬件层 (第八部分) / OS (第二部分) / 编译 (第五部分) / AI (第十二部分) 全被推.

### 9.3 工程师必备的"形态切换" 能力

1. 给我一段 CUDA kernel, 能定位它在第 3 (RTL) / 4 (microarch SM) / 5 (ISA) / 9 (PyTorch→ cuBLAS path).
2. 给我一段 Go 服务, 能告诉我它的 latency 受第 6 (kernel fork) / 第 7 (epoll) / 第 4 (cache miss) 哪层主导.
3. 给我一段 Transformer 训练脚本, 能告诉我它在 XPU 谱: CPU 做控制, GPU 做 GEMM, DPU/NIC 做梯度同步, HBM 做激活 cache.

---

## 十、未来 (2026+) 应看的形态信号

- **NPU 进 PC / 移动成主流**: Apple Intelligence / Windows Copilot+ / Android AI 主推.
- **CXL pool 化内存**: 数据中心级 "memory pool" 走出研究阶段, 进入商用 workload.
- **量子-经典混合协处理** (QPU-as-accelerator for crypto / material / optimization): 部分 HPC workload 上线.
- **Chiplet + die-stacking**: AMD 3D V-Cache / Intel Foveros / 台积电 CoWoS / chiplet 互联取代单大 die.
- **6G 与低轨卫星直连**: 卫星互联网补齐地球 IP (Starlink 等).
- **AI 编程范式入工程主体**: Agent / MCP / multi-tool loop 成为默认开发栈, IDE 与 git 都换头脑.

---

## 十一、与后续各部分的接口

| 形态 | 对应后续部分 |
|------|----------|
| Mainframe / Mini | 第二部分 OS 历史; 第五部分编译器历史 |
| PC | 第八部分组成原理 (CPU 流水线 / cache / ISA) |
| MCU / 嵌入式 | 第二部分 OS 至深 (RTOS / eBPF 系统级调度) |
| Mobile / ARM | 第八部分 ISA (x86/ARM/RISC-V 横向纵向) |
| Cloud / Web | 第三部分网络 + 第六部分分布式 + 第七部分系统设计 |
| AI / XPU | 第八部分 GPU/TPU + 第十二部分 AI/ML |

---

## 十二、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **七段形态**: 大型机 → 小型机 → PC → MCU → 移动/ARM → 云/Web → AI/XPU.
> - 每段不是替代: 是叠加; 在 2026 全部共存.
> - 各段对应"新用户群 + 新软件范式 + 新契约 + 新主流芯片".
> - ARM 经手机 wtt2007 反袭 + 2020 Apple Silicon 卷回桌面 + 2018 Graviton 卷入数据器.
> - XPU 不是 CPU 替代, 是分工 = 控制流 CPU / 张量 GPU / 服务 off-load DPU / 端 AI NPU / 推理 ASIC.
> - 形态与抽象层级多对多: 形态演进激活抽象层级某些段.
> - 工程师能力核心: 给一份新名词 (MEC / AI PC / agentic workload / ...) 能定位在形态 + 抽象层级哪一格.

---

下一篇: [4. 主干纵贯: CPU/内存 → OS/Linux → 网络/Web → DB → 编译 → 分布式 → AI 的承接链](standing-on-shoulders.md).
