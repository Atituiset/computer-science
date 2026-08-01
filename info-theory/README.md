# 第十一部分 · 信息论与编码

## 一句话

Shannon 1948 "A Mathematical Theory of Communication" 提出:**信息 (information)** 是可量化的——一个事件 $X$ 的"信息量"$I(x) = -\log_2 P(x)$ bits. 这条单公式衍生了三大主轴: **(1) 信息压缩的极限 = 熵 $H(X)$**; **(2) 通信信道的极限 = 信道容量 $C = B \log_2(1+\text{SNR})$**; **(3) 故障检测与纠正的极限 = 纠错码**. 每一条都直接决定了我们今天的 5G NR 控制信道用 Polar 码 (Arikan 2008)、数据信道用 LDPC、4G 用 Turbo 码; QR 码 / SSD / RAID 6 / CD-ROM 用 Reed-Solomon; 软件压缩 zstd 用 LZ77 + ANS / Huffman encoder. 信息论既是理论与工程的桥梁, 也是物理定律 (信噪比的香农极限) 在数字通信上现实化.

## 思想链

```
[Streaming 4K HDR video over 5G mmWave]
  └─> RAW: 12-bit × 7680×4320 × 60 Hz × 3 = 11.9 Gbit/s 原始比特流
       └─> H.265 视频压缩 (intra + inter + DCT)
            └─> ~25 Mbit/s (压缩比 ~500×)
                  └─> 离熵 H(X): H.265 利用 spatial / temporal redundancy
                       └─> 信道编码: 5G NR LDPC (data) / Polar code (control)
                             └─> 添加 ~30% redundancy bit-rate 5/6
                                   └─> QAM 调制: 64/256-QAM with constellation shaping
                                         └─> OFDM: 100 MHz bandwidth, subcarriers 1200
                                               └─> 香农极限: B log(1+SNR) = 100M × log₂(1+20) ≈ 432 Mbit/s
                                                     └─> 实测 1.2 Gbit/s peak (with MIMO 4×4 spatial streams)
                                                           └─> 距香农限不到 3 dB 实践范: SNR margin
```

任何一层**redundancy → entropy → coding → modulation**, 每 error 从产业科学家 to 工程师逐环扣死. **数学极限 vs 工业极限**只有这个学科塞死了这条直游戏.

## 章节

- [开篇：从 Shannon 1948 到 5G NR 编解码设计](index.html) ← 当前
- [1. Shannon Entropy: 离散源熵 / 联合熵 / 条件熵 / 互信息](entropy.md)
- [2. 信道容量: 香农公式 C = B · log₂(1 + SNR)](capacity.md)
- [3. 无损压缩: 哈夫曼 / LZ77 / LZ78 / zstd / 算术编码 / ANS](compression.md)
- [4. 汉明码: 可纠 1-bit 错误的鼻祖](hamming.md)
- [5. Reed-Solomon 在 GF(2⁸) 上的纠错码](reed-solomon.md)
- [6. BCH 码、循环码与多项式基础](bch.md)
- [7. LDPC 码: 5G NR 数据信道与 Tanner 图](ldpc.md)
- [8. Polar 码: Arikan 2008 构造与 5G NR 控制信道](polar.md)
- [9. Turbo 码: 3G/4G 并行级联卷积码与 BCJR 迭代](turbo.md)
- [10. 调制: QPSK / 16-QAM / 64-QAM 星座图与误码率](modulation.md)
- [附录: 编码率 / 纠错能力 / SNR 实践速查](appendix.md)

读完应能:

1. 给离散无记忆源 $X$, 算熵 $H(X) = -\sum p_i \log_2 p_i$; 给联合分布, 算 $H(X, Y)$, $H(X|Y)$, $I(X;Y)$. 链式法则 $H(X, Y) = H(X) + H(Y|X)$ 怎么从独立逐步推到条件.
2. 说"信源编码定理 (Shannon's source coding theorem)": 任何无损压缩的期望长度下界 ≥ $H(X)$. 例: 英语字母源熵 ~4.5 bits / char, ASCII 8 bits 过冗余度 ~44%.
3. 香农容量 $C = B \log_2(1 + S/N)$ 推导: AWGN 信道下 high-SNR 渐近给出 ~$B \log_2 \text{SNR}$. 实践 5G mmWave 上 100 MHz 带宽, 25 dB SNR ⇒ 理论 830 Mbit/s, 实测 5G 峰 1.4 Gbit/s (MIMO 4x4).
4. Huffman 编码本质 greedy 在频率上建前缀树, 但只能 approaching 整数 bit per symbol; 算术编码可以到分数 bit per symbol; ANS (Asymmetric Numeral Systems) 巧用进制 lattice 表搞出来 — zstd 生效.
5. 汉明码 (7,4) 用奇偶校验矩阵 H 设计所进入=3 (Hu Porge), 单 e bit error recoverable; SECDED 加 1 个 overall parity bit 纠 1-bit + 检 2-bit.
6. Reed-Solomon (n, k) on GF(2^8) 用 generator polynomial $\prod(x - \alpha^i)$ for i = 1..(n-k); 修 erasure (CD / QR / SSD) 与错误 (TB Detect cord); RAID 6 双 RS-tolerant.
7. LDPC 用 sparse parity check matrix + Belief Propagation iterative decoder; complexity linear in n; design near-Shannon; 5G 数据信道选用. Tanner 图, girth ≥ 6.
8. Polar code (Arikan 2008) 用 channel polarization: fair split 与 unfair split, half 渐进无噪 / half 渐进全噪. 选择 "good" channels for data; "frozen" 部分固定.
9. Turbo 码: 2 RSC + interleaver + BCJR MAP decoder iterate; 3G/4G 起; 收敛速度劣于 LDPC, 5G 弃用 data 用 LDPC.
10. QPSK / 16-QAM / 64-QAM 的 constellation packing 定 bit/symbol; 与 SNR-coupled BER (QAM-64 在 21 dB SNR 下 BER ~10⁻⁵; coding 后 effective BER ~10⁻¹²).
11. 现代卷积码 + Viterbi decoder; 5G 物理广播 channel (PBCH) 还在用 Polar; data 层 LDPC; LTE 在 turbo 主导 4G.

