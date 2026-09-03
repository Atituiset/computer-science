/**
 * 学习笔记 · 心得记录 (localStorage 版) — VitePress 移植
 *
 * 移植自 mdBook 时代的 notes.js, 逻辑保持不变:
 * - 划词笔记: 正文选中文字 -> "记笔记" 工具条; 以字符偏移锚定, 刷新后重新高亮
 * - 数据仅存当前浏览器 localStorage (cs-notes:v1:<页面路径>)
 * - 一键复制 Markdown (粘贴到 GitHub Discussions) / 一键导出预填 GitHub Issue
 *
 * VitePress 适配:
 * - 正文容器: #content -> .vp-doc
 * - SPA 路由切换后由 Theme 组件调用 onRouteChange() 重建高亮与面板
 * - 样式移至 notes.css (原为 JS 内联注入)
 */

const LS_PREFIX = 'cs-notes:v1:'
const GITHUB_REPO = 'Atituiset/computer-science';

export function contentEl(): HTMLElement {
  return (
    (document.querySelector('main .vp-doc') as HTMLElement) ||
    (document.querySelector('.vp-doc') as HTMLElement) ||
    document.body
  )
}

function pageKey(): string {
  return location.pathname.replace(/\/+$/, '') || '/'
}

function pageTitle(): string {
  return (document.title || '未命名页面').replace(/\s*[-–—|·].*$/, '').trim() || '未命名页面'
}

function readNotes(path: string): any[] {
  try {
    const raw = localStorage.getItem(LS_PREFIX + path)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

function findNote(path: string, id: string): any | null {
  const list = readNotes(path)
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return list[i]
  }
  return null
}

function writeNotes(path: string, notes: any[]): boolean {
  try {
    localStorage.setItem(LS_PREFIX + path, JSON.stringify(notes))
    return true
  } catch (e: any) {
    alert('笔记保存失败: 浏览器本地存储已满或不可用。' + (e && e.message ? ' (' + e.message + ')' : ''))
    return false
  }
}

function uid(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => (n < 10 ? '0' : '') + n
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
  )
}

// ---------- 选中文本 <-> 字符偏移 (正文容器内) ----------

function textLengthUpTo(boundaryNode: Node, boundaryOffset: number): number {
  const container = contentEl()
  if (boundaryNode.nodeType === 3) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let total = 0
    let n: Node | null
    while ((n = walker.nextNode())) {
      if (n === boundaryNode) {
        return total + Math.min(boundaryOffset, (n as Text).nodeValue!.length)
      }
      total += (n as Text).nodeValue!.length
    }
    return total
  }
  // element boundary (rare): 边界元素内 offset 之前的子节点文本
  let prefix = 0
  for (let i = 0; i < boundaryOffset && i < boundaryNode.childNodes.length; i++) {
    const c = boundaryNode.childNodes[i]
    if (c.nodeType === 3) prefix += (c as Text).nodeValue!.length
    else if (c.nodeType === 1) prefix += (c as Element).textContent!.length
  }
  let total2 = 0
  let m: Node | null
  const walker2 = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  while ((m = walker2.nextNode())) {
    if (boundaryNode.contains(m)) {
      return total2 + prefix
    }
    total2 += (m as Text).nodeValue!.length
  }
  return total2 + prefix
}

function captureSelection(): { start: number; end: number; text: string } | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  const container = contentEl()
  if (!container.contains(range.commonAncestorContainer)) return null
  let start = textLengthUpTo(range.startContainer, range.startOffset)
  let end = textLengthUpTo(range.endContainer, range.endOffset)
  if (start > end) {
    const t = start
    start = end
    end = t
  }
  if (end <= start) return null
  const text = range.toString().replace(/\s+/g, ' ').trim()
  if (!text) return null
  return { start, end, text: text.slice(0, 300) }
}

// ---------- 高亮 ----------

function applyHighlight(note: any) {
  if (!note.sel || typeof note.sel.start !== 'number' || typeof note.sel.end !== 'number') return
  const start = note.sel.start
  const end = note.sel.end
  if (end <= start) return
  // 先快照全部文本节点, 再逐个包裹 —— surroundContents 会改动 DOM,
  // 若用活 TreeWalker 继续遍历会重访刚包裹的节点, 造成嵌套高亮
  const walker = document.createTreeWalker(contentEl(), NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) nodes.push(n as Text)
  let pos = 0
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const len = node.nodeValue!.length
    const nodeStart = pos
    const nodeEnd = pos + len
    pos = nodeEnd
    if (nodeEnd <= start || nodeStart >= end) continue
    const s = Math.max(0, start - nodeStart)
    const e = Math.min(len, end - nodeStart)
    if (e <= s) continue
    try {
      const mark = document.createElement('mark')
      mark.className = 'cs-note-mark'
      mark.dataset.id = note.id
      mark.title = (note.content || '').slice(0, 100)
      const r = document.createRange()
      r.setStart(node, s)
      r.setEnd(node, e)
      r.surroundContents(mark)
    } catch (err) {
      /* 跳过无法包裹的节点 (如 SVG) */
    }
  }
}

