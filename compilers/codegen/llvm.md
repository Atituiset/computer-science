# LLVM IR / SelectionDAG / 指令选择

## TL;DR

LLVM IR 是 SSA-based 的 typed 三地址中间表示，是 LLVM 编译流水线的"通用语言"。前端 (Clang、rustc、flang) 把源码翻译成 LLVM IR；后端把 IR 翻译成机器码，中间靠 **SelectionDAG** 做多 → 一的指令选择——把一个 basic block 的 SSA 节点打包成 DAG、用 tree-pattern 覆盖选最便宜的指令模板、再 legalizes 不支持的类型/操作到更小的指令序列。理解 SelectionDAG 是理解"为什么编译器生成那种神仙机器码"的入口。

---

## 一、LLVM IR

### 形式

```llvm
define i32 @add(i32 %a, i32 %b) {
entry:
  %sum = add i32 %a, %b
  ret i32 %sum
}
```

属性：
- **Static Single Assignment**: 每个虚拟寄存器只被赋值一次
- **Typed**：`i32`、`i64`、`f64`、`{i32, i8*}` 结构体；type 由前端给出
- **Three-address**: 大多数指令形式 `%dst = op <type> %a, %b`
- **Basic blocks**: 一个函数有若干 block，block 内线性，block 之间通过 `br` 跳转

### 类型

| 类型 | 用途 |
|------|------|
| `i1` | 布尔 |
| `i32`, `i64` | 整数 |
| `f32`, `f64` | IEEE 浮点 |
| `<4 x float>` | SIMD vector |
| `ptr` | 不透明指针 (LLVM 15 起，取代 `i8*` etc.) |
| `[N x T]` | 数组 |
| `{T1, T2, ...}` | 结构体 |
| `%Name = type { ... }` | 命名结构体 |

### 指令一览

| 指令 | 语义 |
|------|------|
| `%r = add i32 %a, %b` | 加 |
| `%r = fadd fast float %a, %b` | 浮点加速模式 (允许重排) |
| `%r = load i32, ptr %p` | 内存读 |
| `store i32 %v, ptr %p` | 内存写 |
| `%r = getelementptr [10 x i32], ptr %arr, i32 0, i32 %i` | 计算 `&arr[i]`，不实际读内存 |
| `%r = call i32 @foo(i32 %x)` | 调用 |
| `br label %next` | 无条件跳转 |
| `br i1 %cond, label %true_b, label %false_b` | 条件跳转 |
| `%r = phi i32 [ %a, %bb1 ], [ %b, %bb2 ]` | φ 节点 |
| `%r = alloca i32` | 栈分配 |
| `ret i32 %r` | 返回 |

### 一个循环例子

```c
int sum_arr(int *a, int n) {
    int s = 0;
    for (int i = 0; i < n; i++)
        s += a[i];
    return s;
}
```

→ LLVM IR：

```llvm
define i32 @sum_arr(ptr nocapture %a, i32 %n) {
entry:
  br label %loop.cond

loop.cond:
  %i = phi i32 [ 0, %entry ], [ %next_i, %loop.body ]
  %s = phi i32 [ 0, %entry ], [ %next_s, %loop.body ]
  %cmp = icmp slt i32 %i, %n
  br i1 %cmp, label %loop.body, label %loop.end

loop.body:
  %idx = getelementptr i32, ptr %a, i32 %i
  %v = load i32, ptr %idx
  %next_s = add i32 %s, %v
  %next_i = add i32 %i, 1
  br label %loop.cond

loop.end:
  ret i32 %s
}
```

观察：
- `s` 和 `i` 是 SSA 值，每次循环 `phi` 在 loop header 处选 entry 版本或 backedge 版本
- `nocapture` 标注 `a` 的指针不会逃逸（来自 IPA），有助于下游别名分析
- `getelementptr` (GEP) 只算地址不读内存——LLVM 把指针算术从整数算术里独立出，便于 alias analysis

---

## 二、SelectionDAG

### 为什么不用 IR 直接生成机器码？

LLVM IR 是 SSA 的、跨架构的；机器指令是 CISC/RISC 的、有特殊限制。例如：

- x86 `add` 是 2-op dest-1st form（`add rax, rbx` → 写 rax）
- ARM64 大部分三操作数 `add x0, x1, x2`
- x86 的 `imul` 是 IMUL 3-operand，但 `mul` (1-operand) 把结果放 dx:ax
- ARM64 有 SIMD load 配对寄存器 vs scalar load 单独单元

