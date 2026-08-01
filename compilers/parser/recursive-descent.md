# 递归下降 / 算符优先 / Pratt

## TL;DR

递归下降是手写 parser 最常见方式：每产生式对应一函数。Pratt parser 是其变体，专门为表达式优先级处理。本节覆盖产生式 → 函数模板、左/右结合优先级、错误恢复 (panic mode / error productions)、AST 构造、Rust/Go 现代手写 parser 设计。

---

## 一、文法 (Grammar)

 Grammar G = (Terminals, Nonterminals, Productions, Start).

示例 (表达式)：
```
E  -> E + T | E - T | T
T  -> T * F | T / F | F
F  -> ( E ) | num
```

文法有 left recursion `E -> E + T`，**直接**递归下降不能处理（无限循环）。需左消除：

```
E  -> T E'
E' -> + T E' | - T E' | ε
T  -> F T'
T' -> * F T' | / F T' | ε
F  -> ( E ) | num
```

或换 Pratt parser。

## 二、递归下降模板

```rust
struct Parser {
    tokens: Vec<Token>,
    pos: usize,
}

impl Parser {
    fn parse_e(&mut self) -> Expr {
        let mut left = self.parse_t();
        while self.peek() == PLUS || self.peek() == MINUS {
            let op = self.next();
            let right = self.parse_t();
            left = Expr::BinOp(op, Box::new(left), Box::new(right));
        }
        left
    }

    fn parse_t(&mut self) -> Expr {
        let mut left = self.parse_f();
        while self.peek() == TIMES || self.peek() == DIV {
            let op = self.next();
            let right = self.parse_f();
            left = Expr::BinOp(op, Box::new(left), Box::new(right));
        }
        left
    }

    fn parse_f(&mut self) -> Expr {
        match self.next() {
            LPAREN => {
                let e = self.parse_e();
                self.expect(RPAREN);
                e
            }
            NUM(n) => Expr::Num(n),
            t => panic!("unexpected token: {:?}", t),
        }
    }
}
```

## 三、Pratt parser

Pratt parser 用 `binding_power` 表直接处理优先级：

```rust
fn parse_expr(&mut self, min_bp: u8) -> Expr {
    let mut lhs = self.parse_atom();
    loop {
        let op = match self.peek() {
            PLUS => Op::Plus, MINUS => Op::Minus,
            TIMES => Op::Times, DIV => Op::Div,
            _ => break,
        };
        let (l_bp, r_bp) = op.binding_power();
        if l_bp < min_bp { break; }
        self.next();
        let rhs = self.parse_expr(r_bp);   // 右边界 = r_bp 让更高级 op 进 inner
        lhs = Expr::BinOp(op, Box::new(lhs), Box::new(rhs));
    }
    lhs
}

fn binding_power(op: Op) -> (u8, u8) {
    match op {
        Op::Plus | Op::Minus => (1, 2),    // 左结合: l_bp < r_bp
        Op::Times | Op::Div  => (3, 4),
        Op::Pow              => (5, 4),    // 右结合: l_bp > r_bp
    }
}
```

特点：
- 单函数处理所有优先级
- 左结合 `l_bp < r_bp`，右结合反过来 → 不陷入无限递归
- extension 友好 (prefix/postfix/infix 同框架)

matklad 的 https://matklad.github.io/2020/04/13/simple-but-powerful-pratt-parsing.html 是 nginx-ingress 入门必读。

## 四、算符优先 (Operator Precedence)

经典 yacc/lex 风格：`%left`, `%right`：
```
%left PLUS MINUS
%left TIMES DIV
%right POW
%%
expr : expr PLUS expr   | expr MINUS expr | expr TIMES expr
     | expr DIV expr    | expr POW expr   | '(' expr ')' | NUMBER
```

LR parser 用 precedence 决定 shift vs reduce 冲突。需要 Pratt 时，Pratt 更简洁更易调试。

## 五、错误恢复

### 5.1 Panic mode

