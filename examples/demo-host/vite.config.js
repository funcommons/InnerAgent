// [new] demo-host 本地服务: 静态宿主页 + /ia 反代到本机 18090 (手工冒烟用)。
import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5180,
    proxy: {
      // SDK baseURL 默认 '/ia/api/v1' → 同源反代到 inneragent-server (local profile)
      '/ia': {
        target: 'http://127.0.0.1:18090',
        changeOrigin: true,
      },
    },
  },
})
