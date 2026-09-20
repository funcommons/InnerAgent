/**
 * 业务线 1:管理站-认证(P2-admin 18a;AdminAuthService/AdminTokenFilter)。
 *
 * 覆盖:登录成功/失败、连续 5 次失败锁定 423、锁定期正确密码拒绝、
 * 登出后 token 失效、登录审计落库(psql 佐证)、X-IA-Admin-Key 双轨矩阵、
 * UI 登录页契约漂移缺陷证据(DEF-01)与预置会话可用性(后续各线的进入方式)。
 *
 * 说明:登录/锁定语义纯服务端行为,以 API + psql 为准;UI 只能证伪(DEF-01)。
 * 全部用例可复跑:beforeEach 复位 admin 账号锁定态(psql 写测试自身数据,非产品代码)。
 */
import {
  test, expect, ADMIN_KEY, ADMIN_PASSWORD, ADMIN_USER, SERVER, psql, saveJson, saveText, shot,
  messageToast, GATEWAY,
} from '../helpers/support'

const LOGIN = '/ia/api/v1/admin/auth/login'
const resetAdminLock = () =>
  psql(`UPDATE ia_admin_account SET failed_attempts = 0, locked_until = NULL WHERE username = '${ADMIN_USER}'`)

test.afterAll(() => { resetAdminLock() })

test('登录成功签发管理会话 token,审计落库 success=true', async ({ request }) => {
  resetAdminLock() // 复跑安全:清掉历史锁定态
  const resp = await request.post(LOGIN, {
    data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
  })
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.code).toBe(0)
  expect(body.data.username).toBe(ADMIN_USER)
  expect(body.data.tokenType).toBe('Bearer')
  expect(body.data.expiresInSeconds).toBeGreaterThan(0)
  // JWT 三段
  expect(body.data.token.split('.').length).toBe(3)
  saveJson('L1-01-登录成功-响应.json', body)

  const log = psql(`SELECT username, success, fail_reason IS NULL FROM ia_admin_login_log
                    WHERE username='${ADMIN_USER}' ORDER BY id DESC LIMIT 1`)
  expect(log).toBe('admin|t|t') // psql -tA:布尔输出 t/f
  saveText('L1-01-登录成功-审计行.txt', `ia_admin_login_log 最新行(username,success,fail_reason IS NULL):\n${log}`)
})

test('密码错误 401(文案防枚举),失败计数递增', async ({ request }) => {
  const resp = await request.post(LOGIN, {
    data: { username: ADMIN_USER, password: 'wrong-pass-1' },
  })
  expect(resp.status()).toBe(401)
  const body = await resp.json()
  expect(body.msg).toBe('用户名或密码错误')
  saveJson('L1-02-密码错误-响应.json', { http: resp.status(), ...body })

  const attempts = psql(`SELECT failed_attempts FROM ia_admin_account WHERE username='${ADMIN_USER}'`)
  expect(Number(attempts)).toBe(1)
  const log = psql(`SELECT fail_reason FROM ia_admin_login_log WHERE username='${ADMIN_USER}'
                    AND success=false ORDER BY id DESC LIMIT 1`)
  expect(log).toContain('第 1 次失败')
})

test('连续 5 次失败触发锁定 423,计数清零、locked_until 落库', async ({ request }) => {
  resetAdminLock() // 干净计数窗口:本用例内连续 5 次失败
  for (let i = 1; i <= 5; i++) {
    const resp = await request.post(LOGIN, { data: { username: ADMIN_USER, password: `wrong-pass-${i}` } })
    if (i < 5) {
      expect(resp.status()).toBe(401)
    } else {
      expect(resp.status()).toBe(423)
      const body = await resp.json()
      expect(body.msg).toContain('连续失败已达 5 次')
      expect(body.msg).toContain('15 分钟')
      saveJson('L1-03-触发锁定-响应.json', { http: resp.status(), ...body })
    }
  }
  // 锁定即清零失败计数(锁定到期后从零起算)
  const row = psql(`SELECT failed_attempts, locked_until IS NOT NULL FROM ia_admin_account WHERE username='${ADMIN_USER}'`)
  expect(row).toBe('0|t')
  const log = psql(`SELECT fail_reason FROM ia_admin_login_log WHERE username='${ADMIN_USER}'
                    AND success=false ORDER BY id DESC LIMIT 1`)
  expect(log).toContain('触发锁定 15 分钟')
  saveText('L1-03-锁定后账号行.txt', `failed_attempts|locked_until 非空:\n${row}\n审计 fail_reason: ${log}`)
})

test('锁定期内正确密码同样 423,提示剩余秒数', async ({ request }) => {
  // 紧接上一用例的锁定态(beforeEach 不复位);确保处于锁定中
  const locked = psql(`SELECT locked_until IS NOT NULL AND locked_until > now() FROM ia_admin_account WHERE username='${ADMIN_USER}'`)
  test.skip(locked !== 't', '前序锁定用例未生效,本用例跳过')
  const resp = await request.post(LOGIN, { data: { username: ADMIN_USER, password: ADMIN_PASSWORD } })
  expect(resp.status()).toBe(423)
  const body = await resp.json()
  expect(body.msg).toContain('账号已锁定')
  expect(body.msg).toMatch(/请 \d+ 秒后重试/)
  saveJson('L1-04-锁定期正确密码-响应.json', { http: resp.status(), ...body })
})

