# 指令集架构：x86 / ARM / RISC-V

> **TL;DR** — CISC (x86) 以变长指令、内存操作数换取代码密度，代价是前端的解码复杂度；RISC (ARM / RISC-V) 用定长指令和 Load-Store 模型换简单解码与宽发射，代价是静态代码体积。现代 x86 内部早已 RISC 化（μop），ARM 也引入了一些 CISC 特征，边界日渐模糊。真正的分水岭已不在指令长度，而在内存模型、向量扩展策略、特权级设计，以及——是否是开放标准。

---

## 1. RISC 与 CISC：从对立到融合

### 1.1 经典 RISC 信条

1980 年代初，Patterson（UC Berkeley）与 Hennessy（Stanford）几乎同时提出精简指令集的设计哲学。核心教条可以浓缩为四条：

| 原则 | 硬件收益 |
|------|----------|
| **定长指令**（通常 32-bit） | 指令边界检测零成本，并行解码 trivial |
| **Load-Store 架构** | ALU 只操作寄存器，数据通路规整，无内存锁定 |
| **大寄存器堆**（≥32 个 GPR） | 减少 spill/fill，降低内存带宽压力 |
| **单周期（或少量周期）执行** | 流水线均匀，无"惊喜指令"破坏调度 |

ARM（1985）和 MIPS（1986）是第一代商业 RISC 处理器。SPARC（Sun）、PA-RISC（HP）、PowerPC（AIM 联盟）紧随其后。

### 1.2 经典 CISC 信条

Intel 8086（1978）面对的是汇编程序员而非编译器——每条指令的"表现力"直接影响生产力。CISC 的设计决策几乎每一条都与 RISC 相反：

- **变长指令**：x86 指令 1–15 字节，用前缀字节叠加语义（REX、VEX、EVEX）
- **内存操作数**：`add [mem], reg` 单条指令完成读-改-写
- **少量架构寄存器**：x86-32 只有 8 个 GPR，x86-64 扩展到 16 个
- **复杂指令**：`rep movs`（串复制）、`enter/leave`（栈帧）、`xlat`（查表）

代价是解码器——每条指令需要前 1-3 个周期"找边界"（pre-decode），这直接限制了前端的宽度。

### 1.3 现代融合：边界不再清晰

1995 年 Intel Pentium Pro 引入了一个根本性的重构：**把 x86 CISC 指令翻译为类 RISC 的微操作（μop）**。从此，x86 的"外部语言"是变长 CISC，而"内部执行语言"是定长 μop（类似 RISC 三操作数格式）。

```
┌─────────────────────────────────────────────┐
│                   x86 指令流                  │
│  mov eax, [ebx+ecx*4+8]   (1条CISC)         │
└──────────────────┬──────────────────────────┘
                   │ x86 Decoder (MITE)
                   ▼
┌─────────────────────────────────────────────┐
│              μop 序列 (RISC-like)             │
│  tmp ← load [ebx+ecx*4+8]                   │
│  eax ← tmp                                  │
└──────────────────┬──────────────────────────┘
                   │ μop Cache (DSB)
                   ▼
            OoO 调度 / 执行单元
```

反过来，ARM AArch64 也不纯洁：

- **`ldp` / `stp`**：一条指令加载/存储**两个**寄存器（x86 没有直接等价物）
- **复杂寻址模式**：`ldr x0, [x1, x2, lsl #3]`（基址 + 索引 × 移位）
- **`paciasp` / `autiasp`**：指针认证指令，融合了加密与内存访问

**结论**：将 RISC 和 CISC 简化为"定长 vs 变长"已经不能描述 2025 年的真实世界。真正的区分维度应当是：解码复杂度、内存模型、向量策略、特权架构。

---

## 2. x86-64 架构深度

### 2.1 寄存器全景

| 类别 | 寄存器 | 宽度 | 说明 |
|------|--------|------|------|
| 通用 | RAX, RBX, RCX, RDX, RSI, RDI, RBP, RSP, R8–R15 | 64-bit | RSP 专用于栈指针，RBP 为帧指针（可被省略） |
| SIMD | XMM0–XMM15 | 128-bit | SSE 基础，所有 x86-64 处理器必备 |
| SIMD | YMM0–YMM15 | 256-bit | AVX/AVX2，XMM 的超集（低 128 位共享） |
| SIMD | ZMM0–ZMM31 | 512-bit | AVX-512，32 个寄存器（EVEX 编码提供 R' 位扩展） |
| 掩码 | K0–K7 | 64-bit | AVX-512 谓词寄存器，用于按元素掩码 |