直接逐条 IR 翻译出指令往往不优。**SelectionDAG** 把一个 basic block 一个 DAG，用 tree-pattern 的最便宜覆盖选机器指令。

### DAG 构造

IR basic block 的指令序 → 依赖图（def-use chain 形成的 DAG）。比如：

```
  %i  = phi ...
  %idx = gep i32, ptr %a, i32 %i
  %v = load i32, ptr %idx
  %next = add i32 %v, %i
```

DAG：

```
                ADD
               /   \
            LOAD   (use of i)
             |
           GEP
          /   \
        %a    (use of i)
```

DAG node 类型：`add`, `sub`, `mul`, `load`, `store`, `br`, `phi`, `GEP`, `Constant`, `Register`, `EntryToken`, `TokenFactor` (chain for side effects)...

### Tree-Pattern 匹配

每个 target 定义一套 **patterns**——IR 操作 + operand shape → 一条机器指令 + cost：

```
// Target X86 .td
def : Pat<(add GR32:$src1, GR32:$src2),
          (ADD32rr GR32:$src1, GR32:$src2)>;
def : Pat<(add GR32:$src1, (load addr:$src2)),
          (ADD32rm GR32:$src1, addr:$src2)>;        ; load + add 合并
```

第二个 pattern 把 "add 一个加载值" 合并成一条 `ADD rm` 指令——避免单独的 load + add。

DAgger 用 **Burg-style dynamic programming on DAG**: 自底向上为每个 node 计算每种指令模式的 cost，递归选最优。复杂度 O(N) per basic block.

### DAG Legalization

```llvm
%r = add i128 %a, %b
```

目标架构如果是 x86-64 没有 i128 寄存器——support 不直接。Legalize pass 把 i128 加法拆成两条 64bit 加法：

```
add rax, rcx       ; low 64
adc rdx, rdi       ; high 64, with carry
```

Legalize 类型:

1. **Type Legalization**：超大类型拆成多次小操作。
2. **Op Legalization**：x86 没有直接 SSE 的 `fneg` → 用 `xor %xmm, [SIGN_BIT_MASK]` 替代。
3. **Vec Legalization**：把 `<8 x float>` 拆成两条 `<4 x float>` SSE 操作。

### DAG → MachineInstr

DAG 选完 node 后，** legalize selection** 输出 linear sequence `MachineInstr`：

```
%r1 = MOV32rm <frame>     ; load
%r2 = ADD32rr %r1, %i
```

MachineInstr 仍是虚拟寄存器，没有绑定到物理寄存器——这步交给**寄存器分配** (见 [regalloc.md](regalloc.md))。

---

## 三、Machine Function Pass Manager

SelectionDAG 后是 Machine Function Pass** 串：

| Pass | 作用 |
|------|------|
| `Prolog/Epilog Insertion` | 添加函数 prologue (push rbp; save callee-saved) 和 epilogue |
| `Register Allocator` | 虚拟寄存器 → 物理寄存器 + spill 提出 |
| `Instruction Scheduling` | 指令顺序优化 (List Scheduling) |
| `Branch Folding` | 删除空 basic block + 合并相邻无条件跳 |
| `Peephole` | 局部模式替换，比如 `mov r1, r2; mov r2, r1` 删第二行 |

这些 pass 都是 target-specific 通过 `TargetInstrInfo` 接口暴露 hook 给 generic pass。

---

## 四、FastISel

SelectionDAG 全方位但慢——对大函数编译时间显著。LLVM 同时有 **FastISel**: simple direct translation，不优化但快——`-O0` 调试构建用 FastISel，省时间。

GlobalISel 是新一代统一的指令选择器（基于 IR-level pattern matching + legalizer → bank selector → reg alloc-related），现代 ARM target 推。

---

## 五、Codegen 性能：实例对比

### 自动 vec

```c
void add(float *a, float *b, float *c, int n) {
    for (int i = 0; i < n; i++) c[i] = a[i] + b[i];
}
```

LLVM SelectionDAG 在 X86 target 上 pattern-matched:

1. IR vec 后 → `<4 x float> add` → `ADDPS`
2. Legalize `<4 x float>` → SSE/AVX
3. load 中 `getelementptr` folded 进 SIMD load pattern

