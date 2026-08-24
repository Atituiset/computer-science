# 1. 计算机发展史纵贯线: 1936 → 2026

## TL;DR

**90 年计算机史用三条线索串起**: (1) **形式系统**: "什么是可计算"逐步被严格定义;(2) **硬件能力**: 计算速度、内存、IO 用摩尔定律等指数曲线提升, 价位指数下降, 推动"软件范式"被迫重组; (3) **抽象层级**: 每一代工程师不得不引入新抽象来对抗复杂度, 把上一代底层细节封装到契约里.

每一节都讲: **那年发生了什么 / 缔造了什么契约 / 把什么写进了"已经不可能回退"的清单**.

读完应能: 用 20 分钟讲清计算机从 Turing → 2026 推理模型时代的关键节点, 每个节点一句话点破质变.

> [!NOTE]
> 2025-2026 段落已按 2026-08 公开资料（原厂 release note / 主流媒体）核对；模型发布与数字以官方口径为准。

---

## 0. 概览图

```
1936   Turing 论文 "On Computable Numbers..."
1945   von Neumann 架构报告; ENIAC 完成
1947   Bell Labs 三人组发明晶体管
1957   Sputnik → ARPA 成立; FORTRAN; IBM 360 开端
1961   COBOL; 第一台分时系统 CTSS
1969   UNIX Prototype (Bell Labs); ARPANET 起
1971   Intel 4004; 第一台微处理器; 软盘
1975   Altair 8800 → Bill Gates/Microsoft; "个人计算" 概念
1977   Apple II; Commodore PET; TRS-80
1981   IBM PC (开放架构 → clone 洪流 → Wintel 垄断)
1985   Windows 1.0; ARM1 (Acorn)
1991   Linux 0.01 (Linus); WWW 第一网页
1993   Mosaic → Web 爆炸; iPhone 之父在此出生
1995   Win95; Java 1.0; Amazon/eBay (Web 商业化)
2006   AWS EC2 起; iPhone (2007); 触屏 + app store
2012   AlexNet (ImageNet top-5 < 16%, GPU 训练); "深度学习 = GPU"
2017   Transformer / "Attention Is All You Need"
2020   COVID → 数亿人远程办公 → 云速率 5x; 扩散模型
2022   ChatGPT —— 5 天注册破 100M; RLHF 出现工程化
2023   LLaMA / Qwen / DeepSeek 系; 开源 70B 可单机推理
2024   NPU / H100 / TPU v5p / Groq / Cerebras / 量子计算长征
       Blackwell B200 / GB200 NVL72 (NVIDIA); DeepSeek-V3 开源 (12 月)
2025   GPT-5 统一 o 系; Claude 4.x / Gemini 3 / Grok 4 推理模型常态化;
       DeepSeek-R1 "时刻"; Agentic AI + MCP; gpt-oss 开源; HBM4 量产;
       Google Willow 低于阈值量子纠错
2026   GPT-5.x→5.6 / Claude 5 / Gemini 3.6 Flash / DeepSeek R2 快节奏迭代;
       NVIDIA Rubin 量产 + AMD MI450; 昇腾 950 超节点 (1024 卡);
       HBM4 三家量产 (~2 TB/s/stack) + CXL 3.2; 量子数十逻辑 qubit
```

---

## 一、1936-1945: 可计算性的形式化 + 第一台通用电子计算机

### 1.1 Church-Turing 论题 (1936)

- **Alan Turing**: 论文 *On Computable Numbers, with an Application to the Entscheidungsproblem* 提出 Turing Machine.
- **Alonzo Church**: lambda calculus 同期给出等价定义.
- **Church-Turing 论题**: 任何"算法可计算"的函数 = TM 可计算 (直觉但**不是定理**, 是把"算法定义"和"TM 定义"绑成一体).

→ 回到 [第九部分 计算理论](../theory/turing-machine.md) 看形式化定义与停机问题.

### 1.2 第二次世界大战的硬件倒逼

