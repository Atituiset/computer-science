# 3. 下推自动机 (PDA) 与上下文无关文法 (CFG)

## TL;DR

正则语言表达力不够——它记不住"已经看到几个 `a`"以匹配同等数量的 `b`。给 DFA 加一个**栈 (stack)** 作为无界工作内存, 得到 **PDA**; 对应的**文法**类比叫 **CFG (Context-Free Grammar)**。两者语言等级完全等价 (Chomsky 层级 Type-2), 这是**编译器 parser 理论**的全部基础——LL/LR/LALR/Earley/CYK 无非是为不同 CFG 子类找高效算法。读完本章, 你能直接读得下第五部分编译原理 parser 一节不再绕。

---

## 一、CFG 形式定义

四元组 $G = (V, \Sigma, R, S)$:

- $V$: 非终结符有限集 (变量).
- $\Sigma$: 终结符有限集 (字母表) —— $V \cap \Sigma = \emptyset$.
- $R$: 产生式集, 每条形如 $A \to \alpha$, $A \in V$, $\alpha \in (V \cup \Sigma)^*$.
- $S \in V$: 起始非终结符.

派生 (derivation): $\alpha A \beta \Rightarrow \alpha \gamma \beta$ 当 $A \to \gamma \in R$. $\Rightarrow^*$ 是其自反传递闭包. **语言** $L(G) = \{w \in \Sigma^* \mid S \Rightarrow^* w\}$.

### 1.1 例子: $a^n b^n$

$$G = (\{S\}, \{a, b\}, \{S \to a S b \mid \epsilon\}, S)$$

派生 $a^2 b^2$: $S \Rightarrow aSb \Rightarrow aaSbb \Rightarrow aabb$. 直观: $S$ 不停在被压在外环的 "a...b" 之中; 最后退化为 $\epsilon$ 收尾. 栈隐式存在: 每派生一条产生式右侧, "中心" S 像 stack 顶, 等右边终结符 `b` 弹出.

### 1.2 派生树 (Parse Tree)

每条产生式 $A \to \alpha$ 对应一棵子树 $A$ 作为根、$\alpha$ 字符从左到右作为子. 叶节点终结符顺序即派生串. **歧义 (ambiguity)**: 同串两种 parse tree → 不能确定 AST, 语义难定.

> [!WARNING]
> 文法的歧义是**文法性质**, 不是语言性质. 一些语言"先天歧义"——任一 CFG 都歧义. 如 $L = \{a^i b^j c^k \mid i = j \text{ 或 } j = k\}$. 给 L 已知先天歧义, 唯一的办法是过 PDA 之后再加一层语义检查.

### 1.3 LL vs LR

派生顺序影响 parser 实现:

- **最左派生** (leftmost): 每步替换最左非终结符 → 对应 LL parser (自顶向下).
- **最右派生** (rightmost): 每步替换最右非终结符 → 对应 LR parser (自底向上, reduce).

LL(1) = 用 1 个 lookahead 选产生式; LR(1) = 用 1 个 lookahead 选 reduce; LR ⊋ LL (LR 表达力大得多), 但 LR(1) 状态表大; LALR(1) 合并状态、状态数小, yacc/bison 走 LALR.

---

## 二、PDA 形式定义

七元组 $M = (Q, \Sigma, \Gamma, \delta, q_0, Z_0, F)$:

- $Q$: 有限状态集.
- $\Sigma$: 输入字母表.
- $\Gamma$: 栈字母表 (含初始栈底符号 $Z_0$).
- $\delta: Q \times (\Sigma \cup \{\epsilon\}) \times \Gamma \to 2^{Q \times \Gamma^*}$: 转移函数. 当前状态, 当前输入(或 ε), 栈顶 —— 推出新状态 + 要 push 入的串 (pop 栈顶再 push).
- $q_0$: 初始状态. $Z_0$: 初始栈符号. $F$: 接受状态集.

### 2.1 两种接受方式

1. **Final state**: 输入读完 + 当前状态 ∈ F.
2. **Empty stack**: 输入读完 + 栈空.

二者表达力等价 (可互转). 工程多走 final-state 形式 因为 检查容易, dump 时栈可保留以 debug.

### 2.2 例子: 接受 $a^n b^n$

```
Q = {q0, q1, q2}, Σ = {a,b}, Γ = {Z0, A}, q0 = q0, Z0 = Z0, F = {q2}

δ:
    (q0, a, Z0) → (q0, A Z0)        # 第一个 a, push A 不变状态
    (q0, a, A)  → (q0, A A)         # 后续 a, push A
    (q0, b, A)  → (q1, ε)           # 看到 b, pop A, 进 q1
    (q1, b, A)  → (q1, ε)           # 继续配 b, pop A
    (q1, ε, Z0) → (q2, ε)           # 输入完, 栈回 Z0, 进 q2 接受
```

栈在这里就是把"还没配对的 a 数"记下来.

### 2.3 PDA 模拟器 (Python)

