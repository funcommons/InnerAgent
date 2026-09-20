# R1 · SDK 四线 · 测试汇总分册(第 1 轮后半)

- 轮次:/loop 测试循环 第 1 轮后半(SDK 对话 / 断流重连 / 附件上传 / 工具确认 UI / 管理鉴权 UI 可视部分)
- 日期:2026-09-21 · 执行:E2E 测试 agent(只测不改产品代码)
- 明细:07-SDK对话链路 · 08-断流重连 · 09-附件上传 · 10-工具确认UI(+L11 轻量线,见 §4)· assets/(90 份新增证据)
- 缺陷编号:接续 T1 分册(DEF-01~04),本轮 **DEF-05 / DEF-06 / DEF-07**,另记观察项 F12~F17

---

## 1. 环境与 WC 产物结论

| 项 | 结果 |
| --- | --- |
| 基建复用 | ✅ `e2e/env.sh up`(compose 35432/36379 错峰、主服务 18090 IA_ADMIN_KEY=test-key、gateway 18081)沿用 T1 基建,交接五条全部生效 |
| WC 产物 | ✅ `cd sdk-js && pnpm build` → `packages/components/dist/inneragent-chat.js`(601KB,构建产物非改码)。注意:dist 以 **bare specifier 外置 vue/pinia**(vite external),vite dev 宿主自动改写,原生静态托管需 import map(F17) |
| demo-host | ✅ `pnpm dev` 即真集成模式(vite.config 已有 /ia→18090 反代);pnpm 包装器的 deps-check 会因 esbuild 构建脚本被忽略而报错,直起 `node_modules/.bin/vite` 绕开(测试基建注记) |
| demo-spring-host | ✅ 18091(JDK 21;需显式 `JAVA_HOME=$(/usr/libexec/java_home -v 21)`,否则 UnsupportedClassVersionError);六工具经 admin API 注册(endpointUrl=`http://localhost:18091/ia-mcp`,annotationsJson readOnlyHint 齐备) |
| **e2e 可断中转(新增)** | ✅ `e2e/reconnect-host.mjs`(18085):同源托管 WC 宿主页 + /ia 反代(SSE 流式)+ `POST /__break?seconds=N` 断流开关(销毁活动 socket+拒新连接,`allow=running` 白名单可放行元信息面)+ `[cut]/[reconn]/[drop]` 全量日志。另承载两段**测试补偿**(详见 §3 DEF-05/07):裸路径重写与 `/runs` 请求体剔除 `enabledMcpTools:[]` |
| 演示用户隔离 | ✅ 每用例唯一演示用户(92001+,Playwright 路由注入 `X-IA-Demo-User`),finally 按用户物理清理;T1 教训「逻辑删残留踩 DEF-03/04」未再触发 |

**测试口径(重要)**:demo-host 默认接入形态因 DEF-05 不可用(模型/会话 404 → 输入禁用);除 L7-01(纯渲染隔离)与 L7-07(DEF-05 取证)外,功能用例一律在补偿代理页执行(`baseURL=''` + 网关层重写 + 请求体补偿),产品行为覆盖面不受影响,缺陷本体已单独取证。

## 2. 用例统计(19 用例,全部通过;含 3 例缺陷取证型用例)

| 业务线 | spec | 用例 | 通过 | 缺陷取证 |
| --- | --- | --- | --- | --- |
| L7 SDK 对话链路 | 08-sdk-chat.spec.ts | 7 | 7 | DEF-05(L7-07) |
| L8 断流重连 | 09-stream-reconnect.spec.ts | 2 | 2 | DEF-06(L8-06) |
| L9 附件上传 | 10-attachments.spec.ts | 3 | 3 | — |
| L10 工具确认 UI | 11-tool-confirm.spec.ts | 4 | 4 | —(DEF-07 补偿下验证) |
| L11 管理鉴权(UI 可视) | 12-admin-authz-ui.spec.ts | 3 | 3 | — |
| **合计** | | **19** | **19** | 连跑 ~1.4min |

复跑性:workers=1 串行;全部状态自建(固定标识符+查库/查宿主前置),finally 物理清理;失败留 trace/video/console(`e2e/test-results/`)。

