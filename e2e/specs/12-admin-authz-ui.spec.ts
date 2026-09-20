/**
 * e2e/specs/12-admin-authz-ui.spec.ts — L11 管理 API 鉴权矩阵(UI 可视部分)。
 * 匿名演示链路走补偿代理页(RECONNECT_HOST; DEF-05 下 demo-host 不可用, 见 07 分册)。
 *
 * 与 T1 的 API 矩阵(assets/L1-07-鉴权矩阵.json)互补, 不重复造轮子:
 *  - 未带凭据直接访问管理页数据 → UI 侧路由守卫重定向(DEF-01 背景下登录页渲染);
 *  - 管理端点凭据分层(无凭据 401 / 错误 admin key 403);
 *  - embed 链路匿名演示头语义: WC 宿主页无任何凭据时按服务端缺省演示用户可用
 *    (demo 模式可用性的 UI 级证据)。
 */
import {
  test, expect, RECONNECT_HOST, GATEWAY, SERVER_BASE, journalApi, openSdkChat, sendChat,
  waitTerminal, shot, saveText, cleanupDemoUserByConversation,
} from '../helpers/sdk-support'

const TITLE = 'E2E-L11 匿名演示链路探测'

test.describe('L11 管理 API 鉴权矩阵(UI 可视部分)', () => {

  test('L11-01 未带凭据访问管理页: 路由守卫重定向登录页(无数据渲染)', async ({ page }, testInfo) => {
    // 全新上下文: 不预置 sessionStorage['ia:admin-key'](对比 T1 adminPage 夹具)
    await page.goto(`${GATEWAY}/apps`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const url = page.url()
    await shot(page, 'L11-01-未带凭据访问-apps-UI渲染', testInfo)
    saveText('L11-01-访问轨迹.txt', `入口: /apps\n落点: ${url}`)
    // DEF-01 背景: 守卫把无凭据访问挡在登录页(管理数据不可见)
    expect(url, '无凭据访问 /apps 被守卫重定向到登录页').toContain('/login')
  })

  test('L11-02 管理端点凭据分层: 无凭据 401 / 错误 key 401|403', async ({ page }, testInfo) => {
    const anon = await page.request.get(`${SERVER_BASE}/ia/api/v1/admin/tools`)
    const wrong = await page.request.get(`${SERVER_BASE}/ia/api/v1/admin/tools`, {
      headers: { 'X-IA-Admin-Key': 'wrong-key' },
    })
    const anonBody = await anon.text().catch(() => '')
    const wrongBody = await wrong.text().catch(() => '')
    saveText('L11-02-鉴权分层.json', JSON.stringify({
      anonymous: { status: anon.status(), body: anonBody.slice(0, 200) },
      wrongKey: { status: wrong.status(), body: wrongBody.slice(0, 200) },
    }, null, 2))
    expect([401, 403], `无凭据 → 401/403(实测 ${anon.status()})`).toContain(anon.status())
    expect([401, 403], `错误 admin key → 401/403(实测 ${wrong.status()})`).toContain(wrong.status())
  })

  test('L11-03 匿名演示头语义: 无凭据 WC 宿主对话可用(demo 模式)', async ({ page }, testInfo) => {
    // 不注入 X-IA-Demo-User: 走服务端缺省演示用户 12993(allow-anonymous-demo)
    const journal = journalApi(page)
    await openSdkChat(page, RECONNECT_HOST)
    // openSdkChat 已等待发送可用 → GET /me/models 以匿名身份可达
    await sendChat(page, TITLE)
    expect(await waitTerminal(page, 60_000), '匿名演示身份完成一次对话').toBe('已完成')
    await shot(page, 'L11-03-匿名演示头-WC对话可用', testInfo)

    const listResp = [...journal.entries].reverse().find((e) => e.url.includes('/conversations?'))
    saveText('L11-03-匿名会话列表响应.txt', listResp ? `[${listResp.status}] ${listResp.url}\n${listResp.body}` : '(未捕获)')

    // 只清理本用例创建的会话(12993 既有演示数据不触碰)
    const cleanup = cleanupDemoUserByConversation({ title: TITLE })
    saveText('L11-03-清理记录.txt', cleanup)
  })
})
