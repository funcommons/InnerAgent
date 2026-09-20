/**
 * [new] msw 请求处理器(本任务唯一"后端")。
 * 契约:《02-技术方案》§7.1 `/ia/api/v1/admin/*`;契约未细化处自拟,全部在
 * src/api/types.ts 头注释的「契约空缺/自拟字段清单」中登记,留给 P2 对齐。
 *
 * 认证约定(mock):除 /auth/login 外,所有 /ia/api/v1/admin/** 请求必须携带
 * 非空 X-IA-Admin-Key 头,否则 401(信封 code=10301),验证请求层注入与 401 出口。
 */
import { http, HttpResponse } from 'msw'
import type { DefaultBodyType } from 'msw'
import { ApiErrorCode } from '@/api/errorCodes'
import type { CommonResult } from '@/api/common'

export const MOCK_ADMIN_KEY = 'ia-admin-mock-key'

function ok<T>(data: T, init?: ResponseInit): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code: 0, data } satisfies CommonResult<T>, init)
}

function fail(code: number, message: string, status = 200): HttpResponse<DefaultBodyType> {
  return HttpResponse.json({ code, message }, { status })
}

/** 管理凭据校验(除 login 外全部生效) */
function requireAdminKey(request: Request): HttpResponse<DefaultBodyType> | null {
  const key = request.headers.get('X-IA-Admin-Key')
  if (!key) {
    return fail(ApiErrorCode.ADMIN_KEY_INVALID, '缺少 X-IA-Admin-Key,请先登录管理站', 401)
  }
  return null
}

export const handlers = [
  // ===== 认证(占位) =====
  http.post('/ia/api/v1/admin/auth/login', async ({ request }) => {
    const body = (await request.json()) as { adminKey?: string }
    if (!body?.adminKey) {
      return fail(ApiErrorCode.REQUIRED_PARAMETER_MISSING, 'adminKey 不能为空')
    }
    return ok({ ok: true, hint: 'mock 环境:任意非空 key 均可登录' })
  }),
  http.post('/ia/api/v1/admin/auth/logout', ({ request }) => {
    const denied = requireAdminKey(request)
    return denied ?? ok({ ok: true })
  }),
]
