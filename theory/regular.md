# 2. 正则语言与泵引理

## TL;DR

正则语言 (Regular Language) = DFA / NFA / ε-NFA 接受的语言 = 正则表达式描写的语言. 三者等价由 **Kleene Theorem** 给出. 本章把"是否正则"这把尺子交给两个工具:

1. **Pumping Lemma**: 必要但不充分——很多非正则语言也通过 pumping lemma, 用法多半是反证"语言非正则".
2. **Myhill-Nerode**: **充要**, 直接给出最小 DFA 状态数. 适合那些 pumping lemma 抓不住的反例.

读完后, 你能在面试/代码评审里立刻辨出"这语言是否需要栈/计数器"——这就是 parser 选型 (LL / LR / PEG) 的底层依据.

---

## 一、正则语言的形式化

记 $\cup$ 是并, $\cdot$ 是连接, $^*$ 是 Kleene 闭包 ($L^* = \{x_1 \cdot x_2 \cdots x_k \mid k \geq 0, x_i \in L\}$).

**归纳定义正则表达式 (over $\Sigma$)**:

1. $\emptyset$ 与 $\{\epsilon\}$ 是正则.
2. 单字符 $a \in \Sigma$ 的 $\{a\}$ 是正则.
3. 若 $R, S$ 正则, $R \cup S$, $R S$, $R^*$ 正则.
4. 仅由 1-3 出.

记集合 $\mathcal{R}(\Sigma)$. 形式化闭包集正是"正则语言".

### 1.1 三种语言的等价 (Kleene 定理)

$$ \text{正则表达式} \;\stackrel{\text{Thompson}}{\longrightarrow}\; \varepsilon\text{-NFA} \;\stackrel{\text{子集构造}}{\longrightarrow}\; \text{DFA} \;\stackrel{\text{state elimination}}{\longrightarrow}\; \text{正则表达式} $$

证 $\varepsilon$-NFA $\to$ DFA 见上章; DFA $\to$ regex 用 **state elimination**: 把 DFA 转成带 `regex` 的 GNFA, 一个状态一个状态消去, 最后剩 start → accept 一边, 弧上即答案.

工程直接收益: **awk pattern 是 DFA-able**; **Backreference** (PCRE 的 `\1`) 让语言超出 Type-3 (e.g. `(a+)\1` 描等长 a 串拼接, 实质是 $\{a^n a^n\}$), 这就是为什么 PCRE 退回 backtracking + 无法 DFA.

> [!NOTE]
> 这点常被工程师误解. Go `regexp` 故意不支持 backreference, 因为加了它就再也不能用 NFA 编译. 西工大 Snid、Rust `regex` 同理.

---

## 二、闭包性质

正则语言对常见运算**全闭合**:

| 运算 | 闭合性 |
|------|--------|
| 并 $L_1 \cup L_2$ | ✓ |
| 交 $L_1 \cap L_2$ | ✓ (跑两个 DFA 同步) |
| 补 $\overline{L}$ | ✓ (终态/非终态对调) |
| 连接 $L_1 L_2$ | ✓ (ε-NFA 串接) |
| Kleene 闭包 $L^*$ | ✓ |
| 同态像 $h(L)$ | ✓ |
| 逆同态 $h^{-1}(L)$ | ✓ |
| 差 $L_1 - L_2$ | ✓ |

**关键反例**: CFL 不闭补——CFL 的补不一定是 CFL (证明依赖 pumping lemma/范式). 这是分析 parser 缺陷时的常见红 herring.

---

## 三、Pumping Lemma (泵引理)

### 3.1 直觉

正则语言本质"无远距离结构": 长串必有内段可反复 *pump* (重复任意次仍属语言), 因为 DFA 状态有限, 长串过程中必复读某状态 → 形成循环.

### 3.2 形式

若 $L$ 正则, 则 ∃ pumping length $p \geq 1$ 使任意 $w \in L, |w| \geq p$ 可拆 $w = xyz$ 满足:

1. $|xy| \leq p$
2. $|y| \geq 1$
3. ∀ $i \geq 0$: $xy^i z \in L$

### 3.3 反证流程

证 $L = \{a^n b^n \mid n \geq 0\}$ 非正则:

