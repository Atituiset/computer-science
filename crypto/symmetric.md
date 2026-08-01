# 1. 对称加密: AES 与 ChaCha20

## TL;DR

对称加密 (symmetric encryption): 加/解密用**同一把密钥**. 业界两个 main 选手:
- **AES (Rijndael 2001)** — SubBytes / ShiftRows / MixColumns / AddRoundKey 四步, 10-14 轮迭代. 硬件 (AES-NI) 指令, GB/s 量级.
- **ChaCha20 (Bernstein 2008)** — ARX quarter-round 流密码, 无硬件加速也 GB/s. mobile/IoT 与 TLS 主流.

读完此章你能在面试辨: 为何 AES 抗 differential 看每一轮 S-box's max differential probability; 为何 ChaCha20 用 quarter round + counter 保证每字节 keystream 不重写 (nonce+counter 任一是密文 byte 的 IV).

---

## 一、加解密形式化

- 加密: $c = E_k(m)$, 解密: $m = D_k(c)$. 加密与解密均**用同一密钥 $k$**.
- 现代对称加密基于 one-time pad 的理论: if keystream $S$ is uniform random 与 message 同长, ciphertext $c = m \oplus S$ 理论不可破. 现实不难造 $S$ — 真正随机 is hard.
- 流密码 (ChaCha20, RC4, Salsa20): 用 PRG 从 short seed (key + nonce + counter) stretch 为 keystream $S$, $c = m \oplus S$.
- 块密码 (AES): 用 PRP (pseudorandom permutation), 把 128-bit block 切成等价-keyed permutation. 用 modes (CBC/CTR/ECB/GCM) 扩展到任意长输入.

---

## 二、AES 内部: SPN 网络 (Substitution-Permutation Network)

AES 处理 128-bit block; 密钥长 128, 192, 256 分别 10, 12, 14 轮.  每轮 4 步:

1. **SubBytes**: 16 字节逐个经过 8×8 S-box (查表). $x \to \text{SBox}[x]$.
2. **ShiftRows**: 按字节矩阵的每行循环左移 (0, 1, 2, 3 字节).
3. **MixColumns**: GF(2⁸) 上每列做矩阵乘.
4. **AddRoundKey**: ciphertext state $\oplus$ round key $k_i$.

最后一轮跳 MixColumns (否则解密不安全).

### 2.1 S-box 设计依据

AES S-box 不是随机表 — 是 $x \mapsto x^{-1}$ in GF(2⁸) 后接 affine map. 选择 inverse 因"低 differential/linear 概率":
- max differential prob ≈ 4/256, max linear prob ≈ 1/4; 都远低于随机 8-bit 函数.

→ 抗 differential/linear cryptanalysis 的代数根.

### 2.2 MixColumns

每列 4 字节, GF(2⁸) 上乘固定矩阵
$$M = \begin{bmatrix} 2 & 3 & 1 & 1 \\ 1 & 2 & 3 & 1 \\ 1 & 1 & 2 & 3 \\ 3 & 1 & 1 & 2\end{bmatrix}$$
分支数 (branch number) = 5 (maximal for 4×4 binary matrix), 即每输入字节影响 5 个输出字节, 提供 diffusion.

### 2.3 KeySchedule

Initial key → 第一轮 key derivation 推到下一轮; 每 4 字节recursive using S-box + Rcon (round constant) 防 symmetry.

### 2.4 AES round 实施 (Python-style)

```python
SBOX = [...]  # standard AES S-box.

def aes_encrypt_block(block_16: bytes, round_keys: list[bytes]) -> bytes:
    assert len(block_16) == 16
    state = bytearray(block_16)
    for i in range(15):
        sub_bytes(state)         # 1. S-box
        shift_rows(state)         # 2. 
        if i != 14:               # skip last MixColumns
            mix_columns(state)     # 3.
        add_round_key(state, round_keys[i + 1])  # 4.
    return bytes(state)
```

