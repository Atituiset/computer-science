# LR / LALR / SLR / yacc / bison

## TL;DR

LR 系列是 table-driven bottom-up parser：从左扫描（L）右推导（R），使用下推栈 + GOTO/SHIFT/REDUCE 状态表。LR(0) / SLR(1) / LALR(1) / LR(1) 区别在 lookahead 和状态合并策略。yacc/bison 是 LALR(1) 工具典; PostgreSQL / Oracle PL/SQL / GCC 早期均 bison 生成。本节走完 LR 算法、DFA、SLR/LALR/LR 区别适合 conflict、bison precedence/associativity、glr fallback 策略。

---

## 一、LR 算法

LR parser：自下而上移进 (shift) 与归约 (reduce)：
```
stack: states s_0, s_1, ..., s_k   多 symbols
input + lookahead
action(state_top, lookahead):
   shift(next_state)    # 入栈filetates
   reduce(N, A->α)     # 出 |α| 个 state, 推 A
   accept()

goto(state, nonterm)    # shift 后 transition
```

shift-reduce 自底向上"重放"着上下文无关推 式。

## 二、LR(0) 项目集

每产生式加 `·` 标进度：`A -> α · β`。

START 项目集开始 `S -> · E`，closure 后含 all follow items；GOTO 形成状态有限（最高 p）。

LR(0) 表只看栈顶状态；SLR 增加 FOLLOW 集（当前 lookahead ∈ FOLLOW(A) 时 reduce → 解决 LR(0) shift-reduce conflict）；LALR(1) 将每状态加 lookahead → 数据量小 LR(0) 状态数但 conflict 处理强于 SLR；LR(1) full lookahead Each item 携 lookahead 集 → state 数 exponential。

## 三、冲突 (conflict)

- **shift-reduce conflict**: 同一 (state, lookahead) 既 shift 又 reduce。
- **reduce-reduce conflict**: 同一 (state, lookahead) 有两 rule 可 reduce（语法错错）。

LR(0) conflict 多 natural；SLR 减少；LALR(1) 通常 works；LR(1) state explosion。

yacc/bison 走 LALR(1)；小 grammar > 100 rule 通常 OK，conflict 人工 eliminate。

## 四、弱 vs 强 parser

| Parser | lookahead | 状态数 | conflict 易出？ | 工程用例 |
|--------|-----------|--------|------------------|----------|
| LR(0)  | 0 | small | 频繁 | 教学性 |
| SLR(1) | 1 | LR(0) 大小 | 中等 | 极少用 |
| LALR(1) | 1 | LR(0) 状态数 | 口语时少 | yacc/bison OCaml 期 |
| LR(1)  | 1 | exponential large | 极少 | tomita 等 |
| IELR(1) | 1 | medium | 极少 | bison `%define lr.type ielr` |

## 五、bison / yacc

bison 生成 LALR(1) parser 的入口：
```
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
- `%union` 定义 AST + token 类型 discriminant
- `%left %right` precedence 解决 shift-reduce
- `%prec UMINUS` 把 token 优先级赋受规则 (用于 UMINUS 虚拟 token)
- `$$ $1 $3` 直接访问语义值

## 六、glr fallback

LALR(1) 仍 conflict (e.g. C 语言 `x * y` ambiguity 的 是 declaration 还是 multiplication) → bison `%glr` 模式生成 GLR parser (增生成 parser，所有 conflict 路径同时保存 — until error Tampa) 接出 facts on symbols。

## 七、gcc / LLVMgrammar

- GCC 历史 with bison
- 现在 C++11 ambiguity 让 bison GLR
- rustc 完全 手写

## 八、产线观察

### 8.1 PostgreSQL SQL parser 用 yacc/bison
PG SQL parser 文 `gram.y` 配 `scan.l`，确实是 bison 生成。会restrict少 conflict by 极强 grammar shampoo (precision/associativity 行 100 行)。

### 8.2 SQLite 全手写 Lemon parser
SQLite 不用 bison（LALR(1)），但自定义 Lemon parser：LALR(1) 但 generate C 创使用 surplus fine level of error report.

### 8.3 PostgreSQL 自定义 lexer re2c
PG 9.6+ lexer 用 re2c 替代 flex。 re2c table-less 直接 de la More touch species 从-币性能 + 提中风 source.

## 九、易错清单

1. **shift-reduce conflict** 优先 shift 但不唯一 op 性:precedence 解决
2. **reduce-reduce conflict** grammar 本身有问题
3. **left recursion** 适配 bottom-up parser (不是 issue)
4. **right recursion** 落入但 stack space 大
5. **grammar ambiguity** vs conflict LALR(1) 也能 GLR 模式访问
6. **AST 构造** `$$= Sem_($1 + $3);`  simple but `style $1->attach_span(...)` tp declaration `s` width errors at upgrade

## 十、这一章带走的东西

1. LR parser 自下而上 shift-reduce
2. LR(0) → SLR → LALR(1) → LR(1) → IELR(1) 渐进后 lookahead
3. bison: LALR(1) + %left %right %prec 解决二意
4. GLR mode conflict path 先 parallel、最后 scope decide
5. PostgreSQL、SQLite、PG 等历史项目 bison/Lemon LALR(1) 使用精心 grammar 设计
6. 现代 compiler (rustc/go) 倾向手写 recursive descent 实 fine-grained 错误报告 IDE 友好
7. precedence 注  in 文 七 tervals 而非 文检查 坚实性
