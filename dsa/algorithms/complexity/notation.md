# 渐进记号的真实含义

## 一句话

`O(f(n))` 不是"快慢"，是"函数被夹在哪个量级里";它只告诉我们**当 n 趋于无穷时增长的形状**，不告诉我们任何常数、任何 cache 行为、任何 CPU 流水线效应。所以**只看 O 是工程师的天真阶段**——但同时记住：完全没有 O 的工程化分析也是不可能的。这一章的任务是把这两层同时立起来。

## 形式定义

把 `f` 和 `g` 都看作 `ℕ → ℝ⁺`。捕获三种"夹逼"方向：

- `f = O(g)`：存在 `c > 0` 和 `n₀` 使得 `∀n ≥ n₀` 有 `f(n) ≤ c · g(n)`.  即"**f 的增长不会跑过 g 的某个常数倍**".
- `f = Ω(g)`：存在 `c > 0` 和 `n₀` 使得 `∀n ≥ n₀` 有 `f(n) ≥ c · g(n)`.  即"**f 的增长不会慢于 g 的某个常数倍**".
- `f = Θ(g)`：刚好同时是 O 和 Ω。"两边都被常数夹死".
- `f = o(g)` / `f = ω(g)`：严格小、严格大（取极限之比分别为 0 与 ∞）.

> [!WARNING]
> 习惯写法 `f = O(g)` 里的 `=` 不对称。`O(g)` 是一个**函数集合**，严格写法是 `f ∈ O(g)`. 但业界已经把 `{f | f = O(g)}` 当成口语化的某个等价集，所以约定俗成就这样了。你读 `"T(n) = O(n log n)"` 时脑子里要翻译成"T(n) 落在 Θ(n log n) 差不多的量级上"。

## 工程师对渐进的五层误读

### 误读 1：O(1) 一定比 O(log n) 快

错。`O(1)` 里的常数项决定小规模胜负。例子：哈希单次操作 ≈ 几十到几百条指令（hash、mod、可能的 cache miss、可能的 tombstone 探测）；二分单次 ≈ 10 条指令（一次比较 + 一次地址加法 + 一次 cache hopeful 读）。n < 100 时二分一般是赢的。

> [!NOTE]
> benchmark 上一个常见的反例：Go map 在 100 个键时比 `sort.Search` 慢。这就是"O(1)"输给"O(log n)"在工程现场的实证。说明渐进常数大于 10。

### 误读 2：O(log n) 都是一个量级

`log` 的底是常数差异。`log₂ n` 与 `ln n` 差一个 ln 2 ≈ 0.69 的乘性系数。看起来微不足道，但在**每次比较代价高**时：
- 二叉树每次比较 1 cycle；
- 红黑树 + string key 时每次比较可能上百 cycle（strcmp 遍历整个 key，常常命中 cache 也不好）;
- B+ 树页内比较一次后用 SIMD 8-wide 一次比 8 个 key —— 常数缩小 8 倍.

到这里你就理解了：**大 O 不区分 log 的底，但工程常数能差 10 倍**.

### 误读 3：平均复杂度 = 期望复杂度

"平均"必须指明分布。CLRS 上写"平均"默认均匀分布；而**工程平均**常常是"产品实际输入分布下的期望".
- 排序算法的"平均 O(n log n)"指所有排列等可能；
- 同样的快排在"已序数据"上能退化到 O(n²)。

这就是为什么 std::sort 用 introsort（递归深度超过 2 log n 时切到 heap sort），是给"平均分析失效"打的补丁。

### 误读 4：O(n) 里只有一个常数

数字电路视角告诉我们：`O(n)` 里其实有两次 трагедия：

1. **每条指令的 throughput 是 1 ns 级别**（约 3 GHz / cycle）。
2. **每次内存访问的 latency 从 1 ns (L1) 到 80 ns (DRAM)**.

所以同样 O(n)，cache-friendly 版本能跑出 100 GB/s 的内存带宽；cache-hostile 版本只能跑出 5 GB/s。**差 20 倍**。这就是为什么工程里"常数因子"实际上跨两个数量级是常态。

### 误读 5：复杂度能直接指导性能

不能。O 给的是形状，性能还要看：
- 常数；
- cache-locality；
- 分支预测准确率（分支错误一次流水线 flush 浪费 ~15 cycle）；
- SIMD vectorization（紧邻操作可向量化时跑 4-wide/8-wide）；
- TLB 命中（4K page 对 1 GB 数据需要 256K TLB 项，远超 TLB 大小）；
- NUMA（跨 socket 访问再加 100+ ns）。

