# B 树与 B+ 树

## 一句话

普通 BST 在 RAM 里可以正常工作，但当数据规模远超内存、必须以页为单位与磁盘交换时，**树高 h 就直接等价于硬盘 IO 次数**. 一次 SSD IO 约 100 μs，30 次磁盘 IO = 3 ms ⎯ 把 BST 直接搬到数据库上会跑出几秒级延迟. B+ 树的存在是为了让 h = 3~4 而不是 30——**它不是"更好的 BST"，而是"为磁盘这种媒介专门设计的树"**.

## 为什么标准 BST 不能当数据库索引

- 数据库规模动辄 10⁹ 行 × 512 字节 ≈ 512 GB ⎯ 不可能装在内存里;
- 红黑树 h ≈ log₂ 10⁹ ≈ 30;
- 每层比较 1 次 + 1 次磁盘 IO，30 次磁盘 IO 太贵.
- 一个 B+ 树节点用一个 page（4~16 KB）装几百个 entry, **扇出 100+ ⇒ h = 3~4** ⇒ IO 3~4 次.

这就是 B+ 树解决的核心矛盾：**树高 = 磁盘 IO 次数**，所以扇出越大越好，**扇出 ≈ page 大小 / key 大小**.

## B 树定义（m 阶 B 树）

1. 每个节点最多 m 个子节点, m-1 个 key;
2. 每个非根非叶节点至少 `⌈m/2⌉` 个子节点;
3. 所有叶子在同一层;
4. 节点内 key 有序.

**插入触发分裂**:

```
节点 key 数 = m-1（满了） → 插入后会变成 m → 取中间 key 上推到父节点
                                      → 左右两半作为新两个孩子
```

**删除触发合并或借入**:

```
节点 key 数 < ⌈m/2⌉-1 →
  case 1: 兄弟有多余 key → 借入
  case 2: 兄弟也最小     → 与兄弟 + 父分隔 key 合并
```

## B+ 树与 B 树的差异

| 维度 | B 树 | B+ 树 |
|------|------|-------|
| 数据位置 | 内部节点也装 sat data | 所有 sat data 都在叶子 |
| 叶子链 | 无 | 叶子有左右兄弟指针 |
| 范围查询 | 中序遍历，多次 IO | 沿叶子链顺扫，O(1) 次跳 |
| 扇出 | 小一些 | 大（key 比记录小） |

正是叶子链让 `WHERE a > 10 AND a < 1000` 类型查询变得超快：定位到第一个后顺扫一段.

## 真实实现与扇出

- **InnoDB**: page size = 16 KB; 一行 100~500 字节 ⇒ 单页 30~150 行, 扇出近百; 3 层 B+ 树支持 10⁵~10⁶ 行索引; 4 层能上 10⁸.
- **PostgreSQL**: B+ 树（叫 Btree） + heap table 分离存储, heap 是按 line pointer 的 append-only, B+ 树维护 (key, ctid) 映射.
- **SQLite**: 缺省 page 4 KB; B+ 树存 table, B+ 树 或 混合存 index.
- **Ceph BlueStore / RocksDB**: memtable + SSTable (LSM-tree), SSTable 内部块索引也是 B+ 树风格.

## 真物理页面与 IO

一个 16 KB page → SSD 一次 4 KB 单元 IO 槽, 4 次但 OS 一次可批. NVMe 通过 PRP/SGL 把多个 page 一并 DMA. 这就是为什么**4 KB / 16 KB page 是物理对齐的 sweet spot**: Linux page 是 4 KB, NVMe 是 4 KB cache line, **B+ 树 page ≈ OS page ≈ NVMe 块大小**, 这层匹配让 OS 无需重新切 page.

## 复杂度

| 操作 | 复杂度 | 实际 IO |
|------|--------|----------|
| search | O(log_m n) | ⌈log_m n⌉ |
| insert | O(log_m n) | 1 次写 + log_m n 次读 + 偶尔分裂 |
| delete | O(log_m n) | 同上 |
| range(k₁, k₂) | O(log_m n + k) | 1 次定位 + 顺扫 |

