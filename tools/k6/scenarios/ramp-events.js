/*
 * tools/k6/scenarios/ramp-events.js — 事件透传压力:目标 500 events/s 的
 * 服务端 fan-out 吞吐(03-开发计划 §7.3 验收 7「100 并发运行 + 500 events/s」
 * 的吞吐半边;并发半边由 steady-30min 承载)。
 *
 * 负载模型(ramping-arrival-rate,按「运行」为到达单元):
 *   每次迭代 = 一轮完整运行(mock 模型确定性出字:每运行 ≈
 *   IA_EVENTS_PER_RUN_ESTIMATE 个事件,含 TOOL_CALL/CONTENT/DONE),到达率
 *   爬坡到 IA_RAMP_ARRIVAL = IA_TARGET_EVENTS_PER_SEC ÷ IA_EVENTS_PER_RUN_ESTIMATE
 *   (默认 500 ÷ 8 ≈ 63 运行/s),稳态段即目标 ~500 events/s 的服务端事件流。
 *
 *   ⚠ 前提(run.sh 自动执行,亦可手动):
 *     mock 模型 ia_ai_model.max_concurrency 默认 5,须调高(如 1000)否则
 *     模型并发闸会先于服务端事件管道成为瓶颈,测的不是目标对象;
 *     DELTA_INTERVAL=800ms(MockAiProvider 硬编码)决定单运行时长下限,
 *     并发运行数 ≈ 到达率 × 单运行时长(需 VU 池覆盖,见 IA_RAMP_MAX_VUS)。
 *
 * 吞吐判定口径(重要,为何不设为 k6 硬阈值):
 *   k6 Counter 的 rate 阈值是**全测试时长均值**,含爬坡/泄坡稀释,直接
 *   `rate>500` 会系统性误判。本场景在 handleSummary 里按阶段定义解析出
 *   「稀释折算」:稳态折算吞吐 = 全期 rate × 总时长 ÷ 加权窗口(0.5·W+H+0.5·D),
 *   以折算值对 500 events/s 出显式 PASS/FAIL(系数 0.9 容忍)。
 *
 * 阈值(默认 = 验收 7 原文,IA_THRESHOLD_* 可覆盖):
 *   ia_run_failed_rate < 0.1%(熔断);ia_sse_event_passthrough_ms p(95) < 200ms;
 *   ia_sse_first_content_no_model_ms p(95) < 3000ms。
 */

import { check } from 'k6';

import { authHeaders, describeAuth } from '../lib/auth.js';
import { BASE_URL, buildRunBody, DEFAULTS, PATHS, THRESHOLDS } from '../lib/config.js';
import { buildThresholds, newRunTracker } from '../lib/metrics.js';
import { consumeSse, loadSseSafe } from '../lib/sse-client.js';

const TARGET_EVENTS_PER_SEC = intEnv('IA_TARGET_EVENTS_PER_SEC', THRESHOLDS.eventsPerSec);
const EVENTS_PER_RUN = intEnv('IA_EVENTS_PER_RUN_ESTIMATE', 8);
const ARRIVAL = intEnv('IA_RAMP_ARRIVAL', Math.max(1, Math.round(TARGET_EVENTS_PER_SEC / EVENTS_PER_RUN)));
const WARMUP = __ENV.IA_RAMP_WARMUP || '2m';
const HOLD = __ENV.IA_RAMP_HOLD || '10m';
const RAMPDOWN = __ENV.IA_RAMP_DOWN || '1m';
// 单运行时长 ≈ 爬坡到达率 × 时长;VU 池须覆盖并发迭代数(默认按 5s/运行 + 1.5 系数)
const MAX_VUS = intEnv('IA_RAMP_MAX_VUS', Math.ceil(ARRIVAL * 5 * 1.5));

export const options = {
  scenarios: {
    burst: {
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s', // stages.target 的单位 = 每 timeUnit 到达数(每秒运行数)
      preAllocatedVUs: MAX_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { duration: WARMUP, target: ARRIVAL },
        { duration: HOLD, target: ARRIVAL },
        { duration: RAMPDOWN, target: 0 },
      ],
      exec: 'runOnce',
    },
  },
  thresholds: buildThresholds(THRESHOLDS, {
    abortOnError: true,
    delayAbortEval: '1m',
  }),
  tags: { scenario: 'ramp-events' },
};

/** 单迭代:发起一次运行并消费到终态(与 steady 相同的逐事件计时)。 */
export async function runOnce() {
  // 模块装载失败时落必然失败的 check 让阈值门禁熔断(见 lib/sse-client.js)
  const { sse, error } = await loadSseSafe();
  check(sse, { 'SSE 模块可用(k6/x/sse)': (m) => m !== null });
  if (!sse) {
    console.log(error);
    return;
  }
  const startAt = Date.now();
  const tracker = newRunTracker(startAt, 'ramp');

  const res = consumeSse(sse, BASE_URL + PATHS.runs, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(buildRunBody()),
    tags: { name: 'ramp-run' },
  }, {
    onEvent: (event, client) => {
      tracker.onEvent(event);
      if (Date.now() - startAt > DEFAULTS.runTimeoutMs) {
        client.close();
      }
    },
    onError: () => {},
  });

  const snap = tracker.finish(res && res.status === 200);

  check(res, { 'SSE 连接 HTTP 200': (r) => r && r.status === 200 });
  check(snap, { '运行以 DONE 终态收尾': (s) => s.finished });
}

