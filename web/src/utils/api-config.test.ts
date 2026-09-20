/**
 * [adapt] api-config 纯逻辑层测试(对齐 $SRC model-config-form.test.ts /
 * api-config-dialog.test.ts 中的纯函数用例,按五协议裁剪改写)。
 */
import { describe, expect, it } from 'vitest'
import {
  buildApiConfigSavePayload, emptyApiConfigForm, apiConfigToForm,
  getPlatformFields, isProxyFormInvalid, maskSecret,
  normalizePlatform, platformLabel, API_PROVIDER_PRESETS, KEY_UNCHANGED,
} from './api-config'

describe('api-config [adapt] 纯逻辑层', () => {
  it('normalizePlatform:deepseek 历史值并入 openai_compatible(保留 $SRC 行为)', () => {
    expect(normalizePlatform('deepseek')).toBe('openai_compatible')
    expect(normalizePlatform('dashscope')).toBe('dashscope')
    expect(normalizePlatform(null)).toBe('')
  })

  it('getPlatformFields:五协议各自字段;ollama 无密钥;gemini 密钥必填', () => {
    const openai = getPlatformFields('openai_compatible')
    expect(openai.map(f => f.key)).toEqual(['apiUrl', 'apiKey'])
    const ollama = getPlatformFields('ollama')
    expect(ollama.map(f => f.key)).toEqual(['apiUrl'])
    const gemini = getPlatformFields('gemini')
    expect(gemini).toHaveLength(1)
    expect(gemini[0]!.required).toBe(true)
    // 未知平台回落默认
    expect(getPlatformFields('unknown_x').map(f => f.key)).toEqual(['apiUrl', 'apiKey'])
  })

  it('emptyApiConfigForm 默认 openai_compatible + 自动补 /v1 + 密钥哨兵;textProtocol 默认跟随平台', () => {
    const form = emptyApiConfigForm()
    expect(form.platform).toBe('openai_compatible')
    expect(form.autoAppendV1Path).toBe(true)
    expect(form.proxyType).toBe('none')
    expect(form.apiKey).toBe(KEY_UNCHANGED)
    // #16:textProtocol 默认空 = 跟随平台,不显式下发
    expect(form.textProtocol).toBe('')
  })

  it('apiConfigToForm:回填归一与兜底', () => {
    const form = apiConfigToForm({
      id: 9, name: '旧配置', platform: 'deepseek', apiUrl: null, autoAppendV1Path: false,
      proxyType: null, proxyHost: null, proxyPort: null, proxyUsername: null, status: 1, remark: null,
    })
    expect(form.platform).toBe('openai_compatible')
    expect(form.apiUrl).toBe('')
    expect(form.proxyType).toBe('none')
    expect(form.apiKey).toBe(KEY_UNCHANGED)
    expect(form.autoAppendV1Path).toBe(false)
    // #16:存量行 textProtocol 回填(缺省兜底空=跟随平台)
    const withProto = apiConfigToForm({
      id: 10, name: 'x', platform: 'anthropic', textProtocol: 'openai_compatible', apiUrl: null,
      autoAppendV1Path: false, proxyType: null, proxyHost: null, proxyPort: null,
      proxyUsername: null, status: 1, remark: null,
    })
    expect(withProto.textProtocol).toBe('openai_compatible')
  })

  it('buildApiConfigSavePayload:代理未启用清空代理字段;无用户名时密码清空($SRC 行为)', () => {
    const form = { ...emptyApiConfigForm(), proxyType: 'http', proxyHost: ' proxy ', proxyPort: 3128, proxyUsername: ' u ', proxyPassword: 'p', apiKey: 'sk-1' }
    const payload = buildApiConfigSavePayload(form)
    expect(payload.proxyHost).toBe('proxy')
    expect(payload.proxyUsername).toBe('u')
    expect(payload.proxyPassword).toBe('p')
    expect(payload.apiKey).toBe('sk-1')

    const disabled = buildApiConfigSavePayload({ ...form, proxyType: 'none' })
    expect(disabled.proxyType).toBe('none')
    expect(disabled.proxyHost).toBe('')
    expect(disabled.proxyPassword).toBe('')

    const noUser = buildApiConfigSavePayload({ ...form, proxyUsername: '' })
    expect(noUser.proxyPassword).toBe('')
  })

  it('buildApiConfigSavePayload:编辑密钥留空不下发(掩码语义)', () => {
    const payload = buildApiConfigSavePayload({ ...emptyApiConfigForm(), id: 5, name: 'x', apiKey: '' })
    expect(payload.apiKey).toBeUndefined()
    const withKey = buildApiConfigSavePayload({ ...emptyApiConfigForm(), apiKey: 'sk-new' })
    expect(withKey.apiKey).toBe('sk-new')
  })

  it('#16 textProtocol:显式选择才下发;缺省=跟随平台(不下发)', () => {
    const follow = buildApiConfigSavePayload({ ...emptyApiConfigForm(), name: 'x' })
    expect(follow.textProtocol).toBeUndefined()
    const explicit = buildApiConfigSavePayload({ ...emptyApiConfigForm(), name: 'x', textProtocol: 'mock' })
    expect(explicit.textProtocol).toBe('mock')
  })

  it('isProxyFormInvalid:端口范围与密码依赖用户名(保留 $SRC 规则)', () => {
    expect(isProxyFormInvalid({ proxyType: 'none', proxyHost: '', proxyPort: undefined, proxyUsername: '', proxyPassword: '' })).toBe(false)
    expect(isProxyFormInvalid({ proxyType: 'http', proxyHost: '', proxyPort: 3128, proxyUsername: '', proxyPassword: '' })).toBe(true)
    expect(isProxyFormInvalid({ proxyType: 'http', proxyHost: 'h', proxyPort: 0, proxyUsername: '', proxyPassword: '' })).toBe(true)
    expect(isProxyFormInvalid({ proxyType: 'http', proxyHost: 'h', proxyPort: 70000, proxyUsername: '', proxyPassword: '' })).toBe(true)
    expect(isProxyFormInvalid({ proxyType: 'http', proxyHost: 'h', proxyPort: 3128, proxyUsername: '', proxyPassword: 'p' })).toBe(true)
    expect(isProxyFormInvalid({ proxyType: 'http', proxyHost: 'h', proxyPort: 3128, proxyUsername: 'u', proxyPassword: 'p' })).toBe(false)
  })

  it('maskSecret:保留 $SRC 掩码语义', () => {
    expect(maskSecret('')).toBe('')
    expect(maskSecret(null)).toBe('')
    expect(maskSecret('short')).toBe('••••••••')
    expect(maskSecret('12345678')).toBe('••••••••')
    expect(maskSecret('sk-1234567890abcdef')).toBe('sk-1••••cdef')
  })

  it('五协议预设齐备且平台字典一致', () => {
    const platforms = new Set(API_PROVIDER_PRESETS.map(p => p.platform))
    expect(platforms.size).toBeLessThanOrEqual(5)
    expect(platformLabel('openai_compatible')).toBe('OpenAI / 兼容接入')
    expect(platformLabel('deepseek')).toBe('OpenAI / 兼容接入')
    expect(platformLabel('bogus')).toBe('bogus')
  })
})
