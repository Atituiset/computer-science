# 排序

## 排序算法脑图

| 算法 | 平均 | 最坏 | 空间 | 稳定 | 特点 |
|------|------|------|------|------|------|
| 插入 | O(n²) | O(n²) | O(1) | ✅ | 小数据 / 几乎排序时最佳 |
| 冒泡 | O(n²) | O(n²) | O(1) | ✅ | 教学用 |
| 选择 | O(n²) | O(n²) | O(1) | ❌ | 教学用 |
| 归并 | O(n log n) | O(n log n) | O(n) | ✅ | stable; 外排序主力 |
| 快速 | O(n log n) | O(n²) | O(log n) | ❌ | 大多实际最快 |
| 堆 | O(n log n) | O(n log n) | O(1) | ❌ | 适合 priority queue |
| 希尔 | O(n^1.25) | ~ | O(1) | ❌ | 实操排序最快之一 |
| 基数 | O(nk) | O(nk) | O(n+k) | ✅ | 整数 / 字符串场景 |
| 计数 | O(n+k) | O(n+k) | O(k) | ✅ | k 有限值 |
| Tim Sort | O(n log n) | O(n log n) | O(n) | ✅ | Python / Java 实战默认 |
| pdqsort (Rust) | O(n log n) | O(n log n) | O(log n) | ❌ | 实操 vs 三路快排改进, 加插入 fallback |

## 快排: 为什么它最常用

常数小, 且**就地**. 结合三数取中、三路快排 (Dutch flag), 可让含大量重复元素场景不再退化.

```
quicksort(L, R):
  while L < R:
    pivot = median3(a[L], a[(L+R)/2], a[R])
    [i, j] = threeWayPartition(a, L, R, pivot)
    if i-L < R-j:
      quicksort(L, i-1); L = j+1
    else:
      quicksort(j+1, R); R = i-1   // 递归改迭代, 省栈
```

`Lomuto` 简单但退化多, `Hoare` 更平均; `pdqsort` 加 pivot 选择 + 长度阈值后用插入排序.

## 外排 (External Sort)

数据远大于内存: 分成多个 chunk, 每个排序后落盘, 然后 K 路合并. 常用 k-ary heap.

**MapReduce 的 sort phase 本质就是这个**.

## 工程现实

- Python 默认 `sorted` = Timsort.
- Rust 默认 = pdqsort (修正版 intro sort).
- C++ std::sort = introsort (heap fallback).
- Go 不暴露 stable sort 单独 API; `sort.Slice` 用 pdqsort; `sort.SliceStable` 用插入合并.
- Java `Collections.sort` 用 TimSort, 原始类型数组 `Arrays.sort` 用双轴快排.

## 易错

1. **快排取 pivot 时退化**: 对已序数组 / 全相同数组. 三数取中 + 三路 + 长度阈值 → 几乎免疫.
2. **整数溢出**: `(L+R)/2` 用 `L + (R-L)/2`.
3. **stable vs unstable**: 排序后保留原序, 业务上大多要求稳定.

## 经典题

- 排定 K 个数组: LC 23 合并 K 个排序链表.
- LC 315 计算右侧小于当前元素的个数 (归并副产物).
- LC 164 最大间距 (桶排序 O(n)).
