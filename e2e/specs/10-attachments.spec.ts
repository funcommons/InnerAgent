/**
 * e2e/specs/10-attachments.spec.ts — L9 附件上传线(demo-host + mock-text 多模态)。
 *
 * 覆盖: Composer 附件入口→上传→附件 chip(缩略图/文件名)→消息发送→消息区附件渲染
 * (预期 vs 实际记录)→ resourceUrl(/attachments/{id} API 根相对约定)读回;
 * 超限文件(>10MB base64 上限: mock-text 同时具备 url 传输 → 观察回退行为;
 * >20MB 服务端 multipart 上限 → UI 错误反馈);不支持媒体类型 → UI 错误反馈。
 *
 * 前置: e2e/env.sh up + demo-host(5180)。V7 迁移已给 mock-text 配 image/file
 * 双输入 + url/base64 双传输(support_vision=true)。
 *
 * [R2] DEF-05 修复后本线从补偿代理页(RECONNECT_HOST)切回 demo-host 默认接入
 * (baseURL 默认值)。demo-host 未声明 agentType → SDK 默认 ai_media,其内置
 * 工具面不含 get_current_time → legacy mock 走 FALLBACK_DELTAS(无收尾脚注),
 * 故 L9-01 以 mockScript 驱动一个只读 MCP 目录工具(R2 校准,断言不变)。
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test, expect, DEMO_HOST, SERVER_BASE, injectDemoUser, journalApi, openSdkChat,
  sendChat, waitTerminal, shot, saveJournal, saveText, saveJson, psql,
  cleanupDemoUser, uniqueDemoUser, setMockScript,
} from '../helpers/sdk-support'

const FOOTER = '本回复由 mock 模型脚本生成'
/** 1x1 红色 PNG(合法图片字节, 保证缩略图 <img> 真实加载) */
const PNG_1PX_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test.describe('L9 附件上传线', () => {

  test('L9-01 附件上传→chip 渲染→消息携带→resourceUrl 读回', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    const attachmentIds: string[] = []

    // [R2 校准] demo-host 默认 agentType=ai_media(无 get_current_time),legacy mock
    // 无工具结果 → 无收尾脚注。驱动一个只读 MCP 目录工具保证「工具执行→全文收尾」
    // 与 R1 断言语义一致(FOOTER 断言不变)。
    setMockScript('{"mockScript":[{"tool":"mcp__demo-spring-host__get_product_brief","args":{"productId":"88"}}]}')
    try {
      await runAttachmentFlow(page, testInfo, user, journal, attachmentIds)
    } finally {
      setMockScript('')
      await page.close().catch(() => {})
      cleanupDemoUser(user)
    }
  })

  async function runAttachmentFlow(
    page: import('@playwright/test').Page,
    testInfo: import('@playwright/test').TestInfo,
    user: number,
    journal: ReturnType<typeof journalApi>,
    attachmentIds: string[],
  ): Promise<void> {
    await openSdkChat(page, DEMO_HOST)

    // 1) Composer 附件入口 → 选文件 → 上传
    const pngPath = join(tmpdir(), `e2e-l9-${user}.png`)
    writeFileSync(pngPath, PNG_1PX_RED)
    await page.getByTestId('assistant-attachment-input').setInputFiles(pngPath)

    // 附件 chip 渲染: 缩略图 <img> 真实加载 + 文件名
    await page.getByTestId('assistant-attachments').waitFor({ state: 'visible', timeout: 30_000 })
    const chip = page.getByTestId('assistant-attachments').locator('[data-testid^="assistant-attachment-"]').first()
    await chip.waitFor({ state: 'visible', timeout: 30_000 })
    await expect(chip).toContainText(/\.png/i)
    const thumb = chip.locator('img')
    await expect(thumb).toHaveCount(1)
    await expect.poll(async () => thumb.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
      .toBeGreaterThan(0)
    await shot(page, 'L9-02-附件chip(缩略图+文件名)', testInfo)

    // 2) resourceUrl: /attachments/{id} API 根相对约定 + 读回可达
    // (上传响应 data 即 resourceUrl="/attachments/{id}"; id 经 psql 登记行核对)
    const attRow = psql(`select id, file_name, mime_type, input_type, transport, size_bytes from ia_agent_attachment where user_id=${user} order by id desc limit 1`)
    saveText('L9-03-psql-附件登记行.txt', attRow)
    expect(attRow, '附件登记行落库').toContain('.png')
    attachmentIds.push(attRow.split('|')[0])

    // 3) 携带附件发送消息
    const text = 'E2E-L9 看看这张图'
    await sendChat(page, text)
    expect(await waitTerminal(page, 60_000), '携带附件的运行到达已完成').toBe('已完成')
    await expect(page.getByTestId('assistant-user-bubble')).toContainText(text)
    await expect(page.getByTestId('assistant-message-list')).toContainText(FOOTER)
    // 消息区附件渲染: 记录实际(预期: 消息携带附件可见;实测看 UI 是否渲染)
    const messageListText = await page.getByTestId('assistant-message-list').innerText()
    const attachmentRenderedInMessages = /\.png/i.test(messageListText)
    const messageImages = await page.getByTestId('assistant-message-list').locator('img').count()
    await shot(page, 'L9-04-消息完成后-消息区附件渲染观察', testInfo)
    saveJson('L9-04-消息区附件渲染观察.json', {
      attachmentRenderedInMessages,
      messageImages,
      note: '用户气泡模板仅渲染 content 文本(assistant-messages__user);附件渲染实测见截图',
    })

    // 4) resourceUrl 读回: GET {API 根}/attachments/{id}(归属用户一致, 200 + image/png)
    const readback = await page.request.get(`${SERVER_BASE}/ia/api/v1/attachments/${attachmentIds[0]}`, {
      headers: { 'X-IA-Demo-User': String(user) },
    })
    saveText('L9-05-resourceUrl读回-headers.txt',
      `GET /ia/api/v1/attachments/${attachmentIds[0]}\nstatus=${readback.status()}\ncontent-type=${readback.headers()['content-type'] ?? ''}\nbytes=${(await readback.body()).length}`)
    expect(readback.status(), 'resourceUrl 读回 200').toBe(200)
    expect(readback.headers()['content-type'], 'Content-Type 按登记 MIME 回显').toContain('image/png')

    // 越权读回(另一演示用户)→ 404 不泄露存在性
    const forbidden = await page.request.get(`${SERVER_BASE}/ia/api/v1/attachments/${attachmentIds[0]}`, {
      headers: { 'X-IA-Demo-User': String(user + 1) },
    })
    saveText('L9-06-越权读回-响应.txt', `status=${forbidden.status()}`)
    expect(forbidden.status(), '他人读回 → 404(不泄露存在性)').toBe(404)

    saveJournal(journal, `L9-01-api-journal-user${user}.txt`)
  }

  test('L9-07 超限文件: >10MB 走 url 回退(设计内), >20MB 服务端拒收→UI 反馈', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)

    await openSdkChat(page, DEMO_HOST)

    // 1) 15MB(>10MB base64 上限, 但 mock-text 具备 url 传输 → SDK 回退 url, 服务端 ≤20MB 收下)
    const big15 = join(tmpdir(), `e2e-l9-big15-${user}.png`)
    writeFileSync(big15, Buffer.alloc(15 * 1024 * 1024, 7))
    await page.getByTestId('assistant-attachment-input').setInputFiles(big15)
    await page.getByTestId('assistant-attachments').waitFor({ state: 'visible', timeout: 30_000 })
    const chip = page.getByTestId('assistant-attachments').locator('[data-testid^="assistant-attachment-"]').first()
    let urlFallbackOk = true
    let fallbackNote = ''
    try {
      await chip.waitFor({ state: 'visible', timeout: 30_000 })
    } catch {
      urlFallbackOk = false
    }
    const alert15 = await page.getByTestId('assistant-composer-alert').isVisible().catch(() => false)
    const alert15Text = alert15 ? await page.getByTestId('assistant-composer-alert').innerText() : ''
    await shot(page, 'L9-08-15MB文件-传输回退观察', testInfo)
    saveJson('L9-08-15MB传输回退.json', {
      chipVisible: urlFallbackOk,
      composerAlert: alert15Text,
      note: 'SDK assistantMultimodal: >10MB 且模型具备 url 传输 → transport=url 回退(≤20MB 可传);无 UI 错误属设计内',
    })
    // 移除该附件(避免影响后续步骤)
    if (urlFallbackOk) {
      const removeBtn = page.locator('[data-testid^="assistant-attachment-remove-"]').first()
      if (await removeBtn.count()) await removeBtn.click()
    }

    // 2) 25MB(>服务端 multipart 20MB 上限)→ 服务端拒收 → UI 错误反馈
    const big25 = join(tmpdir(), `e2e-l9-big25-${user}.png`)
    writeFileSync(big25, Buffer.alloc(25 * 1024 * 1024, 7))
    await page.getByTestId('assistant-attachment-input').setInputFiles(big25)
    const alert = page.getByTestId('assistant-composer-alert')
    await alert.waitFor({ state: 'visible', timeout: 60_000 })
    const alertText = await alert.innerText()
    await shot(page, 'L9-09-25MB超限-UI错误反馈', testInfo)
    saveText('L9-09-25MB错误反馈文案.txt', alertText)
    expect(alertText.length, '有明确错误反馈文案').toBeGreaterThan(0)
    // 25MB 附件未被加入
    await expect(page.getByTestId('assistant-attachments')).toHaveCount(0)

    saveJournal(journal, `L9-07-api-journal-user${user}.txt`)
    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })

  test('L9-10 不支持的媒体类型 → UI 错误反馈', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)

    await openSdkChat(page, DEMO_HOST)

    const exePath = join(tmpdir(), `e2e-l9-evil-${user}.exe`)
    writeFileSync(exePath, Buffer.alloc(1024, 1))
    await page.getByTestId('assistant-attachment-input').setInputFiles(exePath)

    const alert = page.getByTestId('assistant-composer-alert')
    await alert.waitFor({ state: 'visible', timeout: 15_000 })
    const alertText = await alert.innerText()
    await shot(page, 'L9-10-不支持类型-UI错误反馈', testInfo)
    saveText('L9-10-不支持类型反馈文案.txt', alertText)
    expect(alertText, '反馈含「不是支持的…」语义').toContain('不是支持的')
    // .exe 附件未被加入
    await expect(page.getByTestId('assistant-attachments')).toHaveCount(0)

    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })
})
