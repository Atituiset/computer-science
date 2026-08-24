# 数论与模运算

## 一句话

模运算的本质是**把无限的整数世界投影到有限的商结构 $\mathbb{Z}/m\mathbb{Z}$ 里**: 加法和乘法在投影下保持同态, 所以"只关心余数"的算法可以一路取模不膨胀; 当 $m$ 是素数时投影后的结构更进一步成为**域**——非零元素全部可逆, 于是"除法"变成乘逆元 $a^{p-2}$; 而中国剩余定理说的是"多个小模下的余数可以唯一拼回一个大模下的答案", 这是 RSA 解密 4 倍加速和大数并行计算的共同底座。竞赛与工程的绝大多数数论代码, 都是这四件事的排列组合: **快速幂 (对数时间做指数)、gcd/exgcd (线性结构的骨架)、逆元 (模下除法)、筛法 (批量质因子)**。

读完应能：

1. 说清为什么 $m$ 为素数时 $\mathbb{Z}/m$ 是域, 以及费马小定理如何把逆元变成一次快速幂;
2. 默写快速幂与扩展欧几里得 (Python + Go), 并用 Bézout 恒等式解释 exgcd 的回溯式;
3. 解释线性筛为什么恰好 $O(n)$——每个合数被其**最小质因子**筛掉且仅一次;
4. 写出 CRT 合并公式, 并说明 RSA-CRT 加速的原理。

---

## 思想链

```
问题: 无限大的整数算不动 / 存不下, 怎么办?
  └─► 只保留除以 m 的余数 ─► Z/mZ: 加乘封闭且同态
        ├─ 指数爆炸? ─► 幂也同态: a^k mod m 可按 k 的二进制平方乘 ─► O(log k)
        ├─ 要做"除法"?
        │     ├─ m 素数 ─► 域! 非零元可逆 ─► a⁻¹ = a^(p-2) (费马小定理)
        │     └─ 一般 m ─► gcd(a,m)=1 才有逆 ─► exgcd 求 ax+my=1 的 x
        │           └─► 批量求逆? inv[i] = -(m/i)·inv[m%i] mod m ─► O(n) 递推
        └─ 大模 M 太大算得慢?
              └─► M = p·q 分解成两个小模分别算 ─► CRT 唯一拼回
                    └─► RSA 解密 / NTT / 大数并行的同一招
质数从哪来? ─► Eratosthenes O(n log log n); 线性筛 O(n) 用最小质因子
大数判素?   ─► 试除到 √n 不够用 ─► Miller-Rabin 概率判素 (crypto 标配)
```

## 形式化定义

**同余**：$a \equiv b \pmod m$ 当且仅当 $m \mid a-b$。它把整数划分成 $m$ 个等价类, 全体等价类记作 $\mathbb{Z}/m\mathbb{Z}$——加法、乘法定义良好 (换代表元不变), 即商环。

**单位群**：$(\mathbb{Z}/m\mathbb{Z})^\times = \{a : \gcd(a, m) = 1\}$, 元素个数是欧拉函数 $\varphi(m)$。关键分界:

- $m$ **合数**: 单位群里才有逆元, 非单位 (如 $2 \bmod 4$) 连乘法可逆都保证不了;
- $m$ **素数**: 所有非零元都是单位, $\mathbb{Z}/p$ 成为**域**——这是"模素数下可以放心做除法"的精确含义。

**费马小定理**：$p$ 素数、$p \nmid a$ 时 $a^{p-1} \equiv 1$, 移项即得逆元公式 $a^{-1} \equiv a^{p-2} \pmod p$。一般模下对应欧拉定理 $a^{\varphi(m)} \equiv 1$。

> [!NOTE]
> "模运算下不能直接比大小、不能直接除"这两条直觉限制, 都能从商环结构读出: 同一类里大小可以任意 (加 $km$ 就翻盘), 而"除法"是否存在取决于操作数是否为单位。数学预备见 [离散数学 · 代数结构](../../math/discrete.md)。

## 快速幂: 对数时间的指数

把指数写成二进制, 反复平方:

```python
def pow_mod(a: int, n: int, m: int) -> int:
    """a^n mod m. O(log n) 次乘法. 支持负指数? 不支持, 先求逆."""
    r, a = 1, a % m                      # 先归约底数
    while n:
        if n & 1:
            r = r * a % m                # 当前二进制位为 1: 收入结果
        a = a * a % m                    # 底数自乘: a^(2^i)
        n >>= 1
    return r


if __name__ == "__main__":
    assert pow_mod(2, 10, 1000) == 24            # 1024
    assert pow_mod(7, 0, 13) == 1                # 空积 = 单位元
    assert pow_mod(3, 1000000006, 1000000007) == 1   # 费马小定理: p-1 次幂归一
    assert pow_mod(5, 3, 7) == 125 % 7 == 6      # 与先算后取模一致
```

