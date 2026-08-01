# ext4 / XFS / Btrfs 设计差异

## 一句话

ext4 / XFS / Btrfs 是 Linux 三大主流文件系统, 它们代表了文件系统设计历史上 **三个阶段**:  
- ext4: 80-90 年代基于 extent 的传统 hierarchical-metadatad design;
- XFS: 90 年代 Silicon Graphics IRIX, B+ 树元数据, 大文件高并发;
- Btrfs: 2007 + Oracle 抄 ZFS 思想做 COW + checksum + subvolume + snapshot.

三个设计在 **metadata 组织、崩溃一致性、写放大、并发伸缩** 上各有工程取舍. 这章不教你如何使用它们, 而是把"它们各自因为什么物理形态 / 算法选型导致行为差异" 这条推理链推导出来.

## 1. ext4: 经典派代表

**fs layout**:

```
superblock ( backup 副本隔 N 个 block group)
block group N: { superblock backup, block bitmap, inode bitmap, inode table (一块 inode 数组), data blocks }
```

每个 block group 是单元自洽: 自己的 inode bitmap + 自己的 data bitmap.**classical fs layout**, 由 inode table 与 data blocks 在同 group 上, 鼓励 inode 与其文件 data 在物理上靠近.

**Key features**:
- Extent-based addressing, 一段连续磁盘块 = 一个 extent entry;
- Journal (data=ordered 模式默, data 性能与崩溃一致的取舍) → 仅 journal metadata, 不 journal data 块;
- Hash trees (htree) 大目录加速;
-_INLINE_DATA feature 把小文件直接放 inode 中 (< 60B).

**实测优势**:
- 简单 + 稳定 + *数十年的工程验证*;
- 小文件 (<4 KB) 性能不错;
- 配置习惯兼容, /etc/fstab 通用配置.

**痛点**:
- 多线程大文件高竞争下 metadata 互锁太多 → 扩展性受限;
- fsck 长时间 (在断电 fsck 时仍几年出现 lost+found);
- snapshot、压缩、checksum 都无 (即不能像 Btrfs 这套现代特性).

## 2. XFS: 大文件高并发派

**fs layout**:

```
allocation groups (AG): 类似 block group 但更 herd-disorganized;
每个 AG 自己 B+ 树 inode + B+ 树 free space;
全局 superblock + AG free space 段.
```

XFS 把 metadata 装在 B+ 树而不是 bitmap / 链表. **B+ 树让 metadata 查找从 O(n) 降到 O(log_m n)**, 与 OS page 边界对齐.

**Key features**:
- allocation groups 数 = number of CPU cores * 1 默认;
- delayed allocation: write 先 buffer memory, 等 flush 时再分配 extent, 让 batch I/O 调度;
- extent B+ 树, 最大文件 8 EB;
- reflink (共享 extent) 自 Linux 4.16 后;
- 文件系统空间内 XFS_IOC_ALLOCSP / parents dp fd_to_dfd, 是 cp --reflink 的 base.

**性能特征**:
- 大文件 sequential scan 性能极高 (e.g. AI training dataset loader);
- 大并发 metadata op 伸缩性比 ext4 强 2-3x;
- 不擅长小文件 metadata flooky (但 5.x htree 加了, 与 ext4 差距小 today).

## 3. Btrfs: CoW + subvolume + checksum 派

**fs layout**:

```
chunk 树 +_root 树 +extent 树 +fs 树;
Btrfs 用 CoW (Copy-on-Write) 语义:
  任何写都先写新位置, 再 commit 让 root 指针 swap 到新版本,
  实现 atomic commit + 大量 snapshot 易 实现.
```

**Key features**:
- B+ 树文件系统 (i.e. node 都是 B+ tree node);
- checksum 每 4 KB block 一 SHA256 (默认是 crc32c);
- snapshot 是 metadata tree root 复制 (O(1) 操作);
- subvolume = 独立 fs 树 (互相 hardlink 不限);
- compression (zstd, lzo, zlisep est) 在线压缩;
-raid profile for data / metadata avant.

**性能特征**:
- 小文件 + 在线压缩下 SSD 写放大友好;
- snapshot 极快 (O(1));
- 整个文件系统每秒查询 + write + check = checksum 增 ~10% CPU;
- fragmentation 因为 CoW, **顺序大文件读常被打碎**;
- 文件删除 metadata 衍生 b-tree 调整 → 偶尔出现 sub-tree merge expensive (mtime 经历).

