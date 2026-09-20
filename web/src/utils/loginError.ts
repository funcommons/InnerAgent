/**
 * [new] 登录失败文案归一(DEF-01):区分「凭据错误(401)」与「账号锁定
 * (423,含剩余分钟)」。服务端 423 文案形如「账号已锁定,请 N 秒后重试」,
 * 这里换算为分钟透出,避免用户对着秒数发懵。
 */
import { ApiError, HTTP_STATUS } from '@/api/errorCodes'

/** 从服务端锁定文案中提取剩余秒数并换算为分钟(至少 1 分钟) */
function lockMinutesFrom(message: string): number | null {
  const matched = /(\d+)\s*秒/.exec(message)
  if (!matched) return null
  return Math.max(1, Math.ceil(Number(matched[1]) / 60))
}

/** 登录失败文案:401 凭据错误 / 423 锁定(含剩余分钟)/ 其余透出服务端原文 */
export function describeLoginError(err: unknown): string {
  if (!(err instanceof ApiError)) return '登录失败,请重试'
  if (err.status === HTTP_STATUS.UNAUTHORIZED) {
    return err.message || '用户名或密码错误'
  }
  if (err.status === HTTP_STATUS.LOCKED) {
    const minutes = lockMinutesFrom(err.message)
    return minutes
      ? `账号已锁定,剩余约 ${minutes} 分钟后自动解锁,请稍后重试`
      : err.message || '账号已锁定,请稍后重试'
  }
  return err.message || '登录失败,请重试'
}
