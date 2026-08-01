# 正则 → NFA → DFA / 表驱动词法

## TL;DR

词法分析器 (Lexer/Scanner) 把源文本切成 token 流。常见做法是正则 → NFA (Thompson 构造) → DFA (子集构造) → 表驱动跳转。本节走完 Thompson NFA、power set DFA、最小化 (Hopcroft)、表驱动 vs `re2c` 直接生成 C 状态机、flex 的扩展 max-munch 规则、最长匹配、回溯 vs DFA 字符串字面量混合 lexer 实战。

---

## 一、为什么正则 + 自动机

正则表达式 = regular language (Type-3 grammar in Chomsky hierarchy)，对应 NFA/DFA 描述。lexer 工作就是"识别 token 的有限状态机"。

正则的"原子语言不描述 nesting"——这是为什么 parser 必须用上下文无关文法 (CFG, Chomsky Type-2)。下推下推栈。

## 二、Thompson 构造 NFA

正则 e 转 ε-NFA recursive:

```
'a'            [start] --a--> [accept]
e1|e2          [start] --ε--> NFA(e1)
               [start] --ε--> NFA(e2)
                     accept(e1) / accept(e2)  --ε--> [accept]
e1e2           [start] --ε--> NFA(e1).start
               NFA(e1).accept --ε--> NFA(e2).start
               NFA(e2).accept --ε--> [accept]
e*             [start] --ε--> NFA(e1).start
               [start] --ε--> [accept]
               NFA(e1).accept --ε--> NFA(e1).start  (回 loop)
               NFA(e1).accept --ε--> [accept]
```

每操作加 2 状态 (start + accept)。总 NFA 大小 O(|e|)。

## 三、子集构造 NFA → DFA

```
def subset_construction(nfa):
    dfa_start = ε-closure(nfa.start)
    dfa_states = [dfa_start]
    dfa_transitions = {}
    queue = [dfa_start]
    while queue:
        S = queue.pop()
        for c in alphabet:
            U = ε-closure(move(S, c))
            if U not in dfa_states:
                dfa_states.append(U)
                queue.append(U)
            dfa_transitions[S, c] = U
    accept_states = [S for S in dfa_states if any(nfa.accept in S for s in S)]
```

最坏 O(2^n) 状态数（指数），但实际 lexspec 中表现好。

## 四、Hopcroft 最小化 DFA

```
def hopcroft(dfa):
    P = {accepting, non-accepting}
    W = {{accepting}, {non-accepting}}
    while W:
        A = W.pop()
        for c in alphabet:
            X = {s | move(s, c) in A}
            refine P and W by split on X
    return P
```

O(n log n) 时间。最小化后每状态语义更清晰。

## 五、表驱动 lexer

```c
// 状态表
int transitions[MAX_STATES][256];  // ' ' = current state, char = next
int is_accept[MAX_STATES];

int lex() {
    int state = 0;
    int last_accept = -1;
    int last_pos = 0;
    char *p = input;
    while (*p) {
        state = transitions[state][(unsigned char)*p++];
        if (is_accept[state]) {
            last_accept = state;
            last_pos = p - input;
        }
    }
    return token_type[accept_state];
}
```

特点：稳定、易生成；查表一个 byte lookup 几纳秒。LLVM tablegen / flex 生成该代码。

## 六、`re2c` 直接生成 C 状态机

re2c 不做表 — 把 DFA 直接 emit C 代码：

```c
// re2c
/*!re2c
    [0-9]+  { return NUMBER; }
    "if"    { return IF; }
    [a-zA-Z_][a-zA-Z0-9_]* { return IDENT; }
*/
```

转成:

```c
{
    int yych = *cursor++;
    switch (state) {
    case 0:
        if (yych >= '0' && yych <= '9') goto state_num_1;
        if (yych == 'i') goto state_kw_if_1;
        ...
    case state_num_1:
        if (yych >= '0' && yych <= '9') goto state_num_1;
        else return NUMBER;
    ...
    }
}
```

直接嵌入函数 — 比 flex 表驱动快 1.5-2x，无 indirect dispatch。PHP、ninja、Hack 用 re2c。

