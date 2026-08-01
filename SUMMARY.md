# Summary

[前言](README.md)

---

# 导论卷 · 计算机基础知识体系

> 沿时间轴 (1936 → 2026) 与抽象层级 (晶体管 → AI 模型) 把全书 13 主题串起来的纵贯线, 让读者先在脑子里搭起一座"全景骨架", 再下钻各主题时不再"信息孤岛".

- [开篇: 这卷要做什么](prologue/README.md)
  - [1. 计算机发展史纵贯线: 1936 → 2026](prologue/history.md)
  - [2. 抽象层级: 从晶体管到 AI 模型的十层金字塔](prologue/abstraction-layers.md)
  - [3. 形态演进: 大型机 → PC → 单片机/ARM → 云 → Web → AI → XPU](prologue/mainframe-xpu.md)
  - [4. 主干纵贯: CPU/内存 → OS/Linux → 网络/Web → DB → 编译 → 分布式 → AI 的承接链](prologue/standing-on-shoulders.md)
  - [5. 全书地图: 13 部分与导论的交叉索引](prologue/map.md)

---

# 第零部分 · 工程数学与离散数学基础

> 把后面十三部分反复出现的同一组数学抽到一处讲透: 离散结构 + 线性代数 + 概率统计 + 微积分/优化. 让后续读 DSA / OS / DB / Compiler / Crypto / 信息论 / Transformer 时, 数学不再是被卡的那一关.

- [开篇: 工程数学 + 离散数学为什么放最前](math/README.md)
  - [1. 离散数学: 逻辑 / 集合 / 关系 / 图 / 组合 / 递推 / 代数结构](math/discrete.md)
  - [2. 线性代数: 向量空间 / 矩阵 / 谱 / SVD / 张量](math/linalg.md)
  - [3. 概率统计: 分布 / 贝叶斯 / MLE / MAP / 极限 / KL](math/prob.md)
  - [4. 微积分与最优化: 链式法则 / 雅可比 / Hessian / 凸优化 / 信息几何](math/calc-opt.md)

---

# 工程化实践轴 · 让代码真正跑进生产

> 与 14 部分"计算机原理"互补的手艺轴：Git 版本控制 / 测试工程 / CI-CD 发布 / 性能工程 / 应用安全 / 代码质量 / 可观测性。定位是"1-20 年工程师把基础落地到生产"。

- [开篇: 工程化 = 让代码跑进生产的手艺](engineering/README.md)
  - [1. Git 与版本控制: 原理 / 分支模型 / 合并策略 / 进阶命令](engineering/git-workflow.md)
  - [2. 测试工程: 测试金字塔 / 单元/集成/契约/E2E / mock / flaky 治理](engineering/testing.md)
  - [3. CI/CD 与发布工程: 管线 / 镜像 / 蓝绿金丝雀 / IaC](engineering/cicd-devops.md)
  - [4. 性能工程: profiling / 火焰图 / 缓存与批处理方法论](engineering/performance-engineering.md)
  - [5. 应用安全: OWASP Top 10 / 认证授权 / 数据安全 / 供应链](engineering/app-security.md)
  - [6. 代码质量: 重构 / code review / 复杂度治理 / DDD 落地](engineering/code-quality.md)
  - [7. 可观测性实操: metrics/logs/traces 打点 / OpenTelemetry / SLO](engineering/observability-practice.md)
  - [8. GitHub Actions 实战: workflow / expression / 缓存 / 矩阵 / reusable / 自托管](engineering/gh-actions-deepdive.md)
  - [9. 云原生发布与 GitOps: K8s 应用 / Helm / ArgoCD / Flux / 服务网格](engineering/gitops-k8s.md)
  - [10. SRE 工程: 错误预算 / 容量 / 变更 / 事件响应 / 生产就绪](engineering/sre-engineering.md)

---

# 第一部分 · 数据结构与算法（DSA）