```asm
.LBB0_8:
  vmovups ymm0, [rdi + 4*rax]
  vmovups ymm1, [rsi + 4*rax]
  vaddps  ymm0, ymm0, ymm1
  vmovups [rdx + 4*rax], ymm0
  add rax, 8
  cmp rax, rcx
  jl .LBB0_8           ; AVX2 8 性能 8 个 float per iter
```

### 不向量化版本

把 `c[i] = a[i] + b[i]` 改成带 pointer alias 时:

```c
void add_alias(float *a, float *b, float *c, int n) {
    for (int i = 0; i < n; i++) {
        c[i] = a[i] * 2;
        a[i] = c[i - 1]; // 假 alias，c[i-1] 依赖 c[i-1]
    }
}
```

→ 没向量化。LLVM 标无法 prove no-alias → fall back to scalar。

---

## 六、LLVM IR 是软件工程师的工具

很多大项目直接用 LLVM IR：

| 项目 | 用途 |
|------|------|
| **Rust** | 把 Rust MIR 翻译成 LLVM IR，借 LLVM 优化器 |
| **Julia** | JIT 编译时直接生成 LLVM IR |
| **Halide** | 数字图像处理 DSL，定义 schedule 后 emit LLVM IR |
| **GPU NVVM** | 基于 LLVM IR 的 NVPTX backend |
| **Cranelift** | WASM runtime 的 IR (独立设计，但概念同 LLVM) |
| **WASM SIMD** | LLVM IR 上 vector op 映射到 WASM SIMD 指令 |

LLVM IR 在工业里这么红是因为它**丰富、稳定、配套生态完整**——同时是 cross-target API，又是优化 pass 的输入格式，又是 JIT 的快通道。**工程师会读 LLVM IR 是和编译器对话的关键技能**——`clang -S -emit-llvm foo.c -o -` 看 IR、`godbolt.org` 看对应汇编，调优起步。

---

## 七、易错清单

1. **LLVM IR SSA 在 exception 边界**：landingpad 节点处需要特殊处理；C try/catch + patchpoint 的 unwind 表必须正确。
2. **`getelementptr` 的 inbounds**：标 `inbounds` 表示没溢出，编译器更激进做 alias analysis；错标会 silent UB。
3. **`nocapture` 错标 → caller 错期望 callee 不存指针**：bigfoot 性能 bug。LLVM 的 `_ARG nocapture` 由 `inferattrs` pass 自动推。
4. **SelectionDAG 与 GlobalISel 不可同时用**：target 选其一；现代 AArch64 默认 GlobalISel 实验。
5. **Debug info 与优化 pass 同步**：老 LLVM 版本 `O2` 把变量位置打飞 → debugger 乱跳行号。Location-tracking 改进。

---

## 八、等等 X86 翻译：

### 关于 LLVM IR 与 SelectionDAG

**LLVM IR** 在 SSA 上做 machine-independent 优化；**SelectionDAG** 在 per-basic-block 上做指令选择，把 IR 翻译成 MachineInstr(虚拟寄存器阶段) → 寄存器分配 → 机器码。

这是 LLVM 的核心架构**——它让"IR 优化 pass"与"后端指令选择"解耦：第三方 target 不用重写所有 opt pass，只用写 `.td` pattern + legalizer hook 就上 LLVM 生态。

### 例：把 LLVM IR 的 `add i32` 在 RISC-V 上选择指令

```
; RISC-V 64 target
%r = add i32 %a, %b
```

RISC-V `.td`:

```
def : Pat<(add GPR:$src1, GPR:$src2),
          (ADD GPR:$src1, GPR:$src2)>;
```

SelectionDAG → MachineInstr:

```
%r = ADD %a, %b
```

Reg alloc 后:

```
add a0, a1, a2             ; a0/a1/a2 = RISC-V 寄存器约定
```

emit binary:

```
00000000 00100001 00000001 00110011   ; add a0, a1, a2 编码
```

---

## 这一章带走的东西

1. LLVM IR 是 SSA-based、typed、跨架构的中间表示——前端 emit、后端 translate。
2. SelectionDAG 用 tree-pattern dynamic programming 选最便宜的机器指令模板。
3. Legalize 把 IR 上启发式不支持的类型/操作拆成目标架构支持的指令序列。
4. Machine Function Pass 一串：prolog/epilog insert + reg alloc + sched + peephole。
5. LLVM IR 是工程师的"和编译器对话"工具，会读 IR 是性能调优的入门门槛。

---

下一节 → [寄存器分配](regalloc.md)
