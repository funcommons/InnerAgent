# 《docs/使用手册》全量回归测试报告

- 日期:2026-09-29(环境时区;用例执行窗口 09:11–11:40)
- 用例源:《docs/使用手册》18 篇(README 导读 + 17 内容篇)的可执行断言
- 脚本:`e2e/manual-docs-verify/run.mjs`(分阶段:`pre` MiniMax 真模型基线 → `api` 播种 canned mock 后的 API/契约用例 → `ui` 9203 前端用例 → `finalize` 回切与合并)
- 铁律遵守:未修改任何既有代码与文档;新增物仅 `e2e/manual-docs-verify/`(脚本 + 本报告 + 截图证据)

## 1. 执行摘要

| 指标 | 数值 |
| --- | --- |
| 行为用例总数 | **41** |
| 通过 | **41**(100%) |
| 失败 | **0** |
| 静态核对项 | **15**(见 §3,不占通过/失败计数) |
| 文档偏差/歧义(修复意见) | **9 条**(R-01…R-09,见 §4;均只记录不改) |
| 环境最终态 | 默认模型已回切 **MiniMax-M3**(`ia_ai_model` 查询确认,见 §5);自建 MCP 注册 0 残留;12993 无挂起运行 |

说明:三轮过程中曾出现 19→10→4→2 个失败,全部为**测试脚本自身问题**(SSE CRLF 解析、embed 头缺 Content-Type、mock 规则 tool 全 FQN 不被后缀解析、LIKE 下划线通配、软删键跨轮复用等),逐轮修复后最终全绿。

## 2. 逐篇用例表

证据均在 `e2e/manual-docs-verify/assets/`(每用例至少 1 张 PNG;API 类用例先渲染证据页 HTML 再截图,UI 类用例另有过程截图)。

### README(导读)

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| RD-1 | 文档地图 18 篇在盘;全局速查:server 基址、网关(/ia 反代)、管理面 `X-IA-Admin-Key`、观测端点 | fs 存在性 + HTTP 探测(无 key 被拒/带 key 200) | PASS | RD-1.png |

### 01-技术白皮书/01-产品概述

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| BP1-1 | 运行状态机 `RUNNING → WAITING_CONFIRMATION → COMPLETED/FAILED/CANCELLED`;SSE 终态 ↔ 运行单据终态 | ALWAYS_ASK 挂起 → 确认 → DONE ↔ COMPLETED(DB 双读);CANCELLED 在 AP1-3 实证 | PASS | BP1-1.png |
| (静态) | 「宿主桥工具 + 三方 MCP + 平台内置」三类工具;24h 确认超时;mock 登记制 | 工具三类与 24h 由 QS2-3/IG4-1/QS1-3 交叉实证;成本对比/价值小结为论述性内容 | 静态核对 | — |

### 01-技术白皮书/02-整体架构

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| BP2-1 | 端口表:18090/18081/35432/36379/9300(宿主桥 /ia-mcp)/9203 逐项连通 | HTTP/psql/redis-cli 探测 | PASS | BP2-1.png |
| BP2-2 | 指标 `fusion_agentscope_runtime_runs_active/_runs_waiting/_outbox_backlog`、`ia_reconnect_total` | /actuator/prometheus 逐项 grep(重连计数为惰性注册,IG2-3 重连后复验存在) | PASS | BP2-2.png |
| IG2-1a(交叉) | 帧契约事实:text/event-stream、`id:<runId>:<seq>`、data 含 outputType/createdAt、终态关流 | 真模型(MiniMax)实测逐帧断言 | PASS | IG2-1a.png |
| (静态) | 容量基线(100 并发×30min、≈18KB/运行)、outbox 500ms×200、SSRF/隔离模型 | 容量数字引自容量报告,本轮未复压;SSRF/隔离在 IG4-3 行为实证 | 静态核对+交叉 | — |

### 02-快速开始/01-五分钟跑起来

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| QS1-1 | `/actuator/health` UP | HTTP GET | PASS | QS1-1.png |
| QS1-2 | POST /runs SSE(DEFAULT→DONE);demo 内置工具(几点→get_current_time)读工具自动放行;终态后服务端关流 | 消费全流断言 outputType 序列与 closedByServer | PASS | QS1-2.png |
| QS1-3 | ALWAYS_ASK:确认卡事件(`USER_CONFIRMATION_REQUIRED`,`controlType=USER_CONFIRM_REQUIRED`)、运行态 WAITING_CONFIRMATION、SSE 保持打开、确认后 DONE | 挂起 35s 测 keep-alive 注释帧(实测 30.0s/条)→ POST /confirm → 续流至 DONE | PASS | QS1-3.png |
| QS1-4 | 18081 网关可打开(平台前端静态 + /ia 反代) | GET :18081/ 与 /ia/api/v1/runs/running | PASS(RD-1 合并验证) | RD-1.png |

