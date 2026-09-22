import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import pkg from './package.json'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'pinia', 'vue-i18n'],
      dts: 'auto-imports.d.ts',
      eslintrc: { enabled: false },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version || '0.0.0'),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@use "@/styles/variables.scss" as *;`
      }
    }
  },
  server: {
    port: 9203,
    open: true,
    // 允许生产域名 Host 头穿透 (OEM 多租户识别 + Nginx 反代模拟)
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      'aigc-beta.lhs11.com',
      'aidoit-beta.lhs11.com',
      '.lhs11.com'
    ],
    proxy: {
      // ACME DEMO 宿主后端(embed token 签发/工单/webhook 事件)
      '/api': {
        target: 'http://127.0.0.1:9300',
        changeOrigin: true
      },
      // InnerAgent server(仅 API 前缀;SDK baseURL /ia/api/v1 与 SSE 流)。
      // 不能放宽到 '/ia':/ia/overview|agents|embed|tools 是 SPA 路由、
      // /ia/frame.html 是 public/ia/ 被嵌页,前缀过宽会被代理劫持成 404 JSON
      // (真机截图验收发现的冲突,2026-09-22)。
      '/ia/api': {
        target: 'http://127.0.0.1:18090',
        changeOrigin: true
      }
    }
  },
  build: {
    // 拆分大依赖到独立 chunk, 避免 500kB 警告
    rollupOptions: {
      output: {
        manualChunks: {
          // Vue 运行时 + 路由 + 状态管理
          'vue-vendor': ['vue', 'vue-router', 'pinia', 'vue-i18n'],
          // UI 库
          'element-plus': ['element-plus', '@element-plus/icons-vue'],
        },
      },
    },
    // 单 chunk 报警阈值 (kB); element-plus 完整包约 1MB, 业务依赖都在此阈值之下
    chunkSizeWarningLimit: 1100,
  }
})
