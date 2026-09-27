/**
 * [E1 转正 2026-09-27] DEMO 业务线全量回归 wrapper。
 *
 * 以子进程运行 e2e/demo-regression.driver.mjs(24 用例唯一事实源),
 * 结束后按仓库根 results.json 逐用例断言并输出失败清单。运行方式:
 *
 *   cd e2e && npx playwright test -c playwright.demo.config.ts
 *
 * 前置(与 driver 相同):六服务在跑(9203/9300/18081/18090/PG/Redis,
 * 真模型可达)。产物:仓库根 assets/*.png + results.json;报告目录
 * test-report/<date>/ 由归档流程另行落库。
 */
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect } from '@playwright/test'

// spec 位于 e2e/specs-demo/:driver 与其输出(results.json)分别在 e2e/ 与仓库根
const e2eDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const driverPath = resolve(e2eDir, 'demo-regression.driver.mjs')
const resultsPath = resolve(e2eDir, '..', 'results.json')

test('demo 业务线全量回归(24 用例,真模型)', async () => {
  expect(existsSync(driverPath)).toBe(true)

  const run = spawnSync('node', [driverPath], {
    cwd: e2eDir,
    stdio: 'inherit',
    env: process.env,
  })

  expect(existsSync(resultsPath)).toBe(true)
  const results = JSON.parse(readFileSync(resultsPath, 'utf-8')) as Array<{
    id: string
    title: string
    status: string
    error?: string
  }>

  const failures = results.filter((item) => item.status !== 'PASS')
  const summary = results
    .map((item) => `${item.status === 'PASS' ? '✓' : '✗'} ${item.id} ${item.title}${item.error ? ` — ${item.error}` : ''}`)
    .join('\n')

  // 先把逐用例结果打進报告(失败时可读),再断言总体
  console.log(`\n[demo-regression] ${results.length - failures.length}/${results.length} PASS\n${summary}`)

  expect(run.status, 'driver 进程应正常退出(0)').
    toBe(0)
  expect(failures, `失败用例:\n${summary}`).toEqual([])
})