> **注**：在 AVX-512 模式下，YMM/ZMM 寄存器的高位在上下文切换时**不需要**保存（XSAVE 头中的 XSTATE_BV 位图标记实际使用的高位寄存器），但保存/恢复仍很昂贵（~1KB+ 状态）。

### 2.2 变长编码解析

x86-64 指令编码从低地址到高地址的结构为：

```
[Prefixes] [Opcode 1-3B] [ModR/M] [SIB] [Displacement 1/2/4B] [Immediate 1/2/4/8B]
```

- **传统前缀**（Legacy）：`0x66`（操作数宽度）、`0x67`（地址宽度）、`0xF0`（LOCK）、`0xF2`/`0xF3`（REP/REPE/REPNE）、段覆盖
- **REX 前缀**：`0x40–0x4F`，用 4 个 bit（W, R, X, B）将 GPR 寻址扩展到 16 个寄存器和 64 位操作数
- **VEX 前缀**（AVX）：2 或 3 字节，编码非破坏性三操作数格式（`c5`/`c4` 开头）
- **EVEX 前缀**（AVX-512）：4 字节，扩展 32 个向量寄存器和掩码/广播/取整模式

一个极端例子——`vaddps zmm20 {k3}{z}, zmm8, [rax+rcx*8+0x1234]`（512-bit 向量加，带掩码和零化）：

```
EVEX.512.66.0F.W0 58 /r
62h F1h 3Eh 08h 58h 54h C8h 34h 12h
│    │   │   │   │   │   │   └── displacement[15:0] = 0x1234
│    │   │   │   │   │   └────── SIB: scale=3(index=rcx, base=rax)
│    │   │   │   │   └────────── ModR/M: reg=zmm20, rm=[SIB]+disp32
│    │   │   │   └────────────── Opcode: 0x58 (VADDPS)
│    │   │   └────────────────── EVEX.pp=0b01, mm=0b10, W=0, vvvv=zmm8
│    │   └────────────────────── EVEX.R'R=0b0000 → reg 扩展位
│    └────────────────────────── EVEX payload 第 2 字节
└──────────────────────────────── EVEX 标识: 0x62
```

共 10 字节——这就是变长指令的代价和表现力。

### 2.3 寻址模式

x86 最著名的"瑞士军刀"寻址：

```
Seg:[Base + Index * Scale + Displacement]
```

- Base：任意 GPR
- Index：任意 GPR（除 RSP）
- Scale：1、2、4、8
- Displacement：0、8、16、32 位

**一条指令完成指针算术 + 访存**。这在遍历 `struct` 数组时极为高效：

```asm
; x86-64: 遍历 struct Node { value(8B), next(8B) }
; rdi = 指向当前节点的指针
.loop:
    mov rax, [rdi]             ; 加载 node->value
    add rbx, rax               ; 累加
    mov rdi, [rdi + 8]         ; node = node->next（基址+偏移即位移）
    test rdi, rdi
    jnz .loop
```

对比 ARM 的等价位：需要 **两条** 加载指令。

### 2.4 调用约定

| 项目 | System V AMD64 (Linux/macOS) | Microsoft x64 (Windows) |
|------|------------------------------|------------------------|
| 参数寄存器 | RDI, RSI, RDX, RCX, R8, R9 | RCX, RDX, R8, R9 |
| 返回值 | RAX (以及 RDX 用于 128-bit) | RAX |
| 被调用者保存 | RBX, RBP, R12–R15 | RBX, RBP, RDI, RSI, R12–R15 |
| 调用者保存 | 其余全部 | 其余全部 |
| 栈对齐 | 16 字节（调用前） | 16 字节 |
| 阴影空间 | 无 | 32 字节（调用者分配，给被调用者用） |

两种约定不可混用，这是跨平台 ABI 调试中常见的深坑（Windows 的阴影空间常常被 Linux 开发者忽略）。

---

## 3. ARM AArch64 架构