最简单：error 时一直 skip token 直到 同步 token (statement boundary = `;` 或 `}`):

```rust
fn parse_block(&mut self) -> Block {
    self.expect(LBRACE);
    let mut stmts = Vec::new();
    while self.peek() != RBRACE && !self.is_eof() {
        let stmt = self.parse_stmt();
        if let Err(e) = stmt {
            self.report(e);
            self.skip_to_recovery_set();
            continue;
        }
    }
    self.expect(RBRACE);
    Block(stmts)
}

fn skip_to_recovery_set(&mut self) {
    while !self.is_eof() && !RECOVERY_SET.contains(&self.peek()) {
        self.next();
    }
}
```

### 5.2 Error productions

认可特定 token sequence 是 "expected error"，让 error 不 stack：文法 `E -> E + T | E - T | E * T | IDENT error IDENT`。

yacc `%error` 是 error productions。

### 5.3 一致性 AST

error 时仍构造 AST，不阻塞后续 phase：rustc `Diag` 输出 error 后继续 build AST `Arc<Ty>`，下游 type checking 可以继续。

## 六、AST 构造

```rust
enum Expr {
    BinOp(Op, Box<Expr>, Box<Expr>),
    UnaryOp(UnOp, Box<Expr>),
    Num(f64),
    Ident(String),
    Call(Box<Expr>, Vec<Expr>),
    Index(Box<Expr>, Box<Expr>),
}

enum Stmt {
    Let(String, Expr),
    Expr(Expr),
    Block(Vec<Stmt>),
    If(Expr, Box<Stmt>, Option<Box<Stmt>>),
    While(Expr, Box<Stmt>),
}
```

## 七、现代手写 parser 设计

### 7.1 rustc

- 完全手写 (recursive descent + Pratt for expressions)
- token `Span` (range-based + macro) 含 pelos file + BytePos + line/col
- AST + async ergo async error
- lookahead 1 token 即可（含 sufficiently 现代 OK）

### 7.2 V8

- 手写 parser / Node-style
- stack-based  debug friendly，含 source spans 注释

### 7.3 Go / gc

- 手写 recursive descent
- error recovery minimal (skip to semicolon)
- very fast (≤1 MB / sec)

### 7.4 Roslyn (C#)

- fully hand-written recursive descent
- error recovery 工业级 ("error productions" 数 hundred rules)
- AST + immutable + reusable incremental

## 八、产线优缺

手写 parser 优势：
1. 易诊断 error
2. 不依赖工具 build chain
3. 调性能/调优先级灵活
4. 现代 IDE source span 复杂

劣势：
1. 文法大变化工作量大
2. IDE 增量 parse 需 custom incremental (rust-analyzer 6 person 月)
3. 团队线性时间增长 (LL1.5 工具)

## 九、易错清单

1. **左递归消除** 必用 EBNF transform 或 Pratt
2. ** Pratt 右结合：`l_bp > r_bp`，**left `l_bp < r_bp`**
3. **错误恢复** panic mode 必 让 AST 一致 (downstream 可以 work)
4. **AST 字符串字面量 token raw bytes** 处理转义 preserve col span
5. **span 含 byte + line/col** 二元 数据 让 IDE 可编 (rustc)
6. **never lookahead >1 token** √ 计 nitpick; 但 hook parser 需 lookahead 2 (e.g. TypeScript `async () =>` vs `async + fn`)
7. **comment 必 preserve to AST** 或 hover IDE would lose info

## 十、这一章带走的东西

1. 递归下降 + Pratt 是现代手写 parser 主流，bind powers 单表
2. Pratt 函数处理左结合（l_bp < r_bp）与右结合（l_bp > r_bp）
3. panic mode error recovery skip 到同步 token
4. error 仍构造 AST，下游 phase 可以继续
5. rustc/V8/Golang/Roslyn 都手写 parser，IDE source spans friendly
6. AST 设计 immutable + span-based 是 modern IDE 互操作基础
