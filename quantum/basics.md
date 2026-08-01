# 1. 量子计算基础: Dirac 记号 / qubit / 量子门 / 测量

## TL;DR

量子计算的"数据结构"是 **qubit**，操作是 **量子门**（酉矩阵），输出靠 **测量**（坍缩）。这一章把这三个基础用线性代数讲透（第零部分线代 §1 复数/矩阵直接适用），并引入**纠缠**——量子计算最重要的非经典资源。

读完应能：
1. 用 Dirac 记号写单/多 qubit 状态，理解叠加与归一化。
2. 知道量子门是酉变换（`U†U = I`），会写 X/H/CNOT 的矩阵形式。
3. 理解测量坍缩与 Born 规则（概率 = |振幅|²）。
4. 理解张量积构造多 qubit，理解纠缠与 Bell 态。
5. 会用简单量子线路图。

---

## 一、qubit：量子比特

### 1.1 经典 bit vs qubit

```
经典 bit:  0 或 1 (二选一)
量子 qubit: α|0⟩ + β|1⟩  (叠加: 同时是 0 和 1, 带复系数 α, β)
```

- 基态：$|0\rangle = \begin{pmatrix} 1 \\ 0 \end{pmatrix}$，$|1\rangle = \begin{pmatrix} 0 \\ 1 \end{pmatrix}$。
- 任意态：$|\psi\rangle = \alpha |0\rangle + \beta |1\rangle = \begin{pmatrix} \alpha \\ \beta \end{pmatrix}$，其中 $\alpha, \beta \in \mathbb{C}$。
- **归一化**：$|\alpha|^2 + |\beta|^2 = 1$（概率和为 1）。

### 1.2 测量坍缩

测量 qubit：
- 得到 $|0\rangle$ 的概率 = $|\alpha|^2$
- 得到 $|1\rangle$ 的概率 = $|\beta|^2$
- **测量后坍缩**到测量到的基态（经典结果）。

> [!WARNING]
> 这是关键反直觉点：**量子态在测量前"同时存在"，测量是投影**。所以量子计算的关键是"把答案的概率放大到可测"，而不是"读所有叠加"——你只能读一次，读到什么看概率。

### 1.3 叠加态例子

- $|+\rangle = \frac{1}{\sqrt 2}(|0\rangle + |1\rangle)$：测量得到 0 或 1 各 50%。
- $|-\rangle = \frac{1}{\sqrt 2}(|0\rangle - |1\rangle)$：也是 50/50，但相位不同（后面 Grover 用得上）。

---

## 二、量子门：酉变换

### 2.1 门必须是酉矩阵

量子门 = 幺正（酉）矩阵 $U$：$U^\dagger U = I$（可逆、保范数）。

- 因为态向量范数 = 1（概率），门必须保长度 → 酉。
- 酉 = 可逆 → 量子计算**可逆**（无信息损失）。

### 2.2 单 qubit 门

| 门 | 矩阵 | 作用 |
|----|------|------|
| **X**（NOT） | $\begin{pmatrix}0&1\\1&0\end{pmatrix}$ | $|0\rangle↔|1\rangle$ |
| **H**（Hadamard） | $\frac{1}{\sqrt2}\begin{pmatrix}1&1\\1&-1\end{pmatrix}$ | $|0\rangle→|+\rangle$, 制造叠加 |
| **Z** | $\begin{pmatrix}1&0\\0&-1\end{pmatrix}$ | 翻转 $|1\rangle$ 相位 |
| **Y** | $\begin{pmatrix}0&-i\\i&0\end{pmatrix}$ | 绕 y 轴旋转 |

**H 门**是最重要的单门——它把确定态变成叠加态：

$$H|0\rangle = |+\rangle, \quad H|1\rangle = |-\rangle, \quad H^2 = I$$

### 2.3 门作用 = 矩阵乘法

$$X|0\rangle = \begin{pmatrix}0&1\\1&0\end{pmatrix}\begin{pmatrix}1\\0\end{pmatrix} = \begin{pmatrix}0\\1\end{pmatrix} = |1\rangle$$

$$H|0\rangle = \frac{1}{\sqrt2}\begin{pmatrix}1&1\\1&-1\end{pmatrix}\begin{pmatrix}1\\0\end{pmatrix} = \frac{1}{\sqrt2}\begin{pmatrix}1\\1\end{pmatrix} = |+\rangle$$

---

## 三、多 qubit 与张量积

### 3.1 张量积构造多 qubit 态

两个 qubit 的组合态用**张量积（Kronecker product）**：

