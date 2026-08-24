# 语法分析

## 这一节

- [递归下降 / Pratt / 错误恢复](recursive-descent.md)
- [LR/LALR/SLR/yacc/bison](lr.md)
- [GLR、PEG、packrat](glr-peg.md)

读完应能回答：

- 左递归为什么让递归下降死循环? 表达式层为什么不消左递归而用 Pratt?
- LR 栈里存状态而不存文法符号, 换来的是什么?
- SLR 的 FOLLOW 近似为什么产生假冲突? LALR 合并为什么只新增 reduce-reduce?
- GLR 在冲突处分叉后, 内存为什么不会指数爆炸?
- PEG 的有序选择 `/` 与 CFG 的无序 `|` 差在哪? packrat 用什么换线性时间?

---

下一节 → [语义分析与类型系统](../sema/README.md)
