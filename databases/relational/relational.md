# 关系代数与 SQL semantics

## TL;DR

Codd 1970 的关系代数是真"理论"——σ / ∏ / × / ∪ / − / ρ 六个原语 + ⨝ join 衍生。SQL 是关系代数的可读文字形态加上工程便利扩展（GROUP BY / 聚合 / 窗口 / NULL 三值逻辑 / CTE / 递归 / Recursive）。本节从关系代数走到 planner 的 rule-based 重写规则、SQL 三值逻辑的踩雷、CTE decorrelation 实战、window 函数执行模型——这一节是看懂任何 DB 的 explain plan 的入门钥匙。

---

## 一、关系代数六个原语

| 符号 | 名字 | SQL 对应 |
|------|------|----------|
| σ_p(R) | selection | `SELECT * FROM R WHERE p` |
| ∏_A(R) | projection | `SELECT A FROM R` |
| R×S | cartesian product | `SELECT * FROM R, S` (no join) |
| R∪S | union | `UNION` |
| R−S | set difference | `EXCEPT` |
| ρ_N(R) | rename | `R AS N` |
| R⨝_p S | join (衍生) | `JOIN ON p` |
| γ_A,agg(R) | group-by (衍生) | `GROUP BY A` |
| τ(R) | sort (工程扩展) | `ORDER BY` |

## 二、关系代数到 SQL 的映射

```sql
SELECT u.name, COUNT(o.id)
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.age > 18
GROUP BY u.name
HAVING COUNT(o.id) > 5
ORDER BY COUNT(o.id) DESC
```

抽象成代数树：

```
τ_count desc    ← ORDER BY
  └─ γ_name, COUNT(id)  HAVING COUNT(id) > 5    ← GROUP BY + HAVING
       └─ σ_age > 18   ← WHERE
            └─ ⨝_id=user_id (left)   ← LEFT JOIN
                 ├─ users (R)
                 └─ orders (S)
```

每节点对应一个 physical operator，planner 通过代数规则重排节点顺序以最小化 cost。

---

## 三、planner 的代数变换规则

| 规则 | 原始 | 重写后 | 实际收益 |
|------|------|--------|----------|
| predicate pushdown | `∏(σ_p(R))` | `σ_p(∏(R))` | 减少扫描量 |
| join reordering | `R ⨝ (S ⨝ T)` | `(R ⨝ S) ⨝ T` | 选小/中表先 join |
| projection pushdown | `∏_{A,B}(σ_p(R))` | `σ_p(∏_{A,B}(R))` | 列裁剪减 IO |
| join predicate pushdown | `σ_p(R ⨝ S)` | `σ_p(R) ⨝ S` | 早过滤 |
| constant folding | `1 + 1 > 2` | `TRUE` | 简化 |
| subquery decorrelation | `SELECT ... WHERE x IN (SELECT y FROM T)` | `LEFT SEMI JOIN` | 重写为 join |
| common subexpression elimination | `∏_∩(σ_p(R) ∪ σ_q(R))` | `∏_∩(σ_{p∨q}(R))` | 减少重复扫描 |
| dead branch removal | `σ_{0=1}(R)` | empty relation | 计算消除 |

PostgreSQL 用 13.x 的 GEQO (Gen代算法) + dynamic programming 做 join reordering。当 join 数 >12 表时切换到遗传算法避免组合爆炸。MySQL 8.0 起 optimizer 也支持 hash join 重写，之前仅 nested loop。

---

## 四、三值逻辑（NULL）

SQL 的 `NULL` 是 **UNKNOWN**（不是 0 也不是 false），引入三值逻辑。老师常忽略：

### AND / OR / NOT 真值表

| AND | T | F | U |  OR | T | F | U |
|-----|---|---|---|-----|---|---|---|
| T   | T | F | U | T   | T | T | T |
| F   | F | F | F | F   | T | F | U |
| U   | U | F | U | U   | T | U | U |

### WHERE 子句与 NULL

`WHERE p` 选择 `p == TRUE`，UNKNOWN 与 FALSE 都被排除：

```sql
SELECT * FROM users WHERE age > 18;       -- age=NULL 不返回，因 UNKNOWN 排除
SELECT * FROM users WHERE age <= 18 OR age IS NULL;  -- 取得 NULL
SELECT * FROM users WHERE age != 18;      -- NULL 不返回
```

### Aggregate 与 NULL

| 函数 | 行为 |
|------|------|
| `COUNT(*)` | 数所有行（包括 NULL） |
| `COUNT(col)` | 跳过 NULL |
| `SUM(col)` | 跳过 NULL |
| `AVG(col)` | 跳过 NULL（分母是 non-NULL 计数） |
| `GROUP BY` | NULL 算一个组 |
| `ORDER BY` | PostgreSQL 默认 NULL last (ASC)，MySQL 默认 NULL first |
| `UNION` | 去重 NULL，与 `5` 和 `NULL` 是不同行 |