- **Colossus** (1943, Bletchley Park) 破译 Lorenz 密码的专用机器 (非通用).
- **ENIAC** (1945, Eckert & Mauchly, 宾大): 第一台通用电子数字计算机. 17468 真空管、30 吨、5 kW、每秒 5000 加法.
- **EDVAC 报告** (1945, von Neumann): 提出**存储程序**架构, CPU + 内存 + IO 三分, 指令和数据同存内存. 这就是后世"von Neumann 架构".

> [!WARNING]
> 这个架构的"存储程序 + 共享总线"是把**冯诺依曼瓶颈**钉死在所有现代 CPU 里. CPU 与内存的频率差距至今不断拉开, 这就是为什么 HBM / CXL / NUMA 等手段反复被发明 — 都是绕过 1945 那条契约.

---

## 二、1947-1960: 晶体管 + 大型机 + 高级语言

### 2.1 晶体管 (1947)

Bell Labs 的 Shockley / Bardeen / Brattain 发明点接触晶体管 (Nobel 1956). 替代真空管: 体积小、能耗低、长寿命 → 可堆大规模. 没它就没有集成电路.

### 2.2 集成电路 (1958)

- Jack Kilby (TI) 与 Robert Noyce (Fairchild) 几乎同时分别发明 IC.
- 1965 Gordon Moore 提出 Moore 定律 (每 18-24 月晶体管数翻倍). 半个世纪后这条曲线仍未平.

### 2.3 大型机时代 (1955-1975)

- **IBM 701** (1952): IBM 第一台商用电子计算机.
- **IBM S/360** (1964): 主打"全系列兼容", 引入 ISA (instruction set architecture) 与 microarch 分离的概念. 这一台机器让"程序员一旦写汇编, 在更高型号同运行"成为可能, 也让**ISA 抽象**成为行业必需.

→ 这是"计算机抽象层级"的真正起点, 见 [abstraction-layers](abstraction-layers.md).

### 2.4 高级语言史 (1957-1972)

| 年份 | 语言 | 出发点 |
|------|------|--------|
| 1957 | FORTRAN (IBM) | 科学计算; 之前手写汇编 |
| 1959 | COBOL | 商业数据处理 (DoD 推) |
| 1958 | LISP | 符号计算, AI 起源 |
| 1964 | BASIC | 教学, 简化学生入门 |
| 1970 | Pascal | 结构化编程教学 |
| 1972 | C (Ritchie) | 用来重写 Unix, "可移植汇编" |

→ **C 与 Unix 是孪生兄弟**; 操作系统首次可移植 (PDP-7 → PDP-11 → VAX). 这件事让"硬件厂家锁定"被反复松动, 是后续一切的种子.

---

## 三、1969-1981: Unix + ARPANET + 微处理器 + PC

### 3.1 Unix (1969)

Ken Thompson & Dennis Ritchie 在 Bell Labs 为 PDP-7 写"unics" (-> Unix), 后用 C 重写为可移植 OS. 几乎所有现代 OS (Linux, macOS, iOS, Android 底层, BSD) 都直接或间接是 Unix 派生.

**贡献**: 文件即字节流 / 进程 / fork-exec / pipe / 小工具组合的 shell 哲学 / 网络套接字.

→ 本书 [第二部分 OS](../os/README.md) 几乎是 Unix 与 Linux 工程化的延伸.

### 3.2 ARPANET (1969)

第一个分组交换网络; 4 节点起步 (UCLA / SRI / UCSB / Utah). 1973 TCP/IP 雏形 (Cerf-Kahn). 1983 NSFNET 升级 TCP/IP, "互联网" 实质开始.

1971 Ray Tomlinson 发第一封 email. 1976 Apple I 卖给爱好者; 1977 Apple II 内置 BASIC + 成品机箱; 1981 IBM PC 出货, 标致"个人计算机"被企业级认可.

### 3.3 Intel 4004 (1971): 第一颗微处理器

Intel 4004 = 2300 晶体管, 4-bit, 740 kHz. 上面运行 Busicom 打印机的计算. 这件事的本质: **CPU 也能做成芯片**而不再是机房箱柜. 后续 8080/8086 (1978 x86 起) 一步步推.

### 3.4 Altair 8800 (1975) 与 Microsoft 起步

