/**
 * run.mjs — 《docs/使用手册》全量回归驱动入口(只读测试;不改产品代码/文档)。
 *
 * 用法:
 *   node run.mjs all     # 完整四阶段:pre(MiniMax 基线)→ 播种 mock → api → ui → 回切
 *   node run.mjs pre|api|ui|finalize
 *
 * 环境足迹自动记录到 state/env-footprint.log;结果合并到 results.json;证据在 assets/。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeBrowser, results, savePhase } from './lib.mjs'
import { phasePre } from './phases/pre.mjs'
import { phaseApi1, seedMock } from './phases/api1.mjs'
import { phaseApi2 } from './phases/api2.mjs'
import { phaseApi3 } from './phases/api3.mjs'
import { phaseUi } from './phases/ui.mjs'
import { phaseFinalize } from './phases/finalize.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const which = process.argv[2] || 'all'
const t0 = Date.now()

async function main() {
  if (which === 'all' || which === 'pre') {
    console.log('== 阶段 pre:MiniMax 真模型基线 ==')
    await phasePre()
  }
  if (which === 'all' || which === 'api') {
    console.log('== 阶段 api:播种 canned mock 规则模型 ==')
    await seedMock()
    console.log('== 阶段 api1:确认流/模型/SSE 契约 ==')
    await phaseApi1()
    console.log('== 阶段 api2:重连/审计/口径 ==')
    await phaseApi2()
    console.log('== 阶段 api3:运行端点/MCP/配额/错误码 ==')
    await phaseApi3()
  }
  if (which === 'all' || which === 'ui') {
    console.log('== 阶段 ui:9203 前端 ==')
    await phaseUi()
  }
  if (which === 'all' || which === 'finalize') {
    console.log('== 阶段 finalize:回切 MiniMax + 合并结果 ==')
    await phaseFinalize()
  }
}

try {
  await main()
} finally {
  await closeBrowser().catch(() => { })
  // 安全兜底:任何路径退出都必须保证 mock 不留在默认位(手册「严禁生产设为默认」口径)
  try {
    const { psql } = await import('./lib.mjs')
    const d = psql("select string_agg(code, ',') from ia_ai_model where model_type=1 and default_model").trim()
    if (d.includes('mock-text')) {
      console.log('[run.mjs] 检测到 mock 仍在默认位 — 执行兜底回切')
      const { execSync } = await import('node:child_process')
      execSync(`docker exec -i inneragent-postgres psql -U inneragent -d inneragent < ${path.join(here, '../../examples/acme-demo/seeds/mock-model-restore.sql')}`)
      console.log('[run.mjs] 兜底回切完成: ' + psql("select string_agg(code, ',') from ia_ai_model where model_type=1 and default_model").trim())
    } else {
      console.log(`[run.mjs] 默认模型检查: ${d}(mock 未在默认位,无需回切)`)
    }
  } catch (e) { console.log('[run.mjs] 兜底回切检查失败: ' + e) }
  const pass = results.filter((r) => r.status === 'PASS').length
  const fail = results.filter((r) => r.status === 'FAIL').length
  console.log(`\n[run.mjs] 本进程用例 ${results.length}:PASS=${pass} FAIL=${fail},耗时 ${((Date.now() - t0) / 1000).toFixed(0)}s`)
  if (fail > 0) {
    for (const f of results.filter((r) => r.status === 'FAIL')) console.log(`  [FAIL] ${f.id} ${f.title}`)
  }
}
