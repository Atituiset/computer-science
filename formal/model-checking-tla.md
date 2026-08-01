# 1. 模型检查与 TLA+: 穷举状态空间找反例

## TL;DR

**模型检查（Model Checking）**：把系统的所有状态穷举出来，自动验证"不变量是否永远成立"、"会不会死锁/活锁"。**TLA+**（Temporal Logic of Actions，Leslie Lamport 1994）是专为并发/分布式系统设计的规格语言——Raft 作者 Ongaro 用 TLA+ 验证了 Raft，Paxos、BFT、各种共识协议都有 TLA+ 规格。这一章教你理解 TLA+ 的思维、写最小规格、跑 TLC 模型检查。

读完应能：
1. 说清模型检查 vs 测试 vs 定理证明的区别。
2. 看懂 TLA+ 规格的核心（状态变量 / 初始谓词 / 动作 / 不变量 / 时间性质）。
3. 写一个简单系统的 TLA+ 规格（如互斥锁、时钟同步）并跑 TLC。
4. 用 Lamport 的三个经典性质（安全性 / 活性 / 公平性）分析系统。
5. 知道 TLA+ 在工业（Raft/Paxos/Amazon）里的实际用法。

---

## 一、模型检查 vs 测试

### 1.1 为什么测试不够

并发系统的状态空间是**无穷/指数级**的：

```
2 个进程, 每进程 10 个内部状态 → 100 个组合状态
3 个进程 → 1000
n 个进程 + 消息延迟 + 故障 → 天文数字
```

测试只能抽样；**模型检查穷举**（在可管理的小规模上）。

### 1.2 三者的定位

| | 测试 | 模型检查 | 定理证明 |
|---|---|---|---|
| 怎么工作 | 跑真实代码 | 穷举状态空间 | 逻辑推导 |
| 找什么 | bug | **反例**（违反性质的路径） | 全部性质的证明 |
| 规模 | 真实 | 简化（小 n） | 任意 |
| 自动化 | 高 | 高 | 低（人机交互） |
| 结果 | "这次过" | "有/没有反例" | "证明了" |
| 适合 | 日常 | 并发/分布式协议 | 关键安全实现 |

> [!NOTE]
> 模型检查不能证明"大系统"（状态爆炸），但它能在**小规模上穷举**——而并发 bug 通常在小规模就能复现。Raft 的 TLA+ 用 3-5 节点验证，抓到了活锁。

---

## 二、TLA+ 的核心思维

### 2.1 三个概念

```
状态变量 (state variables): 系统的"内存" (如 pc, x, msg)
初始状态 (Init):            系统一开始长什么样
动作 (Next):                状态如何转换 (行为 = 状态序列)
```

### 2.2 一个系统的 TLA+ 规格

```tla
---- MODULE SimpleCounter ----
EXTENDS Naturals

VARIABLE n

Init == n = 0

Next == n' = n + 1        \* 每次加 1 (n' 表示"下一个状态")

Spec == Init /\ [][Next]_n    \* 从 Init 开始, 每步执行 Next (或不变)
====
```

- `n' = n + 1`：动作谓词，描述"下一个状态 n' 是什么"。
- `[][Next]_n`：每步要么执行 Next，要么保持不变（stuttering）。

### 2.3 不变量（Invariant）

> 不变量 = 系统**任何状态下都必须为真**的性质。

```tla
Inv == n >= 0      \* 计数器永不为负

\* 在 .cfg 里让 TLC 检查: INVARIANT Inv
```

模型检查器会**穷举所有可达状态**，验证不变量是否一直成立；不成立就给出一条**反例路径**。

---

## 三、实战：互斥锁的 TLA+

### 3.1 规格

两个进程想进临界区，必须互斥（不能同时在里面）。

```tla
---- MODULE Mutex ----
EXTENDS Naturals

CONSTANT N                      \* 进程数
VARIABLES pc                     \* 每个进程的程序计数器

Proc(i) == i \in 1..N

Init == pc = [i \in 1..N |-> "idle"]

\* 请求进入
Req(i) == pc[i] = "idle" /\ pc' = [pc EXCEPT ![i] = "waiting"]

\* 尝试获取锁: 只有当没有其他进程在临界区时
Get(i) == pc[i] = "waiting" /\ \A j \in 1..N \ {i} : pc[j] /= "crit"
           /\ pc' = [pc EXCEPT ![i] = "crit"]

\* 释放
Rel(i) == pc[i] = "crit" /\ pc' = [pc EXCEPT ![i] = "idle"]

Next == \E i \in 1..N : Req(i) \/ Get(i) \/ Rel(i)
Spec == Init /\ [][Next]_pc
====

\* === Mutex.cfg ===
\* SPECIFICATION Spec
\* CONSTANT N = 2
\* INVARIANT MutexInv
```

### 3.2 互斥性质

```tla
MutexInv == \A i, j \in 1..N : i /= j => ~(pc[i] = "crit" /\ pc[j] = "crit")
\* 任意两个进程不可能同时在临界区
```

