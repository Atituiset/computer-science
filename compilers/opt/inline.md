# Inline / IPA / Escape Analysis

## TL;DR

Inline 的本质是函数调用 emit 在 caller 处展开——节省调用开销（passing 参数、保存寄存器、branch 一直到 callee 入口、return jump），更重要的是**让下游 pass 看穿函数边界做更深的优化**。Inline 单独看不重要，但它解锁了常量传播、DCE、向量化所有跨函数优化的能力。IPA (Inter-Procedural Analysis) 是跨函数的信息流分析——什么函数会逃逸什么指针、pure/pure 函数识别、call graph 构造。Escape Analysis 决定堆分配能否变成栈分配——Java HotSpot、Scala Dotty、Go escape analysis 都用这个砍掉 90% 的无用堆分配。

---

## 一、Inline 的成本 vs 收益

### 数值模型

每次 call 的代机：
- 几条指令准备参数（栈/寄存器安排）
- `call` 指令（push return address, jump）—— 几个 cycle
- 几条 callee prologue 保存 callee-saved 寄存器
- epilogue 恢复
- `ret` 指令 (pop + jump)

总开销 5-30 cycle 视现代 CPU 分支预测器、call/ret stack 是否存在而有不同。一次 call 不到 10 cycle 在 Branch Target Buffer + Return Address Stack 命中的情况下。

### 解锁 downstream pass 的价值

```c
int square(int x) { return x * x; }
int sum(int x, int y) { return x + y; }

int compute(int a) {
    return sum(square(a), square(a + 1));
}
```

`square` 是小函数，inline 后：

```c
int compute(int a) {
    int t1 = a * a;
    int t2 = (a + 1) * (a + 1);
    return t1 + t2;
}
```

现在下游 pass 能看到 `t1 + t2` 的实际表达式。**CSE** 能识别 `a*a` 这种纯算术共现，**strength reduction** 能判定 `a*a` 是否需要查表——key benefit is **下游 pass 不划界面**。

### LLVM Inline 的 cost model

`llvm::InlineCost` 估计 inline 后基本块数、指令数、call 数。常量参数 inline 后能消除死代码会减少成本。

阈值：
- `-O0`: 几乎不 inline
- `-O1`: 偶尔 inline（小函数）
- `-O2`: 中等阈值 inline（~50 指令阈值）
- `-O3`: 激进 inline
- `__attribute__((always_inline))`: 强制
- 虚函数 / 间接调用：编译期不可 inline（除非 devirtualization）

### C++ 模板的隐式 inline

```cpp
template<int N> int factorial() { return N * factorial<N - 1>(); }
template<> int factorial<0>() { return 1; }

int main() { return factorial<5>(); }     // 完全编译期展开 → return 120
```

模板 + 常量参数 → 整段代码 inline + SCCP + 常量折叠 = 编译期计算。这就是 C++ 表达式模板 (Eigen、Blitz) 的核心。

---

## 二、IPA (Inter-Procedural Analysis)

Inline 是它的特例。**IPA** 包括：

| 分析类型 | 用途 |
|---------|------|
| Call Graph | 谁调谁，用于 inline、devirt、reflection |
| Mod/Ref Analysis | 函数会修改/读取哪些全局/参数指针 |
| Pure Function Detection | 没副作用，可被 DCE 删除 |
| Escape Analysis | 哪些对象不会逃逸函数外，可栈分配 |
| Points-to Analysis | 哪些指针可指向哪些对象 |

### Mod/Ref Example

```c
int g = 0;
void f(int *p) { *p = 1; }
void g_caller() {
    f(&g);          // Mod analysis: g 被 modified
    return g;       // 不是 0，是 1
}
```

IPA 知道 `f` 会 Mod 它的参数指针 → caller 知道 `g` 会被改 → 看穿 f 的行为。

### Pure Function Detection

```c
int square(int x) { return x * x; }       // pure
int counter() { static int n = 0; return ++n; }  // not pure (有 static 副作用)
```

Pure 函数：
- 不读/写任何可变全局
- 不调用非 pure 函数
- 不 deref 可逃逸的指针

