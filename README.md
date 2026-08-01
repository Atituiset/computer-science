# Computer Science Notes

一份基于 mdBook 的个人 CS 知识库，目标是对计算机科学的核心知识做**全面、深入、可工程化落地**的整理, 并以"一纵一横"的结构呈现: **导论卷**沿时间 / 抽象层级 / 形态 / 承接四视图搭骨架, **第零到第十三部分**按学科横切做工程级深度。

> [!NOTE]
> 在线版已部署到 GitHub Pages: <https://atituiset.github.io/computer-science/>

## 这份笔记的定位

- **不是**面试速记卡，也不抄一遍教材的目录。
- **是**自己用过的、推过的、踩过的坑沉淀下来的工程级笔记。
- 对每个专题，要求三件事：
  1. **原理讲透**：知道为什么这么设计、代价是什么、什么时候该用不该用。
  2. **代码落地**：用 Go / TypeScript / Python / C/C++ 至少两种语言给出可运行实现，必要时给出工业优化版本。
  3. **可被验证**：复杂度、边界、对抗用例都列出。

## 谁应该读

- **已经能写代码、但对"为什么"还不够熟的工程师**：能完成需求，但读论文、看源码、做架构选型时仍卡在数学或底层概念。
- **复习型读者**：离校多年、忘了"自动机 / MVCC / Sylvester / KL"的人，需要一份**从工程痛点反向回溯到原理**的笔记，而不是教材正着讲一遍。
- **想横向打通 CS 的工程师**：把 DSA、OS、DB、Compiler、Crypto、信息论当**同一张网**而不是十本独立教材来看的人——第十二部分"元抽象"专为你写。

> [!TIP]
> 如果你是从 DSA / OS / Compiler 入手而撞上数学记号，先回**第零部分**把数学准备到位再继续；每篇都明确标了"喂给后面哪一章"。

## 章节骨架

| # | 部分 | 目录 | 文件数 / 行数 |
|---|------|------|--------------|
| – | **导论卷 · 计算机基础知识体系** | [`prologue/`](prologue/index.html) | 6 / 1.8K |
| – | **工程化实践轴 · 让代码跑进生产** | [`engineering/`](engineering/index.html) | 11 / 3.5K |
| 0 | **工程数学与离散数学基础** | [`math/`](math/index.html) | 5 / 1.8K |
| 1 | 数据结构与算法（DSA） | [`dsa/`](dsa/index.html) | 36 / 3.9K |
| 2 | 操作系统 | [`os/`](os/index.html) | 28 / 3.5K |
| 3 | 计算机网络 | [`networking/`](networking/index.html) | 23 / 6.2K |
| 4 | 数据库系统 | [`databases/`](databases/index.html) | 23 / 4.6K |
| 5 | 编译原理 | [`compilers/`](compilers/index.html) | 19 / 3.3K |
| 6 | 分布式系统 | [`distributed/`](distributed/index.html) | 22 / 3.8K |
| 7 | 系统设计 | [`system-design/`](system-design/index.html) | 30 / 6.0K |
| 8 | 计算机组成原理 | [`computer-arch/`](computer-arch/index.html) | 10 / 4.7K |
| 9 | 计算理论（自动机 / 复杂度） | [`theory/`](theory/index.html) | 10 / 2.1K |
| 10 | 密码学与安全 | [`crypto/`](crypto/index.html) | 13 / 2.8K |
| 11 | 信息论与编码 | [`info-theory/`](info-theory/index.html) | 12 / 2.0K |
| 12 | 人工智能与机器学习 | [`ai-ml/`](ai-ml/index.html) | 14 / 4.3K |
| 13 | 元抽象（跨章节大主题） | [`_meta/`](_meta/index.html) | 8 / 1.3K |
| – | **形式化方法卷** | [`formal/`](formal/index.html) | 4 / 0.8K |
| – | **量子计算卷** | [`quantum/`](quantum/index.html) | 4 / 0.6K |

合计：**导论卷 + 工程化实践轴 + 第零部分（前置数学）+ 13 主题 + 形式化卷 + 量子卷**，281 个 `.md` / ~57.6K 行 / ~220 个一线章节。

