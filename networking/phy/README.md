# 物理层 / 数据链路层

## TL;DR

物理层（PHY）负责把比特变成可在线缆/光纤/空气中传输的物理信号（电压、光强、电磁波相位），数据链路层（MAC）负责把比特组帧、加校验、处理共享介质的接入冲突。这两层决定了网络的"天花板"：带宽、延迟、丢包率、MTU、抖动。

## 思维链

考虑一行 `curl https://example.com`，从网卡 PHY 出发的完整链路：

```
应用层 HTTP -> TLS -> TCP -> IP -> Ethernet MAC/PHY
                  -> 交换机 (L2 转发, 查 MAC 表)
                  -> 路由器 (L3 转发, 查路由表)
                  -> 光纤骨干 (DWDM)
                  -> 对端路由器 / 交换机
                  -> 服务器网卡
```

每一跳都有 PHY → MAC → IP 的拆层 / 装层。这一节要回答：
- 以太网帧为什么最小 **64 字节**？
- 100G/400G 网卡 PHY 是不是直接打铜线？为什么美团字节都在向 25G 接入、100G 互联、400G spine 切换？
- 数据中心为什么大量用光纤而不是 Cat6？DAC（直连铜缆）什么时候比光便宜？
- 为什么 1500 字节 MTU 一直没动？jumbo frame 9000 在哪些场景赢？
- PFC / ECN / DCBX 怎么在链路层做流控？为什么 RoCE 必须依赖 PFC？

---

## 以太网帧结构

```
+----------+--------+--------+--------+-----------+--------+--------+
| Preamble | SFD    | DA     | SA     | EtherType | Payload | FCS   |
| 7B 10101010| 1B 10101011 | 6B | 6B | 2B        | 46-1500 | 4B CRC |
+----------+--------+--------+--------+-----------+--------+--------+
                                                             +12B IFG (帧间隙)
```

最小帧长（不含 preamble/SFD/IFG）= 64 字节，最大（含 4 字节 FCS）= 1518 字节。VLAN tag 加 4 字节 → 1522。

### 64 字节最小帧的由来

CSMA/CD 时代（共享总线 / Hub）：冲突检测要求发送方在帧发完之前能收到对端的冲突信号，否则已经把整帧光发出去了，冲突信号回来已经晚了。

```
T_frame >= 2 * T_propagation   (round-trip time)
```

最长 2.5 km 同轴电缆（10BASE5）≈ 25.6 µs RTT（光速 2/3 c 的铜信号）。10 Mbps 下：

```
10 Mbps × 25.6 µs × 2 = 512 bit = 64 byte
```

→ 最小帧 64 字节恰好是 10 Mbps 下"冲突窗口"的两倍。短数据要 padding 到 64。万兆全双工交换时代 CSMA/CD 已经没用，但 64 字节保留为兼容。

> [!NOTE]
> 高速链路（≥1G）下，"近端冲突信号延迟"在大楼尺度内不足 1µs，远小于 64 字节发送时间。但 64 字节已成为以太网帧法定下限，跨所有速率保留。

### 1500 字节 MTU 的由来

1980 年代以太网用 1500 字节是 **CPU 处理能力和缓冲大小的折中**：

- 太大 → 早期网卡没有足够 RAM buffer + CPU 中断处理开销过大
- 太小 → 协议头开销比例高（14B header + 4B FCS = 18B 开销）

1500 在 10 Mbps 下发送 1.2 ms。IEEE 802.3 标准化后锁死，因为 MTU 必须全网一致——改了就跨厂商互不兼容。1998 年 IEEE 802.3ac 引入 jumbo frame 9000 字节为可选，但**互联网路径只能依赖 PMTUD 到 1500**，jumbo 只是在数据中心内部用。

> [!WARNING]
> 修改 MTU 时两端必须对称，否则会出现"小包通大包掉"的诡异黑洞。`ping -M do -s 1472 target` 可以测路径 MTU（1472 = 1500 - 20 IP头 - 8 ICMP头）。

---

## PHY / MAC 分层

