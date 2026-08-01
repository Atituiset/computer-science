# 5. 应用安全: OWASP Top 10 / 认证授权 / 数据安全 / 供应链

## TL;DR

密码学部分（第十部分）讲的是"加密算法怎么工作"；这一章讲**应用层安全**——你的 Web 服务怎么被攻击、怎么防御。攻击不是靠破解 AES，而是靠**应用逻辑漏洞**（注入、越权、逻辑绕过）。这一章以 OWASP Top 10 为主线，覆盖最常见攻击面 + 认证授权 + 数据安全 + 供应链安全。

读完应能：
1. 说清 OWASP Top 10 每一项的漏洞原理、攻击方式、防御手段。
2. 理解认证（你是谁）vs 授权（你能干嘛）的区别，会设计会话/JWT/角色权限。
3. 知道常见数据安全实践（加密/掩码/合规）。
4. 意识到底层依赖（供应链）也是攻击面。

---

## 一、威胁模型与信任边界

### 1.1 先想清楚"谁在攻击谁"

安全设计的第一步不是堆防护，而是**威胁建模（Threat Modeling）**：

```
信任边界 1: 用户 vs 公网         → 认证、输入校验
信任边界 2: 公网服务 vs 内部服务  → 内网隔离、mTLS
信任边界 3: 服务 vs 数据库        → 最小权限、加密连接
信任边界 4: 开发 vs 生产          → 密钥管理、环境隔离
```

每一条边界都要问：**跨这条边界的数据/调用，怎么被滥用？**

### 1.2 安全三原则

- **纵深防御（Defense in Depth）**：不只一层防护，层层都设防。
- **最小权限（Least Privilege）**：只给完成任务所需的最小权限。
- **默认安全（Secure by Default）**：默认关闭，需要才开。

---

## 二、OWASP Top 10（核心）

### 2.1 总览

| 序号 | 漏洞 | 一句话 |
|------|------|--------|
| A01 | 访问控制破坏 | 越权（IDOR），用户能访问不该访问的资源 |
| A02 | 加密失败 | 敏感数据明文存储/传输 |
| A03 | 注入（SQLi/命令注入） | 用户输入拼进查询/命令 |
| A04 | 不安全设计 | 信任边界/设计缺陷 |
| A05 | 安全配置错误 | 默认密码、多余端口、DEBUG 开着 |
| A06 | 易受攻击组件 | 依赖库有已知 CVE 不更新 |
| A07 | 认证与会话失效 | 弱口令、会话可预测、密码明文存 |
| A08 | 软件与数据完整性失败 | 反序列化漏洞、签名缺失 |
| A09 | 日志与监控不足 | 被入侵了但没日志抓不到 |
| A10 | SSRF | 服务端请求伪造，访问内网 |

### 2.2 A03 注入：SQL 注入（最经典）

**漏洞**：把用户输入直接拼进 SQL。

```python
# ❌ 危险：字符串拼接
query = f"SELECT * FROM users WHERE name = '{username}'"
# 输入: username = "admin' --" → 查询变成:
# SELECT * FROM users WHERE name = 'admin' --'
# 注掉后面所有条件 → 越权登录!

# ✅ 参数化查询
cursor.execute("SELECT * FROM users WHERE name = %s", (username,))
```

**防御**：**永远用参数化查询/预编译语句**，绝不用字符串拼接。ORM 通常默认参数化，但要小心 raw query。

### 2.3 A01 访问控制破坏：IDOR（越权）

**漏洞**：用户直接访问 `GET /order/12345`，没检查"这个订单是不是他的"。

```python
# ❌ 只按 id 查，不校验归属
def get_order(order_id):
    return db.fetch("SELECT * FROM orders WHERE id = %s", (order_id,))

# ✅ 校验归属
def get_order(user_id, order_id):
    row = db.fetch("SELECT * FROM orders WHERE id = %s AND user_id = %s",
                   (order_id, user_id))
    if row is None: raise Forbidden()   # 不归属 → 拒绝
    return row
```

**防御**：**服务端每次都必须校验资源归属**，不能只靠前端隐藏。用不可枚举的 ID（UUID 而非自增）只是缓解，不是修复。

### 2.4 A02 加密失败（敏感数据保护）