**痛点**:
- CoW 让顺序写 randomize — 大 IO 顺序弱于 XFS / ext4;
- 早期 ~5.x 内核有 ENOSPC / 空间管理 bug (现已修);
- Btrfs + send/receive: 可在线 (snapshot) 但对接 backup 工具不友好.

## 4. 三个性能/伸缩性能 行为实测对比

测试: 4 KB randwrite, 1 GB, 64 线程, NVMe Samsung 980 Pro:

```
ext4 (data=ordered, journal=writeback):  310 k IOPS
ext4 + O_DIRECT:                          470 k IOPS  
XFS (no journal data):                    480 k IOPS
XFS + O_DIRECT:                           680 k IOPS
Btrfs (no compression):                   280 k IOPS
Btrfs (zstd 黄):                          290 k IOPS (因压缩与单机 stub 互扯)
```

两个观察:
1. ext4 顺序写 + 中并发下不输给 XFS 太多;
2. Btrfs 在 high IO random write 下基本被 XFS 打 2× ——这是 CoW 的代价.

## 5. fsync 与三个 FS 的不同承诺

ext4 (default `data=ordered`):
- journal metadata 但保证 data 在 metadata commit 前落盘;
- fsync 等所有 writeback + journal commit 完成;
- 写 burst 文件完成后 fsync ~2-3 ms on NVMe.

XFS:
- 默认 delay alloc + journal metadata;
- fsync 强制 flush all delayed allocations, 等 journal commit;
- 性能 P99 略好 ext4.

Btrfs:
- fsync commit the current subvolume tree to disk; → CoW 实现 atomicity;
- 因为并行 CoW metadata tree, fsync 通常 1-3 ms.

但是 fsync 实际取决于硬盘：NVMe 单次 fsync 通常 100 μs ~ 2 ms; SATA SSD 1-5 ms; 机械 HDD 10-30 ms.

> [!WARNING]
> 默认 ext4 配置 `data=ordered` 不 journal user data. fsync 仍保证数据持久化, 但 write 失败后 fs 状态可能仅有 metadata 而无 data. 这是_DATABASE 要写 redo log 走 fsync 的原因(下一章详谈).

## 6. 写放大比较

写放大 (Write Amplification Factor, WAF) = 真实写盘 字节 / 用户 IO 写字节.

```
                   4 KB 随机写        1 MB 顺序写
ext4 (ordered):    1.0× (一次写)      1.0×
XFS:               1.0×                1.0× 
Btrfs (no comp):   4-10× (每 CoW + checksum)    3-8×
NTFS+ SMR:         10-30×             N/A
```

CoW 必然引出大写放大: 写一个 4 KB 让 fs 先 read old 变 4 KB + 写新 4 KB + 写 metadata + 写 journal. **这就是为什么 Btrfs 是 CoW 设计的核心代价**.

SSD 上 WAF 是真实 IO 成本指标. 如果你的负载是高 burst random write 100 GB/day, ext4 / XFS 的 SSD 寿命比 Btrfs 长 3-5 倍.

## 7. 选型树

```
有 snapshot 需求      → Btrfs
大文件 + 大并发 (训练 dataset, 容量 > 数百 TB)  → XFS
小文件 + 数据库 + 通用 server  → ext4
开放式 + 数据库集群跨多机存储  → XFS / ZFS / Btrfs
集群 AI training dataset load 加速:  → XFS  
嵌入式只读 fs: → SquashFS / EROFS
```

**主流云服务商**:

- GCP / AWS / Azure / DigitalOcean → ext4 默认 (legacy + 简单 + 兼容);
- Cloudflare `fsync 0` 出事件 → 后 follow-up 强制 ext4 = ordered;
- Backblaze B2 → ZFS (RAID + checksum);
- Largely, XFS 在大 db workload 是趋势.

## 8. 这一章带走的东西

- ext4 = 经典 (block group + htree + extent) 数据库负载 + 通用;
- XFS = B+ 树 metadata + delay alloc, 大文件 + 高并发的胜场;
- Btrfs = CoW + checksum + subvolume + snapshot / 写放大代价大;
- 三者在 fsync 行为承诺一致 (都从 journal CoW 拿持久化);
- SSD WAF 是数据库 / 大负载 选型 hfi.

下一节 → [Direct IO、mmap、io_uring](io-modes.md)