### 实战坑

```sql
-- ❌ 想找"不为 true"的行
SELECT * FROM users WHERE active = FALSE;
-- 返回 active=FALSE 行；忽略 active=NULL

-- ✅ 正确版
SELECT * FROM users WHERE active IS NOT TRUE;
-- 返回 active=FALSE 或 NULL
```

```sql
-- 还原窗口 + NULL
-- LEAD(col) over NULL → 仍返回 NULL
-- FIRST_VALUE(col) IGNORE NULLS (PostgreSQL 没原生语法，需要 workaround)
```

---

## 五、SQL:1999 OLAP 扩展

### 5.1 window 函数

```sql
SELECT
    user_id, order_amount,
    SUM(order_amount) OVER (
        PARTITION BY user_id
        ORDER BY created_at
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS cum_amount,
    LAG(order_amount, 1) OVER (
        PARTITION BY user_id ORDER BY created_at
    ) AS prev_amount,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS rn
FROM orders
```

执行模型：
1. PARTITION BY 按 key 分桶（hash 或 sort）
2. ORDER BY 桶内排序
3. 滑动窗口聚合：每行扫描时按 window frame 移动累加 / 求 sum / min / max
4. LEAD/LAG/ROW_NUMBER 通过 sort + 上一行 offset 实现
5. NTILE 用 sample count percentile 切分

PostgreSQL 13 加 `RANGE BETWEEN INTERVAL '1 day' PRECEDING AND CURRENT ROW` 支持。DuckDB 1.0 支持任意 window frame expression。

### 5.2 CTE (Common Table Expression)

```sql
WITH recent_orders AS (
    SELECT * FROM orders WHERE created_at > '2024-01-01'
),
top_users AS (
    SELECT user_id FROM recent_orders GROUP BY user_id LIMIT 10
)
SELECT * FROM top_users;
```

Postgres 12 之前 CTE 是 **optimizer barrier**——子查询被 materialize 然后注入，inline-replace 在 12 才默认开启。MySQL 8 引入 CTE 时已是 inline 模式。

### 5.3 Recursive CTE

```sql
WITH RECURSIVE descendants AS (
    SELECT id, parent_id, 0 AS depth FROM nodes WHERE parent_id IS NULL
    UNION ALL
    SELECT n.id, n.parent_id, d.depth + 1
    FROM nodes n JOIN descendants d ON n.parent_id = d.id
    WHERE d.depth < 10
) SELECT * FROM descendants;
```

执行模型 iteratively fixpoint：
1. base case：第一行 SELECT 算一次结果放 worktable
2. recursive case：把 worktable 当表跑下一行 SELECT，产出追加到 worktable
3. 重复直到递归 case 不再产出新行或 cycle 检测

应用：组织树、依赖图、ISO 国家代码层级、推荐系统"朋友的朋友"。

### 5.4 anti-semi join

```sql
SELECT * FROM users WHERE NOT EXISTS (SELECT 1 FROM orders WHERE user_id = users.id);
```

`NOT EXISTS` 自然对应 anti-semi-join；planner 通常用 hash anti-join 实现，O(M+N)。新手常写 `LEFT JOIN + IS NULL` 也可重写：

```sql
SELECT u.* FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE o.user_id IS NULL;
```

MySQL 5.6 之前 LEFT JOIN + IS NULL 比 NOT EXISTS 快一些；之后两者等价。PostgreSQL 始终两者等价。

---

## 六、嵌套子查询与 decorrelation

### 6.1 朴素子查询与性能

```sql
-- ❌ 慢：相关子查询，每行 users 跑一次
SELECT * FROM users u WHERE EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.id AND o.created_at > '2024-01-01'
);

-- ✅ planner 重写为 semi-join（PostgreSQL 14+ 自动）
SELECT u.* FROM users u
  LEFT SEMI JOIN orders o ON o.user_id = u.id AND o.created_at > '2024-01-01';
```

### 6.2 Lateral Join（PostgreSQL 9.3+）

```sql
SELECT u.name, recent.order_id
FROM users u,
LATERAL (
    SELECT order_id FROM orders o
    WHERE o.user_id = u.id
    ORDER BY created_at DESC LIMIT 3
) recent;
```

LATERAL 让子查询引用左边表 u 的列——常用于 top-N per group。

执行模型：对每行 users 跑一次 LATERAL 子查询，结果集 join。Lateral join + 索引支持可高效（每行用 user_id index lookup）。

### 6.3 correlated vs uncorrelated 子查询

```sql
-- uncorrelated：子查询独立可代入常量
SELECT * FROM users WHERE age > (SELECT AVG(age) FROM users);

-- correlated：依赖外行
SELECT u.name, (SELECT COUNT(*) FROM orders WHERE user_id = u.id) AS order_count
FROM users u;
```

