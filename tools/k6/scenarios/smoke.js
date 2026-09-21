/*
 * tools/k6/scenarios/smoke.js — 单并发单轮对话冒烟(压测前置门禁)。
 *
 * 目的:压测前验证 SSE 链路连通与契约(03-开发计划 §3.3 验收 2 的客户端
 * 黑盒子集):POST /ia/api/v1/runs 能收到 CONTENT 增量与终态 DONE,事件 id
 * 形如 "<runId>:<seq>"(断点续传的游标形态,Last-Event-ID 重连依赖它)。
 * 不承载验收 7 的性能口径(那是 steady-30min/ramp-events 的职责)。
 *
 * 用法:
 *   k6 run tools/k6/scenarios/smoke.js          # 需服务在 IA_BASE_URL(默认 18090)
 *   IA_BASE_URL=http://host:18090 k6 run ...    # 远端环境
 *
 * 退出码非 0 = 冒烟失败(checks 阈值门禁),后续场景不应继续。
 */

import { check } from 'k6';
import exec from 'k6/execution';

import { authHeaders, describeAuth } from '../lib/auth.js';
import { BASE_URL, buildRunBody, DEFAULTS, PATHS } from '../lib/config.js';
import { newRunTracker } from '../lib/metrics.js';
import { consumeSse, loadSseSafe } from '../lib/sse-client.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    // 冒烟是硬门禁:任何结构断言失败都应阻断后续压测
    checks: ['rate==1'],
    ia_run_failed_rate: ['rate==0'],
  },
  tags: { scenario: 'smoke' },
};

export default async function () {
  // 模块装载失败时落一条必然失败的 check(退出码非 0),详见 lib/sse-client.js
  const { sse, error } = await loadSseSafe();
  check(sse, { 'SSE 模块可用(k6/x/sse)': (m) => m !== null });
  if (!sse) {
    console.log(error);
    return;
  }
  const startAt = Date.now();
  const tracker = newRunTracker(startAt, 'smoke');
  const seen = { idFormat: false, content: false, done: false, firstPayload: null };

  const res = consumeSse(sse, BASE_URL + PATHS.runs, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(buildRunBody()),
    tags: { name: 'smoke-run' },
  }, {
    onEvent: (event, client) => {
      tracker.onEvent(event);
      // 事件 id 契约:"<runId>:<seq>"(AiPipelineController.toSse)
      if (event.id && /^[^:]+:\d+$/.test(String(event.id))) {
        seen.idFormat = true;
      }
      let payload = null;
      try {
        payload = event.data ? JSON.parse(event.data) : null;
      } catch (e) {
        payload = null;
      }
      if (payload && payload.outputType === 'CONTENT') {
        seen.content = true;
      }
      if (payload && payload.outputType === 'DONE') {
        seen.done = true;
        if (seen.firstPayload === null) {
          seen.firstPayload = payload;
        }
        client.close(); // 终态后防御性关闭(服务端通常已关流)
      }
      // 冒烟兜底超时:防止悬挂连接阻塞整个 k6 进程
      if (Date.now() - startAt > DEFAULTS.runTimeoutMs) {
        client.close();
      }
    },
    onError: () => {}, // 连接级错误由 finish 的 failed 计数与 checks 体现
  });

  const snap = tracker.finish(res && res.status === 200);

  check(res, {
    'SSE 连接 HTTP 200': (r) => r && r.status === 200,
  });
  check(snap, {
    '事件 id 形如 runId:seq': () => seen.idFormat,
    '收到 CONTENT 增量': () => seen.content,
    '终态 DONE': () => snap.terminalType === 'DONE',
    'runId 已取到': () => Boolean(snap.runId),
  });

  console.log(`
──────────────── IA 冒烟(k6)────────────────
  环境:      ${BASE_URL}(鉴权: ${describeAuth()})
  runId:     ${snap.runId}
  事件数:    ${snap.events},末序号: ${snap.lastSeq},终态: ${snap.terminalType}
  首事件:    ${snap.firstEventMs} ms,首 CONTENT: ${snap.firstContentMs} ms
  VU/迭代:   ${exec.instance.vusActive}
  结论:      ${seen.content && snap.terminalType === 'DONE' ? 'PASS — 可继续压测' : 'FAIL — 先修复链路再压测'}
──────────────────────────────────────────────`);
}
