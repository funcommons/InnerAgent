#!/usr/bin/env node
/**
 * golden-diff —— builtin / inner 两侧 SSE 事件序列归一化 diff(03-开发计划 §2.6 / §6.4,W8 交付物)。
 *
 * 输入:两份 JSONL(每行一个 SSE 事件对象,`{"event":..,"data":{..}}` 包裹形或扁平形)。
 * 流程:归一化(掩码易变字段)→ 按「事件类型 + 类型内序号」对齐 → 逐字段 deep diff
 *      → 白名单消化已知可接受差异 → 报告 + 退出码。
 *
 * 用法:
 *   node golden-diff.mjs <builtin.jsonl> <inner.jsonl> [--normalize path.to.field]...
 *                       [--whitelist rules.json] [--json]
 *
 * 退出码:实际失败差异(白名单消化后)= 0 → 0;否则 1(输入/解析错误也归 1,信息走 stderr)。
 * 零运行时依赖,仅用 Node 内置模块。
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 归一化掩码占位(保留字段存在性,值参与相等比较时视为恒等) */
export const MASK = '<normalized>';

/**
 * 内置默认归一化规则(字段名级,任意深度生效;`*` 结尾 = 前缀通配)。
 * 覆盖时间戳 / runId / messageId / 会话与事件 ID / seq / 耗时延迟类 / AgentScope 身份 ID /
 * 工具调用配对 ID(跨侧重生成,非语义)。
 */
export const DEFAULT_KEY_RULES = [
  'timestamp', 'createdAt', 'created_at', 'createdAtMs',
  'runId', 'run_id',
  'messageId', 'message_id',
  'conversationId', 'conversation_id',
  'eventId', 'event_id',
  'seq', 'sequence', 'seq_no', 'sequenceNo', 'sequence_no',
  'duration*', 'latency*', 'durationMs', 'elapsed*',
  'reasoningStartTime', 'reasoningStartTimeMs', 'reasoningDuration', 'reasoningDurationMs',
  'rawEventId', 'raw_event_id',
  'replyId', 'reply_id', 'blockId', 'block_id',
  'toolCallId', 'tool_call_id',
];

/** 语义字段(工具名 / decision / 错误码 / 终态等):报告里以 `!` 标注,优先人工评审 */
export const SEMANTIC_KEYS = new Set([
  'toolName', 'tool_name', 'name', 'decision', 'status', 'toolStatus', 'tool_status',
  'error', 'code', 'errorCode', 'error_code', 'finished', 'cancelled', 'riskLevel',
]);

const KEY_RULE_EXACT = new Set(DEFAULT_KEY_RULES.filter((rule) => !rule.endsWith('*')));
const KEY_RULE_PREFIX = DEFAULT_KEY_RULES
  .filter((rule) => rule.endsWith('*'))
  .map((rule) => rule.slice(0, -1));

/** 深拷贝 + 按字段名掩码(数组逐元素递归) */
export function normalizeByKeys(value, exactKeys = KEY_RULE_EXACT, prefixes = KEY_RULE_PREFIX) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeByKeys(item, exactKeys, prefixes));
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = keyMatchesRule(key, exactKeys, prefixes) ? MASK : normalizeByKeys(child, exactKeys, prefixes);
    }
    return out;
  }
  return value;
}

function keyMatchesRule(key, exactKeys, prefixes) {
  return exactKeys.has(key) || prefixes.some((prefix) => key.startsWith(prefix));
}

/**
 * 按点分路径掩码(追加规则):按「字段链后缀」匹配 —— 从事件根出发的字段链
 * (`data.toolCalls` → ['data','toolCalls'];数组透明,元素不占链段)存在一段
 * 与规则逐级对应即命中;段 `*` 匹配任意单级键。因此:
 *   --normalize toolCalls.id   掩码 toolCalls 各元素的 id(包裹形/扁平形都命中)
 *   --normalize data.error     掩码 data.error
 *   --normalize id             掩码任意层级名为 id 的字段
 */
export function normalizeByPaths(root, paths) {
  let out = root;
  for (const path of paths) {
    const segments = String(path).split('.').map((segment) => segment.trim()).filter(Boolean);
    out = maskByPathChains(out, [], segments);
  }
  return out;
}

