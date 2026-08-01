# 4. 主干纵贯: CPU/内存 → OS/Linux → 网络/Web → DB → 编译 → 分布式 → AI 的承接链

## TL;DR

前面 [history](history.md) 讲时间线、[abstraction-layers](abstraction-layers.md) 讲层级、[mainframe-xpu](mainframe-xpu.md) 讲形态. 这一节反过来 — **沿"承接链"反向**回到纵贯主线: 每条技术都因"上层拿它做啥"才有意义, 每条新技术大概率是对上层需求的回响.

**承接链** (dependency-of-statements):

```
物理 → 晶体管 → 数字 → ISA → 微架构 → 内存 → OS → 进程 / 虚存
                                            ↓
          → 文件系统 → 网络 → Web → 数据库 → 应用 → 业务
                  ↘
                   → 编译器 → 高级语言 → 框架
                                              ↘
                                               → 分布式 → 共识 → 一致性 → 云
                                                                   ↓
                                                                   → AI 训练 → 推理
```

每一节都讲: **它的上一站契约是什么 / 它对下一站提供什么 / 没有它上一步走不动**.

读完应能: 把任意一份你做过 / 你读过的工程问题挂到这条承接链某节点上, 知道"上一站是怎么影响它"和"它对下一站指挥谁".

---

## 一、CPU 与内存: 1945 年那纸契约的开始

### 1.1 von Neumann 架构

```
     CPU  ←─── shared bus ───  Memory
                                   │
                                 IO
```

存储程序 + 共享总线 + 取指 → 解码 → 执行 → 写回. 这套循环在一台机器上仍是 2026 主流 (除 Harvard / NUMA / DSP variant).

### 1.2 第一道承接: 性能 vs 内存之间的-frequency gap

```
1980  CPU 5MHz, DRAM 100ns     到 CPU 一致
1995  CPU 100MHz, DRAM 60ns   缓慢拉开
2000  CPU 1GHz, DRAM 6ns       10x 差距
2010  CPU 3GHz, DRAM 0.3ns    100x 差距 ← cache 不可缺
2026  CPU 5GHz, HBM 0.2ns     memory wall; cache + HBM + CXL
```

→ 这就是为什么 [第八部分 memory-hierarchy](../computer-arch/memory-hierarchy.md) / TLB / DRAM / HBM 全是必需. **内存是 CPU 的最薄弱点, 没有第二选项**, 没有它后整个 OS / 编译 / AI 承接链都得重.

### 1.3 为何 OS 出现: 单机内部多任务化的契约

- 主机仍单 CPU 时, OS 把"硬件时序"封成"时序进程"; 进程 / 线程 / 上下文切换 = 虚拟时间 + 虚空间.
- 一旦有保护模式 + 虚拟内存 + 系统态分, 用户程序不必对每个硬件细节了如指掌 — 这是 OS 出现的核心动因.

---

## 二、OS/Linux: 让程序员不再写硬件

### 2.1 进程 + 虚拟内存 = 抽象母机

- 进程 = 一份拥有独立虚地址空间的执行单位; 内核为每个建 page table, 给"独立空间"幻觉.
- 调度器 (Linux CFS / EDF / RT) 将 CPU 时间切片让多进程并发"幻觉".
- 上下文切换挂上下文 + TLB; 延迟 ~ 1-10us (见 [os/sched](../os/sched/README.md)).

### 2.2 文件系统: 让 IO 字节流化

| OS 抽象 | 物理对应 |
|---------|---------|
| `open(path)` | inode 解析 + dentry cache |
| `read/write(fd)` | page cache + direct IO |
| `mmap(fd)` | TLB + page dirty |
| `fsync(fd)` | WAL flush + 块设备 cache flush |
| `sendfile(out, in)` | zero-copy, DMA |

→ 见 [os/fs](../os/fs/README.md).

### 2.3 网络栈与 epoll/io_uring

- `socket()` 复用 fd 抽象; TCP 4 层 + IP + 驱动.
- C10K 问题 (2002): 单机 10000 连接压力 → epoll (2002) + kqueue; 后 100K / 1M 由 io_uring (2019) 实现.

