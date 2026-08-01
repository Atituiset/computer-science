# 缓存

缓存不解决性能问题, 它只把问题前移——把"DB 单次 5ms 查询"变成"缓存 0.5ms 查询", 但 cache hit ratio/staleness/eviction/失效成为新的复杂度来源。 几行 cache 代码就让运维复杂度爆炸——黄疸/雪崩/穿透/击穿 是工程师必须懂的话题。

- [多级缓存](multilevel.md) — 进程内 / Redis / CDN / HTTP cache / OS page cache
- [缓存模式](patterns.md) — cache-aside / read-through / write-through / write-back
- [缓存失效模式与雪崩/穿透/击穿](failure-modes.md)
