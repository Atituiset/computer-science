# AVL 与红黑树

## 一句话

AVL 与红黑树是同一抽象的两种工程取舍：**严格平衡**（AVL，读多场景占优）与**弱平衡**（红黑树，写多场景占优）。理解它们为什么都 O(log n)、为什么树高稍稍不同、为什么红黑树在工业里更常见——核心不在"哪个更平衡"，而在**每次插入 / 删除后需要修复旋转的次数上界**。这就是工业界默认红黑树的原因。

## 为什么 AVL 想要严格平衡

AVL 不变量：

```
任意 node v:
  height(v.left) - height(v.right) ∈ {-1, 0, +1}
```

数学上：高度 ≤ `1.44 * log₂(n+2) — 0.328`，渐进上等价 O(log n).

_AVL 高度 vs 红黑树高度_：

```
n = 10^9
AVL h 上限 ≈ 43;
红黑 h 上限 ≈ 2·log₂(10^9+1) ≈ 60.
```

AVL 略矮 ⇒ 比 AVL 平均访问的 cycle 数略少 ⇒ 读场景占优.

## AVL 的四种失衡

设 z 是最近失衡节点。看插入发生在 z 的哪一子孩子 + 哪一子孩子：

| 插入路径 | 操作 |
|----------|------|
| z.left.left | 右旋一次 |
| z.left.right | 先左旋 z.left，再右旋 z |
| z.right.right | 左旋一次 |
| z.right.left | 先右旋 z.right，再左旋 z |

LL/RR 是 single rotation；LR/RL 是 double rotation.

插入后**祖先可能继续失衡**——但 AVL 经典性质：插入触发**最多 1 次** 双旋（single 或 double），因为 z 处修好后，子树高度恢复原状，祖先失衡解除.

## AVL 删除的特殊之处

删除后子树高度可能"减少 1"，沿祖先向上传播：
- 每层都可能再次失衡；
- 修复路径 O(log n) 层，每层 O(1) 工作；
- 总复杂度 O(log n)，但**常数远大于插入**.

这是 AVL 在"写多"场景输红黑树的主因.

## 红黑树：五条不变量

```
1. 节点是红或黑;
2. 根是黑;
3. 叶子（NIL）是黑;
4. 红节点的孩子必须是黑（无连续两红）;
5. 任意 node v 到其后代 NIL 的所有路径上黑节点数相同.h
```

由这 5 条 ⇒ `h ≤ 2 log₂(n+1)`.

工程直觉：**每条路径上有约等量的黑节点 + 红节点处自由分布**——红黑树本质上是**用颜色编码"允许局部不平衡"**，从而**减少修复旋转次数**.

## 红黑树插入 fixup（CLRS 版简化）

```
新节点 z 着红色插入，然后做 fixup：
while z.p.color == RED:
    if z.p == z.p.p.left:
        y = z.p.p.right                  // 叔叔
        if y.color == RED:                // 情况 1: 叔叔是红
            z.p.color = BLACK
            y.color = BLACK
            z.p.p.color = RED
            z = z.p.p                     // 向上传播
        else:
            if z == z.p.right:            // 情况 2: z 是右孩子
                z = z.p; LEFT_ROTATE(z)
            // 情况 3: z 是左孩子 + 重色 + 旋转
            z.p.color = BLACK
            z.p.p.color = RED
            RIGHT_ROTATE(z.p.p)
    else: // 对称镜像
```

插入：**最多 2 次旋转 + 几次重色**——这是红黑树在工业里能跑赢的根基.

## 红黑树删除更复杂

删除涉及 6 种情形（GLR canonical 设 4 种、注意 OMI 推导），但**最多 3 次旋转 + O(log n) 次重色**. 比起 AVL 的 O(log n) 旋转，常数差距很大。

## AVL vs 红黑 关键指标

