# 9. ZKP 入门: zk-SNARKs / zk-STARKs / Bulletproofs

## TL;DR

**Zero-Knowledge Proof (ZKP)**: 证明者 P 向 验证者 V 证明"我持有某型证据 w 使 statement X(w) 为 true"而不泄漏 w.

形式化三性质:
- **Completeness**: 若 statement 真, V 接受.
- **Soundness**: 若 假, 任何 cheating P 让 V 接受概率 negligible (< 1/2^λ).
- **Zero-knowledge**: V 学不到任何 w 信息 (除了 statement 真假).

主流 4 类:
- **zk-SNARK** (succinct non-interactive arguments of knowledge): trusted setup, ~200 bytes proof, ms-verify, ms-prove. typical: Groth16, PLONK, Marlin.
- **zk-STARK** (scalable transparent ARguments of knowledge): no trusted setup (transparent random public); O(log n) verifier; O(n poly-log n) prover; post-quantum.
- **Bulletproofs**: no trusted setup; short proof (log n); but **linear** verifier runtime (slow for huge statements).
- **Σ-protocols** (interactive): simple template performances.

应用 jump:
- Crypto-rollups (zk-Rollup on Ethereum) 上 100× cheaper transactions 通过 compressing all state transitions into 1 proof.
- Privacy coins (Zcash): shielded transactions.
- Identity: VCs (Idemix, AnonCred) 零泄露 age 属性.
- Bridge-less cross-chain proof transfer.

---

## 一、ZK proof 范式

### 1.1 Interactive Proof

P & V 多轮交互. 输入 statement x:

```
For i in rounds:
    V sends challenge c_i, P returns response r_i.
```

V 最后 accept/reject.

### 1.2 Non-interactive via Fiat-Shamir trick

```
c_i = Hash(transcript-so-far).   // deterministic random oracle
```

把 interactive 转 NIZK (non-interactive zero-knowledge) by replacing random challenge with hash function assumed as random oracle.

### 1.3 第三的形式: zk-SNARK = succinct witness-indistinguishable argument of knowledge with logarithmic verifier.

- succinct: proof size small (200-1000 bytes), verifier time logarithmic in statement size.
- ARgument (not Proof): soundness 仅对 computational-bounded prover (not information-theoretic); NP 困难 assumption.

---

## 二、Σ-protocol example: Schnorr identification

P knows secret $x$ s.t. public $y = g^x$.

1. P ephemeral $r$; sends commitment $R = g^r$.
2. V sends random challenge $c$.
3. P sends $z = r + c x$.
4. V verifies $g^z \stackrel{?}{=} R y^c$.

正确性 follows from $g^{r+cx} = g^r \cdot (g^x)^c = R y^c$.

