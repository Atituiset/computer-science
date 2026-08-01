# NAT 与 conntrack

## TL;DR

NAT 让多个内网主机共享一个公网 IP，背后是 Linux `nf_conntrack` 维护的连接表。这一节讲 NAT 类型对应用的影响、conntrack 数据结构、性能天花板、Cone vs Symmetric NAT 对 P2P 的影响——以及为什么运营商级 NAT 让所有 P2P 客户端都不得不走 TURN relay。

## 为什么 NAT 存在

IPv4 地址空间 32 bit，~43 亿。80 年代没人想到每台设备都上 IP。NAT 出来用 RFC 1918 私网地址 + 端口复用，救了 IPv4 的命。

但 NAT 打破了 IP 端到端原则：

- 服务器无法主动连接 to NAT 后的客户端
- IP 包并非"路由对称"——同一会话的出向/入向可能走不同 NAT 设备
- 应用层 IP 信息泄漏（SIP SDP 内嵌公网地址）+ 中间设备需 ALG 做 NAT 翻译

> [!NOTE]
> 真正"破"了 end-to-end 的从来不是 NAT 本身，而是 RFC 1918 私网地址。NAT 只是补丁让私网地址上互联网。一旦 IPv6 普及，私网办法不会被取消（CDN、企业隔离都需要），所以 NAT 模式即使 IPv6 普及也不会消失。

---

## NAT 类型（RFC 3489）

| 类型 | 是否固定端口 | 跨主机端口复用 |
|------|--------------|----------------|
| Full-cone | 是 | 否 |
| Restricted-cone | 是 | 否 |
| Port-restricted cone | 是 | 否 |
| Symmetric | 否（按目标分配端口） | 否 |

Cone NAT（NAT 给同一内部 socket 总分配同一外部 socket），P2P（如 STUN）容易打穿。
**Symmetric NAT 按目标地址给不同外部端口**，STUN 拿不到对应 → 对等打洞失败。

> 移动运营商多是 Symmetric NAT，P2P 应用只能求助 **TURN relay**。这就是 WebRTC (Chrome 默认 P2P) 在企业网经常失败的原因。

Linux `iptables MASQUERADE` 默认是 Port-restricted cone，对 UDP 这个表现尤为明显：单 IP+port 上的 P2P socket 在 STUN 配合下可以打穿到对方 cone NAT，对另一端 Symmetric NAT 一起打则失败。

---

## Linux NAT 实现

`iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE`

底层依赖 `nf_conntrack` 模块。

### Conntrack 结构

```c
struct nf_conn {
    struct nf_conntrack_tuple_hash hash;
    struct nf_conntrack_tuple tuple[2];   // 原/反向
    unsigned long status;                 // status bits: SEEN_REPLY, ASSURED
    unsigned long timeout;                // 老化时间 (jiffies)
    u_int32_t mark;
    ...
};
```

Hash 表项：

```
[src_ip, src_port, dst_ip, dst_port, proto]
                ↕
[src_ip, src_port, dst_ip, dst_port, proto]   （反向）
```

每条 socket → 一个 conntrack entry。

### 默认 timeout

| 协议状态 | timeout |
|----------|---------|
| NEW (no reply) | 30s |
| ESTABLISHED (TCP) | Linux 5d 默认（432000s） |
| ASSURED (双向见过) | 432000s |
| UDP unreplied | 30s |
| UDP assured | 180s |

**UDP assured 5 min timeout 在大量短连接场景下非常容易被 DDoS 攻击爆 conntrack 表**。Amazon 防 DDoS 反射攻击的文章都是聊这数（5000 个 UDP query × 5 min = 200 万条 conntrack）。

### 检查表满

```bash
$ cat /proc/sys/net/netfilter/nf_conntrack_max
262144
$ cat /proc/sys/net/netfilter/nf_conntrack_count
240          # 当前条目
$ sudo conntrack -L | head
tcp      6 431998 ESTABLISHED src=10.0.0.5 dst=1.1.1.1 ...
udp      17 173  src=10.0.0.5 dst=8.8.8.8 ...
```

表满了 → 新建连接被丢 (`nf_conntrack: table full, dropping packet` in dmesg)。

→ **生产时易坑**：sysctl 默认 max=262144 对 6 GB RAM 机器合适，但负载暴增时必须监控 `nf_conntrack_count / nf_conntrack_max` ratio。

### 调参

```bash
# 大型 L7 proxy 调高 max + 加 hash cache
echo 1048576 > /proc/sys/net/netfilter/nf_conntrack_max
echo 262144 > /sys/module/nf_conntrack/parameters/hashsize
# TCP established timeout 缩短到 2h（防僵尸连接占 Conntrack）
echo "net.netfilter.nf_conntrack_tcp_timeout_established=7200" >> /etc/sysctl.conf
# 表示如果 NFSv4 不用就关 30s（UDP）
echo "net.netfilter.nf_conntrack_udp_timeout=10" >> /etc/sysctl.conf
```

---

## 性能瓶颈

`nf_conntrack` per-flow cost ≈ 1 KB 内存 + 一次 hash 查找 + 一次原子操作。300B 包规模下：

