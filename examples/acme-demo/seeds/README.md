# ACME 仿真场景 Agent 种子库(seeds)

为 acme-demo 演示环境配套的 **5 个仿真场景 Agent**(5 main + 3 sub 定义)、Skill 包、
KB 语料与三方 MCP 演示服务器,以及一条幂等的 `provision.sh` 开通流水线。
所有内容为 ACME 公司业务语境的仿真数据,直接入库即可演示。

```
seeds/
├─ agent-bundle.json          # 8 个定义(5 main + 3 sub;schemaVersion=1)
├─ provision.sh               # 幂等开通:dryRun → 导入 → Skill → KB → 工具 → 三方 MCP
├─ skills/
│  ├─ report-style-src/       # Skill 包源目录(skill.json + SKILL.md + references/)
│  ├─ build-skills.sh         # zip 打包(产物 report-style.zip)
│  └─ report-style.zip        # 构建产物(可重生成)
├─ kb-docs/                   # 3 篇公司手册语料(请假/报销/产品 FAQ,每篇约 1000-1500 字)
├─ mcp-third-party/           # 零依赖 Node streamable-http MCP echo 服务器(见其 README)
└─ .local/                    # 本机生成物(宿主签名私钥;已 gitignore,不入库)
```

## 一键开通

```bash
zsh e2e/env.sh up                      # InnerAgent server @18090(IA_ADMIN_KEY=test-key)
zsh examples/acme-demo/seeds/provision.sh
```

可选环境变量:`IA_BASE_URL` / `IA_ADMIN_KEY` / `ACME_APP_KEY`(默认 acme-demo)/
`ACME_SKIP_MCP=1`(跳过三方 MCP)/ `ACME_MCP_PORT`(echo 服务器端口,默认 9401)。

流水线按序执行且**可重复执行**(幂等语义):

| 步骤 | 幂等做法 |
| --- | --- |
| [1] 应用解析/创建 | 按 appKey 查 `GET /admin/apps`,已存在不重建;签名密钥生成于 `seeds/.local/`(私钥不入库) |
| [2] bundle dryRun | `POST /admin/definitions/import?dryRun=true`,errors>0 直接中止 |
| [3] bundle 真实导入 | `conflictPolicy=overwrite`(按 bundle 覆盖同名字段),回查 main=5/sub=3 |
| [4] Skill 导入+激活 | 预览 0 error → `overwrite=true` 导入 → 未激活才激活;已达激活上限 8 时自动停用最早一个让位 |
| [5] KB 摄取 | 同名文档走 `PUT /admin/kb/documents/{id}`(带正文即重分块),不存在才导入;附检索冒烟 |
| [6] 宿主桥工具注册 | `GET /admin/tools?serverKey=acme-demo` 先查,已注册跳过(409 亦按跳过处理) |
| [7] 三方 MCP 注册 | `serverKey=acme-echo` 已存在跳过;echo 服务器未起则后台拉起(日志 /tmp/acme-echo-mcp.log) |

## 5 个演示 Agent:定义与能力矩阵

| agentType | 名称 | kind | 工具面 | 子 Agent 引用 | 主打能力 |
| --- | --- | --- | --- | --- | --- |
| `ticket-assistant` | 客服工单助手 | main | create_ticket(WRITE)/list_tickets/resolve_scope | - | 宿主桥工具 + 写操作确认卡 + SLA 语气 |
| `knowledge-qa` | 企业知识问答 | main | 无(纯 KB) | - | mini KB 检索注入 + [KB:id] 引用溯源 + 无命中不注入 |
| `report-writer` | 报告撰写助手 | main | 无 | - | Skill 按需注入(激活/不激活输出对比) |
| `ops-analyst` | 运维数据主管 | main | query_sales(READ) | sales-query、chart-pitch | 子 Agent 编排(parentRunId 层级/深度扇出护栏) |
| `master-demo` | 全栈演示官 | main | create_ticket(WRITE)/list_tickets | digest-writer | 四能力串演(全家桶收尾) |
| `sales-query` | 查数子 Agent | sub | query_sales(收敛) | - | 工具面收敛的查数执行器 |
| `chart-pitch` | 图表建议子 Agent | sub | 无 | - | 纯分析子 Agent(无工具) |
| `digest-writer` | 摘要子 Agent | sub | 无 | - | 材料压缩子 Agent(≤120 字) |

引用图:`ops-analyst → {sales-query, chart-pitch}`、`master-demo → digest-writer`,
无环、深度 ≤3、扇出 ≤5(导入侧做环检测,运行侧另有深度/并发/deadline 钳制护栏)。

每个 main 的 systemPrompt 都写明了「本场景演示什么」,选中即可感知;greeting
槽位配置了开场演示引导话术。

## 演示剧本(Demo Guide)

> 页面缩写:管理站 = `http://localhost:18081`(e2e 网关);宿主演示 =
> `http://localhost:9203`(acme-demo frontend,先起 backend 9300 + frontend)。
> **运行时须知**:对话运行内核当前读代码注册表(`AiAgentRegistry`),经管理面
> 导入的定义先落 `ia_agent_definition`(定义中心/导出/提示词编辑均可用),
> 聊天直呼新 agentType 需等「数据驱动内核」批次。下面的剧本按「现在就能演」
> 与「定义中心展示」两条线组织。