### 3.1 寄存器布局

| 寄存器 | 别名 / 用途 |
|--------|------------|
| X0–X7 | 参数 / 返回值（X0 也接收返回值） |
| X8 | 间接结果寄存器（如返回大型 struct） |
| X9–X15 | 调用者保存的临时寄存器 |
| X16–X17 | 过程内调用暂存（IP0, IP1） |
| X18 | **平台寄存器**（Windows 的 TLS 指针，Linux 通用） |
| X19–X28 | 被调用者保存 |
| X29 | 帧指针（FP） |
| X30 | 链接寄存器（LR，存放返回地址） |
| XZR / SP | X31，指令中根据上下文解释为零寄存器或栈指针 |

32 个 GPR 意味着编译器几乎不需要 spill 临时变量——这对 ISA 的编译友好性贡献极大。

### 3.2 Load-Store 铁律

ARM 不存在 `add [mem], reg` 这类指令。任何内存操作必须经过：

1. **Load**：从内存拉到寄存器
2. **Operate**：在寄存器上执行 ALU
3. **Store**：从寄存器推回内存

这保证了所有 ALU 操作的延迟可预测，数据通路无需与内存控制器耦合。

```asm
; AArch64: 遍历 Node 链表
; x0 = 当前节点指针
.loop:
    ldr x1, [x0]               ; x1 = node->value (load)
    add x19, x19, x1           ; 累加到被调用者保存寄存器
    ldr x0, [x0, #8]           ; x0 = node->next (基址+偏移寻址)
    cbnz x0, .loop             ; 比较并分支（一条指令）
```

### 3.3 条件执行：从 ARM32 到 AArch64

ARM32（A32/T32）的标志性特征是**几乎每条指令都可条件执行**——指令的高 4 位是条件码（EQ、NE、CS、MI 等 15 种条件）。这省去了大量分支跳转，但也消耗了编码空间。

AArch64 大幅削减了这一机制：

- 移除了通用条件执行字段
- **仅保留少数条件指令**：`csel`（条件选择）、`cset`（条件设值）、`ccmp`（条件比较）、`cinc`（条件自增）
- 分支仍然使用 `b.eq`、`b.ne` 等（条件码来自 NZCV 标志，由 `cmp` / `tst` 等设置）

```asm
; AArch64: abs(x0) 无分支
    cmp x0, #0
    cneg x0, x0, lt            ; 若 x0 < 0 则 x0 = -x0，否则不变
```

### 3.4 调用约定（AAPCS64）

```
参数:  X0→X7（整数/指针）, V0→V7（浮点/SIMD）
返回:  X0（整数）, V0（浮点）
被调用者保存: X19–X28, V8–V15
```

苹果平台还有细微修改，统称 Darwin ABI。

---

## 4. RISC-V 架构

### 4.1 模块化设计哲学

RISC-V 最基本的创新不在技术而在**治理**——这是一份自由、开放的 ISA 规范，归属 RISC-V International 而非任何公司。

ISA 被拆分为基础指令集 + 标准扩展，每种扩展用一个字母标识：

| 扩展 | 内容 |
|------|------|
| **I** | 基础整数指令（RV32I / RV64I） |
| **M** | 整数乘除 |
| **A** | 原子操作 |
| **F** | 单精度浮点 |
| **D** | 双精度浮点 |
| **C** | 压缩指令（16-bit） |
| **V** | 向量扩展 |
| **Zicsr** | 控制和状态寄存器访问 |
| **Zifencei** | 指令栅栏 |
| **Zbb** | 基础位操作 |
| …… | 总共 40+ 已批准扩展 |

常见的软件目标：`RV64GC` = RV64I + M + A + F + D + C。

### 4.2 寄存器与 ABI

| 寄存器 | ABI 名称 | 用途 |
|--------|---------|------|
| x0 | zero | 硬连线 0 |
| x1 | ra | 返回地址 |
| x2 | sp | 栈指针 |
| x3 | gp | 全局指针 |
| x4 | tp | 线程指针 |
| x5–x7 | t0–t2 | 临时 |
| x8 | s0/fp | 被调用者保存 / 帧指针 |
| x9 | s1 | 被调用者保存 |
| x10–x17 | a0–a7 | 函数参数 / 返回值 |
| x18–x27 | s2–s11 | 被调用者保存 |
| x28–x31 | t3–t6 | 临时 |