- 装 1M conntrack 表 (= 1 GB RAM) 可处理 ~1M Cps hit
- 性能瓶颈在 conntrack 锁 + cache miss

> [!NOTE]
> 大型网关一般关掉 conntrack，用 eBPF / DPDK -> nftables + offload + XDP bypass kernel 网络栈。Cilium + eBPF 让 Kubernetes node 完全跳过 iptables。每跳节省 10-100µs。

---

## NAT 与 conntrack 的关联接口

- `iptables SNAT/DNAT/MASQUERADE/REDIRECT` 全依赖 nf_conntrack
- `ipset` 不依赖 conntrack，性能更线性
- `bpfilter` / `eBPF maps`：可以用 LPM trie 替代 conntrack 实现 host NAT

---

## CGN (Carrier-Grade NAT)

运营商级 NAT 用一段公网 100.64.0.0/10 (RFC 6598) 给客户分"二次私网"。底层 Pool NAT 维护几百万 conntrack entry，瞬时大量新建需要超大规模 Hash。Cloudflare 写过 1.6Tbps 中 CGN，主要 trick：CTF hashmap singleton、NUMA 局部 cache、parallel LRU。

CGN 必须做 deterministic port mapping：每用户分一段端口范围给出去，避免 outbound 单 IP 被全局 ban。所以一个 CGN IP 同时只服务 ~100 个家庭。

---

## 端口范围

一台 NAT 设备只有 65535 个 port 范围（实际 1024-65535 = ~64000）。每条 conntrack 占一个外部端口。

但 conntrack 区分四元组 → 不同目的地的同一内部 socket 可共用一个外部端口（NAPT → Network Address Port Translation）。所以 buffer 足够；倒是单 IP 到同一目的的并发上限 ≈ 64000。

操作员需要拼"有多少公网 IP" × "每 IP 端口数" = NAT 总并发能力。

---

## 对等打洞 (Hole Punching)

### UDP STUN + Cone NAT

主机 A、B 都先连 STUN 服务器，得自己的外部 (IP, port)。然后双方把对方的 (IP, port) 告知对端，从各自的私有 socket 直接往对方的 (IP, port) 发包。Cone NAT 因为只看 5 元组中的内部 socket，会建立反向 conntrack entry 让对方的入向包通过。

### 对 Symmetric NAT

Symmetric NAT 给每个不同目的地分配不同 socket → STUN 拿到的回程不正确 → 必须用 TURN 中转。

> [!WARNING]
> WebRTC 设计 1开发者频繁遇到 STUN OK + TURN 必走的场景，就是 symmetric NAT / 严格防火环境。TURN server 成本高（每 session 中转带宽），所以大规模部署需要自建 TURN cluster + 节省 cert 流量。

### TCP hole punching (the difficult one)

TCP NAT hole punching 比 UDP 复杂很多，因为 TCP 三次握手+状态机：
1. A 内部开放 socket + bind 端口 K
2. A 主动连接 STUN server（建立 conntrack: A_int ∷ A_ext :: STUN）
3. B 同理，A 和 B 都拿到对方外部 (IP, port)
4. A 从 socket K 发 SYN 给 B_ext，B 同时 SYN 给 A_ext
5. SYN 互达 → 让 NAT A 和 NAT B 都建立 reverse conntrack entry
6. 经过协调时钟后即可 TCP 直连

但这需要两条 socket 同时双向发 SYN，应用代码复杂。**所以 TCP hole punching 实际部署几乎为 0**；UDP 才是主流 (WebRTC、QUIC 都靠 UDP)。

---

## conntrack 真实生产事故

1. **Cloudflare 2020 7 月 DDoS**: 大量短 UDP 包占满 edge CGN conntrack → 后续 legitimate UDP DNS 查询无 conntrack entry → 全员 DNS 不工作。**修复**：edge 把 DNS 流量 bypass conntrack (`raw` table `NOTRACK`)。
2. **某游戏公司 mobile 2019**: NAT 类型测试对端 NAT 是 Symmetric NAT → P2P 成功率只有 40% → 部署 TURN relay + 95% 成功，但 TURN 成本预计 100TB / month。**优化** 加让 TURN 应用于欢迎有 symmetric NAT 客户端 + 端到端加密（TURN 用 TCP-UDP tunnel）。
3. **某云厂商 2017**: 当然会被认为是防火墙 bug, 实际是 Linux conntrack 默认 TCP timeout=5d 让短连接重启后 4天 entries 都不消失 → conntrack 表慢满 → 服务丢包。**修复** sysctl 调到 2h + 业务层连接池保活。

---

## 这一章带走的东西

1. Cone NAT vs Symmetric NAT 决定 P2P 是否可能；Symmetric NAT 实际把 P2P 客户端逼到 TURN
2. Linux NAT 依赖 nf_conntrack，per-flow 1KB，撑 ~65k 新建 / 秒—cg 因 hash table size
3. 表满是大型 / 高频 UDP 服务的头号踩坑点
4. CGN 是国家规模 NAT 的边缘；每 CGN IP 只服务 ~100 个家庭避免单 IP 全局被 ban
5. UDP STUN + Cone NAT 是 WebRTC 端到端直连的基础；TCP hole punching 几乎不实用

下一节 → [TCP/UDP](../tcp/index.html)
