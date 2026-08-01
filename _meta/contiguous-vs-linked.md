# 1. 顺序 vs 链接: CPU 视角下两种物理化

## 一句话

数据结构界表面上看有十几种, 但底层只两种物理化选项: **顺序** (contiguous) 和 **链接** (linked). 顺序赢在 cache locality 和位运算, 链接赢在 O(1) splice 和迭代器稳定性. 这两种物理化在 CPU 视角、运行时视角、网络协议视角、磁盘视角都反复出现 —— **理解了"顺序 vs 链接"这一对双胞胎, 你就理解了所有数据结构差异的 80%**.

## 第一站: 物理化

数据结构本身是数学对象:

- 数组 = 索引到值的有限映射;
- 链表 = 头 + 尾组成的可拼接序列;
- 二叉树 = 节点 + 左右孩子组成的多级结构;
- 哈希表 = 函数 (hash) → 槽 + (比较) 的组合.

但**计算机必须给数学对象一个物理化身**: 内存的字节怎么排布、指针怎么连、cache 怎么预取. 这一步 "数学对象 → 物理化身" 的选择几乎只有两条路:

### 选项 A: 顺序 (contiguous)

把所有元素紧排到连续内存, 用偏移量 i 找元素: `addr[i] = base + i · sizeof(T)`.

- **代表**: 数组、动态数组、堆、CSR 邻接表、B+ 树页、SIMD、SSD page.
- **优势**: O(1) 索引、cache 极友好、SIMD 并发、零指针开销.
- **代价**: 大小固定 / 改大小要扩容、中插代价 O(n)、迭代器失效.

### 选项 B: 链接 (linked)

每个元素自带一个或多个指针指下/上元素, 内存可以散乱分布.

- **代表**: 链表、树、跳表、哈希桶链、STL std::map、跳表.
- **优势**: O(1) splice (已知指针时)、迭代器稳定、动态扩容零拷贝.
- **代价**: 每元素 +8B (或更多) 指针开销、cache miss 风暴、几乎不可 SIMD.

## 这两种物化的 lifecycle 一种抽象对偶

数学抽象层面, 它们对应**对偶同构**: 同一抽象有两条工程化路径. 让我从 CPU、运行时、协议、磁盘四处各举一对实例:

### CPU 层

```
顺序: SSE/AVX SIMD — 16/32/64 字节一字 load 多元素 = 1 cycle/8 元素;
链接: 间接寻址 (load 指针再 load 数据) — ~10 cycle/元素
```

CPU 在 SIMD 上一次处理的就是"一段顺序". "链接"在 CPU 层就是被惩罚的代名词 —— 链接破坏 prefetcher 模型.

### 内存模型层

```
顺序: std::vector / Go slice / Python list 内部 = 一段连续字节.
链接: std::list / intrusive_list / dict overflow bucket 链.
```

`std::vector::iterator` 在扩容时失效 (因为底层基地址换了). `std::list::iterator` 在 erase 后对其他节点仍然有效 —— **这就是 "链接" 的标志特征**.

### 网络协议层

```
顺序:TCP 字节流 — 数据按顺序到达, 滑动窗口按 sequence
链接:IP 路由的 next-hop 链 — 数据包一跳一跳走
```

TCP 是 sequential 接收 IP 是 hop-by-hop 路由, 这是网络栈上同型的两个层级.

### 磁盘与日志层

```
顺序: WAL / LSM-Tree / Kafka append-only — 顺序写 1+ GB/s
链接: inode / extent tree / B+ 树内部节点
```

LSM-Tree 把"顺序写"做到极致 (单段顺序追加), B+ 树把"范围查询"做到极致 (叶子链接 + 内部顺序). ** LSM 与 B+ 都在"一棵树"上**, 但 LSM 把"顺序"放在 IO 层, B+ 把"顺序"放在内存层 — 这就是同一抽象不同物化的对偶.

## 怎么决定选哪种?

业务真的需要 **迭代器稳定性 / splice / 已知指针位置操作** ⇒ 链接. 否则, **选顺序**.

一个简单决策表:

| 需求特征 | 推荐物理化 |
|---------|------------|
| 批量随机访问 | 顺序 |
| 中间频繁插入 (无已知指针) | 顺序滚动 + 二分插入 |
| 中间频繁插入 (已知指针) | 链接 |
| 大空间扩容 + 容量不可预测 | 顺序动态数组 |
| 大空间扩容 + 容量可限定 | 顺序 ring buffer |
| 跨多线程接口稳定迭代器 | 顺序 std::deque 或链接 |
| 范围扫描 | 顺序 (任何能 SIMD 友好的) |
| 高 IO 顺序写 | LSM (一种顺序实现) |

## 工程的折衷: 闘尾同构

这一段的中心观点: **数据结构的"顺序 / 链接" 在不同层有同构**.

```
软件层: 数组 vs 链表
OS层:   page cache sequential read vs fsync 散写
网络层: TCP 顺序 byte stream vs IP 多跳路由
硬件层: SIMD packed op vs 间接寻址
```

**底层是同一抽象的列向物化**: 在同一规模上, "顺序" 总在 cache、SIMD、batch 友好; "链接" 总允许 splice、稳定迭代器、跨层 indirection.

## 多语言对比

语言标准库对 "顺序/链接" 的默认提供非常不同:

| 语言 | 主顺序容器 | 主链接容器 | 备选 |
|------|------------|-------------|------|
| C++ | `std::vector` | `std::list` | `std::deque` 折中 |
| Rust | `Vec<T>` | (无 std 内置链表) | `Box<Node>` 自实现 |
| Go | `[]T` 切片 | `container/list` 通用 | `Ring` ring buffer |
| Python | `list` | (无纯链接 类型) | `deque` 分块链接 |
| Java | `ArrayList` | `LinkedList` | `ArrayDeque` 通常更优 |
| JS | `Array` 紧排 (Smi) | (无) | linked-list 模拟 |

特别提到 Rust 故意不在标准库链表 —— 这是语言设计哲学的表态: **现代默认应该选顺序, 链接只在确需时引入**. 这个决定不是性能微调, 而是把数据结构物理化的选择**显式化** —— 你需要链表就 `unsafe` 自己写或者用 crate. 这反而强迫你**思考清楚需求**.

## FPGA 视角

在 FPGA 上, 这种对偶更明显:

- **顺序 BRAM**: 单地址空间, 给 base addr + offset 数组寻址, 等价软件的数组;
- **链式 BRAM**: 链表节点存下一节点地址, 通过 deref 流水线 token 移动;

数据流图 (DFG) 加速器里常见 sequential shift register / systolic array = 顺序物化的"流水", 而 linked 描述则需要在 BRAM 上模拟 ptr, **延迟几十 cycle**. 这就是 FPGA 上**几乎所有高速数据通路都选顺序物化**的原因.

## 这一章带走的东西

- **数学上只有顺序 vs 链接, 几乎所有数据结构都是这两条物化之一**;
- 顺序赢 cache+SIMD+indexing, 链接赢 splice+iterator stability;
- 网络层、OS 层、硬件层都有这种对偶同构;
- 选哪种不仅仅看 "操作复杂度 O()", 更看 cache、并发、迭代器稳定性;
- Rust 的 std 不内置 list 是一种哲学态度: 显式选择物理化.

下一篇 → [摊还 vs 最坏](amortized-vs-worst.md)
