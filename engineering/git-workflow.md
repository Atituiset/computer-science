# 1. Git 与版本控制: 原理 / 分支模型 / 合并策略 / 进阶命令

## TL;DR

Git 是工程师每天用最多、却最容易被"记命令"蒙混过的工具。理解 Git 的**底层模型**（内容寻址 DAG）后，几乎所有"诡异行为"都能推理出来，而不是靠背 `git reset --hard`。这一章讲透：

1. **对象模型**：blob / tree / commit / tag 都是什么，Git 为什么是"内容寻址存储"。
2. **引用与 HEAD**：branch / tag / HEAD 的真相，`detached HEAD` 是什么。
3. **暂存区与工作区**：`add/commit/checkout/reset` 到底在动什么。
4. **分支模型**：GitFlow / GitHub Flow / Trunk-Based 对比，怎么选。
5. **合并与变基**：merge vs rebase vs cherry-pick，冲突解决。
6. **回滚与恢复**：`reset` 三种模式、`revert`、`reflog` 救命。
7. **团队协作**：pull request / 保护分支 / 语义化提交。

读完应能：不慌任何 Git 场景——合并冲突、误删、改错分支、把 WIP 弄丢、多分支拉错。

---

## 一、Git 的对象模型（一切的根）

### 1.1 四个对象类型

| 对象 | 内容 | 特点 |
|------|------|------|
| **blob** | 一个文件的内容 | 无文件名，只存内容 |
| **tree** | 一个目录：文件名 → blob/tree 映射 | 记录目录结构 |
| **commit** | 一次提交：指向 tree + parent(s) + 作者/时间/消息 | 不可变快照 |
| **tag** | 指向某个 commit（或带注释） | 命名的锚点 |

### 1.2 内容寻址

所有对象都用 **SHA-1/SHA-256 哈希**（内容哈希）作为地址。同样的内容永远得到同样的哈希——**这是 Git 一切特性（去重、快照、不可变）的根**。

```
commit  (哈希 = f(内容))
  ├─→ tree      (整个目录快照)
  │     ├─→ blob "main.go"     (文件内容)
  │     └─→ tree "pkg/"
  └─→ parent commit (父提交, 可多个 = merge)
```

### 1.3 为什么 Git 快

- **快照而非 diff**：每个 commit 存整棵 tree，但 blob 按内容去重——没改的文件复用同一 blob 哈希，只存一次。
- **不可变**：commit 生成后内容不变，新提交只新增。这保证历史可信任、可审计。

> [!NOTE]
> 理解了这个，`git log` 为什么是"沿 parent 指针走 DAG"、`git diff A B` 为什么能精确算差异、`.git` 为什么能瘦身——全都有了解释。Git 就是"分布式 §DAG 章节"的活实例。

---

## 二、引用、HEAD 与三区

### 2.1 三区模型

| 区域 | 是什么 | 命令影响它 |
|------|--------|-----------|
| 工作区 | 你看到的文件 | 所有编辑 |
| 暂存区（index） | 准备提交的快照 | `git add` |
| 仓库（.git） | 已提交的历史 | `git commit` |

```
工作区  --git add-->  暂存区  --git commit-->  仓库
  ↑                     ↑                        ↑
git checkout          git reset (mixed)       git reset --hard
```

### 2.2 引用（refs）与 HEAD

- **branch** 是一个指向 commit 的指针（`.git/refs/heads/xxx`）。
- **HEAD** 是一个特殊指针，指向"当前在哪个分支/commit"。
- 分支不是"装提交的容器"，只是**会移动的指针**——commit 本身在全球共享的 DAG 里。

### 2.3 detached HEAD

当 HEAD 不指向任何分支（`git checkout <commit>`）时进入 detached 状态：你可以在任何 commit 上工作，但新提交**不挂在任何分支名下**，切走就可能"丢"（其实 reflog 里还在）。

> [!WARNING]
> 在 detached HEAD 上做了想保留的改动：立刻 `git switch -c <新分支名>` 建分支保住，否则切走后只能靠 `git reflog` 捞。

---

## 三、分支模型：三种主流

### 3.1 GitFlow（经典但重）

```
master ───────────────────────────────
         \                    /
          \ develop ─────────/──────
                \       /
                 \ feature
```
- `master` 只接受 release；`develop` 是集成分支；feature/release/hotfix 围绕它。
- **适用**：固定发布周期、版本化产品（传统企业）。
- **问题**：分支多、合并复杂，对持续发布偏重。

