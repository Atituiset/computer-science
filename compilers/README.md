# 第五部分 · 编译原理

## 一句话

编译器把高级语言翻译成机器码的过程就是"理解→变换"的流水线：源文本 → token → AST → 语义检查 → IR → 优化 → 汇编/机器码。每一层都是形式系统的工程化。

## 章节

- [词法分析](lexer/index.html)
- [语法分析](parser/index.html)
- [语义分析与中间表示](sema/index.html)
- [优化](opt/index.html)
- [后端：codegen 与机器模型](codegen/index.html)

读完应能回答：正则为什么不够描述嵌套结构、LR vs LL 的差异、SSA 为什么使优化简单、escape analysis 怎么做、tiered compilation 的价值、寄存器分配为什么是图着色、LLVM 与 cranelift 设计差、V8 JIT 5 阶段 tier、 escape analysis 与 LTO 的关系。
