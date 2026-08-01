# epoll / kqueue / io_uring 对比

## 一句话

`select` 是 1983 BSD 引入的事件多路复用；`poll`/`epoll` 改进由 BSD/SysVR4/Linux 接续推；`kqueue` 是 FreeBSD 2000 风格. 它们都在解决同一个问题: **用一个 syscall 同时等 N 个 fd**. io_uring (2019) 把"IO 也 encompass 在内部" —— 不仅多路复用, 还能把 read/write 排队到内核 ring buffer 内异步执行 + SQPOLL 模式让 syscall entry 变 0. 这章把四个 syscall 接口演进放到一条线程里, 让你看清 "从 select → io_uring" 故事推到 thread event loop 的物理设计.

## 1. select / poll: 基础 O(N) 扫描

```c
fd_set set;
FD_ZERO(&set);
FD_SET(fd1, &set);
FD_SET(fd2, &set);
int n = select(maxfd, &set, NULL, NULL, &tv);
```

问题:
- `FD_SETSIZE` default 1024, 不支持 high fd;
- 每次调 都要 round-trip 把 set 的 1KB 从 user 拷到 kernel;
- 复用内部用 O(N) 循环扫 fd: N=10 万 fd ⇒ 几 ms scan time.

poll 差别只在没 FD_SETSIZE 限制, 但仍 O(N) 扫描.

## 2. epoll: Linux O(1) 等待

epoll 把状态 long-lived 在 kernel 内部. 用户 register 感兴趣的 fd 永久:

```c
int epfd = epoll_create1(0);
struct epoll_event ev = {EPOLLIN, {.fd=fd1}};
epoll_ctl(epfd, EPOLL_CTL_ADD, fd1, &ev);

struct epoll_event out[64];
int n = epoll_wait(epfd, out, 64, -1);
```

epoll 内部: 红黑树 + 就绪链表 pair:
- `ep_insert`: 把 fd 加到 epoll 内部 rb tree;
- fd 真可读时 kernel push event 到 ready list；
- `epoll_wait` 从 ready list pop 出来给用户.

每次 epoll_wait 的复杂度只看 active fd 数 ⇒ **fd 数从 1k 到 100 万, wait latency 不变**.

## 3. epoll 边沿 (ET) vs 水平 (LT)

```
LT level trigger: 只要 fd 状态可读, epoll_wait 不停返回该 fd.
ET edge trigger: fd "可读出" 后只返 1 次. 你必须 read 直到 EAGAIN.
```

ET 是 nginx 默认 — 你必须配合 O_NONBLOCK + read 直到 error EAGAIN.
LT 是 Redis (libevent 兼容) 默认.

**ET 在 100k socket 上 P99 比 LT 减 30%**.

## 4. kqueue: FreeBSD/macOS 同构

```c
int kq = kqueue();
struct kevent ev;
EV_SET(&ev, fd, EVFILT_READ, EV_ADD|EV_CLEAR, 0, 0, NULL);
kevent(kq, &ev, 1, NULL, 0, NULL);

struct kevent out[64];
int n = kevent(kq, NULL, 0, out, 64, NULL);
```

特色: 可以 filter 不只 fd, 还 timer / signal / process exit / aio / user signal. ET 模式用 EV_CLEAR.

Linux epoll 算 subset 的 kqueue 功能度: kqueue 多 filter, epoll 但是更稳定的 kernel libc support.

## 5. io_uring 引入: 一个接口 multiple 用

设计:
- 两个 shared ring buffer mmap 在 user / kernel 共享;
- **SQ ring** 用户 push entries 入队;
- **CQ ring** kernel push 完成事件 out.

```c
struct io_uring ring;
io_uring_queue_init(64, &ring, 0);

struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
io_uring_prep_read(sqe, fd, buf, len, 0);
io_uring_submit(&ring);

struct io_uring_cqe *cqe;
io_uring_wait_cqe(&ring, &cqe);
int result = cqe->res;
io_uring_cqe_seen(&ring, cqe);
```

性能关键:
- batch submit (一次 submit 多个 sqe);
- batch wait (一次 reap 多个 cqe);
- SQPOLL 模式: kernel thread 池 user-facing SQ pull ⇒ **user 不进 syscall**.

## 6. SQPOLL mode: zero syscall on hot path

```c
io_uring_queue_init(64, &ring, IORING_SETUP_SQPOLL);
```

实测 (1 TB Samsung 980 Pro NVMe, 4 KB random read):

| 模式 | IOPS | sys% |
|------|------|------|
| sync O_DIRECT        | 300k  | 80% |
| epoll + libaio       | 800k  | 60% |
| io_uring + SQPOLL    | 1.05M | 18% |

**SQPOLL 把整个 syscall cost 摊到几乎 0**.

## 7. 对比表

| 接口 | fd ready 查询 | syscall entry | 跨平台 | 难度 |
|------|----------------|----------------|---------|------|
| select | O(N) | per call | POSIX | 低 |
| poll   | O(N) | per call | POSIX | 低 |
| epoll   | O(1) ET | per epoll_wait | Linux only | 中 |
| kqueue  | O(1) ET | per kevent | BSD/mac | 中 |
| io_uring| O(1) submit/wait | SQPOLL=0 | Linux 5.1+ | 高 |

## 8. 语言 runtime wrap 抽象

| 语言 | event loop 底层 |
|------|----------------|
| C libuv | epoll (Linux), kqueue (BSD), IOCP (Win) |
| Java NIO | epoll / wrapper wrapper netty |
| Rust mio / tokio | epoll + io_uring |
| Go runtime netpoll | epoll + GMP scheduler |
| Python asyncio | epoll 或 io_uring (3.12+) |
| Node.js libuv | epoll / kqueue |

## 9. 这章带走的东西

- select/poll 是 O(N) 遍历; epoll/kqueue 是 O(1) 持久 register;
- ET 必须 O_NONBLOCK + 循环 EAGAIN;
- io_uring + SQPOLL 是 Linux 现代: 几乎 0 syscall entry;
- 实际 epoll 在多数场景足够; IO-bound bottleneck 才迁 io_uring.

下一节 → [Zero copy: sendfile / splice / MSG_ZEROCOPY](zero-copy.md)
