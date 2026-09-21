/*
 * tools/k6/lib/metrics.js — 自定义指标与逐事件计时(四场景共用)。
 *
 * ── 指标口径(03-开发计划 §7.3 验收 7)──────────────────────────────────
 *
 * 1) 首字延迟「不含模型」的实现口径(验收原文:首字 P95 ≤3s(不含模型)):
 *    客户端黑盒无法直接剥离模型耗时,k6 同时落三个 Trend,判定按环境二选一:
 *    a. ia_sse_first_event_ms        POST 发出 → 首个 SSE 事件到达(全含);
 *    b. ia_sse_first_content_ms      POST 发出 → 首个 CONTENT 事件到达(全含);
 *    c. ia_sse_first_content_no_model_ms
 *          = b − 事件自带 reasoningDurationMs(首个 CONTENT 事件携带的模型思考
 *            耗时,出处 AiChatStreamRespVO 字段注释与 AgentMessageProjectionService;
 *            无 REASONING/无该字段时记 null,不落点)。
 *    * mock 模型环境(MockAiProvider,确定性脚本、无真实推理):模型贡献 ≈0,
 *      直接以 b/c 对 3s 线判定 —— 这是容量报告的**主判定口径**;
 *    * 接真实模型的环境:以 c 为参考值(扣除了思考段;模型首 token 内部耗时
 *      无法黑盒剥离,残差须在容量报告注明),并对照服务端 IA-5 指标
 *      ia_sse_first_event_seconds(灰度大盘 B5,挂点 POST /runs 首事件)。
 *
 * 2) 事件透传延迟 ia_sse_event_passthrough_ms(验收原文:事件透传 P95 ≤200ms):
 *    = k6 收到事件的本地时刻 − 事件 createdAt(服务端事件日志/journal 创建时刻,
 *    随事件体下发)。覆盖「journal 创建 → 投影 → SSE 出口 → 网络 → 客户端」全程。
 *    * 时钟前提:createdAt 是服务端时钟。run.sh 默认 k6 与 server 同机(localhost),
 *      偏差可忽略;跨机部署必须 NTP 对齐,并在容量报告记录时钟口径。
 *    * 防污染:解析失败或差值为负(时钟回拨/偏差 > IA_CLOCK_SKEW_MS,默认 250ms)
 *      的样本不计入 Trend,计入 ia_clock_skew_samples 计数器并在报告披露数量。
 *
 * 3) 事件间透传延迟 ia_sse_inter_event_ms:同一次运行内相邻两事件的到达间隔。
 *    正常由模型出字节奏主导(mock 模型固定 800ms/delta);压测下若服务器 fan-out
 *    积压,该值系统性抬升 —— 作为积压观察位,不设硬阈值。
 *
 * 4) 会话总时长 ia_run_duration_ms:POST 发出 → 终态事件(DONE/ERROR/CANCELLED)
 *    到达(或连接关闭)。
 *
 * 5) 吞吐:ia_events_total 计数器(收到的事件总数);500 events/s 判定用
 *    handleSummary 对 rate(全测试时长均值,含爬坡稀释)计算并在 summary 显式
 *    出「达成/未达成」结论 —— 不作为 k6 硬阈值,避免爬坡稀释误判(README 口径)。
 *
 * 6) 结局:ia_run_finished_rate(以 DONE 终态收尾)/ ia_run_failed_rate
 *    (连接失败、超时、ERROR/CANCELLED 终态;阈值 0.1%)。
 */

import { Counter, Gauge, Rate, Trend } from 'k6/metrics';

export const metrics = {
  firstEventMs: new Trend('ia_sse_first_event_ms', true),
  firstContentMs: new Trend('ia_sse_first_content_ms', true),
  firstContentNoModelMs: new Trend('ia_sse_first_content_no_model_ms', true),
  eventPassthroughMs: new Trend('ia_sse_event_passthrough_ms', true),
  interEventMs: new Trend('ia_sse_inter_event_ms', true),
  runDurationMs: new Trend('ia_run_duration_ms', true),
  eventsPerRun: new Trend('ia_events_per_run', true),
  eventsTotal: new Counter('ia_events_total'),
  runFinished: new Rate('ia_run_finished_rate'),
  runFailed: new Rate('ia_run_failed_rate'),
  clockSkewSamples: new Counter('ia_clock_skew_samples'),
  // idle-sessions 专用(内存稳定采样,见 lib/prometheus.js)
  idleHeapUsedBytes: new Gauge('ia_idle_heap_used_bytes'),
  idleNonHeapUsedBytes: new Gauge('ia_idle_nonheap_used_bytes'),
  idleRunsWaiting: new Gauge('ia_idle_runs_waiting'),
  // 单样本 Trend:采样 VU 收尾时记入稳态期 heap 回归斜率(B/min),
  // 供 handleSummary 跨上下文读取(k6 每 VU 独立脚本实例,数组全局不可跨 VU)
  idleHeapGrowthBpm: new Trend('ia_idle_heap_growth_bytes_per_min', true),
  idleHoldEstablished: new Rate('ia_idle_hold_established_rate'),
};

/** 服务端可下发的输出类型全集(契约快照同源;DONE/ERROR/CANCELLED 为终态)。 */
export const TERMINAL_TYPES = ['DONE', 'ERROR', 'CANCELLED'];

const CLOCK_SKEW_MS = intEnv('IA_CLOCK_SKEW_MS', 250);

