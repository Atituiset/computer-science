# 第三部分 · 计算机网络

## 一句话

`axios.get('https://api.example.com')` 背后：电信号从 100BASE-T 网口出去，跨交换机、路由器、光纤骨干、CDN、TLS、负载均衡，跑几千公里到服务器再原路返回一个 JSON。这条通路上每一跳都对应一层"协议"负责把上一层数据装进下一层信封。读完这一部分，你应该能从字节看到光子、从 RPC 看到内核中断、从握手 RTT 看到激光相位——这就是网络工程师的全栈视角。

## 为什么协议要分层

把 5000 种硬件介质和 5000 种应用协议两两对接是 $O(n^2)$ 工程，分层让接口收敛到 $O(n)$：上层只对"下一层提供的接口"负责，下层只对"上一层调用我的方式"负责。这就是 ISO/OSI 七层真正的现实版（虽然 OSI 自己部署不出去，TCP/IP 五层活了下来）：

```
应用层    | HTTP/2/gRPC/MQTT     | 你写的 axios
传输层    | TCP/UDP/QUIC          | 内核 + 协议栈
网络层    | IPv4/IPv6/ICMP        | 路由表 + LPM 查找
数据链路层| Ethernet/WiFi/PPP     | MAC + 帧组装 + FCS
物理层    | 1000BASE-T/100G-QSFP  | PHY PHY PCS PMA PMD
```

每一层有自己的命名空间（端口号 vs IP 地址 vs MAC 地址），自己的拥塞模型（TCP Cubic vs RED/ECN 信号 vs CSMA/CD 冲突），自己的恢复机制（重传 vs ARP 重试 vs 链路重连）。把它们打包成 5 层抽象之后，软件工程师可以用 `fetch()` 调地球另一端的服务而不用懂光相位检测。但**遇到性能问题、丢包混沌、协议升级时，分层就是要把每层都拆开来看**——这一部分就是干这件事。

## 这一部分的章节

- [物理层 / 数据链路层](phy/index.html) — 以太网帧、CSMA/CD、PHY/MAC 分层、光纤、DWDM、机房布线
- [IP / 路由](ip/index.html) — IPv4/v6、ICMP、ARP/NDP/DHCP、BGP/OSPF、NAT+conntrack
- [TCP / UDP](tcp/index.html) — 三次握手四次挥手、TIME_WAIT、Reno/Cubic/BBR、SACK/RTO 估计
- [HTTP / TLS](http/index.html) — 1.0→1.1→2→3 演进、TLS 1.3 握手与 0-RTT、证书链/PKI、gRPC/Protobuf
- [QUIC](quic/index.html) — over UDP 解决什么、连接迁移、BBR 在 QUIC 下的特点

读完你应该能回答这些问题，而不是只会说"我学过计算机网络"：

1. 为什么以太网帧最小是 **64 字节**而不是 32？为什么 1500 字节 MTU 沿用 40 年没人改？
2. **BGP vs OSPF** 谁的收敛快？为什么 ISP 用 OSPF，跨 ISP 用 BGP？为什么 BGP 默认 30s 抑制？
3. **TCP Cubic vs BBR** 在卫星链路、5G 移动网络、跨洋数据中心里各自赢谁？
4. **TLS 1.3 0-RTT** 怎么保证保密性同时还能被 replay attack？应用层应该做什么限制？
5. **QUIC** 为什么比 TCP+TLS 1.3 快？连接迁移到底解决了什么真问题？
6. 为什么 `tcp_tw_recycle` 在 Linux 4.12 后被移除？为什么 NAT 后多 client 共用 IP 时它会丢包？
7. Google BBR v1 在 2016 部署后，2019 又换了 v2，到底什么场景下 v1 不公平？

## 这一部分的工程立场

每次给一个新协议栈调优，标配工具链：`tcpdump -i any -nn -X port 443 | wireshark -k -i -` 抓包看 header；`ss -tin` 看内核 socket 状态、cwnd、rtt；`iperf3` 测带宽；`ss -ian` 看中断分布；`ethtool -S eth0` 看 NIC 计数器（rx_missed / rx_no_dma_resources / alloc_rx_page_failed 都是热指标）；`bpftool prog show` 看 XDP；`perf top -e eth0:tx-qos-mismatch` 看软中断热路径。

> [!NOTE]
> 这一部分凡是讲数字的地方（如 "100G 显卡 1W 功耗"、"DWDM 单纤 80λ × 100G = 8Tbps"、"BBR ProbeBW 8 阶段 cycle 8s"）都是公开论文/产品 datasheet 的实际值，不是随手编的。这些数字记下来，做架构决策时可以少打很多白板。
