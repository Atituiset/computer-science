import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'
import { katex } from '@mdit/plugin-katex'
import { buildSidebar, buildRewrites } from './summary'

const nav = [
  { text: '导论', link: '/prologue/' },
  { text: '数学', link: '/math/' },
  { text: '工程化', link: '/engineering/' },
  {
    text: '核心基础',
    items: [
      { text: '数据结构与算法', link: '/dsa/' },
      { text: '操作系统', link: '/os/' },
      { text: '计算机网络', link: '/networking/' },
      { text: '数据库系统', link: '/databases/' },
      { text: '编译原理', link: '/compilers/' },
      { text: '计算机组成原理', link: '/computer-arch/' }
    ]
  },
  {
    text: '系统与理论',
    items: [
      { text: '分布式系统', link: '/distributed/' },
      { text: '系统设计', link: '/system-design/' },
      { text: '计算理论', link: '/theory/' },
      { text: '密码学与安全', link: '/crypto/' },
      { text: '信息论与编码', link: '/info-theory/' },
      { text: '形式化方法', link: '/formal/' },
      { text: '量子计算', link: '/quantum/' }
    ]
  },
  { text: 'AI/ML', link: '/ai-ml/' },
  { text: '元抽象', link: '/_meta/' },
  { text: '笔记', link: '/notes/' }
]

export default withMermaid(
  defineConfig({
    lang: 'zh-CN',
    title: 'Computer Science Notes',
    description:
      'Personal CS knowledge base — DSA, OS, Networks, DB, Compilers, Distributed Systems, System Design, Computer Architecture, Computation Theory, Cryptography, Information Theory',
    base: '/computer-science/',
    // URL 与 mdBook 时代保持一致: README.md -> /dir/
    cleanUrls: true,
    rewrites: buildRewrites(),

    srcExclude: ['book/**', 'node_modules/**'],

    // mdBook 时代启用的 fold: 分组默认展开, 可点击折叠
    themeConfig: {
      nav,
      sidebar: buildSidebar(),
      outline: { level: [2, 3], label: '页面导航' },
      docFooter: { prev: '上一页', next: '下一页' },
      lastUpdated: { text: '最后更新于', formatOptions: { dateStyle: 'short', timeStyle: 'short' } },
      returnToTopLabel: '回到顶部',
      sidebarMenuLabel: '菜单',
      darkModeSwitchLabel: '主题',
      lightModeSwitchTitle: '切换到浅色模式',
      darkModeSwitchTitle: '切换到深色模式',

      socialLinks: [{ icon: 'github', link: 'https://github.com/Atituiset/computer-science' }],
      editLink: {
        pattern: 'https://github.com/Atituiset/computer-science/edit/main/:path',
        text: '在 GitHub 上编辑此页'
      },

      search: {
        provider: 'local',
        options: {
          translations: {
            button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
            modal: {
              noResultsText: '无法找到相关结果',
              resetButtonTitle: '清除查询条件',
              displayDetails: '显示详细列表',
              footer: {
                selectText: '选择',
                navigateText: '切换',
                closeText: '关闭',
                searchByText: '搜索'
              }
            }
          }
        }
      }
    },

    markdown: {
      lineNumbers: false,
      // mdBook 无此限制; 这些语言 Shiki 未收录, 注册别名映射到最接近的高亮语法
      languageAlias: {
        text: 'txt',
        cassandra: 'sql',
        cisco: 'ini',
        cuda: 'cpp',
        idris: 'haskell',
        kafka: 'ini',
        llvm: 'asm',
        openssl: 'ini',
        promql: 'yaml',
        rman: 'bash',
        thrift: 'protobuf',
        tla: 'pascal'
      },
      config(md) {
        md.use(katex, {
          throwOnError: false
          // 默认定界符即 mdBook 同款: $...$ 行内 / $$...$$ 块级
        })

        // mdBook/GitHub 风格 README.md 链接 -> index (配合 rewrites 输出 /dir/)
        const orig = md.renderer.rules.link_open!
        md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
          const i = tokens[idx].attrIndex('href')
          if (i >= 0) {
            const v = tokens[idx].attrs![i][1]
            const m = v.match(/^((?:\.\/|.*\/)?)README\.md(#.*)?$/)
            if (m) tokens[idx].attrs![i][1] = m[1] + 'index.md' + (m[2] || '')
          }
          return orig(tokens, idx, options, env, self)
        }

        // 行内 code 加 v-pre: GitHub Actions 等内容的 `${{ expr }}` 会被 Vue 当插值编译报错
        md.renderer.rules.code_inline = (tokens, idx) => {
          const token = tokens[idx]
          return '<code v-pre>' + md.utils.escapeHtml(token.content) + '</code>'
        }
      }
    },

    mermaid: { startOnLoad: false },
    mermaidPlugin: { class: 'mermaid' },

    vite: {
      // mermaid 11 的 fastdom 依赖是 UMD 无 default export, 预打包后 import 会挂;
      // 加入 include 让 esbuild 统一 interop, 避免 dev 模式应用启动失败
      optimizeDeps: {
        include: ['mermaid', 'fastdom', 'fastdom/promises']
      }
    }
  })
)
