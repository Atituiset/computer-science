# 13. LLM 推理与部署: KV Cache / PagedAttention / 连续批处理 / 量化

## TL;DR

训练决定了模型"会什么"，推理决定了模型"多贵、多快、能服务多少人"。LLM 推理的物理瓶颈不是算力而是**显存带宽**：decode 阶段每生成 1 个 token 都要把全部权重读一遍，且 **KV cache**（历史的 key/value 缓存）随序列长度线性增长、按请求动态分配——这两点催生了 vLLM 的 **PagedAttention**（按物理块分配显存，消除碎片）和**连续批处理**（新请求动态插入解码中的请求）。再叠加**投机解码**（小模型草稿 + 大模型验证）和**量化**（GPTQ/AWQ，权重压到 4bit）后，一个 70B 模型才能在单卡上跑出可用的吞吐。这一章给全链路的数字账本和工程架构。

读完应能：
1. 推导 decode 的 token 速度公式（≈ 显存带宽 / 模型字节数），并解释为什么小模型不一定比大模型便宜。
2. 写出 KV cache 的显存公式（2 × layers × kv_heads × head_dim × seq_len × bytes），说出 GQA/MQA 解决什么。
3. 讲清 PagedAttention 的物理块/逻辑块映射与连续批处理的收益（显存利用率、调度自由度）。
4. 解释投机解码为什么"多算一次小模型反而更快"，以及量化 W4A16 的误差来源与校准（GPTQ/AWQ）。
5. 画出生产 serving 架构：prefill/decode 分离、GPU 池、路由、弹性扩容、容灾。

---

## 一、先算账: decode 为什么慢

LLM 推理分两个阶段：

- **prefill**：一次处理整个 prompt，并行度高，受**计算**（FLOPs）限制；
- **decode**：逐 token 生成，每次只算 1 个 token，受**显存带宽**限制。

decode 每步的耗时 ≈ **读一遍全部权重的时间**：

$$\text{tokens/s} \approx \frac{BW_{\text{HBM}}}{\text{模型字节数}}$$

以 70B fp16 模型（140 GB）、H100（3.35 TB/s）为例：$3350/140 \approx 24$ tokens/s——这是**单请求理论上限**，实际 10-15 tokens/s 就很好了。

> [!WARNING]
> 反直觉结论：**模型小一倍 ≠ 快一倍**。7B 和 70B 都吃同样的"每 token 读全部权重"，7B 只是少几倍字节（且更吃不到带宽饱和）。真正让吞吐起飞的是**同时服务多个请求共享权重读**——批处理是唯一免费午餐。

## 二、KV cache: 推理显存的头号消耗

自注意力里，每个历史 token 的 K/V 都要留给后续 token 查询：

$$\text{KV bytes} = 2(\text{K+V}) \times \text{layers} \times \text{kv_heads} \times \text{head_dim} \times \text{seq\_len} \times \text{bytes}$$

70B（80 layers, GQA-8, head_dim 128, fp16）在 4K 上下文：

$$2 \times 80 \times 8 \times 128 \times 4096 \times 2 \text{B} \approx 1.34 \text{ GB / 请求}$$

4096 并发请求就要 ~5.5 TB——**超过单机显存**。KV cache 是"按请求动态分配、随生成长短不一"的内存，和操作系统面临的内存碎片问题一模一样，于是有了 PagedAttention。

### GQA / MQA

多头注意力每头一份 KV（MHA）太贵；**MQA**（所有头共享 1 份 KV）省显存但损质量；**GQA**（分若干组共享）是折中——Llama 2/3 70B 用 GQA-8，KV 直接除以 8。这是"用质量换显存"的教科书权衡。

## 三、PagedAttention / vLLM

### 3.1 问题

朴素实现：请求进来一次性分配 `max_seq_len` 的连续显存。结果：

- **内部碎片**：每个请求只用到一小段；
- **外部碎片**：连续分配在并发请求间互相挤压；
- 显存利用率往往只有 20-40%。

### 3.2 解法: 按块分配

```
逻辑 KV cache (连续 token 序列)
  [t0 t1 t2 t3 | t4 t5 t6 t7 | t8 ...]
      ↓  逻辑块 → 物理块映射 (类似虚拟内存页表)
物理块 (固定大小, 如 16 tokens/block, 分散在显存各处)
  [block 7] [block 3] [block 9] ...
```

