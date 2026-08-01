# 7. 强化学习与 RLHF: MDP / Bellman / Q-learning / Policy Gradient / PPO / RLHF

## TL;DR

强化学习（RL）处理的是"**没有正确答案，只有延迟奖励**"的学习问题——Agent 在环境里行动、获得反馈、最大化长期回报。RL 有两套并行主线：**value-based**（学 Q 值，代表 Q-learning / DQN）和 **policy-based**（直接学策略，代表 Policy Gradient / PPO）。RLHF（基于人类反馈的强化学习）把 RL 用在语言模型上：用人类偏好训练奖励模型，再用 PPO 微调 LM 让输出更符合偏好——**ChatGPT 时代的核心对齐技术**。

读完应能：
1. 形式化一个 MDP（状态/动作/转移/奖励/折扣），写出 Bellman 方程。
2. 区分 value-based vs policy-based，说出各自适用场景。
3. 推导 policy gradient 定理的核心公式，说出 PPO 的 clip 机制为什么稳。
4. 讲清 RLHF 三步流水线（SFT → Reward Model → PPO）和 GRPO/DPO 为什么是更省事的替代。
5. 看懂 DeepSeek-R1 / InstructGPT 论文里 RL 相关的数学记号。

---

## 一、MDP：RL 的通用语言

### 1.1 五元组

一个马尔可夫决策过程（MDP）`(S, A, P, R, γ)`：

- `S`：状态集合
- `A`：动作集合
- `P(s' | s, a)`：转移概率（马尔可夫性质：只看当前态，不看历史）
- `R(s, a, s')`：奖励函数
- `γ ∈ [0, 1]`：折扣因子（越远回报越不值钱，保证有限和）

### 1.2 策略与回报

- 策略 `π(a | s)`：状态 → 动作的概率分布。
- 折扣回报：`G_t = Σ_{k=0}^∞ γ^k R_{t+k+1}`。
- Agent 目标：最大化期望回报 `E_π[G_0]`。

### 1.3 与第零部分的接口

MDP 是马尔可夫链（概率 §8 随机过程）加了"动作"维度 + 奖励。回顾 Markov 性质、平稳分布（`πP = π`）在 RL 里反复出现。

---

## 二、贝尔曼方程：RL 的"解方程组"

### 2.1 价值函数

- **状态价值** `V^π(s) = E_π[G_t | S_t = s]`：从状态 s 开始，按 π 走，期望总回报。
- **动作价值** `Q^π(s, a) = E_π[G_t | S_t = s, A_t = a]`：从 s 执行 a，之后按 π 走。
- 关系：`V^π(s) = Σ_a π(a|s) Q^π(s, a)`。

### 2.2 Bellman 方程

把 G_t 拆成"立即奖励 + 后续折扣价值"：

$$V^\pi(s) = \sum_{a} \pi(a|s) \sum_{s'} P(s'|s,a) \left[ R(s,a,s') + \gamma V^\pi(s') \right]$$

$$Q^\pi(s,a) = \sum_{s'} P(s'|s,a) \left[ R(s,a,s') + \gamma \sum_{a'} \pi(a'|s') Q^\pi(s',a') \right]$$

**最优价值**（max 算子替换均值）：

