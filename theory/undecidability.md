# 5. 不可判定性: 停机问题、Rice 定理

## TL;DR

1936 年 Turing 证明: **不存在** 算法判断任意程序 $\langle M \rangle$ 在任意输入 $w$ 上是否会停. 这个被命名为 **Halting Problem** 的命题, 把"程序能关于自己说什么"封死了一个明确上限. Rice 定理进一步把所有非平凡**语义**性质 (而非语法) 全部锁死——"是否恶意代码"、"是否使用了网络"、"是否会输出某字符串"、"是否会蒸发内存"——都不可判定. 这就是为什么静态分析 (Clang Static Analyzer, Rust Borrow Checker, SonarQube) 必须牺牲完整性换可解——所有"超安全"声称必含 false positive 或 false negative.

---

## 一、Halting Problem

### 1.1 形式定义

记 $H = \{ \langle M, w \rangle \mid M \text{ 接受输入 } w \text{ 时停 (接受或拒绝都算停)} \}$. $H$ 是 RE 但**不是** $\mathcal{R}$.

### 1.2 对角线反证 (Turing 1936)

设反设: $H$ 可判定, 即存在 DTM `HALT(M, w)` 返回 true 当且仅当 $M$ 在 $w$ 停机.

构造新的 DTM `D`:
```
def D(M):                       # 输入是 TM 编码 M
    if HALT(M, M):              # 询问 M 在自身编码上是否停
        loop_forever()          # 否则不停
    else:
        halt()
```

问: `D(D)` 停吗?

- 若停 ⇒ `HALT(D, D) = True` ⇒ D 调到 `loop_forever()` ⇒ 不停. 矛盾.
- 若不停 ⇒ `HALT(D, D) = False` ⇒ D 调到 `halt()` ⇒ 停. 矛盾.

故 $H$ 不可判定. $\square$

### 1.3 Python 模拟 (直观感)

```python
def halt(prog_str: str, input_str: str) -> bool:
    """
    Hypothetical halting oracle — would have to exist in some 'magic' world.
    Real-world: 这里只是 placeholder, 假设它存在.
    """
    raise NotImplementedError("impossible by diagonalization")

def D(prog_str: str) -> None:
    if halt(prog_str, prog_str):
        while True: pass    # loop forever
    else:
        return             # halt cleanly

# D 的源码
D_src = inspect.getsource(D)
# 询问 D(D) — paradox
```

虽然 Python 视角下也只是把"如果 HALT 存在就坏"做了一道逻辑链——同样告诉**任何 ≥ Turing-complete 的语言**这条 cap 都挂顶.

---

## 二、归约 (Reductions)

把"如果 $B$ 可判定则 $A$ 可判定"形式化: $A \leq B$. 反证 $A$ 不可判定 ⇒ $B$ 不可判定.

### 2.1 Many-one reduction $A \leq_m B$

存在可计算 $f: \Sigma^* \to \Sigma^*$ 使 $x \in A \Leftrightarrow f(x) \in B$. 即把 $A$ 的实例编码成 $B$ 的实例.

### 2.2 Turing reduction $A \leq_T B$

存在以 $B$ 为 oracle 的 DTM 解 $A$. 比 $\leq_m$ 弱但更直观.

### 2.3 使用范式

证 $L$ 不可判定:
1. 取已知不可判定的 $A$ ($\subset \mathcal{R}$), 例如 $H$.
2. 构造可计算 $f$ 使 $\langle M, w \rangle \in A \Leftrightarrow f(\langle M, w\rangle) \in L$.
3. 若 $L$ 可判定, $A$ 也可判定—矛盾.

---

## 三、Rice 定理 (1953)

**定理**: 任意非平凡性质 $\mathcal{P}$ of RE language ($\emptyset \neq \mathcal{P} \neq \text{所有 RE}$), 集合 $\{ \langle M \rangle \mid L(M) \in \mathcal{P} \}$ 不可判定.