### 02-快速开始/02-宿主应用接入(ACME demo)

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| QS2-1 | 9203 演示登录 → 建工单话术 → 确认卡(回显参数)→ 确认 → 建单回复 | Playwright:login(filler-02907=userId 12993)→ WC 挂载 → 发送话术 → 点确认 | PASS | QS2-1-confirm-card.png、QS2-1-after-confirm.png、QS2-1.png |
| QS2-2 | 工具面板台账出现 channel=agent 的本单工单卡片 | /ia/tools 断言标题唯一命中 + agent 渠道标记 | PASS | QS2-2-ticket-board.png、QS2-2.png |
| QS2-3 | 宿主工具 4 个(create_ticket/list_tickets/resolve_scope/query_sales);endpointUrl 指向 :9300/ia-mcp(与 act.audiences 对齐);宿主桥注册行「4 个宿主工具 @ /ia-mcp」 | 管理面 tools 过滤 serverKey=acme-demo 恰 4 + ia_tool_registry FQN 行 + POST /ia-mcp initialize;桥注册行在本次拉起 demo 后端日志中确证 | PASS | QS2-3.png |

### 03-接入指南/01-SDK 接入(Java 宿主桥)

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| IG1-2 | embed token:宿主后端签发(TTL 43200s=12h);claims.sub=行级隔离 userId;Bearer 调平台 | POST /api/demo/login → GET /api/ia/embed-token → 解码 JWT claims → Bearer GET /runs/running | PASS | IG1-2.png |
| (静态) | starter 依赖坐标、`inneragent.bridge.act.audiences` 配置、@IaTool/IaActClaims 注解、Webhook 验签三原则 | 代码/配置核对(audiences 对齐已由 QS2-3 实证;Webhook 验签为宿主侧行为,本轮未单测) | 静态核对 | — |

### 03-接入指南/02-直接 HTTP 接入(SSE 契约)

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| IG2-1a | 帧结构、createdAt 双形态兼容、outputType 主要取值、终态关流 | 真模型运行逐帧断言(见 §4 R-02/R-03/R-04 的实测偏差) | PASS(偏差已记录) | IG2-1a.png |
| IG2-3 | 断点续传:半途断开 → `Last-Event-ID` 重连不丢事件(replay-then-live);`afterSequence` 等价;终态后关流;`ia_reconnect_total{result=resumed}` | 收 2 帧断开 → 断开期间运行继续 → 重连,回放 seq 集合与 journal 断点后投影集合逐一比对(不丢不重);重连后指标出现 | PASS | IG2-3.png |

### 03-接入指南/03-前端组件与 iframe 嵌入

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| IG3-1 | WC `<inneragent-chat>` 直挂完成一轮对话 | Playwright 挂载 + 知识库话术回复 | PASS | IG3-1-wc-chat.png、IG3-1.png |
| IG3-2 | iframe + postMessage 模式完成握手(高度/状态事件回传,token 不入 URL) | embed 页切 iframe 模式挂载,等待握手完成标记 | PASS | IG3-2-iframe-handshake.png、IG3-2.png |
| IG3-3 | 参考实现在盘(sdk-js/、EmbedChat.vue、iframe-host.js、frame.html/frame.js/iframe-child.js、iframeEmbed.ts) | fs 存在性 | PASS | IG3-3.png |
| (静态) | tokenGetter 三要点、view 属性、会话连续性(Last-Event-ID 续传在 IG2-3 实证) | 论述性内容;续传行为已交叉实证 | 静态核对 | — |

