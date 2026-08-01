# 数组与动态数组

## 一句话

数组是几乎所有数据结构的"底座"——你今天在工程里碰到的链表、树、堆、图，理论上可以换成数组下标实现，因为**数组下标和指针在 CPU 层面是一回事**：连续内存 + 偏移量。理解了这层，再去看 B+ 树用 page 数组、堆用层号编址、并查集用 parent[] 数组，会一眼通透。

## 静态数组的物理形态

静态数组 `T a[n]` 在内存里就是一段连续 `n · sizeof(T)` 字节。读 `a[i]` 编译成两步：

```
addr  = a + i * sizeof(T)        // 算地址
value = load(addr)              // 从那个地址读
```

第一步是单条 ADD 指令，第二步是单条 load 指令。也就是说**索引访问是 1 次加法 + 1 次内存读**。这俩加起来在很多 CPU 上还不到 1 纳秒。这就是为什么大家说"数组是 O(1) 访问"——这里的 O(1) **常数项极小**，小到比绝大多数哈希的真实常数还小。

但 O(1) 这四个字容易骗人。你做下面这个实验：

```c
// 1024 x 1024 int 矩阵
int m[1024][1024];

// 模式 A：按行扫
for (int i = 0; i < 1024; i++)
    for (int j = 0; j < 1024; j++) sum += m[i][j];

// 模式 B：按列扫
for (int j = 0; j < 1024; j++)
    for (int i = 0; i < 1024; i++) sum += m[i][j];
```

两者都是 `O(n²)`，编译器看到的两层 for 几乎一模一样。但在我手边的机器上跑：模式 A ≈ 0.4 ms，模式 B ≈ 4 ms。**差 10 倍**。

原因：现代 CPU 不是"按字节读内存"，而是按 cache line（通常 64 字节，恰好等于 16 个 int）整块载入 L1；预取器还会主动预读接下来用到的连续地址。模式 A 顺着 cache line 走，**16 次加法共享一次内存读**；模式 B 每次跨到下一行，cache 老是 miss。

> [!NOTE]
> 严格说，O(1) 只回答"乘积数轴上的极限速率"。而真实世界的 CPU 内嵌了**内存层级**——L1 (~1 ns) / L2 (~4 ns) / L3 (~12 ns) / DRAM (~80 ns)，跨度 80 倍。**O(1) 里的那个常数，在 cache 友好和 cache 不友好之间能差两个数量级**。这是后文一切"为什么 std::vector 比链表快得多"的根。

所以记住第一条工程铁律：**当一个数组方案和一个"看起来更高级"的方案复杂度都是 O(n) 时，先选数组方案**——它给出的 O(n) 几乎总是更小的 O(n)。

## 动态数组：你天天在用，但从没注意过扩容为什么是倍增

静态数组有个硬约束：**容量固定**。但工程里几乎每次都"先放进去几个，再加几个，再加几个"。需要的是：能动态增长、又保留数组连续内存 + O(1) 索引的结构。这就是 `vector` / `ArrayList` / `slice` / `list`。

实现思路不复杂：

```
type动态数组 = (指针 ptr, 当前长度 len, 容量 cap)
push(x):
    if len == cap:        # 满了
        新数组 = malloc(cap * 因子)     # 申请一块更大的
        拷贝旧内容到新数组
        free(旧数组)
        ptr = 新数组
        cap *= 因子
    ptr[len] = x
    len++
```

关键就是这一行：`cap * 因子`。**因子到底该取多少？**

### 论证 1：选 2 倍

把"扩容"看成一个时间点，触发频率随 n 几何递减：

```
第 1 次扩容：cap 1 → 2，移动 1 个
第 2 次扩容：cap 2 → 4，移动 2 个
第 3 次扩容：cap 4 → 8，移动 4 个
第 k 次扩容：移动 2^(k-1) 个
```

n 次 push 触发的累计移动量 `= 1 + 2 + 4 + … + 2^k`，其中 `2^k ≤ n`。等比数列求和是 `2n - 1`。加上每次 push 本身的 1 次写入，总开销 `≤ 3n`。

> **每次 push 的摊还开销是 3 次内存操作 = O(1)。**

不光是 O(1)，而且**常数是 3**。这就是为什么倍增扩容在工业里被默许。

### 论证 2：那为什么不选 1.5 倍？

倍增有个不爽的地方：**内存利用率最坏 50%**。比如刚扩容到 cap=2n，里面只有 n+1 个元素时，浪费了 n-1 个槽。Google 的 Java 工程师观察到一个细节：Go 1.18+ 的 resize 策略实际上对小切片用 2 倍，对大切片用 1.25 倍附近——理由是想让旧内存**有机会被回收后又被复用**。

