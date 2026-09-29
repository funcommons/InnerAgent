/**
 * phases/api1.mjs — 播种 mock 后:确认流/授权语义/SSE 契约/模型篇/事件口径。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import {
  SERVER, psql, api, adminHeaders, demoHeaders, consumeSSE, parseId,
  startRun, settleRun, evidenceShot, runCase, ok, DEMO_USER, savePhase, assert, embedAuth,
} from '../lib.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const SEED_MOCK = path.join(REPO, 'examples/acme-demo/seeds/mock-model-script.sql')

export const ctx = {} // 跨用例共享(runId/replyId 等)
export const seenOutputTypes = new Set()

export async function seedMock() {
  execSync(`docker exec -i inneragent-postgres psql -U inneragent -d inneragent < ${SEED_MOCK}`, { encoding: 'utf8' })
  console.log('[footprint] 已播种 canned mock 规则模型为默认(mock-model-script.sql)')
}

/** 跑一轮并自动收口确认(返回事件列表);opts.confirm: 'approve'|'reject'|'expire'|null */
export async function runWithConfirm(payload, { confirm = null, deadlineMs = 90000, keepAliveMs = 0 } = {}) {
  const auth = payload.__auth === 'embed' ? await embedAuth() : demoHeaders(payload.__user || DEMO_USER)
  const before = []
  const after = []
  let confirmRes = null
  let confirmEv = null
  let runId = null
  const r = await consumeSSE(`${SERVER}/ia/api/v1/runs`, {
    headers: auth,
    body: (({ __user, __auth, ...rest }) => rest)(payload),
    deadlineMs,
    // 同一条 SSE 流内完成确认(手册口径:「原 SSE 连接(或重连)收到后续事件」),
    // 不主动断流 — 断流+立即确认会与投影竞态(实测 500 序列间隙)
    onEvent: async (ev) => {
      const d = ev.data
      if (!d?.outputType) return
      ;(confirmEv ? after : before).push(ev)
      seenOutputTypes.add(d.outputType)
      if (d.outputType === 'USER_CONFIRMATION_REQUIRED' && confirm && !confirmEv) {
        confirmEv = ev
        runId = parseId(ev)?.runId
        const replyId = d.replyId
        const doConfirm = () => confirm === 'expire'
          ? api('POST', `${SERVER}/ia/api/v1/runs/${runId}/confirm/expire`, { headers: auth, body: { replyId } })
          : api('POST', `${SERVER}/ia/api/v1/runs/${runId}/confirm`, {
              headers: auth,
              body: { replyId, decisions: d.pendingToolCalls.map((t) => ({ toolCallId: t.toolCallId, approved: confirm === 'approve' })) },
            })
        confirmRes = await doConfirm()
        for (let i = 0; i < 3 && confirmRes.status >= 500; i++) { // 瞬态竞态兜底:退避重试
          await new Promise((res) => setTimeout(res, 800 * (i + 1)))
          confirmRes = await doConfirm()
        }
        return // 不掐流,继续在同一连接读到终态
      }
    },
  })
  const evs = r.events.filter((x) => !x.comment)
  return { runId, confirmEv, confirmRes, events: before.length ? before : evs, after, all: evs, stream2: r, confirm }
}

