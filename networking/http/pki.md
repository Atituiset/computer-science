# 证书链 / PKI / OCSP stapling

## TL;DR

TLS 给 client 验证 server 身份的两个核心问题：(1) 证书是谁签的，怎么验？(2) 证书撤回了吗？前者是 X.509 + CA 信任链；后者是 OCSP、CRL、Must-Staple、CRLite。本节讲 ASN.1 证书的实际字段，为什么 CA 不能 root 全签叶证书，OCSP 实时性的代价，Let's Encrypt 用 ACME 流水化的新时代签发，以及 HPKP 锁死 CTO 自杀事故。

---

## 一、X.509 v3 证书真实结构

X.509 证书是 ASN.1 DER 编码，RFC 5280 定义结构：

```
Certificate ::= SEQUENCE {
    tbsCertificate      TBSCertificate,    ← 真正证书主体
    signatureAlgorithm  AlgorithmIdentifier,
    signatureValue      BIT STRING          ← CA 对 tbsCertificate 的签 hash
}

TBSCertificate ::= SEQUENCE {
    version         [0] EXPLICIT Version DEFAULT v1,
    serialNumber    CertificateSerialNumber,
    signature       AlgorithmIdentifier,
    issuer          Name,                   ← 签发机构名
    validity        Validity,               ← notBefore / notAfter
    subject         Name,                   ← 主体名 (CN, O, OU, C...)
    subjectPKI      SubjectPublicKeyInfo,
    issuerUID      [1] IMPLICIT BIT STRING OPTIONAL,
    subjectUID     [2] IMPLICIT BIT STRING OPTIONAL,
    extensions     [3] EXPLICIT Extensions OPTIONAL  ← v3 only
}
```

### 1.1 关键扩展

| Extension | OID | 用途 |
|-----------|------|------|
| `subjectAltName` | 2.5.29.17 | 多域名 + wildcard (e.g. `DNS:*.example.com, IP:10.0.0.1`) |
| `basicConstraints` | 2.5.29.19 | `CA:TRUE/FALSE` + `pathLenConstraint` |
| `keyUsage` | 2.5.29.15 | `digitalSignature, keyEncipherment, ...` |
| `extKeyUsage` | 2.5.29.37 | `serverAuth, clientAuth, codeSigning` |
| `authorityKeyIdentifier` | 2.5.29.35 | 找签发者 cert |
| `subjectKeyIdentifier` | 2.5.29.14 | 当前证书指纹 |
| `certificatePolicies` | 2.5.29.32 | OV/EV 策略 |
| `authorityInfoAccess` | 1.3.6.1.5.5.7.1.1 | 包含 `ocsp` URL + `caIssuers` URL |
| `crlDistributionPoints` | 2.5.29.31 | 旧式 CRL URL |
| `sCTList` | 1.3.6.1.4.1.11129.6.2 | 透明度日志 SignedCertificateTimestamp |

### 1.2 实际样例

```bash
$ openssl x509 -in example.com.crt -text -noout
Certificate:
    Data:
        Version: 3 (0x2)
        Serial Number:
            04:8b:d9:3a:dc:3d:71:78:e1:98:7a:14:e7:eb:67:8d
    Signature Algorithm: ecdsa-with-SHA256
        Issuer: CN=E5, O=Let's Encrypt, C=US
        Validity
            Not Before: Aug 12 04:30:00 2024 GMT
            Not After : Nov 10 04:30:00 2024 GMT   ← 90 天有效期
        Subject: CN=example.com
        Subject Public Key Info:
            Public Key Algorithm: id-ecPublicKey
                Public-Key: (256 bit)
                pub: 04:9d:5b:28:7b:6e:... 38 bytes
                ASN1 OID: prime256v1
                NIST CURVE: P-256
        X509v3 extensions:
            X509v3 Key Usage: critical
                Digital Signature
            X509v3 Extended Key Usage:
                TLS Web Server Authentication, TLS Web Client Authentication
            X509v3 Basic Constraints: critical
                CA:FALSE
            X509v3 Subject Key Identifier:
                2A:3B:F0:E1:38:65:21:5F:AC:9F:7E:F0:F0:B3:4E:12:FF:61:75:7B
            X509v3 Authority Key Identifier:
                keyid:8D:02:78:81:68:91:80:71:52:8C:A3:48:2B:99:9D:1F:5F:86:E5:6F
            X509v3 Subject Alternative Name:
                DNS:example.com, DNS:www.example.com
            Authority Information Access:
                OCSP - URI:http://e5.o.lencr.org
                CA Issuers - URI:http://e5.i.lencr.org/
            CT Precert SCTs:
                log_id 1: ... 
                log_id 2: ...
    Signature Algorithm: ecdsa-with-SHA256
         30:45:02:20:54:ac:.....
```

