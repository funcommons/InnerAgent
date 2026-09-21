/*
 * tools/k6/scenarios/idle-sessions.js — 1000 空闲会话建立后保持,采样内存。
 *
 * 对应 03-开发计划 §7.3 验收 7:「1000 空闲会话内存稳定」。
 *
 * 「空闲会话」的实现口径(按真实契约,SSE 半开):
 *   以 toolExecutionMode=ALWAYS_ASK 发起运行 —— 服务端策略为「所有工具调用
 *   一律 ASK 且授权不可绕过」(AgentToolPermissionPolicy V19 语义),mock 模型
 *   首轮脚本调用 get_current_time 时运行进入 WAITING_CONFIRMATION
 *   (confirmation-timeout 24h),SSE 流在投出确认事件后保持打开、服务端静默
 *   —— 这就是生产中「用户确认卡挂着不动」的空闲会话真实形态,纯平台栈
 *   (server+PG+Redis+mock 模型,无需宿主桥)即可复现。
 *
 *   轮询备选(IA_IDLE_MODE=poll):建完会话后按真实契约低频轮询
 *   GET /runs/{runId} + /runs/running。适用于不允许长挂连接的环境;
 *   默认 sse(半开)。
 *
 * 内存采样:
 *   sampler 单 VU 每 IA_IDLE_SAMPLE_INTERVAL(15s)抓 /actuator/prometheus:
 *     jvm_memory_used_bytes(area=heap 求和 / nonheap)、
 *     fusion_agentscope_runtime_runs_waiting(应 ≈ 空闲会话数,交叉验证驻留)、
 *     outbox_backlog(观察位)。样本进 k6 Gauge + console JSON 行(run.sh 落盘)。
 *   稳定判定:稳态窗口(爬坡结束后)heap 对时间的线性回归斜率
 *     ia_idle_heap_growth_bytes_per_min,|斜率| 无持续增长(经验线 ≤1MB/min,
 *     容量报告结合 GC 周期裁量)→ summary 显式 PASS/FAIL。
 *
 * 节奏:IA_IDLE_SESSIONS=1000,爬坡 IA_IDLE_RAMP(3m)避免建会话惊群,
 * 保持 IA_IDLE_HOLD(10m;验收未定观察窗,容量报告须记录取值)。
 */

import { check, sleep } from 'k6';
import http from 'k6/http';

import { authHeaders, describeAuth } from '../lib/auth.js';
import { BASE_URL, buildRunBody, DEFAULTS, PATHS } from '../lib/config.js';
import { metrics, newRunTracker } from '../lib/metrics.js';
import {
  heapGrowthBytesPerMin,
  IDLE_WANTED,
  scrapeMetrics,
  summarizeIdleSample,
} from '../lib/prometheus.js';
import { consumeSse, loadSseSafe } from '../lib/sse-client.js';

const SESSIONS = intEnv('IA_IDLE_SESSIONS', 1000);
const RAMP = __ENV.IA_IDLE_RAMP || '3m';
const HOLD = __ENV.IA_IDLE_HOLD || '10m';
const SAMPLE_INTERVAL = intEnv('IA_IDLE_SAMPLE_INTERVAL', 15);
const MODE = __ENV.IA_IDLE_MODE || 'sse'; // sse(半开,默认)| poll(轮询)

// k6 每个场景时长需静态声明:总时长 = 爬坡 + 保持 + 收尾缓冲
const SCENARIO_SECONDS = Math.ceil((parseDuration(RAMP) + parseDuration(HOLD) + 60000) / 1000);

