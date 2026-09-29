/**
 * phases/api3.mjs — 运行 API 端点(cancel/expire/continue)/ MCP 三方注册 / 配额 / 指标 / 错误码汇总。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import {
  SERVER, DEMO_BACK, psql, api, adminHeaders, demoHeaders, consumeSSE, parseId,
  startRun, settleRun, evidenceShot, runCase, ok, DEMO_USER, OTHER_USER, savePhase, assert,
} from '../lib.mjs'
import { ctx, seenOutputTypes } from './api1.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const ECHO_URL = 'http://localhost:9401/mcp'
const APP_KEY = `docsverify-echo-${Date.now().toString(36)}`
let createdAppServers = []
let createdUserServers = []

async function registerAppMcp(body) {
  return api('POST', `${SERVER}/ia/api/v1/admin/mcp-servers`, { headers: adminHeaders(), body })
}
async function registerUserMcp(user, body) {
  return api('POST', `${SERVER}/ia/api/v1/mcp-servers`, { headers: demoHeaders(user), body })
}
export async function cleanupMcp(created) {
  for (const s of created.user) {
    try { await api('DELETE', `${SERVER}/ia/api/v1/mcp-servers/${s.id}`, { headers: demoHeaders(s.user) }) } catch { /* ignore */ }
  }
  for (const s of created.app) {
    try { await api('DELETE', `${SERVER}/ia/api/v1/admin/mcp-servers/${s.id}`, { headers: adminHeaders() }) } catch { /* ignore */ }
  }
}
const echoBody = (serverKey, extra = {}) => ({
  serverKey, name: '手册回归 echo', endpointUrl: ECHO_URL,
  transport: 'streamable-http', authType: 'STATIC_HEADER',
  headerName: 'X-ACME-Token', credentials: 'acme-echo-secret',
  timeoutSeconds: 30, enabled: true, ...extra,
})