你可以做一个思想实验：从空数组开始连续扩容，看 cap 序列：

| 因子 | cap 序列 |
|------|----------|
| 2.0  | 1, 2, 4, 8, 16, 32, 64, … |
| 1.5  | 1, 2, 3, 4, 6, 9, 13, 19, 28, 42, 63, … |

注意 1.5 倍增长几步后，**早期某个 cap 值恰好等于下一个 cap 值的 descent**：

```
2 → 3 → 4 → 6 → 9 → 13 → 19 → 28 → 42 → 63
              (42 ≈ 28 + 19 ← 实际 jemalloc/free 能合并)
```

实践中，1.5 倍增长在 glibc/jemalloc/tcmalloc 之类带"位桶（size class）"的 allocator 下更容易让旧块被合并并复用——而 2 倍增长每次新的 cap 永远比之前所有 cap 大，旧块永远小不了、合不掉。

### 论证 3：那为什么不更小甚至固定 +1？

固定 +K（每次加 K）扩容，单次扩容仍是 O(n) 但触发的密度没有几何递减：

- 第 n 次 push 之后累计拷贝 = `O(n² / K)`；
- 摊还到每次 push 是 O(n)。

n 大点就挂。这就是为什么没人在标准库里用线性扩容。

> [!WARNING]
> 摊还分析关心的是**序列总和的上界**。如果你的系统有硬实时约束（HFT、音视频主线程、游戏 server tick），单次最坏延迟仍然是 O(n)。这种场合必须**预分配容量**，把扩容搬到 startup / 调度点。

## 收缩为什么少见

动态数组默认增不缩。为什么？

考虑一段代码反复 `push(x); pop()`：

- 每次 push 触发"满了就扩"；
- 每次 pop 不做收缩（只 `len--`）；
- 这种来回**不会触发拷贝**，摊还正常。

但如果你加"删除时缩容"：

```
pop():
    len--
    if len < cap / 4:
        容量减半
```

那么假如 `push; pop; push; pop; ...` 且 `len` 在阈值（`cap/4` 与 `cap/2`）间反复横跳，每两次操作就要拷贝一次，**摊还直接恶化到 O(n)**——这就是"抖动"。

所以工业实现要么**完全不自动缩**（Rust `Vec`），要么**显式 API 让你调用**（Java `ArrayList.trimToSize`, Go `runtime.GC` 配合切片切小并重新分配）。

> [!TIP]
> 一句话：**扩容幂等安全、缩容有抖动风险**。如果你的程序"短期占用大、长期不用大"，记得显式 `shrink_to_fit` 或重新切片一次。

## Go 切片的别名陷阱

Go 里写 `s = append(s, x)` 而不是 `s.append(x)`，一直以来是新人吐槽点。这背后的设计其实是被 Go 强制的，目的是**让 slice 操作没有副作用**：

```go
s := []int{1, 2, 3}    // cap=3, ptr=ArrayA
t := s                 // t 和 s 共享 ptr=ArrayA
s = append(s, 4)       // 没扩容，直接写 ArrayA[3]，触发 panic —— 这里你应该没意识到
```

不对——上面 `append` 之前 cap=3 已经满了，所以 `s` 会扩容、走新数组，`t` 仍然指向 ArrayA，两者从此分家。看起来 slice 就是 (ptr, len, cap) 三元组、append 是"返回新三元组"，这是**值语义**——但只要没扩容，append 就**就地写**了 ArrayA，所有共享 ptr 的 slice 都看得到。

```go
s := make([]int, 3, 5)   // len=3 cap=5
t := s                   // 同享 ArrayA
s = append(s, 4)         // 没扩容，写入 ArrayA[3]
fmt.Println(t[3])        // ??? 实际为 0 (t 的 len=3 看不到下标 3)
fmt.Println(t[:4][3])    // 4  (用 [:4] 扩界限就能看到)
```

所以 slice 的别名语义是：

1. 共享底层 array，slice 之间是别名；
2. 看不看得到，由 (len) 决定；
3. append 触发扩容，则别名断了；
4. 切片操作 `s[i:j]` 不拷贝内存，新 slice 共享底层。

这就是为什么 Go 工程里反复强调"slice 传给函数要小心"，尤其涉及 append 时，**要么传指针 `*[]T`、要么显式 return**。从 `errors` 到 `bytes.Buffer` 都受这个微妙约束影响。

## Python list 究竟是不是"动态数组"

CPython 实现里，`PyListObject` 内部就是一个 `PyObject**` 指针 + ob_size + allocated：

```c
struct PyListObject {
    PyObject **ob_item;   // 指针数组，每个元素是 PyObject*
    Py_ssize_t ob_size;
    Py_ssize_t allocated;
};
```

