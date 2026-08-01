# 第十部分 · 密码学与安全

## 一句话

**密码学**把"对手的难度"变成"算力代价", 让攻击者只能用 brute force 撞靠墙——并通过这个等价交换, 把不可信网络的通信变成"在不可信通道上的逻辑信任协议". 它的本质是**把对抗 NP 完备性问题的难度转化成密码协议的设计目标**: RSA 安全性建立在 factoring 假设, ECDLP 用椭圆曲线上群运算, SHA-256 用 Merkle-Damgård 结构, AES 用 SPN 网络抵抗 differential/linear cryptanalysis. 同时密码学不是孤立数学, 它一层一层堆栈: **对称加密 + 操作模式 → AEAD → 密钥交换 + 签名 → 证书链 → TLS 1.3**——这正是日常 https 表象后的暗物质.

## 思想链

```
[HTTPS GET api.bank.com]
  └─> TLS 1.3 ClientHello (含 ECDHE pub key, cipher suite)
       └─> Server: 验证 client SNI, 给 cert chain (X.509 leaf → intermediate → root CA in CT-log)
             └─> Client: 验证 cert chain (OCSP stapling 或 CRL), 握 ECDHE shared secret HKDF
                  └─> 生成 traffic keys: client→server / server→client 各两组 (key, IV)
                       └─> AES-256-GCM AEAD encrypt data: ciphertext = AES(plaintext) + tag
                              └─> Tag 验证: 整流路防篡改 / 重放 / 截断
                                     └─> HTTP/2 headers HPACK 压缩 → /api/order
                                          └─> Application 接路由 + DB
                                               └─> back protocol: JWT signed by Ed25519 signing
```

任何"以为 HTTPS 是一个东西的"抽象, 实则 4 层 stack. 其中**任一层崩 → 全栈崩**: 弱 RNG (DNSSEC rollover 死过) / EECDH curve 选错 / cert chain 错乱 / RC4 危险 / IV reuse 一次性全毁. 这一模块按 layer 把所有底层铺开, 并显式给出 ECDSA / ChaCha20 / HKDF 工程级 reference implementation.

## 章节

- [开篇：从凯撒密码到 TLS 1.3](index.html) ← 当前
- [1. 对称加密: AES (SubBytes/ShiftRows/MixColumns/AddRoundKey) 与 ChaCha20](symmetric.md)
- [2. 操作模式: ECB / CBC / CTR / GCM (AEAD) 与 nonce-reuse 灾难](modes.md)
- [3. 非对称加密: RSA (欧拉函数 / CRT 加速) 与 ECC (secp256k1 / Curve25519)](asymmetric.md)
- [4. 密钥交换: Diffie-Hellman / ECDHE / X25519](key-exchange.md)
- [5. 数字签名: RSA-PSS / ECDSA / Ed25519 的设计差异](signatures.md)
- [6. 哈希: SHA-256 / SHA-3 (Keccak) / BLAKE3 / 抗碰撞史](hashes.md)
- [7. TLS 1.3 握手全流程: ClientHello → ServerHello → EncryptedExtensions → Finished](tls13.md)
- [8. 证书链: X.509 / PKI / Certificate Transparency / OCSP](pki.md)
- [9. ZKP 入门: zk-SNARKs / zk-STARKs / Bulletproofs](zkp.md)
- [10. 侧信道攻击: timing / power analysis / Spectre / Meltdown](sidechannel.md)
- [11. 安全最佳实践: constant-time / nonce 不重用 / 密钥轮转 / OOB validation](best-practices.md)
- [附录: 密码学考试/工程 checklist](appendix.md)

读完应能:

