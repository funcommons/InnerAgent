import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

/**
 * [new] 被嵌页自包含产物 (dist/iframe-child.js) — P4/W15。
 *
 * mountIframeAgent + sdk-core + sdk-components 的 <inneragent-chat> 一次打包,
 * vue/pinia (runtime-only) **全部内联**: 被嵌页单个 <script type="module">
 * 即可, 无需 import map (严格 CSP script-src 'self' 下内联 import map 不可用)。
 * minify 关闭: 产物可审计 (CSP/安全评审 grep 友好, csp.spec.ts 断言无危险求值)。
 */
export default defineConfig({
  plugins: [vue({ customElement: true, features: { customElement: true } })],
  resolve: {
    alias: {
      '@inneragent/sdk-core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      '@inneragent/sdk-components': fileURLToPath(new URL('../components/src/inneragent-chat.ts', import.meta.url)),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    minify: false,
    lib: {
      entry: fileURLToPath(new URL('./src/child-entry.ts', import.meta.url)),
      formats: ['es'],
      fileName: () => 'iframe-child.js',
    },
    outDir: 'dist',
  },
})
