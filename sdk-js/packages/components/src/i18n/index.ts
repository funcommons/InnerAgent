/**
 * [new] 轻量 i18n — 替代 vue-i18n (SDK 去依赖)。
 *
 * API 兼容组件用到的子集: `t(key, params?)` / `te(key)`; 文案内插 `{name}`,
 * 兼容 vue-i18n 字面量转义 `{'@'}`。zh-CN 默认, en-US 备选; 缺失 key 原样返回
 * (与 vue-i18n 回退行为等价的兜底)。
 */
import { computed, ref } from 'vue'
import { zhCN, enUS } from './messages'

export type IaLocale = 'zh-CN' | 'en-US'

const MESSAGES: Record<IaLocale, Record<string, string>> = {
  'zh-CN': zhCN,
  'en-US': enUS,
}

const locale = ref<IaLocale>('zh-CN')

/** 切换 SDK 内置文案语言 (不影响宿主应用)。 */
export function setIaLocale(next: IaLocale): void {
  locale.value = next
}

function interpolate(template: string, params?: Record<string, unknown>): string {
  let result = template.replace(/\{'([^']*)'\}/g, '$1')
  if (params) {
    result = result.replace(/\{(\w+)\}/g, (match, name: string) =>
      Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match)
  }
  return result
}

export function useI18n() {
  const messages = computed(() => MESSAGES[locale.value])
  const t = (key: string, params?: Record<string, unknown>): string => {
    const template = messages.value[key]
    if (template === undefined) return key
    return interpolate(template, params)
  }
  const te = (key: string): boolean => messages.value[key] !== undefined
  return { t, te, locale }
}
