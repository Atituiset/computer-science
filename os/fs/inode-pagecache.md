# inode、dentry、page cache

## 一句话

你说 `cat /etc/passwd`，看似"打开一个文件然后读字节"。实际内核做了五层抽象:

```
路径 /etc/passwd
   ↓ (dentry 树解析)
inode 号 + fs 元信息
   ↓
磁盘 block 列表 (extent / direct / indirect)
   ↓
page cache (一次 page 4 KB)
   ↓
块层 + IO 调度
   ↓
NVMe 提交 queue → DRAM 落块
```

每层都是一个 cache, 每层都各有失效模式. 这一章把这套链路拆开, 让你看清 `open + read` 在 OS 内部到底是怎么发生的——同时也解释为什么 PostgreSQL / InnoDB / Rocks 这些系统都坚持自己再做一遍 IO 层.

## 1. dentry: 路径字符串看到的虚拟树

当你 `cat /etc/passwd` 内核要先做 **path resolution**:

```
/   →  根 dir inode 1
etc →  在根 dir 找 "etc" 这一项
       这一项指向下一层 dentry
passwd → 在 etc dir 找 "passwd" 这项
       拿到 final inode
```

每一层访问都是一次目录扫描 (实际是个 hash/遍历查找). preload 内存里维护 dentry cache (dcache), 命中即命中.

**dcache 是 OS 层 "路径 → inode" 的缓存**. 内核启动后大部分系统的 `/usr/bin` 等热目录可达 dcache 100% 命中.

## 2. inode: 一个文件的 metadata

inode 装着:

```
文件大小
所有者 + 权限
atime / mtime / ctime
文件数据 block 列表 (extent 或 direct + indirect)
文件类型 (regular / dir / link / device / FIFO)
```

**注意 inode 不带文件名**——文件名是它在父目录这条 dentry 的属性. 一份 inode 可被多个 dentry 指 (hardlink), 即一个文件可以多个文件名, 但 inode 本身唯一.

读 inode 也走过 VFS 层后到具体 fs, 在 ext4 上是 `ext4_inode` 结构, 字段 packed, 256 字节起步, 大文件可扩展.

## 3. extent vs indirect block: 怎么描述"一个文件的所有数据块"

历史方案是 BSD 早期用 **direct block + indirect block + double indirect + triple indirect**:

```
inode 前 12 个 block pointer 直接给前 12 × 4 KB = 48 KB;
第 13 个 pointer → 一块装 1024 pointer → 1024 × 4 = 4 MB;
第 14 个 pointer → 一块装 1024 个 pointer → 每 pointer 又指向装 1024 pointer 的块;
第 15 个 → 4 GB;
```

听起来文艺但不工程友好 —— 大文件一次访问多级寻址 + cache miss.

**现代文件系统改用 extent**: 一个 extent 直接表示 `[起始 block, 长度 L blocks]`. ext4 一个 inode 装内嵌 4 个 extent, 一个 extent 默认最大 32 KB (现代改进后 extent tree 可以扩展). XFS 用 B+ 树 extent.

extent 的好处:
- 顺序文件 metadata 极小 (1 GB 文件 = 一个 extent entry);
- 顺序 IO 友好 (磁盘一次 sequential read);
- 大文件碎片化 metadata 节省 cookie.

**这是 DSA 中 B+ 树 + 顺序物理化 在 OS 文件系统层的同构**.

## 4. page cache: 把"读过的页" 留在 DRAM

文件 IO 的真实路径不是 `read → disk`:

```
read(fd, buf, n)
   ↓
explicit_filemap_read → page cache 命中 →
   ↓                                ↓
命中就 memcpy 到 buf            miss →
                              submit_bio → 块层 / NVMe
                              data 拉进 page cache
                              再 memcpy 到 user buf
```

`read` 总是先看 page cache, `mmap` 是更高级别坐进 page cache 让用户空间零拷贝访问.

**page cache 是 OS 层的"通用 read cache"**, 对所有进程间共享——如果两个进程同时 cat 同一个文件, 同一个 page cache 被 reused.

## 5. dirty page 与 writeback

写路径:

```
write(fd, buf, n)
   ↓
page cache 上写 (与 read 反过来, 先看命中)
   ↓
mark dirty + 设置 dirty 标记位
   ↓
  pthread_async + writeback thread 慢慢 submit_bio 来刷盘
   ↓
disk 完成, 清 dirty 标记
```

`write` 在 99% 情况下不立刻写盘. 这是 OS 优化的核心: 把 write-burst 缓冲起来 + 顺序刷盘 + 由 IO 调度合并相邻 page.

但要持久化, 用户必须 `fsync(fd)` —— **强制把 dirty 同步刷盘并等 disk ACK**. fsync 之前的数据**可能在断电 / panic 中丢**, 这是 crash consistency 的核心题.

## 6. 文件 IO 怎么测性能

```bash
# 系统 cache 命中
time cat /etc/passwd > /dev/null          # 几百 μs

# 强制读盘 + Drop cache
echo 3 > /proc/sys/vm/drop_caches
time cat large_file > /dev/null           # 看盘速度

# 用 fio 做 raw benchmark
fio --name=test --filename=/tmp/a --rw=randread --bs=4k --size=1G --iodepth=8 --numjobs=8

# 看 page cache 占用大小
free -h
vmstat 1
```

## 7. 多语言 / 多运行时

| 语言 | 默认 IO 路径 | 优势 / 坑 |
|------|-------------|-----------|
| C `read/write` | 系统调用 + page cache | 取决于 fsync |
| Go `os.File.Read` | 同上 + goroutine 调度 不阻塞 GMP | `GOMAXPROCS` 满时阻塞会 M 扩 |
| Rust `File::read` | `libc` wrapper, 内 `read` | async 用 `tokio::fs` 走 epoll + thread pool |
| Java `InputStreamReader` | JVM 内 heap buffer + page cache | 双层 buffer 有时浪费 |
| Python `open().read` | C InputStreamReader 流式 buffer | 写大文件建议 `buffering` 调大 |

各语言 IO 接口都 wraps 系统 syscall, 抽象同一, 仅 syntactic 差异. **真正工程上 IO 性能差别主要看 cache 是否被正确使用 + fsync 频率**.

## 8. PG / InnoDB / Rocks 的"自己再写 IO"

主流数据库 (PG / MySQL / MongoDB / RocksDB) **绕过操作系统 page cache + 自己做缓存管理**:

- 内 buffer pool 是 OS page cache 的平行物, 但能精确控制 LRU + 大小 + writeback;
- 使用 `O_DIRECT` flag (下一章详谈) 让 IO 不进 page cache;
- 自己做 pread + WAL + checksum.

为什么? OS page cache 弱在**多线程 + 大内存 + 多 workload 共享机器时不可预期**. 自家 buffer pool 能控 : 哪个 thread 等谁、 cache hit 高 / 低、flush 时频率.

## 9. i_size + i_blocks / dense sparse file

inode 的 `i_sb` (super block) 信息中含 `i_blocks` (used blocks count, 1 block = 512B).  Linux `du -h` 用 `i_blocks × 512` 实际盘占用, 而 `ls -l` 用 `i_size` 逻辑大小. 这两者差距来自 sparse file 不一定真占用 block. mkfile 输出 50 GB sparse 文件 = 0 i_blocks, 但 i_size = 50 GB.

`fallocate --dig` 通过 fallocate syscall 让 fs 提前置位 extent 但不实际写入 0, 当 metadata-first allocator, 极适合"预占大文件 + 慢慢填充". 不预先 fallocate 大文件, 等 first write 时 fs 才动态分 extent, 在 high perf IO 场景上要 fallocate + O_DIRECT.

## 10. 这一章带走的东西

- `open + read` 实际穿五层 VFS/dentry/inode/page cache/block layer;
- extent 模型是 indirect block 的工程演进 (少 metadata + 友 cache);
- page cache 是不分进程共享的 read cache;
- write 默认仅写 page cache, fsync 才保证持久化;
- 数据库普遍走 O_DIRECT 绕 page cache, 自己实现 buffer pool.

下一节 → [ext4 / XFS / Btrfs 设计差异](filesystems.md)