## 历史 1: 1948 Shannon 论文一锤定音

Claude Shannon 在 Bell System Technical Journal 发表 "A Mathematical Theory of Communication", 引入 "bit" (binary digit) 概念, 区分信源 entropy vs 信道 capacity, 既给"压缩极限"又给"通信极限". 这一 paper 同时建立"信息论"与"编码论"两个领域. 此前 Hartley 1928 给节 "R = B log S" 简易版本; Shannon 把统计级加入.

## 历史 2: 1950 Hamming (7,4)

Richard Hamming 在 Bell Lab 与 Shannon 同时代, 因 weekends 实算 error bit 被后烦, 设计汉明码. 论文 1950 发, 第一 systematic error-correcting code. 直接 7 bit = 4 bit data + 3 bit parity, 单 bit 纠错. Hamming distance 概念 同引出.

## 历史 3: 1960 Reed-Solomon

Irving Reed 与 Gustave Solomon 在 MIT Lincoln Lab 给出 GF(2^m) 上 BCH 类码系统, 纠 erasure (data loss 已知位置)达  $n - k$, 纠错误 (位置不知) 达 $(n-k)/2$. CD-ROM / DVD / QR / DSL 全部仍然在用. RS(255, 223) 给 16 字节 纠错: 这是空间探测器 Voyager / Galileo 上上行.

## 历史 4: 1993 Berrou Turbo 码

Berrou-Glavieux-Thitimajshima 发表 "Near Shannon limit error-correcting coding" 在 ICC, 重写"香农限"概念——首次在 iteration 实验中观测到香农 ⼀≤ 1 dB. 业界就 quickly adopt 到 3G/4G 移动 communication 提出 consistency. 论文 originally 拒 paper from 1991 ICS conference on theory '认为不'are unworkable'; final 来 1993 era takes broad acceptance 此 45-year Shannon limit 真类似.

## 历史 5: 1996 MacKay-Neal LDPC 重发现

Gallager 1963 MIT dissertation 给 LDPC; 学术 default 'not practical'; 1996 MacKay 与 Neal 重新发现 r 密度 sparse parity matrix + belief propagation iterative decoding → 给接近 Shannon 极限的性能, 业内对 LDPC 're-embrace'. DVB-S2 2003, WiFi 802.11n 2009, 5G NR 2016 data channel 用 LDPC 取代 Turbo.

## 历史 6: 2008 Arikan Polar 码

Erdal Arikan 在 Bilkent Univ 论 "Channel Polarization" 给出 deterministic code 接近 Shannon limit. 2016 3GPP RAN1 选择 Polar code 给 5G NR 控制信道 (短 message 短 coding). Polar 比 convolution/Turbo 在 short coding 给更显优势.

## 历史 7: 2014-2020 zstd / ANS / Brotli

Jarek Duda 2006/2009 提出 ANS (Asymmetric Numeral Systems) 新编码 family, software 行 fast and throughput 化 entropy coding. Zstd Facebook 2015; Brotli Google 2015; LZ4 / zstd 给 现代压缩 pipeline (HTTP content-encoding br, zstd). BLAKE3 类作 hash + compression test drives equilibrium.

## 历史 8: 2009-2024 5G NR 物理层标准化

3GPP Release 15 (2017-2018): 决策 LDPC for data (eMBB, long block sizes), Polar for control (short codes), 短 code 用 TBConv编码 legacy. Release 16-17 加入 URLLC 物理层 PID 极 support URLLC for industrial IoT; pilot channels Under non-3GPP RAN; ATIS RC 确上行 TX 按内 polar-coded.

---

下一节 → [Shannon Entropy](entropy.md)