### 1.3 ASN.1 / DER 编码

```python
# = subjectAltName example 简化
SEQUENCE [
  OCTET STRING (encapsulates)
    SEQUENCE [
      [2] IMPLICIT IA5String "example.com"   # tag=2 is DNS
    ]
]
DER byte layout:
30 13              # SEQUENCE, len 19
  82 0b            # context [2] IA5String, len 11
  "example.com"
```

DER 是定长编码（不像 BER 可含冗余），保证 "同内容 = 同字节"。证书指纹 (`X.509 SHA-256 fingerprint`) 因此稳定。

---

## 二、信任链与路径构建

### 2.1 三层结构

```
Root CA              (自签名, 内置 OS trust store, 30-year cert)
   └─ Intermediate CA    (5-10-year cert, 公网可 ==)
        └─ Leaf           (90-day cert, 业务证书)
```

为什么不能 root 直接签 leaf？
1. root 私钥必须离线安全保管（物理隔离 HSM），频繁操作风险大
2. intermediate 关闭 (Compromised intermediate)：吊销其证书不影响 root
3. 多个 intermediate 用于不同业务（.LE: E1/E2 ECDSA，R3/R10/R11 RSA）

### 2.2 路径构建（RFC 5280 §6）

Client 验证步骤（典型）：
```
1. 从 leaf 起向上找 issuer
   issuer可能在 leaf cert 中附带（handshake send full chain）
   或 client 预装 intermediate cache
2. 找到 self-signed root → 终止
3. 验每对 (parent_signature on child):
   - 检查有效期 (notBefore < now < notAfter)
   - 检查 revocation (CRL/OCSP)
   - 检查 keyUsage (issuing CA 必须有 keyCertSign)
   - 验签
4. 检查 name constraints (RFC 5280 §4.2.1.10)
   CN 主须匹配
```

### 2.3 cross-sign

新 CA 在 OS 信任普及前可选 cross-sign：同一 leaf cert 被两个不同 root 签 → 客户端任一信任即可用：

```
ISRG Root X1 (Let's Encrypt) ─┐
                              ├─ R3 intermediate ── leaf (example.com)
DST Root CA X3 (IdenTrust)  ─┘
       ↑                          ↑
   新 root (现代 OS trust)    老 root (老 Android trust)
```

Let's Encrypt 用此方案支持老 Android 上 dual-trust，2021-09 DST Root CA X3 到期后又用特殊"trust extension"续 3 年。

---

## 三、OCSP / CRL 实现

### 3.1 CRL (Certificate Revocation List, RFC 5280)

CA 周期发一份"已吊销证书"列表：
```
CRL ::= SEQUENCE {
    tbsCertList   TBSCertList,
    signatureAlg  AlgorithmIdentifier,
    signature     BIT STRING
}

TBSCertList ::= SEQUENCE {
    version, signature, issuer, thisUpdate, nextUpdate,
    revokedCertificates SEQUENCE OF SEQUENCE {
        userCert    CertificateSerialNumber,
        revocationDate   Time,
        crlEntryExtensions Extensions OPTIONAL
    }
}
```

缺陷：
- **太大**：CA-Browser Forum 限制 <64MB 但仍然每刷新下载大
- **延迟**：CA 每几天发一份，吊销后到下份 CRL 间隙 → 攻击者可利用
- **缓存差**：浏览器不愿每连接拉 5MB

Chrome / Firefox 实际**默认不查 CRL** —— 商业 CA 也不强推。

### 3.2 OCSP (RFC 6960)

```http
POST http://ocsp.digicert.com
Content-Type: application/ocsp-request

asn.1 encoded:
{ request { tbsRequest { reqList { CertID { hashAlgorithm: SHA1, issuerKeyHash, issuerNameHash, serialNumber } } } } }

Response:
HTTP 200
Content-Type: application/ocsp-response

OCSPResponse { responseStatus=successful, responseBytes { ocspBasic { tbsResponseData { responses { CertID, certStatus={ good | revoked | unknown }, thisUpdate, nextUpdate } }, signatureAlgorithm, signature } } }
```

realtime 查询：CA OCSP responder 几秒内回复。优点：
- 微小（<1KB）
- 比较实时（24h 内）

