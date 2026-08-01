# 4. 密钥交换: DH / ECDHE / X25519

## TL;DR

两方**从未见面**、**通过公开信道**协商一份共享秘密——这就是 Diffie-Hellman (DH) 1976 给人类的革命. 现代用**ECDHE (ephemeral)**: 每会话生短期私钥, 计算 $Q = kG$, exchange value, derive shared secret via HKDF. 短期公钥**永远不验证** (这就允许 zero-knowledge identity: even long-term key leakage 离 archive 已发密技不朽 ephemeral private key). WireGuard 用 Noise Protocol framework + Curve25519; TLS 1.3 强制 PFS (Perfect Forward Secrecy) by ECDHE-only design (deprecated static RSA).

---

## 一、Modular-group DH

### 1.1 Algebraic setting

$\mathbb{Z}_p^*$ 是 integers mod prime $p$. 取 generator $g$ (a primitive root $\bmod p$). $g, p$ public. 任一方 $i$ 取私钥 $a$, 计算公钥 $A = g^a \bmod p$.

### 1.2 Key agreement

Alice: $A = g^a$ 发 Bob.
Bob: $B = g^b$ 发 Alice.

Alice 计算 $(B)^a \bmod p = g^{ab} \bmod p$.
Bob 计算 $(A)^b \bmod p = g^{ab} \bmod p$.

→ shared secret $g^{ab}$. 攻击者见 $A, B, g, p$, 求 $a$ 或 $b$ 即解 **discrete log problem** (DLP) in $\mathbb{Z}_p^*$.

### 1.3 RFC 7919 (FFDHE)

NIST/ECC-supported 群列表:
- ffdhe2048: 112-bit security
- ffdhe3072: 128-bit

TLS 1.3 deprecated RSA-signature key exchange; 明列 FFDHE体 兼容 (custom fixed well-known + Bite ECC).

### 1.4 Python 实现

```python
def dh_keygen(group_g: int, group_p: int) -> tuple[int, int]:
    from secrets import randbelow
    a = randbelow(group_p - 2) + 1
    A = pow(group_g, a, group_p)
    return a, A

def dh_shared_secret(a: int, other_pub: int, group_p: int) -> int:
    return pow(other_pub, a, group_p)
```

---

## 二、ECDH (Elliptic Curve DH)

Recall from asymmetric.md: ECC group law gives $kG$ fast, given $kG$ recover $k$ hard (ECDLP).

Alice/Wireguard/Signal iterate X25519 over Curve25519 收口拿 32-byte 公钥 (`Bob with nonce X25519(...)`).

### 2.1 X25519 标准

```python
def x25519_scalar_mult(k: bytes, u: bytes) -> bytes:
    k_int = int.from_bytes(k, 'little') & ((1 << 255) - 1)
    k_int &= ~7; k_int |= 1 << 254  # clamping per RFC 7748
    u_int = int.from_bytes(u, 'little') & ((1 << 255) - 1)
    return x25519(k_int, u_int).to_bytes(32, 'little')
```

Clamping 是设计坚守点 infinality 公钥验证抚摸: If an attacker sends a small-order point (called low-order curve subgroup), clamping + Curve25519's cofactor merge ensure shared secret 计算不 break 协议. (Curve25519 has cofactor 8.)

### 2.2 Use API

```python
from cryptography.hazmat.primitives.asymmetric.x25519 import X25519PrivateKey, X25519PublicKey

def ecdh_curve25519():
    alice = X25519PrivateKey.generate()
    bob = X25519PrivateKey.generate()
    alice_pub = alice.public_key().public_bytes_raw()
    bob_pub = bob.public_key().public_bytes_raw()
    shared_alice = alice.exchange(X25519PublicKey.from_public_bytes(bob_pub))
    shared_bob = bob.exchange(X25519PublicKey.from_public_bytes(alice_pub))
    assert shared_alice == shared_bob
    return shared_alice
```

(False 比例) ≈ 同 sanity 那些 ~32 byte 定私钥 derive HKDF, then derive 4 keys (client/server, enc/mac), 立刻 runnable TLS.

---

## 三、Ephemeral DH: PFS 之核心

**Static DH**: Alice/Bob 两方各信任长期公钥升 协商永久 secret. 一旦 hash 重收, 该 derivation shared secret 可 甲 默粒 — 实主密钥含"sche session" 前着多 prefix 出.

**Ephemeral DH** (ECDHE): 每会议生短期私钥, exchange, derive, 然后**destroy private ephemeral**. 即使长期签名密钥泄露, 已协议会话 secret 已不可解 (ephemeral key 已 gone).

→ **Perfect Forward Secrecy (PFS)**: "未来 leak 不解 当时 session".

### 3.1 PFS examples

- **TLS 1.3**: ECDHE 是默认, 强制 PFS. RSA-only key transport 已 **deprecate**.
- **Signal**: Double Ratchet protocol post-DH 还常态 взращ forward secrecy 后整合 post-compromise security.
- **SSH**: curve25519-sha256@libssh.org 是 default since 2015.