$$V^*(s) = \max_a \sum_{s'} P(s'|s,a)\left[ R + \gamma V^*(s') \right]$$

> [!NOTE]
> Bellman 方程是"自指"方程——把未来价值写进当前价值。求解方式分三类：DP（已知 P，迭代）、MC（采样估计）、TD（用下一次估计更新，如 Q-learning）。

### 2.3 动态规划视角

如果转移概率 P 已知，V 迭代 `V_{k+1} = T V_k`（Bellman backup 算子）收敛到 V\*，策略迭代 + 值迭代是标准解法。回顾 DSA 动态规划：**最优子结构 + 重叠子问题**——Bellman 方程就是 MDP 上的 DP。

---

## 三、Value-based 方法：Q-learning

### 3.1 核心想法

不知道 P，就用**采样**估计 Q。Q-learning 用 TD 更新：

$$Q(s,a) \leftarrow Q(s,a) + \alpha \left[ r + \gamma \max_{a'} Q(s',a') - Q(s,a) \right]$$

- 括号里是 **TD 误差**（真实回报 - 当前估计）。
- `max` 让它成为 off-policy（学的是最优策略，即使用 ε-greedy 探索）。

### 3.2 DQN（Deep Q-Network，2015）

用神经网络近似 Q：`Q_θ(s,a) ≈ Q*(s,a)`。两大工程技巧：

1. **经验回放（replay buffer）**：存 (s,a,r,s')，随机采样训练 → 打破相关性。
2. **目标网络**：用隔 N 步冻结的 `Q_θ⁻` 计算 TD target，稳定训练。

```python
# 简化 DQN 更新
for (s, a, r, s_next, done) in batch:
    target = r if done else r + gamma * max_a' Q_target(s_next, a')
    loss = F.mse_loss(Q_online(s)[a], target)   # 只更新选中的动作
```

### 3.3 适用与局限

- **适用**：离散动作空间（游戏、棋盘）、值函数好近似。
- **局限**：连续动作空间难做 `max`；高维视觉尚可，复杂策略表达能力受限。

---

## 四、Policy-based 方法：Policy Gradient

### 4.1 直接学策略

不用 Q，直接参数化策略 `π_θ(a|s)`（神经网络输出动作分布）。目标：

$$J(\theta) = E_{\tau \sim \pi_\theta}[G_0(\tau)]$$

其中 τ 是一条轨迹（状态-动作序列）。

### 4.2 Policy Gradient 定理

**核心公式**（REINFORCE）：

$$\nabla_\theta J(\theta) = E_{\tau}\left[ \sum_t \nabla_\theta \log \pi_\theta(a_t | s_t) \cdot G_t \right]$$

直觉：`log π` 的梯度指向"让这条轨迹更可能"的方向，乘以回报 G_t 加权——高回报轨迹的动作概率上调，低回报下调。

### 4.3 减小方差：baseline 与 advantage

直接 G_t 方差大。减一个 baseline b(s)（常为 V）：

$$\nabla_\theta J(\theta) = E_{\tau}\left[ \sum_t \nabla_\theta \log \pi_\theta(a_t | s_t) \cdot \underbrace{(G_t - V(s_t))}_{\text{advantage } A_t} \right]$$

**Advantage** `A_t = G_t - V(s_t)`：这条动作比"平均"好多少。这是 actor-critic 框架的雏形（actor=策略，critic=价值基线）。

---

## 五、TRPO / PPO：RL 的工程稳定化

### 5.1 问题：梯度上升让策略崩

直接 policy gradient 每步更新大步，策略突变 → 训练发散。TRPO/PPO 的核心思想：**限制每次更新前后策略的差距**。

### 5.2 TRPO（Trust Region Policy Optimization，2015）

约束新旧策略的 KL 散度不超 δ：

$$\max_\theta \; E\left[ \frac{\pi_\theta(a|s)}{\pi_{\theta_{old}}(a|s)} A_t \right] \quad \text{s.t.} \quad E[\mathrm{KL}(\pi_{\theta_{old}} \| \pi_\theta)] \le \delta$$

用自然梯度（Fisher 矩阵逆）求解——回顾第零部分微积分 §6 信息几何：**KL 局部 = Fisher 二次型，自然梯度就是在分布空间的黎曼梯度**。

### 5.3 PPO（Proximal Policy Optimization，2017）——主流

PPO 把"约束"改成软 clip，不用算 Fisher：

$$L^{CLIP}(\theta) = E\left[ \min\left( r_t(\theta) A_t, \; \mathrm{clip}(r_t(\theta), 1-\epsilon, 1+\epsilon) A_t \right) \right]$$

- `r_t(θ) = π_θ(a|s) / π_θold(a|s)`：新旧策略概率比。
- clip 到 `[1-ε, 1+ε]`：当 A_t > 0 时，r 不能涨超过 1+ε；A_t < 0 时不能跌低于 1-ε。
- **直观**：每步不让策略比旧策略偏离太多，同时不限制"应该提升的方向"。

### 5.4 为什么 PPO 是 RLHF 标配

- 只需一阶梯度（不用 Fisher 逆），GPU 友好。
- clip 天然防止一步崩策略——语言模型微调尤其怕"一步生成崩溃"。
- 支持大量并行 rollout + 单次多 epoch 复用。

---

## 六、RLHF：把 RL 用到语言模型

### 6.1 动机

LM 训练是"预测下一个 token"，学的是"什么像人话"，不是"什么符合偏好"。RLHF 让 LM 优化一个表达人类偏好的奖励。

### 6.2 三步流水线

```
第 1 步: SFT 监督微调
   用人工标注的指令-回答对, 普通 next-token CE 训练一个基础模型 π_SFT

第 2 步: 训练奖励模型 RM
   让人对同 prompt 的两个回答排序 (chosen / rejected)
   训一个 reward model r_φ(x, y): 给定 (prompt, 回答) → 打分
   用 pairwise ranking loss (Bradley-Terry 模型):
       L = -E[ log σ( r_φ(x, y_w) - r_φ(x, y_l) ) ]

第 3 步: 用 PPO 微调策略
   初始化 π_θ = π_SFT
   每次 rollout 采样回答 y ~ π_θ(·|x), 用 RM 打分
   加上 KL 惩罚, 防止偏离 SFT 太远 (保持流畅度 + 防奖励黑客):
       reward_total(x, y) = r_φ(x, y) − β·KL(π_θ(y|x) || π_SFT(y|x))
   用 PPO 更新 π_θ
```

### 6.3 Bradley-Terry 奖励建模

排序对 (y_w 好于 y_l)，BT 假设：

$$P(y_w \succ y_l) = \sigma\left(r_\phi(x, y_w) - r_\phi(x, y_l)\right) = \frac{\exp(r_\phi(y_w))}{\exp(r_\phi(y_w)) + \exp(r_\phi(y_l))}$$

最大化这个 log-likelihood 训 RM——本质上是一个**二分类（谁更好）的 logistic 回归**。回顾第零部分逻辑回归的 softmax+CE。

### 6.4 为什么要 KL 惩罚

- 纯奖励最大化 → 模型找到"骗 RM"的捷径（奖励黑客）。
- KL 项把策略钉在 SFT 附近，保留语言流畅度。
- β 是权衡：β 大 → 更保守（贴近 SFT）；β 小 → 更激进追奖励。

### 6.5 InstructGPT / ChatGPT 用的具体化

- OpenAI InstructGPT（2022）：SFT → RM（每 prompt 生成 4-9 个回答人工排序）→ PPO。
- 关键点：**RM 必须和策略一起评估**，RL 阶段每轮 roll out 更新；推理时 RM 拿掉，只留微调后的 π_θ。

---

## 七、GRPO / DPO：更省事的替代

### 7.1 为什么要替代

PPO 要**同时训 4 个模型**（policy、value critic、reference、reward），工程复杂、显存高、调参难。2023 后出现两个主流替代：

### 7.2 DPO（Direct Preference Optimization，2023）

**核心洞察**：奖励最大化 + KL 约束的闭环解可解析消掉奖励模型，直接对偏好对优化策略。

DPO 损失：

$$L_{DPO}(\theta) = -E_{(x,y_w,y_l)} \log \sigma\left( \beta \log\frac{\pi_\theta(y_w|x)}{\pi_{ref}(y_w|x)} - \beta \log\frac{\pi_\theta(y_l|x)}{\pi_{ref}(y_l|x)} \right)$$

- 只有 `π_θ` 和 `π_ref`（冻结的 SFT），**不需要 RM、不需要 PPO、不需要 rollout**。
- 一次 CE 式训练就能对齐——显著省算力。

**缺点**：没有"探索"（不像 RL 能采样新响应再打分）；对偏好数据质量敏感。

### 7.3 GRPO（Group Relative Policy Optimization，DeepSeek-R1 用）

- 对同一个 prompt 采样**一组**（group）响应，用组内相对优势（不是学出来的 critic）：
  $$A_i = \frac{r_i - \mathrm{mean}(r_{group})}{\mathrm{std}(r_{group})}$$
- 去掉 value network → 显存 / 训练复杂度大降。
- DeepSeek-R1 用它做 reasoning RL（verifiable reward：答案对不对、格式对不对）。

### 7.4 对比表

| 方法 | 需要 RM | 需要 rollout | 需要 value net | 复杂度 | 代表 |
|------|--------|-------------|---------------|--------|------|
| PPO | ✓ | ✓ | ✓ | 高 | InstructGPT, ChatGPT |
| DPO | ✗ | ✗ | ✗ | 低 | Llama-2-chat, Mistral, 大量开源 |
| GRPO | ✓（可） | ✓ | ✗ | 中 | DeepSeek-R1, DeepSeek-V3 |
| Rejection sampling | ✓ | ✓ | ✗ | 低 | 部分开源（只取 RM 最高的） |

---

## 八、RL 数学与第零部分的接口

| RL 概念 | 第零部分对应 |
|---------|-------------|
| MDP / Markov 链 / 平稳分布 | 概率 §8 随机过程 |
| Bellman 方程 / DP | DSA DP + 概率 |
| Advantage = G - V | 概率期望/方差 |
| TRPO 自然梯度 / KL 约束 | 微积分 §6 信息几何（Fisher 度量） |
| Bradley-Terry / 排序损失 | 概率 §4 贝叶斯 + 逻辑回归（foundations §2） |
| PPO clip / 蒙特卡洛 rollout | 概率 §6 极限定理（MC 估计） |

---

## 九、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **MDP**：`(S, A, P, R, γ)`；目标是最大化折扣回报。
> - **Bellman**：`V(s) = E_π[R + γV(s')]`；最优用 max 算子。
> - **Q-learning**：`Q ← Q + α[r + γmaxQ' - Q]`；off-policy TD。
> - **Policy Gradient**：`∇J = E[∇log π(a|s) · A_t]`；A_t 是 advantage。
> - **PPO**：clip 新旧策略比到 `[1-ε, 1+ε]`；一阶、稳、RLHF 标配。
> - **RLHF**：SFT → Reward Model(BT 排序) → PPO(+KL 惩罚)。
> - **DPO**：解析消掉 RM，直接对偏好对优化，省算力。
> - **GRPO**：组内相对 advantage，去 value net，DeepSeek-R1 用。

---

下一篇: [8. 大模型训练工程: DP/PP/TP/ZeRO/FSDP/checkpoint](training-at-scale.md).
