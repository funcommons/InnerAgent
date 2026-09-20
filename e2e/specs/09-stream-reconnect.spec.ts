/**
 * e2e/specs/09-stream-reconnect.spec.ts — L8 断流重连线(可断中转 18085)。
 *
 * 手段(任务口径的「再包一层 e2e 断点代理」): e2e/reconnect-host.mjs 在独立端口
 * 18085 同源托管 WC 宿主页 + 反代 18090, 并提供 POST /__break?seconds=N 断流开关
 * (销毁全部活动 socket + N 秒内拒绝新连接)。
 *
 * SDK 重连时序(store/assistant.ts): 流错误 → onError → scheduleEnsureRetry(5s)
 * → ensureContentConnection → 按 knownRunId + Last-Event-ID 重连 /runs/{id}/events;
 * 轮询面若先感知完成(断流窗口覆盖终态), 修复后(DEF-06)不再放弃, 而是从本地游标
 * 补偿回填 /events 至全文再终态化。因此「续流中恢复」要求 run 存活期 > 断流时刻
 * + 5s:用 4 轮只读工具的 mockScript 把 run 拉长到 ~8s;L8-06 用长断流窗口覆盖
 * run 终态, 回归「轮询判完成 → 补偿回填 → UI 全文收敛」(修复反转, 原为截断取证)。
 *
 * 证据: 断流前/中/后截图 + reconnect-host 日志([cut]/[reconn] Last-Event-ID)+
 * psql 事件 seq 连续性(UI 收到的 SSE id 与库内可见事件对齐)。
 *
 * 前置: e2e/env.sh up + sdk-js dist + node e2e/reconnect-host.mjs(18085)。
 */
import { readFileSync } from 'node:fs'
import {
  test, expect, type Page, type TestInfo, RECONNECT_HOST, injectDemoUser, openSdkChat, sendChat,
  waitTerminal, liveContentLength, shot, saveText, saveJson, saveJournal, journalApi,
  psql, cleanupDemoUser, uniqueDemoUser, captureSse, readSseCaptured, setMockScript,
} from '../helpers/sdk-support'

const RECONNECT_LOG = '/tmp/ia-e2e-logs/reconnect-host.log'
const FOOTER = '本回复由 mock 模型脚本生成'
const SERVER_KEY = 'demo-spring-host'

async function breakProxy(seconds: number, allowRunning = false): Promise<void> {
  const res = await fetch(`${RECONNECT_HOST}/__break?seconds=${seconds}${allowRunning ? '&allow=running' : ''}`, { method: 'POST' })
  if (!res.ok) throw new Error(`/__break ${res.status}`)
}

async function waitProxyRecovered(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const state = await (await fetch(`${RECONNECT_HOST}/__state`)).json() as { breaking: boolean }
      if (!state.breaking) return
    } catch { /* 恢复探测中 */ }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('断流窗口未恢复')
}

