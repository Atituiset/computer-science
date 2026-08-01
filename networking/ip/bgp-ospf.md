# BGP / OSPF 路由

## TL;DR

OSPF 是企业/AS 内部的路由协议（IGP），BGP 是互联网之间的路由协议（EGP）。两者解决的问题相似——把包送到目的网段——但抽象层次、可扩展性、强调路径选择 vs metric 的策略完全不同。

## OSPF

### Link-State

OSPF 是链路状态协议：

1. 每个路由器泛洪自己直连链路的"链路通告"（LSA）给整个 area
2. 每个节点都拿到完整拓扑（LSDB）
3. 全区域同步 LSDB → 一致性
4. 节点本地跑 Dijkstra 算最短路径
5. 计算 ECMP（等价多路径）

```
   +-----------LSA-----------+
   v                          ^
router_a 相当于  LSDB 同步 router_b
   ↓
Dijkstra → SPF tree → 路由表
```

每个 LSA 还要承载：链路代价、可用 IP 等元数据。开销从 1 起步，最大 65535（24 比特）。

### Area 分层

OSPF 用多 area 减小 LSDB 与 Dijkstra 规模：

```
            Area 0 (Backbone)
              ┃  ┃  ┃
              │  │  │
        Area 1  Area 2  Area 3 (分别是与 Backbone 相连)
```

- Area 0 是 backbone，所有 area 必须与 area 0 有连接或通过 virtual-link 临时桥接
- ABR（Area Border Router）汇总 area 间 LSA，避免把详细 LSDB 跨 area 传播
- ASBR（Autonomous System Border Router）把外部路由灌入 OSPF

### LSA 类型

| Type | Name | 用途 |
|------|------|------|
| 1 | Router-LSA | 节点直连链路（本 area 内传播） |
| 2 | Network-LSA | 广播段子网（DR 通告） |
| 3 | Summary-LSA | ABR 宣告跨 area 前缀 |
| 4 | ASBR-summary | 跨 area 到 ASBR 的路径 |
| 5 | AS-external-LSA | 外部路由 |
| 7 | NSSA External LSA | NSSA 内特殊外部 |

### OSPF cost 极限

默认 cost = `100 / bandwidth(Mbps)`：1Gbps cost=1；10Gbps cost=1（实际仍 floor 到 1）。**操作员手工调 cost** 控制路径偏好。

```cisco
! Cisco IOS 配置
interface FastEthernet0/0
 bandwidth 1000          ! 报 1Gbps
 ip ospf cost 5          ! 改 SPF 选路权重
```

> [!NOTE]
> OSPF 实际选路 metric 单调到 1M 已经饱和（多 1G 链路 cost=1 都视为等价）→ ECMP 多路径不会因 metric 略偏好。只能手工分 interface tweak cost 让上层路径有差异。

---

## IS-IS 与 OSPF

IS-IS 也链路状态、同 area 内全反映转、Dijkstra 计算。差异：

- IS-IS 在 OSI 协议栈 L2 上跑（CLNS），不直接和 IPv4 强绑
- 一个 IS-IS 进程可同时承载 IPv4 + IPv6，OSPF 通常要 v2/v3 分进程
- 大型 ISP 更爱 IS-IS，扩展性被认为更强（数百到数千节点 LSDB 单一 area OK）

主流 ISP（Verizon/Comcast/中国移动/中国电信）核心都用 IS-IS；企业用 OSPF。

---

## BGP

### Path Vector

> 距离向量传递"AS_PATH 累积列表"，整个 path 决定可达，不只是 metric。所以叫 Path Vector Protocol。

BGP 基于 TCP port 179。两台路由器直连通过 TCP 179 建立 BGP session，互相宣告 IP prefix + path attributes。

### BGP Message

| Type | 用途 |
|------|------|
| OPEN | 握 hand，版本号、AS、Hold Time (默认 90s) |
| KEEPALIVE | 保活 |
| UPDATE | 宣告/撤回 routes |
| NOTIFICATION | 出错关闭 session |
| ROUTE-REFRESH | 请求对端重新发 |

### 关键 Path Attributes

| 属性 | 说明 | 选择权 |
|------|------|------|
| ORIGIN | IGP/EGP/INCOMPLETE | - |
| AS_PATH | 走过的 AS 列表（防环：本 AS 已在 path 则拒） | 选更短 |
| LOCAL_PREF | 本 AS 进出策略 | 选更高 |
| MED | 跨 AS 退出策略 | 选更低 |
| NEXT_HOP | 下一跳 IP | - |
| COMMUNITY | 标签路由（NO_EXPORT / NO_ADVERTISE 等） | - |

### 决策顺序（Best Path Algorithm）

```
1. LOCAL_PREF 高的胜
2. AS_PATH 短的胜
3. ORIGIN 类型优先级高的胜 (IGP > EGP > INCOMPLETE)
4. MED 低的胜（仅当第一 AS 相同才比）
5. 到 NEXT_HOP 的 IGP 距离短的胜
6. EBGP 路由胜过 IBGP
7. OLD 优于 NEW（避免抖动，bandwidth jitter reduction）
8. router_id 低胜
```

> [!WARNING]
> **MRAI (Min Route Advertisement Interval) = 30s**：BGP 默认每 30s 才发 route 广告，限制 churn → 收敛慢。这就是为什么"路由抖动每 30s 你才看到一次"。生产 BGP 改 0 或 5s 加快。

