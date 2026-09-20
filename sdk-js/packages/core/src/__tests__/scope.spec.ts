/**
 * [new] P2-scope 任务 #15:约束范围解析单测(core 纯函数层)。
 *
 * 契约要点:
 * - 旧事件无 scope 字段 → 归一化 degraded(fail-closed)+ UI 弱提示,不报协议错误;
 * - 服务端 v1 不变式 degraded == !resolved;矛盾/畸形形态一律按 degraded;
 * - 批提取:任一 degraded → 整批 degraded;空批 → degraded 缺省。
 */
import { describe, expect, it } from 'vitest'

import type { PendingToolCallInfo, ToolCallScope } from '../runs'
import {
  DEGRADED_SCOPE,
  normalizeToolCallScope,
  pendingScopeDigest,
} from '../scope'

describe('normalizeToolCallScope(确认等待事件 scope 归一化)', () => {
  it('旧事件(无 scope 字段)→ degraded 缺省(fail-closed,不抛错)', () => {
    expect(normalizeToolCallScope(undefined)).toEqual(DEGRADED_SCOPE)
    expect(normalizeToolCallScope()).toEqual(DEGRADED_SCOPE)
  })

  it('resolved 形态(服务端宿主实现 resolve_scope)→ 原样透传', () => {
    expect(normalizeToolCallScope({ resolved: true, degraded: false })).toEqual({
      resolved: true,
      degraded: false,
    })
  })

  it('degraded 形态保留稳定原因 summary', () => {
    const scope: ToolCallScope = {
      resolved: false,
      degraded: true,
      summary: '宿主未实现约束范围反查(resolve_scope),本次运行无约束范围上下文',
    }
    expect(normalizeToolCallScope(scope)).toEqual(scope)
  })

  it('矛盾形态(degraded=false 但 resolved=false)按 degraded 兜底', () => {
    expect(normalizeToolCallScope({ resolved: false, degraded: false })).toEqual(
      DEGRADED_SCOPE,
    )
  })

  it('畸形字段(缺 boolean / 非对象)按 degraded 兜底', () => {
    expect(normalizeToolCallScope({} as ToolCallScope)).toEqual(DEGRADED_SCOPE)
    expect(
      normalizeToolCallScope({ resolved: 'yes' as unknown as boolean, degraded: false }),
    ).toEqual(DEGRADED_SCOPE)
    expect(normalizeToolCallScope(null as unknown as ToolCallScope)).toEqual(
      DEGRADED_SCOPE,
    )
    expect(normalizeToolCallScope([] as unknown as ToolCallScope)).toEqual(
      DEGRADED_SCOPE,
    )
  })
})

describe('pendingScopeDigest(批提取 → 确认条渲染输入)', () => {
  const call = (scope?: ToolCallScope): PendingToolCallInfo => ({
    toolCallId: 'tc-1',
    toolName: 'mcp__crm__update_contact',
    argumentsPreview: '{}',
    ...(scope ? { scope } : {}),
  })

  it('双工具均 resolved → resolved 态(summary 可缺省)', () => {
    expect(
      pendingScopeDigest([
        call({ resolved: true, degraded: false }),
        {
          toolCallId: 'tc-2',
          toolName: 't2',
          argumentsPreview: '{}',
          scope: { resolved: true, degraded: false },
        },
      ]),
    ).toEqual({ resolved: true, degraded: false })
  })

  it('旧事件(均无 scope)→ 整批 degraded 弱提示(兼容矩阵)', () => {
    expect(pendingScopeDigest([call(), call()])).toEqual(DEGRADED_SCOPE)
  })

  it('任一 degraded → 整批 degraded;degraded 摘要优先', () => {
    const digest = pendingScopeDigest([
      call({ resolved: true, degraded: false, summary: '只读范围' }),
      call({ resolved: false, degraded: true, summary: '降级原因' }),
    ])
    expect(digest).toEqual({ resolved: false, degraded: true, summary: '降级原因' })
  })

  it('空批/缺省入参 → degraded 缺省', () => {
    expect(pendingScopeDigest([])).toEqual(DEGRADED_SCOPE)
    expect(pendingScopeDigest(undefined)).toEqual(DEGRADED_SCOPE)
  })
})