export const options = {
  scenarios: {
    holders: {
      executor: 'ramping-vus',
      startVUs: 1,
      stages: [
        { duration: RAMP, target: SESSIONS },
        { duration: HOLD, target: SESSIONS },
        { duration: '30s', target: 0 },
      ],
      // 持有型迭代:生命周期 = 爬坡+保持;不给 gracefulStop 杀半开连接的机会
      gracefulStop: '10s',
      exec: 'holdSession',
    },
    sampler: {
      executor: 'constant-vus',
      vus: 1,
      duration: `${SCENARIO_SECONDS}s`,
      exec: 'sampleLoop',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    ia_idle_hold_established_rate: ['rate>0.99'],
  },
  tags: { scenario: 'idle-sessions' },
};

// 注意:k6 每个 VU 是独立脚本实例,模块级可变量不能跨 VU 聚合 ——
// 采样数据归 sampler 单 VU 私有,结果经指标/JSONL 行外送(见 sampleLoop)。


/**
 * setup 返回值会作为第一个参数传给每个 exec 函数(k6 每 VU 独立脚本实例,
 * 不能用模块级全局跨 VU 传状态 —— 这是本脚本易错点,见 README「实现注记」)。
 */
export function setup() {
  const startedAt = Date.now();
  const rampMs = parseDuration(RAMP);
  const holdMs = parseDuration(HOLD);
  // 基线快照(容量报告「环境规格/基线」引用)
  let baseline = null;
  try {
    baseline = summarizeIdleSample(scrapeMetrics(BASE_URL, IDLE_WANTED));
  } catch (e) {
    baseline = { error: String(e) };
  }
  console.log(`[ia-k6][idle] baseline ${JSON.stringify(Object.assign({ ts: startedAt }, baseline))}`);
  return {
    startedAt,
    rampMs,
    holdMs,
    steadyFrom: startedAt + rampMs,
    deadline: startedAt + rampMs + holdMs,
    baseline,
  };
}

/** SSE 模块装载:失败时落必然失败的 check(门禁非零退出),本轮让位。 */
async function loadHolderSse() {
  const { sse, error } = await loadSseSafe();
  check(sse, { 'SSE 模块可用(k6/x/sse)': (m) => m !== null });
  if (!sse) {
    console.log(error);
    return null;
  }
  return sse;
}

/** 持有型 VU:建立一例空闲会话并保持到场景结束(半开 SSE 或轮询)。 */
export async function holdSession(data) {
  if (MODE === 'poll') {
    await holdByPolling(data);
    return;
  }
  const sse = await loadHolderSse();
  if (!sse) {
    return;
  }
  const startAt = Date.now();
  const tracker = newRunTracker(startAt, 'idle');
  let established = false;

  const res = consumeSse(sse, BASE_URL + PATHS.runs, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(buildRunBody({ toolExecutionMode: 'ALWAYS_ASK' })),
    tags: { name: 'idle-hold' },
  }, {
    onEvent: (event, client) => {
      tracker.onEvent(event);
      let payload = null;
      try {
        payload = event.data ? JSON.parse(event.data) : null;
      } catch (e) {
        payload = null;
      }
      // 确认事件到达 = 运行已进入 WAITING_CONFIRMATION,之后服务端静默,
      // 连接保持半开 —— 不调 client.close(),让连接活到场景收尾。
      // 实测载荷(2026-09-21,HEAD 冒烟):outputType=USER_CONFIRMATION_REQUIRED
      // 且 controlType=USER_CONFIRM_REQUIRED,二者任一命中即认为建立。
      if (payload && (payload.controlType === 'USER_CONFIRM_REQUIRED'
        || payload.outputType === 'USER_CONFIRMATION_REQUIRED'
        || payload.outputType === 'TOOL_CALL_STARTED')) {
        established = true;
      }
      // 兜底:意外到达终态(策略/行为变化)则关闭,迭代正常结束
      if (payload && (payload.outputType === 'DONE'
        || payload.outputType === 'ERROR'
        || payload.outputType === 'CANCELLED')) {
        client.close();
      }
    },
    onError: () => {},
  });

  const snap = tracker.finish(res && res.status === 200);
  metrics.idleHoldEstablished.add(established && !snap.failed ? 1 : 0);
  check(snap, {
    '空闲会话建立(进入等待确认,SSE 半开)': () => established && !snap.finished,
  });
  // 走到这里说明连接已被关闭(场景收尾被 k6 打断或意外终态)
}

