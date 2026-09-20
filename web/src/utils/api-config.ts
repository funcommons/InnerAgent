/**
 * [adapt] 来源: $SRC/frontend/src/utils/api-config.ts (mmagix-minicuts-backup/frontend/src/utils/api-config.ts)
 * 改动类型: [adapt] —— 拆除的业务依赖:
 *   - 图像/视频协议域(InnerAgent 仅文本协议,PRD §6.3 五协议;方案 §4.4 去图像/视频列)
 *   - GoogleFlowReverseApi / vertex_ai / comfyui / newapi / agnes / volcengine 平台
 *   - i18n labelKey(改中文常量)
 * 保留(机械复制+改造):平台动态字段 getPlatformFields、deepseek→openai_compatible
 * 归一 normalizePlatform、表单默认/回填/保存 payload(代理清理逻辑)、
 * 代理完整性校验 isProxyFormInvalid、密钥脱敏 maskSecret。
 * [new] 新增:anthropic/gemini/ollama 提供商预设;密钥未修改哨兵 KEY_UNCHANGED。
 */
import type { ModelApiConfigSaveReq, ModelPlatform } from '@/api/types'

/** 协议下拉的"未配置"哨兵值(沿用 $SRC UNSET_PROTOCOL_VALUE) */
export const UNSET_PROTOCOL_VALUE = '__unset_protocol__'

/** 编辑时密钥留空 = 不修改 */
export const KEY_UNCHANGED = ''

// ========== 平台动态字段(对齐 $SRC getPlatformFields,五协议裁剪) ==========

export type PlatformFieldKey = 'apiUrl' | 'apiKey'

export interface PlatformFieldDef {
  key: PlatformFieldKey
  label: string
  placeholder: string
  type?: 'text' | 'password'
  required?: boolean
  multiline?: boolean
  helper?: string
}

const F_API_URL: PlatformFieldDef = { key: 'apiUrl', label: 'API 地址', placeholder: 'https://...' }
const F_API_KEY: PlatformFieldDef = { key: 'apiKey', label: 'API Key', placeholder: 'sk-...', type: 'password', required: true }

/** 各平台需要展示的连接/鉴权字段(对齐 $SRC getPlatformFields,InnerAgent 五协议) */
export function getPlatformFields(platform: string | null | undefined): PlatformFieldDef[] {
  switch (platform) {
    case 'openai_compatible':
      return [
        { ...F_API_URL, helper: '兼容 OpenAI Chat Completions 的服务地址;勾选「自动补充 /v1」时只填到域名' },
        { ...F_API_KEY },
      ]
    case 'anthropic':
      return [
        { ...F_API_URL, placeholder: 'https://api.anthropic.com(默认可留空)' },
        { ...F_API_KEY, placeholder: 'sk-ant-...' },
      ]
    case 'gemini':
      return [
        { key: 'apiKey', label: 'API Key', placeholder: 'AIza...', type: 'password', required: true, helper: 'Gemini Developer API 密钥' },
      ]
    case 'dashscope':
      return [
        { ...F_API_URL, placeholder: 'https://dashscope.aliyuncs.com', helper: '阿里云百炼 / DashScope;国内生产推荐(PRD §6.3)' },
        { ...F_API_KEY },
      ]
    case 'ollama':
      return [{ key: 'apiUrl', label: '服务地址', placeholder: 'http://localhost:11434', required: true, helper: '本地/私有化 Ollama,无需密钥' }]
    default:
      return [{ ...F_API_URL }, { ...F_API_KEY, required: undefined }]
  }
}

// ========== 平台 / 提供商预设 ==========

/** 旧 deepseek 平台值已并入 openai_compatible(对齐 $SRC normalizePlatform) */
export function normalizePlatform(platform: string | null | undefined): string {
  if (platform === 'deepseek') return 'openai_compatible'
  return platform || ''
}

export interface ApiProviderPreset {
  id: string
  platform: ModelPlatform
  label: string
  url: string
  textProtocol: string
}

/** 常用提供商快捷填入(对齐 $SRC API_PROVIDER_PRESETS,裁剪 + [new] 五协议补全) */
export const API_PROVIDER_PRESETS: readonly ApiProviderPreset[] = [
  { id: 'deepseek', platform: 'openai_compatible', label: 'DeepSeek', url: 'https://api.deepseek.com', textProtocol: 'openai_compatible' },
  { id: 'dashscope', platform: 'dashscope', label: '阿里 DashScope', url: 'https://dashscope.aliyuncs.com', textProtocol: 'dashscope' },
  { id: 'openai', platform: 'openai_compatible', label: 'OpenAI', url: 'https://api.openai.com', textProtocol: 'openai_compatible' },
  { id: 'anthropic', platform: 'anthropic', label: 'Anthropic', url: 'https://api.anthropic.com', textProtocol: 'anthropic' },
  { id: 'gemini', platform: 'gemini', label: 'Google Gemini', url: 'https://generativelanguage.googleapis.com', textProtocol: 'gemini' },
  { id: 'ollama', platform: 'ollama', label: 'Ollama(本地)', url: 'http://localhost:11434', textProtocol: 'ollama' },
]

// ========== 平台字典 ==========