1. 为什么 AES 选择 SPN 网络替代 Feistel? AES S-box 设计 explicit GF(2⁸) 抵抗 differential/linear 的代数证据何在?
2. ChaCha20 用 quarter-round ARX 操作不给硬件加速也能 GB/s, 在 mobile IoT / TLS 表示何处?
3. ECB / CBC / CTR / GCM 选模: 各自抗篡改 / 并行 / 错误传播 / nonce约束。GCM 一次 nonce 改不动用就丢 all messages?
4. RSA: 2048-bit modulus 有 1024-bit security? 实际约 112-bit security by NIST 比对; CRT 移位子解密加速约 4×.
5. 为什么 Curve25519 比 secp256k1 在 ground field 上更工程友? 常数时间 Montgomery ladder vs Weierstrass'\x00 binary特殊点问题?
6. ECDSA signature 重 nonce reuse → 私钥可逆推 (kindle PS3 hacking 2010); Ed25519 deterministic nonce (RFC 8032) 怎么避免?
7. SHA-256 Merkle-Damgård 被长度扩展攻击伤; BLAKE3 之 50× faster in parallel mode 用 Merkle-tree hash.
8. TLS 1.3 vs 1.2: 1.3 把全部握手 encrypt 进 Early-Traffic,少 1 RTT 还是 0 RTT?
9. X.509 cert chain 验证中 path build logic; Certificate Transparency log 给 audit; OCSP must-staple 错放直接被浏览器拒.
10. zk-SNARKs trusted setup vs zk-STARKs scalability: 为什么 zk-rollup 多选 STARK (Arabica 系)? Bulletproofs 的 non-SNARK 银行轻吗 bpc 范围证明.
11. Spectre / Meltdown / Rowhammer: timing side channel 如何 notice 系统调用边界形成纪录 乒乓散度; microarchitectural state no clean domain.
12. constant-time memory compare: why `==` is unsafe; 慢 secret-dependent branch 真的能 leak key over 公网.

## 历史 1: 1976 Diffie-Hellman 公钥革命

Whitfield Diffie 和 Martin Hellman 在 "New Directions in Cryptography" 一举突破"对称密钥分发"瓶颈, 用 modular exponentiation 给出了"两人从未见面, 通过公开信道协商家 secret". 这是公钥密码学诞生. RSA 1977 紧随其后, 椭圆曲线 1985 (Koblitz & Miller).

## 历史 2: 1995 SHA-1 → 2017 shattered

SHA-1 1995 NIST 出版, 2013 weakness evidence, 2017 Google CWI công shattered.SHA-1.collision finding. 全网 exhorted to SHA-2/3. BLAKE2 (2012) / BLAKE3 (2020) 在 faster plane.

## 历史 3: 2008 TLS 1.2 → 2018 TLS 1.3 pure AEAD

TLS 1.2 12 cipher suites; 2018 TLS 1.3 砍掉 CBC/RC4/SHA1, 仅留 AEAD (AES-GCM/ChaCha20-Poly1305) + ECDHE + 签名 RSA-PSS/EdDSA. 1 RTT handshake + 0-RTT optional.

## 历史 4: 2013 Snowden泄密 → TLS 1.3 普及

PRISM 暴露 NSA 内部被动解密能力 (用 GCHQ-applied "BULLRUN" 加密 weaponize). 业界推进 PFS (Perfect Forward Secrecy) 与 ECDHE 强制——每条新 session 短期 ephemeral 私钥 ephemeral 化密钥 (即使长期私钥泄露, 已存档流量也无法解密).

## 历史 5: 2018 Spectre / Meltdown

Google Project Zero + 各学术团揭示现代 CPU 推测执行 + cache 让任意 user 程序读 kernel 内存. 整个 cloud/security 业软层 react 18-24 个月. 至今 ♻ "Spectre vN" 系列未绝.

## 历史 6: 2018 zk-STARKs 与 2020 zk-rollup 兴起

StarkWare 用 STARK 证明 ETH rollup 交易, Ethereum rollup 降低 gas 成本 100× 太. SNARK (Groth16, PLONK) 与 STARK (ultra-scalability, no trusted setup) 在 2020s Crypto builder core stack.

## 历史 7: 2022 NIST PQC 选定

CRYSTALS-Kyber (KEM) + CRYSTALS-Dilithium (signature) + SPHINCS+ (hash-based fallback) 三连环: 四年评估筛 7 选 1). 美政府 2022-2025 逐步迁移 done be HTTPS Q-safe.

---

下一节 → [对称加密: AES 与 ChaCha20](symmetric.md)
