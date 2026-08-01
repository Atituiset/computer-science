# JIT / Tiered Compilation / V8 TurboFan / Cranelift

## TL;DR

JIT 编译器在**运行时**把字节码（或源码）翻译成机器码，热路径深度优化、冷路径保留解释器执行。**Tiered Compilation** 把这条流水线分多层：最开始解释器（Ignition、HotSpot 解释器、PyPy 解释器）零编译、~10-100x 慢；快速编出基线机器码（V8 Sparkplug、HotSpot C1）做 1x 接近 AOT；最热的代码用激进优化器（V8 TurboFan、HotSpot C2）做到 LLVM `-O2` 级甚至更优——因为有运行时 profile 可以做纯静态难以做到的 devirt、type feedback、speculative inlining。理解 V8、HotSpot、Cranelift、Julia、PyPy 的 tiered 模型与 deoptimization 机制是 JIT 现代化的入口。

---

## 一、JIT vs AOT 工程对比

| 维度 | AOT (LLVM/GCC) | JIT (V8/HotSpot/PyPy/Julia) |
|------|----------------|-----------------------------|
| 启动 | 直接跑机器码 | 必须先解释 + 编译 |
| 峰值 | LLVM `-O3` 接近上限 | HotSpot C2 / V8 TurboFan 可超 LLVM |
| 优化依据 | 静态分析 + PGO (人工采样) | 运行时 profile 自动 |
| 解决 polymorphism | C++ devirt 模板、虚函数分析 | V8 inline cache、HotSpot CHA |
| Binary 大小 | 原生二进制 | 字节码 + JIT cache |
| 部署可重现 | ✅ 同输入同 binary | ❌ JIT 受执行时 profile 影响 |
| 安全 | 编译产物可 audit | JIT compile 由地址必有 W^X 麻烦事故 |

AOT 优势是**首次执行快、可 reproducible、无 security concern**。JIT 优势是**因为 profile 在运行中收集、能做推测性优化 + 可 deopt → 实际峰值经常超 AOT**。

---

## 二、Tiered Compilation 设计

### V8 (JS) 5-tier 现代架构

```
JavaScript source
  ↓ Parser
AST
  ↓ Ignition Compiler
Ignition bytecode
  ↓ interpret (initial)
hot bytecode → counter threshold
  ↓ Sparkplug (baseline JIT, fast compile)
fast baseline machine code
  ↓ hot further (counter)
TurboFan (Tier 1 optimizing)
  ↓ if polymorhism/re-checks fail
Maglev (Tier 2 mid-top optimizing)
  ↓ hottest methods
TurboFan (Tier 3 top, speculative + inlining)
```

### HotSpot (Java) 5-tier 编译

```
0. 解释器
1. C1 with profiling
2. C1 without profiling   # cold code 编译了一次没有后续触发
3. C1 with profiling     # collect types + branches
4. C2 aggressive optimizing with profile
```

HotSpot OSR (on-stack-replacement)、CHA (Class Hierarchy Analysis) + escape analysis + speculative devirt 让 C2 编出来的代码再 5-30% 超 GCC `-O3` 静态编。

### Go vs Rust vs Python

- **Go**: 默认 AOT (gc tool chain)，无 JIT。`gctrace` debug 模式可观察。
- **Rust**: AOT (LLVM backend)，Wasm 时 Cranelift 替代 LLVM 做 JIT 级速度。
- **Python**: CPython 解释器无 JIT（3.13 之前）；PyPy 有 JIT (RPython-based trace compilation)；3.13 起有 adaptive interpreter (specializing bytecode)，但不是 JIT。

---

## 三、V8 TurboFan 内幕

### Sea-of-Nodes IR

TurboFan 用 Cliff Click 1995 设计的 **Sea-of-Nodes** 表示：
- 节点 = 操作 (`Add`, `Load`, `Phi`, `CheckMaps`, `Branch`...)
- 边 = 数据依赖 (输入值) 或 控制依赖 (control flow edge) 或 **effect edge** (内存副作用顺序)
- 是把 CFG 与 SSA 融合的"图 IR"——各节点自由调度，没显式 basic block 直到 schedule 阶段才把 Nodesort 进 block

