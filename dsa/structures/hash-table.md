# 哈希表：从原理到工程

## 一句话

"哈希表 = O(1)" 是 DSA 里**最危险的过度简化**。一张哈希表的工程性能由冲突率、装载因子、rehash、cache 局部性、hash 函数抗碰撞性、并发同步、DoS 抗性共同决定，**复杂度只是其中一个分量**。这一章把它从理论拓到工业：从 SipHash 的内核抗 DoS、到 SwissTable 的 SIMD 单 SIMD 比较、再到裸 SIMD hash map 写到 FPGA.

## 核心三件套

```
key → (hasher) → hash → (indexing) → slot → (compare) entry
       ↑               ↑             ↑
       依赖 key         依赖容量      依赖 key 相等
```

- `hasher` 把任意长 key 压成定长 bit；
- `indexing` 通常 `hash % bucket` 或更稳的 `hash & (cap - 1)`（要求 cap 是 2 的幂）；
- `compare` 必须实现稳定相等；
- 别忘了符号位：`hash & MASK` 直接用位与，需要 cap 是 2 的幂。

## 冲突处理：两条主路线

### 1. 链地址（chaining）

- 每 bucket 一条链表；
- 插入 O(1)，最坏 O(n)（全 key 同 hash）；
- 删除 O(1)，自然；
- 装载因子任意。

**Java HashMap、Go map 走这条路**.

### 2. 开放寻址（open addressing）

- 所有元素在数组里；冲突就探下一个 slot；
- 三种探测序列：
  - 线性 `i + k`：cache 极友好但聚集严重；
  - 二次 `i + k²`：抗主聚集；
  - 双哈希 `i + k·h2(key)`：抗所有聚集；
- 删除难：tombstone 替代物理删除，否则断链；
- 装载因子必须 < 0.75（线性）；
- 现代 SIMD 探测变种：**SwissTable / F14**.

**Python dict、Rust HashMap、absl flat_hash_map 走这条路**.

### 工程取舍

| 维度 | 链地址 | 开放寻址 |
|------|--------|----------|
| Cache locality | 差 | 好 |
| 删除 | O(1) 自然 | 需 tombstone |
| 装填因子上限 | 任意 | < 0.75 |
| DoS 抗性 | 同串桶弱 | 一般 |
| 实现 | 低 | 中 |
| 内存底线 | 必须 8B/key 指针 | 紧排，少开销 |

Java 8 给链地址加了一条 sweetener：单桶链长度 ≥ 8 时**转红黑树**，把"用力构造同 hash 的攻击"挡掉。

## Rehash 与扩容

触发阈值由 `load_factor` 决定，链地址通常 LF=1.0，开放寻址 0.5-0.75.

扩容步骤：

1. 分配新数组（通常 cap×2 或更大）；
2. 重新 hash 所有 key (`hash & new_cap_mask`)；
3. 释放旧数组.

如果**第一和第三步在同一次 op 里完成**：
- 短期代价 O(n)；
- 单次 op 延迟尖刺，几 ms.

生产服务下 99.99% 长尾读 HBase / Redis 必有此尖刺.

**渐进式 rehash**（dictugador 风格）：把步骤 2 分摊到每次 op，每次搬 1-2 个 bucket. 这是 Redis 4.0+、Java 8 HashMap 一起做的事.

## 哈希函数：从 FNV 到 SipHash

理想哈希：**分布均匀 + 雪崩效应 + 不可预测（抗 DoS）**.

| 哈希 | 速度 | 抗 DoS | 备注 |
|------|------|--------|------|
| FNV-1a | 极快 | ❌ | 教学用 |
| MurmurHash3 | 快 | ❌ | 入门实战 |
| xxHash / xxhash3 | 最快 | ❌ | 现代标准 |
| SipHash | 中等 | ✅ | Rust/Python 默认，抗 hash flooding |
| CityHash | 快 | 部分 | Google |
| wyhash | 快 | 较好 | absl flat_hash_map |

> [!WARNING]
> 写公开服务时，**必须用 SipHash 或带随机 seed 的哈希**. 否则三行代码就能用"同 hash 桶" 把你 QPS 打挂.

### SipHash 的特别之处

SipHash 是 **密码学风格 PRF** —— 输入 key 和 一个 secret (per-process random key)，输出 64-bit. 它不可预测，所以客户端构造"全 hash 到 0" 的输入集需要破解 random seed，相当于一次 PRF 攻击，现实中是不可能的. 这就是为什么 Python 3.4+ dict / Rust HashMap / Java `String.hashCode` 都引入了**进程级隨机 seed**.

### SIMD 加速的现代哈希查表

**SwissTable 的精髓**：

- 8 个桶一组，组内**保留 7-bit 元数据**（取 hash 高 7 位作为控制字节）；
- 一次 SIMD load 8 字节 = 控制 64-bit 寄存器；
- 用 `_mm_cmpeq_epi8` 一次比 8 个 control byte，看哪几桶是"匹配候选"；
- 没匹配就跨过整组，cache-friendly 且常数小.

abseil flat_hash_map / Rust hashbrown / Google 内部 dense_hash_map 都用这种思路. **吞吐量比 STL `unordered_map` 高 5-15 倍**.

### CPU 视角的 hash probe

```c
// 简化 SwissTable probe 模式
__m64 ctrl = load_8c(ac + i);                    // 64-bit 8 个 control
__m64 match = _mm_cmpeq_pi8(ctrl, target);       // == target?
uint32_t mask = _mm_movemask_pi8(match);         // 8-bit bitmap
while (mask) {
    int slot = __builtin_ctz(mask);
    if (keyMatches(ac+i*8+slot, key, ...)) return slot;
    mask &= mask - 1;
}
```

