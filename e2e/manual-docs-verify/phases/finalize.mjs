/**
 * phases/finalize.mjs — 回切 MiniMax(手册 05-接入指南 §4 口径)+ 校验 + 合并 results.json。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { psql, api, evidenceShot, runCase, ok, DEMO_USER, SERVER, savePhase, assert } from '../lib.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..')
const SEED_RESTORE = path.join(REPO, 'examples/acme-demo/seeds/mock-model-restore.sql')
const STATE = path.join(REPO, 'e2e/manual-docs-verify/state')

export async function phaseFinalize() {
  await runCase('IG5-4', '03-接入指南/05', '回切真实模型:执行 mock-model-restore.sql → MiniMax-M3 恢复默认、mock 退出', async (e) => {
    execSync(`docker exec -i inneragent-postgres psql -U inneragent -d inneragent < ${SEED_RESTORE}`, { encoding: 'utf8' })
    const raw = psql("select code, default_model, status from ia_ai_model where model_type=1 order by code")
    const defaults = psql("select string_agg(code, ',') from ia_ai_model where model_type=1 and default_model").trim()
    const v = [
      ok(defaults === 'MiniMax-M3', 'default_model 唯一且为 MiniMax-M3(回切成功)', `defaults=${defaults}`),
      ok(/mock-text\|f/.test(raw), 'mock-text 已退出默认位', raw.replace('\n', ' ; ')),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [
      { h: '断言结果', verdicts: v },
      { h: '回切后 ia_ai_model(code|default|status)', body: raw },
      { h: '执行的脚本', body: 'examples/acme-demo/seeds/mock-model-restore.sql(手册 03-接入指南/05 §4 口径)' },
    ]
    await evidenceShot('IG5-4', '接入指南/05 · 回切默认模型', e._sections, { pass })
    e.evidence.push('assets/IG5-4.png')
    assert(pass, '回切失败 — 必须人工恢复 mock-model-restore.sql!')
  })

  // 健康复查:回切后平台仍健康(手册「压测后回切默认模型并回归一遍对话」自检)
  await runCase('IG5-4b', '03-接入指南/05', '回切后回归一轮对话(真模型 MiniMax 正常应答至终态)', async (e) => {
    const { startRun } = await import('../lib.mjs')
    const r = await startRun({ conversationId: null, message: '现在几点了?', agentType: 'demo', toolExecutionMode: 'DEFAULT', enabledSkills: [] }, { deadlineMs: 120000 })
    const evs = r.events.filter((x) => !x.comment)
    const ots = evs.map((x) => x.data?.outputType)
    const reply = evs.map((x) => x.data?.content || '').join('')
    const v = [
      ok(r.httpStatus === 200, '运行受理', `${r.httpStatus}`),
      ok(ots[ots.length - 1] === 'DONE', '真模型回复至 DONE', ots.join(',')),
      ok(reply.length > 5, '回复非空(非 mock 固定文案路径)', reply.slice(0, 120)),
    ]
    const pass = v.every((x) => x.ok)
    e._sections = [{ h: '断言结果', verdicts: v }, { h: '事件序列', body: ots.join(',') }, { h: '回复(截取)', body: reply.slice(0, 300) }]
    await evidenceShot('IG5-4b', '接入指南/05 · 回切后对话回归', e._sections, { pass })
    e.evidence.push('assets/IG5-4b.png')
    assert(pass, '回切后对话回归失败')
  })

  savePhase('finalize')

  // 合并各阶段结果
  const merged = []
  for (const f of ['pre.json', 'api1.json', 'api2.json', 'api3.json', 'ui.json', 'finalize.json']) {
    const p = path.join(STATE, f)
    if (fs.existsSync(p)) {
      try { merged.push(...JSON.parse(fs.readFileSync(p, 'utf8'))) } catch (err) { console.error(`读取 ${f} 失败: ${err}`) }
    }
  }
  fs.writeFileSync(path.join(REPO, 'e2e/manual-docs-verify/results.json'), JSON.stringify(merged, null, 2))
  const passN = merged.filter((r) => r.status === 'PASS').length
  console.log(`\n[summary] 合并 ${merged.length} 条用例记录,PASS=${passN}, FAIL=${merged.length - passN}`)
  console.log(`[default model] ${psql("select string_agg(code, ',') from ia_ai_model where model_type=1 and default_model")}`)
}