特殊在中**有 Effect dependency edge**：一条 `Store *p` 之后跟着 `Load *q`，编译器把 q 与 p 用 effect edge 串起来——除非 alias analysis 证明无关系。

### Type Feedback Vector (ICs)

V8 在 Ignition 执行每条字节码时记**类型历史**:

```javascript
function f(a, b) { return a + b; }
f(1, 2);    // IC slot: (Smi, Smi) → Smi+
f(1.5, 2);  // IC slot: (HeapNum, Smi) → Num+ (unbox float)
f("a", "b"); // IC slot: (String, String) → String+
```

每条操作有 **inline cache** (IC)：第一次跑时探测类型 + 选择 specialization, 后续命中直接走 specul code。多态 (`polymorphic`) 时 IC vs monomorphic 大幅差性能。

TurboFan 优化时 query IC，得到代表类型，编译生成只看一种形态的指令 + **deopt guard**——若运行时类型 deviate，bailout 回 Ignition。

### Speculative Inlining

```js
function g(x) { return x.f(); }
```

`x.f()` 可调用 100 个不同类，静态分析不可 inline。但 profile 显示 99% 调用对单一类型 `A.f` → TurboFan specul devirt + emit:

```
CheckMaps x, A_map
call A.f
guard not taken: deopt to interpreter at frame index N
```

热 path 跑 devirt，0.1% path 走 guard 失败回退。HotSpot 称为 **speculative devirtualization**。

### Deoptimization (Deopt)

V8 deopt 流程：

1. Generated code 在每个 specul 假设的位置放 **deopt guard**: `cmp map(x), expected; jne deopt_pad`
2. deopt_pad 调用 `Runtime_Deopt`：用 frame translation 信息恢复 Ignition 字节码状态 + 寄存器状态 (反推 SSA → 栈)
3. 跳回 Ignition 的对应 bytecode offset 执行

deopt 大量使用 `Maps`(隐藏类)、`FrameInfo`——LLVM 与 Cranelift 没这种"反编译到 IR" 机制，因为它们不假设持续执行。

### WebAssembly 在 V8

```
Wasm binary → Streaming Decoder
  → Liftoff (baseline JIT, fast compile)
  → TurboFan (optimizing when hot)
```

Wasm binary 是 1) typed, 2) structured (no control flow irreducibility), 3) 无 polymorphism——比 JS 简单。**Liftoff** 编译快，**TurboFan** 给热函数再优化。Wasmer、Wasmtime (基于 Cranelift), GraalWasm 等都是类似 pipeline。

---

## 四、HotSpot C2

### Ideal Graph

C2 的 IR 是 **Ideal Graph** (Sea-of-Nodes variant)——与 TurboFan 概念接近。Click 在 90 年代写 HotSpot 早期版本 (Strongtalk) 时发明的 Sea-of-Nodes。

### C2 的 Phase

```
Parse  (bytecode → Ideal Graph)
PhaseIdealLoop (loop tree、range check elimination)
PhaseIterGVN   (global value numbering)
PhaseIdealLoop (more)
PhaseIGVN
   ↓ (scheduler)
Macro Node expansion (alloc → scalar replace)
Matcher (selecting machine instructions, x86-64)
RegAlloc (Chaitin-PBQP)
emit
```

### C2 做的 LLVM 难做的优化

| 优化 | C2 | LLVM AOT 等价 |
|------|------|----------------|
| 推断虚函数 monomorphic | CHA + 类型 profile | `-fdevirtualization` specul (有时) |
| scalar replace（escape analysis） | dead static elim | MemCpyOpt + alias analysis |
| biased locking | 锁对象最近被同线程使用 → 测试 → 直接进入 — no atomic | 无 (语言级无 monitor) |
| on-stack replacement | 解释 → JIT 切换中 frame | 无 |
| range check elimination | loop bound profile 推断 | `-fcheck-new-roots` 不 |

### 重要副效应：JDK 17 deprecated biased locking

2021年 HotSpot 移除 biased locking —— 大量工程 benchmark 显示 它收益小、维护成本高。Safer `LockSupport` 兼容、JIT 仍可消除锁。

---

## 五、Cranelift：Wasm 时代的新 JIT

