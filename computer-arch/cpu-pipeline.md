# CPU 流水线与指令级并行

## TL;DR

CPU 执行 `add x1, x2, x3` 不是原子瞬间完成的——它经过 **取指 → 译码 → 执行 → 访存 → 写回** 五阶段流水线。 理想状态下每 cycle 完成一条指令, 但 **三种冒险 (hazard)** 会打乱节奏:

1. **结构冒险 (Structural)**: 多指令争同一硬件资源 (如单端口 L1 cache)
2. **数据冒险 (Data)**: 指令依赖前一条的结果 → forwarding / stalling
3. **控制冒险 (Control)**: 分支跳转导致流水线等待 → branch prediction / speculative execution

"IPC = 1" (每 cycle 一条) 在现实中被这三种冒险撞成 IPC ≈ 0.3-0.8 (单发射标量处理器)。 现代 CPU 通过 forwarding、branch predictor、speculation 来逼近 IPC=1。 本章推导 5-stage RISC pipeline 的每个 stage, 分析 hazards 与硬件修复代价, 最后落到真实 x86/ARM 核心 (Golden Cove、Zen 5 Cortex-X4 等等)。

---

## 一、5-stage Classic RISC Pipeline

### RISC 5 阶段

```mermaid
flowchart LR
    IF[IF: Instruction Fetch<br/>取指] --> ID[ID: Instruction Decode<br/>译码+寄存器 读]
    ID --> EX[EX: Execute<br/>ALU 计算]
    EX --> MEM[MEM: Memory Access<br/>访存(load/store)]
    MEM --> WB[WB: Write Back<br/>写回寄存器]
```

每个 stage 1 cycle, 每 cycle 一个组新指令 enters IF 同时前条指令移到下 stage。 所以 5 条指令可同时在流水线 (不同 stage), CPI = 1 (理想)。

### 例子: `ld x1, 0(x2)` (RISC-V load)

| Cycle | IF | ID | EX | MEM | WB |
|-------|----|----|----|-----|----|
| 1 | `ld x1,0(x2)` | | | | |
| 2 | `add x3,x4,x5` | `ld x1,0(x2)` | | | |
| 3 | `sub x6,x7,x8` | `add x3,x4,x5` | `ld x1,0(x2)` | | |
| 4 | ... | `sub x6,x7,x8` | `add x3,x4,x5` | `ld x1,0(x2)` | |
| 5 | ... | ... | `sub x6,x7,x8` | `add x3,x4,x5` | `ld x1,0(x2)` |

第 5 cycle 后 `x1` 数据才写回寄存器, **后读该 x1 的指令必须等**。

---

## 二、Data Hazard & Forwarding

### 三种 Data Hazard

| 类型 | 例 | 说明 |
|------|----|------|
| RAW (Read After Write) | `add x1,x2,x3` → `sub x4,x1,x5` | 后条需要等前条写完 x1 |
| WAR (Write After Read) | `add x1,x2,x3` → `sub x2,x4,x5` | 后条写 x2 不能覆盖前条读 x2 |
| WAW (Write After Write) | `add x1,x2,x3` → `sub x1,x4,x5` | 两条都写 x1, 需保序 |

WAR/WAW 主要用于 OoO 跑 (见下一章超标量); RAW 是 pipeline 最常见 hazard。

### Forwarding (Bypassing)

`add x1,x2,x3` 在 EX 结束已经有了结果 (在第 3 cycle 末尾), 但 WB 才是第 5 cycle。 如果下条指令是 `sub x4,x1,x5`, 没必要等 WB——直接从 ALU output 绕过寄存器文件 forward 到下条 ALU input:

```
Cycle 3: add EX (result in pipeline latch)
Cycle 4: sub EX — receives forwarded x1 from add latch (instead of WB register)
```

**必须加 forwarding multiplexer** + comparators 检查 dest register 与 src register 匹配。

### Load-Use Hazard

`ld x1,0(x2)` →  value 在 MEM 结束后 (第 4 cycle 末) 才能用 而 `add x3,x1,x4` 在第 3 cycle EX 开始等不到。 一个 bubble (pipeline stall) 插等:

| Cycle | IF | ID | EX | MEM | WB |
|-------|----|----|----|-----|----|
| 3 | `add` | `ld` bubble | `ld` | | |
| 4 | `add` | `ld` bubble | bubble(EX stall) | `ld` | |
| 5 | `add` 后指令 | `add` (check x1) | bubble | bubble | `ld` |

只能 stall 1 cycle, 不可能 forwarding 前 收 (MEM 值， EX 太早).

现代 CPU 编译 器可以重新排序 `ld` → `few independent instructions` → `use` 隐藏潜伏期。

---

## 三、Control Hazard & Branch Prediction

### 分支代价

```
beq x1, x2, target
```

第 3 cycle EX 结束才知道 taken or not。 但是直到第 3 cycle 结束 流水线 already fetched instruction after branch → 若 taken 则 两条 fetched 指令必须 flush。

Flush = 第 3-4 cycle 塞 NOP (no-op) = losing 2 cycles。

### Branch Prediction 历史

| 预测器 | 例 | 准确率 |
|--------|----|--------|
| Static (always not taken) | early RISC | ~50% |
| 1-bit BHT (Branch History Table) | 单 bit T/NT selector | ~80% |
| 2-bit saturating counter | 经典 "双状态" predictor | ~90% |
| Gshare / Gselect (global history) | last N branch outcomes XOR with PC 选择预测 | ~95% |
| Tournament (hybrid) | 多 predictor competition | ~97% |
| TAGE (TAgged GEometric) | multi-length history, 近代: Haswell 起 | ~99% |
| Perceptron / Neural branch predictor | AMD Zen 4/5, Apple M3 | ~99.5% |

