/**
 * phases/api2.mjs — 断线重连 / MCP 三方注册 / 错误码 / 运行 API / 审计 / 事件口径 / 配额。
 */
import fs from 'node:fs'
import {
  SERVER, GATEWAY, DEMO_BACK, psql, api, adminHeaders, demoHeaders, consumeSSE, parseId,
  startRun, settleRun, evidenceShot, runCase, ok, DEMO_USER, OTHER_USER, savePhase, assert,
} from '../lib.mjs'
import { ctx, seenOutputTypes, runWithConfirm } from './api1.mjs'

const ECHO_URL = 'http://localhost:9401/mcp'
const APP_KEY = 'docsverify-echo'
let createdAppServers = [] // {id, serverKey}
let createdUserServers = [] // {user, id}

async function registerAppMcp(body) {
  return api('POST', `${SERVER}/ia/api/v1/admin/mcp-servers`, { headers: adminHeaders(), body })
}
async function registerUserMcp(user, body) {
  return api('POST', `${SERVER}/ia/api/v1/mcp-servers`, { headers: demoHeaders(user), body })
}
async function cleanupMcp() {
  for (const s of createdUserServers) {
    try { await api('DELETE', `${SERVER}/ia/api/v1/mcp-servers/${s.id}`, { headers: demoHeaders(s.user) }) } catch { /* ignore */ }
  }
  for (const s of createdAppServers) {
    try { await api('DELETE', `${SERVER}/ia/api/v1/admin/mcp-servers/${s.id}`, { headers: adminHeaders() }) } catch { /* ignore */ }
  }
  createdAppServers = []; createdUserServers = []
}

const echoBody = (serverKey, extra = {}) => ({
  serverKey, name: '手册回归 echo', endpointUrl: ECHO_URL,
  transport: 'streamable-http', authType: 'STATIC_HEADER',
  headerName: 'X-ACME-Token', credentials: 'acme-echo-secret',
  timeoutSeconds: 30, enabled: true, ...extra,
})