注意一个细节：它存的是**指向 PyObject 的指针**，不是 PyObject 本身。

所以 Python list 比真正的 `vector<int>` 多一重 indirection：

- `lst[i]` 在底层是 `ob_item[i]`（一个 `PyObject**` 取下标）；
- 然后再 `*` 一下得到的 `PyObject*`；

这意味着 Python 一次索引访问要走两次内存读。再加上 PyObject 本身有引用计数、GC，所以**CP 的 list 在小数据上比 C vector 慢 20-50 倍**很正常。

扩容策略 CPython 用的是 `new_allocated = (size >> 3) + 3 + size`，也就是大约 1.125 倍——比 Go/Java 慢慢递增，但因为指针拷贝本来就便宜，常数影响不大。

## 多语言对齐

```go
// Go
a := make([]int, 0, 16)   // 预分配 cap=16
a = append(a, 1, 2, 3)
a = append(a, 4)
```

```ts
// TypeScript / V8
const a: number[] = [];
a.push(1, 2, 3);
// V8 的 Array 是哈希 + 元素类型可变的 Smi/HeapNumber 数组：
// 连续小整数时 backing store 整块推进；
// 出现 double 或 object 时整体降级到指针数组。
```

```python
# Python
a = [1, 2, 3]              # list
# 推荐先用 list(range(n)) 占位，再按下标写：
a = [0] * n
```

```cpp
// C++
std::vector<int> v;
v.reserve(16);             // 预分配 cap 不改 len
v.push_back(1);
v.shrink_to_fit();         // 显式回收多余容量
```

预分配是个**关键**技巧：在你知道队列或图像的近似规模时，预先 reserve 能把扩容摊还常数从 3 压到接近 1，**还可避免例如 trace 期间大量碎片**。生产服务高 QPS 场景里，`reserve("capacity")` 经常是把一个 P99 延迟从 2 ms 拉到 0.5 ms 的功臣。

## 易错清单

1. **`Vec::with_capacity(n)` vs `vec![0; n]`**：前者 len=0 容量 n（深坑：未初始化，直接读是 UB）；后者 len=n 且都已 0。

2. **C++ `std::vector` 容量增长**：libstdc++ 是 2 倍，libc++ 也是 2 倍；MSVC 曾 1.5 倍。

3. **end iterator 失效**：扩容后所有指针、引用、迭代器都失效。在循环 `for (auto it = v.begin(); it != v.end(); ++it) v.push_back(*it);` 里 push 会让 end()/it 立即过时 ⇒ UB。

4. **2D 矩阵方向**：c/c++ 是 row-major，Fortran/NumPy 中默认列优先实际还是 row-major（看你 contiguous 风格而定，BLAS 层面 col-major 为主）。**遍历方向必须匹配存储方向**。

5. **大对象值语义**：Rust `Vec<BigStruct>` expand 会逐个 move 整块大对象，如果大对象复制开销 > 16 字节，用 `Vec<Box<BigStruct>>` 堆指针代替。

6. **`strings.Builder` / `bytes.Buffer`**：在字符串频繁拼接时不用 `a += "x"`，因为 Go/Java 等里 `+` 每次会构造新 String，总开销 `O(n²)`；`bytes.Buffer`/`strings.Builder` 维护 dynamic array（byte slice）。

## 经典题走题路线

按这个顺序过两遍，对数组的工程理解会从"会背扩容公式"变成"看得见 cache":

1. **LC 27 移除元素**：经典双指针，val 把右边写左边。
2. **LC 26 删除有序数组中的重复项**：同上风格，再加 hash-avoid 的技巧。
3. **LC 11 盛最多水的容器**：贪心收缩两端的经典。
4. **LC 209 长度最小的子数组**：滑动窗口入门。
5. **LC 238 除自身以外数组的乘积**：双 prefix 之积，O(n) 不用除法。
6. **LC 54 螺旋矩阵**：方向数组。
7. **LC 31 下一个排列**：原地翻转模板。
8. **LC 41 缺失的第一个正数**：原地 hash 把数组本身当 mark。
9. **LC 289 生命游戏**：状态位编码。

## 这一章带走的东西

- **数组的 O(1) 是常数最小的 O(1)；
- 动态数组倍增是摊还 O(1)，常数 3；
- 缩容几乎不自动做，因为有抖动风险；
- Go slice 是值语义共享底层，append 可断别名；
- 真正决定性能的是 cache locality，遍历方向错了能差 10 倍。

下一节 → [链表](linked-list.md) ：我们会发现链表"理论上"的 O(1) 插入在实际中常常输给 vector，原因正是 cache。