- 按需分配物理块，**不需要预测最大长度** → 内部碎片消除；
- 块可分散 → 外部碎片消除，且**多请求可共享同一物理块**（beam search/前缀缓存）；
- 代价：block table 一次间接寻址 + 块内 padding（最后一个块不满）。

### 3.3 连续批处理（Continuous Batching）

传统静态批处理：等整批全部生成完才回收。连续批处理让**新请求随时插入**解码中的批次：

```
t=0: [A prefill] [B decode] [C decode]
t=1: [B decode] [C decode] [D prefill]   ← D 插队, A 已结束
```

收益：吞吐量提升 2-10 倍（大模型多 10x），因为 decode 的带宽受限状态能一直满载。调度策略（FCFS、SJF、抢占）直接决定吞吐 vs 延迟的曲线——这又是 OS 调度问题的镜像。

## 四、投机解码: 多算一次反而更快

大模型逐 token 生成是串行的，但**验证多个候选 token 可以并行**：

1. 小模型（draft model）快速生成 k 个候选 token；
2. 大模型一次 prefill 并行验证 k 个位置；
3. 从首个不一致处截断，接受一致的前缀。

加速比 ≈ 草稿接受率 × k（接受率高时接近 k 倍）。典型：70B + 小草稿可达 2-3x。变体：**self-speculative**（同模型浅层草稿）、**Medusa**（额外 head 并行预测）。限制：草稿模型要与大模型分布接近，且 k 太大时验证成本上升。

## 五、量化推理: 4bit 权重 + 16bit 激活

decode 瓶颈是带宽，所以**权重越小越快**。W4A16（权重 4bit、激活 16bit）把 70B 从 140GB 压到 ~35GB——单卡 H100 直接能跑。

朴素 RTN（round-to-nearest）误差大，于是有：

| 方法 | 核心思想 | 特点 |
|---|---|---|
| **GPTQ** | 逐层逐列做**二阶近似误差最小化**（Hessian 逆），量化时补偿 | 一次性离线量化，精度好 |
| **AWQ** | 观察激活分布，**按通道保护重要权重**（缩放通道） | 不重训，速度快，精度稳 |
| **FP8 训练后量化** | 直接 FP8，H100 原生支持 | 精度损失小，工业默认 |
| **KV cache 量化（FP8/INT8）** | 压 KV 而非权重 | 显存减半，长上下文必备 |

> [!WARNING]
> 量化后一定要**看下游任务精度而不是困惑度**：4bit 对推理/代码任务往往无感，但对数学/长尾知识任务可能掉点。生产上线流程 = 离线校准 → 任务集评测 → A/B 灰度，缺一不可。

## 六、生产 serving 架构

```
客户端 ─► API Gateway ─► 调度/路由 (按模型、按租户、按负载)
              │
              ├─► Prefill 池 (算力密集, A100/H100)
              │       │  KVCache/激活经 RDMA/PCIe 传递
              ├─► Decode 池 (带宽密集, 长 KV cache)
              │       │  → vLLM/TensorRT-LLM/SGLang
              └─► 冷路径: 量化/蒸馏模型、请求排队、限流、回退
```

关键设计点：

- **PD 分离（prefill/decode disaggregation）**：prefill 吃算力、decode 吃带宽，混跑互相拖累；分离后各自最优批大小，但 KV 传输有成本；
- **前缀缓存**：系统提示词/文档前缀共享 KV 块（PagedAttention 的共享能力），长文档 RAG 场景吞吐翻倍；
- **弹性与容灾**：按 QPS 扩缩容、队列背压、超时降级（小模型兜底）、多副本灰度；
- **观察指标**：TTFT（首 token 延迟）、TPOT/ITL（token 间隔）、吞吐（tokens/s/GPU）、KV 命中率、队列深度。

## 七、一页速查

```
瓶颈:  prefill=算力, decode=带宽; tokens/s ≈ 带宽/权重字节
KV:    2×L×kv_heads×head_dim×seq×bytes; GQA/MQA 除以组数
PagedAttention: 逻辑块→物理块映射, 消除内外碎片, 支持共享
批处理: 连续批处理让新请求插队 → 吞吐 2-10x
加速:   投机解码(草稿+验证) 2-3x; 前缀缓存共享 KV
量化:   W4A16: GPTQ/AWQ/FP8; KV 量化撑长上下文
架构:   PD 分离 + GPU 池 + 路由/限流 + 弹性; 盯 TTFT/TPOT/吞吐
```

下一篇: [元抽象卷 · 跨章节大主题](../_meta/README.md)。