与 ARM 类似有 32 个 GPR，但 x0 硬编码为 0（读）或 `/dev/null`（写）——这很巧妙：`nop` 实际上是 `addi x0, x0, 0`。

### 4.3 指令格式：规整而优雅

所有基础指令严格 32 位，分 4 种格式：

```
R-type: funct7(7) | rs2(5) | rs1(5) | funct3(3) | rd(5) | opcode(7)
I-type: imm[11:0](12) | rs1(5) | funct3(3) | rd(5) | opcode(7)
S-type: imm[11:5](7) | rs2(5) | rs1(5) | funct3(3) | imm[4:0](5) | opcode(7)
U-type: imm[31:12](20) | rd(5) | opcode(7)
```

字段位置在所有格式中对齐——`rs1` 始终在 bit 15–19，`rs2` 在 bit 20–24，`rd` 在 bit 7–11。解码器可以用**一层 MUX** 完成寄存器读取，不需要像 x86 那样先解析 ModR/M 才能定位寄存器字段。

### 4.4 无状态条件码

RISC-V 抛弃了 x86 和 ARM 共享的 **条件码寄存器**（FLAGS / NZCV）设计。比较通过**比较-分支融合**指令完成：

```asm
; RISC-V: 比较并分支（单条指令）
    blt x5, x6, .L_target      ; if x5 < x6 goto target
    beq x5, x0, .L_done        ; if x5 == 0 goto done
```

这消除了条件码作为隐式状态的依赖，简化了乱序执行中的寄存器重命名（不需要单独的条件码物理寄存器堆）。

### 4.5 向量扩展：RVV

RISC-V Vector Extension (RVV 1.0) 的核心思想借鉴了 Cray-1 的向量模型：

- **向量长度不可知**（Vector Length Agnostic）：同一代码可在 128-bit 到 65536-bit 的实现上无修改运行
- 使用 `vsetvl` 指令在运行时设置向量长度（基于硬件 VLEN 和应用元素宽度）
- 三种加载模式：单元步进（unit-stride）、步幅（strided）、索引（indexed）

```asm
; RISC-V RVV: VA + VB → VC（任意长度）
    vsetvli t0, a0, e32, m1    ; 配置: 32-bit 元素, LMUL=1, 设置 vl = min(VLEN/32, a0)
    vle32.v v1, (a1)            ; 加载 A（单元步进）
    vle32.v v2, (a2)            ; 加载 B
    vadd.vv v3, v1, v2          ; 向量加法
    vse32.v v3, (a3)            ; 存储到 C
    sub a0, a0, t0              ; 剩余元素数
    bnez a0, .loop              ; 尾循环处理超长向量
```

### 4.6 特权架构

RISC-V 定义了三个标准特权级：Machine (M)、Supervisor (S)、User (U)，外加可选的 Hypervisor (H)。

- **M-mode**：始终存在，用于固件/安全监控（类比 ARM EL3）
- **S-mode**：操作系统内核（类比 x86 Ring 0）
- **U-mode**：用户空间（类比 x86 Ring 3）

分页方案：Sv39（3 级页表，39-bit VA，512 GB 地址空间），Sv48（4 级，48-bit VA），Sv57（5 级，57-bit VA）。Linux 内核主线已完整支持 RISC-V，发行版（Ubuntu、Fedora、Debian）均提供 RV64GC 镜像。

---

## 5. SIMD 扩展对比

### 5.1 演进路径

```
x86:    MMX(64b,'97) → SSE(128b,'99) → AVX(256b,'11) → AVX-512(512b,'16)
ARM:    NEON(128b,'05) ────────────────→ SVE(variable,'19) → SVE2('20)
RISC-V: ──────────────────────────────→ RVV(1.0,'21)
```

每一代不仅是宽度翻倍——指令格式、寄存器堆编码、编译器内在函数（intrinsics）全部不同。

### 5.2 x86 AVX-512：丰富但分裂

AVX-512 最大的工程败笔是 **子集碎片化**。它不是一个整体，而是十几个独立的指令子集：

