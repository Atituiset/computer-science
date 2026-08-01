# GLR、PEG、packrat

## TL;DR

当 CFG 走 LALR conflict 解决时，三种 modern 替代：(1) GLR (Generalized LR) 在每 conflict 分叉成多个同时走；(2) PEG (Parsing Expression Grammar) 把 grammar 转 backtracking parser；(3) Packrat parser 缓存每 (state, position) 让 PEG O(n)。本节覆盖三者算法、适用场景、性能对比、现代实战 (Tree-sitter、ANTLR4、Rust 项目)。

---

## 一、GLR (Tomita 1987)

LALR conflict 时，不报错，**双路径同时 shift** 或 **同时 reduce**。

```python
def glr_parse(input):
    stack_set = {(0,)}
    while stack_set:
        new_set = set()
        for stack in stack_set:
            action = actions[stack[-1], lookahead]
            if action is SHIFT:
                new_stack = stack + (action.next,)
                new_set.add(new_stack)
            elif action is REDUCE:
                for prod in action.productions:
                    new_stack = stack[:-len(prod.rhs)] + (prod.lhs,)
                    new_set.add(new_stack)
            elif action is ACCEPT:
                return stack
        stack_set = new_set
        advance_lookahead()
```

特点：
- 处理 ambiguity (C 语言 `T * x` ambiguity)
- 多空间栈：extra memory per conflict
- 时间最坏指数

```
bison %glr
%expect 0
%expect-rr 0
```

## 二、PEG (Ford 2004)

CFG 一个 grammar 可多个 parser；PEG 是 another formal system：sequence、ordered choice、lookahead。无 ambiguity (因 ordered choice)。

```
expr    <- term (('+' / '-') term)*
term    <- factor (('*' / '/') factor)*
factor  <- '(' expr ')' / number / '-' factor
number  <- [0-9]+
```

PEG 语义 deterministic：`/` order 按文法先 first match wins。最坏 backtracking → exponential。

## 三、Packrat parser

packrat 缓存每 (rule, position) 的 parse result，让 PEG linear-time：

```python
cache = {}  # (rule_name, position) -> result

def parse_rule(rule, pos):
    if (rule, pos) in cache:
        return cache[(rule, pos)]
    result = _eval(rule, pos)
    cache[(rule, pos)] = result
    return result
```

特征：
- O(n × #rules) 时间 + 内存 — linear but high constant
- 适合 parsing tools，e.g. linters / formatters (Parser Combinators)
- 内存大 — 200 MB 源码吃 200 MB also

## 四、Parser combinators (Rust nom)

Rust `nom` 用 parser combinator：
```rust
fn expr(i: &str) -> IResult<&str, Expr> {
    let (i, lhs) = term(i)?;
    let (i, ops) = many0(tuple((alt((char('+'), char('-'))), term)))(i)?;
    // fold into AST
}
```

特点：
- 类型安全 + 代码简洁
- backtracking not built-in: combinator 写者要小心
- performance 良 (release debug visualized)

## 五、ANTLR4

ANTLR4 parser (LL*) + adaptive LL:
- runtime predictive + backtracking fallback
- grammar precedence 直接编码
- 性能 OK 中等 grammar (<10k tokens/s 典型)

## 六、tree-sitter

Tree-sitter 是 GitHub 开源 incremental parser：combinateur:
- GLR 的 variant (CST set of choices)
- incremental: 修改源文件后局 re-parse
- multi-language (rust, JS, Python, Go, ...)
- error recovery robust (source text 一直 work)

VS Code、neovim、Zed 用作 syntax highlighting + folding + jump-to-def。

Tree-sitter parser 仍是 LALR variant + GLR for ambiguity + incremental context update。性能 ≤100MB/s。

## 七、产线对比

| 工具 | 类型 | Avg performance | 用例 |
|------|------|----------------|------|
| PEG parser combinator | PEG + packrat | 50 MB/s | 学 school |
| nom | parser combinator + zero-copy | 100 MB/s | Rust projects |
| tree-sitter | GLR + incremental | 10 MB/s | IDE |
| ANTLR4 | adaptive LL(*) | 10-20 MB/s | DSL |
| GLR (bison %glr) | GLR | 50 MB/s | legacy |

## 八、易错清单

1. **PEG ordered choice** irreversibility → 别 left-recursion (PEG flashback 不行)
2. **packrat memory** O(n × rules) —— 行业项目 grammar 100 rule × 1MB source = 100 MB
3. **GLR ambiguity** 可任意 — 但 business 通常 wants one 路径
4. **tree-sitter error recovery** 来处 fragment 让 speak 输 lost source 'we need canon IDE INIT: still provide CST outline 包含 valid + error nodes'
5. **ANTLR4 LL* \runtime** 比 bison 慢 but grammar 写起来易, 不 recommend 用于 SUB 100k source

## 九、这一章带走的东西

1. GLR 用 stack 分叉 disambiguate; bison %glr 处含文法 ambiguity
2. PEG ordered-choice grammar — 无 ambiguity 自然但 backtracking worst exp
3. packrat parser O(n × |rules|) cache 让 PEG linear-time 但存高
4. tree-sitter = GLR + incremental + multi-language IDE 适合
5. parser combinator (nom, Haskell parsec) 现代 language 友好
6. ANTLR4 LL(*) adaptive 性能良 适合 DSL grammar 壳