---

## BGP Pluggable Extensions

### BGP-LS

BGP-LS 用 BGP UPDATE 编码链路拓扑分享给集中 SDN 控制面，控制器有了全网拓扑后下发 PCEP/segment routing 流表。SR-MPLS 一类方案就是 **BGP-LS + Path Computation Element 协议 (PCEP)**。

### BGP EVPN

数据中心的 BGP EVPN 用 BGP 控制面交换 MAC/IP，把 L3 路由层面统一到一个协议。Spine-Leaf + EVPN 是当前最大型数据中心的标准操作，已被 Cumulus / Arista / Cisco / FRR 全面支持。**替代了 STP + VxLAN + IGMP Snooping + 早期 TRILL**。

EVPN 的核心：通过 BGP controlplane 同步 MAC/IP，data plane 用 VxLAN 封装，去做"hash 等化负载均衡 + concentration of fail"。

### Segment Routing (SR)

源路由 in MPLS 标签栈里写"我下一站去 N1, 然后 N2, 然后 N3"，中间路由器只看栈顶标签转发，不用维护每流状态。SR-MPLS / SRv6 (segment in IPv6 Routing Header) 2 种实现。

---

## 选型：OSPF 还是 BGP？

答案：两者都要。

- **AS 内**（IGP）：OSPF 或 IS-IS，毫秒级收敛，目标最快收敛最少包丢失
- **AS 间**（EGP）：BGP，秒分钟级收敛，目标可达性 + policy (不希望被运营商多绕了一条路去付费)

数据中心 Spine-Leaf 部署 BGP 也是"用 BGP 扮演 IGP"——加 RR (Route Reflector)、宣告自己、local_pref/MET 控制。AWS 风格简洁地利用 BGP 的可扩展性。Meta/JPM/Facebook 数据中心内部都跑 BGP + EVPN，**几乎不用 OSPF**了。

### 为啥数据中心不再用 OSPF?

- OSPF area 0 LSDB 同步在 large spine-leaf 网里每次拓扑变化都触发 SPF 计算 → ~1 秒内计算量爆炸
- 数据中心 spine-leaf 全 ECMP, BGP naturally 提供，OSPF 需要 tweak
- EVPN + VxLAN 需要 L2 over L3 传播 MAC/IP，BGP EVPN 是事实标准，OSPF 没有

---

## 收敛时间对比

| 协议 | 健康→故障检测 | 收敛时间 |
|------|---------------|----------|
| OSPF 默认 | Hello Interval 10s Dead 40s | 几秒到秒 |
| OSPF BFD | 50ms 探测 | 30ms-1s |
| BGP 默认 | Hold Time 90s | 几秒到几十秒 |
| BGP+BFD | 50ms-300ms 探测 + Connected + 退避 | 1s-2s |

**BFD (Bidirectional Forwarding Detection)** 是任意链路协议都可叠加邻居存活探测，与 BFD 重叠的是 **GR (Graceful Restart) / NSR (Non-Stop Routing)**：路由器主控 failover 时让邻居保持会话不撕裂。

---

## 实战：调 OSPF 切换

```cisco
! 路由器 1 关闭链路 -> 路由器 2 在 40s 内才会发现 OSPF dead
! 启用 BFD
router ospf 1
 bfd all-interfaces

! 调稀疏 SPF throttle (怕 churn 不怕慢)
router ospf 1
 timers throttle spf 10 100 200
```

(0ms initial, 100ms wait-min, 200ms wait-max)

```bash
# Linux 看 OSPF 邻居 (FRR/Quagga)
vtysh -c 'show ip ospf neighbor'
```

---

## 真实生产事故参考

1. **Pakistan Telecom 2008**：误把 YouTube 的 /24 prefix 注入 BGP AS_PATH 空，全球 BGP 路由器向 YouTube 改路到巴基斯坦 → 全球用户 2 小时进不了 YouTube。**教训**：BGP 没有 RPKI ROA 强制 RPKI。RPKI 现已广泛部署，过滤掉 ROA 不符合的 routes。
2. **YouTube 2017 雪球**: 某次 BGP 配置 typo 引起广泛 churn + RPKI 清理 + 链路抖动 → 全球 BGP 路由表 几秒钟抖动湿式 churn 让所有 ISP 同时 recalculating best path。**修复**：BGP add-path + BGP-LS 监视收敛速率，远离 churn 重置事件。
3. **Cloudflare 2019 6/24**：配置变更使 BGP 撤回 RPKI 失效前缀 → 部分全球用户连不上 → 27 分钟。**修复**：BGP 配置变更通过 dry-run emulator 测试 + RPKI 自动化校验。

---

## 这一章带走的东西

1. OSPF Link-State Dijkstra，可扩展性限定在 area 数 (一般每 area ~200 节点)
2. BGP Path-Vector policy，可承载 ~1.1M+ v4 前缀
3. BGP 不快、BFD 帮加快 + GR/NSR 帮 failover 不撕裂
4. BGP EVPN 已成新一代 DC L3 over leaf 标准；OSPF 在 DC 退潮
5. RPKI + BGP-LS + segment routing 是 2020 后路由协议演化的三大方向

下一节 → [NAT 与 conntrack](nat.md)
