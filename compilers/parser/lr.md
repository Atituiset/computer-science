# LR / LALR / SLR / yacc / bison

## TL;DR

LR 系列是**表驱动的自底向上分析器**：从左到右扫描（Left-to-right），产出最右推导的逆（Rightmost derivation in reverse）。核心数据结构是两张表——ACTION（状态 × 终结符 → 移进/归约/接受）和 GOTO（状态 × 非终结符 → 状态）。LR(0) / SLR(1) / LALR(1) / LR(1) 的全部差异只在**归约时用什么信息做 lookahead 判断**与**状态是否按 lookahead 合并**；yacc/bison 生成的是 LALR(1)，用优先级/结合性声明手工消解冲突，实在不行还有 `%glr` 兜底并行探索。

```text
工程问题: 手写解析器处理大语法会失控
  └─ 为什么? 上下文无关语法的决策点互相纠缠, 人脑跟踪不了几百个产生式的 lookahead
       └─ 原理: 把"决策点"物化成有限状态的转移 —— 项目集构造出 DFA
            └─ LR(0): 只看栈顶状态, 太弱
                 ├─ SLR: 借 FOLLOW(A) 过滤归约 —— 一行改进
                 ├─ LALR(1): 精确 lookahead 但合并同核状态 —— yacc/bison 的选择
                 └─ LR(1): 不合并, 状态爆炸但能力最强 —— 理论上限
```

---

## 一、LR 分析算法本身

移进-归约（shift-reduce）框架：

```text
stack:  s0 s1 ... sk              (状态栈, 附带符号栈)
input:  a_k+1 ... $               (剩余输入)

action[sk, a]:
    shift s'   → 压入 s'
    reduce A→α → 弹出 |α| 个状态, 露出 s_j,
                 再压 goto[sj, A]        (符号栈同步弹出 α 压入 A)
    accept     → 解析成功
    error      → 报错恢复
```

关键观察：**栈里存状态而不是文法符号**，因为状态编码了"到目前为止已识别出的句柄前缀"的全部信息——这就是 LR 比 LL 强的根源：它已经看见了整个左文法的上下文。

## 二、LR(0) 项目集规范族

项目（item）= 在产生式右部加一个位置标记：`A → α · β`。

- **closure(I)**: 若 `A → α · Bβ ∈ I`，则把所有 `B → · γ` 加入 I，直到不动点。
- **goto(I, X)**: `{ A → αX · β | A → α · Xβ ∈ I }` 再求 closure。
- 从 `S' → · S` 出发，对全体非终结符/终结符反复求 goto，得到的项目集就是 DFA 的状态。

经典算术文法跑一遍：

```text
(0) S' → E        (3) T → T * F
(1) E → E + T     (4) F → ( E )
(2) E → T         (5) F → id
    T → ( E ) | id  即 T → (E) 与 T → id
```

状态 I1 含 `E → E · + T` 和 `S' → E ·`——在输入 `+` 时移进、在 `$` 时接受，不冲突。这个文法是 LR(0) 的：**不需要任何 lookahead 就无歧义地决策**。真实语言很少这么幸运，于是有了下面三个层级。

## 三、SLR / LALR / LR(1)：只差"什么时候敢归约"

归约 `A → α` 的时机判断是三者的分水岭：

| 方法 | 归约条件 | 状态数 | 冲突倾向 | 工程地位 |
|------|----------|--------|----------|----------|
| LR(0) | 无条件归约 | 最小 | 大量 shift-reduce | 教学基线 |
| SLR(1) | lookahead ∈ FOLLOW(A) | 同 LR(0) | 中等 | 几乎没人直接用 |
| LALR(1) | 精确 lookahead，但**同核状态合并** | 同 LR(0)/SLR | 可能引入 reduce-reduce | yacc/bison/IELR 前 |
| LR(1) | 精确 lookahead，不合并 | 可指数膨胀 | 几乎没有 | 理论上限、部分生成器 |

> [!NOTE]
> LALR 合并同核（core 相同、仅 lookahead 集不同）的 LR(1) 状态后，**永远不会新增 shift-reduce 冲突**（shift/goto 转移完全由 core 决定），只可能新增 reduce-reduce 冲突——这是理解 bison 行为的钥匙。

SLR 的弱点示例：`S → L = R | R`，`L → * R | id`，`R → L`。状态含 `S → L · = R` 与 `R → L ·`，遇 `=` 时 SLR 因 `= ∈ FOLLOW(R)` 而报 reduce-reduce；但任何以 `L` 开头且后面跟 `=` 的合法句子根本不会走 `R → L` 这条路——**FOLLOW(R) 是全局近似，太粗**。LR(1) 用精确 lookahead 区分两种局面，LALR 合并后此例仍保留区分（两状态 core 不同）。

## 四、bison / yacc 实战