即对**任意**对 TM 语言的非平凡**语义**问题, 都不存在算法判定它.

### 3.1 证明骨架

把 $H$ 归约到 $\mathcal{P}$:

- 任选一个 $L_{\text{yes}} \in \mathcal{P}$, 一个 $L_{\text{no}} \notin \mathcal{P}$.
- 对 $\langle M, w \rangle$, 构造 $\tilde M$:
  - ignore input $x$;
  - 模拟 $M$ 在 $w$ 上跑:
    - 若停 ⇒ 接受 iff $x \in L_{\text{yes}}$.
    - 若不停 ⇒ 持续 loop.
- 则 $M(w)$ 停 $\Rightarrow L(\tilde M) = L_{\text{yes}} \in \mathcal{P}$; 不停 $\Rightarrow L(\tilde M) = \emptyset \notin \mathcal{P}$ (因 $\mathcal{P} \neq \emptyset$ 充分满是 trivially 取 $L \in \mathcal{P}$ 不为空)——要保证 $\emptyset \notin \mathcal{P}$, 可选注意力放: 如果 $\emptyset \in \mathcal{P}$, 则 inverse membership 用同样构造绕到补.

### 3.2 实例

| 性质 $\mathcal{P}$ of $L(M)$ | 不可判定性来源 |
|------------------------------|------|
| $L = \Sigma^*$ (M 接受一切) | Rice |
| $L = \emptyset$ (M 拒绝一切), 即**永远不会停 accept** | Rice |
| $L$ 不是空 (M 至少接受一个) | Rice (且属 RE — 半可判定) |
| $L = L_{\text{ref}}$ for fixed $L_{\text{ref}}$ | Rice |
| $|L| = 5$ | Rice |
| $w_0 \in L$ for fixed $w_0$ | Rice (即 $H$) |
| $L$ finite | Rice |
| $L$ regular | Rice |
| $L$ 上下文无关 | Rice |

> [!WARNING]
> Rice 仅说"语义"性质。**语法**性质有时可判定: "M 在前 100 步内访问 cell 12"可判; "M 长度 < 100" 可判; "M 是否曾用过某指令" 可判 (有界步内即可). 静态分析器**就卡在"语法可判, 语义不可判"分界线**.

---

## 四、其他经典不可判定问题

### 4.1 Post Correspondence Problem (PCP)

给一组 domino $[(t_1, b_1), \ldots, (t_n, b_n)]$ (每片上方串 + 下方串), 问能否挑序 (允许重复) $i_1, \ldots, i_k$ 们上面串拼接 = 下面串拼接.

Emil Post 1946 证明 PCP 不可判定 (用 TM config history 归约). 即拼字谜不可判定. 由 PCP 立即立: 上下文无关文法的歧义不可判定 (PCP $\leq$ 歧义检查).

### 4.2 Hilbert's 10th (Diophantine)

存在整数多项式方程的有整数解? — **不可判定**. Yuri Matiyasevich 1970 终结了之. 直接证明"数论方程的解数非可计算函数" (引出 Mandelbrot-like 几何限制).

### 4.3 Wang tiles / Domino tiling

能否铺整个平面? — 不可判定.

### 4.4 Word problem in groups (Novikov-Boone)

群论中, 是否任意两字等价? — 不可判定. 这给"代数定理机器证不可判"。

### 4.5 Collatz conjecture

至今未证 —— 但已证**广义 Collatz** 不可判定 (停机归约到 Collatz 演算路径).

### 4.6 第十/awk 模型

awk regex 是否能匹配任意串 — 若允许 backreference, 不可判定 (regex 中嵌入 TM encoding).

---

## 五、Rice-Shapiro (半可解)

把 Rice 推化到"哪些性质可在 RE 而非 $\mathcal{R}$":

