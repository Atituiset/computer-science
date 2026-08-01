# QUIC

## TL;DR

QUIC 是 RFC 9000-9002 (2021) 定义的"基于 UDP 的全新可靠传输 + 拥塞控制 + 集成 TLS 1.3"。Google 从 2013 起内部实验，2018 ANRW 上 Cloudflare/Akamai/Fastly 加入，2022 RFC 9114 (HTTP/3) 标准化。本节我们走完 QUIC 的字节布局、CID-based 连接管理、stream 独立、connection migration、PTO/RACK 重传，以及产线上 4 大部署难点（UDP 中间盒、家用 NAT PMTU、负载均衡 CID 路由、0-RTT replay business ack）。

## 章节

- [QUIC over UDP：解决什么](overview.md) — 协议演进动机、packet 字节布局、frame 类型、与 TCP/TLS 栈对比
- [0-RTT / 连接迁移](0rtt.md) — early data workflow、PSK resumption、connection migration、PATH_CHALLENGE 流程
- [BBR 在 QUIC 下的表现](bbr.md) — ack_delay 字段、stream 独立 cwnd、QUIC over UDP 拥塞控制部署观测

---

## QUIC 时间线

```
2012   Google 内部实验性 QUIC (GAQ)
2016   NTT 测试 QUIC，IEFT BOF 起草
2018   IETF WG 正式 draft-ietf-quic-transport-00
2021   RFC 9000 (transport) + 9001 (TLS) + 9002 (recovery) published
2022   RFC 9114 (HTTP/3) published
2023   RFC 9369 (version negotiation) + 9390 (DPLPMTUD)
        BBR v3 + quiche 全网部署
```

## QUIC vs TCP+TLS 协议栈

```
HTTP/1.1 over TCP+TLS 1.2:
   HTTP   →   TLS 1.2   →   TCP   →   IP   →   Ethernet
              ↑             ↑
              2 握手 RTT     3-way + cwnd build

HTTP/2 over TCP+TLS 1.3:
   HTTP/2 →   TLS 1.3   →   TCP   →   IP   →   Ethernet
              ↑             ↑
              1+0 RTT       3-way + cwnd

HTTP/3 over QUIC:
   HTTP/3 →   QUIC (含 TLS 1.3)   →   UDP   →   IP   →   Ethernet
              ↑                    ↑
              1+0 RTT 单达成合       no SYN, no connect
```

QUIC 把 TLS 1.3 握手 encode 在 CRYPTO frame 里，与 packet 同步发出 + 接收 → 1 RTT 完成。

## QUIC 解决 TCP 自带 5 大痛点

| TCP 痛点 | 在 TCP 中的根因 | QUIC 解决方案 |
|----------|----------------|----------------|
| HoL blocking (TCP stream HoL) | TCP 序号 byte-stream，client 无法选择性 ACK 单 stream 内字节 | 每 stream 独立 ack + 独立重传 |
| 握手 RTT 高 | TCP 3-way + TLS 握手不重叠 | CRYPTO frame + TLS 1.3 内嵌，1 RTT |
| 连接 4 元组绑定 | TCP 5-tuple NAT 表项随源 IP/port 变化 | Connection ID 恒定，路由不靠 5-tuple |
| 中间盒缓存语义 | NAT/firewall 缓存 seq，重传包注入歧义 | 协议在 user space + packet number 单调 |
| 升级慢 | 内核 TCP，10 年才能全 clan | QUIC 在 user space，库升级 |
| RTT 估不准 | ACK delay 看不到 | ACK frame 含 ack_delay 显式字段 |
| 应用层 HoL (HTTP/1.1 串行) | HTTP/1.1 自身限制 | 直接走 HTTP/3 |

---

## 这一章带走的东西

1. QUIC 把 transport + congestion control + TLS 1.3 完全集成在 user space，1 RTT 握手是核心收益
2. CID 是独立于 5-tuple 的 conn 标识，让连接迁移与 LB routing 解耦
3. 0-RTT、DPLPMTUD、ECN、ack_delay 是 QUIC 必修字段
4. NAT rebinding + 跨 ISP 链路切换是 QUIC 在移动网络杀手锏
5. 部署仍有难点：UDP 中间盒被丢、负载均衡需要 CID 一致、客户端包兼容性

## 下一节 →

[QUIC over UDP：解决什么](overview.md) — packet 字节布局、long/short header、frame 类型、stream 编号、与 RTT 估计算法。
