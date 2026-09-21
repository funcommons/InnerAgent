/*
 * tools/k6/lib/config.js — 压测配置与环境变量解析(四个场景共用)。
 *
 * 口径说明(03-开发计划 §7.3 验收 7 / §7.4):
 *   - 服务端契约:POST /ia/api/v1/runs 为 SSE 流(text/event-stream,事件名
 *     pipeline-event,id 形如 "<runId>:<seq>",data 为 AiChatStreamRespVO JSON),
 *     终态 DONE/ERROR/CANCELLED 后服务端关闭流(AgentRunReplayService 到达
 *     terminalSequence 即完成 Flux)。出处:inneragent-server AiPipelineController
 *     / AgentScopePipelineRunService.stream / scripts/smoke-sse.sh。
 *   - 所有阈值参数化(环境变量可覆盖),默认值 = 验收 7 原文数字,不得私改。
 *
 * 环境变量(全部可选,括号内为默认值):
 *   IA_BASE_URL                 服务基址(http://localhost:18090)
 *   IA_DEMO_USER                匿名演示用户 ID(12993;local profile
 *                               allow-anonymous-demo=true 时生效)
 *   IA_EMBED_TOKEN              宿主 embed token(设置则优先于演示头,
 *                               Authorization: Bearer)
 *   IA_ADMIN_KEY                管理面密钥(仅 run.sh 快照/校验用,场景不发管理面请求)
 *   IA_AGENT_TYPE               Agent 类型(demo,对应 P0 演示 Agent + mock 模型)
 *   IA_MESSAGE                  发起的用户消息(现在几点了?)
 *   IA_TOOL_MODE                toolExecutionMode:DEFAULT(压测默认,读工具自动放行)
 *                               / ALWAYS_ASK(idle-sessions 用:所有工具调用转确认,
 *                               运行进入 WAITING_CONFIRMATION,SSE 保持半开)
 *   IA_RUN_TIMEOUT_MS           单轮运行超时(30000;超过视为失败并中断消费)
 *
 * 阈值(验收 7 原文,参数化见 README「阈值口径」):
 *   IA_THRESHOLD_ERROR_RATE     运行错误率上界(0.001 = 0.1%)
 *   IA_THRESHOLD_FIRST_CHAR_MS  首字 P95 上界毫秒(3000;口径见 lib/metrics.js)
 *   IA_THRESHOLD_PASSTHROUGH_MS 事件透传 P95 上界毫秒(200)
 *   IA_THRESHOLD_EVENTS_PER_SEC 事件吞吐目标(500;仅 summary 判定,非 k6 硬阈值)
 */

/** 服务与路径 */
export const BASE_URL = __ENV.IA_BASE_URL || 'http://localhost:18090';

export const PATHS = {
  /** 发起运行(SSE) */
  runs: '/ia/api/v1/runs',
  /** 断点续传(SSE,Last-Event-ID 头) */
  runEvents: (runId) => `/ia/api/v1/runs/${runId}/events`,
  /** 运行状态查询(轮询模式的空闲保持用) */
  runStatus: (runId) => `/ia/api/v1/runs/${runId}`,
  /** 运行中的运行列表(轮询模式低频校验用) */
  running: '/ia/api/v1/runs/running',
  /** 取消运行(收尾清理) */
  runCancel: (runId) => `/ia/api/v1/runs/${runId}/cancel`,
  /** actuator(Prometheus 抓取端点,IA-1 已落;健康检查也走这里) */
  health: '/actuator/health',
  prometheus: '/actuator/prometheus',
};

/** 默认请求体字段 */
export const DEFAULTS = {
  agentType: __ENV.IA_AGENT_TYPE || 'demo',
  message: __ENV.IA_MESSAGE || '现在几点了?',
  toolMode: __ENV.IA_TOOL_MODE || 'DEFAULT',
  runTimeoutMs: intEnv('IA_RUN_TIMEOUT_MS', 30000),
};

/** 验收阈值(默认 = 03-开发计划 §7.3 验收 7 原文数字) */
export const THRESHOLDS = {
  errorRate: floatEnv('IA_THRESHOLD_ERROR_RATE', 0.001),
  firstCharP95Ms: intEnv('IA_THRESHOLD_FIRST_CHAR_MS', 3000),
  passthroughP95Ms: intEnv('IA_THRESHOLD_PASSTHROUGH_MS', 200),
  eventsPerSec: intEnv('IA_THRESHOLD_EVENTS_PER_SEC', 500),
};

/** 构造 AiChatReqVO 请求体(字段名以 server AiChatReqVO 为准)。 */
export function buildRunBody(overrides) {
  const o = overrides || {};
  const body = {
    // conversationId 为空 → 服务端新建会话(压测按「每轮新会话」口径;
    // 复用会话的场景自行覆盖该字段)
    conversationId: o.conversationId !== undefined ? o.conversationId : null,
    message: o.message !== undefined ? o.message : DEFAULTS.message,
    agentType: o.agentType !== undefined ? o.agentType : DEFAULTS.agentType,
    toolExecutionMode: o.toolExecutionMode !== undefined
      ? o.toolExecutionMode
      : DEFAULTS.toolMode,
    enabledSkills: [],
  };
  if (o.enabledTools) body.enabledTools = o.enabledTools;
  return body;
}

function intEnv(name, dflt) {
  const v = parseInt(__ENV[name], 10);
  return Number.isFinite(v) ? v : dflt;
}

function floatEnv(name, dflt) {
  const v = parseFloat(__ENV[name]);
  return Number.isFinite(v) ? v : dflt;
}