/** 断流重连证据链(psql 事件序列 + 中转日志 + 重放 SSE 对齐) */
async function assertReconnectEvidence(page: Page, testInfo: TestInfo, userId: number, runId: string): Promise<void> {
  void userId
  // ---- 证据 1: psql 事件 seq 连续性(该 run 可见事件全覆盖、以 DONE 收尾) ----
  const seqRows = psql(
    `select sequence_no || ':' || coalesce(nullif(output_type,''),'(子事件)') from ia_agent_event where run_id='${runId}' order by sequence_no`,
  )
  const visibleSeqs = psql(
    `select string_agg(sequence_no::text, ',' order by sequence_no) from ia_agent_event where run_id='${runId}' and output_type <> ''`,
  ).split(',').map(Number)
  saveText('L8-psql-事件序列.txt', `runId=${runId}\n可见事件 seq: ${visibleSeqs.join(',')}\n全部行:\n${seqRows}`)
  for (let i = 1; i < visibleSeqs.length; i++) {
    expect(visibleSeqs[i], `可见事件 seq 严格递增(${visibleSeqs[i - 1]}→${visibleSeqs[i]})`).toBeGreaterThan(visibleSeqs[i - 1])
  }
  const terminalSeq = psql(`select sequence_no from ia_agent_event where run_id='${runId}' and output_type='DONE'`)
  expect(terminalSeq, 'DONE 事件已持久化').not.toBe('')

  // ---- 证据 2: 中转日志([cut]/[reconn] Last-Event-ID;按 runId 过滤, 多次尝试不串扰) ----
  let logText = ''
  try { logText = readFileSync(RECONNECT_LOG, 'utf8') } catch { /* 日志缺失时报告说明 */ }
  const runLog = logText.split('\n').filter((line) => line.includes(runId) && /\[(cut|reconn|break|drop|uperr)\]/.test(line)).join('\n')
  saveText('L8-reconnect-host-断流重连日志.txt', runLog || '(无匹配行)')
  expect(runLog, '日志含 SDK 自动重连记录 [reconn] Last-Event-ID').toContain('[reconn]')
  const reconnLines = [...runLog.matchAll(/Last-Event-ID=\S+:(\d+)/g)]
  const reconnCursor = Number(reconnLines[reconnLines.length - 1]?.[1] ?? -1)
  expect(reconnCursor, `重连游标为有效事件 id(${reconnCursor})`).toBeGreaterThan(0)
  expect(reconnCursor, '重连游标小于 DONE seq(存在后续事件待续传)').toBeLessThan(Number(terminalSeq))

  // ---- 证据 3: 重连续流精确性(replay 从 Last-Event-ID+1 起、连续无缺、直达 DONE) ----
  let sseCaptures = await readSseCaptured(page)
  for (let i = 0; i < 10 && !sseCaptures.some((c) => /\/events$/.test(c.url) && c.body); i++) {
    await page.waitForTimeout(500)
    sseCaptures = await readSseCaptured(page)
  }
  saveJson('L8-sse捕获清单.json', sseCaptures.map((c) => ({ url: c.url, length: c.body?.length ?? null })))
  const replayCandidates = sseCaptures.filter((c) => c.url.includes(runId) && /\/events$/.test(c.url) && c.body)
  const reconnectBody = replayCandidates.map((c) => c.body).join('\n\n')
  expect(reconnectBody, '捕获到重连 SSE 响应体').toContain('outputType')
  saveText('L8-reconnect-SSE响应体.txt', reconnectBody)
  const replayIds = [...reconnectBody.matchAll(/^id:.+:(\d+)$/gm)].map((m) => Number(m[1]))
  for (let i = 1; i < replayIds.length; i++) {
    expect(replayIds[i], `重放 id 严格递增无缺段(${replayIds[i - 1]}→${replayIds[i]})`).toBe(replayIds[i - 1] + 1)
  }
  expect(replayIds[0], `重放起点 = 重连游标+1(${reconnCursor + 1}, Last-Event-ID 续传语义)`).toBe(reconnCursor + 1)
  expect(replayIds[replayIds.length - 1], '重放直达 DONE 终态事件').toBe(Number(terminalSeq))
  // 首发流若有部分响应体可读, 与重放取并集后须覆盖库内全部可见事件
  const initialText = sseCaptures.filter((c) => c.url === '/runs').map((c) => c.body ?? '').join('\n')
  void initialText
  const initialIds = [...new Set(
    [...initialText.matchAll(/^id:.+:(\d+)$/gm)].map((m) => Number(m[1])),
  )]
  const unionIds = [...new Set([...initialIds, ...replayIds])].sort((a, b) => a - b)
  const expectedCoverage = initialIds.length
    ? visibleSeqs.length
    : visibleSeqs.filter((s) => s <= reconnCursor).length + replayIds.length
  saveText('L8-ui-sse-id全集.txt',
    `initial(可能缺失/截断)=${initialIds.join(',') || '(响应体不可读, 断流所致)'}\nreplay=${replayIds.join(',')}\nunion=${unionIds.join(',')}\n库内可见=${visibleSeqs.join(',')}`)
  expect(unionIds.length, 'UI 收到事件(并集)覆盖库内全部可见事件').toBe(expectedCoverage)
  saveJson('L8-ui-sse-id与库对齐.json', { runId, reconnCursor, initialIds, replayIds, visibleSeqs })
}

