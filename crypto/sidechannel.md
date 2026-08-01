# 10. 侧信道攻击: timing / power analysis / Spectre / Meltdown

## TL;DR

密码协议在数学层 secure ≠ 实现级 secure. 一旦执行 involves secret-dependent branch / memory access / power profile, 物理/系统旁观者可统计时间/功耗/cache 命中推断 secret. 历史极致:
- OpenSSL AES table lookup cache-timing 2005 → 30 ms 提取整个 AES key.
- SPA / DPA on smartcards (Kocher 1998) → 1 mA current trace 复原 signals.
- Spectre / Meltdown 2018 → 用户程序读 kernel memory.
- Rowhammer 2014 → flip bit in unprivileged RAM.
- Plundervolt 2020 → undervoltage 使 Intel SGX 出错.

工程心智: **真正对抗侧信道**要求**所有代码路径完全独立于 secret**——constant-time 编程 + 减少 secret-dependent memory access + 硬件协助 (AES-NI / ARM crypto extensions / SGX).

---

## 一、Timing attack 原理

### 1.1 Naive strcmp 经典

```c
int strcmp(const char *a, const char *b) {
    while (*a && *b) {
        if (*a != *b) return *a - *b;
        a++; b++;
    }
    return *a - *b;
}
```

首次不匹配的 byte 数 ⇒ 时间. 攻击者逐字节 翻 — 字节 0 通过所有不匹配 → 第 1 字节比较也走长达累 unitra puppy 单独 diad 启始; 也每晚多时间, comic from Deter secret 通otive correct.

### 1.2 Constant-time compare

```c
int ct_equal(const unsigned char *a, const unsigned char *b, size_t n) {
    unsigned char diff = 0;
    for (size_t i = 0; i < n; i++) diff |= a[i] ^ b[i];
    return diff == 0;
}
```

或 libsodium `crypto_verify_16/32`. 永远搞 路径全 长度素.

### 1.3 Modular exponentiation timing

naive `pow(base, exp, mod)` 走 binary square-and-multiply loop 每个 bit of `exp`:
- 如果 bit=0: square.
- 如果 bit=1: square + multiply.

攻击者测量时间 → pull `exp` bit by bit (Kocher 1996 attack).

现代 gmp / OpenSSL BN_exp 用 **fixed-window exponentiation** —— 每 window 由 table lookup 给结果 减少时间 correlation with exp bit.

### 1.4 AES table lookup timing

Naive AES uses 256-byte S-box table. 攻击者用无数 cache-state trigger 看 access delay — 第 1 cache hit vs miss 区分表格行 byte, then iterate over secret cycles → extract full key.

> [!WARNING]
> Bernstein 2005 published server-side attack on remote OpenSSL AES server: ~50ms total network jitter, but with 2^22 queries can recover full AES key from network timing! (Yes, **remote**, no local access.)

Solution:
- AES-NI hardware instruction bypasses lookup table (data-independent timing).
- bitsliced AES implementation (process 64-byte blocks in parallel寄存器).
- "T-tables" mitigation (constant-time memory access patterns):

---

## 二、Power analysis (SPA / DPA)

### 2.1 SPA (Simple Power Analysis)

Power consumption of CPU varies with operations. Multiply draws more than XOR. 观察 power trace 一段时间, *人类 视肉眼 inspect* 直接读出 square-vs-multiply 序列 → 恢复 private exponent.

### 2.2 DPA (Differential Power Analysis)

Multiple traces + statistical correlation:
- 选 target intermediate bit $b$ = function of secret s.
- Sample 一批 (用不同 inputs).
- 按 $b$ 值分组, 平均 power consumption 出差.
- 推断 $s$.

→ Kout 仅 one smartcard 输可 约 thousands traces 解出 key.

### 2.3 Mitigation

- Blinding: $r$ random; compute $r^e \cdot m$ encrypt instead of $m$, divide by $r^e$ at end (RSA blinding).
- Constant-time operations, 平衡指令.
- EM shielding / randomize clock frequency 抵抗 external sample.

---

## 三、Cache attacks

### 3.1 Prime+Probe attack

Attacker fills all cache sets with itself, victim runs (secret-dependent memory access evict some attacker cache line), attacker reload fills timings 计 which sets evicted → 推 victim keyed address.

### 3.2 Flush+Reload attack

