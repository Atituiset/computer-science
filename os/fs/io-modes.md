# Direct IO、mmap、io_uring

## 一句话

Linux 给你**至少三种文件 IO 抽象**: 普通 read/write + page cache、Direct IO 绕 page cache、mmap 让内存成为文件视图、 io_uring 用 ring buffer 批量 syscall. 这 4 种模式对应 OS 在用户态、内核态、块层、设备层不同方式的抽象取舍. 这章拆开看，你会发现它们不是"互相替代"——而是**四种对应不同工作负载的物理化**. 在数据库、KV 存储、AI 训练 dataset、高性能服务里，选错一种就立刻损失 50% 吞吐.

## 1. 默认 read/write + page cache

基本模式：

```c
int fd = open("/data/foo", O_RDONLY);
ssize_t n = read(fd, buf, 4096);
```

`read` 系统调用实际做了：

```
syscall read → 进入 kernel mode;
查 file 的 page cache;
没有 → 启 submit_bio → 块层 NVMe 出: SSD → DRAM (一次 PRP DMA);
有 → copy_to_user(buf, page_cache 的位置, n);
返回 (n 字节)
```

每一次 read 必然拷一份字节到 user buffer. **拷贝本身** 这个动作在 OS 层无法避免 (security: user process 不能直接读 kernel page; 隔离) .

`write` 同样进 kernel 但 page cache 标 dirty 不立即落盘. 这就是 page cache 默认行为.

**适合**: 通用文件读 / 写; 大量 syscall 但 cache hit 高; 中小服务.

**不适合**:
- 自家缓存管理很大并精确控制 (数据库 buffer pool);
- 1 ms P99 不能容忍的硬延迟 (syscall + page cache 路径);
- 大文件 sequential scan (page cache 被洗一遍).

## 2. Direct IO (O_DIRECT)

```c
int fd = open("/data/foo", O_DIRECT | O_RDONLY);
ssize_t n = read(fd, buf, 4096);  // 必须 4KB 对齐的 buf
```

**O_DIRECT 改的是什么**: 数据不进 page cache. 直接 DMA 到 user space buffer. 跳过 memcpy 一步.

**前提**: user buffer 必须 page aligned、len 必须是 page 倍数、file offset 必须 page 对齐. 不对就 -EINVAL.

实现机制:

```
O_DIRECT read:
   → 验证 buf 对齐
   → submit_bio 但 bio 把 page 指向 user buffer (not page cache)
   → 同步等 DMA 完成
   → return (no copy)
```

为什么需要 O_DIRECT? 

1. 数据库自己有 buffer pool, 不希望 OS 再把 page cache 占几百 GB;
2. 顺序写 huge file 不希望破坏 page cache;
3. 1 ms 级延迟服务 page cache lookup overhead (~1 μs) 累计起来太多.

## 3. mmap: 把文件当 byte aptr

```c
void *p = mmap(NULL, len, PROT_READ|PROT_WRITE, MAP_SHARED, fd, 0);
// 接下来 p[i] 就是文件的第 i 字节
```

`mmap` 把内核 page 与 user VA 关联. 一次 `mov eax, [p+i]` 触发 page fault (if not 物化), 内核拉 page → page cache, 然后用户去访问.

**优势**:
- 零拷贝 (user 直接访问 page cache);
- 不需要 explicit `read/write` syscall;
- 共享 MAP_SHARED → 多进程同 map 文件可共享 page cache;
- 支持大文件 lazy page-in (不会一次拉整文件).

**劣势**:
- 写仍标 dirty 可以丢失 until msync/fsync;
- page fault 是额外 sub-μs latency (伴 TLB miss);
- DAX / persistent memory 可以 mmap NVM 直接访问.

**适合**:
- 只读大文件 multi-process 扫描;
- 配置文件 mmap + 不变;
- 静态 immutable 数据 集 (索引);

## 4. io_uring: ring-based async IO

