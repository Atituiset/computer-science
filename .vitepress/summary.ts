/**
 * SUMMARY.md (mdBook 目录格式) -> VitePress sidebar / rewrites 解析器
 *
 * SUMMARY.md 仍是目录结构的唯一事实来源:
 *  - 每个 `README.md` 条目通过 rewrites 映射为同目录 `index.md` (URL 保持 mdBook 的 `/dir/` 风格)
 *  - sidebar 层级按列表缩进还原 (2 空格 = 一级)
 *  - `# 标题` 生成 sidebar 分组; `>` 描述行被忽略; 根部无 `#` 的散链作为顶层项
 */
import fs from 'node:fs'
import path from 'node:path'

// VitePress 会把 config 打包成临时 .mjs 再执行, import.meta.url 不可靠;
// 统一从 process.cwd() (项目根) 定位
const rootDir = path.resolve(process.cwd())
const SUMMARY = path.join(rootDir, 'SUMMARY.md')

export interface SidebarItem {
  text: string
  link?: string
  items?: SidebarItem[]
  collapsed?: boolean
}

/** 相对链接 -> VitePress 绝对 link; README.md 归一化为目录 */
function toLink(href: string): string {
  let link = href.replace(/\\/g, '/')
  if (!link.endsWith('.md')) link += '.md'
  link = '/' + link.replace(/^\.\//, '')
  // README.md -> 目录形式 (与 rewrites 的 index.md 规则一致)
  if (/(^|\/)README\.md$/.test(link)) link = link.replace(/(^|\/)README\.md$/, '$1')
  return link
}

/** 解析 SUMMARY.md 为 sidebar 结构 */
export function buildSidebar(): SidebarItem[] {
  const lines = fs.readFileSync(SUMMARY, 'utf-8').split(/\r?\n/)

  const sidebar: SidebarItem[] = []
  /** item 栈: 按列表缩进层级 (缩进/2 空格为深度) */
  let stack: { depth: number; item: SidebarItem }[] = []
  let currentSection: SidebarItem | null = null

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) continue

    // `# 标题` -> 新分组 (首个 "# Summary" 跳过)
    const h = line.match(/^#\s+(.*)$/)
    if (h) {
      if (/^summary$/i.test(h[1].trim())) continue
      currentSection = { text: h[1].trim(), items: [], collapsed: false }
      sidebar.push(currentSection)
      stack = []
      continue
    }
    // 水平分割线 / 引用块描述 -> 重置缩进上下文
    if (/^---+$/.test(line.trim()) || line.trimStart().startsWith('>')) {
      stack = []
      continue
    }

    const li = line.match(/^(\s*)-\s+\[(.*?)\]\((.*?)\)\s*$/)
    if (li) {
      const depth = Math.floor(li[1].length / 2)
      const item: SidebarItem = { text: li[2], link: toLink(li[3]) }
      const holder =
        currentSection && currentSection.items
          ? currentSection
          : (sidebar.length === 0 ? (sidebar.push({ text: '目录', items: [] }), sidebar[0]) : sidebar[0])
      if (!holder.items) holder.items = []

      if (depth === 0) {
        holder.items.push(item)
        stack = [{ depth: 0, item }]
      } else {
        // 回退栈到父级 (depth-1), 找不到则挂到最近一级
        while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop()
        let parent = stack[stack.length - 1]
        if (!parent || parent.depth >= depth) parent = { depth: depth - 1, item: holder.items[holder.items.length - 1] }
        if (!parent.item.items) parent.item.items = []
        parent.item.items.push(item)
        stack.push({ depth, item })
      }
      continue
    }
  }

  // 仅有顶层散链的分组退化为纯链接项
  return sidebar
    .map((s) => (s.items && s.items.length === 1 && s.text === s.items[0].text ? { ...s.items[0] } : s))
    .filter((s) => s.link || (s.items && s.items.length))
}

/** 扫描 srcDir 生成 README.md -> index.md 的 rewrites (根 README -> /index) */
export function buildRewrites(): Record<string, string> {
  const rewrites: Record<string, string> = {}
  const skipDirs = new Set(['.git', 'node_modules', 'book', '.vitepress', '.github', 'katex'])
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue
        walk(path.join(dir, entry.name), rel + entry.name + '/')
      } else if (entry.isFile() && entry.name === 'README.md') {
        const src = rel + 'README.md'
        rewrites[src] = rel + 'index.md'
      }
    }
  }
  walk(rootDir, '')
  return rewrites
}
