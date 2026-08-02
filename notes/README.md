# 学习笔记 · 心得记录

> 随读随记：每页右下角的 **📝** 按钮打开笔记面板。笔记默认只存在**你的浏览器 localStorage**（不注册、无账号、无数据库、别人看不到）；需要沉淀时一键导出为 GitHub Issue，或复制 Markdown 粘贴到 Discussions / 任意笔记软件。

## 这个工具能做什么

| 动作 | 说明 |
|------|------|
| 本页记笔记 | 打开右下角 📝，写入并保存；笔记按页面路径独立存放 |
| 全部笔记 | 面板切到"全部"，聚合这台浏览器上所有页面的笔记 |
| 复制 Markdown | 一键复制带页面来源的 Markdown，可粘贴到 GitHub Discussions |
| 导出 Issue | 预填 `issues/new?title=…&body=…`，登录 GitHub 后确认即发布，无需 token |
| 删除 | 单条删除（有确认）；不提供"清空"，防误删 |

## 数据存在哪

- **localStorage**：键为 `cs-notes:v1:<页面路径>`，只在你当前浏览器。换设备、清缓存、开无痕即不可见——它是"草稿区"，不是存档。
- **GitHub Issues**：导出后存在仓库 Issues 里，可搜索、打标签、转 PR，随仓库一起版本化。
- **GitHub Discussions**：GitHub 没有"预填新建讨论"的链接，所以这里用"复制 Markdown"代替——粘贴发布即可；若想"一键发 Discussion"，后续可以注册免费 OAuth App 走 GraphQL API（本工具暂不内置）。

## 把笔记变成正式章节

笔记面板里的内容只是草稿。想让它成为这本书的一部分（被搜索、随 GitHub Actions 部署、保留版本历史）：

1. 把内容整理成 Markdown，追加到对应部分的章节文件，或新建文件；
2. 挂进 [SUMMARY.md](../SUMMARY.md)；
3. `commit + push`，Actions 自动构建部署到 GitHub Pages。

## 实现与配置

- 组件：[notes.js](../notes.js)（无依赖原生 JS，样式内联）。
- 挂载：`book.toml` → `[output.html]` → `additional-js = ["notes.js"]`。
- 目标仓库：`notes.js` 顶部的 `GITHUB_REPO` 常量，导出 Issue 时指向该仓库。