1. 假设 $L$ 正则, pump length $p$.
2. 取 $w = a^p b^p, |w| = 2p \geq p$.
3. 拆 $w = xyz$. 由 $|xy| \leq p$, $xy$ 内全是 a, 即 $y = a^k, k \geq 1$.
4. 取 $i = 0$, $xy^0 z = xz = a^{p-k} b^p$ 不属 $L$.
5. 矛盾. $\square$

→ 因此 $L$ 非正则; DFA 跟不住"还剩多少 a 要配多少 b"——必须用栈 (PDA).

### 3.4 局限: pumping lemma 非充分

**反例语言**: $L = \{uwv \mid u, v, w \in \{a, b\}^*, |w| \text{ 不是素数}\}$. 它满足 pumping lemma 但实际**非正则**. 验证跳过, 详见 Sipser 第 1.4 节练习.

实践上就用 Myhill-Nerode 给充要.

---

## 四、Myhill-Nerode: 充要条件

### 4.1 引理

定义 $L$ 上等价关系 $\equiv_L$:
$$ x \equiv_L y \iff \forall z: (xz \in L) \Leftrightarrow (yz \in L). $$

**定理** (Myhill-Nerode): $L$ 正则 iff $\equiv_L$ 的等价类数有限, 此数为最小 DFA 状态数.

### 4.2 用 pump lemma 也卡的例子

证 $\{ a^n b^n\}$ 非正则: $x_i = a^i$ for $i = 0, 1, 2, ...$, []),
- $x_i$ 与 $x_j$ ($i \neq j$) 不等价, 因为以 $z = b^i$ 接续: $x_i z = a^i b^i \in L$, $x_j z = a^j b^i \notin L$.
- 故等价类无限 → 非正则. 直接.

### 4.3 最小 DFA 上界

等价类 $\emptyset, [a], [a^2], \ldots$ 互不相等, 最小 DFA 状态数 = 类数 = $\infty$, 因此非正则.

### 4.4 工程示例题: 判断 $L = \{xyy^R x^R \mid x, y \in \{a,b\}^*\}$ 是否正则

(其中 $s^R$ 表示串反转) 答案: **正则** —— 因为 $L$ 其实 = $\Sigma^*$ 全体串都满足 (取 $x = \epsilon$). 这种"形而上学难, 实则平凡"的题靠 Myhill-Nerode 数类一下就看清.

---

## 五、Brush-up: 速查反证法清单

| 要证非正则 | 工具 | 关键构造 |
|-----------|------|----------|
| $a^n b^n$ | pumping (取 $i=0$) | pump a |
| $a^n b^n c^n$ | pumping (取 $i=2$) | pump b → 一类增多 |
| $\{w \mid \text{含 0/1 数相等}\}$ | Myhill-Nerode | $x_i = 0^i$ |
| 回文 $\{w w^R\}$ | pumping (取 $i=2$) | pump 中段破坏回文 |
| $\{a^{p^k} \mid k \geq 1\}$ | Myhill-Nerode | 素数无关 → pump 都失败 |
| $\{a^n \mid n \text{ 完全平方}\}$ | pumping (取 $i=2$) | $p^2 \to 2p^2$ 不是平方 |
| $\{a^n b^m, n \neq m\}$ | DFA 补 + pumping 反证 | $L$ 非正则 → 补 $L$ 非正则 |
| $\{w \mid \exists k: w = a^k b^k\}$ | 证伪 | 实际是 $a^* b^*$ ✓ 正则 |

最后一项提醒: **"含某性质"的"是否存在 k"和"相等" 等价性极强**, 不要急着用 lemma. 先想清楚 $L$ 是不是合于"两串是否相等"——平等性是 pumping 极不友好的 a 类.

---

## 六、与其他章节的桥梁

- **第三章 [CFG/PDA]**: $a^n b^n$ 需要 PDA = CFG 接受, 进入 Type-2 语言层级;
- **第五章 [不可判定]**: Post Correspondence Problem 用 CFG 类比不可判定;
- **第七部分 [系统设计]** 的"为什么不能穷举所有可能入手路径" 跟 pumping lemma "DFA 必复读某状态" 的同构——资源有限自然形成循环.

---

下一节 → [下推自动机 (PDA) 与上下文无关文法 (CFG)](cfg-pda.md)
