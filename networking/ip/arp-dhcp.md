# DHCP / ARP / NDP

## TL;DR

IP 地址不是绑定网卡的物理属性；地址解析、地址分配靠 ARP（IPv4）和 NDP（IPv6）+ DHCPv4 / DHCPv6/SLAAC 完成。这一节讲协议细节、安全陷阱、企业网络实践。

## ARP 概览

ARP 不是 L2 协议也不是 L3 协议；它是"用 IP 解 MAC"的桥接：

1. 主机 A 想发到 192.0.2.5
2. 查 ARP cache，没命中 -> 发广播 `Who has 192.0.2.5?` (EtherType 0x0806)
3. 主机 B 应单播 `192.0.2.5 is at 11:22:33:44:55:66`
4. A 在 cache 写入 IP→MAC，设 15-30 min TTL
5. 之后 A 直接封装 Ethernet 帧发送

### ARP packet 结构

```
| HW type (16) | Proto type (16) | HW len (8) | Proto len (8) | Op (16) |
| Sender hardware addr (HWlen)  | Sender protocol addr (Plen)            |
| Target hardware addr (HWlen)  | Target protocol addr (Plen)            |
```

类型 1=Ethernet, 2=IPv4, op 1=request, 2=reply. ARP 包 42-60 字节（不够 64 需要链路层 padding）。

### Gratuitous ARP / ACD

主机开机或 IP 改变后发一个 ARP 广播宣告 `my IP is at my MAC`，未请求的广播。用于：
- 防止冲突（ACD，Address Conflict Detection）
- 高可用切换：主备 VIP 漂移后让交换机刷新 MAC 表（这点 Linux 的 keepalived 默认会发）

---

## DHCPv4 流程

```
client -> DISCOVER (broadcast UDP 67)
servers -> OFFER (broadcast/unicast, UDP 68)
client -> REQUEST   (挑一个，含 server id)
server -> ACK       (含 lease_time, options)
```

DHCP Options 丰富：

| CODE | Option | 备注 |
|------|--------|------|
| 1   | Subnet Mask | |
| 3   | Router (default gateway) | |
| 6   | DNS Servers | |
| 12  | Hostname | |
| 51  | Lease Time | |
| 53  | DHCP Message Type | 必备 |
| 54  | DHCP Server Identifier | |
| 82  | Relay Agent Information | DHCP Snooping 用 |
| 119 | Domain Search List | |

### Lease 续约

```
T1 = 0.5 * lease_time        -> 看门狗，找原 server 续
T2 = 0.875 * lease_time       -> 原 server 失联，找任何 server
lease_time 到期              -> 必须放掉 IP
```

默认租约 24 小时；本机查看：

```bash
$ sudo cat /var/lib/dhcp/dhclient.leases  # Debian/Ubuntu
$ sudo cat /var/db/dhcpd_leases             # macOS
$ nmcli dev show eth0 | grep IP4.ADDRESS
```

### DHCP Relay（RFC 3046 Option 82）

L3 网段到 DHCP server 跨网段时，relay agent 把 client 广播转单播发到 server：

```
client ----broadcast----> relay
  relay -unicast to DHCP- with Option 82 (Agent Circuit ID + Remote ID)
        <- response from DHCP with Option 82
relay ----broadcast-----> client
```

**Option 82** 是企业网大规模集中 DHCP 的基础：在大楼 L2 接入交换机上启 DHCP Snooping，所有 DHCP 包按端口抓包 + 在 Option 82 里塞入口标识，集中 DHCP server 能据此分出每个接入端口实际在公司哪个楼层。**Cable MSO 用 DHCP Option 82 给家里 CM (cable modem) 分 IP**。

---

## ARP 安全陷阱

### ARP 欺骗（ARP Spoofing）

LAN 上任何主机可发伪造的 ARP Reply："192.0.2.1 is at attacker_mac"，邻居 ARP cache 被污染，所有去 192.0.2.1 的帧到达攻击者。Linux 工具：

```bash
# arpspoof from dsniff 套件
sudo arpspoof -i eth0 -t 192.0.2.10 192.0.2.1
# 现在所有 192.0.2.10 -> 192.0.2.1 的包都到攻击机
```

防御：
- 交换机 **Dynamic ARP Inspection (DAI)**，只允许 DHCP snooping 表里记录的 IP/MAC 映射发 ARP Reply
- 主机静态 ARP——但移动场景难维护
- 802.1X + MACsec 加密链路层数据 → 二层攻击者看不到加密内容

> [!NOTE]
> **MACsec** (IEEE 802.1AE) 在 L2 做 AES-GCM 加密 → 即使接入了恶意设备，所有跨 link 的帧都是密文。数据中心管理网 / 5G 时代电网 BN（backhaul network）常用。

### Proxy ARP

