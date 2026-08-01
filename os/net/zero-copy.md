# Zero copy: sendfile / splice / MSG_ZEROCOPY

## 一句话

"零拷贝" 这个词也常被误读。它不是字面意义的"字节一次都不拷"——它是"**不去把数据从 kernel space 拷到 user space 再拷回去**"的工程化叫法. 在网络栈下半段, 一个 packet 从 disk 到 NIC 经过零拷贝优化能少 2 次 memcpy. 这章把 `sendfile / splice / tee / MSG_ZEROCOPY` 四种形式拆开, 你看到"零拷贝"有多个抽象层级.

## 1. 普通 read/write 几次拷贝?

```
read(fd, buf, 4096):
  DMA disk → kernel page cache (1 次 DMA, 不算 copy);
  memcpy kernel → user buf (1 次 CPU copy);
  返回 user.

write(socket, buf, n):
  memcpy user → kernel socket buffer (1 次 CPU copy);
  kernel → NIC DMA (1 次 DMA, 不算 copy).
```

**总共 2 次 CPU memcpy, 2 次 DMA**. 一次 disk-to-NIC 大概 8 KB / IP packet ⇒ memcpy 8 KB 不是大头, 但小请求高 QPS 时 syscall + cache miss + page table walk → 包 sys% 占 60-80%.

## 2. sendfile: 替 read+write

```c
ssize_t sendfile(int out_fd, int in_fd, off_t *offset, size_t count);
```

`out_fd` 只能 socket; `in_fd` 只能 file.

实现: kernel 内部 DMA disk → page cache → DMA page cache → NIC (用 SG-DMA / zero-copy TCP). **字节不经过 user space, 也不经过 user buf 的 memcpy**.

适合场景:
- nginx sendfile on;  (默认 on)
- Apache HTTPD EnableSendfile On;
- webserver 静态文件 dispatch.

## 3. splice / tee: 任意 fd 间零拷贝

```c
int splice(int in_fd, off_t *off_in, int out_fd, off_t *off_out, size_t len, unsigned flags);
int tee(int fd_in, int fd_out, size_t len, unsigned flags);
```

splice 必须至少一端是 pipe; tee 双端都是 pipe. Linux 把数据在 kernel 之间传用 pipe buffer 引用。

```
in_fd → splice → pipe → splice → out_fd
      (机制: 内部用 pipe_buffer struct, 共享 page 引用)
```

实例:
- HTTP proxy 转发 disk file → client socket:
  ```
  fdt = open("file");
  pipe(p);
  splice(fdt, NULL, p[1], NULL, 65536, 0);
  splice(p[0], NULL, client_sock, NULL, 65536, SPLICE_F_MOVE);
  ```
  完全在 kernel 内传 page reference, no CPU copy.

## 4. MSG_ZEROCOPY: 用户态 zero copy

`send` 系统调用一个 flag, 加上 `MSG_ZEROCOPY`:

```c
send(socket, user_buf, len, MSG_ZEROCOPY);
```

实现: kernel 把 user buf 注册成一次 DMA 引用，NIC 直接从 user 内存 DMA 出去而不复制到 kernel socket buffer.

但需要 user 显式 `poll` 一个错误队列 (`MSG_ERRQUEUE`) 接收完成通知，再 free 缓冲区. 否则 NIC 还在引用，free 就乱套. 这就是为什么大部分项目选用 RDMA 而非 MSG_ZEROCOPY: 通知机制复杂.

Go runtime 在 net package 已经支持 MSG_ZEROCOPY 自 1.11, 但需要 reflective GSO + ack notify framework, 工程实操需要 package reset.

## 5. RDMA verbs: zero copy 跨主机

RDMA (Remote Direct Memory Access) 物理: HCA (Host Channel Adapter) 卡直接访问 host 内存 + 跨主机 host-host 内存 zero copy.

```c
ibv_post_send(qp, &wr, &bad);  // post send to peer host's MR
```

延迟:
```
TCP loopback           5 μs
TCP cross host hetzner 50 μs
RDMA cross host       2 μs
RDMA + GPUDirect      1 μs
```

Virtually 跨主机无 syscall, 由硬件 inbox 卡完成.

工业: HFT / HPC / NVIDIA Magnum IO / late توسط Microsoft Azure 等. **真 zero copy cross host 就这一个**.

## 6. 实测比较 (1 GB disk → NIC 流量)

| 模式 | 工作流 | 延迟 | CPU% |
|------|--------|------|------|
| send + recv | 100-10 ms | 100 μs | 60% |
| sendfile | zero copy disk→NIC | 50 μs | 10% |
| splice + 中间 pipe | anonymous | 60 μs | 12% |
| MSG_ZEROCOPY | user buf DMA | 70 μs | 15% |
| RDMA | 直接内存到内存 (no 路径 disk) | 2 μs | 5% |

## 7. 多语言支持

| 语言 | zero-copy 接口 |
|------|----------------|
| C / C++ | sendfile, splice, MSG_ZEROCOPY, RDMA verbs |
| Go | net.TCPConn.WriteFile + syscall.Sendfile; `net` package `WriteTo` |
| Rust | nix::sys::sendfile, tokio-utils |
| Java | FileChannel.transferTo (用 sendfile), NIO |
| Python | os.sendfile (Python 3.3+ 直接 wrap) |

工程各语言都给 wrap. Go 1.11+ `net.TCPConn` `.ReadFrom` 直接走 sendfile 自动.

## 8. 这章带走的东西

- 普通 read/write 在每次数据 flip 有 2 次 CPU memcpy;
- sendfile 是 disk → socket 专用零拷贝 (Linux 2.2+);
- splice 利用 pipe 内部 page ref 共享, 任意两 fd 通用零拷贝;
- MSG_ZEROCOPY 让 user buf 直接给 NIC DMA, 需要 `MSG_ERRQUEUE` 通知;
- RDMA 是真跨主机零拷贝, 在 HFT / HPC 接近微秒级;
- 各 runtime 提供 wrap, 但要用到位需深入了解 API 语义.

下一节 → [TCP/IP 内核栈与 NAPI](kernel-tcp.md)