让每个 128-bit block 加密成 1 个 cycle (16 字节 parallel GF mul). 现代 CPU AES-NI = `AESENC` 指令做以上四步.

### 2.5 AES-NI 硬件

Intel 2010 Westmere 引入 AES-NI: `AESENC xmm1, xmm2` 直接做 1 round. AES-128 加密 ~1.3 cycle/byte, GB/s/copy. 现代 CPU 加密吞吐 5-10 GB/s core-parallel; GPU A100: 60+ GB/s.

→ pure-software AES (~50-200 MB/s Python) 在没有 AES-NI 的 IoT 板上 bad 的 → 这就是 ChaCha20 的主场.

---

## 三、ChaCha20: ARX 流密码

设计者 Bernstein 给 Salsa20 (2005) 改进版, RFC 7539 (2015) 收 HTTPS use. 用 256-bit key + 96-bit nonce + 32-bit counter; 每 block 64 字节 keystream.

### 3.1 Internal state (16 个 32-bit words)

512-bit state:
```
const0 const1 const2 const3
key0   key1   key2   key3
key4   key5   key6   key7
counter nonce0 nonce1 nonce2
```

前 4 是常数 "expand 32-byte k" split.

### 3.2 Quarter Round (QR)

操作 4 个 state words:
```
a += b;  d ^= a;  d = ROL(d, 16);
c += d;  b ^= c;  b = ROL(b, 12);
a += b;  d ^= a;  d = ROL(d, 8);
c += d;  b ^= c;  b = ROL(b, 7);
```

ARX (Add-Rotate-Xor): 所有操作寄存器可循环, 严密 anti-timing-side-channel by design.

### 3.3 Double round: column QR + diagonal QR

20 轮 QR, 每 4 个 QR 处理三 row / 三列/diagonals 各一 (10 次 column + 10 次 diagonal).

### 3.4 输出

最终 state + 原始 state (= 极小 key increment stream output), 这 64-byte XOR 与 message.

### 3.5 Python 实现示意

```python
import struct

def rotl32(x, n):
    return ((x << n) | (x >> (32 - n))) & 0xFFFFFFFF

def quarter_round(s, a, b, c, d):
    s[a] = (s[a] + s[b]) & 0xFFFFFFFF; s[d] = rotl32(s[d] ^ s[a], 16)
    s[c] = (s[c] + s[d]) & 0xFFFFFFFF; s[b] = rotl32(s[b] ^ s[c], 12)
    s[a] = (s[a] + s[b]) & 0xFFFFFFFF; s[d] = rotl32(s[d] ^ s[a], 8)
    s[c] = (s[c] + s[d]) & 0xFFFFFFFF; s[b] = rotl32(s[b] ^ s[c], 7)

def chacha20_block(key: bytes, counter: int, nonce: bytes) -> bytes:
    constants = b"expand 32-byte k"
    s = list(struct.unpack("<16I", constants + key + struct.pack("<I", counter) + nonce))
    init = s[:]
    for _ in range(10):
        quarter_round(s, 0, 4,  8, 12); quarter_round(s, 1, 5,  9, 13)
        quarter_round(s, 2, 6, 10, 14); quarter_round(s, 3, 7, 11, 15)
        quarter_round(s, 0, 5, 10, 15); quarter_round(s, 1, 6, 11, 12)
        quarter_round(s, 2, 7,  8, 13); quarter_round(s, 3, 4,  9, 14)
    out = [(init[i] + s[i]) & 0xFFFFFFFF for i in range(16)]
    return struct.pack("<16I", *out)

def chacha20_keystream(key: bytes, nonce: bytes, counter_start: int, length: int) -> bytes:
    out = b""
    n = (length + 63) // 64
    for i in range(n):
        out += chacha20_block(key, counter_start + i, nonce)
    return out[:length]

def chacha20_xor(key: bytes, nonce: bytes, data: bytes, counter_start: int = 1) -> bytes:
    ks = chacha20_keystream(key, nonce, counter_start, len(data))
    return bytes(a ^ b for a, b in zip(data, ks))
```

