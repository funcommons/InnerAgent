/**
 * e2e/helpers/sdk-support.ts — SDK 四线(对话/断流/附件/确认)测试公共设施。
 *
 * 复用 helpers/support.ts 的 psql/shot/saveText; 新增:
 *  - uniqueDemoUser()/injectDemoUser(): 每用例独立演示用户(X-IA-Demo-User 注入),
 *    实现数据隔离与「按用户物理清理」(T1 教训: 自建数据必须物理清理, 防踩 DEF-03/04);
 *  - openSdkChat(): 打开 WC 宿主页(demo-host 5180 / 断流中转 18085)并等组件就绪;
 *  - SCOPE_RESOLVED 捕获注册(宿主元素 addEventListener, detail 断言用);
 *  - setMockScript(): ia_ai_model.config mockScript 驱动(完场复位 null);
 *  - hostState(): demo-spring-host /ia-demo/state 观测;
 *  - cleanupDemoUser(): 该演示用户全部 ia_* 行物理删除(报告清理确认节引用)。
 *
 * 注意(T1 交接④⑤): 不跨用例共享模块级可变状态(固定标识符 + 查库自建前置);
 * 管理面断言一律 X-IA-Admin-Key(不依赖 UI 登录, DEF-01 已知缺陷)。
 */
import { type Page, type TestInfo, type APIRequestContext } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ASSETS, psql, shot as baseShot } from './support'

export { psql, saveJson, saveText, slug, unique, GATEWAY } from './support'
export { expect, test } from './support'

export const DEMO_HOST = process.env.DEMO_HOST_URL || 'http://localhost:5180'
export const RECONNECT_HOST = process.env.RECONNECT_HOST_URL || 'http://localhost:18085'
export const HOST_BASE = process.env.IA_HOST_BASE || 'http://localhost:18091'
export const SERVER_BASE = process.env.IA_BASE_URL || 'http://localhost:18090'

mkdirSync(ASSETS, { recursive: true })

let demoUserSeed = 92001 + Math.floor(Math.random() * 100)
/** 每用例唯一演示用户(92001 起;标注 testId 便于审计核对) */
export function uniqueDemoUser(): number {
  demoUserSeed += 1
  return demoUserSeed
}

/**
 * 注入 X-IA-Demo-User 头(宿主页发出的全部 API 请求)。
 * 依据: DemoUserAuthenticationFilter 对无 Bearer 请求按该头注入演示身份;
 * 上传附件的 <img> 读回请求同样经此通道, 与上传用户一致(归属校验可过)。
 * 匹配: demo-host(5180)与断流中转(18085)两个宿主页源的全部请求
 * (中转页以 baseURL='' 接入, 请求路径无 /ia 前缀, 故按端口谓词匹配)。
 */
export async function injectDemoUser(page: Page, userId: number): Promise<void> {
  await page.route((url) => url.hostname === 'localhost'
    && (url.port === '5180' || url.port === '18085'), async (route) => {
    const headers = { ...route.request().headers(), 'x-ia-demo-user': String(userId) }
    await route.continue({ headers })
  })
}

export interface ApiJournal {
  entries: Array<{ url: string; status: number; body: string }>
}

/**
 * 页面内 fetch 包装捕获 SSE(Playwright response.text() 对流式响应取不到 body)。
 * 须在页面脚本运行前注册(addInitScript);readSseCaptured() 取捕获结果。
 */
export async function captureSse(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as any
    w.__sseCaptures = []
    const origFetch = w.fetch.bind(w)
    w.fetch = async (input: any, init?: any) => {
      const resp = await origFetch(input, init)
      try {
        const url = typeof input === 'string' ? input : input?.url ?? ''
        const path = new URL(url, location.href).pathname
        if (/(^|\/)runs(\/|$)/.test(path)) {
          resp.clone().text().then((t: string) => {
            w.__sseCaptures.push({ url: path, body: t })
          }).catch(() => {
            w.__sseCaptures.push({ url: path, body: null })
          })
        }
      } catch { /* 尽力而为 */ }
      return resp
    }
  })
}