- [开篇：为什么从头学 DSA](dsa/README.md)
- [复杂度分析](dsa/algorithms/complexity.md)
  - [渐进记号的真实含义](dsa/algorithms/complexity/notation.md)
  - [摊还分析入门](dsa/algorithms/complexity/amortized.md)
  - [实战：复杂度反推设计](dsa/algorithms/complexity/practice.md)
- [基本数据结构](dsa/structures/README.md)
  - [数组与动态数组](dsa/structures/array.md)
  - [链表：单链/双链/跳表](dsa/structures/linked-list.md)
  - [栈与队列](dsa/structures/stack-queue.md)
  - [哈希表：从原理到工程](dsa/structures/hash-table.md)
- [树结构](dsa/structures/trees/README.md)
  - [二叉搜索树与平衡](dsa/structures/trees/bst.md)
  - [AVL 与红黑树](dsa/structures/trees/avl-rbt.md)
  - [B 树与 B+ 树](dsa/structures/trees/btree.md)
  - [堆与优先队列](dsa/structures/trees/heap.md)
  - [字典树与并查集](dsa/structures/trees/trie-union.md)
- [图](dsa/structures/graphs/README.md)
  - [图的表示与遍历](dsa/structures/graphs/representation.md)
  - [最短路径：Dijkstra / Bellman-Ford / Floyd](dsa/structures/graphs/shortest-path.md)
  - [最小生成树：Kruskal / Prim](dsa/structures/graphs/mst.md)
  - [拓扑排序与强连通分量](dsa/structures/graphs/topo-scc.md)
  - [网络流入门](dsa/structures/graphs/flow.md)
- [算法设计范式](dsa/algorithms/README.md)
  - [分治](dsa/algorithms/divide-conquer.md)
  - [贪心](dsa/algorithms/greedy.md)
  - [动态规划](dsa/algorithms/dp.md)
  - [回溯与剪枝](dsa/algorithms/backtracking.md)
  - [分支限界](dsa/algorithms/branch-bound.md)
- [经典算法专题](dsa/topics/README.md)
  - [排序：从朴素到极致](dsa/topics/sorting.md)
  - [搜索：二分与三分](dsa/topics/searching.md)
  - [字符串：KMP / Rabin-Karp / Z / AC 自动机](dsa/topics/string.md)
  - [数论与模运算](dsa/topics/number-theory.md)
- [附录](dsa/appendix/README.md)
  - [Snippets](dsa/appendix/snippets.md)
  - [LeetCode 刷题路线](dsa/appendix/leetcode-roadmap.md)

---

# 第二部分 · 操作系统

- [开篇：操作系统到底在帮你做什么](os/README.md)
- [内存](os/memory/README.md)
  - [虚拟内存与地址翻译](os/memory/virtual-memory.md)
  - [分页、TLB、Huge Page](os/memory/tlb-hugepage.md)
  - [页面置换与 working set](os/memory/replacement.md)
  - [内存分配器：ptmalloc/jemalloc/tcmalloc/mimalloc](os/memory/allocator.md)
  - [NUMA 与 CXL 内存池](os/memory/numa.md)
- [文件系统](os/fs/README.md)
  - [inode、dentry、page cache](os/fs/inode-pagecache.md)
  - [ext4 / XFS / Btrfs 设计差异](os/fs/filesystems.md)
  - [Direct IO、mmap、io_uring](os/fs/io-modes.md)
  - [WAL、fsync、崩溃一致性](os/fs/crash-consistency.md)
- [进程与线程调度](os/sched/README.md)
  - [Linux CFS 调度器](os/sched/cfs.md)
  - [实时调度：SCHED_FIFO / RR / EDF](os/sched/rt.md)
  - [goroutine GMP 模型](os/sched/gmp.md)
  - [Cgroup v2、CPU 迁移与亲和](os/sched/cgroup.md)
- [锁与同步原语](os/lock/README.md)
  - [futex、CAS、spinlock 内部](os/lock/futex-cas.md)
  - [RCU、seqlock、brlock](os/lock/rcu.md)
  - [内存模型与 memory barrier](os/lock/memory-barrier.md)
  - [lock-free/wait-free 数据结构](os/lock/lockfree.md)
