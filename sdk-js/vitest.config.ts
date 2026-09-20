import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

/**
 * InnerAgent SDK monorepo 测试入口 (任务 P1-T3a)。
 * - project core: packages/core — 时间线 reducer / API 重映射 / SSE 解析 / tokenGetter 懒换
 * - project components: packages/components — 组件挂载冒烟 + WC 注册冒烟
 * 全部 mock (msb 不引入, 直接 vi.fn/stubGlobal fetch), 不要求真实服务端。
 */
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@inneragent/sdk-core': fileURLToPath(new URL('./packages/core/src', import.meta.url)),
      '@inneragent/sdk-components': fileURLToPath(new URL('./packages/components/src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['packages/*/src/**/*.{test,spec}.ts'],
  },
})