Pop Electronics 1975 封面 Altair 8800 → 哈佛大二学生 Bill Gates 与 Paul Allen 写 Altair BASIC 解释器, 一年不到成立 Microsoft. "软件"作为商品第一次清晰化.

---

## 四、1981-1995: PC 标准化 + GUI + 互联网基础

### 4.1 IBM PC (1981)

- 用 Intel 8088 (4.77 MHz, 16-bit 内核 + 8-bit 外总线); OS 用 Microsoft DOS (买断 Seattle Computer 产品 QDOS 改名).
- **关键**: 架构未保密 → Compaq / Phoenix BIOS 等厂商大量克隆 → "PC 兼容机"潮 → x86 成为事实标准.

→ **x86 vs ARM** 分叉的故事从这年开始, 见 [mainframe-xpu](mainframe-xpu.md).

### 4.2 WIMP + GUI

- 1973 Xerox PARC 的 Alto 第一次实现 GUI (windows, icons, mouse, popup).
- 1984 Apple Macintosh 商业化 GUI. 1985 Windows 1.0.
- 1989 Tim Berners-Lee 在 CERN 提 HyperText + HTTP/HTML, 写下第一个 web server.

### 4.3 LAN 与数据库

- 1980 Novell NetWare / 3Com Ethernet 网卡让办公室组 LAN 成常态.
- **关系数据库** 1970 Codd 论文 → Oracle (1979) / IBM DB2 (1983) / PostgreSQL前身 Postgres (1996). 这是 [第四部分数据库](../databases/README.md) 的源头.

---

## 五、1991-2001: Linux + Web + 开源

### 5.1 Linux (1991)

Linus Torvalds 在赫尔辛基大学宿舍写 Linux 0.01 (1991-08-25 公告), 1992 GPL 化 → 开源爆发. 90 年代 ~ 一切服务器都 Linux 化; "LAMP stack" (Linux+Apache+MySQL+PHP) 成为 web 默认.

→ 这是 Unix 之外**第二支不锁厂商的开源 OS**, 给后续 web 服务、云计算、AI 训练堆栈全部用 Linux 作底.

### 5.2 World Wide Web (1991)

Tim Berners-Lee 在 CERN 部署第一个 web server, HTTP 0.9 / HTML. 1993 Marc Andreessen 写 Mosaic 浏览器 → Netscape (1994) → 商业化 web.

→ 后续影响 [第三部分网络](../networking/README.md) 的一切. HTTP 是几乎所有协议层的"最后一公里".

### 5.3 开源浪潮

- 1985 GNU (Richard Stallman) → GCC, glibc, bash, Emacs.
- 1991 Linux + 1995 Apache HTTP 服务器 + 1996 PostgreSQL + 2005 Git.

→ 2000 年后开源几乎成为基础设施软件默认形态, 也是 AI 时代模型托管 (HuggingFace) 的预设.

---

## 六、2001-2010: Web 2.0 + 移动 + ARM 逆袭 + 虚拟化

### 6.1 AJAX + Web 2.0 (2004-2005)

- Gmail (2004) / Google Maps (2005) 引爆 AJAX → 浏览器成"富客户端", SPA (Single Page App) 兴起.
- 2006 AWS EC2 商业化 (虚拟机租用), 启云时代.

### 6.2 iPhone + 触屏 + App Store (2007)

- 2007 初代 iPhone (ARM11 412 MHz, 128MB RAM) 改变"手机"定义: 全屏触屏 + 应用商店.
- 2008 Android 1.0; ARM 几乎一夜成为移动通用 CPU → 制造规模超 x86 → RISC 复兴.
- 2010 iPad; 2011 Chromebook.

→ ARM 在手机出货量以 **100×** 量级碾压 x86, 后又通过 Apple Silicon M1 (2020) 与 AWS Graviton 反杀数据中心. 见 [mainframe-xpu](mainframe-xpu.md).

### 6.3 虚拟化与云萌芽

- 1999 VMware; 2003 Xen; 2006 EC2; 2008 KVM 入 Linux 主干.
- "弹性的服务器"成为商品 → 创业公司不需自买机架 + 上架.

→ [第七部分系统设计](../system-design/README.md) 的所有 case (Twitter Snowflake / Google 三件套 / Kubernetes 控制平面) 都默认这套云底座.