test('登录审计全量落库:成功与各失败形态逐条可查(psql 佐证)', async ({ request }) => {
  // 汇总窗口:本文件全部用例产生的尝试(成功 1 + 失败 6)
  const rows = psql(`SELECT success, count(*) FROM ia_admin_login_log WHERE username='${ADMIN_USER}'
                     AND create_time > now() - interval '10 minutes' GROUP BY success ORDER BY success`)
  saveText('L1-05-登录审计汇总.txt', `近 10 分钟 admin 登录审计按 success 分组(success|count):\n${rows}`)
  expect(rows).toContain('t|')
  expect(rows).toContain('f|')
  const failReasons = psql(`SELECT DISTINCT fail_reason FROM ia_admin_login_log WHERE username='${ADMIN_USER}'
                            AND create_time > now() - interval '10 minutes' AND success=false`)
  saveText('L1-05-失败原因分布.txt', `失败原因 DISTINCT:\n${failReasons}`)
  expect(failReasons).toContain('密码错误')
  expect(failReasons).toContain('锁定中')
  expect(failReasons).toContain('触发锁定')
})

test('登出后 token 失效(401),X-IA-Admin-Key 自动化通道不受影响', async ({ request }) => {
  resetAdminLock() // 前序用例可能处于锁定期,登录需可用
  const login = await request.post(LOGIN, { data: { username: ADMIN_USER, password: ADMIN_PASSWORD } })
  const token = (await login.json()).data.token as string

  const before = await request.get('/ia/api/v1/admin/tools', { headers: { Authorization: `Bearer ${token}` } })
  expect(before.status()).toBe(200)

  const out = await request.post('/ia/api/v1/admin/auth/logout', { headers: { Authorization: `Bearer ${token}` } })
  expect(out.status()).toBe(200)
  saveJson('L1-06-登出-响应.json', { http: out.status(), body: await out.json() })

  const after = await request.get('/ia/api/v1/admin/tools', { headers: { Authorization: `Bearer ${token}` } })
  expect(after.status()).toBe(401)
  const afterBody = await after.json()
  expect(afterBody.msg).toContain('管理会话 token 无效')
  saveJson('L1-06-登出后-token-响应.json', { http: after.status(), ...afterBody })

  // 双轨另一边:管理 key 仍可用(自动化通道不受会话吊销影响)
  const viaKey = await request.get('/ia/api/v1/admin/tools', { headers: { 'X-IA-Admin-Key': ADMIN_KEY } })
  expect(viaKey.status()).toBe(200)
})

test('管理面鉴权矩阵:无凭据/错误 key 403,正确 key 200', async ({ playwright }) => {
  // 独立 context:不注入默认头,分别验证三种凭据形态
  const bare = await playwright.request.newContext({ baseURL: SERVER })
  const noHeader = await bare.get('/ia/api/v1/admin/tools')
  expect(noHeader.status()).toBe(403)
  const wrongKey = await bare.get('/ia/api/v1/admin/tools', { headers: { 'X-IA-Admin-Key': 'wrong-key' } })
  expect(wrongKey.status()).toBe(403)
  const ok = await bare.get('/ia/api/v1/admin/tools', { headers: { 'X-IA-Admin-Key': ADMIN_KEY } })
  expect(ok.status()).toBe(200)
  await bare.dispose()
  saveJson('L1-07-鉴权矩阵.json', {
    noHeader: noHeader.status(), wrongKey: wrongKey.status(), ok: ok.status(),
  })
})

test('DEF-01:UI 登录页仍发 adminKey 占位契约,真服务模式登录必 400(证据)', async ({ adminPage }) => {
  // 无预置会话的干净页面,走真实 UI 登录路径
  await adminPage.addInitScript(() => window.sessionStorage.clear())
  await adminPage.goto(`${GATEWAY}/login`)
  await expect(adminPage.getByText('InnerAgent 管理站')).toBeVisible()
  await shot(adminPage, 'L1-08-登录页(仅管理Key输入框,无账号密码域)')
  // 表单结构佐证:只有「管理 Key」一个输入域 —— 无法输入 username/password
  await expect(adminPage.getByPlaceholder(/X-IA-Admin-Key/)).toBeVisible()

  const loginResp = adminPage.waitForResponse((r) => r.url().includes('/admin/auth/login'))
  await adminPage.getByPlaceholder(/X-IA-Admin-Key/).fill(ADMIN_KEY)
  await adminPage.getByRole('button', { name: '登录' }).click()
  const resp = await loginResp
  // 观察值(缺陷):请求体 {adminKey},服务端要求 {username,password} → 400
  expect(resp.status()).toBe(400)
  const body = await resp.json()
  expect(body.code).toBe(400)
  saveJson('L1-08-DEF01-UI登录-网络响应.json', { status: resp.status(), body })
  await expect(messageToast(adminPage, '不能为空').or(messageToast(adminPage, '参数错误'))).toBeVisible()
  await shot(adminPage, 'L1-09-DEF01-UI登录400错误态')
  await expect(adminPage).toHaveURL(/\/login/)
})

test('预置会话经 X-IA-Admin-Key 通道进入管理站(后续业务线的进入方式)', async ({ adminPage }) => {
  await adminPage.goto(`${GATEWAY}/apps`)
  const appsResp = await adminPage.waitForResponse((r) => r.url().includes('/admin/apps') && r.request().method() === 'GET')
  expect(appsResp.status()).toBe(200)
  await expect(adminPage.locator('.el-table__row').first()).toBeVisible()
  await shot(adminPage, 'L1-10-预置会话进入应用管理(真实服务数据)')
})
