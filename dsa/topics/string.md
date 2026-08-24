# 字符串: KMP / Z / Rabin-Karp / AC 自动机

## 一句话

字符串匹配的算法光谱, 本质是"**匹配失败时, 已扫过的信息还能榨出多少**": 暴力法把信息全扔了 (text 指针回退, $O(nm)$); KMP 用前缀函数把"已匹配部分的最长相等真前后缀"预计算好, 失配时 pattern 自己滑到自己内部的重叠处——**text 指针永不回退**, 线性; Z 函数换一个等价视角 ("每个后缀与整串的 LCP"), 好写且直观; Rabin-Karp 干脆放弃逐字符比较, 用滚动哈希给每个窗口发指纹, 期望线性但允许极小概率误报, 却因此免费解锁多模式与二维匹配; AC 自动机则是 KMP 的多模式推广——把 pattern 集合建成 Trie, fail 指针在 Trie 上完成同样的"滑到自己最长的真后缀前缀"。选型口诀: **单模式要确定性 → KMP/Z; 多模式 → AC; 要哈希才能做的题 (二维/重复子串/随机化) → Rabin-Karp**。

读完应能：

1. 默写前缀函数 $\pi$ 与 Z 函数的定义, 并说清两者的相互转化;
2. 解释 KMP 为什么是摊还线性 (势能论证), 以及"text 不回退"靠的是什么;
3. 手写滚动哈希的窗口更新公式, 并说出双模数防卡的原因;
4. 描述 AC 自动机 fail 指针的语义与 BFS 构建顺序。

---

## 思想链

```
问题: 长度 n 的 text 里找长度 m 的 pattern 所有出现
  └─► 暴力: 失配就从头再来 ─► O(nm) ─► 已匹配的前缀被白白扔掉
        └─► 关键观察: 已匹配前缀 = pattern 的一个前缀
              └─► 它自己内部的"前缀=后缀"重叠可以复用!
                    ├─ 前缀函数 π[i]: p[..i] 的最长相等真前后缀 ─► KMP
                    │     └─► text 指针不回退, pattern 跳到 π ─► O(n+m) 确定性
                    ├─ Z[i]: s[i..] 与 s 的 LCP ─► 同样信息的另一种记账 ─► Z 算法
                    └─ 不比较字符, 比较指纹?
                          └─► 多项式滚动哈希 ─► Rabin-Karp 期望 O(n+m)
                                └─► 指纹可批量算 ─► 多模式 / 二维 / +二分求重复子串
  └─► 一次扫 text 同时找 k 个 pattern?
        └─► 把 k 个 pattern 建成 Trie, KMP 的 π 推广成 fail 指针 ─► AC 自动机
              └─► fail(u) = u 串的最长真后缀 ∩ Trie 中存在的节点
```

## 形式化定义

给定文本 $s[0..n)$ 与模式 $p[0..m)$。**匹配问题**: 求所有 $i$ 使得 $s[i..i+m) = p$。约定字符集大小为 $\sigma$。

**前缀函数** $\pi[i]$: 子串 $p[0..i]$ 的最长相等**真**前后缀长度 ($\pi[0] = 0$, "真"排除整个子串自身)。例: `ababab` 的 $\pi = [0,0,1,2,3,4]$。

**Z 函数** $z[i]$: 后缀 $s[i..n)$ 与 $s$ 本身的最长公共前缀长度 ($z[0] = n$)。例: `aabxaab` 的 $z = [7,1,0,0,3,1,0]$。

两者编码同一信息, 可 $O(n)$ 互转; 工程上 Z 更直观, KMP 的 $\pi$ 在失配跳转上更顺手。

> [!NOTE]
> 为什么暴力会退化到 $O(nm)$? 最坏情形 `aaaa...a` 里找 `aaa...ab`: 每次失配只前进一格。KMP 的全部工作就是把这种"重复比较"消灭掉——而它用的工具正是 [摊还分析](../algorithms/complexity/amortized.md) 里的势能法。

## KMP: 前缀函数与失配跳转