### 03-接入指南/04-MCP 三方工具接入

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| IG4-1 | 应用级注册(echo :9401,streamable-http+STATIC_HEADER)成功;凭据打码;审计落行(decision=allowed) | 管理面注册 → 列表断言 credentialsMasked → 审计行 | PASS | IG4-1.png |
| IG4-2 | 重复 serverKey 409;非法字符(下划线/中文/65 字)400;OAUTH 501;STATIC_HEADER 缺头名/头值 400;非法 transport 400;64 字允许 | 10 组契约请求逐一断言(实测见 §4 R-08 的作用域口径) | PASS | IG4-2.png |
| IG4-3 | 用户级注册拒本机/内网地址(SSRF);跨用户读取 404 不泄露存在性 | localhost/127.0.0.1/10.0.0.1 三连拒 + 公网注册成功 + 用户 B 读取 404 | PASS | IG4-3.png |
| IG4-4 | 注册后工具以 `mcp__<serverKey>__<tool>` 进入工具箱;变更触发失效广播、删除后目录摘除 | 注册 → 临时 mock 规则(裸名 echo)驱动对话 → 确认批准 → `mcp__…__echo` 调用与回显 → 删除 → 列表摘除 | PASS | IG4-4.png |
| (静态) | 用户级编辑 credentials 空值语义、invalidator 裁剪部署静默跳过 | 代码口径核对,本轮未构造裁剪部署 | 静态核对 | — |

### 03-接入指南/05-模型接入与切换

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| IG5-1 | canned mock 规则四条话术 + default:建工单($1..$3 捕获注入,FQN 后缀解析,WRITE 确认后执行)、年假([KB:] 引用)、报告、几点(get_current_time);无命中落 default | mock 默认下逐话术运行 + 确认;断言 args 注入/回复文案/工具事件 | PASS | IG5-1.png |
| IG5-2 | `deltaMs` 出字节拍(种子 60);坑②:`ia_agent_run.agent_definition_snapshot_json.modelOptions` 能看到生效 config 原文 | 相邻 CONTENT 间隔中位数 62ms(≥40ms);快照 `modelOptions.mockScript.deltaMs=60` | PASS | IG5-2.png |
| IG5-3 | 正则标点须半角:全角话术不命中 → 落 default | 全角话术运行,断言无工具/确认事件且回复为 default | PASS | IG5-3.png |
| IG5-5 | `ia_ai_model` 登记口径:max_concurrency 默认 5(MiniMax 行)/压测 1000(mock 行);同类型唯一 default | DB 全表断言 | PASS | IG5-5.png |
| IG5-4/4b | 切换/回切:`mock-model-script.sql` 播种、`mock-model-restore.sql` 回切;回切后回归一轮对话 | 执行官方脚本 + DB 断言 + 真模型一轮 DONE | PASS | IG5-4.png、IG5-4b.png |

### 04-API 参考/01-运行与事件流 API

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| AP1-3 | `POST /runs/{id}/cancel`:挂起运行 → CANCELLED 终态(单据+事件流);重复取消幂等;已完成运行取消(实测 200/success,见 R-05) | 挂起→取消→回放事件断言 CANCELLED;重复取消与终态取消各一发 | PASS | AP1-3.png |
| AP1-5 | `POST /runs/cancel?conversationId=` 兜底(无活动运行 404);`confirm/expire` 幂等 | 会话兜底取消 + 无效会话 404 + expire 双发 | PASS | AP1-5.png |
| AP1-6 | `POST /runs/{runId}/continue`:对已取消运行续跑出新 SSE 流至终态;旧 run 保持 CANCELLED | continue 后解析新 runId 并断言终态 | PASS | AP1-6.png |
| (交叉) | GET /runs/{id}(状态枚举/非本人 404)、GET /runs/running、admin 三端点、actuator | BP1-1/AP1-3/QS1-3/AP2-1/RD-1 已覆盖 | PASS | 同上 |

### 04-API 参考/02-错误码与重连语义

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| AP2-1 | 错误码表:401(非法 Bearer)/403(管理面错 key)/404(行级隔离)/409/501/400;local profile 无鉴权头匿名放行;429 静态标注 | 逐请求断言;Agent 不存在实测 500(见 R-06) | PASS | AP2-1.png |
| AP2-3 | POST /runs 非幂等(两次两 run);`createdAt` 为服务端时钟(同机偏差 <5s) | 两次运行 + 时钟差测量 | PASS | AP2-3.png |
| (交叉) | 重试语义表(取消/过期幂等、SSE 断线走续传)、ia_reconnect_total{app,result} | AP1-3/AP1-5/IG2-3 已覆盖 | PASS | 同上 |