Cranelift 是 Bytecode Alliance 的 Rust 编译器后端，为 Wasmtime、Wasm3、Firefox SpiderMonkey 后端提供 fast JIT 编译。

### 设计

- **CLIF (Cranelift IR)**: SSA + typed + Sea-of-Nodes wind + ebb (extended basic block) 流
- **Fast compile**: 编译速度 ≈100MB/s, 3-20x 快于 LLVM 在 `-O0`
- **Quality**: 接近 LLVM `-O1`, 不向量化激进
- **Reg Alloc**: Regalloc2 (graph coloring with splitting)
- **Target**: x86-64, ARM64, RISC-V64, s390x

### 用 LLVM Process

2023 起 Wasmtime 加 "Cranelift + eBPF-style lazy optimization"，目标是 1) 启动时基线快、2) 热点可后续 elevate 到 LLVM JIT。这就是 layered JIT——Cranelift 是基线，LLVM 是高阶。

### WebAssembly Component Model

Cranelift 与 WIT、Wasm 接口结合——Wasm component module 之间的 calls 通过 Cranelift 生成的 trampoline，无需重编 module，这是工业上 JIT 模块化的早期阶段。

---

## 六、PyPy Trace-based JIT

PyPy 用 **trace-based JIT** (Truffle 之外的另一种派别)，跟 method-based JIT (HotSpot) 不同：

```
1. 解释器跑循环 / 凄暖路径
2. trace recorder: 沿实际执行路径记录指令
3. 在 loop 辑后停下、组装成 loop 形式的 linear trace
4. optimize linear trace (constant propagation、loop peeling, inlining via trace stitching)
5. emit machine code (x86-64/ARM64/Z80 用)
6. Guard at start of trace: 类型匹配、循环上界等，否则 fail → fallback interpreter
```

Trace-based 优势：**loop-friendly 优化、linear 简单**；劣势：分支多 + 迭代不规整时 trace 完整性下降。

### LuaJIT 头部 trace-based JIT

LuaJIT (Mike Pall) 是业界最快 trace-based JIT 之一。LuaJIT trace 大部分是几 KB、quality 大致 = HotSpot C1。Mike 用大量手工汇编 trampoline。 **异步 runtime**

---

## 七、JIT 实施事故

### V8 Speculative Devirt 大退步 (2018)

Chrome 老版本 V8 "BackgroundCompileThread" 偶发 race 导致死锁——TurboFan deopt 后 re-compile 时丢失部分 IC，下次运行 0.5%-3% slower。Fix 用 ReadWriteLock。

### HotSpot Reference Queue Overflow (1997)

旧 FullSpeed `ReferenceQueue` 在 GC 时可能丢软引用，导致 finalize 不调用揭晓的 bug。HotSpot 经典 bug fix "Use precise reference discovery"。

### Native Image 容器 JIT memory: JIT cache 与 native stack 冲突

Linux x86-64 第 47-bit memory limit：JIT cache 在 0x7fff... 高位、native stack 在低位 → unreachable mapping。一些 Cloud Foundry / WSL 1.x 环境导致 JVM crash。Native Image、JIT exec memory via `mmap` 在 sbrk 上同对策。

### ETA JIT Cache Flush (Apple Silicon macOS)

macOS Apple Silicon 下**每个 W^X 必须 pmap_cs_*** invalidate JTC cache、JIT 编译后 mmap PROT_EXEC—PROT_WRITE 翻转。**JIT 在 Apple Silicon Mojave ~15-20% slower than x86_64 macOS** 现 Apple thread_set_exception_ports 加 fast release — 解决。

### W^X 与 mmap PROT_EXEC

很多 JIT 是感`mmap(..., PROT_READ|PROT_WRITE)` 写完代码 → `mprotect(PROT_READ|PROT_EXEC)` 启用 exec。 SPD Linux 中 CAP_SYS_RAWIO 起才有 — fix 经常 needs sysctl `kernel.randomize_va_space`、`vm.mmap_min_addr`。

### Cranelift Bug series (2020-2022)

Cranelift reg alloc 在某些 high-pressure 函数生成错误 spill slot → silent miscompile 一个 Wasm17_WASI 子模块 benchmark。回归测试定期 catch 。