| 指标 | AVL | 红黑树 |
|------|-----|--------|
| 最大高度 | 1.44 log(n+2) | 2 log(n+1) |
| 查找 cycle 数 | 更少 | 略多 |
| 插入旋转次数 | ≤ 1 | ≤ 2 |
| 删除旋转次数 | ≤ O(log n) | ≤ 3 |
| 实现复杂度 | 中等 | 较高 |

**这就是为什么 C++ STL、Linux CFS、Java TreeMap、Linux kernel 进程管理的进程链表都选红黑树**：删除时的旋转次数有上界，写性能稳定.

## Go 实现 AVL 插入（带四种旋转）

```go
type Node struct {
    key          int
    h            int
    left, right  *Node
}

func height(n *Node) int { if n == nil { return 0 }; return n.h }
func updateH(n *Node)    { n.h = 1 + max(height(n.left), height(n.right)) }

func rotateRight(y *Node) *Node {
    x := y.left
    y.left = x.right
    x.right = y
    updateH(y); updateH(x)
    return x
}

func rotateLeft(x *Node) *Node {
    y := x.right
    x.right = y.left
    y.left = x
    updateH(x); updateH(y)
    return y
}

func insert(n *Node, key int) *Node {
    if n == nil { return &Node{key: key, h: 1} }
    if key < n.key { n.left = insert(n.left, key) }
    else { n.right = insert(n.right, key) }
    updateH(n)
    bal := height(n.left) - height(n.right)
    switch {
    case bal > 1 && key < n.left.key:
        return rotateRight(n)
    case bal > 1 && key > n.left.key:
        n.left = rotateLeft(n.left)
        return rotateRight(n)
    case bal < -1 && key > n.right.key:
        return rotateLeft(n)
    case bal < -1 && key < n.right.key:
        n.right = rotateRight(n.right)
        return rotateLeft(n)
    }
    return n
}
```

## 红黑树代码骨架

红黑树太长，这里只展示插入 fixup 的骨架：

```go
type color int
const ( RED, BLACK color = iota, 1 )

type RBNode struct {
    key         int
    c           color
    left, right, parent *RBNode
}

func rbInsertFixup(root **RBNode, z *RBNode) {
    for z.parent != nil && z.parent.c == RED {
        // ... 三种情况 + 镜像，~80 行 ...
    }
    (*root).c = BLACK
}
```

> 全红黑树真正能写对的工程师相对少——大部分人用 `google/btree` 或 `container/list + 库`. **教学价值高但工程价值有限**。这就是为什么大型项目里很少有人裸写红黑树——维护负担太重.

## 工程化注意点

1. 注释里**永远写不变量**: 例如 NIL 节点颜色为黑. 否则半年后无人能改.
2. 删除节点路径需更新姊妹链路的颜色与平衡。
3. 内存布局：`RBNode` 比朴素 BST 多一个 color 字段。**用 1 bit 而不是 1 byte**——Rust 通过 ptr 低位藏 color 节省 8 字节.
4. **page-aligned B+ 树** vs 红黑树：单机内存红黑树仍占绝对优势，但磁盘上的索引绝对走 B+.

## cache 视角

红黑树与 AVL 在 cache 行为上都不理想——每层指针跳跃都是 cache miss. 这就是为什么 Redis、LevelDB 用跳表替代红黑树: 跳表的数组底层 cache 友好且实现更短.

## 经典题

- LC 110 平衡二叉树。
- LC 1382 将 BST 转成平衡 BST (中序 + 重建)。
- 实现红黑树的小型 benchmark: 插入 10⁶ 个 key, 测与 std::map 对比 - 看常数.

## 这一章带走的东西

- AVL 严格平衡、读取占优、插入旋转 ≤ 1;
- 红黑树弱平衡、写多场景稳、删除旋转 ≤ 3;
- 同 O(log n), 工程默认红黑树, 因为删除旋转有上界;
- 紧排 layout 上, 红黑树都不如 B+ 树 cache 友好;
- 工程上 ST 默认 `std::map / google btree`, 真要自己写平衡树要充分测试.

下一节 → [B 树与 B+ 树](btree.md)
