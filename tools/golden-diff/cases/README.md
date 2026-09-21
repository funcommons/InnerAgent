# 对照用例集(PRD 锚点 × 4)

> **状态:骨架(2026-09-21,W8)。golden 文件为结构正确的最小样例(事件形对齐仓库真实线缆
> `AiChatStreamRespVO` / `data.outputType` 判别),语义为人工构造;待 W9 双跑实测回填。**
> 回填方法:融光既有 agent 集成测试子集 + PRD 锚点的融光化版本,在 builtin / inner 两侧各跑一遍,
> 抓取 SSE 流存为 `builtin.jsonl` / `inner.jsonl`,以 `golden-diff` 出报告(03-开发计划 §6.4)。

每个用例目录固定三件套:

| 文件 | 说明 |
| --- | --- |
| `builtin.jsonl` | builtin 侧事件序列 golden |
| `inner.jsonl` | inner 侧事件序列 golden |
| `whitelist.json` | 该用例已知可接受差异声明(无则 `{"rules":[]}`) |

验收口径:带各自 `whitelist.json` 跑 `golden-diff` 退出码 = 0(§7.3:等价性 = 对照用例集事件序列
golden-diff = 0,白名单差异除外,白名单需评审)。

## 用例与 PRD 锚点对应

| 目录 | PRD 锚点 | 序列概要 | 白名单要点 |
| --- | --- | --- | --- |
| `case-01-single-turn` | 单轮对话 | REASONING → CONTENT×2 → DONE | 无(纯归一化消化易变字段) |
| `case-02-tool-confirm` | 工具调用 + 确认 | TOOL_CALL_STARTED →(确认 decision=CONFIRMED)→ TOOL_FINISHED → CONTENT → DONE | builtin 侧 `PROGRESS` 心跳 inner 不产出(`side: builtin` 整事件缺失规则) |
| `case-03-multi-turn` | 多轮上下文 | 同会话两轮:REASONING/CONTENT/DONE ×2,第二轮引用第一轮上下文 | 无 |
| `case-04-error-recovery` | 错误恢复 | TOOL_CALL(status=error)→ ERROR → 降级 CONTENT → DONE | 错误码命名差异:`data.error` 字段级规则(`RESOURCE_LIMIT_EXCEEDED` vs `IA_RESOURCE_LIMIT`,对应 §2.6「归一化去 RESOURCE_LIMIT」) |

## 手动跑法

```bash
node ../golden-diff.mjs case-01-single-turn/builtin.jsonl case-01-single-turn/inner.jsonl
node ../golden-diff.mjs case-02-tool-confirm/builtin.jsonl case-02-tool-confirm/inner.jsonl \
  --whitelist case-02-tool-confirm/whitelist.json
```

## W9 回填 checklist

- [ ] 四锚点两侧双跑实录回填 `builtin.jsonl` / `inner.jsonl`(保留真实 `outputType` 序列与 toolCalls 结构)
- [ ] 实测暴露的易变字段差异 → 追加 `--normalize` 规则或默认规则(`DEFAULT_KEY_RULES`)
- [ ] 实测暴露的已知可接受差异 → 白名单条目 + `reason`,过评审后落库
- [ ] case-02 的确认流形态核对(确认交互在两侧线缆上的真实事件形,当前以 `toolCalls[].decision=CONFIRMED` 占位)
- [ ] `node --test tools/golden-diff/` 全绿(样例回归已内置于 test.mjs)
