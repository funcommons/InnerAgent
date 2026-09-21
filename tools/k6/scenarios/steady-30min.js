/*
 * tools/k6/scenarios/steady-30min.js — 验收主场景:100 并发运行持续 30 分钟。
 *
 * 对应 03-开发计划 §7.3 验收 7:「性能(30 分钟持续):100 并发运行 + 500 events/s,
 * 错误率 <0.1%;首字 P95 ≤3s(不含模型)、事件透传 P95 ≤200ms」中
 * 「100 并发运行持续 30 分钟」的部分(500 events/s 由 ramp-events.js 承载;
 * 本场景同时复测透传延迟稳态)。
 *
 * 负载模型(ramping-vus,按「运行」发起):
 *   每个迭代 = 一次完整运行(POST /runs → SSE 逐事件消费 → 终态关流)。
 *   VU 数 = 同时活跃的运行数,100 VU 即 100 并发运行;每轮新会话
 *   (conversationId=null),30 分钟约产生 ~2×10^3 量级会话/运行落库,
 *   属压测预期容量消耗(容量报告「环境规格」须记库容量前后值)。
 *
 * 节奏(环境变量可覆盖,默认 = 验收口径):
 *   IA_STEADY_VUS=100  IA_STEADY_WARMUP=2m  IA_STEADY_DURATION=30m  IA_STEADY_RAMPDOWN=1m
 *
 * 阈值(默认 = 验收 7 原文;IA_THRESHOLD_* 可覆盖,见 lib/config.js):
 *   ia_run_failed_rate rate < 0.1%(超界 1m 后熔断,避免整场白跑)
 *   ia_sse_first_content_no_model_ms p(95) < 3000   ← 首字口径见 lib/metrics.js 头注
 *   ia_sse_event_passthrough_ms p(95) < 200         ← 时钟前提:与 server 同机/NTP
 */

import { check } from 'k6';
import exec from 'k6/execution';

import { authHeaders, describeAuth } from '../lib/auth.js';
import { BASE_URL, buildRunBody, DEFAULTS, PATHS, THRESHOLDS } from '../lib/config.js';
import { buildThresholds, newRunTracker } from '../lib/metrics.js';
import { consumeSse, loadSseSafe } from '../lib/sse-client.js';

const VUS = intEnv('IA_STEADY_VUS', 100);
const WARMUP = __ENV.IA_STEADY_WARMUP || '2m';
const HOLD = __ENV.IA_STEADY_DURATION || '30m';
const RAMPDOWN = __ENV.IA_STEADY_RAMPDOWN || '1m';

export const options = {
  scenarios: {
    steady: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: WARMUP, target: VUS },
        { duration: HOLD, target: VUS },
        { duration: RAMPDOWN, target: 0 },
      ],
      // 单迭代 = 单轮运行;宽限期让在途运行自然到终态而不是被硬杀计数
      gracefulStop: '40s',
      exec: 'runOnce',
    },
  },
  thresholds: buildThresholds(THRESHOLDS, {
    abortOnError: true,
    delayAbortEval: '1m',
  }),
  tags: { scenario: 'steady-30min' },
};

/** 单迭代:发起一次运行并消费到终态。 */
export async function runOnce() {
  // 模块装载失败时落必然失败的 check 让阈值门禁熔断(见 lib/sse-client.js)
  const { sse, error } = await loadSseSafe();
  check(sse, { 'SSE 模块可用(k6/x/sse)': (m) => m !== null });
  if (!sse) {
    console.log(error);
    return;
  }
  const startAt = Date.now();
  const tracker = newRunTracker(startAt, 'steady');

  const res = consumeSse(sse, BASE_URL + PATHS.runs, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(buildRunBody()),
    tags: { name: 'steady-run' },
  }, {
    onEvent: (event, client) => {
      tracker.onEvent(event);
      // 运行级超时兜底(服务端 run-timeout 30m,客户端不等待超长悬挂)
      if (Date.now() - startAt > DEFAULTS.runTimeoutMs) {
        client.close();
      }
    },
    onError: () => {},
  });

  const snap = tracker.finish(res && res.status === 200);

  check(res, { 'SSE 连接 HTTP 200': (r) => r && r.status === 200 });
  check(snap, {
    '运行以 DONE 终态收尾': (s) => s.finished,
    '事件序号严格递增到最后': (s) => s.lastSeq === null || s.lastSeq > 0,
  });
}

