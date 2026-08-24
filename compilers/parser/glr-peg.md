# GLR、PEG、packrat

## TL;DR

当 LALR 的冲突表填不平、或手写递归下降的文法改写太痛苦时, 有三条现代出路: **GLR** 让 LR 解析器在冲突处分裂成并行分支同时探索, 把消歧推迟到语义阶段 (Tomita 的图结构栈共享汇合后缀); **PEG** 干脆换一套形式系统——有序选择 `/` 天然无二义, "第一个匹配赢"就是语义, 代价是最坏指数回溯; **packrat** 用记忆化把每个 `(规则, 位置)` 的结果缓存起来, 换 $O(n)$ 时间与可观的内存。tree-sitter 把 GLR 思路做进增量解析器统治了 IDE 生态; ANTLR4 的 ALL(\*) 在运行时动态预测, 让 LL 文法也能直接写左递归。选型一句话: **要增量/容错 → tree-sitter; 要确定性小引擎 → PEG/packrat; 真二义语法 (C typedef) → bison `%glr`**。

```text
问题: CFG 二义 / 冲突填不平, 又不想大改文法
  ├─ 保住 LR 家族
  │    └─ GLR: 冲突点分叉并行探索 ─► 图结构栈 (GSS) 共享后缀
  │          └─► 存活唯一分支即答案; 全死才报错 ─► 消歧交给语义阶段
  ├─ 换形式系统
  │    └─ PEG: sequence + 有序选择 + 谓词 (&x !x)
  │          ├─► 无二义 by construction (first-match-wins)
  │          ├─► 代价: 回溯最坏指数; 左递归天然不可行
  │          └─► packrat: memo[(rule,pos)] ─► O(n) 时间, O(n·规则数) 内存
  └─ 运行时自适应
       └─ ANTLR4 ALL(*) / tree-sitter: 预测失败再回溯/分叉, 增量复用子树
```

---

## 一、GLR: 分叉而不是报错

LALR 表里一个 `(状态, lookahead)` 出现 shift-reduce 或 reduce-reduce 冲突时, 普通 LR 只能按预设优先级硬猜。GLR (Tomita) 的选择是**全都要**: 复制解析栈, 每个动作各走一条, 之后每一步所有并行栈同步推进。

工程实现的核心数据结构是**图结构栈 (Graph-Structured Stack)**: 分叉时新栈与旧栈共享未分叉的前缀; 不同分支归约到同一非终结符且抵达同一状态时, 后缀合并回同一个节点——否则歧义度 $k$ 会让内存随输入长度指数膨胀, GSS 把它压到多项式。

bison 里只需局部标注:

```c
%glr-parser
%expect 0        // 允许的 sr 冲突数
%expect-rr 0     // 允许的 rr 冲突数

%%
decl : type ident ';'
     | type ident '(' params ')' ';'   // 与函数声明冲突? %glr 双线并走
     ;
```

语义动作在多分支并存时的约定: bison 会保留每个分支的语义值, 用户在归约动作里可以返回"待定"值, 等**唯一分支存活**后再裁决 (典型: C 的 `T * x;` 是声明还是乘法表达式, 由符号表在语义阶段回答)。正常无冲突的输入上, GLR 与 LALR 性能几乎相同——所以只对个别规则开 `%glr`, 不要全语法开启。

## 二、PEG: 有序选择换确定性

CFG 的 `|` 是"无序或", 二义了谁也不让; PEG (Ford, POPL 2004) 把它改成**有序的 `/`**: 先试左边的, 成功就绝不回头。加上两个语法谓词 `&x` (向后看必须匹配但不消费) 与 `!x` (必须不匹配), PEG 成为独立的识别系统:

```text
expr   <- term (('+' / '-') term)*
term   <- factor (('*' '/') factor)*
factor <- number / '(' expr ')' / '-' factor
number <- [0-9]+ '!'?          # 例: 支持 3! 阶乘后缀
```

三个必须内化的性质:

1. **无二义是构造出来的**, 不是证明出来的——但代价是文法的组合性被破坏: `S ← A / AB` 中 `AB` 永远没机会被尝试 (A 能吃掉的一定先被 A 吃掉), 直觉上等价的改写可能改变语言;
2. **左递归不可行**: `E ← E '+' T` 第一字符递归自己, 无限循环。要么机械消除, 要么用近年研究支持直接左递归的实现 (Tratt 等人的 packrat 变体);
3. **回溯最坏指数**: 嵌套可选结构 (`(a/a/a)*`) 上经典爆炸。

## 三、Packrat: 记忆化买线性

packrat 缓存每个 `(规则, 输入位置)` 的结果 (含失败), 同一位置同一规则的重复解析变成一次查表——最坏指数被压成 $O(n \times 规则数)$。下面是一个 ~40 行的最小引擎 + 组合子, 足以看清全部机制:

```python
def lit(s):
    def rule(pos, text, parse):
        if text.startswith(s, pos):
            return s, pos + len(s)
        return None
    return rule


def ordered(*alts):
    """PEG 的 '/': 有序选择, 左边成功就绝不试右边."""
    def rule(pos, text, parse):
        for a in alts:
            r = a(pos, text, parse)
            if r is not None:
                return r
        return None
    return rule


def seq(*parts):
    def rule(pos, text, parse):
        out, cur = [], pos
        for part in parts:
            r = part(cur, text, parse)
            if r is None:
                return None
            out.append(r[0])
            cur = r[1]
        return out, cur
    return rule


def many(p):
    def rule(pos, text, parse):
        out, cur = [], pos
        while (r := p(cur, text, parse)) is not None and r[1] > cur:
            out.append(r[0])
            cur = r[1]
        return out, cur                      # 空匹配也成功 ⇒ * 语义
    return rule


def make_packrat(rules: dict):
    """memo[(rule, pos)] 同时缓存成功与失败两种结果."""
    memo, stats = {}, {"miss": 0, "hit": 0}

    def parse(rule: str, pos: int, text: str):
        key = (rule, pos)
        if key in memo:
            stats["hit"] += 1
            return memo[key]
        stats["miss"] += 1
        memo[key] = res = rules[rule](pos, text, parse)
        return res

    parse.stats = stats
    return parse


if __name__ == "__main__":
    rules = {
        "expr": ordered(
            seq((lambda pos, t, p: p("term", pos, t)), lit("+"),
                (lambda pos, t, p: p("expr", pos, t))),
            lambda pos, t, p: p("term", pos, t)),
        "term": ordered(lit("ab"), lit("a")),     # 有序选择: "ab" 优先
    }
    p = make_packrat(rules)
    _, end = p("expr", 0, "ab+x")
    assert end == 2                               # 只消费了 "ab"
    assert p.stats["hit"] >= 2                    # 回溯重入处全部命中缓存
```

## 四、Parser combinator: PEG 的类型化形态

Rust `nom` / Haskell `parsec` 把上述组合子做成库, 文法即代码:

```rust
use nom::{branch::alt, character::complete::{char, digit1},
          multi::many0, sequence::tuple, IResult};

fn expr(i: &str) -> IResult<&str, Vec<char>> {
    // term (('+'|'-') term)*  —— 组合子直译
    let (i, t) = digit1(i)?;
    let (i, rest) = many0(tuple((alt((char('+'), char('-'))), digit1)))(i)?;
    Ok((i, std::iter::once(t.chars().next().unwrap())
        .chain(rest.into_iter().map(|(op, _)| op)).collect()))
}
```

特点: 类型安全、零拷贝切片、编译期内联后性能接近手写; 但**回溯边界由作者负责**——组合子默认不缓存, 忘记 packrat 化就退回指数最坏。

## 五、ANTLR4 与 tree-sitter: 运行时自适应的两极

**ANTLR4 (ALL(\*))**: 生成的 LL 解析器在预测失败时不放弃, 而是**运行时模拟 ATN 自动机**向前看任意远 (自适应), 用户完全无感; 直接支持左递归规则 (内部自动改写成优先级链)。DSL、协议描述、静态分析工具链的主力。

**tree-sitter**: 为编辑器而生——GLR 式运行时分叉消化歧义 + **增量重解析** (编辑几个字节只重析受影响区间, 子树按内容哈希复用) + **错误恢复内置** (任何时刻都能给出包含 ERROR 节点的完整具体语法树 CST)。GitHub 代码导航、neovim/Zed 高亮、符号跳转都跑在它上面。注意它产出的是 **CST** (连标点空白都在树上), 这是精确格式化与重构的基础, 也是它与普通 AST 工具的本质差异。

## 六、产线对比

| 工具 | 技术 | 吞吐量级 | 内存 | 适用 |
|------|------|----------|------|------|
| 手写 RD + Pratt | — | 最高 | 低 | 编译器本体 |
| bison `%glr` | GLR | 高 | 歧义时增长 | 真二义遗留语法 (C) |
| ANTLR4 | ALL(\*) | 中 | 中 | DSL / 静态分析 |
| nom / pest | 组合子 (+packrat 可选) | 高 | 低–中 | Rust 侧数据格式 |
| packrat 全开 | PEG memo | 低–中 | $O(n \times$ 规则$)$ | 小语言 / linter |
| tree-sitter | GLR + 增量 | 中 (增量后极高) | 中 | 编辑器 / 大仓导航 |

## 七、易错清单

1. **PEG 的 `/` 不是 CFG 的 `|`**: 有序性让文法不再满足交换律, 重排候选顺序=换了语言;
2. **PEG 写左递归**: 基础版无限循环; 要么消除, 要么确认实现明确支持直接左递归;
3. **packrat 当免费午餐**: 缓存粒度、失效策略、内存上限都要设计; 只缓存热点规则常是最优解;
4. **GLR 全语法开启**: 正常路径性能虽同 LALR, 但歧义度高的文法会让 GSS 膨胀; 局部 `%glr`;
5. **把 CST 当 AST 用**: tree-sitter 树上有标点/ERROR 节点, 遍历逻辑必须跳过匿名节点;
6. **增量解析的边界条件**: tree-sitter 复用依赖子树哈希, 宏展开类"远处影响近处"的语言特性需要额外标记范围。

## 八、这一章带走的东西

1. GLR = LR + 冲突处分叉 + GSS 共享后缀; 消歧推迟到语义阶段;
2. PEG 用有序选择构造出无二义, 代价是回溯指数与左递归禁手;
3. packrat 记忆化 `(规则, 位置)` 换线性时间, 内存是它的账单;
4. ANTLR4 ALL(\*) 运行时自适应预测, tree-sitter 把 GLR + 增量 + 容错带进 IDE;
5. 选型: 增量容错 → tree-sitter; 小而确定 → PEG; 真二义 → `%glr`; 造编译器本体 → 手写 RD + Pratt。

---

回到章首: [语法分析](README.md)