现代网卡（Intel X550 / Mellanox ConnectX-6 / NVIDIA BlueField-3）内部：

```
+------+   +--------+   +-----+   +------+   +------+
| PCIe | <->| MAC     |<->| PCS  |<->| PMA  |<->| PMD  |<-> 介质
| (TX/ |    | (RS,    |   | 64b/ |   |serdes|   | optics/
| RX   |    |  MAC    |   | 66b  |   |      |   | cu   |
| ring |    |  ctrl)  |   | enc  |   |      |   | laser|
| ao_) |    +--------+   +-----+   +------+   +------+
+------+
              ↑                        ↑         ↑
            MAC 层                   PHY 子层  PHY 子层
```

- **MAC**：帧组装、FCS 计算、流量控制、802.1p/q tag、QoS 调度
- **RS**（Reconciliation Sublayer）：MAC ↔ PHY 适配
- **PCS**：8b/10b、64b/66b、256b/257b 编码 + 对齐
- **PMA**：串并转换、CDR（clock data recovery）
- **PMD**：物理介质驱动（光 / 铜）

### 线路编码：为什么不是 8b/8b

NRZ 直传时钟会和直流耦合问题撞上：
- 长串 0/1 时接收端 CDR 锁不住时钟相位 → bit error rate 上升
- 直流分量偏移会破坏隔直电容

所以需要 **直流平衡 + 跳变密度** 两条件都满足：

| 速率 | 编码 | 开销 | 跳变密度 |
|------|------|------|----------|
| 1G Ethernet | 8b/10b | 25% | 至少 3 次/10 bit |
| 10G Ethernet | 64b/66b | 3.1% | 平均 12 transitions/66 bit |
| 25G/50G | 64b/66b | 3.1% | 同上 |
| 100G/200G | 64b/66b + RS-FEC (528/514) | ~5% 附加 |
| 400G/800G | 256b/257b + PCS-FEC | <1% 编码 + <5% FEC |

> [!NOTE]
> 8b/10b 用 256 个有效字符 + 12 个控制字符 + 100+ 控制字符的冗余表示，每 8 bit 译码成 10 bit。64b/66b 用 2 bit 同步头提供跳变 + 扰码保证密度，比 8b/10b 节省 22% 带宽。

---

## Auto-Negotiation 与流控

### AN (Auto-Negotiation)

1000BASE-T 通过 FLP（Fast Link Pulse）广播本端能力（速率 / 双工 / 暂停帧支持 / FEC），双方选交集。**强制 Speed/Duplex 是反模式**——一端强制另一端自协商会出现 duplex mismatch（一端 full 一端 half），表现为大量 late collision + 性能崩溃 1/2 倍 + 偶发 timeout。

### IEEE 802.3x Pause + 802.1Qbb PFC

普通 Pause 帧会把整口堵死。PFC（Priority Flow Control）按 802.1p 优先级 8 个 class 各自独立暂停：

```
host A -> switch -> host B
        switch 出口拥塞 -> 发 PAUSE 帧 (class 3) 给 host A
        host A 暂停 class 3 发送，其余继续
```

数据中心 RoCE / RDMA 强依赖 PFC + ECN 实现 **"无损以太网"**（lossless Ethernet）。否则 RoCE 的 credit-based flow control 一旦遇到丢包会重传，PG 暂停秒级。

实际部署里 PFC 有**死锁 (deadlock)** 风险：A→B、B→C、C→A 互相暂停 → 链路全部冻结。解决：交换机做 deadlock detection + 强制丢弃优先级 head-of-line 帧（vendor-specific；亲测 Arista/Cisco 都要单独配置 `pfc watchdog`）。

---

## 交换机转发逻辑

L2 交换机核心：

```python
def on_receive(frame):
    src = frame.src_mac
    dst = frame.dst_mac
    mac_table[src] = ingress_port   # 学习
    if dst in mac_table:
        forward(mac_table[dst], frame)
    else:
        flood(frame, all_ports_except(ingress))  # 未知单播泛洪
```

CAM 表项老化默认 5 分钟。STP（802.1D）通过 BPDU 计算"根桥 → 端口角色（root/designated/block）"，收敛时间 30-50s；RSTP（802.1w）≤ 1s。

