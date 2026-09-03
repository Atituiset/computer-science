/**
 * 检测被 markdown-it-attrs 误吞的花括号内容:
 * 正文里 `foo {a: 1, b: 2}` 会被解析成 HTML 属性 -> 属性名含 : 或 , 的空属性
 *
 * 用法: node scripts/detect-attrs.mjs
 * (需要项目已安装 vitepress; 输出可疑行, 人工确认后修内容)
 */
import { createMarkdownRenderer } from 'vitepress'
import fs from 'fs'
import { execSync } from 'child_process'

const md = await createMarkdownRenderer(process.cwd(), {}, '/')
const files = execSync("git ls-files '*.md'").toString().trim().split('\n')
let hits = 0
for (const f of files) {
  let out
  try {
    out = md.render(fs.readFileSync(f, 'utf-8'))
  } catch {
    continue
  }
  // 属性名含 : 或 , 的空属性 —— 正常内容不会出现这种属性
  const bad = out.match(/<[a-z0-9]+[^>]* [^"=<> ]*[:,][^"=<> ]*=""/g)
  if (bad) {
    hits += bad.length
    console.log(f + ' :: ' + bad.join(' | '))
  }
}
console.error('total suspicious tags:', hits)