---

## 八、JIT 通过外部接口

### TIER HINTS

HotSpot 把**付费用户获取的 profile 经人工采样** 摆到 AOT：AOT compile 用 `-XX:+PrintTieredEvents`, JIT 收集的 IC 与 hot loop dynamic run 编出 特定 AOT module so 更优生成代码。

**Project Leyden (Java)** 把启动时代解释 + C1 编译收 移到 AOT，而运行时仍运行 C2 优化热路径。三分 系。

**GraalVM Native Image** 把 HotSpot JIT 全推成 AOT — 不再有 JIT 在运行时 编译。Run-time 优惠: 低内存、启动快、镜像小。但峰值 slower than C2，无 trace.

### LLVM ORC JIT

LLVM 自带 ORC (On-Request Compilation) JIT API —— ClangRepl, Cling in ROOT6 用 LLVM JIT streaming during REPL runtime commands。Kits / engineering Kernels Jupyterling 等 REPL JIT 都用 ORC。

---

## 九、JIT vs Specul side effect 工程师视角

如果你写高性能 VM 服务：

- **热启动**: V8/HotSpot tilt1 编 + 解释阶段时间长——通常 30s+ warm-up。注意 K8s rolling-deployment。
- **Tiered flow peak**：一般 50k-100k 触发 C2 编译—— 做 has 高 throughput 随机负载需要预 warm-up。
- **Memory budget**: JIT cache 通常 256-1GB 内存消耗。Hammerver 控 code cache size via `ReservedCodeCacheSize`、"max JIT"；
- **可重现 build**: JIT 受运行时环境影响——同样 binary、profile 影响运行时性能。常 forgot fixed performance benchmark 上 baseline dry-run 模式可能 不可比。
- **Security**: JIT exec memory 需 PROT_EXEC—让攻击面增加。**Bugs in JIT** (CVE-2018-) 是误 protect hole, **Use-after-free in deopt path common**.

---

## 十、易错清单

1. **JIT run from cold start**: 启动 benchmarking 1000 RPS 给 Go/Java 服务 超高 loadbalancer 上肯定 误。给 warm-up phase , measure 稳态 throughput。
2. **TieredCompilation disabled for benchmark** 容易被忘记: JMH Java benchmark 默认 tiered；profile 全状态。
3. **Devirtualization guard 高估**: 即使 specul devirt 后 90% dependency。若动态类型 fall outside IC 一直 changing (polymorphic call check map)，VIP 中 时间不会看 5-7 类型 STI TurboFan pass 设置 W.
4. **Forever keep JIT-cached code**: W^X memory probs是 fixed-size, JIT `RT_FlushIC` 可能 default-Ignore。需 控制 reserve code size。
5. **LLVM ORC 不能完整 HotSpot C2**: ORC 仅 supports AOT-level opt passes + lazily-compile module——不做 deopt、不做 speculative devirt。
6. **Wasmtime attrdeopt**: Wasmtime 不做 Garbage collection, mem segfault (incl D lang) 无 JIT - silently going abort, limit MC trapping mechanism.

---

## 十一、这一章带走的东西

1. JIT 在运行时 compile, 用 profile 收集真实执行路径与类型信息——AOT 难做到。
2. Tiered Compilation 把解释器 (Ignition HotSpot强大的interpret)、Baseline JIT (Sparkplug C1) optimizing JIT (TurboFan C2) 串发明了启动与峰值的平衡。
3. V8 是 Sea-of-Nodes IR + Inline Cache Feedback + Speculative Deopt——与传统"译成 AOT" 完全不同。
4. HotSpot C2 用 Ideal Graph + escape analysis + CHA + biased locking, 跟 LLVM-O3 比 +5-30% spec-benchmarks.
5. Cranelift 走 "fast compile first, hot code promote to LLVM later"——Wasmtime、 Firefox SpiderMonkey 后端。
6. PyPy 是 trace-based JIT 与 method-based JIT (HotSpot / V8) 派别。
7. JIT run-time risk: profile volatility, code cache, security (PROT_EXEC/W^X), 与启动 warm-up cost 是 AOT 场景仍然 受欢迎原因。

---

下一节 → [分布式系统总览](../../distributed/README.md)
