/**
 * e2e/playwright.config.ts — InnerAgent 管理站 E2E 配置(测试基建)。
 *
 * - baseURL 指向 e2e/gateway.mjs(18081:web 生产构建静态服务 + /ia 反代 18090);
 * - 截图策略(任务口径):
 *   · 通过用例 = 业务关键步显式截图(helpers/support.ts shot(),落报告 assets/);
 *   · 失败用例 = 完整 trace + 全步截图(trace 内含每步截图)+ video + console 落文件
 *     (见 fixtures 的 afterEach 捕获,输出 e2e/test-results);
 * - workers=1:六个业务线共享同一数据库状态,串行保证可复跑确定性。
 */
import { defineConfig } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const artifacts = resolve(here, 'test-results')
mkdirSync(artifacts, { recursive: true })

export default defineConfig({
  testDir: './specs',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: artifacts,
  reporter: [['list'], ['html', { outputFolder: resolve(here, 'playwright-report'), open: 'never' }]],
  use: {
    baseURL: process.env.GATEWAY_URL || 'http://localhost:18081',
    screenshot: { mode: 'only-on-failure', fullPage: true },
    trace: { mode: 'retain-on-failure', screenshots: true, snapshots: true, sources: true },
    video: { mode: 'retain-on-failure' },
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    viewport: { width: 1440, height: 900 },
    locale: 'zh-CN',
  },
})
