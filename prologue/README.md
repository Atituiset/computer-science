# 导论卷 · 计算机基础知识体系

## 一句话

这份笔记剩下 13 部分（数学 + DSA / OS / 网络 / DB / Compiler / 分布式 / 系统设计 / 组成原理 / 计算理论 / 密码学 / 信息论 / AI/ML / 元抽象）是**按学科纵切**的深度章节；这一导论卷反过来——**沿着时间与抽象层级横拉一条贯穿全场的纵贯线**, 让你先在脑子里搭起一座"全景骨架", 再下钻各主题时永远知道自己在哪一节脊椎上.

## 思想链

```
1936 Turing / Church                ─── 可计算性的形式化
   │
1945 von Neumann / ENIAC             ─── 存储程序 → CPU + 内存一体
   │
1957 Bell Labs / IBM 360             ─── 大型机时代 (transistor, OS, 编译器, Fortran)
   │
1971 Intel 4004                      ─── 微处理器; 半导体路线胜出
   │
1975 Altair / Apple II (1977)        ─── 个人 PC 时代起
   │
1981 IBM PC + x86 + DOS              ─── PC 标准化; Wintel 联盟
   │
1991 Linux 0.01 / WWW (Berners-Lee)  ─── 自由 OS + 全球网
   │
2006 AWS EC2 / iPhone (2007)         ─── 云计算 + 移动互联网 (ARM 逆袭)
   │
2012 AlexNet / GPU CUDA             ─── 深度学习靠 GPU 起势 → XPU 时代
   │
2017 Transformer                     ─── 大模型; AI 作为新计算范式
   │
2022 LLM / 扩散 + RLHF               ─── 生成式 AI 工程化
   │
2024+ NPU / TPU / 量子 / CXL         ─── 异构计算 (XPU) 成主流
   │
2025 GPT-5 统一 o 系 / DeepSeek-R1    ─── 推理模型 + Agent (MCP) 主流化
   │
2026 Claude 5 / Gemini 3.6 / Rubin   ─── 月级迭代; 整柜算力 + HBM4 + 量子纠错爬坡
   ▼
你现在 ↓
   ──数学──硬件──OS──网络──DB──编译──分布式──系统设计──计算理论──密码学──信息论──AI──
       │      │    │     │    │     │      │         │         │       │      │     │
       └─ 导论卷 把这一整条用「纵贯线 + 抽象层级 + 形态演进」串起来 ─┘
```

## 你将带走什么

读完应能:

1. **站在 1936 / 1945 / 1971 / 1991 / 2006 / 2017 / 2024 / 2026 的每一节点上**, 知道那一年"硬件能力 / 编程模型 / 主流抽象"三件事的契约是什么, 一句话解释为什么那节点是质变而不是渐进.
2. **看懂"抽象层级"**: 晶体管 → 逻辑门 → ISA → microarch → 机器码 → 汇编 → C → OS 系统调用 → 高级语言 → 编程框架 → AI 模型. 这十层里**每一层都靠下一层的契约与不等式**支撑; 知道这些契约何时被打破 (Spectre / GC 暂停 / cache miss / NaN).
3. **用一条主线把计算机从真空管演到 XPU 讲清**: ENIAC → IBM 360 → PDP/Unix → x86 PC → ARM 移动 → 云原生 → GPU 深度学习 → LLM XPU. 每一阶段的"参数" (单台算力 / 价格 / 功耗 / 程序员数) 与"软件范式"如何同步变.
4. **看任意一份新技术文档** (e.g. H100 spec / CUDA 12 / LLaMA-3 卡) 立刻看出它在"层级 / 历史 / 异构形态"哪一格, 不被名词震到.
5. **从纵贯线一眼定位本书每一部分的位置**: 看完导论后再回各部分深读时不再"信息孤立".

## 章节结构

- [开篇: 这卷要做什么](README.md) ← 当前
- [1. 计算机发展史纵贯线: 1936 → 2026](history.md)
- [2. 抽象层级: 从晶体管到 AI 模型的十层金字塔](abstraction-layers.md)
- [3. 形态演进: 大型机 → PC → 单片机/ARM → 云 → Web → AI → XPU](mainframe-xpu.md)
- [4. 主干纵贯: CPU/内存 → OS/Linux → 网络/Web → DB → 编译 → 分布式 → AI 的承接链](standing-on-shoulders.md)
- [5. 全书地图: 13 部分与导论的交叉索引](map.md)

## 这卷不是什么

- **不是** Wikipedia 复制粘贴. 重点在"每一节点改变了什么契约", 不在"年份-事件" trivia.
- **不是** 教你硬件设计 / OS 内核 / 编译器实现的入口 (那是后续 8 部分 OS / 5 部分 Compiler 做的事).
- **不是** 答辩稿式编年史. 锚点是**形式系统 + 硬件能力 + 软件范式**三联, 而不是换 CEO.

## 与 13 部分的接口

| 导论章节 | 主要喂给的后续部分 |
|----------|---------------------|
| [history](history.md) | 全部: 给每部分一个"为何在那年出现"的认知 |
| [abstraction-layers](abstraction-layers.md) | OS (第八部分组成原理 / 第二部分 OS)、Compiler(第五)、AI(第十二) 受益最大 |
| [mainframe-xpu](mainframe-xpu.md) | 组成原理 / 系统设计 / 分布式 / AI 受益最大 |
| [standing-on-shoulders](standing-on-shoulders.md) | 全部: 让每部分知道它的"上一站契约"和"下一站使用方"是谁 |
| [map](map.md) | 全部: 一张表回查每部分所在位置 |

## 阅读路径

- **第一次来全书**: 先读导论 5 章 → 再按 [主 README](../README.md) 的阅读路径下钻.
- **已熟 CS 想横通**: 直接读 [map](map.md) 与 [standing-shoulders](standing-on-shoulders.md), 跳过 history.
- **学 Transformer 优先**: 看 [mainframe-xpu](mainframe-xpu.md) 的"GPU / XPU"段即可, 跳到第十二部分.

---

下一篇: [1. 计算机发展史纵贯线: 1936 → 2026](history.md).
