# 倒排索引与全文检索: Lucene / BM25 / Elasticsearch

## TL;DR

`WHERE name = 'foo'` 是精确匹配，B+ 树就够；`WHERE name LIKE '%foo%'` 是**子串匹配**，B+ 树直接退化全表扫。全文检索（Google 搜索、ES、Postgres 全文、代码搜索）用的是另一种索引结构：**倒排索引**——先分词，再为每个词维护"哪些文档包含它"的倒排表（posting list），查询时合并 posting list，用 **BM25** 打分排序。这一章讲清楚倒排索引的数据结构、Lucene 的磁盘布局与近实时语义、ES 在分布式下的搜索流程，以及"什么时候别用 ES 而用 PG 全文/ClickHouse"的工程判断。

读完应能：
1. 画出倒排索引的内存/磁盘结构（词典 → postings → 位置/载荷文件），说明为什么它支持子串/词级查询而 B+ 树不支持。
2. 手写 BM25 公式并能解释 IDF、饱和度、文档长度归一化三个直觉。
3. 讲清 Lucene 的 segment / immutable / merge / 墓碑删除机制，以及"删了的文档为什么还占磁盘"。
4. 说清 ES 一次搜索请求怎么走：routing → 分片 scatter/gather → 打分聚合 → DFS 结果合并。
5. 根据"数据量 / 实时性 / 查询模式 / 运维成本"给出 PG 全文 vs ES vs ClickHouse 的选型判断。

---

## 一、为什么 B+ 树做不了全文检索

`name LIKE '%foo%'` 在 B+ 树上的问题是：**前缀未知**，无法定位到树中的某个起始 key，只能从树的最小键扫到最大键——复杂度 O(N)。方向对的技术是**把"内容"翻过来建索引**：

```
正向:  文档1 = "apple banana"       文档2 = "banana cherry"
倒排:  apple  → [doc1]
       banana → [doc1, doc2]
       cherry → [doc2]
```

查询 `banana AND cherry` = 取两个 posting list **求交集**；查询 `apple OR cherry` = **求并集**。复杂度与"命中的文档数"成正比，而不是与"总文档数"成正比。

> [!NOTE]
> 倒排索引本质是**多值属性上的二级索引**：把"文档"这个实体的一个重复字段（词）拆成 N 行建索引。这和关系库里给数组字段建 GIN 索引是同一件事（见 [specialized.md](specialized.md) 的 GIN 一节）。

## 二、三段式结构

### 2.1 分词与 analyzer

建索引前先归一化文本：

- **tokenizer**：按 Unicode 属性切词（空白、标点、CJK 按词典/ngram 切）；
- **filter**：小写化、去停用词、词干化（stemming）、同义词扩展；
- 中文的坑：英文空格分词即可；中文要 **IK / jieba 词典分词或 ngram 切分**，否则"中华人民共和国"搜"中华"匹配不上。

分词结果决定召回率。**分析器不匹配是线上"搜不到"的第一大原因**：建索引用的 analyzer 与查询用的 analyzer 必须一致（或查询侧对每个词做同样的归一化）。

### 2.2 词典（dictionary / term index）

所有去重后的词，排好序存起来，支持 `O(log n)` 查找 + **前缀扫描**（`foo*` 查询依赖）。Lucene 的做法：

- `.tim`（term index）：内存中的 **FST（有限状态转换器）**，把词条前缀压缩成共享 DAG，几百万词条只占几百 KB 内存；
- `.tip`：FST 的根块指针；
- `.tmd` 旧版/`.tim`：词条 + 指向 postings 文件块的偏移。

> 为什么用 FST 而不是哈希表：哈希只能精确命中，FST 天然支持 `前缀 → 全部词条` 的枚举，且对字典序相邻的词条共享压缩——**内存换查询能力**。

### 2.3 倒排表（posting list）

对每个词存：

```
term "banana":
  [docID delta 编码] 1, 1, 3, 2 ...   ← 差值 + varint/PForDelta 压缩
  [频率]             3, 1, 2 ...
  [位置]             12, 45, 78 ...   ← 短语查询 / 高亮才需要
  [payload]          偏移、权重
```

压缩是关键：posting list 可能上亿条，Lucene 用 **Frame Of Reference（按 128 个 docID 一块，块内差值 + bit-packing）**，从"每条 4 字节"压到平均 1-2 字节。

## 三、查询执行: 合并与打分

### 3.1 合并策略

- **AND**：两个有序 posting list 做归并/跳表（posting 按 docID 升序，块内有最大 docID，可跳跃）；
- **OR**：归并取并；为了排序效率，**用块级 skip 先粗筛高频词**；
- **短语 "a b"**：先 AND 取交集，再比较位置差（需要 pos 文件）。

### 3.2 BM25 打分

BM25 是 Lucene 默认（取代旧 TF-IDF）的相关性公式：

$$\text{score}(q, d) = \sum_{t \in q} \text{IDF}(t) \cdot \frac{f_{t,d} (k_1 + 1)}{f_{t,d} + k_1 (1 - b + b \cdot \frac{|d|}{\text{avgdl}})}$$

$$\text{IDF}(t) = \ln\left(1 + \frac{N - n_t + 0.5}{n_t + 0.5}\right)$$

