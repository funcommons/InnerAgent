---
name: inneragent-implementation-state
description: InnerAgent 无人值守实现的目标协议、构建命令与阶段进度锚点
metadata:
  type: project
---

InnerAgent(/Users/justin/codes/funcommons/InnerAgent)正在无人值守实现四份文档(01-PRD V1.3 / 02-技术方案 V1.1 / 03-开发计划 V1.1 / 04-对标调研)。参考代码只读:/Users/justin/codes/funcommons/mmagix-minicuts-backup/(前端 frontend/,后端 ai-fusion-video/)。

**Why:** 目标是 /goal 持久指令(实现全部文档,多子agent分工,每步≤1000行,写测试→写代码→测试→修复循环,单任务测试仅测对应代码且由子agent异步执行,>10%或>1000行或>10任务触发全量测试);会话压缩后需凭此恢复。**用户编排约束:并发子 agent ≤3 个**(超出即排队,完成一个再放行下一个;死 agent 用 SendMessage 从 transcript 错峰恢复,进度无损);工作树被在途 agent 占 mvn 时不得改树/合并。

**How to apply:**
- 构建:`export JAVA_HOME=$(/usr/libexec/java_home -v 21)`(系统 mvn 默认 JDK17,必须覆盖)。数据库:docker/dev-compose.yml(PG 15432/Redis 16379,被占用 35432/36379+IA_DB_PORT/IA_REDIS_PORT)。迁移规范:inneragent-server/src/main/resources/db/migration/README.md(ia_ 前缀、app_id BIGINT NOT NULL DEFAULT 1);当前迁移链至 **V15**(24+ 张 ia_ 表,以 FlywayMigrationSmokeIT 为准)。
- 移植规范:scripts/port-kernel.sh + scripts/audit-port-diff.sh;[port]/[adapt] 标注;映射 service/ai/agentscope→com.inneragent.agent.{kernel,state,workspace,mcp,skill,context,runtime,message,permission,tool},run→agent.run,provider→model.provider,未移植依赖→platform.*。
- **关键钉版/语义**:MCP SDK=io.modelcontextprotocol.sdk:mcp **0.17.0 勿升 2.0.1**(agentscope-core 2.0.0 传递依赖;客户端须关 resumableStreams/openConnectionOnStartup;session 恢复=单飞重建客户端);stateless 宿主桥=HttpServletStatelessServerTransport;X-IA-Act 三段挂点=httpRequestCustomizer→Jakarta Filter 401 fail-closed→contextExtractor;dashscope starter 自动配置已排除;swagger-annotations pinned 2.2.43;okio 钉 3.16.4(okhttp-jvm 5.3.2 需 Okio.socket())。
- **流程纪律(血泪)**:①合并分支前确认主树 mvn 空闲;合并后必跑合并态全量回归(抓到过 McpToolCatalog 缺 @Autowired 的装配回归)②**E2E 起服务前核对 server jar 时间戳 vs HEAD**(R3 教训:旧 jar 误判)③**共享实体加列必须过真库 IT**——MyBatis-Plus 整行 updateById 会连带非空列,JsonbTypeHandler 是 MySQL 形(setString),运行态连接串无 stringtype=unspecified 即炸(R3 DEF-08);健康/配置类新列用 TEXT+服务层 JSON 序列化④MP updateById 跳过 null 字段,「清空」语义必须 LambdaUpdateWrapper 显式 SET(resume/webhook url 同族教训)⑤e2e 常驻基建:e2e/env.sh up|down,15 spec/84+ 用例(gateway.mjs=web dist 静态+反代,绕开 msw dev mock;reconnect-host.mjs=可断中转)。

**阶段进度:**
- **P0 移植基座 ✅**(275 主文件+44 兼容类,审计 PASS,smoke 真跑,286 单测绿)。
- **P1 ✅ 关闭(2026-09-20)**:身份双层+embed/act 双级令牌+JWKS+admin 注册(AppContext/UserContext/EmbedTokenVerifier/ActTokenIssuer 72h 轮换宽限/AdminTokenFilter 双轨);工具中枢(注册/sha256 指纹分诊 V14/grant→确认档位/resolve_scope 降级/McpToolCatalog∪yml 并集进内核工具面);starter 四职责(stateless 桥/验签 Filter/占位/自动装配,@ConditionalOnMissingBean 声明即接管);SDK(core baseURL+tokenGetter 401 懒换单飞+<inneragent-chat> WC,element-plus 全拆);API 面 /ia/api/v1/* 一次性切换;真机验收=M0 活体 8/8+U1 宿主旅程 26/26+M1 四场景(U1-U3/U5)全贯通。终态:surefire 429+failsafe 71+starter 44。
- **P2 基本完成**:
  - 首批(#13/14/15/17)✅:管理站对齐/服务端收口(铲除 P0 匿名明文密钥泄漏面)/SCOPE_RESOLVED 契约/密钥脱敏+V9 轮换宽限。
  - W5 三路(18a/18b/18c)✅:管理员认证(V10 Argon2id+HS256 会话+锁定+登录审计,AdminTokenFilter 双轨)、审计检索+读时脱敏、Webhook 投递(V11 HMAC 签名+退避重试+SKIP LOCKED 不重投+redeliver)、OTel GenAI span 工厂(四挂点,内容默认关)、demo-spring-host+M1 旅程。okio 根因修复。嵌入认证域隔离(embed 过滤器跳过 /admin/**)。
  - **/loop E2E 测试修复循环 ✅(R1→R4)**:R1 十线 63 用例→7 缺陷(5P1+2P2,DEF-01~07)→修复 8 提交→R2 64+18 全绿→交付 99-优化建议 26 条→「修 P0~P3」三路全落(413/熔断紧急停用 V14/ILIKE/错误语义表/管理站 18 条/SDK 6 条)→R3 抓 DEF-08(JSONB 写路径回归)+DEF-09→修复(V15+真库守卫 IT+resume 清空连带)→R4 定点 20/20 全绿,**26/26 终版矩阵**。报告:test-report/2026-09-21-01~04/(00-统一测试报告/99-优化建议/00-R3验证报告)。终态:surefire 604+failsafe 83+web 148+sdk 238+starter 44。