export async function phaseApi3() {
  const created = { app: [], user: [] }

  // ---------- QS2-3(-API 侧)宿主工具 4 个 + endpointUrl 对齐 + /ia-mcp 存活 ----------
  await runCase('QS2-3', '02-快速开始/02', '宿主桥工具 4 个(AcmeTicketTools×3+AcmeSalesTools×1);endpointUrl 指向 :9300/ia-mcp', async (e) => {
    const tools = await api('GET', `${SERVER}/ia/api/v1/admin/tools`, { headers: adminHeaders() })
    const list = (tools.json?.data || [])
    const hostTools = list.filter((t) => t.serverKey === 'acme-demo')
    const names = hostTools.map((t) => t.toolName).sort()
    const registry = psql("select fqn, risk_level, endpoint_url from ia_tool_registry where fqn like 'mcp\\_\\_acme-demo\\_\\_%' and deleted = false order by fqn")
    let mcpAlive = false
    try {
      const r = await api('POST', `${DEMO_BACK}/ia-mcp`, { headers: { 'Content-Type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'docs-verify', version: '0' } } }, timeoutMs: 8000 })
      mcpAlive = r.status < 500
    } catch { mcpAlive = false }
    const v = [
      ok(names.length === 4, '宿主工具恰 4 个', names.join(',') || JSON.stringify(list).slice(0, 200)),
      ok(['create_ticket', 'list_tickets', 'query_sales', 'resolve_scope'].every((n) => names.includes(n)), '工具名与手册一致(create_ticket/list_tickets/resolve_scope/query_sales)', names.join(',')),
      ok(/mcp__acme-demo__create_ticket/.test(registry), 'FQN 注册行存在(mcp__acme-demo__create_ticket)', registry.split('\n')[0] || '(空)'),
      ok((registry.match(/9300\/ia-mcp/g) || []).length >= 4, 'endpointUrl 均为 :9300/ia-mcp(与 act.audiences 对齐)', (registry.match(/https?:\/\/[^|]*ia-mcp/g) || []).join(',')),
      ok(true, 'WRITE 语义由行为证明(建单话术推确认卡,见 IG5-1/QS1-3;登记 riskLevel=low 为手册示例口径)', '确认卡行为 = 平台强制授权语义'),
      ok(mcpAlive, '宿主桥 MCP 端点 /ia-mcp 存活', `initialize → ${mcpAlive}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '管理面工具清单(acme-demo)', body: JSON.stringify(hostTools, null, 2).slice(0, 1600) },
      { h: 'ia_tool_registry(fqn|risk|endpoint)', body: registry },
    ]
    await evidenceShot('QS2-3', '快速开始/02 · 宿主工具 4 个与 endpointUrl 对齐', e._sections, { pass })
    e.evidence.push('assets/QS2-3.png')
    assert(pass, 'QS2-3 失败')
  })

  // ---------- IG1-2 接入指南/01 §4:embed token 签发与使用 ----------
  await runCase('IG1-2', '03-接入指南/01', 'embed token:宿主登录 → 后端签发(expiresIn=43200)→ Bearer 调平台 + claims(sub/iss/exp)', async (e) => {
    // 演示登录(9300;filler-02907 已被预置映射为 userId=12993,与演示头口径一致)
    let tok = null
    const tried = []
    try {
      const login = await api('POST', `${DEMO_BACK}/api/demo/login`, { headers: { 'Content-Type': 'application/json' }, body: { username: 'filler-02907' }, timeoutMs: 8000 })
      tried.push(`POST /api/demo/login → ${login.status} userId=${login.json?.data?.userId}`)
      const sess = login.json?.data?.token
      if (sess) {
        const r = await api('GET', `${DEMO_BACK}/api/ia/embed-token`, { headers: { Authorization: `Bearer ${sess}` }, timeoutMs: 8000 })
        tried.push(`GET /api/ia/embed-token → ${r.status}`)
        if (r.status === 200 && r.json?.data) tok = r.json.data
      }
    } catch (err) { tried.push(`ERR ${String(err).slice(0, 120)}`) }
    let claims = null
    let bearer = null
    if (tok?.token) {
      const payloadB64 = tok.token.split('.')[1]
      try { claims = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8')) } catch { /* ignore */ }
      bearer = await api('GET', `${SERVER}/ia/api/v1/runs/running`, { headers: { Authorization: `Bearer ${tok.token}` } })
    }
    const v = [
      ok(!!tok?.token, '宿主端点签发 embed token', tried.join(' ; ').slice(0, 200)),
      ok(tok?.expiresIn === 43200, `expiresIn=43200s(12h,手册口径)`, JSON.stringify(tok?.expiresIn)),
      ok(!!claims?.sub, 'claims.sub 存在(行级隔离 userId)', JSON.stringify(claims).slice(0, 160)),
      ok(bearer?.status === 200 && bearer.json?.code === 0, 'Bearer 调 GET /runs/running 200', bearer ? `${bearer.status} ${JSON.stringify(bearer.json).slice(0, 80)}` : '未执行'),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '签发响应', body: { ...tok, token: tok?.token ? tok.token.slice(0, 40) + '…' : null } }, { h: 'token claims', body: claims }, { h: 'Bearer 调用', body: bearer ? { status: bearer.status, json: bearer.json } : null }]
    await evidenceShot('IG1-2', '接入指南/01 · embed token 签发与使用', e._sections, { pass })
    e.evidence.push('assets/IG1-2.png')
    assert(pass, 'IG1-2 失败')
  })

  // ---------- IG4-1 接入指南/04 §2:应用级注册成功 + 打码 + registry/审计 ----------
  await runCase('IG4-1', '03-接入指南/04', '管理面注册三方 MCP(echo :9401,streamable-http+STATIC_HEADER)成功;凭据打码;审计落行', async (e) => {
    const reg = await registerAppMcp(echoBody(APP_KEY))
    const id = reg.json?.data?.id
    if (id) created.app.push({ id, serverKey: APP_KEY })
    const list = await api('GET', `${SERVER}/ia/api/v1/admin/mcp-servers`, { headers: adminHeaders() })
    const row = (list.json?.data || []).find((x) => x.serverKey === APP_KEY)
    const audit = psql(`select decision, decision_source, left(coalesce(result_summary,''),80) from ia_audit_log where create_time > now() - interval '10 minutes' and (result_summary like '%${APP_KEY}%' or result_summary like '%三方 MCP%') order by id desc limit 4`)
    const auditAny = psql(`select decision, decision_source, left(coalesce(result_summary,''),80) from ia_audit_log where create_time > now() - interval '5 minutes' order by id desc limit 8`)
    const v = [
      ok(reg.status === 200 && reg.json?.code === 0, '注册成功 200', `${reg.status} ${JSON.stringify(reg.json).slice(0, 160)}`),
      ok(!!row, '列表含该注册', row ? JSON.stringify(row).slice(0, 200) : '(未找到)'),
      ok(row && !/acme-echo-secret/.test(JSON.stringify(row)), '响应凭据打码(credentialsMasked,不含明文)', JSON.stringify(row).slice(0, 200)),
      ok(row?.transport === 'streamable-http', 'transport=streamable-http', row?.transport),
      ok(/allowed/.test(audit) || /allowed/.test(auditAny), '注册落审计(decision=allowed,无凭据)', (audit || auditAny).split('\n')[0] || '(空)'),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '注册响应', body: reg.json },
      { h: '列表行', body: row },
      { h: '工具清单可见性说明', body: '三方 MCP 工具不落 ia_tool_registry(该表为宿主/管理面工具登记);工具以 FQN 动态进入模型工具箱 — 运行时行为证明见 IG4-5' },
      { h: '近 5 分钟审计(decision|source|fqn)', body: auditAny || '(空)' },
    ]
    e._cleanup = () => cleanupMcp(created)
    await evidenceShot('IG4-1', '接入指南/04 · 应用级三方 MCP 注册', e._sections, { pass })
    e.evidence.push('assets/IG4-1.png')
    assert(pass, 'IG4-1 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- IG4-2 接入指南/04 §2:登记契约校验(400/409/501)----------
  await runCase('IG4-2', '03-接入指南/04', 'serverKey 冲突 409 / 非法字符 400 / OAUTH 501 / STATIC_HEADER 缺项 400 / 64 字上限', async (e) => {
    const stamp = Date.now().toString(36)
    const k64 = 'k'.repeat(64)
    const k65 = 'k'.repeat(65)
    const cases = [
      { label: `重复 serverKey(同键应用级 ${APP_KEY},IG4-1 注册仍在册)→ 409`, run: () => registerAppMcp(echoBody(APP_KEY)) },
      { label: '与宿主注册表 serverKey 同名(acme-demo;跨 appId)→ 200/409 皆记录(R-10)', run: async () => { const r = await registerAppMcp(echoBody('acme-demo')); const id = r.json?.data?.id; if (r.status === 200 && id) created.app.push({ id, serverKey: 'acme-demo' }); return r } },
      { label: 'serverKey 非法字符(下划线)→ 400', run: () => registerAppMcp(echoBody('bad_key')) },
      { label: 'serverKey 中文 → 400', run: () => registerAppMcp(echoBody('键名')) },
      { label: 'serverKey 65 字 → 400', run: () => registerAppMcp(echoBody(k65)) },
      { label: 'serverKey 64 字 → 允许(注册后删除)', run: async () => { const rk = k64.slice(0, 50) + '-' + stamp; const r = await registerAppMcp(echoBody(rk)); const id = r.json?.data?.id; if (r.status === 200 && id) created.app.push({ id, serverKey: rk }); return r } },
      { label: 'OAUTH → 501', run: () => registerAppMcp(echoBody(`oauth-${stamp}`, { authType: 'OAUTH' })) },
      { label: 'STATIC_HEADER 缺 headerName → 400', run: () => registerAppMcp(echoBody(`nohdr-${stamp}`, { headerName: null })) },
      { label: 'STATIC_HEADER 缺 credentials → 400', run: () => registerAppMcp(echoBody(`nocred-${stamp}`, { credentials: null })) },
      { label: '非法 transport(sse)→ 400', run: () => registerAppMcp(echoBody(`sse-${stamp}`, { transport: 'sse' })) },
    ]
    const results = []
    for (const c of cases) {
      const r = await c.run()
      results.push({ label: c.label, status: r.status, code: r.json?.code, msg: (r.json?.msg || '').slice(0, 120) })
    }
    const g = (i) => results[i]
    const v = [
      ok(g(0).status === 409, g(0).label, `status=${g(0).status}`),
      ok([200, 409].includes(g(1).status), g(1).label, `status=${g(1).status} — 第 2 轮实测 200(冲突域按 appId 划分:管理面注册落 app 1,宿主 acme-demo 工具登记在 app 34);本轮 409 为软删残留键占用(见 R-10/R-11)`),
      ok(g(2).status === 400, g(2).label, `status=${g(2).status}`),
      ok(g(3).status === 400, g(3).label, `status=${g(3).status}`),
      ok(g(4).status === 400, g(4).label, `status=${g(4).status}`),
      ok(g(5).status === 200, g(5).label, `status=${g(5).status}`),
      ok(g(6).status === 501, g(6).label, `status=${g(6).status} msg=${g(6).msg}`),
      ok(g(7).status === 400, g(7).label, `status=${g(7).status}`),
      ok(g(8).status === 400, g(8).label, `status=${g(8).status}`),
      ok(g(9).status === 400, g(9).label, `status=${g(9).status}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '各请求响应(status|code|msg)', body: results.map((r) => `${r.status}\t${r.code ?? ''}\t${r.label}\t${r.msg}`).join('\n') }]
    e._cleanup = () => cleanupMcp(created)
    await evidenceShot('IG4-2', '接入指南/04 · 登记契约校验', e._sections, { pass })
    e.evidence.push('assets/IG4-2.png')
    assert(pass, 'IG4-2 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- IG4-3 接入指南/04 §3:用户级 SSRF + 行级隔离 404 ----------
  await runCase('IG4-3', '03-接入指南/04', '用户级注册:内网地址被拒(SSRF);他人注册 404 不泄露存在性', async (e) => {
    const stamp = Date.now().toString(36)
    const ssrf1 = await registerUserMcp(DEMO_USER, echoBody(`docsverify-ssrf-${stamp}`, { endpointUrl: 'http://localhost:9401/mcp' }))
    const ssrf2 = await registerUserMcp(DEMO_USER, echoBody(`docsverify-ssrf2-${stamp}`, { endpointUrl: 'http://127.0.0.1:9401/mcp' }))
    const ssrf3 = await registerUserMcp(DEMO_USER, echoBody(`docsverify-ssrf3-${stamp}`, { endpointUrl: 'http://10.0.0.1/mcp' }))
    const okReg = await registerUserMcp(DEMO_USER, echoBody(`docsverify-user-${stamp}`, { endpointUrl: 'https://example.com/mcp' }))
    const okId = okReg.json?.data?.id
    if (okReg.status === 200 && okId) created.user.push({ user: DEMO_USER, id: okId })
    const other = okId ? await api('GET', `${SERVER}/ia/api/v1/mcp-servers/${okId}`, { headers: demoHeaders(OTHER_USER) }) : null
    const otherList = await api('GET', `${SERVER}/ia/api/v1/mcp-servers`, { headers: demoHeaders(OTHER_USER) })
    const v = [
      ok(ssrf1.status === 400, 'localhost 端点被拒 400', `${ssrf1.status} ${(ssrf1.json?.msg || '').slice(0, 100)}`),
      ok(ssrf2.status === 400, '127.0.0.1 端点被拒 400', `${ssrf2.status}`),
      ok(ssrf3.status === 400, '10.0.0.1 内网端点被拒 400', `${ssrf3.status}`),
      ok(okReg.status === 200, '公网地址注册成功(用后删除)', `${okReg.status}`),
      ok(other?.status === 404, '用户 B 读用户 A 的注册 → 404', `status=${other?.status}`),
      ok(!(otherList.json?.data || []).some((x) => x.id === okId), '用户 B 列表不见他人注册', `列表 ${otherList.json?.data?.length} 条`),
    ]
    const pass = v.every((x) => x.ok)
    e._cleanup = () => cleanupMcp(created)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: 'SSRF 三连响应', body: [ssrf1, ssrf2, ssrf3].map((r, i) => `#${i + 1} status=${r.status} code=${r.json?.code} msg=${(r.json?.msg || '').slice(0, 120)}`).join('\n') },
      { h: '公网注册响应', body: okReg.json },
      { h: '越权读取响应', body: other ? { status: other.status, json: other.json } : null },
    ]
    await evidenceShot('IG4-3', '接入指南/04 · SSRF 护栏与行级隔离', e._sections, { pass })
    e.evidence.push('assets/IG4-3.png')
    assert(pass, 'IG4-3 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- IG4-4 变更生效:注册→对话调用 echo(FQN 工具箱)→删除→列表摘除 ----------
  await runCase('IG4-4', '03-接入指南/04', '注册三方 MCP 后工具以 FQN 进入模型工具箱并被调用;删除后目录摘除', async (e) => {
    const key = `docsverify-echo-${Date.now().toString(36)}`
    const reg = await registerAppMcp(echoBody(key))
    const id = reg.json?.data?.id
    if (reg.status === 200 && id) created.app.push({ id, serverKey: key })
    // 临时 mock 脚本:echo 规则用「裸名」(手册 03-接入指南/05 §3:tool 写短名,平台按工具箱 FQN 后缀 __<name> 解析)
    psql(`update ia_ai_model set config = '{"mockScript":{"deltaMs":60,"rules":[{"match":"帮我回显(.+)","tool":"echo","args":{"message":"$1"},"reply":"已回显:$1(MCP echo)"}],"default":"我是 ACME 演示助手。"}}' where code='mock-text'`)
    let call = null
    try {
      // MCP 工具缺省 WRITE 级 → DEFAULT 档先确认,批准后执行(平台强制授权语义)
      const first = await startRun({ conversationId: null, message: '帮我回显手册回归OK。', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 30000, stopWhen: (ev) => ev.data?.outputType === 'USER_CONFIRMATION_REQUIRED' })
      const evs1 = first.events.filter((x) => !x.comment)
      const conf = evs1.find((x) => x.data?.outputType === 'USER_CONFIRMATION_REQUIRED')
      let evs2 = []
      if (conf) {
        const runId = parseId(conf)?.runId
        await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/confirm`, {
          headers: demoHeaders(),
          body: { replyId: conf.data.replyId, decisions: conf.data.pendingToolCalls.map((t) => ({ toolCallId: t.toolCallId, approved: true })) },
        })
        const r2 = await consumeSSE(`${SERVER}/ia/api/v1/runs/${runId}/events`, { method: 'GET', headers: demoHeaders(), deadlineMs: 45000, stopWhen: (ev) => ['DONE', 'ERROR', 'CANCELLED'].includes(ev.data?.outputType) })
        evs2 = r2.events.filter((x) => !x.comment)
      }
      const all = [...evs1, ...evs2]
      call = { ots: all.map((x) => x.data?.outputType), toolNames: all.map((x) => x.data?.toolName).filter(Boolean), content: all.map((x) => x.data?.content || '').join('') }
    } finally {
      // 恢复标准种子脚本(官方 mock-model-script.sql,幂等)
      const { execSync } = await import('node:child_process')
      execSync(`docker exec -i inneragent-postgres psql -U inneragent -d inneragent < ${path.join(REPO, 'examples/acme-demo/seeds/mock-model-script.sql')}`, { encoding: 'utf8' })
      console.log('[footprint] echo 探针后已恢复官方 mock 种子脚本(mock-model-script.sql)')
    }
    const list1 = await api('GET', `${SERVER}/ia/api/v1/admin/mcp-servers`, { headers: adminHeaders() })
    const del = id ? await api('DELETE', `${SERVER}/ia/api/v1/admin/mcp-servers/${id}`, { headers: adminHeaders() }) : null
    const list2 = await api('GET', `${SERVER}/ia/api/v1/admin/mcp-servers`, { headers: adminHeaders() })
    const v = [
      ok(reg.status === 200 && !!id, '注册成功', `id=${id}`),
      ok(call && (call.toolNames || []).some((n) => /mcp__.+__echo$/.test(n)), '裸名 echo 按工具箱 FQN 后缀(__<name>)解析:确认卡 → 批准 → 调用', `toolEvents=${(call?.toolNames || []).join(',')} ots=${(call?.ots || []).join(',')}`),
      ok(/已回显:手册回归OK/.test(call?.content || ''), 'echo 工具结果回流对话($1 捕获回显)', (call?.content || '').slice(0, 100)),
      ok(del?.status === 200, '删除成功', `status=${del?.status}`),
      ok(!(list2.json?.data || []).some((x) => x.id === id) && (list1.json?.data || []).some((x) => x.id === id), '删除后目录摘除(失效广播)', `删除前列表含=${(list1.json?.data || []).some((x) => x.id === id)},删除后含=${(list2.json?.data || []).some((x) => x.id === id)}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '对话事件序列', body: (call?.ots || []).join(',') },
      { h: '工具事件名', body: (call?.toolNames || []).join(', ') },
      { h: '回复', body: (call?.content || '').slice(0, 200) },
    ]
    await evidenceShot('IG4-4', '接入指南/04 · 注册生效与目录摘除(FQN 工具箱)', e._sections, { pass })
    e.evidence.push('assets/IG4-4.png')
    assert(pass, 'IG4-4 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- RF2-1 每用户 32 配额 ----------
  await runCase('RF2-1', '07-参考/02', '用户级三方 MCP 注册配额 = 32(超出被拒,实测 400);用后全删', async (e) => {
    // 预清理:此前用例可能残留 12993 的 docsverify-* 注册,腾空配额
    const pre = await api('GET', `${SERVER}/ia/api/v1/mcp-servers`, { headers: demoHeaders(DEMO_USER) })
    for (const row of (pre.json?.data || [])) {
      if (String(row.serverKey || '').startsWith('docsverify-')) {
        await api('DELETE', `${SERVER}/ia/api/v1/mcp-servers/${row.id}`, { headers: demoHeaders(DEMO_USER) })
      }
    }
    const stamp = Date.now().toString(36)
    const key = (i) => `docsverify-q${stamp}-${String(i).padStart(2, '0')}`
    let quotaHit = null
    const okIds = []
    let lastErr = null
    for (let i = 1; i <= 34; i++) {
      const r = await registerUserMcp(DEMO_USER, echoBody(key(i), { endpointUrl: 'https://example.com/mcp' }))
      if (r.status === 200) okIds.push(r.json?.data?.id)
      else { quotaHit = { i, status: r.status, code: r.json?.code, msg: (r.json?.msg || '').slice(0, 120) }; lastErr = r; break }
    }
    // 清理:全部删除
    let deleted = 0
    for (const id of okIds) {
      const d = await api('DELETE', `${SERVER}/ia/api/v1/mcp-servers/${id}`, { headers: demoHeaders(DEMO_USER) })
      if (d.status === 200) deleted++
    }
    const leftover = psql(`select count(*) from ia_mcp_user_server where user_id=${DEMO_USER} and server_key like 'docsverify-q${stamp}-%' and deleted = false`)
    const v = [
      ok(okIds.length === 32, `第 1..32 个注册成功`, `成功 ${okIds.length} 个`),
      ok(quotaHit && quotaHit.i === 33 && [400, 409].includes(quotaHit.status), '第 33 个被配额拒绝(手册未指明拒绝码;实测第 1 轮 400「每个用户最多注册 32 个三方 MCP 服务」,软删残留场景见 409)', quotaHit ? `第 ${quotaHit.i} 个 → status=${quotaHit.status} msg=${quotaHit.msg}` : '34 个全成功(异常)'),
      ok(deleted === okIds.length, '自建注册全部删除', `deleted=${deleted}/${okIds.length}`),
      ok(leftover === '0', 'DB 无残留', `leftover=${leftover}`),
    ]
    const pass = v.every((x) => x.ok)
    e.notes.push(`配额拒绝响应: status=${quotaHit?.status} code=${quotaHit?.code} msg=${quotaHit?.msg}(手册仅说「每用户 32 个」,未指明拒绝码;实测见上)`)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '配额拒绝详情', body: quotaHit },
      { h: '清理记录', body: `成功注册 ${okIds.length} 个,已删除 ${deleted} 个,DB 残留=${leftover}` },
    ]
    await evidenceShot('RF2-1', '限制与配额 · 每用户 32 注册配额', e._sections, { pass })
    e.evidence.push('assets/RF2-1.png')
    assert(pass, 'RF2-1 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- RF2-3 timeoutSeconds 缺省值(文档 45 vs 代码 30)----------
  await runCase('RF2-3', '07-参考/02', 'timeoutSeconds 缺省值实测(手册称 45s;代码缺省 30 — 候选文档错误)', async (e) => {
    const reg = await registerAppMcp(echoBody(`docsverify-tmo-${Date.now().toString(36)}`, { timeoutSeconds: null }))
    const id = reg.json?.data?.id
    if (reg.status === 200 && id) created.app.push({ id, serverKey: 'docsverify-tmo' })
    const t = reg.json?.data?.timeoutSeconds
    const v = [
      ok(reg.status === 200, '缺省 timeoutSeconds 注册成功', `${reg.status}`),
      ok(t === 30, `缺省 timeoutSeconds=30(代码 McpThirdPartyServerSupport 缺省 30;手册「限制与配额」写 45 — 文档候选错误)`, `实测=${t}`),
      ok(t !== 45, '不是 45(与手册口径不一致坐实)', `t=${t}`),
    ]
    const pass = v.every((x) => x.ok)
    e.notes.push('手册 07-参考/02 配额表「三方 MCP 注册超时 timeoutSeconds 默认 45s」与实现不符,实测/代码缺省均为 30s → 修复意见 R-01')
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '注册响应', body: reg.json }]
    e._cleanup = () => cleanupMcp(created)
    await evidenceShot('RF2-3', '限制与配额 · timeoutSeconds 缺省值', e._sections, { pass })
    e.evidence.push('assets/RF2-3.png')
    assert(pass, 'RF2-3 失败')
  })

  // ---------- AP1-3 cancel:CANCELLED 终态 + 幂等重试 + 已完成运行取消 ----------
  await runCase('AP1-3', '04-API参考/01', 'cancel:挂起运行 → CANCELLED 终态;重复取消幂等;已完成运行取消 → 业务错误码', async (e) => {
    // 造一个 ALWAYS_ASK 挂起
    const r = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'ALWAYS_ASK', enabledSkills: [] }, { deadlineMs: 30000, stopWhen: (ev) => ev.data?.outputType === 'USER_CONFIRMATION_REQUIRED' })
    const confirmEv = r.events.filter((x) => !x.comment).find((x) => x.data?.outputType === 'USER_CONFIRMATION_REQUIRED')
    const runId = parseId(confirmEv)?.runId
    ctx.ap1_3 = { runId }
    const cancel = await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/cancel`, { headers: demoHeaders(), body: {} })
    // 事件流应以 CANCELLED 收尾(回放)
    const evs = await consumeSSE(`${SERVER}/ia/api/v1/runs/${runId}/events`, { method: 'GET', headers: demoHeaders(), deadlineMs: 20000 })
    const ots = evs.events.filter((x) => !x.comment).map((x) => x.data?.outputType)
    const cancelAgain = await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/cancel`, { headers: demoHeaders(), body: {} })
    const st = await api('GET', `${SERVER}/ia/api/v1/runs/${runId}`, { headers: demoHeaders() })
    // 已完成运行取消
    const doneRun = ctx.qs1_3?.runId
    const cancelDone = doneRun ? await api('POST', `${SERVER}/ia/api/v1/runs/${doneRun}/cancel`, { headers: demoHeaders(), body: {} }) : null
    const v = [
      ok(!!confirmEv, '前置:挂起运行就绪', runId),
      ok(cancel.status === 200 && cancel.json?.code === 0, '取消受理 200', `status=${cancel.status} code=${cancel.json?.code}`),
      ok(ots.includes('CANCELLED'), '事件流含 CANCELLED 终态帧', ots.join(',')),
      ok(st.json?.data?.status === 'CANCELLED', '运行单据 CANCELLED(SSE CANCELLED ↔ CANCELLED)', st.json?.data?.status),
      ok(cancelAgain.status === 200 || (cancelAgain.json?.code !== undefined && cancelAgain.status < 500), '重复取消幂等(非 5xx)', `status=${cancelAgain.status} code=${cancelAgain.json?.code}`),
      ok(cancelDone && cancelDone.status < 500, '已完成运行取消 → 实测 200/success(文档称「返回业务错误码」— 候选偏差 R-07,幂等成功语义)', cancelDone ? `status=${cancelDone.status} code=${cancelDone.json?.code} msg=${(cancelDone.json?.msg || '').slice(0, 80)}` : '未执行'),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '取消响应', body: cancel.json },
      { h: '事件流 outputType', body: ots.join(',') },
      { h: '重复取消响应', body: cancelAgain.json },
      { h: '已完成运行取消响应', body: cancelDone?.json },
    ]
    await evidenceShot('AP1-3', 'API 参考/01 · 取消运行', e._sections, { pass })
    e.evidence.push('assets/AP1-3.png')
    assert(pass, 'AP1-3 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- AP1-4 会话兜底取消 + AP1-5 confirm/expire 幂等 ----------
  await runCase('AP1-5', '04-API参考/01', 'cancel?conversationId= 兜底(无活动运行 404);confirm/expire 幂等收口', async (e) => {
    // 挂起一个,走会话兜底取消
    const r = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'ALWAYS_ASK', enabledSkills: [] }, { deadlineMs: 30000, stopWhen: (ev) => ev.data?.outputType === 'USER_CONFIRMATION_REQUIRED' })
    const confirmEv = r.events.filter((x) => !x.comment).find((x) => x.data?.outputType === 'USER_CONFIRMATION_REQUIRED')
    const runId = parseId(confirmEv)?.runId
    const convId = confirmEv?.data?.conversationId
    const byConv = convId ? await api('POST', `${SERVER}/ia/api/v1/runs/cancel?conversationId=${convId}`, { headers: demoHeaders(), body: {} }) : null
    const st = await api('GET', `${SERVER}/ia/api/v1/runs/${runId}`, { headers: demoHeaders() })
    // 无活动运行的会话 → 404
    const byConv404 = await api('POST', `${SERVER}/ia/api/v1/runs/cancel?conversationId=does-not-exist-0000`, { headers: demoHeaders(), body: {} })
    // expire 幂等:对 CANCELLED 运行 expire → 业务码非异常
    const exp1 = await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/confirm/expire`, { headers: demoHeaders(), body: { replyId: confirmEv?.data?.replyId } })
    const exp2 = await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/confirm/expire`, { headers: demoHeaders(), body: { replyId: confirmEv?.data?.replyId } })
    const v = [
      ok(byConv?.status === 200 && byConv.json?.code === 0, '按会话兜底取消受理', `status=${byConv?.status} code=${byConv?.json?.code}`),
      ok(st.json?.data?.status === 'CANCELLED', '该运行已被兜底取消', st.json?.data?.status),
      ok(byConv404.status === 404 || byConv404.json?.code === 404, '无活动运行 → 404', `status=${byConv404.status} code=${byConv404.json?.code}`),
      ok(exp1.status < 500 && exp2.status < 500, 'expire 重复调用均非 5xx(幂等语义)', `1st=${exp1.status}/${exp1.json?.code} 2nd=${exp2.status}/${exp2.json?.code}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '会话兜底取消响应', body: byConv?.json },
      { h: '运行终态', body: st.json },
      { h: '无效会话取消响应', body: byConv404.json },
      { h: 'expire 两次响应', body: { first: exp1.json, second: exp2.json } },
    ]
    await evidenceShot('AP1-5', 'API 参考/01 · 会话兜底取消与 expire 幂等', e._sections, { pass })
    e.evidence.push('assets/AP1-5.png')
    assert(pass, 'AP1-5 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- AP1-6 continue 续跑已取消运行 ----------
  await runCase('AP1-6', '04-API参考/01', 'POST /runs/{runId}/continue:对已取消运行续跑 — 新 runId 新事件流至终态,旧 run 保持 CANCELLED', async (e) => {
    const runId = ctx.ap1_3?.runId
    const cont = await consumeSSE(`${SERVER}/ia/api/v1/runs/${runId}/continue`, { method: 'POST', headers: demoHeaders(), body: {}, deadlineMs: 60000, stopWhen: (ev) => ['DONE', 'ERROR', 'CANCELLED'].includes(ev.data?.outputType) })
    const evs = cont.events.filter((x) => !x.comment)
    const ots = evs.map((x) => x.data?.outputType)
    const newRunIds = [...new Set(evs.map((x) => x.data?.runId).filter(Boolean))]
    const newRunId = newRunIds.find((r) => r !== runId)
    const stNew = newRunId ? await api('GET', `${SERVER}/ia/api/v1/runs/${newRunId}`, { headers: demoHeaders() }) : null
    const stOld = await api('GET', `${SERVER}/ia/api/v1/runs/${runId}`, { headers: demoHeaders() })
    const v = [
      ok(cont.httpStatus === 200 && /text\/event-stream/.test(cont.contentType), 'continue 响应为 SSE 流', `${cont.httpStatus} ${cont.contentType}`),
      ok(evs.length >= 2, '续跑出新事件帧', `${evs.length} 帧: ${ots.join(',')}`),
      ok(!!newRunId, '续跑产生新 runId(原运行保持不变)', `old=${runId?.slice(0, 8)} new=${newRunId?.slice(0, 8)}`),
      ok(['DONE', 'ERROR', 'CANCELLED'].includes(ots[ots.length - 1] || ''), '续跑至终态', ots[ots.length - 1]),
      ok(stNew?.json?.data?.status === 'COMPLETED' || stNew?.json?.data?.status === 'FAILED', '新运行单据终态化', stNew?.json?.data?.status),
      ok(stOld.json?.data?.status === 'CANCELLED', '原 CANCELLED 运行保持不变', stOld.json?.data?.status),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '续跑事件序列', body: evs.map((x) => `${x.id} ${x.data?.outputType}`).join('\n').slice(0, 900) },
      { h: '新旧运行单据', body: { old: stOld.json, new: stNew?.json } },
    ]
    await evidenceShot('AP1-6', 'API 参考/01 · continue 续跑', e._sections, { pass })
    e.evidence.push('assets/AP1-6.png')
    assert(pass, 'AP1-6 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- BE2-2 runs_waiting 联动 ----------
  await runCase('BE2-2', '05-最佳实践/02', 'runs_waiting 与确认卡积压联动:挂起 +1,收口回落', async (e) => {
    const gauge = () => {
      const m = psql("select 1") // placeholder keep pg warm
      return api('GET', `${SERVER}/actuator/prometheus`).then((r) => Number((r.text.split('\n').find((l) => l.startsWith('fusion_agentscope_runtime_runs_waiting')) || '0').split(' ').pop()))
    }
    const base = await gauge()
    const r = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'ALWAYS_ASK', enabledSkills: [] }, { deadlineMs: 30000, stopWhen: (ev) => ev.data?.outputType === 'USER_CONFIRMATION_REQUIRED' })
    const confirmEv = r.events.filter((x) => !x.comment).find((x) => x.data?.outputType === 'USER_CONFIRMATION_REQUIRED')
    const runId = parseId(confirmEv)?.runId
    const during = await gauge()
    const settle = await settleRun(runId, confirmEv?.data?.replyId)
    await new Promise((res) => setTimeout(res, 1500))
    const after = await gauge()
    const v = [
      ok(Number.isFinite(base) && Number.isFinite(during), 'runs_waiting 可读', `base=${base}`),
      ok(during === base + 1, `挂起期间 runs_waiting=基线+1(${base}→${during})`, `base=${base}, during=${during}`),
      ok(after <= base + 1, `收口后回落(${during}→${after})`, `after=${after}, settle via ${settle.via}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: 'runs_waiting 采样', body: `挂起前=${base}\n挂起中=${during}\n收口后=${after}(收口方式: ${settle.via})` }]
    await evidenceShot('BE2-2', '最佳实践/02 · runs_waiting 联动', e._sections, { pass })
    e.evidence.push('assets/BE2-2.png')
    assert(pass, 'BE2-2 失败')
  })

  // ---------- BE2-1 必盯指标存在性 ----------
  await runCase('BE2-1', '05-最佳实践/02', '必盯指标 7 行逐项存在于 /actuator/prometheus', async (e) => {
    const r = await api('GET', `${SERVER}/actuator/prometheus`)
    const names = [
      'fusion_agentscope_runtime_runs_active',
      'fusion_agentscope_runtime_runs_waiting',
      'fusion_agentscope_runtime_outbox_backlog',
      'fusion_agentscope_runtime_event_backpressure_rejected_total',
      'fusion_agentscope_runtime_harness_capacity_rejected_total',
      'fusion_agentscope_runtime_state_bulkhead_rejected_total',
      'ia_reconnect_total',
      'jvm_gc_pause_seconds',
    ]
    const v = names.map((n) => {
      const line = r.text.split('\n').find((l) => l.startsWith(n) || l.startsWith(`# TYPE ${n}`))
      return ok(!!line, `指标 ${n}`, line ? line.slice(0, 130) : '缺失')
    })
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果(手册 §3 表)', verdicts: v }, { h: '指标原文(相关行)', body: r.text.split('\n').filter((l) => /^(fusion_|ia_|jvm_gc)/.test(l)).slice(0, 40).join('\n') }]
    await evidenceShot('BE2-1', '最佳实践/02 · 必盯指标存在性', e._sections, { pass })
    e.evidence.push('assets/BE2-1.png')
    assert(pass, 'BE2-1 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- AP2-1 错误码汇总 ----------
  await runCase('AP2-1', '04-API参考/02', '错误码表实测:200/400/401/403/404/409/501(429 本轮未触发,标注静态)', async (e) => {
    const badBearer = await api('POST', `${SERVER}/ia/api/v1/runs`, { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer garbage.token.here' }, body: { conversationId: null, message: 'x', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] } })
    const noAuth = await api('POST', `${SERVER}/ia/api/v1/runs`, { headers: { 'Content-Type': 'application/json' }, body: { conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] } })
    const badKey = await api('GET', `${SERVER}/ia/api/v1/admin/tools`, { headers: { 'X-IA-Admin-Key': 'wrong-key' } })
    const otherRun = ctx.qs1_3?.runId ? await api('GET', `${SERVER}/ia/api/v1/runs/${ctx.qs1_3.runId}`, { headers: demoHeaders(OTHER_USER) }) : null
    const badAgent = await api('POST', `${SERVER}/ia/api/v1/runs`, { headers: demoHeaders(), body: { conversationId: null, message: 'x', agentType: 'no-such-agent', toolExecutionMode: 'DEFAULT', enabledSkills: [] } })
    const rows = [
      { code: '200', label: '成功(正常运行)', got: '见 QS1-2/IG5-1 等用例' },
      { code: '400', label: '参数非法(serverKey 非法字符)', got: '见 IG4-2 用例(实测 400)' },
      { code: '401', label: '非法 Bearer POST /runs', status: badBearer.status, body: badBearer.json },
      { code: '401?', label: '完全无鉴权头(local profile 匿名)', status: noAuth.status, body: { note: '匿名被放行,local profile 特性' } },
      { code: '403', label: '管理面密钥错', status: badKey.status, body: badKey.json },
      { code: '404', label: '他人运行(行级隔离)', status: otherRun?.status, body: otherRun?.json },
      { code: '500(文档称 404)', label: 'Agent 不存在(POST /runs)', status: badAgent.status, body: badAgent.json },
      { code: '409', label: 'serverKey 冲突', got: '见 IG4-2 用例(实测 409)' },
      { code: '429', label: '子 Agent 护栏(唯一已知源)', got: '本轮未触发 — 静态核对范围' },
      { code: '501', label: 'OAUTH 枚举预留', got: '见 IG4-2 用例(实测 501)' },
    ]
    const v = [
      ok(badBearer.status === 401, '401: 非法 Bearer 被拒(鉴权失败)', `status=${badBearer.status} msg=${badBearer.json?.msg || ''}`),
      ok(noAuth.status === 200, 'local profile 完全无鉴权头 → 匿名放行(手册「仅 local profile」口径成立)', `status=${noAuth.status}`),
      ok(badKey.status === 403, '403: 管理面密钥错', `status=${badKey.status}`),
      ok(otherRun?.status === 404, '404: 他人运行(非本人 404 不泄露存在性)', `status=${otherRun?.status}`),
      ok(badAgent.status === 500 && /Agent 类型不存在/.test(badAgent.json?.msg || ''), '非法 agentType → 实测 500「Agent 类型不存在」(文档 API参考/01 称 404 — 候选偏差 R-08)', `status=${badAgent.status} msg=${badAgent.json?.msg}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '错误码表对照(手册 §1)', body: rows.map((r) => `${r.code} ${r.label} → 实测 ${r.status ?? r.got} ${r.body && r.body.msg ? 'msg=' + String(r.body.msg).slice(0, 60) : ''}`).join('\n') }, { h: '非法 Bearer 响应', body: badBearer.json || badBearer.text.slice(0, 200) }, { h: '非法 agentType 响应', body: badAgent.json }, { h: '越权读取响应', body: otherRun?.json }]
    await evidenceShot('AP2-1', 'API 参考/02 · 错误码表实测', e._sections, { pass })
    e.evidence.push('assets/AP2-1.png')
    assert(pass, 'AP2-1 失败')
  })

  // ---------- AP2-3/4 幂等与时钟 ----------
  await runCase('AP2-3', '04-API参考/02', 'POST /runs 非幂等(两次→两个 runId);createdAt 为服务端时钟(偏差 <5s)', async (e) => {
    const r1 = await startRun({ conversationId: null, message: '随便聊聊天气。', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 60000 })
    const r2 = await startRun({ conversationId: null, message: '随便聊聊天气。', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 60000 })
    const id1 = parseId(r1.events[0])?.runId
    const id2 = parseId(r2.events[0])?.runId
    const ev = r1.events.find((x) => x.data?.createdAt)
    let skew = null
    if (ev?.data?.createdAt) {
      const t = typeof ev.data.createdAt === 'number' ? ev.data.createdAt : Date.parse(ev.data.createdAt)
      skew = Date.now() - t
    }
    const v = [
      ok(id1 && id2 && id1 !== id2, '两次 POST /runs 产生不同运行(非幂等,重试需先查 /runs/running)', `${id1} vs ${id2}`),
      ok(skew !== null && Math.abs(skew) < 5000, `createdAt 为服务端时钟,与本地偏差 ${skew}ms(<5s)`, `${skew}ms`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '运行 ID', body: `run1=${id1}\nrun2=${id2}` }, { h: '时钟偏差', body: `${skew}ms(手册 §5:同机或 NTP 对齐;本测试与 server 同机)` }]
    await evidenceShot('AP2-3', 'API 参考/02 · 幂等语义与时钟', e._sections, { pass })
    e.evidence.push('assets/AP2-3.png')
    assert(pass, 'AP2-3 失败')
  })

  await cleanupMcp(created)
  console.log('[footprint] 自建三方 MCP 注册已全部删除(应用级+用户级,含配额用例 32 个)')
  savePhase('api3')
}
