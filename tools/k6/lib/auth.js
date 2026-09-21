/*
 * tools/k6/lib/auth.js — 鉴权头注入(双级令牌契约,见 docs/接入指南.md §2/§4)。
 *
 * 压测客户端按下列优先级携带业务凭据:
 *   1. IA_EMBED_TOKEN:宿主签发的 embed token(RS256,iss=appKey、sub=用户 ID、
 *      exp 未过期),以 `Authorization: Bearer` 头发送 —— 对齐生产接入形态;
 *   2. 未设置时回退 `X-IA-Demo-User: <IA_DEMO_USER>` 匿名演示头(仅 local profile
 *      `inneragent.security.allow-anonymous-demo=true` 时服务端接受;出处
 *      server DemoUserAuthenticationFilter 与 scripts/smoke-sse.sh 先例)。
 *
 * 管理面(`X-IA-Admin-Key`)只供 run.sh 的环境快照/所有权校验使用;
 * 业务场景不发管理面请求(adminTokenFilter 403 语义见接入指南 §2 步骤④)。
 */

import { BASE_URL } from './config.js';

/** 业务请求头(SSE 与 REST 共用;Content-Type 由调用方按需叠加)。 */
export function authHeaders() {
  const token = __ENV.IA_EMBED_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  return { 'X-IA-Demo-User': __ENV.IA_DEMO_USER || '12993' };
}

/** 管理面请求头(run.sh 专用;场景脚本不应调用)。 */
export function adminHeaders() {
  if (!__ENV.IA_ADMIN_KEY) {
    throw new Error('[ia-k6] IA_ADMIN_KEY 未设置:管理面不可用(服务端未配置该环境变量时整体 403)');
  }
  return { 'X-IA-Admin-Key': __ENV.IA_ADMIN_KEY };
}

/** 便于 run.sh/日志输出的自述行(不泄露 token 明文)。 */
export function describeAuth() {
  return __ENV.IA_EMBED_TOKEN
    ? 'embed token(Authorization: Bearer,长度 ' + String(__ENV.IA_EMBED_TOKEN).length + ')'
    : '演示头(X-IA-Demo-User=' + (__ENV.IA_DEMO_USER || '12993') + ')';
}

export { BASE_URL };
