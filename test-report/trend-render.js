#!/usr/bin/env node
/**
 * test-report/trend-render.js — 把 trend.json 渲染成 markdown 表格(2026-09-24 优化建议 E2)
 *
 * 用法:
 *   node test-report/trend-render.js
 *
 * 输出:
 *   test-report/TREND.md — 趋势报告(总通过率随时间)
 */
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const trendFile = path.join(here, 'trend.json')
if (!fs.existsSync(trendFile)) {
  console.error(`未找到 ${trendFile};先跑 trend.js 生成`)
  process.exit(1)
}

const data = JSON.parse(fs.readFileSync(trendFile, 'utf-8'))

const lines = ['# 测试趋势报告(TREND)', '', '| 日期 | 用例 | PASS | 通过率 |', '|---|---|---|---|']
for (const row of data) {
  lines.push(`| ${row.date} | ${row.total} | ${row.pass} | ${row.rate}% |`)
}

if (data.length >= 2) {
  const first = data[0]
  const last = data[data.length - 1]
  const deltaPP = last.rate - first.rate
  lines.push('', `## 趋势: ${first.date} → ${last.date}`, ``, `总通过率变化: **${deltaPP >= 0 ? '+' : ''}${deltaPP.toFixed(1)}pp**`)
}

fs.writeFileSync(path.join(here, 'TREND.md'), lines.join('\n'))
console.log(`已写入 ${path.join(here, 'TREND.md')}`)
data.forEach(r => console.log(`  ${r.date}: ${r.pass}/${r.total} (${r.rate}%)`))