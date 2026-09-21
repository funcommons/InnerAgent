import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

/**
 * [new] 宿主侧产物 (dist/iframe-host.js) — P4/W15。
 *
 * createIframeEmbed 纯 TS 实现, 零框架依赖, 单文件可引入任意宿主页。
 */
export default defineConfig({
  build: {
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./src/host.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'iframe-host.js',
    },
    outDir: 'dist',
    emptyOutDir: false,
  },
})