---

## 七、2010-2020: 深度学习 + 大数据 + 容器化

### 7.1 GPU 通用计算爆发 (2007+ CUDA, 2012 AlexNet)

- 2007 NVIDIA 推出 CUDA 让 GPU 可做通用并行.
- 2012 AlexNet (ImageNet top-5 error 16%) 第一次大规模用 GPU 训 CNN, **一举把深度学习从学识题变成工业题**.
- 2013-2015 VGG/ResNet/Inception; 2014 GAN; 2015 Batch Norm; 2016 ResNet (152 层可训).
- 2017 Transformer → 序列建模换赛道.

### 7.2 大数据基础设施 (2004 MapReduce / GFS → 2010 Spark)

- 2004 Google MapReduce & GFS paper → Hadoop (2006) 开源 copy.
- 2006 BigTable paper → Cassandra (2008) / HBase / Dynamo (2007) / Redis (2009).
- 2014 Kubernetes; 2015 Docker 1.0 主流; 2018 service mesh / Istio / Envoy.

→ [第六部分分布式系统](../distributed/README.md) 的 CAP / Paxos / Raft / K8s 全靠这十年开源沉淀.

### 7.3 CPU 增长遇阻 + 多核 + 加速器登场

- 2005 后单核性能增速放慢 (Dennard scaling 结束), 8 核 / 16 核 / 32 核 CPU 成主流.
- 2010 后 GPU / TPU / FPGA 在数据中心占比上升 → **异构计算**开篇.
- 2017 RISC-V 基金会成立; ISA 开源化大潮.

→ 直接铺垫 [第八部分组成原理](../computer-arch/README.md) 里的 GPU / TPU / NPU 章节.

---

## 八、2020-2024: 大模型 + 生成式 AI + XPU 主流化

### 8.1 关键事件

- 2020 GPT-3 (175B); **scaling law** (Kaplan 2020) 起势.
- 2021 ViT / DALL-E; 2022 ChatGPT (5 天 +1 亿用户, 历史最快).
- 2022 扩散模型 (Stable Diffusion, Midjourney).
- 2023 LLaMA-2 (Meta); Qwen / Baichuan / DeepSeek 等中国开源; 推理成本 -90% / 半年.
- 2024 推理为王, TPU v5p, Groq LPU, Cerebras WSE, RISC-V 在 AI子系统, NPU 进入个人 PC 与手机, CXL 内存池化.

### 8.2 范式迁移: CPU 时代 → GPU 时代 → XPU 时代

| 阶段 | 算力主流芯片 | 开发模型 |
|------|-------------|----------|
| 1981-2005 CPU | x86 / ARM 单核 | C / C++ / Java |
| 2005-2015 多核 | 8-32 核 CPU | pthreads / TBB / Java util.concurrent |
| 2010-2020 GPU | NVIDIA + CUDA | CUDA / OpenCL / OpenGL |
| 2016-2024 加速器 | TPU / NPU / DPU | 高层框架 (PyTorch / JAX) + 算子级 |
| 2024+ XPU 异构 | CPU + GPU + NPU + DPU + 量子预研 | 全栈编排: MLIR-on-IR + workload dispatch |

→ "XPU" 是 Andy Bechtolsheim 2017 命名,**统一意味着异构**: CPU 处理控制流, GPU 处理大并行, DPU 卸载网络与存储, NPU 在终端推理. 见 [mainframe-xpu](mainframe-xpu.md) 详述.

### 8.3 RLHF 工程化

- 2022 InstructGPT → ChatGPT 把"政策对齐"从科研推成通用工程.
- 后续 DPO (Direct Preference Optimization, 2023) / RLHF with KL penalty / GRPO (DeepSeek 2024) 成主流.

---

## 八·5、2025-2026: 推理模型、Agentic AI 与 Blackwell 时代

> 按 2026-08 公开资料 (原厂 release note / 主流媒体) 核对; 模型发布与数字以官方口径为准.

### 8.5.1 推理模型 (Reasoning Models) 主流化