### 3.2 GitHub Flow（轻量主流）

- 只有 `main`，永远可部署；每个改动开短命分支 → PR → 合并回 main。
- **适用**：持续交付的互联网产品（主流现代团队）。
- 特点：PR 即审核 + CI + 自动部署。

### 3.3 Trunk-Based（极致 CI）

- 所有人直接往 `main` 提交（或短命分支 < 1 天），靠 feature flag 控制上线。
- **适用**：强 CI/CD、Google/Netflix 风格、高频发布。
- 特点：集成冲突最少、但要求测试覆盖与自动化极强。

| 模型 | 分支复杂度 | 发布频率 | 适合 |
|------|-----------|---------|------|
| GitFlow | 高 | 低（版本化） | 传统产品、发布周期 |
| GitHub Flow | 中 | 高 | 互联网产品默认 |
| Trunk-Based | 低 | 极高 | 强 CI/CD 团队 |

---

## 四、合并策略：merge / rebase / cherry-pick

### 4.1 merge（保留历史分叉）

```bash
git switch main && git merge feature
```
产生一个 merge commit，历史保留两分支的真实形状。**历史忠实但分叉多**。

### 4.2 rebase（线性化历史）

```bash
git switch feature && git rebase main
```
把 feature 的提交"搬到" main 顶端重新应用，产生线性历史。

| | merge | rebase |
|---|---|---|
| 历史形状 | 分叉 + merge commit | 线性 |
| 提交哈希 | 不变 | **会变**（新提交） |
| 什么时候用 | 公共分支、保留真相 | 私有分支、整理历史 |
| 风险 | 低 | 已 push 的分支 rebase 会出问题 |

> [!WARNING]
> **永远不要 rebase 已 push 到共享的分支**。别人基于旧哈希的提交会错乱。规则：rebase 只用于**自己还没推过的私有提交**；共享分支用 merge。

### 4.3 cherry-pick（挑单个提交）

```bash
git cherry-pick <commit-hash>
```
把别的分支上的单个提交应用到当前分支。用于热修复、挑某个修复进 release。

### 4.4 冲突解决

冲突标记：`<<<<<<< HEAD` / 你的代码 / `=======` / 对方的代码 / `>>>>>>> branch`。

```bash
git merge main          # 报冲突
# 编辑文件解决冲突 → 删除冲突标记
git add 文件
git commit              # merge 场景：直接 commit 完成
```

> [!TIP]
> 大冲突别硬解：先 `git merge --abort` 冷静，用 `git merge-base A B` 看分歧点，或者 `git checkout --theirs/--ours 文件` 选一边再改。

---

## 五、回滚与恢复：reset / revert / reflog

### 5.1 reset 三模式

```bash
git reset --soft  <commit>   # 只移 HEAD, 暂存区和工作区不动
git reset        <commit>   # mixed: 移 HEAD + 清暂存区, 工作区不动（默认）
git reset --hard <commit>   # 全清: 工作区也丢弃改动 ⚠️危险
```

### 5.2 revert（安全回滚，推荐用于已推送）

```bash
git revert <commit>
```
**产生一个"反向提交"**，不改历史，只是加一个新提交抵消那个提交的改动。**适合已 push / 公共分支**，因为不动历史，别人 pull 无冲突。

### 5.3 reflog（救命日志）

```bash
git reflog     # 列出 HEAD 移动的全部记录（含被删的分支/commit）
git reflog --all
git reset --hard HEAD@{5}   # 回到 5 步前的状态
```

> [!WARNING]
> Git 的对象在 reflog 过期前**不会真正删除**（默认 90 天）。误删分支、reset 过头、checkout 丢了 WIP，都先查 `git reflog` 再行动。这几乎是"Git 数据恢复"的第一手段。

---

## 六、团队协作实践

### 6.1 Pull Request 流程（GitHub Flow 标配）

```
feature 分支 → git push origin feature
→ 开 PR → CI 跑测试 → code review → 合并（squash / merge / rebase-merge）
```

三种合并方式：

| 方式 | 效果 | 适用 |
|------|------|------|
| **Squash merge** | 整条分支压成 1 个提交 | 特性合并进 main，历史整洁 |
| Merge commit | 保留分叉 | 想保留分支历史 |
| Rebase merge | 线性化 | 已通过 rebase 整理的分支 |

