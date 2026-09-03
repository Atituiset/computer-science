import DefaultTheme from 'vitepress/theme'
import { h } from 'vue'
import NotesTool from './components/NotesTool.vue'
import 'katex/dist/katex.min.css'
import './notes.css'
import type { Theme } from 'vitepress'

export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      // 悬浮笔记工具为 fixed 定位, 挂在 layout-bottom 插槽且随 SPA 导航持久存在
      'layout-bottom': () => h(NotesTool)
    })
} satisfies Theme