- **OpenAI o1** (2024 末) 与 **o3** (2025): 把 Chain-of-Thought 显式化训练, 用 RL 学习"长内部思考"过程; "test-time compute" 成为新维度.
- **DeepSeek-R1** (2025-01): 完全开源的 reasoning 模型, 凭冷启动 + 规则奖励 RL 训出一阶性能接近 o1; 价格却只有零头, 一夜踩穿美国闭源厂商定价 → "**DeepSeek 时刻**".
- **GPT-5 统一 o 系** (2025-08): OpenAI 把 o 系并入 GPT-5 按需切换推理 / 普通模式, 同周开源 **gpt-oss-120b/20b** (2025-08-05, Apache 2.0); 此后按"月"迭代 (5.1 → 5.2 → … → 5.6), 2026-07 的 **GPT-5.6** 再分成 Sol / Terra / Luna 三档能力层.
- **Anthropic** (2025-2026): Claude 3.7 / 4.x 把 "extended thinking" 做成内置开关; 2026-02 **Sonnet 4.6** 首搭 1M context, 2026-06/07 进入 **Claude 5 时代** (Sonnet 5 / Opus 5), agentic 编程与超长上下文成为默认能力.
- **Google / xAI** (2025-11): **Gemini 3 Pro** 与 **Grok 4.1** 同期发布; 2026-07 Google 出 **Gemini 3.6 Flash / 3.5 Flash-Lite / 3.5 Flash Cyber** 主打 agent 效率, Grok 5 却一再跳票、只更新到 4.5 —— 大版本节奏第一次被拉开.
- **中国开源路线齐发** (2025-2026): DeepSeek V3.2 → **R2** (2026 初)、Qwen3-Max → **Qwen3.5** (2026-02)、Kimi K2.5、GLM-Z1 等, 把 RL + verifier + 过程奖励走通并保持开源权重.

→ **统计学含义**: 不再只是 next-token 似然, 而是 MCTS + PRM + verifiable reward 上的策略优化; 模型从"模仿分布" 变 "在状态空间搜解". 这把强化学习 (RL) 从边缘推成 LLM 训练 core 环, 且 2026 年推理算力曲线比预训练更陡 —— "推理时算力" 成为新的军备竞赛主轴.

### 8.5.2 百万 token 上下文与 KV / attention 革新

- 2024 Gemini 1.5 Pro 首秀 1M context; 2026-03 **Claude Opus 4.6 / Sonnet 4.6 把 1M context 转正为 GA** (标准价、无溢价), Gemini 3 / Claude 5 延续 1M+ 原生支持, OpenAI 400K 走"短上下文快推理" 路线.
- 技术栈: sparse attention + sink token + RoPE 外插改进 (YaRN / LongRoPE) + KV 量化 (FP8 / INT4) + PagedAttention.
- → 把 [第十二部分 §2 MHA](../ai-ml/transformer.md) 与 [§3 backprop](../ai-ml/backprop.md) 里 attention 显存 $O(T^2)$ 的容器打到工程极限; 长上下文从"演示指标" 变成"默认产品参数".

### 8.5.3 NVIDIA Blackwell 与 HBM4 / Rubin

- **B200** (2024 发布 / 2025 量产): 双 die, 192 GB HBM3e, 8 PFLOPS FP4. 注意 B200 不再单芯片, 而是 2 个 reticle 用 NV-HBI 互连封装.
- **GB200 NVL72**: 36 块 Grace CPU + 72 块 B200 通过 1.8 TB/s NVLink 互联构建单机柜巨型张量机.
- **HBM4** (JEDEC 2025-04 定标; SK 海力士 2025-10 量产 → Samsung 2026-02 → Micron 2026-06 通过 NVIDIA 认证): 位宽 1024→2048 bit, **单 stack 约 2 TB/s**, 8-hi 24 GB / 12-hi 36 GB 起步; 配合 CXL 3.x 让 Tiered memory 走向主流.
- **Rubin / Vera Rubin** (CES 2026 发布, 2026 下半年量产): 72 Rubin GPU + 36 Vera CPU, NVLink 6 (每 GPU 3.6 TB/s) + ConnectX-9, 把"整柜张量机"再推上机架级 NVLink Domain; 2026 起 AI 硬件竞争从单卡打到整机柜.