function unwrapMarks(id?: string) {
  const marks = document.querySelectorAll('.cs-note-mark')
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i] as HTMLElement
    if (id && m.dataset.id !== id) continue
    const parent = m.parentNode!
    while (m.firstChild) parent.insertBefore(m.firstChild, m)
    parent.removeChild(m)
  }
}

function applyAllMarks() {
  unwrapMarks()
  readNotes(pageKey()).forEach(applyHighlight)
}

// ---------- 导出 / 复制 ----------

function toMarkdown(note: any): string {
  const title = note.pageTitle || pageTitle()
  const lines = ['**学习笔记 · ' + fmtTime(note.ts) + '**', '来自: [' + title + '](' + (note.pageUrl || location.href) + ')']
  if (note.sel && note.sel.text) lines.push('', '> 划词: "' + note.sel.text + '"')
  lines.push('', note.content)
  return lines.join('\n')
}

function copyText(text: string, okMsg?: string) {
  const fallback = () => {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.cssText = 'position:fixed;opacity:0;'
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      toast(okMsg || '已复制')
    } catch (e) {
      toast('复制失败, 请手动复制')
    }
    document.body.removeChild(ta)
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toast(okMsg || '已复制'),
      fallback
    )
  } else {
    fallback()
  }
}

function exportIssue(note: any) {
  const title = '📝 学习笔记: ' + (note.pageTitle || pageTitle())
  const url =
    'https://github.com/' + GITHUB_REPO + '/issues/new?title=' +
    encodeURIComponent(title) + '&body=' + encodeURIComponent(toMarkdown(note))
  window.open(url, '_blank')
}

let toastTimer: number | null = null
function toast(msg: string) {
  let el = document.getElementById('cs-notes-toast')
  if (!el) {
    el = document.createElement('div')
    el.id = 'cs-notes-toast'
    document.body.appendChild(el)
  }
  el.textContent = msg
  el.style.opacity = '1'
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    el!.style.opacity = '0'
  }, 2200)
}

// ---------- UI 构造 ----------

// 惰性初始化: SSR 构建时无 window/location, 必须延迟到 initNotes() 里赋值
const state = { tab: 'page' as 'page' | 'all', path: '' }
let pendingSel: { start: number; end: number; text: string } | null = null

function el(tag: string, cls?: string, html?: string): HTMLElement {
  const n = document.createElement(tag)
  if (cls) n.className = cls
  if (html !== undefined) n.innerHTML = html
  return n
}

// ---------- 弹窗 (新建 / 编辑) ----------

let popState: { path: string; id: string | null } | null = null

function openPopover(path: string, id: string | null, selInfo?: { text: string } | null) {
  const pop = document.getElementById('cs-notes-pop')!
  const quote = document.getElementById('cs-notes-pop-quote')!
  const ta = document.getElementById('cs-notes-pop-input') as HTMLTextAreaElement
  const note = id ? findNote(path, id) : null
  popState = { path, id: id || null }
  ta.value = note ? note.content : ''
  const selText = (note && note.sel && note.sel.text) || (selInfo && selInfo.text)
  if (selText) {
    quote.style.display = 'block'
    quote.textContent = '划词: "' + selText + '"'
  } else {
    quote.style.display = 'none'
  }
  pop.classList.add('open')
  ta.focus()
}

function closePopover() {
  const pop = document.getElementById('cs-notes-pop')
  if (pop) pop.classList.remove('open')
  popState = null
}

function savePopover() {
  if (!popState) return
  const ta = document.getElementById('cs-notes-pop-input') as HTMLTextAreaElement
  const content = ta.value.trim()
  if (!content) {
    toast('先写点内容再保存')
    return
  }
  let notes = readNotes(popState.path)
  if (popState.id) {
    notes = notes.map((n) => {
      if (n.id !== popState!.id) return n
      const copy: any = {}
      for (const k in n) {
        if (Object.prototype.hasOwnProperty.call(n, k)) copy[k] = n[k]
      }
      copy.content = content
      return copy
    })
  } else {
    notes.unshift({
      id: uid(),
      ts: Date.now(),
      content,
      pageTitle: pageTitle(),
      pageUrl: location.href,
      sel: pendingSel || null
    })
    pendingSel = null
  }
  if (writeNotes(popState.path, notes)) {
    closePopover()
    applyAllMarks()
    render()
    toast('已保存到本浏览器')
  }
}

// ---------- 面板 (本页 / 全部) ----------