/**
 * 单次运行的事件跟踪器:把 SSE 逐事件喂给 onEvent(),结束后调 finish()。
 * 场景侧只关心返回的 snapshot() 结果(用于 checks)。
 *
 * @param {number} startAt POST 发出时刻(Date.now())
 * @param {string} name    场景名(仅用于日志)
 */
export function newRunTracker(startAt, name) {
  let firstEventAt = null;
  let firstContentAt = null;
  let firstContentReasoningMs = null;
  let prevEventAt = null;
  let events = 0;
  let terminalType = null;
  let runId = null;
  let lastSeq = null;
  let closedByServer = false;

  return {
    /** 每个到达的 SSE 事件调用一次;event 为 xk6-sse 事件对象。 */
    onEvent(event) {
      const now = Date.now();
      events += 1;
      metrics.eventsTotal.add(1);

      if (firstEventAt === null) {
        firstEventAt = now;
        metrics.firstEventMs.add(now - startAt);
      }
      if (prevEventAt !== null) {
        metrics.interEventMs.add(now - prevEventAt);
      }
      prevEventAt = now;

      // SSE 帧:id: "<runId>:<seq>"(AiPipelineController.toSse),name 为事件名,
      // data 为 AiChatStreamRespVO JSON;解析失败按透传计数但跳过字段提取。
      let payload = null;
      try {
        payload = event.data ? JSON.parse(event.data) : null;
      } catch (e) {
        payload = null;
      }
      if (event.id) {
        const sep = String(event.id).lastIndexOf(':');
        if (sep > 0) {
          runId = String(event.id).slice(0, sep);
          const seq = Number(String(event.id).slice(sep + 1));
          if (Number.isFinite(seq)) {
            lastSeq = seq;
          }
        }
      }

      // 透传延迟(口径见文件头 2):本地接收 − 服务端 createdAt
      const createdMs = parseCreatedAt(payload);
      if (createdMs !== null) {
        const delta = now - createdMs;
        // 负值或超大方差按时钟问题丢弃,单独计数(报告披露)
        if (delta < -CLOCK_SKEW_MS || delta > 600000) {
          metrics.clockSkewSamples.add(1);
        } else if (delta >= 0) {
          metrics.eventPassthroughMs.add(delta);
        }
      }

      if (payload && payload.outputType) {
        const type = payload.outputType;
        if (type === 'CONTENT' && firstContentAt === null) {
          firstContentAt = now;
          metrics.firstContentMs.add(now - startAt);
          const r = payload.reasoningDurationMs;
          if (typeof r === 'number' && r >= 0) {
            firstContentReasoningMs = r;
            // 首字「不含模型」口径(文件头 1c):扣除首个 CONTENT 自带的思考耗时
            metrics.firstContentNoModelMs.add(Math.max(0, now - startAt - r));
          }
        }
        if (TERMINAL_TYPES.indexOf(type) !== -1) {
          terminalType = type;
        }
      }
    },

    /** 连接结束(服务端关流/客户端关闭/超时中断)后调用。 */
    finish(closedByServerFlag) {
      closedByServer = closedByServerFlag !== false;
      const endedAt = Date.now();
      const finished = terminalType === 'DONE';
      const failed = !finished;
      metrics.runFinished.add(finished ? 1 : 0);
      metrics.runFailed.add(failed ? 1 : 0);
      if (events > 0 && finished) {
        metrics.runDurationMs.add(endedAt - startAt);
        metrics.eventsPerRun.add(events);
      }
      return {
        finished,
        failed,
        terminalType,
        events,
        runId,
        lastSeq,
        firstEventMs: firstEventAt === null ? null : firstEventAt - startAt,
        firstContentMs: firstContentAt === null ? null : firstContentAt - startAt,
        firstContentNoModelMs: firstContentAt === null || firstContentReasoningMs === null
          ? null
          : Math.max(0, firstContentAt - startAt - firstContentReasoningMs),
        durationMs: endedAt - startAt,
        closedByServer,
      };
    },

    snapshot() {
      return { runId, lastSeq, events, terminalType };
    },
  };
}

/** createdAt 解析:兼容 ISO-8601 字符串与 epoch 数值(Spring/Jackson 双形态)。 */
function parseCreatedAt(payload) {
  if (!payload || payload.createdAt === undefined || payload.createdAt === null) {
    return null;
  }
  const v = payload.createdAt;
  if (typeof v === 'number') {
    return v < 1e12 ? v * 1000 : v; // 秒 → 毫秒
  }
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function intEnv(name, dflt) {
  const v = parseInt(__ENV[name], 10);
  return Number.isFinite(v) ? v : dflt;
}

/** k6 thresholds 片段组装(参数化默认值来自 lib/config.js 的 THRESHOLDS)。 */
export function buildThresholds(t, opts) {
  const o = opts || {};
  const th = {};
  th.checks = ['rate>0.99'];
  th.ia_run_failed_rate = [{
    threshold: `rate<${t.errorRate}`,
    // 30 分钟主场景错误率超界尽早熔断,避免整场白跑
    abortOnFail: Boolean(o.abortOnError),
    delayAbortEval: o.delayAbortEval || '1m',
  }];
  if (!o.skipFirstChar) {
    th.ia_sse_first_content_no_model_ms = [`p(95)<${t.firstCharP95Ms}`];
  }
  if (!o.skipPassthrough) {
    th.ia_sse_event_passthrough_ms = [`p(95)<${t.passthroughP95Ms}`];
  }
  return th;
}
