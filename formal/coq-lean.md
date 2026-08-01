# 2. 定理证明: Coq / Lean / 依赖类型 / Curry-Howard

## TL;DR

模型检查在"小规模"上穷举；**定理证明（Interactive Theorem Proving）**在"任意规模"上用逻辑推理证明命题——本质是**让计算机验证你的证明每一步是否合法**。Coq 和 Lean 是两类主流证明助手，它们的根基是**依赖类型**和 **Curry-Howard 对应**（命题 = 类型，证明 = 程序）。这一章给心智模型 + 最小可跑示例，让你能看懂 `Theorem ... := ...` 和证明脚本，理解 CompCert / seL4 / F* 这类"被证明的系统"。

读完应能：
1. 理解 Curry-Howard：为什么"证明一个命题"等价于"构造一个类型的程序"。
2. 理解依赖类型与普通类型系统的区别（类型可以依赖值）。
3. 读一个简单的 Coq / Lean 证明，理解 `Proof` / `Qed` / tactics 是什么。
4. 知道 Coq / Lean / Isabelle 的区别与代表成果（CompCert / seL4 / mathlib）。
5. 理解定理证明的成本与适用场景（编译器/内核/密码关键实现）。

---

## 一、Curry-Howard 对应：命题即类型，证明即程序

### 1.1 核心对应

| 逻辑 | 类型论 |
|------|--------|
| 命题 A | 类型 A |
| A 的证明 | 类型 A 的一个程序（term） |
| A ∧ B | 积类型 (A × B) |
| A ∨ B | 和类型 (A + B) |
| A ⇒ B | 函数类型 (A → B) |
| ∀x, P(x) | 依赖函数 (∀ x, P x) |

> [!NOTE]
> **Curry-Howard**：证明"若 A 则 B" = 写一个函数 `A → B`（输入 A 的证明，输出 B 的证明）。证明"存在 x 使 P(x)" = 构造一个具体的 x 和它的证明。这就是为什么**写证明像写程序**——证明助手本质是个"带类型检查的编程语言"。

### 1.2 为什么这很重要

- **程序即证明**：你写一个满足类型的 term，就是给出一个证明。
- **类型检查即验证**：计算机自动检查 term 类型是否合法 = 自动验证证明步骤。
- **反例即类型错误**：证明有漏洞 → 类型检查不过 → 编译器拒绝。

---

## 二、依赖类型：类型可以依赖值

### 2.1 普通类型系统

`List<Int>`：类型参数是类型（`Int`），不是值。

### 2.2 依赖类型

类型可以**依赖具体值**：

```coq
(* 长度索引的向量: Vec A n 是长度为 n 的 A 列表 *)
Inductive Vec (A : Type) : nat -> Type :=
  | nil  : Vec A 0
  | cons : forall n, A -> Vec A n -> Vec A (S n).
```

- `Vec A 3` 是"长度恰好为 3 的向量"——**长度是类型的一部分**。
- 好处：`head` 函数可以只在"非空向量"上定义（类型系统强制），空向量调 head 编译都不过。

### 2.3 例子：头元素只对非空合法

```coq
Definition head (A : Type) (n : nat) (v : Vec A (S n)) : A :=
  match v with
  | cons _ a _ => a
  end.
(* 注意: 没有 nil 分支! 因为类型 Vec A (S n) 保证非空, 编译器不接受 nil *)
```

> [!WARNING]
> 这正是依赖类型 vs 普通类型系统的分水岭：普通系统在运行时查 `null` / 抛异常；依赖类型**在编译期就把非法状态排除**。代价是写证明（构造类型）更难。

---

## 三、Coq：一个最小的证明

### 3.1 环境

Coq 是一个依赖类型语言 + 证明助手（CIC 演算），配合 IDE（CoqIDE / VS Code + vscoq）。

### 3.2 一个简单定理

```coq
(* 证明: 对任意自然数 n, n + 0 = n *)
Theorem plus_0_r : forall n : nat, n + 0 = n.
Proof.
  intros n.
  induction n as [| n' IH].
  - reflexivity.              (* 0 + 0 = 0, 直接化简成立 *)
  - simpl. rewrite IH. reflexivity.   (* S n' + 0 = S (n'+0) = S n' *)
Qed.
```

- `intros n`：把 `forall n` 的 n 引入上下文。
- `induction n`：归纳法（基础情形 + 归纳步骤）。
- `reflexivity` / `rewrite IH`：tactic（策略），驱动证明。
- `Qed`：证明完成，定理被登记为可信。

### 3.3 证明本质上是"指导类型检查器"

