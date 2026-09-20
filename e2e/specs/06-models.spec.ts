/**
 * 业务线 6:管理站-模型配置(AdminModelConfigController /ia/api/v1/admin/model-configs)。
 *
 * 覆盖:列表(含 V4 demo seed)、创建(密钥掩码回显)、编辑留空不改密钥/换钥重掩码、
 * 连通性测试 ok:false 兜底形态(HTTP 200 + ok 布尔,探针语义)、删除后 404。
 * 说明:web 前端 save payload 不携带 textProtocol 字段(服务端可空),联调核对点记录在案。
 */
import {
  test, expect, saveJson, saveText, shot, messageToast, tableRow, confirmBox, psql,
} from '../helpers/support'

// 固定标识符(Playwright 用例失败后会以新模块实例继续,随机常量不可跨用例依赖)
const modelName = 'e2e-model-rc1'
// 状态自洽:id 现查库
const modelIdOf = () =>
  Number(psql(`SELECT id FROM ia_model_api_config WHERE name='${modelName}' ORDER BY id DESC LIMIT 1`)) || 0
const API_KEY_1 = 'sk-e2e-1234567890abcd'
const API_KEY_2 = 'sk-e2e-zz9999zzzznnnn'
async function removeIfExists(request: import('@playwright/test').APIRequestContext) {
  const id = modelIdOf()
  if (id) await request.delete(`/ia/api/v1/admin/model-configs/${id}`)
}
async function ensureConfig(request: import('@playwright/test').APIRequestContext) {
  if (modelIdOf() === 0) {
    const create = await request.post('/ia/api/v1/admin/model-configs', {
      data: { name: modelName, platform: 'openai_compatible', apiUrl: 'http://localhost:9', apiKey: API_KEY_1, status: 1, remark: 'e2e 前置补建' },
    })
    expect(create.status()).toBe(200)
  }
}

test('模型列表加载:含 demo seed(mock-text)', async ({ adminPage }) => {
  await adminPage.goto('/models')
  const resp = await adminPage.waitForResponse((r) => r.url().includes('/admin/model-configs'))
  expect(resp.status()).toBe(200)
  await expect(adminPage.locator('.el-table__row').first()).toBeVisible()
  await shot(adminPage, 'L6-01-模型配置列表(含demo seed)')
})

test('创建配置:密钥只回掩码(前4+****+后4)', async ({ request, adminPage }) => {
  await removeIfExists(request)
  await adminPage.goto('/models')
  await adminPage.getByRole('button', { name: '新建 API 配置' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await dlg.locator('.el-form-item').filter({ hasText: '配置名称' }).locator('input').fill(modelName)
  // 平台保持默认 openai_compatible;API 地址指向本机不可达端口(供后续连通性失败)
  await dlg.getByPlaceholder('https://...').fill('http://localhost:9')
  await dlg.getByPlaceholder('sk-...').fill(API_KEY_1)
  await dlg.locator('.el-form-item').filter({ hasText: '备注' }).locator('textarea').fill('e2e 创建')

  const createResp = adminPage.waitForResponse((r) => r.url().endsWith('/admin/model-configs') && r.request().method() === 'POST')
  await dlg.getByRole('button', { name: '保存' }).click()
  const resp = await createResp
  expect(resp.status()).toBe(200)
  const body = await resp.json()
  expect(body.code).toBe(0)
  // 掩码口径:sk-e2e-1234567890abcd → sk-e••••abcd
  expect(body.data.apiKeyMasked).toBe('sk-e••••abcd')
  expect(JSON.stringify(body.data)).not.toContain(API_KEY_1) // 明文绝不回显
  saveJson('L6-02-创建模型配置-响应.json', body)

  await expect(messageToast(adminPage, 'sk-e••••abcd')).toBeVisible()
  await shot(adminPage, 'L6-02-创建成功-密钥掩码提示')
  await expect(tableRow(adminPage, modelName)).toBeVisible()
})

test('编辑留空密钥 = 不修改;填新密钥 = 重掩码', async ({ request, adminPage }) => {
  await ensureConfig(request)
  await adminPage.goto('/models')
  const row = tableRow(adminPage, modelName)
  await row.getByRole('button', { name: '编辑' }).click()
  const dlg = adminPage.locator('.el-dialog:visible')
  await expect(dlg.locator('input[type="password"]')).toHaveAttribute('placeholder', /已设置\(sk-e••••abcd\)/)
  const keyField = dlg.locator('input[type="password"]')
  const putResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/model-configs\/\d+$/) !== null && r.request().method() === 'PUT')
  await dlg.getByRole('button', { name: '保存' }).click()
  const resp = await putResp
  const body = await resp.json()
  expect(body.data.apiKeyMasked).toBe('sk-e••••abcd') // 留空不改
  saveJson('L6-03-编辑留空-响应.json', body)
  // 明文不随响应出现
  expect(JSON.stringify(body)).not.toContain(API_KEY_1)
  await shot(adminPage, 'L6-03-编辑留空密钥-不改')

  // 换钥
  await tableRow(adminPage, modelName).getByRole('button', { name: '编辑' }).click()
  await keyField.fill(API_KEY_2)
  const put2 = adminPage.waitForResponse((r) => r.url().match(/\/admin\/model-configs\/\d+$/) !== null && r.request().method() === 'PUT')
  await dlg.getByRole('button', { name: '保存' }).click()
  const resp2 = await put2
  const body2 = await resp2.json()
  expect(body2.data.apiKeyMasked).toBe('sk-e••••nnnn')
  saveJson('L6-03-编辑换钥-响应.json', body2)
  await shot(adminPage, 'L6-03-编辑换钥-掩码更新')
})