```python
from typing import Set, Dict, Tuple, List, Optional

class PDA:
    def __init__(self, Q, Sigma, Gamma, delta, q0, Z0, F):
        self.delta = delta   # dict[(state, input or '', stack_top)] -> set of (state, push_str)
        self.q0, self.Z0, self.F = q0, Z0, F
        self.Sigma, self.Gamma, self.Q = Sigma, Gamma, Q

    def accepts(self, w: str) -> bool:
        # 当前 config 集合: (state, input_pos, stack as tuple bottom→top)
        start = (self.q0, 0, (self.Z0,))
        frontier = {start}
        # 限制总步数防爆 (PDA 半可解)
        for step in range(10000):
            nxt = set()
            for (q, i, stack) in frontier:
                if i == len(w):
                    # ε 转移
                    if stack:
                        top = stack[-1]
                        for (r, push) in self.delta.get((q, '', top), set()):
                            nxt.add((r, i, stack[:-1] + tuple(push)))
                    if q in self.F:
                        return True
                else:
                    ch = w[i]
                    if stack:
                        top = stack[-1]
                        for (r, push) in self.delta.get((q, ch, top), set()):
                            nxt.add((r, i + 1, stack[:-1] + tuple(push)))
                        for (r, push) in self.delta.get((q, '', top), set()):
                            nxt.add((r, i, stack[:-1] + tuple(push)))
            if not nxt or nxt <= frontier:
                break
            frontier = nxt
        return any((q in self.F and i == len(w)) for (q, i, s) in frontier)
```

PDA 模拟比 DFA 复杂——状态集理论上无限 (栈内容是无限信息), 所以更优雅的做法是直接转 CFG.

---

## 三、CFG ⇔ PDA 等价证明

### 3.1 CFG → PDA (顶部展开)

构造一个 PDA 用栈装载"待派生串"; 栈顶若是非终结符就展开某个产生式, 若是终结符就匹配输入消费.

具体:
- 状态只一两个 (q_loop), 实质在栈上工作.
- 转移: 读 ε 时若栈顶 = $A$, 任选 $A \to \alpha$ 替换栈顶为 $\alpha$ 反序 (使栈顶出 $\alpha$ 首字符).
- 读字符 c 时, 若栈顶 = c, 匹配退栈.

接受: 输入读完 + 栈空. 这个构造用 ε-NFA 风格极简, 但 NFA 系列 size 巨大.

### 3.2 PDA → CFG (config 转非终结符)

技巧: 引入集合 $A_{pq}$ 表示 "从状态 p 空栈到状态 q 空栈的串集". 递归方程:

- $A_{pq} \supseteq A_{pr} A_{rq}$  (走两段)
- $A_{pq} \supseteq a A_{rs} b$  (一步 push a + 内部一段 + pop b)
- $A_{pp} \supseteq \epsilon$

把这些方程变 productions, $S \to A_{q_0, f}$ for $f \in F$, 完成 CFG 构造. 证明细节见 Sipser 引理 2.20.

---

## 四、CFG Pumping Lemma

类似正则, CFL 也有 pumping lemma, 但**两段**而非一段:

**定理**: CFL $L$ 存在 $p$ 使任意 $w \in L, |w| \geq p$ 可拆 $w = uvxyz$ 满足:

1. $|vxy| \leq p$
2. $|vy| \geq 1$
3. ∀ $i \geq 0$: $uv^i x y^i z \in L$.

直觉: 派生树的深层节点 (高度 > $h$ 的高度) 必复读同一非终结符; 找出对应两段可 pump.

### 4.1 经典用法: $L = \{a^n b^n c^n\}$ 非 CFL

设 pump length $p$. 取 $w = a^p b^p c^p$. $|vxy| \leq p$, 故 $vxy$ 只能覆盖两类字符 (要么 ab 段, 要么 bc 段). 设 $vy$ 不含 c, 则 pump $i = 2$ 多 a/b 不多 c → 数失去平衡. 类似若 $vy$ 只含 b 段也会失衡 a-c. 任何 split 都矛盾.

→ $L$ 非 CFL, 必须 TM.

### 4.2 反例: pump lemma 不充分

存在非 CFL 也满足 pump lemma (例如 Sipser 练习给的 $L = \{a^i b^j c^k \mid i = j \text{ 或 } j = k\}$ 满足 Lemma 但**实际是 CFL**——经典反白).

工程实践: 用 Ogden's lemma 给更强条件——指定"区分位"而非全覆盖.

---

## 五、CFL 闭包性质

| 运算 | CFL 闭合? |
|------|----------|
| 并 | ✓ (新初始 $S \to S_1 \mid S_2$) |
| 连接 | ✓ |
| Kleene 闭包 | ✓ |
| 同态像 | ✓ |
| 逆同态 | ✓ |
| 与正则交 | ✓ (跑 PDA + DFA 同步) |
| **交** | ✗ ($a^n b^n c^n$ = $a^n b^n$ ∩ $b^n c^n$ 都是 CFL, 交不是) |
| **补** | ✗ (补非闭合 ⇒ 交非闭合同结果) |