### 6.2 保护分支（protected branch）

`main` 应设置：不允许直接 push、必须有 PR + 至少 1 人 approve、CI 必须通过、线性历史。这是团队的"最后防线"。

### 6.3 语义化提交（Conventional Commits）

```
feat(api): 新增用户查询接口
fix(cache): 修复 key 过期竞态
docs(readme): 更新部署说明
refactor(db): 拆分连接池
```

`feat`/`fix` 直接驱动 changelog 和语义化版本（semver）：`feat` → minor，`fix` → patch，`BREAKING CHANGE` → major。让提交消息变成机器可读的元数据。

### 6.4 子模块与 monorepo

- **monorepo**：全代码一个仓（Google/字节模式），靠 build system 隔离，PR 全局可见。
- **submodule**：嵌套仓库，但要小心（子模块不自动跟随父仓 checkout）。
- 现在更多团队用 **workspace**（pnpm/yarn workspaces、Go workspaces）替代 submodule。

---

## 七、常用命令速查

```bash
# 诊断
git status / git log --oneline --graph / git diff / git diff --staged
git branch -a / git remote -v

# 提交
git add -p           # 交互式分块暂存
git commit --amend   # 修改上一次提交消息（未推送时）
git stash / git stash pop    # 暂存 WIP
git stash list / git stash drop

# 分支
git switch -c feature    # 建并切换
git branch -d feature    # 删已合并分支
git fetch --prune        # 清理远端已删分支

# 撤销
git restore 文件         # 丢弃工作区改动（替代 checkout -- 文件）
git restore --staged 文件 # 取消暂存
git reset --hard HEAD    # 丢弃全部未提交（小心）

# 高级
git blame 文件           # 谁改的
git log -S 字符串        # 找哪次提交加了/删了该字符串
git bisect start         # 二分找引入 bug 的提交
git clean -fd            # 清理未跟踪文件（小心）
git filter-repo          # 重写历史（慎用）
```

---

## 八、实战场景

### 8.1 场景 1：改错了分支

```bash
# 在 main 上改了 feature 的代码，还没提交
git stash                          # 暂存改动
git switch feature
git stash pop                      # 恢复改动到 feature
```

### 8.2 场景 2：提交到 main 想挪到 feature

```bash
# 已有 commit 在 main
git switch -c feature              # 分支带上当前状态
git switch main
git reset --hard HEAD~1            # main 后退一提交（本地）
git push origin main --force-with-lease   # 覆盖远端（注意：只对没共享的分支）
```

> [!WARNING]
> `--force` vs `--force-with-lease`：后者先检查远端是否被其他人更新过，防止覆盖他人提交。**永远优先用 `--force-with-lease`**。

### 8.3 场景 3：误删分支 / 丢失提交

```bash
git reflog          # 找到那个提交的哈希
git branch -c <哈希> recovered   # 从哈希建回分支
```

### 8.4 场景 4：WIP 弄丢

```bash
git fsck --lost-found        # 找 dangling 对象
# 或 reflog 找 stash 记录
git stash list && git stash apply stash@{0}
```

---

## 九、结束 + 速查表

> [!TIP]
> 一页快速唤回：
>
> - **Git = 内容寻址 DAG**：blob/tree/commit/tag，哈希即地址，不可变、去重、可快照。
> - **三区**：工作区 → add → 暂存区 → commit → 仓库。
> - **分支 = 会移动的指针**；HEAD 指向当前。
> - **rebase 只用于未推送的私有提交**；共享分支用 merge。
> - **回滚**：`reset --hard` 危险（动历史），`revert` 安全（加反向提交），`reflog` 是救命日志。
> - **分支模型**：GitFlow（重）/ GitHub Flow（主流）/ Trunk-Based（极致 CI）。
> - **保护分支**：PR + approve + CI 通过 + 线性历史。
> - **语义化提交**：feat/fix/docs → 驱动 changelog + semver。
> - **数据恢复**：先 reflog，再 fsck --lost-found。
> - **force push 用 `--force-with-lease`**，不要裸 `--force`。

---

下一篇: [2. 测试工程: 测试金字塔 / 单元/集成/契约/E2E / mock / flaky 治理](testing.md).