数据中心用 **SPB** (IEEE 802.1aq) 或 **TRILL** 替代 STP 因为 STP 阻塞端口浪费带宽；现在胖树 spine-leaf + ECMP 已经是事实标准，STP 已经退场。

---

## 数据中心布线：铜 vs 光

| 维度 | Cat6A (10G copper) | SFP+ DAC | SFP28 (25G) 光 | QSFP-DD (400G) |
|------|-------------------|----------|----------------|----------------|
| 距离 | 100 m | 5 m | 100 m (OM4) / 10 km (SMF) | 100 m - 40 km |
| 功耗 | 0.5 W | <0.2 W | 1 W | 10 W+ |
| 延迟 | ~500 ns/100m | <10 ns | ~500 ns/100m | 类似 |
| 成本 | 低 | 最低 | 中 | 高 |
| 散热难度 | 中 | 易 | 中 | 难 |

机架内 Top-of-Rack 用 DAC（5m 内零功耗）；机架间或跨机房用多模光纤（OM4 100m）；跨 DC 用单模 + DWDM。

### DWDM（Dense Wavelength Division Multiplexing）

一根单模光纤可以同时承载 80-160 个波长，每个波长 100G/200G/400G → **单纤 12.8 Tbps+**（中国电信在 2022 年实验室已演示过 104 TBps）。相干光通信（coherent detection）+ DP-QPSK / 16QAM 调制盘活骨干容量。

```
C-band 频段 (1530-1565 nm):
λ_1, λ_2, ..., λ_80  ---  每个间隔 50 GHz ITU grid
        ↓
EDFA 光放大器同时放大所有波长 (不需要光-电-光转换)
        ↓
经过几千公里到对端，光放大器间距 80-100 km
        ↓
要分波时用 OADM (Optical Add-Drop Multiplexer)
海底光缆常见间距 50-100 km EDFA，每 1000 km 加一个 REGEN（光-电-光再生）
```

### 调制效率：从 QPSK 到 PM-256QAM

每符号携带的比特数：

| 调制 | bit/sym | 在 50 GHz ITU slot 下速率 |
|------|---------|---------------------------|
| DP-QPSK | 4 | 100G |
| DP-16QAM | 8 | 200G |
| DP-64QAM | 12 | 300G |
| DP-256QAM | 16 | 400G |

调制阶数越高 → 每个 symbol 对噪声越敏感 → 容许 OSNR 越高 → 距离越短。所以 DC 内用 PAM4 简单，跨大陆用低阶调制 + 强大 FEC + 相干接收。

---

## 硬件视角：MAC 到 PCIe DMA

### 收包（RX）路径

```
网线 -> PHY -> MAC RX ring buffer -> DMA 写到 host 内存
       -> MSI-X 中断 -> NAPI poll -> skb -> netif_receive_skb
       -> IP/TCP stack -> socket queue -> recvmsg()
```

`rx_desc` 环（典型 1024-4096 项）由驱动提前把已分配 skb 的物理地址填好。NIC 收到包后 DMA 直接把帧写到 ring 里，**不经过 CPU**。

```bash
ethtool -G eth0 rx 4096 tx 4096      # 调环大小
ethtool -L eth0 combined 16          # 调 RSS 队列数
ethtool -N eth0 rx-flow-hash tcp4 sdfn   # 五元组 hash 分队列
ethtool -S eth0 | grep -E 'rx_missed|rx_no_dma|alloc_rx' # 关键 NIC 计数器
```

### 中断与 NAPI

每个 packet 触发一个中断在中带宽下 OK，高 PPS 下 NAPI 切换到轮询：

```c
irq -> napi_schedule() -> softirq NET_RX
  -> napi_poll() budget=64 一批
  -> budget 用完或 ring 空 -> 关闭轮询，重新启用 IRQ
```

高 PPS 下 ring 要大、IRQ affinity 要 pin 到核、与 NUMA 配对、`SO_BUSY_POLL`、`XDP` 全部上场。可以打到 10M-50M pps（64B 包）。