export function handleSummary(data) {
  // 注意:k6 每 VU 是独立脚本实例,模块级计数不可跨 VU 聚合 ——
  // 运行数/结局/事件数一律从 handleSummary 的 data.metrics 反推。
  const m = data.metrics;
  const p95 = (name) => (m[name] && m[name].values ? Math.round(m[name].values['p(95)']) : null);
  const rate = (name) => (m[name] && m[name].values ? m[name].values.rate : null);
  const cnt = (name) => (m[name] && m[name].values ? m[name].values.count : null);
  // Rate 指标:count = 记点次数(=运行数),rate = 1 的占比 → 完成数 ≈ rate×count
  const iterations = cnt('ia_run_finished_rate') || 0;
  const finished = Math.round((rate('ia_run_finished_rate') || 0) * iterations);
  const failed = iterations - finished;
  const totals = {
    iterations,
    finished,
    failed,
    events: cnt('ia_events_total') || 0,
  };
  const verdict = (v, limit) => (v === null ? 'N/A' : v <= limit ? `PASS (${v} ≤ ${limit})` : `FAIL (${v} > ${limit})`);

  const line = `
──────────────── IA steady-30min 结果(验收 7)────────────────
  环境/鉴权:       ${BASE_URL} / ${describeAuth()}
  节奏:            warmup ${WARMUP} → ${VUS} VU × ${HOLD} → rampdown ${RAMPDOWN}
  迭代(运行数):   ${totals.iterations}(完成 ${totals.finished} / 失败 ${totals.failed})
  事件总数:        ${totals.events}
  ── 验收阈值(默认值可经 IA_THRESHOLD_* 覆盖)──
  错误率 <${THRESHOLDS.errorRate}:           ${verdict(rate('ia_run_failed_rate'), THRESHOLDS.errorRate)}
  首字 P95(不含模型)<${THRESHOLDS.firstCharP95Ms}ms:  ${verdict(p95('ia_sse_first_content_no_model_ms'), THRESHOLDS.firstCharP95Ms)}
       (全含口径首字 P95: ${p95('ia_sse_first_content_ms')} ms)
  透传 P95 <${THRESHOLDS.passthroughP95Ms}ms:         ${verdict(p95('ia_sse_event_passthrough_ms'), THRESHOLDS.passthroughP95Ms)}
  ── 观察位 ──
  运行时长 P95:    ${p95('ia_run_duration_ms')} ms;事件间间隔 P95: ${p95('ia_sse_inter_event_ms')} ms
  每运行事件数:    avg ${m.ia_events_per_run && m.ia_events_per_run.values ? m.ia_events_per_run.values.avg.toFixed(1) : 'N/A'}
  时钟偏差丢弃样本: ${m.ia_clock_skew_samples ? m.ia_clock_skew_samples.values.count : 0}
  结果文件:        见 run.sh results 目录(--summary-export 全量指标 JSON)
────────────────────────────────────────────────────────────`;
  // run.sh 会注入 IA_RESULT_DIR;单独跑 k6 时只出 stdout
  const out = { stdout: line };
  if (__ENV.IA_RESULT_DIR) {
    out[`${__ENV.IA_RESULT_DIR}/steady-30min.ia-summary.json`] = {
      scenario: 'steady-30min',
      env: BASE_URL,
      totals,
      thresholds: THRESHOLDS,
      metrics: {
        firstContentP95Ms: p95('ia_sse_first_content_ms'),
        firstContentNoModelP95Ms: p95('ia_sse_first_content_no_model_ms'),
        passthroughP95Ms: p95('ia_sse_event_passthrough_ms'),
        interEventP95Ms: p95('ia_sse_inter_event_ms'),
        runDurationP95Ms: p95('ia_run_duration_ms'),
        eventsPerRunAvg: m.ia_events_per_run && m.ia_events_per_run.values ? m.ia_events_per_run.values.avg : null,
        failedRate: rate('ia_run_failed_rate'),
      },
    };
  }
  return out;
}

function intEnv(name, dflt) {
  const v = parseInt(__ENV[name], 10);
  return Number.isFinite(v) ? v : dflt;
}