- [虚拟化与容器: VM / KVM / namespaces / gVisor](os/virtualization.md)
- [IO 与网络栈](os/net/README.md)
  - [epoll / kqueue / io_uring 对比](os/net/epoll-iouring.md)
  - [Zero copy：sendfile / splice / MSG_ZEROCOPY](os/net/zero-copy.md)
  - [TCP/IP 内核栈与 NAPI](os/net/kernel-tcp.md)
  - [XDP、DPDK 与 kernel bypass](os/net/xdp-dpdk.md)

---

# 第三部分 · 计算机网络

- [开篇：为什么协议要分层](networking/README.md)
- [物理层 / 数据链路层](networking/phy/README.md)
  - [以太网帧、CSMA/CD、PHY/MAC](networking/phy/ethernet.md)
  - [光纤、波分复用、机房布线](networking/phy/optical.md)
- [IP / 路由](networking/ip/README.md)
  - [IPv4 / IPv6 / ICMP](networking/ip/ipv6.md)
  - [DHCP / ARP / NDP](networking/ip/arp-dhcp.md)
  - [BGP / OSPF 路由](networking/ip/bgp-ospf.md)
  - [NAT 与 conntrack](networking/ip/nat.md)
  - [DNS: 名字解析 / 缓存 / CDN 调度 / DNSSEC](networking/ip/dns.md)
- [TCP/UDP](networking/tcp/README.md)
  - [三次握手 / 四次挥手 / TIME_WAIT](networking/tcp/handshake.md)
  - [拥塞控制：Reno / Cubic / BBR](networking/tcp/congestion.md)
  - [重传、SACK、RTO/RTT 估计](networking/tcp/retransmission.md)
- [HTTP / TLS](networking/http/README.md)
  - [HTTP 1.0 → 1.1 → 2 → 3](networking/http/versions.md)
  - [HTTPS / TLS 1.3 握手与 0-RTT](networking/http/tls.md)
  - [证书链 / PKI / OCSP stapling](networking/http/pki.md)
  - [gRPC / Protobuf / Thrift](networking/http/rpc.md)
- [QUIC](networking/quic/README.md)
  - [QUIC over UDP：解决什么](networking/quic/overview.md)
  - [0-RTT / 连接迁移](networking/quic/0rtt.md)
  - [BBR 在 QUIC 下的表现](networking/quic/bbr.md)

---

# 第四部分 · 数据库系统

- [开篇：数据库在解决什么](databases/README.md)
- [SQL 与关系模型](databases/relational/README.md)
  - [关系代数、SQL semantics](databases/relational/relational.md)
  - [事务、ACID、隔离级别与现象](databases/relational/isolation.md)
  - [MVCC 原理：PostgreSQL vs InnoDB](databases/relational/mvcc.md)
  - [WAL / redo / undo / 2PL](databases/relational/wal-2pl.md)
- [索引与存储结构](databases/indexing/README.md)
  - [B+ 树索引与覆盖索引](databases/indexing/btree.md)
  - [LSM-Tree 与 SSTable](databases/indexing/lsm.md)
  - [Hash index、GIN、GiST、BRIN](databases/indexing/specialized.md)
  - [倒排索引与全文检索: Lucene / BM25 / Elasticsearch](databases/indexing/inverted-index.md)
  - [执行计划：explain analyze 怎么读](databases/indexing/explain.md)
- [日志与崩溃恢复](databases/recovery/README.md)
  - [WAL 协议、ARIES](databases/recovery/aries.md)
  - [Checkpoint、Point-in-time 恢复](databases/recovery/checkpoint.md)
- [查询优化](databases/optimization/README.md)
  - [基于规则 / 基于代价优化](databases/optimization/rbo-cbo.md)
  - [Join 顺序、hash join vs nested loop](databases/optimization/join.md)
  - [向量化执行、列存](databases/optimization/vectorized.md)
