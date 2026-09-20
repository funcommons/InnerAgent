import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// [new] library mode 构建 (验收以测试+typecheck 为主, 此配置保证 vite build 可产出)
export default defineConfig({
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      formats: ['es'],
      fileName: 'inneragent-sdk-core',
    },
    rollupOptions: {
      external: ['vue', 'pinia'],
    },
    outDir: 'dist',
  },
})
