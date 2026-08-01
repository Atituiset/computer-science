# SSA / CFG / 支配树 / dom tree

## TL;DR

SSA (Static Single Assignment) 是现代编译器中间表示：每个变量单次赋值。CFG (Control Flow Graph) 是基本块+边，支配树 (dominator tree) 给每基本块"唯一前驱节点"，控制依赖 (post-dominator) 决定循环 / 分支归属。LLVM、Cranelift、V8 Turbofan、 Hotspot C2 全部走 SSA。本节走完为什么 SSA 让优化简单、dom 树算法 (Cooper-Harvey-Kennedy)、SSA 构造、φ 节点、constant folding / DCE / mem-to-reg 等基于 SSA passes。

---

## 一、CFG

CFG = (basic blocks, edges)
- basic block: linear sequence of straight-line instructions, single entry single exit
- edges: jump / fall through / branch

```
bb1: %a = 1
     br bb2

bb2: %cond = eq %a, 1
     cond_br %cond, bb3, bb4

bb3: %b = 2
     br bb5

bb4: %b = 3
     br bb5

bb5: %c = %b + 1
     return %c
```

## 二、SSA 形式

每变量单次定义。"分支合并" 在汇合点用 φ (phi) function:

```
bb1: %a0 = 1
     br bb2

bb2: %cond0 = eq %a0, 1
     cond_br %cond0, bb3, bb4

bb3: %b0 = 2
     br bb5(%b0)

bb4: %b1 = 3
     br bb5(%b1)

bb5(%bx): %c0 = %bx + 1  ← phi (%b0, %b1) chooses 收 b0 / b1
          return %c0
```

`phi(%b0, %b1)` 给 bb5 选择正确祖先版本。

## 三、为什么 SSA

```
非 SSA:
  int i = 0;
  while (i < N) { sum += a[i]; i++; }
  // i 在 loop 多次赋值，需要 phi 加 join，但代码没明示.

SSA:
  i0 = 0
  loop:
    i_phi = phi(i0, i_succ)      ← merge values
    cond = i_phi < N
    if !cond goto end
    sum_phi = phi(sum0, sum_succ)
    sum = sum_phi + a[i_phi]
    i_succ = i_phi + 1
    goto loop
end:
  return sum_phi
```

- **def-use chain** 显式 — 一个 SSA 变量只 one def，use 一定能反查 def
- **常量传播更直接**：value 数 declines + multiple versions
- **DCE (Dead Code Elimination)**: unused variable → entire def 可删
- **优化自动处理 alias**: 不同 def/use 易跟踪

## 四、支配树 (dom tree)

Dominator set dom(b) = { 起点 + all blocks 必经 b }
- idom(b) = immediate dominator (closest strict dominator)
- 支配关系 form tree

Cooper-Harvey-Kennedy 算法 (2001) O(n α(n,n)) — fast:

```
for bb in reverse_post_order(cfg):
    idom[bb] = intersect(processed_preds(bb))
```

支配边界 (DF(bset)): 应插 φ 的基本块集合。

```
bb  has preds p1, p2
DF(bb) = bb ∪ DF(p1) ∪ DF(p2)   if bb has ≥2 preds
```

Φ 插入算法 (Cytron 1991)：iter dominance frontier，每个 variable 算 DF ∩ definitions。

## 五、SSA 构造算法

1. **Cytron**: 计算 DF, 插 φ, 变 rename (use SSA version).
2. **PrSSA / SSI**: 边插 φ 在 split edge.
3. **loop closed SSA (LCSSA)**: 不让 loop value escape — 每变量 在 loop exit 插 φ.

## 六、SSA 上的优化 passes

### 6.1 Constant folding

```
%a = 1 + 2 → %a = 3
```

### 6.2 DCE (Dead Code Elimination)

```
%a = 1 + 2   # nobody uses %a   → 删
```

### 6.3 Common Subexpression Elimination (CSE)

```
%x = a + b
%y = a + b  → %y = %x
```

### 6.4 Global Value Numbering (GVN)

assign 一 ID 每 equivalence class，make same expr → 同一 SSA value.

### 6.5 Loop Invariant Code Motion (LICM)

循环不变量出循环.

### 6.6 Partial Redundancy Elimination (PRE)

用 SSA + dom 树做"工作量保" Partial available 计算, loop-out invariant expr.

### 6.7 Mem-to-reg

将 memory location 转 SSA reg (helps scalar replacement)

## 七、SSA destruction (out-of-SSA)

LLVM IR 是 SSA，但目标机有 register 而非 SSA. 必须移除 phi:

```
phi(%x1, %x2):
  
 %x1 = ...(estimate predecessor branch)
Store temp sẵn in each predecessor, e.g:
pred1: %src1 = %x1
pred2: %src2 = %x2
join:  %dst = phi(%src1, %src2)
→ rewrite as:
pred1: %x_dst = %x1
pred2: %x_dst = %x2
join:  uses %x_dst
```

Implement: "critical edge splitting" + 虚拟 move 移到 predecessor.

## 八、产线误用

### 8.1 phi node 与 critical edge
Critical edge: edge from bb with multiple successors to bb with multiple preds → 必须 split 加新 bb 防 phi 安装.

### 8.2 mem-to-reg 只 scalar
array / heap object 不参与 mem-to-reg, must use Scalar Replacement of Aggregates (SROA) 的 pass.

### 8.3 LCSSA 在 SLT 边界
入门 compiler 不实现 LCSSA 也能 work, 但 LICM out-of-loop 假设 LCSSA — 大 compiler (LLVM/GCC) 默认 LCSSA.

## 九、易错清单

1. **phi 节点**：数量要与 predecessor 数匹配
2. **critical edge split**: must add bogus 中间 bb
3. ** SSA destruction** 必须正确 set/move 以保 program semantics
4. **dom tree** 计算必 walk cfg in post-order / post-dominator 反之
5. **dead phi** variable 不能直接删除，需要 use-def chain verify DCE
6. **Aliasing** in mem-to-reg: multiple ub result name clash — 实现需要 alias analysis

## 十、这一章带走的东西

1. SSA: 一变量一定义，让 def-use chain 显态； phi 在合并点
2. CFG + dom tree 给 control flow 形式分析 / 支配边界 / branch analysis
3. Cytron 1991 的 SSA construction algorithm 行业基础
4. SSA 让 constant folding / DCE / GVN / LICM / PRE pass 写起来简单
5. LLVM IR 是 SSA，cranelift 亦 SSA, V8 Turbofan / Hotspot IR SSA
6. Phi 移除必 split critical edge + virtual moves in predecessor
7. LCSSA force loop var in exit phi simplifies loop optimizations