**Rice-Shapiro**: 性质 $\mathcal{P}$ 在 RE 半可解 iff 存在有限集 $D$ 的并集来描述: 
$$ \mathcal{P} = \{ L \mid \exists \text{ finite } D \subseteq L, D \in \mathcal{F}\} $$
某个汇集的可计算枚举 $\mathcal{F}$.

直觉: 在 RE 模型下, 机器只能"看到"有限 prefix → 只能基于有限 prefix 半-custom 解.

工程意义: **多数静态分析器实现都是 $\mathcal{RE}$ 半可解** ——它们能枚举"出错原因", 找到就警告, 找不到就静默 (即放弃 false negative 不放弃 soundness).

---

## 六、Arithmetic Hierarchy

把 $\mathcal{RE}$, co-$\mathcal{RE}$ 推广到 $\Sigma_n^0$, $\Pi_n^0$:

- $\Sigma_0^0 = \Pi_0^0 = \mathcal{R}$.
- $\Sigma_{n+1}^0$ = "存在 $x$, $R(\cdot, x)$" where $R \in \Pi_n^0$.
- $\Pi_{n+1}^0$ = "对一切 $x$, $R(\cdot, x)$" where $R \in \Sigma_n^0$.

$H \in \Sigma_1^0$, $\overline{H} \in \Pi_1^0$. **Totality** "$M$ halts on all inputs" $\in \Pi_2^0$ — 比停机更高一层, 既不在 $\Sigma_1^0$ 也不在 $\Pi_1^0$. 这是"经量化变元深度"递归消灭的可计算子集度.

**Beyond**: $\emptyset^{(n)}$ = 第 $n$ 步 jump, 不可与之判定 (单个 intuition: 多 jump oracle 间有不可比性 — Post's theorem).

---

## 七、实践路线: 工程上怎么办

不可判定 ≠ 不能做. 工程师用三招绕:

### 7.1 限制子语言

把分析对象限制到不可判定的子语言 (语法层 vs 语义层):
- **Rust borrow checker**: SSA-style lifetime, 没有递归 (在禁 recursive function 后), decidability. 
- **Petri nets**: reachability 实际**decidable** (虽然 EXPSPACE-hard), 替代 TM model of concurrency.
- **Linear/affine typing** (Linear ML): 用类型化截掉时间复杂性.

### 7.2 近似/精化

放弃 sound 或 completeness:
- **Taint analysis**: 假定某些 path impossible, 简化但可能漏报.
- **Abstract interpretation**: 把 concrete domain 映射到有限抽象 domain, 工作在 abstract config 间 — 真值保 sandwich 但精度可能差. Cousot 1977.
- **Symbolic execution + bound**: 给 step limit. KLEE/SAGE 跑有限步, 不穷尽代码空间.

### 7.3 演绎而非验证

不判断"是否满足", 而找出**反例 (counter-example)': SMT solver (Z3 / CVC5) 反向找反例. SAT-based bounded model checking (CBMC) 在 n step 内证"无 bug 路径"; 若证不出, 调步 limit.

> [!NOTE]
> 这就是 Rust borrow checker 工作的本质类: 它的"安全复位"是按线性类型 + borrow scope 限制的**有界步** (limited decode), 编译器能证。**不是分析任意程序**的 alias, 而是"在 SSA + 线性借用语义"子语言里查借用规则.

---

## 八、桥梁

- **类型系统**: HM (Hindley-Milner) 类型推断要决定所有子项可判定, 必须"不图灵完全". 第五部分 compilers/sema/type-system 讲为什么 ML 是完全可判定 type infered; TC (Type Classes) / Scala implicits 实际**不可判定** (resolution 可触发任意环).
- **软件验证**: Frama-C, Why3, Agda, Coq 都依赖让目标**被动**先化到可判子集.
- **第八/七部分**: Kubernetes controller "解释为什么状态尚未 reconcile"在理论上是 不可判定 (encoding 应用侧特别路上的 cfg) — 实践用 YAML schema bounds.

---

下一节 → [Complexity Classes](complexity.md)