### 2.4 同步原语与内存模型

- 进程内 sync: mutex / semaphore / rwlock; kernel 内 futex + CAS; 浪费大批 lock-free / RCU 设计.

→ 见 [os/lock](../os/lock/README.md).

### 2.5 OS 对承接链"承诺"的清单一句话

- 进程隔离的虚空间
- 通用 IO 的字节流
- 跨进程的协议: socket / IPC / pipe
- 命名隔离: filesystem
- 安全 / 权限: uid / cgroup / capability

这一组契约就是后续一切软件的"地基".

---

## 三、网络与 Web: 让孤立的机器互连

### 3.1 IP/TCP 契约

- IP: 不可靠的、按 packet; 上层自己保序 / 重传可靠性.
- TCP: reliable byte stream; congestion control (Reno/Cubic/BBR); 3-way handshake + 4-way close.

### 3.2 HTTP / TLS: 最薄一英里

- HTTP/0.9-1.1 一条 TCP 一个 request; HTTP/2 (2015) 一条连接多路 stream; HTTP/3 over QUIC (2022+) → 见 [networking/quic](../networking/quic/README.md).
- TLS 1.3 (2018) 1-RTT + 0-RTT; X.509 + PKI + CT.

### 3.3 Web 把客户端拉成终端

- 浏览器是 OS 上的一个 "虚拟机"; HTML/CSS/JS DOM/WASM/WebGPU 成熟.
- 2024+ WebGPU 让浏览器可调 GPU 算 + WASI 让 WASM 调本地 file. 浏览器从文档看待器 → 通用客户端 → 实际计算平台.

### 3.4 网络对 DB / 应用的影响

- DB 出现 single machine 邦联后就受网络影响; 网络 RTT 决定 commit 时间 → 数据库 replication 的延迟很关键.
- 应用从 monolith → SOA → micro-service → service mesh 全由于网络可靠性 / IP/TLS / k8s / 等成熟.

---

## 四、数据库系统: 让状态在并发 / 故障下成立

### 4.1 为什么需要 DB 而不是文件

OS 文件系统只承诺 "字节流", 没说"原子写 / 多 client 并发 / crash 后一致". DB 把这些不变式钉死:

- ACID (事务原子性 / 一致性 / 隔离性 / 持久性).
- MVCC + WAL + 2PL + snapshot isolation.
- 主流: PostgreSQL / MySQL (OLTP), ClickHouse / Snowflake (OLAP), Redis / Dynamo (KV).

→ 见 [databases](../databases/README.md). 这是承接链 **保存状态** 的核心一层.

### 4.2 数据库如何依赖 OS / 网络 / 硬件

- 依赖文件 + fsync 确保持久性 (write-ahead log); 这是个 OS 与块设备之间的契约. 一旦块设备"写入但未 flush" 破坏这一契约, ACID 就有空洞 (e.g. SSD cache 丢).
- 依赖网络做 replication; latency → Paxos / Raft 单写 1 RTT trip.
- 依赖 page cache / direct IO / io_uring / NVMe 多队列 → 与 OS / 块设备协同.

### 4.3 DB 是 web 后端的"状态核心"

- Web 上层把所有"状态"丢 DB, 自己做无状态服务 + 容器; K8s + RDS 模型 一切都这么搭.
- DB 与分布式系统的 cap 线 / 一致性范畴都来自这条承接.

---

## 五、编译器 / 高级语言: 让机器可读变成人可写

### 5.1 编译器史的简线

- 1957 FORTRAN; 1972 C; 1990 GCC; 2000 LLVM; 2010 V8 Tiered JIT; 2020 Rust + LLVM + Miri.
- 编译器把"人工可写"高级语言转到"机器可执行" ISA, 同时做优化: SSA / CFG / constant folding / dead-code / loop unroll / auto-vectorize / IPO.
- 见 [compilers](../compilers/README.md).

### 5.2 编译器承接了"OS 加上后程序可点点"

- OS 提供 syscall ABI; 编译器知道怎么写出对 ABI 正确的代码 (caller/callee saved regs, stack frame).
- 语言层 → 库 → syscall → kernel → driver.

