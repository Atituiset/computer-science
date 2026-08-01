# 5. 编程语言运行时: 四种实现语义

## 一句话

Go / TS / Python / C++ 表面上是四种语言, 但**语言背后的运行时语义决定了数据结构的物理化、内存模型、GC 行为、并发选择**. 同一个 std::vector 在 C++ 与 Rust 里 differ 不大, 但在 Go 切片里多了 (ptr, len, cap) 三元组语义; Python list 用指针数组 + PyObject; JS Array 是 dense backstore + sparse hash fallback. **每一个差异都在暴露运行时设计取舍**.

## 主要差异维度

四种主流语言 (Go / TS / Python / C++) 的运行时在四个维度的不同:

### 1. 内存布局

| 语言 | 列表底层 | 字符串 | 结构体内存 |
|------|---------|--------|------------|
| C++ | 紧排 `T[]` | SSO 字符数组 + heap 指针 | struct 默认 packed |
| Go | (ptr, len, cap) 三元组 backing | Uint8 数组 (不可变 string header) | field 对齐 + padding |
| Rust | `Vec<T>` = (ptr, len, cap) 紧排 | `String` = `Vec<u8>` + utf8 不变量 | 默认紧排, #[repr(C)] 强制 C-ABI 对齐 |
| Python | PyObject** 指针数组 | 字符串对象内嵌 ASCII, 否则堆 | dict + gc |
| Java | 引用数组 + JVM VM compacted | heap String + substring 共享底层 | JVM 字段默认可重排优化 |
| TS (V8) | Smi/HeapNumber Array 双模式 | Two-bytes / Latin1 UTF16 不同编码 | JS object 用 hidden class 字段重排 |

### 2. 内存回收

| 语言 | 回收方式 | 副 / 主代价 |
|------|----------|--------------|
| C++ | 析构 + RAII | 0 (无 GC) |
| Rust | ownership/borrow + Drop | 0 |
| Go | concurrent_tracing_mark_sweep STW 极短 | periodic stop-the-world + 该 batch |
| Python | 引用计数 + 周期性 GC 标记循环 | 引用计数分散开销 |
| Java | G1 / ZGC / Shenandoah 可选 | 不同 latency profile |
| TS V8 | 分代+ compacting | GC 平均 50-200 μs pause |

GC 的 stw 时间是工程上"硬实时" 问题的关键. 这就是为什么 HRT (high reliability timing) 通常要求无 GC 或确控的 ZGC.

### 3. 并发模型

| 语言 | 并发原语 | 编程模型 |
|------|----------|----------|
| C++ | std::thread + mutex + atomic | pthread / 内核线程 |
| Rust | std::thread + Send/Sync | 所有权转移 + sync safety 由 type system 保护 |
| Go | goroutine + channel (CSP 模型) + GMP 调度器 | 协程轻量级 (2 KB / goroutine) |
| Python | GIL 阻碍 + multiprocessing | GIL 是 python 主要瓶颈 |
| Java | thread + lock + JUC | volatile / synchronized / Lock |
| TS | event loop + Promise + Promise.all = CSP 式 | JS event loop 单线程 + webworker |

并发模型决定了:**一句 `shared map[k]++` 在各语言语义不同**:

- C++/Rust: 必须 atomic / lock;
- Go: 用 channel 消息更稳, 否则 sync.Map; 
- Python: 锁 (因 GIL 在 CPython 里通常 100% 单核, 写都很安全);
- Java: synchronized 或 ConcurrentHashMap 或 LongAdder;
- TS: event loop 串行, 没真并发 (除非 webworker);
- 多 worker 之间用 SharedArrayBuffer.

### 4. 抽象类型系统

| 语言 | 类型系统 | 泛型实现 |
|------|---------|-----------|
| C++ | templates 静态 + 多态 | compile-time monomorphization |
| Rust | trait + lifetime 类型系统 | compile-time monomorphization |
| Go | 1.18 加 type params 参数化 | dict 风格 GC-aware |
| Python | 鸭子类型 + 强动态 | 运行时 dispatch |
| Java | 静态类型 + generic box | type erasure + javac 检查 |
| TS | 静态类型检查但 runtime type erased | 半结构静态 |

C++/Rust 的 monomorphization = 编译为类型专用代码 (快) — 但二进制尺寸膨胀. Go 用 dict 实现 = 慢但是 binary 小. 这就是为什么 Rust 写 `Vec<u8>` 和 `Vec<u64>` 性能差; Go 的 `[]int` 和 `[]byte` 在泛型上区别不那么大.

## 同一抽象不同物化: 4 语言 vector push 实测

"为 `Vec<int>` push_back 1M 元素" 在四种语言下的真实表现:

```
C++ / std::vector<int>  push_back 1M:
  - 1M × (1 cycle insert + amortized copy) ≈ 5 ms

Rust / Vec<i32>  push 1M:
  - 类似 C++, 5 ms (LLVM 优化等同于 -O2)

Go / []int  append 1M:
  - 慢一些 ≈ 12 ms (扩容策略略保守 + bounds check + GC bookkeep)

Python list.append 1M:
  - 50-80 ms (ref count + dict overhead)

Java ArrayList<Integer>.add 1M:
  - 60 ms (boxing Integer + indirection)
  - int[] 1M < 5 ms
```

**同一种"动态数组 push"**  在 4 种语言之间差 **10× 量级**; 全部进入"摊还 O(1)". **这就是为什么"复杂度 O()" 在 4 种语言里没法直接比较** - 工程常数被各自运行时折算进来.

## 同构与抽象

把这些"语言运行时差异" 抽离出来, 实际只有 4 个"选择的轴":

1. 内存的紧排性 (C++/Rust 紧排, Python/JS 引用稀疏);
2. 内存回收的延迟 profile (RAII vs GC vs ref count);
3. 并发模型 (线程 vs CSP vs event loop vs GIL);
4. 类型系统 monomorphization vs dynamic dispatch.

这就是我让你建立"跨语言看抽象"能力的 concret实例: **看四种语言时, 不是看语法 sugar, 而是看这 4 条轴上的各自站队**.

## 同一抽象的硬件层

有趣的是:这 4 条轴**在硬件层同样适用**:

```
1. 数据紧排：cache-friendly row-major vs linked;
2. 回收：手动 free / 自 delete / GC;
   - FPGA 上的数据通路通常手动管理, 类似 RAII;
3. 并发：硬件层线程 + axi-stream + atomic;
4. 类型 / 多态：VLIW 指令 vs SIMD 多通道 vs dynamic dispatch.
```

这次我们发现"语言运行时"+"硬件层"在数据通路、回收、并发、多态这 4 个维度上**成对** 同构. 硬件 + 软件语言层共享同一组抽象决定.

## 这一章带走的东西

- 4 语言的运行时差异可压缩到 4 条轴:内存紧排、GC 模型、并发、类型双编译实现;
- 同一算法的常数差可达 10×, "/O/() 在跨语言运行时下不能跨比较" ;
- 软件运行时的 4 条轴与硬件的 4 条轴成对同构;
- 工程师选语言不仅是 syntactic 偏好, 是对 4 条轴的选择组合;
- 学语言时抓住"这 4 条轴上你站在哪里"就是抓住了语言本质.

下一篇 → [6. 并发与一致性: 单机到分布式同构](concurrency-consistency.md)