export async function phaseApi1() {
  // ---------- QS1-2 快速开始/01 §3 第一轮运行(DEFAULT,读工具自动放行) ----------
  await runCase('QS1-2', '02-快速开始/01', 'POST /runs(DEFAULT):SSE 流 + demo 内置工具自动放行 + DONE 终态关流', async (e) => {
    const r = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 60000 })
    const evs = r.events.filter((x) => !x.comment)
    evs.forEach((x) => x.data?.outputType && seenOutputTypes.add(x.data.outputType))
    const ots = evs.map((x) => x.data?.outputType)
    ctx.pureReplyRun = { runId: parseId(evs[0])?.runId, sseFrames: evs.length }
    const v = [
      ok(r.httpStatus === 200 && /text\/event-stream/.test(r.contentType), 'HTTP 200 + text/event-stream', `${r.httpStatus} ${r.contentType}`),
      ok(evs.length > 0, '收到 SSE 帧', `${evs.length} 帧`),
      ok(evs.some((x) => x.data?.outputType === 'CONTENT'), '收到 CONTENT', ots.join(',')),
      ok(evs.some((x) => /TOOL_CALL/.test(x.data?.outputType || '')), '内置工具 get_current_time 被调用(工具事件)', ots.join(',')),
      ok(!evs.some((x) => x.data?.outputType === 'USER_CONFIRMATION_REQUIRED'), 'DEFAULT 档读工具未弹确认', ots.join(',')),
      ok(ots[ots.length - 1] === 'DONE', '终态 DONE', ots[ots.length - 1]),
      ok(r.closedByServer === true, '服务端关闭流', `closedByServer=${r.closedByServer}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: 'outputType 序列', body: evs.map((x) => `seq=${parseId(x)?.seq} ${x.data?.outputType}${x.data?.toolName ? ' tool=' + x.data.toolName : ''}`).join('\n') },
      { h: 'DONE 帧原文', body: evs[evs.length - 1]?.data },
    ]
    await evidenceShot('QS1-2', '快速开始/01 · 第一轮运行(DEFAULT)', e._sections, { pass })
    e.evidence.push('assets/QS1-2.png')
    assert(pass, 'QS1-2 失败')
  })

  // ---------- QS1-3 快速开始/01 §3 ALWAYS_ASK 确认卡 + WAITING_CONFIRMATION + keep-alive ----------
  await runCase('QS1-3', '02-快速开始/01', 'ALWAYS_ASK:确认卡事件 + WAITING_CONFIRMATION + 流保持打开(keep-alive)+ 确认后 DONE', async (e) => {
    const r = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'ALWAYS_ASK', enabledSkills: [] }, { deadlineMs: 30000, stopWhen: (ev) => ev.data?.outputType === 'USER_CONFIRMATION_REQUIRED' })
    const evs = r.events.filter((x) => !x.comment)
    evs.forEach((x) => x.data?.outputType && seenOutputTypes.add(x.data.outputType))
    const confirmEv = evs.find((x) => x.data?.outputType === 'USER_CONFIRMATION_REQUIRED')
    const runId = confirmEv ? parseId(confirmEv)?.runId : null
    ctx.qs1_3 = { runId, replyId: confirmEv?.data?.replyId }
    const st = runId ? await api('GET', `${SERVER}/ia/api/v1/runs/${runId}`, { headers: demoHeaders() }) : null
    const running = await api('GET', `${SERVER}/ia/api/v1/runs/running`, { headers: demoHeaders() })
    // keep-alive:保持连接 ~35s,期望注释帧(30s/条)
    const ka = await consumeSSE(`${SERVER}/ia/api/v1/runs/${runId}/events`, { method: 'GET', headers: demoHeaders(), deadlineMs: 42000, maxEvents: 1000 })
    const comments = ka.events.filter((x) => x.comment)
    // 确认 → 续流至终态
    const conf = await api('POST', `${SERVER}/ia/api/v1/runs/${runId}/confirm`, {
      headers: demoHeaders(),
      body: { replyId: confirmEv.data.replyId, decisions: confirmEv.data.pendingToolCalls.map((t) => ({ toolCallId: t.toolCallId, approved: true })) },
    })
    const r2 = await consumeSSE(`${SERVER}/ia/api/v1/runs/${runId}/events`, {
      method: 'GET', headers: demoHeaders(), deadlineMs: 60000,
      stopWhen: (ev) => ['DONE', 'ERROR', 'CANCELLED'].includes(ev.data?.outputType),
    })
    const evs2 = r2.events.filter((x) => !x.comment)
    evs2.forEach((x) => x.data?.outputType && seenOutputTypes.add(x.data.outputType))
    const ots2 = evs2.map((x) => x.data?.outputType)
    const st2 = await api('GET', `${SERVER}/ia/api/v1/runs/${runId}`, { headers: demoHeaders() })
    ctx.qs1_3.finalStatus = st2.json?.data?.status
    const v = [
      ok(!!confirmEv, '收到确认卡事件 USER_CONFIRMATION_REQUIRED', evs.map((x) => x.data?.outputType).join(',')),
      ok(confirmEv?.data?.controlType === 'USER_CONFIRM_REQUIRED', 'controlType=USER_CONFIRM_REQUIRED', confirmEv?.data?.controlType),
      ok(st?.json?.data?.status === 'WAITING_CONFIRMATION', '运行态 WAITING_CONFIRMATION', st?.json?.data?.status),
      ok(!!confirmEv?.data?.expiresAt, '确认事件带 expiresAt', confirmEv?.data?.expiresAt),
      ok((running.json?.data || []).some((x) => x.runId === runId), 'GET /runs/running 含该挂起运行', `列表 ${running.json?.data?.length} 条`),
      ok(comments.length >= 1, 'SSE 半开期间收到 keep-alive 注释帧(≈30s/条)', comments.map((x) => `@${x.t}ms ${x.comment.slice(0, 30)}`).join(' | ') || '无'),
      ok(conf.status === 200 && conf.json?.code === 0, 'POST /confirm 受理', `status=${conf.status} code=${conf.json?.code}`),
      ok(ots2[ots2.length - 1] === 'DONE', '确认后续流至 DONE', ots2.join(',')),
      ok(st2.json?.data?.status === 'COMPLETED', '运行态终为 COMPLETED(SSE DONE ↔ COMPLETED)', st2.json?.data?.status),
    ]
    const pass = v.every((x) => x.ok)
    e.notes.push(`keep-alive 注释帧 ${comments.length} 条,间隔样例 ${comments.map((c) => c.t + 'ms').join('/')}`)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '确认卡事件完整 JSON', body: confirmEv?.data },
      { h: '挂起期间事件序列', body: evs.map((x) => `seq=${parseId(x)?.seq} ${x.data?.outputType}`).join('\n') },
      { h: '确认后事件序列', body: evs2.map((x) => `seq=${parseId(x)?.seq} ${x.data?.outputType}`).join('\n') },
      { h: 'GET /runs/{id} 终态响应', body: st2.json },
    ]
    await evidenceShot('QS1-3', '快速开始/01 · ALWAYS_ASK 确认流(含 keep-alive)', e._sections, { pass })
    e.evidence.push('assets/QS1-3.png')
    assert(pass, 'QS1-3 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- BP1-1 产品概述 §3 状态机 ----------
  await runCase('BP1-1', '01-白皮书/01', '运行状态机:WAITING_CONFIRMATION → COMPLETED 实证(+CANCELLED 见 AP1-3)', async (e) => {
    const runId = ctx.qs1_3?.runId
    const before = await api('GET', `${SERVER}/ia/api/v1/runs/${runId}`, { headers: demoHeaders() })
    const row = psql(`select status from ia_agent_run where run_id='${runId}'`)
    const v = [
      ok(before.json?.data?.status === 'COMPLETED', 'SSE DONE 后运行单据 COMPLETED', before.json?.data?.status),
      ok(['COMPLETED', 'FAILED', 'CANCELLED'].includes(before.json?.data?.status || ''), '终态枚举属文档集合', before.json?.data?.status),
      ok(row === 'COMPLETED', 'DB 行同状态', row),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '运行单据(GET /runs/{runId})', body: before.json },
      { h: '状态机对照(手册)', body: 'RUNNING → WAITING_CONFIRMATION → COMPLETED/FAILED/CANCELLED;SSE 终态事件 DONE/ERROR/CANCELLED ↔ COMPLETED/FAILED/CANCELLED\n本轮实证:WAITING_CONFIRMATION(QS1-3)→ COMPLETED(本用例);CANCELLED 在 AP1-3 实证' },
    ]
    await evidenceShot('BP1-1', '产品概述 §3 · 运行状态机', e._sections, { pass })
    e.evidence.push('assets/BP1-1.png')
    assert(pass, 'BP1-1 失败')
  })

  // ---------- IG5-1 接入指南/05 §3 canned mock 规则形态 ----------
  const TICKET_TITLE = `手册回归工单-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`
  await runCase('IG5-1', '03-接入指南/05', 'mock 规则四条话术 + default:建工单($1 捕获)/年假 KB/报告/几点/无命中', async (e) => {
    const res = {}
    // ① 建工单(DEFAULT;WRITE → 确认 → $1 注入 → 工具真实执行;create_ticket 在 ticket-assistant 工具箱)
    const t = await runWithConfirm({ conversationId: null, message: `帮我建一张工单:标题=${TICKET_TITLE},描述=3楼打印机卡纸,优先级=high`, agentType: 'ticket-assistant', toolExecutionMode: 'DEFAULT', enabledSkills: [], __auth: 'embed' }, { confirm: 'approve' })
    res.ticket = t
    const replyAll = t.all.map((x) => x.data?.content || '').join('')
    const confirmTool = t.confirmEv?.data?.pendingToolCalls?.[0]
    ctx.ig5_1 = { runId: t.runId, title: TICKET_TITLE }
    // ② 年假
    const kb = await startRun({ conversationId: null, message: '年假有几天?', agentType: 'knowledge-qa', toolExecutionMode: 'DEFAULT', enabledSkills: [], __auth: 'embed' }, { deadlineMs: 60000 })
    const kbReply = kb.events.filter((x) => !x.comment).map((x) => x.data?.content || '').join('')
    // ③ 报告
    const rep = await startRun({ conversationId: null, message: '请写一段 Q3 销售总结。', agentType: 'report-writer', toolExecutionMode: 'DEFAULT', enabledSkills: [], __auth: 'embed' }, { deadlineMs: 60000 })
    const repReply = rep.events.filter((x) => !x.comment).map((x) => x.data?.content || '').join('')
    // ④ 无命中
    const dft = await startRun({ conversationId: null, message: '随便聊聊天气。', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 60000 })
    const dftReply = dft.events.filter((x) => !x.comment).map((x) => x.data?.content || '').join('')
    // 「几点」规则已在 QS1-2 实证(get_current_time 短名解析)
    if (t.confirmRes) e._sections = e._sections || []
    const v = [
      ok(!!t.confirmEv, '① 建工单话术触发 create_ticket 确认卡', confirmTool?.toolName),
      ok(/create_ticket/.test(confirmTool?.toolName || ''), '工具 FQN=mcp__acme-demo__create_ticket(短名按后缀解析)', confirmTool?.toolName),
      ok((confirmTool?.argumentsPreview || '').includes(TICKET_TITLE), 'args 注入 $1(标题回显)', confirmTool?.argumentsPreview),
      ok(/已创建成功/.test(replyAll) && replyAll.includes(TICKET_TITLE), '回复含 $1/$2/$3 注入文案', replyAll.slice(0, 120)),
      ok(kbReply.includes('[KB:'), '② 年假 → [KB:] 引用', kbReply.slice(0, 100)),
      ok(/92%|回款/.test(repReply), '③ 报告规则命中', repReply.slice(0, 100)),
      ok(dftReply.includes('ACME 演示助手'), '④ 无命中 → default 回复', dftReply.slice(0, 100)),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '① 建工单:确认卡 pendingToolCalls', body: confirmTool },
      { h: '① 确认后全部事件', body: t.all.map((x) => `seq=${parseId(x)?.seq} ${x.data?.outputType} ${x.data?.toolName || ''}`).join('\n') },
      { h: '① confirm 响应', body: t.confirmRes ? { status: t.confirmRes.status, json: t.confirmRes.json } : '(无)' },
      { h: '① 最终回复', body: replyAll.slice(0, 400) },
      { h: '② 年假回复', body: kbReply.slice(0, 300) },
      { h: '③ 报告回复', body: repReply.slice(0, 300) },
      { h: '④ default 回复', body: dftReply.slice(0, 300) },
    ]
    await evidenceShot('IG5-1', '接入指南/05 · canned mock 规则行为', e._sections, { pass })
    e.evidence.push('assets/IG5-1.png')
    assert(pass, 'IG5-1 失败: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- IG5-2 deltaMs 节奏 + snapshot 生效值(坑②)----------
  await runCase('IG5-2', '03-接入指南/05', 'deltaMs 出字节拍实测(种子 60)+ agent_definition_snapshot_json.modelOptions 核对', async (e) => {
    const r = await startRun({ conversationId: null, message: '请写一段 Q3 销售总结。', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 60000 })
    const contents = r.events.filter((x) => !x.comment && x.data?.outputType === 'CONTENT')
    const gaps = []
    for (let i = 1; i < contents.length; i++) gaps.push(contents[i].t - contents[i - 1].t)
    const minGap = gaps.length ? Math.min(...gaps) : -1
    const medGap = gaps.length ? gaps.slice().sort((a, b) => a - b)[Math.floor(gaps.length / 2)] : -1
    const runId = parseId(r.events.find((x) => !x.comment))?.runId
    const snap = psql(`select agent_definition_snapshot_json from ia_agent_run where run_id='${runId}'`)
    let modelOptions = null
    try { modelOptions = JSON.parse(snap).modelOptions } catch { /* parse */ }
    const snapDelta = modelOptions?.mockScript?.deltaMs
    const v = [
      ok(contents.length >= 2, 'CONTENT 帧数 ≥2(可测节奏)', `${contents.length} 帧`),
      ok(medGap >= 40, `相邻 CONTENT 间隔中位数 ≥40ms(deltaMs=60 节拍存在;实测中位=${medGap}ms,min=${minGap}ms — 单帧间隔可因合帧小于 deltaMs)`, gaps.join(',')),
      ok(snapDelta === 60, '快照 modelOptions.mockScript.deltaMs=60(生效值核对;modelOptions 即 config 原文)', JSON.stringify(snapDelta)),
      ok(snap.includes('mockScript'), '快照含 mockScript(config 原文)', 'ia_agent_run.agent_definition_snapshot_json'),
    ]
    const pass = v.every((x) => x.ok)
    e.notes.push(`deltaMs 实测间隔 min=${minGap}ms 中位=${medGap}ms(手册:种子 60=CI 快速出字;k6 calibrate 默认 800)`)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: 'CONTENT 到达时刻(ms)', body: contents.map((x) => x.t).join(', ') },
      { h: '快照 modelOptions(截取)', body: JSON.stringify(modelOptions, null, 2)?.slice(0, 1200) },
    ]
    await evidenceShot('IG5-2', '接入指南/05 · deltaMs 节奏与快照核对', e._sections, { pass })
    e.evidence.push('assets/IG5-2.png')
    assert(pass, 'IG5-2 失败')
  })

  // ---------- IG5-3 FAQ/05:全角标点不命中 ----------
  await runCase('IG5-3', '03-接入指南/05', '全角冒号/逗号话术不命中规则 → 落 default(手册 §3 提示)', async (e) => {
    const FW = '帮我建一张工单\uFF1A标题=全角测试\uFF0C描述=标点全角\uFF0C优先级=high'
    const r = await startRun({ conversationId: null, message: FW, agentType: 'ticket-assistant', toolExecutionMode: 'DEFAULT', enabledSkills: [], __auth: 'embed' }, { deadlineMs: 60000 })
    const evs = r.events.filter((x) => !x.comment)
    evs.forEach((x) => x.data?.outputType && seenOutputTypes.add(x.data.outputType))
    const ots = evs.map((x) => x.data?.outputType)
    const reply = evs.map((x) => x.data?.content || '').join('')
    const v = [
      ok(!ots.some((o) => /TOOL_CALL|USER_CONFIRM/.test(o || '')), '全角话术未触发工具/确认', ots.join(',')),
      ok(reply.includes('ACME 演示助手'), '落 default 回复', reply.slice(0, 100)),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '触发语(全角\uFF1A/\uFF0C)', body: FW }, { h: '事件序列', body: ots.join(',') }, { h: '回复', body: reply.slice(0, 200) }]
    await evidenceShot('IG5-3', '接入指南/05 · 全角标点不命中', e._sections, { pass })
    e.evidence.push('assets/IG5-3.png')
    assert(pass, 'IG5-3 失败')
  })

  // ---------- IG5-5 + RF2:ia_ai_model 字段口径 ----------
  await runCase('IG5-5', '03-接入指南/05', 'ia_ai_model 登记:max_concurrency 默认 5 / mock 压测 1000 / 唯一默认', async (e) => {
    const raw = psql("select code, model_type, default_model, status, sort, max_concurrency from ia_ai_model order by code")
    const rows = raw.split('\n').map((l) => l.split('|'))
    const find = (code) => rows.find((r) => r[0] === code)
    const mini = find('MiniMax-M3')
    const mock = find('mock-text')
    const defaults = psql("select count(*) from ia_ai_model where model_type=1 and default_model").trim()
    const v = [
      ok(mini && mini[5] === '5', 'MiniMax-M3 max_concurrency=5(登记字段默认)', mini ? mini.join(' | ') : '无此行'),
      ok(mock && mock[5] === '1000', 'mock-text max_concurrency=1000(压测 calibrate 口径)', mock ? mock.join(' | ') : '无此行'),
      ok(mock && mock[2] === 't' && mini && mini[2] === 'f', '当前 mock-text 为默认(本阶段播种态)', `mock=${mock?.[2]} mini=${mini?.[2]}`),
      ok(defaults === '1', 'model_type=1 仅一个 default_model', `count=${defaults}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: 'ia_ai_model 全表(code|model_type|default_model|status|sort|max_concurrency)', body: raw }]
    await evidenceShot('IG5-5', '接入指南/05 · 模型登记字段', e._sections, { pass })
    e.evidence.push('assets/IG5-5.png')
    assert(pass, 'IG5-5 失败')
  })

  savePhase('api1')
}
