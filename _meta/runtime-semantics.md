# 5. 编程语言运行时: 四种实现语义

## 一句话

Go / TS / Python / C++ 表面上是四种语言, 但**语言背后的运行时语义决定了数据结构的物理化、内存模型、GC 行为、并发选择**. 同一个"动态数组"在 C++ 与 Rust 里差别不大 (`std::vector` 与 `Vec<T>` 都是紧排三元组), 但在 Go 切片里多出 (ptr, len, cap) 的显式语义; Python list 是 `PyObject*` 指针数组; JS Array 在紧凑存储和稀疏字典模式之间切换. **每一个差异都在暴露运行时的设计取舍**.

## 思想链

```
工程问题: 同一行代码 list.append(x), 为什么四种语言差 10×?
  └─► 运行时在 4 条轴上各自站队
        └─► 轴1 内存布局: 紧排 (C++/Rust) vs 引用稀疏 (Python/JS)
              └─► 决定 cache miss 次数与 SIMD 可能性
        └─► 轴2 回收策略: RAII vs tracing GC vs 引用计数
              └─► 决定尾延迟分布 (P99 由 GC 停顿决定)
        └─► 轴3 并发模型: 内核线程 / CSP / event loop / GIL
              └─► 决定争用结构与调度开销
        └─► 轴4 多态实现: 编译期单态化 vs 运行期动态派发
              └─► 决定热循环里有没有间接调用
  └─► 复杂度记号 O() 相同 ≠ 性能相同: 工程常数被运行时折算进来
```

## 主要差异维度

四种主流语言 (Go / TS / Python / C++) 的运行时在四个维度上的不同:

### 1. 内存布局

| 语言 | 列表底层 | 字符串 | 结构体内存 |
|------|---------|--------|------------|
| C++ | 紧排 `T[]` | SSO 栈上字符数组 + heap 指针 | struct 默认成员对齐 |
| Rust | `Vec<T>` = (ptr, len, cap) 紧排 | `String` = `Vec<u8>` + UTF-8 不变量 | 默认重排对齐, `#[repr(C)]` 强制 C-ABI 布局 |
| Go | (ptr, len, cap) 三元组指向 backing array | 不可变 string header + UTF-8 字节数组 | field 对齐 + padding |
| Java | 引用数组 + 压缩指针 (compressed oops) | heap String + substring 共享底层数组 | JVM 字段可重排优化 |
| Python | `PyObject*` 指针数组 | 字符串对象内嵌 ASCII, 否则堆上 | dict + gc 头 |
| TS (V8) | 紧凑元素存储, 稀疏时退化字典模式 | Latin-1 / UTF-16 双编码切换 | hidden class 决定字段布局 |

### 2. 内存回收

| 语言 | 回收方式 | 代价特征 |
|------|----------|--------------|
| C++ | 析构 + RAII | 零运行时开销, 生命周期错误由人负责 |
| Rust | ownership/borrow + `Drop` | 零运行时开销, 错误移到编译期 |
| Go | 并发三色标记清扫, STW 极短 | 后台 CPU 占用 + 写屏障开销 |
| Python | 引用计数为主 + 分代 GC 兜底循环引用 | 计数操作分散在每条指令, 周期性停顿 |
| Java | G1 / ZGC / Shenandoah 可选 | 不同延迟 profile 可插拔 |
| TS V8 | 分代 + compacting | GC 平均停顿 50-200 μs |

GC 停顿时间是工程上"硬实时"问题的关键. 这就是为什么硬实时场景 (HFT、音视频、游戏 tick) 通常要求无 GC 语言, 或选可预测停顿的 ZGC / Shenandoah——与 [摊还 vs 最坏](amortized-vs-worst.md) 的张力同源.

### 3. 并发模型

| 语言 | 并发原语 | 编程模型 |
|------|----------|----------|
| C++ | `std::thread` + mutex + atomic | pthread / 内核线程 |
| Rust | `std::thread` + Send/Sync | 所有权转移, 线程安全由类型系统静态保证 |
| Go | goroutine + channel (CSP) + GMP 调度器 | 协程轻量级 (~2 KB / goroutine) |
| Java | thread + lock + JUC | volatile / synchronized / Lock |
| Python | multiprocessing 绕开 GIL | GIL 是 CPython 的主要并行瓶颈 |
| TS | event loop + Promise 异步编排 | JS 单线程事件循环, 重活交给 worker |

并发模型决定了:**同一句 `map[k]++` 在各语言里语义完全不同**:

- C++/Rust: 必须 atomic 或加锁;
- Go: 用 channel 传所有权更稳, 否则 `sync.Map` / 加锁;
- Python: GIL 让单字节码近似原子, 但"读-改-写"复合操作仍需锁;
- Java: `synchronized` / `ConcurrentHashMap` / `LongAdder`;
- TS: event loop 串行执行没有真并发 (除非开 worker);
- 多 worker 之间用 SharedArrayBuffer + Atomics.

### 4. 抽象类型系统

