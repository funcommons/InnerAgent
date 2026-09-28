#!/usr/bin/env node
/**
 * test-report/diff.js — 对比两次报告的 PASS/FAIL delta(2026-09-24 优化建议 E2)
 *
 * 用法:
 *   node test-report/diff.js <older-report-dir> <newer-report-dir>
 *   例: node test-report/diff.js test-report/2026-09-23-01 test-report/2026-09-24-01
 *
 * 输出:
 *   - 总通过率变化(pp)
 *   - 各业务线 PASS 数变化(L0-L12)
 *   - 修复的用例列表(FAIL → PASS)
 *   - 退化的用例列表(PASS → FAIL)
 *   - 仍失败的用例列表
 */
import fs from 'node:fs'
import path from 'node:path'

function load(dir) {
  const file = path.join(dir, 'results.json')
  if (!fs.existsSync(file)) {
    console.error(`未找到 ${file}`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(file, 'utf-8'))
}

function summary(results) {
  const total = results.length
  const pass = results.filter(r => r.status === 'PASS').length
  return { total, pass, rate: total ? (pass / total) * 100 : 0 }
}

function byLine(results) {
  const map = new Map()
  for (const r of results) {
    const line = r.line || '未分类'
    if (!map.has(line)) map.set(line, { total: 0, pass: 0 })
    map.get(line).total += 1
    if (r.status === 'PASS') map.get(line).pass += 1
  }
  return map
}

const [_, __, olderDir, newerDir] = process.argv
if (!olderDir || !newerDir) {
  console.error('用法: node test-report/diff.js <older> <newer>')
  process.exit(1)
}

const older = load(olderDir)
const newer = load(newerDir)
const oldSummary = summary(older)
const newSummary = summary(newer)
const oldByLine = byLine(older)
const newByLine = byLine(newer)

const deltaPP = newSummary.rate - oldSummary.rate
const allLines = new Set([...oldByLine.keys(), ...newByLine.keys()])

console.log(`\n报告对比: ${path.basename(olderDir)} → ${path.basename(newerDir)}\n`)
console.log(`总通过率: ${oldSummary.rate.toFixed(1)}% (${oldSummary.pass}/${oldSummary.total}) → ${newSummary.rate.toFixed(1)}% (${newSummary.pass}/${newSummary.total}) [${deltaPP >= 0 ? '+' : ''}${deltaPP.toFixed(1)}pp]\n`)

console.log('业务线 PASS 数变化:')
const sortedLines = [...allLines].sort()
for (const line of sortedLines) {
  const o = oldByLine.get(line) || { total: 0, pass: 0 }
  const n = newByLine.get(line) || { total: 0, pass: 0 }
  const dPP = n.pass - o.pass
  if (o.pass === 0 && n.pass === 0) continue
  console.log(`  ${line.padEnd(12, ' ')} ${o.pass}/${o.total} → ${n.pass}/${n.total}  ${dPP === 0 ? '(持平)' : `[${dPP > 0 ? '+' : ''}${dPP}]`}`)
}

const oldById = new Map(older.map(r => [r.id, r]))
const newById = new Map(newer.map(r => [r.id, r]))
const allIds = new Set([...oldById.keys(), ...newById.keys()])
const fixed = []
const regressed = []
const stillFailing = []
const stillPassing = []

for (const id of allIds) {
  const o = oldById.get(id)
  const n = newById.get(id)
  if (!o) continue
  if (!n) continue
  if (o.status === 'FAIL' && n.status === 'PASS') fixed.push(`${id} ${n.title}`)
  else if (o.status === 'PASS' && n.status === 'FAIL') regressed.push(`${id} ${n.title}`)
  else if (n.status === 'FAIL') stillFailing.push(`${id} ${n.title}`)
  else if (n.status === 'PASS') stillPassing.push(`${id} ${n.title}`)
}

if (fixed.length) {
  console.log(`\n✅ 修复的用例(${fixed.length}):`)
  fixed.forEach(s => console.log(`  - ${s}`))
}
if (regressed.length) {
  console.log(`\n⚠️ 退化的用例(${regressed.length}):`)
  regressed.forEach(s => console.log(`  - ${s}`))
}
if (stillFailing.length) {
  console.log(`\n❌ 仍失败的用例(${stillFailing.length}):`)
  stillFailing.forEach(s => console.log(`  - ${s}`))
}
if (stillPassing.length) {
  console.log(`\n✓ 保持通过的用例(${stillPassing.length}):`)
  stillPassing.slice(0, 5).forEach(s => console.log(`  - ${s}`))
  if (stillPassing.length > 5) console.log(`  ... 共 ${stillPassing.length} 个`)
}
console.log()