每步 tactic 都在**改变证明项（term）**，最终形成一个类型为"该定理"的 term——`Qed` 让 Coq 内核独立校验这个 term。**即使是复杂 tactic，最终证明都要过内核的语法检查**（这就是可信内核的关键设计）。

### 3.4 证明被编译进程序（可提取）

```coq
(* 程序提取: 把证明中的可计算部分提成 OCaml/Haskell *)
Extraction "sorted.ml" sort_spec.
```

---

## 四、Lean：现代证明助手

### 4.1 与 Coq 的区别

| | Coq | Lean |
|----|------|------|
| 系统 | CIC 演算（依赖类型） | 依赖类型 + 商类型 |
| 定位 | 程序验证成熟（CompCert） | 数学库 + 验证并重（mathlib） |
| 元编程 | Ltac（较老） | Lean 4 用自身（宏） |
| 风格 | 偏"程序" | 偏"数学 + 程序" |
| 代表 | CompCert, VST | mathlib (数学), Verifiable C |

### 4.2 Lean 例子

```lean
-- 证明: 对任意自然数 n, n + 0 = n
theorem plus_zero_right (n : Nat) : n + 0 = n := by
  induction n with
  | zero => rfl
  | succ n ih => simp [ih]

-- 或更函数式:
def addZero : (n : Nat) → n + 0 = n
  | 0 => rfl
  | n+1 => by simp [addZero]
```

### 4.3 mathlib：最大的数学证明库

- mathlib 是 Lean 的数学库，包含大量现代数学的形式化证明。
- 意义：**定理证明已经证明"庞大数学理论"**，不只是玩具。

---

## 五、被证明的系统：为什么值得

### 5.1 CompCert（被证明的 C 编译器）

- 用 Coq 证明：**编译器的每次变换都保持程序语义**。
- 结论：C 程序在 CompCert 编译下"正确运行" = 在数学意义上被保证（无编译器 bug）。
- 价值：安全关键软件（航空、汽车）用 CompCert 消除"编译器引入的 bug"。

### 5.2 seL4（被证明的操作系统内核）

- 用 Isabelle/HOL 证明 seL4 微内核满足功能规格。
- 这是第一个"操作系统内核功能正确性"的机械验证。
- 影响：验证安全关键系统（军用、汽车）的基石。

### 5.3 其他

- **F* / F**：依赖类型验证语言，用于加密实现（EverCrypt 用 F* 生成 C/汇编加密库）。
- **VST (Verified Software Toolchain)**：Coq 里验证 C 程序的工具。
- **RustBelt**：证明 Rust 的类型系统 + unsafe 内存安全。

---

## 六、什么时候用定理证明

| 用 | 不用 |
|----|------|
| 编译器 / 内核 / 加密原语（不可有 bug） | 普通应用（bug 可接受、迭代快） |
| 协议关键性质（共识、时间） | 已有测试足够的系统 |
| 数学/逻辑研究 | 快速原型 |

**成本**：CompCert 用了数人年、几十万行证明。这是**每行证明的成本远高于每行代码**的领域。

> [!TIP]
> 工程上的务实做法：**只在"正确性代价极高"的组件用**（如加密库、内存安全边界、共识核心），其余用测试。现代趋势是"形式化 + 测试"混合（如 Rust 生态里用证明验证 unsafe 部分）。

---

## 七、与前面章节的接口

- 依赖类型 = 类型系统（编译 §type-system）+ 数学（理论 §形式语言）。
- Curry-Howard = 逻辑（数学 §逻辑）在类型里的实现。
- Hoare 逻辑（下一章）是"程序验证"用逻辑证明代码性质，定理证明是它的执行工具。

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **Curry-Howard**：命题=类型、证明=程序、证明检查=类型检查。
> - **依赖类型**：类型依赖值（`Vec A n`），编译期排除非法状态。
> - **Coq**：CIC 演算 + tactics（`intros`/`induction`/`reflexivity`/`rewrite`），`Qed` 过内核校验。
> - **Lean**：现代证明助手，mathlib 数学库，验证 + 数学并重。
> - **证明 = 指导类型检查器**：即使复杂 tactic，最终 term 要过内核。
> - **代表成果**：CompCert（C 编译器）、seL4（OS 内核）、EverCrypt（加密）、RustBelt（Rust）。
> - **成本极高**：只在正确性关键处用；"证明每行"比"写每行"贵得多。
> - **工程趋势**：形式化 + 测试混合（关键组件证明，其余测试）。

---

下一篇: [3. 程序验证: Hoare 逻辑 / 符号执行 / 形式语义](program-verification.md).