- [OLAP 与现代数据栈](databases/olap/README.md)
  - [ClickHouse / DuckDB / Snowflake 设计](databases/olap/columnar.md)
  - [预聚合、物化视图、Cubes](databases/olap/materialized.md)
  - [Lakehouse：Iceberg / Delta / Hudi](databases/olap/lakehouse.md)

---

# 第五部分 · 编译原理

- [开篇：编译器是软件里最挑战的工程](compilers/README.md)
- [词法分析](compilers/lexer/README.md)
  - [正则 → NFA → DFA / 表驱动词法](compilers/lexer/dfa.md)
  - [Unicode、字符集、错误恢复](compilers/lexer/unicode.md)
- [语法分析](compilers/parser/README.md)
  - [递归下降 / 算符优先 / Pratt](compilers/parser/recursive-descent.md)
  - [LR/LALR/SLR/yacc/bison](compilers/parser/lr.md)
  - [GLR、PEG、packrat](compilers/parser/glr-peg.md)
- [语义分析与中间表示](compilers/sema/README.md)
  - [类型系统、类型推断、HM 类型系](compilers/sema/type-system.md)
  - [SSA / CFG /支配树 / dom tree](compilers/sema/ssa.md)
- [优化](compilers/opt/README.md)
  - [常量折叠、复写传播、死代码消除](compilers/opt/basic.md)
  - [循环优化、向量化、strength reduction](compilers/opt/loop.md)
  - [Inline / IPA / escape analysis](compilers/opt/inline.md)
- [后端：codegen 与机器模型](compilers/codegen/README.md)
  - [寄存器分配：线性扫描 vs graph coloring](compilers/codegen/regalloc.md)
  - [LLVM / cranelift 设计](compilers/codegen/llvm.md)
  - [JIT / tiered compilation / V8 / JVM](compilers/codegen/jit.md)

---

# 第六部分 · 分布式系统

- [开篇：分布式 = 让 N 台机器表现得像 1 台](distributed/README.md)
- [基础概念](distributed/concepts/README.md)
  - [CAP / PACELC / BASE](distributed/concepts/cap.md)
  - [一致性、线性化与序](distributed/concepts/ordering.md)
  - [故障检测、failure models](distributed/concepts/failure.md)
- [共识](distributed/consensus/README.md)
  - [Paxos / Multi-Paxos](distributed/consensus/paxos.md)
  - [Raft 详解](distributed/consensus/raft.md)
  - [ZooKeeper / etcd / Linearizability](distributed/consensus/linearizability.md)
- [复制](distributed/replication/README.md)
  - [主从 / 多主 / 无主复制](distributed/replication/topologies.md)
  - [CRDT：无冲突数据类型](distributed/replication/crdt.md)
  - [读修复 / 反熵 / hinted handoff](distributed/replication/repair.md)
- [分布式事务: 2PC / Saga / TCC / Outbox / Spanner](distributed/transactions.md)
- [时钟与顺序](distributed/clock/README.md)
  - [逻辑时钟、向量时钟、HLC](distributed/clock/logical.md)
  - [TrueTime / HLC / attestation](distributed/clock/physical.md)
  - [DAG、git、blockchain 的序](distributed/clock/dag.md)
- [分布式存储与容错](distributed/fault/README.md)
  - [Quorum / W+R>N / Read Repair](distributed/fault/quorum.md)
  - [Erasure coding / Reed-Solomon](distributed/fault/erasure.md)
  - [Borg / Kubernetes / Mesos 调度](distributed/fault/scheduling.md)

---

# 第七部分 · 系统设计