### 5.3 高级语言运行时: 抽象 GC 与线程的延展

- Java / Python / Go / Rust / JS 等, 加 GC / 协程 / async / await / Future / channel; 都把 OS 线程 + sqlite / pipe 的细节包到运行时.

---

## 六、分布式系统: 一台机器不够用后 N 台协同

### 6.1 必来

- 单机扩展到 +10GHz 时 CPU 与内存墙都搅过; 一台机器能跑的 QPS / 数据量 / HA 都不可满足 → 必须多机.
- 多机 = 网络 → 延迟 + 故障 + 异构 → 必须协议 (CAP / 一致性).
- Multi-Paxos / Raft / Gossip + CRDT; 见 [distributed](../distributed/README.md).

### 6.2 共识 = 状态机复制的工具

- 1990 Lamport Paxos; 2014 Raft.
- 任何"被许多机器共享的状态"几乎都用这俩或其变种.
-共识是承接链中**调度多机**, 把"不可靠网络 + 部分机器丢"转成"一组虚拟主机机".

### 6.3 一致性与时间

- 物理时钟不可同步全 → logical clock (Lamport, vector clock, HLC) → 全序 / 偏序隔离.
- TrueTime (Spanner) / HLC (CockroachDB) 借 GPS + 原子钟做单亿误差.

### 6.4 把"集群"抽象成"单机"

- K8s 把 10000 台集群抽象成一组 control-plane API; 用户提 YAML 即一份声明式资源 → 内部 reconciliation loop → 自动调拨.
- 见 [system-design/case/k8s-control-plane](../system-design/case/k8s-control-plane.md).

---

## 七、Web 后端 / 微服务 / 系统设计

### 7.1 估算 → 缓存 → 队列 → 限流

- Little's Law + Little's Law → 平均 response = arrival_time / (1 - rho); back-of-envelope 计算 QPS / IOPS / 带宽 / 存储.
- cache-aside / write-through / write-behind; 失效 (穿透 / 击穿 / 雪崩).
- 队列 Kafka / Pulsar / SQS; at-least-once vs exactly-once; outbox pattern.

### 7.2 系统设计 = 反推与分解

- 任务需求 → 估算 → 主组件 → 数据流 → 失败模式 → 可观测 → 上云.
- 见 [system-design](../system-design/README.md).

### 7.3 微服务网格的承接

- 服务网格 (Istio / Linkerd / Envoy) 在 K8s 之上加: mTLS + routing + 重试 / timeout / 熔断 + observability + sidecar proxy.

---

## 八、AI: 状态机的"高维"模式化

### 8.1 它从哪里踏上承接链

- **数学** (第零部分): 反向传播 + 链式法则 + softmax / SVD + 概率分布 → 是 AI 训练算法本身.
- **硬件** (第八部分): GPU/TPU/NPU 异构芯片 + HBM + 互联 → 性能 + 显存决定 能不能训.
- **OS** (第二部分): Linux + cgroup + nccl + RDMA → GPU 集群的互联.
- **网络** (第三部分): RoCE v2 / nvBandwidth → 多卡通信快; HTTPS 推理 API.
- **数据库** (第四部分): 训练数据集存储; vector database 给 LLM 工具调用 / RAG.
- **分布式** (第六部分): model 并行 / data 并行 / pipeline 并行 / ZeRO-3 → 8 卡变 65K 卡.
- **系统设计** (第七部分): inference service 设计 / KV cache 共享 / 多 tenant / autoscaling.

### 8.2 AI 反过来反推这条承接链

- GPU/NPU 出来前: CPU 单线喂不饱; 现在 GPU 训练一批 7B 模型 1000 卡密集用; **NCCL + RDMA + GPUDirect-RDMA** 是新协议栈; 这把承接链的工具形态全部改.
- LLM 推理: 把反向 AD 的 cache 改成 KV cache, 不是梯度是 attention 中间结果 → 这反过来推 HBM / CXL / 互联带宽.
- Agent (2025+) 反推 RPC / tool/API 框架: MCP 协议让 LLM 配 SQL / fs / browser 成为可工程交互.

