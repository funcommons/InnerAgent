/**
 * [new] 管理站认证 API(登录占位)。
 * 《02-技术方案》§6.3:管理站人类管理员认证首版为内置管理员账号(Argon2 口令散列 +
 * 失败锁定 + 登录审计);本任务为 P2 前置工程,仅做管理 key UI 壳,msw 恒定放行。
 */
import { http } from './request'

/** 登录请求(占位:管理 key) */
export interface AdminLoginReq {
  adminKey: string
}

/** 登录响应(占位;P2 正式任务为 session/Argon2 账号体系) */
export interface AdminLoginResp {
  ok: boolean
  /** 服务端提示(如默认 key 提醒),仅 mock 用 */
  hint?: string
}

export const adminAuthApi = {
  /** 校验管理 key(仅 UI 壳;msw 中非空即过) */
  login: (data: AdminLoginReq) => http.post<AdminLoginResp>('/ia/api/v1/admin/auth/login', data),

  /** 登出(占位:服务端无状态,仅审计埋点) */
  logout: () => http.post<{ ok: boolean }>('/ia/api/v1/admin/auth/logout'),
}