### 2-bit Saturating Counter

状态机:

```
       taken
SNT ─→ WT ─→ ST
  ↑      ↓ taken
  └── WNT ←─ SNT (reset via not taken)
```

四状态: Strongly Not Taken (00) → Weakly Not Taken (01) → Weakly Taken (10) → Strongly Taken (11)。 两个 not taken 后 从 WT 退到 WNT, 最后 not-taken 进 SNT。

### Gshare / Gselect

Global branch history 寄存器 (GBHR): N 次最近 taken/not taken shift-in。 Gshare = XOR(PC[low bits], GBHR) → index BHT。 Gselect = concatenation。

Modern tournament: 多 predictor vote + 选择器 choose per branch。

### Branch Target Buffer (BTB)

BTB 存储了"曾经 taken 的分支地址 → 目标地址"映射: 在 IF 阶段就能读取 target PC, 不经等 EX 阶段算出。 第一道缓存: 命中 → fetch 立即转到 target。

### Return Address Stack (RAS)

函数返回 `ret` 是一个间接分支——每次 `call` 把 return_addr 推入 RAS LIFO stack; `ret` 就 predict top of RAS → 准确率 ~99.99%。

---

## 四、Structural Hazard

### 原因

- 单端口 L1 D-cache 不能同时读 (ID stage) 和 写 (MEM store stage)
- 寄存器文件单端口读 无法 multi 端口 支持同时向多 stage 读

RISC 寄存器文件多端口解决。 Cache split I and D (L1 I-cache for IF + L1 D-cache for MEM), 只有在 store 时 单端口 structural hazard。 

x86 寄存器名字少 (8×16+ → 32) — 但有 物理寄存器 大 (192+ 用于 OoO 改名)。

---

## 五、真实 CPU 流水线深度

| CPU | 流水线深度 | 特点 |
|-----|-----------|------|
| ARM Cortex-A53 (in-order) | 8 stage | 低功耗, IPC≤1 |
| ARM Cortex-A78 (OoO) | 10-15 | dispatch → 8-wide decode |
| Apple M3 P-core (OoO) | ~12-16 | extreme 宽度 decode 9-wide |
| Intel Golden Cove (12th gen) | 14-19 stages (complex decoded uops) | 6-wide decode + 12 execution ports |
| AMD Zen 5 | ~19 stages (decode + uop cache) | dual 4-issue front-end |

深度 大 = 更高 clock rate (5GHz+) 但 mispredict penalty 也大 (19 cycle flush)。

---

## 六、Micro-op (uop) 与 Macro-op Fusion

x86 是 CISC 指令集——`add [rax], rbx` (读 rax 存 memory) 是一个复杂 CISC 指令; decode 阶段 split 成 2-4 RISC-like μops:
```
μop1: 计算地址 rax→pAddr
μop2: load  [pAddr] → tmp
μop3: add tmp, rbx
μop4: store result [pAddr]
```

### 宏融合: `cmp+jcc` 在 decode 时组合成一单 μop `compare-and-branch`, 比 两 μop 少 一半 dispatch。 Intel Skylake+ 支持。

### uop Cache (DSB)

Decoded Stream Buffer (Intel 内部): decoded μops 缓存; 遇到 1K+ hotspot loop → 从 μop cache 读, 绕过 decode pipeline → 省 2-3 cycle。 AMD Zen 3/4 有 "Op Cache" 类似。

---

## 七、典型事故

### Pentium FDIV Bug (1994)

`FDIV` 引起 浮点除法 lookup table 部分错位 (4 entries missing 1066) — 1 in billions 错 误 指令。 Intel 召回 $475M。

### Spectre/Meltdown (2018)

Branch predictor speculation + "load  secret despite 训 坏 memory access" − 侧信道攻击。 显示 speculative execution 泄露 敏感数据（side-channel）。 软件修补 → store bypass attack、retpolines， 性能损失 5-30%。

### ARM M1 Virtualization trap

Apple M1 没有 x86 `TOTAL_STORE_ORDER` 内存模型, 运行 x86 translation 导致 额外 memory barrier, 性能 缺陷。 Rosetta 2 opt fix.

---

## 八、易错清单

1. **Load-use stall 无法 被 forwarding 消除** — only next 指令 位置 reorder 可降。
2. **Branch predictor 99% 等于 still 1% flush**: at GHz 率 1 秒 = 10M flush (每 flush ~19 cycle = 空过 190M missed cycles).
3. **μop 数量 不一定 省**: `add [rax], rbx` 在 decode 分解 成 4 uops， 可慢 than 分离 load + reg op on RISC。
4. **BTB miss cost > 2 cycle**: 需 重算 分支地址， pipeline fill restart = 10-20 cycle.
5. **Write-after-write (WAW) 虽 pipeline raw 少 见， OoO 在 超标量 时常出现 → reg renaming 解。**

---

## 九、这一章带走的东西

1. 五阶段 pipeline: IF/ID/EX/MEM/WB；CPI=1 是 ideal, reals IPC 更有用.
2. Data hazards：forwarding 可解决 RAW 但 load-use 必须 stall.
3. Control hazards：branch prediction (2-bit / Gshare / TAGE / perceptron) + BTB + RAS.
4. 流水线越深 → clock 高频, branch mispredict penalty ~19 cycle.
5. x86 μop decode: CISC→RISC 转 min 1 op, `add [reg], reg` 分解成 3-4 uops.
6. Spectre / Meltdown:  speculative execution 允许 side-channel attack → OS/hardware fix → performance loss 5-30%.

---

下一节 → [超标量 / OoO / Tomasulo](cpu-superscalar.md)