### 8.3 新承接: AI → 系统 / OS 的反向输入

- GPU 集群调度: Borg/Omega/Kubernetes 都要支持 device plugin + topology-aware; Linux 内核对 GPU 的 cgroup 隔离还很弱 (2024+ 才有 NVIDIA MIG 与 DPDK 隔离成熟).
- ML 监控与 trace: OpenTelemetry 增强 ML metrics; 单步训练几百次需 trace-blame 与 schema.
- 推理直接接 OS syscall (e.g. AI tool use) → 安全沙箱新关注.

---

## 九、整个承接链图

```
物理 ─ 晶体管 ─ 数字 ─ ISA ─ microarch
                                  ↓
                            虚拟内存 + CPU cache
                                  ↓
            ┌───────── OS (Linux Kernel) ─────┐
            ↓             ↓                 ↓
        File System    网络 (TCP/IP)      进程 + 调度
            ↓             ↓                 ↓
        块设备 / SSD   HTTP / TLS          线程/协程
            ↓             ↓                 ↓
            DB          Web/REST        编译器 / 语言运行时
            ↓             ↓                 ↓
            OLAP / OLTP    LAMP/MEAN/MERN   JIT/HotSpot/V8
            ↓             ↓                 ↓
            分布式: KV / Queue / Consensus / K8s
            ↓             ↓                 ↓
───────────────────────────────────────────
                            ↓
                    AI: Training + Inference
                            ↓
                  GPU / NPU / TPU / 异构 XPU
                            ↓
                  HBM4 + NVLink + CXL 3.0
                            ↓
                  Agent + MCP + 推理 SDK
                            ↓
                  === 下一波新抽象 ===
```

每一节点都为前一节点顺承不变式; 跳一节点工程就断了.

---

## 十、五个"如果是新工程师, 你正在哪段承接"的练习

| 你做的事 | 你主要在哪段承接 |
|---------|-----------------|
| 写 Web 后端 + DB RDS | Web 后端 / DB / OS (epoll+socket) |
| 写 mobile app | 高级语言运行时 / Android/iOS SDK / NPU |
| 写 CUDA kernel 训大模型 | 物理层之上的 microarch / ISA (PTX) / AI 调度栈 |
| 写 Kubernetes operator | 分布式 / 系统 / OS |
| 写 Linux 内核 driver | OS / ISA / 微架构 |

→ 这套表帮你定位"读完哪几章本书就可以接入你工作".

---

## 十一、与第零部分数学的加乘

数学 (第零部分) 不在承接链有自己的节点 — 它**横跨所有节点**:

- 第 1-2 物理层 - 信息论/熵与极限.
- ISA 与微架构 - 不必数学.
- OS / 调度 - 概率 + 排队 + 极限.
- 网络 - 概率分布 + 信息论熵 / 信道容量.
- DB - 关系代数 + 估计 + 一致性序.
- 分布式 - 偏序 + 概率 + 信息论.
- AI - 微积分 + 线代 + 概率 + 优化.

→ 这就是为什么数学放在第零部分: **每段承接都要用到**, 不能单挑一节点上.

---

## 十二、结束 + 速查表

> [!TIP]
> 一页唤回:
>
> - **承接链**: 物理 → ISA → 微架构 → 内存 → OS → 进程 + 文件 + 网络 → 编译器 → DB → 分布式 → AI.
> - 每一段都需要上段提供契约; 没有它下段最后一段不动.
> - OS 给"进程 + 字节流文件 + socket"; 没它再好硬件也只是 DSP.
> - DB 提供并发 + 故障下状态一致; ACID = WAL + 2PL + MVCC 等.
> - 网络把孤立机器拥成集群; CAP / 共识 / 一致性序随之而来.
> - 分布式抽象集群为虚拟机; K8s + Raft + CRDT 这套套餐现成.
> - AI 反过来给承接链压力, 推 GPU/互联/HBM/CXL/MCP.
> - 数学横跨所有节点 = 第零部分必须放最前.

---

下一篇: [5. 全书地图: 13 部分与导论的交叉索引](map.md).