/** 读取 captureSse 捕获的 SSE 流(数组项: {url, body}) */
export async function readSseCaptured(page: Page): Promise<Array<{ url: string; body: string | null }>> {
  return page.evaluate(() => (window as any).__sseCaptures ?? [])
}

/** 采集页面全部 API 往返(证据落文件;SSE 响应体读满为尽力而为)。
 *  匹配: /ia/*(18090 直连/网关反代)与补偿代理页的裸路径(/me /conversations /attachments /runs)。 */
export function journalApi(page: Page): ApiJournal {
  const journal: ApiJournal = { entries: [] }
  page.on('response', (resp) => {
    const url = resp.url()
    let path = ''
    try { path = new URL(url).pathname } catch { return }
    const matched = path.startsWith('/ia/')
      || /^\/(me|conversations|attachments|runs)(\/|$)/.test(path)
    if (!matched) return
    resp.text().then(
      (body) => journal.entries.push({ url, status: resp.status(), body: body.slice(0, 3000) }),
      () => journal.entries.push({ url, status: resp.status(), body: '(body unavailable)' }),
    ).catch(() => {})
  })
  return journal
}

export function saveJournal(journal: ApiJournal, name: string): string | null {
  if (!journal.entries.length) return null
  const text = journal.entries
    .map((e, i) => `#${i} [${e.status}] ${e.url}\n${e.body}\n`)
    .join('\n')
  const file = join(ASSETS, name)
  writeFileSync(file, text)
  return file
}

export async function shot(page: Page, name: string, testInfo?: TestInfo): Promise<string> {
  return baseShot(page, name, testInfo)
}

/** 打开 WC 宿主页并等组件就绪; requireModels=false 时只等组件渲染(隔离取证用) */
export async function openSdkChat(
  page: Page,
  base: string,
  options: { requireModels?: boolean } = {},
): Promise<void> {
  const { requireModels = true } = options
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const root = page.locator('inneragent-chat')
  await root.waitFor({ state: 'attached', timeout: 20_000 })
  // Shadow DOM 内组件窗口渲染完成
  await page.getByTestId('assistant-window').waitFor({ state: 'visible', timeout: 20_000 })
  await page.getByTestId('assistant-composer').waitFor({ state: 'visible', timeout: 20_000 })
  if (!requireModels) return
  // 模型列表加载完成(SDK 挂载后 GET /me/models → 模型下拉出现选项并自动选中默认模型;
  // 注意发送按钮在输入为空时按设计禁用, 不能作为就绪判据)
  await page.locator('[data-testid="assistant-model-select"] option').first()
    .waitFor({ state: 'attached', timeout: 30_000 })
}

/** 在 WC 宿主元素上注册 SCOPE_RESOLVED 捕获(挂载后任意时刻可注册) */
export async function captureScopeResolved(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.querySelector('inneragent-chat')
    if (!el) throw new Error('inneragent-chat not found')
    const w = window as unknown as { __scopeEvents?: unknown[] }
    w.__scopeEvents = []
    el.addEventListener('SCOPE_RESOLVED', (event) => {
      const detail = (event as CustomEvent).detail
      w.__scopeEvents!.push({
        at: new Date().toISOString(),
        conversationId: detail?.conversationId,
        runId: detail?.runId,
        replyId: detail?.replyId,
        tools: detail?.tools,
      })
    })
  })
}

export async function readScopeEvents(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as { __scopeEvents?: Array<Record<string, unknown>> }).__scopeEvents ?? [])
}

export async function sendChat(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(text)
  await page.getByTestId('assistant-send').click()
}

/** 当前 live timeline 内容段总字符数(流式增量渲染证据) */
export async function liveContentLength(page: Page): Promise<number> {
  return page.locator('[data-testid^="assistant-content-"]').evaluateAll(
    (els) => els.map((e) => e.textContent?.length ?? 0).reduce((a, b) => a + b, 0),
  )
}

/** 等待会话到达终态: 头部标题出现「· 已完成/已取消/失败」, 或错误反馈可见 */
export async function waitTerminal(page: Page, timeout = 60_000): Promise<string> {
  const header = page.locator('inneragent-chat .assistant-window__titles')
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = await terminalState(page)
    if (state) return state
    await page.waitForTimeout(500)
  }
  throw new Error(`等待终态超时(${timeout}s); 头部文本: ${await header.innerText().catch(() => '(n/a)')}`)
}

