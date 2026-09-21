/**
 * e2e/helpers/support.ts — 测试公共设施(测试基建,不碰产品代码)。
 *
 * 提供:
 *  - test/adminPage:预置管理站会话的页面夹具(DEF-01 修复后登录页可账号密码
 *    直登;本夹具走 sessionStorage['ia:admin-key'] + X-IA-Admin-Key 引导通道,
 *    为 AdminTokenFilter 合法自动化凭据,各业务线沿用以免逐用例登录);
 *  - api:直连 18090 的 APIRequestContext(X-IA-Admin-Key 注入);
 *  - shot():关键步截图 → test-report/2026-09-21-02/assets(R2 轮);
 *  - psql():docker exec psql 佐证/数据准备/清理;
 *  - saveJson()/saveText():API 证据落文件(报告 md 内嵌引用);
 *  - 控制台/页面异常捕获:失败时落文件并 attachment。
 */
import { test as base, expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const REPO = '/Users/justin/codes/funcommons/InnerAgent'
// R3 验证轮:证据落 2026-09-21-03(R1/R2 证据保留原目录,收官文档可回引)
export const REPORT_DIR = join(REPO, 'test-report', '2026-09-21-03')
export const ASSETS = join(REPORT_DIR, 'assets')

export const GATEWAY = process.env.GATEWAY_URL || 'http://localhost:18081'
export const SERVER = process.env.IA_BASE_URL || 'http://localhost:18090'
export const ADMIN_KEY = 'test-key'
export const ADMIN_USER = 'admin'
export const ADMIN_PASSWORD = 'Admin#12345'
/** web 管理站会话存储键(web/src/stores/auth.ts STORAGE_KEY) */
export const WEB_SESSION_KEY = 'ia:admin-key'

mkdirSync(ASSETS, { recursive: true })

export function psql(sql: string): string {
  // 压平空白:模板字符串里的换行经 shell 传递会被 psql 当字面 \n
  const flat = sql.replace(/\s+/g, ' ').trim()
  return execSync(
    `docker exec inneragent-postgres psql -U inneragent -d inneragent -tAc ${JSON.stringify(flat)}`,
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  ).trim()
}

/** 生成 RSA 2048 公钥 PEM(应用注册/轮换用;openssl 由 macOS 自带) */
export function genRsaPublicPem(): string {
  const pem = execSync(
    `openssl genrsa 2048 2>/dev/null | openssl rsa -pubout 2>/dev/null`,
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  )
  if (!pem.includes('-----BEGIN PUBLIC KEY-----')) throw new Error('openssl 生成公钥失败')
  return pem.trim()
}

export function saveJson(name: string, data: unknown): string {
  const file = join(ASSETS, name)
  writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2))
  return file
}

export function saveText(name: string, text: string): string {
  return saveJson(name, text)
}

export function slug(text: string): string {
  return text.replace(/[^a-zA-Z0-9一-龥]+/g, '-').slice(0, 60)
}

export async function shot(page: Page, name: string, testInfo?: TestInfo): Promise<string> {
  const file = join(ASSETS, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  if (testInfo) testInfo.attach(name, { path: file })
  return file
}

interface Fixtures {
  /** 已预置管理站会话的页面(进入 /apps 等受守卫页) */
  adminPage: Page
}

export const test = base.extend<Fixtures>({
  // 覆写内置 request 夹具:直连主服务 18090 + 注入 X-IA-Admin-Key(管理面自动化凭据)。
  // 所有 spec 统一经此发起 API 调用;用例结束把全部 API 往返落文件作证据。
  request: async ({ playwright }, use, testInfo) => {
    const ctx = await playwright.request.newContext({
      baseURL: SERVER,
      extraHTTPHeaders: { 'X-IA-Admin-Key': ADMIN_KEY },
    })
    const responses: Array<{ url: string; status: number; body: string }> = []
    ctx.on('response', async (resp) => {
      try {
        const req = resp.request()
        if (req.method() === 'GET' || req.method() === 'POST' || req.method() === 'PUT' || req.method() === 'DELETE') {
          responses.push({ url: resp.url(), status: resp.status(), body: (await resp.text()).slice(0, 4000) })
        }
      } catch { /* 证据采集尽力而为 */ }
    })
    await use(ctx)
    await ctx.dispose()
    const journal = responses.map((r, i) => `#${i} [${r.status}] ${r.url}\n${r.body}\n`).join('\n')
    if (journal) saveText(`api-journal-${slug(testInfo.title)}.txt`, journal)
  },

  adminPage: async ({ page }, use, testInfo) => {
    const consoleLines: string[] = []
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`))
    page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`))
    page.on('requestfailed', (req) =>
      consoleLines.push(`[requestfailed] ${req.method()} ${req.url()} ${req.failure()?.errorText ?? ''}`))
    // 预置管理站会话:restore() 读取该键即认为已登录;请求层注入 X-IA-Admin-Key。
    // 服务端以 test-key 校验通过 → 全部页面按真实集成运作。
    await page.addInitScript(([key, value]) => {
      window.sessionStorage.setItem(key as string, value as string)
    }, [WEB_SESSION_KEY, ADMIN_KEY])
    await use(page)
    if (testInfo.status !== testInfo.expectedStatus) {
      const file = join(ASSETS, `FAIL-${slug(testInfo.title)}-console.log`)
      writeFileSync(file, consoleLines.join('\n') || '(no console output)')
      testInfo.attach('console-log', { path: file })
    }
  },
})

export { expect }

/** ElMessage 轻提示(按文本片段匹配最新一条) */
export function messageToast(page: Page, text: string) {
  return page.locator('.el-message').filter({ hasText: text }).first()
}

/**
 * ElMessageBox 确认框的确认按钮。
 * 注意:自定义 confirmButtonText 的框用中文(确认应用/停用/确认轮换…),
 * 未自定义的框是 Element Plus 默认英文 OK/Cancel(应用未配 zh-cn locale,FIND-P3)。
 */
export async function confirmBox(page: Page, confirmText: string) {
  const box = page.locator('.el-message-box:visible')
  const custom = box.getByRole('button', { name: confirmText })
  if (await custom.count()) {
    await custom.click()
  } else {
    await box.getByRole('button', { name: 'OK' }).click()
  }
}

/** 表格行(按单元格文本;仅可见行,规避 el-table 固定列克隆的隐藏副本) */
export function tableRow(page: Page, text: string) {
  return page.locator('.el-table__row').filter({ hasText: text }).locator('visible=true').first()
}

export const unique = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