**核心机制**：设当前已匹配了 $k$ 个字符 (即 $s[j-k..j) = p[0..k)$), 下一位失配。暴力把 $j$ 回退; KMP 注意到已匹配段是 $p$ 的前缀, 若该前缀有长度为 $\pi[k-1]$ 的相等真前后缀, 则**这两段后缀已经和 text 对齐过了**——直接把 $k$ 跳到 $\pi[k-1]$, $j$ 一动不动:

```text
text : ... a b a b | c ...
patt :     a b a b | a        ← 失配在 c vs a
π[3]=2: "abab" 有真前后缀 "ab" 相等
patt :         a b | a b a    ← k 直接跳到 2, text 指针没动过!
```

```python
def build_next(p: str) -> list[int]:
    """前缀函数 π. π[i] = p[..i+1] 的最长相等真前后缀长度. O(m)."""
    nxt = [0] * len(p)
    k = 0
    for i in range(1, len(p)):
        while k > 0 and p[k] != p[i]:
            k = nxt[k - 1]               # 失配: 沿 π 链回退到次长候选
        if p[k] == p[i]:
            k += 1
        nxt[i] = k
    return nxt


def kmp(s: str, p: str) -> list[int]:
    """返回 p 在 s 中的全部起始下标. O(n + m)."""
    if not p:
        return []
    nxt, hits, k = build_next(p), [], 0
    for i, c in enumerate(s):
        while k > 0 and p[k] != c:
            k = nxt[k - 1]
        if p[k] == c:
            k += 1
        if k == len(p):                  # 完整命中
            hits.append(i - k + 1)
            k = nxt[k - 1]               # 继续找下一个 (允许重叠)
    return hits


if __name__ == "__main__":
    assert build_next("ababab") == [0, 0, 1, 2, 3, 4]
    assert build_next("abcdabc") == [0, 0, 0, 0, 1, 2, 3]
    assert kmp("ababcababcabd", "abc") == [2, 7]
    assert kmp("aaaa", "aa") == [0, 1, 2]          # 重叠匹配
    assert kmp("hello", "xz") == []
```

**为什么是线性的**——势能论证: 主循环里 $k$ 每次至多 $+1$, 所以全程增量 $\le n$; 而 `while` 循环每转一圈 $k$ 严格变小且永不为负, 总下降次数 $\le$ 总上升次数 $\le n$。两段相加 $O(n)$。构造阶段同理 $O(m)$。

## Z 算法: 同一信息的另一种记法

$z[i]$ 的维护利用一条性质: **已知区间 $[l, r)$ 是当前最右的匹配段** (某后缀与 $s$ 的 LCP 达到过这里), 则 $z[i]\ (i < r)$ 至少是 $\min(z[i-l],\ r-i)$——因为 $s[i..r)$ 与 $s[i-l..r)$ 完全相同, 可以抄作业, 抄完再暴力扩展。均摊分析同 KMP: 右端点 $r$ 只增不减, $O(n)$。

典型用法——模式匹配转"自匹配":

```python
def z_func(s: str) -> list[int]:
    """z[0] = n; z[i] = s[i..] 与 s 的 LCP. O(n)."""
    n = len(s)
    z = [0] * n
    z[0] = n
    l = r = 0                                  # 当前已知最右匹配区间 [l, r)
    for i in range(1, n):
        if i < r:
            z[i] = min(z[i - l], r - i)        # 抄镜像位置作业, 截断到 r
        while i + z[i] < n and s[z[i]] == s[i + z[i]]:
            z[i] += 1                          # 超出抄来的部分, 暴力扩
        if i + z[i] > r:
            l, r = i, i + z[i]
    return z


if __name__ == "__main__":
    assert z_func("aabxaab") == [7, 1, 0, 0, 3, 1, 0]
    assert z_func("aaaa") == [4, 3, 2, 1]
    t, p = "ababcabd", "abc"
    zz = z_func(p + "#" + t)                   # 分隔符保证 LCP 不会越过 p
    m = len(p)
    hits = [(i - m - 1) for i in range(m + 1, len(zz)) if zz[i] >= m]
    assert hits == [2]                         # 换算回 text 下标
```