/** 读取当前终态(非终态返回空串)。注意: Playwright 选择器才穿透 Shadow DOM。 */
export async function terminalState(page: Page): Promise<string> {
  const text = await page
    .locator('inneragent-chat .assistant-window__titles')
    .textContent()
    .catch(() => '') ?? ''
  for (const mark of ['· 已完成', '· 已取消', '· 失败']) {
    if (text.includes(mark)) return mark.replace('· ', '')
  }
  return ''
}

// ---- demo-spring-host / mock 模型 ----

export async function hostState(): Promise<Record<string, any>> {
  const res = await fetch(`${HOST_BASE}/ia-demo/state`)
  if (!res.ok) throw new Error(`/ia-demo/state ${res.status}`)
  return res.json()
}

export async function hostStateJson(): Promise<string> {
  return JSON.stringify(await hostState(), null, 2)
}

/** mock 模型脚本(ia_ai_model.config.mockScript); 传 '' 复位 legacy */
export function setMockScript(script: string): void {
  if (script) {
    psql(`update ia_ai_model set config='${script}' where code='mock-text'`)
  } else {
    psql(`update ia_ai_model set config=null where code='mock-text'`)
  }
}

// ---- 数据物理清理(自建演示用户全部痕迹) ----

export function cleanupDemoUser(userId: number): string {
  const sql = [
    `delete from ia_agent_event where run_id in (select run_id from ia_agent_run where user_id=${userId})`,
    `delete from ia_agent_message where conversation_id in (select conversation_id from ia_agent_conversation where user_id=${userId})`,
    `delete from ia_audit_log where user_id=${userId}`,
    `delete from ia_agent_run where user_id=${userId}`,
    `delete from ia_agent_attachment where user_id=${userId}`,
    `delete from ia_agent_conversation where user_id=${userId}`,
    `select 'user ${userId} cleaned'`,
  ].join('; ')
  const out = execSync(
    `docker exec inneragent-postgres psql -U inneragent -d inneragent -tAc ${JSON.stringify(sql)}`,
    { encoding: 'utf8' },
  ).trim()
  return out
}

/** 生成任意内容文件(超限/不支持类型用例的输入) */
export function makeFile(dir: string, name: string, bytes: number, fill: number): string {
  const buf = Buffer.alloc(bytes, fill)
  const file = join(dir, name)
  writeFileSync(file, buf)
  return file
}

/**
 * 按会话标题物理清理单条会话(L11 匿名演示链路用: 只删本用例建的会话,
 * 不触碰缺省演示用户 12993 的既有数据)。
 */
export function cleanupDemoUserByConversation(options: { title: string; conversationId?: string }): string {
  const cond = options.conversationId
    ? `conversation_id='${options.conversationId}'`
    : `title='${options.title.replace(/'/g, "''")}'`
  const find = `select conversation_id from ia_agent_conversation where ${cond} order by id desc limit 1`
  const id = psql(find)
  if (!id) return 'no matching conversation; nothing to clean'
  return psql(
    [
      `delete from ia_agent_event where run_id in (select run_id from ia_agent_run where conversation_id='${id}')`,
      `delete from ia_agent_message where conversation_id='${id}'`,
      `delete from ia_audit_log where conversation_id='${id}'`,
      `delete from ia_agent_run where conversation_id='${id}'`,
      `delete from ia_agent_conversation where conversation_id='${id}'`,
      `select 'conversation ${id} cleaned'`,
    ].join('; '),
  )
}

/** 管理 API 直连请求上下文(X-IA-Admin-Key)——管理面断言用, 不走 UI 登录 */
export async function adminApi(playwright: import('@playwright/test').Playwright): Promise<APIRequestContext> {
  const { ADMIN_KEY, SERVER } = await import('./support')
  return playwright.request.newContext({
    baseURL: SERVER,
    extraHTTPHeaders: { 'X-IA-Admin-Key': ADMIN_KEY },
  })
}

export type { TestInfo }
