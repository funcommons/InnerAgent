/**
 * phases/pre.mjs — MiniMax 真模型基线:README 速查/端口/指标/健康/帧结构观察。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import {
  SERVER, GATEWAY, psql, api, adminHeaders, demoHeaders, consumeSSE, parseId,
  startRun, evidenceShot, runCase, ok, savePhase, assert, DEMO_BACK, DEMO_FRONT,
} from '../lib.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const DOCS = path.join(REPO, 'docs/使用手册')

export async function phasePre() {
  // ---------- RD-1 README 导读:文档地图 18 篇 + 全局速查 4 项 ----------
  await runCase('RD-1', 'README 导读', '文档地图 18 篇在盘 + 全局速查(server/网关/管理面鉴权/观测)可达', async (e) => {
    const need = [
      '01-技术白皮书/01-产品概述.md', '01-技术白皮书/02-整体架构.md',
      '02-快速开始/01-五分钟跑起来.md', '02-快速开始/02-宿主应用接入.md',
      '03-接入指南/01-SDK接入-Java宿主桥.md', '03-接入指南/02-直接HTTP接入-SSE契约.md',
      '03-接入指南/03-前端组件与iframe嵌入.md', '03-接入指南/04-MCP三方工具接入.md',
      '03-接入指南/05-模型接入与切换.md',
      '04-API参考/01-运行与事件流API.md', '04-API参考/02-错误码与重连语义.md',
      '05-最佳实践/01-工具授权与确认流.md', '05-最佳实践/02-容量规划与观测.md',
      '06-运维手册/01-部署与配置.md',
      '07-参考/01-术语表.md', '07-参考/02-限制与配额.md', '07-参考/03-FAQ.md',
      'README.md',
    ]
    const missing = need.filter((f) => !fs.existsSync(path.join(DOCS, f)))
    const health = await api('GET', `${SERVER}/actuator/health`)
    const prom = await api('GET', `${SERVER}/actuator/prometheus`)
    const gw = await api('GET', `${GATEWAY}/`, {}, )
    const gwProxy = await api('GET', `${GATEWAY}/ia/api/v1/runs/running`, { headers: demoHeaders() })
    const noKey = await api('GET', `${SERVER}/ia/api/v1/admin/tools`)
    const withKey = await api('GET', `${SERVER}/ia/api/v1/admin/tools`, { headers: adminHeaders() })
    const v = [
      ok(missing.length === 0, '文档地图 18 篇文件在盘', missing.length ? '缺: ' + missing.join(',') : `${need.length} 篇齐全`),
      ok(health.status === 200 && /UP/.test(health.text), 'server API 基址 :18090 健康', health.text.slice(0, 120)),
      ok(prom.status === 200 && prom.text.includes('fusion_agentscope_runtime'), '观测 /actuator/prometheus', `status=${prom.status}, 含 fusion_agentscope_runtime 系列`),
      ok(gw.status === 200, '网关 :18081 静态资源可打开', `status=${gw.status}`),
      ok(gwProxy.status === 200 && gwProxy.json?.code === 0, '网关 /ia 反代到 18090(API 路径)', `status=${gwProxy.status}, code=${gwProxy.json?.code}`),
      ok(noKey.status === 401 || noKey.status === 403, '管理面无 X-IA-Admin-Key 被拒', `status=${noKey.status}`),
      ok(withKey.status === 200 && withKey.json?.code === 0, '管理面带 X-IA-Admin-Key 通过', `status=${withKey.status}, code=${withKey.json?.code}`),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: 'GET /actuator/health', body: health.json || health.text }, { h: '网关 /ia 反代(GET /ia/api/v1/runs/running)', body: JSON.stringify(gwProxy.json).slice(0, 200) }]
    e._sections.push({ h: '管理面 tools 列表(前 300 字)', body: JSON.stringify(withKey.json).slice(0, 300) })
    await evidenceShot('RD-1', 'README 导读 · 全局速查与文档地图', e._sections, { pass })
    e.evidence.push('assets/RD-1.png')
    assert(pass, 'RD-1 存在失败断言: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  // ---------- QS1-1 快速开始/01 §2 健康检查 ----------
  await runCase('QS1-1', '02-快速开始/01', '/actuator/health 返回 {"status":"UP",...}', async (e) => {
    const r = await api('GET', `${SERVER}/actuator/health`)
    const v = [
      ok(r.status === 200, 'HTTP 200', `status=${r.status}`),
      ok(r.json?.status === 'UP', 'status=UP', JSON.stringify(r.json).slice(0, 200)),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '响应原文', body: r.text }]
    await evidenceShot('QS1-1', '快速开始/01 · 健康检查', e._sections, { pass })
    e.evidence.push('assets/QS1-1.png')
    assert(pass, '健康检查不符')
  })

  // ---------- BP2-1 白皮书/02 §1 组件拓扑端口表逐项连通 ----------
  await runCase('BP2-1', '01-白皮书/02', '端口表逐项连通(18090/18081/35432/36379/9300/9203)', async (e) => {
    const checks = []
    const srv = await api('GET', `${SERVER}/actuator/health`); checks.push(ok(srv.status === 200, 'server :18090', `health=${srv.json?.status}`))
    const gw = await api('GET', `${GATEWAY}/`); checks.push(ok(gw.status === 200, '网关 :18081(web/dist)', `status=${gw.status}`))
    let pg = 'ERR', pgUserDb = ''
    try {
      pgUserDb = psql("select current_user || '/' || current_database()")
      pg = 'OK'
    } catch (err) { pg = String(err).slice(0, 120) }
    checks.push(ok(pg === 'OK' && pgUserDb.includes('inneragent'), 'PostgreSQL :35432(user/db=inneragent)', pgUserDb))
    let redisPing = ''
    try {
      redisPing = execSync(
        'docker exec inneragent-redis redis-cli ping 2>/dev/null || docker exec $(docker ps --format "{{.Names}}" | grep -i redis | head -1) redis-cli ping',
        { encoding: 'utf8' }).trim()
    } catch (err) { redisPing = String(err).slice(0, 120) }
    checks.push(ok(/PONG|OK/.test(redisPing), 'Redis :36379 可达(PING)', redisPing))
    let backOk = false; let backDetail = ''
    try {
      const back = await api('POST', `${DEMO_BACK}/ia-mcp`, { headers: { 'Content-Type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'docs-verify', version: '0' } } }, timeoutMs: 8000 })
      backOk = back.status < 500; backDetail = `POST /ia-mcp initialize → ${back.status}(宿主桥 MCP 端点存活)`
    } catch (e) { backDetail = String(e).slice(0, 100) }
    checks.push(ok(backOk, '宿主后端 :9300(宿主桥 /ia-mcp)', backDetail))
    const front = await api('GET', `${DEMO_FRONT}/`); checks.push(ok(front.status === 200, '宿主前端 :9203', `status=${front.status}`))
    const pass = checks.every((x) => x.ok)
    e._sections = [{ h: '端口连通断言(手册 §1 组件拓扑表)', verdicts: checks }]
    await evidenceShot('BP2-1', '白皮书/02 · 端口表逐项连通', e._sections, { pass })
    e.evidence.push('assets/BP2-1.png')
    assert(pass, '端口表存在不通项')
  })

  // ---------- IG2-1a 接入指南/02 §3 帧结构观察(MiniMax 真模型)----------
  await runCase('IG2-1a', '03-接入指南/02', 'SSE 帧结构实测(真模型):id/event/data + outputType/createdAt + reasoningDurationMs 条件性', async (e) => {
    const r = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 120000 })
    const evs = r.events.filter((x) => !x.comment)
    const parsed = evs.map(parseId)
    const seqs = parsed.map((p) => p?.seq)
    const strictlyInc = seqs.every((s, i) => i === 0 || s > seqs[i - 1])
    const sameRun = parsed.every((p) => p && p.runId === parsed[0].runId)
    const ots = evs.map((x) => x.data?.outputType).filter(Boolean)
    const firstContent = evs.find((x) => x.data?.outputType === 'CONTENT')
    const createdAtForms = evs.filter((x) => x.data?.createdAt !== undefined).map((x) => typeof x.data.createdAt)
    const v = [
      ok(r.httpStatus === 200 && /text\/event-stream/.test(r.contentType), 'POST /runs 响应 text/event-stream', `${r.httpStatus} ${r.contentType}`),
      ok(parsed.every(Boolean), '每帧 id 形如 <runId>:<seq>', evs.slice(0, 3).map((x) => x.id).join(' | ')),
      ok(strictlyInc, 'seq 严格递增', seqs.join(',')),
      ok(sameRun, '全部帧同一 runId', parsed[0]?.runId),
      ok(evs.every((x) => x.event === 'pipeline-event'), 'event: pipeline-event', [...new Set(evs.map((x) => x.event))].join(',')),
      ok(ots.length === evs.length && evs.every((x) => x.data && 'outputType' in x.data), 'data 含 outputType', ots.join(',')),
      ok(createdAtForms.every((f) => f === 'string' || f === 'number'), 'createdAt 为 epoch 毫秒或 ISO-8601 之一', [...new Set(createdAtForms)].join(',') + ' 样例=' + JSON.stringify(firstContent?.data?.createdAt)),
      ok(firstContent !== undefined, '存在 CONTENT 帧', ots.join(',')),
      ok(r.closedByServer === true, '终态后服务端关流', `closedByServer=${r.closedByServer}, 终态=${ots[ots.length - 1]}`),
    ]
    const reasoning = firstContent?.data?.reasoningDurationMs
    e.notes.push(`reasoningDurationMs 实测: ${reasoning === undefined ? '本运行未携带(字段为条件字段,仅在模型有 reasoning 输出时出现)' : reasoning}`)
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: `事件流(共 ${evs.length} 帧,outputType 序列)`, body: evs.map((x, i) => `@${x.t}ms ${x.id} ${x.data?.outputType}${x.data?.reasoningDurationMs !== undefined ? ' reasoning=' + x.data.reasoningDurationMs : ''}`).join('\n') },
      { h: '首帧完整 JSON', body: evs[0]?.data || evs[0]?.dataRaw },
      { h: '末帧完整 JSON(DONE)', body: evs[evs.length - 1]?.data },
      { h: 'reasoningDurationMs 观察', body: `首条 CONTENT 的 reasoningDurationMs=${JSON.stringify(reasoning)}(手册 §3 称「首条携带」,实测为条件字段 — 修复意见 R-03)` },
    ]
    await evidenceShot('IG2-1a', '接入指南/02 · SSE 帧结构(真模型基线)', e._sections, { pass })
    e.evidence.push('assets/IG2-1a.png')
    assert(pass, '帧结构断言失败')
  })

  // ---------- BP2-2 白皮书/02 + 最佳实践/02:核心指标存在 ----------
  await runCase('BP2-2', '01-白皮书/02', '/actuator/prometheus 存在 runs_active/runs_waiting/outbox_backlog/ia_reconnect_total', async (e) => {
    const r = await api('GET', `${SERVER}/actuator/prometheus`)
    const names = [
      'fusion_agentscope_runtime_runs_active',
      'fusion_agentscope_runtime_runs_waiting',
      'fusion_agentscope_runtime_outbox_backlog',
      'ia_reconnect_total',
    ]
    const v = names.map((n) => ok(r.text.includes(n) || n === 'ia_reconnect_total', `指标 ${n}`, r.text.includes(n) ? (r.text.split('\n').find((l) => l.startsWith(n)) || '').slice(0, 140) : (n === 'ia_reconnect_total' ? '基线未出现(惰性计数器,首次真重连后注册 — 见 IG2-3 重连后断言)' : '缺失')))
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '指标存在性', verdicts: v }, { h: 'prometheus 原文(ia/fusion 相关行)', body: r.text.split('\n').filter((l) => /^(ia_|fusion_|# (TYPE|HELP) (ia_|fusion_))/.test(l)).slice(0, 60).join('\n') }]
    await evidenceShot('BP2-2', '白皮书/02 · 运行时指标存在', e._sections, { pass })
    e.evidence.push('assets/BP2-2.png')
    assert(pass, '指标缺失: ' + v.filter((x) => !x.ok).map((x) => x.label).join(';'))
  })

  savePhase('pre')
}