> [!TIP]
> KMP 与 Z 的选择: 求"period / border / 最短循环节"用 $\pi$ (`n - π[n-1]` 即最小周期, 且 `n % (n-π[n-1]) == 0` 时整串由它循环构成); 求"每个后缀和谁像"用 $z$。两者都值得手熟, 但竞赛中 Z 通常更好写对。

## Rabin-Karp: 指纹代替逐字符比较

把长度 $m$ 的窗口看作 $\sigma$ 进制多项式取模: $h(s[i..i+m)) = \sum s[i+j] \cdot b^{m-1-j} \bmod M$。窗口右移一格只需**减最高位、乘底、加最低位**, $O(1)$:

$$h_{i+1} = (h_i - s_i \cdot b^{m-1}) \cdot b + s_{i+m} \pmod M$$

哈希相等只是必要条件, 还需一次真比较兜底; 期望复杂度 $O(n+m)$ (哈希冲突概率 $\approx n/M$)。

```python
def rabin_karp(s: str, p: str, base: int = 131, mod: int = (1 << 61) - 1) -> list[int]:
    """滚动哈希匹配. 期望 O(n+m); mod 取梅森素数便于取模."""
    m, n = len(p), len(s)
    if m == 0 or m > n:
        return []
    B = pow(base, m - 1, mod)
    hp = hs = 0
    for i in range(m):
        hp = (hp * base + ord(p[i])) % mod
        hs = (hs * base + ord(s[i])) % mod
    hits = []
    for i in range(n - m + 1):
        if hs == hp and s[i:i + m] == p:       # 哈希相等后再做一次真比较
            hits.append(i)
        if i + m < n:
            hs = ((hs - ord(s[i]) * B) * base + ord(s[i + m])) % mod
    return hits


if __name__ == "__main__":
    assert rabin_karp("ababcababcabd", "abab") == [0, 5]
    assert rabin_karp("aaaa", "aa") == [0, 1, 2]
    assert rabin_karp("hello", "xz") == []
```

哈希路线独有的三块领地：

1. **多模式同长匹配**: $k$ 个模式的指纹先算好, text 每个 $O(1)$ 窗口查哈希集合;
2. **二维匹配**: 先对每行滚动哈希压成列指纹, 再对列方向滚一遍——降维打击, KMP 做不到这么自然;
3. **最长重复子串**: "存在长度 $L$ 的重复子串"单调, 二分 $L$ + 哈希判重, $O(n \log n)$。

> [!WARNING]
> 固定 base + 常见 mod 的哈希在竞赛里**会被针对性构造数据卡掉**。对策: 双模数 (或 base/mod 运行时随机)。工程上还要注意 Python 大整数 `%` 的常数、以及 `mod = 2**64` 这类合数模对特定模式 (如 Thue-Morse 序列) 存在系统性反例——用大素数更稳。

## AC 自动机: KMP 的多模式推广

$k$ 个模式各跑一遍 KMP 是 $O(nk)$; AC 自动机把它压到 $O(\Sigma|p_i| + n + \text{hits})$:

1. **建 Trie**: 所有 pattern 插入同一棵字典树;
2. **BFS 建 fail 指针**: $fail(u)$ 指向"$u$ 所代表字符串的**最长真后缀**, 且该后缀也是 Trie 中某个节点"——正是 KMP 前缀函数的多分支版。构建沿 BFS 层序: 子节点的 fail 从父节点的 fail 的对应儿子继承 (没有就继续沿 fail 链爬);
3. **扫描 text**: 在 Trie 上走, 失配沿 fail 跳; 每走到一个节点, 沿 fail 链收集所有以当前位置结尾的模式 (输出链)。