### Go (含俄式乘法防溢出)

```go
package main

import "fmt"

// MulMod 俄式乘法: 中间结果永不溢出 int64. O(log b).
func MulMod(a, b, m int64) int64 {
	res := int64(0)
	a %= m
	for b > 0 {
		if b&1 == 1 {
			res = (res + a) % m
		}
		a = (a * 2) % m
		b >>= 1
	}
	return res
}

// PowMod 快速幂: O(log n) 次乘法.
func PowMod(a, n, m int64) int64 {
	var r int64 = 1
	a %= m
	for n > 0 {
		if n&1 == 1 {
			r = MulMod(r, a, m) // 大模下改用 MulMod 防 (r*a) 溢出
		}
		a = MulMod(a, a, m)
		n >>= 1
	}
	return r
}

func main() {
	fmt.Println(PowMod(2, 10, 1000))              // 24
	fmt.Println(PowMod(3, 1000000006, 1000000007)) // 1
}
```

> [!WARNING]
> Go 的 `r * a` 在 $m \sim 10^{18}$ 时中间值达 $10^{36}$, 直接溢出。三条路: `MulMod` (俄式乘法, 上面的实现)、`big.Int` (慢但稳)、或依赖平台 `__int128` (GCC/Clang 扩展)。Python 无此烦恼——原生大整数, 但也因此慢一个量级。

## GCD 与扩展欧几里得

$\gcd(a, b) = \gcd(b, a \bmod b)$ 的几何本质: 辗转相减的加速版。**扩展版**额外解出 Bézout 恒等式 $ax + by = \gcd(a,b)$ 的整系数 $(x,y)$——递归到底再原路回代:

```python
def exgcd(a: int, b: int) -> tuple[int, int, int]:
    """返回 (g, x, y): ax + by = g = gcd(a, b)."""
    if b == 0:
        return a, 1, 0                     # a·1 + 0·0 = a
    g, x1, y1 = exgcd(b, a % b)
    # b·x1 + (a%b)·y1 = g; 代入 a%b = a - (a//b)·b 整理:
    return g, y1, x1 - (a // b) * y1


def inv(a: int, m: int) -> int | None:
    """a 在 mod m 下的逆元; 不存在返回 None. gcd(a,m)=1 ⇔ 可逆."""
    g, x, _ = exgcd(a % m, m)
    return x % m if g == 1 else None


if __name__ == "__main__":
    assert exgcd(30, 18) == (6, -1, 2)     # 30·(-1) + 18·2 = 6
    assert inv(3, 11) == 4                 # 3·4 = 12 ≡ 1 (mod 11)
    assert inv(4, 8) is None               # gcd(4,8)=2 ≠ 1
```

**批量逆元** ($O(n)$, 竞赛常用)：设 $inv[i] = -\lfloor m/i \rfloor \cdot inv[m \bmod i] \bmod m$——由 $m = \lfloor m/i\rfloor \cdot i + m \bmod i$ 两边同乘 $inv[i]$ 整理而来, 把大问题挂到更小的余数上。

## 筛法: 批量生产质数

```python
def linear_sieve(lim: int) -> list[int]:
    """线性筛: 每个合数被最小质因子标记恰一次 ⇒ O(lim)."""
    f = [False] * (lim + 1)
    primes: list[int] = []
    for i in range(2, lim + 1):
        if not f[i]:
            primes.append(i)               # i 未被任何更小质数划掉 ⇒ i 是质数
        for p in primes:
            if i * p > lim:
                break
            f[i * p] = True
            if i % p == 0:
                break                      # 关键: p 恰是 i*p 的最小质因子, 后面交给更大的 i
    return primes


if __name__ == "__main__":
    ps = linear_sieve(100)
    assert len(ps) == 25 and ps[-1] == 97
    assert ps[:10] == [2, 3, 5, 7, 11, 13, 17, 19, 23, 29]
```

正确性两句话: (1) 每个合数 $n$ 写成 $p \cdot i$ 且 $p$ 取其最小质因子时, $i$ 一定在枚举中出现过; (2) 内层循环在 `i % p == 0` 时 break, 保证不会用更大的质数重复标记同一个合数。两者合起来——每合数恰标一次, 总操作数 $O(n)$。

> [!TIP]
> 只要"最小质因子"这个副产品有用 (分解质因数、欧拉/莫比乌斯函数线性筛), 就选线性筛; 只要质数列表本身, Eratosthenes 位压版更快更好写。