io_uring 是 Linux 5.1+ 的"新一代 async IO" 接口. 用 ring buffer 可以批量 syscall 提交 + 完成, 不一个个进入 kernel.

```c
struct io_uring ring;
io_uring_queue_init(64, &ring, 0);

struct io_uring_sqe *sqe = io_uring_get_sqe(&ring);
io_uring_prep_read(sqe, fd, buf, len, 0);
io_uring_submit(&ring);

struct io_uring_cqe *cqe;
io_uring_wait_cqe(&ring, &cqe);
int n = cqe->res;
io_uring_cqe_seen(&ring, cqe);
```

io_uring 优势:
- 一组 submit + 一组 reap, 减少 syscall 次数;
- SQPOLL 模式 + kernel thread, 减少 kernel entry 0 次/entry;
- 支持 readv/writev/files/mmap/timer/network unified API.

**实测**: 
4 KB 随机读, 1 个 NVMe, 16 深度 io_uring ≈ 3.5× 比 epoll 取 thread-pool + O_NONBLOCK read.

**坑**: SQPOLL 模式如果你的业务 use 一段时间随手 exit, kernel thread 空耗 CPU; 用户 + kernel 数据竞争 metadata 处理要 referral.

## 5. 三种模式实测比较

测试 (1 TB Samsung 980 Pro NVMe, 4 KB randread, depth=32):

| 模式 | IOPS | 实际 CPU% |
|------|------|-----------|
| read + page cache + sync | 350k | 70% 用户态 |
| O_DIRECT + sync | 600k | 30% syscall, 70% user |
| O_DIRECT + libaio (aio_read) | 800k | 25% syscall, 75% user |
| O_DIRECT + io_uring native | 900k | 18% syscall, 82% user |
| O_DIRECT + io_uring SQPOLL | 1.05M | 5% syscall, 5% kernel thread, 90% user |

**io_uring SQPOLL + 0 syscall entry** —— 这是 Linux IO 现代性能革 ground.

## 6. 几个语言运行时态

| 语言 | IO 抽象 | 归os IO bottleneck |
|------|---------|----------------------|
| C / C++ | libc 调用 + Direct IO | 一切可控 |
| Rust | std::fs 调用 Direct IO + async 中 tokio IO_uring | tokio-uring crate |
| Go | netpoll + goroutine 中 read/write | Go runtime 手做 epoll 包 |
| Java NIO DirectBuffer | 堆外 alloc + blocking sendfile | Netty 最深 |
| Python | io_uring 自 3.12+ 试验 | asyncio + RuntimeError Liblet |

加提案中 io_uring 提案: Rust async-std / tokio 多线开 io_uring. Java Project Loom 自 z 21 该 behind epoll. 选型上是实际工程负担极其. 

## 7. io_uring 工程实战模式

```
例 1: KV server 用 io_uring SQPOLL + preadv 批量. 每 batch 提 64 sqe, 等 cqe
      暴增 server CPU utilization 出 ★ → 80% 用户态 syscall -> iouring enter 
      每 mmap SQ+SQE ring buffer = max 1 syscall/tick. 理论零 sysentry load.

例 2: AI training dataset IO IO_uring asynchronous random read = pipe line
     dataset loader, IO 与 GPU forward 重叠 + zero syscall back
     to text 把 bottleneck 转给 GPU.

例 3: nginx + QUIC + io_uring: 每 packet 一帧 nginx async butio_uring submit recv,
      优势响应 latency µs-level.
```

## 8. 这一章带走的东西

- 普通 read/write + page cache 是默认;
- O_DIRECT 绕 page cache, **数据库几乎互为标配**;
- mmap 灵活 + 跨进程共享但 P99 略 laggom;
- io_uring + SQPOLL 是现代 Linux GCP-like AI 新 IO base;
- 主流 runtime io_uring 适配差, 自己写 epoll 仍是常态.

下一节 → [WAL、fsync、崩溃一致性](crash-consistency.md)