export const PLATFORM_OPTIONS: Array<{ value: ModelPlatform; label: string; description: string }> = [
  { value: 'openai_compatible', label: 'OpenAI / 兼容接入', description: 'API Key / Bearer 鉴权,覆盖 DeepSeek/Qwen 等兼容服务' },
  { value: 'anthropic', label: 'Anthropic', description: 'Claude 系列模型' },
  { value: 'gemini', label: 'Google Gemini', description: 'AI Studio / Gemini Developer API' },
  { value: 'dashscope', label: '阿里 DashScope', description: '通义千问;国内生产推荐' },
  { value: 'ollama', label: 'Ollama', description: '本地/私有化部署开源模型' },
]

// ========== 表单状态(文本协议单槽,替代 $SRC 三协议槽) ==========

export interface ApiConfigFormState {
  id?: number
  name: string
  platform: string
  apiUrl: string
  autoAppendV1Path: boolean
  proxyType: string
  proxyHost: string
  proxyPort: number | undefined
  proxyUsername: string
  proxyPassword: string
  /** 编辑留空(KEY_UNCHANGED)= 不修改密钥 */
  apiKey: string
  status: number
  remark: string
}

/** 新建默认值(对齐 $SRC emptyApiConfigForm;textProtocol 槽已剥离——五协议下协议即平台) */
export function emptyApiConfigForm(): ApiConfigFormState {
  return {
    name: '',
    platform: 'openai_compatible',
    apiUrl: '',
    autoAppendV1Path: true,
    proxyType: 'none',
    proxyHost: '',
    proxyPort: undefined,
    proxyUsername: '',
    proxyPassword: '',
    apiKey: KEY_UNCHANGED,
    status: 1,
    remark: '',
  }
}

/** 编辑回填(对齐 $SRC apiConfigToForm):deepseek 历史值归一 + 缺省兜底 */
export interface ApiConfigLike {
  id: number
  name: string
  platform: string | null
  apiUrl: string | null
  autoAppendV1Path: boolean
  proxyType: string | null
  proxyHost: string | null
  proxyPort: number | null
  proxyUsername: string | null
  status: number
  remark: string | null
}

export function apiConfigToForm(config: ApiConfigLike): ApiConfigFormState {
  return {
    id: config.id,
    name: config.name,
    platform: normalizePlatform(config.platform),
    apiUrl: config.apiUrl || '',
    autoAppendV1Path: config.autoAppendV1Path ?? true,
    proxyType: config.proxyType || 'none',
    proxyHost: config.proxyHost || '',
    proxyPort: config.proxyPort ?? undefined,
    proxyUsername: config.proxyUsername || '',
    proxyPassword: '',
    apiKey: KEY_UNCHANGED,
    status: config.status,
    remark: config.remark || '',
  }
}

/** 保存 payload 组装(对齐 $SRC buildApiConfigSavePayload:代理未启用清空全部代理字段;无用户名时密码清空) */
export function buildApiConfigSavePayload(form: ApiConfigFormState): ModelApiConfigSaveReq {
  const proxyEnabled = Boolean(form.proxyType && form.proxyType !== 'none')
  const payload: ModelApiConfigSaveReq = {
    id: form.id,
    name: form.name,
    platform: (normalizePlatform(form.platform) || 'openai_compatible') as ModelPlatform,
    apiUrl: form.apiUrl,
    autoAppendV1Path: form.autoAppendV1Path,
    proxyType: proxyEnabled ? form.proxyType : 'none',
    proxyHost: proxyEnabled ? form.proxyHost.trim() : '',
    proxyPort: proxyEnabled ? form.proxyPort : undefined,
    proxyUsername: proxyEnabled ? form.proxyUsername.trim() : '',
    proxyPassword: proxyEnabled && form.proxyUsername.trim() ? form.proxyPassword : '',
    status: form.status,
    remark: form.remark,
  }
  // 密钥留空 = 不修改(编辑态);仅在有输入时下发
  if (form.apiKey !== KEY_UNCHANGED && form.apiKey.trim() !== '') {
    payload.apiKey = form.apiKey.trim()
  }
  return payload
}

export interface ProxyFormSlice {
  proxyType: string
  proxyHost: string
  proxyPort: number | undefined
  proxyUsername: string
  proxyPassword: string
}

/** 代理启用时的完整性校验(对齐 $SRC isProxyFormInvalid) */
export function isProxyFormInvalid(form: ProxyFormSlice): boolean {
  const enabled = Boolean(form.proxyType && form.proxyType !== 'none')
  if (!enabled) return false
  return Boolean(
    !form.proxyHost.trim()
    || !form.proxyPort
    || form.proxyPort < 1
    || form.proxyPort > 65535
    || (!!form.proxyPassword && !form.proxyUsername.trim()),
  )
}

// ========== 密钥脱敏(对齐 $SRC maskSecret) ==========

/** 空返回空串;≤8 位全打码;长值保留首尾各 4 位 */
export function maskSecret(value: string | null | undefined): string {
  if (!value) return ''
  if (value.length <= 8) return '••••••••'
  return value.slice(0, 4) + '••••' + value.slice(-4)
}

/** 平台显示名 */
export function platformLabel(platform: string | null | undefined): string {
  return PLATFORM_OPTIONS.find(p => p.value === normalizePlatform(platform))?.label ?? (platform || '—')
}