If shared memory (e.g. shared library), attacker CLFLUSH cache set then sleep (offload-measure memory access time. If victim's access pattern secret限-但 指示的 free replaces set CLFLUSH time of reload → recover secret.

### 3.3 Mitigation

- Hardware: AES-NI for AES, ARM crypto extensions, no lookup table.
- Software: avoid shared memory with potential attackers (TLS heartbleed 走过了 close clear state yes).
- process isolation: kernel memory not user-mapped (Meltdown mitigation, KPTI于 x86 Linux).

---

## 四、Speculative execution attacks (Spectre / Meltdown 2018)

### 4.1 Meltdown (Variant 3)

x86 speculative load, kernel memory mapped KAISER-style. Speculative load succeeds speculatively even with privilege bugs out (_GE forwarding instruction retirement). Subsequent cache access dependent on loaded secret; speculative storage in cache **persists** even after rollback. Attacker uses Flush+Reload: detect cache line status → recover secret byte.

```
1:    mov al, byte ptr [kernel_addr]    ; speculative load success (攻击者 has no priv, but MEL香 takedown)
2:    shl al, 12                        ;Multiplier0x1000 for cache line 选择
3:    mov cl, byte ptr [alias_array + rax]
                                    ;secret Index cache line set by 多;
4:     CPU detects permission fault ⇒ squashes 1-3. But cache state changed!
5:    Attacker times each cache-line of alias_array:
     fast access = secret-k byte
```

### 4.2 Spectre (Variant 1, 2)

Spectre v1: trained branch predictor mispredicts (BTB-pattern trained to predicted if-condition true) → secret-load depending 非授权带来.

Spectre v2 (BTB poisoning): attacker 改 BTB targeting sysret / RSB mistarget → trick host / kernel to speculatively execute attacker's gadget code.

### 4.3 Mitigation

- **KPTI (Kernel Page Table Isolation)**: Linux / Windows 10 拒绝映射 kernel pages in user pagetables. cost up to 30% syscall (heavy).
- **IBRS / STIBP / IBPB** (intel microcode): disable speculation across privilege transitions.
- **Retpoline**: replace indirect with RET-based safe execution gadget.
- **Retpoline** etc sacrificed 5-30% speed某些工作负载.

### 4.4 工业影响

- Performance regression in 2018 云服务 5-30%. Cloud providers offer option to disable mitigations (with concomitant risk).
- Apple M1 architecture 早 safer due to Silicon: tighter branch speculation validation not vulnerable to many but variants still.

---

## 五、Rowhammer (2014, Kim et al)

DRAM cells 电荷 leakage: high frequency memory reads nearby cells 电荷 flip bit in adjacent unaccessed cell. Modern DRAM 电容密度 high'er than ideal, "hammering" rows triggers bit flips.

### 5.1 Attack type

- Single-sided: hammer adjacent rows.
- Double-sided: hammer both neighbors of a target row to flip bits in middle.

### 5.2 Practical exploit

- 用 user-mode 32-bit machine, bit flip in struct owner bit of page table entry → flip "user" bit on protected page → user gets root.
- Flip bit in hashed password field → security weakened.
- Throwhammer (2018) - over JS-rowhammer via WebGL.
- RAMBleed (2020) — exploit leakage via upgraded Rowhammer reading speed, extract RSA private key from kernel SGX.

### 5.3 Mitigation

- ECC RAM detects (most) but corrects single bit flip.
- TRR (Target Row Refresh) — internal DRAM balances frequency to mitigate.
- Memory DDR5 与控制器 refresh rate increased targeting.
- Cloud providers disable hugepages and isolate tenants, but really notEliminate 攻击.

---

## 六、SGX attacks (Side Channel TEE)

Intel SGX (Software Guard eXtensions) provides enclave for crypto-protected code execution.

### 6.1 Vulnerabilities History

- Foreshadow (2018): OS-managed scheduler leak SGX's protected memory contents via speculative execution.
- Plundervolt (2020): undervoltage make certain carries error → wrong output in SGX'modular 飞行 exponentiation → recover attestation private key.
- SGAxe (2020): SGX EPID group signature proof leakage.
- LVI (2020): Load Value Injection — fill attacker data into dangling microcode checker.

### 6.2 Hardening

- Lock down BIOS voltage control.
- TEE quote key rotation harder.
- Move to TEEs with provable constant-memory access design (AMD SEV-SNP, ARM TrustZone + CCA).

---

## 七、Constant-time 编程 manual

### 7.1 Rules

1. 不要用 secret 作为 array index. (Cache timing leak.)
2. 不要用 secret 作为 branch condition. (Pipeline prediction 改进 leak.)
3. 不要用 secret 在 floating point? (FP 不同值不同 latencies.)
4. Compiler barrier: volatile, `asm volatile("" ::: "memory")` 防 optimizer 删除双写 /  跳跃 branch.
5.  
  
### 7.2 Constant-time memeq in C

```c
int crypto_verify_16(const unsigned char *x, const unsigned char *y) {
    unsigned int differentbits = 0;
    for (int i = 0; i < 16; i++) differentbits |= x[i] ^ y[i];
    return (1 & ((differentbits - 1) >> 8)) - 1; // 0 if any bit differs; otherwise -1
}
```

Note trifix memory access loading `x[i], y[i]` is not time-varying since the **function loads all 16 bytes regardless of input equality**.

### 7.3 Constant-time conditional

```c
// Set y = x if mask = 0xFF, else y; mask != 0xFF 固定 mask 0
void sw_cmov(unsigned char *y, const unsigned char *x, int len, unsigned char mask) {
    unsigned char m = mask;
    for (int i = 0; i < len; i++) {
        y[i] ^= m & (y[i] ^ x[i]);
    }
}
```

Computes always all bits; ensures no branch.

### 7.4 Verification tools

- `ctgrind` Valgrind plugin marks secret-dependent branches in execution logs.
- `dudect` statistical timing analysis to verify constant time.
- Rust: `subtle` crate provides constant-time versions of conditional moves, equality, etc.
- Libsodium uses 内部 CT utilities always.

---

## 八、与前面章节的桥

- **symmetric.md** AES-NI necessity from cache timing.
- **signatures.md** Ed25519 role independence and Pederson 2-design 抗 nonce reuse.
- **tls13.md** SES Endpoint enable record layer ATK terminate AEAD padding length oracle.
- **os/sched.lockfree**: Optimization Compiler aggressively reorder, may produce secret-dependent timing implicit load semantics.

---

下一节 → [安全最佳实践](best-practices.md)