```c
%{
#include <stdio.h>
%}

%union {
    int ival;
    char *sval;
}

%token <ival> NUMBER
%token <sval> IDENT

%type <ival> expr

%left '+' '-'
%left '*' '/'
%right UMINUS

%%

expr: expr '+' expr   { $$ = $1 + $3; }
    | expr '-' expr   { $$ = $1 - $3; }
    | expr '*' expr   { $$ = $1 * $3; }
    | expr '/' expr   { $$ = $1 / $3; }
    | '-' expr %prec UMINUS { $$ = -$2; }
    | NUMBER          { $$ = $1; }
    | '(' expr ')'    { $$ = $2; }
    ;
```

要点:

- `%union` 定义语义值类型 discriminant，`%token/%type` 给每个符号标注成员
- `%left %right` 按**声明顺序从低到高**定优先级，同时解决 shift-reduce 与结合性（`a-b-c` 解析为 `(a-b)-c`）
- `%prec UMINUS` 给规则借虚拟 token 的优先级——一元负号必须高于 `*`
- `$$ $1 $3` 直接访问语义栈；bison 默认输出 LALR(1)
- 出现 conflict 时 bison 默认"shift 优先"并继续，**务必看 `.output` 文件或开 `%define parse.error detailed` 排查**，默认静默是事故源

> [!WARNING]
> bison 对冲突的默认处理是"选 shift、报告一行 warning"。CI 里应加 `-Werror=conflicts-sr -Werror=conflicts-rr` 让带冲突的 grammar 直接编译失败，否则语法错误会被悄悄吞掉。

### 用 Python 从零构造 SLR 表并驱动解析

生成器的本质不过百余行——closure/goto/FIRST/FOLLOW/建表/驱动全链路：

```python
# 文法: E→E+T|T, T→T*F|F, F→(E)|id   (增广 S'→E)
G = {
    "S'": [["E"]],
    "E": [["E", "+", "T"], ["T"]],
    "T": [["T", "*", "F"], ["F"]],
    "F": [["(", "E", ")"], ["id"]],
}
NT = set(G)                      # 非终结符
TS = {"+", "*", "(", ")", "id", "$"}

def closure(items):
    out = set(items)
    changed = True
    while changed:
        changed = False
        for (A, rhs, dot) in list(out):
            if dot < len(rhs) and rhs[dot] in NT:
                for prod in G[rhs[dot]]:
                    if (rhs[dot], tuple(prod), 0) not in out:
                        out.add((rhs[dot], tuple(prod), 0)); changed = True
    return frozenset(out)

def goto(items, X):
    return closure({(A, tuple(rhs), d + 1) for (A, rhs, d) in items
                    if d < len(rhs) and rhs[d] == X})

start = closure({("S'", ("E",), 0)})
states, work, trans = [start], [start], {}
while work:                       # 子集构造
    I = work.pop()
    symbols = {rhs[d] for (A, rhs, d) in I if d < len(rhs)}
    for X in symbols:
        J = goto(I, X)
        if J not in states: states.append(J); work.append(J)
        trans[(states.index(I), X)] = states.index(J)

def first(symset):                # FIRST 集 (本例手写足够)
    f = {nt: set() for nt in NT}
    f["F"] |= {"(", "id"}; f["T"] |= f["F"]; f["E"] |= f["T"]
    return f

follow = {"S'": {"$"}, "E": {")", "+", "$"}, "T": {"+", ")", "*", "$"},
          "F": {"+", ")", "*", "$"}}          # 本例可直接推出

action = {}                       # SLR 表: 移进 + 按 FOLLOW 过滤的归约
for i, I in enumerate(states):
    for (A, rhs, d) in I:
        if d < len(rhs):
            a = rhs[d]
            assert (i, a) not in action or action[(i, a)][0] == "s"
            action[(i, a)] = ("s", trans[(i, a)])
        elif A != "S'":
            for a in follow[A]:
                if (i, a) in action: raise SystemExit(f"reduce-reduce at {i},{a}")
                action[(i, a)] = ("r", (A, len(rhs)))
        else:
            action[(i, "$")] = ("acc",)

def parse(tokens):                # 表驱动 LR 主循环
    stack, ip = [0], 0
    while True:
        st, a = stack[-1], tokens[ip]
        act = action.get((st, a))
        if act is None: raise SyntaxError(f"unexpected {a!r} at token #{ip}")
        if act[0] == "s":
            stack.append(act[1]); ip += 1
        elif act[0] == "r":
            A, n = act[1]
            for _ in range(n): stack.pop()
            stack.append(trans[(stack[-1], A)])
        else:
            return "accept"

print(parse("id * ( id + id ) $".split()))
```

Go 版驱动器（消费同样的表结构，展示运行时形态）：

```go
package main

import "fmt"

type action struct{ kind byte; num int } // 's'hift / 'r'educe / 'a'ccept

// actionTable/gotoTable 由上文构造过程离线生成后内联于此
var actionTable = map[[2]int]action{
	{0, 3}: {'s', 4}, {0, 2}: {'s', 5}, // ...完整表由生成脚本导出
}

var gotoTable = map[[2]int]int{
	{0, 1}: 8, // ...
}

func parse(tokens []string) bool {
	stack := []int{0}
	for ip := 0; ; {
		act, ok := actionTable[[2]int{stack[len(stack)-1], tokID[tokens[ip]]}]
		if !ok {
			return false // 报错恢复入口
		}
		switch act.kind {
		case 's':
			stack = append(stack, act.num); ip++
		case 'r':
			n := popCount[act.num] // 各产生式右部长度
			stack = stack[:len(stack)-n]
			stack = append(stack, gotoTable[[2]int{stack[len(stack)-1], lhsOf[act.num]}])
		case 'a':
			return true
		}
	}
}

var tokID = map[string]int{"(": 0, ")": 1, "*": 2, "+": 3, "id": 4, "$": 5}

func main() { fmt.Println(parse([]string{"id", "*", "(", "id", "+", "id", ")", "$"})) }
```