某些路由器（如 K8s Calico、docker0 bridge）开启 optional "代理 ARP"：对其它子网里 IP 也能应 ARP（拿自己的 MAC 当网关）。

> [!WARNING]
> 配错会让 client 觉得到外网直连，反而漏了路由器的存在。K8s Calico 用 BGP + Proxy ARP 解决 CNI 子网跨节点访问，但要确保 iptables/IPVS 规则也跟得上，否则冲突时容易丢包。

---

## IPv6 NDP（取代 ARP）

NDP 用 ICMPv6 over IPv6 link local (`fe80::/10`)：

```
host sends NS to solicited-node multicast ff02::1:ffXX:XXXX
target responds NA from its link-local src
host updates Neighbor Cache
```

solicited-node 组播用最后 24 bit MAC 派生地址，**比纯广播负载低很多**：8 台主机分别对应 8 个 solicited-node 多播地址，互不打扰。

### DAD（Duplicate Address Detection）

加新地址前发 NS 询问此地址在不在；2s 没人回 -> 接管。`Tentative` 状态保持期约 1s。

> [!WARNING]
> 在 WiFi 漫游 / 中断场景下，DAD 会延迟到几秒，几秒内服务断。**优化1**：RFC 7527 Optimistic DAD 让 client 紧急时使用 tentative 地址。**优化2**：RFC 4429 SEcure Neighbor Discovery (SEND) 用 RSA 地址防伪。

### 路由器发现 (SLAAC)

参见 [IPv4/IPv6/ICMP](ipv6.md) 那节。RA 报文 RA flags 控制：

- `A` flag → 用 SLAAC
- `M` flag → 用 DHCPv6
- `O` flag → 用 stateless DHCPv6（只拿 DNS）

### NDP 攻击

NA 欺私、伪造 RS/RA -> 整网关路由都被劫持。
**RA Guard** 在交换机丢弃 client 端口的 RA。Cisco/Aruba 等大厂商接入交换机必启。

---

## DHCPv6 vs SLAAC

| 维度 | SLAAC | DHCPv6 stateful |
|------|-------|----------------|
| 配置朴实 | 自动 | 需部署 DHCP server |
| DNS NTP 配置 | 通过 RA RDNSS option 或 stateless DHCPv6 | 通过 options |
| 日志可追溯 | 难 | 可定位 IP 签发历史 |
| IPv4 + IPv6 共存 | 自动 SLAAC | 需编排 |
| 临时地址（Privacy） | 与 SLAAC 配合佳 | DHCPv6 不能签 Privacy 地址 |

企业网络部署最佳实践：**SLAAC + stateless DHCPv6 (拿 DNS + sip战)**。运营商通常用 SLAAC + DHCPv6-PD (Prefix Delegation)，给家里下发 /56 或 /60 一段继续分给客户家中各个 subnet。

---

## 真实生产事故

1. **CERNET 2016 一个 EchoStorm 攻击**: 一个学生的笔记本被植入恶意软件，发 Gratuitous ARP 把自己宣告为网关 → 所有学生断网 → 被 ARP table 老化迅速传播，校园网 2000 终端中毒样式 flood。**修复**：所有接入交换机启 DAI + DHCP Snooping + 802.1X。**教训**：任何用户接入网关必须有二层 ARP 防御。
2. **AWS managed DHCP leaked KV 2017**：Option 82 在某些 region 填错接口 ID，明明 Instance 在 us-east-1d，Option 82 显示 us-east-1b → 客户跨 AZ 链路计费正确性 ID 混乱。**修复**：AWS 后台重建所有 Option 82 + DHCP 流水。**教训**：只要 Option 82 进入业务关键路径，必须有独立审计。
3. **CDN 2018 RA Attack**: 某 CDN POP 在客户服务器被 over-permissive 配置允许 RA → 网络被劫，部分客户失败。**修复**：所有客户端 → RA Guard（接入交换机端口规则）+ Ban 来路异常的 RA。**教训**：IPv6 安全模型与 IPv4 不同，但是迟 IPv6 部署反而激发了安全性提出更严。

---

## 这一章带走的东西

1. ARP 是 ~25 µs 的 LAN 互信，但 MACsec 是新加 L2 防御
2. DHCP Option 82 是跨网段 DHCP 关键 + 企业网 Cable MSO 大量用
3. NDP 比 ARP 多了 DAD + 组播 + 多选项，且 RA/RS 取代广播减少了 LAN 单包负载
4. DAI + RA Guard 是企业级 L2 安全面，与 802.1X 配合构成纵深防御
5. 部署 DHCPv6 vs SLAAC 时视场景选；类 IPv4 的运维ásiongan 仍有"日志可追溯"价值

下一节 → [BGP / OSPF 路由](bgp-ospf.md)