uncorrelated 子查询可一次性 evaluate，correlated 必须按外行迭代。Planner 用 magic set/decorrelation 把 correlated 重写成 join——但**不是所有 DB 都做**。Postgres 做得到，早期 MySQL 不行。

---

## 七、CTE 与 optimizer barrier

### 7.1 PostgreSQL 12 之前：CTE materialize

```sql
-- 在 PG 11 中：
WITH big_cte AS (SELECT * FROM large_table WHERE x > 10)
SELECT * FROM big_cte WHERE x < 5;
```

PG 11 把 large_table ≥10 的所有行写到 worktable，再 filter <5——即使极少数行匹配 x<5。这是 optimizer barrier。

PG 12 默认 inline：CTE 直接放回 SQL，planner 可下推 filter：
```
原 PG 11:    materialize(SELECT * FROM large_table WHERE x > 10) WHERE x < 5
PG 12+ inline: SELECT * FROM large_table WHERE x > 10 AND x < 5
```

### 7.2 强制 materialize (`MATERIALIZED`)

PG 12+ 给 CTE 加 marker：
```sql
WITH big_cte AS MATERIALIZED (SELECT * FROM large_table WHERE x > 10)
SELECT * FROM big_cte WHERE x < 5;
```

适用场景：
1. CTE 多次引用且重计算太贵
2. planner 试图 inline 但实际代价更高（极复杂子查询里有全表)
3. CTE 有副作用（CTE 包 WITH RECURSIVE / DML）

---

## 八、产线案例

### 8.1 NULL 与 ISO 9001 业务逻辑

交易系统想"未审核订单不返回":
```sql
-- ❌
SELECT * FROM orders WHERE approved_by != 'master';
-- approved_by=NULL 的未审核订单也不出现

-- ✅
SELECT * FROM orders WHERE approved_by IS DISTINCT FROM 'master';
-- IS DISTINCT FROM 把 NULL 视为不同值的第三值
```

MySQL 8 起支持 `IS NOT DISTINCT FROM`，PG 9 起支持。

### 8.2 窗口函数慢解析

电商"每用户前 3 单"：
```sql
WITH ranked AS (
    SELECT user_id, order_id,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS rn
    FROM orders
)
SELECT * FROM ranked WHERE rn <= 3;
```

PostgreSQL：sort on (user_id, created_at) → 行号 ceil；100GB orders 做 break：
- 单次 sort 输入-B-tree merge 太慢
- 若 user_id 高基数，单排序可行
- 若 user_id 低基数（少量 user hstore 单 user 巨量订单）→ track partition hash + per-partition top-k heap → 大幅加速

DuckDB / ClickHouse 内部都是 partition-aware 的 efficient top-k 实现。

### 8.3 CTE 递归爆炸

依赖图 N=10^8 边，recursive CTE 没限 depth → iter 直至内存爆。MySQL 没硬上限，PG `max_stack_depth` 可控，但 N 太大 → 显式用 PL/pgSQL cursor 求 workitem batch。

---

## 九、易错清单

1. `WHERE col != 'x'` 不返回 NULL——改用 `IS DISTINCT FROM`
2. `COUNT(col)` 跳过 NULL；`COUNT(*)` 全数
3. `ORDER BY col ASC NULLS LAST` 必须 explicit
4. CTE 在 PG 12 之前是 materialize barrier，旧业务升 PG 后 planner 行为变化
5. LATERAL 子查询不可在 MySQL 5.7 用，MySQL 8.0+ 支持 LATERAL
6. recursive CTE 必加 stop condition 防 cycle
7. anti-join 用 `NOT EXISTS` 比 `LEFT JOIN + IS NULL` 在 PG 上等价
8. OR 优化：`WHERE a = 1 OR b = 2` 难用 index；rewrite 为 `UNION ALL` 后 PG 可走两个 index scan union

---

## 十、这一章带走的东西

1. SQL 是关系代数 + 工程便利扩展；planner 把 SQL 解析为代数表达式再 rule 重排
2. NULL 是 UNKNOWN 第三值；aggregate / WHERE / ORDER BY 不同处理
3. CTE PG 12 起默认 inline，老 PG 视为 optimizer barrier（可显式 `MATERIALIZED` 锁定）
4. window 函数执行模型：PARTITION → ORDER → frame sliding → aggregate
5. recursive CTE 做 cycle / DAG traversal，必加 stop condition
6. anti-join 用 NOT EXISTS，semi-join 用 EXISTS/IN，永远不会 null-join 重复 row
7. LATERAL 子查询引用外行 → top-N per group 用得到，性能靠外 side index

## 下一节 →

[事务、ACID、隔离级别与现象](isolation.md) — ACID、ANSI SQL 4 隔离级别、Berenson critique、2PL、MVCC、SSI
