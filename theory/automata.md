# 1. 自动机：DFA / NFA / ε-NFA / 子集构造 / 最小化

## TL;DR

正则语言的"计算模型"是**有限自动机 (Finite Automaton)**——一种只有有限个状态、读一个字符就走一步的机器. 三种等价形式:

1. **DFA (Deterministic Finite Automaton)** —— 每状态每输入有唯一后继.
2. **NFA (Nondeterministic Finite Automaton)** —— 每状态每输入可有 0~N 个后继, 接受只要某一路径 reaches 终态.
3. **ε-NFA** —— 在 NFA 基础上允许 ε-transfer (无输入也走).

**三者等价** (都识别正则语言), 但工程上 ε-NFA 最易手写、DFA 执行最快. 子集构造把 NFA 编译成 DFA; Hopcroft 算法把 DFA 压到最小. 这一进一出就是 grep / sed / regex JIT 的内部.

---

## 一、DFA 的形式化定义

### 1.1 五元组

DFA 是五元组 $M = (Q, \Sigma, \delta, q_0, F)$:

- $Q$: 有限状态集.
- $\Sigma$: 有限输入字母表.
- $\delta: Q \times \Sigma \to Q$: 转移函数 (完全、确定性).
- $q_0 \in Q$: 初始状态.
- $F \subseteq Q$: 终止/接受状态集.

**接受**: $\delta^*(q_0, w)$ 跑完输入 $w$ 后落在 $F$ 内即接受 $w$, 记 $w \in L(M)$.

### 1.2 例子: 接受"以 0 结尾的二进制串"

```
States Q = {A, B}, Σ = {0,1}, q0 = A, F = {B}
δ:
    A —0→ B      (读到 0, 进 B 表示"刚才读到 0")
    A —1→ A      (读到 1, 留 A)
    B —0→ B
    B —1→ A
```

```
Input: 1010
  A --1--> A --0--> B --1--> A --0--> B  ∈ F → accept
Input: 1011
  A --1--> A --0--> B --1--> A --0?... 错, 末位是 1 → A ∉ F → reject
```

### 1.3 Python 实现

```python
from typing import Dict, Set, Tuple

class DFA:
    def __init__(self, Q, Sigma, delta, q0, F):
        self.Q = Q
        self.Sigma = Sigma
        self.delta = delta        # dict[(state, char)] -> state
        self.q0 = q0
        self.F = F
    
    def accepts(self, w: str) -> bool:
        q = self.q0
        for ch in w:
            if ch not in self.Sigma:
                raise ValueError(f"alphabet mismatch: {ch!r}")
            q = self.delta[(q, ch)]
        return q in self.F

# 以 '0' 结尾
M = DFA(
    Q={"A", "B"}, Sigma={"0", "1"}, q0="A", F={"B"},
    delta={("A","0"):"B", ("A","1"):"A", ("B","0"):"B", ("B","1"):"A"},
)

assert M.accepts("1010") and not M.accepts("1011") and M.accepts("0")
```

### 1.4 TypeScript 实现

```ts
export type DFA = {
  Q: Set<string>;
  Sigma: Set<string>;
  delta: Map<string, string>;   // key = `${q}|${ch}`
  q0: string;
  F: Set<string>;
};

export function runDFA(m: DFA, w: string): boolean {
  let q = m.q0;
  for (const ch of w) {
    if (!m.Sigma.has(ch)) throw new Error(`alphabet mismatch: ${ch}`);
    const nx = m.delta.get(`${q}|${ch}`);
    if (nx === undefined) throw new Error(`no transition`);
    q = nx;
  }
  return m.F.has(q);
}
```

> [!NOTE]
> DFA 是"流式"算法: 接收每字符 O(1), 总 O(n), 不存历史. 这正是 `grep` 高吞量的根本来源——比 backtracking regex engine 快 1-3 个数量级.

---

## 二、NFA：非确定性带来的便利

### 2.1 直觉

NFA 是"幻觉中的并行"——一次走多条路, 只要**任何一条** reach 接受状态就接受. 这不是物理并行, 是数学抽象: 我们用"成像"维护**当前状态集**.

形式化同样五元组, 唯一差别:
$$ \delta: Q \times \Sigma \to 2^Q $$
即转移结果是个状态集.

### 2.2 例子: 接受"以 ab 结尾"的所有串

```
       a        b
(0)----→(1)----→((2))   ← 接受

但更聪明: 用 0,1 的自循环 + 一条 a 弧线直达
```

