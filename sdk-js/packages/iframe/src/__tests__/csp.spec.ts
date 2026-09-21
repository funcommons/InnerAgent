/**
 * [new] CSP 自检 (P4/W15; 03-开发计划 §7.3 验收 5「iframe 模式在严格 CSP
 * demo 宿主可用」的工程化保障):
 *
 * 1. 源码静态断言 (恒执行): sdk-js packages 的 src 内不得出现
 *    eval( / new Function( / document.write( —— 危险求值与 HTML 注入面;
 * 2. 构建产物 grep (dist 存在时执行): components WC 产物与 iframe
 *    host/child 自包含产物同样不得含危险求值; iframe 两份产物还必须
 *    **无外部 bare import** (自包含, 被嵌页不依赖 import map —— 严格 CSP
 *    script-src 'self' 下内联 import map 不可用)。
 *
 * 产物用例在 `pnpm build` 后激活 (缺失时显式跳过并提示, 不静默)。
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

// vitest 以 sdk-js 为项目根启动 (package.json scripts), cwd 即 sdk-js
const SDK_JS_ROOT = resolve(process.cwd())
const PATTERNS: Array<[RegExp, string]> = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/\bdocument\.write\s*\(/, 'document.write()'],
]

function listSources(dir: string, collected: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'dist' || name === 'node_modules') continue
      listSources(full, collected)
    } else if (/\.(ts|vue)$/.test(name)) {
      collected.push(full)
    }
  }
  return collected
}

describe('CSP 自检', () => {
  it('源码无 eval / new Function / document.write (所有 packages src)', () => {
    const packagesDir = join(SDK_JS_ROOT, 'packages')
    for (const pkg of readdirSync(packagesDir)) {
      const srcDir = join(packagesDir, pkg, 'src')
      if (!existsSync(srcDir)) continue
      for (const file of listSources(srcDir)) {
        const content = readFileSync(file, 'utf8')
        for (const [pattern, label] of PATTERNS) {
          if (pattern.test(content)) {
            throw new Error(`CSP 自检失败: ${label} 出现于 ${file.replace(SDK_JS_ROOT, '')}`)
          }
        }
      }
    }
  })

  it('构建产物无危险求值; iframe 产物自包含 (无外部 bare import)', () => {
    const artifacts = [
      { path: join(SDK_JS_ROOT, 'packages', 'components', 'dist', 'inneragent-chat.js'), selfContained: false },
      { path: join(SDK_JS_ROOT, 'packages', 'iframe', 'dist', 'iframe-host.js'), selfContained: true },
      { path: join(SDK_JS_ROOT, 'packages', 'iframe', 'dist', 'iframe-child.js'), selfContained: true },
    ]
    const missing = artifacts.filter((entry) => !existsSync(entry.path))
    if (missing.length === artifacts.length) {
      console.warn('[csp.spec] 跳过产物断言: 未找到 dist 产物 — 请先执行 `pnpm build`')
      return
    }
    expect(missing).toEqual([])

    for (const artifact of artifacts) {
      const content = readFileSync(artifact.path, 'utf8')
      for (const [pattern, label] of PATTERNS) {
        expect({ file: artifact.path, label, matched: pattern.test(content).valueOf() })
          .toEqual({ file: artifact.path, label, matched: false })
      }
      if (artifact.selfContained) {
        // 自包含产物不允许任何 bare specifier 导入 (vue/pinia 已内联)
        const bareImport = /^\s*import\s[^'"]*from\s*['"]([^.'"][^'"]*)['"]/m.exec(content)
        expect({ file: artifact.path, bareImport: bareImport?.[1] ?? null }).toEqual({
          file: artifact.path,
          bareImport: null,
        })
        expect(/^\s*import\s*['"]([^.'"])/m.test(content)).toBe(false)
      }
    }
  })
})
