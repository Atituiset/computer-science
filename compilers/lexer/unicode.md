# Unicode、字符集、错误恢复

## TL;DR

现代语言源码允许直接使用 Unicode：`λ x → x` (Agda)、`let Σ = 1`、JS emoji identifiers。lexer 必支持 Unicode Normalization Form、UTF-8 编码、代码点分类 (letter/digit/punctuation)、以及解析时的 fallback error recovery。本节走完 UTF-8/16 编码、Unicode 表 / `\p{L}`、字符集规范化 NFC/NFD/NFKC/NFKD、跨平台换行 (LF/CRLF/CR)、识别非法 byte 时 lexer 行为。

---

## 一、UTF-8 编码

UTF-8 是变长 1-4 字节：
```
0xxxxxxx                 1 byte  (U+0000 - U+007F)
110xxxxx 10xxxxxx        2 bytes (U+0080 - U+07FF)
1110xxxx 10xxxxxx 10xxxxxx  3 bytes (U+0800 - U+FFFF)
11110xxx 10xxxxxx 10xxxxxx 10xxxxxx  4 bytes (U+10000 - U+10FFFF)
```

UTF-8 优势：
- ASCII 兼容
- 单元自同步（任意 byte 可定位 stream 起点）
- 字节序无关（不需要 BOM）

lexer 要识别"lead byte"决定后续长度 + 验证 4 byte UTF-8 必 ≤ 0x10FFFF + 不入 surrogate 区（D800-DFFF）。

## 二、UTF-16 与代理对

UTF-16 对 BMP (U+0000 - U+FFFF) 用 2 byte，对 supplementary 平面用 surrogate pair (高 D800-DBFF + 低 DC00-DFFF)。

JS string 是 UTF-16，所以 `'a'.length === 1` 但 `'😀'.length === 2`。

lexer 解 UTF-16 source code 必处理 surrogate pair，否则 identifier 报错一半。

## 三、字符分类

lexer 用 Unicode 类别（`\p{L}` letter，`\p{N}` number）：

| 简写 | 含义 |
|------|------|
| `\p{L}` | letter (含 Ll/lower Lu/upper Lt/title Lm/modifier Lo/other) |
| `\p{N}` | number (Nd/Nl/No) |
| `\p{P}` | punctuation |
| `\p{S}` | symbol |
| `\p{M}` | mark (Mn combining) |
| `\p{Z}` | separator (space) |
| `\p{C}` | other (control, surrogate) |

`XID_Start` / `XID_Continue` 是 Unicode 标准 identifier 规则。

lex 执行：
```
ident_start = XID_Start | '_'
ident_continue = XID_Continue
```

```rust
fn is_ident_start(c: char) -> bool {
    c == '_' || unicode_xid::UnicodeXID::is_xid_start(c)
}
```

## 四、Normalization Forms

Unicode encoded 字符有等价 (e.g. `ó` 可 1 码点 U+00F3 或 2 码点 U+006F + U+0301 combining acute)。

- NFC (Normalization Form Composed)：组合 → 单码点
- NFD (Decomposed)：组合拆分
- NFKC / NFKD：兼容性分解（含样式等价）

源文件 lexer 通常用 NFC，让 equivalent code points → same token。Python 3 PEP 263 要求 source code 是 UTF-8 UTF-16。

```rust
// unicode-normalization crate
let nfd: String = s.nfd().collect();
let nfc: String = s.nfc().collect();
```

## 五、跨平台换行

```
\n    LF    Unix
\r\n  CRLF  Windows
\r    CR    Classic Mac OS
```

lexer 公约：
1. 把所有换行 normalize 成 LF
2. column counter 维护基于 normalized column
3. byte offset 仍按原始字节 (error report byte position)

Python `compile()` 把换行 normalize 成 LF：源 + identifier 一 致。

## 六、错误恢复

错误发生时 lexer 应仍可继续：
1. 跳 1 byte 继续
2. 报 `invalid UTF-8 byte 0xFF at line N col M`
3. 配合 IDE 行 / col 信息

```rust
fn lex(s: &str) -> Vec<Token> {
    let mut chars = s.chars().peekable();   // chars() 自检 UTF-8
    let mut tokens = Vec::new();
    while let Some(c) = chars.next() {
        match c {
            ' ' | '\t' | '\n' => continue,
            '0'..='9' => /* number */,
            _ if is_ident_start(c) => /* ident */,
            _ => {
                error(c);
                continue;
            }
        }
    }
    tokens
}
```

Rust `str::chars()` 把无效 UTF-8 替换 U+FFFD；lexer 仍继续。

## 七、产线实战

### 7.1 Rust identifier
Rust 支持 non-ASCII identifier：
```rust
let 用户 = "user";
```

`unicode-xid` crate 实现 XID_Start/XID_Continue literal check。`unicode_xid::is_xid_start('用')` true。

### 7.2 Hack customization
HHVM/Hack 允许 unicode id 但 report style: 与 lazy normalize，警告 non-ASCII identifier 出现在做 方_TAG_CAMÉL CASE。

### 7.3 Python `coding:coding` declaration
Python support `# -*- coding: latin-1 -*-` PEP 263 source code encoding declaration。Lex 文件字节、decode、tokenize 三道。

### 7.4 字符串字面量 buffered decode
某些 lexer 解 字符串字面量时应跳过 unicode decode 错误（保持 raw bytes）。e.g.：
```rust
let s = b"\xFF";   // raw byte, not UTF-8 string
```

## 八、易错清单

1. **UTF-8 byte length** variable: 1-4 字节一个 codepont
2. **Surrogate pair** D800-DFFF 必 reject 在 UTF-8 表达
3. **identifier**: XID_Start not 仅 ASCII letters
4. **`Σ`** 字符小写化 → NFC 等价 `Σ` 与 σ； 直等所有 known NFC text
5. **NFC 默认**: source 通常 NFC normalized 提前 preprocess
6. **CRLF** normalization 必留 byte offset 不变 / col 计数错位
7. **U+00A0 NBSP** 不算 whitespace: lexer 若不理是 bug

## 九、这一章带走的东西

1. UTF-8 1-4 byte variable, 自同步; UTF-16 with surrogate pair
2. Unicode XID_Start/XID_Continue 是 lexer identifier 标准分类
3. NFC normalize source 等价 Unicode normalization
4. 跨平台换行 normalize LF 但保留 byte offset for error report
5. Lexer UTF-8 invalid byte 必 报 + 跳 1 char 持续 继续
6. Rust `str` valid UTF-8 invariant, lexer 允 `[u8]` 处理 raw  bytes (代 char iteration)