NFA 三个状态即可, 而且 ε-free:
```
Q = {S, A, F}, Σ = {a, b}, q0 = S, F = {F}
    S --a--> S, S --a--> A    (读 a 时既留在 S 也走到 A)
    A --b--> F
    F --a,b--> F
```

接受 "ab": `{S} --a--> {S,A} --b--> {F,A,S}` ∃ F → 接受.

### 2.3 NFA 接受的定义

$w = a_1 a_2 \ldots a_n$ 被 NFA 接受 iff 存在状态序列 $q_0 \to q_1 \to \ldots \to q_n$ 使得 $q_i \in \delta(q_{i-1}, a_i)$ 且 $q_n \in F$.

注意"**存在**": NFA 验证比 DFA 弱——它说"有价值", DFA 说"一定走对路".

### 2.4 NFA 的实现: 维护状态"集合"

```python
class NFA:
    def __init__(self, Q, Sigma, delta, q0, F):
        self.delta = delta         # dict[(state, char)] -> set of states
        self.q0, self.F = q0, F
        self.Sigma = Sigma
        self.Q = Q

    def accepts(self, w: str) -> bool:
        current = {self.q0}
        for ch in w:
            nxt = set()
            for q in current:
                nxt |= self.delta.get((q, ch), set())
            if not nxt:
                return False
            current = nxt
        return bool(current & self.F)
```

| 操作 | DFA | NFA |
|------|-----|-----|
| 每个 char | O(1) lookup | O(\|current\|) scans, 状态集大小 ≤ \|Q\| |
| 内存 | O(\|Q\|) | O(\|Q\|) 仅集合 |
| 实现简洁 | 中 | 高 |
| 工程表达力 | 中 | 高 |

NFA 方法在工程上**更易手写、但每步慢 O(|Q|)**; DFA 方法**更难手写、但每步 O(1)** —— 这正是子集构造法存在的原因.

---

## 三、ε-NFA 与 ε-closure

### 3.1 ε 转移

允许 $\delta: Q \times (\Sigma \cup \{\varepsilon\}) \to 2^Q$, 即不读字符就能跳状态. 这在构造 OR / regex 编译时极其方便.

### 3.2 ε-closure($S$)

给定状态集 $S$, $\varepsilon\text{-closure}(S)$ = 从 $S$ 中任一状态沿 ε 弧线能 reach 的所有状态 (含 $S$ 自身).

```python
def epsilon_closure(self, S: set) -> set:
    stack, seen = list(S), set(S)
    while stack:
        q = stack.pop()
        for r in self.delta.get((q, ''), set()):
            if r not in seen:
                seen.add(r); stack.append(r)
    return seen
```

### 3.3 接受串

主流 ε-NFA 的接受算法:
```
S0 = epsilon_closure({q0})
for ch in w:
    S' = ∪_{q ∈ S} δ(q, ch)
    S = epsilon_closure(S')
return S ∩ F ≠ ∅
```

---

## 四、Thompson 构造法: regex → ε-NFA

1968 Ken Thompson (Unix 创始人之一) 在 CTSS 上写 ed 编辑器, 把正则编译成 ε-NFA, 至今仍是 `grep / sed / awk` 的核心算法. 第一部分 dsa/topics/string 已介绍, 复习:

- 对原子 `c`: 两状态 + 一条 c 弧.
- 对 `e1 | e2`: 新 start, ε 走 e1 / ε 走 e2.
- 对 `e1 e2`: 串接.
- 对 `e*`: 新 start, ε→e 头, e 尾 ε→新终, 新 start ε→新终.

每条 regex 长度 n 至多 2n 个 ε-NFA 状态. 这是 PCRE backtracking engine 跟"理论上严格"两条路线的分界.

> [!WARNING]
> Python `re` 和 JS RegExp 内部走 **backtracking** 不是 DFA. 对 `^(a+)+$` 这类病态正则会**指数级爆栈**, 业界叫 **ReDoS**. Go 标准库 `regexp` 用 Russell Cox 实现, 保证 NFA 线性时间, 但放弃了 backreference (因为 backreference 让语言超出正则, 不再能用 DFA 处理).

---

## 五、子集构造: NFA → DFA

### 5.1 算法骨架

把 ε-NFA 的"状态集"显式编号成 DFA 状态. 每 DFA 状态对应 NFA 状态的一个子集 $S \subseteq Q$.

