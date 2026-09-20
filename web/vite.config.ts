import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

// [new] InnerAgent 管理站构建配置(参考 $SRC/frontend/vite.config.ts 的 alias/proxy 模式)
export default defineConfig({
  base: '/',
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5180,
    // 本任务全程 msw mock,不接真实服务;代理仅留给 P2 正式联调时启用
    proxy: {
      '/ia/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vue-vendor': ['vue', 'vue-router', 'pinia'],
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
        },
      },
    },
    chunkSizeWarningLimit: 1100,
  },
})
