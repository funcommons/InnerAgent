/**
 * 业务线 2:管理站-应用管理(AdminAppController /ia/api/v1/admin/apps)。
 *
 * 覆盖:列表加载、注册合法应用(公钥指纹/时间回显)、非法 PEM 400、
 * 重复 appKey 409、公钥轮换(指纹变化 + signKeyRotatedAt 回显)、注销清理。
 * 发现项(报告中单列):服务端 AppView 已回 signKeyFingerprint/signKeyRotatedAt,
 * 但 web 列表/详情无展示位;轮换对话框文案仍称「宽限期未实现」与服务端 V9 实现漂移。
 */
import {
  test, expect, psql, genRsaPublicPem, saveJson, saveText, shot, messageToast, tableRow, unique,
  confirmBox,
} from '../helpers/support'

// 固定标识符(worker 失败续跑会以新模块实例重算随机常量)
const testId = 'e2e-app-rc1'
// 状态自洽:worker 可能在用例失败后重启并重求值本模块,跨用例不信任内存变量,
// 统一以数据库为事实源(appKey 全程用本运行 module 值;取 id 现查)。
const appKeyOf = () =>
  psql(`SELECT app_key FROM ia_app WHERE name='E2E 测试应用' AND app_key LIKE 'e2e-app-%' ORDER BY id DESC LIMIT 1`)
const appIdOf = (key: string) =>
  Number(psql(`SELECT id FROM ia_app WHERE app_key='${key}' ORDER BY id DESC LIMIT 1`))
let firstFingerprint = ''

test.afterAll(async () => {
  // 物理清理自建应用行(为可复跑:逻辑删行仍占 app_key 唯一键)
  psql(`DELETE FROM ia_app WHERE app_key LIKE 'e2e-app-%'`)
})

test('应用列表加载(真实服务数据)', async ({ adminPage }) => {
  await adminPage.goto('/apps')
  const resp = await adminPage.waitForResponse((r) => r.url().includes('/admin/apps'))
  expect(resp.status()).toBe(200)
  await expect(adminPage.locator('.el-table__row').first()).toBeVisible()
  await shot(adminPage, 'L2-01-应用列表')
})

