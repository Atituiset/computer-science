# 3. 无损压缩: 哈夫曼 / LZ77 / LZ78 / zstd / 算术编码 / ANS

## TL;DR

无损压缩把信源 $X$ 的串 $x^n$ 编码成长度 $L(x^n)$ bits, $L$ 越接近 $H(X)$ 越优 (Shannon 信源编码定理). 三大家:
1. **熵编码 (entropy coding)**: Huffman / 算术 / ANS — 给 symbol variable-length code based on frequency.
2. **字典编码 (dictionary coding)**: LZ77 / LZ78 / LZW — 滑动窗子串匹配 reference (GZIP / zlib).
3. **现代融合**: zstd / Brotli / LZ4 = LZ77 + 熵编码 + dedup + dictionary training.

---

## 一、Huffman 编码 (1952)

### 1.1 Greedy tree-building

1. Every symbol initial node weighted by $p_i$.
2. 取 two lowest-weight nodes, create parent weighted by sum.
3. Repeat until one tree.
4. Path from root to each leaf gives codeword.

```python
import heapq

def huffman(prob_symbols: dict) -> dict:
    heap = [[p, [sym, ""]] for sym, p in prob_symbols.items()]
    heapq.heapify(heap)
    while len(heap) > 1:
        lo = heapq.heappop(heap); hi = heapq.heappop(heap)
        for pair in lo[1:]: pair[1] = '0' + pair[1]
        for pair in hi[1:]: pair[1] = '1' + pair[1]
        heapq.heappush(heap, [lo[0] + hi[0]] + lo[1:] + hi[1:])
    return dict(heapq.heappop(heap)[1:])

print(huffman({'a': 0.4, 'b': 0.2, 'c': 0.15, 'd': 0.1, 'e': 0.1, 'f': 0.05}))
# {'a': '0', 'b': '10', 'c': '110', 'd': '1110', 'e': '11110', 'f': '11111'}
```

### 1.2 Bound

$$ H(X) \leq L_{\text{Huffman}} \leq H(X) + 1 $$

Huffman 每个 symbol 花整数 bit ⇒ 平均长度最多 over entropy 1 bit.

---

## 二、算术编码 (Rissanen 1976)

不要每个 symbol 给独立 coding — **作为区间**编码: 整个 message 映射到 [0, 1) 子区间. 分数 bit per symbol.

### 2.1 Algorithm

Initial interval $[0, 1)$. For each symbol $x$:
$$ \text{new range} = [\text{low} + r \cdot \text{CDF}_x^{\min}, \text{low} + r \cdot \text{CDF}_x^{\max}) $$

最后 range 内任一数即可编码.

### 2.2 与 Huffman 对比

- Length $\in [H(X^n), H(X^n) + 1)$ bits for 整个 message — 接近完美 entropy.
- Encoding/decoding carry multiplication / division ⇒ 慢 vs Huffman.
- PPM (Prediction by Partial Matching) 在 arithmetic coding 上加 statistical model.

---

## 三、LZ77 (Ziv-Lempel 1977) — GZIP 内核

**滑动窗**回看前一区 reference. 找最长 match with current. Output `(distance, length, next_char)`.

### 3.1 Encode example 串 "ababab..."

```
pos 0: 'a' → (0,0,'a')
pos 1: 'b' → (0,0,'b')
pos 2: 'aba...' → back 2 chars match 'ab', copy 2. → (2,2,EOF)
```

### 3.2 LZSS refinement

`flag_bit + (distance, length)` 或 `flag_bit + literal`. 长 match 复用更长公共.

### 3.3 解码

Maintain running output buffer; `(d, l)` 指 copy l chars starting d positions back. Fast, ~1 cycle/bit decompress.

---

## 四、LZ78 / LZW (Welch 1984, GIF / Unix compress)

### 4.1 Algorithm

- 初始化 dictionary 含 256 ASCII single chars.
- For input: search for longest prefix already in dict.
- Output longest prefix index. Add (longest prefix + next char) to dict.

例 "TOBEORNOTTOBE":

```
Step  | output | new dict entry
T     |  84    | 256 "TO"
O     |  79    | 257 "OB"
B     |  66    | 258 "BE"
E     |  69    | 259 "EO"
R     |  82    | 260 "RN"
N     |  78    | 261 "NO"
T     |  84    | 262 "TT"
TO    |  256   | 263 "TOB"
```

→ 长 input gets exponentially efficient.

---

## 五、DEFLATE (RFC 1951) — GZIP / zlib / PNG 内部

`gzip` 内: LZ77 (window 32 KB) + Huffman entropy coding:
1. Run LZ77 on input → tokens (literal bytes + match distance-length).
2. Gen Huffman coding for literals + Huffman coding for distances.
3. Stream encode.

Default zlib ~50-100 MB/s encode, 200-500 MB/s decode. **Most-used HTTP** 压缩 (Content-Encoding: gzip).

