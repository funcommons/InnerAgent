import { describe, it, expect } from 'vitest'
import { SITE_FEATURES, SITE_STEPS } from '@/site/features'

describe('site/features(首页特性网格数据)', () => {
  it('共 8 张能力卡,id 唯一', () => {
    expect(SITE_FEATURES).toHaveLength(8)
    expect(new Set(SITE_FEATURES.map((f) => f.id)).size).toBe(8)
  })

  it('每卡:图标为 remixicon 类,链接指向 /docs/<section>', () => {
    for (const f of SITE_FEATURES) {
      expect(f.icon).toMatch(/^ri-[a-z0-9-]+-line$/)
      expect(f.docTo).toMatch(/^\/docs\/[a-z-]+$/)
    }
  })

  it('覆盖任务要求的八个能力点', () => {
    const ids = SITE_FEATURES.map((f) => f.id)
    expect(ids).toEqual(
      expect.arrayContaining([
        'dual-token', 'mcp-hub', 'confirm-flow', 'audit',
        'checkup', 'kill-switch', 'safety', 'north-star',
      ]),
    )
  })

  it('接入三步曲:固定三步', () => {
    expect(SITE_STEPS.map((s) => s.id)).toEqual(['step-1', 'step-2', 'step-3'])
  })
})