function maskByPathChains(value, chain, segments) {
  if (Array.isArray(value)) {
    return value.map((item) => maskByPathChains(item, chain, segments));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    const childChain = [...chain, key];
    out[key] = chainSuffixMatches(childChain, segments) ? MASK : maskByPathChains(child, childChain, segments);
  }
  return out;
}

function chainSuffixMatches(chain, segments) {
  if (segments.length === 0 || chain.length < segments.length) {
    return false;
  }
  const suffix = chain.slice(chain.length - segments.length);
  return suffix.every((key, index) => segments[index] === '*' || segments[index] === key);
}

/** 单事件归一化:先按内置/自定义字段名,再按 --normalize 追加路径 */
export function normalizeEvent(event, customPaths = []) {
  let out = normalizeByKeys(event);
  if (customPaths.length > 0) {
    out = normalizeByPaths(out, customPaths);
  }
  return out;
}

/**
 * 事件类型判别:仓库真实 SSE 以 data.outputType 为判别器(AiChatStreamRespVO),
 * 其次 event 字段,再次扁平 outputType/output_type。
 */
export function eventTypeOf(event) {
  const data = event && typeof event === 'object' ? event.data : undefined;
  if (data && typeof data === 'object') {
    if (typeof data.outputType === 'string') {
      return data.outputType;
    }
    if (typeof data.output_type === 'string') {
      return data.output_type;
    }
  }
  if (typeof event?.event === 'string') {
    return event.event;
  }
  if (typeof event?.outputType === 'string') {
    return event.outputType;
  }
  if (typeof event?.output_type === 'string') {
    return event.output_type;
  }
  return 'unknown';
}

/** diff 差异项:EVENT_MISSING(单侧独有事件)或 FIELD_MISMATCH(对齐事件内字段差异) */
export function diffStreams(builtinEvents, innerEvents) {
  const diffs = [];
  const typesOf = (events) => {
    const byType = new Map();
    for (const event of events) {
      const type = eventTypeOf(event);
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type).push(event);
    }
    return byType;
  };
  const builtinByType = typesOf(builtinEvents);
  const innerByType = typesOf(innerEvents);
  const stats = { builtinTotal: builtinEvents.length, innerTotal: innerEvents.length, alignedTypes: 0 };

  const allTypes = new Set([...builtinByType.keys(), ...innerByType.keys()]);
  for (const type of [...allTypes].sort()) {
    const builtinList = builtinByType.get(type) ?? [];
    const innerList = innerByType.get(type) ?? [];
    const pairs = Math.min(builtinList.length, innerList.length);
    if (builtinList.length > 0 && innerList.length > 0) {
      stats.alignedTypes += 1;
    }
    for (let index = 0; index < pairs; index += 1) {
      deepDiff(builtinList[index], innerList[index], '', type, `${type} #${index + 1}`, diffs);
    }
    for (let index = pairs; index < builtinList.length; index += 1) {
      diffs.push({ kind: 'EVENT_MISSING', event: type, label: `${type} #${index + 1}`, side: 'builtin', ordinal: index + 1,
        builtin: `${type} #${index + 1}`, inner: null });
    }
    for (let index = pairs; index < innerList.length; index += 1) {
      diffs.push({ kind: 'EVENT_MISSING', event: type, label: `${type} #${index + 1}`, side: 'inner', ordinal: index + 1,
        builtin: null, inner: `${type} #${index + 1}` });
    }
  }
  return { diffs, stats };
}