- **P2 尾批(#18)三路在跑(2026-09-21 晚)**:①主树=定义导入导出(bundle 形状为 P3/W7 融光预留)+提示词编辑+webhook 显式清空(OBS-R4-1 同族)+grants/tools 分页+yml 静态 MCP 裁决落码 ②worktree=工具体检 v1(health 三态;健康列用 TEXT 勿 JSONB)+内容安全接入点(ContentSafetyFilter SPI+HTTP 回调,默认 fail-open)③docs/**=接入指南+工具设计规范+运维裁决记录。完成后:合并②(注意 V16 编号)→全量回归→web 适配小批(分页接参/指纹列/体检位/安全占位)。
- **后续阶段**:P3 融光灰度(W7-W8 开发:融光 starter 接入+ASSISTANT_BACKEND flag+17 定义 22 提示词导出脚本+golden-diff;W9-W12 灰度)→P4 增强(用量统计/Skill/KB/iframe postMessage W15/混沌专项)。

- **P4-demo 管理台嵌入定稿(2026-09-22,5f8a66d)**:用户三拍板——①管理能力归 InnerAgent 域,Skill/KB/MCP 不做 APP 端;②demo 自建 Agent 管理页+后端代理彻底删除(git 留档);③不做 SSO,iframe 整站嵌 18081(默认 /definitions),入口与总览/画廊/嵌入/工具侧栏并列。**教训:iframe 文档 origin=iframe 的 src(18081)而非外层页(9203),CORS 必须双来源放行**(env.sh 缺省已含 9203,18081)。demo 截 04 用 `page.frameLocator('[data-testid="ia-admin-frame"]')`,登录按钮文本「登录」。
- **P4-demo 能力覆盖盘点 ✅(2026-09-22 晚)**:①/ia/overview 新增「中台能力↔DEMO 体验入口」覆盖表(19 行,行=链接或「内核保障」标注,Overview.test.ts 3 用例守门);②管理台 12 页 iframe 逐页 playwright 走查截图全过(test-report/2026-09-22-02/assets/admin-01~14);③grants 有管理台 UI(tools 页「用户授权」Tab);④vitest 476/476+vue-tsc 净。**教训:IAB guest 进程会整体僵化(截图 fail for guest+输入事件不到达、CDP fill/evaluate 仍通、新标签页同坏)→ 浏览器走查改用项目自带 playwright;走查前必须重建 web/dist(gitignore 产物,gateway 即时读盘)**。
- **Skill 注入静默失效修复 ✅(2026-09-23)**:provision.sh 按目标应用 provisioning 复核挖出真缺陷——管理面请求(X-IA-Admin-Key)无线程 AppContext,行级拦截器注入 app_id=1:ia_skill 显式 appId≠1 读写被叠加恒空、KB 控制器只有 currentOrDefault,provision 落缺省应用而 embed 运行态按宿主应用(34)解析 → report-writer 技能注入静默失效。修复=AppSkillCatalogService 管理面六方法 + AdminKbController 九端点包 runAsSystem/补显式 appId(同 definitions 先例);provision.sh 全链传 appId。守卫 IT SkillAdminAppScopeIT 4 用例(编程式 MyBatis+Testcontainers,**IT 里 selectPage 的 total 依赖 PaginationInnerInterceptor,编程式装配必须手动加**)。全量 surefire 849+failsafe 142 绿;embed 上下文实测 report-style 回归。**同族坑:管理面新服务一律 runAsSystem+显式 appId**。
- **agentscope 2.0.3 评估定论(2026-09-23):暂不升级**。本地 jar 逐类 md5 对比:2.0.3 变更 218 类+移除 2,本项目消费的 102 个类逐字节未变;其 subagent-bugfix 修的是上游 SubagentsMiddleware 区,与我们的平台层自研级联取消(CancellationCoordinator.cancelChildren,PlatformSubAgentRunService)无交集。需要上游新能力(SessionTranscriptWriter/ArtifactDelivery)时再按全量回归+golden-diff 升。**方法论:dependency:get 双版本→逐类哈希 diff→与 import 消费面求交**。

**残留台账(均不阻断,按批处理):**
- webhook url 空串清空与 ia_storage_config.options JSONB 化(MP null 跳过同族,建议同批 TEXT 化);types.ts:477 旧契约注释(#25 lint 收清单前置);limits 内核执行层仅管理面落库未强制;紧急停用只拒新 run 不批量取消;多实例 jti 黑名单 Redis 化(P3);双 okhttp jar 共存(钉版已消症);写时脱敏(读时已做);ia_ai_model 管理 CRUD/presets 未重建;object 级 Guard 宿主 demo 未演示;yml 静态 MCP 双通道裁决待落文档(批次①在做)。
- 启动:docker compose up -d → `mvn spring-boot:run`(local profile,演示头 X-IA-Demo-User=12993;admin 引导 IA_ADMIN_KEY+IA_ADMIN_BOOTSTRAP_PASSWORD)。smoke:scripts/smoke-sse.sh;/loop 旅程:scripts/e2e-host-journey.sh、e2e-m1-journeys.sh。