- [开篇：系统设计的不是"答案"，是"分解"](system-design/README.md)
- [估算与负载分析](system-design/estimation/README.md)
  - [Back-of-envelope：QPS / 带宽 / 存储 / IOPS](system-design/estimation/back-of-envelope.md)
  - [Little's Law、利用率模型](system-design/estimation/littles-law.md)
  - [真实负载来源：幂律、长尾、突发](system-design/estimation/load-patterns.md)
- [存储选型](system-design/storage/README.md)
  - [KV / 文档 / 关系 / 时序 / 向量 库选择树](system-design/storage/which-store.md)
  - [分片、分区、热点重分布](system-design/storage/sharding.md)
  - [WAL / LSM / B+ 三类存储层的取舍](system-design/storage/wal-lsm-btree.md)
- [缓存设计](system-design/cache/README.md)
  - [Cache-aside / Read-through / Write-through](system-design/cache/patterns.md)
  - [穿透 / 击穿 / 雪崩 与解决方案](system-design/cache/failure-modes.md)
  - [多级缓存 / Caffeine / Nginx cache](system-design/cache/multilevel.md)
- [消息队列与异步](system-design/queue/README.md)
  - [Kafka / Pulsar / RocketMQ 设计](system-design/queue/kafka.md)
  - [At-least-once / exactly-once / at-most-once](system-design/queue/semantics.md)
  - [Outbox pattern / Transactional Outbox](system-design/queue/outbox.md)
- [扩容与高可用](system-design/scale/README.md)
  - [分片 / 复制 / partition tolerance](system-design/scale/sharding-replication.md)
  - [限流 / 熔断 / 降级 / 隔离舱](system-design/scale/resilience.md)
  - [Multi-region / Active-Active 设计](system-design/scale/multi-region.md)
- [可观测性](system-design/monitor/README.md)
  - [Metrics / Logs / Traces 三位一体](system-design/monitor/pillars.md)
  - [Prometheus / OpenTelemetry / eBPF](system-design/monitor/stack.md)
  - [SLO / SLI / Error Budget](system-design/monitor/slo.md)
- [经典架构案例](system-design/case/README.md)
  - [Twitter Snowflake](system-design/case/snowflake.md)
  - [Google MapReduce / BigTable / GFS](system-design/case/google-trio.md)
  - [Dynamo / Cassandra / Redis Cluster](system-design/case/dynamo-family.md)
  - [Kubernetes 控制平面](system-design/case/k8s-control-plane.md)

---

# 第八部分 · 计算机组成原理

- [开篇：从晶体管到云，硬件如何塑造软件](computer-arch/README.md)
- [CPU 流水线与指令级并行](computer-arch/cpu-pipeline.md)
- [超标量 / OoO / Tomasulo](computer-arch/cpu-superscalar.md)
- [存储层次：Cache / DRAM / HBM](computer-arch/memory-hierarchy.md)
- [MMU / TLB / DMA / IOMMU](computer-arch/mmu-dma.md)
- [GPU 架构：SM / CUDA Core / Tensor Core](computer-arch/gpu-architecture.md)
- [AI 加速器：TPU / NPU / FPGA](computer-arch/ai-accelerators.md)
- [总线与互联：PCIe / CXL / NVLink / RDMA](computer-arch/interconnects.md)
- [存储硬件: NAND Flash / SSD FTL / 写入放大 / NVMe](computer-arch/ssd-storage.md)
- [指令集架构：x86 / ARM / RISC-V](computer-arch/isa-design.md)

---

# 第九部分 · 计算理论（Formal Languages / Automata / Complexity）

> 把"可计算"形式化为 DFA / PDA / TM / 图灵机，并封顶"可高效计算"为 P/NP/PSPACE 等复杂度类。

- [开篇：从正则到不可判定，计算的四级爬升](theory/README.md)
- [1. 自动机：DFA → NFA → ε-NFA → 子集构造 → DFA 最小化](theory/automata.md)
- [2. 正则语言与泵引理](theory/regular.md)
- [3. 下推自动机（PDA）与上下文无关文法（CFG）](theory/cfg-pda.md)
- [4. 图灵机：deterministic / non-deterministic / Church-Turing](theory/turing-machine.md)
- [5. 不可判定性：停机问题、Rice 定理](theory/undecidability.md)
- [6. Complexity classes：P / NP / NPC / co-NP / PSPACE](theory/complexity.md)
- [7. Polynomial-time reduction：3-SAT → Clique → Vertex Cover](theory/reductions.md)
- [8. Approximation algorithms、hardness of approximation](theory/approximation.md)
- [附录：常见判定问题分类速查表](theory/appendix.md)

---

# 第十部分 · 密码学与安全

> 把对抗 NPC 难度的难度转移为协议设计目标：AES / RSA / ECDHE / TLS 1.3 / ZKP 全栈。

- [开篇：从凯撒密码到 TLS 1.3](crypto/README.md)
- [1. 对称加密: AES 与 ChaCha20](crypto/symmetric.md)
- [2. 操作模式: ECB / CBC / CTR / GCM (AEAD) 与 nonce-reuse 灾难](crypto/modes.md)
- [3. 非对称加密: RSA 与 ECC](crypto/asymmetric.md)
- [4. 密钥交换: DH / ECDHE / X25519](crypto/key-exchange.md)
- [5. 数字签名: RSA-PSS / ECDSA / Ed25519](crypto/signatures.md)
- [6. 哈希: SHA-256 / SHA-3 / BLAKE3 / 抗碰撞史](crypto/hashes.md)
- [7. TLS 1.3 握手全流程](crypto/tls13.md)
- [8. 证书链: X.509 / PKI / Certificate Transparency / OCSP](crypto/pki.md)
- [9. ZKP 入门: zk-SNARKs / zk-STARKs / Bulletproofs](crypto/zkp.md)
- [10. 侧信道攻击: timing / power analysis / Spectre / Meltdown](crypto/sidechannel.md)
- [11. 安全最佳实践: constant-time / nonce 不重用 / 密钥轮转](crypto/best-practices.md)
- [附录: 密码学考试 / 工程 checklist](crypto/appendix.md)

---

# 第十一部分 · 信息论与编码

> Shannon 1948 一锤定音：信息熵设压缩下界、信道容量设通信上界、纠错码逼近两者之间。

- [开篇：从 Shannon 1948 到 5G NR 编解码设计](info-theory/README.md)
- [1. Shannon Entropy: 离散源熵 / 联合熵 / 条件熵 / 互信息](info-theory/entropy.md)
- [2. 信道容量: 香农公式 C = B · log₂(1 + SNR)](info-theory/capacity.md)
- [3. 无损压缩: 哈夫曼 / LZ77 / LZ78 / zstd / 算术编码 / ANS](info-theory/compression.md)
- [4. 汉明码: 可纠 1-bit 错误的鼻祖](info-theory/hamming.md)
- [5. Reed-Solomon 在 GF(2⁸) 上的纠错码](info-theory/reed-solomon.md)
- [6. BCH 码、循环码与多项式基础](info-theory/bch.md)
- [7. LDPC 码: 5G NR 数据信道与 Tanner 图](info-theory/ldpc.md)
- [8. Polar 码: Arikan 2008 构造与 5G NR 控制信道](info-theory/polar.md)
- [9. Turbo 码: 3G/4G 并行级联卷积码与 BCJR 迭代](info-theory/turbo.md)
- [10. 调制: QPSK / 16-QAM / 64-QAM 星座图与误码率](info-theory/modulation.md)
- [附录: 编码率 / 纠错能力 / SNR 实践速查](info-theory/appendix.md)

---

# 第十二部分 · 人工智能与机器学习

> 把分散在第零部分数学、第八部分 GPU/AI 加速器、第十一部分信息论 KL/熵的"积木"，在 ML 这一处集大成。数学预备已在第零部分就位，本部分直接引用。

- [开篇：从线性回归到 Transformer 的 70 年](ai-ml/README.md)
- [1. Foundations: 线性回归 → 逻辑回归 → MLP → 损失函数谱 → 泛化与正则](ai-ml/foundations.md)
- [2. Backpropagation: 计算图 / 反向模式 AD / 雅可比链式 / 梯度检查](ai-ml/backprop.md)
- [3. Transformer: self-attention / MHA / FFN / LayerNorm / 残差 / Encoder-Decoder / 训练损失](ai-ml/transformer.md)
- [4. Optimizers & Training Dynamics: Adam/AdamW/二阶 + 初始化/LayerNorm/warmup/checkpoint](ai-ml/optimizers.md)
- [5. Generative Models: VAE & ELBO / 扩散模型 / AR 采样 / speculative decoding](ai-ml/generative.md)
- [6. 经典机器学习与树模型: 决策树 / GBDT / XGBoost / SVM](ai-ml/classical-ml.md)
- [7. Tokenizer 与 Embedding: BPE / WordPiece / SentencePiece / 位置编码](ai-ml/tokenizer.md)
- [8. 强化学习与 RLHF: MDP / Bellman / Q-learning / Policy Gradient / PPO / RLHF](ai-ml/rl.md)
- [9. 大模型训练工程: DP/PP/TP/ZeRO/FSDP/Checkpoint](ai-ml/training-at-scale.md)
- [10. 表示学习与对比学习: SimCLR / CLIP / InfoNCE](ai-ml/contrastive-learning.md)
- [11. LLM Agent: Tool Use / ReAct / Plan-Execute / Multi-Agent / Memory](ai-ml/agents.md)
- [12. 多模态: 跨注意力 / Flamingo / LLaVA / BLIP-2 / 扩散多模态](ai-ml/multimodal.md)
- [13. LLM 推理与部署: KV Cache / PagedAttention / 连续批处理 / 量化](ai-ml/llm-inference.md)

---

# 第十三部分 · 元抽象：跨章节大主题

> 把前面十二部分反复出现的概念，往上一层抽出来做横向对比。每篇都假设你已经读完前面的具体章节。

- [开篇：为什么要再抽一层](_meta/README.md)
- [1. 顺序 vs 链接：CPU 视角下两种物理化](_meta/contiguous-vs-linked.md)
- [2. 摊还 vs 最坏：工程常数与硬实时的张力](_meta/amortized-vs-worst.md)
- [3. 分治 vs 贪心 vs DP：什么是"最优子问题分解"](_meta/decomposition-strategies.md)
- [4. 缓存层级：从 L1 到 HBM 到 RDMA 的同构](_meta/memory-hierarchy.md)
- [5. 编程语言运行时：四种实现语义](_meta/runtime-semantics.md)
- [6. 并发与一致性：单机到分布式同构](_meta/concurrency-consistency.md)
- [7. 推理链：硬件层如何决定软件设计](_meta/hardware-shapes-software.md)

---

# 形式化方法卷 · 用数学证明"系统是对的"

> 测试能证明有 bug, 但永远不能证明没 bug。模型检查穷举状态空间, 定理证明验证数学证明, 程序验证把证明连到真实代码——Raft 有 TLA+、CompCert 用 Coq、seL4 被 Isabelle 证明。

- [开篇: 用数学证明"系统是对的"](formal/README.md)
  - [1. 模型检查与 TLA+: 穷举状态空间找反例](formal/model-checking-tla.md)
  - [2. 定理证明: Coq / Lean / 依赖类型 / Curry-Howard](formal/coq-lean.md)
  - [3. 程序验证: Hoare 逻辑 / 符号执行 / 形式语义](formal/program-verification.md)

---

# 量子计算卷 · 用量子比特重新定义"计算"

> 量子比特叠加 + 纠缠带来对特定问题的指数/平方加速。基础 (Dirac 记号 / 门 / 测量) → 算法 (Deutsch-Jozsa / Grover / Shor) → 纠错 (surface code / 逻辑 qubit) 一路讲透, 并给出现实的 Y2Q 判断。

- [开篇: 用量子比特重新定义"计算"](quantum/README.md)
  - [1. 量子计算基础: Dirac 记号 / qubit / 量子门 / 测量](quantum/basics.md)
  - [2. 量子算法: Deutsch-Jozsa / Grover / Shor](quantum/algorithms.md)
  - [3. 量子纠错: 逻辑 qubit / surface code / 现实挑战](quantum/error-correction.md)

---

[TODO / 待补充模块](TODO.md)