### 8.5.4 ASIC 与 XPU 谱系扩展

- **Google TPU v6 Trillium** / **AMD Instinct MI450** (2026, 432 GB HBM4, 19.6 TB/s, Helios 机架) / **AWS Trainium 2**: 都朝"张量 + 互联" 押大注; Intel **Falcon Shores 2025-01 取消** (仅作内部测试芯片), 转向机架级 **Jaguar Shores** —— 路线图再一次证明竞争重心在"系统" 而非"单卡".
- **Groq LPU** 主打"流式推理"几十到几百 tok/s 单卡.
- **Cerebras WSE-3** 与 **SambaNova SN40L**: 整片晶圆级芯片 + 长上下文推理 SDK.
- **Apple M5** (2025-10) / **M5 Pro/Max** (2026-03) Neural Engine + **骁龙 X Elite NPU** 终端推理普及; 一台笔记本上跑百亿参数成产品级.
- **国产**: 昇腾 910C 大规模国产替代 → **昇腾 950 超节点 Atlas 950 SuperPoD** (2026 WAIC 首展: 1024 卡互联, 1 EFLOPS FP8 / 2 EFLOPS FP4, 256 TB 统一内存), 昇腾 384 超节点已商用 750+ 套; SMIC N+2 (7nm 等效) 2026 年底产能目标 7 万片/月; 寒武纪思元 590 / 阿里倚天 / 含光 亦成熟.

### 8.5.5 Agentic AI + MCP 协议

- 2024 末 Anthropic 提出 **MCP** (Model Context Protocol) 让 LLM 与外部工具 / 数据源通过标准 JSON-RPC 协议交互.
- 2025-2026 GPT-5.x / Claude 5 / Gemini 3.x 把 tool use / 多轮调用 / sub-agents 工程化; **Codex / claude-code 等 coding agent 成为首个"产品级 agent" 品类**, "Agent = LLM + tool loop + memory" 成主流范式.
- 由此工具调用从单 API 进化为"企业应用总线"; 安全与沙箱 (Yamada / eBPF 隔离) 同步兴起, agent 从 demo 走向生产.

### 8.5.6 量子计算 "logical qubit" 时代

- **Google Willow** (2024-12, 105 qubit): 首次演示表面码**低于阈值 (below threshold)** —— 错误率随码距增大指数下降, 纠错从理论变成工程曲线.
- **Quantinuum Helios** (2025-11): 98 物理 qubit 编码出 **48 个逻辑 qubit**, 2Q 门平均保真 99.92%, 是目前逻辑 qubit 的最高纪录.
- 2026 现实: 主流设备落在 **10-48 逻辑 qubit**, 尚未抵达 "~100 logical" 门槛; IBM 200 逻辑 qubit 的 Starling 预期 2028-2029.
- 但 **Shor 还要 100 万-1 千万物理 qubit** 才能威胁 RSA-2048; 业内"Y2Q (years to quantum)" 估计仍在 10-30 年.



---

## 九、用一条数学线把 1936-2026 拉直

```
1936 TM        ──── "可计算" 形式化
                                        1948 Shannon 信息论 ── 熵 = 压缩下界 / 容量 = 通信上界
                                              │
1980 协议理论 (Lamport / Pew / FLP) ─── 分布式算法理论起步
                                              │
1995 RSA / DH / ZKP 一线 (Crypto)
                                              │
2012 深度学习 = 反向传播 + GPU + 概率分布建模 大爆
                                              │
2022 大模型工程化 = 自回归 + RLHF + 推理优化
                                              │
2024 异构计算 = 数学调度优化 + 硬件窄并发抽象
                                              │
2025 推理模型 + Agent = RL + verifier + 显式思维链;
       Blackwell B200 把"芯片"从单片推到多 reticle 系统
                                              │
2026 HBM4 (~2 TB/s) + CXL 3.2 + 昇腾 950 超节点 + 量子数十逻辑 qubit:
       数学调度不止 on-die, 跨 memory / chiplet / quantum 同步推上日程
```