LLVM 的 `inferattrs` pass 静态推断，能标 `readnone`/`nocallback` 等。LLVM 中段 pass 跑 lib 优化时 callee 标 readnone → caller 可以删 caller 看来"结果用不上的"调用。

### Devirtualization

虚函数调用 (C++ `virtual`) 通过 vtable 间接调用，编译期难内联。但若有上下文信息可推断动态类型：

```cpp
struct Base { virtual int f() { return 1; } };
struct Derived : Base { int f() override { return 2; } };

void caller() {
    Derived d;
    Base *p = &d;
    return p->f();     // 实际是 Derived::f，编译期可推
}
```

LLVM 的 `devirt` pass:
- 若 `p` 在函数内创建 (类型确定) → 直接 dispatch
- 若是参数但 callgraph 显示只有一种可能实现 → speculatively devirt
- 若是 vtable 上的 known call site 位置 → RFC

Speculative devirtualization：先 emit direct call + guard check 类型→ 没识别成功 fallback 回 indirect call。**VM 内的 type profile** 收集动态类型分布，re-compile + OSR 重入更精确版本。

---

## 三、Escape Analysis

###什么是 escape

```java
Object foo() {
    Object o = new Object();
    return o;          // o 逃逸到 caller
}

void bar() {
    Object o = new Object();
    use(o);            // 不再 escape → 可栈分配
}
```

### Java HotSpot 的 EA

HotSpot C2 在 Sea-of-Nodes 上做 escape analysis：
1. **Global escape**: 赋值给 static、return 给 caller、赋给 instance field 逃逸求外。
2. **Arg escape**: 传给其他函数作为参数（但仍仅 thread-local）。
3. **No escape**: 仅函数内访问。

No escape 的 `new` 直接栈分配（scalar replace），同步锁消除（若未逃逸则 lock-to-unlock 信息可消除 monitor）。

### Go 的逃逸分析

Go 编译器（cmd/compile/internal/escape）做逃逸分析。常见规则：

| 写法 | 逃逸 |
|------|------|
| `func foo() *int { x := 1; return &x }` | 逃逸到堆 |
| `func foo() { x := 1; bar(&x); }` 看 bar 是否会保存 | 取决于 bar |
| `fmt.Println(&x)` | 经常逃逸（Fmt 处理 interface{}） |
| `s := make([]int, n)` n > 64KB | 逃逸到堆 |

Go 的 philosophy 是：能用栈就用栈，减少 GC 压力。**初学者写 Go 总是 hybridize**：`return []*Foo{...}` 让切片逃逸，切片里指针逃逸 → 大量堆 alloc。

### Rust 一切默认栈

```rust
fn foo() {
    let x = Box::new(1);       // x 是 Box<i32> 指针，外层 stack，*x 仍在 heap
    return *x;                  // 返回 i32，Box 释放 → 仅 stack 副作用
}
```

Rust Box 总在 heap；其他默认 stack。Escape analysis 不需要——`move` 语义让所有权流动。

---

## 四、LTO (Link-Time Optimization)

普通 IPA 受限于单 compilation unit：`a.c` 看不到 `b.c` 的函数实现。LTO 把 IR 总结到 link 阶段一起优化。

### LLVM LTO 流程

```
clang -c a.c -flto -o a.o   # a.o 内含 LLVM BC，不是机器码
clang -c b.c -flto -o b.o
clang -flto a.o b.o -o prog
# link 时把所有 BC 合并成一个 module
# 跑 module-level inline、IPA、DCE、whole-program devirt
```

**ThinLTO**：把 module 合并改成"summary + 并行 pass"——众多 TU 各自跑独立 opt pass，只用 cross-TU summary 信息——比 full LTO 速度快 4-8x, 收益小 10%。

### Firefox、Chrome 的 LTO

Chromium 用 ThinLTO + PGO —— TLDR 来说编译 30%、二进制小 15%、运行时快 5%。Link 阶段变成 30+ 分钟，但 binary 性能可接受。

### GCC LTO (ELF vs Windows)

GCC LTO 用 ELF section 存 IR，在 link 上合并。Windows COFF 用类似机制，工程师需 specifc linker (`gold` 或 `mold`) 加速。

---

## 五、Inline 的麻烦事

### Recursive 函数