**关键反差**: 与正则语言交仍 CFL——parser 把 token-level DFA (lexer) 跟 CFG 协同 (parser 只接受 lexer 输出, 这正是 lexer+parser 的分层组合, 第五部分 compilers 已讲).

---

## 六、DCFL (Deterministic CFL) 子类

NPDA vs DPDA: NPDA 比 DPDA 表达力强; DPDA 接受的 CFL 子类叫 **DCFL**.

性质: DCFL **闭合于补**, NPDA 不是. 这个看似理论细节, 工程极重要——

定理: LR(k) 文法 ⇔ DCFL 的子类; LL(k) ⊊ LR(k) ⊊ DCFL.

→ 编译器能做的语法分析子能力排序:

- **LL(1)**: 适合手写 parser, 速度快, 但表达力最弱 (无左递归, 1 token lookahead).
- **LR(1)**: 表达力=DCFL, 表状态巨大, 工程少用.
- **LALR(1)**: 合并 LR(1) 状态, 表小, bison/yacc 走它.
- **SLR(1)**: 简化版 LR(0) + follow 集, 较弱.
- **PEG (Parsing Expression Grammar)**: 引入有序选择 + lookahead + 痕迹 predicate, 表达力 ⊋ 任意 CFG (与超 CFL 重叠), 但定义即算法 (parser-combinator).
- **Earley**: 任意 CFG, O(n³) worst-case, O(n²) for 任意歧义 CFG, O(n) for 几乎所有 LR(k). 适合需要随时改文法的 IDE 场景.

---

## 七、CYK 算法: 任意 CFG 的 O(n³) 解析

把 CFG 转 Chomsky Normal Form (CNF): 每条 production 形如 $A \to BC$ 或 $A \to a$ (二分). 然后 DP:

`dp[i][j] = A`: 子串 $w[i..j]$ 可由 A 派生.

```python
def cyk_parse(G, w):
    # G: dict rules: {'S': [['A', 'B'], ['a']], ...}, w: string
    n = len(w)
    # T[i][j] = set of nonterminals that derive w[i:j+1]
    T = [[set() for _ in range(n)] for _ in range(n)]
    for i in range(n):
        for A, prods in G.items():
            for p in prods:
                if len(p) == 1 and p[0] == w[i]:
                    T[i][i].add(A)
    for length in range(2, n + 1):           # 子串长度
        for i in range(0, n - length + 1):   # 起点
            j = i + length - 1
            for k in range(i, j):
                for A, prods in G.items():
                    for p in prods:
                        if len(p) == 2 and p[0] in T[i][k] and p[1] in T[k+1][j]:
                            T[i][j].add(A)
    return 'S' in T[0][n-1]
```

复杂度 O(|G| · n³). 实践中字法 N 较小 (代码长度 < 10000 行) 仍能跑, 但编译主流走 LALR(1) 把 O(n) 拿到手——CYK 留给 IDE 增量编辑与自然语言 parsing.

### 7.1 TypeScript 实现

```ts
type Rules = Record<string, string[][]>;

export function cyk(G: Rules, w: string): boolean {
  const n = w.length;
  const T: Set<string>[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => new Set())
  );
  for (let i = 0; i < n; i++) {
    for (const [A, prods] of Object.entries(G)) {
      for (const p of prods) {
        if (p.length === 1 && p[0] === w[i]) T[i][i].add(A);
      }
    }
  }
  for (let len = 2; len <= n; len++) {
    for (let i = 0; i + len - 1 < n; i++) {
      const j = i + len - 1;
      for (let k = i; k < j; k++) {
        for (const [A, prods] of Object.entries(G)) {
          for (const p of prods) {
            if (p.length === 2 && T[i][k].has(p[0]) && T[k + 1][j].has(p[1])) T[i][j].add(A);
          }
        }
      }
    }
  }
  return n === 0 ? T[0]?.[0]?.has('S') ?? false : T[0][n - 1].has('S');
}
```

---

## 八、桥梁: 解析器就是受限 PDA

第五部分 compilers/parser 用 LL/LR 的本质, 是**对 CFG 加 lookahead 约束让其可被确定性 PDA 处理**. 一旦 CFG 不是 LR(k), 编译器就要么改写文法, 要么走 GLR/Earley 退回 NPDA + 全分支.

实战经验:
- JSON 是 LL(2)-able, 主流手写 parser.
- Java/TypeScript 是 LALR(1)-able 但有 reserved word 处理高复杂度, 倾向手写 Pratt + 化 recursive descent (Babel parser).
- C++ 文法先天歧义, 工业必走 GLR 或打 multi-pass.
- Python 缩进敏感, lexer 把 INDENT/DEDENT 当 token, 总体 LL(1) OK.

---

下一节 → [图灵机](turing-machine.md)