实际部署难点：
1. **隐私**：CA 知道每个 client 访问过哪些网站（client 主动查 OCSP）
2. **延迟**：每 TLS handshake +1 RTT 查 OCSP，100ms+ penalty
3. **可用性**：CA OCSP responder 挂 → 浏览器 fallback soft fail = 接受，安全性 = 0

### 3.3 OCSP stapling (RFC 7681)

server 主动从 CA 取一遍 OCSP response，在 TLS handshake 中跟随 cert 发：
```
client → ClientHello + status_request extension
server → Certificate
       → CertificateStatus (含 OCSP response)
client 直接验证OCSP response 签名 → 不需访问 CA
```

刷新：OCSP response 有效期 ~7 天，server 每 2 天拉取一次。

```nginx
ssl_stapling on;
ssl_stapling_verify on;
ssl_trusted_certificate /etc/ssl/ca-chain.crt;
resolver 8.8.8.8;
```

### 3.4 Must-Staple extension

cert 在 `TLS Feature extension` (OID 1.3.6.1.5.5.7.1.24) 中加 `status_request` → client **必须看到** 有效 stapled OCSP response 才接受证书。

效果：防 CA 静默回退（OCSP 私下合格 → 应用以为 cert revok 但 OTP "sta 自 默认")

风险：server stapling 失效 → 全站 client 拒连。必须配合严格监控 + multi-route fallback。

### 3.5 CRLite

Mozilla Firefox 推出（2018）：
- Bloom filter 把全 web 证书吊销压缩到 ~1MB
- 客户端启动时下载 + 周期增量
- 三层 Bloom filter 解决 false positive（first / second / third layer）

**缺点**：仅 Firefox 用，Chrome / Safari 没采用，有一定抵制 (Chrome 用 CRLSet 名单方式)。

### 3.6 CRLSet

Chrome / Blink 用自家 CRLSet：CA 主动 push 一组**重大** revoked cert list (subset of all certs) 给 client embed。装在 Chrome 升级包中。

理论不完整但实战 OK，因为 major CA 公开上次 breaches才被 push 进 CRLSet。

---

## 四、ACME (RFC 8555)

Let's Encrypt 协议，自动化证书签发：
```
1. Client GET https://acme-v02.api.letsencrypt.org/directory
   → 拿到所有 endpoint: newAccount, newOrder, ...

2. POST newAccount (JWS-signed)
   → 创建 account, 拿 URL

3. POST newOrder
   identifiers: [{type: dns, value: example.com}]
   → 拿 order URL

4. server 返回 challenges
   - HTTP-01:  http://example.com/.well-known/acme-challenge/<token>
   - DNS-01:   TXT _acme-challenge.example.com → <token>
   - TLS-ALPN-01: ALPN cert

5. client POST challenge URL 上 prove

6. client POST finalize (CSR)
   → server 签 cert, status=valid

7. client GET cert URL → download PEM
```

签名方案 JSON Web Signature (JWS, RFC 7515)。account 用 ECDSA / RSA 私钥签 URL+payload，server 验签。

Rate-limit：
- 50 certs / registered domain / week
- 5 failure / hour / account
- 10 duplicate cert / week

### 4.1 cert-manager (K8s)

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@example.com
    privateKeySecretRef: { name: letsencrypt-prod-key }
    solvers:
      - http01: { ingress: { class: nginx } }
      - dns01: { route53: { region: us-east-1 } }   # wildcard 必须用 DNS-01

---
apiVersion: cert-manager.io/v1
kind: Certificate
metadata: { name: example-com }
spec:
  secretName: example-com-tls
  dnsNames: [example.com, '*.example.com']
  issuerRef: { name: letsencrypt-prod, kind: ClusterIssuer }