| 子集 | 功能 |
|------|------|
| AVX-512**F** | 基础（必有） |
| AVX-512**CD** | 冲突检测 |
| AVX-512**VL** | 128/256-bit 操作数上的 AVX-512 指令 |
| AVX-512**BW** | 字节/字操作 |
| AVX-512**DQ** | 双字/四字 |
| AVX-512**IFMA** | 整数融合乘加 |
| AVX-512**VBMI** | 字节向量位操作 |
| AVX-512**4VNNIW** | 4 字向量神经网络指令 |

仅 Intel 内部就因 **P-core（支持 AVX-512）vs E-core（不支持）** 而内部打架——线程从 P 核迁移到 E 核时必须保存/恢复 ZMM 状态（~1KB XSAVE 区域），在实时系统中引入不可预测的延迟抖动。最终 Intel 在消费级 12/13 代直接熔断（fuse off）AVX-512。

> **工程教训**：ISA 扩展必须是全平台统一的承诺。部分芯片有/部分没有 = 编译器无法生成高效代码（除非独占 -march 目标）。

### 5.3 ARM SVE/SVE2：宽度无关

SVE 的核心思想：**写一次代码，在所有向量宽度上运行**。

```
min(VLEN) = 128 bit, max(VLEN) = 2048 bit (16 字节 → 256 字节)
```

SVE 没有为每个宽度提供不同的指令——寄存器操作数隐式适应 `vl`（向量长度）寄存器的值。这消除了 AVX-512 面临的宽度升级问题。指令示例：

```asm
; SVE: 向量加法（宽度自适应）
    ptrue p0.d                  ; 谓词 = 全真（双字元素）
    ld1d {z0.d}, p0/z, [x1]    ; 加载（由 vl 决定加载元素数）
    ld1d {z1.d}, p0/z, [x2]
    fadd z2.d, z0.d, z1.d      ; 浮点向量加
    st1d {z2.d}, p0, [x3]
```

**但是**：苹果 M 系列**不实现 SVE**，而是依赖自研的 AMX（Apple Matrix coprocessor）加速矩阵运算。对于可移植性，NEON（128-bit 固定）仍然是最低公分母。

### 5.4 RISC-V V：Cray 风格的回归

RVV 与 SVE 概念近似但实现不同：

- SVE 用**谓词寄存器**（`p0`–`p15`）控制每元素是否操作
- RVV 用**向量长度寄存器**（`vl`）控制操作元素数，掩码由 `v0` 向量寄存器提供
- RVV 支持 LMUL（向量长度乘数），允许将多个向量寄存器组合为逻辑寄存器（`LMUL=8` 时每条指令处理 8×VLEN 位数据）

**三条汇编对比**（向量加法，等效语义）：

```asm
; x86 AVX-512: 固定 16 个 32-bit 元素
    vaddps zmm0, zmm1, zmm2

; ARM SVE: 宽度自适应（假设 .s = 32-bit 元素）
    fadd z0.s, z1.s, z2.s

; RISC-V V: LMUL=1, SEW=32
    vfadd.vv v0, v1, v2
```

---

## 6. ISA 对微架构的影响

### 6.1 解码宽度

解码宽度直接决定超标量处理器的"天花板"：

| 微架构 | ISA | 解码宽度 | 关键手段 |
|--------|-----|---------|---------|
| Intel Golden Cove | x86 | 6 宽 | 复杂预解码 + μop Cache (4K entries) |
| AMD Zen 5 | x86 | 4 宽 × 2（双解码簇） | Op Cache 护航 |
| Apple M3 (Avalanche) | ARM AArch64 | **9 宽** | 定长指令→极简解码 |
| SiFive P870 | RISC-V | 8 宽 | 定长 + 部分压缩指令扩展 |

ARM / RISC-V 天然更容易宽解码——32-bit 边界对齐意味着解码器可以并行**盲切**指令流，无需像 x86 那样先扫描前缀（LenFinder）。

**但**：RISC-V 的压缩扩展（`C`，16-bit 指令）破坏了对齐假设。任何地址可以是 16-bit 指令的开始，需要额外的半字对齐检查，复杂度略增。

### 6.2 代码密度

变长编码的 CISC 在代码体积上有天然优势：

```
int sum(int *arr, int n) { int s=0; for(; n--; ) s += arr[n]; return s; }
```

