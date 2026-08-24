# 递归下降 / Pratt / 错误恢复

## TL;DR

递归下降是手写 parser 的主流形态：**每条产生式对应一个函数**, 文法结构直接变成调用结构。它天然只吃 LL 类文法——左递归会无限循环, 公共前缀要提左因子; 而表达式层的优先级/结合性如果靠文法层级硬编码 (E/T/F 三层), 每加一个运算符就要改一串函数。Pratt parser 用一张**结合力 (binding power) 表**把整个表达式语法压进一个带 `min_bp` 参数的循环里: 左结合 `l_bp < r_bp`、右结合 `l_bp > r_bp`, 前缀/后缀/中缀同一框架。工业界 (rustc、Go gc、V8、Roslyn) 全部选择"递归下降 + 表达式用 Pratt"的手写路线, 为的就是**错误恢复与 IDE 级诊断的质量**——生成器给不了。

```text
工程问题: 为什么现代编译器都抛弃生成器, 手写 parser?
  └─ 手写 = 文法的执行计划自己排
       ├─ 结构层: 递归下降 —— 函数即产生式, 控制流即推导
       │     └─ 代价1: 左递归死循环 ─► 消除改写 或 换迭代写法
       │     └─ 代价2: 优先级层级爆炸 ─► 表达式层换 Pratt
       ├─ 表达式层: Pratt —— binding power 单表定优先级+结合性
       │     └─ min_bp 是"当前右边的运算符至少要多强才能吃掉我"
       └─ 生产要求: 出错也要给出最好的诊断
             └─ panic mode 跳到同步集 + error AST 节点 + 全程携带 Span
```

---

## 一、文法前提: LL(1) 与两个坑

递归下降要求文法对每个非终结符、每个 lookahead 能**唯一决定选哪条产生式** (LL(1))。教材表达式文法有两个经典坑：

```text
E → E + T | T        ← 坑1: 左递归. parse_E 先调 parse_E ⇒ 无限循环
E → a b | a c        ← 坑2: 公共左因子. lookahead 只看 a 选不了分支
```

**左递归消除**的标准改写 `A → Aα | β` ⇒ `A → β A'; A' → α A' | ε`, 但它把结合性藏进了循环语义, AST 构造反而别扭——所以实战中表达式层根本不这么干, 直接上 Pratt (下节)。公共左因子则机械地提取成 `A → a B; B → b | c`。

判断"能不能写"用 FIRST/FOLLOW 集: 对每条候选产生式算 FIRST, 不相交才无回溯; 可空产生式还要求 FIRST 与 FOLLOW(A) 不交。这套检查正是表驱动 LL 的全部内容——表驱动 LL 和递归下降共享同一个理论 ([LR 家族](lr.md) 那章的对照视角同样适用), 差别只在"表解释 vs 直译成代码"。

## 二、递归下降模板

以最小计算器为例 (Python 版可运行, Rust 版见下):

```python
class Tok:
    def __init__(self, kind, val):
        self.kind, self.val = kind, val


def tokenize(s: str) -> list[Tok]:
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c.isspace():
            i += 1
        elif c.isdigit():
            j = i
            while j < len(s) and s[j].isdigit():
                j += 1
            out.append(Tok("num", int(s[i:j])))
            i = j
        else:
            out.append(Tok(c, c))
            i += 1
    out.append(Tok("$", None))
    return out


class Parser:
    """文法(已消左递归): E→T {± T}; T→F {*/ F}; F→(E)|-F|num"""

    def __init__(self, tokens: list[Tok]):
        self.toks, self.i = tokens, 0

    def peek(self) -> Tok:
        return self.toks[self.i]

    def next(self) -> Tok:
        t = self.peek()
        self.i += 1
        return t

    def expect(self, kind: str) -> Tok:
        t = self.next()
        if t.kind != kind:
            raise SyntaxError(f"want {kind!r}, got {t.kind!r} at #{self.i}")
        return t

    def parse_e(self) -> float:
        left = self.parse_t()
        while self.peek().kind in ("+", "-"):
            op = self.next().kind
            left = left + self.parse_t() * (1 if op == "+" else -1)
        return left

    def parse_t(self) -> float:
        left = self.parse_f()
        while self.peek().kind in ("*", "/"):
            op = self.next().kind
            right = self.parse_f()
            left = left * right if op == "*" else left / right
        return left

    def parse_f(self) -> float:
        match self.next().kind:
            case "num":
                return self.toks[self.i - 1].val
            case "(":
                e = self.parse_e()
                self.expect(")")
                return e
            case "-":
                return -self.parse_f()
            case k:
                raise SyntaxError(f"unexpected {k!r}")


def calc(s: str) -> float:
    p = Parser(tokenize(s))
    v = p.parse_e()
    p.expect("$")
    return v


if __name__ == "__main__":
    assert calc("1+2*3") == 7
    assert calc("(1+2)*3") == 9
    assert calc("-2*-3") == 6
    assert calc("8/4/2") == 1          # 左结合: (8/4)/2
```

