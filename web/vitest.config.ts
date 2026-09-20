import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// [adapt] 测试配置,融合 $SRC/frontend/vitest.config.ts 的结构;
// element-plus 内联进 vite 处理链,避免 async-validator CJS/ESM 双构建解析问题
// (同 $SRC vitest.config.ts server.deps.inline 注释所述)。
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.ts'],
      setupFiles: ['src/mocks/setup.ts'],
      server: {
        deps: {
          inline: ['element-plus'],
        },
      },
    },
  }),
)