$$|\psi\rangle \otimes |\phi\rangle = \begin{pmatrix} \alpha \\ \beta \end{pmatrix} \otimes \begin{pmatrix} \gamma \\ \delta \end{pmatrix} = \begin{pmatrix} \alpha\gamma \\ \alpha\delta \\ \beta\gamma \\ \beta\delta \end{pmatrix}$$

2 qubit 有 $2^2 = 4$ 个基态：$|00\rangle, |01\rangle, |10\rangle, |11\rangle$。
$n$ qubit 有 $2^n$ 个基态 → **指数级状态空间**（量子并行之源）。

### 3.2 CNOT（受控 NOT）门

最重要的**双 qubit 门**（产生纠缠的引擎）：

- 控制 qubit 是 $|1\rangle$ 时，翻转目标 qubit；是 $|0\rangle$ 时不动。
- 矩阵（4×4）：

$$\mathrm{CNOT} = \begin{pmatrix} 1&0&0&0 \\ 0&1&0&0 \\ 0&0&0&1 \\ 0&0&1&0 \end{pmatrix}$$

$$|00\rangle→|00\rangle,\; |01\rangle→|01\rangle,\; |10\rangle→|11\rangle,\; |11\rangle→|10\rangle$$

---

## 四、纠缠（Entanglement）

### 4.1 Bell 态（最大纠缠）

对 $|00\rangle$ 做 H 到控制位 + CNOT：

$$|00\rangle \xrightarrow{H \otimes I} \frac{1}{\sqrt2}(|00\rangle + |10\rangle) \xrightarrow{CNOT} \frac{1}{\sqrt2}(|00\rangle + |11\rangle) = |\Phi^+\rangle$$

### 4.2 纠缠的本质

$$|\Phi^+\rangle = \frac{1}{\sqrt2}(|00\rangle + |11\rangle)$$

- 测量第一个 qubit 得到 0 → 第二个必然 0；得到 1 → 必然 1。
- **两个 qubit 关联，但态不可分解为两 qubit 的张量积**（不可分离）。
- 这种关联**不受距离限制**（EPR 悖论）——但**不传递信息**（测量前你无法控制结果）。

> [!NOTE]
> 纠缠是量子计算"额外能力"的来源：没有纠缠的量子计算可以经典模拟（Gottesman-Knill 定理部分说明），有纠缠才有真正的量子优势。它是资源，不是"超光速通信"。

---

## 五、量子线路图

```
qubit 0: ── H ──●── M ────   (M = 测量, ● = CNOT 控制)
qubit 1: ────────X── M ────   (X = CNOT 目标)
```

```
|0⟩ ── H ──●── M ── 结果1 (与结果2 关联 → 纠缠)
|0⟩ ──────X── M ── 结果2
```

这画的就是 Bell 态制备 + 测量：`H` 后 `CNOT` → `|Φ⁺⟩` → 测量两个 qubit 总相同。

---

## 六、常见数学工具（第零部分对接）

| 概念 | 公式 | 出处 |
|------|------|------|
| 内积 | $\langle\phi|\psi\rangle$ | 线代 §1 |
| 模长 | $\|\psi\| = \sqrt{\langle\psi|\psi\rangle}$ | 线代 §1 |
| 正交基 | $\langle 0|1\rangle = 0$ | 线代 §1 |
| 张量积 | $A \otimes B$ | 线代 §6 |
| 酉矩阵 | $U^\dagger U = I$ | 线代 §2 |
| 复共轭转置 | $U^\dagger = (U^*)^T$ | 线代 §2 |

---

## 七、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **qubit**：$\alpha|0\rangle + \beta|1\rangle$，$|\alpha|^2 + |\beta|^2 = 1$。
> - **测量**：Born 规则 $P(x) = |\langle x|\psi\rangle|^2$，测后坍缩。
> - **门 = 酉矩阵**：$U^\dagger U = I$，可逆。
> - **X/H/Z/Y 门**：X 翻转、H 叠加、Z 相位翻转。
> - **多 qubit = 张量积**：$n$ qubit → $2^n$ 基态（指数空间）。
> - **CNOT**：控制位为 1 时翻转目标位——纠缠引擎。
> - **Bell 态** $|\Phi^+\rangle = \frac{1}{\sqrt2}(|00\rangle + |11\rangle)$：最大纠缠、测量全同。
> - **纠缠 ≠ 超光速通信**：是资源，不传信息。

---

下一篇: [2. 量子算法: Deutsch-Jozsa / Grover / Shor](algorithms.md).
