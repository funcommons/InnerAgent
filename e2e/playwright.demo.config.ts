/**
 * e2e/playwright.demo.config.ts — DEMO 业务线全量回归(24 用例)独立项目。
 *
 * [E1 转正 2026-09-27] `demo-regression.driver.mjs` 由 tmp 脚本收编为
 * playwright 可复跑资产:
 *   npx playwright test -c playwright.demo.config.ts
 *
 * - 目标是 9203 演示前端(真模型 MiniMax-M3),与管理站默认套件
 *   (playwright.config.ts,baseURL 18081)完全隔离,互不影响;
 * - wrapper spec 以子进程运行 driver(单一事实源),按 results.json
 *   逐用例断言;单 test 超时 20 分钟(真模型对话 + 24 用例串行);
 * - CI mock 模型兜底仍待产品侧 canned mock(平台现无确定性 mock 模型,
 *   L4-L8 断言依赖真实模型行为),暂以真模型 + 手动/夜间触发。
 */
import { defineConfig } from '@playwright/test'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: './specs-demo',
  timeout: 1_200_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: resolve(here, 'test-results-demo'),
  reporter: [['list']],
  use: {
    baseURL: process.env.DEMO_URL || 'http://localhost:9203',
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  },
})