三个结构性观察:

1. **循环即结合性**: `while` 收集同优先级运算符并**向左折叠**, 免费获得左结合 (`8/4/2 = 1`); 若写成递归调用就是右结合;
2. **函数调用深度 = 语法嵌套深度**: 这是递归下降唯一的性能/健壮性软肋, 深表达式 (机器生成的 JSONPath、超长链式调用) 会爆栈, 生产实现要么限制深度要么显式栈化;
3. **错误位置精确**: 每个 `expect` 都知道"此刻在等什么", 这是一切高质量诊断的原材料。

### Rust 形态

```rust
enum Expr {
    Num(f64),
    BinOp(char, Box<Expr>, Box<Expr>),
}

struct Parser<'a> {
    toks: &'a [Token],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn parse_e(&mut self) -> Result<Expr, Error> {
        let mut left = self.parse_t()?;
        while matches!(self.peek(), PLUS | MINUS) {
            let op = self.next();
            let right = self.parse_t()?;      // ? 向上传播而非 panic
            left = Expr::BinOp(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
}
```

要点: 返回 `Result` 而非 panic——错误恢复的前提是错误是**值**, 可以被收集、被恢复点消费; `Box` 装箱让 AST 节点尺寸均匀, 避免枚举被最大变体撑爆。

## 三、Pratt: 一张表吃掉所有优先级

三层文法 E/T/F 的痛点是**每引入一个优先级就多一层函数**。Pratt (1973) 把问题倒过来问: 解析一个表达式时, 我手里的 `lhs` 已经建好, 看到下一个中缀运算符时只关心一件事——**它的结合力够不够强, 强到有权吃掉我作为它的左操作数?**

```python
BP = {"+": (1, 2), "-": (1, 2), "*": (5, 6), "/": (5, 6),
      "^": (11, 10)}          # (l_bp, r_bp); 左结合 l<r, 右结合 l>r


def pratt(p: "Parser", min_bp: int) -> float:
    lhs = nud(p)                              # prefix/atom
    while True:
        kind = p.peek().kind
        if kind not in BP:
            break
        l_bp, r_bp = BP[kind]
        if l_bp < min_bp:                     # 我的结合力不够, 让上层收走 lhs
            break
        p.next()
        rhs = pratt(p, r_bp)                  # 右边界=r_bp: 同级能否继续吃由它决定
        lhs = apply_op(kind, lhs, rhs)
    return lhs


def nud(p: "Parser") -> float:                # Next Unit of Derivation
    match p.next().kind:
        case "num":
            return p.toks[p.i - 1].val
        case "(":
            v = pratt(p, 0)
            p.expect(")")
            return v
        case "-":
            return -pratt(p, 12)              # 前缀 -: 结合力高于一切中缀
        case k:
            raise SyntaxError(f"unexpected {k!r}")


def apply_op(op: str, a: float, b: float) -> float:
    return {"+": a + b, "-": a - b, "*": a * b, "/": a / b,
            "^": a ** b}[op]


if __name__ == "__main__":
    def run(s: str) -> float:
        p = Parser(tokenize(s))
        return pratt(p, 0)

    assert run("1+2*3") == 7                   # * 比 + 强, 先吃 2 和 3
    assert run("(1+2)*3") == 9                 # 括号 = 显式重置为原子
    assert run("2^3^2") == 512                 # 右结合: 2^(3^2)
    assert run("-2^-3") == -0.125              # 前缀与右结合组合
```

读懂这 20 行, 就能读懂 Lua、Rust、rust-analyzer 表达式解析的核心:

| 机制 | 含义 |
|------|------|
| `min_bp` 参数 | "调用者允许我最多消费结合力多强的运算符" |
| `l_bp < min_bp` 判断 | 当前运算符不够强 → 把 `lhs` 完整交还给上层 |
| 右边界传 `r_bp` | 左结合时 `r_bp > l_bp`: 同级**留给本层循环**继续折叠; 右结合 `l_bp > r_bp`: 同级**递归下去**给右边 |
| `nud/led` 分工 | 前缀位置 (数字/括号/一元负号) 与中缀位置的解析器分开注册 |