## 3. 缺陷清单(修复由后续独立 agent 执行,本轮零产品代码改动)

### DEF-05 · P1 · SDK http 层 baseURL 双重拼接,默认接入形态全链路 404
- `client.ts request()` 对相对路径拼 `getBaseURL()`,而 `me.ts / conversations.ts / runs.ts(查询端) / attachments.ts` 调用点又自带 `${getBaseURL()}${path}` → 默认 `'/ia/api/v1'` 下实际请求 `/ia/api/v1/ia/api/v1/...` 全部 404。UI 后果:模型列表加载失败 → 输入区常驻「请求的资源不存在」、输入与发送禁用,**demo-host 按 README 接入不可用**。唯一不受影响的是 SSE `POST /runs`(authenticatedFetch 单次拼接)。
- 证据:`assets/L7-07-DEF05-demo-host默认接入-模型404-发送禁用.png`、`L7-07-DEF05-双重拼接404请求.json`
- 修复:调用点全部去掉 `${getBaseURL()}` 头(交给 request 统一拼),或在 `request()` 检测已带前缀;补一条「默认 baseURL 下 GET /me/models=200」的回归(本轮 L7-07 即可反转为回归用例)。
- 给修复批次:e2e 侧已备好补偿代理页与取证用例,修复后应删除补偿、恢复 demo-host 全量直测。

### DEF-06 · P2 · 断流窗口覆盖 run 终态 → UI「已完成」但内容截断(与持久层不一致)
- 流错误后 SDK 依赖 5s ensure-retry 重连;并行 1s 状态轮询在 run 完成后即把会话判「已完成」并放弃重连;`loadTerminalMessagesWithoutReplacingLiveTranscript` 因存在 live transcript 保留**截断投影** → UI 终态「已完成」但消息区止于断点,库层 `ia_agent_message` 为全文;刷新页面历史回放才恢复全文。触发面:断流窗口覆盖 run 终态(或轮询先于重连感知完成)。本轮以「断流白名单放行 /runs/running」实现确定性取证。
- 证据:`assets/L8-08-DEF06-已完成但内容截断.png`、`L8-08-DEF06-取证.json`(uiMissingFooter=true / dbHasFooter=true)、`L8-09-DEF06-刷新后历史回放全文.png`
- 修复:轮询把会话判「已完成」时,若本地 `lastSequence < 服务端 lastSequence`,应拉取历史/补偿 `/events` 合并转录,不得保留截断 live 投影;或完成态保留一次补偿性 `/events` 拉取(幂等,游标对齐)。
- 给修复批次:L8-06 用例即为回归用例;修复后 `uiMissingFooter` 应为 false。

### DEF-07 · P1 · SDK 默认发送 `enabledMcpTools:[]` → 注册工具在 UI 会话中全部不可达
- composer 空引用时仍把 `enabledMcpTools` 序列化为 `[]`,服务端按「显式空白名单」过滤 → 模型可见工具仅剩内置三项(服务端 WARN「脚本第 1 轮工具 … 不在 toolkit」);对照:curl 旅程不传该字段 → `ia_tool_registry` 注册工具可达并可执行。**工具确认(scope/确认卡)在纯 UI 接入下不可触达**。本轮经网关层剔除该字段补偿后完成 UI 侧验证(行为本身符合旅程口径)。
- 证据:`assets/L8-reconnect-host-断流重连日志.txt`(`[rewrite] /runs 请求体剔除 enabledMcpTools 空数组`)、对照服务端日志 WARN;补偿前后的差异可由 `e2e/reconnect-host.mjs` 头注释复现说明。
- 修复:SDK `references.mcpTools` 为空时字段下发 `undefined`(JSON 剔除);或服务端把空数组视作未指定。修复后 L10 四用例应可在**无补偿**下通过(回归口径)。
- 给修复批次:补偿开关集中在 `e2e/reconnect-host.mjs`(搜 DEF-07),修复验证时关闭该段即可。

### 观察与建议(F12~F17,不计缺陷)