## 如何选 m

经验: **使节点 ≈ 一个磁盘 page 大小**.

```
m ≈ page_size / (sizeof(key) + sizeof(child_ptr))
```

例如 key 8 B, child ptr 8 B, page 16 KB ⇒ m ≈ 1024. 一般加 padding 实取 200~500.

## Split / Borrow 框架

```go
// 节点最多 m = 4 个子、m-1 = 3 个 key; 最少 2 个子、1 个 key
type BPlusNode struct {
    isLeaf   bool
    keys     []int
    children []*BPlusNode
    next     *BPlusNode // 叶子链
}

func splitChild(parent *BPlusNode, i int) {
    full := parent.children[i]
    mid := len(full.keys) / 2
    upKey := full.keys[mid]

    newNode := &BPlusNode{isLeaf: full.isLeaf}
    if full.isLeaf {
        newNode.keys = append(newNode.keys, full.keys[mid:]...)
        full.keys = full.keys[:mid]
        newNode.next = full.next
        full.next = newNode
    } else {
        newNode.keys = append(newNode.keys, full.keys[mid+1:]...)
        newNode.children = append(newNode.children, full.children[mid+1:]...)
        full.keys = full.keys[:mid]
        full.children = full.children[:mid+1]
    }
    // 把 upKey + newNode 插入 parent
    parent.keys = append(parent.keys, 0)
    copy(parent.keys[i+1:], parent.keys[i:])
    parent.keys[i] = upKey
    parent.children = append(parent.children, nil)
    copy(parent.children[i+2:], parent.children[i+1:])
    parent.children[i+1] = newNode
}
```

## LSM-Tree: B+ 树的亲缘替代品

为什么 BigTable、Cassandra、RocksDB、LevelDB 都用 LSM-Tree 而不是 B+ 树？

- B+ 树插入**就地写**, **每次至少 1 次随机 IO**, SSD 上 4 KB 随机写代价远大于顺序写;
- LSM-Tree **append-only», 顺序写超快, 但读要扫描多层 + 多个 SSTable, 加 bloom filter 加速.

**SSD 写放大**指标上:

- B+ 树写放大 ~32× (16 KB page, 100 row/page ⇒ 一行写导致 16 KB 完整 page 写);
- LSM-tree 写放大 ~10-30× (后台 compaction).

writes/s 上 LSM 常胜, reads/s 上 B+ 树常胜. 这就是为什么 OLTP DBMS（MySQL、PG）选 B+ 树, OLAP 列存 + WAL 选 LSM.

## FPGA / 硬件视角

B+ 树在 FPGA/SSD 上有特别的实验:

- **PG-Strom**: PostgreSQL 扩展把 B+ 树扫描放到 GPU 上做 SIMD。
- **BlueDBM**: MIT 风格 near-data processing，把 B+ 树节点 page 直接预存到 SSD controller 上.
- **P2IME/SAP HANA**: 内存计算 + NVM 持久化 + B+ 树兼并内存与 SSD.

不论什么方案, **B+ 树抽象栈上有页、页是对 IO 的最小单位** 这点都成立, 只是物化的层次不同.

## 易错点

1. **分裂方向**: 中间 key 上推, 注意偶数 m 时取左中还是右中要一致.
2. **合并时父节点可能也下溢**: 递归向上传播.
3. **占位写与就地写**: 数据库 page 改写要走 WAL 落盘顺序, 避免 page torn.
4. **cache 边界**: 节点 page 是 atomic unit, 不要在一个事务里同时改多个 page 后才 journal.

## 这一章带走的东西

- 树高 = IO 次数, ⇒ 扇出越大越好;
- B+ 树的"叶子链"是范围查询优势之源;
- page 大小 ≈ OS page ≈ NVMe 块大小 ≈ sweet spot for IO;
- LSM vs B+ 树 = 顺序写 vs 随机写 vs 写/读负荷比例;
- 在 SSD/NVM 时代, B+ 树与 LSM-Tree 是同抽象的两种物化.

下一节 → [堆与优先队列](heap.md)