| 语言 | 类型系统 | 泛型实现 |
|------|---------|-----------|
| C++ | 模板 (静态多态) | compile-time monomorphization |
| Rust | trait + lifetime | compile-time monomorphization |
| Go | 1.18+ type params | 字典分发 + 部分特化 (gc shape stenciling) |
| Java | 静态类型 + 泛型 | type erasure, 只做编译期检查 |
| Python | 强动态 + 鸭子类型 | 运行时 dispatch |
| TS | 编译期类型检查 | 运行时类型全部擦除 |

C++/Rust 的 monomorphization 把泛型编译成类型专用代码 (快), 但二进制膨胀; Go 用字典实现 (慢一些但二进制小). 这就是为什么 Rust 写 `Vec<u8>` 和 `Vec<u64>` 会生成两份代码, 而 Go 的泛型切片共享一份实现.

## 同一抽象不同物化: 4 语言 vector push 实测

"向动态数组 push 100 万个 int" 在四种语言下的真实表现:

```
C++ / std::vector<int>  push_back 1M:
  - 1M × (1 cycle 插入 + 摊还拷贝) ≈ 5 ms

Rust / Vec<i32>  push 1M:
  - ≈ 5 ms (LLVM -O2 下与 C++ 几乎相同)

Go / []int  append 1M:
  - ≈ 12 ms (扩容策略保守 + bounds check + GC 写屏障记账)

Python list.append 1M:
  - 50-80 ms (引用计数 + PyObject 头开销)

Java ArrayList<Integer>.add 1M:
  - ≈ 60 ms (Integer 装箱 + 指针间接)
  - int[] 直填 1M < 5 ms
```

**同一个"动态数组 push"**, 在 4 种语言之间差出 **10× 量级**; 而它们全都号称"摊还 O(1)". **这就是为什么复杂度 O() 无法跨语言直接比较** —— 工程常数被各自的运行时折算进来了.

## 同构与抽象

把这些"语言运行时差异"抽离出来, 实际只有 4 条"选择的轴":

1. 内存的紧排性 (C++/Rust 紧排, Python/JS 引用稀疏);
2. 内存回收的延迟 profile (RAII vs tracing GC vs 引用计数);
3. 并发模型 (内核线程 vs CSP vs event loop vs GIL);
4. 类型系统: 单态化 vs 动态派发.

这是建立"跨语言看抽象"能力的具体实例: **看四种语言时, 不是看语法糖, 而是看这 4 条轴上各自站队**.

> [!NOTE]
> 轴 4 (单态化 vs 动态派发) 的编译器实现细节见 [JIT / tiered compilation / V8 / JVM](../compilers/codegen/jit.md); 类型系统层面的推导见 [类型系统与 HM 推断](../compilers/sema/type-system.md).

## 同一抽象的硬件层

有趣的是: 这 4 条轴**在硬件层同样适用**:

```
1. 数据紧排: cache-friendly 的 row-major 流 vs 逐指针追逐;
2. 回收:    手动生命周期管理 (RAII 式) vs 数据流一次性使用即弃;
            FPGA 数据通路几乎总是后者——没有分配, 只有流动;
3. 并发:    多核线程 + AXI-Stream + 硬件原子;
4. 多态:    指令级静态分发 (SIMD/VLIW 定长编码) vs 微码动态翻译.
```

我们发现"语言运行时"与"硬件层"在数据布局、回收、并发、多态这 4 个维度上**成对同构**. 硬件与软件语言层共享同一组抽象决策.

## 这一章带走的东西

- 4 种语言的运行时差异可以压缩到 4 条轴: 内存紧排、回收策略、并发模型、多态实现;
- 同一算法的实测常数差可达 10×, **复杂度 O() 不能跨语言直接比较**;
- 软件运行时的 4 条轴与硬件的 4 条轴成对同构;
- 工程师选语言不是 syntactic 偏好, 而是对 4 条轴的选择组合;
- 学新语言时抓住"它在 4 条轴上站在哪里", 就抓住了语言本质.

> [!TIP]
> 读跨语言 benchmark 前先问三件事: 数据是不是紧排? 有没有 GC 停顿被算进去了? 泛型走的是单态化还是字典? 三问之后, 大部分"X 比 Y 快 3 倍"的结论都能自己解释.

## 一页速查

| 轴 | 紧排代表 | 疏排代表 | 工程含义 |
|----|----------|----------|----------|
| 内存布局 | C++ / Rust | Python / JS | cache miss 与 SIMD 上限 |
| 内存回收 | RAII (C++/Rust) | GC (Go/Java/JS) / 引用计数 (Python) | 尾延迟 P99 形状 |
| 并发模型 | 内核线程 (C++/Java) | CSP (Go) / event loop (TS) / GIL (CPython) | 争用结构与切换成本 |
| 多态实现 | 单态化 (C++/Rust) | 字典/擦除 (Go/Java/TS) / 动态派发 (Python) | 二进制体积 vs 热路径速度 |

下一篇: [6. 并发与一致性: 单机到分布式同构](concurrency-consistency.md)