test('连通性测试:不可达端点 → HTTP 200 + ok:false 兜底(探针语义,非 500)', async ({ request, adminPage }) => {
  await ensureConfig(request)
  await adminPage.goto('/models')
  const row = tableRow(adminPage, modelName)
  const testResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/model-configs\/\d+\/test$/) !== null)
  await row.getByRole('button', { name: '测试' }).click()
  const resp = await testResp
  expect(resp.status()).toBe(200) // 探针语义:失败是数据不是错误
  const body = await resp.json()
  expect(body.data.ok).toBe(false)
  expect(body.data.responseText).toContain('连接失败')
  expect(body.data.durationMs).toBeGreaterThanOrEqual(0)
  saveJson('L6-04-连通性okfalse-响应.json', body)
  await expect(messageToast(adminPage, '连通失败')).toBeVisible()
  await shot(adminPage, 'L6-04-连通性测试-okfalse错误提示')

  // 对照组:demo seed 的 mock 模型(记录实际表现,不做硬断言)
  const mockRow = adminPage.locator('.el-table__row').filter({ hasText: 'mock' }).first()
  if (await mockRow.count()) {
    const mockResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/model-configs\/\d+\/test$/) !== null)
    await mockRow.getByRole('button', { name: '测试' }).click()
    const mr = await mockResp
    saveJson('L6-04-对照组mock模型连通性.json', { status: mr.status(), body: await mr.json().catch(() => null) })
  }
})

test('删除配置:确认后列表移除,详情 404', async ({ request, adminPage }) => {
  await ensureConfig(request)
  await adminPage.goto('/models')
  const row = tableRow(adminPage, modelName)
  const delResp = adminPage.waitForResponse((r) => r.url().match(/\/admin\/model-configs\/\d+$/) !== null && r.request().method() === 'DELETE')
  await row.getByRole('button', { name: '删除' }).click()
  await confirmBox(adminPage, '确定')
  const resp = await delResp
  expect(resp.status()).toBe(200)
  saveJson('L6-05-删除-响应.json', await resp.json())
  await expect(messageToast(adminPage, '已删除')).toBeVisible()
  await expect(adminPage.locator('.el-table__row').filter({ hasText: modelName })).toHaveCount(0)
  await shot(adminPage, 'L6-05-删除后列表')

  const gone = await request.get(`/ia/api/v1/admin/model-configs/${modelIdOf()}`)
  expect(gone.status()).toBe(404)
  saveJson('L6-05-删除后详情404.json', { status: gone.status(), body: await gone.json() })
})

test('附录:创建请求缺 textProtocol 的落库形态(联调核对点)', async ({ request }) => {
  // web 前端 payload 不携带 textProtocol/platformAppId 等字段;此处核对服务端可空语义
  const name = 'e2e-notp-fixed'
  const create = await request.post('/ia/api/v1/admin/model-configs', {
    data: { name, platform: 'ollama', apiUrl: 'http://localhost:9', status: 1 },
  })
  expect(create.status()).toBe(200)
  const id = (await create.json()).data.id
  const dbRow = psql(`SELECT platform, text_protocol, api_url, status FROM ia_model_api_config WHERE id=${id}`)
  saveText('L6-06-缺textProtocol-落库形态.txt', `platform|text_protocol|api_url|status:\n${dbRow}`)
  await request.delete(`/ia/api/v1/admin/model-configs/${id}`)
})