> [!NOTE]
> 单线 100Gbps 64B 包 = 148.8 Mpps，超出任何软件路径极限。所以 100G 链路对 64B 小包必须用 XDP + AF_XDP 卸载，或硬件三层路由卸载。线速跑 1500B 包只需 8.3Mpps，仍需 ARR/RSS + busy poll 才能跑满。

---

## 多语言示例

### 抓包统计（Python + Scapy）

```python
from scapy.all import sniff, Ether
from collections import Counter
counter = Counter()
def cb(pkt):
    if Ether in pkt:
        et = hex(pkt[Ether].type)
        counter[et] += 1
sniff(prn=cb, count=100000, store=False)
print(counter)
# Counter({'0x800': 95000, '0x86dd': 4000, '0x806': 600})
```

### 用 eBPF/XDP 在网卡做包过滤（C + libbpf）

```c
SEC("xdp")
int drop_bcast(struct xdp_md *ctx) {
    void *data = (void *)(long)ctx->data;
    void *end  = (void *)(long)ctx->data_end;
    struct ethhdr *eth = data;
    if ((void*)(eth+1) > end) return XDP_DROP;
    if (eth->h_dest[0] & 1) return XDP_DROP;   // 广播/组播丢
    return XDP_PASS;
}
```

XDP 程序运行在 driver RX 路径上，还没建 skb 之前，PPS 可达 20M-50M。

### 用 Go 看内核 NIC 计数器（gopsutil）

```go
import "github.com/shirou/gopsutil/v3/net"
stats, _ := net.IOCounters(true)
for _, s := range stats {
    if s.Name == "eth0" {
        fmt.Printf("rx: %d bytes, %d packets; tx: %d, %d\n",
            s.BytesRecv, s.PacketsRecv, s.BytesSent, s.PacketsSent)
    }
}
```

---

## 易错清单

- ❌ 强制 speed/duplex 又对端 auto → duplex mismatch → 性能腰斩
- ❌ 改 MTU 两端不一致 → 黑洞丢包（小包通过，大包掉）
- ❌ PFC 配错优先级 → 上行/下行死锁，需要 deadlock detection 兜底
- ❌ RJ45 跨 100m 走 Cat5e → 高速误码率上升（10G 必须 Cat6A）
- ❌ LACP 两端 hash 算法不一致 → 单流只走一条线（带宽不滚动）
- ❌ SFP 模块未在 HCL 列表 → 高温掉线 / CRC 异常上升
- ❌ 同一根 DAC 走 4Gbps 但插入新交换机后协商成 1G → SFP+ 协议未握手

## 真实生产事故参考

1. **GitHub 2018 10/21**：BGP 跨数据中心 43 秒错误路由 + OSPF 撤回前缀 + TCP RST 重置连接。事后 GitHub 引入 Anycast + 多供应商 BGP + Manycast DNS。
2. **Cloudflare 2020 7/17**：Router BGP 把 POP 路由通告到错误 AS_PATH，全球部分流量被黑洞 27 分钟。
3. **Facebook 2021 10/4**：BGP 撤回权威 DNS 路由 → 全球 6 小时不可访问。根因是内部自动化更新 router 配置前未做任何 dry-run 校验。

## 这一章带走的东西

1. 以太网 64 字节最小帧 = 10 Mbps 下冲突窗口的两倍；CSMA/CD 已废弃但帧格式延续
2. PHY 内部 RS/PCS/PMA/PMD 子层；编码从 8b/10b 演进到 256b/257b（DC 平衡 + 跳变密度）
3. PFC + ECN = 数据中心无损以太网基石，但需 deadlock detection 防 PFC 死锁
4. 骨干带宽来自 DWDM + 相干光，单纤 12T+；C-band + EDFA 是 80λ 同纤放大的物理基础
5. NIC RX 路径：DMA 写 ring -> MSI-X IRQ -> NAPI poll；高 PPS 必须 XDP/NAPI/busy_poll/numa pin 全套上调

下一节 → [以太网帧、CSMA/CD、PHY/MAC](ethernet.md)
