/**
 * 5 个仿真场景 Agent 常量(场景画廊 /ia/agents 与 EmbedChat agentType 选择器共用)。
 *
 * 契约来源:examples/acme-demo/seeds/agent-bundle.json(5 main 定义)与
 * seeds/README.md「5 个演示 Agent:定义与能力矩阵」「演示剧本」。
 * agentType 拼写以种子库为准(契约测试 demoAgents.test.ts 直读种子 JSON 对齐);
 * 展示文案走 i18n(ia.demo.agents.<agentType>.* / ia.demo.capability.<id>,zh/en 双语)。
 */
import type { DocSectionId } from '@/site/docs/types'

/** 能力矩阵的 6 行(行=平台能力;列=场景,勾叉由各场景 capabilities 是否含该 id 决定) */
export const DEMO_CAPABILITIES = [
  'mcp-bridge',
  'confirm-flow',
  'kb-retrieval',
  'kb-citation',
  'skill-injection',
  'sub-agents',
] as const
export type DemoCapabilityId = (typeof DEMO_CAPABILITIES)[number]

/** 场景卡能力 chips 全集(矩阵 6 能力 + 场景特有补充) */
export const DEMO_CHIP_IDS = [
  ...DEMO_CAPABILITIES,
  'ticket-query',
  'kb-no-hit',
  'structured-template',
  'event-hierarchy',
  'data-query',
] as const
export type DemoChipId = (typeof DEMO_CHIP_IDS)[number]

export interface DemoAgentSpec {
  /** 与 seeds/agent-bundle.json 的 agentType 完全一致;同时是 i18n 键(ia.demo.agents.<agentType>) */
  readonly agentType: string
  /** 能力 chips(ia.demo.capability.<id>);其中 6 个矩阵能力同时决定矩阵勾叉 */
  readonly capabilities: readonly DemoChipId[]
  /** 关联文档章节 id(可深链 /docs/<docSectionId>) */
  readonly docSectionId: DocSectionId
}

export const DEMO_AGENTS = [
  {
    agentType: 'ticket-assistant',
    // create_ticket(WRITE 确认卡)/ list_tickets / resolve_scope,经 /ia-mcp 桥
    capabilities: ['mcp-bridge', 'confirm-flow', 'ticket-query'],
    docSectionId: 'tool-bridge',
  },
  {
    agentType: 'knowledge-qa',
    // 无工具纯 KB:top-k 检索注入 + [KB:分段id] 溯源 + 无命中不注入
    capabilities: ['kb-retrieval', 'kb-citation', 'kb-no-hit'],
    docSectionId: 'frontend-embed',
  },
  {
    agentType: 'report-writer',
    // 无工具:激活 report-style 前后输出对比(执行摘要先行 + 关键数据表格 + 动作项)
    capabilities: ['skill-injection', 'structured-template'],
    docSectionId: 'quickstart',
  },
  {
    agentType: 'ops-analyst',
    // query_sales(READ 经桥)+ sales-query / chart-pitch 两个子 Agent(parentRunId 层级)
    capabilities: ['mcp-bridge', 'sub-agents', 'event-hierarchy', 'data-query'],
    docSectionId: 'tool-bridge',
  },
  {
    agentType: 'master-demo',
    // 四能力串演:桥工具确认卡 + KB 引用 + Skill 规范 + digest-writer 子 Agent
    capabilities: ['mcp-bridge', 'confirm-flow', 'kb-retrieval', 'kb-citation', 'skill-injection', 'sub-agents'],
    docSectionId: 'quickstart',
  },
] as const satisfies readonly DemoAgentSpec[]

export type DemoAgentType = (typeof DEMO_AGENTS)[number]['agentType']

/** 全部场景 agentType(画廊卡片 / 矩阵列 / 选择器 options 的固定顺序) */
export const DEMO_AGENT_TYPES: readonly DemoAgentType[] = DEMO_AGENTS.map((a) => a.agentType)

/** 严格判断:值是否为 5 个演示场景之一(选择器持久化恢复 / 深链 query 校验) */
export function isDemoAgentType(value: unknown): value is DemoAgentType {
  return typeof value === 'string' && DEMO_AGENTS.some((a) => a.agentType === value)
}

/** 能力 × 场景矩阵:该场景的对话是否可感知此能力 */
export function hasCapability(agentType: string, capability: DemoCapabilityId): boolean {
  const agent = DEMO_AGENTS.find((a) => a.agentType === agentType)
  return agent?.capabilities.includes(capability) ?? false
}

/** EmbedChat agentType 选择器的 localStorage 键(useLocalStorage,JSON 字符串;'' = 后端默认) */
export const IA_EMBED_AGENT_TYPE_KEY = 'ia-embed-agent-type'