test('注册合法应用:成功回显公钥指纹;webhookSecret 只回掩码', async ({ adminPage }) => {
  // 复跑防重:上次运行的同 appKey 行(含逻辑删)会占唯一键,先物理清理本测试自建数据
  psql(`DELETE FROM ia_app WHERE app_key IN ('${testId}', '${testId}-badpem')`)
  await adminPage.goto('/apps')
  await adminPage.getByRole('button', { name: '注册应用' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.getByPlaceholder('唯一键,重复返回 409;创建后不可改').fill(testId)
  await dlg.locator('.el-form-item').filter({ hasText: '名称' }).locator('input').fill('E2E 测试应用')
  await dlg.locator('textarea').fill(genRsaPublicPem())
  await dlg.locator('.el-form-item').filter({ hasText: 'Webhook 地址' }).locator('input').fill('https://e2e.example.com/hook')

  const regResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/apps') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '保存' }).click()
  const resp = await regResp
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.code).toBe(0)
  // 公钥指纹与时间回显(服务端 AppView):
  expect(body.data.signKeyFingerprint).toMatch(/^[0-9a-f]{16}$/)
  expect(body.data.signKeyRotatedAt).toBeNull() // 首次登记不算轮换
  expect(body.data.webhookSecretMasked).toBe('') // 未设置密钥 → 空串
  expect(body.data.webhookSecret).toBeUndefined() // 明文永不回显
  expect(body.data.conversationRetentionDays).toBe(180)
  firstFingerprint = body.data.signKeyFingerprint
  saveJson('L2-02-注册应用-响应.json', body)
  await expect(messageToast(adminPage, '应用已注册')).toBeVisible()
  await shot(adminPage, 'L2-02-注册应用成功')

  await expect(tableRow(adminPage, testId)).toBeVisible()
  await shot(adminPage, 'L2-03-列表出现新应用(保留期180)')
})

test('注册非法 PEM → 400,UI 透出服务端原文', async ({ adminPage }) => {
  await adminPage.goto('/apps')
  await adminPage.getByRole('button', { name: '注册应用' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.getByPlaceholder('唯一键,重复返回 409;创建后不可改').fill(`${testId}-badpem`)
  await dlg.locator('.el-form-item').filter({ hasText: '名称' }).locator('input').fill('坏 PEM 应用')
  await dlg.locator('textarea').fill('-----BEGIN PUBLIC KEY-----\nnot-a-valid-key\n-----END PUBLIC KEY-----')
  const regResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/apps') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '保存' }).click()
  const resp = await regResp
  expect(resp.status()).toBe(400)
  const body = await resp.json()
  expect(body.msg).toContain('不是合法的 RSA 公钥 PEM')
  saveJson('L2-04-非法PEM-响应.json', { status: resp.status(), ...body })
  await expect(messageToast(adminPage, 'PEM')).toBeVisible()
  await shot(adminPage, 'L2-04-非法PEM-400错误态')
})

test('重复 appKey → 409 冲突', async ({ request, adminPage }) => {
  // 以库中已注册的应用 appKey 为准(不跨用例共享内存状态)
  let existingKey = appKeyOf()
  if (!existingKey) {
    const resp = await request.post('/ia/api/v1/admin/apps', {
      data: { appKey: testId, name: 'E2E 测试应用', signPublicKey: genRsaPublicPem() },
    })
    expect(resp.status()).toBe(200)
    existingKey = appKeyOf()
  }
  await adminPage.goto('/apps')
  await adminPage.getByRole('button', { name: '注册应用' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.getByPlaceholder('唯一键,重复返回 409;创建后不可改').fill(existingKey)
  await dlg.locator('.el-form-item').filter({ hasText: '名称' }).locator('input').fill('重复 appKey 应用')
  await dlg.locator('textarea').fill(genRsaPublicPem())
  const regResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/apps') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '保存' }).click()
  const resp = await regResp
  expect(resp.status()).toBe(409)
  const body = await resp.json()
  expect(body.msg).toContain('已存在')
  saveJson('L2-05-重复appKey-响应.json', { status: resp.status(), ...body })
  await expect(messageToast(adminPage, '已存在')).toBeVisible()
  await shot(adminPage, 'L2-05-重复appKey-409错误态')
})

test('公钥轮换:指纹变化 + signKeyRotatedAt 回显(时间戳非空)', async ({ request, adminPage }) => {
  const key = appKeyOf()
  expect(key, '前置用例应已注册应用').toBeTruthy()
  const before = await request.get(`/ia/api/v1/admin/apps/${appIdOf(key)}`)
  const fingerprintBefore = (await before.json()).data.signKeyFingerprint as string

  await adminPage.goto('/apps')
  const row = tableRow(adminPage, key)
  await row.getByRole('button', { name: '轮换公钥' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  // FIND-P3(文案漂移):服务端 V9 已实现双公钥 72h 宽限期,该告警文案已过时 → 截图存证
  await expect(dlg.getByText(/宽限期语义未实现/)).toBeVisible()
  await shot(adminPage, 'L2-06-轮换对话框(过期文案:称宽限期未实现)')
  await dlg.locator('textarea').fill(genRsaPublicPem())
  const putResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/apps\/\d+$/) !== null && r.request().method() === 'PUT')
  await dlg.getByRole('button', { name: '确认轮换' }).click()
  await confirmBox(adminPage, '确认轮换')
  const resp = await putResp
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.data.signKeyFingerprint).toMatch(/^[0-9a-f]{16}$/)
  expect(body.data.signKeyFingerprint).not.toBe(fingerprintBefore)
  expect(body.data.signKeyRotatedAt).not.toBeNull()
  saveJson('L2-07-轮换公钥-响应.json', body)
  await expect(messageToast(adminPage, '轮换')).toBeVisible()
  await shot(adminPage, 'L2-07-轮换成功')

  // 库层佐证:previous_sign_public_key 已存旧公钥(72h 宽限的数据基础)
  const prev = psql(`SELECT previous_sign_public_key IS NOT NULL, sign_key_rotated_at IS NOT NULL
                     FROM ia_app WHERE app_key='${key}'`)
  expect(prev).toBe('t|t')
  saveText('L2-07-轮换-库层宽限字段.txt', `previous_sign_public_key 非空 | sign_key_rotated_at 非空:\n${prev}`)
})