export function handleSummary(data) {
  const m = data.metrics;
  const p95 = (name) => (m[name] && m[name].values ? Math.round(m[name].values['p(95)']) : null);
  const rate = (name) => (m[name] && m[name].values ? m[name].values.rate : null);
  const cnt = (name) => (m[name] && m[name].values ? m[name].values.count : null);

  // 稀释折算(口径见文件头):加权窗口 = 0.5·W + H + 0.5·D(线性爬坡/泄坡)
  const wMs = parseDuration(WARMUP);
  const hMs = parseDuration(HOLD);
  const dMs = parseDuration(RAMPDOWN);
  const totalMs = wMs + hMs + dMs;
  const weightedMs = 0.5 * wMs + hMs + 0.5 * dMs;
  const observedRate = rate('ia_events_total'); // events/s 全期均值
  const holdEquivalent = observedRate !== null && totalMs > 0
    ? observedRate * (totalMs / weightedMs)
    : null;
  const iterations = cnt('ia_run_finished_rate') || 0;
  const finished = Math.round((rate('ia_run_finished_rate') || 0) * iterations);
  const verdict = holdEquivalent === null
    ? 'N/A'
    : (holdEquivalent >= 0.9 * TARGET_EVENTS_PER_SEC
      ? `PASS(稳态折算 ${Math.round(holdEquivalent)} ≥ 0.9×${TARGET_EVENTS_PER_SEC})`
      : `FAIL(稳态折算 ${Math.round(holdEquivalent)} < 0.9×${TARGET_EVENTS_PER_SEC};先查 ia_run_failed_rate 与 VU 池是否打满)`);

  const line = `
──────────────── IA ramp-events 结果(验收 7:500 events/s 透传压力)────────────────
  环境/鉴权:       ${BASE_URL} / ${describeAuth()}
  到达节奏:        ${WARMUP} → ${ARRIVAL} 运行/s × ${HOLD} → ${RAMPDOWN}(VU 池 ${MAX_VUS})
  目标吞吐:        ${TARGET_EVENTS_PER_SEC} events/s ≈ ${ARRIVAL} 运行/s × ${EVENTS_PER_RUN} 事件/运行
  迭代(运行数):   ${iterations}(完成 ${finished})
  全期事件均值:    ${observedRate !== null ? observedRate.toFixed(1) : 'N/A'} events/s(含爬坡稀释)
  稳态折算吞吐:    ${holdEquivalent !== null ? Math.round(holdEquivalent) : 'N/A'} events/s
  吞吐判定:        ${verdict}
  ── 负载下延迟阈值(默认值可经 IA_THRESHOLD_* 覆盖)──
  错误率 <${THRESHOLDS.errorRate}:           ${rate('ia_run_failed_rate')} (${rate('ia_run_failed_rate') < THRESHOLDS.errorRate ? 'PASS' : 'FAIL'})
  透传 P95 <${THRESHOLDS.passthroughP95Ms}ms:         ${p95('ia_sse_event_passthrough_ms')} ms
  首字 P95(不含模型)<${THRESHOLDS.firstCharP95Ms}ms: ${p95('ia_sse_first_content_no_model_ms')} ms
  实测事件/运行:   avg ${m.ia_events_per_run && m.ia_events_per_run.values ? m.ia_events_per_run.values.avg.toFixed(1) : 'N/A'}(校准 IA_EVENTS_PER_RUN_ESTIMATE)
──────────────────────────────────────────────────────────────────────`;

  const out = { stdout: line };
  if (__ENV.IA_RESULT_DIR) {
    out[`${__ENV.IA_RESULT_DIR}/ramp-events.ia-summary.json`] = {
      scenario: 'ramp-events',
      env: BASE_URL,
      arrivalPerSec: ARRIVAL,
      targetEventsPerSec: TARGET_EVENTS_PER_SEC,
      observedAllAvg: observedRate,
      holdEquivalent,
      iterations,
      finished,
      thresholds: THRESHOLDS,
      metrics: {
        passthroughP95Ms: p95('ia_sse_event_passthrough_ms'),
        firstContentNoModelP95Ms: p95('ia_sse_first_content_no_model_ms'),
        failedRate: rate('ia_run_failed_rate'),
        eventsPerRunAvg: m.ia_events_per_run && m.ia_events_per_run.values ? m.ia_events_per_run.values.avg : null,
      },
      throughputVerdict: verdict,
    };
  }
  return out;
}

function parseDuration(text) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(text).trim());
  if (!m) {
    return 600000;
  }
  return Number(m[1]) * { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
}

function intEnv(name, dflt) {
  const v = parseInt(__ENV[name], 10);
  return Number.isFinite(v) ? v : dflt;
}