```c
int fact(int n) {
    if (n == 0) return 1;
    return n * fact(n - 1);
}
```

inline 递归 → 无限展开。编译器识别 self-recursive edge，只 partial inline 一个 voxel。

### 大函数 + 多 call site

```c
void huge() { /* 5000 行 */ }
void a() { huge(); }
void b() { huge(); }
```

inline huge 到 a、b 后体积膨胀 2x。LLVM 的 strategy：保留一份 huge 给 a、b 调用，并对 a、b 做 partial inline（inline 入口 + 显式 jump 回 huge 中部）。

### Cross-language Inline

C + Rust FFI 不能 inline——调用走 ABI 边界。Rust 的 `pub fn` 在 `extern "C"` 后是 ABI 边界，不能 inline 进 C。但若都是 Rust lto=true 可以跨 crate inline。

### Cold Path Inline

PGO 显示某函数只在 0.1% 的执行路径调用：

```c
void fast_path() { /* hot */ }
void slow_path() { /* cold, 1000 行 */ }
void f() {
    if (rare) slow_path();
    else fast_path();
}
```

cold path **不要 inline**——inline 增大 caller 体积，污染 i-cache。LLVM `coldcc` calling convention 让 cold path 放到 binary 末尾，对分支预测友好。

### Inline 反复制副作用

```c
int counter() { static int n = 0; return ++n; }
int f() { return counter() + counter(); }
```

inline 后：

```c
int f() { return (++n) + (++n); }
```

这改变了求值顺序（C UB / Rust/Java 有定义但结果不同）。**绝不可 inline 非纯函数多次评估语义**。LLVM 在没标 SSA 是 `readnone` 的情况下保守不 inline 多次。

---

## 六、HotSpot 的 Layered Compilation

HotSpot 现代虚拟机用 **tiered compilation**：

1. **Tier 0**: 解释器
2. **Tier 1**: C1 编译，简单 Fast Compilation
3. **Tier 2**: C1 with profiling
4. **Tier 3**: C1 with profiling + 一些 opt
5. **Tier 4**: C2 编译——Sea-of-Nodes + escape analysis + aggressive inlining

profile 收集每个 call site 被调用的实际类型、每条 branch 的触发次数。C2 编译时把 profiling C1 传来的 type/branch info 用进 inline 决策。**这就是 Java 接近 C 性能的秘诀**——无 profile 静态编译做不到 100% inline 决策正确。

---

## 七、易错清单

1. **`__attribute__((always_inline))` 不能强制 recursive inline**：编译器拒绝递归，加 inline hint 也会被拒。
2. **Inline 不代表语言层面的"声明 inline"**：C++ `inline` 关键字只代表"允许多 TU 出现定义"，不强制 inline。
3. **Cross-language LTO 需要同等 IR**：Rust + C 不能 cross language LTO，除非都是 LLVM。GCC `lto-plugin` 处理 ELF link-time。
4. **没标 pure 的 call 不要轻易 DCE**：副作用错删是大事故。LLVM 的 LLVM IR 要 correct `readnone` 标注，否则保留。
5. **Box 不在 stack**：Rust Box 一定 heap。但 Option<Box<T>> 的某些编译期转换会布尔字段化（niche optimization），看懂 stack vs heap 区别。
6. **Go 闭包捕获引用类型逃逸**：`func() { s := []int{}; goroutine(func(){ s = append(s, 1) }); }` → s 逃逸到堆，由 goroutine 同时持有。

---

## 这一章带走的东西

1. Inline 不省 cycle，是**让下游 pass 看穿函数边界**。
2. IPA 是 mod/ref、pure detection、call graph 的统称，依赖 LTO 才能跨 translation unit。
3. Escape Analysis 决定堆→栈分配，Java HotSpot、Go 编译器都用它砍 GC 压力。
4. Devirtualization 需 profile + speculatively inline，HotSpot 把这套发挥到极致。
5. Tiered Compilation 把 JIT 重编开销摊平——profile 收集 + OSR + 重入 = Java 接近 C 的核心机制。
6. LTO 是 IPA 的 link-time 实施，ThinLTO 平衡编译时间与收益。

---

下一节 → [Codegen 总览](../codegen/index.html)
