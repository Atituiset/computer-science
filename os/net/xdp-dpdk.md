# XDP、DPDK 与 kernel bypass

## 一句话

**kernel bypass** = 让 user-space app 直接看到 NIC ring buffer 而不进内核 TCP/IP stack。从 2000 年代起的 PF_RING/DNA, 到 Intel DPDK, 到 Linux 5.0+ 的 XDP+AF_XDP, 演进路径全是"把更前一段路径前移到用户态, 减少 syscall & IRQ reentry." 这章把三条主路 XDP / DPDK / AF_XDP 做对比, 看清 100 Gbps 服务器的真实 before/after.

## 1. kernel 网络栈的瓶颈: 1500 ns per packet

经前面章节的 mental model:

```
kernel TCP/IP 单 packet 处理: ~ 700-1500 ns / CPU
```

100 Gbps + 1500 MTU ⇒ 8 M pps ⇒ 远超单 CPU 能力. multi-queue NIC 让多 CPU 同时分担, 但每次"过 stack 个"仍是常数. **bypass 干的事就是绕过 stack 这一步**.

## 2. DPDK: Intel 2010 出品, 是 kernel bypass 工业事实标准

DPDK = Data Plane Development Kit. 把 NIC driver in user-space 改:

- 把 NIC mmap 到 user-space;
- 大页 + 协议 queue;
- 轮询 thread (poll-mode driver) 自 spin in user-space 不进 IRQ;
- batch packet 64+ 个每批进 user 处理.

```c
// DPDK 类骨架:
while (true) {
    nb_rx = rte_eth_rx_burst(port_id, queue_id, bufs, 32);
    for (i = 0; i < nb_rx; i++) process_packet(bufs[i]);
    nb_tx = rte_eth_tx_burst(port_id, queue_id, bufs, nb_rx);
}
```

优势: 
- 平均 latency 1-3 μs / packet (vs 50 μs kernel);
- 吞吐: 14 Mpps / core 几近线速 + 多 queue.

劣势:
- CPU 100% busy poll (no sleeping);
- NIC 整块 isolated 不能再给 kernel 其他 socket 用;
- driver 在 user-space, 与 native Linux NIC 路径并行不兼容.

部署: HFT / NFV (网络功能虚拟化) / 5G UPF / OVS (Open vSwitch) 大量用 DPDK.

## 3. XDP + AF_XDP: Linux 5.0+ 内核内置 bypass

XDP 是 eBPF 在 kernel 内入口 XDP hook:

```
NIC RX → DMA to ring → 内核 driver → XDP hook ran in driver context →
   动作: XDP_DROP, XDP_PASS, XDP_TX, XDP_REDIRECT
```

XDP 不让 user-space, 它给 eBPF程序在 kernel driver 模型下早期阶段运行. 适合:
- DDoS 拦截;
- L4负载均衡 (Cilium LB);
- 一致分布式 firewall.

**与 DPDK 相比**: XDP 不让 NIC 脱离 kernel stack, 它在 stack 入口插了 hook. 让 packet 可以直接 in-kernel 跳出 stack 而不上 ret.

AF_XDP: 与 XDP 配合, 把 packet 通过 socket 直接传到 user-space:

```c
// XDP program 把 packet redirect 到 AF_XDP socket
int xdp_prog(struct xdp_md *ctx) {
    return bpf_redirect_map(&xsks_map, 0, XDP_PASS);
}

// user-space 绕过 stack
int sock = socket(AF_XDP, SOCK_RAW, 0);
```

perf:
- XDP_DROP: 24 Mpps per CPU
- AF_XDP round-trip user kernel boundary: ~ 10 Mpps per CPU (具体 latency 1-3 μs)

XDP vs DPDK:
- XDP 可与 kernel stack 兼容 (按 PASS 也 用);
- DPDK NIC 独占;
- XDP 需要 Linux 4.18+;
- DPDK 工业成熟度早期 higher (NIC vendors 主流), 但 XDP 在 kernel 已实 工程实测 ~ 2024 与 DPDK 持平.

## 4. Cilium 用 XDP 做的工业级 load balancing

Cilium/eBPF 是 K8s + LB + firewall 一致平台:
- 来自 EC2 pod 的 packet 入 node, XDP early hook 查 priory ip + port → redirect 到本地 pod socket;
- 完全 bypass kernel stack;
- LB ops/s 可以 5-10× kube-proxy.

工程性: 4.18+ kernel 已可用. Cloudflare / GCP / AKS 等是常规.

## 5. RDMA: 完全旁路 NIC

并非所有 NIC 不是 CPU 上 dispatch. NVIDIA ConnectX + RDMA RoCE v2 让国际 NIC 可:
- 一端 host user memory 注册 mr;
- 另一端 user 直接 read / write mr verbs;
- 旁路 NIC stack 和 TCP/IP.

```c
ibv_post_send(qp, &wr, &bad);  // 直接绕 stack post send → peer host's MR
```

latency:
```
TCP via stack        50 μs
DPDK UDP             2-5 μs
RDMA                 1-2 μs
GPUDirect RDMA       <1 μs
```

GPUDirect RDMA 让 GPU mem to NIC zero copy, 不经 host 内存. 大模型训练 benchmark 互联依赖.

## 6. SmartNIC: DPU (Data Processing Unit)

NVIDIA BlueField / Intel IPU / AMD Pensando 把 NIC 升级成 SoC:
- 双 ARM core onboard;
- FPGA / NPU 加速引擎;
- 加载 NVMe storage + Linux;
- 直接处理 VXLAN / TLS / firewall / offload eBPF on NIC.

软件切换范式:
- 在 host CPU 不算网卡 packet;
- 在 NIC 内部把传输到 host 的仅 load 实际数据 packet;
- host CPU 见到的 packet 不是 NIC 物理 raw, 而是 L7 已解析过的 "App 上流事件".

参考架构: DPU = next-gen SmartNIC + 自 VM / ONIC. 

## 7. 多语言

| 语言 | kernel bypass |
|------|---------------|
| C / C++ | DPDK, VPP, mmap NIC ring |
| Rust | async + VPPs lib |
| Go | 不太友好的, but DPDK-binding with cgo usable |
| Java | Apache Pulsar 形 等上Solace Onload, 但很难 |
| Python | 完全不生产 sprint DPDK Python eBPF |

DPDK / XDP / RDMA **工程上由 C/C++/新Rust 文化承担**. 高级语言 runtime 都不独 bind, 因为 1.他们 OS runtime 要 syscall 接口, 而且没有 determinism guarantee 离 kernel-bypass 太远; 2. 用 wrapper cgo 破环 runtime 性能.

但 ECA 出产 XDP-by-Rust (aya) 现 在是的 Serious 试真 names like Solana.

## 8. 选择树 (按 latency 要求)

```
50 ms acceptable     → 通用 TCP/IP + epollioUring
1-10 ms              → kernel + connected to GRO/或 io_uring net Z
<100 μs              → XDP / AF_XDP + custom code in C / Rust
急着 HFT 1 μs        → DPDK + 用户态轮询
急着 7ns/140GB/s       → GPUDirect RDMA on CUDA + ConnectX-7
```

## 9. 这章带走的东西

- kernel stack 默认有 ~700 ns/pkt 限 ⇒ 高 PPS 必 bypass;
- DPDK = user-space poll mode 早 4-100×;
- XDP = kernel 内置 bypass hook, eBPF 编程;
- AF_XDP = XDP 版 user-space socket pass;
- SmartNIC / DPU level: 移动 syscall 到 NIC chip;
- DPDK 与 XDP 性能相近, 选型看 e 库 / 兼容 与 较 选择.