SIMD 把常数因子塌下来 8 倍。这就是为什么 Rust hashmap 比 Java HashMap Performance 在 large N 上领先的原因之一.

## Go map 内部实现阅读笔记

阅读 `runtime/map.go`:

- 内部 `hmap` + `[]bmap`： 每个 `bmap` 持有 8 个 (tophash, key, value)，溢出用链.
- tophash 8-bit 加速 bucket 内顺序比对，减少 cache miss.
- LF 触发扩容时，新数组 cap ×2；渐進式：每次 op 搬 2 个旧 bucket.
- 还有"same size grow"：清理墓碑.
- **Go 不 export 内部 hmap，但反射可以看到**.

```go
m := make(map[string]int, 1000)             // 提示大致容量
m["a"] = 1
v, ok := m["a"]
delete(m, "a")
```

`make(map, ., .)` 第二个参数是 hint，预分配 bucket 数避免早期 rehash.

## 多语言对齐：四种语言运行时哈希表对比

```go
// Go map — 链地址，渐进式 rehash 出自 runtime
m := make(map[string]int, 1000)
m["a"] = 1
delete(m, "a")
```

```ts
// JS Map — insertion order preserved，开放地址? 实际上是
// "ordered hash map" — V8 内部用 chained buckets + insertion order linked list
const m = new Map<string, number>();
m.set("a", 1);
m.delete("a");
// 有 iteration guarantee：按插入顺序遍历
```

```python
# Python dict — 开放地址、Hi-Lo SIMD probe sequence、紧凑存值（3.6+）
m = {"a": 1}
m["b"] = 2
del m["a"]
# 自 3.7 起保证插入序遍历
# 内部数据布局：entries 可 dense + index array；3.11 之后是 compact layout
```

```cpp
// std::unordered_map — 链地址、节点是堆上的
std::unordered_map<std::string, int> m;
m["a"] = 1;
// std::hash<std::string> 实际上不是 SipHash，是平台相关
// 用 absl::flat_hash_map 通常快 5-10 倍
```

横向看，你会注意到"开放地址 + SIMD 探测 + 紧排 entry = 性能最优组合"——这是各语言运行时都在向 SwissTable 靠拢的原因。**唯一例外是 Java**: 因为 `HashMap` 要 iterator stability，无法 tear down 所有链、要求 key-value 引用稳定，链地址是必须的.

这就是为什么我希望你建立"跨语言看抽象"的能力：**表面看四种语言的 dict 各自不一样，背后其实是同一个工程抽象 + 运行时取舍集合**.

## 易错清单（这是个长清单）

1. **依赖遍历顺序**：Go map 随机序；Python 3.7+ / Java LinkedHashMap 保证插入序；C++ unordered_map 无序。
2. **遍历中改 map**：删本元素或加新元素，迭代器可能失效。
3. **float key 与 NaN**：IEEE754 下 `NaN != NaN`，结果两个 NaN 都能入同一个 map. Python 用 `__hash__(inf)` 解决了一部分但 NaN 仍是雷区。
4. **`vector<bool>` key** or `BitSet` key: 这些类型的 hash 实现不对，必须手写 hash function.
5. **Java `==` vs .equals()**：boxed key 必须 `.equals`.
6. **hash mod n != hash & (n-1)**：前者对任何 n 工作；后者要求 n 是 2 的幂. 一般都看 mask 形式.

## DoS attack 视角

2003-12 制造攻击"Hash DoS" (Crosby & Wallach):

```
准备 K 个字符串 hash 都算到 X；
HTTP POST 提交 1MB 数据，2^24 个键；
解析的 hash map 退化为 O(n²).
服务端 CPU 满载，请求挂起.
```

防御手段：

1. 用 SipHash + random seed (per-process) — Python / Rust / 现代 Java 都做了;
2. 限 map 大小 (1MB 表单);
3. 长链 → 树化 (Java 8 之后做法);
4. DoS-aware hash 函数 (QuickHash-ghash).

## FPGA / SIMD 视角

FPGA 上实现 hash table 是 HFT 与 packet processing 的常用块：

- 用 BRAM 存桶，每 bucket 一个寄存器保存最近 hit；
- probe 顺序按 hash 低位走，cache 实际是 SRAM；
- 通常 per-cycle 一碰/一品，超 Gpps 量级.

这就是 FPGA 加速网络/雷达常见技术.

软件 SIMD、CPU cache + lock-free、FPGA banked BRAM 其实是同一抽象本身的多种物化.

## 经典题

- LC 1 Two Sum：哈希一次 O(n);
- LC 49 Group Anagrams：哈希变换成规约 key;
- LC 128 Longest Consecutive Sequence：O(n) 用 set, 不排序;
- LC 706 Design HashMap：裸写冲突处理;
- LC 460 LFU Cache: 组合 hash + 双链 + 频度组.

## 这一章带走的东西

- 开放地址 (SIMD) > 链地址 (除了 Java 例外);
- SwissTable 的 7-bit control + SIMD cmpeq 创造 5-15× 吞吐差;
- **渐进式 rehash** = 长尾敏感的救星;
- SipHash = 抗 Hash DoS 的最低要求;
- 一种"hash + probe" 抽象在 SIMD CPU、lock-free、FPGA 桥间同构.

下一节 → [树](../structures/trees/index.html)