```

`Secret` 60-90 天自动轮替，Ingress 自动拿到新 secrets。

### 4.2 ACME 痛点

1. **DNS-01 DNS 传播延迟**：TTL 60s 有时太短，Let's Encrypt 验正确概率 0.3% → 重试。Cloudflare API 1s 同步稍优。
2. **HTTP-01 必须公网 80 端口可达**：内网无法签。网络隔离严格时无奈。
3. **Rate-limit 触发封账号**：测试环境误用 prod endpoint 几次后又用同一 email → 短期被限。
4. **staging endpoint 必须用**：`acme-staging-v02.api.letsencrypt.org` 不受限。

---

## 五、HPKP 锁死事件档案

### 5.1 HPKP 历史设计

HTTP Public Key Pinning: client 第一次访问记录 cert 的 SPKI hash → 后续访问只接受这些 pinned hash。如果新 cert 不符 → 拒绝。

设计目的：防 CA Misissuance（Symantec 案）乱发 Google cert。

### 5.2 风险

couple cert 升级方案被锁死：CTO 调错 pin → 自己域没法访问 → 直到 pin 过期 max-age 1 年。**没有 recovery**（除非说每个用户单独清浏览器 cache）。

### 5.3 真实事故

- **2015 Erik Kay** (Rackspace engineer): privacy snipper name pin → 让 7百万 Netflix 用户断
- **2017 Comodo 公告**：准备 introduce 但 Google Chrome 提前 announce 废弃 → not push
- **2018 Toptal**：CTO 误配，自锁用户全部 logout 1 周

### 5.4 Chrome 移除

2018-05 Chrome 67 移除 HPKP 支持。Firefox 同步。RFC 7469 BC defer。

### 5.5 替代方案

- **CT (Certificate Transparency)**：CA 强制推签入 append-only log → client 可以审计新 cert。Chrome 用 CT 强制一切 public cert 必须有 SCT (Signed Timestamp)。
- **CT Log 监控**：org 自查"我域名哪些 cert 在被签发" → 检测异常签发。
- **Pinning 仅应用级**：Android Network Security Config + iOS ATS 可在 App 内 hardcode cert，但 PWA/浏览器层不再 hardcode。

---

## 六、产线事故

### 事故 1：OCSP responder 间歇挂 → 客户端体验变差

某 CA (DigiCert) OCSP responder 在 2023-03 因为流量激增 timeout 频繁。Chrome / Safari soft fail 但启 OCSP must-staple 的客户站点 RST 大量。

**修复**：
- 监控 OCSP 响应时间 secondary
- 客户端 cache OCSP response 24 小时（减少 resend）
- stalping 必须强制 + 多 responder 路径

### 事事故 2：证书过期（人肉流程失败）

某 SaaS 因证书只有 90 天有效期，运维忘轮替 → 突发过期 → 全站 customer-facing TLS handshake 通通失败。

**修复**：自动 cert-manager + Prometheus exporter + alert 提前 14 天 warning。

### 事故 3：CT 监控发现陌生 cert

某公司 CT 监控发现外包运维公司签发了该域名 cert 但**不在公司 portfolio 中**。追踪到 outsourcing company verification 不到位。

**修复**：CA account ACME 严管 access 管理 + C AA records (RFC 6844) 限定只允许 Let's Encrypt 签本域。

### 事故 4：CAA 痛点

CAA record 配错 (`0 issue "letsencrypt.org"` 但缺 `issuewild`) → 仍被签 wildcard → CVE-前置。

**修复**：CAA 都配 `issuewild`，禁止 wildcard 签发。

### 事故 5：CT enforcing 段未配

某 cloudflare customer cert 没 SCT，Chrome reject。业务误以为是 cloudflare bug。

**修复**：签 cert 时强制要求 CA 用 CT-friendly issuance, 通过 e5/e6 等 LE endpoint。

---

## 七、易错清单

1. **证书过期**：业务不会自动 renew，必须 cert-manager 或类似工具自动
2. **OCSP stapling 失效**：服务端必须监控 `sslStaplingStatus`，否则 silent fail
3. **must-staple** 是双刃剑：cert 配上后 server stapling 失效 = 全部客户端拒连
4. **CRLite 仅 Firefox 支持**，公网监控只能假设所有浏览器都不查 CRL
5. **HPKP 已废弃**，再做有害无益
6. **CAA record 是合适防护**但 issuer 名 + issuewild 都要配
7. **wildcard 必须用 DNS-01 challenge**，HTTP-01 不能签 wildcard
8. **OCSP 一次拉取仅 4-7 天有效期**：nginx stapling 默认每天 refresh，但 server 重启 cache 清空

---

## 八、这一章带走的东西

1. X.509 = ASN.1 DER 编码的 TBSCert + 签名，扩展字段用 SAN/keyUsage/EKU 表达 wildcard 与用途
2. CA 三层结构 (root → intermediate → leaf) 是机房运维安全 + 商业隔离双重要求
3. OCSP/CRL 在产线上普遍失败，stapling + CT + must-staple 给"还能用的"答案
4. ACME 流水化：HTTP-01 / DNS-01 / TLS-ALPN-01，cert-manager 给 K8s 自动管理
5. HPKP 失败教训：主动 pin 不可逆设计有 lockout 灾难，谁碰谁死
6. CAA record + CT log 监控能拦下陌生 cert 的签发探测

## 下一节 →

[gRPC / Protobuf / Thrift](./rpc.md) — protobuf varint 编码、wire types、HTTP/2 trailers、4 模式 RPC 完整 spec。
