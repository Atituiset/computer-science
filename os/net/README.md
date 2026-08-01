# IO 与网络栈

## 一句话

Linux 的 IO 模型花了 25 年演进: 从 read/write → select → poll → epoll → io_uring. 每一步都是把"用户态 syscall 数量"降到 O(1) 的工程优化. 网络栈这边从 100 MB/s 的传统 TCP/IP 内核栈走到 100 GB/s 的 kernel bypass (DPDK / XDP / io_uring ZC). 这章把 epoll / io_uring / zero-copy / NAPI / XDP / DPDK 五个抽象叠成同一条工程演进线.

- [epoll / kqueue / io_uring 对比](epoll-iouring.md)
- [Zero copy: sendfile / splice / MSG_ZEROCOPY](zero-copy.md)
- [TCP/IP 内核栈与 NAPI](kernel-tcp.md)
- [XDP、DPDK 与 kernel bypass](xdp-dpdk.md)