下面我们把这些点逐层揭示——它们各自都是计算机科学的"硬"层级，**复杂度只是这一切的抽象外壳**.

## 主定理：分治复杂度从哪儿来

`T(n) = a · T(n/b) + f(n)` 的三条规则，背后是**比较 f 与 `n^(log_b a)` 哪个主导**：

| 情形 | 条件 | 结论 |
|------|------|------|
| 1 | `f = O(n^(log_b a − ε))` | `T = Θ(n^(log_b a))` |
| 2 | `f = Θ(n^(log_b a · log^k n))` | `T = Θ(n^(log_b a · log^(k+1) n))` |
| 3 | `f = Ω(n^(log_b a + ε))` 且 regular | `T = Θ(f(n))` |

直觉：**两个 "工程贡献"——递归子树数量 a 与每个分裂的合并工作 f——哪个增长更快，就是 T 的主导**.

| 场景 | a | b | f(n) | T(n) |
|------|---|---|------|------|
| 二分查找 | 1 | 2 | O(1) | Θ(log n) |
| 归并排序 | 2 | 2 | O(n) | Θ(n log n) |
| Strassen 矩阵乘法 | 7 | 2 | O(n²) | Θ(n^log₂7) ≈ Θ(n^2.807) |
| Karatsuba 大整数乘 | 3 | 2 | O(n) | Θ(n^log₂3) ≈ Θ(n^1.585) |
| 普通斐波那契递归 | 2 | 1 | O(1) | Θ(2^n)（不在主定理范围，但用同一思路） |

主定理的工程隐藏点：**它忽略常数**。Strassen 在 n < 100 常输给朴素乘法，原因就是常数 7 比 8 大，但每层多做很多加法和地址跳。

> [!NOTE]
> 这就是为什么平均 O(n^2.807) 的 Strassen 直到 n ≈ 1000 才稳定赢过 O(n^3) 朴素。**当 n 还在 cache 里时，cache-friendly 的朴素矩阵乘能跑到 30+ GFLOPS**，而 Strassen 的间接内存 pattern 跑不到 10 GFLOPS。CPU 通用核心的算力差距被掩盖在大 O 里。

## 从 O 到运行时间的链路

让我们把"复杂度"和"真实运行时间"的链路逐层补完。以一次 `for (i=0; i<n; i++) sum += a[i];` 为例。

### 1. 复杂度层：O(n)

这是抽象最高层。我们只说访问模式线性增长。

### 2. 指令数层：约 4n 条指令

x86 汇编大致：

```
mov  rax, [a]             ; 取数组基地址
xor  ecx, ecx             ; sum = 0
loop:
    mov  edx, [rax + 4*i] ; 一次 load
    add  ecx, edx         ; 加到 sum
    inc  i                ; i++
    cmp  i, n
    jb   loop
```

四条指令，每轮迭代都要跑一次。所以总开销约 `4n` 条指令。

### 3. 指令 throughput 层：约 1 ns / iter

现代 CPU 每条简单整数 ALU 指令 throughput ≈ 0.25～0.5 cycle。但内存 load 在 cache hit 时 latency 仍 ~4 cycle (L1)，hit rate 100% 时通过流水线可以"叠"到每 cycle 一条 load。所以每个循环迭代大约 1 cycle = 0.33 ns（按 3 GHz）.

总时间：~ n ns. 一个 10^8 个 int 的求和：~ 100 ms.

### 4. cache / TLB 层：内存层级拉宽到 80 ns

CPU cache 是金字塔：

```
register   ≈ 0 cycle       (1-2 ns as architecture)
L1 (32KB)  ≈ 4 cycle       (~1 ns)
L2 (256KB) ≈ 12 cycle      (~4 ns)
L3 (8MB)   ≈ 40 cycle      (~12 ns)
DRAM       ≈ 200 cycle      (~80 ns)
```

如果数组远超 L3 —— 10^8 int = 400 MB —— 那么 load 几乎都命中 DRAM，每次 wait 80 ns 即 200 cycle。CPU 的 prefetcher 会主动找出连续模式提前加载到 cache line 64 字节，**让一次 80 ns 的 DRAM access 满载 16 个 int 加法**. 加上 SIMD 一次加 4-8 个 int：

```c
// AVX2 一次加 8 个 int32
__m256i vsum = _mm256_setzero_si256();
for (int i = 0; i + 8 <= n; i += 8) {
    __m256i v = _mm256_loadu_si256((__m256i*)&a[i]);
    vsum = _mm256_add_epi32(vsum, v);
}
```