---

## 六、zstd (Facebook / Zstandard, 2015)

Modern drop-in replacement for zlib:
- 1.x: 3-5× 更快 decompression than zlib at same ratio.
- 训练 dictionaries 给小 files 3× better ratio.
- CLI multi-thread default.

```bash
zstd file.txt                      # level 3 default
zstd -19 file.txt                  # max ratio
zstd --train ./training/*.txt -o dict.bin
zstd -D dict.bin small.json
```

### zstd 内部:
- Block size 128 KB.
- "FSE" 有限状态熵编码 (Finite State Entropy), 类 rANS / tANS — interleaved 状态编码.
- 窗 1 KB - 8 MB.
- LZ77 + FSE 组合.

---

## 七、Brotli (Google 2015)

HTTP `Content-Encoding: br` 主用.
- Static dictionary 120 KB 内置 common strings.
- LZ77 + Context modeling + Huffman.
- 比gzip 5-25% better for HTTP text content.
- Chrome 2016+ 默认启用.

---

## 八、LZ4 (Collet 2011)

Extreme fast. ~500 MB/s compress, 4 GB/s decompress.
- 16-bit match length, 4-byte minimum match.
- 不熵编码.
- 用 ZFS pool, Apache Arrow streaming, hot path Java log.

---

## 九、ANS (Asymmetric Numeral Systems, Duda 2009)

ANS 是 LZ77 与 arithmetic 之间 hybrid. 用 integer $x$ 描述 entropy stream.

### 9.1 Algorithm core

State $x \in \mathbb{Z}$. For symbol $s$ with probability $p_s$ (frequency $L_s$ of total $L$):

$$x' = (\lfloor x / L_s \rfloor \cdot L) + (x \bmod L_s) + c_s$$

→ 在 [0, L) 内自然 move 通过 symbol 概率分布, 解码可逆.

### 9.2 Python rANS prototype

```python
def rans_encode(state: int, symbols: list, freq_table: dict, total: int) -> int:
    x = state
    for sym in symbols:
        f, c = freq_table[sym]
        if x >= (1 << 32) // f:            # need renormalization (output low bits)
            ...                            # omitted, in practice use streaming version
        x = (x // f) * total + (x % f) + c
    return x

def rans_decode(state: int, freq_table: dict, total: int) -> tuple:
    slot = state % total
    for sym, (f, c) in freq_table.items():
        if c <= slot < c + f:
            return sym, (state // total) * f + (slot - c)
    raise ValueError("decode error")
```

### 9.3 实际 use

ANS over arithmetic encoding 给 zstd / Brotli / "FSE" 5-50× faster decode speed 与 naive arithmetic coding 同 ratio. **Modern 压缩 default entropy encoder** when Huffman ratio < arithmetic ratio but arithmetic decode 失.

---

## 十、其它压缩算法

| 算法 | description | use |
|------|------|------|
| BZIP2 | Burrows-Wheeler Transform + Move-to-front + Huffman | Linux tar (good ratio, slow) |
| PPMd | predictive statistical + arithmetic | 7z archive winning |
| LZMA / LZMA2 | LZ77 + range encoding + large dictionary | 7z, xz default |
| Snappy | LZ77-only + dedupe | Google internal fast |
| LZX | LZ with arithmetic | Microsoft CAB legacy |

---

## 十一、压缩极限 boundary

- 随机 bit string length $n$: 期望压缩 ≥ $n$ bits (entropy = n). 压不动!
- **algorithm on pseudo-random data** 实际 give 压缩比率 < 1.0 (扩大) 自己 also-symbol.
- Lossless compression 不破坏 Pigeonhole Principle: 任意串压缩比 1.0 ⇒ must have **expand** strings 比 ≥ 1.0 by similar count.

---

## 十二、工程推荐

| Scenario | 推荐 algorithm |
|---------|----|
| HTTP content-encoding | Brotli (text) + Gzip (fallback) |
| Static file distribution | zstd |
| Streaming real-time (low latency) | LZ4 |
| Storage / archive | zstd or LZMA |
| Memory snapshot | LZ4 with dictionary |
| Image archive | PNG (LZ77+Huffman) or WebP lossy |
| Backup | `zstd -19 --long` |

---

## 十三、Bridges

- **entropy.md prev**: $H(X)$ 下界给 lossless compression.
- **capacity.md prev**: source coding vs channel coding 双限.
- **databases/WAL**: WAL segments 用 zstd 或 LZ4 block compress backup.
- **distributed/fault/erasure.md**: Reed-Solomon 在 encoding 之并发; compression + erasure 组合 best architecture.
- **crypto/hashes.md**: SHA-256 + 利 file 文件 orient checksum廉 质控完整性 independent of compression.

---

下一节 → [汉明码](hamming.md)
