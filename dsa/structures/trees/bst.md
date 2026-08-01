# 二叉搜索树（BST）与平衡

## 一句话

BST 的核心在不在"二叉"，在 **"中序遍历 = 排序序列"** 这个性质：一旦你把 BST 当成"可被中序枚举的有序结构"，所有平衡树、B 树、跳表都成了一组变体——都是在不同物化层上让 h (= 极端最长路径) 收敛到 O(log n)。理解到这一层，红黑树、AVL、B+ 树、跳表看起来就不再像四个不同东西，而**是同一个抽象的四个工程实现版本**。

## BST 的语义

```
任意 node v:
  左子树的所有 key < v.key < 右子树的所有 key
```

"所有"两个字很关键——**不是 v.parent**，是 v 的左子树里的所有节点**。

由这个性质推导出三件事：

1. **中序遍历有序**：这个性质决定了所有 BST 系算法。
2. **二分查找天然适用**：找一个 key，每比较一次能扔掉一棵子树。
3. **前驱/后继可在树内 O(h) 找到**：右子树最左 / 左子树最右。

## 三大操作的代价

| 操作 | 复杂度 | 来源 |
|------|--------|------|
| search | O(h) | 每层一次比较 |
| insert | O(h) | 沿路径找到空位 |
| delete | O(h) | 沿路径找替换 + 替换 |

`h = 树高`. **朴素 BST 的 h 是 [log n, n]**。最坏退化成链表（顺序插入），h=n，一切操作 O(n).

## 删除要分三种情况

为什么这是 BST 里最容易出 bug 的地方？因为删除形态不止一种。

```
情况 1：是叶子 → 直接去掉。
情况 2：只有一个孩子 → 孩子顶上来。
情况 3：有两个孩子 → 找右子树最小（或左子树最大）替换，再删掉原位置。
```

情况 3 的"找替换"方法可任选一种左右一致：

- **右子树最小值**（"中序后继 successor"）
- 或者 **左子树最大值**（"中序前驱 predecessor"）

只要**全局一致**，两种都能保持 BST 性质。但**混用就是 bug**.

> [!WARNING]
> 实习生最常写错的就是 case 3：把"中序后继"误作"前驱"，又在另一处用了不同方向——结果序列在某些输入下失去有序。永远要在一处固定方向。

## 平衡的本质

朴素 BST 在 `1, 2, 3, 4, 5` 顺序插入后，全部接到右子链，**h = n**.

要让 BST 持续保持 h = O(log n)，需要"重塑树但保 BST 中序不变"的操作：**旋转**.

旋转是一组动作，**中序序列不变** —— 这是不变量。任何平衡树算法都是"使用旋转重建 BST，使高度下降，同时中序序列保持"。

## 旋转背后的不变量

```
    y                x
   / \     =>       / \
  x   C            A   y
 / \                  / \
A   B                B   C
```

两个图的中序遍历都是 `{A, x, B, y, C}` —— 不变量被保持.

任何 BST 算法机器都是：

- 把不平衡的某子树旋转一下；
- 改变根与孩子链接；
- 高度和顺序不变.

## 平衡策略一览：同一抽象的不同取舍

| 算法 | 思路 | 复杂度 | 说明 |
|------|------|--------|------|
| AVL | 强平衡：h差 ≤ 1 | O(log n) | 严格平衡；读取多场景最优 |
| 红黑树 | 弱平衡：颜色规则 ⇒ h ≤ 2 log (n+1) | O(log n) | 修改多场景最稳，工程默认 |
| Splay | 功利槐蓟双旋 | 摊还 O(log n) | 访问的 key 下次更近 |
| Treap | 随机优先级 | 期望 O(log n) | 简单好写 |
| 跳表 | 多级有序链表 | 期望 O(log n) | 并发友好 |
| B/B+ | 多叉 + m 大 = 单页 | O(log_m n) | IO 友好，DBMS 标配 |
| LSM-Tree | append + 后台 merge | 摊还 O(log n) | SSD 友好 |

## 多语言实现

### Go 迭代版 BST（含删除三情况）