function buildNoteItem(note: any, path: string): HTMLElement {
  const item = el('div', 'cn-item')
  const meta = el('div', 'cn-meta')
  meta.textContent = fmtTime(note.ts) + (path !== pageKey() ? ' · ' + path : '')
  let quote: HTMLElement | null = null
  if (note.sel && note.sel.text) {
    quote = el('div', 'cn-quote')
    quote.textContent = '"' + note.sel.text + '"'
  }
  const text = el('div', 'cn-text')
  text.textContent = note.content
  const ops = el('div', 'cn-ops')

  const btnCopy = el('button', '', '复制')
  btnCopy.title = '复制 Markdown, 可粘贴到 Discussions'
  btnCopy.addEventListener('click', () => {
    copyText(toMarkdown(note), '已复制, 可粘贴到 Discussions')
  })
  const btnIssue = el('button', '', 'Issue')
  btnIssue.title = '导出为预填的 GitHub Issue'
  btnIssue.addEventListener('click', () => exportIssue(note))
  const btnEdit = el('button', '', '编辑')
  btnEdit.addEventListener('click', () => openPopover(path, note.id))
  const btnDel = el('button', 'cn-del', '删除')
  btnDel.addEventListener('click', () => {
    if (!confirm('删除这条笔记? (对应高亮会一并移除)')) return
    const notes = readNotes(path)
    writeNotes(path, notes.filter((n: any) => n.id !== note.id))
    if (path === pageKey()) unwrapMarks(note.id)
    render()
    toast('已删除')
  })

  ops.appendChild(btnCopy)
  ops.appendChild(btnIssue)
  ops.appendChild(btnEdit)
  ops.appendChild(btnDel)
  item.appendChild(meta)
  if (quote) item.appendChild(quote)
  item.appendChild(text)
  item.appendChild(ops)
  return item
}

function render() {
  const body = document.getElementById('cs-notes-body')
  if (!body) return
  body.textContent = ''
  if (state.tab === 'page') {
    const notes = readNotes(state.path)
    if (!notes.length) {
      body.appendChild(el('div', 'cn-empty', '本页还没有笔记 — 选中正文任意文字试试'))
      return
    }
    notes.forEach((n) => body!.appendChild(buildNoteItem(n, state.path)))
  } else {
    let any = false
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key || key.indexOf(LS_PREFIX) !== 0) continue
        const path = key.slice(LS_PREFIX.length)
        const list = readNotes(path)
        if (!list.length) continue
        any = true
        body.appendChild(el('div', 'cn-page', path))
        list.forEach((n: any) => body!.appendChild(buildNoteItem(n, path)))
      }
    } catch (e) {
      /* ignore */
    }
    if (!any) body.appendChild(el('div', 'cn-empty', '还没有任何笔记'))
  }
}

function hideSelbar() {
  const bar = document.getElementById('cs-notes-selbar')
  if (bar) bar.style.display = 'none'
}

/** 面板标题随路由刷新 */
function refreshHead() {
  const span = document.getElementById('cs-notes-panel-title')
  if (span) span.textContent = pageTitle()
  const popHead = document.querySelector('#cs-notes-pop .cn-pop-head b')
  if (popHead) popHead.textContent = pageTitle()
}

// ---------- 初始化 / 路由切换 ----------

