# IP / 路由

## TL;DR

IP 是 TCP/IP 协议栈"L3 不可靠、全互联、尽力交付 (best-effort)"的抽象。它把所有底层物理介质屏蔽掉，给上层提供 32 位地址（v4）/ 128 位地址（v6）加路由表查询的能力。这一节读完后你应该能看懂 `ip route get`、调试路由黑洞、解释 privacy extension、回答 BGP vs OSPF 收敛速度差异。

## 思维链

```
应用 -> socket -> TCP -> IP -> Ethernet
                   ↑
              ip_route_input() 查路由表
              ↓
            下一跳 -> ARP/ND -> 帧
```

DNS 给出名 `api.example.com` -> 通过 socket 给应用 IP -> IP 层判断目标路由：
- 同子网：直接 ARP 解出 MAC，封装帧
- 跨网段：查路由表 -> 下一跳 -> ARP 下一跳 -> 转发

每一跳路由器都重复查表 -> 改 TTL -> 重算 checksum -> 转发。一台路由器每秒可以处理 10M-100M 包（有 TCAM 卸载可达线速；软件路由只有 1M-10M pps）。

## 这一节要回答的问题

1. IPv4 头部 20 字节每个字段有什么用？为什么 IPv6 去掉了 checksum 反而更快？
2. ICMP 在分片 / PMTUD / traceroute 里到底做了什么？为什么大量 IDC 把 ICMP 整体黑洞掉 PMTUD 必崩？
3. ARP 一秒钟怎么解析、为什么 ARP cache 5 分钟后掉；邻居发现 NDP 比它强在哪儿？
4. DHCP 跨网段必须 relay agent + Option 82，Option 82 是怎么把 client 接入端口传给集中服务器的？
5. OSPF 是什么类型协议，为什么 ISP 不喜欢在 AS 大规模用 OSPF 而用 IS-IS？
6. BGP 是什么类型协议，为什么能承载全球 ~1.1M v4 前缀，路径属性 AS_PATH / LOCAL_PREF / MED / communities 怎么决策？
7. NAT 在 conntrack 表里吃 1 KB / 流，1M 表 = 1 GB RAM；单体 NAT 能撑多少 concurrent？运营商用 CGN 是怎么后向退化到 Symmetric NAT 影响 P2P？

## 这一节骨架

- [IPv4 / IPv6 / ICMP](ipv6.md)：头部字段、扩展头、邻居发现、SLAAC、ICMP 与 PMTUD 关键
- [DHCP / ARP / NDP](arp-dhcp.md)：地址解析、地址分配、跨网段 relay、安全陷阱
- [BGP / OSPF 路由](bgp-ospf.md)：链路状态 vs 路径向量、收敛对比、生产场景选择
- [NAT 与 conntrack](nat.md)：5 元组 conntrack 表、Cone vs Symmetric NAT、P2P 打洞失败根因
- [DNS](dns.md)：递归/权威分层、TTL 与缓存、CDN 调度、DNSSEC / DoH / HTTPDNS