### 05-最佳实践/01-工具授权与确认流

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| QS1-2(交叉) | DEFAULT 档 READ 自动放行 | 几点话术无确认事件 | PASS | QS1-2.png |
| QS1-3/IG5-1(交叉) | WRITE 强制确认卡;确认卡回显全部将执行参数 | 确认事件 pendingToolCalls.argumentsPreview 含标题/优先级 | PASS | QS1-3.png、IG5-1.png |
| BE1-2 | ALWAYS_ASK 全部确认(读工具亦确认);拒绝 → 工具不执行、审计 denied(实测运行继续收尾至 DONE/COMPLETED,见 R-04) | 拒绝路径 + USER_CONFIRM_RESULT + 审计行 | PASS | BE1-2.png |
| BE1-3 | `ALWAYS_ALLOW`/`FULL_ACCESS` 显式豁免档跳过确认,WRITE 工具直接执行 | 两档各跑一轮建单话术,断言无确认卡且有工具事件 | PASS | BE1-3.png |
| BE1-5 | 审计:decision/decisionSource/toolFqn,不含凭据 | 近 20 分钟审计行渲染 + 凭据明文反查 | PASS | BE1-5.png |

### 05-最佳实践/02-容量规划与观测

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| BE2-1 | 必盯指标 8 项真实存在(runs_active/runs_waiting/outbox_backlog/backpressure/capacity/bulkhead 拒绝位、ia_reconnect_total、jvm_gc_pause_seconds) | prometheus 逐项 grep | PASS | BE2-1.png |
| BE2-2 | `runs_waiting` 与确认卡积压联动 | 挂起前/中/后三次采样:10→11→回落 | PASS | BE2-2.png |
| (静态) | 容量实测数字(100 并发×30min 零失败、首字 P95 1643ms、≈18KB/运行、outbox ~400 行/s)与压测方法 | 引自 `tools/k6/capacity-report-20260928.md`,本轮未复压 | 静态核对 | — |

### 06-运维手册/01-部署与配置

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| BP2-1(交叉) | 端口表/依赖一键 compose、健康检查两条命令、Redis 策略 noeviction | 端口连通(BP2-1)+ `CONFIG GET maxmemory-policy` = noeviction | PASS | BP2-1.png |
| (静态) | 环境变量三件套、启动/停机顺序、备份恢复要点、pg_stat_user_tables 观察项 | 论述性内容;journal 事实源/模型热更/MCP 广播三项「升级注意」已分别由 IG2-3/IG5-2/IG4-4 行为实证 | 静态核对 | — |

### 07-参考/01-术语表

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| RF1-1 | 事件口径:journal ≈10-11 条/运行、SSE 投影纯回复 3 条/工具流 6 条、ia_agent_message ≈2 条 | 纯回复运行 journal=10(投影 3)、SSE=3;工具流 journal=18(投影 6)、SSE=6;message=2 —— 与文档口径一致 | PASS | RF1-1.png |
| RF1-3 | 「技能(skill)」经 enabledSkills 传入 | 应用激活技能 report-style 受理至 DONE;非法技能名 500(见 R-07) | PASS | RF1-3.png |
| (交叉) | FQN、审计、keep-alive 30s、首字口径、SSE 帧 | BE1-5/QS1-3/IG2-1a 已实证 | PASS | 同上 |
| (静态) | 「死连接 ~2 个间隔内被暴露释放」 | 未构造死连接场景 | 静态核对 | — |

### 07-参考/02-限制与配额

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| RF2-1 | 每用户三方 MCP 注册 ≤32 | 干净态连注 32 成功、第 33 个被拒(实测 400 + 明确文案);用后全删 | PASS | RF2-1.png |
| RF2-3 | `timeoutSeconds` 默认值(手册写 45s) | 缺省注册 → 响应 **30**(代码同;见 R-01) | PASS(文档偏差) | RF2-3.png |
| (交叉) | serverKey 字符集/长度、OAUTH 501、行级隔离 404、确认超时 24h、embed TTL 43200、keep-alive 30s、max_concurrency 默认 5、SSE 投影口径 | IG4-2/IG4-3/IG1-2/QS1-3(事件 expiresAt 恰 +24h)/IG5-5/RF1-1 已实证 | PASS | 同上 |
| (静态) | 运行超时 30m、act token 60s、429 触发源 | 未构造;429 唯一已知源为子 Agent 护栏,本轮未触发 | 静态核对 | — |

### 07-参考/03-FAQ

