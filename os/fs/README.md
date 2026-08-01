# 文件系统

## 一句话

文件系统是工程上**最悠久也是最有 trade off 张力**的 OS 子系统：磁盘带宽、崩溃一致性、scan 性能、删除代价、小文件 metadata 爆炸、与 page cache 协同——每个点都引出一整套工程历史. 这一节带你把 ext4 / XFS / Btrfs 的设计差异看清，并把 mmap / Direct IO / io_uring 这三个"IO 模式"从一个 syscall 调用拆到硬件层.

- [inode、dentry、page cache](inode-pagecache.md)
- [ext4 / XFS / Btrfs 设计差异](filesystems.md)
- [Direct IO、mmap、io_uring](io-modes.md)
- [WAL、fsync、崩溃一致性](crash-consistency.md)
