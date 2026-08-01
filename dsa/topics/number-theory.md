# 数论与模运算

## 核心公式

### 模运算基础
- `(a + b) mod m = ((a mod m) + b) mod m`
- `(a · b) mod m = ((a mod m) · (b mod m)) mod m`
- **除法**: 模意义下不能直接除, 用乘法逆元.

### 快速幂

```python
def pow_mod(a, n, m):
    r = 1; a %= m
    while n:
        if n & 1: r = r * a % m
        a = a * a % m
        n >>= 1
    return r
```

### 乘法逆元

`a⁻¹ mod p` 当 p 为素数: `a^{p-2} mod p` (费马小定理).
扩展欧几里得可求任意 coprime (a, m) 的逆元.

### GCD + 扩展欧几里得

```python
def exgcd(a, b):
    if b == 0: return a, 1, 0
    g, x1, y1 = exgcd(b, a % b)
    return g, y1, x1 - (a // b) * y1   # ax + by = g
```

### 线性筛素数

```python
def sieve(lim):
    f = [False] * (lim + 1)
    primes = []
    for i in range(2, lim + 1):
        if not f[i]: primes.append(i)
        for p in primes:
            if i * p > lim: break
            f[i * p] = True
            if i % p == 0: break
    return primes
```

每个合数被最小质因子筛一次 ⇒ O(n).

### 中国剩余定理 CRT

求 x satisfying `x ≡ a_i (mod m_i)`, m_i 互质时模 M = ∏m_i 下唯一解.

工程用法: NTRU / RSA 性能加速 - 模 prime 后 CRT 还原.

## 工程实战场景

- **大质数取模**: Dijkstra / SPFA 路径哈希防冲突.
- **哈希**: 背面 64-bit 滚动哈希的双哈希常数.
- **概率素性测试**: Miller-Rabin 多用于 crypto.
- **椭圆曲线 / 离散对数**: 现代 crypto 基础.

## 易错

1. **负数取模**: Python `-1 % 5 == 4`; C/C++ `-1 % 5 == -1`, 要 `(a%m+m)%m`.
2. **模意义下大小关系无意义**: 你不能 `if (a % m) > (b % m)` 来推断实际大小.
3. **乘法溢出**: 64-bit 模下乘法 O(128) 中间溢出, 需要 `__int128` 或快速乘 (俄式乘法).