骨架的设计原则是「一纵一横」：**导论卷**沿时间轴（1936 → 2026）+ 抽象层级（晶体管 → AI 模型）+ 形态演进（大型机 → XPU）+ 承接链（CPU/内存 → AI）四视图把全书串起来；**第零部分到第十三部分**按学科横切，每个专题做工程级深度。**工程化实践轴**则是把基础落地到生产的手艺（Git / 测试 / CI-CD / 性能 / 安全 / 质量 / 可观测性）。读者通过 [prologue/map.md](prologue/map.md) 的一张矩阵可以一眼定位任何一部分所在位置。

## 阅读路径

**起点推荐（新读者）**: 先读 [导论卷](prologue/index.html) — 用 4 个视图（时间 / 抽象层级 / 形态演进 / 承接链）把全书骨架在脑子里搭起来, 然后任选下面三条按背景分型的路径下钻.

**按背景分型**:

1. **应用工程背景 / 看论文吃力**
   → 先 [导论](prologue/index.html) → [第零部分 数学](math/index.html) → [线代](math/linalg.md) → [概率](math/prob.md) → [微积分与优化](math/calc-opt.md) → 再回主线.
2. **没系统学过 CS 理论**
   → [导论](prologue/index.html) → [数学 · 离散篇](math/discrete.md) → [DSA](dsa/index.html) → [计算理论](theory/index.html).
3. **学习 Transformer 优先**
   → [导论 · 形态演进](prologue/mainframe-xpu.md) (XPU 段) → [线代](math/linalg.md) → [概率](math/prob.md) → [微积分](math/calc-opt.md) → [第十二部分 AI/ML](ai-ml/index.html).

主线推荐顺序（已系统学过、想横通 CS）：

```
导论卷 → 第零部分 数学 → DSA → OS → 网络 → DB → Compiler
       → 分布式 → 系统设计 → 计算机组成 → 计算理论
       → 密码学 → 信息论 → AI/ML → 元抽象（收束）
```

`mdbook serve` 后左侧目录即为主线阅读序，每章开头都有"一句话 + 思想链 + 章节列表 + 读完应能回答"。

## 本地预览

```bash
cargo install mdbook mdbook-mermaid mdbook-alerts
mdbook serve --open
```

默认监听 `http://localhost:3000`。

> [!NOTE]
> `book.toml` 当前启用三个 preprocessor：`alerts` (`> [!NOTE]` / `> [!WARNING]` 框)、`mermaid` (流程图)。若想加 linkcheck，可在 `book.toml` 增 `[preprocessor.linkcheck]` 后另装 `mdbook-linkcheck`。

**渲染特性**：

- 数学公式：KaTeX 渲染，行内 `$ ... $` / 块级 `$$ ... $$`。
- 流程图：mermaid v10 本地化嵌入（`mermaid.min.js` + `mermaid-init.js`）。
- 代码高亮：mdBook 内置 highlight.js 配合 `language-xxx` 标注。

## 编写约定

- **每章结构**：`TL;DR / 一句话` → `思想链`（ASCII 树从工程问题回溯到原理）→ 形式化定义 → 例子 → 多语言实现 → 提示框 → 文末"一页速查"。
- **多语言实现**：Go / TypeScript / Python / C++ 至少两版；工业优化版另开小节。
- **涉及分析处**给出形式化结论 + 直觉解释两版。
- **重点结论**用 mdBook alerts 框出：
  - `> [!NOTE]` — 关键观察、跨章引用入口
  - `> [!WARNING]` — 反直觉、常见误用、踩坑警告
  - `> [!TIP]` — 速查表 / 速记口诀
- **数学记号**统一见 [`math/README.md` §记号约定](math/index.html#数学记号约定)。

## 与 TODO 的对齐

后续可继续扩展方向见 [`TODO.md`](TODO.md)。当前 15 个部分（导论 + 工程化轴 + 数学 + 13 主题 + 形式化卷 + 量子卷）均已就位；近期已补 DNS、倒排索引/全文检索、分布式事务、虚拟化与容器、SSD/NAND 存储硬件、经典 ML 与树模型、LLM 推理部署，并对 DSA 的贪心/回溯做了深度重写。后续增补按需进行（如流处理引擎、图数据库、工程化的专项实操）。
