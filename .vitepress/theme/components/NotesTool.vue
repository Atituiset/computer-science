<script lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vitepress'
import { initNotes, onRouteChange } from '../notes'

export default {
  name: 'NotesTool',
  setup() {
    onMounted(() => {
      // 初始挂载: 注入 UI 与高亮
      initNotes()
      // SPA 路由切换: 等待新页面 + KaTeX/Mermaid 渲染完成后重建高亮/面板
      useRouter().onAfterRouteChange = async () => {
        setTimeout(() => onRouteChange(), 500)
      }
    })
    return () => null
  }
}
</script>