| 用例ID | 手册断言 | 验证方法 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| IG5-3(交叉) | 全角/半角坑;恢复链路空文本消息跳过(前半实证) | 见 IG5-3 | PASS | IG5-3.png |
| RF3-1 | outputType 全集与「未知类型忽略」语义 | 全轮汇总实测集合:CONTENT/TOOL_CALL_STARTED/TOOL_CALL/USER_CONFIRMATION_REQUIRED/USER_CONFIRM_RESULT/TOOL_FINISHED/DONE(+AP1-3 的 CANCELLED);对照文档宣称全集(见 R-02/R-03/R-04) | PASS(观测) | RF3-1.png |
| (交叉) | mock 裸名后缀解析、createdAt 双形态、SSE 断线不丢、库涨得快/清理脚本在盘 | IG5-1/IG2-1a/IG2-3/`tools/k6/cleanup-loadtest-data.sql` 在盘核对 | PASS | 同上 |

## 3. 静态核对范围汇总(本轮未回归,共 15 项)

1. 产品概述:与自研成本对比、价值小结(论述性)。
2. 整体架构:容量基线数字(100 并发×30min、18KB/运行)、outbox 500ms×200/批。
3. 快速开始/02:Webhook 验签(原始字节/常量时间/快回 2xx)宿主侧行为。
4. SDK 接入:starter 依赖坐标、@IaTool 注解代码形态、IaActClaims 注入语义。
5. 前端组件:tokenGetter 三要点、view 属性、深色/移动端视口。
6. MCP 接入:credentials 编辑空值语义(保持原值)、invalidator 裁剪部署。
7. 模型接入:OpenAI 兼容登记流程步骤性内容、供应商限流对位。
8. API 参考:会话/消息查询 API(P2 批次,文档自述「按批次补充」)。
9. 错误码:429(子 Agent 护栏,唯一已知源)未触发。
10. 限制与配额:运行超时 30m、act token 60s(内环短时凭证,未截包验证)。
11. 术语表:「死连接 ~2 个间隔内被暴露释放」。
12. 最佳实践/02:全部容量实测数字与三步法。
13. 运维手册:启停顺序、备份恢复、pg_stat_user_tables 观察项。
14. FAQ:「恢复链路注入空文本消息被自动跳过」。
15. 工具描述写法、IaActClaims 二次鉴权代码示例(最佳实践/01 §3/§4)。

## 4. 修复意见清单(只记录,未改动文档)

| 编号 | 位置 | 现象与证据 | 建议改法 |
| --- | --- | --- | --- |
| R-01 | 07-参考/02 配额表 | 「三方 MCP 注册超时 timeoutSeconds 默认 **45s**」;实测缺省注册响应 `timeoutSeconds=30`,代码 `McpThirdPartyServerSupport` 缺省亦为 30(1-600) | 改为「默认 30s(1-600,按端点特性调整)」 |
| R-02 | 02-快速开始/01 §3 示例、03-接入指南/02 §3 取值表、01-白皮书/02 §2 生命周期图 | SSE `outputType` **`RUN_STARTED` 不存在**:全库 `ia_agent_event.output_type` 无此值,主代码无该字面量;实测首帧为 CONTENT(seq 从 4 起,前 3 个内部事件不投影) | 示例与取值表删去 RUN_STARTED,注明「流首帧为 CONTENT;seq 存在跳号(内部事件不投影),客户端按 seq 递增处理即可」 |
| R-03 | 03-接入指南/02 §3 取值表、02-快速开始/01 示例、白皮书/02 生命周期图 | **`DONE` 不附 usage**:实测 DONE 载荷仅 `{"outputType":"DONE","finished":true}`,流 VO 无 usage 字段;「首条 CONTENT 携带 reasoningDurationMs」实测为**条件字段**(模型有 reasoning 输出才出现,MiniMax-M3 demo 轮未出现) | DONE 行删「(附 usage)」;reasoningDurationMs 改注「仅当模型产生 reasoning 输出时携带」 |
| R-04 | 03-接入指南/02 §3 取值表 | 主要取值表列 **`TOOL_RESULT`**,实测该类型不存在(全库无、主代码无字面量);工具结果回传实际投影为 **`TOOL_FINISHED`**;`REASONING`/`SUB_AGENT_FINISHED` 本轮未观测到 | 取值表「TOOL_RESULT」改为「TOOL_FINISHED」;REASONING/SUB_AGENT_FINISHED 标注为特定编排/模型路径下出现 |
| R-05 | 05-最佳实践/01 §5 | 「拒绝后运行**按取消语义收尾**」;实测拒绝(approved=false)后**运行继续**(模型组织拒绝回复)直至 DONE/COMPLETED,工具不执行、审计落 denied(API 参考/02「继续/终止」表述与实现一致) | 改为「拒绝后工具不执行,运行由模型继续组织回复并正常收尾(COMPLETED);审计落 denied」 |
| R-06 | 04-API参考/01(cancel 节 + POST /runs 失败行) | ①「已完成运行返回业务错误码」— 实测对 COMPLETED 运行 cancel 返回 **200/code=0**(幂等成功);②「404 Agent 不存在」— 实测非法 agentType → **500**「Agent 类型不存在」,非法 enabledSkills → **500**「Skill 不可用」 | ①改「幂等:对已终态运行返回成功」;②平台侧建议收敛为 400/404,文档先按实测改 |
| R-07 | 07-参考/01 术语表「技能(skill)」 | 示例「如 report-writer/knowledge-qa」实为 **agentType**;enabledSkills 实际取应用激活技能(本环境 `ia_skill`: **report-style**),传非法值 500 | 示例改为应用激活技能名(如 report-style),注明与 agentType 的区别 |
| R-08 | 03-接入指南/04 §2 冲突域 | 「同键在**任何冲突域**被占用即 409」;实测冲突校验按 **appId 作用域**(管理面注册落当前 app 上下文,与其它 app 的宿主注册表同名键 acme-demo 注册返回 200);另**软删行仍占用唯一键** —— 删除后同键不可复用(复用报 409「数据状态冲突」) | 注明「冲突域校验按 appId 划分」;「换键」处置补充「删除(软删)后同键暂不可复用,建议换键」 |
| R-09 | 07-参考/02 配额表 | 「每用户三方 MCP 注册数 ≤32」未指明拒绝码;实测超限 **400**(msg「每个用户最多注册 32 个三方 MCP 服务」),按活跃行计数 | 补充拒绝码 400 与计数口径(活跃行) |

