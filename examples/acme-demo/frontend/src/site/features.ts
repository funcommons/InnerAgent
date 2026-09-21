/**
 * 产品首页特性网格数据(结构化 TS,文案走 i18n: home.features.items.<id>.*)。
 *
 * 八个能力卡全部来自产品真实事实(README / PRD §2 / 接入指南),
 * 每卡一个 remixicon 图标 + 一条指向 /docs 对应章节的深链。
 */

export interface SiteFeature {
  /** i18n key 后缀 + testid 后缀 */
  id: string
  /** remixicon 类名(ri-*-line) */
  icon: string
  /** 指向文档中心的章节深链 */
  docTo: string
}

export const SITE_FEATURES: SiteFeature[] = [
  { id: 'dual-token', icon: 'ri-key-2-line', docTo: '/docs/embed-token' },
  { id: 'mcp-hub', icon: 'ri-plug-line', docTo: '/docs/tool-bridge' },
  { id: 'confirm-flow', icon: 'ri-shield-check-line', docTo: '/docs/tool-bridge' },
  { id: 'audit', icon: 'ri-file-shield-2-line', docTo: '/docs/security' },
  { id: 'checkup', icon: 'ri-stethoscope-line', docTo: '/docs/app-registration' },
  { id: 'kill-switch', icon: 'ri-toggle-line', docTo: '/docs/tool-bridge' },
  { id: 'safety', icon: 'ri-eye-off-line', docTo: '/docs/security' },
  { id: 'north-star', icon: 'ri-line-chart-line', docTo: '/docs/endpoints' },
]

/** 接入三步曲(hero 下方步骤条;code 为展示用短代码行) */
export interface SiteStep {
  id: 'step-1' | 'step-2' | 'step-3'
}

export const SITE_STEPS: SiteStep[] = [
  { id: 'step-1' },
  { id: 'step-2' },
  { id: 'step-3' },
]