**这条线告诉读者**: 数学在第零部分不是孤立基础, 而是**在 1936-2026 这 90 年里每隔十几年就被换一次主角**, 从离散的 TM → 概率的信息论 → 协议的不变式 → 数论的密码学 → 优化的 AI.

---

## 十、一句话点破每一年质变

| 年份 | 事件 | 质变一句话 |
|------|------|-----------|
| 1936 | Turing | 把"算法"从直觉推到形式 |
| 1945 | von Neumann | 把"程序"放进内存 → 抽象层从此可分 |
| 1947 | 晶体管 | 把"开关"从机电推到固态 |
| 1964 | IBM S/360 | 把"型号"从一次性推到 ISA 兼容 |
| 1969 | Unix | 把"OS"从机房专属推到可移植代码 |
| 1969 | ARPANET | 把"通信"从点对点推到分组交换 |
| 1971 | 4004 | 把"CPU"从箱柜推到芯片 |
| 1981 | IBM PC | 把"计算机"从机房推到桌面 |
| 1991 | Linux + WWW | 把"操作系统"和"信息消费"各自开源 / 全球化 |
| 2006 | AWS EC2 | 把"服务器"从资本推到按分钟计费 |
| 2007 | iPhone | 把"计算机"从桌面推到口袋 (ARM 击穿) |
| 2012 | AlexNet + CUDA | 把"GPU"从图形推到通用张量 |
| 2017 | Transformer | 把"序列建模"从时间串联推到并行 attention |
| 2022 | ChatGPT | 把"AI"从论文推到日常工具 |
| 2024 | XPU 异构 | 把"CPU 一统天下"推到分工表 |
| 2025 | 推理模型 / DeepSeek 时刻 | 把"LLM"从续写推到 RL 增强推理; 开源踩穿定价 |
| 2025 | Blackwell B200 / GB200 | 把"GPU"从单片推到 multi-reticle + 整柜张量机 |
| 2025 | MCP / Agentic AI | 把"LLM"从问答推到工具总线 + 多轮 Agent |
| 2026 | HBM4 三家量产 + Rubin / MI450 + 昇腾 950 | 把"算力"从单供应商单片推到整柜多源分工 |
| 2026 | 量子 10-48 逻辑 qubit | 把纠错从物理实验推到工程爬坡 |

---

## 十一、结束 + 速查表

> [!TIP]
> 一页快速唤回:
>
> - **1936 Turing**: 算法形式化; 不可判定性.
> - **1945 von Neumann**: 存储程序 ISA; CPU + 内存 + IO 三分.
> - **1947 晶体管 + 1958 IC**: 让大规模逻辑可堆.
> - **1964 IBM 360**: 引入 ISA 抽象; "兼容"成为商品属性.
> - **1969 Unix + ARPANET**: OS 可移植 + 分组交换.
> - **1971 Intel 4004**: CPU-on-chip; 微处理器时代.
> - **1981 IBM PC**: x86 + DOS, Wintel 出芽.
> - **1991 Linux + WWW**: 开源 OS + 全球网.
> - **1995 商业 web**: 浏览器, LAMP stack.
> - **2006 AWS**: 云原生起.
> - **2007 iPhone**: ARM 移动逆袭.
> - **2012 AlexNet + CUDA**: GPU = 张量计算事实标准.
> - **2017 Transformer**: 并行 attention 取代 RNN.
> - **2022 ChatGPT**: 大模型工程化, 用户数年破亿.
> - **2024 XPU**: CPU + GPU + DPU + NPU + 量子预研.
> - **2025 Reasoning + Blackwell**: 推理模型把 RL 推上 LLM 主舞台; B200 / GB200 把 GPU 推到整柜张量机.
> - **2025 DeepSeek 时刻**: 开源踩穿闭源定价; 中国开源路线齐发.
> - **2025 MCP / Agentic**: LLM 进化为 Agent + tool bus.
> - **2026 HBM4 (2 TB/s) + Rubin / MI450 + 昇腾 950 + 量子数十逻辑 qubit**: 整柜算力 + 多源供应链; 逻辑 qubit 纠错进入工程爬坡.

---

下一篇: [2. 抽象层级: 从晶体管到 AI 模型的十层金字塔](abstraction-layers.md).
