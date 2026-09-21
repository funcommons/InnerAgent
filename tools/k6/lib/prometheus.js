/*
 * tools/k6/lib/prometheus.js — /actuator/prometheus 抓取与解析(IA-1 已落端点)。
 *
 * 用途:
 *   - idle-sessions 场景在 1000 空闲会话保持期间周期采样 JVM 内存与运行时 Gauge
 *     (验收 7:「1000 空闲会话内存稳定」),样本同时进 k6 Gauge/Trend 与
 *     console JSON 行(run.sh 落盘,容量报告据此回填斜率);
 *   - run.sh 在场景前后抓整份快照(纯文本落盘),供容量报告引用。
 *
 * 指标名(灰度大盘 §2.2 运行时健康表 + JVM 标准 MeterRegistry 前缀):
 *   jvm_memory_used_bytes{area="heap"| "nonheap",id=...}   — heap 取 area 标签聚合;
 *   fusion_agentscope_runtime_runs_waiting                  — 等待确认运行数
 *     (idle 场景用 ALWAYS_ASK 使运行停在 WAITING_CONFIRMATION,该 Gauge 应≈会话数,
 *      作为「1000 空闲会话真实驻留」的交叉验证位);
 *   fusion_agentscope_runtime_runs_active / outbox_backlog  — 观察位。
 */

import http from 'k6/http';

import { PATHS } from './config.js';

/** 原始 Prometheus 文本一行:`name{labels} value [timestamp]`。 */
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed[0] === '#') {
    return null;
  }
  const spaceAt = trimmed.lastIndexOf(' ');
  if (spaceAt < 0) {
    return null;
  }
  const value = parseFloat(trimmed.slice(spaceAt + 1));
  if (!Number.isFinite(value)) {
    return null;
  }
  const head = trimmed.slice(0, spaceAt);
  const braceAt = head.indexOf('{');
  if (braceAt < 0) {
    return { name: head, labels: {}, value };
  }
  const name = head.slice(0, braceAt);
  const labelBody = head.slice(braceAt + 1, head.lastIndexOf('}'));
  return { name, labels: parseLabels(labelBody), value };
}

/** 标签解析状态机:`k="v",k2="v2"`(支持值内逗号/空格/转义,如 id="G1 Eden Space")。 */
function parseLabels(body) {
  const labels = {};
  let i = 0;
  while (i < body.length) {
    const eq = body.indexOf('=', i);
    if (eq < 0) {
      break;
    }
    const key = body.slice(i, eq).trim();
    i = eq + 1;
    if (body[i] !== '"') {
      // 无引号值:读到逗号为止
      let j = body.indexOf(',', i);
      if (j < 0) {
        j = body.length;
      }
      labels[key] = body.slice(i, j);
      i = j + 1;
      continue;
    }
    i += 1; // 跳过开引号
    let val = '';
    while (i < body.length && body[i] !== '"') {
      if (body[i] === '\\' && i + 1 < body.length) {
        val += body[i + 1] === 'n' ? '\n' : body[i + 1];
        i += 2;
      } else {
        val += body[i];
        i += 1;
      }
    }
    i += 1; // 跳过收尾引号
    labels[key] = val;
    if (body[i] === ',') {
      i += 1;
    }
  }
  return labels;
}

/**
 * 抓取并按名提取指标。返回 { [name]: value | { [labelValue]: value } }。
 * @param {string} url   actuator 基址(默认 config.BASE_URL)
 * @param {Array<{name:string, byLabel?:string}>} wanted
 */
export function scrapeMetrics(baseUrl, wanted) {
  const res = http.get(baseUrl + PATHS.prometheus, {
    tags: { name: 'actuator-prometheus' },
    timeout: '10s',
  });
  if (res.status !== 200) {
    throw new Error(`[ia-k6] /actuator/prometheus 抓取失败: HTTP ${res.status}`);
  }
  const out = {};
  wanted.forEach((w) => { out[w.name] = w.byLabel ? {} : null; });
  res.body.split('\n').forEach((line) => {
    const parsed = parseLine(line);
    if (!parsed) {
      return;
    }
    wanted.forEach((w) => {
      if (parsed.name !== w.name) {
        return;
      }
      if (w.byLabel) {
        const key = parsed.labels[w.byLabel] || '_';
        out[w.name][key] = (out[w.name][key] || 0) + parsed.value;
      } else if (Object.keys(parsed.labels).length === 0 || out[w.name] === null) {
        // 无标签样本直接取;有标签的同名样本(多系列)只取首个兜底
        out[w.name] = parsed.value;
      }
    });
  });
  return out;
}

/** idle-sessions 采样集(heap 按 area 聚合需要逐 id 系列求和,这里用 byLabel=id 后求和)。 */
export const IDLE_WANTED = [
  { name: 'jvm_memory_used_bytes', byLabel: 'area' },
  { name: 'fusion_agentscope_runtime_runs_waiting' },
  { name: 'fusion_agentscope_runtime_runs_active' },
  { name: 'fusion_agentscope_runtime_outbox_backlog' },
];

/** 把 scrapeMetrics 结果规整成采样行(jvm_memory_used_bytes 已按 area 分组聚合)。 */
export function summarizeIdleSample(raw) {
  const byArea = (raw.jvm_memory_used_bytes || {});
  const used = Object.keys(byArea)
    .filter((k) => k !== 'nonheap')
    .reduce((acc, k) => acc + byArea[k], 0);
  const nonHeap = byArea.nonheap || 0;
  return {
    heapUsedBytes: used,
    nonHeapUsedBytes: nonHeap,
    runsWaiting: raw.fusion_agentscope_runtime_runs_waiting,
    runsActive: raw.fusion_agentscope_runtime_runs_active,
    outboxBacklog: raw.fusion_agentscope_runtime_outbox_backlog,
  };
}

/** 线性回归斜率(样本 [tMs, v]):内存稳定 = 稳态窗口斜率 ≈ 0(B/min)。 */
export function heapGrowthBytesPerMin(samples) {
  if (samples.length < 3) {
    return null;
  }
  const t0 = samples[0][0];
  const xs = samples.map((s) => (s[0] - t0) / 60000);
  const ys = samples.map((s) => s[1]);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) * (xs[i] - meanX);
  }
  return den === 0 ? null : num / den;
}