function deepDiff(builtinValue, innerValue, path, eventType, eventLabel, diffs) {
  const bothObjects = isPlainObject(builtinValue) && isPlainObject(innerValue);
  const bothArrays = Array.isArray(builtinValue) && Array.isArray(innerValue);
  if (bothObjects) {
    const keys = new Set([...Object.keys(builtinValue), ...Object.keys(innerValue)]);
    for (const key of keys) {
      deepDiff(builtinValue[key], innerValue[key], path ? `${path}.${key}` : key, eventType, eventLabel, diffs);
    }
    return;
  }
  if (bothArrays) {
    const length = Math.max(builtinValue.length, innerValue.length);
    for (let index = 0; index < length; index += 1) {
      deepDiff(builtinValue[index], innerValue[index], `${path}[${index}]`, eventType, eventLabel, diffs);
    }
    return;
  }
  if (!valueEquals(builtinValue, innerValue)) {
    diffs.push({
      kind: 'FIELD_MISMATCH',
      event: eventType,
      label: eventLabel,
      path: path || '<root>',
      semantic: isSemanticPath(path),
      builtin: builtinValue === undefined ? '<缺失>' : builtinValue,
      inner: innerValue === undefined ? '<缺失>' : innerValue,
    });
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function valueEquals(a, b) {
  return a === b || (Number.isNaN(a) && Number.isNaN(b));
}

function isSemanticPath(path) {
  const leaf = path.split(/[.[]/).pop()?.replace(/\].*$/, '').replace(/\[\d+\]$/, '') ?? '';
  return SEMANTIC_KEYS.has(leaf);
}

/** 白名单命中判定:命中即「已知可接受差异」,不计失败 */
export function ruleMatches(rule, diff) {
  const eventPattern = rule.event ?? '*';
  if (eventPattern !== '*' && eventPattern !== diff.event) {
    return false;
  }
  if (diff.kind === 'EVENT_MISSING') {
    if (rule.field !== undefined) {
      return false;
    }
    return rule.side === undefined || rule.side === diff.side;
  }
  if (diff.kind === 'FIELD_MISMATCH') {
    if (rule.field === undefined) {
      return true;
    }
    return diff.path === rule.field || diff.path.startsWith(`${rule.field}.`);
  }
  return false;
}

export function partitionByWhitelist(diffs, rules) {
  const whitelisted = [];
  const failures = [];
  for (const diff of diffs) {
    (rules.some((rule) => ruleMatches(rule, diff)) ? whitelisted : failures).push(diff);
  }
  return { whitelisted, failures };
}

/** 解析 JSONL(空行跳过;坏行抛错并带行号) */
export function parseJsonl(text, label = 'input') {
  const events = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed));
    }
    catch (error) {
      throw new Error(`${label} 第 ${index + 1} 行不是合法 JSON: ${error.message}`);
    }
  }
  return events;
}

export function parseWhitelist(text) {
  const parsed = JSON.parse(text);
  const rules = Array.isArray(parsed) ? parsed : parsed.rules;
  if (!Array.isArray(rules)) {
    throw new Error('白名单文件须为规则数组或 {"rules":[...]}');
  }
  return rules;
}

/** 全流程:文本 → 归一化 → diff → 白名单 → 报告与退出码 */
export function diffJsonl(builtinText, innerText, options = {}) {
  const rules = options.rules ?? [];
  const customPaths = options.normalizePaths ?? [];
  const label = { builtin: options.builtinLabel ?? 'builtin', inner: options.innerLabel ?? 'inner' };
  const builtin = parseJsonl(builtinText, label.builtin).map((event) => normalizeEvent(event, customPaths));
  const inner = parseJsonl(innerText, label.inner).map((event) => normalizeEvent(event, customPaths));
  const { diffs, stats } = diffStreams(builtin, inner);
  const { whitelisted, failures } = partitionByWhitelist(diffs, rules);
  const result = { diffs, stats, whitelisted, failures, rules, label, exitCode: failures.length === 0 ? 0 : 1 };
  result.report = renderReport(result);
  return result;
}