工程注意: Pure Python 5-20 MB/s, Go lib 100+ MB/s, modern CPU AVX 直 1-5 GB/s. Salsa20 family 在 WAN 圈善 landless 用, SHA-style throughput.

---

## 四、AES vs ChaCha20 选型

| 维度 | AES-128-GCM | ChaCha20-Poly1305 |
|------|-------------|-------------------|
| 加速 | AES-NI: 5 GB/s | AVX2: 2-3 GB/s (无硬件一直) |
| 无硬件加速场景 | 30-50 MB/s | 200+ MB/s |
| Mobile/IoT | 不友好 (no AES-NI) | 友好 |
| 256-bit 安全级 | AES-256 直接 | 同 (32 byte key) |
| Key/IV setup overhead | low | low (key 32B, nonce 12B) |
| Counter 32-bit 大 | Yes (counter + IV+block) | Yes, but requires careful nonce management (RFC 7539) |
| Side channel safer | AES-NI instructions constant-time | 算术 ARX inherently constant-time, ANY portable |
| Wider use | TLS, IPsec, VPN,  disk encryption | TLS (Google), Signal, WireGuard, SSH |

工程心智选: **吾 AES-NI 占 95% PC/server**, **吾 mobile with weak AES arm ChaCha 选 WireGuard/Signal**. Cloudflare 2019 paper 工程统计: TLS 1.3 ~17% ChaCha20, 83% AES-GCM; mobile traffic 中 ChaCha20 比例大幅高.

---

## 五、Block Cipher Attack Models & Margin

| 攻击 | 说明 | AES 当前防御 |
|------|------|------------|
| differential (Biham-Shamir 1991) | 找 differential trail with prob > $2^{-}$ certificate 导致区分 | 4 round trail prob too low; full 10 round 攻击 ~$2^{254}$ |
| linear (Matsui 1993) | 高 bias linear approximation 到 round 关联 | full AES linear attack ~$2^{258}$ > brute force |
| integral (square attack) | 用 byte-balanced input 的子 set 观察 after rounds 实际 | full AES 防 6+ 轮有抗 integral 余 |
| related-key attack | key schedule.difficulty for AES-256 Astro 略弱, 仍 14 rounds 抵抗 | AES-256 24-round key schedule 抵抗, key recovery ~$2^{254}$. |
| side-channel (timing/power) | AES table walks leak memory write | AES-NI hardware bypass + constant-time 否 cache timing 选择 |

> [!WARNING]
> 不要 homebrew AES — S-box 作 random table 时, table-lookup 真真创 cache timing leak. OvenSoft 公布 OpenSSL 2005 cache-timing AES attack: timing leak round ≥ 5 rounds 后 recover key. 永远 `use libcrypto / t crypto_aead_*` (libsodium) — done.

---

## 六、与 project 其他章节交叉

- **complexity.md / approximation.md**: NPC 算力不是现行攻击 RSA/AES 假设 base — 攻击 AES 用 specific algebraic attacks (AES 是 SPN 设计 by 具 differential 抵抗), factorzation is in NP∩co-NP (但 not NP-hard), whereas lattice LWE assumption base 现在 PQC.
- **os/lock/lockfree.md**: constant-time 算术 = constant-time wait free algorithm — proper 上 identity.
- **os/net/zero-copy.md**: TLS sendfile hotpath 芯 AES-NI + sendfile integrated 加速 NGINX 5×.
- **distributed/fault/erasure.md**: Reed-Solomon code on GF(2⁸) 复用 AES field 的 FF inverse 构造.

---

下一节 → [操作模式: ECB / CBC / CTR / GCM (AEAD)](modes.md)
