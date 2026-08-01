# 优化

机器无关优化在 IR 上做，机器相关优化在指令选择后做。现代编译器把这两个阶段都用 SSA 形式表达——LLVM 在 IR 上做 Inline、GVN、DCE、LICM、向量化；HotSpot C2 用 Sea-of-Nodes 做 Ideal Graph 优化；Cranelift 用 CLIF IR。优化的本质是**用更便宜的指令序列产生语义等价的程序**，证明等价性靠数据流方程 + SSA 形式。

优化 pass 不是孤立的，而是**迭代流水线**：一个 pass 可能产生另一个 pass 的机会（Inline 后才能做 Constant Propagation，CP 后才能做 DCE，DCE 后才能做 Inline 的下一轮），所以编译器用 Fixed-point iteration 或 Worklist algorithm 反复跑到不动点或达到预算上限。LLVM 默认 `O2` 跑 ~60 个 pass，`O3` 跑 ~80 个，每个 pass 都有 cost model 决定是否值得做。

- [常量折叠、复写传播、死代码消除](basic.md)
- [循环优化、向量化、strength reduction](loop.md)
- [Inline / IPA / escape analysis](inline.md)

## 优化的代价模型

一条 pass 是否值得运行，编译器用**三件事**评估：

1. **编译时间成本**：pass 运行时间。Release 编译慢，但 debug 编译用 `-O0` 跳过所有优化 pass。
2. **代码体积成本**：Inline 让代码变大，可能 i-cache miss 反而变慢。
3. **运行时收益**：profile-guided optimization (PGO) 用真实运行 profile 决定哪些路径热，决定 inline 阈值、块布局、分支预测 hint。

LLVM 的 `opt` 把 pass 分两类：module pass 跨函数分析（Inline、LTO），function pass 单函数分析（DCE、GVN），loop pass 单循环分析（LICM）。pass manager 决定调度——分析 pass 缓存结果，转换 pass 修改 IR，依赖关系用Invalidation 传播。

---

下一节 → [常量折叠、复写传播、死代码消除](basic.md)