export function initNotes() {
  if (document.getElementById('cs-notes-root')) return
  state.path = pageKey()

  const root = document.createElement('div')
  root.id = 'cs-notes-root'

  // 悬浮按钮
  const fab = el('button', '', '📝')
  fab.id = 'cs-notes-fab'
  fab.setAttribute('aria-label', '打开学习笔记')
  fab.title = '学习笔记 (存本浏览器, 可导出 Issue)'
  fab.addEventListener('click', () => {
    const panel = document.getElementById('cs-notes-panel')!
    const open = panel.classList.toggle('open')
    fab.style.display = open ? 'none' : 'flex'
    if (open) render()
  })

  // 面板
  const panel = el('div', '')
  panel.id = 'cs-notes-panel'
  const head = el('div', 'cn-head', '<b>学习笔记</b><span id="cs-notes-panel-title">' + pageTitle() + '</span>')
  const btnAdd = el('button', 'cn-add', '+ 新笔记')
  btnAdd.addEventListener('click', () => openPopover(state.path, null, null))
  const close = el('button', 'cn-close', '✕')
  close.title = '关闭'
  close.addEventListener('click', () => {
    panel.classList.remove('open')
    fab.style.display = 'flex'
  })
  head.appendChild(btnAdd)
  head.appendChild(close)

  const tabs = el('div', 'cn-tabs', '<button class="cn-tab" data-tab="page">本页</button><button class="cn-tab" data-tab="all">全部</button>')
  tabs.querySelectorAll('.cn-tab').forEach((t) => {
    ;(t as HTMLElement).addEventListener('click', () => {
      state.tab = (t as HTMLElement).getAttribute('data-tab') as 'page' | 'all'
      tabs.querySelectorAll('.cn-tab').forEach((x) => x.classList.remove('active'))
      t.classList.add('active')
      render()
    })
  })

  const body = el('div', 'cn-body')
  body.id = 'cs-notes-body'
  const hint = el(
    'div',
    'cn-hint',
    '选中正文文字即可记笔记; 数据仅存本浏览器 (localStorage)。复制 Markdown 可粘贴到 Discussions, 导出 Issue 后在仓库沉淀。'
  )
  panel.appendChild(head)
  panel.appendChild(tabs)
  panel.appendChild(body)
  panel.appendChild(hint)

  // 划词工具条
  const selbar = el('div', '')
  selbar.id = 'cs-notes-selbar'
  const selbarBtn = el('button', '', '📝 记笔记')
  selbarBtn.addEventListener('click', () => {
    if (pendingSel) {
      openPopover(pageKey(), null, pendingSel)
      hideSelbar()
    }
  })
  selbar.appendChild(selbarBtn)

  // 笔记弹窗
  const pop = el('div', '')
  pop.id = 'cs-notes-pop'
  const popHead = el('div', 'cn-pop-head', '<b>' + pageTitle() + '</b>')
  const popClose = el('button', '', '✕')
  popClose.title = '关闭'
  popClose.addEventListener('click', closePopover)
  popHead.appendChild(popClose)
  const popQuote = el('div', 'cn-pop-quote', '')
  popQuote.id = 'cs-notes-pop-quote'
  const popTa = document.createElement('textarea')
  popTa.id = 'cs-notes-pop-input'
  popTa.placeholder = '写下你的心得 / 补充… (Markdown 可用)'
  const popOps = el(
    'div',
    'cn-pop-ops',
    '<button type="button" id="cs-notes-pop-cancel">取消</button><button type="button" class="cn-save" id="cs-notes-pop-save">保存</button>'
  )
  popOps.querySelector('#cs-notes-pop-cancel')!.addEventListener('click', closePopover)
  popOps.querySelector('#cs-notes-pop-save')!.addEventListener('click', savePopover)
  pop.appendChild(popHead)
  pop.appendChild(popQuote)
  pop.appendChild(popTa)
  pop.appendChild(popOps)

  root.appendChild(fab)
  root.appendChild(panel)
  root.appendChild(selbar)
  root.appendChild(pop)
  document.body.appendChild(root)
  tabs.querySelector('[data-tab="page"]')!.classList.add('active')

  // ---------- 事件 ----------

  document.addEventListener('mouseup', (e) => {
    if ((e.target as HTMLElement)?.closest?.('#cs-notes-root')) return
    const sel = window.getSelection()
    const container = contentEl()
    if (!sel || sel.isCollapsed) {
      hideSelbar()
      return
    }
    if (!container.contains(sel.anchorNode) || !container.contains(sel.focusNode)) {
      hideSelbar()
      return
    }
    const cap = captureSelection()
    if (!cap) {
      hideSelbar()
      return
    }
    pendingSel = cap
    let rect: DOMRect | null = null
    try {
      rect = sel.getRangeAt(0).getBoundingClientRect()
    } catch (err) {
      rect = null
    }
    if (rect && rect.width > 0) {
      selbar.style.display = 'flex'
      const x = Math.max(4, Math.min(rect.left, window.innerWidth - 170))
      let y = rect.bottom + 6
      if (y + 34 > window.innerHeight) y = Math.max(4, rect.top - 34)
      selbar.style.left = x + 'px'
      selbar.style.top = y + 'px'
    }
  })

  document.addEventListener('mousedown', (e) => {
    if (!((e.target as HTMLElement)?.closest?.('#cs-notes-root'))) hideSelbar()
  })

  window.addEventListener('scroll', hideSelbar, true)
  window.addEventListener('resize', hideSelbar)

  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement)?.closest?.('#cs-notes-root')) return
    const mark = (e.target as HTMLElement)?.closest?.('.cs-note-mark')
    if (mark) {
      e.preventDefault()
      const id = (mark as HTMLElement).dataset.id
      if (id && findNote(pageKey(), id)) openPopover(pageKey(), id)
      return
    }
    closePopover()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePopover()
  })

  // 页面加载完成后应用高亮 (等 KaTeX / Mermaid 渲染完)
  const applyAfterLoad = () => {
    setTimeout(applyAllMarks, 400)
  }
  if (document.readyState === 'complete') {
    applyAfterLoad()
  } else {
    window.addEventListener('load', applyAfterLoad)
  }
}

/** SPA 路由切换: 由 Theme 组件在延迟(等内容+图渲染)后调用 */export function onRouteChange() {
  state.path = pageKey()
  pendingSel = null
  refreshHead()
  hideSelbar()
  closePopover()
  applyAllMarks()
  render()
}