**Zero-knowledge**: V learns $z, R, c$ but not $x$ (since many combinations produce same z; simulator can re-run with random $z'$ for any c and pull $R' = g^{z'} y^{-c}$).

**Fiat-Shamir**: replace V's $c$ by $H(R, y)$:
```
c = H(R || y)
proof = (R, z)
verify: c = H(R || y) and g^z = R y^c
```

This is in fact the EdDSA signature equivalent! EdDSA = Schnorr = non-interactive identification **in non-interactive style**.

---

## 三、zk-SNARKs

### 3.1 Algebraic setting

Computation 是 **arithmetic circuit**: arithmetic gate (add, mul) over 有 field $\mathbb{F}_p$. 转化 high-level 语言 (Circom / leo / zinc / halo2-circuit) to R1CS (rank-1 constraint system).

#### R1CS definition

A statement written as constraint vector:
- Each gate computes: $A_i \cdot B_i = C_i$ for linear forms A_i, B_i, C_i functions of witness vector $w$.
- Public statement $x$ and witness $w$ satisfy all constraints; show this in ZK to listener.

### 3.2 工匠 trusted setup ceremony

Groth16 / Pinocchio-style SNARK uses SRS (Structured Reference String):

```
Random $\tau$, $\alpha$, $\beta$, $\gamma$, $\delta$:
  proving key = [τ^i G ...], [α · τ^i G ... etc.]
  verifying key = [α G, β G, γ G, δ G, β/γ G ...]
```

Such random must be destroyed; else forger 失猜 SRS know how to forge a false proof. Power of Tau's MPC ceremony (2018, 200+ participants, threshold 1 honest kills 宣 r) used such offline setup.

### 3.3 Pairing curve

Groth16 uses bilinear pairing friendly curves: BN254, BLS12-381. Pairings give $e: \mathbb{G}_1 \times \mathbb{G}_2 \to \mathbb{G}_T$, quadratic equation check verified in 1 multi-exponentiation.

Verification:
$$ e(A_1, B_2) \stackrel{?}{=} e(\alpha G_1, \beta G_2) \cdot e\!\left(\frac{\sum_i C_{public,i} \cdot G_1^i}{\gamma G_1}, \gamma G_2\right) \cdot e(\alpha G, r G_2) \cdot e(s G_1, \delta G_2) \cdot e(A G, B G)$$
Where $\alpha, \beta, \gamma, \delta$ are sub-SRS components and (A_1, B_2, C_1) are the proof.

Verifying time ~1ms computationally.

### 3.4 Groth16, PLONK, Marlin

| System | Setup | Proof Size | Verify | Prover |
|--------|-------|------------|--------|--------|
| Groth16 | Per-circuit | 192 B | ~3 pairings | O(N) |
| PLONK   | Universal updatable | 400 B | 1 pairing + 1 FFT | O(N log N) |
| Marlin  | Universal | 800 B | O(log N) | O(N log N) |

PLONK **Universal setup** = once ever, any circuit uses derived setup does not need re-launch ceremony.

### 3.5 工程库

- **Snarkjs** (JS Library, Groth16 / PLONK).
- **arkworks** (Rust library, supports various proof systems).
- **halo2 (Zcash)**: based on PLONK + recursion, no trusted setup needed per-ZK cash.
- **gnark** (Go).

### 3.6 Use case: Zcash shielded txs

To send shielded zk-tx:
- User creates a note commitment $C_i = H(\text{value}_i \| \text{vk}_i \| \text{rcm}_i)$.
- Next user pays amount by proving "I know (rcm, value, vk) of NULLIFIER N_i previously on-chain; commitment not spent yet by nullifier = H(rcm, nullifier_seed); new output commitment C_j is valid".

Zcash uses Halo2 2023 onwards, deprecated Groth16 prover.

### 3.7 Use case: zkRollup

Ethereum L2 (zkSync Era, Polygon zkEVM, Scroll):

- L2 sequencer combs thousands of L2 txs into batches.
- Prove statement: batch update root of state Merkle tree from root pre to root post correctly applying all tx logic.
- L1 verifies zk proof on-chain (single pairing call charges gas much smaller than re-executing L2 txs).
- Cost ratio: 1× L2 prover cost vs N× L1 verification → 100× cheaper.

---

## 四、zk-STARKs

### 4.1 设计不同

- Hash-based, using **Reed-Solomon codes + FRI protocol** to prove low-degree of polynomial commitments. **No elliptic curves / pairings**.
- Transparent setup (no trusted).
- Post-quantum (hash-based security).
- BUT proof size larger (~50-200 KB) and verifier does O(log² N) work.

### 4.2 AIR (Algebraic Intermediate Representation)

STARK 写程序 RISC machine (Brainfuck-like or Cairo / Cairo VM) and prove algebraic execution trace satisfies transition constraints.

### 4.3 LDE + FRI

Prover produces a low-degree extension (LDE) of execution trace, then polynomial constraints. Prove via FRI protocol (Fast Reed-Solomon Interactive Oracle Proof of proximity):
1. Decommit to oracle queries at random locations.
2. Recursive folding halves degree.
3. Stop at small final degree.

Verifier sees only low-degree check probability from random queries; 共 O(log N) rounds + queries.

### 4.4 Library

- **StarkWare's Stwo / Stone provers**, Rust open-source.
- **Winterfell** (Rust, StarkWare 友 street Ferinitialblock prover community release).
- **OpenZeppelin Cairo contracts** integration.

### 4.5 用例

- StarkNet (zkRollup on Ethereum): STARK proof
- delegation of L1 → L2 transaction trace.
- 200k tx/batch handled in practice.

---

## 五、Bulletproofs

### 5.1 Range proofs on commitment

Built by Bünz-Boutin-Campanelli-et 2018: efficient range proofs for **Pedersen commitments**: prove "value v in [0, 2^n]" without revealing v.

Final proof size O(log n); verifier O(n). No trusted setup, no pairings (regular curve 区).

### 5.2 Use case

- **Monero**: ringCT battery, per tx generates bulletproof range proof. Predictable ~1.4KB on-chain.
- **MimbleWimble**: Grin / Beam 用 bulletproof 范围证明 for homomorphic commitment privacy.
- **zkBounty**: ANNUAL-script institutional hash supplementary overstuck.

### 5.3 Limitations

Verifier linear-time → fail large stacking (e.g., higher counts reach seconds verifier runtime).

---

## 六、防 ZKP elusive case "I am over 18" zero-knowledge age verification

```
Statement: I know private_age such that signature on (private_age) by trusted authority, and currentDate - private_age > 18*365 days.
Witness: age, signature.
```

P proves in ZK; verifier learns ✓/✗ only.

Idemix, AnonCreds, W3C VC use cases.

---

## 七、ZK proof of Solvency (proof of reserves)

Exchange proves "I hold liabilities L for each user, and reserve R ≥ L" without revealing R. Binance / Kraken have published proof of reserves using Merkle sum tree proofs.

```
For user u, hash commitment h_u = H(balance_u).
Exchange commits root of Merkle sum tree:
  Merkle root + users verify inclusion: each leaf sum + inclusion path equals root.
```

This is not even ZK, just "verifiable sum". 延展 ZK if needed for client privacy.

---

## 八、Limitations and pitfalls

- Trusted setup panic: any party who possesses toxic waste from setup can forge proofs forever. Mitigate via universal-and-updatable setup (PLONK, Marlin, Halo2) where random accumulates over multiple parties.
- Quantum threat: pairing-based zk-SNARKs break under quantum (Shor). STARKs and FRI 量子 resilient.
- Implementation bugs not formal proof: Halo2 had bug in 2021 allowing proof forge on a specific circuit; later fixed.
- Bit homomorphic commitments of input must enforce input range (otherwise overflows!), often missed in production.
- finance & privacy mixing: Zcash once revealed 192 secret encryption keys by random source protocol bug.

---

## 九、桥梁

- **complexity.md**: 测复杂度归约与 NP (NPC R1CS reduce from any NP language) statement specification.
- **distributed/clock/dag**: blockchain block hash acts as proof of work-VDF tie-out.
- **hashes.md**: Zero-knowledge proofs rely on cryptographic hash with H security; validity of proof depends on hash-as-random-oracle assumption.
- **tls13.md**: future handshake may ZK-attestations for client identity (e.g., Domain Validation ZK).
- **system-design/case/k8s-control-plane**: server auth by SPIFFE certificate and could extend to ZK identity for k8s node attestation.

---

下一节 → [侧信道攻击](sidechannel.md)
