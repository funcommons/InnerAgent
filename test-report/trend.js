#!/usr/bin/env node
/**
 * test-report/trend.js — 把所有 test-report 的总通过率汇聚成 trend.json(2026-09-24 优化建议 E2)
 *
 * 用法:
 *   node test-report/trend.js
 *
 * 输出:
 *   test-report/trend.json — 数组,每项含 { date, dir, total, pass, rate, fixed, regressed }
 */
import fs from 'node:fs'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname)
const dirs = fs.readdirSync(here).filter(d => /^\d{4}-\d{2}-\d{2}-\d{2}$/.test(d)).sort()

const summary = []
for (const dir of dirs) {
  const file = path.join(here, dir, 'results.json')
  if (!fs.existsSync(file)) continue
  const results = JSON.parse(fs.readFileSync(file, 'utf-8'))
  const total = results.length
  const pass = results.filter(r => r.status === 'PASS').length
  summary.push({
    date: dir,
    dir,
    total,
    pass,
    rate: total ? Number((pass / total * 100).toFixed(1)) : 0,
  })
}

fs.writeFileSync(path.join(here, 'trend.json'), JSON.stringify(summary, null, 2))
console.log(`已扫描 ${dirs.length} 个报告目录 → ${path.join(here, 'trend.json')}`)
summary.forEach(s => console.log(`  ${s.date}: ${s.pass}/${s.total} (${s.rate}%)`))