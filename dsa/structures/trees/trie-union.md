# 字典树（Trie）与并查集（Union-Find）

## 一句话

这两个结构本身没关联, 但都是"用结构编码 prefix / 等价关系"的代表性工具:

- **Trie** 把字符串集合按公共前缀压缩 - 不仅 O(L) 查找, 还能优雅给出"所有以 X 为前缀的字符串", 这是哈希做不到的扩展性.
- **并查集** 把元素按等价关系分组, 用近乎常数代价处理 union / find - 支撑 Kruskal MST、连通性、LCA 等所有"集合合并"问题.

两个结构在硬件层都很 streaming-friendly, 在 FPGA / 网络包处理上有大量工业化实例.

## Trie（前缀树）

### 语义

将"字符串集"按字符路径组织成树. 每条从根到某节点的路径对应一个前缀:

```
              (root)
              / | \
             a  b  w
             |  |  |
             p  y  o
             |     |
             p     r
             |     |
             l     l
             |     |
             e     d
```

存储关键字集 `{apple, by, world}`.

### 复杂度

| 操作 | 时间 | 空间 |
|------|------|------|
| 插入 | O(L) | O(L) |
| 查找 | O(L) | 0 |
| 删除 | O(L) | -L (尾节点引用计数) |
| 前缀查询 | O(L + k·L') |

L = 单词长度, 与字符集无关 ⇒ 对超长字符串集合仍高效. **Trie 的优势是哈希表给不出的**: 前缀查询、字典序遍历、字符串集合的"动态增删 + 前缀匹配"等操作都 O(L).

### 工程应用

- **自动补全 / 搜索框**: 用时序哈希到叶子 → 子树枚举前缀;
- **IP 路由表**: binary trie / Patricia trie; 树高 = 32 位 IPv4 / 128 位 IPv6;
- **HTTP 路由**: gin / echo 早期实现; Radix Tree;
- **Boggle / WC 字符串匹配加速**;
- **AC 自动机 / 后缀树**: Trie 衍生物;
- **DNS resolver**: BGP routing 含 Trie 思.

### 工程优化

1. **子节点表示**:
   - 数组 `[26]*Node` 紧凑但浪费 (每节点 26 槽);
   - `map[byte]*Node` 灵活, 散列查找有常数代价;
   - **Radix Tree / Patricia Trie**: 长单分支压缩成边. Radix 树是 Gin 路由器内部.

2. **行为紧凑**: 合并单分支节点减少内存浪费. Patricia Trie 节省 8× 内存.

3. **删除要小心**: 只删"还没人引用的节点", 否则破坏兄弟节点引用.

### Go 实现模板

```go
type Trie struct{ root *node }
type node struct {
    children map[byte]*node
    end      bool
}

func Constructor() Trie { return Trie{root: &node{children: map[byte]*node{}}} }

func (t *Trie) Insert(s string) {
    cur := t.root
    for i := 0; i < len(s); i++ {
        c := s[i]
        if cur.children[c] == nil {
            cur.children[c] = &node{children: map[byte]*node{}}
        }
        cur = cur.children[c]
    }
    cur.end = true
}

func (t *Trie) Search(s string) bool {
    cur := t.root
    for i := 0; i < len(s); i++ {
        if cur = cur.children[s[i]]; cur == nil { return false }
    }
    return cur.end
}
```

## 并查集（Union-Find / Disjoint Set Union）

### 语义

维护一组互不相交集合的合并 + 查询.

- `find(x)`: 返回 x 所在集合的代表;
- `union(x, y)`: 合并两个集合.

### 朴素实现: 父指针 + 直接union

```
find(x):  while x != parent[x]: x = parent[x]
union(x,y): 直接 parent[y] = x
```

朴素最坏 O(n).

### 两个核心优化

#### 1. 按秩 / 按 size 合并

把**小集挂到大集下**, 保证树高 = O(log n).

```python
def union(x, y):
    rx, ry = find(x), find(y)
    if rx == ry: return
    if size[rx] < size[ry]: rx, ry = ry, rx
    parent[ry] = rx
    size[rx] += size[ry]
```

#### 2. 路径压缩

`find` 顺手把路径上所有点都指向根, 下次 O(1).

```python
def find(x):
    while parent[x] != x:
        parent[x] = parent[parent[x]]   # 半路径压缩
        x = parent[x]
    return x
```

### 两个优化叠加后的复杂度

每次操作摊还 **`O(α(n))`**, 其中 α 是逆 Ackermann 函数, 对 n ≤ 10⁸⁰ 都 α(n) ≤ 4 ⇒ **实务上视作 O(1)**.

带"按秩 + 全路径压缩"的复杂度证明由 Tarjan 1975 给出, 是经典摊还分析示例.

### 应用

- **图连通性**: 判断是否连通;
- **最小生成树 Kruskal**: 贪心选边 + 并查集判环;
- **离线 LCA**: Tarjan 离线 LCA;
- **网格 / 河流 / 区域归并**: 图像分割;
- **分布式: Crash Detective / Spanner tablet region**.

### Go 实现迭代版 (按 rank + 完整路径压缩)

```go
type DSU struct {
    parent []int
    rank   []int
}

func NewDSU(n int) *DSU {
    p, r := make([]int, n), make([]int, n)
    for i := range p { p[i] = i }
    return &DSU{parent: p, rank: r}
}

func (d *DSU) Find(x int) int {
    root := x
    for d.parent[root] != root { root = d.parent[root] }
    for x != root {            // 路径压缩
        nxt := d.parent[x]
        d.parent[x] = root
        x = nxt
    }
    return root
}

func (d *DSU) Union(x, y int) bool {
    rx, ry := d.Find(x), d.Find(y)
    if rx == ry { return false }
    switch {
    case d.rank[rx] < d.rank[ry]: d.parent[rx] = ry
    case d.rank[rx] > d.rank[ry]: d.parent[ry] = rx
    default: d.parent[ry] = rx; d.rank[rx]++
    }
    return true
}
```

## 硬件 / FPGA 视角

Trie 与并查集在硬件层都有规模化实例:

- **网络包前缀匹配 (Longest Prefix Match)**: IP 路由表用 Binary Trie 在 FPGA BRAM 上实现, 性能高 TOE-style;
- **查找引擎**: 各种 Bloom / XOR filter 在 FPGA 上的对应;
- **并查集在硬件上相对少**: 因为并查集是动态结构, FPGA 上更常改用 sync-lines or hardware-class lookup tables.

但 Trie 本身**非常适合 BRAM 物化**: 每 node 一个 children table = BRAM 一个 row, tree depth = trie route depth, pt 到 page 直接读取 - 这就是 NVMe 上的 flow table 性能 mudpark.

## 易错

1. **不初始化 parent[i]=i** ⇒ 死循环;
2. **size 在 union 后忘记更新** ⇒ 后续合并按错误的 rank 处理, 平衡破坏;
3. **半压缩 vs 全压缩**: 在所有路径上的节点都是后调用时还要 `find` 一次, 全压缩更快但递归版深递归可能栈爆;
4. **Trie 节点孩子 map 没回收**: 子树删除如果只标 `end=false`, 节点仍在 → 内存泄漏长尾.

## 经典题

- LC 208 实现 Trie;
- LC 212 单词搜索 II (Trie + DFS 回溯);
- LC 547 朋友圈数量 (DSU);
- LC 684 冗余连接 (DSU 找环);
- LC 990 等式方程可满足性;
- LC 399 除法求值 (DSU 带权版).

## 这一章带走的东西

- Trie 把"字符串集"按前缀压缩成树, 优势是哈希做不出的前缀语义;
- DSU 的两个优化让每次操作变成 O(α(n));
- 这两个结构都**适合 BRAM 物化**, 在 FPGA / 网卡设备上落地;
- 实际生产代码不要裸写 Trie 除非必要: redis / gin 内部自带 Radix Tree.

下一节 → [图](../graphs/README.md)