- 传输：全站 HTTPS（TLS），绝不允许 HTTP 明文。
- 存储：
  - 密码 → **哈希**（bcrypt/argon2/scrypt），**绝不明文**，绝不存可逆。
  - 信用卡/身份证 → 加密存储（AES-256）或 token 化。
  - 日志里不打敏感字段（手机号、身份证、token）。

```python
# 密码必须哈希，绝不加密（不需要解密回来）
import hashlib, secrets
# 用 bcrypt/argon2, 别用裸 sha256（太快）
# from argon2 import PasswordHasher
# ph = PasswordHasher()
# ph.hash(password)          # 存这个
# ph.verify(hash, password)  # 校验
```

### 2.5 A10 SSRF（服务端请求伪造）

**漏洞**：用户控制的 URL 被服务端去请求。

```python
# ❌ 用户能传 url 让服务端去访问
def fetch_image(url):
    return requests.get(url).content
# 攻击: url = "http://169.254.169.254/latest/meta-data/" → 访问云元数据(可能拿到密钥!)
```

**防御**：服务端不发用户可控 URL；若必须，白名单协议/域名、禁止内网 IP、过滤回环地址。

### 2.6 A06 易受攻击组件（供应链）

- 每个依赖库都可能有 CVE，**依赖扫描是 CI 的一部分**（`govulncheck` / `npm audit` / Dependabot）。
- 攻击载体：`package-lock.json` / `go.sum` 应锁定版本并签名校验。
- **不只是依赖**：基础镜像（Docker base image）、Terraform 模块、NPM 包都是供应链。

---

## 三、认证与授权

### 3.1 认证（Authentication）vs 授权（Authorization）

```
认证: 你是谁?  → 登录/口令/SSO/MFA
授权: 你能做什么? → 角色/权限/策略
```

**经典错误**：只做了认证忘了授权 → "能登录 = 能访问一切"（IDOR 的根源）。

### 3.2 会话管理（Session）

- 登录成功后服务端生成 session（随机高熵 id），存服务端，客户端拿 cookie。
- 安全要点：
  - session id 用加密安全随机数（`crypto/rand`）
  - cookie 加 `HttpOnly`（防 XSS 读）、`Secure`（仅 HTTPS）、`SameSite`
  - session 过期 + 登出使失效

### 3.3 Token 方案（JWT）

**JWT**（JSON Web Token）= `header.payload.signature`，无状态（服务端不存）。

```
header:  {"alg": "HS256", "typ": "JWT"}
payload: {"sub": "user123", "role": "admin", "exp": 1700000000}
signature: HMAC-SHA256(header.payload, secret)
```

**安全要点**：
- `alg` 必须白名单（防 alg=none 绕过）
- secret 用强随机 + 环境变量/密钥管理，不进代码
- 必须校验 `exp`
- **放授权信息在 JWT 里要小心**：改 role 后要能强制失效（因为无状态，无法吊销）

### 3.4 授权模型

| 模型 | 说明 | 适用 |
|------|------|------|
| **RBAC**（基于角色） | 用户 → 角色 → 权限 | 大多数系统 |
| **ABAC**（基于属性） | 策略用属性组合（用户/资源/上下文） | 复杂规则 |
| **Policy engine** | OPA / Casbin 声明式策略 | 微服务统一授权 |

```yaml
# OPA 策略示例: 用户只能改自己的订单
allow {
  input.method == "PATCH"
  input.path == ["orders", order_id]
  order_id == input.user_id
}
```

### 3.5 会话固定 / 重放 / 爆破

- **爆破**：限流 + 失败锁定 + 验证码。
- **会话固定**：登录成功后轮换 session id。
- **重放**：请求加时间戳/nonce，服务端校验。

---

## 四、常见 Web 攻击（补充 OWASP）

### 4.1 XSS（跨站脚本）

- 存储型/反射型/DOM 型；用户输入当 HTML/JS 执行。
- 防御：**输出转义**（`html.escape`）、CSP 头、`HttpOnly` cookie、输入过滤。

```python
# ❌ 把用户评论直接插进 HTML
return f"<div>{comment}</div>"   # 用户输入 <script>alert(1)</script>

# ✅ 转义输出
import html
return f"<div>{html.escape(comment)}</div>"
```

