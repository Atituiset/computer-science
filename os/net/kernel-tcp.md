# TCP/IP 内核栈与 NAPI

## 一句话

Linux 内核的 TCP/IP 协议栈是工程上最被低估的子系统之一："高了一个量级"。现代内核 + 多队列网卡 + NAPI + io_uring + eBPF 在 100 Gbps 的网络下还能跑出 50% 的线速。这章拆开 TCP/IP 内核栈的 packet lifecycle + NAPI 机制 + RPS/RFS/XPS 软中断分发, 让你看懂 "16 核 100 Gbps NIC 实际能跑多少"。

## 1. 一个 packet 的 lifecycle

```
NIC RX 流 ingress frame
   ↓ DMA 到 ring buffer (RX ring)
   ↓ 触发 IRQ, 内核 NAPI 软中断
   ↓ net_rx_action → E1000 driver → netif_receive_skb
   ↓ 进入协议栈:
        L2 (eth_type_trans)
        L3 (ip_rcv)
        L4 (tcp_v4_rcv)
   ↓ socket 收包队列
   ↓ syscall recvmsg 拷贝到 user
```

每 packet 经过 ~20 个函数, 2000-5000 cycles 抵达 user space.

2000 cycles ÷ 3 GHz = ~ 700 ns / packet ⇒ 1.4 Mpps / core (kernel 网络栈极限).

50 Gbps 流量 ÷ 1500 MTU = 4 M pps ⇒ **超过单 core 网络处理能力**.

这就是为什么内核需要 multi-queue NIC + multi-core scaling.

## 2. NAPI: 中断 + 轮询混合

NIC 旧模型: 每 packet 触发 1 IRQ + 内核 IRQ handler 处理. pps 高时 IRQ storm 撕 CPU.

NAPI (New API):
- 第一 packet 触发 IRQ, kernel 知道 NIC 有数据;
- 之后关闭 NIC IRQ, kernel 软中断轮询 (net_rx_action) 在该 NIC 上拉 ~64 个 packet 直到 N;
- 没数据再 rearm IRQ.

```
NIC RX IRQ → net_rx_action → poll up to 64 packets → no more → rearm IRQ
```

收益: 5 Mpps 流量下从每 N 次切换 IRQ (50 万 IRQ/s) 降到万次 IRQ/s.

## 3. Multi-queue NIC + IRQ 分配

NIC 256 RX/TX queue (modern Mellanox CX-6/7), 内核把每个 queue 的 IRQ 通过 `smp_affinity` 拆到 CPU:

```bash
cat /proc/irq/N/smp_affinity_list
echo "0-3" > /proc/irq/N/smp_affinity
```

XPS (Transmit Packet Steering): TX queue 选 CPU 默认;
RPS (Receive Packet Steering): RX hash 把 packet 拆到任一 CPU;
RFS (Receive Flow Steering): 按 socket 所在 CPU 转, 提高 cache.
aRFS: 自动 RFS, NIC 直接 dispatch.

**完美配置**: 每 RX queue 绑一 CPU, IRQ 不跨 socket, RPS 关, aRFS 开.

## 4. 网络栈代码路径复杂度

```
packet rate / CPU:
  单核 raw socket (PF_RING zero bypass): ~ 14 Mpps (14 ns/pkt)
  单核 gro + tcp + recvmsg: 1.5 Mpps (700 ns/pkt)
  单核单 epoll + 1024 是可能 0 ms latency јѕ 5 ms env: ~ 1 Mpps
```

高 PPS 越接近 kernel 1750 ns 限 = 需要走 bypass.

## 5. GRO/GSO: 聚合大小 packet 减少 chain

- GRO (Generic Receive Offload): NIC 改 packet frame 收大小异常, kernel 内部 merge 多个 small packet 大 64 KB unit 给上层 stack ⇒ stack 跑一次 vs 100 次;
- GSO (Generic Segmentation Offload): 出向, kernel 把 64 KB 巨型 segment 丢给 NIC, NIC 自己分成 MTU-size.

现代 NIC 通常支持 hardware GRO/GSO, 优势 of tcp burst.

## 6. eBPF + XDP: 内核暖些 pre-router

eBPF 在网络 packet 收入 frame 阶段可以编程:

```
NIC RX queue → XDP (eXpress Data Path) hook → 用户 eBPF program →
   ↓ 丢 / 重定向 / let go to kernel stack
```

XDP eBPF program 通常处理 packet:
- DDoS 现场丢 IP 黑名单;
- L4 load-balancer (e.g. Cilium LB);
- NAT + 防火墙规则;
- metric collection.

性能: XDP 在 Linux 5.0+ 已经能到 24 Mpps per CPU, 远超传统 kernel stack. 这是 Cilium / cloudflare 等工业核心.

## 7. 多语言同一抽象

```
ef: 内核栈可用 = 不需要直接里程.
  - C / Rust: libc syscall on socket
  - Go: runtime 自己 epoll over socket fd
  - Java: NIO epoll
  - Node: libuv
  - Python: asyncio / trio
```

各语言都默认走 kernel TCP/IP stack, 但想要 kernel-bypass 必须自写:

```c
// DPDK 直接 mmap NIC ring
// Onload / OpenOnload 类似 (SolarFlare) NIC driver SDK
```

## 8. 实测生产线式优化

```bash
# 调 NIC IRQ on NUMA socket
for i in $(ls /proc/irq/*/smp_affinity_list); do ... done

# 关闭 packet processing features
ethtool -K eth0 gro off  
ethtool -K eth0 gso off   # 仅 debug baseline

# ringbuffer up
ethtool -G eth0 rx 8192 tx 8192

# 推荐 mtu 9000 (jumbo) 在 internal cluster: ipv_set dev eth0 mtu 9000
```

## 9. 这章带走的东西

- kernel TCP/IP 在单核 ~ 1.5 Mpps 上界;
- NAPI 改 IRQ storm 软轮询, 现代 NIC 必配;
- multi-queue + IRQ smp_affinity + RFS/RPS 让多个核同时处理 RX;
- GRO/GSO 让单 throughput 拓宽 64 KB 上 vs 1.5K MTU 量级;
- bpf + XDP 在 NIC ingress 阶段执行 user code = 24 Mpps per CPU 现代性能;
- 真要 100 Gbps line-rate 跑要用 DPDK/XDP full bypass.

下一节 → [XDP、DPDK 与 kernel bypass](xdp-dpdk.md)