TLC 跑完：**验证通过**（或给出反例——比如 Get 条件漏了，两个进程同时进临界区）。

### 3.3 时间性质（Temporal Properties）

| 性质 | 含义 | TLA+ |
|------|------|------|
| **Safety（安全性）** | "坏事永不发生" | 不变量 / `[]P`（永远 P） |
| **Liveness（活性）** | "好事终究发生" | `<>P`（最终 P） |
| **Fairness（公平性）** | 请求的资源终将被授予 | 强/弱公平假设 |

```
[]P      : 永远 P (always P)          — 安全性
<>P      : 最终 P (eventually P)       — 活性
[]<>P    : 无限次 P                    — 重复活性
<>[]P    : 最终永远 P                  — 稳定
```

例：互斥锁的活性 `<> (pc[i] = "crit")`——进程 i 最终能进临界区（不被饿死）。

> [!NOTE]
> **安全性 vs 活性**是理解并发系统的关键二分：安全性保证"系统不产生坏结果"（不变式），活性保证"系统最终出结果"（不死锁不饿死）。两个都要验证。

---

## 四、TLC 模型检查器

### 4.1 跑起来

```bash
# 需要 TLA+ 工具 (TLA+ Toolbox / TLC)
tlc Mutex.cfg            # 读规格 + 配置
```

TLC 输出：
```
Model checking completed. No error has been found.
  State1: pc = [1 |-> "crit", 2 |-> "waiting"]
  ... (枚举所有可达状态)
```

如果违反不变量：
```
Invariant MutexInv is violated.
  Behavior up to this point:
  pc = [1 |-> "crit", 2 |-> "crit"]   ← 反例路径
```

### 4.2 配置 (.cfg) 文件

```
SPECIFICATION Spec
CONSTANT N = 3
INVARIANT MutexInv
PROPERTY Liveness            \* 检查活性
CONSTANTS N = 3, Timeout = 5
```

### 4.3 状态爆炸怎么缓解

| 手段 | 说明 |
|------|------|
| 减小 N | 3-5 个进程通常够发现 bug |
| 对称规约 | 对称进程算一个 |
| 抽象 | 去掉无关细节（消息内容 → 类型） |
| 属性导向 | 只检查关心的部分 |

---

## 五、真实应用：Raft 与 Paxos

### 5.1 Raft 的 TLA+

- Raft 论文作者 **Ongaro 在论文里提供 TLA+ 规格**（`Raft.tla`），验证了选举/日志复制/安全性。
- 规格把节点建模为状态机：`Follower/Candidate/Leader` + 任期 + 日志。
- 验证的性质：**Election Safety**（同一任期只有一个 leader）、**Log Matching**（日志一致）、**Leader Completeness**（已提交日志在后续 leader 中保留）。

### 5.2 Lamport 的 Paxos

- Lamport 用 TLA+ 写了 Paxos 的严格规格（`Paxos.tla`），在 TLA+ 文档里就是标准例子。
- 模型检查在**有限进程/值**下穷举，抓"活锁"、"选值冲突"等。

### 5.3 Amazon 的实践

- Amazon 用 TLA+ 分析多个分布式系统，发现了**真实系统里测试没抓到的 bug**，有些会导致数据不一致。
- 价值：**在写实现之前/之中**写规格，抓设计层的并发错误，而不是等线上事故。

> [!WARNING]
> TLA+ 不是"验证实现"，是"验证设计/算法"。它证明的是规格的性质，不是代码正确。要连到代码，需要后面程序验证那一层的工具（模型检查代码 / 定理证明实现）。

---

## 六、其他模型检查工具

| 工具 | 语言 | 用途 |
|------|------|------|
| **TLA+ / TLC** | TLA+ | 并发/分布式协议设计验证 |
| **Spin** | Promela | 通信协议 / 并发系统模型检查 |
| **NuSMV / nuXmv** | SMV | 符号模型检查（时序逻辑 CTL） |
| **CBMC / KLEE** | C/LLVM | 程序级模型检查 / 符号执行（见程序验证章） |
| **Alloy** | Alloy | 关系/图结构的模型分析 |

---

## 七、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **模型检查**：穷举状态空间，验证不变量/性质，找反例。适合并发/分布式**协议**。
> - **测试 ≠ 模型检查**：测试抽样、模型检查穷举（小规模）。
> - **TLA+ 三件套**：Init（初始）、Next（动作）、不变量。
> - **安全性 `[]P`**：坏事永不发生；**活性 `<>P`**：好事终究发生。
> - **互斥锁验证**：不变量"无两进程同时在临界区"，活性"最终能进"。
> - **Raft/Paxos 有官方 TLA+ 规格**；Amazon 用 TLA+ 抓真实并发 bug。
> - **TLA+ 验证设计不验证实现**——连到代码要程序验证那层。
> - **状态爆炸**：减 N、对称规约、抽象。

---

下一篇: [2. 定理证明: Coq / Lean / 依赖类型 / Curry-Howard](coq-lean.md).
