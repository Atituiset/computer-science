# 字符串: KMP / Z / Rabin-Karp / AC 自动机

## KMP

### 失败函数 / next 数组

`next[i]` = pattern 前 i 个字符的**前缀 = 后缀**的最长长度 (不取等长自身).

```python
def build_next(p):
    nxt = [0] * len(p)
    k = 0
    for i in range(1, len(p)):
        while k > 0 and p[k] != p[i]:
            k = nxt[k - 1]
        if p[k] == p[i]: k += 1
        nxt[i] = k
    return nxt

def kmp(s, p):
    nxt = build_next(p)
    k, hits = 0, []
    for i, c in enumerate(s):
        while k > 0 and p[k] != c:
            k = nxt[k - 1]
        if p[k] == c: k += 1
        if k == len(p):
            hits.append(i - k + 1)
            k = nxt[k - 1]
    return hits
```

复杂度: 构造 O(m)、搜索 O(n). 关键: **不回退 text 指针**.

## Z 数组

`Z[i]` = s[i:] 与 s 本身的最长公共前缀长度. 构造 O(n), 可用于:
- 在 text 后接上 `pat # text` 求 pat 出现位置.
- 范围最近重复子串.

## Rabin-Karp

基于滚动哈希:

```python
def rabin_karp(s, p, base=131, mod=2**64):
    h_p = 0; h_s = 0; B = pow(base, len(p)-1, mod)
    for i in range(len(p)):
        h_p = (h_p * base + ord(p[i])) % mod
        h_s = (h_s * base + ord(s[i])) % mod
    hits = []
    for i in range(len(s) - len(p) + 1):
        if h_s == h_p and s[i:i+len(p)] == p:
            hits.append(i)
        if i < len(s) - len(p):
            h_s = ((h_s - ord(s[i]) * B) * base + ord(s[i + len(p)])) % mod
    return hits
```

冲突避免: 双 hash (两个 base + 两个 mod).

## AC 自动机

Trie + KMP 失败链: 一次扫描 text 同时匹配多个 pattern.

1. 装 patterns 到 Trie;
2. BFS 构建 fail 链 (KMP 的 next 推广到多分支);
3. 沿 text 走 Trie, 匹配时记录输出.

适用: 敏感词过滤、IDS 模式匹配、日志关键字扫描.

## 进阶算法索引

| 算法 | 复杂度 | 用途 |
|------|--------|------|
| Manacher | O(n) | 最长回文子串 |
| Suffix Array | O(n log n) | 反复子串、DC3 / SA-IS O(n) |
| Suffix Automaton | O(n) | 多模式匹配、不同子串计数 |
| Suffix Tree | O(n) | 全能但代码量大 |

## 经典题

- LC 28 实现 strStr()、LC 459 重复子串模式 (KMP 失败函数性质)
- LC 214 最短回文 (KMP + 反转连接)
- LC 5 最长回文子串 (Manacher)
- AC 自动机模板题 (洛谷 P3808)
