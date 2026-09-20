/**
 * [new] 登录失败文案归一测试(DEF-01):401 凭据错误 / 423 锁定(含剩余分钟)。
 */
import { describe, expect, it } from 'vitest'
import { describeLoginError } from './loginError'
import { ApiError } from '@/api/errorCodes'

describe('describeLoginError (DEF-01 文案区分)', () => {
  it('401 凭据错误:透出服务端防枚举文案', () => {
    const err = new ApiError(401, '用户名或密码错误', { status: 401 })
    expect(describeLoginError(err)).toBe('用户名或密码错误')
  })

  it('401 无文案:回落默认提示', () => {
    expect(describeLoginError(new ApiError(401, '', { status: 401 }))).toBe('用户名或密码错误')
  })

  it('423 锁定:剩余秒数换算为分钟透出', () => {
    const err = new ApiError(423, '账号已锁定,请 600 秒后重试', { status: 423 })
    const text = describeLoginError(err)
    expect(text).toContain('账号已锁定')
    expect(text).toContain('10 分钟')
    expect(text).not.toContain('600 秒')
  })

  it('423 锁定:不足 1 分钟按 1 分钟计', () => {
    const err = new ApiError(423, '账号已锁定,请 30 秒后重试', { status: 423 })
    expect(describeLoginError(err)).toContain('1 分钟')
  })

  it('423 无秒数文案:透出服务端原文', () => {
    const err = new ApiError(423, '连续失败已达 5 次,账号锁定 15 分钟', { status: 423 })
    expect(describeLoginError(err)).toBe('连续失败已达 5 次,账号锁定 15 分钟')
  })

  it('423 空文案:回落默认锁定提示', () => {
    expect(describeLoginError(new ApiError(423, '', { status: 423 }))).toBe('账号已锁定,请稍后重试')
  })

  it('其余状态透出服务端文案;非 ApiError 统一兜底', () => {
    expect(describeLoginError(new ApiError(400, '参数错误', { status: 400 }))).toBe('参数错误')
    expect(describeLoginError(new Error('boom'))).toBe('登录失败,请重试')
    expect(describeLoginError('oops')).toBe('登录失败,请重试')
  })
})