```python
from collections import deque


class AhoCorasick:
    def __init__(self):
        self.children = [{}]                 # children[u][c] = v
        self.fail = [0]
        self.out = [0]                       # out[u] = 以 u 结尾的模式个数

    def add(self, p: str) -> None:
        u = 0
        for c in p:
            if c not in self.children[u]:
                self.children[u][c] = len(self.children)
                self.children.append({})
                self.fail.append(0)
                self.out.append(0)
            u = self.children[u][c]
        self.out[u] += 1                     # 允许重复模式

    def build(self) -> None:
        q = deque()
        for v in self.children[0].values():  # 根的儿子 fail = 根
            q.append(v)
        while q:
            u = q.popleft()
            f = self.fail[u]
            self.out[u] += self.out[f]       # 输出链前缀和: 顺带统计后缀模式
            for c, v in self.children[u].items():
                # 找 u.fail 沿链第一个有 c 儿子的祖先
                while f and c not in self.children[f]:
                    f = self.fail[f]
                self.fail[v] = self.children[f][c] if c in self.children[f] \
                    and self.children[f][c] != v else 0
                q.append(v)

    def count(self, s: str) -> int:
        """s 中出现的模式总次数 (含作为其他模式后缀的情形)."""
        total, u = 0, 0
        for c in s:
            while u and c not in self.children[u]:
                u = self.fail[u]
            u = self.children[u].get(c, 0)
            total += self.out[u]
        return total


if __name__ == "__main__":
    ac = AhoCorasick()
    for w in ["he", "she", "his", "hers"]:
        ac.add(w)
    ac.build()
    assert ac.count("ushers") == 3             # she / he / hers
    assert ac.count("hishers") == 4            # his / she(跨 3..5) / he / hers
```

适用场景全是工程刚需：敏感词过滤、IDS 入侵特征扫描、日志关键字聚合、DNA motif 搜索。模式库静态时还可把 Trie 补满成 **goto 表** (双数组 Trie / 自动机转移表), 让扫描完全无跳转。

## 进阶索引

| 算法 | 复杂度 | 一句话用途 |
|------|--------|-----------|
| Manacher | $O(n)$ | 最长回文子串 (插入分隔符统一奇偶) |
| 后缀数组 + LCP | $O(n \log n)$, SA-IS $O(n)$ | 不同子串计数 / 反复子串 / 多串 LCS |
| 后缀自动机 SAM | $O(n)$ | endpos 等价类; 子串问题全能选手 |
| Lyndon / Runs | $O(n)$ | 字符串最小循环表示 |

## 易错清单

1. **KMP 命中后的续接**: `k = nxt[k-1]` 忘写则只能找到第一个匹配;
2. **Z 函数的分隔符**: `p#t` 里的 `#` 必须不在字符集中, 否则 LCP 会跨进 t 继续匹配;
3. **滚动哈希的窗口更新顺序**: 先减最高位再乘底, 写反会把旧低位卷进来;
4. **AC 自动机构建的层序**: 必须 BFS (短后缀先于长后缀就绪), DFS 会用到尚未计算的 fail;
5. **重叠匹配语义**: 问清"可否重叠"——KMP/Z 天然支持, 有些题要求命中后 `i += m`;
6. **Unicode vs 字节**: Python 按 code point 切片, Go 按 byte; 含中文的匹配先想清楚单位。

## 经典题

- LC 28 找出字符串中第一个匹配项 (KMP/RK 双解);
- LC 459 重复的子字符串 (`n % (n - π[n-1]) == 0`);
- LC 214 最短回文 (KMP 于 `s#reverse(s)` 上跑);
- LC 3007 最长重复子串 (RK + 二分);
- LC 718 最长重复子数组 (RK 降维 / DP 对照);
- LC 336 回文对 (Trie + 构造性分类讨论);
- 洛谷 P3808 AC 自动机 (简单版) / P3796 (出现次数最多);
- POJ 2752 Seek the Name (border 链枚举)。

## 一页速查

```
π[i]:   p[..i] 最长相等真前后缀;  失配跳 k=π[k-1];  text 不回退 ⇒ O(n+m)
周期:   最小周期 = n - π[n-1];  整除 ⇔ 整串循环
z[i]:   s[i..] 与 s 的 LCP;  区间 [l,r) 抄作业 min(z[i-l], r-i)
RK:     h'=(h-s_i·b^{m-1})·b+s_{i+m};  命中须真比较;  防卡用双模/随机
        独占领地: 多模式同长 / 二维 / +二分求重复子串
AC:     Trie + fail(BFS 层序);  fail=最长真后缀节点;  out 沿 fail 前缀和
选型:   单模式确定→KMP/Z;  多模式→AC;  结构类问题(回文/重复)→Manacher/SA/SAM
```

下一篇: [数论与模运算](number-theory.md)。