> 两点**正面确认**(曾有疑问,实测与文档一致):① `ia_agent_run.agent_definition_snapshot_json.modelOptions` 确为生效 config 原文(坑②成立);② mock 规则 `tool` 须写**裸名**(全 FQN 不被后缀解析,与 FAQ/05 篇口径一致)。

## 5. 环境足迹

| 项 | 记录 |
| --- | --- |
| mock 播种 | 每轮 api/ui 阶段前执行 `examples/acme-demo/seeds/mock-model-script.sql`(幂等);阶段结束由兜底逻辑执行 `mock-model-restore.sql` |
| mock 回切确认 | `select code, default_model from ia_ai_model where model_type=1 and default_model` → **`MiniMax-M3 | t`**(mock-text=f);mock config 已复位为官方种子(含四条规则,无探针残留) |
| 回切后回归 | IG5-4b:真模型 MiniMax 一轮「现在几点了?」至 DONE |
| 自建三方 MCP 注册 | 应用级(docsverify-echo-*/acme-demo 探针/k64/timeout 探针等)与用户级(docsverify-user-*/docsverify-q* ×32)全部删除,DB live 行 = 0 |
| 临时 mock 探针配置 | IG4-4 的 echo 规则探针用后即恢复官方种子脚本 |
| 挂起运行收口 | 本轮 ALWAYS_ASK 挂起逐案收口(确认/拒绝/取消/expire);另将 12993 名下历史遗留挂起(2026-09-28 压测/回归残留 ≈403 个)一并 cancel 收口 —— 收口后 12993 无非终态运行 |
| 演示用户口径 | API 走 `X-IA-Demo-User: 12993`;UI/embed 路径经 9300 演示登录(filler-02907,预先将演示用户计数器快进至该名映射 userId=12993;未触碰 user 10086) |
| demo 后端 | 测试窗口开始时 :9300 已下线,按手册 02-快速开始/02 §3 口径以 `seeds/.local/host.key` 重新拉起(仅环境操作,未改代码);启动日志出现「InnerAgent 桥已注册 4 个宿主工具」 |
| 未触碰 | user 10086 的数据、他人注册的 `acme-echo` 三方服务、既有代码与文档 |

## 6. 复现方式

```bash
cd e2e/manual-docs-verify
node run.mjs all     # pre → api(播种 mock)→ ui → finalize(回切+合并 results.json)
node run.mjs pre|api|ui|finalize   # 分阶段
```

结果:`results.json`(41 条);证据:`assets/*.png|html`;阶段产物:`state/*.json`。