```python
def nfa_to_dfa(nfa) -> DFA:
    start = frozenset(nfa.epsilon_closure({nfa.q0}))
    dfa_states = {start}
    dfa_delta = {}
    queue = [start]
    while queue:
        S = queue.pop()
        for ch in nfa.Sigma:
            nxt = set()
            for q in S:
                nxt |= nfa.delta.get((q, ch), set())
            nxt_frozen = frozenset(nfa.epsilon_closure(nxt))
            if nxt_frozen not in dfa_states:
                dfa_states.add(nxt_frozen)
                queue.append(nxt_frozen)
            dfa_delta[(S, ch)] = nxt_frozen
    F_dfa = {s for s in dfa_states if s & nfa.F}
    return DFA(Q=dfa_states, Sigma=nfa.Sigma, delta=dfa_delta,
               q0=start, F=F_dfa)
```

### 5.2 复杂度

最坏 |DFA 状态| = $2^{|Q_{\text{NFA}}|}$. 这个上界紧: 接受 "倒数第 $k$ 个字符是 a" 串的语言, ε-NFA k+1 状态, 子集构造爆出 $2^k$ 状态 DFA. 这也是为什么 grep 不直接编译成 DFA 加载到内存——内存吃不起.

### 5.3 工程版: lazy + cache

Go `regexp` & RE2 实现 lazy 子集构造: 边跑边缓存 (state-set, ch)→state-set, 第一次 miss 则构造 #. 不预先编译所有状态, 把最坏 2^n 推迟到真正见到很多输入时——大多数 regex 实际只用很少状态.

---

## 六、DFA 最小化: Hopcroft / Moore

### 6.1 Myhill-Nerode 等价

两个状态 $p, q$ 等价 iff 对任意后续 $w$: $\delta^*(p, w) \in F \iff \delta^*(q, w) \in F$.

最小 DFA 的状态数 = Myhill-Nerode 等价类数. 这是**充要**条件——pumping lemma 只能给"非正则"的下界, Myhill-Nerode 给充要.

### 6.2 Hopcroft 算法

$O(|Q| \cdot |\Sigma| \cdot \log |Q|)$, 比朴素 $O(|Q|^2)$ 快:

```python
def hopcroft_minimize(dfa) -> DFA:
    # 初始划分: 终态 vs 非终态
    P = [dfa.F, dfa.Q - dfa.F]
    P = [s for s in P if s]
    while True:
        P2 = []
        changed = False
        for group in P:
            # 按"对每个 ch 后继在哪个 group"做细分
            subgroups = {}
            for q in group:
                sig = tuple(next_group_of(dfa.delta[(q, ch)], P) for ch in dfa.Sigma)
                subgroups.setdefault(sig, set()).add(q)
            if len(subgroups) > 1:
                changed = True
            P2.extend(subgroups.values())
        P = P2
        if not changed:
            break
    # 现在每个 P[i] 合并为一个 DFA 状态, 重建 delta/Q/F
    ...
```

工程意义: 每跑一次 regex-fuse 把状态数砍一半, 内存 cache 命中明显改善.

### 6.3 真实版: Brzozowski's derivative

对 NFA 倒过排序 + 子集构造**一步到位**给最小 DFA——理论极美但实践不如 Hopcroft 稳.

---

## 七、状态复杂度下界: Myhill-Nerode

为证 "L 不是正则", 用 pumping lemma 常被"counter example"反将. Myhill-Nerode 给充要, 强:

**定理**: $L$ 正则 iff Myhill-Nerode 等价类有限. 类数 = 最小 DFA 状态数.

**等价关系** $\equiv_L$: $x \equiv_L y$ iff $\forall z: xz \in L \Leftrightarrow yz \in L$.

证 "L = {a^n b^n}" 非正则:
- 取 $x_i = a^i$ for $i \geq 0$.
- 对 $i \neq j$, 取 $z = b^i$, $x_i z = a^i b^i \in L$, $x_j z = a^j b^i \notin L$.
- 故所有 $x_i$ 互不等价 → 类数无限 → 非正则.

---

## 八、桥梁: 接下来的章节

- **正则表达式 ⇔ DFA**: Kleene 定理证明正则表达式 = DFA 接受的语言.
- **regex 比 DFA 强吗?**: PCRE 等支持 backreference, 让语言超出 Type-3, 需 PDA. 下一章会展开.
- **泵引理 (Pumping Lemma)**: 给非正则的**必要非充分**反证工具, 见下一章 regular.md.

---

> **下一节 → [正则语言与泵引理](regular.md)**