> [!TIP]
> 记不住左右结合方向时想一个例子: `a-b-c` 必须 `(a-b)-c`。`-` 的 `(l,r)=(1,2)`, 第二个 `-` 到来时 `min_bp=2 > l_bp=1`, 于是外层循环自己继续折叠——左结合; 而 `^` 取 `(11,10)`, 内层递归 `pratt(p, 10)` 允许同级 `^` 继续吃右边——右结合。

## 四、错误恢复: 编译器的用户体验主战场

生成器默认遇错即停; IDE 场景用户边打字边触发语法错误, parser 必须跳过错误区继续产出近似 AST。

### 4.1 Panic mode + 同步集

最通用的一招: 出错时报告并**丢弃 token 直到同步集** (语句边界 `;` `}`、关键字开头)。语句级语言天然分层, 所以效果出奇地好:

```python
STMT_START = {"let", "if", "while", "return", "{"}


def parse_block(p: "Parser") -> list:
    stmts = []
    while p.peek().kind not in ("}", "$"):
        try:
            stmts.append(parse_stmt(p))
        except SyntaxError as e:
            report(e)
            while p.peek().kind not in STMT_START | {"}", "$"}:
                p.next()                       # 跳到下一个可能的语句开头
    return stmts
```

### 4.2 Error productions 与 error AST 节点

更高阶的两招: **error production** 把常见笔误直接写进文法 (如"缺分号的赋值"), 给出针对性提示而不是泛泛的 syntax error; **error AST 节点** 在出错位置放占位节点让 AST 保持形状完整——下游类型检查可以照常跑完, 把所有错误一次性报全 (rustc/Roslyn 的核心体验)。配套纪律是**永远不因为出错而返回 null**: 缺失的表达式给 `ErrExpr`, 类型检查看到它就静默跳过。

> [!WARNING]
> 错误恢复最大的坑是**连锁报错** (cascade): 一个真实错误被跳读放大成一屏虚假错误。对策: 报错去重 (同一 token 区间只报一次)、跳读距离过远时收敛为单条 "unexpected X"。诊断质量是手写 parser 相对生成器最值钱的差价。

## 五、产线观察

- **rustc**: 手写递归下降 + 表达式 Pratt; 所有 AST 节点携带 `Span`; error AST + 恢复点设计成熟, 支撑了 Rust 生态著名的编译错误质量;
- **Go (gc)**: 手写递归下降, 恢复策略朴素 (跳到分号), 换来极快的解析吞吐——语言语法小、错误信息要求适度的正面案例;
- **V8**: 手写 parser + lazy preparser (顶层函数先粗扫, 执行到才完整解析), 解析速度直接影响页面启动;
- **Roslyn (C#)**: 手写 + 数百条 error productions, 工业级恢复能力; 配合 immutable/red-green 树支撑 IDE 的增量重分析。

共同结论: **语法的体量与稳定性不再是瓶颈, 诊断质量才是**——这是 2010 年代后新编译器全面回到手写的根本原因。生成器并未退场: 语法稳定且体量大的 DSL、配置语言仍适合 [LALR 生成器](lr.md)。

## 六、易错清单

1. **左递归直接写**: `parse_A` 第一件事是调 `parse_A` ⇒ 栈溢出; 表达式层用 Pratt, 其余场景改写文法;
2. **结合方向记反**: 左结合 `l_bp < r_bp` (同级留在本层), 右结合反之; 用 `a-b-c` 与 `a^b^c` 双测例锁住行为;
3. **panic 后忘同步**: 异常逃逸到顶层直接终止, 后续错误全部看不到; 每个循环边界都该有恢复点;
4. **lookahead 超预算**: 递归下降默认只看 1 个 token; 需要 2 个时 (如区分 TypeScript 的 `<` 泛型还是小于), 明确封装成一个决策函数而不是散落各处;
5. **AST 丢 Span**: 编译期偷懒不带位置, IDE 补齐时要重扫源码; Span 从 lexer 开始一路传递;
6. **深嵌套爆栈**: 对用户可控的嵌套深度设上限并给出友好错误, 别等 SIGSEGV。

## 七、这一章带走的东西

1. 递归下降 = 产生式即函数; 循环折叠给左结合, 递归下沉给右结合;
2. Pratt 用 binding power 一张表统一优先级/结合性/前缀中缀后缀;
3. 错误恢复三板斧: panic mode 跳同步集、error production 定向提示、error AST 保形续跑;
4. 诊断质量 (Span + 全量报错) 是现代编译器集体手写 parser 的原因;
5. rustc / Go gc / V8 / Roslyn 四家产线形态各异, 但骨架都是"RD + Pratt"。

---

下一节 → [LR/LALR/SLR/yacc/bison](lr.md)