## 七、flex (最古老)

flex 是 GNU lexer generator，基于 C 表驱动：
- `%option` 控制 noyywrap / case-insensitive / never-interactive
- 默认 POSIX lex 兼容
- 输出 lex.yy.c，yylex() 主入口

POSLEX 规则：
1. **最长匹配 (max-munch)**: 多 rule 命中 → 选最长 input 的
2. **rule 优先**: 同长 → 列文件中前 rule 优先

```c
"if"      return IF;
[a-zA-Z]+ { return IDENT; }   // "ifx" 走这里而非 IF + X
```

## 八、关键场景 lexer 实战

### 8.1 Keyword vs Identifier

```
"if"   rule_1:  return IF
"iff"  (no rule)         → rule_2 IDENT  
"ifx"  match IDENT       ← max-munch 让 "ifx" 全 ID，not IF + IDENT
```

### 8.2 Comment 嵌套

```
/* outer /* inner comment */ 多嵌套 */
```

正则本身不足以处理嵌套。解决：状态机用 `start condition` (flex %x 区作用)：
```c
%x COMMENT
%{
    comment_depth = 0;
%}
%%
"/*"     { BEGIN(COMMENT); comment_depth = 1; }
<COMMENT>"/*"   { comment_depth++; }
<COMMENT>"*/"   { if (--comment_depth == 0) BEGIN(INITIAL); }
<COMMENT>.|\n    { /* skip */ }
```

### 8.3 字符串字面量含转义

```c
\"([^\"\\]|\\.)*\"
```

正则描述即可，但 lexer 状态机模拟。flex 自身不需要 start condition 处理（正则够）。

### 8.4 here-doc Python triple-quote

```
"""multi line
"""
```

用 start condition + construct buffer state 处理缩进敏感。

## 九、错误恢复

lexer 错误恢复 minimalist:
- 报错 row + col + 推进 1 byte
- 继续给 parser

NASal: lexer 多 case error 不行 (semantic 错在 parser/semant)。

```c
. {
    fprintf(stderr, "lex error at %d:%d: char `%c'\n", line, col, *cursor);
    cursor++;   // skip 1 char
    continue;
}
```

## 十、性能对比

| 工具 | 输出形式 | 性能 | 工 |
|------|----------|------|----|
| flex | 表驱动 C | 100 MB/s | 类似 |
| re2c | 直接 C 代码 | 200 MB/s | 现代项目 |
| ANTLR4 lexer | Java/Go runtime | 50 MB/s | 易 |
| hand-written | switch-case + 状态 reg | 200+ MB/s | high projects (Rust, V8) |

V8 / Roslyn / rustc 全部 手写 lexer：状态用 switch，避免代码生成开销。

## 十一、易错清单

1. **max-munch**：longest match 不只是 first match
2. **正则没记 count/嵌套**：context-free 才行 (push down)
3. **状态机 lookahead** 常需 KMP-like 算法以不可回 (so-called `re2c : / = / gets flex yyless()`)
4. **CRLF / LF / CR** 跨平台换行 lexer 应处理
5. **re2c `-b` `-c` `--case-insensitive`** 注意 case folded range (ASCII vs UTF-8)
6. **lexer error recovery 通常 skip 1 char 不 strategy**
7. **flex 中 `yyless(n)`** 把 n bytes 推回 input，但对 backtrack 有性能感 

## 十二、这一章带走的东西

1. 正则 → NFA → DFA → min DFA 是 lexer 经典路径，O(n) worst-case 产 lexer 性能
2. Thompson NFA 大小 O(|e|)，subset 构造最坏指数、实际 1.x 线性
3. 表驱动 (flex) vs 直接 C 状态机 (re2c) 性能差 1.5-2x
4. max-munch + rule 优先级是 lexer 工具必要 POSIX 规则
5. 嵌套 / 复杂字符串字面量用 start condition (flex %x / re2c conditions)
6. 现代大编译器 (rustc/V8/Roslyn) 手写 lexer，省 codegen 开销
7. 错误恢复应保守 1 字符 forward 推进

## 下一节 →

[Unicode、字符集、错误恢复](unicode.md)