function formatValue(value) {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

/** unified diff 形报告 */
export function renderReport(result) {
  const { stats, whitelisted, failures, label } = result;
  const lines = [];
  lines.push('== golden-diff 报告 ==');
  lines.push(`builtin: ${label?.builtin ?? 'builtin'}(${stats.builtinTotal} 事件)  inner: ${label?.inner ?? 'inner'}(${stats.innerTotal} 事件)`);
  lines.push(`对齐事件类型数: ${stats.alignedTypes}`);
  lines.push('--- builtin');
  lines.push('+++ inner');
  if (result.diffs.length === 0) {
    lines.push('@@ 全等:归一化后两侧事件序列无差异 @@');
  }
  for (const diff of result.diffs) {
    if (diff.kind === 'EVENT_MISSING') {
      const missing = diff.side === 'builtin' ? diff.builtin : diff.inner;
      const sign = diff.side === 'builtin' ? '-' : '+';
      lines.push(`@@ 事件缺失(${whitelistedNote(diff, whitelisted)})@@`);
      lines.push(`${sign} <${missing}> 仅 ${diff.side} 侧存在(对侧缺失)`);
      continue;
    }
    const mark = diff.semantic ? '!(语义字段)' : '';
    lines.push(`@@ ${diff.label ?? diff.event} · 字段差异 ${mark}(${whitelistedNote(diff, whitelisted)})@@`);
    lines.push(`- ${diff.path}: ${formatValue(diff.builtin)}`);
    lines.push(`+ ${diff.path}: ${formatValue(diff.inner)}`);
  }
  const digest = '白名单';
  lines.push(`差异合计: ${result.diffs.length} 处(${digest}消化 ${whitelisted.length},实际失败 ${failures.length})`);
  lines.push(`结论: ${failures.length === 0 ? 'PASS(等价性成立)' : 'FAIL(存在未消化差异)'}`);
  return lines.join('\n');
}

function whitelistedNote(diff, whitelisted) {
  return whitelisted.some((entry) => entry === diff) ? '白名单命中' : '未命中白名单';
}

/** 四个 PRD 锚点对照用例目录名(cases/ 下,配 README 说明) */
export const ANCHOR_CASES = [
  'case-01-single-turn',
  'case-02-tool-confirm',
  'case-03-multi-turn',
  'case-04-error-recovery',
];

// ---------------------------------------------------------------------------
// CLI(被 import 时不执行)
// ---------------------------------------------------------------------------
export function main(argv = process.argv.slice(2)) {
  const options = { normalizePaths: [], rules: [] };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--normalize') {
      options.normalizePaths.push(argv[++index] ?? '');
    }
    else if (arg.startsWith('--normalize=')) {
      options.normalizePaths.push(arg.slice('--normalize='.length));
    }
    else if (arg === '--whitelist') {
      options.whitelistFile = argv[++index] ?? '';
    }
    else if (arg.startsWith('--whitelist=')) {
      options.whitelistFile = arg.slice('--whitelist='.length);
    }
    else if (arg === '--json') {
      options.json = true;
    }
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${__docHint()}\n`);
      return 0;
    }
    else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) {
    process.stderr.write('用法: node golden-diff.mjs <builtin.jsonl> <inner.jsonl> [--normalize path]... [--whitelist rules.json] [--json]\n');
    return 1;
  }
  try {
    if (options.whitelistFile) {
      options.rules = parseWhitelist(readFileSync(options.whitelistFile, 'utf8'));
    }
    const result = diffJsonl(readFileSync(positional[0], 'utf8'), readFileSync(positional[1], 'utf8'), {
      ...options,
      builtinLabel: positional[0],
      innerLabel: positional[1],
    });
    if (options.json) {
      process.stdout.write(`${JSON.stringify({
        exitCode: result.exitCode,
        stats: result.stats,
        diffs: result.diffs,
        whitelisted: result.whitelisted,
        failures: result.failures,
        report: result.report,
      }, null, 2)}\n`);
    }
    else {
      process.stdout.write(`${result.report}\n`);
    }
    return result.exitCode;
  }
  catch (error) {
    process.stderr.write(`golden-diff: ${error.message}\n`);
    return 1;
  }
}

function __docHint() {
  return [
    'golden-diff —— builtin/inner 两侧 SSE 事件序列归一化 diff',
    '用法: node golden-diff.mjs <builtin.jsonl> <inner.jsonl> [--normalize path.to.field]... [--whitelist rules.json] [--json]',
    '默认归一化: timestamp/created_at/runId/messageId/conversationId/eventId/seq/duration*/latency*/toolCallId 等(见 DEFAULT_KEY_RULES)',
    '退出码: 0 = 等价(含白名单消化); 1 = 存在实际差异或输入错误',
  ].join('\n');
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  process.exitCode = main();
}