效果：~3 cycle per 8 个 int，折合每元素 1 ns 的 **1/15**：8 GB/s 顺序流可到 100+ GB/s。

到这里你应该看见：**O(n) 在不同层之下能差 100 倍，但它们都叫 O(n)**.

### 5. 数字电路层：cache line 为什么是 64 字节

为什么是 64 字节而不是 32 或 128？

- 一行读出要并行传输给 L1：64 字节正好是 DDR 一条 burst length (8 × 8 字节 = 64)；
- L1 的 ECC、tag 位、一致性管理都按行做，64 字节让 L1 + L2 + L3 行号对齐，**简化了一致协议 (MESI/MOESI)**；
- 主板上 64 字节也对应 PCIe 一次 TLP payload 上限（Completer 上限典型 128B/256B，但 cache line 仍是 64B）。

所以"64"不是任意数字，是**DRAM burst 与 cache 一致协议共同压制的结果**。这就是"知其所以然"的底层：连 64 这个常数都是数字电路决定的。

### 6. FPGA 视角：BRAM/SRL/分布式 RAM 是另一套

FPGA 不是 CPU 上的 cache 模型。Altra/Xilinx FPGA 里有：

- **Distributed RAM**（每个 LUT 都能当 64 bit RAM）—— 极快，几十 ps；
- **URAM / BRAM**：块 RAM，>1 Mbit，~1-2 cycle；
- **HBM**：3D 堆叠 DRAM，~30-100 GB/s/channel，~ 80 ns latency。

FPGA 上的算法设计常常把一个图处理算法**展开成 pipeline**：每个 cycle 进一个 vertex、出一个 vertex，让所有计算在几百 MHz 频率下展开运行，而不是"O(n) 循环". 这就是把 O(n) 工程化到硬件层。

你看，**同一个 O(n) 的求和，从软件常数 3 到数字电路常数 1/15 再到 FPGA 的 "1 cycle/element"**——每一层都有它自己的常数。

## 主导项之外的相加规则

一句话：**相加取最坏，相乘入相邻**.

```
O(f) + O(g) = O(max(f, g))     # 比如 O(n log n) + O(n) = O(n log n)
O(f) × O(g) = O(f × g)         # 嵌套循环 O(n × m)
O(f) + o(f) = O(f)             # 低阶项被吞噬
```

但有边界陷阱：

- `T(n) = T(n-1) + n` 不是 `O(n)` 而是 `O(n²)` —— 是等差级数累计的闭式，**不是简单相加**.
- `T(n) = T(n-1) + 2T(n/2) + n` —— 退化递归；先画递归树数工作总量，不要直接进主定理。
- `T(n) = 2T(n/2) + n/log n` —— 主定理 case 2 的"烦人角落"（Akra-Bazzi 才稳）；结论是 `Θ(n log log n)`。

工程里写递归/分治之前，**至少画一次递归树画三行**，避免被主定理的形式骗到。

## 速查表（含工程常数注释）

| 渐进 | 实际 ops @ n=10⁶ | 工程注释 |
|------|------------------|----------|
| O(1) | 几 ns | 哈希、寻址、SIMD 单向 |
| O(log n) | ~20 次比较 | 树、堆、二分；热区一般 ~10 ns |
| O(n) | ~10⁶ ops | cache 友好 ~3 ms；cache hostile ~50 ms |
| O(n log n) | ~2×10⁷ ops | 排序门限；32 MB 数据 ~100 ms |
| O(n²) | 10¹² ops | n=10⁶ 必死；n=10⁴ 约 100 ms |
| O(2ⁿ) | 不可行 | n≤30 才能跑 |

## 这一章带走的东西

- O / Ω / Θ 是夹逼式的，`=` 是个误用符号；
- O 的工程常数能跨两个数量级，因为 cache + 流水线 + SIMD 三者各贡献一个"乘性加速"；
- O(log n) 在工程里和底不同（B+ 树页内 SIMD 比一次对 8 个 key —— "log 底 8"）；
- 主定理忽略常数，Strassen 在 cache 内打不过朴素乘法是"O 不够看"的最典型案例；
- 一行 `O(n)` 求和从顶层 software 常数 3 一路到 FPGA 1 cycle/element，每一层都是一层硬件知识.

下一节 → [摊还分析入门](amortized.md)：把"序列总和"的渐进分析框入工程可证的形式。