/** 轮询模式:建一次完整运行,然后低频轮询状态保持「会话活跃」。 */
async function holdByPolling(data) {
  // 1) 建会话:完整跑一轮(DEFAULT 档,读工具自动放行,DONE 收尾落库)
  const sse = await loadHolderSse();
  if (!sse) {
    return;
  }
  const startAt = Date.now();
  const tracker = newRunTracker(startAt, 'idle-poll');
  const res = consumeSse(sse, BASE_URL + PATHS.runs, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
    body: JSON.stringify(buildRunBody()),
    tags: { name: 'idle-poll-run' },
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
  metrics.idleHoldEstablished.add(snap.finished ? 1 : 0);
  if (!snap.runId) {
    return;
  }
  // 2) 低频轮询(真实契约端点;30s 一次,模拟用户挂着页面不说话)
  while (Date.now() < data.deadline) {
    const r = http.get(BASE_URL + PATHS.runStatus(snap.runId), {
      headers: authHeaders(),
      tags: { name: 'idle-poll-status' },
    });
    check(r, { '状态查询 200': (x) => x.status === 200 });
    sleep(30);
  }
}

/**
 * 采样 VU:周期抓 actuator,直到保持期结束。
 * 结束时在本 VU 上下文内对稳态样本做线性回归,把斜率记入单样本 Trend ——
 * handleSummary 运行在独立 JS 上下文、读不到本 VU 的数组(README「实现注记」),
 * 指标是唯一跨上下文通道。
 */
export function sampleLoop(data) {
  const samples = []; // [tMs, heapUsedBytes]
  while (Date.now() < data.deadline) {
    let sample = null;
    try {
      sample = summarizeIdleSample(scrapeMetrics(BASE_URL, IDLE_WANTED));
    } catch (e) {
      console.log(`[ia-k6][idle] sample error: ${e}`);
      sleep(SAMPLE_INTERVAL);
      continue;
    }
    const now = Date.now();
    metrics.idleHeapUsedBytes.add(sample.heapUsedBytes);
    metrics.idleNonHeapUsedBytes.add(sample.nonHeapUsedBytes);
    if (sample.runsWaiting !== undefined && sample.runsWaiting !== null) {
      metrics.idleRunsWaiting.add(sample.runsWaiting);
    }
    samples.push([now, sample.heapUsedBytes]);
    console.log(`[ia-k6][idle] ${JSON.stringify(Object.assign({ ts: now }, sample))}`);
    sleep(SAMPLE_INTERVAL);
  }
  // 稳态窗口 = 最后 holdMs 时段(爬坡期建会话本身会抬内存,须剔除)
  const holdMs = data.holdMs;
  let steady = samples;
  if (samples.length > 2) {
    const lastTs = samples[samples.length - 1][0];
    steady = samples.filter((s) => s[0] >= lastTs - holdMs);
  }
  const slope = heapGrowthBytesPerMin(steady);
  if (slope !== null) {
    metrics.idleHeapGrowthBpm.add(slope);
  }
  console.log(`[ia-k6][idle] final ${JSON.stringify({
    totalSamples: samples.length,
    steadySamples: steady.length,
    heapGrowthBytesPerMin: slope,
    steadyHeapMinBytes: steady.length ? Math.min.apply(null, steady.map((s) => s[1])) : null,
    steadyHeapMaxBytes: steady.length ? Math.max.apply(null, steady.map((s) => s[1])) : null,
  })}`);
}

export function handleSummary(data) {
  const growthMetric = data.metrics.ia_idle_heap_growth_bytes_per_min;
  const slope = growthMetric && growthMetric.values ? growthMetric.values.avg : null;
  const waiting = data.metrics.ia_idle_runs_waiting
    && data.metrics.ia_idle_runs_waiting.values
    ? Math.round(data.metrics.ia_idle_runs_waiting.values.avg) : null;
  const slopeLine = slope === null ? 'N/A(样本不足)' : `${(slope / 1024).toFixed(1)} KiB/min`;
  // 判定经验线:稳态期 |增长斜率| ≤ 1 MiB/min 视为无持续增长
  // (GC 锯齿由回归窗 ≥ 保持期全量抹平;更严格口径以容量报告裁量)
  const verdict = slope === null
    ? 'N/A'
    : (Math.abs(slope) <= 1024 * 1024 ? 'PASS(稳态期未观测到持续增长)' : 'FAIL(疑似泄漏,结合 GC/容量报告裁量)');

  const line = `
──────────────── IA idle-sessions 结果(验收 7:1000 空闲会话内存稳定)────────────────
  环境/鉴权:     ${BASE_URL} / ${describeAuth()}
  模式:          ${MODE === 'sse' ? 'SSE 半开(ALWAYS_ASK → WAITING_CONFIRMATION)' : '轮询(status 30s)'}
  会话数/节奏:   ${SESSIONS} 会话,ramp ${RAMP} + hold ${HOLD},采样 ${SAMPLE_INTERVAL}s
  驻留交叉验证:  runs_waiting 均值 ≈ ${waiting}(应接近 ${MODE === 'sse' ? SESSIONS : '0'})'
  heap 稳态斜率: ${slopeLine}
  内存稳定判定:  ${verdict}
  采样明细:      JSONL 行见 run.log 中「[ia-k6][idle]」(run.sh 落盘)
──────────────────────────────────────────────────────────────────────`;

  const out = { stdout: line };
  if (__ENV.IA_RESULT_DIR) {
    out[`${__ENV.IA_RESULT_DIR}/idle-sessions.ia-summary.json`] = {
      scenario: 'idle-sessions',
      mode: MODE,
      sessions: SESSIONS,
      holdSeconds: parseDuration(HOLD) / 1000,
      runsWaitingAvg: waiting,
      heapGrowthBytesPerMin: slope,
      verdict,
    };
  }
  return out;
}

function parseDuration(text) {
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(text).trim());
  if (!m) {
    return 600000; // 兜底 10m
  }
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1000, m: 60000, h: 3600000 }[m[2]];
  return n * unit;
}

function intEnv(name, dflt) {
  const v = parseInt(__ENV[name], 10);
  return Number.isFinite(v) ? v : dflt;
}