### 4.2 CSRF（跨站请求伪造）

- 攻击者让受害者浏览器向你的站点发请求（带 cookie）。
- 防御：CSRF token、`SameSite=Strict/Lax` cookie、自定义 header。

### 4.3 开放重定向 / 点击劫持 / 文件上传

- 文件上传：校验 MIME + 扩展名 + 大小，存储隔离，禁执行目录。
- 点击劫持：`X-Frame-Options: DENY` / CSP `frame-ancestors`。

---

## 五、数据安全与合规

### 5.1 数据生命周期

```
采集 → 传输(加密) → 存储(加密) → 使用(最小权限) → 归档 → 删除(合规)
```

### 5.2 分类与脱敏

- 敏感数据（PII：手机号/身份证/邮箱）要有分类标记。
- 日志/测试环境**脱敏**（掩码 `138****1234`）。
- 备份同样加密。

### 5.3 合规（GDPR / 个保法）

- 数据最小化（只采集需要的）
- 用户有"被遗忘权"（删除请求）
- 跨境传输需评估
- 日志保留期限有上限

---

## 六、安全工程实践（落地）

### 6.1 密钥管理

- **绝不把密钥写进代码**（硬编码是头号漏洞）。
- 用密钥管理服务：AWS Secrets Manager / HashiCorp Vault / K8s Secret。
- 环境变量分离 + 部署时注入。
- 密钥轮转 + 审计。

```bash
# ❌ 硬编码
DB_PASSWORD="abc123"

# ✅ 从环境/密钥管理读取
export DB_PASSWORD=$(vault read -field=value secret/db)
```

### 6.2 安全头（HTTP 层）

```yaml
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

### 6.3 依赖与 CI 安全

```
CI 步骤:
  - 依赖漏洞扫描 (govulncheck / npm audit / trivy)
  - 镜像扫描 (trivy / grype)
  - SAST 静态分析 (semgrep / gosec)
  - 密钥扫描 (git-secrets / gitleaks)
  - 依赖锁定 + 签名校验
```

### 6.4 安全清单（上线前）

```
[ ] 全部用 HTTPS
[ ] 参数化查询（无字符串拼接 SQL）
[ ] 所有资源访问校验归属（防 IDOR）
[ ] 密码 bcrypt/argon2 哈希
[ ] 会话: HttpOnly/Secure/SameSite cookie
[ ] 依赖扫描通过
[ ] 密钥在密钥管理, 不在代码
[ ] 安全头配好
[ ] 日志不记敏感字段
[ ] 权限最小化（DB/服务/云）
```

---

## 七、与第十部分密码学的衔接

| 应用层安全 | 底层密码学 |
|-----------|-----------|
| HTTPS 部署 | TLS 1.3 握手（crypto §tls13） |
| 密码哈希 | bcrypt/argon2（基于哈希 §hashes） |
| JWT 签名 | HMAC-SHA256（§hashes） |
| 加密存储 | AES-256（§symmetric） |
| 防篡改 | 数字签名（§signatures） |

应用安全是密码学的**工程落地**；密码学给应用安全提供原语。

---

## 八、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **威胁建模**：每条信任边界问"数据/调用怎么被滥用"。
> - **三原则**：纵深防御 / 最小权限 / 默认安全。
> - **OWASP 三巨头**：注入（参数化！）、IDOR 越权（校验归属！）、加密失败（密码哈希！）。
> - **SSRF**：服务端请求用户可控 URL → 白名单 + 禁内网。
> - **认证≠授权**：登录 ≠ 能访问一切。
> - **会话**：加密随机 id + HttpOnly/Secure/SameSite + 过期。
> - **JWT**：无状态、校验 exp、alg 白名单、secret 不硬编码。
> - **XSS**：输出转义 + CSP + HttpOnly；**CSRF**：SameSite + token。
> - **密钥**：绝不硬编码，用 Vault/Secrets Manager。
> - **供应链**：依赖扫描进 CI，锁定版本。
> - **上线清单**：HTTPS / 参数化 / 越权 / 哈希 / 安全头 / 扫描。

---

下一篇: [6. 代码质量: 重构 / code review / 复杂度治理 / DDD 落地](code-quality.md).
