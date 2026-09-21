import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  DEMO_AGENTS,
  DEMO_AGENT_TYPES,
  DEMO_CAPABILITIES,
  DEMO_CHIP_IDS,
  IA_EMBED_AGENT_TYPE_KEY,
  hasCapability,
  isDemoAgentType,
} from '@/ia/demoAgents'
import { DOC_SECTION_IDS } from '@/site/docs/types'
import zhCN from '@/locales/zh-CN'
import enUS from '@/locales/en-US'

/**
 * 5 场景契约:agentType 拼写直读 seeds/agent-bundle.json 对齐(防漂移);
 * 能力矩阵勾叉、文档深链、双语 i18n 文案齐备。
 */
function seedBundle(): { definitions: Array<{ agentType: string; specJson?: { kind?: string } }> } {
  // vitest 固定以 frontend 为 cwd 运行;种子库在 acme-demo/seeds/agent-bundle.json
  return JSON.parse(readFileSync(resolve(process.cwd(), '../seeds/agent-bundle.json'), 'utf8'))
}

/** 读 i18n 嵌套叶子(测试断言用,不走 vue-i18n 运行时) */
function msg(tree: unknown, path: string): unknown {
  let node: unknown = tree
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[key] ?? undefined
  }
  return node
}

describe('demoAgents(5 场景契约)', () => {
  it('5 个场景,agentType 拼写与 seeds/agent-bundle.json 的 main 定义一致', () => {
    const seedMains = seedBundle()
      .definitions.filter((d) => d.specJson?.kind === 'main')
      .map((d) => d.agentType)
      .sort()
    expect(DEMO_AGENT_TYPES).toHaveLength(5)
    expect([...DEMO_AGENT_TYPES].sort()).toEqual(seedMains)
  })

  it('每个场景:chips 无重复且在全集内,docSectionId 均可深链 /docs/:id', () => {
    for (const a of DEMO_AGENTS) {
      expect(a.capabilities.length).toBeGreaterThan(0)
      expect(new Set(a.capabilities).size).toBe(a.capabilities.length)
      for (const c of a.capabilities) expect(DEMO_CHIP_IDS).toContain(c)
      expect(DOC_SECTION_IDS).toContain(a.docSectionId)
    }
  })

  it('能力 × 场景矩阵勾叉与 seeds 主打能力一致', () => {
    // ticket-assistant:桥工具 + 写确认卡;无 KB / Skill / 子 Agent
    expect(hasCapability('ticket-assistant', 'mcp-bridge')).toBe(true)
    expect(hasCapability('ticket-assistant', 'confirm-flow')).toBe(true)
    expect(hasCapability('ticket-assistant', 'kb-retrieval')).toBe(false)
    expect(hasCapability('ticket-assistant', 'sub-agents')).toBe(false)
    // knowledge-qa:纯 KB(检索 + 溯源);无桥 / 确认流
    expect(hasCapability('knowledge-qa', 'kb-retrieval')).toBe(true)
    expect(hasCapability('knowledge-qa', 'kb-citation')).toBe(true)
    expect(hasCapability('knowledge-qa', 'mcp-bridge')).toBe(false)
    expect(hasCapability('knowledge-qa', 'confirm-flow')).toBe(false)
    // report-writer:仅 Skill 注入
    expect(hasCapability('report-writer', 'skill-injection')).toBe(true)
    expect(hasCapability('report-writer', 'kb-retrieval')).toBe(false)
    expect(hasCapability('report-writer', 'mcp-bridge')).toBe(false)
    // ops-analyst:query_sales(READ 经桥)+ 子 Agent;无确认流
    expect(hasCapability('ops-analyst', 'mcp-bridge')).toBe(true)
    expect(hasCapability('ops-analyst', 'sub-agents')).toBe(true)
    expect(hasCapability('ops-analyst', 'confirm-flow')).toBe(false)
    // master-demo:6 项矩阵能力全勾(全家桶)
    for (const c of DEMO_CAPABILITIES) expect(hasCapability('master-demo', c)).toBe(true)
    // 未知场景一律无能力
    expect(hasCapability('ai_media', 'mcp-bridge')).toBe(false)
  })

  it('isDemoAgentType 收敛判断(选择器持久化恢复 / 深链 query 校验)', () => {
    expect(isDemoAgentType('ticket-assistant')).toBe(true)
    expect(isDemoAgentType('master-demo')).toBe(true)
    expect(isDemoAgentType('ai_media')).toBe(false) // 后端默认 agentType 不是演示场景
    expect(isDemoAgentType('')).toBe(false)
    expect(isDemoAgentType(null)).toBe(false)
    expect(isDemoAgentType(42)).toBe(false)
  })

  it('双语 i18n 齐备:场景 name/tagline/script(≥3 步,步数 zh=en)与全部 chip 文案', () => {
    for (const a of DEMO_AGENTS) {
      for (const leaf of ['name', 'tagline']) {
        const key = `ia.demo.agents.${a.agentType}.${leaf}`
        expect(typeof msg(zhCN, key)).toBe('string')
        expect((msg(zhCN, key) as string).length).toBeGreaterThan(0)
        expect(typeof msg(enUS, key)).toBe('string')
        expect((msg(enUS, key) as string).length).toBeGreaterThan(0)
      }
      const zhScript = msg(zhCN, `ia.demo.agents.${a.agentType}.script`)
      const enScript = msg(enUS, `ia.demo.agents.${a.agentType}.script`)
      expect(Array.isArray(zhScript)).toBe(true)
      expect(Array.isArray(enScript)).toBe(true)
      expect((zhScript as string[]).length).toBeGreaterThanOrEqual(3)
      expect((enScript as string[]).length).toBe((zhScript as string[]).length)
    }
    for (const c of DEMO_CHIP_IDS) {
      expect(typeof msg(zhCN, `ia.demo.capability.${c}`)).toBe('string')
      expect(typeof msg(enUS, `ia.demo.capability.${c}`)).toBe('string')
    }
  })

  it('选择器 localStorage 键名稳定(跨版本恢复语义)', () => {
    expect(IA_EMBED_AGENT_TYPE_KEY).toBe('ia-embed-agent-type')
  })
})
