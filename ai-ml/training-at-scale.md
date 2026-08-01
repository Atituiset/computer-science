# 8. 大模型训练工程: DP/PP/TP/ZeRO/FSDP/Checkpoint

## TL;DR

单个 GPU 装不下大模型——以 LLaMA-3-70B 为例：权重 fp16 ≈ 140 GB，一个 H100 只有 80 GB。所以必须把训练拆到多卡。这一章讲四种并行范式的数学直觉、显存账本、和它们怎么组合，以及 ZeRO/FSDP 如何把"每卡都要存全量权重"这种浪费砍掉，最后落到 checkpoint 与容错。

读完应能：
1. 给一个模型参数 N + 卡数 G + 序列长 T，算出训练每步的显存账本（权重/梯度/优化器状态/激活）。
2. 说清 DP / TP / PP / ZeRO / FSDP 各自解决什么、限制在哪。
3. 看懂训练框架配置里的 `data_parallel_size` / `tensor_parallel` / `pipeline_stages` / `zero_stage`。
4. 知道为什么"最大可训模型"卡在显存和通信带宽，而不是算力。

---

## 一、先算账：一次训练 step 的显存去哪了

### 1.1 四类内存占用

设参数 N = 70e9（70B），AdamW 优化器，bf16：

| 项 | 公式 | 70B 估算 |
|----|------|---------|
| 模型权重 | N × 2 bytes (bf16) | 140 GB |
| 权重 fp32 master copy | N × 4 bytes | 280 GB |
| Adam m (一阶矩) | N × 4 bytes | 280 GB |
| Adam v (二阶矩) | N × 4 bytes | 280 GB |
| 梯度 | N × 2 bytes | 140 GB |
| **优化器状态+权重+梯度 合计** | ≈ 16×N bytes (Adam) | **~1.12 TB** |

> [!WARNING]
> 结论：**单卡根本不可能**。即便只算"装下参数"，70B bf16 也要 140 GB。这就解释为什么大模型训练必须多卡 + ZeRO。

### 1.2 激活显存（forward 中间量）

激活 ≈ `层数 × batch × seq × hidden × 2 bytes`，且反向时**需要重算**（或 checkpoint 省）。

以 70B、seq=4096、batch=1、d=8192：
- 单层激活 ≈ `1 × 4096 × 8192 × 2` ≈ 64 MB/层 × 80 层 ≈ **5 GB**。
- 加上 attention score `T²×heads` 等，实际峰值更高。

**Gradient Checkpointing**（回顾 backprop 章 §5）可在显存/算力间取舍：省 ~60% 激活，多 ~30% 算。

### 1.3 训练吞吐 vs 显存的现实

- 算力（H100 ≈ 990 TFLOPS bf16）、显存（80 GB/卡）、互联带宽（NVLink 900 GB/s / 跨机 IB 400 Gb/s）**三者都可能是瓶颈**。
- 大模型训练的目标公式：`有效 FLOPs 利用率 (MFU)` = 实际算力 / 峰值算力。业界 LLaMA-3 训练 MFU ≈ 35-40%。

---

## 二、数据并行（DP）：最简单

### 2.1 思路

每张卡持**完整模型副本**，各跑自己的 batch，反向后 all-reduce 平均梯度，再同步更新。

```
卡0: model(完整) + batch0 → grad0 ┐
卡1: model(完整) + batch1 → grad1 ┤ all-reduce 平均 → 每卡用同一梯度更新
卡2: model(完整) + batch2 → grad2 ┘
```

### 2.2 账本

- 显存：每卡 = 全量模型（优化器状态 ×16N 不变）。
- 通信：每步 all-reduce 2×N bytes（前向+反向）。
- 限制：**模型必须能装进单卡**。70B 单卡 80GB 装不下 → DP 不够。

### 2.3 变体

- 全 batch all-reduce：梯度同步用 AllReduce（ReduceScatter + AllGather）。
- 通信重叠：反向时边算边 all-reduce（bucket 化）。

---

## 三、张量并行（TP）：把单层切开

### 3.1 思路

**把一个矩阵乘切开到多卡**。Megatron-LM 风格：把线性层按列/行切成 G 份，每卡算一份，用 all-reduce 拼结果。