## Miller-Rabin: 大数的概率判素

试除到 $\sqrt{n}$ 对 $10^{18}$ 级别毫无意义 (要 $10^9$ 次)。Miller-Rabin 把费马小定理升级成随机测试: 若 $p$ 是奇素数, 则对任意 $a$, 平方链 $a^d, a^{2d}, \dots, a^{2^s d}$ ($n-1 = 2^s d$) 要么中途出现 $-1$, 要么终点是 $1$; 违反即铁证合数。**固定底数组合 {2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37} 对 $< 3.3 \times 10^{24}$ 无假阳性**——密码学生成大素数时配合随机底数使用 (详见 [非对称加密](../../crypto/asymmetric.md))。

## 中国剩余定理: 小模拼大模

$m_1, m_2$ 互质时, 方程组 $x \equiv a_1 \pmod{m_1}, x \equiv a_2 \pmod{m_2}$ 在 $\bmod\ m_1 m_2$ 下有唯一解:

$$x = a_1 + m_1 \cdot \underbrace{\big((a_2 - a_1) \cdot m_1^{-1} \bmod m_2\big)}_{\text{补的倍数}}$$

直觉: 先满足第一个约束, 再以 $m_1$ 为步长微调去命中第二个——因为 $\gcd(m_1, m_2)=1$, 步长扫遍所有剩余类, $m_1^{-1}$ 只是让"扫"变成"直达"。多组同理逐两合并 (exCRT 处理不互质情形, 合并时检查 $\gcd(m_1,m_2) \mid (a_2-a_1)$)。

工程最大牌的应用是 **RSA-CRT 解密加速**: $c^d \bmod N$ ($N=pq$) 拆成 $\bmod\ p$ 与 $\bmod\ q$ 各算一次 (指数先用 $\varphi$ 缩短), 再 CRT 拼回——两次模幂的位数减半, 平方复杂度下合计快约 4 倍 (细节见 [RSA 与 ECC](../../crypto/asymmetric.md))。

## 易错清单

1. **负数取模语义分裂**: Python `-1 % 5 == 4`, C/C++/Java 得 `-1`; 跨语言代码统一 `(a % m + m) % m`;
2. **模下无序**: `(a%m) > (b%m)` 推不出 `a > b`; 涉及比较的逻辑先在真实值域完成;
3. **中间乘法溢出**: 见上文 Go 版 `MulMod` 三选项;
4. **逆元存在性**: 忘查 `gcd(a, m) = 1`, exgcd 会安静地给你一个不是逆元的数;
5. **快速幂底数为 0**: `pow_mod(0, 0, m)` 返回 1 (空积约定), 但 `0^k (k>0)` 必须 0——模板已兼容, 自己手写时留意;
6. **筛法边界**: `lim < 2` 时返回空表; `f[i*p]` 先于 `break` 判断, 顺序反了会漏标。

## 经典题

- LC 50 Pow(x, n) (快速幂直通车);
- LC 149 直线上最多的点数 (分数化最简 → gcd);
- LC 1015 可被 K 整除的最小整数 (鸽巢 + 同余循环);
- LC 1808 好因子的最大数目 (积性函数 + 费马小定理);
- 洛谷 P1226 【模板】快速幂;
- 洛谷 P3811 【模板】乘法逆元 (线性递推);
- 洛谷 P4777 【模板】扩展中国剩余定理 (exCRT);
- POJ 1811 Prime Test (Miller-Rabin + Pollard Rho)。

## 一页速查

```
结构:   Z/m 是环; m 素数 ⇒ 域 ⇒ 非零全可逆
快速幂: 指数二进制 + 平方乘 O(log n); 大模乘法防溢出 (俄式/big.Int/__int128)
逆元:   p 素数: a^(p-2) | 任意 m: exgcd 解 ax+my=1 | 批量: inv[i]=-⌊m/i⌋·inv[m%i]
exgcd:  回溯式 (g,x,y)=(b→y1, x1-⌊a/b⌋·y1); gcd=1 ⇔ 逆元存在
筛法:   线性筛 = 最小质因子恰标一次; 附赠 lp[] 分解质因数
判素:   n<2^32 试除√n; 更大用 Miller-Rabin 固定底组合
CRT:    x=a1+m1·((a2-a1)·m1⁻¹ mod m2); 互质⇒mod M 唯一解; RSA-CRT 提速 ~4×
坑:     负数取模跨语言不同 | 模下不可比大小 | 逆元前查 gcd
```

回到本部分: [主题专题](README.md)。
