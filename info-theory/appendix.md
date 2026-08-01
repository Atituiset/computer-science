# 附录: 编码率 / 纠错能力 / SNR 实践速查

## A.1 — Code families

| 码族 | n / k | min distance | 纠错能力 | 编码率 | 解码复杂度 |
|------|-------|------|------|------|----|
| Hamming (7,4) | 7/4 | 3 | 1 bit | 4/7 ≈ 0.571 | O(n) |
| Hamming SECDED (8,4) | 8/4 | 4 | 1 bit 纠 / 2 bit 检 | 4/8 = 0.5 | O(n) |
| Repetition (5,1) | 5/1 | 5 | 2 bit | 1/5 = 0.2 | O(n) trivial |
| RS(255, 223) | 255/223 | $2t+1$ | 16 symbol error / 32 erasure | 0.875 | O(n t²) |
| BCH(255, 207) | 255/207 | ≥17 | 8 bit error | 0.812 | O(n t²) |
| LDPC QC (8448) | 6688 data | varied | near-capacity at SNR | 0.5 to 0.9 | O(n) BP iters |
| Polar (1024) | K (32-1024) | varies | ≤ 0.5 dB Shannon dist | 0.1 to 1/2 | O(n log n) SCL |
| Turbo PCCC (LTE) | 6144/2048 | varies | 1 dB Shannon dist | 1/3 base; punctured 0.9 | O(n) iters |
| Convolutional (K=7, rate 1/2) | streaming | varies | 4-5 dB coding gain | 1/2 typical | O(n) Viterbi |
| CRC32C | — | — | detect only | overhead 4 bytes / 4 KB | O(n) |
| Hamming ECC DRAM | 72/64 | 4 | 1 err 纠 / 2 err 检 | 0.889 | O(n) |

## A.2 — Channel coding choices

| Use case | Code | Notes |
|---------|------|-------|
| DRAM ECC | SECDED Hamming (72,64) | system memory universal |
| CD-ROM | CIRC RS(32,28) + RS(28,24) | interleaved robustness burst errors |
| DVD | RS-PC RS(208,192) + RS(182,172) | product code |
| QR Code | RS(40,26) baseline version 系列 | shortened per block |
| DSL | RS(255,239) | string Independent ITU |
| Wi-Fi | LDPC (802.11n/ac/ax/be) + Convolutional legacy | 11n+ LDPC |
| 4G LTE control |咬 bite-rate pre QPP interleaver + Turbo | 范本 3G/4G |
| 5G NR control | Polar + CRC | short code polar decoders |
| 5G NR data | LDPC + CRC | 块数据充|
| Satellite DSN | RS(255,223) + Convolutional (rate 1/2, K=7) | Voyager / Cassini / Galileo |
| DVB-S2 (satellite TV) | BCH(8192,6460) + LDPC(64800,43200) | near-Shannon + 双 outer protection |
| WiMAX | RS + Convolutional | old wireless broadband |
| Storage RAID 6 | RS over GF(2^8) | redundancy dual disk failure |
| ZFS raidz3 | 3 parity (braided RS/TP) | triple disk failure |

## A.3 — Modulation and per bit-symbol efficiency

| Modulation | Bits/symbol | Mandatory SNR @ BER 10⁻⁵ (uncoded) | SNR with code |
|---------|------------|-------|---------|
| BPSK | 1 | 9.6 dB | ~2 dB w/ LDPC |
| QPSK | 2 | 9.6 dB | ~2 dB w/ LDPC |
| 8-PSK | 3 | 14 dB | ~6 dB w/ LDPC |
| 16-QAM | 4 | 14.4 dB | ~6.5 dB w/ LDPC |
| 64-QAM | 6 | 18.9 dB | ~10 dB |
| 256-QAM | 8 | 24.4 dB | ~16 dB |
| 1024-QAM | 10 | 28.4 dB | ~20 dB |

→ 低 SNR 区 域 BPSK/QPSK 稳健. 64-QAM 之上须 cell edge / hot beam 同 hind sing fine structure coding with shaping or shaping.

## A.4 — Shannon limit reference table

| Bandwidth | SNR | Capacity (single stream) | 5G modeled peak (MIMO) |
|-----------|-----|----------|------|
| 20 MHz | 10 dB | 70 Mbit/s | 100 (LTE Cat 4), 700 (LTE LAA) |
| 100 MHz | 10 dB | 346 Mbit/s | 700-1200 Mbit/s 4×4 MIMO |
| 100 MHz | 20 dB | 665 Mbit/s | 1500 |
| 400 MHz | 20 dB | 2663 Mbit/s | 4500 mmWave MIMO |
| 1 GHz (mmWave) | 20 dB | 6.65 Gbit/s | 8-10 Gbit/s peak single phone |
| 2 GHz (mmWave) | 30 dB | 13 Gbit/s | 14-20 Gbit/s (MIMO 16 layer) |

行业 statistic 范本工 peak 5G 数达到 close to Shannon (35% under face Survey practical due to implementation loss).

## A.5 — Coding gain hierarchy

最近 Shannon 极限 ≈ lower = 0:

1. **Polar codes (SCL):** ~0.5 dB at short lengths (≤ 1K)
2. **LDPC:** ~0.5 dB at long lengths (≥ 10K)
3. **Turbo codes:** ~0.8 dB at moderate lengths (1K-10K)
4. **RS+Conv. (Voyager):** ~2-3 dB at rate 0.5
5. **BCH+RS (DVB-S2 outer BCH):** ~2-4 dB hybrid concatenated
6. **Hamming (7,4):** ~3 dB at cost of rate 4/7 overhead
7. **Repetition codes:** linear rate half 何 巨 后成

---

## A.6 — Practical implementation references

- **Software**: turbo decode `libturbo`, LDPC `gr-ldpc` `openairinterface5g`, Polar nrPolar decoder in OAI 5G PHY.
- **Hardware accelerators**: ASIC 5G Qualcomm X55-coded coding modules production polar/LDPC throughput 三code gigabaud per second.
- **Field test tools**: `srsRAN` opensource 5G NR base+ue prototype.
- **Wireshark 调制 demod probes**: Wi-Fi decoders show QAM constellation charts in real time as part of `QAMVisualizer`.

## A.7 — 与项目其他章节交叉

- **complexity.md** / **factoriz-ation**: code **distance** metric leaves distance encoded trade-off among code rates.
- **crypto/zkp.md**: probabilistic checkable proofs 在 encoding castle erasure code moral distance 不可通似 proof verify independent paths.
- **distributed/fault/erasure.md**: erasure code 是 RS-based 内 correlated system communityedition 然 ML-KEM Kyber formal blowing codes.
- **databases/olap/lakehouse.md**: columns compression with zstd codecs should integrate with erasure code separate file..
- **crypto/signatures.md**: ECC DR BG  agents 高 needs must frequently compatible frequency for studio bit modes.