| # | 位置 | 问题/建议 | 证据 |
| --- | --- | --- | --- |
| F12 | SDK 断流 UI | 断流中瞬时暴露原始错误文案「network error」+「重试」按钮(重连成功自动清除);建议「连接中断,自动重连中…」静默提示 | `L8-03-断流中UI错误态文案.txt`、`L8-03-断流中-UI状态.png` |
| F13 | SDK 单工具确认卡 | scope 无渲染位:chip 仅在 ≥2 工具批量条渲染,单工具(最常见)确认场景 UI 不可检视;mock 模型单轮单工具亦无法自然构造同批多工具 | `L10-12-scope-chip两轮观察.json`、`L10-04-scope-chip渲染观察.json` |
| F14 | SDK 消息区 | 用户消息携带附件不渲染(气泡仅文本;发送前 chip 有缩略图/文件名,发送后消失;历史回放同) | `L9-04-消息区附件渲染观察.json`、`L9-04-消息完成后-消息区附件渲染观察.png` |
| F15 | 服务端上传 | >20MB 触发 `MaxUploadSizeExceededException` → 500「服务器内部错误」,建议映射 413/400 + 可读文案 | `L9-09-25MB超限-UI错误反馈.png`、`L9-09-25MB错误反馈文案.txt` |
| F16 | SDK 附件传输 | >10MB 且模型具备 url 传输时静默回退 url(≤20MB),UI 无提示;url「公开可访问存储」契约在本地演示语义建议文档化 | `L9-08-15MB传输回退.json` |
| F17 | 测试基建注记 | WC dist 外置 vue/pinia:原生静态托管需 import map(`e2e/sdk-reconnect-page.html` 有现成方案);pnpm deps-check 会拦 vite dev(直起 `.bin/vite`) | `e2e/reconnect-host.mjs`、`e2e/vendor/devtools-api-stub.js` |

## 4. L11 · 管理 API 鉴权矩阵(UI 可视部分,轻量互补线)

- 无凭据访问 `/apps` → 路由守卫重定向 `/login?redirect=/apps`,管理数据零渲染(DEF-01 背景下登录页本身不可用,见 T1 分册)。
- 管理端点凭据分层:无凭据与错误 `X-IA-Admin-Key` 均 **403**(「管理面凭据无效」)—— 与 T1 的 L1-07 API 矩阵一致,不重复展开。
- 匿名演示头语义(embed 链路 demo 模式可用性):无任何凭据的 WC 宿主页完成一整轮对话(缺省演示用户 12993,`allow-anonymous-demo`)✅。
- 证据:`L11-01-未带凭据访问-apps-UI渲染.png`、`L11-01-访问轨迹.txt`、`L11-02-鉴权分层.json`、`L11-03-匿名演示头-WC对话可用.png`、`L11-03-清理记录.txt`

## 5. Shadow DOM 隔离与 SCOPE_RESOLVED 的证据结论

