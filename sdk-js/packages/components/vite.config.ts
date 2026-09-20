import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// [new] <inneragent-chat> Web Component 构建。
// - vue({ customElement: true }): 所有 SFC <style> 编译进组件 styles 数组
//   (而非抽到独立 css 文件), 由 VueElement._injectChildStyle 注入 shadow root,
//   保证 Shadow DOM 样式隔离。
// - remixicon 图标样式经 InnerAgentChat.ce.vue 的
//   <style src="./styles/remixicon-ce.css"> 注入 (woff2-only 生成子集,
//   字体 data URI 内联, 全量五格式内联 ~6.5MB → ~0.5MB)。
export default defineConfig({
  plugins: [vue({ customElement: true, features: { customElement: true } })],
  resolve: {
    alias: {
      '@inneragent/sdk-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/inneragent-chat.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'inneragent-chat',
    },
    rollupOptions: {
      external: ['vue', 'pinia'],
    },
    assetsInlineLimit: 100 * 1024 * 1024,
    outDir: 'dist',
  },
})
