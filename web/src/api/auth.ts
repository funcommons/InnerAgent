/**
 * [new] 管理站认证 API(对齐服务端 AdminAuthController,18a 已落地)。
 * 《02-技术方案》§6.3:内置管理员账号(Argon2 口令散列 + 失败锁定 + 登录审计)。
 * - POST /admin/auth/login {username,password} → 200 {token, tokenType,
 *   expiresInSeconds, username};失败统一 401(文案防枚举)、锁定 423(含剩余秒数)。
 * - POST /admin/auth/logout 吊销当前 Bearer 会话 token(jti 黑名单,幂等)。
 * - 凭据双轨(AdminTokenFilter):Bearer 会话 token 无效 → 401;
 *   X-IA-Admin-Key(自动化/引导通道)无效/缺失 → 403。
 */
import { http } from './request'

/** 登录请求(服务端 AdminAuthController.LoginReqVO,均 @NotBlank) */
export interface AdminLoginReq {
  username: string
  password: string
}

/** 登录响应(服务端 LoginRespVO;web 端 auth store 据此保存 Bearer) */
export interface AdminLoginResp {
  /** 管理会话 JWT(三段式);后续 admin 请求以 Authorization: Bearer 携带 */
  token: string
  /** 恒为 'Bearer' */
  tokenType: string
  /** 会话有效期(秒),用于本地过期判定 */
  expiresInSeconds: number
  username: string
}

export const adminAuthApi = {
  /** 账号密码登录(失败 401 凭据错误 / 423 锁定;全部尝试落服务端登录审计) */
  login: (data: AdminLoginReq) => http.post<AdminLoginResp>('/ia/api/v1/admin/auth/login', data),

  /** 登出(吊销当前会话 token;幂等,失败不阻断本地清理) */
  logout: () => http.post<boolean>('/ia/api/v1/admin/auth/logout'),
}