| ISA | 代码字节数 | 比例 |
|-----|----------|------|
| x86-64 (-O2) | 24 字节 | 1.00× |
| ARM AArch64 (-O2) | 32 字节 | 1.33× |
| RISC-V RV64GC (-O2) | 28 字节 | 1.17× |
| RISC-V RV64I (无压缩) | 40 字节 | 1.67× |

RISC-V 的 `C` 扩展（16-bit）大幅缩小了与 x86 的差距——但 AVX-512 的长前缀又反向拉大了体积。

### 6.3 内存模型

| ISA | 默认模型 | 得到顺序时的屏障 |
|-----|---------|----------------|
| x86 | TSO（强） | 显式 `mfence` / `lock` |
| ARM | 弱序（RCpc） | `dmb ish` / `dmb ishst` |
| RISC-V | RVWMO（弱序） | `fence rw,rw` |

x86 的强内存模型极大简化了锁算法和无锁数据结构的实现（大多数情况下甚至不需要显式屏障），代价是乱序执行器的自由度受限。ARM/RISC-V 更灵活但更容易写出"在 x86 上能跑、在 ARM 上炸"的代码。

---

## 7. 苹果的 ISA 策略

苹果是全球唯一在 ISA 上完成两次迁移的公司：68k → PowerPC（1994）→ x86（2005）→ ARM（2020）。

### 7.1 自研扩展

苹果的 M 系列芯片实现 ARM ISA，但硅片上的功能远超 ARM 标准：

- **AMX**（Apple Matrix coprocessor）：私有矩阵乘加指令，通过 `Accelerate.framework` 暴露（不直接汇编可访问）
- **APR**（Apple Performance Registers）：私有的性能监控和控制 MSR
- **RR**（Return Prediction）：私有的返回地址预测器配置
- 苹果不依赖 ARM 的 CoreSight 调试架构，自研 DAP 链

这套策略等于 **"ARM 是 ABI 兼容层，硅片是我说了算"**。

### 7.2 Rosetta 2 与内存排序

x86 使用**完全存储排序**（Total Store Ordering / TSO）：所有 CPU 核看到的一致性写顺序。ARM 是弱序模型，硬件可重排 store。

翻译 x86 指令时，若每次 store 后都插入 `dmb` 屏障，则性能损失约 5–10%。苹果的解法分两步：

1. **M1**（AOT + JIT）：编译器分析 x86 访存数据依赖，仅在必要处插入屏障
2. **M2+**：硬件新增 **TSO 模式**（可被 Rosetta 2 运行时启用），硬件强制全序，零软件屏障

这是典型的"第一代用软件吃痛，第二代用硬件根治"的 Apple 风格。

---

## 8. 2025 年格局

| 维度 | x86 | ARM | RISC-V |
|------|-----|-----|--------|
| **桌面/笔记本** | Intel Lunar Lake + AMD Zen 5 主导 | Apple M 系列 + Qualcomm Snapdragon X | 未见 |
| **服务器** | AMD EPYC 份额日益增大 | AWS Graviton4 + AmpereOne | Ventana Veyron V2 (2025) |
| **嵌入/加速器** | Intel Atom | Cortex-R/M 占统治地位 | 无处不在（NV GPU 控制器、WD SSD、Google Titan） |
| **生态成熟度** | 极致（40 年） | 强（iOS 生态绑定） | 快速追赶（Linux、GCC/LLVM 主线支持完毕） |
| **许可证** | Intel/AMD 交叉授权 | ARM 商业授权费 | **免费 + 开放** |

**RISE 项目**（RISC-V Software Ecosystem）由 Google、Intel、Qualcomm、MediaTek 等共同资助，目标是将 RISC-V 软件堆栈推向生产级——这可能是 RISC-V 从"嵌入式控制 ISA"跃迁到"通用计算 ISA"的关键拐点。

---

## 9. 工程事故记录

### 9.1 Intel AVX-512 熔断

**问题**：12/13 代酷睿采用混合架构（P-core + E-core）。P-core 具备 AVX-512 而 E-core 不具备。当线程在核间迁移时，AVX-512 状态体的 XSAVE/XRSTOR 延迟（~数百周期）破坏实时性。

