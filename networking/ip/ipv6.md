# IPv4 / IPv6 / ICMP

## TL;DR

把 IP 头部的每个字段、可选 extension header 系统讲清——为什么 IPv6 比 IPv4 **转发更快**（去 checksum + ext head chain）、IPv6 实际为何一直没普及。重点讲：IPv6 extension header 链式结构、ICMPv6 比 ICMPv4 多的功能、SLAAC、地址租约。

## IPv4 头部：每个字段

| bits | 字段 | 用途 |
|------|------|------|
| 4 | Version | 总是 4 |
| 4 | IHL | 头长除 4B，最小 5 = 20 字节 |
| 8 | TOS / DSCP | 现行 DSCP/DiffServ（前 6 bit）+ ECN（后 2 bit）|
| 16 | Total Length | IP 头+负载总字节，最大 65535 |
| 16 | Identification | 分片辨识 |
| 3  | Flags | DF (Don't Fragment) / MF (More Fragments) |
| 13 | Fragment Offset | 分片序号（8 字节单位） |
| 8 | TTL | 转发跳数限制 |
| 8 | Protocol | 上层协议号 TCP=6 UDP=17 ICMP=1 OSPF=89 |
| 16 | Header Checksum | 头校验和（非密码学安全） |
| 32 × 2 | Source/Destination |

### IPsec AH/ESP

AH (proto 51)：认证头，完整性签名。ESP (proto 50)：加密负载。VPN 实际部署中 ESP 占绝大多数。

> [!NOTE]
> 分片相关字段（Flags / Fragment Offset）只在 IPv4 出现 → **IPv6 头部就没有，必须由 source 提前分片 PMTUD**，路由器不能分。这是 IPv6 的设计哲学——把分片责任推给端点，路由器只转发 → 转发芯片极简。

---

## IPv6 头部：每个字段

| bits | 字段 |
|------|------|
| 4 | Version=6 |
| 8 | Traffic Class |
| 20 | Flow Label（实验性，至今低采用） |
| 16 | Payload Length |
| 8 | Next Header |
| 8 | Hop Limit |
| 128 | Source |
| 128 | Destination |

总长 40 字节固定 + ext header 链。**注意：Payload Length 是 IPv6 头后的字节，不是包含头**——jumbo payload 用 0 标记然后 hop-by-hop 头扩展。

### Extension Header 链

```
+--------------+      +-------------+      +------------+
| IPv6 header  | ---> | Hop-by-Hop  | ---> | Routing    | --> dest options / fragment / AH / ESP / TCP
| Next=Hop-by-Hop |  | Next=Routing|      | Next=DstOpt|
+--------------+      +-------------+      +------------+
```

常见 NH 值：

| NH | Header |
|----|--------|
| 0  | Hop-by-Hop |
| 43 | Routing (含 SRH Segment Routing Header) |
| 44 | Fragment |
| 51 | AH |
| 50 | ESP |
| 60 | Destination Options |
| 6  | TCP |
| 17 | UDP |
| 59 | No Next Header |

路由器只会读 Hop-by-Hop 与 Routing；其它 ext header 至目标端才解 → **转发芯片不必关心，转发比 IPv4 简单**。但很多中间设备（防火墙、负载均衡、IDC 出口）不正确解析 ext header 链 → 实际部署前一定要测——如果你 SRv6 网络出口配错一段，第 9 跳才开始丢包。

> [!WARNING]
> 防火墙针对 IPv6 ext header 的处理 vendor 间差异巨大。某次某客户 SRv6 流量过 F5 LTM 在 BH 处理 outer header 时炸链——因为 F5 的 iRule 解析逻辑硬编码假设只有 1 个 extension header。

---

## ICMP

### ICMPv4

| Type | Code | 含义 |
|------|------|------|
| 0 | 0 | Echo Reply (ping) |
| 8 | 0 | Echo Request |
| 3 | * | Destination Unreachable |
|   | 1 | Host Unreachable |
|   | 3 | Port Unreachable (UDP 没人监听) |
|   | 4 | Fragmentation Needed + Next-Hop MTU (**PMTUD 关键**) |
| 11 | 0 | Time Exceeded (TTL=0，traceroute 用) |
| 5 | * | Redirect (现代多关闭防攻击) |

### ICMPv6 (RFC 4443)

更丰富：邻居发现、MLD、PMTUD 必须 (Type 2 Packet Too Big)，否则没有人触发源端 MTU 降低。

邻居发现协议 NDP 一并取代 ARP/ICMP redirect：
- Router Solicitation/Advertisement (RS/RA)
- Neighbor Solicitation/Advertisement (NS/NA)
- Redirect
- Multicast Listener Discovery (MLD)

`ndisc6` 命令查邻居：

```
$ ndisc6 -r fe80::1 eth0
Soliciting fe80::1 (fe80::1) on eth0...
Target: fe80::1
  Link-layer address: 02:00:00:00:00:01
  from fe80::1
```

---

## SLAAC + DHCPv6 工作流

IPv6 自动配置：

```
host up
  -> RS multicast ff02::2        告诉路由器："发广告"
  <- RA from router               带 network prefix + flags
  -> if A flag set: SLAAC         用 prefix + interface ID
  -> if M flag set: DHCPv6        请求 IPv6 + DNS
  -> if O flag set: DHCPv6 拿 DNS 亦可
  -> DAD                          duplicate detection
   -> 如果别人在用 -> 重新算 ID
```

### Privacy Address

- 普通接口 ID 派生自 MAC → 移动设备跨网段仍能被指纹识别（同一 MAC 同一界面始终同 IPv6）
- **RFC 4941 Privacy Extension**：临时地址每日轮换，每次连接换一个，路由器/外部观察者只看到临时地址
- 默认 Android 13 / Win 11 开启；Linux `addr_gen_mode=1` 启用

```bash
# 验证
sysctl net.ipv6.conf.eth0.use_tempaddr
# 2 = generate + prefer; 1 = generate but prefer stable; 0 = off
```

> [!NOTE]
> Cisco/D-Link 等老设备固件不支持临时地址扩展，企业网络实际部署时需 SLAAC + DHCPv6 双路 + 同机加权；电信运营商还把客户 IPv6 路由前缀给 7 天轮换，让穿地址本身不在日志里被追溯。

---

## ICMP 大误解

1. **"ICMP 必须丢，安全"** → 攻击者 TCP RST 仍能截断，关 ICMP 反而让 PMTUD 黑洞、让 traceroute 失效。**正确做法**：开 ICMP echo + ICMP Packet Too Big + ICMP Time Exceeded；关 Redirect。
2. **"Traceroute 暴露网段信息，要禁"** → 现代互联网 Trace 仍是必要的运维手段，封 ICMP 反而让工程师排查问题更慢。Traceroute 类工具还能借助 TCP/IP 层做出来，封了 ICMP 没意义。
3. **"ICMP 6 跟 ICMP 4 一样"** → ICMPv6 是 IPv6 必备（NDP/MLD/PMTUD 全靠它），关了就连邻居发现都挂。

但 ICMP redirect 在公网应关闭（RFC 1122 已建议关）；K8s Calico 也用代理 ARP，不要和 L2 ARP 混乱。

---

## 真实生产事故参考

1. **Cloudflare 2018 7/3 Path-MTU discovery 黑洞**：某 IPv6 路径上一台中间设备把 ICMPv6 Packet Too Big 全黑名单 → 大包（1452+）丢，小包通 → 客户看见的"边缘"是图片渲染一半卡住。修复：所有 PoP 边缘开源 PMTUD heartbeat 探测，发现黑洞后 fallback 到 1280 (IPv6 min MTU) + TCP MSS clamping。
2. **AWS 2020 IPv6 ext header 黑洞**：S3 dual-stack 前置 LB 不支持 SRH (segment routing) → 客户的 SRv6 出口流量到 S3 后被 LB 全部丢。修复：边缘做 SRv6 decapsulation 再前传 IPv4 over SRv6。
3. **Equinix 2019 SLAAC Privacy 关闭**：客户公司强制关闭 Privacy Extension 后所有员工的移动设备 IPv6 地址被广告平台跨网络识别 → 后续隐私诉讼。Equinix 给出的最佳实践是默认开启 RFC 4941。

---

## 这一章带走的东西

1. IPv6 头部去 checksum 是为了转发加速（路由器不再每跳重算 checksum）
2. IPv6 ext header 可插入 1 个或多个；路由器只看 Hop-by-Hop / Routing，其他至目标端处理
3. ICMPv6 比 ICMPv4 多承担邻居发现 (NDP) + PMTUD 强制要求
4. SLAAC + Privacy 当前已默认；企业网部署强身份验证时考虑关 Privacy，但需权衡隐私
5. Jumbo gram 在 IPv6 framework 内允许潘 > 64K，但中间设备 99% 不支持

下一节 → [DHCP / ARP / NDP](arp-dhcp.md)