**Shadow DOM 双向隔离(✅ 成立)**
- 组件内容全部位于 `<inneragent-chat>` open shadowRoot 内(宿主 DOM 不可见内部结构);
- 宿主样式不渗入:组件按钮/输入框的 computedStyle 与宿主「绿色虚线/品红边框」全局样式无关;
- 组件样式不外泄:宿主按钮/段落保持宿主样式(绿色虚线黄字、红色斜体);
- 主题令牌穿透:宿主元素覆写 `--ia-primary` 后,Shadow 内元素的计算值(`--ia-primary` 与 `--app-*` 映射)实时跟随(#409eff→#7c3aed)。
- 证据:`L7-01-ShadowDOM隔离-初始(宿主绿虚线+组件SDK样式).png`、`L7-01-主题令牌穿透(紫色实时换肤,宿主按钮不受影响).png`

**SCOPE_RESOLVED(✅ 成立,数据面完整;呈现面有 F13 缺口)**
- 宿主元素 `addEventListener('SCOPE_RESOLVED')` 可收(bubbles+composed 穿透 Shadow 边界);
- 同确认批**恰派发一次**(runId:replyId 去重生效;测试期一度观测到的「重复派发」经查为测试侧双重监听入账,已修正采集方式并复测);
- detail 完整:conversationId / runId / replyId / tools[].{toolCallId,toolName,scope};
- scope 当前恒为降级形态:`{resolved:false, degraded:true, summary:"宿主未实现约束范围反查(resolve_scope),本次运行无约束范围上下文"}` —— 与服务端 `AgentExecutionFactory.scopeNode` 的安全缺省一致(fail-closed);
- UI 呈现:降级 chip 仅在 ≥2 工具批量确认条渲染,单工具行内确认无 scope 呈现(F13)。
- 证据:`L10-03-SCOPE_RESOLVED-detail.json`、`L10-02-写工具确认卡.png`、`L10-12-scope-chip两轮观察.json`

## 6. 清理确认

- 进程:demo-spring-host(18091)、demo-host vite(5180)、e2e 可断中转(18085)、gateway(18081)、主服务(18090)全部停止;`e2e/env.sh down` 输出:

```text
== 清理 ==
  gateway(pid=83490)已停止
  server(pid=83461)已停止
  端口 18090 无监听 ✓
  端口 18081 无监听 ✓
== compose down ==
  Network docker_default Removed
  容器端口 35432 已释放 ✓
  容器端口 36379 已释放 ✓
```

- 数据(全部物理清理,psql 实证):
  - 测试演示用户(92001+):`ia_agent_conversation/run/message/event/attachment/audit` 清零(16 会话/16 运行/8516 事件等);
  - 缺省演示用户 12993 名下**本轮自建**的 36 条会话(含两条 L11 匿名链路会话)按 `create_time >= 本轮服务启动` 精确删除;既有 22 条演示数据(00:29 前)未触碰;
  - mock 模型脚本复位:`ia_ai_model.config` 已为 NULL(用例 finally 复位 + 终检);
  - 工具注册:本轮注册的 demo-spring-host 六工具连同 schema 历史物理删除(注册表清零;无授权残留,`ia_tool_grant` 相关 0 行);
  - demo-spring-host 为进程内存态,进程已停止即复位。
- git:仅 `git add e2e/**` 与 `test-report/2026-09-21-01/**`(前缀 `test(e2e):`);**未 push**。

## 7. 给修复批次的注意点

1. **DEF-05 与 DEF-07 同根不同层**:前者是 http 层 URL 拼接(修 client.ts 或各调用点),后者是请求体语义(SDK 发空数组 / 服务端视空数组为未指定)。两处都有 e2e 补偿开关:`e2e/reconnect-host.mjs` 内搜 `DEF-05`/`DEF-07` 注释 —— 修复验证时**先关闭补偿**再跑 08~12 五个 spec;全绿后删除补偿段与 L7-07/L8-06 取证口径中的对应说明。
2. **DEF-06 的回归用例已就绪**:L8-06(`allow=running` 白名单)是确定性取证;修复后该用例的断言应反转为「恢复后 UI 续流/回填至全文」。注意其触发依赖「轮询面先感知完成」,若改轮询-重连优先级,请同步复核 L8-01 路径 A 的重放对齐断言(重放 id 与库内可见 seq 逐一对齐)。
3. **重连时序约束**(对 L8 类修复的测试口径):SDK 自动重连固定在「错误后 5s」,状态轮询 1s 级 —— 任何「断流→恢复→续流」类用例的 run 存活期必须显著大于 5s(本轮用 40 轮只读工具脚本把 mock run 拉到 ~13s);mock 模型 800ms/delta 的节奏与 5 deltas 总量是硬约束。
4. **SCOPE_RESOLVED 呈现(F13)**:若为单工具确认补 chip,注意 `assistant-confirm-scope` 目前只挂在批量条组件;`normalizeToolCallScope` 对旧事件(无 scope 字段)按 degraded 归一,补渲染时沿用该归一以免旧事件回归。
5. **测试资产交接**:`e2e/reconnect-host.mjs` + `e2e/sdk-reconnect-page.html` + `e2e/vendor/*` 是可复用的「可断网关 + WC 原生静态托管」套件(import map 方案可解决 dist 外置依赖的裸宿主托管);`e2e/helpers/sdk-support.ts` 提供演示用户注入/物理清理/SCOPE_RESOLVED 捕获/页面内 SSE 捕获(Playwright `response.text()` 取不到流式响应体,勿再走弯路)。
6. **删除补偿前不要直改 spec 断言**:补偿关闭后 L9-07 的 25MB 文案、L10 全线的工具可达性等表现都会变化,请以「补偿关闭 + 断言反转」的成对提交处理。