**对策**：Intel 在微码/熔丝层面禁用 AVX-512，即使硅片支持也不暴露。社区（和某些主板商）尝试通过固件 hack 重新启用——Intel 继续在后续步进中强化熔断。

**教训**：SIMD ISA 必须平台统一。部分实现 = 不可靠实现。

### 9.2 Apple M1 Rosetta 2 TSO 性能

见第 7.2 节。第二教训：**ISA 迁移不仅是解码问题——内存模型是底层的大坑**。

### 9.3 RISC-V 向量扩展版本割裂

RVV 0.7.1 草稿与最终 1.0 规范**不兼容**（指令编码不同）。阿里的玄铁 C910、SiFive 的 X280 等早期核心出货时搭载了 0.7.1。这意味着已部署的硬件无法运行标准 RVV 1.0 代码，且 Rust/GCC 需要同时维护 0.7.1 和 1.0 两套目标。

**教训**：在 ISA 规范未冻结前出货硅片 ≈ 制造永久的生态裂痕。

---

## 10. 易错清单（面试/考试高频陷阱）

1. **x86 `rep movsb` 并不总是快** — 仅在 copy > 256 字节且源/目标对齐到 16/32 字节时，微码的 "fast string" 模式才启动。小 copy 用 `rep movsb` 反而比普通 `mov` 循环慢很多。

2. **ARM `ldp` / `stp` 是两条独立操作** — 它分别加载两个寄存器，不是 128-bit 宽度的单次访存。在弱序内存模型下，两条 load 之间可能被其他 store 插序。

3. **ARM/AArch64 的 SP 不是真的 X31** — 在大多数指令编码中，X31 的位置被解释为 SP 而非 "寄存器 31"（存在 `add x0, sp, #8`，但不存在 `add x0, x31, #8`）。这是编码空间的诡计。

4. **RISC-V 压缩指令译码可能产 2 条 μop** — 某些复合压缩指令（如 `c.lwsp rd, offset`）在宽发射微架构上会被裂解为两条内部操作：先计算地址，再加载。这抵消了部分解码宽度优势。

5. **NEON 永远是 128-bit** — ARM NEON 不可扩展。不要将 NEON 与 SVE 混淆。苹果 M 系列只有 NEON（+ AMX），不支持 SVE。Linux 内核可以通过 `hwcap` 检查 `HWCAP_SVE`。

6. **AVX-512 会降频** — 执行 512-bit 向量指令时，CPU 可能降低 200–400 MHz（thermal budget 重分配）。编译器（GCC `-mprefer-vector-width=256`）和库（glibc `memcpy`）通常避免 512-bit 操作以减少频率惩罚。

7. **x86 LOCK 前缀的隐式操作** — `lock cmpxchg [mem], reg` 不仅原子化这条指令，还隐含了**完全内存栅栏**（full memory barrier）——比单独 `mfence` 更强，因为它强制 store buffer 排空。

---

## 这一章带走的东西

- **RISC vs CISC 已死**：长话短说，现代 x86 内部是 RISC 的；现代 ARM 也不是纯正的 RISC。真正的分水岭在：解码复杂度、内存模型、向量策略、特权架构。
- **选 ISA = 选约束**：x86 给你 40 年生态兼容性和最密代码，代价是解码器的痛。ARM 给你高能效比和宽解码，代价是弱内存模型带来的调试成本。RISC-V 给你自由和免授权费，代价是生态仍在追赶。
- **向量扩展是当前最大的 ISA 战场**：AVX-512 强但碎片化，SVE 优雅但苹果不跟，RVV 开放但生态尚未成熟。矩阵乘法加速（AMX、IMMA、MME）是下一个战场。
- **不要相信"一次编写处处运行"关于 SIMD 的部分**：即使是同一 ISA 家族（如 AVX-512 的各子集），代码在目标芯片缺失该子集时直接 `SIGILL`。运行时特性检测（cpuid / hwcap / misa）是必需的前置步骤。
- **内存模型在 ISA 选择中同等重要**：x86 TSO 的"安全网"让无数并发 Bug 隐身——把这些代码搬到 ARM 或 RISC-V 上时，它们会以最诡异的方式爆发。

---

> **下一节 → [CPU 流水线与指令级并行](cpu-pipeline.md)**