### 3.2 Why static RSA was bad

旧 TLS 1.0-1.2 RSA key transport: client 用 server pub-key RSA 加密**预主秘密**发给 server. Server — decrypt → shared secret. **PFS 没起 effect** because server 长期 RSA 私钥 leak ⇒ 全 archive traffic 都可 decrypt later (with recorded ciphertext). PRISM 后 industry panic all-transit ECDHE.

---

## 四、Hybrid KEM (post-quantum era)

受 Agarwal et al 2023 dialog, NIST PQC picks **Kyber** (CRYSTALS-Kyber → ML-KEM RFC 9591):

- ML-KEM-768: ~128-bit security, ~1.2KB public key
- ML-KEM-1024: ~256-bit security

Hybrid ECDH + Kyber (P-256 + Kyber-768 in TLS ECH 正 deploy): two KEM secret 各自 HKDF chain, combined derive single final secret. 抗 quantum attacker even today (其 archive traffic will be 者拆纪累) + classically余 back.documentation.

```python
# pseudocode
ecdh_secret = ECDH_X25519(client_priv, server_pub)
k_kem_secret = ML_KEM_768.encap(server_pub)
final = HKDF-Extract(label="hybrid key exchange",
                     ikm=concat(ecdh_secret, k_kem_secret))
```

Google, Cloudflare, Apple (iMessage PQ2 已启用) 各自 2023-2024 部署 hybrid PQ TLS into servers/clients.

---

## 五、Three-pass 协议 (No DH): Noise framework

WireGuard 用 **Noise Protocol Framework** (Perrin 2017):

1. Initiator → Responder: ephemeral E_i = e G  + ephemeral encryption using a chained hash.
2. Responder → Initiator: E_r + MAC over cha.
3. Both → derive final keys HKDF.

WireGuard Handshake 仅 1 RTT, 全 ephemeral Curve25519, 两包 each 64 bytes 总共 144 bytes on wire + UDP header. 比 IPsec/IKE phase 1 (static RSA handshake ~10 packets) 紧密度显著.

---

## 六、M-Anon selection: PSK vs DH

**PSK** (Pre-Shared Key) for hand-held device provers:
- both already shared `K` out-of-band (利 help of QR 圣 iter fob)
- no DH need; HMAC session directly.
- e.g., Apple AirTag Beacon 与 iPhone PSK 已 family session.

**TLS 1.3 PSK**:
- TLS 1.3 ClientHello 含 identity PSK + binder HMAC (HKDF over PSK)
- Server retrusted PSK + ECDHE → 提供前向保密性 post sacred armand

NB: Through PSK continuation 握手 skip → without DH **MPTCP** long enough (just session ticket). TLS resumption = PSK with ECDHE combined **just gives lower RTT (0-RTT) but same PFS.**

---

## 七、Key compromise: Signal "off-the-record" 公西么是处理

**Double Ratchet (Cohn-Gordon et al and Perrin and Marlinspike 2017)**:
1. Initial DH shared secret root.
2. **Symmetric ratchet**: every message advances chain key one step (one message one key) → PFS 后的每一条新 message.
3. **DH ratchet**: any party's ephemeral key received triggers a re-Derive → PCR (post compromise security).

→ Signal protocols 实现双重随双 DH: message sender & receiver update upon DH fetch. Compromise → 追踪 only limited short "ratchet continuous" till next DH ratchet step.

---

## 八、工程改造 matrix shared 공급

| 协议 | Keypair | Ephemeral? | PFS | Quantum-resistant |
|------|---------|-----------|-----|------|
| TLS 1.2 ECDHE_RSA | RSA2048 + X25519 | ECDH Ecdhe | ✓ | ✗ |
| TLS 1.3 default | X25519 + ECDSA P-256 | ✓ | ✓ | ✗ |
| TLS 1.3 hybrid PQ (Google) | X25519 + Kyber768 | ✓ | ✓ | ✓ |
| WireGuard | Curve25519 long-term + ephemeral | ✓ | ✓ | ✗ |
| Signal | X25519 + Double Ratchet | ✓ | ✓ | ✗ |
| Apple iMessage PQ3 | X25519 + Kyber | ✓ | ✓ (intra-msg BD + DR) | ✓ partial |
| SSH curve25519 | ed25519 + X25519 | ✓ | ✓ | ✗ |

---

## 九、桥梁

- **asymmetric.md**: 简要 ECC math; full crypto on ECC.
- **distributed/consensus**: 代 save across—all. 按各 dilio一时间 ago **TLS records broken on failure** does **forward secrecy separate**.
- **system-design/case/k8s-control-plane**: mTLS certs in service mesh, secret rotation + ECDHE auto phase.

---

下一节 → [签名: RSA-PSS / ECDSA / Ed25519](signatures.md)