> [!TIP]
> 面试/实战口诀：**"SLR 看 FOLLOW，LALR 合同核，LR(1) 全展开"**。三者状态数关系：LALR = SLR = LR(0) ≤ LR(1)。

## 五、GLR：冲突的兜底方案

LALR(1) 处理不了的真正二义（不是文法写错，而是**语言本身就依赖后续信息才能裁决**）——典型如 C 的 typedef 歧义：`(T)*-1` 里 `T` 是类型还是变量，决定这是强制转换还是乘法，而答案要等符号表才能给出。做法有两条：

1. **lexer hack**: 词法阶段查询符号表，把 typedef 名吐成独立 token 类别（GCC 经典做法，简单但让词法依赖语义）。
2. **GLR（Generalized LR, Tomita）**: bison `%glr` 模式。解析器照常运行，遇到冲突时**分裂成多个并行栈同时探索所有分支**，分支汇合时共享后缀，出错或唯一存活时收敛。语法层不再需要预先消歧，把裁决推迟到语义阶段。

代价：冲突路径并存期间内存随歧义度增长；正常无冲突路径上 GLR 与 LALR 性能相同，所以可以只在个别规则上标 `%glr`。

## 六、产线观察

### 6.1 PostgreSQL：bison + re2c

SQL 语言的语法体量（数百条产生式）正是 LALR(1) + 优先级声明的甜点区。`gram.y` 配合词法器生成，靠大量优先级/结合性声明压住冲突。近年版本把词法从 flex 迁到 re2c：re2c 直接生成原生 switch 代码而非表解释循环，省一次内存间接寻址，词法吞吐明显更高——这与 [DFA 表驱动词法](../lexer/dfa.md) 的"表解释 vs 直译"取舍一致。

### 6.2 SQLite：自带 Lemon

SQLite 不依赖外部工具链，内置了自己的 LALR(1) 生成器 Lemon：语法动作接口更干净（无全局变量约定）、生成的解析器线程安全且便于静态集成——嵌入式场景下"少一个构建期依赖"比工具先进性重要。

### 6.3 手写回归

rustc、Go 编译器、Clang 都选择了手写递归下降（见 [recursive-descent.md](recursive-descent.md)）：为的是**定制错误恢复与 IDE 级诊断**（预期集合、跳读到语句边界）、以及绕开生成器对语法形状的限制。趋势很清晰：**生成器适合语法稳定、体量大、错误提示要求一般的场景；追求诊断质量就手写。**

## 七、易错清单

1. **忽视 bison 默认冲突策略**：默认 shift 且静默，必须在 CI 中把 conflict warning 升级为 error。
2. **reduce-reduce 当成小问题**：它说明文法在该处真二义，shift-reduce 还能靠优先级救，reduce-reduce 通常要改文法。
3. **左递归不用改写**：LR 天然吃左递归（这正是相对递归下降的优势）；把教材上的左递归消除套路照搬过来反而劣化。
4. **优先级声明只该用于表达式层**：拿 precedence 解决语句层的冲突会把错误藏得更深。
5. **LALR 的合并效应**：单独看每个状态都没问题、合并后冒出新冲突——排查时要看 `.output` 里合并后的状态而非原始 LR(1) 项。
6. **错误恢复缺失**：生成器默认遇错即停；生产 parser 需要 `error` token 规则跳到语句边界再续析。

## 八、一页速查

| 维度 | LR(0) | SLR(1) | LALR(1) | LR(1) | GLR |
|------|-------|--------|---------|-------|-----|
| 归约依据 | 无 | FOLLOW(A) | 精确 lookahead | 精确 lookahead | 全部分支 |
| 状态数 | 最小 | 同左 | 同左 | 指数级 | 基于 LALR |
| 新增冲突 | 多 | 中 | 仅 reduce-reduce | 极少 | 无（并行消化）|
| 工具 | 教学 | 少见 | yacc/bison/Lemon | ELR 生成器 | bison `%glr` |
| 代表用户 | — | — | PostgreSQL/SQLite/Bash | — | 旧版 C++ 前端 |

读完应能回答：

- 为什么 LR 栈里存状态而不存文法符号？
- SLR 的 FOLLOW 近似为什么会产生假冲突？LALR 如何解决？
- LALR 合并为什么不会新增 shift-reduce 冲突？
- C 的 typedef 歧义有哪些解法？各自牺牲了什么？
- bison 的冲突为什么必须在 CI 里当错误对待？

---

下一节 → [GLR / PEG / packrat](glr-peg.md)
