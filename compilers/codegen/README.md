# Codegen

机器无关优化在 IR 跑完之后，进入**机器相关**阶段。任务是把 IR 翻译成目标 CPU 指令序列——指令选择、寄存器分配、指令调度、peephole 优化、JIT 编译（如果支持）。这一阶段成果直接决定最后 30% 的性能。**LLVM 后端 **SelectionDAG → MachineInstr → Machine Function Pass → MC Layer** 是教科书级别的工业 stream；HotSpot C2 用 IR graph 直接 emit 寄存器分配器；Cranelift 用 CLIF 一步到位。

- [LLVM IR / SelectionDAG / 指令选择](llvm.md)
- [寄存器分配：graph coloring & linear scan](regalloc.md)
- [JIT、Tiered Compilation、V8 Turbofast、Cranelift](jit.md)

## 后端的几个阶段

```
IR (SSA form, machine-independent)
   ↓  Instruction Selection        (IR -> 目标架构指令模板)
   ↓  Register Allocation          (虚拟寄存器 -> 物理寄存器/spill)
   ↓  Instruction Scheduling       (指令顺序依赖图)
   ↓  Peephole Optimization        (局部模式替换)
   ↓  Machine Code Emission        (binary)
```

### Instruction Selection

```c
a = b + c   (LLVM IR)
```

在 ARM 上：

```
add r0, r1, r2          (单条加法)
```

在 x86 上：

```
mov rax, rbx
add rax, rcx            (必须先 mov，因为 add 目的端是 src-dst)
```

**指令选择** 决定用哪条机器指令实现 IR 操作。LLVM 用 SelectionDAG（树覆盖），GCC 用机器描述 macro，HotSpot C2 直接产生 ideal graph 节点。tree-covering 算法是经典 Burmese (Burs, Graham- Henry) 算法：找树最便宜的覆盖。

### Register Allocation

```c
sum += a[i];              // 用到_sum, i, 临时寄存器
```

物理寄存器只有 16-32 个（x86-64 GPR），但活跃变量可能上百。**Spill**——把不活跃的临时存到栈——是 register allocation 的核心难题。两个经典算法：**Graph Coloring**（Chaitin-Briggs, 复杂但质量最好）与 **Linear Scan**（Poletto-Sarkar, 简单快但稍逊）。

### Instruction Scheduling

CPU 流水线深度：现代 x86 ~14-19 stages，ARM Cortex-A78 ~15 stages。指令间数据依赖会导致 stall——把无关指令插进依赖链中能增加 ILP (Instruction-Level Parallelism)。

```
mov rax, [rsp]        ; load 1, latency 3-4 cyc
add rbx, rax          ; depends on rax
mov rcx, [rsp+8]      ; load 2, independent
add rdx, rcx          ; depends on rcx
```

调度器把无关的 load 提到前面：

```
mov rax, [rsp]
mov rcx, [rsp+8]
add rbx, rax
add rdx, rcx
```

两个 load 并发执行。**List Scheduling** 算法：每 cycle 选依赖闭包里就绪的指令送入。Hardware 多发射让编译器调度放宽；现代 CPU 的 out-of-order 让 compiler scheduling 不那么关键，但仍是关键因素。但 in-order CPU (Cortex-A55、Atom) 仍极依赖 compiler scheduling。

---

下一节 → [LLVM IR / SelectionDAG / 指令选择](llvm.md)