### 场景 1 · ticket-assistant 客服工单助手(现在就能演)

1. 打开宿主演示 `/ia/tools`,先用表单直建一张工单(channel=direct)做对照组。
2. 打开 `/ia/embed`(WC 模式),对助手说:
   **「帮我建一张工单,标题是支付页面报 500,优先级 high」**。
3. 预期现象:助手复述工单要素 → 弹出**确认卡**(WRITE 工具)→ 批准后
   `/ia/tools` 列表实时出现 channel=agent 的工单;拒绝则不落单。
4. 说「现在有哪些 open 工单」→ `list_tickets`(READ)自动执行不打扰。
5. 定义中心展示:管理站「Agent 定义」页看 `ticket-assistant` 的 SLA 语气提示词
   与工具白名单(本场景的可对话形态即演示机默认配置的能力超集)。

### 场景 2 · knowledge-qa 企业知识问答

1. 管理站「mini 知识库」页:确认 3 篇文档在库(请假制度/报销流程/产品 FAQ),
   点检索调试,输入 **「年假有几天」** → 看分段命中与来源锚点(provision 冒烟同款)。
2. 有真实模型时(管理站「模型」页配置),对助手问 **「差旅住宿上限是多少」** →
   预期回答基于注入的引用资料并以 `[KB:分段id]` 标注;运行详情可见 kb_citations。
3. 问一个语料外的问题(如「公司期权政策」)→ 预期明确回答
   **「知识库中没有找到相关资料」**,这就是「无命中不注入」的可感知形态。
4. 机制说明:检索在每次运行前按用户消息 top-k 命中,以 `<kb_references>` 区块
   注入执行输入(不改系统提示词);e2e 默认 mock 模型只会脚本回复,看引用溯源
   请切真实模型。

### 场景 3 · report-writer 报告撰写助手

1. 管理站「Skill」页:`report-style` 已激活(≤8 上限内),详情可见 SKILL.md
   与 references/outline.md 结构模板。
2. **对比实验**(核心):先不激活 Skill,用运行 API(`POST /ia/api/v1/runs`,
   不带 `enabledSkills`)让它写一份周报 → 通用写作习惯;
   再带上 `enabledSkills:["report-style"]` 重发同一请求 → 输出立即变成
   「执行摘要先行 + 关键数据表格 + 下一步动作带责任人与截止日」的规范形态。
   两次输出的差异 = Skill 按需注入的现象。
3. 反向演示:管理站把 Skill 停用 → 同请求报「Skill 不可用」→ 证明未激活不进上下文。

### 场景 4 · ops-analyst 运维数据主管

1. 定义中心展示:管理站「Agent 定义」页看 `ops-analyst` 的 spec ——
   工具面 `query_sales` + 两个子 Agent 引用(`sales-query`/`chart-pitch`),
   子条目带 toolName/refAgentType/parametersSchema;两个 sub 定义各自工具面收敛。
2. 查数底座:`/ia/embed` 对助手说 **「查一下 2026-09 华东的销售数据」** →
   `query_sales`(READ,经 /ia-mcp 桥)返回区域×月份×产品明细与合计——
   这就是子 Agent 未来真正调起的宿主工具。
3. 运行语义讲解(配 e2e specs 或 ai_media 的 `generate_storyboard_*` 子 Agent):
   每次子调起产生挂父运行之下的子运行(parentRunId 指向父),运行树/事件流可见
   父子层级;深度>3/并发>5 会被 429 拒绝,子 deadline 超父会被钳制——护栏由
   平台兜底,定义无需声明。
4. 对话直呼 `ops-analyst` 的完整编排体验,与场景 2/3 同批,等数据驱动内核批次。

### 场景 5 · master-demo 全栈演示官(收尾)

1. 对助手说 **「来一遍全面演示」**(提示词内置编排:①确认卡建单 → ②KB 引用
   问答 → ③Skill 写作规范 → ④子 Agent 摘要),每段自动报幕演示的是什么能力。
2. 单点抽查:建单确认卡(同场景 1)、「年假几天」(同场景 2)、
   `enabledSkills:["report-style"]` 写报告(同场景 3)、
   长材料让 `digest_material` 子 Agent 压成 ≤120 字摘要(同场景 4)。
3. 定义中心展示:`master-demo` 同时挂桥工具 + 一个 sub 引用,spec 一屏看全
   「能力全家桶」的声明形态。

## 已知边界(演示时如被问到)

- **运行时读代码注册表**:聊天运行的 agentType 现取自内核代码注册表;本目录
  导入的定义先在 `ia_agent_definition` 落库(定义中心/导出/提示词编辑可用),
  数据驱动内核切换批次后即可直接对话选中(02-技术方案 §4.6)。
- **应用归属**:定义导入走显式 `appId`(acme-demo 应用);KB 文档、宿主工具
  注册、三方 MCP 配置的管理面 API 目前无 appId 参数,固定落默认应用(id=1,
  行级拦截器口径)——种子与运行态检索按同处默认应用保持一致。
- **激活上限**:应用内同时激活 Skill 上限 8;provision 已做「先查再激活 +
  满员停用最早让位」。
- **仿真数据**:工单/销售数据为宿主内存态(重启即清);KB/Skill/定义/MCP
  配置落库,随环境存活。
