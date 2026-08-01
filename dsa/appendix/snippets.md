# Snippets

## Python 快速 IO 与递归调高

```python
import sys
sys.setrecursionlimit(10**6 + 10)
input = sys.stdin.readline  # 一行快速读
print = sys.stdout.write    # 快写（写入需要 \n 换行）
```

## Go 高效查找 / bitset

```go
// 找第一个 >= x 的位置（lower_bound）
func lowerBound(a []int, x int) int {
    L, R := 0, len(a)
    for L < R {
        M := L + (R-L) >> 1
        if a[M] < x { L = M + 1 } else { R = M }
    }
    return L
}

// 位集合 (固定大小)
type Bitset struct{ bits []uint64 }
func NewBitset(n int) *Bitset { return &Bitset{bits: make([]uint64, (n+63)>>6)} }
func (b *Bitset) Set(i int) { b.bits[i>>6] |= 1 << (uint(i) & 63) }
func (b *Bitset) Get(i int) bool { return b.bits[i>>6] & (1 << (uint(i) & 63)) != 0 }
func (b *Bitset) Count() int {
    c := 0
    for _, x := range b.bits { c += bits.OnesCount64(x) }
    return c
}
```

## TypeScript 工具

```ts
function lowerBound(a: number[], x: number): number {
  let L = 0, R = a.length;
  while (L < R) {
    const M = L + ((R - L) >> 1);
    if (a[M] < x) L = M + 1; else R = M;
  }
  return L;
}
```

## C++ 快读快写

```cpp
inline int read() {
    int x = 0, f = 1; char c = getchar_unlocked();
    while (c < '0' || c > '9') { if (c == '-') f = -1; c = getchar_unlocked(); }
    while (c >= '0' && c <= '9') { x = x * 10 + c - '0'; c = getchar_unlocked(); }
    return x * f;
}
inline void write(int x) {
    if (x < 0) { putchar_unlocked('-'); x = -x; }
    if (x >= 10) write(x / 10);
    putchar_unlocked(x % 10 + '0');
}
```
