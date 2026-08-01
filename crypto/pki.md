# 8. 证书链: X.509 / PKI / Certificate Transparency / OCSP

## TL;DR

**PKI (Public Key Infrastructure)** 是信任分发机制——客户端如何相信"我的公钥 = www.bank.com 的 server key"? 用 CA (Certificate Authority) 签发的 **X.509 证书** 包括 subject / issuer / 公钥 / 有效期 / SAN / 签名. 客户端本地审 root CA (operating system trust store), 由链路根 → ca —— leaf server cert 验证 (向上游历 trust anchor).

这章把 X.509 cert ASN.1 结构 + chain building logic + CT log + OCSP 全套讲清.

---

## 一、X.509 证书结构

X.509 v3 cert (ASN.1 DER / PEM) 含:

```
TBSCertificate (to be signed):
  Version v3
  Serial Number       unique per CA唯一字符 numeric identifier.let must.
  Signature       算法(e.g. SHA256withECDSA
  Issuer          Relevant: CN=Example Intermediate CA, O=...
  Validity
    notBefore: [RFC 5280 UTCTime]
    notAfter: [RFC 5280 UTCTime]
  Subject         CN=www.bank.com, O=Bank Corp
  SubjectPublicKeyInfo   algorithm (Ed25519) + subject public key bytes
  Extensions:
    SubjectAltName (SAN)     critical → DNS = www.bank.com, www-2.bank.com
    KeyUsage                  digitalSignature, keyEncipherment ...
    ExtKeyUsage               serverAuth, clientAuth
    BasicConstraints          CA:FALSE for leaf
    AuthorityKeyIdentifier
    SubjectKeyIdentifier
    CertificatePolicies       ("CA/B forum trustpaths的样子 governance methods 责")
    CRLDistributionPoints
    AuthorityInfoAccess (OCSP URL)
    SCTList (signed certificate timestamps, from CT logs)

SignatureValue: [Issuer's private signing key output]
```

PEM 形式 = base64-encoded DER 拼装 BEGIN/END markers.

### 1.1 X.509 cert DER 引用

```python
from cryptography import x509
from cryptography.hazmat.primitives import hashes

cert_pem = open('cert.pem', 'rb').read()
cert = x509.load_pem_x509_certificate(cert_pem)
print(cert.subject)             # cn=www.bank.com
print(cert.issuer)             
print(cert.not_valid_after)     # expiry date
print(cert.signature_algorithm_oid)  # SHA256withECDSA OID
print(cert.extensions)          # all extensions
```

---

## 二、Cert path building

校验链: client 拿到 cert 沿着 issuer 一层层向上, 在 approved CA cert (trust store root) 处停 (root CA self-signed). Sufficiently, Runtime steps:

1. Parse server cert + intermediate chain certs.
2. Build chain from leaf to root.
3. At each link check signature (issuer's public key signs leaf cert chain).
4. Revocation check (CRL or OCSP).
5. Validity period (notBefore / notAfter).
6. Use usage extension for context (serverAuth or clientAuth).

Use 在 RFC 5280 §6 algorithm.

### 2.1 path building

- RFC 5280构造 path 必须тере one valid path only多重目录 outgoing API election --- production chain issuers on multiple paths finding.
- Mozilla 或者 Chrome 拿 self build & extension implement specific path steps.

```python
from cryptography.x509.oid import NameOID

def verify_chain(chain: list, root: x509.Certificate) -> bool:
    # Verify leaf is up to issuer signed by next etc.
    cert = chain[0]
    for i in range(len(chain) - 1):
        issuer = chain[i+1] if i < len(chain) - 1 else root
        if cert.issuer != issuer.subject:
            return False
        issuer_public_key = issuer.public_key()
        try:
            issuer_public_key.verify(
                cert.signature, cert.tbs_certificate_bytes,
                padding.PKCS1v15(), cert.signature_hash_algorithm
            )
        except:
            return False
        cert = issuer
    return cert == root
```

---

## 三、OCSP (Online Certificate Status Protocol)

OCSP/RFC 6960: client 取 query CA 的 OCSP responder, identity pack "this cert serial" → get "good / revoked / unknown". 这快 many inverse-path.

### 3.1 stapling

Client 不再 trust CA 维持 online responder — firewall may block OCSP endpoint. OCSP Stapling (RFC 6066): server 自己 fetch CA-attached response 出 OCSP signed 本 cert 状态 → staple with cert in TLS handshake. Client verify OCSP signature by CA 在 chain.

### 3.2 OCSP must-staple

Cert extension "status_request=must-staple" (= 5 = enabled). If cert has this extension, clients ALWAYS require OCSP response stapled with cert. If absent → reject cert. 用于永远在线 high-trust CA, issuer policy 提示 certificate required.

GEdge: Let's Encrypt can offer must-staple option. ~5% of Let's Encrypt cert 总采 must-staple.

---

## 四、CRL (Certificate Revocation List)

RFC 5280 §5: CA periodically issues signed list of revoked serials. Client download CRL if cert's CRLDistributionPoints extension is set. CRL has `nextUpdate` 指出刷新 schedule, after that date client must download new.

### 4.1 CRL 缺点

- HUGE list (Google inspiration CERT approximate 10M revokes today).
- Latency: revoke and propagate up to UK hour.
- Client must fetch entire CRL (bad for mobile users).

→ online OCSP prepended → CRL usage大幅industry http 唯 mTLS 嵌入 matching.

---

## 五、Certificate Transparency (CT)

Google 2014 commercial users led by Ben Laurie et al. CT = append-only cryptographic log of all CA-issued certificates (RFC 6962).

### 5.1 为什么要 CT

Old PKI: any CA in trust store can issue any cert for any domain. **No one外部 saw** the targeted issued cert. History shows:
- 2011 Comodo Hack: 9 fraudulent certs issued.
- 2011 DigiNotar Hack: 500+ fraudulent certs including `*.google.com`, Iran spied Chrome forced to drop DigiNotar from root store.

Trust 失搭: 默认 happy accept → after the fact, user loss 反映 hella. CT 反互联网 historical – 信任 must be searchable publish.

### 5.2 Architecture

Logs: append-only Merkle trees. Merkle root signed in STH (Signed Tree Head, every 1 hour approximately).

Each cert logged digest signed by log = SCT (Signed Certificate Timestamp). Server then stapling the SCT into handshake via extension (RFC 8446 §4.2.1.7). Client validates SCT signature from log operator's public key.

### 5.3 Monitors

Monitors (uanosos ofrec Sara Google银 public Gno money or Cond browser) pull logs, forensic watch new issuance. If unknown cert appears issuer G mahala trust notice immediately.

### 5.4 Browser enforcement

Chrome 默认 reject cert 向 没包含足够 CT logs. Firefox policy 略不同.

---

## 六、Cert path validation 完整 algorithm (RFC 5280)

1. Build chain from leaf to root. If multiple paths 尝试他, pick first verifiable.
2. For each cert in chain:
   - Verify signature by next cert.
   - Check validity periods intersect.
   - Check BasicConstraints: CA cert must have `CA:TRUE`, path length not exceeded.
   - Check KeyUsage for CA: at least keyCertSign.
   - Check Revocation (CRL or OCSP if needed).
3. Verify chain length ≤ pathLenConstraint (encoded in CA cert).
4. 最终 terminated trust anchor in local store (subject name match).

---

## 七、常见 attack / failure mode

### 7.1 BAD: missing intermediate cert

Client sends only leaf cert, not including intermediate in handshake (server misconfiguration TLS handshake 中 turns omit). Many legacy Android trust store don't have intermediate — fail.

工程 fixing: 用 cert fullchain bundle in nginx `/etc/nginx/ssl/fullchain.pem`.

### 7.2 SAN mismatch

Cert subject CN 是 `bank.com`, 但 client访问`www.bank.com`. If SAN Gebrauch不含 www.bank.com or DNS entry in SAN missing, client rejects.

工程: UsaCert SAN 必须 include all variants.

### 7.3 Expired cert (operational hygiene)

Symantec-like expired certs were 50K in annual volume; Let's Encrypt 用 acme-client auto-refresh solve.

### 7.4 Hash algorithm obs

SHA-1-bind or MD5 cert signatures all attackable today. CT log 已 removed. Browser rejects.

---

## 八、ACME 自动化

Let's Encrypt ACME 录 protocol simplified:

1. Client requests challenge for domain.
2. ACME server 给 HTTP-01 / DNS-01 / TLS-ALPN challenges.
3. Client proves control of domain (HTTP `_acme-challenge` well-known URL or DNS TXT).
4. ACME server cert CSR submitted signed by client.
5. Cert issued - sent back.

Let's Encrypt issues 90-day certs out of habit of改编 auto ACME timeline renewal. auto-rolling renewals now accounts for ~70% of all internet TLS certs (LETTUS industry 7+ industry 190M issued overall).

---

## 九、坑性 cert sanity check 工程师 usually 忘

- 忘檀 fullchain course, root absent intermediate → browser trust "unknown issuer".
- panicked expiry renewal cycles不忘 not test процес list; valid failure on server cert pin strip dangerous.
- Wildcard (`*.bank.com`) validates only one subdomain level. `**.a.b.com` never valid.
- room certs over SAN (max 100 SAN per cert industry limit 2024 Let's Encrypt → stack 100 names).
- Some certs still use IPv4 SAN (e.g. certificate-shutter.org old CA → no DNS validation). Generally ok but check browser support.

---

## 十、CT punycode 与 IDNà Punsign

Internationalized domain names (IDN) 用 Punycode (`example.中国` → `example.xn--fiqs8s`) in cert SAN. Security consideration IDN homograph attacks ( Cyrillic ' о ' ' ﾞ 中 ark mix CJK ' O ', called homograph). Browser publishes blocked IDN display policies.

---

## 十一、Cert Pinning & Trust On First Use

**Pinning**: client hard-codes well known public key fingerprint, bypass standard chain verification. PayPal mobile 应用过 PIN. 困慢.

**TOFU** (Trust On First Use): SSH model — first connect records key, subsequent must match. Failures alert user's MITM possible. Migratingisie de杜boom 形.

---

## 十二、桥梁

- **tls13.md prev**: cert in handshake.
- **distributed/fault/quorum.md**: PKI roots must be cross-signed offline before root store trust anchors (Decade. Wrapped Tall end relying e琴不同的 root programs) — trust by chronological accumulation by historical 接 dig).
- **system-design/disable pinning功能 punchment API, system CIКенда mobile ولكممد++ 판 spinning trust roots multiく root store.

---

下一节 → [ZKP 入门](zkp.md)