test.describe('L8 断流重连线', () => {

  test.setTimeout(300_000)

  test('L8-01 流式中途断流→自动恢复→UI 终态收敛与数据完整', async ({ page }, testInfo) => {
    test.setTimeout(300_000)
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    const journal = journalApi(page)
    await captureSse(page)

    await openSdkChat(page, RECONNECT_HOST)
    await sendChat(page, 'E2E-L8 断流重连探测')

    // 断流点: 首段内容增量已渲染(TOOL 事件已处理、runId 已知 → 走自动重连而非启动失败)
    await page.locator('[data-testid^="assistant-content-"]').first().waitFor({ state: 'visible', timeout: 30_000 })
    const lenBefore = await liveContentLength(page)
    await shot(page, 'L8-02-断流前-流式中(首段增量已现)', testInfo)

    // ---- 长窗断流 8s(销毁活动连接 + 拒绝新连接), 覆盖 mock run 终态 ----
    await breakProxy(8)
    await page.waitForTimeout(2500)
    const errTextDuringBreak = await page.getByTestId('assistant-message-error').innerText().catch(() => '')
    saveText('L8-03-断流中UI错误态文案.txt', errTextDuringBreak)
    await shot(page, 'L8-03-断流中-UI状态', testInfo)
    await waitProxyRecovered()

    // SDK 两条收敛路径(A: ensure-retry 自动重连→Last-Event-ID 续流;
    // B: 轮询先判完成→DEF-06 修复后转补偿回填)。两条路径终态都必须「全文+已完成」。
    const state = await waitTerminal(page, 120_000)
    expect(state, '断流后运行收敛到终态(未停留运行中/错误终态)').toBe('已完成')
    const uiText = await page.getByTestId('assistant-message-list').innerText()
    // [R1 修复反转] DEF-06 修复后不再存在「截断收敛」路径: UI 必须续流/回填至全文
    expect(uiText.includes(FOOTER), 'UI 恢复后回填/续流至全文(不允许截断终态)').toBe(true)
    const pathA = uiText.includes(FOOTER)
    await shot(page, pathA
      ? 'L8-04-路径A-自动重连续流至DONE(全文+已完成)'
      : 'L8-04-路径B-轮询判完成(内容截断,详见L8-06)', testInfo)
    const errAfter = await page.getByTestId('assistant-message-error').isVisible().catch(() => false)
    expect(errAfter, '收敛后 UI 无残留错误态').toBe(false)
    saveText('L8-05-收敛路径.txt', `path=${pathA ? 'A(auto-reconnect-resume)' : 'B(poll-completed-truncation,DEF-06)'}\n`
      + `断流前内容长度=${lenBefore}\n断流后内容长度=${(await liveContentLength(page))}\nUI 含收尾段=${pathA}`)

    // ---- 数据完整性: 库层全文与事件 seq 连续性(两路径共同验收) ----
    const runId = psql(`select run_id from ia_agent_run where user_id=${user} order by id desc limit 1`)
    const seqRows = psql(
      `select sequence_no || ':' || coalesce(nullif(output_type,''),'(子事件)') from ia_agent_event where run_id='${runId}' order by sequence_no`,
    )
    const visibleSeqs = psql(
      `select string_agg(sequence_no::text, ',' order by sequence_no) from ia_agent_event where run_id='${runId}' and output_type <> ''`,
    ).split(',').map(Number)
    saveText('L8-psql-事件序列.txt', `runId=${runId}\n可见事件 seq: ${visibleSeqs.join(',')}\n全部行:\n${seqRows}`)
    expect(visibleSeqs.length, '服务端已持久化完整事件流').toBeGreaterThan(3)
    const dbContent = psql(
      `select left(m.content, 200) from ia_agent_message m join ia_agent_conversation c on m.conversation_id=c.conversation_id
       where c.user_id=${user} and m.role='assistant' order by m.id desc limit 1`)
    expect(dbContent, '库层助手消息含全文收尾段(服务端数据完整)').toContain(FOOTER)

    let reconnectCursor = -1
    if (pathA) {
      // ---- 路径 A 追加断言: 重连游标 + 重放连续性 ----
      let logText = ''
      try { logText = readFileSync(RECONNECT_LOG, 'utf8') } catch { /* 尽力而为 */ }
      const runLog = logText.split('\n').filter((line) => line.includes(runId) && /\[(cut|reconn|break|drop|uperr)\]/.test(line)).join('\n')
      saveText('L8-reconnect-host-断流重连日志.txt', runLog || '(无匹配行)')
      expect(runLog, '日志含 SDK 自动重连记录 [reconn] Last-Event-ID').toContain('[reconn]')
      reconnectCursor = Number([...runLog.matchAll(/Last-Event-ID=\S+:(\d+)/g)].pop()?.[1] ?? -1)
      const terminalSeq = Number(psql(`select max(sequence_no) from ia_agent_event where run_id='${runId}' and output_type='DONE'`))
      expect(reconnectCursor, `重连游标为有效事件 id(${reconnectCursor})`).toBeGreaterThan(0)
      expect(reconnectCursor, '重连游标小于 DONE seq(存在后续事件被续传)').toBeLessThan(terminalSeq)
      let sseCaptures = await readSseCaptured(page)
      for (let i = 0; i < 10 && !sseCaptures.some((c) => /\/events$/.test(c.url) && c.body); i++) {
        await page.waitForTimeout(500)
        sseCaptures = await readSseCaptured(page)
      }
      saveJson('L8-sse捕获清单.json', sseCaptures.map((c) => ({ url: c.url, length: c.body?.length ?? null })))
      const replayCandidates = sseCaptures.filter((c) => c.url.includes(runId) && /\/events$/.test(c.url) && c.body)
      const reconnectBody = replayCandidates.map((c) => c.body).join('\n\n')
      expect(reconnectBody, '捕获到重连 SSE 响应体').toContain('outputType')
      saveText('L8-reconnect-SSE响应体.txt', reconnectBody)
      const replayIds = [...reconnectBody.matchAll(/^id:.+:(\d+)$/gm)].map((m) => Number(m[1]))
      for (let i = 1; i < replayIds.length; i++) {
        expect(replayIds[i], `重放 id 严格递增(${replayIds[i - 1]}→${replayIds[i]}; 可见事件 id 本身可跨空)`)
          .toBeGreaterThan(replayIds[i - 1])
      }
      expect(replayIds[0], `重放起点 > 重连游标(${reconnectCursor}, Last-Event-ID 续传语义)`).toBeGreaterThan(reconnectCursor)
      const expectedReplay = visibleSeqs.filter((s) => s > reconnectCursor)
      expect(replayIds.join(','), '重放事件覆盖游标之后的全部可见事件(无缺漏)').toBe(expectedReplay.join(','))
      expect(replayIds[replayIds.length - 1], '重放直达 DONE 终态事件').toBe(terminalSeq)
      saveJson('L8-ui-sse-id与库对齐.json', { runId, reconnectCursor, replayIds, visibleSeqs })
    } else {
      // 路径 B(修复后不可达, 防御保留): 若截断收敛复现, 上方全文断言已先行失败
      await openSdkChat(page, RECONNECT_HOST)
      await expect(page.getByTestId('assistant-message-list')).toContainText(FOOTER, { timeout: 20_000 })
      await shot(page, 'L8-09-路径B-刷新后历史回放全文(UI最终一致)', testInfo)
    }
    saveJson('L8-收敛观察.json', { pathA, reconnectCursor, terminalState: state })
    saveJournal(journal, `L8-01-api-journal-user${user}.txt`)

    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })

  test('L8-06 DEF-06 回归: 长断流覆盖 run 终态 → 轮询判完成后补偿回填, UI 全文收敛', async ({ page }, testInfo) => {
    const user = uniqueDemoUser()
    await injectDemoUser(page, user)
    await captureSse(page)

    await openSdkChat(page, RECONNECT_HOST)
    await sendChat(page, 'E2E-L8 长断流回填回归')
    // [R1 修复反转] 原取证用例: 8s 断流(allow=running)覆盖 run 终态 → 轮询先判
    // 「已完成」→ SDK 放弃重连 → UI 保留截断投影(uiMissingFooter=true)。
    // 修复后: 轮询判终态且本地投影 seq 落后时, 先经 /runs/{id}/events 从本地
    // 游标补偿回填, 回填交付根终态后再终态化 → UI 无需刷新即恢复全文。
    await page.locator('[data-testid^="assistant-content-"]').first().waitFor({ state: 'visible', timeout: 30_000 })
    await breakProxy(8, true)
    await page.waitForTimeout(3000)
    await shot(page, 'L8-07-长断流中-UI状态', testInfo)
    await waitProxyRecovered()

    const state = await waitTerminal(page, 120_000)
    const uiText = await page.getByTestId('assistant-message-list').innerText()
    // 库层助手消息为全文(含收尾段); UI 必须不刷新即回填至全文(与持久层一致)
    const dbContent = psql(
      `select left(m.content, 200) from ia_agent_message m join ia_agent_conversation c on m.conversation_id=c.conversation_id
       where c.user_id=${user} and m.role='assistant' order by m.id desc limit 1`,
    )
    saveText('L8-08-DEF06回归-取证.json', JSON.stringify({
      terminalState: state,
      uiContentTail: uiText.slice(-120),
      dbAssistantContent: dbContent,
      uiMissingFooter: !uiText.includes(FOOTER),
      dbHasFooter: dbContent.includes(FOOTER),
    }, null, 2))
    expect(state, 'run 终态为已完成(状态收敛)').toBe('已完成')
    expect(dbContent, '库层助手消息含全文收尾段').toContain(FOOTER)
    expect(uiText.includes(FOOTER), 'UI 未刷新即补偿回填至全文(修复后 uiMissingFooter=false)').toBe(true)
    await shot(page, 'L8-08-DEF06回归-已完成且内容完整', testInfo)

    await page.close().catch(() => {})
    cleanupDemoUser(user)
  })
})
