# 附录: 密码学考试 / 工程 checklist

## A.1 — Algorithm cheat sheet

| Class | Algorithm | Key Size | Use | Notes |
|------|-----------|----------|-----|-------|
| Symmetric block | AES-128 / AES-256 | 16/32 B | bulk encryption | use AES-NI hardware if available |
| Symmetric stream | ChaCha20 | 32 B | bulk encryption | when no AES acceleration |
| MAC | HMAC-SHA256 | any | message auth | RFC 2104; combine with E-then-M |
| AEAD | AES-128-GCM | 16B + 12B IV | bulk + auth | TLS 1.3 / IPsec mainline |
| AEAD | ChaCha20-Poly1305 | 32B + 12B | bulk + auth | mobile/IoT preferred |
| Hash | SHA-256 | — | integrity, KDF, MAC | Merkle-Damgård length-extension caveat |
| Hash | SHA-3-256 | — | future-proof | sponge construction |
| Hash | BLAKE3 | — | parallel high-throughput | 10 GB/s with AVX2 |
| Password hash | Argon2id | — | password storage | PHC winner 2015; memory-hard |
| KDF | HKDF | — | derive multiple keys from master | RFC 5869 |
| Public key enc | RSA-3072-OAEP | 3072 b | legacy / enveloped | deprecated for new systems; use KEM |
| Public KEM | ML-KEM-768 / Kyber | ~1184 B | post-quantum key exchange | FIPS 203 / RFC 9591 |
| Public signature | RSA-PSS-3072 | 3072 b | cert signing | RFC 8017; works for TLS1.3 |
| Public signature | ECDSA P-256 | 32B | TLS cert signing | use RFC 6979 deterministic nonce |
| Public signature | Ed25519 | 32B | modern signing | RFC 8032 |
| Public PQ sig | ML-DSA-65 / Dilithium | ~2KB | post-quantum signing | FIPS 204 |
| Hash-based sig | SLH-DSA-SHA2-128f | 7KB | stateless PQ hash-based | FIPS 205 |
| Key exchange | X25519 | 32B | ephemeral ECDH | RFC 7748; constant-time |
| Key exchange | X448 | 56B | high-security ECDH | RFC 7748 |
| KEM/sig combos | hybrid Kyber-X25519 | — | TLS PQ preview | Cloudflare / Apple |
| ZK: Groth16 | pairing curve BLS12 | per-circuit setup | Zcash legacy | 192B proof |
| ZK: PLONK | universal updatable | 400B proof | zkSync Era/Scroll | O(N log N) prover |
| ZK: STARK | hash-based, transparent | ~50-200KB | StarkNet post-quantum | O(log² N) verify |
| ZK: Bulletproof | curve no setup | O(log n) | Monero range proof | linear verify |

## A.2 — Browser / OS trust store matrix

| CA Program | Update Cycle | Min RSA | Min EC | SHA-1 | SHA-256 | Notable |
|-----------|---|---|---|---|---|---|
| Apple root program | Yearly | 2048 | 256 | rejected | OK | private group |
| Microsoft root | Quarterly | 2048 | 256 | rejected | OK | Windows Update push |
| Mozilla / NSS | Weekly | 2048 | 256 | rejected | OK | open source program |
| Google Chrome | uses NSS | — | — | rejected | OK | CT enforcement 2018+ |

## A.3 — Security level lookup table

| Security level | Symmetric | RSA modulus | ECC modulus | SHA output | Notes |
|------|---|---|---|---|---|
| 80 | 80 bit | 1024 | 160 | 160 | retired |
| 112 | 112 | 2048 | 224 | 224 | RSA-2048 minimum |
| 128 | 128 | 3072 | 256 | 256 | TLS modern baseline |
| 192 | 192 | 7680 | 384 | 384 | high-sensitivity |
| 256 | 256 | 15360 | 521 | 512 | NSA Suite B / Type 1 |

注: AES / SHA-256 在 quantum Grover 之下仍 128 等 trillion quadratic 安全, 但 RSA / ECC 在 Shor 之下 hard broken ⇒ migration to ML-KEM/ML-DSA.

## A.4 — Online resources / tooling

- **OpenSSL** command-line + library; cert generation, TLS 模拟, signature tests.
- **Libsodium** cross-language crypto 简洁 API wrapper.
- **ring** (Rust), maintained, fast OpenSSL alternative for TLS.
- **BoringSSL** Google fork, internal improvements, used by Chromium.
- **Wireshark** + `SSLKEYLOGFILE` env → decrypt own TLS sessions (debug only).
- **Certbot** / **lego** ACME clients for Let's Encrypt automation.
- `ssh-keygen -t ed25519` for modern SSH keys.
- **age** encryption tool by Filippo Valsorda — modern file encryption, X25519, AEAD.
- **minisign** for file signing (Ed25519).
- **Snarkjs** 编译零知识 proof 验证 in CLI.

## A.5 — Common pitfall reminder one-pager

- ✗ Random nonce RNG without CSPRNG → breakable keystream with predictable IV in CTR.
- ✗ ECDSA nonce `random()` → reuse → private key recoverable from 2 signatures.
- ✗ MAC-then-Encrypt → padding oracle.
- ✗ ECB for multi-block messages → visually leaks pattern.
- ✗ Passwords hashed with plain SHA-256 → rainbow-table compromise.
- ✗ Raw RSA $m^e$ for small message → low-exponent attack recoverable.
- ✗ Same long-term signing key for multiple platforms → cross-protocol attack.
- ✗ ECDSA curve point input not validated → invalid-curve attack sends small subgroup point whose DLP trivial.
- ✓ Use libsodium / ring / OpenSSL.
- ✓ Rotate secrets, audit logs, monitor alerts.
- ✓ Constant-time comparison of secrets.
- ✓ AEAD encryption in 95%+ cases.
- ✓ Ed25519 for new signatures unless hardware constrained.
- ✓ X25519 / Kyber768 hybrid for new systems post-2024.

## A.6 — Open-source implementation references

- RFC 8446 TLS 1.3
- RFC 7748 X25519 / X448
- RFC 8032 Ed25519
- RFC 7539 ChaCha20-Poly1305 AEAD
- RFC 5869 HKDF
- RFC 6962 Certificate Transparency
- RFC 6960 OCSP
- RFC 5297 AES-SIV
- RFC 9591 Kyber-derived ML-KEM id encode (post-quantum)
- FIPS 203 ML-KEM, 204 ML-DSA, 205 SLH-DSA standards (Aug 2024 finalized).

## A.7 — 与项目其他章节交叉

- **asymmetric.md**: RSA math with CRT, ECC curve selection.
- **tls13.md**: 握手 derive secret 链; cert chain verification.
- **sidechannel.md**: time / power attack 探测:
- **theory/complexity**: PRIMES ∈ P (AKS) 提 major示范; factoring 在 NP∩co-NP but not NP-hard.
- **distributed/fault/quorum**: BFT consensus multi-party signature aggregation.
- **system-design/case/dynamo-family**: cryptographic secret 分配 among distributed storage derivatives.
- **compilers/sema/type-system**: secure "opaque type" 专用 防止 counter-logging from secret-annotated values.

---

下一节 → [信息论与编码 README](../info-theory/index.html)
