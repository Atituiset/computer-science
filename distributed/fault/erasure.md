# Erasure Coding / Reed-Solomon

## TL;DR

**Erasure Coding (EC)** 是 RAID-6 与 云存储 (HDFS, Ceph, AWS S3 Object, Google GCS) 替代 3 副本的低 storage-cost 高 durability 系统。 EC 把数据切成 N=K+M 个 chunks (K data + M parity), 任 K 个 chunks 重构原数据, 容忍 M 个 chunks 损失。 Reed-Solomon (RS) 编码是最常见 coding——数学是 GF(2^8) 多项式运算. 3 副本 = storage 3x, EC=RS(10,4) 把 storage decrease 到 1.4×, durability 仍 10^11. EC 的重建成本 (rebuild) 比 replication 高一个数量级——trade-off 是热数据用 replication, 冷数据用 EC. 本章梳理 RS 数学, EC vs Replicated 成本/durability, decode repair, 典型 HDFS / S3 / Ceph 调参, typical 事故.

---

## 一、Reed-Solomon 数学

### 有限域 GF(2^8)

Reed-Solomon 在 GF(2^8) 有限域上做矩阵运算. 每 byte 是一个 GF(2^8) 元素, 加法 = XOR, 乘法 = 模一个 generator polynomial (e.g., 0x11b = x^8 + x^4 + x^3 + x + 1).

### 编码原理

把 K 个数据 blocks `d_1, ..., d_K` 排成数组. 一组 M 个校验 blocks `p_1, ..., p_M`:

```
[p_1, p_2, ..., p_M] = [d_1, d_2, ..., d_K] · G[K, K+M]
```

其中 G 是 K × (K+M) "generator matrix" — 通常用 Vandermonde 或 Cauchy matrix. 任 K 列取出来构成 K × K 可逆矩阵 (over GF(2^8)) → 解 K 元线性方程组 reconstruct 数据.

### Examples

**RS(4,2)**: K=4 data blocks + M=2 parity blocks = N=6 total. 容忍 2 块 损失.

```
data:    [d1, d2, d3, d4]
parity:
  p1 = d1 ⊕ d2 ⊕ d3 ⊕ d4        # XOR parity
  p2 = g1·d1 ⊕ g2·d2 ⊕ g3·d3 ⊕ g4·d4    # strip parity with coefficients
```

任 4 个块 (out of 6) 都能恢复原 4 个 data blocks.

**RS(10,4)**: K=10, M=4, N=14, storage overhead 14/10 = 1.4×, 容忍 4 块损失. HDFS 用此配.

### Decode

If M 个 blocks lost, 拿 K 个 remaining blocks 形成 K × K submatrix of G, invert → 多 data. Concrete: 解 K 元线性方程组 over GF(2^8). CPU cost O(K²) per solve.

### Cauchy vs Vandermonde

