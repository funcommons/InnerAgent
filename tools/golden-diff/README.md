# golden-diff —— builtin / inner 两侧 SSE 事件序列归一化 diff

W8 交付物(03-开发计划 §2.6 公共测试资产、§6.4 等价性对照):把 builtin(融光既有引擎)与
inner(InnerAgent 内核)两侧同场景跑出的 SSE 事件序列各存一份 JSONL,归一化后 diff,
**实际失败差异 = 0(白名单消化后)即视为等价性成立**。每次灰度升档前必须全绿。

零运行时依赖,仅 Node 内置模块(Node ≥ 18)。

## 用法

```bash
node golden-diff.mjs <builtin.jsonl> <inner.jsonl> [options]

# 常用形态
node golden-diff.mjs cases/case-01-single-turn/builtin.jsonl cases/case-01-single-turn/inner.jsonl
node golden-diff.mjs builtin.jsonl inner.jsonl --whitelist cases/case-02-tool-confirm/whitelist.json
node golden-diff.mjs builtin.jsonl inner.jsonl --normalize toolCalls.id --normalize data.retryHint --json
```

| 参数 | 说明 |
| --- | --- |
| `<builtin.jsonl> <inner.jsonl>` | 两侧事件序列,每行一个 SSE 事件对象(JSONL;`#` 开头行视为注释跳过) |
| `--normalize <path>` | 追加归一化路径,可多次 |
| `--whitelist <rules.json>` | 已知可接受差异声明(命中即不计失败);数组或 `{"rules":[...]}` |
| `--json` | 机器可读输出(stats/diffs/whitelisted/failures/report) |

**退出码**:0 = 等价(含白名单消化);1 = 存在实际差异或输入错误(错误详情走 stderr)。

## 输入事件形

与仓库真实线缆对齐(`AiPipelineController.toSse` → `AiChatStreamRespVO`):
每行 `{"event":"pipeline-event","data":{...}}`,事件类型判别优先取 `data.outputType`
(REASONING / CONTENT / TOOL_CALL_STARTED / TOOL_CALL / TOOL_FINISHED / SUB_AGENT_FINISHED / DONE / ERROR / CANCELLED)。
扁平形(`outputType` 在根上)与裸 `event` 判别同样支持。

## 归一化(易变字段掩码为 `<normalized>`)

内置默认规则(字段名级,任意深度生效;`*` 结尾 = 前缀通配),见 `DEFAULT_KEY_RULES`:

- 时间戳:`timestamp` / `createdAt` / `created_at`
- 身份 IDs(跨侧重生成,非语义):`runId` / `messageId` / `conversationId` / `eventId` / `rawEventId` / `replyId` / `blockId`
- 序号:`seq` / `sequence`
- 耗时延迟:`duration*` / `latency*` / `elapsed*` / `reasoningStartTime` / `reasoningDurationMs`
- 工具调用配对 ID:`toolCallId` / `tool_call_id`

追加规则 `--normalize path.to.field` 按「字段链后缀」匹配(数组透明,`*` 匹配任意单级键):

```bash
--normalize toolCalls.id     # 掩码 toolCalls 各元素的 id(若双跑实测跨侧不同)
--normalize data.error       # 掩码 data.error 整个字段
```

## 白名单(已知可接受差异,需评审后保留)

```json
{
  "rules": [
    { "event": "PROGRESS", "side": "builtin", "reason": "builtin 的 progress 心跳 inner 没有" },
    { "event": "ERROR", "field": "data.error", "reason": "两侧资源限额错误码命名不同" }
  ]
}
```

- `event`:事件类型(如 `ERROR`),`*` = 任意类型;
- `side`(`EVENT_MISSING` 用):单侧独有事件的侧别(`builtin` / `inner`);
- `field`(`FIELD_MISMATCH` 用):点分路径,按前缀命中(`data.error` 覆盖 `data.error.code`);缺省 = 该事件任意字段差异均消化;
- `reason`:必填的评审理由(进报告,审计用)。

## diff 与报告

按「事件类型 + 类型内序号」对齐(对两侧交织顺序差异鲁棒),对齐事件逐字段 deep diff。
工具名 / decision / 错误码等语义字段差异在报告中以 `!(语义字段)` 标注。
报告为 unified diff 形:`-` builtin / `+` inner,末尾给差异合计与 PASS/FAIL 结论。

## 自测

```bash
node --test tools/golden-diff/        # 或 node --test tools/golden-diff/test.mjs
```

覆盖:归一化(内置规则 / 追加路径)、事件类型判别、对齐与缺失、白名单命中与不消化、
退出码、四个锚点样例全量回归、CLI 子进程端到端。

## 对照用例集

见 [`cases/README.md`](cases/README.md)。当前为**结构正确的最小 golden 骨架,待 W9 双跑实测回填**。
