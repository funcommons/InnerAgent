# 业务线 7 · SDK 对话链路(R2 复测)

- 被测:`@inneragent/sdk` WC `<inneragent-chat>` + demo-host 默认接入(DEF-05 修复面)+ SSE 流式
- 用例文件:`e2e/specs/08-sdk-chat.spec.ts`(7 用例)
- 结论:**7 通过,0 失败,0 REGRESSED**。DEF-05 关闭:demo-host 按 README 默认接入(baseURL 默认值)全链路 200,输入/发送可用。
- 接入口径(本线):L7-01/L7-07 直连 **demo-host(5180)**;L7-02~06 因断言以 `agentType:'demo'` 工具链为基准(get_current_time chip / 脚注),demo-host 示例未声明 agentType(默认 ai_media)属**环境差异**,沿用可断中转页(该页 R2 已改默认 baseURL,纯透传,见 08-断流重连.md 与复测分册 §2)。

## 用例明细

| # | 用例 | R2 实际 | 判定 | 证据(assets/) |
| --- | --- | --- | --- | --- |
| 1 | Shadow DOM 双向隔离与主题令牌穿透 | 一致(demo-host 直连) | ✅ | `L7-01-ShadowDOM隔离-初始(宿主绿虚线+组件SDK样式).png`、`L7-01-主题令牌穿透(紫色实时换肤,宿主按钮不受影响).png` |
| 2 | 发消息 → SSE 流式增量渲染 | 停止按钮可见 → 内容增量增长 → 已完成 + 全文 + get_current_time chip;SSE id 严格递增、run COMPLETED | ✅ | `L7-02-run-SSE全量.txt`、`L7-02-run-SSE-id序列.txt`、`L7-02-psql-run.txt` |
| 3 | 消息历史:刷新后保留与回放 | 一致 | ✅ | `L7-03-刷新后会话保留(历史回放).png` |
| 4 | 新会话与切换会话 | 一致 | ✅ | `L7-04-会话乙完成(列表含两条).png` |
| 5 | 取消运行:CANCELLED 渲染 | UI 已取消 + 库层 CANCELLED | ✅ | `L7-05-psql-run.txt` |
| 6 | 错误输入:空消息禁用/超长消息 | 空白禁用;10 万字符到达终态、UI 不崩溃 | ✅ | `L7-06-超长输入结果.txt` |
| 7 | **DEF-05 回归**:默认 baseURL 单前缀可达 | demo-host 直连:`/ia/api/v1/me/models?type=1`、`/me/reference-options`、`/conversations` 全部 **200**;**0 个双重前缀请求、0 个 404**;composer 无错误提示、发送可用 | ✅ **缺陷关闭** | `L7-07-DEF05回归-默认接入请求清单.json`、`L7-07-DEF05回归-demo-host默认接入-模型200-发送可用.png` |

## DEF-05 闭环

- R1 发现:SDK http 层 baseURL 双重拼接(`/ia/api/v1/ia/api/v1/*` 全 404),默认接入形态不可用(P1)。
- 修复提交:**00cf15a**(调用点交相对路径 + request() 统一拼接 + 已带前缀幂等防护)。
- R2 复测:L7-07 反转为回归后通过;且 R2 已删除网关侧全部 URL 补偿(`e2e/reconnect-host.mjs` 的 SDK_BARE_PREFIX 段与宿主页 `baseURL:''`),修复后语义在**零补偿**下成立。**判定:关闭**。
