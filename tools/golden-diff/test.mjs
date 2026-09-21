/**
 * golden-diff 自测(node:test,零外部依赖):归一化、类型对齐、白名单、退出码、
 * 四个 PRD 锚点对照样例全量回归 + CLI 子进程退出码。
 * 运行:node --test tools/golden-diff/
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MASK,
  diffJsonl,
  diffStreams,
  eventTypeOf,
  normalizeEvent,
  parseJsonl,
  parseWhitelist,
  partitionByWhitelist,
  ruleMatches,
} from './golden-diff.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES = join(HERE, 'cases');

// ---------------------------------------------------------------------------
// 归一化
// ---------------------------------------------------------------------------

test('归一化:内置规则掩码时间戳/IDs/seq/耗时(任意深度)', () => {
  const event = {
    event: 'pipeline-event',
    data: {
      schemaVersion: 1,
      runId: 'run-b-1',
      sequence: 7,
      messageId: 'msg-1',
      conversationId: 'conv-1',
      createdAt: '2026-09-21T01:00:00Z',
      reasoningDurationMs: 812,
      latencyFirstTokenMs: 240,
      toolCalls: [{ toolCallId: 'call-b-1', name: 'host_lookup', meta: { eventId: 'e-9' } }],
      content: '正文保持不变',
    },
  };
  const normalized = normalizeEvent(event);
  assert.equal(normalized.data.runId, MASK);
  assert.equal(normalized.data.sequence, MASK);
  assert.equal(normalized.data.messageId, MASK);
  assert.equal(normalized.data.conversationId, MASK);
  assert.equal(normalized.data.createdAt, MASK);
  assert.equal(normalized.data.reasoningDurationMs, MASK);
  assert.equal(normalized.data.latencyFirstTokenMs, MASK);
  assert.equal(normalized.data.toolCalls[0].toolCallId, MASK);
  assert.equal(normalized.data.toolCalls[0].meta.eventId, MASK);
  assert.equal(normalized.data.toolCalls[0].name, 'host_lookup');
  assert.equal(normalized.data.content, '正文保持不变');
  assert.equal(event.data.runId, 'run-b-1', '入参事件对象不被修改');
});

test('归一化:--normalize 追加路径 —— 数组透明与 * 通配段', () => {
  const event = {
    event: 'pipeline-event',
    data: { toolCalls: [{ id: 'call_001', name: 'host_lookup' }], decision: 'CONFIRMED' },
  };
  // 数组透明:toolCalls.id 命中各元素的 id(包裹形/扁平形通吃)
  const normalized = normalizeEvent(event, ['toolCalls.id']);
  assert.equal(normalized.data.toolCalls[0].id, MASK);
  assert.equal(normalized.data.toolCalls[0].name, 'host_lookup');
  assert.equal(normalized.data.decision, 'CONFIRMED');
  // * 通配单级键:meta.*.id 命中 meta 下任意键的 id
  const nested = { event: 'pipeline-event', data: { meta: { calls: [{ id: 'c-9' }] } } };
  const normalizedNested = normalizeEvent(nested, ['meta.*.id']);
  assert.equal(normalizedNested.data.meta.calls[0].id, MASK);
});

test('事件类型判别:data.outputType 优先于 SSE event 名(仓库真实线缆形)', () => {
  assert.equal(eventTypeOf({ event: 'pipeline-event', data: { outputType: 'CONTENT' } }), 'CONTENT');
  assert.equal(eventTypeOf({ event: 'message', data: { output_type: 'DONE' } }), 'DONE');
  assert.equal(eventTypeOf({ event: 'progress' }), 'progress');
  assert.equal(eventTypeOf({ outputType: 'ERROR' }), 'ERROR');
  assert.equal(eventTypeOf({}), 'unknown');
});

// ---------------------------------------------------------------------------
// 对齐与 diff
// ---------------------------------------------------------------------------

test('对齐:仅易变字段不同的同构序列 diff 为 0', () => {
  const builtin = [{ event: 'pipeline-event', data: { outputType: 'CONTENT', content: '你好', runId: 'a' } }];
  const inner = [{ event: 'pipeline-event', data: { outputType: 'CONTENT', content: '你好', runId: 'b' } }];
  const { diffs } = diffStreamsOf(builtin, inner);
  assert.equal(diffs.length, 0);
});

test('对齐:字段差异带点分路径,语义字段标记 !(工具名/decision/错误码)', () => {
  const builtin = [{ event: 'pipeline-event', data: { outputType: 'TOOL_CALL', toolName: 'host_lookup', decision: 'CONFIRMED', note: 'x' } }];
  const inner = [{ event: 'pipeline-event', data: { outputType: 'TOOL_CALL', toolName: 'hostLookup', decision: 'REJECTED', note: 'y' } }];
  const { diffs } = diffStreamsOf(builtin, inner);
  const byPath = new Map(diffs.map((diff) => [diff.path, diff]));
  assert.equal(byPath.get('data.toolName').semantic, true);
  assert.equal(byPath.get('data.decision').semantic, true);
  assert.equal(byPath.get('data.note').semantic, false);
  assert.equal(byPath.get('data.toolName').builtin, 'host_lookup');
  assert.equal(byPath.get('data.toolName').inner, 'hostLookup');
  assert.equal(diffs[0].event, 'TOOL_CALL', 'diff.event 为纯事件类型(白名单匹配用)');
  assert.equal(diffs[0].label, 'TOOL_CALL #1', 'diff.label 带类型内序号(报告展示用)');
});

test('对齐:类型内按序配对,多出事件报 EVENT_MISSING 且记侧别', () => {
  const progress = () => ({ event: 'pipeline-event', data: { outputType: 'PROGRESS', createdAt: 't' } });
  const done = () => ({ event: 'pipeline-event', data: { outputType: 'DONE', finished: true } });
  const { diffs } = diffStreamsOf([progress(), progress(), done()], [done()]);
  assert.equal(diffs.length, 2);
  assert.ok(diffs.every((diff) => diff.kind === 'EVENT_MISSING' && diff.side === 'builtin' && diff.event === 'PROGRESS'));
});

test('解析:坏 JSONL 行报行号', () => {
  assert.throws(() => parseJsonl('{"a":1}\nnot-json\n', 'x.jsonl'), /x\.jsonl 第 2 行/);
});

// ---------------------------------------------------------------------------
// 白名单
// ---------------------------------------------------------------------------

test('白名单:EVENT_MISSING 按 event+side 命中,side 不符不消化', () => {
  const diff = { kind: 'EVENT_MISSING', event: 'PROGRESS', side: 'builtin', ordinal: 1 };
  assert.equal(ruleMatches({ event: 'PROGRESS', side: 'builtin' }, diff), true);
  assert.equal(ruleMatches({ event: 'PROGRESS', side: 'inner' }, diff), false);
  assert.equal(ruleMatches({ event: 'PROGRESS' }, diff), true);
  assert.equal(ruleMatches({ event: '*', side: 'builtin' }, diff), true);
  assert.equal(ruleMatches({ event: 'PROGRESS', side: 'builtin', field: 'data.x' }, diff), false, '带 field 的规则不适用于整事件缺失');
});

test('白名单:FIELD_MISMATCH 按字段前缀命中(data.error 覆盖 data.error.code)', () => {
  const diff = { kind: 'FIELD_MISMATCH', event: 'ERROR', path: 'data.error.code', builtin: 'A', inner: 'B' };
  assert.equal(ruleMatches({ event: 'ERROR', field: 'data.error' }, diff), true);
  assert.equal(ruleMatches({ field: 'data' }, diff), true);
  assert.equal(ruleMatches({ field: 'data.payload' }, diff), false);
});

test('白名单:声明式文件解析(数组形与 {rules} 形)', () => {
  assert.deepEqual(parseWhitelist('{"rules":[{"event":"PROGRESS"}]}'), [{ event: 'PROGRESS' }]);
  assert.deepEqual(parseWhitelist('[{"event":"*"}]'), [{ event: '*' }]);
  assert.throws(() => parseWhitelist('{"nope":1}'), /rules/);
});

// ---------------------------------------------------------------------------
// 退出码
// ---------------------------------------------------------------------------

test('退出码:无差异 → 0;未消化差异 → 1;白名单消化后 → 0', () => {
  const heartbeat = (createdAt) => ({ event: 'pipeline-event', data: { outputType: 'PROGRESS', createdAt } });
  const content = (text) => ({ event: 'pipeline-event', data: { outputType: 'CONTENT', content: text } });
  const noRule = diffJsonl(`${JSON.stringify(heartbeat('t1'))}\n${JSON.stringify(content('hi'))}\n`, `${JSON.stringify(content('hi'))}\n`);
  assert.equal(noRule.exitCode, 1);
  assert.equal(noRule.failures.length, 1);

  const digested = diffJsonl(
    `${JSON.stringify(heartbeat('t1'))}\n${JSON.stringify(content('hi'))}\n`,
    `${JSON.stringify(content('hi'))}\n`,
    { rules: [{ event: 'PROGRESS', side: 'builtin', reason: '心跳' }] },
  );
  assert.equal(digested.exitCode, 0);
  assert.equal(digested.whitelisted.length, 1);
  assert.match(digested.report, /白名单命中/);
  assert.match(digested.report, /PASS/);
});

test('退出码:报告 FAIL 形态包含差异明细与合计', () => {
  const failing = diffJsonl(
    '{"event":"pipeline-event","data":{"outputType":"CONTENT","content":"A"}}\n',
    '{"event":"pipeline-event","data":{"outputType":"CONTENT","content":"B"}}\n',
  );
  assert.equal(failing.exitCode, 1);
  assert.match(failing.report, /data\.content/);
  assert.match(failing.report, /FAIL/);
});

// ---------------------------------------------------------------------------
// 真实样例:四个 PRD 锚点对照用例(cases/,待 W9 双跑实测回填)
// ---------------------------------------------------------------------------

function runCase(name) {
  const dir = join(CASES, name);
  const whitelist = JSON.parse(readFileSync(join(dir, 'whitelist.json'), 'utf8'));
  return diffJsonl(readFileSync(join(dir, 'builtin.jsonl'), 'utf8'), readFileSync(join(dir, 'inner.jsonl'), 'utf8'), {
    rules: Array.isArray(whitelist) ? whitelist : whitelist.rules,
    builtinLabel: `${name}/builtin.jsonl`,
    innerLabel: `${name}/inner.jsonl`,
  });
}

for (const name of ['case-01-single-turn', 'case-02-tool-confirm', 'case-03-multi-turn', 'case-04-error-recovery']) {
  test(`锚点样例 ${name}:带白名单 diff=0`, () => {
    const result = runCase(name);
    assert.deepEqual(result.failures.map((failure) => `${failure.kind} ${failure.event} ${failure.path ?? ''}`), [],
      `未消化差异: ${result.report}`);
    assert.equal(result.exitCode, 0);
    assert.match(result.report, /PASS/);
  });
}

test('锚点样例 case-02:白名单是承重的——去掉后 PROGRESS 缺失计为失败', () => {
  const dir = join(CASES, 'case-02-tool-confirm');
  const result = diffJsonl(readFileSync(join(dir, 'builtin.jsonl'), 'utf8'), readFileSync(join(dir, 'inner.jsonl'), 'utf8'), {
    rules: [],
    builtinLabel: 'case-02/builtin.jsonl',
    innerLabel: 'case-02/inner.jsonl',
  });
  assert.equal(result.exitCode, 1);
  assert.ok(result.failures.some((failure) => failure.kind === 'EVENT_MISSING' && failure.event === 'PROGRESS'));
});

test('锚点样例 case-04:不带白名单时错误码差异暴露(供评审)', () => {
  const dir = join(CASES, 'case-04-error-recovery');
  const result = diffJsonl(readFileSync(join(dir, 'builtin.jsonl'), 'utf8'), readFileSync(join(dir, 'inner.jsonl'), 'utf8'), { rules: [] });
  const errorDiff = result.failures.find((failure) => failure.kind === 'FIELD_MISMATCH' && failure.path === 'data.error');
  assert.ok(errorDiff, 'data.error 差异应被检出');
  assert.equal(errorDiff.builtin.includes('RESOURCE_LIMIT_EXCEEDED'), true);
  assert.equal(errorDiff.inner.includes('IA_RESOURCE_LIMIT'), true);
});

test('partitionByWhitelist:命中/未命中互斥且不丢失', () => {
  const diffs = [
    { kind: 'EVENT_MISSING', event: 'PROGRESS', side: 'builtin' },
    { kind: 'FIELD_MISMATCH', event: 'CONTENT', path: 'data.content', builtin: 'a', inner: 'b' },
  ];
  const { whitelisted, failures } = partitionByWhitelist(diffs, [{ event: 'PROGRESS', side: 'builtin' }]);
  assert.equal(whitelisted.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(whitelisted[0].event, 'PROGRESS');
  assert.equal(failures[0].path, 'data.content');
});

// ---------------------------------------------------------------------------
// CLI 子进程(退出码端到端)
// ---------------------------------------------------------------------------

function runCli(args) {
  return spawnSync(process.execPath, [join(HERE, 'golden-diff.mjs'), ...args], { encoding: 'utf8' });
}

test('CLI:case-01 直接 diff=0 退出;case-02 需 --whitelist 才为 0', () => {
  const c1 = runCli([join(CASES, 'case-01-single-turn/builtin.jsonl'), join(CASES, 'case-01-single-turn/inner.jsonl')]);
  assert.equal(c1.status, 0, c1.stderr || c1.stdout);

  const files = ['case-02-tool-confirm/builtin.jsonl', 'case-02-tool-confirm/inner.jsonl'].map((file) => join(CASES, file));
  const without = runCli(files);
  assert.equal(without.status, 1);
  const withWhitelist = runCli([...files, '--whitelist', join(CASES, 'case-02-tool-confirm/whitelist.json')]);
  assert.equal(withWhitelist.status, 0, withWhitelist.stdout || withWhitelist.stderr);
});

test('CLI:--normalize 追加规则与 --json 机器可读输出', () => {
  const dir = join(CASES, 'case-02-tool-confirm');
  const result = runCli([
    join(dir, 'builtin.jsonl'), join(dir, 'inner.jsonl'),
    '--whitelist', join(dir, 'whitelist.json'),
    '--normalize', 'toolCalls.id',
    '--json',
  ]);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.exitCode, 0);
  assert.equal(parsed.stats.builtinTotal, 6);
  assert.equal(parsed.stats.innerTotal, 5);
  assert.equal(parsed.whitelisted.length, 1, 'builtin 侧 PROGRESS 心跳被白名单消化');
});

test('CLI:参数缺失或文件不存在 → 退出 1 并输出用法', () => {
  const noArgs = runCli([]);
  assert.equal(noArgs.status, 1);
  assert.match(noArgs.stderr, /用法/);
  const missing = runCli([join(CASES, 'nope.jsonl'), join(CASES, 'nope.jsonl')]);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /golden-diff/);
});

// 测试内部小工具:直接构造事件序列走归一化 + diffStreams 等价路径
function diffStreamsOf(builtinEvents, innerEvents) {
  return diffStreams(
    builtinEvents.map((event) => normalizeEvent(event)),
    innerEvents.map((event) => normalizeEvent(event)),
  );
}