三个直觉：

| 项 | 直觉 | 工程含义 |
|----|------|---------|
| **TF 项（分子分子饱和）** | 一个词出现 10 次 ≠ 相关性是 1 次的 10 倍 | `k1 ≈ 1.2`，高频词收益递减 |
| **文档长度归一化** | 200 词文档里出现 1 次，比 2000 词文档里出现 1 次更相关 | `b ≈ 0.75` 惩罚长文档 |
| **IDF** | 越稀有的词区分度越高 | 停用词 IDF≈0，天然压权 |

> [!WARNING]
> 工程里 BM25 调参最常犯的错：**拿搜索词频最高的业务词（如"免费"）当热门词压权**，结果精准查询被噪声淹没。正确做法是先看查询日志的分布，再决定 `b`/`k1`，或加业务 boost 字段。

## 四、Lucene 的磁盘与近实时

### 4.1 segment: 不可变 + 后台合并

索引由多个 **segment**（段）组成，每个段是完整的小索引：

```
写入 → 攒内存 buffer → flush 成 segment 落盘 (只读)
后台 → merge 小段成大段 (合并同时把删除真正清除)
删除 → 只写墓碑 (tombstone), 不物理删
```

由此推出的三条铁律：

1. **写放大与 IO 放大**：segment 越多查询越慢（每段都要查），所以有 merge 策略（tiered merge）在段大小/数量间权衡；
2. **删除不立即释放磁盘**：只有 merge 才物理清除——"删了 1TB 数据磁盘没变小"是 ES 最常见投诉；
3. **refresh vs commit**：`refresh`（默认 1s）把 buffer 变成可搜索的 segment（**近实时**）；`commit` 才 fsync 落盘（**持久化**）。机器宕机丢的是两次 commit 之间的数据——所以 ES 用 translog 补。

### 4.2 与 B+ 树的对照

| | B+ 树 (InnoDB) | 倒排索引 (Lucene) |
|---|---|---|
| 可变性 | 就地更新，原地读最新 | 不可变 segment，删除靠墓碑 |
| 写入 | 随机写 + 页分裂 | 顺序追加，天然友好 SSD |
| 读 | 精确点查/范围 | 词级/短语/前缀，BM25 排序 |
| 压缩 | 页级 | FOR/字典压缩，内存友好 |
| 一致性 | WAL + 页日志 | translog + segment commit |

> 这解释了为什么"搜索引擎写优化"和"OLTP 读优化"选择相反的结构：**前者追求顺序写 + 大批量 merge，后者追求原地小改动 + 单行点查**。

## 五、Elasticsearch 分布式搜索

1. **路由**：`_id` 哈希 → 主分片（`shard = hash(_id) % num_shards`），副本参与读负载；
2. **scatter/gather**：查询请求发给所有相关分片；每个分片本地算 top-K（**shard 级截断**）；
3. **协调节点合并**：把各分片 top-K 汇总再精排。

> [!WARNING]
> ES 深分页（`from + size`）要取 `from+size` 个结果再丢弃——`from=100000` 会让协调节点汇总 100000×N 条，几乎必 OOM。方案：`search_after`（游标）、scroll（快照）、或索引按时间分片只搜必要分片。

### 5.1 相关性问题

分片级 top-K 的近似性：每个分片只看自己的 top-K，若某词在某分片密集出现，可能漏掉全局真正的 top-10。解决：**只读少分片（按路由把同类文档放同分片）、或用 DFS query-then-fetch 先全局统计 IDF**（代价高，默认关）。

## 六、工程选型

| 场景 | 选择 | 理由 |
|------|------|------|
| 交易库内小规模全文/`ILIKE` | PG `tsvector` / pg_trgm | 与事务同库，无数据同步延迟 |
| 日志 / 可观测（高写入、偏 append） | ES / OpenSearch / Loki | 写放大可接受，查询灵活 |
| 大规模离线分析 + 偶尔全文 | ClickHouse（带 bloom/倒排） | 列存扫描 + 压缩，吞吐优先 |
| 代码/大规模文档精确词检索 | ES + ngram + highlight | 位置信息支持高亮与短语 |
| 业务属性过滤 + 少量关键词 | PG JSONB GIN / ES 混合 | 避免 ES 运维成本 |

**通用铁律**：全文检索的实时性、一致性、容量三者只能选两个——`refresh_interval=1s` 的近实时 + 异步刷盘 = 可能有秒级丢失；要强一致要么引外部队列（如 Kafka → ES），要么接受近似。

## 七、一页速查

```
索引结构:  词典(FST) → 倒排表(差值压缩) → 位置/载荷
查询:      AND=交集 / OR=并集 / 短语=位置差 / 前缀=FST 扫描
打分:      BM25 = IDF × 饱和TF × 长度归一化
磁盘:      segment 不可变 + 墓碑删除 + 后台 merge
实时性:    refresh(可搜,1s) vs commit(fsync) vs translog(不丢)
分布式:    路由哈希 + scatter/gather + 协调节点合并
选型:      交易内=PG / 日志观测=ES / 离线分析=ClickHouse
```

下一篇: [执行计划: explain analyze 怎么读](explain.md)。