对 `y = xW`（x: [B,T,d]，W: [d,d']），按列切 `W = [W_0; W_1; ...]`：

- 前向：`y_i = xW_i`（每卡算 y 的一部分），`y = concat(y_i)`（f 操作：all-gather）。
- 反向：`dx = Σ_i dy_i W_i^T`（g 操作：reduce-scatter）。

### 3.2 为什么 TP 需要高速互联

每层前向+反向都有两次跨卡通信（all-gather + reduce-scatter）。**卡间带宽必须极高**——TP 只在同一节点内（NVLink/NVSwitch，900 GB/s）用，跨节点用 IB 太慢。

### 3.3 适用

- 模型层内矩阵巨大（hidden 维 8K-16K）时有效。
- 典型配置：TP=8（一个节点 8 卡 NVLink 全互联）。

---

## 四、流水线并行（PP）：按层切开

### 4.1 思路

**把层序列分成若干 stage，每卡负责一段层**：

```
Stage0: layers 0-7    Stage1: layers 8-15    Stage2: layers 16-23
```

前向一层层往下传，反向一层层回传。

### 4.2 Bubble（气泡）问题

纯串行：前向要等前一 stage 算完 → 大部分卡空闲（气泡）。解决：**micro-batch 流水**——把一个 batch 切成小片，流水交错，气泡只占开头/结尾。

现代用 **1F1B（one-forward-one-backward）** 调度：前向和反向交错排布，让每卡尽量不空。

### 4.3 账本

- 显存：每卡只装 N/stage 的层 + 该 stage 的优化器状态。
- 通信：只在 stage 边界传 hidden 状态（小量），跨节点友好。
- 缺点：气泡（调度不好会有 ~p-1/p 空闲）；stage 间负载不均难平衡。

---

## 五、ZeRO：把 DP 的"冗余"砍掉

### 5.1 问题

DP 每卡存全量权重+优化器状态（16N）——**纯冗余**。ZeRO（Rajbhandari 2020）把这三样**分片**到各卡。

### 5.2 三阶段

| Stage | 分片什么 | 省多少优化器显存 | 通信 |
|-------|---------|-----------------|------|
| ZeRO-1 | 优化器状态 (m, v) | ~4× | 每步 all-reduce |
| ZeRO-2 | + 梯度 | ~8× | 用 ReduceScatter + AllGather |
| ZeRO-3 | + 权重 | ~N_gpus × | 每层前向/反向都要 all-gather 权重 |

### 5.3 直觉

- **ZeRO-1/2**：梯度在反向时用 ReduceScatter 分片聚合，优化器更新只用本地分片，再 AllGather 权重。**通信量 = 一次 full all-reduce，与 DP 同量级**，但显存省 8×。
- **ZeRO-3**：权重也分片 → 前向每层前临时 all-gather 权重、算完就丢。显存省 G 倍，但通信多（每个 transformer 层都 gather）。

### 5.4 ZeRO-offload

再把优化器状态/梯度 offload 到 CPU 内存或 NVMe。可让 70B 在 8×80GB 卡上跑，代价是 CPU-GPU 拷贝带宽限制训练速度。

---

## 六、FSDP：PyTorch 的 ZeRO-3 实现

FSDP（Fully Sharded Data Parallel，PyTorch 2022）是 ZeRO-3 的工程化：默认全分片，按层做 **unshard（前向 gather）→ 计算 → reshard（丢弃）**。

```python
from torch.distributed.fsdp import FullyShardedDataParallel as FSDP

model = FSDP(
    model,
    mixed_precision=torch.distributed.fsdp.MixedPrecision(
        param_dtype=torch.bfloat16,
        reduce_dtype=torch.bfloat16,
    ),
    sharding_strategy=torch.distributed.fsdp.ShardingStrategy.FULL_SHARD,
    auto_wrap_policy=...,   # 按 transformer block 切分
)
```

关键点：
- `FULL_SHARD` = ZeRO-3（权重也分片）；`SHARD_GRAD_OP` = ZeRO-2；`NO_SHARD` = DP。
- 配合 **activation checkpointing**（`torch.utils.checkpoint`）是单集群大模型标配。

---

## 七、3D 并行：组合

### 7.1 主流组合（Megatron / DeepSpeed）

```
TP (同节点张量切)  ×  PP (跨节点流水)  ×  DP/ZeRO (跨节点数据分片)
```

典型 70B on 128×H100（16 节点 × 8 卡）：

| 维度 | 值 | 说明 |
|------|-----|------|
| TP | 8 | 节点内 NVLink |
| PP | 8 | 跨 8 组 stage |
| DP/ZeRO | 2 | 数据并行副本 ×2 |
| 总卡 | 8 × 8 × 2 = 128 | |

### 7.2 为什么这样分

- **TP** 快但只在节点内（NVLink 带宽高）。
- **PP** 通信少（只传 hidden），适合跨节点。
- **DP/ZeRO** 吞吐高，跨节点扩展主力。
- 三者正交，组合后总卡数 = TP×PP×DP。

### 7.3 通信拓扑（分布式 §6 对接）

- All-reduce / All-gather / Reduce-scatter 是基础原语——回顾 distributed 章节的通信模型。
- 大集群跨节点用 **RDMA（IB / RoCE）**，训练吞吐瓶颈常在通信而非算力。
- NCCL（NVIDIA Collective Communications Library）是这些原语的 GPU 实现，PyTorch 底层。

---

## 八、Checkpoint 与容错

### 8.1 为什么必须 checkpoint

大模型训练常跑数周，中途 GPU 故障、机器掉线是常态（千卡集群 MTBF 以小时计）。必须定期保存状态以便恢复。

### 8.2 三种 checkpoint

| 类型 | 存什么 | 用途 |
|------|--------|------|
| 全量 checkpoint | 全部权重+优化器状态+调度器 | 完整恢复 |
| 权重 checkpoint | 只存模型权重 | 推理/微调用 |
| 优化器状态 checkpoint | m, v 等 | 恢复训练精度 |

**调度器状态**（学习率当前值、step）也常存——否则恢复后 lr 突变。

### 8.3 ZeRO-3 下 checkpoint 的坑

ZeRO-3 权重分片在各卡——**单卡 save 只存自己分片**。必须 gather 成完整权重再存，否则单机恢复不了。FSDP 有 `state_dict` 的 gather 语义，用 `use_orig_params=True` 或收集到 rank0。

### 8.4 恢复流程（分布式 §6 故障模型对接）

```
检测到 GPU 故障 (心跳超时) → 任务重启
 → 从最近 checkpoint 加载权重 + 优化器状态
 → 从该 step 重新开始 (不是从头)
 → 学习率从保存的调度器位置继续
```

---

## 九、量化与低精度训练（衔接 XPU）

### 9.1 bf16 vs fp16

| dtype | 指数位 | 尾数位 | 范围 | 用途 |
|-------|--------|--------|------|------|
| fp32 | 8 | 23 | 大 | 主权重 / 累加 |
| bf16 | 8 | 7 | 同 fp32 | 训练计算（稳定，无需 loss scale） |
| fp16 | 5 | 10 | 小 | 计算快但易溢出，需 loss scaling |

现代大模型训练标配 bf16（H100/A100 原生支持）。

### 9.2 混合精度

- 主权重 fp32 存（防累积误差），计算 bf16。
- 反向梯度 bf16 算，累加进 fp32 master。

### 9.3 训练后量化（推理用）

- **INT8 / INT4 / FP8**：推理显存 / 带宽省 2-8×。
- 平滑量化（AWQ / GPTQ）把敏感权重保留高精度。
- 与第 8 部分 XPU（FP8 Tensor Core）对接：FP8 训练正在成熟，能省一半显存。

---

## 十、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **显存账本**：Adam 下 ≈ 16×N bytes（权重2 + fp32 master 4 + m 4 + v 4 + 梯度2）。
> - **DP**：全量副本 + all-reduce，简单但装不下大模型。
> - **TP**：层内切矩阵，需要 NVLink（节点内）。
> - **PP**：按层切 + micro-batch 流水（1F1B 调度），通信少、跨节点友好。
> - **ZeRO**：把优化器状态/梯度/权重分片，1/2/3 级省 4/8/N 倍，通信≈DP。
> - **FSDP** = PyTorch 的 ZeRO-3；`FULL_SHARD`/`SHARD_GRAD_OP`/`NO_SHARD`。
> - **3D 并行** = TP×PP×DP，总卡数乘积；TP 节点内、PP/DP 跨节点。
> - **Checkpoint**：全量/权重/优化器三种；ZeRO-3 要 gather 完整权重再存。
> - **bf16** 是大模型训练标配；FP8 量化是推理显存救命药。

---

回主目录: [第十二部分 · 人工智能与机器学习 README](index.html).
