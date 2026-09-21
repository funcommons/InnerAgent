// [new] iframe 演示本地服务 (P4/W15):
// - 5181 端口起 demo 宿主页 (index.html) 与被嵌页 (frame.html)
// - /ia 反代到本机 18090 服务端 (child 页内 API 走同源 /ia/api/v1)
// - fs.allow 放行 ../../sdk-js (直接引用构建产物 dist/iframe-*.js)
import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  server: {
    port: 5181,
    fs: {
      allow: [fileURLToPath(new URL('../..', import.meta.url))],
    },
    proxy: {
      '/ia': {
        target: 'http://127.0.0.1:18090',
        changeOrigin: true,
      },
    },
  },
})