```go
type Node struct {
    key         int
    left, right *Node
}

type BST struct{ root *Node }

func (t *BST) Insert(key int) {
    n := &Node{key: key}
    if t.root == nil { t.root = n; return }
    cur := t.root
    for {
        if key < cur.key {
            if cur.left == nil { cur.left = n; return }
            cur = cur.left
        } else {
            if cur.right == nil { cur.right = n; return }
            cur = cur.right
        }
    }
}

func (t *BST) Delete(key int) {
    var parent *Node
    cur := t.root
    for cur != nil && cur.key != key {
        parent = cur
        if key < cur.key { cur = cur.left } else { cur = cur.right }
    }
    if cur == nil { return }
    // case 3：两个孩子 → 用 cur 的右子树最小替代 cur.key，再删那 succ
    if cur.left != nil && cur.right != nil {
        succP, succ := cur, cur.right
        for succ.left != nil { succP, succ = succ, succ.left }
        cur.key = succ.key
        cur, parent = succ, succP
    }
    // 现在 cur 至多有一个孩子
    var child *Node
    if cur.left != nil { child = cur.left } else { child = cur.right }
    if parent == nil { t.root = child } else
    if parent.left == cur { parent.left = child } else { parent.right = child }
}
```

### TypeScript 递归版

```ts
class Node<T> {
  constructor(public key: T,
              public left: Node<T> | null = null,
              public right: Node<T> | null = null) {}
}

class BST<T> {
  root: Node<T> | null = null;
  insert(key: T) {
    const rec = (n: Node<T> | null): Node<T> => {
      if (!n) return new Node(key);
      if (key < n.key) n.left = rec(n.left);
      else n.right = rec(n.right);
      return n;
    };
    this.root = rec(this.root);
  }
  inorder(): T[] {
    const out: T[] = [];
    const walk = (n: Node<T> | null) => {
      if (!n) return;
      walk(n.left); out.push(n.key); walk(n.right);
    };
    walk(this.root);
    return out;
  }
}
```

### C++：裸 BST 与 STL

裸 BST 写完之后，工程上**永远直接用 STL `std::map / std::set`**（红黑树底层）. 你**不要在日常业务里自己写 BST**——除非是面试/教学。

## 工程视角：保留中序 + 在上面堆附加结构

很多高级数据结构是"BST + 字段":

- 子树 size ⇒ k-th O(log n)；
- 子树 max ⇒ 区间查询；
- 子树 sum ⇒ 区间和（线段树本质）；
- 颜色 ⇒ 红黑树；
- 优先级 ⇒ Treap；
- 多路扇出 ⇒ B+ 树。

> 在 BST 之上叠结构是非常常见的"工程复用"思路。一旦理解所有结构都是"中序遍历 + 附加 invariant"，后面 AVL/红黑/B+ 的代码看到只不过是加不同 invariant 的 BST 而已。

## cache / 数字电路 / FPGA 视角

BST 在硬件层并不理想：

- **指针跳跃** = cache miss 风暴；
- **平衡树每次旋转 = 一节点的左右多处内存写**；
- 没法 SIMD 并发.

真实工程中，对内存紧排需求高时：

- 用 B+ 树替代 BST：每节点 ≥ 16-128 key order ⇒ cache 友好；
- 用 LSM-Tree 替代 B+：append 友好 + SSD 友好；
- 在 FPGA 上：用 BRAM-based hash 代替 BST——h 大的树在 FPGA 上跑性比常数更糟;

这就是为什么**软件界没人在 GPU/FPGA 上跑红黑树**，但会跑哈希表 + 紧排.

## 易错清单

1. 把 BST 限定成"v.left.key < v.key < v.right.key"——错! 是**所有左子树节点 < v.key**, 不是只比 parent。
2. 删除 case 3 中序后继 vs 前驱混用 → bug。
3. 用 parent 字段 + 删除路线时**忘记更新 parent 字段**。
4. 把 sorted linked list 的"自带 key 排序"误读成"是 BST"——不是 BST，是链表.
5. 用 NaN 作 key —— `NaN != NaN`，BST 性质破坏。

## 经典题

- LC 98 Validate BST: 用 `(min, max)` 范围而不是只比 parent.
- LC 230 Kth Smallest in BST: 子树 size 字段 O(log n).
- LC 1038 / 538 BST to Greater Sum Tree: 逆序中序遍历.
- LC 449 Serialize and Deserialize BST.
- LC 173 BST Iterator: 用栈模拟中序遍历，lazy 模式.

## 这一章带走的东西

- BST 的本质 = 中序遍历排序；
- 任何平衡树都是"旋转 + 中序不变量"的叠加；
- 删除三情况 + 中序后继 vs 前驱必须一致；
- BST 在硬件层 cache-hostile → 工业默认用 B+ 树 / LSM-Tree；
- 一旦在 BST 上加字段，你就解锁了所有"顺序统计 + 区间树 + 线段树"的工具集.

下一节 → [AVL 与红黑树](avl-rbt.md)