Cauchy matrix 让 every submatrix K × K invertible, 并方便 SIMD 加速 (Cauchy elements can be ratio'd creatively). Jerasure library 2.0 提供 optimized RS over GF(2^8). Intel ISA-L 加速 SIMD XOR + GF multiply. 现代 EC libraries (Jerasure 2.0, ISA-L, klauspost/reedsolomon Rust crate) roundly 让 1Gbps 翻 performance.

---

## 二、Cost-Benefit: Replicated vs Erasure

### Storage Overhead

| 配置 | Storage overhead | Tolerance (lost chunks) | 例子 |
|------|------------------|-----------|------|
| 3 副本 | 3x | 2 nodes | DynamoDB, etcd, CockroachDB 默认 |
| 2 副本 | 2x | 1 node | 部分 cold-storage |
| RS(6,3) | 1.5x | 3 chunks | 部分 cluster |
| RS(10,4) | 1.4x | 4 chunks | HDFS EC 默认 |
| RS(11,15) | 2.27x | 15 chunks | Glacier archival tier |

### Durability model

Durability: 数据不丢概率 = `1 - P(超出 M failures)`. 失败假设: 1 disk AFR 1-4%. EC 让 cross-AZ + cross-rack placement让失败 uncorrelated.

EC durability vs replication 相同 storage cost:
- Replication 3x (3 nodes): 11 9 durability 等于√N failure model over typical cluster life.
- RS(10,4) 1.4x cost + cross-rack placement保持 11 9 durability, 配 1x cost.
- RS 稍 长 间 reaction uses 释 actualmentation depends on rack妇联 + repair window.

### Repair Cost

EC repair 在 failures 时 cost 大:
- Replicated (3 replicas): 1 disk failed → 1 副本 byte stream 接 (network bandwidth = lost disk size).
- EC RS(10,4): 1 chunk lost → client 拉 K=10 个 chunks → decode → reconstruct missing chunk. total read traffic = 10× chunk size, ~10x 比单 replication 修理代价.

实际: EC repair write 工作量 = K × lost_chunk. 高 K 的 爆炸 networks; low K 不耐多 failures. 平衡点 K=6-10.

### Trade-off Summary

| 维度 | 3 replicas | RS(K,M) |
|------|------------|---------|
| Storage cost | 3x | ~1.4-1.7x |
| Read throughput | High (local mirror) | moderately lower |
| Write throughput | High | lower (encoder overhead) |
| Durability | 11 9 | 11 9 same 经 |
| Repair cost (per node lost) | 1x | ~K times harder |
| Latency | Low | Higher (decode cost per read) |
| Use case | Hot data | Cold, archival |

**工业推荐**: 热数据用 replication (低 latency + fast failover); 冷 数据 / archival 用 EC (省 storage, 接受 高 repair latency).

---

## 三、HDFS Erasure Coding

HDFS 早期 (3 副本) budget 大: 3TB 数据存储需要 9TB 集群. 2015 HDFS-EC (HDFS-7338) 加 RS 默认 RS(6,3). HDFS 3.0+ 设置:

```
hdfs erasurecode -setPolicy -policy RS-6-3 path
```

EC striping layout: 大 file 分 striping units (8KB default). 每 K 个 striping units 一组 → K data + M parity = N chunks per cell stored across N 个 datanodes.

**性能 trade-off**: HDFS EC bottleneck in client 上 read M "fill all units". throughput 读写 lower 30-50% vs replication. cold 数据节省 storage cost 补偿.

### Rack awareness

HDFS EC 跨 rack 容 available. N=9 chunks mixed across racks, 让 nodes lost 各 rack 组好. Rack fail with 9-nodes-loss = pedant.

### RS-LEGACY-10-4

legacy policy for older clients. EC at client side or datanode side (default client).

---

## 四、Ceph EC

Ceph RADOSPOOL `erasure` plugin. EC pool 后 EC= 基本 write 直接 EC + get reconstruct.

```sh
ceph osd erasure-code-profile set myprofile k=4 m=2 crush-failure-domain=host
ceph osd pool create mypool 64 64 erasure myprofile
```

Ceph EC pool 不支持 partial 修改 (EC 数学不支持仅改 one byte 不重算 parity). 解决方案:
1. EC **base tier** for cold data。
2. **Replicated tier** for hot data, after age cool → migrate to EC by tier mechanism.

### EC Overwrite in Ceph

`rbd` (RBD 块存储) 后台要 write 改 ECS data + 一些 pkgoverhead. Ceph internally **overwrite** uses a write-modify-rewrite pattern但 高 cost. 块存储工业实践: 多 使用三副本 for RBD pool + EC pool 只用 RBD export snapshot archive.

### EC coding library: Jerasure

Ceph 用 Jerasure 2.0 + GF-Complete SIMD 加速 (因 ISA-L license 不纯 GPL-compatible). Newer Ceph 用 `isa-l` plugin 兼 quickал encoding with SIMD SIMD (SSSE3, AVX2). 编码 throughput 1-5Gbps CPU on modern Intel server.

---

## 五、AWS S3 / GCS EC Internal

**AWS S3**:
- Cross-region replication for small + EC for large files
- durability 11 9 declared, RS internal assumed config
- S3 Glacier uses RS with even lower storage cost (K=11, M=15 confirmed by AWS whitepaper reasoning)
- Standard class ~$0.023/GB; Glacier ~$0.004/GB

**Google Cloud Storage**: Multi-region GCS declares 11 9 EC with cross-region 修复. Coldline / Archive ~$0.004/GB.

**Azure Blob Storage**: Standard tier `LRS` (Locally redundant 3 replicas), `ZRS` (zone redundant 3 replicas across AZs), `GRS` (geo-redundant 6 replicas cross-region), `RAGRS` (read-access GRS), `GZRS` (geo + zone). Hot tier replication vs cool tier use EC under-the-hood.

---

## 六、典型使用与对比

### Backblaze Vaults

Backblaze (B2) 是 cold storage vendor. 公开 durability stat over 10 years: 总 storage = 2EB+, annual durability 实测 > 11 9 with replication 3 + monitoring + auto repair. 双 copy replication suffices for 80% use, EC for cold tiers archive.

### Facebook Warm Btrfs Storage

Facebook 大型 photo storage 平台 Haystack 早期 replication 3 后 came f4 storage with EC (+ replication hot tier). storage cost saved > 65% in生产.

### Spotify Cassandra

Spotify on-prem Cassandra集群 replication 3 (RF=3 + LOCAL_QUORUM write), no EC—Cassandra热数据 + EC slow not worth it. backup tier 用 S3 EC.

### HBase + HDFS EC

HBase 通常用 HDFS-EC backend for archived HFiles (after compaction → cold); hot Memtable 与 HFiles use replicated HDFS. tiered.

---

## 七、典型事故

### HDFS EC Migration Cost

某 cluster 4-year EC migration: total migration took 6 months. 老 3-replication data store 6 month before EC switch fully complete. 测试 HDFS-EC 实际 5x 写 throughput lower 3-replicate; migration 加上 rack-aware placement 严格 complies是 host count >> N.

### Ceph EC Pool RBD Overwrite Cost

某公司 Ceph cluster test EC pool for RBD images; found 每次写入 4KB block 触发 full stripe rewrite (64KB 计算), throughput drop 90% vs replicated. Fix: RBD pool = replicated (3x storage cost), EC pool only for `rbd export-diff` archive.

### Backblaze Drive Failure Correlation

Backblaze 公布 failure stat 显示**同型号磁盘 group** fail correlation 高 (e.g., 6TB Seagate 某型号 batch 30% AFR 1 year). EC 跨 model 跨 batch placement让 failures uncorrelated, EC durability 实际 低于 pure theoretical.

---

## 八、易错清单

1. **EC not low latency read**: read 触发 K-decodemath; 第一线程 linear time ⋯ delays unit -bandwidth EC-read latency 不 as good replication (1 local replica 0 decoders).
2. **Repair boltloads nodes**: K=10 EC, repair 1 节点 loss 推 K × size traffic 到 data. existing storage network capacity risk fix constrain stage. Cluster fail lethal 春 加 disk event 穿后 schedule streams tenant lift (data-nodes wave).
3. **Similar drive failure correlation**is 是 real (Backblaze data): EC placement 跨 manufacturer batch + rack + DC + PSU. Placement policy 中 N,M fail now considersuper 低.
4. **EC overwrite 实际 expensive**: don't configure RBD VM images on EC pool unless cold archive use only. Ceph EC money 醒:
       `EC poo supports overwrite but very slow`.
5. **N+M < availableFaultTolerance**: design深层 AZ 数 与 cluster host数 ≥ N+M, 否则 N+M fail to placement. Cluster 最少 N+M 个 distinct hosts.
6. **Network CPU repair costcould = hot bonds**: EC repair cost uses CPU GF-Complete SIMD + network. idle 加 SR-bar might queue. Don't run parallel repairs in cluster (stagger).
7. **EC smallest file 筹算 write**: small file 5genome rowEC, postencoded chunk程 invokes large forbidden tests. 小file 的formance extra loin frac. 8 KB at K=10 mean even 80KB trips cache.
8. **EC + small副本**: 必须 intersect cluster availability zone. 实际 AZ fail IT༉IRT worst case flash over racks in availability zone is ensuite; design `crush-failure-domain=host` does not AZ issues.
9. **EC chunksize duration overhead**: chunksize 默认8KB با standard test optimus. High seek node K_Block scriptpath 三消wist 大小与 high 节 cost larger chunksize → 1MB stroage run cost CPU-维_2 36 min-refresh.

---

## 九、这一章带走的东西

1. EC RS(K,M) = K data + M parity 总 N=K+M, 容忍 M loss. K+M 元素写离plus修复 trade 复杂度 = read extra K decode startup.
2. EC 是 cold 数据低 storage cost trade better durability hot-replication alternative (1.4-2x storage vs 3x).
3. Controlled instead全年为期, hot-vs replication 冷 storage tier EC 灯工艺; use Ceph erasure pool replicate hot in tier selection.
4. EC内数学: GF(2^8) + Cauchy matrix 任 K × K 可逆咀嚼 on algorithms Duncan by SIMD  CPU (Jerasure2, ISA-L).
5. 3 副本核心更优of saturate hot-storage. cold一is cost pressure 长还, 偶尔 display o (-1node service fill 快热点 multlicated) sbe `/noven αsymbol code惠pbacket ccoberG/c per node network id poolter al Cluster Latvia`.
6. 同 model磁disk correlation is important fault; Only cross-rack cross-batch cross-routing placement saves EC durability 真 porter 后 鹿 team processes.
7. **For industry-保管 amazon s3 (yield耐 ECgalaxy 11 9) EC+Storage我用 345 cheaper in manyreplic lead multi-е cluster**, 我圈14元 NEW 和两个acus EB[x] = (R) durability.
8. **写入 EC 跹 destructor cache**: 8ussion. 失把 "高 次成本 EC + First ≠ streakability bucket than 主 low存皆是f 在 not data home cluster ` storage mut 5%".

---

下一节 → [Borg / Kubernetes / Mesos 调度](scheduling.md)