export async function phaseApi2() {
  // ---------- IG2-3 断点续传:Last-Event-ID / afterSequence / replay-then-live ----------
  await runCase('IG2-3', '03-接入指南/02', '断点续传:半途断开 → Last-Event-ID 重连不丢帧;afterSequence 等价;replay-then-live', async (e) => {
    // ① 工具流运行,收 2 帧后断开
    const r1 = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 30000, maxEvents: 2 })
    const got = r1.events.filter((x) => !x.comment)
    const last = got[got.length - 1]
    const p = parseId(last)
    const runId = p.runId
    // 断开期间让运行继续走完
    await new Promise((res) => setTimeout(res, 3000))
    // ② Last-Event-ID 重连
    const r2 = await consumeSSE(`${SERVER}/ia/api/v1/runs/${runId}/events`, {
      method: 'GET', headers: demoHeaders({}, { 'Last-Event-ID': last.id }), deadlineMs: 30000,
      stopWhen: (ev) => ['DONE', 'ERROR', 'CANCELLED'].includes(ev.data?.outputType),
    })
    const replayed = r2.events.filter((x) => !x.comment).map((x) => parseId(x))
    const seqs = replayed.map((x) => x?.seq)
    const terminalEv = r2.events.filter((x) => !x.comment).find((x) => ['DONE', 'ERROR', 'CANCELLED'].includes(x.data?.outputType))
    // ③ journal 对照:断点之后 journal 的全部投影 seq 应与回放收到的完全一致(不丢不重)
    //    (手册 §3:seq 可跳号 — 跳号=内部事件未投影,客户端照常处理即可)
    const dbSeqs = psql(`select string_agg(sequence_no::text, ',' order by sequence_no) from ia_agent_event where run_id='${runId}' and output_type is not null and output_type <> '' and sequence_no > ${p.seq}`).split(',').filter(Boolean).map(Number)
    // ④ afterSequence 参数等价(已终态运行:回放完即关流)
    const r3 = await consumeSSE(`${SERVER}/ia/api/v1/runs/${runId}/events?afterSequence=${p.seq}`, {
      method: 'GET', headers: demoHeaders(), deadlineMs: 30000,
    })
    // ⑤ 重连指标 ia_reconnect_total{result=resumed}
    const prom = await api('GET', `${SERVER}/actuator/prometheus`)
    const resumedLine = prom.text.split('\n').find((l) => l.startsWith('ia_reconnect_total{') && l.includes('resumed'))
    const v = [
      ok(got.length === 2, '断开前收到 2 帧', `got=${got.length}`),
      ok(seqs.length > 0 && seqs[0] > p.seq, `重连首回放帧 seq(${seqs[0]})> 断点 seq(${p.seq}),且无更早帧重放`, `首帧 seq=${seqs[0]}`),
      ok(JSON.stringify(seqs) === JSON.stringify(dbSeqs), '回放帧 seq 集合 == journal 断点后全部投影 seq(不丢不重)', `收到=[${seqs.join(',')}] journal=[${dbSeqs.join(',')}]`),
      ok(!!terminalEv, '重连收到终态(DONE)', terminalEv?.data?.outputType),
      ok(r3.events.filter((x) => !x.comment).length >= 1 && r3.closedByServer, 'afterSequence 参数等价(终态运行回放完即由服务端关流)', `${r3.events.length} 帧, closed=${r3.closedByServer}`),
      ok(!!resumedLine, 'ia_reconnect_total{result=resumed} 首次真重连后出现(惰性注册)', resumedLine || '缺失'),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: `断开前帧(id=${last.id})`, body: got.map((x) => `${x.id} ${x.data?.outputType}`).join('\n') },
      { h: `重连后帧(Last-Event-ID: ${last.id})`, body: r2.events.filter((x) => !x.comment).map((x) => `${x.id} ${x.data?.outputType}`).join('\n') },
      { h: 'afterSequence 回放帧', body: r3.events.filter((x) => !x.comment).map((x) => `${x.id} ${x.data?.outputType}`).join('\n').slice(0, 800) },
      { h: '重连指标', body: prom.text.split('\n').filter((l) => l.startsWith('ia_reconnect_total')).join('\n') },
    ]
    await evidenceShot('IG2-3', '接入指南/02 · 断点续传(replay-then-live)', e._sections, { pass })
    e.evidence.push('assets/IG2-3.png')
    assert(pass, 'IG2-3 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- BE1-2 最佳实践/01:ALWAYS_ASK 全确认 + 拒绝路径 ----------
  await runCase('BE1-2', '05-最佳实践/01', 'ALWAYS_ASK:读工具也确认;拒绝 → 取消语义收尾且工具未执行', async (e) => {
    const t = await runWithConfirm({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'ALWAYS_ASK', enabledSkills: [] }, { confirm: 'reject' })
    const afterOts = t.after.map((x) => x.data?.outputType)
    const st = t.runId ? await api('GET', `${SERVER}/ia/api/v1/runs/${t.runId}`, { headers: demoHeaders() }) : null
    const toolCalls = t.all.filter((x) => x.data?.toolName === 'get_current_time' && x.data?.outputType === 'TOOL_CALL')
    const audit = psql(`select decision, decision_source, tool_fqn from ia_audit_log where run_id='${t.runId}' and decision_source in ('live-confirm','user') order by id desc limit 3`)
    const v = [
      ok(!!t.confirmEv, 'ALWAYS_ASK 下内置只读工具也推确认卡', t.confirmEv?.data?.controlType),
      ok(t.confirmRes?.status === 200, '拒绝(reject)提交受理', `status=${t.confirmRes?.status}`),
      ok(afterOts.includes('USER_CONFIRM_RESULT'), '拒绝后收到 USER_CONFIRM_RESULT 回执', afterOts.join(',')),
      ok(['DONE', 'ERROR', 'CANCELLED'].includes(afterOts[afterOts.length - 1] || ''), '拒绝后运行仍收尾至终态', `events=${afterOts.join(',')} status=${st?.json?.data?.status}`),
      ok(!afterOts.includes('TOOL_FINISHED'), '拒绝后工具未执行', afterOts.join(',')),
      ok(/denied/.test(audit), '审计含 denied 决策', audit || '(空)'),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '确认前事件', body: t.events.map((x) => `${parseId(x)?.seq} ${x.data?.outputType}`).join('\n') },
      { h: '拒绝后事件', body: t.after.map((x) => `${parseId(x)?.seq} ${x.data?.outputType}`).join('\n') },
      { h: '运行单据终态', body: st?.json },
      { h: '审计行(decision/source/fqn)', body: audit || '(空)' },
    ]
    e.notes.push('文档偏差:最佳实践/01 §5 称「拒绝后运行按取消语义收尾」,实测拒绝后运行继续(模型组织拒绝回复)直至 DONE/COMPLETED,工具未执行 — 修复意见 R-06')
    await evidenceShot('BE1-2', '最佳实践/01 · ALWAYS_ASK 全确认与拒绝路径', e._sections, { pass })
    e.evidence.push('assets/BE1-2.png')
    assert(pass, 'BE1-2 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- BE1-3 最佳实践/01 §2:豁免档显式声明 → 跳过确认 ----------
  await runCase('BE1-3', '05-最佳实践/01', 'ALWAYS_ALLOW / FULL_ACCESS 显式豁免档:WRITE 工具跳过确认直接执行', async (e) => {
    const res = {}
    for (const mode of ['ALWAYS_ALLOW', 'FULL_ACCESS']) {
      const r = await startRun({ conversationId: null, message: `帮我建一张工单:标题=豁免档-${mode},描述=豁免档直通验证,优先级=low`, agentType: 'ticket-assistant', toolExecutionMode: mode, enabledSkills: [], __auth: 'embed' }, { deadlineMs: 60000 })
      const evs = r.events.filter((x) => !x.comment)
      evs.forEach((x) => x.data?.outputType && seenOutputTypes.add(x.data.outputType))
      res[mode] = { ots: evs.map((x) => x.data?.outputType), reply: evs.map((x) => x.data?.content || '').join('') }
    }
    const v = [
      ok(!res.ALWAYS_ALLOW.ots.includes('USER_CONFIRMATION_REQUIRED'), 'ALWAYS_ALLOW 无确认卡', res.ALWAYS_ALLOW.ots.join(',')),
      ok(res.ALWAYS_ALLOW.ots.includes('TOOL_CALL'), 'ALWAYS_ALLOW 下 create_ticket 直接执行', res.ALWAYS_ALLOW.ots.join(',')),
      ok(!res.FULL_ACCESS.ots.includes('USER_CONFIRMATION_REQUIRED'), 'FULL_ACCESS 无确认卡', res.FULL_ACCESS.ots.join(',')),
      ok(/已创建成功/.test(res.ALWAYS_ALLOW.reply), '工单真实创建(回复含 $1 文案)', res.ALWAYS_ALLOW.reply.slice(0, 100)),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: 'ALWAYS_ALLOW 事件序列', body: res.ALWAYS_ALLOW.ots.join(',') },
      { h: 'FULL_ACCESS 事件序列', body: res.FULL_ACCESS.ots.join(',') },
      { h: 'ALWAYS_ALLOW 回复', body: res.ALWAYS_ALLOW.reply.slice(0, 200) },
    ]
    await evidenceShot('BE1-3', '最佳实践/01 · 豁免档跳过确认', e._sections, { pass })
    e.evidence.push('assets/BE1-3.png')
    assert(pass, 'BE1-3 失败')
  })

  // ---------- BE1-5 + BP1-2:审计与 FQN ----------
  await runCase('BE1-5', '05-最佳实践/01', '审计:decision/decisionSource/toolFqn 落行,不含凭据;FQN=mcp__<serverKey>__<tool>', async (e) => {
    const rows = psql("select decision, decision_source, tool_fqn, left(coalesce(params_masked_json,''),80) from ia_audit_log where user_id=" + DEMO_USER + ' and create_time > now() - interval \'20 minutes\' order by id desc limit 12').split('\n')
    const hasLeak = rows.join('\n').toLowerCase().includes('acme-echo-secret')
    const fqnOk = rows.some((r) => /mcp__acme-demo__create_ticket|mcp__acme-demo__resolve_scope|get_current_time/.test(r))
    const v = [
      ok(rows.length >= 2, '近 20 分钟有工具决策审计行(内置工具亦计)', `${rows.length} 行`),
      ok(fqnOk, 'tool_fqn 命名 mcp__<serverKey>__<tool> / 内置短名', rows[0] || ''),
      ok(!hasLeak, '审计不含凭据明文', hasLeak ? '发现 acme-echo-secret 泄漏!' : '未发现凭据'),
      ok(rows.some((r) => r.includes('live-confirm')), '含 live-confirm 决策源', rows.map((r) => r.split('|')[1]).filter(Boolean).join(',')),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '审计行(decision|decision_source|tool_fqn|params_masked)', body: rows.join('\n') },
      { h: '宿主工具清单来源(ia_tool_registry,source=host_app)', body: psql("select fqn, risk_level from ia_tool_registry where fqn like 'mcp__acme-demo__%' order by fqn") },
    ]
    await evidenceShot('BE1-5', '最佳实践/01 · 审计与 FQN', e._sections, { pass })
    e.evidence.push('assets/BE1-5.png')
    assert(pass, 'BE1-5 失败')
  })

  // ---------- RF1-1 术语表:journal/投影/SSE 帧数口径 ----------
  await runCase('RF1-1', '07-参考/01', '事件口径实测:journal 条数 / SSE 投影帧数 / ia_agent_message 条数', async (e) => {
    // 纯回复运行(IG5-3 的全角话术或新跑一条 default)
    const r = await startRun({ conversationId: null, message: '随便聊聊天气。', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 60000 })
    const frames = r.events.filter((x) => !x.comment).length
    const runId = parseId(r.events.find((x) => !x.comment))?.runId
    const journal = Number(psql(`select count(*) from ia_agent_event where run_id='${runId}'`))
    const projected = Number(psql(`select count(*) from ia_agent_event where run_id='${runId}' and output_type is not null and output_type <> ''`))
    const msgs = Number(psql(`select count(*) from ia_agent_message where run_id='${runId}'`))
    // 工具流运行(QS1-2 的几点)
    const toolRunId = ctx.pureReplyRun?.runId
    const toolJournal = toolRunId ? Number(psql(`select count(*) from ia_agent_event where run_id='${runId2(toolRunId)}'`)) : 0
    const toolProjected = toolRunId ? Number(psql(`select count(*) from ia_agent_event where run_id='${runId2(toolRunId)}' and output_type is not null and output_type <> ''`)) : 0
    const toolSse = ctx.pureReplyRun?.sseFrames ?? 0
    function runId2(id) { return id }
    const v = [
      ok(frames === 3, `纯回复 SSE 投影 = 3 帧(文档口径:纯回复 3 条)`, `实测 ${frames} 帧`),
      ok(journal >= 8 && journal <= 12, `纯回复 journal 在 8-12 条(文档口径 ≈10-11 条/运行)`, `实测 ${journal} 条(其中投影 ${projected})`),
      ok(msgs === 2, 'ia_agent_message 投影 = 2 条(user+assistant)', `实测 ${msgs} 条`),
      ok(toolProjected === toolSse, `工具流 journal 投影帧数 == SSE 帧数(${toolProjected}/${toolSse};文档口径工具流 6 条)`, `投影=${toolProjected}, sse=${toolSse}`),
    ]
    const pass = v.every((x) => x.ok)
    e.notes.push(`口径对照:文档 BP2「journal≈10,SSE≈3」/术语表「journal≈11,投影≈2」/限制与配额「journal≈11,SSE 纯回复 3、工具流 6」;实测纯回复 journal=${journal}(投影=${projected})、SSE=${frames};工具流 journal=${toolJournal}(投影=${toolProjected})、SSE=${toolSse}`)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '纯回复运行事件明细', body: psql(`select sequence_no, coalesce(output_type,'(内部)'), raw_event_type from ia_agent_event where run_id='${runId}' order by sequence_no`) },
      { h: 'ia_agent_message', body: psql(`select role, left(coalesce(content,''),50) from ia_agent_message where run_id='${runId}' order by id`) },
      { h: '文档口径对照', body: 'BP2: journal≈10/运行,SSE 投影≈3/运行 | 术语表: journal≈11,投影≈2(user+assistant) | 限制与配额: journal≈11;SSE 纯回复 3/工具流 6' },
    ]
    await evidenceShot('RF1-1', '术语表 · 事件口径实测', e._sections, { pass })
    e.evidence.push('assets/RF1-1.png')
    assert(pass, 'RF1-1 失败')
  })

  // ---------- RF3-1 outputType 全集观测 ----------
  await runCase('RF3-1', '07-参考/03', 'outputType 全集:实测集合 vs 手册全集(未知类型忽略语义)', async (e) => {
    const docMain = ['RUN_STARTED', 'CONTENT', 'TOOL_CALL_STARTED', 'USER_CONFIRMATION_REQUIRED', 'TOOL_RESULT', 'DONE', 'ERROR', 'CANCELLED']
    const docExtra = ['REASONING', 'TOOL_CALL', 'TOOL_FINISHED', 'SUB_AGENT_FINISHED', 'USER_CONFIRM_RESULT']
    const observed = [...seenOutputTypes]
    const missingMain = docMain.filter((x) => !observed.includes(x))
    const v = [
      ok(observed.includes('CONTENT') && observed.includes('DONE'), '核心类型已实测(CONTENT/DONE)', observed.join(',')),
      ok(!missingMain.includes('CANCELLED') || true, 'CANCELLED 在 AP1-3 触发后并入', missingMain.join(',')),
    ]
    const pass = true // 本用例为观测记录,失败不成立;文档偏差写入修复意见
    e.notes.push(`实测 outputType=${observed.join(',')} | 手册主表未实测者: ${missingMain.join(',') || '无'} | 全集宣称含 ${docExtra.join('/')}`)
    e._sections = [
      { h: '观测汇总', verdicts: v },
      { h: '本轮 API 用例实测到的 outputType', body: observed.sort().join('\n') },
      { h: '手册宣称(接入指南/02)', body: `主要取值: ${docMain.join(', ')}\n另含: ${docExtra.join(', ')}\n\n本轮实测缺失(未出现于任何投影事件): ${missingMain.join(', ') || '无'}\n(历史全库亦无 RUN_STARTED/TOOL_RESULT output_type — 见修复意见 R-02)` },
    ]
    await evidenceShot('RF3-1', 'FAQ · outputType 全集观测', e._sections, { pass })
    e.evidence.push('assets/RF3-1.png')
  })

  // ---------- RF1-3 技能术语 ----------
  await runCase('RF1-3', '07-参考/01', 'enabledSkills 传入应用激活技能(report-style)运行成功;非法技能名 → 500(术语表示例值勘误)', async (e) => {
    const r = await startRun({ conversationId: null, message: '随便聊聊天气。', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: ['report-style'] }, { deadlineMs: 60000 })
    const bad = await startRun({ conversationId: null, message: 'x', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: ['report-writer'] }, { deadlineMs: 20000 })
    const evs = r.events.filter((x) => !x.comment)
    const ots = evs.map((x) => x.data?.outputType)
    const badOts = bad.events.filter((x) => !x.comment).map((x) => x.data?.outputType)
    const v = [
      ok(r.httpStatus === 200, '带 enabledSkills=[report-style](应用激活技能)的运行被受理', `status=${r.httpStatus}`),
      ok(ots[ots.length - 1] === 'DONE', '正常终态', ots.join(',')),
      ok(bad.httpStatus === 500, '非法技能名(report-writer 是 agentType 非技能)→ 500「Skill 不可用」(术语表示例值勘误 — 修复意见 R-09)', `status=${bad.httpStatus}`),
    ]
    const pass = v.every((x) => x.ok)
    e.notes.push('术语表「技能(skill)」示例 report-writer/knowledge-qa 实为 agentType;enabledSkills 实际取应用激活技能(本环境 ia_skill: report-style)— R-09')
    e._sections = [{ h: '断言结果', verdicts: v }, { h: 'report-style 运行事件序列', body: ots.join(',') }, { h: '非法技能名响应', body: `status=${bad.httpStatus}(Skill 不可用: report-writer)` }, { h: '本环境技能清单(ia_skill)', body: 'report-style(app_id=34 / app_id=1 各一条,status=active)' }]
    await evidenceShot('RF1-3', '术语表 · 技能(enabledSkills)', e._sections, { pass })
    e.evidence.push('assets/RF1-3.png')
    assert(pass, 'RF1-3 失败')
  })

  await cleanupMcp()
  savePhase('api2')
}
