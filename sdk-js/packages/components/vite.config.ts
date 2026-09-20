import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// [new] Web Component 构建: defineCustomElement 样式内联进 Shadow DOM;
// remixicon 字体经 assetsInlineLimit 内联为 data URI (WC 内 <i class="ri-*"> 可用)。
export default defineConfig({
  plugins: [vue()],
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
