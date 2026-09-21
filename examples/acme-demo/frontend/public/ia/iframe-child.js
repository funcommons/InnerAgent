const IA_THEME_TOKENS = [
  "--ia-primary",
  "--ia-primary-contrast",
  "--ia-bg",
  "--ia-bg-card",
  "--ia-bg-muted",
  "--ia-text",
  "--ia-text-secondary",
  "--ia-text-tertiary",
  "--ia-separator",
  "--ia-danger",
  "--ia-warning",
  "--ia-success"
];
const DEFAULT_BASE_URL = "/ia/api/v1";
const DEFAULT_AGENT_TYPE = "ai_media";
const DEFAULT_STORAGE_PREFIX = "inneragent-assistant";
let runtime = null;
function init(options) {
  if (!options.appKey || !options.appKey.trim()) {
    throw new Error("@inneragent/sdk init: appKey is required");
  }
  if (typeof options.tokenGetter !== "function") {
    throw new Error("@inneragent/sdk init: tokenGetter is required");
  }
  runtime = {
    appKey: options.appKey,
    baseURL: (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    mode: options.mode ?? "wc",
    agentType: options.agentType ?? DEFAULT_AGENT_TYPE,
    storagePrefix: options.storagePrefix ?? DEFAULT_STORAGE_PREFIX,
    tokenGetter: options.tokenGetter
  };
  if (options.theme) applyTheme(options.theme);
  return runtime;
}
function getSdkConfig() {
  if (!runtime) {
    throw new Error("@inneragent/sdk is not initialized; call init({ appKey, tokenGetter }) first");
  }
  return runtime;
}
function getBaseURL() {
  return runtime?.baseURL ?? DEFAULT_BASE_URL;
}
function applyTheme(theme) {
  if (typeof document === "undefined") return;
  for (const token of IA_THEME_TOKENS) {
    const value = theme[token];
    if (value) document.documentElement.style.setProperty(token, value);
  }
}
const HTTP_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};
class ApiError extends Error {
  code;
  status;
  traceId;
  details;
  silent;
  constructor(code, message, options = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = options.status;
    this.traceId = options.traceId;
    this.details = options.details;
    if (options.silent) this.silent = true;
  }
  /** 源实现语义: 业务码 10200 或 HTTP 401 视为未认证 */
  isAuthError() {
    return this.code === 10200 || this.status === 401;
  }
}
const noopHooks = {};
let hooks = noopHooks;
function setAssistantEventHooks(next) {
  hooks = next ?? noopHooks;
}
const assistantEventHooks = {
  onToolFinished(toolName) {
    try {
      hooks.onToolFinished?.(toolName);
    } catch {
    }
  },
  onRunTerminal() {
    try {
      hooks.onRunTerminal?.();
    } catch {
    }
  },
  onUnauthorized() {
    try {
      hooks.onUnauthorized?.();
    } catch {
    }
  }
};
const TRACE_ID_STORAGE_KEY = "inneragent:trace-id";
function getOrCreateTraceId() {
  let traceId = "";
  try {
    traceId = sessionStorage.getItem(TRACE_ID_STORAGE_KEY) || "";
  } catch {
  }
  if (!traceId) {
    traceId = newTraceId();
    try {
      sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId);
    } catch {
    }
  }
  return traceId;
}
function newTraceId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
let tokenRefreshPromise = null;
function refreshTokenSingleFlight() {
  if (!tokenRefreshPromise) {
    const { tokenGetter } = getSdkConfig();
    tokenRefreshPromise = Promise.resolve().then(() => tokenGetter()).finally(() => {
      tokenRefreshPromise = null;
    });
  }
  return tokenRefreshPromise;
}
async function resolveToken(override) {
  if (override !== void 0) return override;
  const { tokenGetter } = getSdkConfig();
  return Promise.resolve().then(() => tokenGetter());
}
function isFormDataBody(body) {
  return typeof FormData !== "undefined" && body instanceof FormData;
}
function serializeBody(config) {
  const { body } = config;
  if (body === void 0 || body === null) return void 0;
  if (isFormDataBody(body) || typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body;
  return JSON.stringify(body);
}
function baseHeaders(config) {
  const headers = new Headers(config.headers);
  const { body } = config;
  if (isFormDataBody(body)) {
    headers.delete("Content-Type");
  } else if (typeof body === "string") {
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  } else if (body !== void 0 && body !== null && !(body instanceof URLSearchParams)) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}
function fieldErrors(error) {
  if (!Array.isArray(error)) return [];
  return error.filter((e) => e != null && typeof e === "object" && typeof e.message === "string").map((e) => ({
    field: typeof e.field === "string" ? e.field : "",
    code: typeof e.code === "string" ? e.code : void 0,
    message: e.message,
    rejectedValue: e.rejectedValue
  }));
}
function readTraceId(headers, body) {
  const headerVal = headers.get("x-trace-id") || "";
  const traceId = headerVal || body?.trace_id || "";
  if (traceId) {
    try {
      sessionStorage.setItem(TRACE_ID_STORAGE_KEY, traceId);
    } catch {
    }
  }
  return traceId;
}
function timeoutFetch(url, init2, timeoutMs) {
  if (!timeoutMs) return fetch(url, init2);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "AbortError")), timeoutMs);
  const linkedSignal = init2.signal ? AbortSignal.any([init2.signal, controller.signal]) : controller.signal;
  return fetch(url, { ...init2, signal: linkedSignal }).finally(() => clearTimeout(timer));
}
async function request(url, config = {}) {
  const isAbsolute = /^https?:\/\//.test(url);
  let fullUrl = url;
  if (!isAbsolute) {
    const base = getBaseURL();
    const alreadyPrefixed = base !== "" && (url === base || url.startsWith(`${base}/`));
    fullUrl = alreadyPrefixed ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`;
  }
  return doRequest(fullUrl, config);
}
async function doRequest(fullUrl, config) {
  const headers = baseHeaders(config);
  const token = await resolveToken(config.__overrideToken);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("X-Trace-Id", getOrCreateTraceId());
  let response;
  try {
    response = await timeoutFetch(fullUrl, {
      method: config.method ?? "GET",
      headers,
      body: serializeBody(config)
    }, config.timeoutMs ?? 3e4);
  } catch {
    throw new ApiError(0, "网络错误，请稍后重试", { silent: config.silent });
  }
  if (response.status === HTTP_STATUS.UNAUTHORIZED) {
    assistantEventHooks.onUnauthorized();
    if (!config.__retried) {
      const freshToken = await refreshTokenSingleFlight().catch(() => null);
      if (freshToken) {
        return doRequest(fullUrl, { ...config, __retried: true, __overrideToken: freshToken });
      }
    }
  }
  if (!response.ok) {
    const { message, body } = await readErrorPayload(response);
    throw new ApiError(response.status, message, {
      status: response.status,
      silent: config.silent,
      traceId: readTraceId(response.headers, body)
    });
  }
  const payload = await response.json().catch(() => null);
  if (payload === null || payload.code === void 0) {
    return payload;
  }
  if (payload.code === 0) {
    readTraceId(response.headers, payload);
    return payload.data;
  }
  throw new ApiError(payload.code, payload.message || payload.msg || "请求失败", {
    silent: config.silent,
    traceId: readTraceId(response.headers, payload),
    details: fieldErrors(payload.error)
  });
}
async function readErrorPayload(response) {
  let body = null;
  try {
    const text = await response.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    body = null;
  }
  let message = "请求失败";
  switch (response.status) {
    case HTTP_STATUS.BAD_REQUEST:
      message = body?.message || "请求参数错误";
      break;
    case HTTP_STATUS.UNAUTHORIZED:
      message = body?.msg || body?.message || "登录已过期，请重新登录";
      break;
    case HTTP_STATUS.FORBIDDEN:
      message = "没有权限访问";
      break;
    case HTTP_STATUS.NOT_FOUND:
      message = "请求的资源不存在";
      break;
    case HTTP_STATUS.INTERNAL_SERVER_ERROR:
      message = body?.message || "服务器内部错误";
      break;
    default:
      message = body?.message || `请求失败 (${response.status})`;
  }
  return { message, body };
}
const http = {
  get(url, config) {
    return request(url, { ...config, method: "GET" });
  },
  post(url, data, config) {
    return request(url, { ...config, method: "POST", body: data });
  },
  put(url, data, config) {
    return request(url, { ...config, method: "PUT", body: data });
  },
  delete(url, config) {
    return request(url, { ...config, method: "DELETE" });
  },
  patch(url, data, config) {
    return request(url, { ...config, method: "PATCH", body: data });
  }
};
async function authenticatedFetch(input, init2) {
  const headers = new Headers(init2?.headers);
  const token = await resolveToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(input, { ...init2, headers });
  if (response.status === 401) {
    assistantEventHooks.onUnauthorized();
    const freshToken = await refreshTokenSingleFlight().catch(() => null);
    if (freshToken) {
      headers.set("Authorization", `Bearer ${freshToken}`);
      return fetch(input, { ...init2, headers });
    }
  }
  return response;
}
const OUTPUT_TYPES = /* @__PURE__ */ new Set([
  "REASONING",
  "CONTENT",
  "TOOL_CALL_STARTED",
  "TOOL_CALL",
  "TOOL_FINISHED",
  "SUB_AGENT_STARTED",
  "SUB_AGENT_FINISHED",
  "USER_CONFIRMATION_REQUIRED",
  "EXTERNAL_EXECUTION_REQUIRED",
  "USER_CONFIRM_RESULT",
  "EXTERNAL_EXECUTION_RESULT",
  "DONE",
  "ERROR",
  "CANCELLED"
]);
function isRecord$2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getApiPayloadMessage(payload) {
  if (!isRecord$2(payload)) return null;
  const message = payload.msg ?? payload.message;
  return typeof message === "string" && message.trim() ? message.trim() : null;
}
async function readApiResponseError(response) {
  try {
    const body = await response.text();
    if (body.trim()) {
      try {
        const message = getApiPayloadMessage(JSON.parse(body));
        if (message) return message;
      } catch {
      }
    }
  } catch {
  }
  return "请求失败";
}
function parseEventId(value) {
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error("Pipeline SSE id is invalid");
  }
  const runId = value.slice(0, separator);
  const encodedSequence = value.slice(separator + 1);
  if (!/^\d+$/.test(encodedSequence)) {
    throw new Error("Pipeline SSE id sequence is invalid");
  }
  const sequence = Number(encodedSequence);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    throw new Error("Pipeline SSE id sequence is outside the safe range");
  }
  return { runId, sequence };
}
function parsePipelineEvent(jsonText) {
  let value;
  try {
    value = JSON.parse(jsonText);
  } catch {
    throw new Error("Pipeline SSE data is not valid JSON");
  }
  if (!isRecord$2(value)) {
    throw new Error("Pipeline SSE data must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error("Unsupported Pipeline SSE schema version");
  }
  if (typeof value.runId !== "string" || value.runId.trim() !== value.runId || !value.runId) {
    throw new Error("Pipeline SSE runId is invalid");
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence <= 0) {
    throw new Error("Pipeline SSE sequence is invalid");
  }
  if (typeof value.outputType !== "string" || !OUTPUT_TYPES.has(value.outputType)) {
    throw new Error("Pipeline SSE outputType is invalid");
  }
  return value;
}
function isRootTerminalEvent(event) {
  return !event.parentToolCallId && !event.agentName && (event.outputType === "DONE" || event.outputType === "ERROR" || event.outputType === "CANCELLED");
}
function parseSseEventBlock(eventBlock, callbacks, cursor) {
  const dataLines = [];
  const idLines = [];
  for (const rawLine of eventBlock.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    } else if (line.startsWith("id:")) {
      idLines.push(line.slice(3).trimStart());
    }
  }
  const jsonText = dataLines.join("\n").trim();
  if (!jsonText) return;
  const idLine = idLines[0];
  if (idLines.length !== 1 || idLine === void 0) {
    throw new Error("Pipeline SSE event must contain exactly one id field");
  }
  const eventId = parseEventId(idLine);
  const event = parsePipelineEvent(jsonText);
  if (event.runId !== eventId.runId || event.sequence !== eventId.sequence) {
    throw new Error("Pipeline SSE id does not match its data identity");
  }
  if (cursor.runId && event.runId !== cursor.runId) {
    throw new Error("Pipeline SSE switched to a different run");
  }
  if (event.sequence <= cursor.lastSequence) {
    return;
  }
  callbacks.onEvent(event);
  cursor.runId = event.runId;
  cursor.lastSequence = event.sequence;
  if (isRootTerminalEvent(event)) {
    cursor.terminalSeen = true;
  }
}
function consumeSseBuffer(buffer, callbacks, cursor) {
  const normalizedBuffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const eventBlocks = normalizedBuffer.split("\n\n");
  const remaining = eventBlocks.pop() || "";
  for (const eventBlock of eventBlocks) {
    parseSseEventBlock(eventBlock, callbacks, cursor);
  }
  return remaining;
}
async function consumeRunResponse(response, callbacks, cursor) {
  if (!response.ok) {
    throw new Error(await readApiResponseError(response));
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("无法获取 Pipeline 响应流");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSseBuffer(buffer, callbacks, cursor);
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    parseSseEventBlock(buffer.replace(/\r\n/g, "\n"), callbacks, cursor);
  }
  if (!cursor.terminalSeen) {
    throw new Error("Pipeline SSE ended before a terminal journal event");
  }
  callbacks.onComplete?.();
}
function runStreamRequest(request2, callbacks, cursor, controller) {
  void (async () => {
    try {
      await consumeRunResponse(await request2(), callbacks, cursor);
    } catch (error) {
      if (controller.signal.aborted) return;
      callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  })();
}
function startRunStream(req, callbacks) {
  const controller = new AbortController();
  const cursor = { lastSequence: 0, terminalSeen: false };
  runStreamRequest(
    () => authenticatedFetch(`${getBaseURL()}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal
    }),
    callbacks,
    cursor,
    controller
  );
  return controller;
}
function reconnectRunStream(runId, afterSequence, callbacks) {
  if (!runId || runId.trim() !== runId) {
    throw new Error("runId is required for Run reconnect");
  }
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw new Error("afterSequence must be a non-negative safe integer");
  }
  const controller = new AbortController();
  const cursor = {
    runId,
    lastSequence: afterSequence,
    terminalSeen: false
  };
  const eventId = `${runId}:${afterSequence}`;
  runStreamRequest(
    () => authenticatedFetch(
      `${getBaseURL()}/runs/${encodeURIComponent(runId)}/events`,
      {
        method: "GET",
        headers: { "Last-Event-ID": eventId },
        signal: controller.signal
      }
    ),
    callbacks,
    cursor,
    controller
  );
  return controller;
}
async function cancelRun(target) {
  if (target.runId) {
    await http.post(`/runs/${encodeURIComponent(target.runId)}/cancel`);
    return;
  }
  const conversationId = target.conversationId;
  if (!conversationId) {
    throw new Error("cancelRun requires runId or conversationId");
  }
  const query = new URLSearchParams({ conversationId });
  await http.post(`/runs/cancel?${query.toString()}`);
}
async function confirmRunTools(request2) {
  const { runId, ...body } = request2;
  await http.post(`/runs/${encodeURIComponent(runId)}/confirm`, body);
}
async function expireRunConfirmation(request2) {
  const { runId, ...body } = request2;
  await http.post(`/runs/${encodeURIComponent(runId)}/confirm/expire`, body);
}
const RUNNING_LIST_CACHE_TTL_MS = 500;
let runningListCache = null;
function fetchRunningList() {
  if (runningListCache && Date.now() - runningListCache.at < RUNNING_LIST_CACHE_TTL_MS) {
    return runningListCache.promise;
  }
  const promise = http.get("/runs/running");
  runningListCache = { at: Date.now(), promise };
  promise.catch(() => {
    runningListCache = null;
  });
  return promise;
}
async function getRunStatus(target) {
  if (target.runId) {
    return http.get(
      `/runs/${encodeURIComponent(target.runId)}`
    );
  }
  const running = await fetchRunningList();
  const match = running.find((item) => item.conversationId === target.conversationId);
  if (match) {
    return {
      runId: match.runId,
      status: match.status,
      lastSequence: match.lastSequence,
      waitingReplyId: match.waitingReplyId
    };
  }
  return { runId: "", status: "COMPLETED", lastSequence: 0 };
}
async function getAssistantReferenceOptions() {
  return http.get("/me/reference-options");
}
async function listConversations(params) {
  const searchParams = new URLSearchParams({
    pageNo: String(params.pageNo),
    pageSize: String(params.pageSize)
  });
  if (params.category) {
    searchParams.set("category", params.category);
  }
  return http.get(
    `/conversations?${searchParams}`
  );
}
async function listMessages(conversationId) {
  return http.get(
    `/conversations/${encodeURIComponent(conversationId)}/messages`
  );
}
async function deleteConversation(id) {
  await http.delete(`/conversations/${id}`);
}
async function deleteConversationByConversationId(conversationId) {
  await http.delete(
    `/conversations/by-conversation-id/${encodeURIComponent(conversationId)}`
  );
}
const aiModelApi = {
  /** 按类型获取可用模型列表 (composer 仅消费 type=1 对话模型) */
  listByType: (type) => (
    // [DEF-05] 相对路径: baseURL 由 client.request() 统一拼接, 调用点不再自带前缀
    http.get(`/me/models?type=${type}`)
  )
};
const meApi = {
  /** 助手可引用 Skill/MCP 工具 (原 /api/ai/assistant/reference-options) */
  referenceOptions: () => (
    // [DEF-05] 同上
    http.get("/me/reference-options")
  )
};
async function uploadAttachment(file, modelId, transport) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("modelId", String(modelId));
  formData.append("transport", transport);
  return http.post("/attachments", formData, { timeoutMs: 0 });
}
function resolveMediaUrl(url) {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  if (url.startsWith("/")) return `${getBaseURL()}${url}`;
  return url;
}
const mcpUserServersApi = {
  /** 本人的三方 MCP 服务器列表 (含停用; 配置视图主列表) */
  list() {
    return http.get("/mcp-servers");
  },
  /** 详情 */
  get(id) {
    return http.get(`/mcp-servers/${id}`);
  },
  /** 注册 (防 SSRF 拒绝本机/内网地址; OAUTH 即 501) */
  register(req) {
    return http.post("/mcp-servers", req);
  },
  /** 更新 (credentials 不传/空 → 保持原值口径由服务端定, 见差距清单) */
  update(id, req) {
    return http.put(`/mcp-servers/${id}`, req);
  },
  /** 启用 */
  enable(id) {
    return http.post(`/mcp-servers/${id}/enable`);
  },
  /** 停用 (从本人目录摘除其全部三方工具) */
  disable(id) {
    return http.post(`/mcp-servers/${id}/disable`);
  },
  /** 删除 */
  remove(id) {
    return http.delete(`/mcp-servers/${id}`);
  }
};
let currentContext = [];
let currentRunContext = {};
function getAssistantPageContext() {
  return currentContext;
}
function setRunContext(context) {
  currentRunContext = { ...context };
}
function getRunContext() {
  return currentRunContext;
}
let toolDisplayNamesMap = {};
let subAgentToolNameList = [];
function getToolDisplayName(toolName) {
  return toolDisplayNamesMap[toolName] ?? toolName;
}
function subAgentToolNames() {
  return subAgentToolNameList;
}
function createInitialPipelineState() {
  return {
    status: "idle",
    reasoningText: "",
    timeline: [],
    lastSequence: 0
  };
}
function createPendingPipelineState() {
  return {
    status: "reasoning",
    reasoningText: "",
    timeline: [],
    lastSequence: 0
  };
}
function pendingPipelineForNextRun(conversationId) {
  return {
    ...createPendingPipelineState(),
    conversationId,
    lastSequence: 0
  };
}
function statusIsRunning(status) {
  return status === "running" || status === "pending" || status === "RUNNING" || status === "WAITING_CONFIRMATION" || status === "WAITING_EXTERNAL" || status === "CANCEL_REQUESTED";
}
function statusFromPipeline(status) {
  switch (status) {
    case "COMPLETED":
      return "completed";
    case "FAILED":
      return "failed";
    case "CANCELLED":
      return "cancelled";
    case "CANCEL_REQUESTED":
      return "CANCEL_REQUESTED";
    case "WAITING_CONFIRMATION":
      return "WAITING_CONFIRMATION";
    case "WAITING_EXTERNAL":
      return "WAITING_EXTERNAL";
    case "ERROR":
      return "failed";
    default:
      return "running";
  }
}
function normalizeTitle(value) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.slice(0, 50) || "新对话";
}
function hasTerminal(event) {
  return !event.parentToolCallId && !event.agentName && (event.outputType === "DONE" || event.outputType === "ERROR" || event.outputType === "CANCELLED");
}
function terminalStatusForEvent(event) {
  if (event.outputType === "DONE") return "completed";
  if (event.outputType === "ERROR") return "failed";
  return "cancelled";
}
function hasLiveTranscript(runtime2) {
  return runtime2.pipeline.timeline.length > 0 || runtime2.pipeline.reasoningText.trim().length > 0;
}
function finishedToolTimelineStatus(status) {
  if (status === "success" || status === "done") return "done";
  if (status === "error") return "error";
  if (status === "cancelled") return "cancelled";
  throw new Error(`Unsupported finished tool status: ${String(status)}`);
}
function persistedToolTimelineStatus(status) {
  if (status === "running") return "calling";
  if (status === "rejected") return "rejected";
  if (status === "expired") return "expired";
  return finishedToolTimelineStatus(status);
}
function appendReasoningToSubTimeline(children, reasoningContent, startedAtMs) {
  const last = children[children.length - 1];
  if (last && last.type === "reasoning") {
    return [
      ...children.slice(0, -1),
      {
        ...last,
        text: last.text + reasoningContent,
        startedAtMs: last.startedAtMs ?? startedAtMs
      }
    ];
  }
  return [
    ...children,
    {
      type: "reasoning",
      text: reasoningContent,
      ...startedAtMs !== void 0 ? { startedAtMs } : {}
    }
  ];
}
function updateLastSubTimelineReasoningDuration(children, durationMs) {
  for (let index = children.length - 1; index >= 0; index--) {
    const item = children[index];
    if (item === void 0) continue;
    if (item.type === "reasoning") {
      return children.map(
        (child, childIndex) => childIndex === index && child.type === "reasoning" ? { ...child, durationMs } : child
      );
    }
  }
  return children;
}
function appendReasoningToTimeline(timeline, reasoningContent, startedAtMs) {
  const last = timeline[timeline.length - 1];
  if (last && last.type === "reasoning") {
    return [
      ...timeline.slice(0, -1),
      {
        ...last,
        text: last.text + reasoningContent,
        startedAtMs: last.startedAtMs ?? startedAtMs
      }
    ];
  }
  return [
    ...timeline,
    {
      type: "reasoning",
      text: reasoningContent,
      ...startedAtMs !== void 0 ? { startedAtMs } : {}
    }
  ];
}
function updateLastTimelineReasoningDuration(timeline, durationMs) {
  for (let index = timeline.length - 1; index >= 0; index--) {
    const item = timeline[index];
    if (item === void 0) continue;
    if (item.type === "reasoning") {
      return timeline.map(
        (timelineItem, timelineIndex) => timelineIndex === index && timelineItem.type === "reasoning" ? { ...timelineItem, durationMs } : timelineItem
      );
    }
  }
  return timeline;
}
function updateToolStatus(timeline, toolCallId, status) {
  return timeline.map(
    (item) => item.type === "tool" && item.id === toolCallId ? { ...item, status } : item
  );
}
function isInProgressToolStatus(status) {
  return status === "preparing" || status === "calling" || status === "awaiting_approval" || status === "approved";
}
function cancelCallingSubTimelineTools(children) {
  let changed = false;
  const next = children.map((child) => {
    if (child.type !== "tool" || !isInProgressToolStatus(child.status)) return child;
    changed = true;
    return { ...child, status: "cancelled" };
  });
  return changed ? next : children;
}
function cancelCallingTimelineTools(timeline) {
  let changed = false;
  const next = timeline.map((item) => {
    if (item.type !== "tool") return item;
    const children = item.children ? cancelCallingSubTimelineTools(item.children) : item.children;
    const status = isInProgressToolStatus(item.status) ? "cancelled" : item.status;
    if (status === item.status && children === item.children) return item;
    changed = true;
    return { ...item, status, children };
  });
  return changed ? next : timeline;
}
function updateConfirmationToolStatuses(timeline, parentToolCallId, updates) {
  if (updates.size === 0) {
    throw new Error("Tool confirmation must contain at least one decision");
  }
  const updateChildren = (children) => {
    for (const [toolCallId, update] of updates) {
      const matches = children.filter(
        (child) => child.type === "tool" && child.id === toolCallId
      );
      if (matches.length !== 1) {
        throw new Error(`Expected one child tool call for confirmation: ${toolCallId}`);
      }
      const match = matches[0];
      if (match?.type !== "tool") {
        throw new Error(`Invalid confirmation state for child tool call: ${toolCallId}`);
      }
      if (update.expectedName !== void 0 && match.name !== update.expectedName) {
        throw new Error(`Confirmation tool name mismatch: ${toolCallId}`);
      }
    }
    return children.map((child) => {
      if (child.type !== "tool") return child;
      const update = updates.get(child.id);
      if (!update) return child;
      return update.plan ? { ...child, status: update.status, plan: update.plan } : { ...child, status: update.status };
    });
  };
  if (parentToolCallId) {
    const parents = timeline.filter(
      (item) => item.type === "tool" && item.id === parentToolCallId
    );
    if (parents.length !== 1 || parents[0]?.type !== "tool" || !parents[0].children) {
      throw new Error(`Confirmation parent tool call is missing: ${parentToolCallId}`);
    }
    return timeline.map((item) => item.type === "tool" && item.id === parentToolCallId ? { ...item, children: updateChildren(item.children ?? []) } : item);
  }
  for (const [toolCallId, update] of updates) {
    const matches = timeline.filter(
      (item) => item.type === "tool" && item.id === toolCallId
    );
    const match = matches[0];
    if (matches.length !== 1 || match?.type !== "tool") {
      throw new Error(`Expected one tool call for confirmation: ${toolCallId}`);
    }
    if (match.status !== update.expectedStatus) {
      throw new Error(`Invalid confirmation state for tool call: ${toolCallId}`);
    }
    if (update.expectedName !== void 0 && match.name !== update.expectedName) {
      throw new Error(`Confirmation tool name mismatch: ${toolCallId}`);
    }
  }
  return timeline.map((item) => {
    if (item.type !== "tool") return item;
    const update = updates.get(item.id);
    if (!update) return item;
    return update.plan ? { ...item, status: update.status, plan: update.plan } : { ...item, status: update.status };
  });
}
function requireConfirmationDecisions(event, pending) {
  if (!event.replyId || event.replyId !== pending.replyId) {
    throw new Error("USER_CONFIRM_RESULT replyId does not match the pending confirmation");
  }
  if (event.parentToolCallId !== pending.parentToolCallId) {
    throw new Error("USER_CONFIRM_RESULT parent tool identity does not match");
  }
  if (!event.decisions?.length) {
    throw new Error("USER_CONFIRM_RESULT has no decisions");
  }
  const decisions = /* @__PURE__ */ new Map();
  for (const decision of event.decisions) {
    if (!decision.toolCallId || typeof decision.approved !== "boolean") {
      throw new Error("USER_CONFIRM_RESULT contains an invalid decision");
    }
    if (decisions.has(decision.toolCallId)) {
      throw new Error(`USER_CONFIRM_RESULT contains a duplicate decision: ${decision.toolCallId}`);
    }
    decisions.set(decision.toolCallId, decision.approved);
  }
  const pendingIds = new Set(
    (pending.toolCalls ?? []).map((toolCall) => toolCall.toolCallId)
  );
  if (pendingIds.size !== (pending.toolCalls ?? []).length || decisions.size !== pendingIds.size || [...decisions.keys()].some((toolCallId) => !pendingIds.has(toolCallId))) {
    throw new Error("USER_CONFIRM_RESULT decisions do not match the pending tool calls");
  }
  return decisions;
}
function finishToolCall(timeline, parentToolCallId, toolCallId, status, result) {
  const validPreviousStatus = (value) => value === "calling" || value === "approved";
  if (parentToolCallId) {
    const parents = timeline.filter(
      (item) => item.type === "tool" && item.id === parentToolCallId
    );
    const parent = parents[0];
    if (parents.length !== 1 || parent?.type !== "tool" || !parent.children) {
      throw new Error(`Finished tool parent is missing: ${parentToolCallId}`);
    }
    const children = parent.children;
    const matches2 = children.filter(
      (child) => child.type === "tool" && child.id === toolCallId
    );
    const match2 = matches2[0];
    if (matches2.length !== 1 || match2?.type !== "tool" || !validPreviousStatus(match2.status)) {
      throw new Error(`Finished child tool has no valid in-progress call: ${toolCallId}`);
    }
    return timeline.map((item) => item.type === "tool" && item.id === parentToolCallId ? {
      ...item,
      children: (item.children ?? []).map((child) => child.type === "tool" && child.id === toolCallId ? { ...child, status, result } : child)
    } : item);
  }
  const matches = timeline.filter(
    (item) => item.type === "tool" && item.id === toolCallId
  );
  const match = matches[0];
  if (matches.length !== 1 || match?.type !== "tool" || !validPreviousStatus(match.status)) {
    throw new Error(`Finished tool has no valid in-progress call: ${toolCallId}`);
  }
  return timeline.map((item) => item.type === "tool" && item.id === toolCallId ? { ...item, status, result } : item);
}
function appendToToolChildren(timeline, parentToolCallId, updater) {
  return timeline.map(
    (item) => item.type === "tool" && item.id === parentToolCallId ? { ...item, children: updater(item.children ?? []) } : item
  );
}
function appendContentToSubTimeline(children, content) {
  const updated = [...children];
  const last = updated[updated.length - 1];
  if (last && last.type === "content") {
    return [
      ...updated.slice(0, -1),
      { ...last, text: last.text + content }
    ];
  }
  return [...updated, { type: "content", text: content }];
}
function appendContentToTimeline(timeline, content) {
  const last = timeline[timeline.length - 1];
  if (last && last.type === "content") {
    return [
      ...timeline.slice(0, -1),
      { ...last, text: last.text + content }
    ];
  }
  return [...timeline, { type: "content", text: content }];
}
function validTimestamp(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : void 0;
}
function validDuration(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
function reducePipelineEvent(prev, event) {
  if (prev.runId && prev.runId !== event.runId) {
    throw new Error("Pipeline event belongs to a different run");
  }
  if (event.sequence <= prev.lastSequence) {
    return prev;
  }
  const next = {
    ...prev,
    timeline: [...prev.timeline],
    runId: event.runId,
    lastSequence: event.sequence,
    error: void 0
  };
  if (event.conversationId) {
    next.conversationId = event.conversationId;
  }
  const isSubAgent = !!event.parentToolCallId;
  const eventReasoningDurationMs = validDuration(event.reasoningDurationMs);
  if (eventReasoningDurationMs !== void 0) {
    if (isSubAgent) {
      next.timeline = appendToToolChildren(
        next.timeline,
        event.parentToolCallId ?? "",
        (children) => updateLastSubTimelineReasoningDuration(children, eventReasoningDurationMs)
      );
    } else {
      next.reasoningDurationMs = eventReasoningDurationMs;
      next.timeline = updateLastTimelineReasoningDuration(next.timeline, eventReasoningDurationMs);
    }
  }
  switch (event.outputType) {
    case "REASONING":
      if (event.reasoningContent) {
        const reasoningStartTime = validTimestamp(event.reasoningStartTime);
        if (isSubAgent) {
          next.timeline = appendToToolChildren(
            next.timeline,
            event.parentToolCallId ?? "",
            (children) => appendReasoningToSubTimeline(children, event.reasoningContent ?? "", reasoningStartTime)
          );
        } else {
          next.status = prev.status === "cancelling" ? "cancelling" : "reasoning";
          const last = next.timeline[next.timeline.length - 1];
          if (!last || last.type !== "reasoning") {
            next.reasoningText = "";
            next.reasoningDurationMs = void 0;
            next.reasoningStartTime = reasoningStartTime;
          } else if (next.reasoningStartTime === void 0) {
            next.reasoningStartTime = reasoningStartTime;
          }
          next.reasoningText += event.reasoningContent;
          next.timeline = appendReasoningToTimeline(
            next.timeline,
            event.reasoningContent,
            reasoningStartTime
          );
        }
      }
      return next;
    case "CONTENT":
      next.status = prev.status === "cancelling" ? "cancelling" : "running";
      if (event.content) {
        if (isSubAgent) {
          next.timeline = appendToToolChildren(
            next.timeline,
            event.parentToolCallId ?? "",
            (children) => appendContentToSubTimeline(children, event.content ?? "")
          );
        } else {
          next.timeline = appendContentToTimeline(next.timeline, event.content);
        }
      }
      return next;
    case "TOOL_CALL_STARTED":
      next.status = prev.status === "cancelling" ? "cancelling" : "running";
      if (!event.replyId || !event.toolCalls?.length) {
        throw new Error("TOOL_CALL_STARTED event has no replyId or tool calls");
      }
      for (const toolCall of event.toolCalls) {
        if (isSubAgent) {
          next.timeline = appendToToolChildren(
            next.timeline,
            event.parentToolCallId ?? "",
            (children) => {
              if (children.some((child) => child.type === "tool" && child.id === toolCall.id)) {
                throw new Error(`Tool call already started: ${toolCall.id}`);
              }
              return [
                ...children,
                {
                  type: "tool",
                  id: toolCall.id,
                  name: toolCall.name,
                  arguments: "",
                  batchId: event.replyId,
                  status: "preparing"
                }
              ];
            }
          );
        } else {
          if (next.timeline.some((item) => item.type === "tool" && item.id === toolCall.id)) {
            throw new Error(`Tool call already started: ${toolCall.id}`);
          }
          next.timeline.push({
            type: "tool",
            id: toolCall.id,
            name: toolCall.name,
            arguments: "",
            batchId: event.replyId,
            status: "preparing",
            agentName: event.agentName
          });
        }
      }
      return next;
    case "TOOL_CALL":
      next.status = prev.status === "cancelling" ? "cancelling" : "running";
      if (!event.replyId || !event.toolCalls?.length) {
        throw new Error("TOOL_CALL event has no replyId or tool calls");
      }
      {
        for (const toolCall of event.toolCalls) {
          if (isSubAgent) {
            next.timeline = appendToToolChildren(
              next.timeline,
              event.parentToolCallId ?? "",
              (children) => {
                const existing = children.find(
                  (child) => child.type === "tool" && child.id === toolCall.id
                );
                if (existing?.type === "tool") {
                  if (existing.status !== "preparing" || existing.name !== toolCall.name) {
                    throw new Error(`Invalid completed tool call definition: ${toolCall.id}`);
                  }
                  return children.map((child) => child.type === "tool" && child.id === toolCall.id ? {
                    ...child,
                    arguments: toolCall.arguments,
                    batchId: event.replyId,
                    status: "calling"
                  } : child);
                }
                return [
                  ...children,
                  {
                    type: "tool",
                    id: toolCall.id,
                    name: toolCall.name,
                    arguments: toolCall.arguments,
                    batchId: event.replyId,
                    status: "calling"
                  }
                ];
              }
            );
          } else {
            const existing = next.timeline.find(
              (item) => item.type === "tool" && item.id === toolCall.id
            );
            if (existing?.type === "tool") {
              if (existing.status !== "preparing" || existing.name !== toolCall.name) {
                throw new Error(`Invalid completed tool call definition: ${toolCall.id}`);
              }
              next.timeline = next.timeline.map((item) => item.type === "tool" && item.id === toolCall.id ? {
                ...item,
                arguments: toolCall.arguments,
                batchId: event.replyId,
                status: "calling"
              } : item);
            } else {
              next.timeline.push({
                type: "tool",
                id: toolCall.id,
                name: toolCall.name,
                arguments: toolCall.arguments,
                batchId: event.replyId,
                status: "calling",
                agentName: event.agentName
              });
            }
          }
        }
      }
      return next;
    case "TOOL_FINISHED":
      if (!event.toolCallId) {
        throw new Error("TOOL_FINISHED event has no toolCallId");
      }
      next.timeline = finishToolCall(
        next.timeline,
        event.parentToolCallId,
        event.toolCallId,
        finishedToolTimelineStatus(event.toolStatus),
        event.toolResult
      );
      return next;
    case "SUB_AGENT_FINISHED":
      if (isSubAgent) {
        next.timeline = updateToolStatus(
          next.timeline,
          event.parentToolCallId ?? "",
          "done"
        );
      }
      return next;
    case "USER_CONFIRMATION_REQUIRED":
      if (!event.replyId || !event.pendingToolCalls?.length || !event.expiresAt) {
        throw new Error("Invalid USER_CONFIRMATION_REQUIRED event");
      }
      {
        const existing = prev.pendingConfirmation;
        if (existing && (existing.runId !== event.runId || existing.replyId !== event.replyId || existing.parentToolCallId !== event.parentToolCallId || existing.expiresAt !== event.expiresAt)) {
          throw new Error("Concurrent tool confirmation batches have different identities");
        }
        const existingToolCalls = new Map(
          (existing?.toolCalls ?? []).map((toolCall) => [toolCall.toolCallId, toolCall])
        );
        const updates = /* @__PURE__ */ new Map();
        const appendedToolCalls = [];
        for (const toolCall of event.pendingToolCalls) {
          if (updates.has(toolCall.toolCallId)) {
            throw new Error(`Duplicate pending tool call: ${toolCall.toolCallId}`);
          }
          const existingToolCall = existingToolCalls.get(toolCall.toolCallId);
          if (existingToolCall && (existingToolCall.toolName !== toolCall.toolName || existingToolCall.argumentsPreview !== toolCall.argumentsPreview)) {
            throw new Error(`Pending tool call changed within its batch: ${toolCall.toolCallId}`);
          }
          updates.set(toolCall.toolCallId, {
            status: "awaiting_approval",
            expectedStatus: existingToolCall ? "awaiting_approval" : "calling",
            expectedName: toolCall.toolName,
            ...toolCall.plan ? { plan: toolCall.plan } : {}
          });
          if (!existingToolCall) appendedToolCalls.push(toolCall);
        }
        if (existing && (existing.submitting || Object.keys(existing.decisions).length > 0) && appendedToolCalls.length > 0) {
          throw new Error("Tool confirmation batch changed after a decision was submitted");
        }
        next.timeline = updateConfirmationToolStatuses(
          next.timeline,
          event.parentToolCallId,
          updates
        );
        next.pendingConfirmation = existing ? {
          ...existing,
          toolCalls: [...existing.toolCalls ?? [], ...appendedToolCalls]
        } : {
          runId: event.runId,
          replyId: event.replyId,
          ...event.parentToolCallId ? { parentToolCallId: event.parentToolCallId } : {},
          toolCalls: event.pendingToolCalls,
          expiresAt: event.expiresAt,
          decisions: {},
          submitting: false
        };
      }
      next.status = prev.status === "cancelling" ? "cancelling" : "running";
      return next;
    case "USER_CONFIRM_RESULT":
      if (!prev.pendingConfirmation) {
        throw new Error("USER_CONFIRM_RESULT has no pending confirmation");
      }
      {
        const decisions = requireConfirmationDecisions(event, prev.pendingConfirmation);
        const updates = /* @__PURE__ */ new Map();
        for (const [toolCallId, approved] of decisions) {
          updates.set(toolCallId, {
            status: approved ? "approved" : "rejected",
            expectedStatus: "awaiting_approval"
          });
        }
        next.timeline = updateConfirmationToolStatuses(
          next.timeline,
          event.parentToolCallId,
          updates
        );
      }
      next.pendingConfirmation = void 0;
      next.status = prev.status === "cancelling" ? "cancelling" : "running";
      return next;
    case "DONE":
      if (event.parentToolCallId || event.agentName) return next;
      next.status = "done";
      next.pendingConfirmation = void 0;
      if (event.content) {
        next.timeline = appendContentToTimeline(next.timeline, event.content);
      }
      return next;
    case "ERROR":
      if (isSubAgent) {
        next.timeline = updateToolStatus(
          next.timeline,
          event.parentToolCallId ?? "",
          "error"
        );
        next.timeline = appendToToolChildren(
          next.timeline,
          event.parentToolCallId ?? "",
          (children) => [
            ...children,
            {
              type: "content",
              text: `❌ ${event.agentName || "子Agent"} 出错: ${event.error || "未知错误"}`
            }
          ]
        );
      } else {
        next.status = "error";
        next.pendingConfirmation = void 0;
        next.error = event.error || "未知错误";
      }
      return next;
    case "CANCELLED":
      if (!event.parentToolCallId && !event.agentName) {
        next.status = "cancelled";
        if (event.cancellationReason === "CONFIRMATION_EXPIRED" && prev.pendingConfirmation) {
          const updates = /* @__PURE__ */ new Map();
          for (const toolCall of prev.pendingConfirmation.toolCalls ?? []) {
            updates.set(toolCall.toolCallId, {
              status: "expired",
              expectedStatus: "awaiting_approval",
              expectedName: toolCall.toolName
            });
          }
          next.timeline = updateConfirmationToolStatuses(
            next.timeline,
            prev.pendingConfirmation.parentToolCallId,
            updates
          );
        } else {
          next.timeline = cancelCallingTimelineTools(next.timeline);
        }
        next.pendingConfirmation = void 0;
        if (event.content) {
          next.timeline = appendContentToTimeline(next.timeline, event.content);
        }
      }
      return next;
    default:
      return next;
  }
}
function reduceAssistantEvent(pipeline, event) {
  const next = reducePipelineEvent(pipeline, event);
  return pipeline.status === "cancelling" && next.status === "cancelling" ? { ...next, timeline: cancelCallingTimelineTools(next.timeline) } : next;
}
function isSubAgentTool(name) {
  return subAgentToolNames().includes(name);
}
function normalizeToolResult(toolName, content) {
  if (!content || !toolName || !isSubAgentTool(toolName)) {
    return content;
  }
  try {
    const value = JSON.parse(content);
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return content;
    }
    const result = value.result;
    if (typeof result === "string" && result.trim()) {
      return result;
    }
    const error = value.error;
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  } catch {
  }
  return content;
}
function requireToolMessageIdentity(message) {
  if (!message.toolCallId) {
    throw new Error(`Persisted tool message ${message.id} has no toolCallId`);
  }
  if (!message.toolName) {
    throw new Error(`Persisted tool message ${message.id} has no toolName`);
  }
  return { toolCallId: message.toolCallId, toolName: message.toolName };
}
function fillPersistedToolArguments(item, toolCallId, toolName, toolArguments, child) {
  if (item.name !== toolName) {
    throw new Error(`Persisted ${child ? "child " : ""}tool name changed: ${toolCallId}`);
  }
  if (item.status === "calling") {
    throw new Error(`Persisted ${child ? "child " : ""}tool call is duplicated: ${toolCallId}`);
  }
  item.arguments = toolArguments;
}
function createPersistedSettledTool(toolCallId, toolName, toolStatus, content, child) {
  const status = persistedToolTimelineStatus(toolStatus);
  if (status === "cancelled") {
    if (typeof content !== "string") {
      throw new Error(`Persisted cancelled ${child ? "child " : ""}tool ${toolCallId} has no arguments`);
    }
    return {
      type: "tool",
      id: toolCallId,
      name: toolName,
      arguments: content,
      status
    };
  }
  return {
    type: "tool",
    id: toolCallId,
    name: toolName,
    arguments: "",
    status,
    result: normalizeToolResult(toolName, content)
  };
}
function pushReasoningToTimeline(timeline, text, durationMs) {
  const last = timeline[timeline.length - 1];
  if (last && last.type === "reasoning") {
    last.text += text;
    if (durationMs !== void 0) {
      last.durationMs = durationMs;
    }
    return;
  }
  timeline.push({
    type: "reasoning",
    text,
    ...durationMs !== void 0 ? { durationMs } : {}
  });
}
function pushContentToTimeline(timeline, text) {
  const last = timeline[timeline.length - 1];
  if (last && last.type === "content") {
    last.text = last.text.endsWith("\n\n") ? last.text + text : last.text.endsWith("\n") ? `${last.text}
${text}` : `${last.text}

${text}`;
    return;
  }
  timeline.push({ type: "content", text });
}
function updateLastReasoningDurationInList(items, durationMs) {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item && item.type === "reasoning") {
      item.durationMs = durationMs;
      return;
    }
  }
}
function messagesToTimeline(messages) {
  const timeline = [];
  const toolIndexMap = /* @__PURE__ */ new Map();
  const pendingParentUpdates = /* @__PURE__ */ new Map();
  const registerTool = (toolCallId, index) => {
    toolIndexMap.set(toolCallId, index);
    const pendingUpdates = pendingParentUpdates.get(toolCallId);
    if (!pendingUpdates?.length) return;
    const parentItem = timeline[index];
    if (parentItem?.type !== "tool") return;
    if (!parentItem.children) {
      parentItem.children = [];
    }
    for (const update of pendingUpdates) {
      update(parentItem.children);
    }
    pendingParentUpdates.delete(toolCallId);
  };
  const appendToParentChildren = (parentToolCallId, updater) => {
    const parentIdx = toolIndexMap.get(parentToolCallId);
    if (parentIdx === void 0) {
      const pendingUpdates = pendingParentUpdates.get(parentToolCallId) ?? [];
      pendingUpdates.push(updater);
      pendingParentUpdates.set(parentToolCallId, pendingUpdates);
      return;
    }
    const parentItem = timeline[parentIdx];
    if (parentItem?.type !== "tool") return;
    if (!parentItem.children) {
      parentItem.children = [];
    }
    updater(parentItem.children);
  };
  for (const msg of messages) {
    const reasoningDurationMs = validDuration(msg.reasoningDurationMs ?? void 0);
    if (msg.role === "tool") {
      const { toolCallId, toolName } = requireToolMessageIdentity(msg);
      if (msg.parentToolCallId) {
        appendToParentChildren(msg.parentToolCallId, (children) => {
          if (msg.toolStatus === "running") {
            if (typeof msg.content !== "string") {
              throw new Error(`Persisted tool call ${toolCallId} has no arguments`);
            }
            const existingChild2 = children.find(
              (child) => child.type === "tool" && child.id === toolCallId
            );
            if (existingChild2?.type === "tool") {
              fillPersistedToolArguments(existingChild2, toolCallId, toolName, msg.content, true);
              return;
            }
            children.push({
              type: "tool",
              id: toolCallId,
              name: toolName,
              arguments: msg.content,
              status: "calling"
            });
            return;
          }
          const existingChild = children.find(
            (child) => child.type === "tool" && child.id === toolCallId
          );
          if (existingChild && existingChild.type === "tool") {
            if (existingChild.name !== toolName) {
              throw new Error(`Persisted child tool name changed: ${toolCallId}`);
            }
            existingChild.status = persistedToolTimelineStatus(msg.toolStatus);
            existingChild.result = normalizeToolResult(toolName, msg.content);
            return;
          }
          children.push(createPersistedSettledTool(toolCallId, toolName, msg.toolStatus, msg.content, true));
        });
        continue;
      }
      const existingIdx = toolIndexMap.get(toolCallId);
      if (msg.toolStatus === "running") {
        if (typeof msg.content !== "string") {
          throw new Error(`Persisted tool call ${toolCallId} has no arguments`);
        }
        if (existingIdx !== void 0) {
          const existingItem = timeline[existingIdx];
          if (existingItem?.type === "tool") {
            fillPersistedToolArguments(existingItem, toolCallId, toolName, msg.content, false);
          }
          continue;
        }
        const idx2 = timeline.length;
        timeline.push({
          type: "tool",
          id: toolCallId,
          name: toolName,
          arguments: msg.content,
          status: "calling"
        });
        registerTool(toolCallId, idx2);
        continue;
      }
      if (existingIdx !== void 0) {
        const existingItem = timeline[existingIdx];
        if (existingItem?.type === "tool") {
          if (existingItem.name !== toolName) {
            throw new Error(`Persisted tool name changed: ${toolCallId}`);
          }
          existingItem.status = persistedToolTimelineStatus(msg.toolStatus);
          existingItem.result = normalizeToolResult(toolName, msg.content);
        }
        continue;
      }
      const idx = timeline.length;
      timeline.push(createPersistedSettledTool(toolCallId, toolName, msg.toolStatus, msg.content, false));
      registerTool(toolCallId, idx);
      continue;
    }
    if (msg.parentToolCallId) {
      appendToParentChildren(msg.parentToolCallId, (children) => {
        if (msg.reasoningContent) {
          pushReasoningToSubTimelineList(children, msg.reasoningContent, reasoningDurationMs);
        } else if (reasoningDurationMs !== void 0) {
          updateLastReasoningDurationInList(children, reasoningDurationMs);
        }
        if (msg.content) {
          if (reasoningDurationMs !== void 0) {
            updateLastReasoningDurationInList(children, reasoningDurationMs);
          }
          pushContentToSubTimelineList(children, msg.content);
        }
      });
      continue;
    }
    if (msg.reasoningContent) {
      pushReasoningToTimeline(timeline, msg.reasoningContent, reasoningDurationMs);
    } else if (reasoningDurationMs !== void 0) {
      updateLastTimelineReasoningDuration(timeline, reasoningDurationMs);
    }
    if (msg.content) {
      if (reasoningDurationMs !== void 0) {
        updateLastTimelineReasoningDuration(timeline, reasoningDurationMs);
      }
      pushContentToTimeline(timeline, msg.content);
    }
  }
  return timeline;
}
function pushReasoningToSubTimelineList(children, text, durationMs) {
  const last = children[children.length - 1];
  if (last && last.type === "reasoning") {
    last.text += text;
    if (durationMs !== void 0) {
      last.durationMs = durationMs;
    }
    return;
  }
  children.push({
    type: "reasoning",
    text,
    ...durationMs !== void 0 ? { durationMs } : {}
  });
}
function pushContentToSubTimelineList(children, text) {
  const last = children[children.length - 1];
  if (last && last.type === "content") {
    last.text = last.text.endsWith("\n\n") ? last.text + text : last.text.endsWith("\n") ? `${last.text}
${text}` : `${last.text}

${text}`;
    return;
  }
  children.push({ type: "content", text });
}
function messageKey(message) {
  if (message.role === "user" && message.messageOrder > 0) {
    return `user:${message.conversationId}:${message.messageOrder}:${message.content ?? ""}`;
  }
  if (message.id > 0) return `id:${message.id}`;
  if (message.runId && message.projectionKey) return `projection:${message.runId}:${message.projectionKey}`;
  return [message.role, message.messageOrder, message.content ?? "", message.toolCallId ?? ""].join(":");
}
function mergeMessages(current, incoming) {
  const merged = /* @__PURE__ */ new Map();
  for (const message of [...current, ...incoming]) merged.set(messageKey(message), message);
  return [...merged.values()].sort((a, b) => (a.messageOrder ?? 0) - (b.messageOrder ?? 0));
}
function timelineForMessages(messages) {
  return messagesToTimeline(messages.filter((message) => message.role !== "user"));
}
function uniqueConversations(current, incoming) {
  const byId = new Map(current.map((conversation) => [conversation.conversationId, conversation]));
  for (const conversation of incoming) byId.set(conversation.conversationId, conversation);
  return [...byId.values()].sort((a, b) => {
    const left = new Date(a.lastMessageTime ?? a.createTime ?? 0).getTime();
    const right = new Date(b.lastMessageTime ?? b.createTime ?? 0).getTime();
    return right - left;
  });
}
const DEGRADED_SCOPE = Object.freeze({
  resolved: false,
  degraded: true
});
function isRecord$1(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeToolCallScope(scope) {
  if (!isRecord$1(scope)) return { ...DEGRADED_SCOPE };
  const summary = typeof scope.summary === "string" && scope.summary.trim() ? scope.summary : void 0;
  const withSummary = (base) => summary ? { ...base, summary } : base;
  if (scope.degraded !== false) {
    return withSummary({ resolved: false, degraded: true });
  }
  if (scope.resolved === true) {
    return withSummary({ resolved: true, degraded: false });
  }
  return withSummary({ resolved: false, degraded: true });
}
function pendingScopeDigest(toolCalls) {
  let degraded = false;
  let degradedSummary;
  let resolvedSummary;
  let count = 0;
  for (const toolCall of toolCalls ?? []) {
    count++;
    const scope = normalizeToolCallScope(toolCall?.scope);
    if (scope.degraded) {
      degraded = true;
      degradedSummary = degradedSummary ?? scope.summary;
    } else {
      resolvedSummary = resolvedSummary ?? scope.summary;
    }
  }
  const summary = degradedSummary ?? resolvedSummary;
  if (count === 0 || degraded) {
    return summary ? { resolved: false, degraded: true, summary } : { ...DEGRADED_SCOPE };
  }
  return summary ? { resolved: true, degraded: false, summary } : { resolved: true, degraded: false };
}
// @__NO_SIDE_EFFECTS__
function makeMap(str) {
  const map = /* @__PURE__ */ Object.create(null);
  for (const key of str.split(",")) map[key] = 1;
  return (val) => val in map;
}
const EMPTY_OBJ = {};
const EMPTY_ARR = [];
const NOOP = () => {
};
const NO = () => false;
const isOn = (key) => key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && // uppercase letter
(key.charCodeAt(2) > 122 || key.charCodeAt(2) < 97);
const isModelListener = (key) => key.startsWith("onUpdate:");
const extend = Object.assign;
const remove = (arr, el) => {
  const i = arr.indexOf(el);
  if (i > -1) {
    arr.splice(i, 1);
  }
};
const hasOwnProperty$1 = Object.prototype.hasOwnProperty;
const hasOwn = (val, key) => hasOwnProperty$1.call(val, key);
const isArray = Array.isArray;
const isMap = (val) => toTypeString(val) === "[object Map]";
const isSet = (val) => toTypeString(val) === "[object Set]";
const isDate = (val) => toTypeString(val) === "[object Date]";
const isFunction = (val) => typeof val === "function";
const isString = (val) => typeof val === "string";
const isSymbol = (val) => typeof val === "symbol";
const isObject = (val) => val !== null && typeof val === "object";
const isPromise = (val) => {
  return (isObject(val) || isFunction(val)) && isFunction(val.then) && isFunction(val.catch);
};
const objectToString = Object.prototype.toString;
const toTypeString = (value) => objectToString.call(value);
const toRawType = (value) => {
  return toTypeString(value).slice(8, -1);
};
const isPlainObject$1 = (val) => toTypeString(val) === "[object Object]";
const isIntegerKey = (key) => isString(key) && key !== "NaN" && key[0] !== "-" && "" + parseInt(key, 10) === key;
const isReservedProp = /* @__PURE__ */ makeMap(
  // the leading comma is intentional so empty string "" is also included
  ",key,ref,ref_for,ref_key,onVnodeBeforeMount,onVnodeMounted,onVnodeBeforeUpdate,onVnodeUpdated,onVnodeBeforeUnmount,onVnodeUnmounted"
);
const cacheStringFunction = (fn) => {
  const cache = /* @__PURE__ */ Object.create(null);
  return ((str) => {
    const hit = cache[str];
    return hit || (cache[str] = fn(str));
  });
};
const camelizeRE = /-\w/g;
const camelize = cacheStringFunction(
  (str) => {
    return str.replace(camelizeRE, (c) => c.slice(1).toUpperCase());
  }
);
const hyphenateRE = /\B([A-Z])/g;
const hyphenate = cacheStringFunction(
  (str) => str.replace(hyphenateRE, "-$1").toLowerCase()
);
const capitalize = cacheStringFunction((str) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
});
const toHandlerKey = cacheStringFunction(
  (str) => {
    const s = str ? `on${capitalize(str)}` : ``;
    return s;
  }
);
const hasChanged = (value, oldValue) => !Object.is(value, oldValue);
const invokeArrayFns = (fns, ...arg) => {
  for (let i = 0; i < fns.length; i++) {
    fns[i](...arg);
  }
};
const def = (obj, key, value, writable = false) => {
  Object.defineProperty(obj, key, {
    configurable: true,
    enumerable: false,
    writable,
    value
  });
};
const looseToNumber = (val) => {
  const n = parseFloat(val);
  return isNaN(n) ? val : n;
};
const toNumber = (val) => {
  const n = isString(val) ? Number(val) : NaN;
  return isNaN(n) ? val : n;
};
let _globalThis;
const getGlobalThis = () => {
  return _globalThis || (_globalThis = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
};
function normalizeStyle(value) {
  if (isArray(value)) {
    const res = {};
    for (let i = 0; i < value.length; i++) {
      const item = value[i];
      const normalized = isString(item) ? parseStringStyle(item) : normalizeStyle(item);
      if (normalized) {
        for (const key in normalized) {
          res[key] = normalized[key];
        }
      }
    }
    return res;
  } else if (isString(value) || isObject(value)) {
    return value;
  }
}
const listDelimiterRE = /;(?![^(]*\))/g;
const propertyDelimiterRE = /:([^]+)/;
const styleCommentRE = /"(?:[^"\\]|\\[^])*"|'(?:[^'\\]|\\[^])*'|\\[^]|\/\*[^]*?\*\//g;
function parseStringStyle(cssText) {
  const ret = {};
  cssText.replace(styleCommentRE, (match) => match.startsWith("/*") ? "" : match).split(listDelimiterRE).forEach((item) => {
    if (item) {
      const tmp = item.split(propertyDelimiterRE);
      tmp.length > 1 && (ret[tmp[0].trim()] = tmp[1].trim());
    }
  });
  return ret;
}
function normalizeClass(value) {
  let res = "";
  if (isString(value)) {
    res = value;
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const normalized = normalizeClass(value[i]);
      if (normalized) {
        res += normalized + " ";
      }
    }
  } else if (isObject(value)) {
    for (const name in value) {
      if (value[name]) {
        res += name + " ";
      }
    }
  }
  return res.trim();
}
const specialBooleanAttrs = `itemscope,allowfullscreen,formnovalidate,ismap,nomodule,novalidate,readonly`;
const isSpecialBooleanAttr = /* @__PURE__ */ makeMap(specialBooleanAttrs);
function includeBooleanAttr(value) {
  return !!value || value === "";
}
function looseCompareArrays(a, b, seen) {
  if (a.length !== b.length) return false;
  let equal = true;
  for (let i = 0; equal && i < a.length; i++) {
    equal = looseEqual(a[i], b[i], seen);
  }
  return equal;
}
function looseCompareCollections(a, b, seen) {
  if (a.size !== b.size) return false;
  const candidates = Array.from(b);
  const matched = new Uint8Array(candidates.length);
  for (const item of a) {
    let index = -1;
    for (let i = 0; i < candidates.length; i++) {
      if (!matched[i] && looseEqual(item, candidates[i], seen)) {
        index = i;
        break;
      }
    }
    if (index < 0) return false;
    matched[index] = 1;
  }
  return true;
}
function looseCompareObjects(a, b, seen) {
  let aValidType = isMap(a);
  let bValidType = isMap(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? looseCompareCollections(a, b, seen) : false;
  }
  aValidType = isSet(a);
  bValidType = isSet(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? looseCompareCollections(a, b, seen) : false;
  }
  const aKeysCount = Object.keys(a).length;
  const bKeysCount = Object.keys(b).length;
  if (aKeysCount !== bKeysCount) {
    return false;
  }
  for (const key in a) {
    const aHasKey = a.hasOwnProperty(key);
    const bHasKey = b.hasOwnProperty(key);
    if (aHasKey && !bHasKey || !aHasKey && bHasKey || !looseEqual(a[key], b[key], seen)) {
      return false;
    }
  }
  return String(a) === String(b);
}
function looseCompareNested(a, b, seen, compare) {
  if (!seen) {
    seen = [/* @__PURE__ */ new Map(), /* @__PURE__ */ new Map()];
  }
  const [seenA, seenB] = seen;
  if (seenA.has(a) || seenB.has(b)) {
    return seenA.get(a) === b && seenB.get(b) === a;
  }
  seenA.set(a, b);
  seenB.set(b, a);
  const equal = compare(a, b, seen);
  seenA.delete(a);
  seenB.delete(b);
  return equal;
}
function looseEqual(a, b, seen) {
  if (a === b) return true;
  let aValidType = isDate(a);
  let bValidType = isDate(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? a.getTime() === b.getTime() : false;
  }
  aValidType = isSymbol(a);
  bValidType = isSymbol(b);
  if (aValidType || bValidType) {
    return a === b;
  }
  aValidType = isArray(a);
  bValidType = isArray(b);
  if (aValidType || bValidType) {
    return aValidType && bValidType ? looseCompareNested(a, b, seen, looseCompareArrays) : false;
  }
  aValidType = isObject(a);
  bValidType = isObject(b);
  if (aValidType || bValidType) {
    if (!aValidType || !bValidType) {
      return false;
    }
    return looseCompareNested(a, b, seen, looseCompareObjects);
  }
  return String(a) === String(b);
}
const isRef$1 = (val) => {
  return !!(val && val["__v_isRef"] === true);
};
const toDisplayString = (val) => {
  return isString(val) ? val : val == null ? "" : isArray(val) || isObject(val) && (val.toString === objectToString || !isFunction(val.toString)) ? isRef$1(val) ? toDisplayString(val.value) : JSON.stringify(val, replacer, 2) : String(val);
};
const replacer = (_key, val) => {
  if (isRef$1(val)) {
    return replacer(_key, val.value);
  } else if (isMap(val)) {
    return {
      [`Map(${val.size})`]: [...val.entries()].reduce(
        (entries, [key, val2], i) => {
          entries[stringifySymbol(key, i) + " =>"] = val2;
          return entries;
        },
        {}
      )
    };
  } else if (isSet(val)) {
    return {
      [`Set(${val.size})`]: [...val.values()].map((v) => stringifySymbol(v))
    };
  } else if (isSymbol(val)) {
    return stringifySymbol(val);
  } else if (isObject(val) && !isArray(val) && !isPlainObject$1(val)) {
    return String(val);
  }
  return val;
};
const stringifySymbol = (v, i = "") => {
  var _a;
  return (
    // Symbol.description in es2019+ so we need to cast here to pass
    // the lib: es2016 check
    isSymbol(v) ? `Symbol(${(_a = v.description) != null ? _a : i})` : v
  );
};
let activeEffectScope;
class EffectScope {
  // TODO isolatedDeclarations "__v_skip"
  constructor(detached = false) {
    this.detached = detached;
    this._active = true;
    this._on = 0;
    this.effects = [];
    this.cleanups = [];
    this._isPaused = false;
    this._warnOnRun = true;
    this.__v_skip = true;
    if (!detached && activeEffectScope) {
      if (activeEffectScope.active) {
        this.parent = activeEffectScope;
        this.index = (activeEffectScope.scopes || (activeEffectScope.scopes = [])).push(
          this
        ) - 1;
      } else {
        this._active = false;
        this._warnOnRun = false;
      }
    }
  }
  get active() {
    return this._active;
  }
  pause() {
    if (this._active) {
      this._isPaused = true;
      let i, l;
      if (this.scopes) {
        const scopes = this.scopes.slice();
        for (i = 0, l = scopes.length; i < l; i++) {
          scopes[i].pause();
        }
      }
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].pause();
      }
    }
  }
  /**
   * Resumes the effect scope, including all child scopes and effects.
   */
  resume() {
    if (this._active) {
      if (this._isPaused) {
        this._isPaused = false;
        let i, l;
        if (this.scopes) {
          const scopes = this.scopes.slice();
          for (i = 0, l = scopes.length; i < l; i++) {
            scopes[i].resume();
          }
        }
        const effects = this.effects.slice();
        for (i = 0, l = effects.length; i < l; i++) {
          effects[i].resume();
        }
      }
    }
  }
  run(fn) {
    if (this._active) {
      const currentEffectScope = activeEffectScope;
      try {
        activeEffectScope = this;
        return fn();
      } finally {
        activeEffectScope = currentEffectScope;
      }
    }
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  on() {
    if (++this._on === 1) {
      this.prevScope = activeEffectScope;
      activeEffectScope = this;
    }
  }
  /**
   * This should only be called on non-detached scopes
   * @internal
   */
  off() {
    if (this._on > 0 && --this._on === 0) {
      if (activeEffectScope === this) {
        activeEffectScope = this.prevScope;
      } else {
        let current = activeEffectScope;
        while (current) {
          if (current.prevScope === this) {
            current.prevScope = this.prevScope;
            break;
          }
          current = current.prevScope;
        }
      }
      this.prevScope = void 0;
    }
  }
  stop(fromParent) {
    if (this._active) {
      this._active = false;
      let i, l;
      for (i = 0, l = this.effects.length; i < l; i++) {
        this.effects[i].stop();
      }
      this.effects.length = 0;
      for (i = 0, l = this.cleanups.length; i < l; i++) {
        this.cleanups[i]();
      }
      this.cleanups.length = 0;
      if (this.scopes) {
        const scopes = this.scopes.slice();
        for (i = 0, l = scopes.length; i < l; i++) {
          scopes[i].stop(true);
        }
        this.scopes.length = 0;
      }
      if (!this.detached && this.parent && !fromParent) {
        const last = this.parent.scopes.pop();
        if (last && last !== this) {
          this.parent.scopes[this.index] = last;
          last.index = this.index;
        }
      }
      this.parent = void 0;
    }
  }
}
function effectScope(detached) {
  return new EffectScope(detached);
}
function getCurrentScope() {
  return activeEffectScope;
}
function onScopeDispose(fn, failSilently = false) {
  if (activeEffectScope) {
    activeEffectScope.cleanups.push(fn);
  }
}
let activeSub;
const pausedQueueEffects = /* @__PURE__ */ new WeakSet();
class ReactiveEffect {
  constructor(fn) {
    this.fn = fn;
    this.deps = void 0;
    this.depsTail = void 0;
    this.flags = 1 | 4;
    this.next = void 0;
    this.cleanup = void 0;
    this.scheduler = void 0;
    if (activeEffectScope) {
      if (activeEffectScope.active) {
        activeEffectScope.effects.push(this);
      } else {
        this.flags &= -2;
      }
    }
  }
  pause() {
    this.flags |= 64;
  }
  resume() {
    if (this.flags & 64) {
      this.flags &= -65;
      if (pausedQueueEffects.has(this)) {
        pausedQueueEffects.delete(this);
        this.trigger();
      }
    }
  }
  /**
   * @internal
   */
  notify() {
    if (this.flags & 2 && !(this.flags & 32)) {
      return;
    }
    if (!(this.flags & 8)) {
      batch(this);
    }
  }
  run() {
    if (!(this.flags & 1)) {
      return this.fn();
    }
    this.flags |= 2;
    cleanupEffect(this);
    prepareDeps(this);
    const prevEffect = activeSub;
    const prevShouldTrack = shouldTrack;
    activeSub = this;
    shouldTrack = true;
    try {
      return this.fn();
    } finally {
      cleanupDeps(this);
      activeSub = prevEffect;
      shouldTrack = prevShouldTrack;
      this.flags &= -3;
    }
  }
  stop() {
    if (this.flags & 1) {
      for (let link = this.deps; link; link = link.nextDep) {
        removeSub(link);
      }
      this.deps = this.depsTail = void 0;
      cleanupEffect(this);
      this.onStop && this.onStop();
      this.flags &= -2;
    }
  }
  trigger() {
    if (this.flags & 64) {
      pausedQueueEffects.add(this);
    } else if (this.scheduler) {
      this.scheduler();
    } else {
      this.runIfDirty();
    }
  }
  /**
   * @internal
   */
  runIfDirty() {
    if (isDirty(this)) {
      this.run();
    }
  }
  get dirty() {
    return isDirty(this);
  }
}
let batchDepth = 0;
let batchedSub;
let batchedComputed;
function batch(sub, isComputed2 = false) {
  sub.flags |= 8;
  if (isComputed2) {
    sub.next = batchedComputed;
    batchedComputed = sub;
    return;
  }
  sub.next = batchedSub;
  batchedSub = sub;
}
function startBatch() {
  batchDepth++;
}
function endBatch() {
  if (--batchDepth > 0) {
    return;
  }
  if (batchedComputed) {
    let e = batchedComputed;
    batchedComputed = void 0;
    while (e) {
      const next = e.next;
      e.next = void 0;
      e.flags &= -9;
      e = next;
    }
  }
  let error;
  while (batchedSub) {
    let e = batchedSub;
    batchedSub = void 0;
    while (e) {
      const next = e.next;
      e.next = void 0;
      e.flags &= -9;
      if (e.flags & 1) {
        try {
          ;
          e.trigger();
        } catch (err) {
          if (!error) error = err;
        }
      }
      e = next;
    }
  }
  if (error) throw error;
}
function prepareDeps(sub) {
  for (let link = sub.deps; link; link = link.nextDep) {
    link.version = -1;
    link.prevActiveLink = link.dep.activeLink;
    link.dep.activeLink = link;
  }
}
function cleanupDeps(sub) {
  let head;
  let tail = sub.depsTail;
  let link = tail;
  while (link) {
    const prev = link.prevDep;
    if (link.version === -1) {
      if (link === tail) tail = prev;
      removeSub(link);
      removeDep(link);
    } else {
      head = link;
    }
    link.dep.activeLink = link.prevActiveLink;
    link.prevActiveLink = void 0;
    link = prev;
  }
  sub.deps = head;
  sub.depsTail = tail;
}
function isDirty(sub) {
  for (let link = sub.deps; link; link = link.nextDep) {
    if (link.dep.version !== link.version || link.dep.computed && (refreshComputed(link.dep.computed) || link.dep.version !== link.version)) {
      return true;
    }
  }
  if (sub._dirty) {
    return true;
  }
  return false;
}
function refreshComputed(computed2) {
  if (computed2.flags & 4 && !(computed2.flags & 16)) {
    return;
  }
  computed2.flags &= -17;
  if (computed2.globalVersion === globalVersion) {
    return;
  }
  computed2.globalVersion = globalVersion;
  if (!computed2.isSSR && computed2.flags & 128 && (!computed2.deps && !computed2._dirty || !isDirty(computed2))) {
    return;
  }
  computed2.flags |= 2;
  const dep = computed2.dep;
  const prevSub = activeSub;
  const prevShouldTrack = shouldTrack;
  activeSub = computed2;
  shouldTrack = true;
  try {
    prepareDeps(computed2);
    const value = computed2.fn(computed2._value);
    if (dep.version === 0 || hasChanged(value, computed2._value)) {
      computed2.flags |= 128;
      computed2._value = value;
      dep.version++;
    }
  } catch (err) {
    dep.version++;
    throw err;
  } finally {
    activeSub = prevSub;
    shouldTrack = prevShouldTrack;
    cleanupDeps(computed2);
    computed2.flags &= -3;
  }
}
function removeSub(link, soft = false) {
  const { dep, prevSub, nextSub } = link;
  if (prevSub) {
    prevSub.nextSub = nextSub;
    link.prevSub = void 0;
  }
  if (nextSub) {
    nextSub.prevSub = prevSub;
    link.nextSub = void 0;
  }
  if (dep.subs === link) {
    dep.subs = prevSub;
    if (!prevSub && dep.computed) {
      dep.computed.flags &= -5;
      for (let l = dep.computed.deps; l; l = l.nextDep) {
        removeSub(l, true);
      }
    }
  }
  if (!soft && !--dep.sc && dep.map) {
    dep.map.delete(dep.key);
  }
}
function removeDep(link) {
  const { prevDep, nextDep } = link;
  if (prevDep) {
    prevDep.nextDep = nextDep;
    link.prevDep = void 0;
  }
  if (nextDep) {
    nextDep.prevDep = prevDep;
    link.nextDep = void 0;
  }
}
let shouldTrack = true;
const trackStack = [];
function pauseTracking() {
  trackStack.push(shouldTrack);
  shouldTrack = false;
}
function resetTracking() {
  const last = trackStack.pop();
  shouldTrack = last === void 0 ? true : last;
}
function cleanupEffect(e) {
  const { cleanup } = e;
  e.cleanup = void 0;
  if (cleanup) {
    const prevSub = activeSub;
    activeSub = void 0;
    try {
      cleanup();
    } finally {
      activeSub = prevSub;
    }
  }
}
let globalVersion = 0;
class Link {
  constructor(sub, dep) {
    this.sub = sub;
    this.dep = dep;
    this.version = dep.version;
    this.nextDep = this.prevDep = this.nextSub = this.prevSub = this.prevActiveLink = void 0;
  }
}
class Dep {
  // TODO isolatedDeclarations "__v_skip"
  constructor(computed2) {
    this.computed = computed2;
    this.version = 0;
    this.activeLink = void 0;
    this.subs = void 0;
    this.map = void 0;
    this.key = void 0;
    this.sc = 0;
    this.__v_skip = true;
  }
  track(debugInfo) {
    if (!activeSub || !shouldTrack || activeSub === this.computed) {
      return;
    }
    let link = this.activeLink;
    if (link === void 0 || link.sub !== activeSub) {
      link = this.activeLink = new Link(activeSub, this);
      if (!activeSub.deps) {
        activeSub.deps = activeSub.depsTail = link;
      } else {
        link.prevDep = activeSub.depsTail;
        activeSub.depsTail.nextDep = link;
        activeSub.depsTail = link;
      }
      addSub(link);
    } else if (link.version === -1) {
      link.version = this.version;
      if (link.nextDep) {
        const next = link.nextDep;
        next.prevDep = link.prevDep;
        if (link.prevDep) {
          link.prevDep.nextDep = next;
        }
        link.prevDep = activeSub.depsTail;
        link.nextDep = void 0;
        activeSub.depsTail.nextDep = link;
        activeSub.depsTail = link;
        if (activeSub.deps === link) {
          activeSub.deps = next;
        }
      }
    }
    return link;
  }
  trigger(debugInfo) {
    this.version++;
    globalVersion++;
    this.notify(debugInfo);
  }
  notify(debugInfo) {
    startBatch();
    try {
      if (false) ;
      for (let link = this.subs; link; link = link.prevSub) {
        if (link.sub.notify()) {
          ;
          link.sub.dep.notify();
        }
      }
    } finally {
      endBatch();
    }
  }
}
function addSub(link) {
  link.dep.sc++;
  if (link.sub.flags & 4) {
    const computed2 = link.dep.computed;
    if (computed2 && !link.dep.subs) {
      computed2.flags |= 4 | 16;
      for (let l = computed2.deps; l; l = l.nextDep) {
        addSub(l);
      }
    }
    const currentTail = link.dep.subs;
    if (currentTail !== link) {
      link.prevSub = currentTail;
      if (currentTail) currentTail.nextSub = link;
    }
    link.dep.subs = link;
  }
}
const targetMap = /* @__PURE__ */ new WeakMap();
const ITERATE_KEY = /* @__PURE__ */ Symbol(
  ""
);
const MAP_KEY_ITERATE_KEY = /* @__PURE__ */ Symbol(
  ""
);
const ARRAY_ITERATE_KEY = /* @__PURE__ */ Symbol(
  ""
);
function track(target, type, key) {
  if (shouldTrack && activeSub) {
    let depsMap = targetMap.get(target);
    if (!depsMap) {
      targetMap.set(target, depsMap = /* @__PURE__ */ new Map());
    }
    let dep = depsMap.get(key);
    if (!dep) {
      depsMap.set(key, dep = new Dep());
      dep.map = depsMap;
      dep.key = key;
    }
    {
      dep.track();
    }
  }
}
function trigger(target, type, key, newValue, oldValue, oldTarget) {
  const depsMap = targetMap.get(target);
  if (!depsMap) {
    globalVersion++;
    return;
  }
  const run = (dep) => {
    if (dep) {
      {
        dep.trigger();
      }
    }
  };
  startBatch();
  if (type === "clear") {
    depsMap.forEach(run);
  } else {
    const targetIsArray = isArray(target);
    const isArrayIndex = targetIsArray && isIntegerKey(key);
    if (targetIsArray && key === "length") {
      const newLength = Number(newValue);
      depsMap.forEach((dep, key2) => {
        if (key2 === "length" || key2 === ARRAY_ITERATE_KEY || !isSymbol(key2) && key2 >= newLength) {
          run(dep);
        }
      });
    } else {
      if (key !== void 0 || depsMap.has(void 0)) {
        run(depsMap.get(key));
      }
      if (isArrayIndex) {
        run(depsMap.get(ARRAY_ITERATE_KEY));
      }
      switch (type) {
        case "add":
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY));
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY));
            }
          } else if (isArrayIndex) {
            run(depsMap.get("length"));
          }
          break;
        case "delete":
          if (!targetIsArray) {
            run(depsMap.get(ITERATE_KEY));
            if (isMap(target)) {
              run(depsMap.get(MAP_KEY_ITERATE_KEY));
            }
          }
          break;
        case "set":
          if (isMap(target)) {
            run(depsMap.get(ITERATE_KEY));
          }
          break;
      }
    }
  }
  endBatch();
}
function getDepFromReactive(object, key) {
  const depMap = targetMap.get(object);
  return depMap && depMap.get(key);
}
function reactiveReadArray(array) {
  const raw = /* @__PURE__ */ toRaw(array);
  if (raw === array) return raw;
  track(raw, "iterate", ARRAY_ITERATE_KEY);
  if (/* @__PURE__ */ isShallow(array)) return raw;
  if (!/* @__PURE__ */ isReadonly(array)) return raw.map(toReactive);
  return /* @__PURE__ */ isReactive(array) ? raw.map((item) => toReadonly(toReactive(item))) : raw.map(toReadonly);
}
function shallowReadArray(arr) {
  track(arr = /* @__PURE__ */ toRaw(arr), "iterate", ARRAY_ITERATE_KEY);
  return arr;
}
function toWrapped(target, item) {
  if (/* @__PURE__ */ isReadonly(target)) {
    return /* @__PURE__ */ isReactive(target) ? toReadonly(toReactive(item)) : toReadonly(item);
  }
  return toReactive(item);
}
const arrayInstrumentations = {
  __proto__: null,
  [Symbol.iterator]() {
    return iterator(this, Symbol.iterator, (item) => toWrapped(this, item));
  },
  concat(...args) {
    return reactiveReadArray(this).concat(
      ...args.map((x) => isArray(x) ? reactiveReadArray(x) : x)
    );
  },
  entries() {
    return iterator(this, "entries", (value) => {
      value[1] = toWrapped(this, value[1]);
      return value;
    });
  },
  every(fn, thisArg) {
    return apply(this, "every", fn, thisArg, void 0, arguments);
  },
  filter(fn, thisArg) {
    return apply(
      this,
      "filter",
      fn,
      thisArg,
      (v) => v.map((item) => toWrapped(this, item)),
      arguments
    );
  },
  find(fn, thisArg) {
    return apply(
      this,
      "find",
      fn,
      thisArg,
      (item) => toWrapped(this, item),
      arguments
    );
  },
  findIndex(fn, thisArg) {
    return apply(this, "findIndex", fn, thisArg, void 0, arguments);
  },
  findLast(fn, thisArg) {
    return apply(
      this,
      "findLast",
      fn,
      thisArg,
      (item) => toWrapped(this, item),
      arguments
    );
  },
  findLastIndex(fn, thisArg) {
    return apply(this, "findLastIndex", fn, thisArg, void 0, arguments);
  },
  // flat, flatMap could benefit from ARRAY_ITERATE but are not straight-forward to implement
  forEach(fn, thisArg) {
    return apply(this, "forEach", fn, thisArg, void 0, arguments);
  },
  includes(...args) {
    return searchProxy(this, "includes", args);
  },
  indexOf(...args) {
    return searchProxy(this, "indexOf", args);
  },
  join(separator) {
    return reactiveReadArray(this).join(separator);
  },
  // keys() iterator only reads `length`, no optimization required
  lastIndexOf(...args) {
    return searchProxy(this, "lastIndexOf", args);
  },
  map(fn, thisArg) {
    return apply(this, "map", fn, thisArg, void 0, arguments);
  },
  pop() {
    return noTracking(this, "pop");
  },
  push(...args) {
    return noTracking(this, "push", args);
  },
  reduce(fn, ...args) {
    return reduce(this, "reduce", fn, args);
  },
  reduceRight(fn, ...args) {
    return reduce(this, "reduceRight", fn, args);
  },
  shift() {
    return noTracking(this, "shift");
  },
  // slice could use ARRAY_ITERATE but also seems to beg for range tracking
  some(fn, thisArg) {
    return apply(this, "some", fn, thisArg, void 0, arguments);
  },
  splice(...args) {
    return noTracking(this, "splice", args);
  },
  toReversed() {
    return reactiveReadArray(this).toReversed();
  },
  toSorted(comparer) {
    return reactiveReadArray(this).toSorted(comparer);
  },
  toSpliced(...args) {
    return reactiveReadArray(this).toSpliced(...args);
  },
  unshift(...args) {
    return noTracking(this, "unshift", args);
  },
  values() {
    return iterator(this, "values", (item) => toWrapped(this, item));
  }
};
function iterator(self2, method, wrapValue) {
  const arr = shallowReadArray(self2);
  const iter = arr[method]();
  if (arr !== self2 && !/* @__PURE__ */ isShallow(self2)) {
    iter._next = iter.next;
    iter.next = () => {
      const result = iter._next();
      if (!result.done) {
        result.value = wrapValue(result.value);
      }
      return result;
    };
  }
  return iter;
}
const arrayProto = Array.prototype;
function apply(self2, method, fn, thisArg, wrappedRetFn, args) {
  const arr = shallowReadArray(self2);
  const needsWrap = arr !== self2 && !/* @__PURE__ */ isShallow(self2);
  const methodFn = arr[method];
  if (methodFn !== arrayProto[method]) {
    const result2 = methodFn.apply(self2, args);
    return needsWrap ? toReactive(result2) : result2;
  }
  let wrappedFn = fn;
  if (arr !== self2) {
    if (needsWrap) {
      wrappedFn = function(item, index) {
        return fn.call(this, toWrapped(self2, item), index, self2);
      };
    } else if (fn.length > 2) {
      wrappedFn = function(item, index) {
        return fn.call(this, item, index, self2);
      };
    }
  }
  const result = methodFn.call(arr, wrappedFn, thisArg);
  return needsWrap && wrappedRetFn ? wrappedRetFn(result) : result;
}
function reduce(self2, method, fn, args) {
  const arr = shallowReadArray(self2);
  const needsWrap = arr !== self2 && !/* @__PURE__ */ isShallow(self2);
  let wrappedFn = fn;
  let wrapInitialAccumulator = false;
  if (arr !== self2) {
    if (needsWrap) {
      wrapInitialAccumulator = args.length === 0;
      wrappedFn = function(acc, item, index) {
        if (wrapInitialAccumulator) {
          wrapInitialAccumulator = false;
          acc = toWrapped(self2, acc);
        }
        return fn.call(this, acc, toWrapped(self2, item), index, self2);
      };
    } else if (fn.length > 3) {
      wrappedFn = function(acc, item, index) {
        return fn.call(this, acc, item, index, self2);
      };
    }
  }
  const result = arr[method](wrappedFn, ...args);
  return wrapInitialAccumulator ? toWrapped(self2, result) : result;
}
function searchProxy(self2, method, args) {
  const arr = /* @__PURE__ */ toRaw(self2);
  track(arr, "iterate", ARRAY_ITERATE_KEY);
  const res = arr[method](...args);
  if ((res === -1 || res === false) && /* @__PURE__ */ isProxy(args[0])) {
    args[0] = /* @__PURE__ */ toRaw(args[0]);
    return arr[method](...args);
  }
  return res;
}
function noTracking(self2, method, args = []) {
  pauseTracking();
  startBatch();
  const res = (/* @__PURE__ */ toRaw(self2))[method].apply(self2, args);
  endBatch();
  resetTracking();
  return res;
}
const isNonTrackableKeys = /* @__PURE__ */ makeMap(`__proto__,__v_isRef,__isVue`);
const builtInSymbols = new Set(
  /* @__PURE__ */ Object.getOwnPropertyNames(Symbol).filter((key) => key !== "arguments" && key !== "caller").map((key) => Symbol[key]).filter(isSymbol)
);
function hasOwnProperty(key) {
  if (!isSymbol(key)) key = String(key);
  const obj = /* @__PURE__ */ toRaw(this);
  track(obj, "has", key);
  return obj.hasOwnProperty(key);
}
class BaseReactiveHandler {
  constructor(_isReadonly = false, _isShallow = false) {
    this._isReadonly = _isReadonly;
    this._isShallow = _isShallow;
  }
  get(target, key, receiver) {
    if (key === "__v_skip") return target["__v_skip"];
    const isReadonly2 = this._isReadonly, isShallow2 = this._isShallow;
    if (key === "__v_isReactive") {
      return !isReadonly2;
    } else if (key === "__v_isReadonly") {
      return isReadonly2;
    } else if (key === "__v_isShallow") {
      return isShallow2;
    } else if (key === "__v_raw") {
      if (receiver === (isReadonly2 ? isShallow2 ? shallowReadonlyMap : readonlyMap : isShallow2 ? shallowReactiveMap : reactiveMap).get(target) || // receiver is not the reactive proxy, but has the same prototype
      // this means the receiver is a user proxy of the reactive proxy
      Object.getPrototypeOf(target) === Object.getPrototypeOf(receiver)) {
        return target;
      }
      return;
    }
    const targetIsArray = isArray(target);
    if (!isReadonly2) {
      let fn;
      if (targetIsArray && (fn = arrayInstrumentations[key])) {
        return fn;
      }
      if (key === "hasOwnProperty") {
        return hasOwnProperty;
      }
    }
    const res = Reflect.get(
      target,
      key,
      // if this is a proxy wrapping a ref, return methods using the raw ref
      // as receiver so that we don't have to call `toRaw` on the ref in all
      // its class methods
      /* @__PURE__ */ isRef(target) ? target : receiver
    );
    if (isSymbol(key) ? builtInSymbols.has(key) : isNonTrackableKeys(key)) {
      return res;
    }
    if (!isReadonly2) {
      track(target, "get", key);
    }
    if (isShallow2) {
      return res;
    }
    if (/* @__PURE__ */ isRef(res)) {
      const value = targetIsArray && isIntegerKey(key) ? res : res.value;
      return isReadonly2 && isObject(value) ? /* @__PURE__ */ readonly(value) : value;
    }
    if (isObject(res)) {
      return isReadonly2 ? /* @__PURE__ */ readonly(res) : /* @__PURE__ */ reactive(res);
    }
    return res;
  }
}
class MutableReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow2 = false) {
    super(false, isShallow2);
  }
  set(target, key, value, receiver) {
    let oldValue = target[key];
    const isArrayWithIntegerKey = isArray(target) && isIntegerKey(key);
    if (!this._isShallow) {
      const isOldValueReadonly = /* @__PURE__ */ isReadonly(oldValue);
      if (!/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value)) {
        oldValue = /* @__PURE__ */ toRaw(oldValue);
        value = /* @__PURE__ */ toRaw(value);
      }
      if (!isArrayWithIntegerKey && /* @__PURE__ */ isRef(oldValue) && !/* @__PURE__ */ isRef(value)) {
        if (isOldValueReadonly) {
          return true;
        } else {
          oldValue.value = value;
          return true;
        }
      }
    }
    const hadKey = isArrayWithIntegerKey ? Number(key) < target.length : hasOwn(target, key);
    const result = Reflect.set(
      target,
      key,
      value,
      /* @__PURE__ */ isRef(target) ? target : receiver
    );
    if (target === /* @__PURE__ */ toRaw(receiver) && result) {
      if (!hadKey) {
        trigger(target, "add", key, value);
      } else if (hasChanged(value, oldValue)) {
        trigger(target, "set", key, value);
      }
    }
    return result;
  }
  deleteProperty(target, key) {
    const hadKey = hasOwn(target, key);
    target[key];
    const result = Reflect.deleteProperty(target, key);
    if (result && hadKey) {
      trigger(target, "delete", key, void 0);
    }
    return result;
  }
  has(target, key) {
    const result = Reflect.has(target, key);
    if (!isSymbol(key) || !builtInSymbols.has(key)) {
      track(target, "has", key);
    }
    return result;
  }
  ownKeys(target) {
    track(
      target,
      "iterate",
      isArray(target) ? "length" : ITERATE_KEY
    );
    return Reflect.ownKeys(target);
  }
}
class ReadonlyReactiveHandler extends BaseReactiveHandler {
  constructor(isShallow2 = false) {
    super(true, isShallow2);
  }
  set(target, key) {
    return true;
  }
  deleteProperty(target, key) {
    return true;
  }
}
const mutableHandlers = /* @__PURE__ */ new MutableReactiveHandler();
const readonlyHandlers = /* @__PURE__ */ new ReadonlyReactiveHandler();
const shallowReactiveHandlers = /* @__PURE__ */ new MutableReactiveHandler(true);
const shallowReadonlyHandlers = /* @__PURE__ */ new ReadonlyReactiveHandler(true);
const toShallow = (value) => value;
const getProto = (v) => Reflect.getPrototypeOf(v);
function createIterableMethod(method, isReadonly2, isShallow2) {
  return function(...args) {
    const target = this["__v_raw"];
    const rawTarget = /* @__PURE__ */ toRaw(target);
    const targetIsMap = isMap(rawTarget);
    const isPair = method === "entries" || method === Symbol.iterator && targetIsMap;
    const isKeyOnly = method === "keys" && targetIsMap;
    const innerIterator = target[method](...args);
    const wrap = isShallow2 ? toShallow : isReadonly2 ? toReadonly : toReactive;
    !isReadonly2 && track(
      rawTarget,
      "iterate",
      isKeyOnly ? MAP_KEY_ITERATE_KEY : ITERATE_KEY
    );
    return extend(
      // inheriting all iterator properties
      Object.create(innerIterator),
      {
        // iterator protocol
        next() {
          const { value, done } = innerIterator.next();
          return done ? { value, done } : {
            value: isPair ? [wrap(value[0]), wrap(value[1])] : wrap(value),
            done
          };
        }
      }
    );
  };
}
function createReadonlyMethod(type) {
  return function(...args) {
    return type === "delete" ? false : type === "clear" ? void 0 : this;
  };
}
function createInstrumentations(readonly2, shallow) {
  const instrumentations = {
    get(key) {
      const target = this["__v_raw"];
      const rawTarget = /* @__PURE__ */ toRaw(target);
      const rawKey = /* @__PURE__ */ toRaw(key);
      if (!readonly2) {
        if (hasChanged(key, rawKey)) {
          track(rawTarget, "get", key);
        }
        track(rawTarget, "get", rawKey);
      }
      const { has } = getProto(rawTarget);
      const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
      if (has.call(rawTarget, key)) {
        return wrap(target.get(key));
      } else if (has.call(rawTarget, rawKey)) {
        return wrap(target.get(rawKey));
      } else if (target !== rawTarget) {
        target.get(key);
      }
    },
    get size() {
      const target = this["__v_raw"];
      !readonly2 && track(/* @__PURE__ */ toRaw(target), "iterate", ITERATE_KEY);
      return target.size;
    },
    has(key) {
      const target = this["__v_raw"];
      const rawTarget = /* @__PURE__ */ toRaw(target);
      const rawKey = /* @__PURE__ */ toRaw(key);
      if (!readonly2) {
        if (hasChanged(key, rawKey)) {
          track(rawTarget, "has", key);
        }
        track(rawTarget, "has", rawKey);
      }
      return key === rawKey ? target.has(key) : target.has(key) || target.has(rawKey);
    },
    forEach(callback, thisArg) {
      const observed = this;
      const target = observed["__v_raw"];
      const rawTarget = /* @__PURE__ */ toRaw(target);
      const wrap = shallow ? toShallow : readonly2 ? toReadonly : toReactive;
      !readonly2 && track(rawTarget, "iterate", ITERATE_KEY);
      return target.forEach((value, key) => {
        return callback.call(thisArg, wrap(value), wrap(key), observed);
      });
    }
  };
  extend(
    instrumentations,
    readonly2 ? {
      add: createReadonlyMethod("add"),
      set: createReadonlyMethod("set"),
      delete: createReadonlyMethod("delete"),
      clear: createReadonlyMethod("clear")
    } : {
      add(value) {
        const target = /* @__PURE__ */ toRaw(this);
        const proto = getProto(target);
        const rawValue = /* @__PURE__ */ toRaw(value);
        const valueToAdd = !shallow && !/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value) ? rawValue : value;
        const hadKey = proto.has.call(target, valueToAdd) || hasChanged(value, valueToAdd) && proto.has.call(target, value) || hasChanged(rawValue, valueToAdd) && proto.has.call(target, rawValue);
        if (!hadKey) {
          target.add(valueToAdd);
          trigger(target, "add", valueToAdd, valueToAdd);
        }
        return this;
      },
      set(key, value) {
        if (!shallow && !/* @__PURE__ */ isShallow(value) && !/* @__PURE__ */ isReadonly(value)) {
          value = /* @__PURE__ */ toRaw(value);
        }
        const target = /* @__PURE__ */ toRaw(this);
        const { has, get } = getProto(target);
        let hadKey = has.call(target, key);
        if (!hadKey) {
          key = /* @__PURE__ */ toRaw(key);
          hadKey = has.call(target, key);
        }
        const oldValue = get.call(target, key);
        target.set(key, value);
        if (!hadKey) {
          trigger(target, "add", key, value);
        } else if (hasChanged(value, oldValue)) {
          trigger(target, "set", key, value);
        }
        return this;
      },
      delete(key) {
        const target = /* @__PURE__ */ toRaw(this);
        const { has, get } = getProto(target);
        let hadKey = has.call(target, key);
        if (!hadKey) {
          key = /* @__PURE__ */ toRaw(key);
          hadKey = has.call(target, key);
        }
        get ? get.call(target, key) : void 0;
        const result = target.delete(key);
        if (hadKey) {
          trigger(target, "delete", key, void 0);
        }
        return result;
      },
      clear() {
        const target = /* @__PURE__ */ toRaw(this);
        const hadItems = target.size !== 0;
        const result = target.clear();
        if (hadItems) {
          trigger(
            target,
            "clear",
            void 0,
            void 0
          );
        }
        return result;
      }
    }
  );
  const iteratorMethods = [
    "keys",
    "values",
    "entries",
    Symbol.iterator
  ];
  iteratorMethods.forEach((method) => {
    instrumentations[method] = createIterableMethod(method, readonly2, shallow);
  });
  return instrumentations;
}
function createInstrumentationGetter(isReadonly2, shallow) {
  const instrumentations = createInstrumentations(isReadonly2, shallow);
  return (target, key, receiver) => {
    if (key === "__v_isReactive") {
      return !isReadonly2;
    } else if (key === "__v_isReadonly") {
      return isReadonly2;
    } else if (key === "__v_raw") {
      return target;
    }
    return Reflect.get(
      hasOwn(instrumentations, key) && key in target ? instrumentations : target,
      key,
      receiver
    );
  };
}
const mutableCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(false, false)
};
const shallowCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(false, true)
};
const readonlyCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(true, false)
};
const shallowReadonlyCollectionHandlers = {
  get: /* @__PURE__ */ createInstrumentationGetter(true, true)
};
const reactiveMap = /* @__PURE__ */ new WeakMap();
const shallowReactiveMap = /* @__PURE__ */ new WeakMap();
const readonlyMap = /* @__PURE__ */ new WeakMap();
const shallowReadonlyMap = /* @__PURE__ */ new WeakMap();
function targetTypeMap(rawType) {
  switch (rawType) {
    case "Object":
    case "Array":
      return 1;
    case "Map":
    case "Set":
    case "WeakMap":
    case "WeakSet":
      return 2;
    default:
      return 0;
  }
}
// @__NO_SIDE_EFFECTS__
function reactive(target) {
  if (/* @__PURE__ */ isReadonly(target)) {
    return target;
  }
  return createReactiveObject(
    target,
    false,
    mutableHandlers,
    mutableCollectionHandlers,
    reactiveMap
  );
}
// @__NO_SIDE_EFFECTS__
function shallowReactive(target) {
  return createReactiveObject(
    target,
    false,
    shallowReactiveHandlers,
    shallowCollectionHandlers,
    shallowReactiveMap
  );
}
// @__NO_SIDE_EFFECTS__
function readonly(target) {
  return createReactiveObject(
    target,
    true,
    readonlyHandlers,
    readonlyCollectionHandlers,
    readonlyMap
  );
}
// @__NO_SIDE_EFFECTS__
function shallowReadonly(target) {
  return createReactiveObject(
    target,
    true,
    shallowReadonlyHandlers,
    shallowReadonlyCollectionHandlers,
    shallowReadonlyMap
  );
}
function createReactiveObject(target, isReadonly2, baseHandlers, collectionHandlers, proxyMap) {
  if (!isObject(target)) {
    return target;
  }
  if (target["__v_raw"] && !(isReadonly2 && target["__v_isReactive"])) {
    return target;
  }
  if (target["__v_skip"] || !Object.isExtensible(target)) {
    return target;
  }
  const existingProxy = proxyMap.get(target);
  if (existingProxy) {
    return existingProxy;
  }
  const targetType = targetTypeMap(toRawType(target));
  if (targetType === 0) {
    return target;
  }
  const proxy = new Proxy(
    target,
    targetType === 2 ? collectionHandlers : baseHandlers
  );
  proxyMap.set(target, proxy);
  return proxy;
}
// @__NO_SIDE_EFFECTS__
function isReactive(value) {
  if (/* @__PURE__ */ isReadonly(value)) {
    return /* @__PURE__ */ isReactive(value["__v_raw"]);
  }
  return !!(value && value["__v_isReactive"]);
}
// @__NO_SIDE_EFFECTS__
function isReadonly(value) {
  return !!(value && value["__v_isReadonly"]);
}
// @__NO_SIDE_EFFECTS__
function isShallow(value) {
  return !!(value && value["__v_isShallow"]);
}
// @__NO_SIDE_EFFECTS__
function isProxy(value) {
  return value ? !!value["__v_raw"] : false;
}
// @__NO_SIDE_EFFECTS__
function toRaw(observed) {
  const raw = observed && observed["__v_raw"];
  return raw ? /* @__PURE__ */ toRaw(raw) : observed;
}
function markRaw(value) {
  if (!hasOwn(value, "__v_skip") && Object.isExtensible(value)) {
    def(value, "__v_skip", true);
  }
  return value;
}
const toReactive = (value) => isObject(value) ? /* @__PURE__ */ reactive(value) : value;
const toReadonly = (value) => isObject(value) ? /* @__PURE__ */ readonly(value) : value;
// @__NO_SIDE_EFFECTS__
function isRef(r) {
  return r ? r["__v_isRef"] === true : false;
}
// @__NO_SIDE_EFFECTS__
function ref(value) {
  return createRef(value, false);
}
function createRef(rawValue, shallow) {
  if (/* @__PURE__ */ isRef(rawValue)) {
    return rawValue;
  }
  return new RefImpl(rawValue, shallow);
}
class RefImpl {
  constructor(value, isShallow2) {
    this.dep = new Dep();
    this["__v_isRef"] = true;
    this["__v_isShallow"] = false;
    this._rawValue = isShallow2 ? value : /* @__PURE__ */ toRaw(value);
    this._value = isShallow2 ? value : toReactive(value);
    this["__v_isShallow"] = isShallow2;
  }
  get value() {
    {
      this.dep.track();
    }
    return this._value;
  }
  set value(newValue) {
    const oldValue = this._rawValue;
    const useDirectValue = this["__v_isShallow"] || /* @__PURE__ */ isShallow(newValue) || /* @__PURE__ */ isReadonly(newValue);
    newValue = useDirectValue ? newValue : /* @__PURE__ */ toRaw(newValue);
    if (hasChanged(newValue, oldValue)) {
      this._rawValue = newValue;
      this._value = useDirectValue ? newValue : toReactive(newValue);
      {
        this.dep.trigger();
      }
    }
  }
}
function unref(ref2) {
  return /* @__PURE__ */ isRef(ref2) ? ref2.value : ref2;
}
function toValue(source) {
  return isFunction(source) ? source() : unref(source);
}
const shallowUnwrapHandlers = {
  get: (target, key, receiver) => key === "__v_raw" ? target : unref(Reflect.get(target, key, receiver)),
  set: (target, key, value, receiver) => {
    const oldValue = target[key];
    if (/* @__PURE__ */ isRef(oldValue) && !/* @__PURE__ */ isRef(value)) {
      oldValue.value = value;
      return true;
    } else {
      return Reflect.set(target, key, value, receiver);
    }
  }
};
function proxyRefs(objectWithRefs) {
  return /* @__PURE__ */ isReactive(objectWithRefs) ? objectWithRefs : new Proxy(objectWithRefs, shallowUnwrapHandlers);
}
// @__NO_SIDE_EFFECTS__
function toRefs(object) {
  const ret = isArray(object) ? new Array(object.length) : {};
  for (const key in object) {
    ret[key] = propertyToRef(object, key);
  }
  return ret;
}
class ObjectRefImpl {
  constructor(_object, key, _defaultValue) {
    this._object = _object;
    this._defaultValue = _defaultValue;
    this["__v_isRef"] = true;
    this._value = void 0;
    this._key = isSymbol(key) ? key : String(key);
    this._raw = /* @__PURE__ */ toRaw(_object);
    let shallow = true;
    let obj = _object;
    if (!isArray(_object) || isSymbol(this._key) || !isIntegerKey(this._key)) {
      do {
        shallow = !/* @__PURE__ */ isProxy(obj) || /* @__PURE__ */ isShallow(obj);
      } while (shallow && (obj = obj["__v_raw"]));
    }
    this._shallow = shallow;
  }
  get value() {
    let val = this._object[this._key];
    if (this._shallow) {
      val = unref(val);
    }
    return this._value = val === void 0 ? this._defaultValue : val;
  }
  set value(newVal) {
    if (this._shallow && /* @__PURE__ */ isRef(this._raw[this._key])) {
      const nestedRef = this._object[this._key];
      if (/* @__PURE__ */ isRef(nestedRef)) {
        nestedRef.value = newVal;
        return;
      }
    }
    this._object[this._key] = newVal;
  }
  get dep() {
    return getDepFromReactive(this._raw, this._key);
  }
}
class GetterRefImpl {
  constructor(_getter) {
    this._getter = _getter;
    this["__v_isRef"] = true;
    this["__v_isReadonly"] = true;
    this._value = void 0;
  }
  get value() {
    return this._value = this._getter();
  }
}
// @__NO_SIDE_EFFECTS__
function toRef(source, key, defaultValue) {
  if (/* @__PURE__ */ isRef(source)) {
    return source;
  } else if (isFunction(source)) {
    return new GetterRefImpl(source);
  } else if (isObject(source) && arguments.length > 1) {
    return propertyToRef(source, key, defaultValue);
  } else {
    return /* @__PURE__ */ ref(source);
  }
}
function propertyToRef(source, key, defaultValue) {
  return new ObjectRefImpl(source, key, defaultValue);
}
class ComputedRefImpl {
  constructor(fn, setter, isSSR) {
    this.fn = fn;
    this.setter = setter;
    this._value = void 0;
    this.dep = new Dep(this);
    this.__v_isRef = true;
    this.deps = void 0;
    this.depsTail = void 0;
    this.flags = 16;
    this.globalVersion = globalVersion - 1;
    this.next = void 0;
    this.effect = this;
    this["__v_isReadonly"] = !setter;
    this.isSSR = isSSR;
  }
  /**
   * @internal
   */
  notify() {
    this.flags |= 16;
    if (!(this.flags & 8) && // avoid infinite self recursion
    activeSub !== this) {
      batch(this, true);
      return true;
    }
  }
  get value() {
    const link = this.dep.track();
    refreshComputed(this);
    if (link) {
      link.version = this.dep.version;
    }
    return this._value;
  }
  set value(newValue) {
    if (this.setter) {
      this.setter(newValue);
    }
  }
}
// @__NO_SIDE_EFFECTS__
function computed$1(getterOrOptions, debugOptions, isSSR = false) {
  let getter;
  let setter;
  if (isFunction(getterOrOptions)) {
    getter = getterOrOptions;
  } else {
    getter = getterOrOptions.get;
    setter = getterOrOptions.set;
  }
  const cRef = new ComputedRefImpl(getter, setter, isSSR);
  return cRef;
}
const INITIAL_WATCHER_VALUE = {};
const cleanupMap = /* @__PURE__ */ new WeakMap();
let activeWatcher = void 0;
function onWatcherCleanup(cleanupFn, failSilently = false, owner = activeWatcher) {
  if (owner) {
    let cleanups = cleanupMap.get(owner);
    if (!cleanups) cleanupMap.set(owner, cleanups = []);
    cleanups.push(cleanupFn);
  }
}
function watch$1(source, cb, options = EMPTY_OBJ) {
  const { immediate, deep, once, scheduler, augmentJob, call } = options;
  const reactiveGetter = (source2) => {
    if (deep) return source2;
    if (/* @__PURE__ */ isShallow(source2) || deep === false || deep === 0)
      return traverse(source2, 1);
    return traverse(source2);
  };
  let effect2;
  let getter;
  let cleanup;
  let boundCleanup;
  let forceTrigger = false;
  let isMultiSource = false;
  if (/* @__PURE__ */ isRef(source)) {
    getter = () => source.value;
    forceTrigger = /* @__PURE__ */ isShallow(source);
  } else if (/* @__PURE__ */ isReactive(source)) {
    getter = () => reactiveGetter(source);
    forceTrigger = true;
  } else if (isArray(source)) {
    isMultiSource = true;
    forceTrigger = source.some((s) => /* @__PURE__ */ isReactive(s) || /* @__PURE__ */ isShallow(s));
    getter = () => source.map((s) => {
      if (/* @__PURE__ */ isRef(s)) {
        return s.value;
      } else if (/* @__PURE__ */ isReactive(s)) {
        return reactiveGetter(s);
      } else if (isFunction(s)) {
        return call ? call(s, 2) : s();
      } else ;
    });
  } else if (isFunction(source)) {
    if (cb) {
      getter = call ? () => call(source, 2) : source;
    } else {
      getter = () => {
        if (cleanup) {
          pauseTracking();
          try {
            cleanup();
          } finally {
            resetTracking();
          }
        }
        const currentEffect = activeWatcher;
        activeWatcher = effect2;
        try {
          return call ? call(source, 3, [boundCleanup]) : source(boundCleanup);
        } finally {
          activeWatcher = currentEffect;
        }
      };
    }
  } else {
    getter = NOOP;
  }
  if (cb && deep) {
    const baseGetter = getter;
    const depth = deep === true ? Infinity : deep;
    getter = () => traverse(baseGetter(), depth);
  }
  const scope = getCurrentScope();
  const watchHandle = () => {
    effect2.stop();
    if (scope && scope.active) {
      remove(scope.effects, effect2);
    }
  };
  if (once && cb) {
    const _cb = cb;
    cb = (...args) => {
      const res = _cb(...args);
      watchHandle();
      return res;
    };
  }
  let oldValue = isMultiSource ? new Array(source.length).fill(INITIAL_WATCHER_VALUE) : INITIAL_WATCHER_VALUE;
  const job = (immediateFirstRun) => {
    if (!(effect2.flags & 1) || !effect2.dirty && !immediateFirstRun) {
      return;
    }
    if (cb) {
      const newValue = effect2.run();
      if (immediateFirstRun || deep || forceTrigger || (isMultiSource ? newValue.some((v, i) => hasChanged(v, oldValue[i])) : hasChanged(newValue, oldValue))) {
        if (cleanup) {
          cleanup();
        }
        const currentWatcher = activeWatcher;
        activeWatcher = effect2;
        try {
          const args = [
            newValue,
            // pass undefined as the old value when it's changed for the first time
            oldValue === INITIAL_WATCHER_VALUE ? void 0 : isMultiSource && oldValue[0] === INITIAL_WATCHER_VALUE ? [] : oldValue,
            boundCleanup
          ];
          oldValue = newValue;
          call ? call(cb, 3, args) : (
            // @ts-expect-error
            cb(...args)
          );
        } finally {
          activeWatcher = currentWatcher;
        }
      }
    } else {
      effect2.run();
    }
  };
  if (augmentJob) {
    augmentJob(job);
  }
  effect2 = new ReactiveEffect(getter);
  effect2.scheduler = scheduler ? () => scheduler(job, false) : job;
  boundCleanup = (fn) => onWatcherCleanup(fn, false, effect2);
  cleanup = effect2.onStop = () => {
    const cleanups = cleanupMap.get(effect2);
    if (cleanups) {
      if (call) {
        call(cleanups, 4);
      } else {
        for (const cleanup2 of cleanups) cleanup2();
      }
      cleanupMap.delete(effect2);
    }
  };
  if (cb) {
    if (immediate) {
      job(true);
    } else {
      oldValue = effect2.run();
    }
  } else if (scheduler) {
    scheduler(job.bind(null, true), true);
  } else {
    effect2.run();
  }
  watchHandle.pause = effect2.pause.bind(effect2);
  watchHandle.resume = effect2.resume.bind(effect2);
  watchHandle.stop = watchHandle;
  return watchHandle;
}
function traverse(value, depth = Infinity, seen) {
  if (depth <= 0 || !isObject(value) || value["__v_skip"]) {
    return value;
  }
  seen = seen || /* @__PURE__ */ new Map();
  if ((seen.get(value) || 0) >= depth) {
    return value;
  }
  seen.set(value, depth);
  depth--;
  if (/* @__PURE__ */ isRef(value)) {
    traverse(value.value, depth, seen);
  } else if (isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      traverse(value[i], depth, seen);
    }
  } else if (isSet(value) || isMap(value)) {
    value.forEach((v) => {
      traverse(v, depth, seen);
    });
  } else if (isPlainObject$1(value)) {
    for (const key in value) {
      traverse(value[key], depth, seen);
    }
    for (const key of Object.getOwnPropertySymbols(value)) {
      if (Object.prototype.propertyIsEnumerable.call(value, key)) {
        traverse(value[key], depth, seen);
      }
    }
  }
  return value;
}
const stack = [];
let isWarning = false;
function warn$1(msg, ...args) {
  if (isWarning) return;
  isWarning = true;
  pauseTracking();
  const instance = stack.length ? stack[stack.length - 1].component : null;
  const appWarnHandler = instance && instance.appContext.config.warnHandler;
  const trace = getComponentTrace();
  if (appWarnHandler) {
    callWithErrorHandling(
      appWarnHandler,
      instance,
      11,
      [
        // eslint-disable-next-line no-restricted-syntax
        msg + args.map((a) => {
          var _a, _b;
          return (_b = (_a = a.toString) == null ? void 0 : _a.call(a)) != null ? _b : JSON.stringify(a);
        }).join(""),
        instance && instance.proxy,
        trace.map(
          ({ vnode }) => `at <${formatComponentName(instance, vnode.type)}>`
        ).join("\n"),
        trace
      ]
    );
  } else {
    const warnArgs = [`[Vue warn]: ${msg}`, ...args];
    if (trace.length && // avoid spamming console during tests
    true) {
      warnArgs.push(`
`, ...formatTrace(trace));
    }
    console.warn(...warnArgs);
  }
  resetTracking();
  isWarning = false;
}
function getComponentTrace() {
  let currentVNode = stack[stack.length - 1];
  if (!currentVNode) {
    return [];
  }
  const normalizedStack = [];
  while (currentVNode) {
    const last = normalizedStack[0];
    if (last && last.vnode === currentVNode) {
      last.recurseCount++;
    } else {
      normalizedStack.push({
        vnode: currentVNode,
        recurseCount: 0
      });
    }
    const parentInstance = currentVNode.component && currentVNode.component.parent;
    currentVNode = parentInstance && parentInstance.vnode;
  }
  return normalizedStack;
}
function formatTrace(trace) {
  const logs = [];
  trace.forEach((entry, i) => {
    logs.push(...i === 0 ? [] : [`
`], ...formatTraceEntry(entry));
  });
  return logs;
}
function formatTraceEntry({ vnode, recurseCount }) {
  const postfix = recurseCount > 0 ? `... (${recurseCount} recursive calls)` : ``;
  const isRoot = vnode.component ? vnode.component.parent == null : false;
  const open = ` at <${formatComponentName(
    vnode.component,
    vnode.type,
    isRoot
  )}`;
  const close = `>` + postfix;
  return vnode.props ? [open, ...formatProps(vnode.props), close] : [open + close];
}
function formatProps(props) {
  const res = [];
  const keys = Object.keys(props);
  keys.slice(0, 3).forEach((key) => {
    res.push(...formatProp(key, props[key]));
  });
  if (keys.length > 3) {
    res.push(` ...`);
  }
  return res;
}
function formatProp(key, value, raw) {
  if (isString(value)) {
    value = JSON.stringify(value);
    return raw ? value : [`${key}=${value}`];
  } else if (typeof value === "number" || typeof value === "boolean" || value == null) {
    return raw ? value : [`${key}=${value}`];
  } else if (/* @__PURE__ */ isRef(value)) {
    value = formatProp(key, /* @__PURE__ */ toRaw(value.value), true);
    return raw ? value : [`${key}=Ref<`, value, `>`];
  } else if (isFunction(value)) {
    return [`${key}=fn${value.name ? `<${value.name}>` : ``}`];
  } else {
    value = /* @__PURE__ */ toRaw(value);
    return raw ? value : [`${key}=`, value];
  }
}
function callWithErrorHandling(fn, instance, type, args) {
  try {
    return args ? fn(...args) : fn();
  } catch (err) {
    handleError(err, instance, type);
  }
}
function callWithAsyncErrorHandling(fn, instance, type, args) {
  if (isFunction(fn)) {
    const res = callWithErrorHandling(fn, instance, type, args);
    if (res && isPromise(res)) {
      res.catch((err) => {
        handleError(err, instance, type);
      });
    }
    return res;
  }
  if (isArray(fn)) {
    const values = [];
    for (let i = 0; i < fn.length; i++) {
      values.push(callWithAsyncErrorHandling(fn[i], instance, type, args));
    }
    return values;
  }
}
function handleError(err, instance, type, throwInDev = true) {
  const contextVNode = instance ? instance.vnode : null;
  const { errorHandler, throwUnhandledErrorInProduction } = instance && instance.appContext.config || EMPTY_OBJ;
  if (instance) {
    let cur = instance.parent;
    const exposedInstance = instance.proxy;
    const errorInfo = `https://vuejs.org/error-reference/#runtime-${type}`;
    while (cur) {
      const errorCapturedHooks = cur.ec;
      if (errorCapturedHooks) {
        for (let i = 0; i < errorCapturedHooks.length; i++) {
          if (errorCapturedHooks[i](err, exposedInstance, errorInfo) === false) {
            return;
          }
        }
      }
      cur = cur.parent;
    }
    if (errorHandler) {
      pauseTracking();
      callWithErrorHandling(errorHandler, null, 10, [
        err,
        exposedInstance,
        errorInfo
      ]);
      resetTracking();
      return;
    }
  }
  logError(err, type, contextVNode, throwInDev, throwUnhandledErrorInProduction);
}
function logError(err, type, contextVNode, throwInDev = true, throwInProd = false) {
  if (throwInProd) {
    throw err;
  } else {
    console.error(err);
  }
}
const queue = [];
let flushIndex = -1;
const pendingPostFlushCbs = [];
let activePostFlushCbs = null;
let postFlushIndex = 0;
const resolvedPromise = /* @__PURE__ */ Promise.resolve();
let currentFlushPromise = null;
function nextTick(fn) {
  const p2 = currentFlushPromise || resolvedPromise;
  return fn ? p2.then(this ? fn.bind(this) : fn) : p2;
}
function findInsertionIndex(id) {
  let start = flushIndex + 1;
  let end = queue.length;
  while (start < end) {
    const middle = start + end >>> 1;
    const middleJob = queue[middle];
    const middleJobId = getId(middleJob);
    if (middleJobId < id || middleJobId === id && middleJob.flags & 2) {
      start = middle + 1;
    } else {
      end = middle;
    }
  }
  return start;
}
function queueJob(job) {
  if (!(job.flags & 1)) {
    const jobId = getId(job);
    const lastJob = queue[queue.length - 1];
    if (!lastJob || // fast path when the job id is larger than the tail
    !(job.flags & 2) && jobId >= getId(lastJob)) {
      queue.push(job);
    } else {
      queue.splice(findInsertionIndex(jobId), 0, job);
    }
    job.flags |= 1;
    queueFlush();
  }
}
function queueFlush() {
  if (!currentFlushPromise) {
    currentFlushPromise = resolvedPromise.then(flushJobs);
  }
}
function queuePostFlushCb(cb) {
  if (!isArray(cb)) {
    if (activePostFlushCbs && cb.id === -1) {
      activePostFlushCbs.splice(postFlushIndex + 1, 0, cb);
    } else if (!(cb.flags & 1)) {
      pendingPostFlushCbs.push(cb);
      cb.flags |= 1;
    }
  } else {
    for (let i = 0; i < cb.length; i++) {
      pendingPostFlushCbs.push(cb[i]);
    }
  }
  queueFlush();
}
function flushPreFlushCbs(instance, seen, i = flushIndex + 1) {
  for (; i < queue.length; i++) {
    const cb = queue[i];
    if (cb && cb.flags & 2) {
      if (instance && cb.id !== instance.uid) {
        continue;
      }
      queue.splice(i, 1);
      i--;
      if (cb.flags & 4) {
        cb.flags &= -2;
      }
      cb();
      if (!(cb.flags & 4)) {
        cb.flags &= -2;
      }
    }
  }
}
function flushPostFlushCbs(seen) {
  if (pendingPostFlushCbs.length) {
    const deduped = [...new Set(pendingPostFlushCbs)].sort(
      (a, b) => getId(a) - getId(b)
    );
    pendingPostFlushCbs.length = 0;
    if (activePostFlushCbs) {
      for (let i = 0; i < deduped.length; i++) {
        activePostFlushCbs.push(deduped[i]);
      }
      return;
    }
    activePostFlushCbs = deduped;
    for (postFlushIndex = 0; postFlushIndex < activePostFlushCbs.length; postFlushIndex++) {
      const cb = activePostFlushCbs[postFlushIndex];
      if (cb.flags & 4) {
        cb.flags &= -2;
      }
      if (!(cb.flags & 8)) cb();
      cb.flags &= -2;
    }
    activePostFlushCbs = null;
    postFlushIndex = 0;
  }
}
const getId = (job) => job.id == null ? job.flags & 2 ? -1 : Infinity : job.id;
function flushJobs(seen) {
  try {
    for (flushIndex = 0; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex];
      if (job && !(job.flags & 8)) {
        if (false) ;
        if (job.flags & 4) {
          job.flags &= ~1;
        }
        callWithErrorHandling(
          job,
          job.i,
          job.i ? 15 : 14
        );
        if (!(job.flags & 4)) {
          job.flags &= ~1;
        }
      }
    }
  } finally {
    for (; flushIndex < queue.length; flushIndex++) {
      const job = queue[flushIndex];
      if (job) {
        job.flags &= -2;
      }
    }
    flushIndex = -1;
    queue.length = 0;
    flushPostFlushCbs();
    currentFlushPromise = null;
    if (queue.length || pendingPostFlushCbs.length) {
      flushJobs();
    }
  }
}
let currentRenderingInstance = null;
let currentScopeId = null;
function setCurrentRenderingInstance(instance) {
  const prev = currentRenderingInstance;
  currentRenderingInstance = instance;
  currentScopeId = instance && instance.type.__scopeId || null;
  return prev;
}
function withCtx(fn, ctx = currentRenderingInstance, isNonScopedSlot) {
  if (!ctx) return fn;
  if (fn._n) {
    return fn;
  }
  const renderFnWithContext = (...args) => {
    if (renderFnWithContext._d) {
      setBlockTracking(-1);
    }
    const prevInstance = setCurrentRenderingInstance(ctx);
    const prevStackSize = blockStack.length;
    let res;
    try {
      res = fn(...args);
    } finally {
      for (let i = blockStack.length; i > prevStackSize; i--) closeBlock();
      setCurrentRenderingInstance(prevInstance);
      if (renderFnWithContext._d) {
        setBlockTracking(1);
      }
    }
    return res;
  };
  renderFnWithContext._n = true;
  renderFnWithContext._c = true;
  renderFnWithContext._d = true;
  return renderFnWithContext;
}
function invokeDirectiveHook(vnode, prevVNode, instance, name) {
  const bindings = vnode.dirs;
  const oldBindings = prevVNode && prevVNode.dirs;
  for (let i = 0; i < bindings.length; i++) {
    const binding = bindings[i];
    if (oldBindings) {
      binding.oldValue = oldBindings[i].value;
    }
    let hook = binding.dir[name];
    if (hook) {
      pauseTracking();
      callWithAsyncErrorHandling(hook, instance, 8, [
        vnode.el,
        binding,
        vnode,
        prevVNode
      ]);
      resetTracking();
    }
  }
}
function provide(key, value) {
  if (currentInstance) {
    let provides = currentInstance.provides;
    const parentProvides = currentInstance.parent && currentInstance.parent.provides;
    if (parentProvides === provides) {
      provides = currentInstance.provides = Object.create(parentProvides);
    }
    provides[key] = value;
  }
}
function inject(key, defaultValue, treatDefaultAsFactory = false) {
  const instance = getCurrentInstance();
  if (instance || currentApp) {
    let provides = currentApp ? currentApp._context.provides : instance ? instance.parent == null || instance.ce ? instance.vnode.appContext && instance.vnode.appContext.provides : instance.parent.provides : void 0;
    if (provides && key in provides) {
      return provides[key];
    } else if (arguments.length > 1) {
      return treatDefaultAsFactory && isFunction(defaultValue) ? defaultValue.call(instance && instance.proxy) : defaultValue;
    } else ;
  }
}
function hasInjectionContext() {
  return !!(getCurrentInstance() || currentApp);
}
const ssrContextKey = /* @__PURE__ */ Symbol.for("v-scx");
const useSSRContext = () => {
  {
    const ctx = inject(ssrContextKey);
    return ctx;
  }
};
function watch(source, cb, options) {
  return doWatch(source, cb, options);
}
function doWatch(source, cb, options = EMPTY_OBJ) {
  const { immediate, deep, flush, once } = options;
  const baseWatchOptions = extend({}, options);
  const runsImmediately = cb && immediate || !cb && flush !== "post";
  let ssrCleanup;
  if (isInSSRComponentSetup) {
    if (flush === "sync") {
      const ctx = useSSRContext();
      ssrCleanup = ctx.__watcherHandles || (ctx.__watcherHandles = []);
    } else if (!runsImmediately) {
      const watchStopHandle = () => {
      };
      watchStopHandle.stop = NOOP;
      watchStopHandle.resume = NOOP;
      watchStopHandle.pause = NOOP;
      return watchStopHandle;
    }
  }
  const instance = currentInstance;
  baseWatchOptions.call = (fn, type, args) => callWithAsyncErrorHandling(fn, instance, type, args);
  let isPre = false;
  if (flush === "post") {
    baseWatchOptions.scheduler = (job) => {
      queuePostRenderEffect(job, instance && instance.suspense);
    };
  } else if (flush !== "sync") {
    isPre = true;
    baseWatchOptions.scheduler = (job, isFirstRun) => {
      if (isFirstRun) {
        job();
      } else {
        queueJob(job);
      }
    };
  }
  baseWatchOptions.augmentJob = (job) => {
    if (cb) {
      job.flags |= 4;
    }
    if (isPre) {
      job.flags |= 2;
      if (instance) {
        job.id = instance.uid;
        job.i = instance;
      }
    }
  };
  const watchHandle = watch$1(source, cb, baseWatchOptions);
  if (isInSSRComponentSetup) {
    if (ssrCleanup) {
      ssrCleanup.push(watchHandle);
    } else if (runsImmediately) {
      watchHandle();
    }
  }
  return watchHandle;
}
function instanceWatch(source, value, options) {
  const publicThis = this.proxy;
  const getter = isString(source) ? source.includes(".") ? createPathGetter(publicThis, source) : () => publicThis[source] : source.bind(publicThis, publicThis);
  let cb;
  if (isFunction(value)) {
    cb = value;
  } else {
    cb = value.handler;
    options = value;
  }
  const reset = setCurrentInstance(this);
  const res = doWatch(getter, cb.bind(publicThis), options);
  reset();
  return res;
}
function createPathGetter(ctx, path) {
  const segments = path.split(".");
  return () => {
    let cur = ctx;
    for (let i = 0; i < segments.length && cur; i++) {
      cur = cur[segments[i]];
    }
    return cur;
  };
}
const TeleportEndKey = /* @__PURE__ */ Symbol("_vte");
const isTeleport = (type) => type.__isTeleport;
const leaveCbKey = /* @__PURE__ */ Symbol("_leaveCb");
function findNonCommentChild(children) {
  let child = children[0];
  if (children.length > 1) {
    for (const c of children) {
      if (c.type !== Comment) {
        child = c;
        break;
      }
    }
  }
  return child;
}
function getInnerChild$1(vnode) {
  if (!isKeepAlive(vnode)) {
    if (isTeleport(vnode.type) && vnode.children) {
      return findNonCommentChild(vnode.children);
    }
    return vnode;
  }
  if (vnode.component) {
    return vnode.component.subTree;
  }
  const { shapeFlag, children } = vnode;
  if (children) {
    if (shapeFlag & 16) {
      return children[0];
    }
    if (shapeFlag & 32 && isFunction(children.default)) {
      return children.default();
    }
  }
}
function setTransitionHooks(vnode, hooks2) {
  if (vnode.shapeFlag & 6 && vnode.component) {
    vnode.transition = hooks2;
    const subTree = vnode.component.subTree;
    setTransitionHooks(
      isTeleport(subTree.type) ? getInnerChild$1(subTree) || subTree : subTree,
      hooks2
    );
  } else if (vnode.shapeFlag & 128) {
    vnode.ssContent.transition = hooks2.clone(vnode.ssContent);
    vnode.ssFallback.transition = hooks2.clone(vnode.ssFallback);
  } else {
    vnode.transition = hooks2;
  }
}
// @__NO_SIDE_EFFECTS__
function defineComponent(options, extraOptions) {
  return isFunction(options) ? (
    // #8236: extend call and options.name access are considered side-effects
    // by Rollup, so we have to wrap it in a pure-annotated IIFE.
    /* @__PURE__ */ (() => extend({ name: options.name }, extraOptions, { setup: options }))()
  ) : options;
}
function markAsyncBoundary(instance) {
  instance.ids = [instance.ids[0] + instance.ids[2]++ + "-", 0, 0];
}
function isTemplateRefKey(refs, key) {
  let desc;
  return !!((desc = Object.getOwnPropertyDescriptor(refs, key)) && !desc.configurable);
}
const pendingSetRefMap = /* @__PURE__ */ new WeakMap();
function setRef(rawRef, oldRawRef, parentSuspense, vnode, isUnmount = false) {
  if (isArray(rawRef)) {
    rawRef.forEach(
      (r, i) => setRef(
        r,
        oldRawRef && (isArray(oldRawRef) ? oldRawRef[i] : oldRawRef),
        parentSuspense,
        vnode,
        isUnmount
      )
    );
    return;
  }
  if (isAsyncWrapper(vnode) && !isUnmount) {
    if (vnode.shapeFlag & 512 && vnode.type.__asyncResolved && vnode.component.subTree.component) {
      setRef(rawRef, oldRawRef, parentSuspense, vnode.component.subTree);
    }
    return;
  }
  const refValue = vnode.shapeFlag & 4 ? getComponentPublicInstance(vnode.component) : vnode.el;
  const value = isUnmount ? null : refValue;
  const { i: owner, r: ref3 } = rawRef;
  const oldRef = oldRawRef && oldRawRef.r;
  const refs = owner.refs === EMPTY_OBJ ? owner.refs = {} : owner.refs;
  const setupState = owner.setupState;
  const rawSetupState = /* @__PURE__ */ toRaw(setupState);
  const canSetSetupRef = setupState === EMPTY_OBJ ? NO : (key) => {
    if (isTemplateRefKey(refs, key)) {
      return false;
    }
    return hasOwn(rawSetupState, key);
  };
  const canSetRef = (ref22, key) => {
    if (key && isTemplateRefKey(refs, key)) {
      return false;
    }
    return true;
  };
  if (oldRef != null && oldRef !== ref3) {
    invalidatePendingSetRef(oldRawRef);
    if (isString(oldRef)) {
      refs[oldRef] = null;
      if (canSetSetupRef(oldRef)) {
        setupState[oldRef] = null;
      }
    } else if (/* @__PURE__ */ isRef(oldRef)) {
      const oldRawRefAtom = oldRawRef;
      if (canSetRef(oldRef, oldRawRefAtom.k)) {
        oldRef.value = null;
      }
      if (oldRawRefAtom.k) refs[oldRawRefAtom.k] = null;
    }
  }
  if (isFunction(ref3)) {
    callWithErrorHandling(ref3, owner, 12, [value, refs]);
  } else {
    const _isString = isString(ref3);
    const _isRef = /* @__PURE__ */ isRef(ref3);
    if (_isString || _isRef) {
      const doSet = () => {
        if (rawRef.f) {
          const existing = _isString ? canSetSetupRef(ref3) ? setupState[ref3] : refs[ref3] : canSetRef() || !rawRef.k ? ref3.value : refs[rawRef.k];
          if (isUnmount) {
            isArray(existing) && remove(existing, refValue);
          } else {
            if (!isArray(existing)) {
              if (_isString) {
                refs[ref3] = [refValue];
                if (canSetSetupRef(ref3)) {
                  setupState[ref3] = refs[ref3];
                }
              } else {
                const newVal = [refValue];
                if (canSetRef(ref3, rawRef.k)) {
                  ref3.value = newVal;
                }
                if (rawRef.k) refs[rawRef.k] = newVal;
              }
            } else if (!existing.includes(refValue)) {
              existing.push(refValue);
            }
          }
        } else if (_isString) {
          refs[ref3] = value;
          if (canSetSetupRef(ref3)) {
            setupState[ref3] = value;
          }
        } else if (_isRef) {
          if (canSetRef(ref3, rawRef.k)) {
            ref3.value = value;
          }
          if (rawRef.k) refs[rawRef.k] = value;
        } else ;
      };
      if (value) {
        const job = () => {
          doSet();
          pendingSetRefMap.delete(rawRef);
        };
        job.id = -1;
        pendingSetRefMap.set(rawRef, job);
        queuePostRenderEffect(job, parentSuspense);
      } else {
        invalidatePendingSetRef(rawRef);
        doSet();
      }
    }
  }
}
function invalidatePendingSetRef(rawRef) {
  const pendingSetRef = pendingSetRefMap.get(rawRef);
  if (pendingSetRef) {
    pendingSetRef.flags |= 8;
    pendingSetRefMap.delete(rawRef);
  }
}
getGlobalThis().requestIdleCallback || ((cb) => setTimeout(cb, 1));
getGlobalThis().cancelIdleCallback || ((id) => clearTimeout(id));
const isAsyncWrapper = (i) => !!i.type.__asyncLoader;
const isKeepAlive = (vnode) => vnode.type.__isKeepAlive;
function onActivated(hook, target) {
  registerKeepAliveHook(hook, "a", target);
}
function onDeactivated(hook, target) {
  registerKeepAliveHook(hook, "da", target);
}
function registerKeepAliveHook(hook, type, target = currentInstance) {
  const wrappedHook = hook.__wdc || (hook.__wdc = () => {
    let current = target;
    while (current) {
      if (current.isDeactivated) {
        return;
      }
      current = current.parent;
    }
    return hook();
  });
  injectHook(type, wrappedHook, target);
  if (target) {
    let current = target.parent;
    while (current && current.parent) {
      if (isKeepAlive(current.parent.vnode)) {
        injectToKeepAliveRoot(wrappedHook, type, target, current);
      }
      current = current.parent;
    }
  }
}
function injectToKeepAliveRoot(hook, type, target, keepAliveRoot) {
  const injected = injectHook(
    type,
    hook,
    keepAliveRoot,
    true
    /* prepend */
  );
  onUnmounted(() => {
    remove(keepAliveRoot[type], injected);
  }, target);
}
function injectHook(type, hook, target = currentInstance, prepend = false) {
  if (target) {
    const hooks2 = target[type] || (target[type] = []);
    const wrappedHook = hook.__weh || (hook.__weh = (...args) => {
      pauseTracking();
      const reset = setCurrentInstance(target);
      const res = callWithAsyncErrorHandling(hook, target, type, args);
      reset();
      resetTracking();
      return res;
    });
    if (prepend) {
      hooks2.unshift(wrappedHook);
    } else {
      hooks2.push(wrappedHook);
    }
    return wrappedHook;
  }
}
const createHook = (lifecycle) => (hook, target = currentInstance) => {
  if (!isInSSRComponentSetup || lifecycle === "sp") {
    injectHook(lifecycle, (...args) => hook(...args), target);
  }
};
const onBeforeMount = createHook("bm");
const onMounted = createHook("m");
const onBeforeUpdate = createHook(
  "bu"
);
const onUpdated = createHook("u");
const onBeforeUnmount = createHook(
  "bum"
);
const onUnmounted = createHook("um");
const onServerPrefetch = createHook(
  "sp"
);
const onRenderTriggered = createHook("rtg");
const onRenderTracked = createHook("rtc");
function onErrorCaptured(hook, target = currentInstance) {
  injectHook("ec", hook, target);
}
const COMPONENTS = "components";
function resolveComponent(name, maybeSelfReference) {
  return resolveAsset(COMPONENTS, name, true, maybeSelfReference) || name;
}
const NULL_DYNAMIC_COMPONENT = /* @__PURE__ */ Symbol.for("v-ndc");
function resolveAsset(type, name, warnMissing = true, maybeSelfReference = false) {
  const instance = currentRenderingInstance || currentInstance;
  if (instance) {
    const Component = instance.type;
    {
      const selfName = getComponentName(
        Component,
        false
      );
      if (selfName && (selfName === name || selfName === camelize(name) || selfName === capitalize(camelize(name)))) {
        return Component;
      }
    }
    const res = (
      // local registration
      // check instance[type] first which is resolved for options API
      resolve(instance[type] || Component[type], name) || // global registration
      resolve(instance.appContext[type], name)
    );
    if (!res && maybeSelfReference) {
      return Component;
    }
    return res;
  }
}
function resolve(registry, name) {
  return registry && (registry[name] || registry[camelize(name)] || registry[capitalize(camelize(name))]);
}
function renderList(source, renderItem, cache, index) {
  let ret;
  const cached = cache;
  const sourceIsArray = isArray(source);
  if (sourceIsArray || isString(source)) {
    const sourceIsReactiveArray = sourceIsArray && /* @__PURE__ */ isReactive(source);
    let needsWrap = false;
    let isReadonlySource = false;
    if (sourceIsReactiveArray) {
      needsWrap = !/* @__PURE__ */ isShallow(source);
      isReadonlySource = /* @__PURE__ */ isReadonly(source);
      source = shallowReadArray(source);
    }
    ret = new Array(source.length);
    for (let i = 0, l = source.length; i < l; i++) {
      ret[i] = renderItem(
        needsWrap ? isReadonlySource ? toReadonly(toReactive(source[i])) : toReactive(source[i]) : source[i],
        i,
        void 0,
        cached
      );
    }
  } else if (typeof source === "number") {
    {
      ret = new Array(source);
      for (let i = 0; i < source; i++) {
        ret[i] = renderItem(i + 1, i, void 0, cached);
      }
    }
  } else if (isObject(source)) {
    if (source[Symbol.iterator]) {
      ret = Array.from(
        source,
        (item, i) => renderItem(item, i, void 0, cached)
      );
    } else {
      const keys = Object.keys(source);
      ret = new Array(keys.length);
      for (let i = 0, l = keys.length; i < l; i++) {
        const key = keys[i];
        ret[i] = renderItem(source[key], key, i, cached);
      }
    }
  } else {
    ret = [];
  }
  return ret;
}
function renderSlot(slots, name, props, fallback, noSlotted, branchKey) {
  if (props == null) props = {};
  if (currentRenderingInstance.ce || currentRenderingInstance.parent && isAsyncWrapper(currentRenderingInstance.parent) && currentRenderingInstance.parent.ce) {
    const slotProps = props;
    const hasProps = Object.keys(slotProps).length > 0;
    if (name !== "default") slotProps.name = name;
    return openBlock(), createBlock(
      Fragment,
      null,
      [createVNode("slot", slotProps, fallback)],
      hasProps ? -2 : 64
    );
  }
  let slot = slots[name];
  if (slot && slot._c) {
    slot._d = false;
  }
  const prevStackSize = blockStack.length;
  openBlock();
  let rendered;
  try {
    const validSlotContent = slot && ensureValidVNode(slot(props));
    const slotKey = props.key || branchKey || // slot content array of a dynamic conditional slot may have a branch
    // key attached in the `createSlots` helper, respect that
    validSlotContent && validSlotContent.key;
    rendered = createBlock(
      Fragment,
      {
        key: (slotKey && !isSymbol(slotKey) ? slotKey : `_${name}`) + // #7256 force differentiate fallback content from actual content
        (!validSlotContent && fallback ? "_fb" : "")
      },
      validSlotContent || (fallback ? fallback() : []),
      validSlotContent && slots._ === 1 ? 64 : -2
    );
  } catch (err) {
    for (let i = blockStack.length; i > prevStackSize; i--) closeBlock();
    throw err;
  } finally {
    if (slot && slot._c) {
      slot._d = true;
    }
  }
  return rendered;
}
function ensureValidVNode(vnodes) {
  return vnodes.some((child) => {
    if (!isVNode(child)) return true;
    if (child.type === Comment) return false;
    if (child.type === Fragment && !ensureValidVNode(child.children))
      return false;
    return true;
  }) ? vnodes : null;
}
const getPublicInstance = (i) => {
  if (!i) return null;
  if (isStatefulComponent(i)) return getComponentPublicInstance(i);
  return getPublicInstance(i.parent);
};
const publicPropertiesMap = (
  // Move PURE marker to new line to workaround compiler discarding it
  // due to type annotation
  /* @__PURE__ */ extend(/* @__PURE__ */ Object.create(null), {
    $: (i) => i,
    $el: (i) => i.vnode.el,
    $data: (i) => i.data,
    $props: (i) => i.props,
    $attrs: (i) => i.attrs,
    $slots: (i) => i.slots,
    $refs: (i) => i.refs,
    $parent: (i) => getPublicInstance(i.parent),
    $root: (i) => getPublicInstance(i.root),
    $host: (i) => i.ce,
    $emit: (i) => i.emit,
    $options: (i) => resolveMergedOptions(i),
    $forceUpdate: (i) => i.f || (i.f = () => {
      queueJob(i.update);
    }),
    $nextTick: (i) => i.n || (i.n = nextTick.bind(i.proxy)),
    $watch: (i) => instanceWatch.bind(i)
  })
);
const hasSetupBinding = (state, key) => state !== EMPTY_OBJ && !state.__isScriptSetup && hasOwn(state, key);
const PublicInstanceProxyHandlers = {
  get({ _: instance }, key) {
    if (key === "__v_skip") {
      return true;
    }
    const { ctx, setupState, data, props, accessCache, type, appContext } = instance;
    if (key[0] !== "$") {
      const n = accessCache[key];
      if (n !== void 0) {
        switch (n) {
          case 1:
            return setupState[key];
          case 2:
            return data[key];
          case 4:
            return ctx[key];
          case 3:
            return props[key];
        }
      } else if (hasSetupBinding(setupState, key)) {
        accessCache[key] = 1;
        return setupState[key];
      } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
        accessCache[key] = 2;
        return data[key];
      } else if (hasOwn(props, key)) {
        accessCache[key] = 3;
        return props[key];
      } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
        accessCache[key] = 4;
        return ctx[key];
      } else if (shouldCacheAccess) {
        accessCache[key] = 0;
      }
    }
    const publicGetter = publicPropertiesMap[key];
    let cssModule, globalProperties;
    if (publicGetter) {
      if (key === "$attrs") {
        track(instance.attrs, "get", "");
      }
      return publicGetter(instance);
    } else if (
      // css module (injected by vue-loader)
      (cssModule = type.__cssModules) && (cssModule = cssModule[key])
    ) {
      return cssModule;
    } else if (ctx !== EMPTY_OBJ && hasOwn(ctx, key)) {
      accessCache[key] = 4;
      return ctx[key];
    } else if (
      // global properties
      globalProperties = appContext.config.globalProperties, hasOwn(globalProperties, key)
    ) {
      {
        return globalProperties[key];
      }
    } else ;
  },
  set({ _: instance }, key, value) {
    const { data, setupState, ctx } = instance;
    if (hasSetupBinding(setupState, key)) {
      setupState[key] = value;
      return true;
    } else if (data !== EMPTY_OBJ && hasOwn(data, key)) {
      data[key] = value;
      return true;
    } else if (hasOwn(instance.props, key)) {
      return false;
    }
    if (key[0] === "$" && key.slice(1) in instance) {
      return false;
    } else {
      {
        ctx[key] = value;
      }
    }
    return true;
  },
  has({
    _: { data, setupState, accessCache, ctx, appContext, props, type }
  }, key) {
    let cssModules;
    return !!(accessCache[key] || data !== EMPTY_OBJ && key[0] !== "$" && hasOwn(data, key) || hasSetupBinding(setupState, key) || hasOwn(props, key) || hasOwn(ctx, key) || hasOwn(publicPropertiesMap, key) || hasOwn(appContext.config.globalProperties, key) || (cssModules = type.__cssModules) && cssModules[key]);
  },
  defineProperty(target, key, descriptor) {
    if (descriptor.get != null) {
      target._.accessCache[key] = 0;
    } else if (hasOwn(descriptor, "value")) {
      this.set(target, key, descriptor.value, null);
    }
    return Reflect.defineProperty(target, key, descriptor);
  }
};
function useSlots() {
  return getContext().slots;
}
function getContext(calledFunctionName) {
  const i = getCurrentInstance();
  return i.setupContext || (i.setupContext = createSetupContext(i));
}
function normalizePropsOrEmits(props) {
  return isArray(props) ? props.reduce(
    (normalized, p2) => (normalized[p2] = null, normalized),
    {}
  ) : props;
}
let shouldCacheAccess = true;
function applyOptions(instance) {
  const options = resolveMergedOptions(instance);
  const publicThis = instance.proxy;
  const ctx = instance.ctx;
  shouldCacheAccess = false;
  if (options.beforeCreate) {
    callHook(options.beforeCreate, instance, "bc");
  }
  const {
    // state
    data: dataOptions,
    computed: computedOptions,
    methods,
    watch: watchOptions,
    provide: provideOptions,
    inject: injectOptions,
    // lifecycle
    created,
    beforeMount,
    mounted,
    beforeUpdate,
    updated,
    activated,
    deactivated,
    beforeDestroy,
    beforeUnmount,
    destroyed,
    unmounted,
    render: render2,
    renderTracked,
    renderTriggered,
    errorCaptured,
    serverPrefetch,
    // public API
    expose,
    inheritAttrs,
    // assets
    components,
    directives,
    filters
  } = options;
  const checkDuplicateProperties = null;
  if (injectOptions) {
    resolveInjections(injectOptions, ctx, checkDuplicateProperties);
  }
  if (methods) {
    for (const key in methods) {
      const methodHandler = methods[key];
      if (isFunction(methodHandler)) {
        {
          ctx[key] = methodHandler.bind(publicThis);
        }
      }
    }
  }
  if (dataOptions) {
    const data = dataOptions.call(publicThis, publicThis);
    if (!isObject(data)) ;
    else {
      instance.data = /* @__PURE__ */ reactive(data);
    }
  }
  shouldCacheAccess = true;
  if (computedOptions) {
    for (const key in computedOptions) {
      const opt = computedOptions[key];
      const get = isFunction(opt) ? opt.bind(publicThis, publicThis) : isFunction(opt.get) ? opt.get.bind(publicThis, publicThis) : NOOP;
      const set = !isFunction(opt) && isFunction(opt.set) ? opt.set.bind(publicThis) : NOOP;
      const c = computed({
        get,
        set
      });
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => c.value,
        set: (v) => c.value = v
      });
    }
  }
  if (watchOptions) {
    for (const key in watchOptions) {
      createWatcher(watchOptions[key], ctx, publicThis, key);
    }
  }
  if (provideOptions) {
    const provides = isFunction(provideOptions) ? provideOptions.call(publicThis) : provideOptions;
    Reflect.ownKeys(provides).forEach((key) => {
      provide(key, provides[key]);
    });
  }
  if (created) {
    callHook(created, instance, "c");
  }
  function registerLifecycleHook(register, hook) {
    if (isArray(hook)) {
      hook.forEach((_hook) => register(_hook.bind(publicThis)));
    } else if (hook) {
      register(hook.bind(publicThis));
    }
  }
  registerLifecycleHook(onBeforeMount, beforeMount);
  registerLifecycleHook(onMounted, mounted);
  registerLifecycleHook(onBeforeUpdate, beforeUpdate);
  registerLifecycleHook(onUpdated, updated);
  registerLifecycleHook(onActivated, activated);
  registerLifecycleHook(onDeactivated, deactivated);
  registerLifecycleHook(onErrorCaptured, errorCaptured);
  registerLifecycleHook(onRenderTracked, renderTracked);
  registerLifecycleHook(onRenderTriggered, renderTriggered);
  registerLifecycleHook(onBeforeUnmount, beforeUnmount);
  registerLifecycleHook(onUnmounted, unmounted);
  registerLifecycleHook(onServerPrefetch, serverPrefetch);
  if (isArray(expose)) {
    if (expose.length) {
      const exposed = instance.exposed || (instance.exposed = {});
      expose.forEach((key) => {
        Object.defineProperty(exposed, key, {
          get: () => publicThis[key],
          set: (val) => publicThis[key] = val,
          enumerable: true
        });
      });
    } else if (!instance.exposed) {
      instance.exposed = {};
    }
  }
  if (render2 && instance.render === NOOP) {
    instance.render = render2;
  }
  if (inheritAttrs != null) {
    instance.inheritAttrs = inheritAttrs;
  }
  if (components) instance.components = components;
  if (directives) instance.directives = directives;
  if (serverPrefetch) {
    markAsyncBoundary(instance);
  }
}
function resolveInjections(injectOptions, ctx, checkDuplicateProperties = NOOP) {
  if (isArray(injectOptions)) {
    injectOptions = normalizeInject(injectOptions);
  }
  for (const key in injectOptions) {
    const opt = injectOptions[key];
    let injected;
    if (isObject(opt)) {
      if ("default" in opt) {
        injected = inject(
          opt.from || key,
          opt.default,
          true
        );
      } else {
        injected = inject(opt.from || key);
      }
    } else {
      injected = inject(opt);
    }
    if (/* @__PURE__ */ isRef(injected)) {
      Object.defineProperty(ctx, key, {
        enumerable: true,
        configurable: true,
        get: () => injected.value,
        set: (v) => injected.value = v
      });
    } else {
      ctx[key] = injected;
    }
  }
}
function callHook(hook, instance, type) {
  callWithAsyncErrorHandling(
    isArray(hook) ? hook.map((h2) => h2.bind(instance.proxy)) : hook.bind(instance.proxy),
    instance,
    type
  );
}
function createWatcher(raw, ctx, publicThis, key) {
  let getter = key.includes(".") ? createPathGetter(publicThis, key) : () => publicThis[key];
  if (isString(raw)) {
    const handler = ctx[raw];
    if (isFunction(handler)) {
      {
        watch(getter, handler);
      }
    }
  } else if (isFunction(raw)) {
    {
      watch(getter, raw.bind(publicThis));
    }
  } else if (isObject(raw)) {
    if (isArray(raw)) {
      raw.forEach((r) => createWatcher(r, ctx, publicThis, key));
    } else {
      const handler = isFunction(raw.handler) ? raw.handler.bind(publicThis) : ctx[raw.handler];
      if (isFunction(handler)) {
        watch(getter, handler, raw);
      }
    }
  } else ;
}
function resolveMergedOptions(instance) {
  const base = instance.type;
  const { mixins, extends: extendsOptions } = base;
  const {
    mixins: globalMixins,
    optionsCache: cache,
    config: { optionMergeStrategies }
  } = instance.appContext;
  const cached = cache.get(base);
  let resolved;
  if (cached) {
    resolved = cached;
  } else if (!globalMixins.length && !mixins && !extendsOptions) {
    {
      resolved = base;
    }
  } else {
    resolved = {};
    if (globalMixins.length) {
      globalMixins.forEach(
        (m) => mergeOptions(resolved, m, optionMergeStrategies, true)
      );
    }
    mergeOptions(resolved, base, optionMergeStrategies);
  }
  if (isObject(base)) {
    cache.set(base, resolved);
  }
  return resolved;
}
function mergeOptions(to, from, strats, asMixin = false) {
  const { mixins, extends: extendsOptions } = from;
  if (extendsOptions) {
    mergeOptions(to, extendsOptions, strats, true);
  }
  if (mixins) {
    mixins.forEach(
      (m) => mergeOptions(to, m, strats, true)
    );
  }
  for (const key in from) {
    if (asMixin && key === "expose") ;
    else {
      const strat = internalOptionMergeStrats[key] || strats && strats[key];
      to[key] = strat ? strat(to[key], from[key]) : from[key];
    }
  }
  return to;
}
const internalOptionMergeStrats = {
  data: mergeDataFn,
  props: mergeEmitsOrPropsOptions,
  emits: mergeEmitsOrPropsOptions,
  // objects
  methods: mergeObjectOptions,
  computed: mergeObjectOptions,
  // lifecycle
  beforeCreate: mergeAsArray,
  created: mergeAsArray,
  beforeMount: mergeAsArray,
  mounted: mergeAsArray,
  beforeUpdate: mergeAsArray,
  updated: mergeAsArray,
  beforeDestroy: mergeAsArray,
  beforeUnmount: mergeAsArray,
  destroyed: mergeAsArray,
  unmounted: mergeAsArray,
  activated: mergeAsArray,
  deactivated: mergeAsArray,
  errorCaptured: mergeAsArray,
  serverPrefetch: mergeAsArray,
  // assets
  components: mergeObjectOptions,
  directives: mergeObjectOptions,
  // watch
  watch: mergeWatchOptions,
  // provide / inject
  provide: mergeDataFn,
  inject: mergeInject
};
function mergeDataFn(to, from) {
  if (!from) {
    return to;
  }
  if (!to) {
    return from;
  }
  return function mergedDataFn() {
    return extend(
      isFunction(to) ? to.call(this, this) : to,
      isFunction(from) ? from.call(this, this) : from
    );
  };
}
function mergeInject(to, from) {
  return mergeObjectOptions(normalizeInject(to), normalizeInject(from));
}
function normalizeInject(raw) {
  if (isArray(raw)) {
    const res = {};
    for (let i = 0; i < raw.length; i++) {
      res[raw[i]] = raw[i];
    }
    return res;
  }
  return raw;
}
function mergeAsArray(to, from) {
  return to ? [...new Set([].concat(to, from))] : from;
}
function mergeObjectOptions(to, from) {
  return to ? extend(/* @__PURE__ */ Object.create(null), to, from) : from;
}
function mergeEmitsOrPropsOptions(to, from) {
  if (to) {
    if (isArray(to) && isArray(from)) {
      return [.../* @__PURE__ */ new Set([...to, ...from])];
    }
    return extend(
      /* @__PURE__ */ Object.create(null),
      normalizePropsOrEmits(to),
      normalizePropsOrEmits(from != null ? from : {})
    );
  } else {
    return from;
  }
}
function mergeWatchOptions(to, from) {
  if (!to) return from;
  if (!from) return to;
  const merged = extend(/* @__PURE__ */ Object.create(null), to);
  for (const key in from) {
    merged[key] = mergeAsArray(to[key], from[key]);
  }
  return merged;
}
function createAppContext() {
  return {
    app: null,
    config: {
      isNativeTag: NO,
      performance: false,
      globalProperties: {},
      optionMergeStrategies: {},
      errorHandler: void 0,
      warnHandler: void 0,
      compilerOptions: {}
    },
    mixins: [],
    components: {},
    directives: {},
    provides: /* @__PURE__ */ Object.create(null),
    optionsCache: /* @__PURE__ */ new WeakMap(),
    propsCache: /* @__PURE__ */ new WeakMap(),
    emitsCache: /* @__PURE__ */ new WeakMap()
  };
}
let uid$1 = 0;
function createAppAPI(render2, hydrate) {
  return function createApp2(rootComponent, rootProps = null) {
    if (!isFunction(rootComponent)) {
      rootComponent = extend({}, rootComponent);
    }
    if (rootProps != null && !isObject(rootProps)) {
      rootProps = null;
    }
    const context = createAppContext();
    const installedPlugins = /* @__PURE__ */ new WeakSet();
    const pluginCleanupFns = [];
    let isMounted = false;
    const app = context.app = {
      _uid: uid$1++,
      _component: rootComponent,
      _props: rootProps,
      _container: null,
      _context: context,
      _instance: null,
      version,
      get config() {
        return context.config;
      },
      set config(v) {
      },
      use(plugin, ...options) {
        if (installedPlugins.has(plugin)) ;
        else if (plugin && isFunction(plugin.install)) {
          installedPlugins.add(plugin);
          plugin.install(app, ...options);
        } else if (isFunction(plugin)) {
          installedPlugins.add(plugin);
          plugin(app, ...options);
        } else ;
        return app;
      },
      mixin(mixin) {
        {
          if (!context.mixins.includes(mixin)) {
            context.mixins.push(mixin);
          }
        }
        return app;
      },
      component(name, component) {
        if (!component) {
          return context.components[name];
        }
        context.components[name] = component;
        return app;
      },
      directive(name, directive) {
        if (!directive) {
          return context.directives[name];
        }
        context.directives[name] = directive;
        return app;
      },
      mount(rootContainer, isHydrate, namespace) {
        if (!isMounted) {
          const vnode = app._ceVNode || createVNode(rootComponent, rootProps);
          vnode.appContext = context;
          if (namespace === true) {
            namespace = "svg";
          } else if (namespace === false) {
            namespace = void 0;
          }
          {
            render2(vnode, rootContainer, namespace);
          }
          isMounted = true;
          app._container = rootContainer;
          rootContainer.__vue_app__ = app;
          return getComponentPublicInstance(vnode.component);
        }
      },
      onUnmount(cleanupFn) {
        pluginCleanupFns.push(cleanupFn);
      },
      unmount() {
        if (isMounted) {
          callWithAsyncErrorHandling(
            pluginCleanupFns,
            app._instance,
            16
          );
          render2(null, app._container);
          delete app._container.__vue_app__;
        }
      },
      provide(key, value) {
        context.provides[key] = value;
        return app;
      },
      runWithContext(fn) {
        const lastApp = currentApp;
        currentApp = app;
        try {
          return fn();
        } finally {
          currentApp = lastApp;
        }
      }
    };
    return app;
  };
}
let currentApp = null;
const getModelModifiers = (props, modelName) => {
  return modelName === "modelValue" || modelName === "model-value" ? props.modelModifiers : props[`${modelName}Modifiers`] || props[`${camelize(modelName)}Modifiers`] || props[`${hyphenate(modelName)}Modifiers`];
};
function emit(instance, event, ...rawArgs) {
  if (instance.isUnmounted) return;
  const props = instance.vnode.props || EMPTY_OBJ;
  let args = rawArgs;
  const isModelListener2 = event.startsWith("update:");
  const modifiers = isModelListener2 && getModelModifiers(props, event.slice(7));
  if (modifiers) {
    if (modifiers.trim) {
      args = rawArgs.map((a) => isString(a) ? a.trim() : a);
    }
    if (modifiers.number) {
      args = args.map(looseToNumber);
    }
  }
  let handlerName;
  let handler = props[handlerName = toHandlerKey(event)] || // also try camelCase event handler (#2249)
  props[handlerName = toHandlerKey(camelize(event))];
  if (!handler && isModelListener2) {
    handler = props[handlerName = toHandlerKey(hyphenate(event))];
  }
  if (handler) {
    callWithAsyncErrorHandling(
      handler,
      instance,
      6,
      args
    );
  }
  const onceHandler = props[handlerName + `Once`];
  if (onceHandler) {
    if (!instance.emitted) {
      instance.emitted = {};
    } else if (instance.emitted[handlerName]) {
      return;
    }
    instance.emitted[handlerName] = true;
    callWithAsyncErrorHandling(
      onceHandler,
      instance,
      6,
      args
    );
  }
}
const mixinEmitsCache = /* @__PURE__ */ new WeakMap();
function normalizeEmitsOptions(comp, appContext, asMixin = false) {
  const cache = asMixin ? mixinEmitsCache : appContext.emitsCache;
  const cached = cache.get(comp);
  if (cached !== void 0) {
    return cached;
  }
  const raw = comp.emits;
  let normalized = {};
  let hasExtends = false;
  if (!isFunction(comp)) {
    const extendEmits = (raw2) => {
      const normalizedFromExtend = normalizeEmitsOptions(raw2, appContext, true);
      if (normalizedFromExtend) {
        hasExtends = true;
        extend(normalized, normalizedFromExtend);
      }
    };
    if (!asMixin && appContext.mixins.length) {
      appContext.mixins.forEach(extendEmits);
    }
    if (comp.extends) {
      extendEmits(comp.extends);
    }
    if (comp.mixins) {
      comp.mixins.forEach(extendEmits);
    }
  }
  if (!raw && !hasExtends) {
    if (isObject(comp)) {
      cache.set(comp, null);
    }
    return null;
  }
  if (isArray(raw)) {
    raw.forEach((key) => normalized[key] = null);
  } else {
    extend(normalized, raw);
  }
  if (isObject(comp)) {
    cache.set(comp, normalized);
  }
  return normalized;
}
function isEmitListener(options, key) {
  if (!options || !isOn(key)) {
    return false;
  }
  key = key.slice(2);
  key = key === "Once" ? key : key.replace(/Once$/, "");
  return hasOwn(options, key[0].toLowerCase() + key.slice(1)) || hasOwn(options, hyphenate(key)) || hasOwn(options, key);
}
function markAttrsAccessed() {
}
function renderComponentRoot(instance) {
  const {
    type: Component,
    vnode,
    proxy,
    withProxy,
    propsOptions: [propsOptions],
    slots,
    attrs,
    emit: emit2,
    render: render2,
    renderCache,
    props,
    data,
    setupState,
    ctx,
    inheritAttrs
  } = instance;
  const prev = setCurrentRenderingInstance(instance);
  let result;
  let fallthroughAttrs;
  try {
    if (vnode.shapeFlag & 4) {
      const proxyToUse = withProxy || proxy;
      const thisProxy = false ? new Proxy(proxyToUse, {
        get(target, key, receiver) {
          warn$1(
            `Property '${String(
              key
            )}' was accessed via 'this'. Avoid using 'this' in templates.`
          );
          return Reflect.get(target, key, receiver);
        }
      }) : proxyToUse;
      result = normalizeVNode(
        render2.call(
          thisProxy,
          proxyToUse,
          renderCache,
          false ? /* @__PURE__ */ shallowReadonly(props) : props,
          setupState,
          data,
          ctx
        )
      );
      fallthroughAttrs = attrs;
    } else {
      const render22 = Component;
      if (false) ;
      result = normalizeVNode(
        render22.length > 1 ? render22(
          false ? /* @__PURE__ */ shallowReadonly(props) : props,
          false ? {
            get attrs() {
              markAttrsAccessed();
              return /* @__PURE__ */ shallowReadonly(attrs);
            },
            slots,
            emit: emit2
          } : { attrs, slots, emit: emit2 }
        ) : render22(
          false ? /* @__PURE__ */ shallowReadonly(props) : props,
          null
        )
      );
      fallthroughAttrs = Component.props ? attrs : getFunctionalFallthrough(attrs);
    }
  } catch (err) {
    blockStack.length = 0;
    handleError(err, instance, 1);
    result = createVNode(Comment);
  }
  let root = result;
  if (fallthroughAttrs && inheritAttrs !== false) {
    const keys = Object.keys(fallthroughAttrs);
    const { shapeFlag } = root;
    if (keys.length) {
      if (shapeFlag & (1 | 6)) {
        if (propsOptions && keys.some(isModelListener)) {
          fallthroughAttrs = filterModelListeners(
            fallthroughAttrs,
            propsOptions
          );
        }
        root = cloneVNode(root, fallthroughAttrs, false, true);
      }
    }
  }
  if (vnode.dirs) {
    root = cloneVNode(root, null, false, true);
    root.dirs = root.dirs ? root.dirs.concat(vnode.dirs) : vnode.dirs;
  }
  if (vnode.transition) {
    const child = isTeleport(root.type) ? getInnerChild$1(root) || root : root;
    setTransitionHooks(child, vnode.transition);
  }
  {
    result = root;
  }
  setCurrentRenderingInstance(prev);
  return result;
}
const getFunctionalFallthrough = (attrs) => {
  let res;
  for (const key in attrs) {
    if (key === "class" || key === "style" || isOn(key)) {
      (res || (res = {}))[key] = attrs[key];
    }
  }
  return res;
};
const filterModelListeners = (attrs, props) => {
  const res = {};
  for (const key in attrs) {
    if (!isModelListener(key) || !(key.slice(9) in props)) {
      res[key] = attrs[key];
    }
  }
  return res;
};
function shouldUpdateComponent(prevVNode, nextVNode, optimized) {
  const { props: prevProps, children: prevChildren, component } = prevVNode;
  const { props: nextProps, children: nextChildren, patchFlag } = nextVNode;
  const emits = component.emitsOptions;
  if (nextVNode.dirs || nextVNode.transition) {
    return true;
  }
  if (optimized && patchFlag >= 0) {
    if (patchFlag & 1024) {
      return true;
    }
    if (patchFlag & 16) {
      if (!prevProps) {
        return !!nextProps;
      }
      return hasPropsChanged(prevProps, nextProps, emits);
    } else if (patchFlag & 8) {
      const dynamicProps = nextVNode.dynamicProps;
      for (let i = 0; i < dynamicProps.length; i++) {
        const key = dynamicProps[i];
        if (hasPropValueChanged(nextProps, prevProps, key) && !isEmitListener(emits, key)) {
          return true;
        }
      }
    }
  } else {
    if (prevChildren || nextChildren) {
      if (!nextChildren || !nextChildren.$stable) {
        return true;
      }
    }
    if (prevProps === nextProps) {
      return false;
    }
    if (!prevProps) {
      return !!nextProps;
    }
    if (!nextProps) {
      return true;
    }
    return hasPropsChanged(prevProps, nextProps, emits);
  }
  return false;
}
function hasPropsChanged(prevProps, nextProps, emitsOptions) {
  const nextKeys = Object.keys(nextProps);
  if (nextKeys.length !== Object.keys(prevProps).length) {
    return true;
  }
  for (let i = 0; i < nextKeys.length; i++) {
    const key = nextKeys[i];
    if (hasPropValueChanged(nextProps, prevProps, key) && !isEmitListener(emitsOptions, key)) {
      return true;
    }
  }
  return false;
}
function hasPropValueChanged(nextProps, prevProps, key) {
  const nextProp = nextProps[key];
  const prevProp = prevProps[key];
  if (key === "style" && isObject(nextProp) && isObject(prevProp)) {
    return !looseEqual(nextProp, prevProp);
  }
  return nextProp !== prevProp;
}
function updateHOCHostEl({ vnode, parent, suspense }, el) {
  while (parent) {
    const root = parent.subTree;
    if (root.suspense && root.suspense.activeBranch === vnode) {
      root.suspense.vnode.el = root.el = el;
      vnode = root;
    }
    if (root === vnode) {
      (vnode = parent.vnode).el = el;
      parent = parent.parent;
    } else {
      break;
    }
  }
  if (suspense && suspense.activeBranch === vnode) {
    suspense.vnode.el = el;
  }
}
const internalObjectProto = {};
const createInternalObject = () => Object.create(internalObjectProto);
const isInternalObject = (obj) => Object.getPrototypeOf(obj) === internalObjectProto;
function initProps(instance, rawProps, isStateful, isSSR = false) {
  const props = {};
  const attrs = createInternalObject();
  instance.propsDefaults = /* @__PURE__ */ Object.create(null);
  setFullProps(instance, rawProps, props, attrs);
  for (const key in instance.propsOptions[0]) {
    if (!(key in props)) {
      props[key] = void 0;
    }
  }
  if (isStateful) {
    instance.props = isSSR ? props : /* @__PURE__ */ shallowReactive(props);
  } else {
    if (!instance.type.props) {
      instance.props = attrs;
    } else {
      instance.props = props;
    }
  }
  instance.attrs = attrs;
}
function updateProps(instance, rawProps, rawPrevProps, optimized) {
  const {
    props,
    attrs,
    vnode: { patchFlag }
  } = instance;
  const rawCurrentProps = /* @__PURE__ */ toRaw(props);
  const [options] = instance.propsOptions;
  let hasAttrsChanged = false;
  if (
    // always force full diff in dev
    // - #1942 if hmr is enabled with sfc component
    // - vite#872 non-sfc component used by sfc component
    (optimized || patchFlag > 0) && !(patchFlag & 16)
  ) {
    if (patchFlag & 8) {
      const propsToUpdate = instance.vnode.dynamicProps;
      for (let i = 0; i < propsToUpdate.length; i++) {
        let key = propsToUpdate[i];
        if (isEmitListener(instance.emitsOptions, key)) {
          continue;
        }
        const value = rawProps[key];
        if (options) {
          if (hasOwn(attrs, key)) {
            if (value !== attrs[key]) {
              attrs[key] = value;
              hasAttrsChanged = true;
            }
          } else {
            const camelizedKey = camelize(key);
            props[camelizedKey] = resolvePropValue(
              options,
              rawCurrentProps,
              camelizedKey,
              value,
              instance,
              false
            );
          }
        } else {
          if (value !== attrs[key]) {
            attrs[key] = value;
            hasAttrsChanged = true;
          }
        }
      }
    }
  } else {
    if (setFullProps(instance, rawProps, props, attrs)) {
      hasAttrsChanged = true;
    }
    let kebabKey;
    for (const key in rawCurrentProps) {
      if (!rawProps || // for camelCase
      !hasOwn(rawProps, key) && // it's possible the original props was passed in as kebab-case
      // and converted to camelCase (#955)
      ((kebabKey = hyphenate(key)) === key || !hasOwn(rawProps, kebabKey))) {
        if (options) {
          if (rawPrevProps && // for camelCase
          (rawPrevProps[key] !== void 0 || // for kebab-case
          rawPrevProps[kebabKey] !== void 0)) {
            props[key] = resolvePropValue(
              options,
              rawCurrentProps,
              key,
              void 0,
              instance,
              true
            );
          }
        } else {
          delete props[key];
        }
      }
    }
    if (attrs !== rawCurrentProps) {
      for (const key in attrs) {
        if (!rawProps || !hasOwn(rawProps, key) && true) {
          delete attrs[key];
          hasAttrsChanged = true;
        }
      }
    }
  }
  if (hasAttrsChanged) {
    trigger(instance.attrs, "set", "");
  }
}
function setFullProps(instance, rawProps, props, attrs) {
  const [options, needCastKeys] = instance.propsOptions;
  let hasAttrsChanged = false;
  let rawCastValues;
  if (rawProps) {
    for (let key in rawProps) {
      if (isReservedProp(key)) {
        continue;
      }
      const value = rawProps[key];
      let camelKey;
      if (options && hasOwn(options, camelKey = camelize(key))) {
        if (!needCastKeys || !needCastKeys.includes(camelKey)) {
          props[camelKey] = value;
        } else {
          (rawCastValues || (rawCastValues = {}))[camelKey] = value;
        }
      } else if (!isEmitListener(instance.emitsOptions, key)) {
        if (!(key in attrs) || value !== attrs[key]) {
          attrs[key] = value;
          hasAttrsChanged = true;
        }
      }
    }
  }
  if (needCastKeys) {
    const rawCurrentProps = /* @__PURE__ */ toRaw(props);
    const castValues = rawCastValues || EMPTY_OBJ;
    for (let i = 0; i < needCastKeys.length; i++) {
      const key = needCastKeys[i];
      props[key] = resolvePropValue(
        options,
        rawCurrentProps,
        key,
        castValues[key],
        instance,
        !hasOwn(castValues, key)
      );
    }
  }
  return hasAttrsChanged;
}
function resolvePropValue(options, props, key, value, instance, isAbsent) {
  const opt = options[key];
  if (opt != null) {
    const hasDefault = hasOwn(opt, "default");
    if (hasDefault && value === void 0) {
      const defaultValue = opt.default;
      if (opt.type !== Function && !opt.skipFactory && isFunction(defaultValue)) {
        const { propsDefaults } = instance;
        if (key in propsDefaults) {
          value = propsDefaults[key];
        } else {
          const reset = setCurrentInstance(instance);
          value = propsDefaults[key] = defaultValue.call(
            null,
            props
          );
          reset();
        }
      } else {
        value = defaultValue;
      }
      if (instance.ce) {
        instance.ce._setProp(key, value);
      }
    }
    if (opt[
      0
      /* shouldCast */
    ]) {
      if (isAbsent && !hasDefault) {
        value = false;
      } else if (opt[
        1
        /* shouldCastTrue */
      ] && (value === "" || value === hyphenate(key))) {
        value = true;
      }
    }
  }
  return value;
}
const mixinPropsCache = /* @__PURE__ */ new WeakMap();
function normalizePropsOptions(comp, appContext, asMixin = false) {
  const cache = asMixin ? mixinPropsCache : appContext.propsCache;
  const cached = cache.get(comp);
  if (cached) {
    return cached;
  }
  const raw = comp.props;
  const normalized = {};
  const needCastKeys = [];
  let hasExtends = false;
  if (!isFunction(comp)) {
    const extendProps = (raw2) => {
      hasExtends = true;
      const [props, keys] = normalizePropsOptions(raw2, appContext, true);
      extend(normalized, props);
      if (keys) needCastKeys.push(...keys);
    };
    if (!asMixin && appContext.mixins.length) {
      appContext.mixins.forEach(extendProps);
    }
    if (comp.extends) {
      extendProps(comp.extends);
    }
    if (comp.mixins) {
      comp.mixins.forEach(extendProps);
    }
  }
  if (!raw && !hasExtends) {
    if (isObject(comp)) {
      cache.set(comp, EMPTY_ARR);
    }
    return EMPTY_ARR;
  }
  if (isArray(raw)) {
    for (let i = 0; i < raw.length; i++) {
      const normalizedKey = camelize(raw[i]);
      if (validatePropName(normalizedKey)) {
        normalized[normalizedKey] = EMPTY_OBJ;
      }
    }
  } else if (raw) {
    for (const key in raw) {
      const normalizedKey = camelize(key);
      if (validatePropName(normalizedKey)) {
        const opt = raw[key];
        const prop = normalized[normalizedKey] = isArray(opt) || isFunction(opt) ? { type: opt } : extend({}, opt);
        const propType = prop.type;
        let shouldCast = false;
        let shouldCastTrue = true;
        if (isArray(propType)) {
          for (let index = 0; index < propType.length; ++index) {
            const type = propType[index];
            const typeName = isFunction(type) && type.name;
            if (typeName === "Boolean") {
              shouldCast = true;
              break;
            } else if (typeName === "String") {
              shouldCastTrue = false;
            }
          }
        } else {
          shouldCast = isFunction(propType) && propType.name === "Boolean";
        }
        prop[
          0
          /* shouldCast */
        ] = shouldCast;
        prop[
          1
          /* shouldCastTrue */
        ] = shouldCastTrue;
        if (shouldCast || hasOwn(prop, "default")) {
          needCastKeys.push(normalizedKey);
        }
      }
    }
  }
  const res = [normalized, needCastKeys];
  if (isObject(comp)) {
    cache.set(comp, res);
  }
  return res;
}
function validatePropName(key) {
  if (key[0] !== "$" && !isReservedProp(key)) {
    return true;
  }
  return false;
}
const isInternalKey = (key) => key === "_" || key === "_ctx" || key === "$stable";
const normalizeSlotValue = (value) => isArray(value) ? value.map(normalizeVNode) : [normalizeVNode(value)];
const normalizeSlot = (key, rawSlot, ctx) => {
  if (rawSlot._n) {
    return rawSlot;
  }
  const normalized = withCtx((...args) => {
    if (false) ;
    return normalizeSlotValue(rawSlot(...args));
  }, ctx);
  normalized._c = false;
  return normalized;
};
const normalizeObjectSlots = (rawSlots, slots, instance) => {
  const ctx = rawSlots._ctx;
  for (const key in rawSlots) {
    if (isInternalKey(key)) continue;
    const value = rawSlots[key];
    if (isFunction(value)) {
      slots[key] = normalizeSlot(key, value, ctx);
    } else if (value != null) {
      const normalized = normalizeSlotValue(value);
      slots[key] = () => normalized;
    }
  }
};
const normalizeVNodeSlots = (instance, children) => {
  const normalized = normalizeSlotValue(children);
  instance.slots.default = () => normalized;
};
const assignSlots = (slots, children, optimized) => {
  for (const key in children) {
    if (optimized || !isInternalKey(key)) {
      slots[key] = children[key];
    }
  }
};
const initSlots = (instance, children, optimized) => {
  const slots = instance.slots = createInternalObject();
  if (instance.vnode.shapeFlag & 32) {
    const type = children._;
    if (type) {
      assignSlots(slots, children, optimized);
      if (optimized) {
        def(slots, "_", type, true);
      }
    } else {
      normalizeObjectSlots(children, slots);
    }
  } else if (children) {
    normalizeVNodeSlots(instance, children);
  }
};
const updateSlots = (instance, children, optimized) => {
  const { vnode, slots } = instance;
  let needDeletionCheck = true;
  let deletionComparisonTarget = EMPTY_OBJ;
  if (vnode.shapeFlag & 32) {
    const type = children._;
    if (type) {
      if (optimized && type === 1) {
        needDeletionCheck = false;
      } else {
        assignSlots(slots, children, optimized);
      }
    } else {
      needDeletionCheck = !children.$stable;
      normalizeObjectSlots(children, slots);
    }
    deletionComparisonTarget = children;
  } else if (children) {
    normalizeVNodeSlots(instance, children);
    deletionComparisonTarget = { default: 1 };
  }
  if (needDeletionCheck) {
    for (const key in slots) {
      if (!isInternalKey(key) && deletionComparisonTarget[key] == null) {
        delete slots[key];
      }
    }
  }
};
const queuePostRenderEffect = queueEffectWithSuspense;
function createRenderer(options) {
  return baseCreateRenderer(options);
}
function baseCreateRenderer(options, createHydrationFns) {
  const target = getGlobalThis();
  target.__VUE__ = true;
  const {
    insert: hostInsert,
    remove: hostRemove,
    patchProp: hostPatchProp,
    createElement: hostCreateElement,
    createText: hostCreateText,
    createComment: hostCreateComment,
    setText: hostSetText,
    setElementText: hostSetElementText,
    parentNode: hostParentNode,
    nextSibling: hostNextSibling,
    setScopeId: hostSetScopeId = NOOP,
    insertStaticContent: hostInsertStaticContent
  } = options;
  const patch = (n1, n2, container, anchor = null, parentComponent = null, parentSuspense = null, namespace = void 0, slotScopeIds = null, optimized = !!n2.dynamicChildren) => {
    if (n1 === n2) {
      return;
    }
    if (n1 && !isSameVNodeType(n1, n2)) {
      anchor = getNextHostNode(n1);
      unmount(n1, parentComponent, parentSuspense, true);
      n1 = null;
    }
    if (n2.patchFlag === -2) {
      optimized = false;
      n2.dynamicChildren = null;
    }
    if (n2.dynamicChildren && n1 && n1.dynamicChildren && n1.dynamicChildren.hasOnce) {
      if (n2.dynamicChildren === EMPTY_ARR) {
        n2.dynamicChildren = [];
      }
      n2.dynamicChildren.hasOnce = true;
    }
    const { type, ref: ref3, shapeFlag } = n2;
    switch (type) {
      case Text:
        processText(n1, n2, container, anchor);
        break;
      case Comment:
        processCommentNode(n1, n2, container, anchor);
        break;
      case Static:
        if (n1 == null) {
          mountStaticNode(n2, container, anchor, namespace);
        }
        break;
      case Fragment:
        processFragment(
          n1,
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized
        );
        break;
      default:
        if (shapeFlag & 1) {
          processElement(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized
          );
        } else if (shapeFlag & 6) {
          processComponent(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized
          );
        } else if (shapeFlag & 64) {
          type.process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
            internals
          );
        } else if (shapeFlag & 128) {
          type.process(
            n1,
            n2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized,
            internals
          );
        } else ;
    }
    if (ref3 != null && parentComponent) {
      setRef(ref3, n1 && n1.ref, parentSuspense, n2 || n1, !n2);
    } else if (ref3 == null && n1 && n1.ref != null) {
      setRef(n1.ref, null, parentSuspense, n1, true);
    }
  };
  const processText = (n1, n2, container, anchor) => {
    if (n1 == null) {
      hostInsert(
        n2.el = hostCreateText(n2.children),
        container,
        anchor
      );
    } else {
      const el = n2.el = n1.el;
      if (n2.children !== n1.children) {
        hostSetText(el, n2.children);
      }
    }
  };
  const processCommentNode = (n1, n2, container, anchor) => {
    if (n1 == null) {
      hostInsert(
        n2.el = hostCreateComment(n2.children || ""),
        container,
        anchor
      );
    } else {
      n2.el = n1.el;
    }
  };
  const mountStaticNode = (n2, container, anchor, namespace) => {
    [n2.el, n2.anchor] = hostInsertStaticContent(
      n2.children,
      container,
      anchor,
      namespace,
      n2.el,
      n2.anchor
    );
  };
  const moveStaticNode = ({ el, anchor }, container, nextSibling) => {
    let next;
    while (el && el !== anchor) {
      next = hostNextSibling(el);
      hostInsert(el, container, nextSibling);
      el = next;
    }
    hostInsert(anchor, container, nextSibling);
  };
  const removeStaticNode = ({ el, anchor }) => {
    let next;
    while (el && el !== anchor) {
      next = hostNextSibling(el);
      hostRemove(el);
      el = next;
    }
    hostRemove(anchor);
  };
  const processElement = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
    if (n2.type === "svg") {
      namespace = "svg";
    } else if (n2.type === "math") {
      namespace = "mathml";
    }
    if (n1 == null) {
      mountElement(
        n2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized
      );
    } else {
      const customElement = n1.el && n1.el._isVueCE ? n1.el : null;
      try {
        if (customElement) {
          customElement._beginPatch();
        }
        patchElement(
          n1,
          n2,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized
        );
      } finally {
        if (customElement) {
          customElement._endPatch();
        }
      }
    }
  };
  const mountElement = (vnode, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
    let el;
    let vnodeHook;
    const { props, shapeFlag, transition, dirs } = vnode;
    el = vnode.el = hostCreateElement(
      vnode.type,
      namespace,
      props && props.is,
      props
    );
    if (shapeFlag & 8) {
      hostSetElementText(el, vnode.children);
    } else if (shapeFlag & 16) {
      mountChildren(
        vnode.children,
        el,
        null,
        parentComponent,
        parentSuspense,
        resolveChildrenNamespace(vnode, namespace),
        slotScopeIds,
        optimized
      );
    }
    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, "created");
    }
    setScopeId(el, vnode, vnode.scopeId, slotScopeIds, parentComponent);
    if (props) {
      for (const key in props) {
        if (key !== "value" && !isReservedProp(key)) {
          hostPatchProp(el, key, null, props[key], namespace, parentComponent);
        }
      }
      if ("value" in props) {
        hostPatchProp(el, "value", null, props.value, namespace);
      }
      if (vnodeHook = props.onVnodeBeforeMount) {
        invokeVNodeHook(vnodeHook, parentComponent, vnode);
      }
    }
    if (dirs) {
      invokeDirectiveHook(vnode, null, parentComponent, "beforeMount");
    }
    const needCallTransitionHooks = needTransition(parentSuspense, transition);
    if (needCallTransitionHooks) {
      transition.beforeEnter(el);
    }
    hostInsert(el, container, anchor);
    if ((vnodeHook = props && props.onVnodeMounted) || needCallTransitionHooks || dirs) {
      queuePostRenderEffect(() => {
        try {
          vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode);
          needCallTransitionHooks && transition.enter(el);
          dirs && invokeDirectiveHook(vnode, null, parentComponent, "mounted");
        } finally {
        }
      }, parentSuspense);
    }
  };
  const setScopeId = (el, vnode, scopeId, slotScopeIds, parentComponent) => {
    if (scopeId) {
      hostSetScopeId(el, scopeId);
    }
    if (slotScopeIds) {
      for (let i = 0; i < slotScopeIds.length; i++) {
        hostSetScopeId(el, slotScopeIds[i]);
      }
    }
    if (parentComponent) {
      let subTree = parentComponent.subTree;
      if (vnode === subTree || isSuspense(subTree.type) && (subTree.ssContent === vnode || subTree.ssFallback === vnode)) {
        const parentVNode = parentComponent.vnode;
        setScopeId(
          el,
          parentVNode,
          parentVNode.scopeId,
          parentVNode.slotScopeIds,
          parentComponent.parent
        );
      }
    }
  };
  const mountChildren = (children, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized, start = 0) => {
    for (let i = start; i < children.length; i++) {
      const child = children[i] = optimized ? cloneIfMounted(children[i]) : normalizeVNode(children[i]);
      patch(
        null,
        child,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized
      );
    }
  };
  const patchElement = (n1, n2, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
    const el = n2.el = n1.el;
    let { patchFlag, dynamicChildren, dirs } = n2;
    patchFlag |= n1.patchFlag & 16;
    const oldProps = n1.props || EMPTY_OBJ;
    const newProps = n2.props || EMPTY_OBJ;
    let vnodeHook;
    parentComponent && toggleRecurse(parentComponent, false);
    if (vnodeHook = newProps.onVnodeBeforeUpdate) {
      invokeVNodeHook(vnodeHook, parentComponent, n2, n1);
    }
    if (dirs) {
      invokeDirectiveHook(n2, n1, parentComponent, "beforeUpdate");
    }
    parentComponent && toggleRecurse(parentComponent, true);
    if (
      // #6385 the old vnode may be a user-wrapped non-isomorphic block
      // Force full diff when block metadata is unstable.
      dynamicChildren && (!n1.dynamicChildren || n1.dynamicChildren.length !== dynamicChildren.length)
    ) {
      patchFlag = 0;
      optimized = false;
      dynamicChildren = null;
    }
    if (oldProps.innerHTML && newProps.innerHTML == null || oldProps.textContent && newProps.textContent == null) {
      hostSetElementText(el, "");
    }
    if (dynamicChildren) {
      patchBlockChildren(
        n1.dynamicChildren,
        dynamicChildren,
        el,
        parentComponent,
        parentSuspense,
        resolveChildrenNamespace(n2, namespace),
        slotScopeIds
      );
    } else if (!optimized) {
      patchChildren(
        n1,
        n2,
        el,
        null,
        parentComponent,
        parentSuspense,
        resolveChildrenNamespace(n2, namespace),
        slotScopeIds,
        false
      );
    }
    if (patchFlag > 0) {
      if (patchFlag & 16) {
        patchProps(el, oldProps, newProps, parentComponent, namespace);
      } else {
        if (patchFlag & 2) {
          if (oldProps.class !== newProps.class) {
            hostPatchProp(el, "class", null, newProps.class, namespace);
          }
        }
        if (patchFlag & 4) {
          hostPatchProp(el, "style", oldProps.style, newProps.style, namespace);
        }
        if (patchFlag & 8) {
          const propsToUpdate = n2.dynamicProps;
          for (let i = 0; i < propsToUpdate.length; i++) {
            const key = propsToUpdate[i];
            const prev = oldProps[key];
            const next = newProps[key];
            if (next !== prev || key === "value") {
              hostPatchProp(el, key, prev, next, namespace, parentComponent);
            }
          }
        }
      }
      if (patchFlag & 1) {
        if (n1.children !== n2.children) {
          hostSetElementText(el, n2.children);
        }
      }
    } else if (!optimized && dynamicChildren == null) {
      patchProps(el, oldProps, newProps, parentComponent, namespace);
    }
    if ((vnodeHook = newProps.onVnodeUpdated) || dirs) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, n2, n1);
        dirs && invokeDirectiveHook(n2, n1, parentComponent, "updated");
      }, parentSuspense);
    }
  };
  const patchBlockChildren = (oldChildren, newChildren, fallbackContainer, parentComponent, parentSuspense, namespace, slotScopeIds) => {
    for (let i = 0; i < newChildren.length; i++) {
      const oldVNode = oldChildren[i];
      const newVNode = newChildren[i];
      const container = (
        // oldVNode may be an errored async setup() component inside Suspense
        // which will not have a mounted element
        oldVNode.el && // - In the case of a Fragment, we need to provide the actual parent
        // of the Fragment itself so it can move its children.
        (oldVNode.type === Fragment || // - In the case of different nodes, there is going to be a replacement
        // which also requires the correct parent container
        !isSameVNodeType(oldVNode, newVNode) || // - In the case of a component, it could contain anything.
        oldVNode.shapeFlag & (6 | 64 | 128)) ? hostParentNode(oldVNode.el) : (
          // In other cases, the parent container is not actually used so we
          // just pass the block element here to avoid a DOM parentNode call.
          fallbackContainer
        )
      );
      patch(
        oldVNode,
        newVNode,
        container,
        null,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        true
      );
    }
  };
  const patchProps = (el, oldProps, newProps, parentComponent, namespace) => {
    if (oldProps !== newProps) {
      if (oldProps !== EMPTY_OBJ) {
        for (const key in oldProps) {
          if (!isReservedProp(key) && !(key in newProps)) {
            hostPatchProp(
              el,
              key,
              oldProps[key],
              null,
              namespace,
              parentComponent
            );
          }
        }
      }
      for (const key in newProps) {
        if (isReservedProp(key)) continue;
        const next = newProps[key];
        const prev = oldProps[key];
        if (next !== prev && key !== "value") {
          hostPatchProp(el, key, prev, next, namespace, parentComponent);
        }
      }
      if ("value" in newProps) {
        hostPatchProp(el, "value", oldProps.value, newProps.value, namespace);
      }
    }
  };
  const processFragment = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
    const fragmentStartAnchor = n2.el = n1 ? n1.el : hostCreateText("");
    const fragmentEndAnchor = n2.anchor = n1 ? n1.anchor : hostCreateText("");
    let { patchFlag, dynamicChildren, slotScopeIds: fragmentSlotScopeIds } = n2;
    if (fragmentSlotScopeIds) {
      slotScopeIds = slotScopeIds ? slotScopeIds.concat(fragmentSlotScopeIds) : fragmentSlotScopeIds;
    }
    if (n1 == null) {
      hostInsert(fragmentStartAnchor, container, anchor);
      hostInsert(fragmentEndAnchor, container, anchor);
      mountChildren(
        // #10007
        // such fragment like `<></>` will be compiled into
        // a fragment which doesn't have a children.
        // In this case fallback to an empty array
        n2.children || [],
        container,
        fragmentEndAnchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized
      );
    } else {
      if (patchFlag > 0 && patchFlag & 64 && dynamicChildren && // #2715 the previous fragment could've been a BAILed one as a result
      // of renderSlot() with no valid children
      n1.dynamicChildren && n1.dynamicChildren.length === dynamicChildren.length) {
        patchBlockChildren(
          n1.dynamicChildren,
          dynamicChildren,
          container,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds
        );
        if (
          // #2080 if the stable fragment has a key, it's a <template v-for> that may
          //  get moved around. Make sure all root level vnodes inherit el.
          // #2134 or if it's a component root, it may also get moved around
          // as the component is being moved.
          n2.key != null || parentComponent && n2 === parentComponent.subTree
        ) {
          traverseStaticChildren(
            n1,
            n2,
            true
            /* shallow */
          );
        }
      } else {
        patchChildren(
          n1,
          n2,
          container,
          fragmentEndAnchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized
        );
      }
    }
  };
  const processComponent = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
    n2.slotScopeIds = slotScopeIds;
    if (n1 == null) {
      if (n2.shapeFlag & 512) {
        parentComponent.ctx.activate(
          n2,
          container,
          anchor,
          namespace,
          optimized
        );
      } else {
        mountComponent(
          n2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          optimized
        );
      }
    } else {
      updateComponent(n1, n2, optimized);
    }
  };
  const mountComponent = (initialVNode, container, anchor, parentComponent, parentSuspense, namespace, optimized) => {
    const instance = initialVNode.component = createComponentInstance(
      initialVNode,
      parentComponent,
      parentSuspense
    );
    if (isKeepAlive(initialVNode)) {
      instance.ctx.renderer = internals;
    }
    {
      setupComponent(instance, false, optimized);
    }
    if (instance.asyncDep) {
      parentSuspense && parentSuspense.registerDep(instance, setupRenderEffect, optimized);
      if (!initialVNode.el) {
        const placeholder = instance.subTree = createVNode(Comment);
        processCommentNode(null, placeholder, container, anchor);
        initialVNode.placeholder = placeholder.el;
      }
    } else {
      setupRenderEffect(
        instance,
        initialVNode,
        container,
        anchor,
        parentSuspense,
        namespace,
        optimized
      );
    }
  };
  const updateComponent = (n1, n2, optimized) => {
    const instance = n2.component = n1.component;
    if (shouldUpdateComponent(n1, n2, optimized)) {
      if (instance.asyncDep && !instance.asyncResolved) {
        n2.el = n1.el;
        updateComponentPreRender(instance, n2, optimized);
        return;
      } else {
        instance.next = n2;
        instance.update();
      }
    } else {
      n2.el = n1.el;
      instance.vnode = n2;
    }
  };
  const setupRenderEffect = (instance, initialVNode, container, anchor, parentSuspense, namespace, optimized) => {
    const componentUpdateFn = () => {
      if (!instance.isMounted) {
        let vnodeHook;
        const { el, props } = initialVNode;
        const { bm, m, parent, root, type } = instance;
        const isAsyncWrapperVNode = isAsyncWrapper(initialVNode);
        toggleRecurse(instance, false);
        if (bm) {
          invokeArrayFns(bm);
        }
        if (!isAsyncWrapperVNode && (vnodeHook = props && props.onVnodeBeforeMount)) {
          invokeVNodeHook(vnodeHook, parent, initialVNode);
        }
        toggleRecurse(instance, true);
        {
          if (root.ce && root.ce._hasShadowRoot()) {
            root.ce._injectChildStyle(
              type,
              instance.parent ? instance.parent.type : void 0
            );
          }
          const subTree = instance.subTree = renderComponentRoot(instance);
          patch(
            null,
            subTree,
            container,
            anchor,
            instance,
            parentSuspense,
            namespace
          );
          initialVNode.el = subTree.el;
        }
        if (m) {
          queuePostRenderEffect(m, parentSuspense);
        }
        if (!isAsyncWrapperVNode && (vnodeHook = props && props.onVnodeMounted)) {
          const scopedInitialVNode = initialVNode;
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook, parent, scopedInitialVNode),
            parentSuspense
          );
        }
        if (initialVNode.shapeFlag & 256 || parent && isAsyncWrapper(parent.vnode) && parent.vnode.shapeFlag & 256) {
          instance.a && queuePostRenderEffect(instance.a, parentSuspense);
        }
        instance.isMounted = true;
        initialVNode = container = anchor = null;
      } else {
        let { next, bu, u, parent, vnode } = instance;
        {
          const nonHydratedAsyncRoot = locateNonHydratedAsyncRoot(instance);
          if (nonHydratedAsyncRoot) {
            if (next) {
              next.el = vnode.el;
              updateComponentPreRender(instance, next, optimized);
            }
            nonHydratedAsyncRoot.asyncDep.then(() => {
              queuePostRenderEffect(() => {
                if (!instance.isUnmounted) update();
              }, parentSuspense);
            });
            return;
          }
        }
        let originNext = next;
        let vnodeHook;
        toggleRecurse(instance, false);
        if (next) {
          next.el = vnode.el;
          updateComponentPreRender(instance, next, optimized);
        } else {
          next = vnode;
        }
        if (bu) {
          invokeArrayFns(bu);
        }
        if (vnodeHook = next.props && next.props.onVnodeBeforeUpdate) {
          invokeVNodeHook(vnodeHook, parent, next, vnode);
        }
        toggleRecurse(instance, true);
        const nextTree = renderComponentRoot(instance);
        const prevTree = instance.subTree;
        instance.subTree = nextTree;
        patch(
          prevTree,
          nextTree,
          // parent may have changed if it's in a teleport
          hostParentNode(prevTree.el),
          // anchor may have changed if it's in a fragment
          getNextHostNode(prevTree),
          instance,
          parentSuspense,
          namespace
        );
        next.el = nextTree.el;
        if (originNext === null) {
          updateHOCHostEl(instance, nextTree.el);
        }
        if (u) {
          queuePostRenderEffect(u, parentSuspense);
        }
        if (vnodeHook = next.props && next.props.onVnodeUpdated) {
          queuePostRenderEffect(
            () => invokeVNodeHook(vnodeHook, parent, next, vnode),
            parentSuspense
          );
        }
      }
    };
    instance.scope.on();
    const effect2 = instance.effect = new ReactiveEffect(componentUpdateFn);
    instance.scope.off();
    const update = instance.update = effect2.run.bind(effect2);
    const job = instance.job = effect2.runIfDirty.bind(effect2);
    job.i = instance;
    job.id = instance.uid;
    effect2.scheduler = () => queueJob(job);
    toggleRecurse(instance, true);
    update();
  };
  const updateComponentPreRender = (instance, nextVNode, optimized) => {
    nextVNode.component = instance;
    const prevProps = instance.vnode.props;
    instance.vnode = nextVNode;
    instance.next = null;
    updateProps(instance, nextVNode.props, prevProps, optimized);
    updateSlots(instance, nextVNode.children, optimized);
    pauseTracking();
    flushPreFlushCbs(instance);
    resetTracking();
  };
  const patchChildren = (n1, n2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized = false) => {
    const c1 = n1 && n1.children;
    const prevShapeFlag = n1 ? n1.shapeFlag : 0;
    const c2 = n2.children;
    const { patchFlag, shapeFlag } = n2;
    if (patchFlag > 0) {
      if (patchFlag & 128) {
        patchKeyedChildren(
          c1,
          c2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized
        );
        return;
      } else if (patchFlag & 256) {
        patchUnkeyedChildren(
          c1,
          c2,
          container,
          anchor,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized
        );
        return;
      }
    }
    if (shapeFlag & 8) {
      if (prevShapeFlag & 16) {
        unmountChildren(c1, parentComponent, parentSuspense);
      }
      if (c2 !== c1) {
        hostSetElementText(container, c2);
      }
    } else {
      if (prevShapeFlag & 16) {
        if (shapeFlag & 16) {
          patchKeyedChildren(
            c1,
            c2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized
          );
        } else {
          unmountChildren(c1, parentComponent, parentSuspense, true);
        }
      } else {
        if (prevShapeFlag & 8) {
          hostSetElementText(container, "");
        }
        if (shapeFlag & 16) {
          mountChildren(
            c2,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized
          );
        }
      }
    }
  };
  const patchUnkeyedChildren = (c1, c2, container, anchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
    c1 = c1 || EMPTY_ARR;
    c2 = c2 || EMPTY_ARR;
    const oldLength = c1.length;
    const newLength = c2.length;
    const commonLength = Math.min(oldLength, newLength);
    let i;
    for (i = 0; i < commonLength; i++) {
      const nextChild = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
      patch(
        c1[i],
        nextChild,
        container,
        null,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized
      );
    }
    if (oldLength > newLength) {
      unmountChildren(
        c1,
        parentComponent,
        parentSuspense,
        true,
        false,
        commonLength
      );
    } else {
      mountChildren(
        c2,
        container,
        anchor,
        parentComponent,
        parentSuspense,
        namespace,
        slotScopeIds,
        optimized,
        commonLength
      );
    }
  };
  const patchKeyedChildren = (c1, c2, container, parentAnchor, parentComponent, parentSuspense, namespace, slotScopeIds, optimized) => {
    let i = 0;
    const l2 = c2.length;
    let e1 = c1.length - 1;
    let e2 = l2 - 1;
    while (i <= e1 && i <= e2) {
      const n1 = c1[i];
      const n2 = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized
        );
      } else {
        break;
      }
      i++;
    }
    while (i <= e1 && i <= e2) {
      const n1 = c1[e1];
      const n2 = c2[e2] = optimized ? cloneIfMounted(c2[e2]) : normalizeVNode(c2[e2]);
      if (isSameVNodeType(n1, n2)) {
        patch(
          n1,
          n2,
          container,
          null,
          parentComponent,
          parentSuspense,
          namespace,
          slotScopeIds,
          optimized
        );
      } else {
        break;
      }
      e1--;
      e2--;
    }
    if (i > e1) {
      if (i <= e2) {
        const nextPos = e2 + 1;
        const anchor = nextPos < l2 ? c2[nextPos].el : parentAnchor;
        while (i <= e2) {
          patch(
            null,
            c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]),
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized
          );
          i++;
        }
      }
    } else if (i > e2) {
      while (i <= e1) {
        unmount(c1[i], parentComponent, parentSuspense, true);
        i++;
      }
    } else {
      const s1 = i;
      const s2 = i;
      const keyToNewIndexMap = /* @__PURE__ */ new Map();
      for (i = s2; i <= e2; i++) {
        const nextChild = c2[i] = optimized ? cloneIfMounted(c2[i]) : normalizeVNode(c2[i]);
        if (nextChild.key != null) {
          keyToNewIndexMap.set(nextChild.key, i);
        }
      }
      let j;
      let patched = 0;
      const toBePatched = e2 - s2 + 1;
      let moved = false;
      let maxNewIndexSoFar = 0;
      const newIndexToOldIndexMap = new Array(toBePatched);
      for (i = 0; i < toBePatched; i++) newIndexToOldIndexMap[i] = 0;
      for (i = s1; i <= e1; i++) {
        const prevChild = c1[i];
        if (patched >= toBePatched) {
          unmount(prevChild, parentComponent, parentSuspense, true);
          continue;
        }
        let newIndex;
        if (prevChild.key != null) {
          newIndex = keyToNewIndexMap.get(prevChild.key);
        } else {
          for (j = s2; j <= e2; j++) {
            if (newIndexToOldIndexMap[j - s2] === 0 && isSameVNodeType(prevChild, c2[j])) {
              newIndex = j;
              break;
            }
          }
        }
        if (newIndex === void 0) {
          unmount(prevChild, parentComponent, parentSuspense, true);
        } else {
          newIndexToOldIndexMap[newIndex - s2] = i + 1;
          if (newIndex >= maxNewIndexSoFar) {
            maxNewIndexSoFar = newIndex;
          } else {
            moved = true;
          }
          patch(
            prevChild,
            c2[newIndex],
            container,
            null,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized
          );
          patched++;
        }
      }
      const increasingNewIndexSequence = moved ? getSequence(newIndexToOldIndexMap) : EMPTY_ARR;
      j = increasingNewIndexSequence.length - 1;
      for (i = toBePatched - 1; i >= 0; i--) {
        const nextIndex = s2 + i;
        const nextChild = c2[nextIndex];
        const anchorVNode = c2[nextIndex + 1];
        const anchor = nextIndex + 1 < l2 ? (
          // #13559, #14173 fallback to el placeholder for unresolved async component
          anchorVNode.el || resolveAsyncComponentPlaceholder(anchorVNode)
        ) : parentAnchor;
        if (newIndexToOldIndexMap[i] === 0) {
          patch(
            null,
            nextChild,
            container,
            anchor,
            parentComponent,
            parentSuspense,
            namespace,
            slotScopeIds,
            optimized
          );
        } else if (moved) {
          if (j < 0 || i !== increasingNewIndexSequence[j]) {
            move(nextChild, container, anchor, 2);
          } else {
            j--;
          }
        }
      }
    }
  };
  const move = (vnode, container, anchor, moveType, parentSuspense = null) => {
    const { el, type, transition, children, shapeFlag } = vnode;
    if (shapeFlag & 6) {
      move(vnode.component.subTree, container, anchor, moveType);
      return;
    }
    if (shapeFlag & 128) {
      vnode.suspense.move(container, anchor, moveType);
      return;
    }
    if (shapeFlag & 64) {
      type.move(vnode, container, anchor, internals);
      return;
    }
    if (type === Fragment) {
      hostInsert(el, container, anchor);
      for (let i = 0; i < children.length; i++) {
        move(children[i], container, anchor, moveType);
      }
      hostInsert(vnode.anchor, container, anchor);
      return;
    }
    if (type === Static) {
      moveStaticNode(vnode, container, anchor);
      return;
    }
    const needTransition2 = moveType !== 2 && shapeFlag & 1 && transition;
    if (needTransition2) {
      if (moveType === 0) {
        if (transition.persisted && !el[leaveCbKey]) {
          hostInsert(el, container, anchor);
        } else {
          transition.beforeEnter(el);
          hostInsert(el, container, anchor);
          queuePostRenderEffect(() => transition.enter(el), parentSuspense);
        }
      } else {
        const { leave, delayLeave, afterLeave } = transition;
        const remove22 = () => {
          if (vnode.ctx.isUnmounted) {
            hostRemove(el);
          } else {
            hostInsert(el, container, anchor);
          }
        };
        const performLeave = () => {
          const wasLeaving = el._isLeaving || !!el[leaveCbKey];
          if (el._isLeaving) {
            el[leaveCbKey](
              true
              /* cancelled */
            );
          }
          if (transition.persisted && !wasLeaving) {
            remove22();
          } else {
            leave(el, () => {
              remove22();
              afterLeave && afterLeave();
            });
          }
        };
        if (delayLeave) {
          delayLeave(el, remove22, performLeave);
        } else {
          performLeave();
        }
      }
    } else {
      hostInsert(el, container, anchor);
    }
  };
  const unmount = (vnode, parentComponent, parentSuspense, doRemove = false, optimized = false) => {
    const {
      type,
      props,
      ref: ref3,
      children,
      dynamicChildren,
      shapeFlag,
      patchFlag,
      dirs,
      cacheIndex,
      memo
    } = vnode;
    if (patchFlag === -2 || dynamicChildren && dynamicChildren.hasOnce) {
      optimized = false;
    }
    if (ref3 != null) {
      pauseTracking();
      setRef(ref3, null, parentSuspense, vnode, true);
      resetTracking();
    }
    if (cacheIndex != null && (!vnode.ctx || vnode.ctx === parentComponent)) {
      parentComponent.renderCache[cacheIndex] = void 0;
    }
    if (shapeFlag & 256) {
      parentComponent.ctx.deactivate(vnode);
      return;
    }
    const shouldInvokeDirs = shapeFlag & 1 && dirs;
    const shouldInvokeVnodeHook = !isAsyncWrapper(vnode);
    let vnodeHook;
    if (shouldInvokeVnodeHook && (vnodeHook = props && props.onVnodeBeforeUnmount)) {
      invokeVNodeHook(vnodeHook, parentComponent, vnode);
    }
    if (shapeFlag & 6) {
      unmountComponent(vnode.component, parentSuspense, doRemove);
    } else {
      if (shapeFlag & 128) {
        vnode.suspense.unmount(parentSuspense, doRemove);
        return;
      }
      if (shouldInvokeDirs) {
        invokeDirectiveHook(vnode, null, parentComponent, "beforeUnmount");
      }
      if (shapeFlag & 64) {
        vnode.type.remove(
          vnode,
          parentComponent,
          parentSuspense,
          internals,
          doRemove
        );
      } else if (dynamicChildren && // #5154
      // when v-once is used inside a block, setBlockTracking(-1) marks the
      // parent block with hasOnce: true
      // so that it doesn't take the fast path during unmount - otherwise
      // components nested in v-once are never unmounted.
      !dynamicChildren.hasOnce && // #1153: fast path should not be taken for non-stable (v-for) fragments
      (type !== Fragment || patchFlag > 0 && patchFlag & 64)) {
        unmountChildren(
          dynamicChildren,
          parentComponent,
          parentSuspense,
          false,
          true
        );
      } else if (type === Fragment && patchFlag & (128 | 256) || !optimized && shapeFlag & 16) {
        unmountChildren(children, parentComponent, parentSuspense);
      }
      if (doRemove) {
        remove2(vnode);
      }
    }
    const shouldInvalidateMemo = memo != null && cacheIndex == null;
    if (shouldInvokeVnodeHook && (vnodeHook = props && props.onVnodeUnmounted) || shouldInvokeDirs || shouldInvalidateMemo) {
      queuePostRenderEffect(() => {
        vnodeHook && invokeVNodeHook(vnodeHook, parentComponent, vnode);
        shouldInvokeDirs && invokeDirectiveHook(vnode, null, parentComponent, "unmounted");
        if (shouldInvalidateMemo) {
          vnode.el = null;
        }
      }, parentSuspense);
    }
  };
  const remove2 = (vnode) => {
    const { type, el, anchor, transition } = vnode;
    if (type === Fragment) {
      {
        removeFragment(el, anchor);
      }
      return;
    }
    if (type === Static) {
      removeStaticNode(vnode);
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave();
      }
      return;
    }
    const performRemove = () => {
      hostRemove(el);
      if (transition && !transition.persisted && transition.afterLeave) {
        transition.afterLeave();
      }
    };
    if (vnode.shapeFlag & 1 && transition && !transition.persisted) {
      const { leave, delayLeave } = transition;
      const performLeave = () => leave(el, performRemove);
      if (delayLeave) {
        delayLeave(vnode.el, performRemove, performLeave);
      } else {
        performLeave();
      }
    } else {
      performRemove();
    }
  };
  const removeFragment = (cur, end) => {
    let next;
    while (cur !== end) {
      next = hostNextSibling(cur);
      hostRemove(cur);
      cur = next;
    }
    hostRemove(end);
  };
  const unmountComponent = (instance, parentSuspense, doRemove) => {
    const { bum, scope, job, subTree, um, m, a } = instance;
    invalidateMount(m);
    invalidateMount(a);
    if (bum) {
      invokeArrayFns(bum);
    }
    scope.stop();
    if (job) {
      job.flags |= 8;
      unmount(subTree, instance, parentSuspense, doRemove);
    } else if (instance.vnode.el && subTree) {
      subTree.transition = instance.vnode.transition;
      unmount(subTree, instance, parentSuspense, doRemove);
    }
    if (um) {
      queuePostRenderEffect(um, parentSuspense);
    }
    queuePostRenderEffect(() => {
      instance.isUnmounted = true;
    }, parentSuspense);
  };
  const unmountChildren = (children, parentComponent, parentSuspense, doRemove = false, optimized = false, start = 0) => {
    for (let i = start; i < children.length; i++) {
      unmount(children[i], parentComponent, parentSuspense, doRemove, optimized);
    }
  };
  const getNextHostNode = (vnode) => {
    if (vnode.shapeFlag & 6) {
      return getNextHostNode(vnode.component.subTree);
    }
    if (vnode.shapeFlag & 128) {
      return vnode.suspense.next();
    }
    const el = hostNextSibling(vnode.anchor || vnode.el);
    const teleportEnd = el && el[TeleportEndKey];
    return teleportEnd ? hostNextSibling(teleportEnd) : el;
  };
  let isFlushing = false;
  const render2 = (vnode, container, namespace) => {
    let instance;
    if (vnode == null) {
      if (container._vnode) {
        unmount(container._vnode, null, null, true);
        instance = container._vnode.component;
      }
    } else {
      patch(
        container._vnode || null,
        vnode,
        container,
        null,
        null,
        null,
        namespace
      );
    }
    container._vnode = vnode;
    if (!isFlushing) {
      isFlushing = true;
      flushPreFlushCbs(instance);
      flushPostFlushCbs();
      isFlushing = false;
    }
  };
  const internals = {
    p: patch,
    um: unmount,
    m: move,
    r: remove2,
    mt: mountComponent,
    mc: mountChildren,
    pc: patchChildren,
    pbc: patchBlockChildren,
    n: getNextHostNode,
    o: options
  };
  let hydrate;
  return {
    render: render2,
    hydrate,
    createApp: createAppAPI(render2)
  };
}
function resolveChildrenNamespace({ type, props }, currentNamespace) {
  return currentNamespace === "svg" && type === "foreignObject" || currentNamespace === "mathml" && type === "annotation-xml" && props && props.encoding && props.encoding.includes("html") ? void 0 : currentNamespace;
}
function toggleRecurse({ effect: effect2, job }, allowed) {
  if (allowed) {
    effect2.flags |= 32;
    job.flags |= 4;
  } else {
    effect2.flags &= -33;
    job.flags &= -5;
  }
}
function needTransition(parentSuspense, transition) {
  return (!parentSuspense || parentSuspense && !parentSuspense.pendingBranch) && transition && !transition.persisted;
}
function traverseStaticChildren(n1, n2, shallow = false) {
  const ch1 = n1.children;
  const ch2 = n2.children;
  if (isArray(ch1) && isArray(ch2)) {
    for (let i = 0; i < ch1.length; i++) {
      const c1 = ch1[i];
      let c2 = ch2[i];
      if (c2.shapeFlag & 1 && !c2.dynamicChildren) {
        if (c2.patchFlag <= 0 || c2.patchFlag === 32) {
          c2 = ch2[i] = cloneIfMounted(ch2[i]);
          c2.el = c1.el;
        }
        if (!shallow && c2.patchFlag !== -2)
          traverseStaticChildren(c1, c2);
      }
      if (c2.type === Text) {
        if (c2.patchFlag === -1) {
          c2 = ch2[i] = cloneIfMounted(c2);
        }
        c2.el = c1.el;
      }
      if (c2.type === Comment && !c2.el) {
        c2.el = c1.el;
      }
    }
  }
}
function getSequence(arr) {
  const p2 = arr.slice();
  const result = [0];
  let i, j, u, v, c;
  const len = arr.length;
  for (i = 0; i < len; i++) {
    const arrI = arr[i];
    if (arrI !== 0) {
      j = result[result.length - 1];
      if (arr[j] < arrI) {
        p2[i] = j;
        result.push(i);
        continue;
      }
      u = 0;
      v = result.length - 1;
      while (u < v) {
        c = u + v >> 1;
        if (arr[result[c]] < arrI) {
          u = c + 1;
        } else {
          v = c;
        }
      }
      if (arrI < arr[result[u]]) {
        if (u > 0) {
          p2[i] = result[u - 1];
        }
        result[u] = i;
      }
    }
  }
  u = result.length;
  v = result[u - 1];
  while (u-- > 0) {
    result[u] = v;
    v = p2[v];
  }
  return result;
}
function locateNonHydratedAsyncRoot(instance) {
  const subComponent = instance.subTree.component;
  if (subComponent) {
    if (subComponent.asyncDep && !subComponent.asyncResolved) {
      return subComponent;
    } else {
      return locateNonHydratedAsyncRoot(subComponent);
    }
  }
}
function invalidateMount(hooks2) {
  if (hooks2) {
    for (let i = 0; i < hooks2.length; i++)
      hooks2[i].flags |= 8;
  }
}
function resolveAsyncComponentPlaceholder(anchorVnode) {
  if (anchorVnode.placeholder) {
    return anchorVnode.placeholder;
  }
  const instance = anchorVnode.component;
  if (instance) {
    return resolveAsyncComponentPlaceholder(instance.subTree);
  }
  return null;
}
const isSuspense = (type) => type.__isSuspense;
function queueEffectWithSuspense(fn, suspense) {
  if (suspense && suspense.pendingBranch) {
    if (isArray(fn)) {
      suspense.effects.push(...fn);
    } else {
      suspense.effects.push(fn);
    }
  } else {
    queuePostFlushCb(fn);
  }
}
const Fragment = /* @__PURE__ */ Symbol.for("v-fgt");
const Text = /* @__PURE__ */ Symbol.for("v-txt");
const Comment = /* @__PURE__ */ Symbol.for("v-cmt");
const Static = /* @__PURE__ */ Symbol.for("v-stc");
const blockStack = [];
let currentBlock = null;
function openBlock(disableTracking = false) {
  blockStack.push(currentBlock = disableTracking ? null : []);
}
function closeBlock() {
  blockStack.pop();
  currentBlock = blockStack[blockStack.length - 1] || null;
}
let isBlockTreeEnabled = 1;
function setBlockTracking(value, inVOnce = false) {
  isBlockTreeEnabled += value;
  if (value < 0 && currentBlock && inVOnce) {
    currentBlock.hasOnce = true;
  }
}
function setupBlock(vnode) {
  vnode.dynamicChildren = isBlockTreeEnabled > 0 ? currentBlock || EMPTY_ARR : null;
  closeBlock();
  if (isBlockTreeEnabled > 0 && currentBlock) {
    currentBlock.push(vnode);
  }
  return vnode;
}
function createElementBlock(type, props, children, patchFlag, dynamicProps, shapeFlag) {
  return setupBlock(
    createBaseVNode(
      type,
      props,
      children,
      patchFlag,
      dynamicProps,
      shapeFlag,
      true
    )
  );
}
function createBlock(type, props, children, patchFlag, dynamicProps) {
  return setupBlock(
    createVNode(
      type,
      props,
      children,
      patchFlag,
      dynamicProps,
      true
    )
  );
}
function isVNode(value) {
  return value ? value.__v_isVNode === true : false;
}
function isSameVNodeType(n1, n2) {
  return n1.type === n2.type && n1.key === n2.key;
}
const normalizeKey = ({ key }) => key != null ? key : null;
const normalizeRef = ({
  ref: ref3,
  ref_key,
  ref_for
}) => {
  if (typeof ref3 === "number") {
    ref3 = "" + ref3;
  }
  return ref3 != null ? isString(ref3) || /* @__PURE__ */ isRef(ref3) || isFunction(ref3) ? { i: currentRenderingInstance, r: ref3, k: ref_key, f: !!ref_for } : ref3 : null;
};
function createBaseVNode(type, props = null, children = null, patchFlag = 0, dynamicProps = null, shapeFlag = type === Fragment ? 0 : 1, isBlockNode = false, needFullChildrenNormalization = false) {
  const vnode = {
    __v_isVNode: true,
    __v_skip: true,
    type,
    props,
    key: props && normalizeKey(props),
    ref: props && normalizeRef(props),
    scopeId: currentScopeId,
    slotScopeIds: null,
    children,
    component: null,
    suspense: null,
    ssContent: null,
    ssFallback: null,
    dirs: null,
    transition: null,
    el: null,
    anchor: null,
    target: null,
    targetStart: null,
    targetAnchor: null,
    staticCount: 0,
    shapeFlag,
    patchFlag,
    dynamicProps,
    dynamicChildren: null,
    appContext: null,
    ctx: currentRenderingInstance
  };
  if (needFullChildrenNormalization) {
    normalizeChildren(vnode, children);
    if (shapeFlag & 128) {
      type.normalize(vnode);
    }
  } else if (children) {
    vnode.shapeFlag |= isString(children) ? 8 : 16;
  }
  if (isBlockTreeEnabled > 0 && // avoid a block node from tracking itself
  !isBlockNode && // has current parent block
  currentBlock && // presence of a patch flag indicates this node needs patching on updates.
  // component nodes also should always be patched, because even if the
  // component doesn't need to update, it needs to persist the instance on to
  // the next vnode so that it can be properly unmounted later.
  (vnode.patchFlag > 0 || shapeFlag & 6) && // the EVENTS flag is only for hydration and if it is the only flag, the
  // vnode should not be considered dynamic due to handler caching.
  vnode.patchFlag !== 32) {
    currentBlock.push(vnode);
  }
  return vnode;
}
const createVNode = _createVNode;
function _createVNode(type, props = null, children = null, patchFlag = 0, dynamicProps = null, isBlockNode = false) {
  if (!type || type === NULL_DYNAMIC_COMPONENT) {
    type = Comment;
  }
  if (isVNode(type)) {
    const cloned = cloneVNode(
      type,
      props,
      true
      /* mergeRef: true */
    );
    if (children) {
      normalizeChildren(cloned, children);
    }
    if (isBlockTreeEnabled > 0 && !isBlockNode && currentBlock) {
      if (cloned.shapeFlag & 6) {
        currentBlock[currentBlock.indexOf(type)] = cloned;
      } else {
        currentBlock.push(cloned);
      }
    }
    cloned.patchFlag = -2;
    return cloned;
  }
  if (isClassComponent(type)) {
    type = type.__vccOpts;
  }
  if (props) {
    props = guardReactiveProps(props);
    let { class: klass, style } = props;
    if (klass && !isString(klass)) {
      props.class = normalizeClass(klass);
    }
    if (isObject(style)) {
      if (/* @__PURE__ */ isProxy(style) && !isArray(style)) {
        style = extend({}, style);
      }
      props.style = normalizeStyle(style);
    }
  }
  const shapeFlag = isString(type) ? 1 : isSuspense(type) ? 128 : isTeleport(type) ? 64 : isObject(type) ? 4 : isFunction(type) ? 2 : 0;
  return createBaseVNode(
    type,
    props,
    children,
    patchFlag,
    dynamicProps,
    shapeFlag,
    isBlockNode,
    true
  );
}
function guardReactiveProps(props) {
  if (!props) return null;
  return /* @__PURE__ */ isProxy(props) || isInternalObject(props) ? extend({}, props) : props;
}
function cloneVNode(vnode, extraProps, mergeRef = false, cloneTransition = false) {
  const { props, ref: ref3, patchFlag, children, transition } = vnode;
  const mergedProps = extraProps ? mergeProps(props || {}, extraProps) : props;
  const cloned = {
    __v_isVNode: true,
    __v_skip: true,
    type: vnode.type,
    props: mergedProps,
    key: mergedProps && normalizeKey(mergedProps),
    ref: extraProps && extraProps.ref ? (
      // #2078 in the case of <component :is="vnode" ref="extra"/>
      // if the vnode itself already has a ref, cloneVNode will need to merge
      // the refs so the single vnode can be set on multiple refs
      mergeRef && ref3 ? isArray(ref3) ? ref3.concat(normalizeRef(extraProps)) : [ref3, normalizeRef(extraProps)] : normalizeRef(extraProps)
    ) : ref3,
    scopeId: vnode.scopeId,
    slotScopeIds: vnode.slotScopeIds,
    children,
    target: vnode.target,
    targetStart: vnode.targetStart,
    targetAnchor: vnode.targetAnchor,
    staticCount: vnode.staticCount,
    shapeFlag: vnode.shapeFlag,
    // if the vnode is cloned with extra props, we can no longer assume its
    // existing patch flag to be reliable and need to add the FULL_PROPS flag.
    // note: preserve flag for fragments since they use the flag for children
    // fast paths only.
    patchFlag: extraProps && vnode.type !== Fragment ? patchFlag === -1 ? 16 : patchFlag | 16 : patchFlag,
    dynamicProps: vnode.dynamicProps,
    dynamicChildren: vnode.dynamicChildren,
    appContext: vnode.appContext,
    dirs: vnode.dirs,
    transition,
    // These should technically only be non-null on mounted VNodes. However,
    // they *should* be copied for kept-alive vnodes. So we just always copy
    // them since them being non-null during a mount doesn't affect the logic as
    // they will simply be overwritten.
    component: vnode.component,
    suspense: vnode.suspense,
    ssContent: vnode.ssContent && cloneVNode(vnode.ssContent),
    ssFallback: vnode.ssFallback && cloneVNode(vnode.ssFallback),
    placeholder: vnode.placeholder,
    el: vnode.el,
    anchor: vnode.anchor,
    ctx: vnode.ctx,
    ce: vnode.ce,
    cacheIndex: vnode.cacheIndex
  };
  if (transition && cloneTransition) {
    setTransitionHooks(
      cloned,
      transition.clone(cloned)
    );
  }
  return cloned;
}
function createTextVNode(text = " ", flag = 0) {
  return createVNode(Text, null, text, flag);
}
function createCommentVNode(text = "", asBlock = false) {
  return asBlock ? (openBlock(), createBlock(Comment, null, text)) : createVNode(Comment, null, text);
}
function normalizeVNode(child) {
  if (child == null || typeof child === "boolean") {
    return createVNode(Comment);
  } else if (isArray(child)) {
    return createVNode(
      Fragment,
      null,
      // #3666, avoid reference pollution when reusing vnode
      child.slice()
    );
  } else if (isVNode(child)) {
    return cloneIfMounted(child);
  } else {
    return createVNode(Text, null, String(child));
  }
}
function cloneIfMounted(child) {
  return child.el === null && child.patchFlag !== -1 || child.memo ? child : cloneVNode(child);
}
function normalizeChildren(vnode, children) {
  let type = 0;
  const { shapeFlag } = vnode;
  if (children == null) {
    children = null;
  } else if (isArray(children)) {
    type = 16;
  } else if (typeof children === "object") {
    if (shapeFlag & (1 | 64)) {
      const slot = children.default;
      if (slot) {
        slot._c && (slot._d = false);
        normalizeChildren(vnode, slot());
        slot._c && (slot._d = true);
      }
      return;
    } else {
      type = 32;
      const slotFlag = children._;
      if (!slotFlag && !isInternalObject(children)) {
        children._ctx = currentRenderingInstance;
      } else if (slotFlag === 3 && currentRenderingInstance) {
        if (currentRenderingInstance.slots._ === 1) {
          children._ = 1;
        } else {
          children._ = 2;
          vnode.patchFlag |= 1024;
        }
      }
    }
  } else if (isFunction(children)) {
    if (shapeFlag & (1 | 64)) {
      normalizeChildren(vnode, { default: children });
      return;
    }
    children = { default: children, _ctx: currentRenderingInstance };
    type = 32;
  } else {
    children = String(children);
    if (shapeFlag & 64) {
      type = 16;
      children = [createTextVNode(children)];
    } else {
      type = 8;
    }
  }
  vnode.children = children;
  vnode.shapeFlag |= type;
}
function mergeProps(...args) {
  const ret = {};
  for (let i = 0; i < args.length; i++) {
    const toMerge = args[i];
    for (const key in toMerge) {
      if (key === "class") {
        if (ret.class !== toMerge.class) {
          ret.class = normalizeClass([ret.class, toMerge.class]);
        }
      } else if (key === "style") {
        ret.style = normalizeStyle([ret.style, toMerge.style]);
      } else if (isOn(key)) {
        const existing = ret[key];
        const incoming = toMerge[key];
        if (incoming && existing !== incoming && !(isArray(existing) && existing.includes(incoming))) {
          ret[key] = existing ? [].concat(existing, incoming) : incoming;
        } else if (incoming == null && existing == null && // mergeProps({ 'onUpdate:modelValue': undefined }) should not retain
        // the model listener.
        !isModelListener(key)) {
          ret[key] = incoming;
        }
      } else if (key !== "") {
        ret[key] = toMerge[key];
      }
    }
  }
  return ret;
}
function invokeVNodeHook(hook, instance, vnode, prevVNode = null) {
  callWithAsyncErrorHandling(hook, instance, 7, [
    vnode,
    prevVNode
  ]);
}
const emptyAppContext = createAppContext();
let uid = 0;
function createComponentInstance(vnode, parent, suspense) {
  const type = vnode.type;
  const appContext = (parent ? parent.appContext : vnode.appContext) || emptyAppContext;
  const instance = {
    uid: uid++,
    vnode,
    type,
    parent,
    appContext,
    root: null,
    // to be immediately set
    next: null,
    subTree: null,
    // will be set synchronously right after creation
    effect: null,
    update: null,
    // will be set synchronously right after creation
    job: null,
    scope: new EffectScope(
      true
      /* detached */
    ),
    render: null,
    proxy: null,
    exposed: null,
    exposeProxy: null,
    withProxy: null,
    provides: parent ? parent.provides : Object.create(appContext.provides),
    ids: parent ? parent.ids : ["", 0, 0],
    accessCache: null,
    renderCache: [],
    // local resolved assets
    components: null,
    directives: null,
    // resolved props and emits options
    propsOptions: normalizePropsOptions(type, appContext),
    emitsOptions: normalizeEmitsOptions(type, appContext),
    // emit
    emit: null,
    // to be set immediately
    emitted: null,
    // props default value
    propsDefaults: EMPTY_OBJ,
    // inheritAttrs
    inheritAttrs: type.inheritAttrs,
    // state
    ctx: EMPTY_OBJ,
    data: EMPTY_OBJ,
    props: EMPTY_OBJ,
    attrs: EMPTY_OBJ,
    slots: EMPTY_OBJ,
    refs: EMPTY_OBJ,
    setupState: EMPTY_OBJ,
    setupContext: null,
    // suspense related
    suspense,
    suspenseId: suspense ? suspense.pendingId : 0,
    asyncDep: null,
    asyncResolved: false,
    // lifecycle hooks
    // not using enums here because it results in computed properties
    isMounted: false,
    isUnmounted: false,
    isDeactivated: false,
    bc: null,
    c: null,
    bm: null,
    m: null,
    bu: null,
    u: null,
    um: null,
    bum: null,
    da: null,
    a: null,
    rtg: null,
    rtc: null,
    ec: null,
    sp: null
  };
  {
    instance.ctx = { _: instance };
  }
  instance.root = parent ? parent.root : instance;
  instance.emit = emit.bind(null, instance);
  if (vnode.ce) {
    vnode.ce(instance);
  }
  return instance;
}
let currentInstance = null;
const getCurrentInstance = () => currentInstance || currentRenderingInstance;
let internalSetCurrentInstance;
let setInSSRSetupState;
{
  const g = getGlobalThis();
  const registerGlobalSetter = (key, setter) => {
    let setters;
    if (!(setters = g[key])) setters = g[key] = [];
    setters.push(setter);
    return (v) => {
      if (setters.length > 1) setters.forEach((set) => set(v));
      else setters[0](v);
    };
  };
  internalSetCurrentInstance = registerGlobalSetter(
    `__VUE_INSTANCE_SETTERS__`,
    (v) => currentInstance = v
  );
  setInSSRSetupState = registerGlobalSetter(
    `__VUE_SSR_SETTERS__`,
    (v) => isInSSRComponentSetup = v
  );
}
const setCurrentInstance = (instance) => {
  const prev = currentInstance;
  internalSetCurrentInstance(instance);
  instance.scope.on();
  return () => {
    instance.scope.off();
    internalSetCurrentInstance(prev);
  };
};
const unsetCurrentInstance = () => {
  currentInstance && currentInstance.scope.off();
  internalSetCurrentInstance(null);
};
function isStatefulComponent(instance) {
  return instance.vnode.shapeFlag & 4;
}
let isInSSRComponentSetup = false;
function setupComponent(instance, isSSR = false, optimized = false) {
  isSSR && setInSSRSetupState(isSSR);
  const { props, children } = instance.vnode;
  const isStateful = isStatefulComponent(instance);
  initProps(instance, props, isStateful, isSSR);
  initSlots(instance, children, optimized || isSSR);
  const setupResult = isStateful ? setupStatefulComponent(instance, isSSR) : void 0;
  isSSR && setInSSRSetupState(false);
  return setupResult;
}
function setupStatefulComponent(instance, isSSR) {
  const Component = instance.type;
  instance.accessCache = /* @__PURE__ */ Object.create(null);
  instance.proxy = new Proxy(instance.ctx, PublicInstanceProxyHandlers);
  const { setup } = Component;
  if (setup) {
    pauseTracking();
    const setupContext = instance.setupContext = setup.length > 1 ? createSetupContext(instance) : null;
    const reset = setCurrentInstance(instance);
    const setupResult = callWithErrorHandling(
      setup,
      instance,
      0,
      [
        instance.props,
        setupContext
      ]
    );
    const isAsyncSetup = isPromise(setupResult);
    resetTracking();
    reset();
    if ((isAsyncSetup || instance.sp) && !isAsyncWrapper(instance)) {
      markAsyncBoundary(instance);
    }
    if (isAsyncSetup) {
      setupResult.then(unsetCurrentInstance, unsetCurrentInstance);
      if (isSSR) {
        return setupResult.then((resolvedResult) => {
          setInSSRSetupState(true);
          try {
            handleSetupResult(instance, resolvedResult, isSSR);
          } finally {
            setInSSRSetupState(false);
          }
        }).catch((e) => {
          handleError(e, instance, 0);
        });
      } else {
        instance.asyncDep = setupResult;
      }
    } else {
      handleSetupResult(instance, setupResult);
    }
  } else {
    finishComponentSetup(instance);
  }
}
function handleSetupResult(instance, setupResult, isSSR) {
  if (isFunction(setupResult)) {
    if (instance.type.__ssrInlineRender) {
      instance.ssrRender = setupResult;
    } else {
      instance.render = setupResult;
    }
  } else if (isObject(setupResult)) {
    instance.setupState = proxyRefs(setupResult);
  } else ;
  finishComponentSetup(instance);
}
function finishComponentSetup(instance, isSSR, skipOptions) {
  const Component = instance.type;
  if (!instance.render) {
    instance.render = Component.render || NOOP;
  }
  {
    const reset = setCurrentInstance(instance);
    pauseTracking();
    try {
      applyOptions(instance);
    } finally {
      resetTracking();
      reset();
    }
  }
}
const attrsProxyHandlers = {
  get(target, key) {
    track(target, "get", "");
    return target[key];
  }
};
function createSetupContext(instance) {
  const expose = (exposed) => {
    instance.exposed = exposed || {};
  };
  {
    return {
      attrs: new Proxy(instance.attrs, attrsProxyHandlers),
      slots: instance.slots,
      emit: instance.emit,
      expose
    };
  }
}
function getComponentPublicInstance(instance) {
  if (instance.exposed) {
    return instance.exposeProxy || (instance.exposeProxy = new Proxy(proxyRefs(markRaw(instance.exposed)), {
      get(target, key) {
        if (key in target) {
          return target[key];
        } else if (key in publicPropertiesMap) {
          return publicPropertiesMap[key](instance);
        }
      },
      has(target, key) {
        return key in target || key in publicPropertiesMap;
      }
    }));
  } else {
    return instance.proxy;
  }
}
const classifyRE = /(?:^|[-_])\w/g;
const classify = (str) => str.replace(classifyRE, (c) => c.toUpperCase()).replace(/[-_]/g, "");
function getComponentName(Component, includeInferred = true) {
  return isFunction(Component) ? Component.displayName || Component.name : Component.name || includeInferred && Component.__name;
}
function formatComponentName(instance, Component, isRoot = false) {
  let name = getComponentName(Component);
  if (!name && Component.__file) {
    const match = Component.__file.match(/([^/\\]+)\.\w+$/);
    if (match) {
      name = match[1];
    }
  }
  if (!name && instance) {
    const inferFromRegistry = (registry) => {
      for (const key in registry) {
        if (registry[key] === Component) {
          return key;
        }
      }
    };
    name = inferFromRegistry(instance.components) || instance.parent && inferFromRegistry(
      instance.parent.type.components
    ) || inferFromRegistry(instance.appContext.components);
  }
  return name ? classify(name) : isRoot ? `App` : `Anonymous`;
}
function isClassComponent(value) {
  return isFunction(value) && "__vccOpts" in value;
}
const computed = (getterOrOptions, debugOptions) => {
  const c = /* @__PURE__ */ computed$1(getterOrOptions, debugOptions, isInSSRComponentSetup);
  return c;
};
const version = "3.5.43";
let policy = void 0;
const tt = typeof window !== "undefined" && window.trustedTypes;
if (tt) {
  try {
    policy = /* @__PURE__ */ tt.createPolicy("vue", {
      createHTML: (val) => val
    });
  } catch (e) {
  }
}
const unsafeToTrustedHTML = policy ? (val) => policy.createHTML(val) : (val) => val;
const svgNS = "http://www.w3.org/2000/svg";
const mathmlNS = "http://www.w3.org/1998/Math/MathML";
const doc = typeof document !== "undefined" ? document : null;
const templateContainer = doc && /* @__PURE__ */ doc.createElement("template");
const nodeOps = {
  insert: (child, parent, anchor) => {
    parent.insertBefore(child, anchor || null);
  },
  remove: (child) => {
    const parent = child.parentNode;
    if (parent) {
      parent.removeChild(child);
    }
  },
  createElement: (tag, namespace, is, props) => {
    const el = namespace === "svg" ? doc.createElementNS(svgNS, tag) : namespace === "mathml" ? doc.createElementNS(mathmlNS, tag) : is ? doc.createElement(tag, { is }) : doc.createElement(tag);
    if (tag === "select" && props && props.multiple != null) {
      el.setAttribute("multiple", props.multiple);
    }
    return el;
  },
  createText: (text) => doc.createTextNode(text),
  createComment: (text) => doc.createComment(text),
  setText: (node, text) => {
    node.nodeValue = text;
  },
  setElementText: (el, text) => {
    el.textContent = text;
  },
  parentNode: (node) => node.parentNode,
  nextSibling: (node) => node.nextSibling,
  querySelector: (selector) => doc.querySelector(selector),
  setScopeId(el, id) {
    el.setAttribute(id, "");
  },
  // __UNSAFE__
  // Reason: innerHTML.
  // Static content here can only come from compiled templates.
  // As long as the user only uses trusted templates, this is safe.
  insertStaticContent(content, parent, anchor, namespace, start, end) {
    const before = anchor ? anchor.previousSibling : parent.lastChild;
    if (start && (start === end || start.nextSibling)) {
      while (true) {
        parent.insertBefore(start.cloneNode(true), anchor);
        if (start === end || !(start = start.nextSibling)) break;
      }
    } else {
      templateContainer.innerHTML = unsafeToTrustedHTML(
        namespace === "svg" ? `<svg>${content}</svg>` : namespace === "mathml" ? `<math>${content}</math>` : content
      );
      const template = templateContainer.content;
      if (namespace === "svg" || namespace === "mathml") {
        const wrapper = template.firstChild;
        while (wrapper.firstChild) {
          template.appendChild(wrapper.firstChild);
        }
        template.removeChild(wrapper);
      }
      parent.insertBefore(template, anchor);
    }
    return [
      // first
      before ? before.nextSibling : parent.firstChild,
      // last
      anchor ? anchor.previousSibling : parent.lastChild
    ];
  }
};
const vtcKey = /* @__PURE__ */ Symbol("_vtc");
function patchClass(el, value, isSVG) {
  const transitionClasses = el[vtcKey];
  if (transitionClasses) {
    value = (value ? [value, ...transitionClasses] : [...transitionClasses]).join(" ");
  }
  if (value == null) {
    el.removeAttribute("class");
  } else if (isSVG) {
    el.setAttribute("class", value);
  } else {
    el.className = value;
  }
}
const vShowOriginalDisplay = /* @__PURE__ */ Symbol("_vod");
const vShowHidden = /* @__PURE__ */ Symbol("_vsh");
const CSS_VAR_TEXT = /* @__PURE__ */ Symbol("");
const displayRE = /(?:^|;)\s*display\s*:/;
function patchStyle(el, prev, next) {
  const style = el.style;
  const isCssString = isString(next);
  let hasControlledDisplay = false;
  if (next && !isCssString) {
    if (prev) {
      if (!isString(prev)) {
        for (const key in prev) {
          if (next[key] == null) {
            setStyle(style, key, "");
          }
        }
      } else {
        for (const prevStyle of prev.split(";")) {
          const key = prevStyle.slice(0, prevStyle.indexOf(":")).trim();
          if (next[key] == null) {
            setStyle(style, key, "");
          }
        }
      }
    }
    for (const key in next) {
      if (key === "display") {
        hasControlledDisplay = true;
      }
      const value = next[key];
      if (value != null) {
        if (!shouldPreserveTextareaResizeStyle(
          el,
          key,
          !isString(prev) && prev ? prev[key] : void 0,
          value
        )) {
          setStyle(style, key, value);
        }
      } else {
        setStyle(style, key, "");
      }
    }
  } else {
    if (isCssString) {
      if (prev !== next) {
        const cssVarText = style[CSS_VAR_TEXT];
        if (cssVarText) {
          next += ";" + cssVarText;
        }
        style.cssText = next;
        hasControlledDisplay = displayRE.test(next);
      }
    } else if (prev) {
      el.removeAttribute("style");
    }
  }
  if (vShowOriginalDisplay in el) {
    el[vShowOriginalDisplay] = hasControlledDisplay ? style.display : "";
    if (el[vShowHidden]) {
      style.display = "none";
    }
  }
}
const importantRE = /\s*!important$/;
function setStyle(style, name, val) {
  if (isArray(val)) {
    val.forEach((v) => setStyle(style, name, v));
  } else {
    if (val == null) val = "";
    if (name.startsWith("--")) {
      if (importantRE.test(val)) {
        style.setProperty(name, val.replace(importantRE, ""), "important");
      } else {
        style.setProperty(name, val);
      }
    } else {
      const prefixed = autoPrefix(style, name);
      if (importantRE.test(val)) {
        style.setProperty(
          hyphenate(prefixed),
          val.replace(importantRE, ""),
          "important"
        );
      } else {
        style[prefixed] = val;
      }
    }
  }
}
const prefixes = ["Webkit", "Moz", "ms"];
const prefixCache = {};
function autoPrefix(style, rawName) {
  const cached = prefixCache[rawName];
  if (cached) {
    return cached;
  }
  let name = camelize(rawName);
  if (name !== "filter" && name in style) {
    return prefixCache[rawName] = name;
  }
  name = capitalize(name);
  for (let i = 0; i < prefixes.length; i++) {
    const prefixed = prefixes[i] + name;
    if (prefixed in style) {
      return prefixCache[rawName] = prefixed;
    }
  }
  return rawName;
}
function shouldPreserveTextareaResizeStyle(el, key, prev, next) {
  return el.tagName === "TEXTAREA" && (key === "width" || key === "height") && isString(next) && prev === next;
}
const xlinkNS = "http://www.w3.org/1999/xlink";
function patchAttr(el, key, value, isSVG, instance, isBoolean = isSpecialBooleanAttr(key)) {
  if (isSVG && key.startsWith("xlink:")) {
    if (value == null) {
      el.removeAttributeNS(xlinkNS, key.slice(6, key.length));
    } else {
      el.setAttributeNS(xlinkNS, key, value);
    }
  } else {
    if (value == null || isBoolean && !includeBooleanAttr(value)) {
      el.removeAttribute(key);
    } else {
      el.setAttribute(
        key,
        isBoolean ? "" : isSymbol(value) ? String(value) : value
      );
    }
  }
}
function patchDOMProp(el, key, value, parentComponent, attrName) {
  if (key === "innerHTML" || key === "textContent") {
    if (value != null) {
      el[key] = key === "innerHTML" ? unsafeToTrustedHTML(value) : value;
    }
    return;
  }
  const tag = el.tagName;
  if (key === "value" && tag !== "PROGRESS" && // custom elements may use _value internally
  !tag.includes("-")) {
    const oldValue = tag === "OPTION" ? el.getAttribute("value") || "" : el.value;
    const newValue = value == null ? (
      // #11647: value should be set as empty string for null and undefined,
      // but <input type="checkbox"> should be set as 'on'.
      el.type === "checkbox" ? "on" : ""
    ) : String(value);
    if (oldValue !== newValue || !("_value" in el)) {
      el.value = newValue;
    }
    if (value == null) {
      el.removeAttribute(key);
    }
    el._value = value;
    return;
  }
  let needRemove = false;
  if (value === "" || value == null) {
    const type = typeof el[key];
    if (type === "boolean") {
      value = includeBooleanAttr(value);
    } else if (value == null && type === "string") {
      value = "";
      needRemove = true;
    } else if (type === "number") {
      value = 0;
      needRemove = true;
    }
  }
  try {
    el[key] = value;
  } catch (e) {
  }
  needRemove && el.removeAttribute(attrName || key);
}
function addEventListener(el, event, handler, options) {
  el.addEventListener(event, handler, options);
}
function removeEventListener(el, event, handler, options) {
  el.removeEventListener(event, handler, options);
}
const veiKey = /* @__PURE__ */ Symbol("_vei");
function patchEvent(el, rawName, prevValue, nextValue, instance = null) {
  const invokers = el[veiKey] || (el[veiKey] = {});
  const existingInvoker = invokers[rawName];
  if (nextValue && existingInvoker) {
    existingInvoker.value = nextValue;
  } else {
    const [name, options] = parseName(rawName);
    if (nextValue) {
      const invoker = invokers[rawName] = createInvoker(
        nextValue,
        instance
      );
      addEventListener(el, name, invoker, options);
    } else if (existingInvoker) {
      removeEventListener(el, name, existingInvoker, options);
      invokers[rawName] = void 0;
    }
  }
}
const optionsModifierRE = /(Once|Passive|Capture)$/;
const optionsModifierEventRE = /^on:?(?:Once|Passive|Capture)$/;
function parseName(name) {
  let options;
  let m;
  while ((m = name.match(optionsModifierRE)) && !optionsModifierEventRE.test(name)) {
    if (!options) options = {};
    name = name.slice(0, name.length - m[1].length);
    options[m[1].toLowerCase()] = true;
  }
  const event = name[2] === ":" ? name.slice(3) : hyphenate(name.slice(2));
  return [event, options];
}
let cachedNow = 0;
const p = /* @__PURE__ */ Promise.resolve();
const getNow = () => cachedNow || (p.then(() => cachedNow = 0), cachedNow = Date.now());
function createInvoker(initialValue, instance) {
  const invoker = (e) => {
    if (!e._vts) {
      e._vts = Date.now();
    } else if (e._vts <= invoker.attached) {
      return;
    }
    const value = invoker.value;
    if (isArray(value)) {
      const originalStop = e.stopImmediatePropagation;
      e.stopImmediatePropagation = () => {
        originalStop.call(e);
        e._stopped = true;
      };
      const handlers = value.slice();
      const args = [e];
      for (let i = 0; i < handlers.length; i++) {
        if (e._stopped) {
          break;
        }
        const handler = handlers[i];
        if (handler) {
          callWithAsyncErrorHandling(
            handler,
            instance,
            5,
            args
          );
        }
      }
    } else {
      callWithAsyncErrorHandling(
        value,
        instance,
        5,
        [e]
      );
    }
  };
  invoker.value = initialValue;
  invoker.attached = getNow();
  return invoker;
}
const isNativeOn = (key) => key.charCodeAt(0) === 111 && key.charCodeAt(1) === 110 && // lowercase letter
key.charCodeAt(2) > 96 && key.charCodeAt(2) < 123;
const patchProp = (el, key, prevValue, nextValue, namespace, parentComponent) => {
  const isSVG = namespace === "svg";
  if (key === "class") {
    patchClass(el, nextValue, isSVG);
  } else if (key === "style") {
    patchStyle(el, prevValue, nextValue);
  } else if (isOn(key)) {
    if (!isModelListener(key)) {
      patchEvent(el, key, prevValue, nextValue, parentComponent);
    }
  } else if (key[0] === "." ? (key = key.slice(1), true) : key[0] === "^" ? (key = key.slice(1), false) : shouldSetAsProp(el, key, nextValue, isSVG)) {
    patchDOMProp(el, key, nextValue);
    if (!el.tagName.includes("-") && (key === "value" || key === "checked" || key === "selected")) {
      patchAttr(el, key, nextValue, isSVG, parentComponent, key !== "value");
    }
  } else if (
    // #11081 force set props for possible async custom element
    el._isVueCE && // #12408 check if it's declared prop or it's async custom element
    (shouldSetAsPropForVueCE(el, key) || // @ts-expect-error _def is private
    el._def.__asyncLoader && (/[A-Z]/.test(key) || !isString(nextValue)))
  ) {
    patchDOMProp(el, camelize(key), nextValue, parentComponent, key);
  } else {
    if (key === "true-value") {
      el._trueValue = nextValue;
    } else if (key === "false-value") {
      el._falseValue = nextValue;
    }
    patchAttr(el, key, nextValue, isSVG);
  }
};
function shouldSetAsProp(el, key, value, isSVG) {
  if (isSVG) {
    if (key === "innerHTML" || key === "textContent") {
      return true;
    }
    if (key in el && isNativeOn(key) && isFunction(value)) {
      return true;
    }
    return false;
  }
  if (key === "spellcheck" || key === "draggable" || key === "translate" || key === "autocorrect") {
    return false;
  }
  if (key === "sandbox" && el.tagName === "IFRAME") {
    return false;
  }
  if (key === "form") {
    return false;
  }
  if (key === "list" && el.tagName === "INPUT") {
    return false;
  }
  if (key === "type" && el.tagName === "TEXTAREA") {
    return false;
  }
  if (key === "width" || key === "height") {
    const tag = el.tagName;
    if (tag === "IMG" || tag === "VIDEO" || tag === "CANVAS" || tag === "SOURCE") {
      return false;
    }
  }
  if (isNativeOn(key) && isString(value)) {
    return false;
  }
  return key in el;
}
function shouldSetAsPropForVueCE(el, key) {
  const props = (
    // @ts-expect-error _def is private
    el._def.props
  );
  if (!props) {
    return false;
  }
  const camelKey = camelize(key);
  return Array.isArray(props) ? props.some((prop) => camelize(prop) === camelKey) : Object.keys(props).some((prop) => camelize(prop) === camelKey);
}
const REMOVAL = {};
// @__NO_SIDE_EFFECTS__
function defineCustomElement(options, extraOptions, _createApp) {
  let Comp = /* @__PURE__ */ defineComponent(options, extraOptions);
  if (isPlainObject$1(Comp)) Comp = extend({}, Comp, extraOptions);
  class VueCustomElement extends VueElement {
    constructor(initialProps) {
      super(Comp, initialProps, _createApp);
    }
  }
  VueCustomElement.def = Comp;
  return VueCustomElement;
}
const BaseClass = typeof HTMLElement !== "undefined" ? HTMLElement : class {
};
class VueElement extends BaseClass {
  constructor(_def, _props = {}, _createApp = createApp) {
    super();
    this._def = _def;
    this._props = _props;
    this._createApp = _createApp;
    this._isVueCE = true;
    this._instance = null;
    this._app = null;
    this._nonce = this._def.nonce;
    this._connected = false;
    this._resolved = false;
    this._patching = false;
    this._dirty = false;
    this._numberProps = null;
    this._styleChildren = /* @__PURE__ */ new WeakSet();
    this._styleAnchors = /* @__PURE__ */ new WeakMap();
    this._ob = null;
    if (this.shadowRoot && _createApp !== createApp) {
      this._root = this.shadowRoot;
    } else {
      if (_def.shadowRoot !== false) {
        this.attachShadow(
          extend({}, _def.shadowRootOptions, {
            mode: "open"
          })
        );
        this._root = this.shadowRoot;
      } else {
        this._root = this;
      }
    }
  }
  connectedCallback() {
    if (!this.isConnected) return;
    if (!this.shadowRoot && !this._resolved) {
      this._parseSlots();
    }
    this._connected = true;
    let parent = this;
    while (parent = parent && // #12479 should check assignedSlot first to get correct parent
    (parent.assignedSlot || parent.parentNode || parent.host)) {
      if (parent instanceof VueElement) {
        this._parent = parent;
        break;
      }
    }
    if (!this._instance) {
      if (this._resolved) {
        this._mount(this._def);
      } else {
        if (parent && parent._pendingResolve) {
          this._pendingResolve = parent._pendingResolve.then(() => {
            this._pendingResolve = void 0;
            if (this.isConnected) {
              return this._resolveDef();
            }
          });
        } else {
          this._resolveDef();
        }
      }
    }
  }
  _setParent(parent = this._parent) {
    if (parent) {
      this._instance.parent = parent._instance;
      this._inheritParentContext(parent);
    }
  }
  _inheritParentContext(parent = this._parent) {
    if (parent && this._app) {
      Object.setPrototypeOf(
        this._app._context.provides,
        parent._instance.provides
      );
    }
  }
  disconnectedCallback() {
    this._connected = false;
    nextTick(() => {
      if (!this._connected) {
        if (this._ob) {
          this._ob.disconnect();
          this._ob = null;
        }
        this._app && this._app.unmount();
        if (this._instance) this._instance.ce = void 0;
        this._app = this._instance = null;
        if (this._teleportTargets) {
          this._teleportTargets.clear();
          this._teleportTargets = void 0;
        }
      }
    });
  }
  _processMutations(mutations) {
    for (const m of mutations) {
      this._setAttr(m.attributeName);
    }
  }
  /**
   * resolve inner component definition (handle possible async component)
   */
  _resolveDef() {
    if (this._pendingResolve) {
      return this._pendingResolve;
    }
    for (let i = 0; i < this.attributes.length; i++) {
      this._setAttr(this.attributes[i].name);
    }
    this._ob = new MutationObserver(this._processMutations.bind(this));
    this._ob.observe(this, { attributes: true });
    const resolve2 = (def2, isAsync = false) => {
      this._resolved = true;
      this._pendingResolve = void 0;
      const { props, styles } = def2;
      let numberProps;
      if (props && !isArray(props)) {
        for (const key in props) {
          const opt = props[key];
          if (opt === Number || opt && opt.type === Number) {
            if (key in this._props) {
              this._props[key] = toNumber(this._props[key]);
            }
            (numberProps || (numberProps = /* @__PURE__ */ Object.create(null)))[camelize(key)] = true;
          }
        }
      }
      this._numberProps = numberProps;
      this._resolveProps(def2);
      if (this.shadowRoot) {
        this._applyStyles(styles);
      }
      this._mount(def2);
    };
    const asyncDef = this._def.__asyncLoader;
    if (asyncDef) {
      this._pendingResolve = asyncDef().then((def2) => {
        def2.configureApp = this._def.configureApp;
        resolve2(this._def = def2, true);
      });
      return this._pendingResolve;
    } else {
      resolve2(this._def);
    }
  }
  _mount(def2) {
    this._app = this._createApp(def2);
    this._inheritParentContext();
    if (def2.configureApp) {
      def2.configureApp(this._app);
    }
    this._app._ceVNode = this._createVNode();
    this._app.mount(this._root);
    const exposed = this._instance && this._instance.exposed;
    if (!exposed) return;
    for (const key in exposed) {
      if (!hasOwn(this, key)) {
        Object.defineProperty(this, key, {
          // unwrap ref to be consistent with public instance behavior
          get: () => unref(exposed[key])
        });
      }
    }
  }
  _resolveProps(def2) {
    const { props } = def2;
    const declaredPropKeys = isArray(props) ? props : Object.keys(props || {});
    for (const key of Object.keys(this)) {
      if (key[0] !== "_" && declaredPropKeys.includes(key)) {
        this._setProp(key, this[key]);
      }
    }
    for (const key of declaredPropKeys.map(camelize)) {
      Object.defineProperty(this, key, {
        get() {
          return this._getProp(key);
        },
        set(val) {
          this._setProp(key, val, true, !this._patching);
        }
      });
    }
  }
  _setAttr(key) {
    if (key.startsWith("data-v-")) return;
    const has = this.hasAttribute(key);
    let value = has ? this.getAttribute(key) : REMOVAL;
    const camelKey = camelize(key);
    if (has && this._numberProps && this._numberProps[camelKey]) {
      value = toNumber(value);
    }
    this._setProp(camelKey, value, false, true);
  }
  /**
   * @internal
   */
  _getProp(key) {
    return this._props[key];
  }
  /**
   * @internal
   */
  _setProp(key, val, shouldReflect = true, shouldUpdate = false) {
    if (val !== this._props[key]) {
      this._dirty = true;
      if (val === REMOVAL) {
        delete this._props[key];
      } else {
        this._props[key] = val;
        if (key === "key" && this._app) {
          this._app._ceVNode.key = val;
        }
      }
      if (shouldUpdate && this._instance) {
        this._update();
      }
      if (shouldReflect) {
        const ob = this._ob;
        if (ob) {
          this._processMutations(ob.takeRecords());
          ob.disconnect();
        }
        if (val === true) {
          this.setAttribute(hyphenate(key), "");
        } else if (typeof val === "string" || typeof val === "number") {
          this.setAttribute(hyphenate(key), val + "");
        } else if (!val) {
          this.removeAttribute(hyphenate(key));
        }
        ob && ob.observe(this, { attributes: true });
      }
    }
  }
  _update() {
    const vnode = this._createVNode();
    if (this._app) vnode.appContext = this._app._context;
    render(vnode, this._root);
  }
  _createVNode() {
    const baseProps = {};
    if (!this.shadowRoot) {
      baseProps.onVnodeMounted = baseProps.onVnodeUpdated = this._renderSlots.bind(this);
    }
    const vnode = createVNode(this._def, extend(baseProps, this._props));
    if (!this._instance) {
      vnode.ce = (instance) => {
        this._instance = instance;
        instance.ce = this;
        instance.isCE = true;
        const dispatch = (event, args) => {
          this.dispatchEvent(
            new CustomEvent(
              event,
              isPlainObject$1(args[0]) ? extend({ detail: args }, args[0]) : { detail: args }
            )
          );
        };
        instance.emit = (event, ...args) => {
          dispatch(event, args);
          if (hyphenate(event) !== event) {
            dispatch(hyphenate(event), args);
          }
        };
        this._setParent();
      };
    }
    return vnode;
  }
  _applyStyles(styles, owner, parentComp) {
    if (!styles) return;
    if (owner) {
      if (owner === this._def || this._styleChildren.has(owner)) {
        return;
      }
      this._styleChildren.add(owner);
    }
    const nonce = this._nonce;
    const root = this.shadowRoot;
    const insertionAnchor = parentComp ? this._getStyleAnchor(parentComp) || this._getStyleAnchor(this._def) : this._getRootStyleInsertionAnchor(root);
    let last = null;
    for (let i = styles.length - 1; i >= 0; i--) {
      const s = document.createElement("style");
      if (nonce) s.setAttribute("nonce", nonce);
      s.textContent = styles[i];
      root.insertBefore(s, last || insertionAnchor);
      last = s;
      if (i === 0) {
        if (!parentComp) this._styleAnchors.set(this._def, s);
        if (owner) this._styleAnchors.set(owner, s);
      }
    }
  }
  _getStyleAnchor(comp) {
    if (!comp) {
      return null;
    }
    const anchor = this._styleAnchors.get(comp);
    if (anchor && anchor.parentNode === this.shadowRoot) {
      return anchor;
    }
    if (anchor) {
      this._styleAnchors.delete(comp);
    }
    return null;
  }
  _getRootStyleInsertionAnchor(root) {
    for (let i = 0; i < root.childNodes.length; i++) {
      const node = root.childNodes[i];
      if (!(node instanceof HTMLStyleElement)) {
        return node;
      }
    }
    return null;
  }
  /**
   * Only called when shadowRoot is false
   */
  _parseSlots() {
    const slots = this._slots = {};
    let n;
    while (n = this.firstChild) {
      const slotName = n.nodeType === 1 && n.getAttribute("slot") || "default";
      (slots[slotName] || (slots[slotName] = [])).push(n);
      this.removeChild(n);
    }
  }
  /**
   * Only called when shadowRoot is false
   */
  _renderSlots() {
    const outlets = this._getSlots();
    const scopeId = this._instance.type.__scopeId;
    for (let i = 0; i < outlets.length; i++) {
      const o = outlets[i];
      const slotName = o.getAttribute("name") || "default";
      const content = this._slots[slotName];
      const parent = o.parentNode;
      if (content) {
        for (const n of content) {
          if (scopeId && n.nodeType === 1) {
            const id = scopeId + "-s";
            const walker = document.createTreeWalker(n, 1);
            n.setAttribute(id, "");
            let child;
            while (child = walker.nextNode()) {
              child.setAttribute(id, "");
            }
          }
          parent.insertBefore(n, o);
        }
      } else {
        while (o.firstChild) parent.insertBefore(o.firstChild, o);
      }
      parent.removeChild(o);
    }
  }
  /**
   * @internal
   */
  _getSlots() {
    const roots = [this];
    if (this._teleportTargets) {
      roots.push(...this._teleportTargets);
    }
    const slots = /* @__PURE__ */ new Set();
    for (const root of roots) {
      const found = root.querySelectorAll("slot");
      for (let i = 0; i < found.length; i++) {
        slots.add(found[i]);
      }
    }
    return Array.from(slots);
  }
  /**
   * @internal
   */
  _injectChildStyle(comp, parentComp) {
    this._applyStyles(comp.styles, comp, parentComp);
  }
  /**
   * @internal
   */
  _beginPatch() {
    this._patching = true;
    this._dirty = false;
  }
  /**
   * @internal
   */
  _endPatch() {
    this._patching = false;
    if (this._dirty && this._instance) {
      this._update();
    }
  }
  /**
   * @internal
   */
  _hasShadowRoot() {
    return this._def.shadowRoot !== false;
  }
  /**
   * @internal
   */
  _removeChildStyle(comp) {
  }
}
const systemModifiers = ["ctrl", "shift", "alt", "meta"];
const modifierGuards = {
  stop: (e) => e.stopPropagation(),
  prevent: (e) => e.preventDefault(),
  self: (e) => e.target !== e.currentTarget,
  ctrl: (e) => !e.ctrlKey,
  shift: (e) => !e.shiftKey,
  alt: (e) => !e.altKey,
  meta: (e) => !e.metaKey,
  left: (e) => "button" in e && e.button !== 0,
  middle: (e) => "button" in e && e.button !== 1,
  right: (e) => "button" in e && e.button !== 2,
  exact: (e, modifiers) => systemModifiers.some((m) => e[`${m}Key`] && !modifiers.includes(m))
};
const withModifiers = (fn, modifiers) => {
  if (!fn) return fn;
  const cache = fn._withMods || (fn._withMods = {});
  const cacheKey = modifiers.join(".");
  return cache[cacheKey] || (cache[cacheKey] = ((event, ...args) => {
    for (let i = 0; i < modifiers.length; i++) {
      const guard = modifierGuards[modifiers[i]];
      if (guard && guard(event, modifiers)) return;
    }
    return fn(event, ...args);
  }));
};
const keyNames = {
  esc: "escape",
  space: " ",
  up: "arrow-up",
  left: "arrow-left",
  right: "arrow-right",
  down: "arrow-down",
  delete: "backspace"
};
const withKeys = (fn, modifiers) => {
  const cache = fn._withKeys || (fn._withKeys = {});
  const cacheKey = modifiers.join(".");
  return cache[cacheKey] || (cache[cacheKey] = ((event) => {
    if (!("key" in event)) {
      return;
    }
    const eventKey = hyphenate(event.key);
    if (modifiers.some(
      (k) => k === eventKey || keyNames[k] === eventKey
    )) {
      return fn(event);
    }
  }));
};
const rendererOptions = /* @__PURE__ */ extend({ patchProp }, nodeOps);
let renderer;
function ensureRenderer() {
  return renderer || (renderer = createRenderer(rendererOptions));
}
const render = ((...args) => {
  ensureRenderer().render(...args);
});
const createApp = ((...args) => {
  const app = ensureRenderer().createApp(...args);
  const { mount } = app;
  app.mount = (containerOrSelector) => {
    const container = normalizeContainer(containerOrSelector);
    if (!container) return;
    const component = app._component;
    if (!isFunction(component) && !component.render && !component.template) {
      component.template = container.innerHTML;
    }
    if (container.nodeType === 1) {
      container.textContent = "";
    }
    const proxy = mount(container, false, resolveRootNamespace(container));
    if (container instanceof Element) {
      container.removeAttribute("v-cloak");
      container.setAttribute("data-v-app", "");
    }
    return proxy;
  };
  return app;
});
function resolveRootNamespace(container) {
  if (container instanceof SVGElement) {
    return "svg";
  }
  if (typeof MathMLElement === "function" && container instanceof MathMLElement) {
    return "mathml";
  }
}
function normalizeContainer(container) {
  if (isString(container)) {
    const res = document.querySelector(container);
    return res;
  }
  return container;
}
let activePinia;
const setActivePinia = (pinia) => activePinia = pinia;
const piniaSymbol = (
  /* istanbul ignore next */
  /* @__PURE__ */ Symbol()
);
function isPlainObject(o) {
  return o && typeof o === "object" && Object.prototype.toString.call(o) === "[object Object]" && typeof o.toJSON !== "function";
}
var MutationType;
(function(MutationType2) {
  MutationType2["direct"] = "direct";
  MutationType2["patchObject"] = "patch object";
  MutationType2["patchFunction"] = "patch function";
})(MutationType || (MutationType = {}));
function createPinia() {
  const scope = effectScope(true);
  const state = scope.run(() => /* @__PURE__ */ ref({}));
  let _p = [];
  let toBeInstalled = [];
  const pinia = markRaw({
    install(app) {
      setActivePinia(pinia);
      pinia._a = app;
      app.provide(piniaSymbol, pinia);
      app.config.globalProperties.$pinia = pinia;
      toBeInstalled.forEach((plugin) => _p.push(plugin));
      toBeInstalled = [];
    },
    use(plugin) {
      if (!this._a) {
        toBeInstalled.push(plugin);
      } else {
        _p.push(plugin);
      }
      return this;
    },
    _p,
    // it's actually undefined here
    // @ts-expect-error
    _a: null,
    _e: scope,
    _s: /* @__PURE__ */ new Map(),
    state
  });
  return pinia;
}
const noop = () => {
};
function addSubscription(subscriptions, callback, detached, onCleanup = noop) {
  subscriptions.add(callback);
  const removeSubscription = () => {
    const isDel = subscriptions.delete(callback);
    isDel && onCleanup();
  };
  if (!detached && getCurrentScope()) {
    onScopeDispose(removeSubscription);
  }
  return removeSubscription;
}
function triggerSubscriptions(subscriptions, ...args) {
  subscriptions.forEach((callback) => {
    callback(...args);
  });
}
const fallbackRunWithContext = (fn) => fn();
const ACTION_MARKER = /* @__PURE__ */ Symbol();
const ACTION_NAME = /* @__PURE__ */ Symbol();
function mergeReactiveObjects(target, patchToApply) {
  if (target instanceof Map && patchToApply instanceof Map) {
    patchToApply.forEach((value, key) => target.set(key, value));
  } else if (target instanceof Set && patchToApply instanceof Set) {
    patchToApply.forEach(target.add, target);
  }
  for (const key in patchToApply) {
    if (!patchToApply.hasOwnProperty(key))
      continue;
    const subPatch = patchToApply[key];
    const targetValue = target[key];
    if (isPlainObject(targetValue) && isPlainObject(subPatch) && target.hasOwnProperty(key) && !/* @__PURE__ */ isRef(subPatch) && !/* @__PURE__ */ isReactive(subPatch)) {
      target[key] = mergeReactiveObjects(targetValue, subPatch);
    } else {
      target[key] = subPatch;
    }
  }
  return target;
}
const skipHydrateSymbol = (
  /* istanbul ignore next */
  /* @__PURE__ */ Symbol()
);
function shouldHydrate(obj) {
  return !isPlainObject(obj) || !Object.prototype.hasOwnProperty.call(obj, skipHydrateSymbol);
}
const { assign } = Object;
function isComputed(o) {
  return !!(/* @__PURE__ */ isRef(o) && o.effect);
}
function createOptionsStore(id, options, pinia, hot) {
  const { state, actions, getters } = options;
  const initialState = pinia.state.value[id];
  let store;
  function setup() {
    if (!initialState && true) {
      pinia.state.value[id] = state ? state() : {};
    }
    const localState = /* @__PURE__ */ toRefs(pinia.state.value[id]);
    return assign(localState, actions, Object.keys(getters || {}).reduce((computedGetters, name) => {
      computedGetters[name] = markRaw(computed(() => {
        setActivePinia(pinia);
        const store2 = pinia._s.get(id);
        return getters[name].call(store2, store2);
      }));
      return computedGetters;
    }, {}));
  }
  store = createSetupStore(id, setup, options, pinia, hot, true);
  return store;
}
function createSetupStore($id, setup, options = {}, pinia, hot, isOptionsStore) {
  let scope;
  const optionsForPlugin = assign({ actions: {} }, options);
  const $subscribeOptions = { deep: true };
  let isListening;
  let isSyncListening;
  let subscriptions = /* @__PURE__ */ new Set();
  let actionSubscriptions = /* @__PURE__ */ new Set();
  let debuggerEvents;
  const initialState = pinia.state.value[$id];
  if (!isOptionsStore && !initialState && true) {
    pinia.state.value[$id] = {};
  }
  let activeListener;
  function $patch(partialStateOrMutator) {
    let subscriptionMutation;
    isListening = isSyncListening = false;
    if (typeof partialStateOrMutator === "function") {
      partialStateOrMutator(pinia.state.value[$id]);
      subscriptionMutation = {
        type: MutationType.patchFunction,
        storeId: $id,
        events: debuggerEvents
      };
    } else {
      mergeReactiveObjects(pinia.state.value[$id], partialStateOrMutator);
      subscriptionMutation = {
        type: MutationType.patchObject,
        payload: partialStateOrMutator,
        storeId: $id,
        events: debuggerEvents
      };
    }
    const myListenerId = activeListener = /* @__PURE__ */ Symbol();
    nextTick().then(() => {
      if (activeListener === myListenerId) {
        isListening = true;
      }
    });
    isSyncListening = true;
    triggerSubscriptions(subscriptions, subscriptionMutation, pinia.state.value[$id]);
  }
  const $reset = isOptionsStore ? function $reset2() {
    const { state } = options;
    const newState = state ? state() : {};
    this.$patch(($state) => {
      assign($state, newState);
    });
  } : (
    /* istanbul ignore next */
    noop
  );
  function $dispose() {
    scope.stop();
    subscriptions.clear();
    actionSubscriptions.clear();
    pinia._s.delete($id);
  }
  const action = (fn, name = "") => {
    if (ACTION_MARKER in fn) {
      fn[ACTION_NAME] = name;
      return fn;
    }
    const wrappedAction = function() {
      setActivePinia(pinia);
      const args = Array.from(arguments);
      const afterCallbackSet = /* @__PURE__ */ new Set();
      const onErrorCallbackSet = /* @__PURE__ */ new Set();
      function after(callback) {
        afterCallbackSet.add(callback);
      }
      function onError(callback) {
        onErrorCallbackSet.add(callback);
      }
      triggerSubscriptions(actionSubscriptions, {
        args,
        name: wrappedAction[ACTION_NAME],
        store,
        after,
        onError
      });
      let ret;
      try {
        ret = fn.apply(this && this.$id === $id ? this : store, args);
      } catch (error) {
        triggerSubscriptions(onErrorCallbackSet, error);
        throw error;
      }
      if (ret instanceof Promise) {
        return ret.then((value) => {
          triggerSubscriptions(afterCallbackSet, value);
          return value;
        }).catch((error) => {
          triggerSubscriptions(onErrorCallbackSet, error);
          return Promise.reject(error);
        });
      }
      triggerSubscriptions(afterCallbackSet, ret);
      return ret;
    };
    wrappedAction[ACTION_MARKER] = true;
    wrappedAction[ACTION_NAME] = name;
    return wrappedAction;
  };
  const partialStore = {
    _p: pinia,
    // _s: scope,
    $id,
    $onAction: addSubscription.bind(null, actionSubscriptions),
    $patch,
    $reset,
    $subscribe(callback, options2 = {}) {
      const removeSubscription = addSubscription(subscriptions, callback, options2.detached, () => stopWatcher());
      const stopWatcher = scope.run(() => watch(() => pinia.state.value[$id], (state) => {
        if (options2.flush === "sync" ? isSyncListening : isListening) {
          callback({
            storeId: $id,
            type: MutationType.direct,
            events: debuggerEvents
          }, state);
        }
      }, assign({}, $subscribeOptions, options2)));
      return removeSubscription;
    },
    $dispose
  };
  const store = /* @__PURE__ */ reactive(partialStore);
  pinia._s.set($id, store);
  const runWithContext = pinia._a && pinia._a.runWithContext || fallbackRunWithContext;
  const setupStore = runWithContext(() => pinia._e.run(() => (scope = effectScope()).run(() => setup({ action }))));
  for (const key in setupStore) {
    const prop = setupStore[key];
    if (/* @__PURE__ */ isRef(prop) && !isComputed(prop) || /* @__PURE__ */ isReactive(prop)) {
      if (!isOptionsStore) {
        if (initialState && shouldHydrate(prop)) {
          if (/* @__PURE__ */ isRef(prop)) {
            prop.value = initialState[key];
          } else {
            mergeReactiveObjects(prop, initialState[key]);
          }
        }
        pinia.state.value[$id][key] = prop;
      }
    } else if (typeof prop === "function") {
      const actionValue = action(prop, key);
      setupStore[key] = actionValue;
      optionsForPlugin.actions[key] = prop;
    } else ;
  }
  assign(store, setupStore);
  assign(/* @__PURE__ */ toRaw(store), setupStore);
  Object.defineProperty(store, "$state", {
    get: () => pinia.state.value[$id],
    set: (state) => {
      $patch(($state) => {
        assign($state, state);
      });
    }
  });
  pinia._p.forEach((extender) => {
    {
      assign(store, scope.run(() => extender({
        store,
        app: pinia._a,
        pinia,
        options: optionsForPlugin
      })));
    }
  });
  if (initialState && isOptionsStore && options.hydrate) {
    options.hydrate(store.$state, initialState);
  }
  isListening = true;
  isSyncListening = true;
  return store;
}
// @__NO_SIDE_EFFECTS__
function defineStore(id, setup, setupOptions) {
  let options;
  const isSetupStore = typeof setup === "function";
  options = isSetupStore ? setupOptions : setup;
  function useStore(pinia, hot) {
    const hasContext = hasInjectionContext();
    pinia = // in test mode, ignore the argument provided as we can always retrieve a
    // pinia instance with getActivePinia()
    pinia || (hasContext ? inject(piniaSymbol, null) : null);
    if (pinia)
      setActivePinia(pinia);
    pinia = activePinia;
    if (!pinia._s.has(id)) {
      if (isSetupStore) {
        createSetupStore(id, setup, options, pinia);
      } else {
        createOptionsStore(id, options, pinia);
      }
    }
    const store = pinia._s.get(id);
    return store;
  }
  useStore.$id = id;
  return useStore;
}
const ASSISTANT_CATEGORY = "assistant";
const NEW_ASSISTANT_DRAFT_KEY = "__new__";
function assistantAgentType() {
  try {
    return getSdkConfig().agentType;
  } catch {
    return "ai_media";
  }
}
const PAGE_SIZE = 20;
function makeRuntime(conversation, drafts, runIds, toolExecutionMode) {
  const conversationId = conversation.conversationId;
  const knownRunId = runIds[conversationId];
  const lastSequence = 0;
  return {
    conversation,
    messages: [],
    pipeline: {
      ...createInitialPipelineState(),
      conversationId,
      runId: knownRunId,
      lastSequence
    },
    draft: drafts[conversationId] ?? "",
    status: conversation.status || "completed",
    statusConfirmed: !statusIsRunning(conversation.status),
    knownRunId,
    messagesLoaded: false,
    messagesLoading: false,
    reconnecting: false,
    unread: false,
    toolExecutionMode
  };
}
const ASSISTANT_STORAGE_SCHEMA_VERSION = 1;
let persistTimer = null;
function storageKey(userId) {
  let prefix = DEFAULT_STORAGE_PREFIX_FALLBACK;
  try {
    prefix = getSdkConfig().storagePrefix;
  } catch {
  }
  return `${prefix}:${userId}:v${ASSISTANT_STORAGE_SCHEMA_VERSION}`;
}
const DEFAULT_STORAGE_PREFIX_FALLBACK = "inneragent-assistant";
function isToolExecutionMode(value) {
  return value === "DEFAULT" || value === "ALWAYS_ASK" || value === "ALWAYS_ALLOW" || value === "FULL_ACCESS";
}
function safeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && entry.trim()) result[key] = entry;
  }
  return result;
}
function safeNumberRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry) && entry >= 0) {
      result[key] = Math.floor(entry);
    }
  }
  return result;
}
function safeToolExecutionModes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isToolExecutionMode(entry)) result[key] = entry;
  }
  return result;
}
function readRaw(userId) {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed;
    return value.schemaVersion === ASSISTANT_STORAGE_SCHEMA_VERSION ? value : {};
  } catch {
    return {};
  }
}
function defaultPersistedState(userId) {
  const value = readRaw(userId);
  return {
    schemaVersion: ASSISTANT_STORAGE_SCHEMA_VERSION,
    selectedConversationId: typeof value.selectedConversationId === "string" ? value.selectedConversationId : null,
    selectedModelId: typeof value.selectedModelId === "number" && Number.isSafeInteger(value.selectedModelId) ? value.selectedModelId : null,
    drafts: safeRecord(value.drafts),
    runIds: safeRecord(value.runIds),
    lastSequences: safeNumberRecord(value.lastSequences),
    toolExecutionModes: safeToolExecutionModes(value.toolExecutionModes),
    newToolExecutionMode: isToolExecutionMode(value.newToolExecutionMode) ? value.newToolExecutionMode : "DEFAULT"
  };
}
function clearAssistantPersistTimer() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
}
const expiringConfirmations = /* @__PURE__ */ new Set();
const connectionControllers = /* @__PURE__ */ new Map();
function initialConversationToolExecutionMode(modes, conversationId, preferredMode) {
  const persisted = modes[conversationId];
  return persisted === void 0 ? preferredMode : persisted;
}
function buildAutoReferences(referencedProjectId, conversationProjectId) {
  const pageRefs = getAssistantPageContext();
  if (!pageRefs.length) return void 0;
  const pageProjectId = pageRefs.find((ref2) => ref2.type === "project")?.id ?? null;
  const activeProjectId = referencedProjectId ?? conversationProjectId ?? pageProjectId;
  if (pageProjectId !== null && activeProjectId !== null && pageProjectId !== activeProjectId) {
    return [{ type: "project", id: activeProjectId }];
  }
  return pageRefs;
}
const useAssistantStore = /* @__PURE__ */ defineStore("assistant", () => {
  const hydratedUserId = /* @__PURE__ */ ref(null);
  const initialized = /* @__PURE__ */ ref(false);
  const open = /* @__PURE__ */ ref(false);
  const selectedConversationId = /* @__PURE__ */ ref(null);
  const selectedModelId = /* @__PURE__ */ ref(null);
  const conversations = /* @__PURE__ */ ref([]);
  const conversationStates = /* @__PURE__ */ ref({});
  const newDraft = /* @__PURE__ */ ref("");
  const newToolExecutionMode = /* @__PURE__ */ ref("DEFAULT");
  const drawerOpen = /* @__PURE__ */ ref(false);
  const conversationsLoading = /* @__PURE__ */ ref(false);
  const conversationsError = /* @__PURE__ */ ref(void 0);
  const hasMoreConversations = /* @__PURE__ */ ref(false);
  const conversationPage = /* @__PURE__ */ ref(0);
  const connection = /* @__PURE__ */ ref(null);
  const connectionGeneration = /* @__PURE__ */ ref(0);
  function writeAssistantPersisted() {
    if (typeof window === "undefined" || !hydratedUserId.value) return;
    const drafts = { __new__: newDraft.value };
    const runIds = {};
    const lastSequences = {};
    const toolExecutionModes = {};
    for (const [conversationId, runtime2] of Object.entries(conversationStates.value)) {
      toolExecutionModes[conversationId] = runtime2.toolExecutionMode;
      if (runtime2.draft) drafts[conversationId] = runtime2.draft;
      const advertisedRunId = runtime2.knownRunId || runtime2.pipeline.runId;
      if (advertisedRunId) runIds[conversationId] = advertisedRunId;
      const cursorRunId = runtime2.pipeline.runId;
      const cursor = Math.max(0, Math.floor(runtime2.pipeline.lastSequence));
      if (cursor > 0 && cursorRunId && cursorRunId === advertisedRunId) {
        lastSequences[conversationId] = cursor;
      }
    }
    const value = {
      schemaVersion: ASSISTANT_STORAGE_SCHEMA_VERSION,
      selectedConversationId: selectedConversationId.value,
      selectedModelId: selectedModelId.value,
      drafts,
      runIds,
      lastSequences,
      toolExecutionModes,
      newToolExecutionMode: newToolExecutionMode.value
    };
    try {
      localStorage.setItem(storageKey(hydratedUserId.value), JSON.stringify(value));
    } catch {
    }
  }
  function persist() {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      writeAssistantPersisted();
    }, 250);
  }
  function commitAssistantPersist() {
    writeAssistantPersisted();
  }
  function updateRuntime(conversationId, updater) {
    const runtime2 = conversationStates.value[conversationId];
    if (!runtime2) return;
    conversationStates.value = {
      ...conversationStates.value,
      [conversationId]: updater(runtime2)
    };
  }
  let pollTimer = null;
  let pollInFlightGeneration = null;
  let pollFailureCount = 0;
  let lifecycleGeneration = 0;
  let ensureGeneration = 0;
  let pendingEnsure = null;
  let ensureRetryTimer = null;
  const eventKeysByRun = /* @__PURE__ */ new Map();
  const metadataGenerations = /* @__PURE__ */ new Map();
  const beginMetadataRequest = (conversationId) => {
    const generation = (metadataGenerations.get(conversationId) ?? 0) + 1;
    metadataGenerations.set(conversationId, generation);
    return generation;
  };
  const invalidateMetadataRequests = (conversationId) => {
    metadataGenerations.set(
      conversationId,
      (metadataGenerations.get(conversationId) ?? 0) + 1
    );
  };
  const isCurrentMetadataRequest = (conversationId, generation) => metadataGenerations.get(conversationId) === generation;
  const invalidatePendingEnsure = () => {
    ensureGeneration += 1;
    pendingEnsure = null;
    if (ensureRetryTimer) clearTimeout(ensureRetryTimer);
    ensureRetryTimer = null;
  };
  const loadTerminalMessagesWithoutReplacingLiveTranscript = (conversationId) => {
    if (!open.value || selectedConversationId.value !== conversationId) return;
    const runtime2 = conversationStates.value[conversationId];
    if (!runtime2 || hasLiveTranscript(runtime2)) return;
    void loadMessagesIfNeeded(conversationId);
  };
  const REPLAY_MAX_ATTEMPTS = 5;
  const REPLAY_RETRY_COOLDOWN_MS = 4500;
  const replayAttempts = /* @__PURE__ */ new Map();
  const replayLastAttemptAt = /* @__PURE__ */ new Map();
  const CONNECT_FAILURE_LIMIT = REPLAY_MAX_ATTEMPTS;
  const reconnectFailures = /* @__PURE__ */ new Map();
  const pipelineReachedTerminal = (pipeline) => pipeline.status === "done" || pipeline.status === "error" || pipeline.status === "cancelled";
  const needsCompensatingReplay = (conversationId) => {
    const runtime2 = conversationStates.value[conversationId];
    if (!runtime2 || !hasLiveTranscript(runtime2)) return false;
    if (pipelineReachedTerminal(runtime2.pipeline)) return false;
    if (!(runtime2.pipeline.runId || runtime2.knownRunId)) return false;
    return open.value && selectedConversationId.value === conversationId;
  };
  const beginCompensatingReplay = (conversationId) => {
    const runtime2 = conversationStates.value[conversationId];
    const runId = runtime2?.pipeline.runId || runtime2?.knownRunId;
    if (!runtime2 || !runId) return false;
    if (connection.value?.conversationId === conversationId) return true;
    const now = Date.now();
    const lastAt = replayLastAttemptAt.get(conversationId);
    if (lastAt !== void 0 && now - lastAt < REPLAY_RETRY_COOLDOWN_MS) return true;
    if ((replayAttempts.get(conversationId) ?? 0) >= REPLAY_MAX_ATTEMPTS) return false;
    replayAttempts.set(conversationId, (replayAttempts.get(conversationId) ?? 0) + 1);
    replayLastAttemptAt.set(conversationId, now);
    const afterSequence = runtime2.pipeline.runId === runId ? runtime2.pipeline.lastSequence : 0;
    connect(conversationId, "reconnect", void 0, runId, afterSequence);
    return true;
  };
  const resetCompensatingReplay = (conversationId) => {
    replayAttempts.delete(conversationId);
    replayLastAttemptAt.delete(conversationId);
  };
  const markConnectionRestored = (conversationId) => {
    if (!reconnectFailures.delete(conversationId)) return;
    updateRuntime(conversationId, (runtimeValue) => ({ ...runtimeValue, reconnecting: false }));
  };
  const scheduleEnsureRetry = (delay = 5e3) => {
    if (ensureRetryTimer) return;
    const generation = ensureGeneration;
    ensureRetryTimer = setTimeout(() => {
      ensureRetryTimer = null;
      if (generation === ensureGeneration) ensureContentConnection();
    }, delay);
  };
  const invalidateConnection = () => {
    invalidatePendingEnsure();
    const current = connection.value;
    if (current) connectionControllers.get(current.connectionGeneration)?.abort();
    const nextGeneration = connectionGeneration.value + 1;
    connection.value = null;
    connectionGeneration.value = nextGeneration;
    scheduleStatusPolling();
    return nextGeneration;
  };
  const clearConnection = (generation) => {
    const current = connection.value;
    if (!current || current.connectionGeneration !== generation) return;
    connection.value = null;
    connectionGeneration.value = generation + 1;
  };
  const clearPolling = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  };
  const pollingCandidates = () => {
    const activeConversationId = connection.value?.conversationId;
    return conversations.value.filter((conversation) => {
      if (conversation.conversationId === activeConversationId) return false;
      if (conversation.conversationId === pendingEnsure?.conversationId) return false;
      const runtime2 = conversationStates.value[conversation.conversationId];
      return statusIsRunning(runtime2?.status ?? conversation.status);
    });
  };
  const applyPolledStatus = (conversationId, response, requestGeneration, metadataGeneration, expectedRunId) => {
    if (requestGeneration !== lifecycleGeneration || !isCurrentMetadataRequest(conversationId, metadataGeneration)) return;
    const nextStatus = statusFromPipeline(response.status);
    const terminal = !statusIsRunning(nextStatus);
    let applied = false;
    const runtime2 = conversationStates.value[conversationId];
    if (runtime2 && connection.value?.conversationId !== conversationId && isCurrentMetadataRequest(conversationId, metadataGeneration)) {
      if (!(expectedRunId && runtime2.statusConfirmed && statusIsRunning(runtime2.status) && runtime2.knownRunId !== expectedRunId)) {
        if (terminal && needsCompensatingReplay(conversationId) && beginCompensatingReplay(conversationId)) return;
        const runChanged = !!runtime2.knownRunId && !!response.runId && runtime2.knownRunId !== response.runId;
        const nextConversation = { ...runtime2.conversation, status: nextStatus };
        applied = true;
        conversations.value = conversations.value.map((item) => item.conversationId === conversationId ? nextConversation : item);
        updateRuntime(conversationId, () => ({
          ...runtime2,
          conversation: nextConversation,
          status: nextStatus,
          statusConfirmed: true,
          knownRunId: response.runId || runtime2.knownRunId,
          remoteLastSequence: response.lastSequence,
          connectionError: terminal ? void 0 : runtime2.connectionError,
          // [P1 #5] 服务端终态落地 → 重连提示态一并清除
          reconnecting: terminal ? false : runtime2.reconnecting,
          // A background completion makes the persisted transcript stale,
          // but it still must not trigger a content request while closed.
          messagesLoaded: terminal || runChanged ? false : runtime2.messagesLoaded,
          unread: terminal && (!open.value || selectedConversationId.value !== conversationId) ? true : runtime2.unread
        }));
      }
    }
    if (!applied) return;
    if (terminal) {
      resetCompensatingReplay(conversationId);
      loadTerminalMessagesWithoutReplacingLiveTranscript(conversationId);
    }
  };
  const scheduleStatusPolling = () => {
    if (pollTimer || pollInFlightGeneration !== null || pollingCandidates().length === 0) return;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    const baseDelay = hidden ? 5e3 : 1e3;
    const backoff = Math.min(5e3, baseDelay * 2 ** pollFailureCount);
    const delay = hidden ? Math.max(5e3, backoff) : backoff;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void pollStatuses();
    }, delay);
  };
  const pollStatuses = async () => {
    if (pollInFlightGeneration !== null) return;
    const requestGeneration = lifecycleGeneration;
    const candidates = pollingCandidates().map((conversation) => ({
      conversation,
      expectedRunId: conversationStates.value[conversation.conversationId]?.knownRunId,
      metadataGeneration: beginMetadataRequest(conversation.conversationId)
    }));
    if (candidates.length === 0) {
      clearPolling();
      return;
    }
    pollInFlightGeneration = requestGeneration;
    let failures = 0;
    try {
      await Promise.all(candidates.map(async ({
        conversation,
        expectedRunId,
        metadataGeneration
      }) => {
        try {
          const response = await getRunStatus({ conversationId: conversation.conversationId });
          applyPolledStatus(
            conversation.conversationId,
            response,
            requestGeneration,
            metadataGeneration,
            expectedRunId
          );
        } catch {
          failures += 1;
        }
      }));
    } finally {
      if (requestGeneration !== lifecycleGeneration || pollInFlightGeneration !== requestGeneration) return;
      pollInFlightGeneration = null;
      pollFailureCount = failures === candidates.length ? Math.min(pollFailureCount + 1, 4) : 0;
      if (pollingCandidates().length > 0) scheduleStatusPolling();
      else clearPolling();
    }
  };
  const alignCursorWithRun = (conversationId, runId) => {
    let afterSequence = 0;
    const runtime2 = conversationStates.value[conversationId];
    if (runtime2) {
      const sameRun = runtime2.pipeline.runId === runId;
      afterSequence = sameRun ? runtime2.pipeline.lastSequence : 0;
      const cursorUnchanged = sameRun && afterSequence === runtime2.pipeline.lastSequence;
      if (!cursorUnchanged) {
        updateRuntime(conversationId, (current) => ({
          ...current,
          knownRunId: runId,
          pipeline: {
            ...current.pipeline,
            runId,
            conversationId,
            lastSequence: afterSequence,
            reasoningText: "",
            reasoningStartTime: void 0,
            reasoningDurationMs: void 0,
            error: void 0
          }
        }));
      } else {
        updateRuntime(conversationId, (current) => ({ ...current, knownRunId: runId }));
      }
    }
    return afterSequence;
  };
  const connect = (conversationId, connectionMode, request2, reconnectRunId, reconnectAfterSequence = 0) => {
    if (!open.value || selectedConversationId.value !== conversationId) return;
    const runtime2 = conversationStates.value[conversationId];
    if (!runtime2 || !statusIsRunning(runtime2.status)) return;
    if (connection.value?.conversationId === conversationId) return;
    if (connectionMode === "reconnect" && !reconnectRunId) return;
    const generation = invalidateConnection();
    invalidateMetadataRequests(conversationId);
    updateRuntime(conversationId, (runtimeValue) => ({
      ...runtimeValue,
      connectionError: void 0
    }));
    const callbacks = {
      onEvent: (event) => {
        const current = connection.value;
        if (!current || current.connectionGeneration !== generation || current.conversationId !== conversationId) return;
        if (current.runId && event.runId !== current.runId) return;
        invalidateMetadataRequests(conversationId);
        const runKey = `${conversationId}:${event.runId}`;
        const eventSet = eventKeysByRun.get(runKey) ?? /* @__PURE__ */ new Set();
        eventKeysByRun.set(runKey, eventSet);
        const eventKey = `${event.sequence}:${event.messageId ?? event.outputType}`;
        if (eventSet.has(eventKey)) return;
        eventSet.add(eventKey);
        const currentRuntime = conversationStates.value[conversationId];
        if (!currentRuntime || currentRuntime.pipeline.runId && currentRuntime.pipeline.runId !== event.runId || event.sequence <= currentRuntime.pipeline.lastSequence) return;
        markConnectionRestored(conversationId);
        try {
          const nextPipeline = reduceAssistantEvent(currentRuntime.pipeline, event);
          const terminal = hasTerminal(event);
          const nextStatus = terminal ? terminalStatusForEvent(event) : currentRuntime.status === "CANCEL_REQUESTED" ? "CANCEL_REQUESTED" : event.outputType === "USER_CONFIRMATION_REQUIRED" ? "WAITING_CONFIRMATION" : event.outputType === "EXTERNAL_EXECUTION_REQUIRED" ? "WAITING_EXTERNAL" : "running";
          if (event.outputType === "TOOL_FINISHED" && event.toolName && event.toolStatus !== "error") {
            assistantEventHooks.onToolFinished(event.toolName);
          } else if (terminal) {
            assistantEventHooks.onRunTerminal();
          }
          updateRuntime(conversationId, (runtimeValue) => ({
            ...runtimeValue,
            pipeline: {
              ...nextPipeline,
              runId: event.runId,
              conversationId,
              lastSequence: event.sequence
            },
            status: nextStatus,
            statusConfirmed: true,
            knownRunId: event.runId,
            remoteLastSequence: Math.max(runtimeValue.remoteLastSequence ?? 0, event.sequence),
            connectionError: void 0,
            messagesLoaded: terminal ? false : runtimeValue.messagesLoaded,
            conversation: { ...runtimeValue.conversation, status: nextStatus },
            unread: terminal && (!open.value || selectedConversationId.value !== conversationId)
          }));
          if (terminal) resetCompensatingReplay(conversationId);
          const indexedConversation = conversations.value.find(
            (item) => item.conversationId === conversationId
          );
          if (indexedConversation && indexedConversation.status !== nextStatus) {
            conversations.value = conversations.value.map((item) => item.conversationId === conversationId ? { ...item, status: nextStatus } : item);
          }
          if (connection.value?.connectionGeneration === generation) {
            connection.value = { ...connection.value, runId: event.runId };
          }
        } catch (error) {
          updateRuntime(conversationId, (runtimeValue) => ({
            ...runtimeValue,
            connectionError: error instanceof Error ? error.message : "无法处理助手事件"
          }));
        }
      },
      onError: (error) => {
        const current = connection.value;
        if (!current || current.connectionGeneration !== generation || current.conversationId !== conversationId) return;
        const startRejected = current.connectionMode === "start" && !current.runId;
        if (startRejected) {
          updateRuntime(conversationId, (runtimeValue) => ({
            ...runtimeValue,
            reconnecting: false,
            connectionError: error.message,
            status: "failed",
            statusConfirmed: true,
            conversation: { ...runtimeValue.conversation, status: "failed" }
          }));
          conversations.value = conversations.value.map((conversation) => conversation.conversationId === conversationId ? { ...conversation, status: "failed" } : conversation);
          clearConnection(generation);
          return;
        }
        const failures = (reconnectFailures.get(conversationId) ?? 0) + 1;
        reconnectFailures.set(conversationId, failures);
        const exhausted = failures >= CONNECT_FAILURE_LIMIT;
        updateRuntime(conversationId, (runtimeValue) => ({
          ...runtimeValue,
          reconnecting: !exhausted,
          connectionError: exhausted ? `连接中断，自动重连未成功：${error.message}` : void 0
        }));
        clearConnection(generation);
        if (!exhausted) scheduleEnsureRetry();
        scheduleStatusPolling();
      },
      onComplete: () => {
        const current = connection.value;
        if (!current || current.connectionGeneration !== generation || current.conversationId !== conversationId) return;
        clearConnection(generation);
        const latestRuntime = conversationStates.value[conversationId];
        if (latestRuntime && !statusIsRunning(latestRuntime.status)) {
          loadTerminalMessagesWithoutReplacingLiveTranscript(conversationId);
        }
        scheduleStatusPolling();
      }
    };
    let controller;
    try {
      if (connectionMode === "start") {
        if (!request2) throw new Error("缺少助手请求");
        controller = startRunStream(request2, callbacks);
      } else {
        controller = reconnectRunStream(
          reconnectRunId ?? "",
          reconnectAfterSequence,
          callbacks
        );
      }
    } catch (error) {
      updateRuntime(conversationId, (runtimeValue) => ({
        ...runtimeValue,
        connectionError: error instanceof Error ? error.message : "无法连接助手"
      }));
      scheduleEnsureRetry();
      scheduleStatusPolling();
      return;
    }
    connectionControllers.set(generation, controller);
    connection.value = {
      conversationId,
      runId: reconnectRunId,
      connectionGeneration: generation,
      connectionMode
    };
  };
  const confirmStatusAndReconnect = (conversationId) => {
    if (pendingEnsure?.conversationId === conversationId) return;
    const generation = ++ensureGeneration;
    const requestConnectionGeneration = connectionGeneration.value;
    const metadataGeneration = beginMetadataRequest(conversationId);
    pendingEnsure = { conversationId, generation };
    void getRunStatus({ conversationId }).then((response) => {
      if (generation !== ensureGeneration || connectionGeneration.value !== requestConnectionGeneration || !isCurrentMetadataRequest(conversationId, metadataGeneration)) return;
      const nextStatus = statusFromPipeline(response.status);
      const runtime2 = conversationStates.value[conversationId];
      if (runtime2 && !statusIsRunning(nextStatus) && needsCompensatingReplay(conversationId) && beginCompensatingReplay(conversationId)) {
        scheduleStatusPolling();
        return;
      }
      if (runtime2 && connectionGeneration.value === requestConnectionGeneration && isCurrentMetadataRequest(conversationId, metadataGeneration)) {
        const nextConversation = { ...runtime2.conversation, status: nextStatus };
        conversations.value = conversations.value.map((item) => item.conversationId === conversationId ? nextConversation : item);
        updateRuntime(conversationId, () => ({
          ...runtime2,
          conversation: nextConversation,
          status: nextStatus,
          statusConfirmed: true,
          knownRunId: response.runId,
          remoteLastSequence: response.lastSequence,
          connectionError: statusIsRunning(nextStatus) ? runtime2.connectionError : void 0,
          reconnecting: statusIsRunning(nextStatus) ? runtime2.reconnecting : false,
          messagesLoaded: statusIsRunning(nextStatus) ? runtime2.messagesLoaded : false
        }));
      }
      if (!statusIsRunning(nextStatus)) {
        loadTerminalMessagesWithoutReplacingLiveTranscript(conversationId);
        scheduleStatusPolling();
        return;
      }
      if (!open.value || selectedConversationId.value !== conversationId || connection.value || !response.runId) {
        scheduleStatusPolling();
        return;
      }
      const afterSequence = alignCursorWithRun(conversationId, response.runId);
      connect(conversationId, "reconnect", void 0, response.runId, afterSequence);
    }).catch(() => {
      if (generation === ensureGeneration) scheduleEnsureRetry();
      scheduleStatusPolling();
    }).finally(() => {
      if (pendingEnsure?.generation === generation) pendingEnsure = null;
    });
  };
  const ensureContentConnection = () => {
    const conversationId = selectedConversationId.value;
    if (!open.value || !conversationId) {
      scheduleStatusPolling();
      return;
    }
    const runtime2 = conversationStates.value[conversationId];
    if (!runtime2 || !statusIsRunning(runtime2.status)) {
      scheduleStatusPolling();
      return;
    }
    if (connection.value?.conversationId === conversationId) return;
    void loadMessagesIfNeeded(conversationId);
    if (!runtime2.statusConfirmed || !runtime2.knownRunId) {
      confirmStatusAndReconnect(conversationId);
      return;
    }
    if (needsCompensatingReplay(conversationId)) {
      if (beginCompensatingReplay(conversationId)) return;
      scheduleStatusPolling();
      return;
    }
    const afterSequence = alignCursorWithRun(conversationId, runtime2.knownRunId);
    connect(conversationId, "reconnect", void 0, runtime2.knownRunId, afterSequence);
  };
  const resetCoordinator = () => {
    lifecycleGeneration += 1;
    invalidateConnection();
    clearPolling();
    pollInFlightGeneration = null;
    pollFailureCount = 0;
    eventKeysByRun.clear();
    metadataGenerations.clear();
    replayAttempts.clear();
    replayLastAttemptAt.clear();
    reconnectFailures.clear();
  };
  async function respondToToolConfirmations(target) {
    const conversationId = selectedConversationId.value;
    if (!conversationId) {
      throw new Error("Tool confirmation requires a selected conversation");
    }
    const runtime2 = conversationStates.value[conversationId];
    if (!runtime2) {
      throw new Error(`Missing assistant runtime for ${conversationId}`);
    }
    const pending = runtime2.pipeline.pendingConfirmation;
    if (!pending) {
      throw new Error(`Conversation ${conversationId} has no pending tool confirmation`);
    }
    if (pending.submitting) {
      throw new Error(`Conversation ${conversationId} is submitting tool decisions`);
    }
    const expiresAt = Date.parse(pending.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      throw new Error("Tool confirmation expiry is invalid");
    }
    if (Date.now() >= expiresAt) {
      scheduleStatusPolling();
      return;
    }
    const pendingToolCalls = pending.toolCalls ?? [];
    const pendingIds = new Set(pendingToolCalls.map((toolCall) => toolCall.toolCallId));
    if (pendingIds.size !== pendingToolCalls.length) {
      throw new Error("Tool confirmation contains duplicate toolCallIds");
    }
    if (target.kind === "single" && !pendingIds.has(target.toolCallId)) {
      throw new Error(`Tool confirmation does not contain ${target.toolCallId}`);
    }
    const existingDecisionIds = Object.keys(pending.decisions);
    if (existingDecisionIds.some((decisionId) => !pendingIds.has(decisionId) || typeof pending.decisions[decisionId] !== "boolean")) {
      throw new Error("Pending tool confirmation contains invalid local decisions");
    }
    const decisionUpdates = target.kind === "all" ? Object.fromEntries(pendingToolCalls.map((toolCall) => [
      toolCall.toolCallId,
      target.approved
    ])) : { [target.toolCallId]: target.approved };
    const decisions = {
      ...pending.decisions,
      ...decisionUpdates
    };
    const submitting = Object.keys(decisions).length === pendingIds.size;
    const decisionsToSubmit = submitting ? pendingToolCalls.map((toolCall) => ({
      toolCallId: toolCall.toolCallId,
      approved: decisions[toolCall.toolCallId] ?? false
    })) : void 0;
    const pendingSnapshot = pending;
    updateRuntime(conversationId, (current) => {
      const currentPending = current.pipeline.pendingConfirmation;
      if (currentPending !== pendingSnapshot) {
        throw new Error("Pending tool confirmation changed before submission");
      }
      return {
        ...current,
        connectionError: void 0,
        pipeline: {
          ...current.pipeline,
          pendingConfirmation: {
            ...currentPending,
            decisions,
            submitting
          }
        }
      };
    });
    if (!decisionsToSubmit) return;
    try {
      await confirmRunTools({
        runId: pending.runId,
        replyId: pending.replyId,
        decisions: decisionsToSubmit
      });
      invalidateConnection();
      ensureContentConnection();
      scheduleStatusPolling();
    } catch (error) {
      const expired = Date.now() >= expiresAt;
      updateRuntime(conversationId, (current) => {
        const currentPending = current.pipeline.pendingConfirmation;
        if (!currentPending || currentPending.replyId !== pending.replyId || !currentPending.submitting) {
          throw new Error("Pending tool confirmation changed after submission failure");
        }
        return {
          ...current,
          connectionError: expired ? void 0 : error instanceof Error ? error.message : String(error),
          pipeline: {
            ...current.pipeline,
            pendingConfirmation: {
              ...currentPending,
              submitting: false
            }
          }
        };
      });
      if (expired) scheduleStatusPolling();
    }
  }
  function initializeForUser(userId) {
    if (typeof userId !== "number" && typeof userId !== "string") return;
    if (typeof userId === "number" && (!Number.isSafeInteger(userId) || userId <= 0)) return;
    if (typeof userId === "string" && !userId.trim()) return;
    if (initialized.value && hydratedUserId.value === userId) return;
    if (hydratedUserId.value) commitAssistantPersist();
    resetCoordinator();
    clearAssistantPersistTimer();
    const persisted = defaultPersistedState(userId);
    const drafts = persisted.drafts;
    const restoredSelectedConversationId = persisted.selectedConversationId;
    hydratedUserId.value = userId;
    initialized.value = true;
    selectedConversationId.value = null;
    selectedModelId.value = persisted.selectedModelId;
    conversations.value = [];
    conversationStates.value = {};
    newDraft.value = drafts[NEW_ASSISTANT_DRAFT_KEY] ?? "";
    newToolExecutionMode.value = persisted.newToolExecutionMode;
    drawerOpen.value = false;
    conversationsLoading.value = true;
    conversationsError.value = void 0;
    hasMoreConversations.value = false;
    conversationPage.value = 0;
    void listConversations({ pageNo: 1, pageSize: PAGE_SIZE, category: ASSISTANT_CATEGORY }).then((result) => {
      if (hydratedUserId.value !== userId) return;
      const filtered = result.list.filter((conversation) => !conversation.category || conversation.category === ASSISTANT_CATEGORY);
      const conversationStatesNext = {};
      for (const conversation of filtered) {
        conversationStatesNext[conversation.conversationId] = makeRuntime(
          conversation,
          drafts,
          persisted.runIds,
          initialConversationToolExecutionMode(
            persisted.toolExecutionModes,
            conversation.conversationId,
            persisted.newToolExecutionMode
          )
        );
      }
      const selected = restoredSelectedConversationId && conversationStatesNext[restoredSelectedConversationId] ? restoredSelectedConversationId : null;
      conversations.value = filtered;
      conversationStates.value = conversationStatesNext;
      selectedConversationId.value = selected;
      conversationsLoading.value = false;
      conversationPage.value = 1;
      hasMoreConversations.value = filtered.length < result.total;
      conversationsError.value = void 0;
      scheduleStatusPolling();
      const selectedId = selectedConversationId.value;
      if (open.value && selectedId) {
        void loadMessagesIfNeeded(selectedId);
        ensureContentConnection();
      }
    }).catch((error) => {
      if (hydratedUserId.value !== userId) return;
      conversationsLoading.value = false;
      conversationsError.value = error instanceof Error ? error.message : "加载助手会话失败";
    });
  }
  function resetForUser() {
    if (hydratedUserId.value) commitAssistantPersist();
    resetCoordinator();
    clearAssistantPersistTimer();
    hydratedUserId.value = null;
    initialized.value = false;
    open.value = false;
    selectedConversationId.value = null;
    selectedModelId.value = null;
    conversations.value = [];
    conversationStates.value = {};
    newDraft.value = "";
    newToolExecutionMode.value = "DEFAULT";
    drawerOpen.value = false;
    conversationsLoading.value = false;
    conversationsError.value = void 0;
    hasMoreConversations.value = false;
    conversationPage.value = 0;
    connection.value = null;
  }
  function loadMoreConversations() {
    if (conversationsLoading.value || !hasMoreConversations.value || !hydratedUserId.value) return;
    const page = conversationPage.value + 1;
    const userId = hydratedUserId.value;
    conversationsLoading.value = true;
    void listConversations({ pageNo: page, pageSize: PAGE_SIZE, category: ASSISTANT_CATEGORY }).then((result) => {
      if (hydratedUserId.value !== userId) return;
      const filtered = result.list.filter((conversation) => !conversation.category || conversation.category === ASSISTANT_CATEGORY);
      const merged = uniqueConversations(conversations.value, filtered);
      const persisted = defaultPersistedState(userId);
      const conversationStatesNext = { ...conversationStates.value };
      for (const conversation of filtered) {
        const existing = conversationStatesNext[conversation.conversationId];
        conversationStatesNext[conversation.conversationId] = existing ? {
          ...existing,
          conversation: { ...conversation, status: existing.status }
        } : makeRuntime(
          conversation,
          persisted.drafts,
          persisted.runIds,
          initialConversationToolExecutionMode(
            persisted.toolExecutionModes,
            conversation.conversationId,
            persisted.newToolExecutionMode
          )
        );
      }
      conversations.value = merged;
      conversationStates.value = conversationStatesNext;
      conversationsLoading.value = false;
      conversationPage.value = page;
      hasMoreConversations.value = merged.length < result.total;
      scheduleStatusPolling();
    }).catch((error) => {
      if (hydratedUserId.value !== userId) return;
      conversationsLoading.value = false;
      conversationsError.value = error instanceof Error ? error.message : "加载更多会话失败";
    });
  }
  function selectConversation(conversationId) {
    if (conversationId && !conversationStates.value[conversationId]) {
      throw new Error(`Cannot select conversation without runtime: ${conversationId}`);
    }
    if (selectedConversationId.value !== conversationId) {
      invalidateConnection();
    }
    if (!conversationId) {
      selectedConversationId.value = null;
      drawerOpen.value = false;
    } else {
      const runtime2 = conversationStates.value[conversationId];
      if (!runtime2) {
        throw new Error(`Conversation runtime disappeared during selection: ${conversationId}`);
      }
      selectedConversationId.value = conversationId;
      drawerOpen.value = false;
      updateRuntime(conversationId, (current) => ({ ...current, unread: false }));
    }
    persist();
    scheduleStatusPolling();
    if (conversationId && open.value) {
      void loadMessagesIfNeeded(conversationId);
      ensureContentConnection();
    }
  }
  function startNewConversation() {
    if (connection.value || selectedConversationId.value) invalidateConnection();
    selectedConversationId.value = null;
    drawerOpen.value = false;
    persist();
  }
  function setDraft(conversationId, draft) {
    if (!conversationId) newDraft.value = draft;
    else updateRuntime(conversationId, (runtime2) => ({ ...runtime2, draft }));
    persist();
  }
  function setSelectedModelId(modelId) {
    selectedModelId.value = modelId;
    persist();
  }
  function setToolExecutionMode(mode) {
    const conversationId = selectedConversationId.value;
    newToolExecutionMode.value = mode;
    if (conversationId) {
      updateRuntime(conversationId, (runtime2) => ({ ...runtime2, toolExecutionMode: mode }));
    }
    persist();
  }
  async function sendMessage(message, modelId, reasoningEffort, projectId, references) {
    const multimodalInputs = references?.multimodalInputs ?? [];
    const content = message.trim() || (multimodalInputs.length ? "请分析这些附件。" : "");
    if (!content) return;
    if (connection.value) throw new Error("当前会话仍在生成中");
    const previousSelectedId = selectedConversationId.value;
    let conversationId = previousSelectedId;
    const title = normalizeTitle(content);
    if (!conversationId) {
      conversationId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const conversation = {
        id: -Date.now(),
        conversationId,
        userId: 0,
        projectId: projectId ?? null,
        category: ASSISTANT_CATEGORY,
        title,
        messageCount: 0,
        status: "completed"
      };
      const runtime22 = {
        ...makeRuntime(conversation, {}, {}, newToolExecutionMode.value),
        // The optimistic conversation has no server history yet. Treat its
        // empty local transcript as loaded so connection recovery cannot
        // race the create request with a history lookup that must 404.
        messagesLoaded: true
      };
      conversations.value = [conversation, ...conversations.value];
      conversationStates.value = { ...conversationStates.value, [conversationId]: runtime22 };
      selectedConversationId.value = conversationId;
      newDraft.value = "";
    }
    const knownRuntime = conversationStates.value[conversationId];
    if (!knownRuntime) throw new Error("会话尚未准备好");
    if (previousSelectedId && statusIsRunning(knownRuntime.status)) {
      throw new Error("当前会话仍在生成中");
    }
    const shouldSetTitle = !previousSelectedId || knownRuntime.conversation.title === "新对话";
    let runtime2 = knownRuntime;
    if (runtime2.pipeline.timeline.length > 0 && !runtime2.messagesLoaded) {
      await loadMessagesIfNeeded(conversationId);
      runtime2 = conversationStates.value[conversationId] ?? runtime2;
    }
    const conversationProjectId = projectId !== void 0 ? projectId : runtime2.conversation.projectId ?? null;
    const activeContext = {
      // [adapt] 契约: 请求体增 context{page,object} (02-技术方案 §7.1)。
      // 宿主经 pageContext.setRunContext 注册; 未注册时字段缺省。
      ...getRunContext()
    };
    if (references?.mcpTools.length) {
      activeContext.activeMcpReferences = references.mcpTools.map((tool) => `${tool.serverName}/${tool.toolName}`).join("\n");
    }
    const serializedReferences = references && (conversationProjectId !== null || references.skills.length > 0 || references.mcpTools.length > 0 || multimodalInputs.length > 0) ? JSON.stringify({
      version: 2,
      projectId: conversationProjectId,
      project: references.project ?? null,
      skills: references.skills,
      mcpTools: references.mcpTools,
      attachments: multimodalInputs.map(({
        id,
        name,
        inputType,
        mimeType,
        transport,
        resourceUrl,
        size
      }) => ({
        id,
        name,
        inputType,
        mimeType,
        transport,
        resourceUrl,
        size
      }))
    }) : void 0;
    const optimisticMessage = {
      id: -Date.now(),
      conversationId,
      role: "user",
      content,
      referencesJson: serializedReferences,
      messageOrder: Math.max(0, ...runtime2.messages.map((item) => item.messageOrder ?? 0)) + 1
    };
    const pendingPipeline = {
      ...pendingPipelineForNextRun(conversationId),
      // Keep an already visible answer until the persisted projection is
      // available; new events append to this same reducer state.
      timeline: runtime2.messagesLoaded ? [] : runtime2.pipeline.timeline
    };
    const conversationTitle = runtime2.conversation.title === "新对话" ? title : runtime2.conversation.title;
    updateRuntime(conversationId, (current) => ({
      ...current,
      messages: [...current.messages, optimisticMessage],
      pipeline: pendingPipeline,
      status: "running",
      statusConfirmed: true,
      knownRunId: void 0,
      remoteLastSequence: 0,
      messagesError: void 0,
      connectionError: void 0,
      reconnecting: false,
      conversation: {
        ...current.conversation,
        status: "running",
        title: conversationTitle,
        projectId: conversationProjectId
      }
    }));
    reconnectFailures.delete(conversationId);
    conversations.value = conversations.value.map((item) => item.conversationId === conversationId ? { ...item, status: "running", title: conversationTitle, projectId: conversationProjectId } : item);
    persist();
    const request2 = {
      message: content,
      conversationId,
      modelId: modelId ?? void 0,
      reasoningEffort: reasoningEffort ?? void 0,
      agentType: assistantAgentType(),
      category: ASSISTANT_CATEGORY,
      title: shouldSetTitle ? title : void 0,
      projectId: conversationProjectId ?? void 0,
      context: Object.keys(activeContext).length ? activeContext : void 0,
      autoReferences: buildAutoReferences(
        projectId,
        conversationProjectId
      ),
      // [DEF-07] 空数组/未选择时不下发该字段(undefined → JSON 剔除): 服务端把
      // "enabledMcpTools":[] 视作「显式空白名单」过滤 → ia_tool_registry 注册
      // 工具在 UI 会话中全部不可达; 缺省(不传)才是「未指定 = 跟随授权目录」。
      // enabledSkills 同口径(服务端对 null/[] 语义一致, 见 resolveActiveSkills)。
      enabledSkills: references?.skills.length ? references.skills.map((skill) => skill.name) : void 0,
      enabledMcpTools: references?.mcpTools.length ? references.mcpTools.map((tool) => tool.toolName) : void 0,
      multimodalInputs,
      referencesJson: serializedReferences,
      toolExecutionMode: runtime2.toolExecutionMode
    };
    resetCompensatingReplay(conversationId);
    connect(conversationId, "start", request2);
    scheduleStatusPolling();
  }
  async function stopGeneration() {
    const conversationId = selectedConversationId.value;
    const runtime2 = conversationId ? conversationStates.value[conversationId] : void 0;
    const connectionRunId = connection.value?.conversationId === conversationId ? connection.value.runId : void 0;
    const runId = connectionRunId || runtime2?.pipeline.runId || runtime2?.knownRunId;
    if (!conversationId || !runtime2 || runtime2.status === "CANCEL_REQUESTED") return;
    const previousStatus = runtime2.status;
    const previousConversationStatus = runtime2.conversation.status;
    const previousPipelineStatus = runtime2.pipeline.status;
    const previousListStatus = conversations.value.find(
      (item) => item.conversationId === conversationId
    )?.status;
    updateRuntime(conversationId, (current) => ({
      ...current,
      status: "CANCEL_REQUESTED",
      connectionError: void 0,
      reconnecting: false,
      pipeline: {
        ...current.pipeline,
        status: "cancelling"
      },
      conversation: { ...current.conversation, status: "CANCEL_REQUESTED" }
    }));
    conversations.value = conversations.value.map((item) => item.conversationId === conversationId ? { ...item, status: "CANCEL_REQUESTED" } : item);
    try {
      await cancelRun(runId ? { runId } : { conversationId });
      scheduleStatusPolling();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      updateRuntime(conversationId, (current) => current.status === "CANCEL_REQUESTED" ? {
        ...current,
        status: previousStatus,
        connectionError: `取消请求失败：${errorMessage}`,
        pipeline: {
          ...current.pipeline,
          status: previousPipelineStatus
        },
        conversation: {
          ...current.conversation,
          status: previousConversationStatus
        }
      } : current);
      conversations.value = conversations.value.map((item) => item.conversationId === conversationId && item.status === "CANCEL_REQUESTED" ? { ...item, status: previousListStatus ?? previousStatus } : item);
      throw error;
    }
  }
  function respondToToolConfirmation(toolCallId, approved) {
    return respondToToolConfirmations({ kind: "single", toolCallId, approved });
  }
  function respondToAllToolConfirmations(approved) {
    return respondToToolConfirmations({ kind: "all", approved });
  }
  async function expireToolConfirmation() {
    const conversationId = selectedConversationId.value;
    if (!conversationId) return;
    const pending = conversationStates.value[conversationId]?.pipeline.pendingConfirmation;
    if (!pending) return;
    const expiresAt = Date.parse(pending.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      throw new Error("Tool confirmation expiry is invalid");
    }
    if (Date.now() < expiresAt) return;
    const requestKey = `${pending.runId}:${pending.replyId}`;
    if (expiringConfirmations.has(requestKey)) return;
    expiringConfirmations.add(requestKey);
    try {
      await expireRunConfirmation({
        runId: pending.runId,
        replyId: pending.replyId
      });
      invalidateConnection();
      ensureContentConnection();
    } catch (error) {
      console.warn("[Assistant] 审批超时状态同步失败", error);
    } finally {
      expiringConfirmations.delete(requestKey);
      scheduleStatusPolling();
    }
  }
  function markConversationRead(conversationId) {
    updateRuntime(conversationId, (runtime2) => ({ ...runtime2, unread: false }));
  }
  async function deleteConversation$1(conversationId, id) {
    const runtime2 = conversationStates.value[conversationId];
    if (runtime2 && statusIsRunning(runtime2.status)) throw new Error("运行中的会话不能删除");
    if (id < 0) {
      await deleteConversationByConversationId(conversationId);
    } else {
      await deleteConversation(id);
    }
    if (selectedConversationId.value === conversationId) invalidateConnection();
    const conversationStatesNext = { ...conversationStates.value };
    delete conversationStatesNext[conversationId];
    conversations.value = conversations.value.filter((item) => item.conversationId !== conversationId);
    conversationStates.value = conversationStatesNext;
    if (selectedConversationId.value === conversationId) selectedConversationId.value = null;
    persist();
  }
  function setOpen(next) {
    if (open.value === next) return;
    open.value = next;
    if (!next) {
      invalidateConnection();
      drawerOpen.value = false;
      scheduleStatusPolling();
      return;
    }
    drawerOpen.value = false;
    const selectedId = selectedConversationId.value;
    if (selectedId) {
      const runtime2 = conversationStates.value[selectedId];
      if (runtime2?.unread) updateRuntime(selectedId, (current) => ({ ...current, unread: false }));
      void loadMessagesIfNeeded(selectedId);
      ensureContentConnection();
    }
  }
  function setDrawerOpen(next) {
    drawerOpen.value = next;
  }
  async function loadMessagesIfNeeded(conversationId) {
    if (!conversationId) return;
    const userId = hydratedUserId.value;
    const runtime2 = conversationStates.value[conversationId];
    if (!runtime2 || runtime2.messagesLoaded || runtime2.messagesLoading) return;
    updateRuntime(conversationId, (current) => ({
      ...current,
      messagesLoading: true,
      messagesError: void 0
    }));
    try {
      const incoming = await listMessages(conversationId);
      if (hydratedUserId.value !== userId) return;
      const current = conversationStates.value[conversationId];
      if (!current) return;
      const messages = mergeMessages(current.messages, incoming);
      const shouldBuildTimeline = !connection.value && !statusIsRunning(current.status);
      conversationStates.value = {
        ...conversationStates.value,
        [conversationId]: {
          ...current,
          messages,
          messagesLoaded: true,
          messagesLoading: false,
          messagesError: void 0,
          pipeline: shouldBuildTimeline ? {
            ...current.pipeline,
            timeline: timelineForMessages(messages),
            conversationId
          } : current.pipeline
        }
      };
    } catch (error) {
      updateRuntime(conversationId, (current) => ({
        ...current,
        messagesLoading: false,
        messagesError: error instanceof Error ? error.message : "加载消息失败"
      }));
    }
  }
  return {
    // state
    hydratedUserId,
    initialized,
    open,
    selectedConversationId,
    selectedModelId,
    conversations,
    conversationStates,
    newDraft,
    newToolExecutionMode,
    drawerOpen,
    conversationsLoading,
    conversationsError,
    hasMoreConversations,
    conversationPage,
    connection,
    connectionGeneration,
    // actions
    initializeForUser,
    resetForUser,
    loadMoreConversations,
    selectConversation,
    startNewConversation,
    setDraft,
    setSelectedModelId,
    setToolExecutionMode,
    sendMessage,
    stopGeneration,
    respondToToolConfirmation,
    respondToAllToolConfirmations,
    expireToolConfirmation,
    markConversationRead,
    deleteConversation: deleteConversation$1,
    setOpen,
    setDrawerOpen,
    loadMessagesIfNeeded,
    ensureContentConnection
  };
});
const zhCN = {
  "assistant.title": "InnerAgent 助手",
  "assistant.subtitle": "你的协作助手",
  "assistant.conversations": "会话",
  "assistant.conversations-only": "仅显示助手对话",
  "assistant.new-conversation": "新建对话",
  "assistant.start-new": "开始新对话",
  "assistant.empty-conversations": "还没有助手会话",
  "assistant.media-download": "下载视频",
  "assistant.subagent-default": "子任务",
  "assistant.subagent-progress-doing": "已完成 {label}",
  "assistant.subagent-progress-ran": "已执行 {label} 步",
  "assistant.subagent-progress-done": "{label} 步",
  "assistant.status-running": "运行中",
  "assistant.status-completed": "已完成",
  "assistant.status-failed": "失败",
  "assistant.status-cancelled": "已取消",
  "assistant.status-cancelling": "取消中",
  "assistant.status-waiting-confirm": "待确认",
  "assistant.status-waiting-external": "等待执行",
  "assistant.unread": "未读",
  "assistant.delete-conversation": "删除会话",
  "assistant.delete-title": "删除这条会话？",
  "assistant.delete-desc": "“{title}”的消息记录会从当前账户移除，此操作无法撤销。",
  "assistant.delete-confirm": "删除",
  "assistant.cancel": "取消",
  "assistant.delete-failed": "删除失败",
  "assistant.running-delete-disabled": "运行中的会话不能删除",
  "assistant.time-now": "刚刚",
  "assistant.time-minutes-ago": "{n} 分钟前",
  "assistant.time-hours-ago": "{n} 小时前",
  "assistant.time-days-ago": "{n} 天前",
  "assistant.load-more": "加载更多",
  "assistant.loading": "加载中",
  "assistant.loading-messages": "加载消息",
  "assistant.empty-title": "今天想完成什么？",
  "assistant.empty-desc": "告诉助手你想完成什么，可以直接描述你的任务或提出问题。",
  "assistant.thinking": "正在思考…",
  "assistant.reconnecting": "连接中断，自动重连中…",
  "assistant.back-to-bottom": "回到底部",
  "assistant.input-placeholder": "发挥想象…（Enter 换行，Ctrl+Enter 发送）",
  "assistant.send": "发送",
  "assistant.stop": "停止",
  "assistant.stopping": "取消中…",
  "assistant.stop-failed": "停止失败",
  "assistant.model": "模型",
  "assistant.model-load-failed": "模型加载失败",
  "assistant.retry": "重试",
  "assistant.reasoning-effort": "推理力度",
  "assistant.tool-mode": "工具执行模式",
  "assistant.tool-mode-DEFAULT": "默认（按工具设定）",
  "assistant.tool-mode-ALWAYS_ASK": "每次询问",
  "assistant.tool-mode-ALWAYS_ALLOW": "总是允许",
  "assistant.tool-mode-FULL_ACCESS": "完全访问",
  "assistant.confirm-batch-title": "批量审批",
  "assistant.confirm-batch-expired": "审批时间已结束，系统将按未同意处理",
  "assistant.confirm-batch-submitting": "正在提交 {n} 个工具的审批决定",
  "assistant.confirm-batch-waiting": "{n} 个工具等待确认{selected} · 剩余 {time}",
  "assistant.confirm-batch-selected": "，已选择 {n}/{total}",
  "assistant.confirm-scope-degraded": "约束范围降级：未获取上下文提示，写操作将逐次确认",
  "assistant.confirm-scope-resolved": "约束范围：{summary}",
  "assistant.confirm-scope-resolved-default": "约束范围已注入本次运行",
  "assistant.confirm-reject-all": "全部拒绝",
  "assistant.confirm-approve-all": "全部允许",
  "assistant.confirm-approve": "允许",
  "assistant.confirm-reject": "拒绝",
  "assistant.tool-awaiting": "等待确认 · 剩余 {time}",
  "assistant.input-placeholder-hint": "发挥想象…\n使用 {'@'} 引用页面上下文，/ 引用 Skill",
  "assistant.send-failed": "发送失败，请重试",
  "assistant.reference-label": "引用",
  "assistant.reference-remove": "移除 {name}",
  "assistant.reference-project-fallback": "项目 #{id}",
  "assistant.reference-entity-context": "将对象作为本轮对话上下文",
  "assistant.reference-project-title": "引用对象",
  "assistant.reference-capability-title": "引用 Skill 或 MCP",
  "assistant.reference-project-hint": "输入名称或 ID 模糊查找",
  "assistant.reference-capability-hint": "输入名称、来源或描述模糊查找",
  "assistant.reference-searching": "正在查找 “{query}”",
  "assistant.reference-loading": "加载引用项",
  "assistant.reference-no-match": "没有匹配的引用项",
  "assistant.reference-empty-project": "暂无可用上下文对象",
  "assistant.reference-empty-capability": "暂无已配置的 Skill 或 MCP",
  "assistant.reference-project-eyebrow": "项目 #{id}",
  "assistant.reference-skill-eyebrow": "Skill · {name}",
  "assistant.reference-mcp-eyebrow": "MCP · {server}",
  "assistant.reference-mcp-default-desc": "引用 MCP 工具",
  "assistant.reference-load-failed": "加载 Skill/MCP 失败",
  "assistant.reference-projects-load-failed": "加载上下文对象失败",
  "assistant.reference-attach-project": "引用该对象上下文",
  "assistant.entity-project": "项目",
  "assistant.entity-script": "剧本",
  "assistant.entity-storyboard": "分镜",
  "assistant.entity-storyboardEpisode": "分镜分集",
  "assistant.entity-storyboardItem": "分镜镜头",
  "assistant.entity-asset": "资产",
  "assistant.attachment-add": "添加附件",
  "assistant.attachment-busy": "附件正在处理中，请稍候",
  "assistant.attachment-count-limit": "单次最多添加 {n} 个附件",
  "assistant.attachment-size-limit": "{name} 的大小必须在 1B 到 100MB 之间",
  "assistant.attachment-unsupported": "{name} 不是支持的图片、视频、音频、PDF 或文本文件",
  "assistant.attachment-model-unsupported": "{model} 不支持{type}输入",
  "assistant.attachment-base64-limit": "{name} 超出 Base64 限制，且当前模型未启用 URL 输入",
  "assistant.attachment-read-failed": "读取 {name} 失败",
  "assistant.attachment-encode-failed": "{name} 无法转换为 Base64",
  "assistant.attachment-incompatible": "{model} 不支持附件“{name}”的 {transport} 输入",
  "assistant.attachment-text-only": "当前模型仅支持文本输入",
  "assistant.attachment-capability-add": "添加{capabilities}",
  "assistant.attachment-capability-transport-url": "URL",
  "assistant.attachment-capability-transport-base64": "Base64",
  "assistant.attachment-type-image": "图片",
  "assistant.attachment-type-video": "视频",
  "assistant.attachment-type-audio": "音频",
  "assistant.attachment-type-file": "文件",
  "assistant.attachment-remove": "移除附件",
  "assistant.attachment-model-required": "请先选择对话模型",
  "assistant.attachment-url-fallback": "大文件将以 URL 引用传输",
  "notification.reasoning": "思考",
  "notification.reasoning-duration": "思考 ({s}s)",
  "notification.tool-preparing": "准备中",
  "notification.tool-calling": "执行中",
  "notification.tool-awaiting": "等待确认",
  "notification.tool-rejected": "已拒绝",
  "notification.tool-expired": "已过期",
  "notification.status-done": "已完成",
  "notification.status-error": "出错",
  "notification.status-cancelled": "已取消",
  "common.close": "关闭",
  "emptyState.empty": "暂无内容",
  "api.request-failed": "请求失败",
  "api.unauthorized": "登录已过期，请重新登录",
  // ---- [new] P4/W15 配置视图 (view="config"; Skill 只读 + 用户级三方 MCP 启停) ----
  "config.title": "配置",
  "config.skills": "Skill 技能",
  "config.skills-desc": "当前可被助手引用的 Skill(只读, 由应用管理员与内置库提供)",
  "config.skills-empty": "暂无可用 Skill",
  "config.mcp": "三方 MCP 服务器",
  "config.mcp-desc": "接入你自己的三方 MCP 服务器; 停用后其工具将从你的目录摘除",
  "config.mcp-empty": "还没有接入三方 MCP 服务器",
  "config.mcp-enabled": "已启用",
  "config.mcp-disabled": "已停用",
  "config.action-enable": "启用",
  "config.action-disable": "停用",
  "config.action-refresh": "刷新",
  "config.auth-static-header": "静态头鉴权",
  "config.auth-oauth": "OAuth 鉴权(暂未支持)",
  "config.load-failed": "配置加载失败",
  "config.update-failed": "操作失败, 已回滚"
};
const enUS = {
  "assistant.title": "InnerAgent Assistant",
  "assistant.subtitle": "Your collaboration assistant",
  "assistant.conversations": "Conversations",
  "assistant.conversations-only": "Assistant conversations only",
  "assistant.new-conversation": "New conversation",
  "assistant.start-new": "Start a conversation",
  "assistant.empty-conversations": "No assistant conversations yet",
  "assistant.media-download": "Download video",
  "assistant.subagent-default": "Subtask",
  "assistant.subagent-progress-doing": "{label} done",
  "assistant.subagent-progress-ran": "{label} steps run",
  "assistant.subagent-progress-done": "{label} steps",
  "assistant.status-running": "Running",
  "assistant.status-completed": "Completed",
  "assistant.status-failed": "Failed",
  "assistant.status-cancelled": "Cancelled",
  "assistant.status-cancelling": "Cancelling",
  "assistant.status-waiting-confirm": "Awaiting approval",
  "assistant.status-waiting-external": "Waiting for execution",
  "assistant.unread": "Unread",
  "assistant.delete-conversation": "Delete conversation",
  "assistant.delete-title": "Delete this conversation?",
  "assistant.delete-desc": "Messages of “{title}” will be removed from this account. This cannot be undone.",
  "assistant.delete-confirm": "Delete",
  "assistant.cancel": "Cancel",
  "assistant.delete-failed": "Delete failed",
  "assistant.running-delete-disabled": "Running conversations cannot be deleted",
  "assistant.time-now": "just now",
  "assistant.time-minutes-ago": "{n} min ago",
  "assistant.time-hours-ago": "{n} h ago",
  "assistant.time-days-ago": "{n} d ago",
  "assistant.load-more": "Load more",
  "assistant.loading": "Loading",
  "assistant.loading-messages": "Loading messages",
  "assistant.empty-title": "What do you want to get done today?",
  "assistant.empty-desc": "Describe your task or ask a question to get started.",
  "assistant.thinking": "Thinking…",
  "assistant.reconnecting": "Connection lost — reconnecting…",
  "assistant.back-to-bottom": "Back to bottom",
  "assistant.send": "Send",
  "assistant.stop": "Stop",
  "assistant.stopping": "Cancelling…",
  "assistant.stop-failed": "Stop failed",
  "assistant.model": "Model",
  "assistant.model-load-failed": "Failed to load models",
  "assistant.retry": "Retry",
  "assistant.reasoning-effort": "Reasoning effort",
  "assistant.tool-mode": "Tool execution mode",
  "assistant.tool-mode-DEFAULT": "Default (per tool)",
  "assistant.tool-mode-ALWAYS_ASK": "Always ask",
  "assistant.tool-mode-ALWAYS_ALLOW": "Always allow",
  "assistant.tool-mode-FULL_ACCESS": "Full access",
  "assistant.confirm-batch-title": "Batch approval",
  "assistant.confirm-batch-expired": "Approval window ended; treated as not approved",
  "assistant.confirm-batch-submitting": "Submitting decisions for {n} tools",
  "assistant.confirm-batch-waiting": "{n} tools awaiting approval{selected} · {time} left",
  "assistant.confirm-batch-selected": ", {n}/{total} selected",
  "assistant.confirm-scope-degraded": "Scope degraded: no context hints; write tools require per-call approval",
  "assistant.confirm-scope-resolved": "Scope: {summary}",
  "assistant.confirm-scope-resolved-default": "Scope context attached to this run",
  "assistant.confirm-reject-all": "Reject all",
  "assistant.confirm-approve-all": "Approve all",
  "assistant.confirm-approve": "Approve",
  "assistant.confirm-reject": "Reject",
  "assistant.tool-awaiting": "Awaiting approval · {time} left",
  "assistant.input-placeholder-hint": "Imagine…\nUse {'@'} for page context, / for Skills",
  "assistant.send-failed": "Send failed, please retry",
  "assistant.reference-label": "References",
  "assistant.reference-remove": "Remove {name}",
  "assistant.reference-project-fallback": "Project #{id}",
  "assistant.reference-entity-context": "Attach this object as conversation context",
  "assistant.reference-project-title": "Reference object",
  "assistant.reference-capability-title": "Reference Skills or MCP",
  "assistant.reference-project-hint": "Search by name or ID",
  "assistant.reference-capability-hint": "Search by name, source or description",
  "assistant.reference-searching": "Searching “{query}”",
  "assistant.reference-loading": "Loading references",
  "assistant.reference-no-match": "No matching references",
  "assistant.reference-empty-project": "No context objects available",
  "assistant.reference-empty-capability": "No Skills or MCP configured",
  "assistant.reference-project-eyebrow": "Project #{id}",
  "assistant.reference-skill-eyebrow": "Skill · {name}",
  "assistant.reference-mcp-eyebrow": "MCP · {server}",
  "assistant.reference-mcp-default-desc": "Reference MCP tool",
  "assistant.reference-load-failed": "Failed to load Skills/MCP",
  "assistant.reference-projects-load-failed": "Failed to load context objects",
  "assistant.reference-attach-project": "Reference this object context",
  "assistant.entity-project": "Project",
  "assistant.entity-script": "Script",
  "assistant.entity-storyboard": "Storyboard",
  "assistant.entity-storyboardEpisode": "Episode",
  "assistant.entity-storyboardItem": "Shot",
  "assistant.entity-asset": "Asset",
  "assistant.attachment-add": "Add attachment",
  "assistant.attachment-busy": "Attachments are being processed, please wait",
  "assistant.attachment-count-limit": "Up to {n} attachments at a time",
  "assistant.attachment-size-limit": "{name} must be between 1B and 100MB",
  "assistant.attachment-unsupported": "{name} is not a supported image, video, audio, PDF or text file",
  "assistant.attachment-model-unsupported": "{model} does not support {type} input",
  "assistant.attachment-base64-limit": "{name} exceeds the Base64 limit and the model has no URL input",
  "assistant.attachment-read-failed": "Failed to read {name}",
  "assistant.attachment-encode-failed": "{name} could not be encoded to Base64",
  "assistant.attachment-incompatible": "{model} does not support {transport} input for “{name}”",
  "assistant.attachment-text-only": "The current model accepts text only",
  "assistant.attachment-capability-add": "Add {capabilities}",
  "assistant.attachment-capability-transport-url": "URL",
  "assistant.attachment-capability-transport-base64": "Base64",
  "assistant.attachment-type-image": "image",
  "assistant.attachment-type-video": "video",
  "assistant.attachment-type-audio": "audio",
  "assistant.attachment-type-file": "file",
  "assistant.attachment-remove": "Remove attachment",
  "assistant.attachment-model-required": "Select a chat model first",
  "assistant.attachment-url-fallback": "Large file will be sent as a URL reference",
  "notification.reasoning": "Thinking",
  "notification.reasoning-duration": "Thinking ({s}s)",
  "notification.tool-preparing": "Preparing",
  "notification.tool-calling": "Running",
  "notification.tool-awaiting": "Awaiting approval",
  "notification.tool-rejected": "Rejected",
  "notification.tool-expired": "Expired",
  "notification.status-done": "Completed",
  "notification.status-error": "Error",
  "notification.status-cancelled": "Cancelled",
  "common.close": "Close",
  "emptyState.empty": "Nothing here yet",
  "api.request-failed": "Request failed",
  "api.unauthorized": "Session expired, please sign in again",
  // ---- [new] P4/W15 config view (view="config"; read-only skills + user-level MCP toggle) ----
  "config.title": "Configuration",
  "config.skills-desc": "Skills the assistant can reference (read-only; provided by app admins and the built-in library)",
  "config.skills": "Skills",
  "config.skills-empty": "No skills available",
  "config.mcp": "Third-party MCP servers",
  "config.mcp-desc": "Connect your own MCP servers; disabling one removes its tools from your catalog",
  "config.mcp-empty": "No third-party MCP servers connected",
  "config.mcp-enabled": "Enabled",
  "config.mcp-disabled": "Disabled",
  "config.action-enable": "Enable",
  "config.action-disable": "Disable",
  "config.action-refresh": "Refresh",
  "config.auth-static-header": "Static header auth",
  "config.auth-oauth": "OAuth auth (not supported yet)",
  "config.load-failed": "Failed to load configuration",
  "config.update-failed": "Operation failed, reverted"
};
const MESSAGES = {
  "zh-CN": zhCN,
  "en-US": enUS
};
const locale = /* @__PURE__ */ ref("zh-CN");
function setIaLocale(next) {
  locale.value = next;
}
function interpolate(template, params) {
  let result = template.replace(/\{'([^']*)'\}/g, "$1");
  if (params) {
    result = result.replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
  }
  return result;
}
function useI18n() {
  const messages = computed(() => MESSAGES[locale.value]);
  const t = (key, params) => {
    const template = messages.value[key];
    if (template === void 0) return key;
    return interpolate(template, params);
  };
  const te = (key) => messages.value[key] !== void 0;
  return { t, te, locale };
}
function conversationStatusKey(status) {
  if (status === "CANCEL_REQUESTED") return "assistant.status-cancelling";
  if (status === "WAITING_CONFIRMATION") return "assistant.status-waiting-confirm";
  if (status === "WAITING_EXTERNAL") return "assistant.status-waiting-external";
  if (statusIsRunning(status)) return "assistant.status-running";
  if (status === "failed" || status === "error") return "assistant.status-failed";
  if (status === "cancelled") return "assistant.status-cancelled";
  return "assistant.status-completed";
}
function conversationStatusTone(status, unread) {
  if (status === "CANCEL_REQUESTED") return "running";
  if (status === "WAITING_CONFIRMATION" || status === "WAITING_EXTERNAL") return "waiting";
  if (statusIsRunning(status)) return "running";
  if (status === "failed" || status === "error") return "failed";
  if (status === "cancelled") return "cancelled";
  if (unread) return "unread";
  return "done";
}
function relativeTimeParts(value, now = Date.now()) {
  if (!value) return { key: "assistant.time-now" };
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return { key: "assistant.time-now" };
  const seconds = Math.max(0, Math.round((now - timestamp) / 1e3));
  if (seconds < 60) return { key: "assistant.time-now" };
  if (seconds < 3600) return { key: "assistant.time-minutes-ago", n: Math.floor(seconds / 60) };
  if (seconds < 86400) return { key: "assistant.time-hours-ago", n: Math.floor(seconds / 3600) };
  if (seconds < 604800) return { key: "assistant.time-days-ago", n: Math.floor(seconds / 86400) };
  return { key: "assistant.time-days-ago", n: Math.floor(seconds / 86400) };
}
function buildSegments(messages, activeRunId) {
  const segments = [];
  let current = { key: "prelude", assistant: [] };
  const pushCurrent = () => {
    if (current.user || current.assistant.length > 0) segments.push(current);
  };
  for (const message of messages) {
    if (message.role === "user") {
      pushCurrent();
      current = {
        key: `segment-${message.id}-${message.messageOrder}`,
        user: message,
        assistant: []
      };
      continue;
    }
    if (activeRunId && message.runId === activeRunId) continue;
    current.assistant.push(message);
  }
  pushCurrent();
  return segments;
}
function selectedBatchDecision(toolCallIds, decisions) {
  if (toolCallIds.some((toolCallId) => !Object.prototype.hasOwnProperty.call(decisions, toolCallId))) {
    return void 0;
  }
  const firstDecision = decisions[toolCallIds[0] ?? ""];
  return toolCallIds.every((toolCallId) => decisions[toolCallId] === firstDecision) ? firstDecision : void 0;
}
const _hoisted_1$h = ["type", "disabled"];
const _hoisted_2$d = {
  key: 0,
  class: "ri-loader-4-line is-spinning",
  "aria-hidden": "true"
};
const _sfc_main$h = /* @__PURE__ */ defineComponent({
  ...{ name: "IaButton", inheritAttrs: false },
  __name: "IaButton",
  props: {
    variant: { default: "primary", type: String },
    size: { default: "md", type: String },
    loading: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    circle: { type: Boolean, default: false },
    block: { type: Boolean, default: false },
    nativeType: { default: "button", type: String }
  },
  emits: ["click"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    const classes = computed(() => [
      "ia-button",
      `variant-${props.variant}`,
      `size-${props.size}`,
      {
        "is-loading": props.loading,
        "is-disabled": props.disabled || props.loading,
        "is-circle": props.circle,
        "is-block": props.block
      }
    ]);
    function onClick(event) {
      if (!props.disabled && !props.loading) emit2("click", event);
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("button", mergeProps({
        class: classes.value,
        type: __props.nativeType,
        disabled: __props.disabled || __props.loading
      }, _ctx.$attrs, { onClick }), [
        __props.loading ? (openBlock(), createElementBlock("i", _hoisted_2$d)) : createCommentVNode("", true),
        renderSlot(_ctx.$slots, "default", {}, void 0)
      ], 16, _hoisted_1$h);
    };
  }
});
const _style_0$h = "\n.ia-button[data-v-d5b5e96c] {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  gap: 5px;\n  padding: 7px 14px;\n  border: 1px solid transparent;\n  border-radius: var(--app-radius-md, 8px);\n  font-weight: 600;\n  line-height: 1.2;\n  cursor: pointer;\n  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.1s ease;\n  user-select: none;\n}\n.ia-button[data-v-d5b5e96c]:active:not(.is-disabled) { transform: scale(0.97);\n}\n.ia-button.is-disabled[data-v-d5b5e96c] {\n  cursor: not-allowed;\n  opacity: 0.55;\n}\n.ia-button.is-block[data-v-d5b5e96c] { width: 100%; display: flex;\n}\n.ia-button.is-circle[data-v-d5b5e96c] { border-radius: 9999px; padding-left: 10px; padding-right: 10px;\n}\n.ia-button.size-sm[data-v-d5b5e96c] { font-size: 12px; padding: 5px 10px;\n}\n.ia-button.size-md[data-v-d5b5e96c] { font-size: 13px;\n}\n.ia-button.size-lg[data-v-d5b5e96c] { font-size: 14px; padding: 9px 18px;\n}\n.ia-button.variant-primary[data-v-d5b5e96c]:not(.is-disabled) {\n  background: var(--app-primary, var(--ia-primary, #409eff));\n  border-color: var(--app-primary, var(--ia-primary, #409eff));\n  color: var(--app-on-primary, var(--ia-primary-contrast, #fff));\n}\n.ia-button.variant-primary[data-v-d5b5e96c]:not(.is-disabled):hover {\n  filter: brightness(0.95);\n  box-shadow: var(--app-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.08));\n}\n.ia-button.variant-secondary[data-v-d5b5e96c] {\n  background: var(--app-bg-card, var(--ia-bg-card, #fff));\n  border-color: var(--app-separator, var(--ia-separator, #dcdfe6));\n  color: var(--app-text, var(--ia-text, #303133));\n}\n.ia-button.variant-secondary[data-v-d5b5e96c]:not(.is-disabled):hover {\n  border-color: var(--app-primary, var(--ia-primary, #409eff));\n  color: var(--app-primary, var(--ia-primary, #409eff));\n}\n.ia-button.variant-text[data-v-d5b5e96c] {\n  background: none;\n  border-color: transparent;\n  color: var(--app-primary, var(--ia-primary, #409eff));\n}\n.ia-button.variant-text[data-v-d5b5e96c]:not(.is-disabled):hover { background: rgba(64, 158, 255, 0.08);\n}\n.ia-button.variant-danger[data-v-d5b5e96c]:not(.is-disabled) {\n  background: var(--app-color-danger, var(--ia-danger, #f56c6c));\n  border-color: var(--app-color-danger, var(--ia-danger, #f56c6c));\n  color: #fff;\n}\n.ia-button.variant-danger[data-v-d5b5e96c]:not(.is-disabled):hover {\n  filter: brightness(0.95);\n  box-shadow: var(--app-shadow-sm, 0 2px 8px rgba(0, 0, 0, 0.08));\n}\n.is-spinning[data-v-d5b5e96c] { animation: ia-button-spin-d5b5e96c 1s linear infinite;\n}\n@keyframes ia-button-spin-d5b5e96c {\nfrom { transform: rotate(0deg);\n}\nto { transform: rotate(360deg);\n}\n}\n";
const _export_sfc = (sfc, props) => {
  const target = sfc.__vccOpts || sfc;
  for (const [key, val] of props) {
    target[key] = val;
  }
  return target;
};
const IaButton = /* @__PURE__ */ _export_sfc(_sfc_main$h, [["styles", [_style_0$h]], ["__scopeId", "data-v-d5b5e96c"]]);
const _hoisted_1$g = { class: "ia-dialog__head" };
const _hoisted_2$c = { class: "ia-dialog__title" };
const _hoisted_3$a = { class: "ia-dialog__body" };
const _hoisted_4$9 = {
  key: 0,
  class: "ia-dialog__footer"
};
const _sfc_main$g = /* @__PURE__ */ defineComponent({
  ...{ name: "IaDialog", inheritAttrs: false },
  __name: "IaDialog",
  props: {
    open: { type: Boolean, default: false },
    title: { default: "", type: String },
    width: { default: "420px", type: [String, Number] },
    closeOnClickModal: { type: Boolean, default: false }
  },
  emits: ["update:open", "close"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    function close() {
      emit2("update:open", false);
      emit2("close");
    }
    function onMaskClick() {
      if (props.closeOnClickModal) close();
    }
    let escHandler = null;
    function detachEsc() {
      if (escHandler) {
        document.removeEventListener("keydown", escHandler);
        escHandler = null;
      }
    }
    watch(() => props.open, (open) => {
      detachEsc();
      if (!open) return;
      escHandler = (event) => {
        if (event.key === "Escape") close();
      };
      document.addEventListener("keydown", escHandler);
    });
    onScopeDispose(detachEsc);
    return (_ctx, _cache) => {
      return __props.open ? (openBlock(), createElementBlock("div", mergeProps({
        key: 0,
        class: "ia-dialog",
        role: "dialog",
        "aria-modal": "true"
      }, _ctx.$attrs), [
        createBaseVNode("div", {
          class: "ia-dialog__mask",
          onClick: onMaskClick
        }),
        createBaseVNode("div", {
          class: "ia-dialog__card",
          style: normalizeStyle({ width: typeof __props.width === "number" ? `${__props.width}px` : __props.width })
        }, [
          createBaseVNode("header", _hoisted_1$g, [
            createBaseVNode("h3", _hoisted_2$c, toDisplayString(__props.title), 1),
            createBaseVNode("button", {
              type: "button",
              class: "ia-dialog__close",
              "aria-label": "close",
              onClick: close
            }, [..._cache[0] || (_cache[0] = [
              createBaseVNode("i", {
                class: "ri-close-line",
                "aria-hidden": "true"
              }, null, -1)
            ])])
          ]),
          createBaseVNode("div", _hoisted_3$a, [
            renderSlot(_ctx.$slots, "default", {}, void 0)
          ]),
          _ctx.$slots.footer ? (openBlock(), createElementBlock("footer", _hoisted_4$9, [
            renderSlot(_ctx.$slots, "footer", {}, void 0)
          ])) : createCommentVNode("", true)
        ], 4)
      ], 16)) : createCommentVNode("", true);
    };
  }
});
const _style_0$g = "\n.ia-dialog[data-v-2385a08f] {\n  position: fixed;\n  inset: 0;\n  z-index: 100;\n  display: grid;\n  place-items: center;\n}\n.ia-dialog__mask[data-v-2385a08f] {\n  position: absolute;\n  inset: 0;\n  background: rgba(0, 0, 0, 0.45);\n}\n.ia-dialog__card[data-v-2385a08f] {\n  position: relative;\n  max-width: calc(100vw - 48px);\n  border-radius: 12px;\n  background: var(--app-bg-card, var(--ia-bg-card, #fff));\n  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);\n  overflow: hidden;\n}\n.ia-dialog__head[data-v-2385a08f] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 14px 16px 10px;\n}\n.ia-dialog__title[data-v-2385a08f] {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--app-text, var(--ia-text, #303133));\n}\n.ia-dialog__close[data-v-2385a08f] {\n  display: grid;\n  place-items: center;\n  width: 24px;\n  height: 24px;\n  border: none;\n  border-radius: 6px;\n  background: none;\n  cursor: pointer;\n  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));\n}\n.ia-dialog__close[data-v-2385a08f]:hover { background: var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7));\n}\n.ia-dialog__body[data-v-2385a08f] {\n  padding: 0 16px 16px;\n  font-size: 13px;\n  color: var(--app-text, var(--ia-text, #303133));\n  line-height: 1.6;\n}\n.ia-dialog__footer[data-v-2385a08f] {\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n  padding: 10px 16px 14px;\n}\n";
const IaDialog = /* @__PURE__ */ _export_sfc(_sfc_main$g, [["styles", [_style_0$g]], ["__scopeId", "data-v-2385a08f"]]);
const _hoisted_1$f = { class: "assistant-nav__head" };
const _hoisted_2$b = { class: "assistant-nav__title" };
const _hoisted_3$9 = { class: "assistant-nav__sub" };
const _hoisted_4$8 = {
  key: 0,
  class: "assistant-nav__empty",
  "data-testid": "assistant-nav-empty"
};
const _hoisted_5$8 = ["data-testid", "onClick", "onKeydown"];
const _hoisted_6$8 = { class: "assistant-nav__main" };
const _hoisted_7$8 = ["title"];
const _hoisted_8$7 = { class: "assistant-nav__meta" };
const _hoisted_9$6 = ["title"];
const _hoisted_10$6 = ["title", "disabled", "data-testid", "onClick"];
const _hoisted_11$5 = {
  key: 1,
  class: "assistant-nav__loading"
};
const _hoisted_12$4 = { class: "assistant-nav__delete-desc" };
const _hoisted_13$3 = {
  key: 0,
  class: "assistant-nav__delete-error",
  "data-testid": "assistant-delete-error"
};
const _hoisted_14$3 = { class: "assistant-nav__delete-actions" };
const _sfc_main$f = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantConversationNav" },
  __name: "AssistantConversationNav",
  emits: ["selected"],
  setup(__props, { emit: __emit }) {
    const emit2 = __emit;
    const { t } = useI18n();
    const store = useAssistantStore();
    const STATUS_ICON = {
      running: "ri-loader-4-line",
      waiting: "ri-error-warning-line",
      failed: "ri-close-circle-line",
      cancelled: "ri-ban-line",
      unread: "ri-error-warning-line",
      done: "ri-checkbox-circle-line"
    };
    function toneClass(status, unread) {
      return `is-${conversationStatusTone(status, unread)}`;
    }
    function isRunningStatus(status) {
      return !!status && ["running", "pending", "RUNNING", "WAITING_CONFIRMATION", "WAITING_EXTERNAL", "CANCEL_REQUESTED"].includes(status);
    }
    function onScroll(event) {
      const element = event.currentTarget;
      if (store.hasMoreConversations && !store.conversationsLoading && element.scrollHeight - element.scrollTop - element.clientHeight < 80) {
        store.loadMoreConversations();
      }
    }
    const deleteTarget = /* @__PURE__ */ ref(null);
    const deleteError = /* @__PURE__ */ ref(null);
    const deleting = /* @__PURE__ */ ref(false);
    const deleteOpen = computed({
      get: () => deleteTarget.value !== null,
      set: (v) => {
        if (!v) deleteTarget.value = null;
      }
    });
    function askDelete(conversationId, id, title) {
      deleteError.value = null;
      deleteTarget.value = { conversationId, id, title };
    }
    async function confirmDelete() {
      if (!deleteTarget.value) return;
      deleting.value = true;
      try {
        await store.deleteConversation(deleteTarget.value.conversationId, deleteTarget.value.id);
        deleteTarget.value = null;
      } catch (error) {
        deleteError.value = error instanceof Error ? error.message : t("assistant.delete-failed");
      } finally {
        deleting.value = false;
      }
    }
    function select(conversationId) {
      try {
        store.selectConversation(conversationId);
        emit2("selected");
      } catch (error) {
        console.error(`[inneragent-chat] ${t("assistant.delete-failed")}`, error);
      }
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("aside", {
        class: normalizeClass(["assistant-nav", { "is-drawer": unref(store).drawerOpen }]),
        "data-testid": "assistant-nav"
      }, [
        unref(store).drawerOpen ? (openBlock(), createElementBlock("div", {
          key: 0,
          class: "assistant-nav__mask",
          onClick: _cache[0] || (_cache[0] = ($event) => unref(store).setDrawerOpen(false))
        })) : createCommentVNode("", true),
        createBaseVNode("div", _hoisted_1$f, [
          createBaseVNode("div", null, [
            createBaseVNode("p", _hoisted_2$b, toDisplayString(unref(t)("assistant.conversations")), 1),
            createBaseVNode("p", _hoisted_3$9, toDisplayString(unref(t)("assistant.conversations-only")), 1)
          ]),
          createVNode(IaButton, {
            class: "assistant-nav__close",
            variant: "secondary",
            size: "sm",
            circle: "",
            title: unref(t)("common.close"),
            "aria-label": unref(t)("common.close"),
            "data-testid": "assistant-drawer-close",
            onClick: _cache[1] || (_cache[1] = ($event) => unref(store).setDrawerOpen(false))
          }, {
            default: withCtx(() => [..._cache[7] || (_cache[7] = [
              createBaseVNode("i", { class: "ri-close-line" }, null, -1)
            ])]),
            _: 1
          }, 8, ["title", "aria-label"]),
          createVNode(IaButton, {
            variant: "secondary",
            size: "sm",
            circle: "",
            title: unref(t)("assistant.new-conversation"),
            "data-testid": "assistant-new-conversation",
            onClick: _cache[2] || (_cache[2] = ($event) => unref(store).startNewConversation())
          }, {
            default: withCtx(() => [..._cache[8] || (_cache[8] = [
              createBaseVNode("i", { class: "ri-add-line" }, null, -1)
            ])]),
            _: 1
          }, 8, ["title"])
        ]),
        createBaseVNode("div", {
          class: "assistant-nav__list",
          onScroll
        }, [
          unref(store).conversations.length === 0 && !unref(store).conversationsLoading ? (openBlock(), createElementBlock("div", _hoisted_4$8, [
            _cache[9] || (_cache[9] = createBaseVNode("i", { class: "ri-chat-new-line" }, null, -1)),
            createBaseVNode("p", null, toDisplayString(unref(t)("assistant.empty-conversations")), 1),
            createVNode(IaButton, {
              variant: "secondary",
              size: "sm",
              onClick: _cache[3] || (_cache[3] = ($event) => unref(store).startNewConversation())
            }, {
              default: withCtx(() => [
                createTextVNode(toDisplayString(unref(t)("assistant.start-new")), 1)
              ]),
              _: 1
            })
          ])) : createCommentVNode("", true),
          (openBlock(true), createElementBlock(Fragment, null, renderList(unref(store).conversations, (conversation) => {
            return openBlock(), createElementBlock("div", {
              key: conversation.conversationId,
              role: "button",
              tabindex: "0",
              class: normalizeClass(["assistant-nav__item", { "is-selected": conversation.conversationId === unref(store).selectedConversationId }]),
              "data-testid": `assistant-conversation-${conversation.conversationId}`,
              onClick: ($event) => select(conversation.conversationId),
              onKeydown: [
                withKeys(($event) => select(conversation.conversationId), ["enter"]),
                withKeys(withModifiers(($event) => select(conversation.conversationId), ["prevent"]), ["space"])
              ]
            }, [
              createBaseVNode("i", {
                class: normalizeClass(["assistant-nav__status", [
                  STATUS_ICON[unref(conversationStatusTone)(
                    unref(store).conversationStates[conversation.conversationId]?.status,
                    unref(store).conversationStates[conversation.conversationId]?.unread ?? false
                  )],
                  toneClass(
                    unref(store).conversationStates[conversation.conversationId]?.status,
                    unref(store).conversationStates[conversation.conversationId]?.unread ?? false
                  ),
                  { "is-spinning": unref(conversationStatusTone)(
                    unref(store).conversationStates[conversation.conversationId]?.status,
                    unref(store).conversationStates[conversation.conversationId]?.unread ?? false
                  ) === "running" }
                ]])
              }, null, 2),
              createBaseVNode("span", _hoisted_6$8, [
                createBaseVNode("span", {
                  class: "assistant-nav__name",
                  title: conversation.title
                }, toDisplayString(conversation.title || unref(t)("assistant.new-conversation")), 9, _hoisted_7$8),
                createBaseVNode("span", _hoisted_8$7, [
                  createBaseVNode("span", null, toDisplayString(unref(t)(unref(conversationStatusKey)(unref(store).conversationStates[conversation.conversationId]?.status))), 1),
                  _cache[10] || (_cache[10] = createBaseVNode("span", { "aria-hidden": "true" }, "·", -1)),
                  createBaseVNode("span", null, toDisplayString(unref(t)(unref(relativeTimeParts)(conversation.lastMessageTime ?? conversation.createTime).key, {
                    n: unref(relativeTimeParts)(conversation.lastMessageTime ?? conversation.createTime).n ?? 0
                  })), 1),
                  unref(store).conversationStates[conversation.conversationId]?.unread ? (openBlock(), createElementBlock("span", {
                    key: 0,
                    class: "assistant-nav__unread",
                    title: unref(t)("assistant.unread")
                  }, null, 8, _hoisted_9$6)) : createCommentVNode("", true)
                ])
              ]),
              createBaseVNode("button", {
                type: "button",
                class: "assistant-nav__delete fc-button-ghost",
                title: isRunningStatus(unref(store).conversationStates[conversation.conversationId]?.status) ? unref(t)("assistant.running-delete-disabled") : unref(t)("assistant.delete-conversation"),
                disabled: isRunningStatus(unref(store).conversationStates[conversation.conversationId]?.status),
                "data-testid": `assistant-delete-${conversation.conversationId}`,
                onClick: withModifiers(($event) => askDelete(conversation.conversationId, conversation.id, conversation.title), ["stop"])
              }, [..._cache[11] || (_cache[11] = [
                createBaseVNode("i", { class: "ri-delete-bin-line" }, null, -1)
              ])], 8, _hoisted_10$6)
            ], 42, _hoisted_5$8);
          }), 128)),
          unref(store).conversationsLoading ? (openBlock(), createElementBlock("p", _hoisted_11$5, [
            _cache[12] || (_cache[12] = createBaseVNode("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
            createTextVNode(" " + toDisplayString(unref(t)("assistant.loading")), 1)
          ])) : unref(store).hasMoreConversations ? (openBlock(), createElementBlock("button", {
            key: 2,
            type: "button",
            class: "assistant-nav__more fc-button-ghost",
            "data-testid": "assistant-load-more",
            onClick: _cache[4] || (_cache[4] = ($event) => unref(store).loadMoreConversations())
          }, toDisplayString(unref(t)("assistant.load-more")), 1)) : createCommentVNode("", true)
        ], 32),
        createVNode(IaDialog, {
          open: deleteOpen.value,
          "onUpdate:open": _cache[6] || (_cache[6] = ($event) => deleteOpen.value = $event),
          title: unref(t)("assistant.delete-title"),
          width: "400px"
        }, {
          footer: withCtx(() => [
            createBaseVNode("div", _hoisted_14$3, [
              createVNode(IaButton, {
                variant: "secondary",
                size: "sm",
                onClick: _cache[5] || (_cache[5] = ($event) => deleteOpen.value = false)
              }, {
                default: withCtx(() => [
                  createTextVNode(toDisplayString(unref(t)("assistant.cancel")), 1)
                ]),
                _: 1
              }),
              createVNode(IaButton, {
                variant: "danger",
                size: "sm",
                loading: deleting.value,
                "data-testid": "assistant-delete-confirm",
                onClick: confirmDelete
              }, {
                default: withCtx(() => [
                  createTextVNode(toDisplayString(unref(t)("assistant.delete-confirm")), 1)
                ]),
                _: 1
              }, 8, ["loading"])
            ])
          ]),
          default: withCtx(() => [
            createBaseVNode("p", _hoisted_12$4, toDisplayString(unref(t)("assistant.delete-desc", { title: deleteTarget.value?.title || unref(t)("assistant.new-conversation") })), 1),
            deleteError.value ? (openBlock(), createElementBlock("p", _hoisted_13$3, toDisplayString(deleteError.value), 1)) : createCommentVNode("", true)
          ]),
          _: 1
        }, 8, ["open", "title"])
      ], 2);
    };
  }
});
const _style_0$f = ".assistant-nav__mask[data-v-50f126bd] {\n  position: fixed;\n  inset: 0;\n  z-index: 55;\n  background: rgba(0, 0, 0, 0.4);\n}\n.assistant-nav__close[data-v-50f126bd] {\n  display: none;\n}\n.assistant-nav[data-v-50f126bd] {\n  width: 220px;\n  position: relative;\n}\n@media (max-width: 768px) {\n.assistant-nav[data-v-50f126bd]:not(.is-drawer) {\n    display: none;\n}\n.assistant-nav.is-drawer[data-v-50f126bd] {\n    position: fixed;\n    inset: 0 auto 0 0;\n    width: 260px;\n    z-index: 60;\n    background: var(--app-bg, var(--el-bg-color));\n    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);\n}\n.assistant-nav.is-drawer .assistant-nav__close[data-v-50f126bd] {\n    display: inline-flex;\n}\n}\n.assistant-nav[data-v-50f126bd] {\n  flex-shrink: 0;\n  display: flex;\n  flex-direction: column;\n  min-height: 0;\n  border-right: 1px solid var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-nav__head[data-v-50f126bd] {\n  flex-shrink: 0;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 12px 12px 10px;\n  border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-nav__head > div[data-v-50f126bd] {\n  min-width: 0;\n}\n.assistant-nav__title[data-v-50f126bd] {\n  margin: 0;\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--app-text);\n}\n.assistant-nav__sub[data-v-50f126bd] {\n  margin: 2px 0 0;\n  font-size: 10px;\n  color: var(--app-text-tertiary, var(--app-text-secondary));\n}\n.assistant-nav__list[data-v-50f126bd] {\n  flex: 1;\n  min-height: 0;\n  overflow-y: auto;\n  padding: 8px;\n}\n.assistant-nav__empty[data-v-50f126bd] {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  gap: 8px;\n  padding: 28px 12px;\n  text-align: center;\n  color: var(--app-text-secondary);\n  font-size: 12px;\n}\n.assistant-nav__empty i[data-v-50f126bd] {\n  font-size: 26px;\n  opacity: 0.4;\n}\n.assistant-nav__empty p[data-v-50f126bd] {\n  margin: 0;\n}\n.assistant-nav__item[data-v-50f126bd] {\n  width: 100%;\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  padding: 8px 10px;\n  margin-bottom: 2px;\n  border: none;\n  border-radius: 10px;\n  background: none;\n  cursor: pointer;\n  text-align: left;\n  transition: background 0.15s;\n}\n.assistant-nav__item[data-v-50f126bd]:hover {\n  background: var(--app-sidebar-item-hover-bg);\n}\n.assistant-nav__item:hover .assistant-nav__delete[data-v-50f126bd] {\n  opacity: 1;\n}\n.assistant-nav__item.is-selected[data-v-50f126bd] {\n  background: var(--el-color-primary-light-9, #ecf5ff);\n}\n.assistant-nav__status[data-v-50f126bd] {\n  flex-shrink: 0;\n  margin-top: 2px;\n  font-size: 13px;\n}\n.assistant-nav__status.is-running[data-v-50f126bd] {\n  color: var(--el-color-primary, #409eff);\n}\n.assistant-nav__status.is-waiting[data-v-50f126bd] {\n  color: var(--el-color-warning, #e6a23c);\n}\n.assistant-nav__status.is-failed[data-v-50f126bd] {\n  color: var(--el-color-danger, #f56c6c);\n}\n.assistant-nav__status.is-cancelled[data-v-50f126bd] {\n  color: var(--app-text-tertiary, #a8abb2);\n}\n.assistant-nav__status.is-unread[data-v-50f126bd] {\n  color: var(--el-color-warning, #e6a23c);\n}\n.assistant-nav__status.is-done[data-v-50f126bd] {\n  color: var(--el-color-success, #67c23a);\n}\n.assistant-nav__status.is-spinning[data-v-50f126bd] {\n  animation: assistant-nav-spin-50f126bd 1s linear infinite;\n}\n@keyframes assistant-nav-spin-50f126bd {\nfrom {\n    transform: rotate(0deg);\n}\nto {\n    transform: rotate(360deg);\n}\n}\n.assistant-nav__main[data-v-50f126bd] {\n  flex: 1;\n  min-width: 0;\n  display: flex;\n  flex-direction: column;\n}\n.assistant-nav__name[data-v-50f126bd] {\n  font-size: 12px;\n  font-weight: 500;\n  color: var(--app-text);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-nav__meta[data-v-50f126bd] {\n  display: flex;\n  align-items: center;\n  gap: 4px;\n  margin-top: 2px;\n  font-size: 10px;\n  color: var(--app-text-secondary);\n}\n.assistant-nav__unread[data-v-50f126bd] {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--el-color-primary, #409eff);\n}\n.assistant-nav__delete[data-v-50f126bd] {\n  flex-shrink: 0;\n  border: none;\n  background: none;\n  cursor: pointer;\n  padding: 2px 4px;\n  border-radius: 6px;\n  font-size: 13px;\n  color: var(--app-text-tertiary, var(--app-text-secondary));\n  opacity: 0;\n  transition: opacity 0.15s, color 0.15s;\n}\n.assistant-nav__delete[data-v-50f126bd]:hover:not(:disabled) {\n  color: var(--el-color-danger, #f56c6c);\n}\n.assistant-nav__delete[data-v-50f126bd]:disabled {\n  cursor: not-allowed;\n  opacity: 0.35;\n}\n.assistant-nav__loading[data-v-50f126bd],\n.assistant-nav__more[data-v-50f126bd] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  width: 100%;\n  padding: 10px 0;\n  font-size: 11px;\n  color: var(--app-text-secondary);\n  background: none;\n  border: none;\n  cursor: pointer;\n}\n.assistant-nav__loading[data-v-50f126bd]:hover,\n.assistant-nav__more[data-v-50f126bd]:hover {\n  color: var(--app-text);\n}\n.is-spinning[data-v-50f126bd] {\n  animation: assistant-nav-spin-50f126bd 1s linear infinite;\n}\n.assistant-nav__delete-desc[data-v-50f126bd] {\n  margin: 0;\n  font-size: 13px;\n  color: var(--app-text);\n  line-height: 1.6;\n}\n.assistant-nav__delete-error[data-v-50f126bd] {\n  margin: 8px 0 0;\n  font-size: 12px;\n  color: var(--el-color-danger, #f56c6c);\n}\n.assistant-nav__delete-actions[data-v-50f126bd] {\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n}";
const AssistantConversationNav = /* @__PURE__ */ _export_sfc(_sfc_main$f, [["styles", [_style_0$f]], ["__scopeId", "data-v-50f126bd"]]);
const _hoisted_1$e = {
  key: 0,
  class: "ia-empty__icon"
};
const _hoisted_2$a = {
  key: 0,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
};
const _hoisted_3$8 = {
  key: 1,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
};
const _hoisted_4$7 = {
  key: 2,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
};
const _hoisted_5$7 = {
  key: 3,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
};
const _hoisted_6$7 = {
  key: 1,
  class: "ia-empty__icon"
};
const _hoisted_7$7 = {
  key: 2,
  class: "ia-empty__title"
};
const _hoisted_8$6 = {
  key: 3,
  class: "ia-empty__title"
};
const _hoisted_9$5 = {
  key: 4,
  class: "ia-empty__desc"
};
const _hoisted_10$5 = {
  key: 5,
  class: "ia-empty__action"
};
const _sfc_main$e = /* @__PURE__ */ defineComponent({
  ...{ name: "IaEmpty" },
  __name: "IaEmpty",
  props: {
    type: { default: "empty", type: String },
    title: { default: "", type: String },
    description: { default: "", type: String }
  },
  setup(__props) {
    const props = __props;
    const slots = useSlots();
    const { t } = useI18n();
    const resolvedTitle = computed(() => props.title || t("emptyState.empty"));
    const hasCustomIcon = computed(() => !!slots.icon);
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", {
        class: normalizeClass(["ia-empty", [`type-${__props.type}`]]),
        role: "status"
      }, [
        !hasCustomIcon.value ? (openBlock(), createElementBlock("div", _hoisted_1$e, [
          __props.type === "empty" ? (openBlock(), createElementBlock("svg", _hoisted_2$a, [..._cache[0] || (_cache[0] = [
            createBaseVNode("path", {
              d: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
              "stroke-linecap": "round",
              "stroke-linejoin": "round"
            }, null, -1)
          ])])) : __props.type === "error" ? (openBlock(), createElementBlock("svg", _hoisted_3$8, [..._cache[1] || (_cache[1] = [
            createBaseVNode("circle", {
              cx: "12",
              cy: "12",
              r: "10"
            }, null, -1),
            createBaseVNode("path", {
              d: "M12 8v4m0 4h.01",
              "stroke-linecap": "round"
            }, null, -1)
          ])])) : __props.type === "search" ? (openBlock(), createElementBlock("svg", _hoisted_4$7, [..._cache[2] || (_cache[2] = [
            createBaseVNode("circle", {
              cx: "11",
              cy: "11",
              r: "8"
            }, null, -1),
            createBaseVNode("path", {
              d: "m21 21-4.35-4.35",
              "stroke-linecap": "round"
            }, null, -1)
          ])])) : (openBlock(), createElementBlock("svg", _hoisted_5$7, [..._cache[3] || (_cache[3] = [
            createBaseVNode("circle", {
              cx: "11",
              cy: "11",
              r: "8"
            }, null, -1),
            createBaseVNode("path", {
              d: "m21 21-4.35-4.35M8 8l6 6M14 8l-6 6",
              "stroke-linecap": "round"
            }, null, -1)
          ])]))
        ])) : (openBlock(), createElementBlock("div", _hoisted_6$7, [
          renderSlot(_ctx.$slots, "icon", {}, void 0)
        ])),
        !_ctx.$slots.default ? (openBlock(), createElementBlock("p", _hoisted_7$7, toDisplayString(resolvedTitle.value), 1)) : (openBlock(), createElementBlock("p", _hoisted_8$6, [
          renderSlot(_ctx.$slots, "default", {}, void 0)
        ])),
        __props.description ? (openBlock(), createElementBlock("p", _hoisted_9$5, toDisplayString(__props.description), 1)) : createCommentVNode("", true),
        _ctx.$slots.action ? (openBlock(), createElementBlock("div", _hoisted_10$5, [
          renderSlot(_ctx.$slots, "action", {}, void 0)
        ])) : createCommentVNode("", true)
      ], 2);
    };
  }
});
const _style_0$e = "\n.ia-empty[data-v-052bbcb7] {\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  padding: 32px;\n  text-align: center;\n  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));\n}\n.ia-empty__icon[data-v-052bbcb7] {\n  width: 64px;\n  height: 64px;\n  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));\n  margin-bottom: 12px;\n}\n.ia-empty__icon svg[data-v-052bbcb7] { width: 100%; height: 100%; display: block;\n}\n.ia-empty__title[data-v-052bbcb7] {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 500;\n  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));\n}\n.ia-empty__desc[data-v-052bbcb7] {\n  margin: 6px 0 0;\n  font-size: 12px;\n  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));\n  max-width: 320px;\n}\n.ia-empty__action[data-v-052bbcb7] {\n  margin-top: 12px;\n  display: flex;\n  gap: 8px;\n  align-items: center;\n}\n";
const IaEmpty = /* @__PURE__ */ _export_sfc(_sfc_main$e, [["styles", [_style_0$e]], ["__scopeId", "data-v-052bbcb7"]]);
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const HTTP_URL = /^https?:\/\//i;
function renderCodeBlock(info, body) {
  const lang = info.trim().split(/\s+/)[0] ?? "";
  return {
    html: [
      '<div class="md-codeblock">',
      `<div class="md-codeblock__head"><span class="md-code-lang">${lang || "text"}</span></div>`,
      `<pre class="md-pre"><code class="md-code">${body.replace(/\n$/, "")}</code></pre>`,
      "</div>"
    ].join("")
  };
}
function renderInline(escaped) {
  const codes = [];
  let text = escaped.replace(/`([^`]+)`/g, (_m, code) => {
    codes.push(code);
    return `\0${codes.length - 1}\0`;
  });
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, url) => {
    if (!HTTP_URL.test(url)) return `${alt} (${url})`;
    return `<img class="md-img" src="${url}" alt="${alt}" loading="lazy">`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    if (!HTTP_URL.test(url)) return `${label} (${url})`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>");
  return text.replace(/\x00(\d+)\x00/g, (_m, index) => {
    const code = codes[Number(index)] ?? "";
    return `<code class="md-code">${code}</code>`;
  });
}
function isTableSeparator(line) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}
function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}
function renderTable(headerCells, bodyRows) {
  const head = `<thead><tr>${headerCells.map((cell) => `<th>${renderInline(cell)}</th>`).join("")}</tr></thead>`;
  const body = `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table class="md-table">${head}${body}</table>`;
}
function renderMarkdown(source) {
  if (!source || !source.trim()) return "";
  const lines = escapeHtml(source.replace(/\r\n?/g, "\n")).split("\n");
  const blocks = [];
  let paragraph = [];
  let listItems = [];
  let listOrdered = false;
  let quoteLines = [];
  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(`<p class="md-p">${renderInline(paragraph.join("<br>"))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    const tag = listOrdered ? "ol" : "ul";
    const orderedClass = listOrdered ? " md-list--ordered" : "";
    blocks.push(`<${tag} class="md-list${orderedClass}">${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${tag}>`);
    listItems = [];
  };
  const flushQuote = () => {
    if (quoteLines.length === 0) return;
    blocks.push(`<blockquote class="md-quote">${renderInline(quoteLines.join("<br>"))}</blockquote>`);
    quoteLines = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*(.*)$/);
    if (fence) {
      flushAll();
      const marker = fence[1] ?? "```";
      const info = fence[2] ?? "";
      const body = [];
      let closed = false;
      for (i = i + 1; i < lines.length; i++) {
        if (new RegExp(`^\\s*${marker[0]}{3,}\\s*$`).test(lines[i] ?? "")) {
          closed = true;
          break;
        }
        body.push(lines[i] ?? "");
      }
      blocks.push(renderCodeBlock(info, body.join("\n")).html);
      if (!closed) break;
      continue;
    }
    if (/^\s*&gt;\s?/.test(line) || /^\s*>\s?/.test(line)) {
      flushParagraph();
      flushList();
      quoteLines.push(line.replace(/^\s*(&gt;|>)\s?/, ""));
      continue;
    }
    flushQuote();
    const nextLine = lines[i + 1] ?? "";
    if (line.includes("|") && isTableSeparator(nextLine)) {
      flushAll();
      const header = splitTableRow(line);
      const rows = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|")) {
        rows.push(splitTableRow(lines[i] ?? ""));
        i += 1;
      }
      i -= 1;
      blocks.push(renderTable(header, rows));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flushAll();
      blocks.push('<hr class="md-hr">');
      continue;
    }
    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushAll();
      const level = (heading[1] ?? "#").length;
      blocks.push(`<h${level} class="md-heading">${renderInline(heading[2] ?? "")}</h${level}>`);
      continue;
    }
    const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = !!ordered;
      if (listItems.length > 0 && isOrdered !== listOrdered) flushList();
      listOrdered = isOrdered;
      listItems.push((unordered?.[1] ?? ordered?.[1] ?? "").trim());
      continue;
    }
    flushList();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushAll();
  return blocks.join("");
}
const _hoisted_1$d = ["innerHTML"];
const _sfc_main$d = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantMarkdown" },
  __name: "AssistantMarkdown",
  props: {
    content: { type: String },
    compact: { type: Boolean, default: false }
  },
  setup(__props) {
    const props = __props;
    const html = computed(() => renderMarkdown(props.content));
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", {
        class: normalizeClass(["assistant-markdown", { "is-compact": __props.compact }]),
        "data-testid": "assistant-markdown",
        innerHTML: html.value
      }, null, 10, _hoisted_1$d);
    };
  }
});
const _style_0$d = ".assistant-markdown[data-v-3e16e316] {\n  min-width: 0;\n  font-size: 13px;\n  line-height: 1.7;\n  color: var(--app-text);\n  word-break: break-word;\n}\n.assistant-markdown[data-v-3e16e316] .md-p {\n  margin: 0 0 8px;\n  white-space: pre-wrap;\n}\n.assistant-markdown[data-v-3e16e316] .md-p:last-child {\n  margin-bottom: 0;\n}\n.assistant-markdown[data-v-3e16e316] .md-heading {\n  margin: 10px 0 6px;\n  font-weight: 600;\n  line-height: 1.4;\n}\n.assistant-markdown[data-v-3e16e316] .md-heading:first-child {\n  margin-top: 0;\n}\n.assistant-markdown[data-v-3e16e316] h1.md-heading {\n  font-size: 17px;\n}\n.assistant-markdown[data-v-3e16e316] h2.md-heading {\n  font-size: 16px;\n}\n.assistant-markdown[data-v-3e16e316] h3.md-heading {\n  font-size: 15px;\n}\n.assistant-markdown[data-v-3e16e316] h4.md-heading {\n  font-size: 14px;\n}\n.assistant-markdown[data-v-3e16e316] h5.md-heading, .assistant-markdown[data-v-3e16e316] h6.md-heading {\n  font-size: 13px;\n}\n.assistant-markdown[data-v-3e16e316] .md-list {\n  margin: 0 0 8px;\n  padding-left: 20px;\n}\n.assistant-markdown[data-v-3e16e316] .md-list:last-child {\n  margin-bottom: 0;\n}\n.assistant-markdown[data-v-3e16e316] .md-list li {\n  margin: 2px 0;\n}\n.assistant-markdown[data-v-3e16e316] .md-quote {\n  margin: 0 0 8px;\n  padding: 4px 10px;\n  border-left: 3px solid var(--app-separator, var(--el-border-color, #dcdfe6));\n  color: var(--app-text-secondary);\n}\n.assistant-markdown[data-v-3e16e316] .md-quote:last-child {\n  margin-bottom: 0;\n}\n.assistant-markdown[data-v-3e16e316] .md-hr {\n  margin: 10px 0;\n  border: none;\n  border-top: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));\n}\n.assistant-markdown[data-v-3e16e316] .md-table {\n  display: block;\n  width: 100%;\n  margin: 0 0 8px;\n  overflow-x: auto;\n  border-collapse: collapse;\n  font-size: 12px;\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));\n  border-radius: 6px;\n}\n.assistant-markdown[data-v-3e16e316] .md-table:last-child {\n  margin-bottom: 0;\n}\n.assistant-markdown[data-v-3e16e316] .md-table th, .assistant-markdown[data-v-3e16e316] .md-table td {\n  padding: 6px 10px;\n  text-align: left;\n  border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));\n}\n.assistant-markdown[data-v-3e16e316] .md-table th {\n  font-weight: 600;\n  white-space: nowrap;\n  background: var(--app-bg-muted, #f5f5f7);\n}\n.assistant-markdown[data-v-3e16e316] .md-table tbody tr:last-child td {\n  border-bottom: none;\n}\n.assistant-markdown[data-v-3e16e316] .md-codeblock {\n  margin: 0 0 8px;\n  overflow: hidden;\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));\n  border-radius: 8px;\n}\n.assistant-markdown[data-v-3e16e316] .md-codeblock:last-child {\n  margin-bottom: 0;\n}\n.assistant-markdown[data-v-3e16e316] .md-codeblock__head {\n  display: flex;\n  align-items: center;\n  padding: 4px 10px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 11px;\n  font-weight: 600;\n  color: var(--app-text-secondary);\n  background: var(--app-bg-muted, #f5f5f7);\n}\n.assistant-markdown[data-v-3e16e316] .md-pre {\n  margin: 0;\n  padding: 10px 12px;\n  overflow-x: auto;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 12px;\n  line-height: 1.6;\n  background: var(--app-bg-muted, #f5f5f7);\n}\n.assistant-markdown[data-v-3e16e316] .md-code {\n  padding: 1px 5px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 0.86em;\n  border-radius: 4px;\n  background: var(--app-bg-muted, #f5f5f7);\n}\n.assistant-markdown[data-v-3e16e316] .md-pre .md-code {\n  padding: 0;\n  background: transparent;\n}\n.assistant-markdown[data-v-3e16e316] a {\n  color: var(--el-color-primary, #409eff);\n  text-decoration: none;\n}\n.assistant-markdown[data-v-3e16e316] a:hover {\n  text-decoration: underline;\n}\n.assistant-markdown[data-v-3e16e316] .md-img {\n  max-width: 100%;\n  border-radius: 8px;\n}\n.assistant-markdown.is-compact[data-v-3e16e316] {\n  font-size: 12px;\n  line-height: 1.6;\n  color: var(--app-text-secondary);\n}\n.assistant-markdown.is-compact[data-v-3e16e316] .md-heading {\n  font-size: 12px;\n}";
const AssistantMarkdown = /* @__PURE__ */ _export_sfc(_sfc_main$d, [["styles", [_style_0$d]], ["__scopeId", "data-v-3e16e316"]]);
const REASONING_TIMER_INTERVAL_MS = 100;
function useReasoningElapsedMs(startedAtMs, durationMs, active2) {
  const now = /* @__PURE__ */ ref(Date.now());
  let timer = null;
  const running = computed(
    () => active2.value && durationMs.value === void 0 && startedAtMs.value !== void 0
  );
  const updateNow = () => {
    now.value = Date.now();
  };
  watch(
    running,
    (isRunning) => {
      if (isRunning && timer === null) {
        updateNow();
        timer = setInterval(updateNow, REASONING_TIMER_INTERVAL_MS);
        window.addEventListener("focus", updateNow);
        document.addEventListener("visibilitychange", updateNow);
      } else if (!isRunning && timer !== null) {
        clearInterval(timer);
        timer = null;
        window.removeEventListener("focus", updateNow);
        document.removeEventListener("visibilitychange", updateNow);
      }
    },
    { immediate: true }
  );
  onBeforeUnmount(() => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    window.removeEventListener("focus", updateNow);
    document.removeEventListener("visibilitychange", updateNow);
  });
  return computed(() => {
    if (durationMs.value !== void 0) return durationMs.value;
    if (!running.value || startedAtMs.value === void 0) return void 0;
    return Math.max(0, now.value - startedAtMs.value);
  });
}
const _hoisted_1$c = { class: "assistant-reasoning" };
const _sfc_main$c = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantReasoning" },
  __name: "AssistantReasoning",
  props: {
    text: { type: String },
    startedAtMs: { type: Number },
    durationMs: { type: Number },
    streaming: { type: Boolean, default: false }
  },
  setup(__props) {
    const props = __props;
    const { t } = useI18n();
    const elapsed = useReasoningElapsedMs(
      /* @__PURE__ */ toRef(props, "startedAtMs"),
      /* @__PURE__ */ toRef(props, "durationMs"),
      /* @__PURE__ */ toRef(props, "streaming")
    );
    const title = computed(() => {
      const ms = elapsed.value;
      if (ms !== void 0) return t("notification.reasoning-duration", { s: (ms / 1e3).toFixed(1) });
      return t("notification.reasoning");
    });
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("details", _hoisted_1$c, [
        createBaseVNode("summary", null, toDisplayString(title.value), 1),
        createVNode(AssistantMarkdown, {
          compact: "",
          content: __props.text
        }, null, 8, ["content"])
      ]);
    };
  }
});
const _style_0$c = ".assistant-reasoning[data-v-f2aa0c94] {\n  min-width: 0;\n}\n.assistant-reasoning summary[data-v-f2aa0c94] {\n  cursor: pointer;\n  font-size: 12px;\n  color: var(--app-text-secondary, var(--app-text));\n  user-select: none;\n}";
const AssistantReasoning = /* @__PURE__ */ _export_sfc(_sfc_main$c, [["styles", [_style_0$c]], ["__scopeId", "data-v-f2aa0c94"]]);
const _hoisted_1$b = ["title"];
const _sfc_main$b = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantScopeChip" },
  __name: "AssistantScopeChip",
  props: {
    scope: { type: Object }
  },
  setup(__props) {
    const { t } = useI18n();
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("p", {
        class: normalizeClass(["assistant-scope-chip", { "is-degraded": __props.scope.degraded }]),
        title: __props.scope.summary || void 0,
        "data-testid": "assistant-confirm-scope"
      }, [
        createBaseVNode("i", {
          class: normalizeClass(__props.scope.degraded ? "ri-shield-keyhole-line" : "ri-guide-line")
        }, null, 2),
        createBaseVNode("span", null, toDisplayString(__props.scope.degraded ? unref(t)("assistant.confirm-scope-degraded") : __props.scope.summary ? unref(t)("assistant.confirm-scope-resolved", { summary: __props.scope.summary }) : unref(t)("assistant.confirm-scope-resolved-default")), 1)
      ], 10, _hoisted_1$b);
    };
  }
});
const _style_0$b = '@charset "UTF-8";\n.assistant-scope-chip[data-v-a46d18b1] {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  max-width: 100%;\n  margin: 4px 0 0;\n  padding: 2px 8px;\n  border-radius: 999px;\n  font-size: 11px;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-scope-chip > i[data-v-a46d18b1] {\n  flex-shrink: 0;\n  font-size: 12px;\n}\n.assistant-scope-chip[data-v-a46d18b1] {\n  /* resolved:信息性标记 */\n  color: var(--app-text-secondary);\n  background: var(--app-bg-muted, #f5f5f7);\n  /* degraded:弱警示(PRD §6.1.4 降级语义,不阻塞确认流) */\n}\n.assistant-scope-chip.is-degraded[data-v-a46d18b1] {\n  color: var(--app-color-warning, var(--el-color-warning, #e6a23c));\n  background: var(--el-color-warning-light-9, #fdf6ec);\n}';
const AssistantScopeChip = /* @__PURE__ */ _export_sfc(_sfc_main$b, [["styles", [_style_0$b]], ["__scopeId", "data-v-a46d18b1"]]);
const TASK_MEDIA_URL_LINE_REGEXP = /((?:视频地址|下载地址)[:：]\s*)(https?:\/\/[^\s)]+|\/media\/[^\s)]+)/g;
function parseTaskMediaLinks(content) {
  const mediaLinks = [];
  const markdownLines = content.split(/\r?\n/).map((line) => {
    let extracted = false;
    const strippedLine = line.replace(
      TASK_MEDIA_URL_LINE_REGEXP,
      (_match, prefix, rawUrl) => {
        const resolvedUrl = resolveMediaUrl(rawUrl) || rawUrl;
        mediaLinks.push({
          label: prefix.replace(/[:：]\s*$/, "").trim() || "下载地址",
          rawUrl,
          resolvedUrl
        });
        extracted = true;
        return "";
      }
    );
    if (!extracted) {
      return line;
    }
    return strippedLine.replace(/[·:：\s-]+$/g, "").trimEnd();
  });
  return {
    markdownContent: markdownLines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    mediaLinks
  };
}
function formatApprovalCountdown(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1e3));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor(totalSeconds % 86400 / 3600);
  const minutes = Math.floor(totalSeconds % 3600 / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分 ${seconds} 秒`;
}
function useToolConfirmationCountdown(expiresAt, updateEverySecond = true) {
  const parsed = computed(() => {
    const value = toValue(expiresAt);
    if (value === void 0) return void 0;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) {
      throw new Error("Tool confirmation expiry is invalid");
    }
    return ms;
  });
  const now = /* @__PURE__ */ ref(Date.now());
  let timer = null;
  const stopTimer = () => {
    if (timer) {
      updateEverySecond ? clearInterval(timer) : clearTimeout(timer);
      timer = null;
    }
  };
  const update = () => {
    now.value = Date.now();
  };
  if (typeof window !== "undefined") {
    watch(parsed, () => {
      stopTimer();
      update();
      if (parsed.value === void 0) return;
      timer = updateEverySecond ? setInterval(update, 1e3) : setTimeout(update, Math.max(0, parsed.value - Date.now()));
    }, { immediate: true });
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    onUnmounted(() => {
      stopTimer();
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    });
  }
  return computed(() => {
    if (parsed.value === void 0) return void 0;
    const remainingMs = Math.max(0, parsed.value - now.value);
    return {
      expired: remainingMs === 0,
      label: formatApprovalCountdown(remainingMs)
    };
  });
}
const _hoisted_1$a = {
  class: "assistant-timeline",
  "data-testid": "assistant-timeline"
};
const _hoisted_2$9 = {
  key: 0,
  class: "assistant-timeline__tool-wrap"
};
const _hoisted_3$7 = ["data-testid"];
const _hoisted_4$6 = { class: "assistant-timeline__tool-name" };
const _hoisted_5$6 = {
  key: 0,
  class: "assistant-timeline__countdown"
};
const _hoisted_6$6 = {
  key: 2,
  class: "assistant-timeline__plan"
};
const _hoisted_7$6 = { class: "assistant-timeline__plan-summary" };
const _hoisted_8$5 = ["data-testid"];
const _hoisted_9$4 = {
  key: 4,
  class: "assistant-timeline__children-wrap"
};
const _hoisted_10$4 = ["data-testid", "onClick"];
const _hoisted_11$4 = { key: 0 };
const _hoisted_12$3 = { key: 1 };
const _hoisted_13$2 = {
  key: 0,
  class: "assistant-timeline__children"
};
const _hoisted_14$2 = {
  key: 2,
  class: "assistant-timeline__child-tool"
};
const _hoisted_15$2 = { class: "assistant-timeline__tool-name" };
const _hoisted_16$2 = {
  key: 0,
  class: "assistant-timeline__countdown"
};
const _hoisted_17$2 = ["data-testid"];
const _hoisted_18$2 = {
  key: 3,
  class: "assistant-timeline__plan"
};
const _hoisted_19$2 = { class: "assistant-timeline__plan-summary" };
const _hoisted_20$2 = {
  key: 0,
  class: "assistant-timeline__media-list"
};
const _hoisted_21$2 = { class: "assistant-media-card__info" };
const _hoisted_22$2 = { class: "assistant-media-card__label" };
const _hoisted_23$2 = ["href", "title"];
const _hoisted_24$1 = ["href"];
const _sfc_main$a = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantTimeline" },
  __name: "AssistantTimeline",
  props: {
    items: { type: Array },
    confirmation: { type: Object },
    streaming: { type: Boolean }
  },
  emits: ["decision"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    const { t } = useI18n();
    const SUB_AGENT_DONE_STATUSES = ["done", "error", "cancelled", "rejected", "expired"];
    const SUB_AGENT_ACTIVE_STATUSES = ["calling", "awaiting_approval", "approved"];
    const expandedSubAgents = /* @__PURE__ */ ref(/* @__PURE__ */ new Set());
    function subAgentExpanded(item) {
      if (item.status === "calling") return true;
      return expandedSubAgents.value.has(item.id);
    }
    function toggleSubAgent(id) {
      const next = new Set(expandedSubAgents.value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      expandedSubAgents.value = next;
    }
    function subAgentProgress(item) {
      const children = item.children ?? [];
      const total = children.filter((c) => c.type === "tool").length;
      if (total === 0) return "";
      const done = children.filter((c) => c.type === "tool" && SUB_AGENT_DONE_STATUSES.includes(c.status)).length;
      const active2 = children.filter((c) => c.type === "tool" && SUB_AGENT_ACTIVE_STATUSES.includes(c.status)).length;
      if (item.status === "calling") {
        return active2 > 0 ? t("assistant.subagent-progress-doing", { label: `${done}/${total}` }) : t("assistant.subagent-progress-ran", { label: total });
      }
      return t("assistant.subagent-progress-done", { label: total });
    }
    const EMPTY_CONTENT_PARTS = { markdownContent: "", mediaLinks: [] };
    const contentPartsByIndex = computed(
      () => props.items.map(
        (item) => item.type === "content" ? parseTaskMediaLinks(item.text) : EMPTY_CONTENT_PARTS
      )
    );
    function contentParts(index) {
      return contentPartsByIndex.value[index] ?? EMPTY_CONTENT_PARTS;
    }
    const singleToolBatch = computed(() => props.confirmation?.toolCallIds.length === 1 ? props.confirmation : void 0);
    function isConfirmedTool(id, parentToolCallId) {
      const confirmation = props.confirmation;
      if (!confirmation) return false;
      if ((confirmation.parentToolCallId ?? void 0) !== (parentToolCallId ?? void 0)) return false;
      return confirmation.toolCallIds.includes(id);
    }
    const countdown = useToolConfirmationCountdown(
      () => singleToolBatch.value ? singleToolBatch.value.expiresAt : void 0
    );
    function toolStatusKey(status) {
      switch (status) {
        case "preparing":
          return "notification.tool-preparing";
        case "calling":
          return "notification.tool-calling";
        case "awaiting_approval":
          return "notification.tool-awaiting";
        case "approved":
          return "notification.tool-calling";
        case "rejected":
          return "notification.tool-rejected";
        case "expired":
          return "notification.tool-expired";
        case "done":
          return "notification.status-done";
        case "error":
          return "notification.status-error";
        default:
          return "notification.status-cancelled";
      }
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", _hoisted_1$a, [
        (openBlock(true), createElementBlock(Fragment, null, renderList(__props.items, (item, index) => {
          return openBlock(), createElementBlock(Fragment, {
            key: `${item.type}-${index}`
          }, [
            item.type === "tool" ? (openBlock(), createElementBlock("div", _hoisted_2$9, [
              createBaseVNode("div", {
                class: "assistant-timeline__tool",
                "data-testid": `assistant-tool-${index}`
              }, [
                _cache[0] || (_cache[0] = createBaseVNode("i", {
                  class: "ri-tools-line",
                  "aria-hidden": "true"
                }, null, -1)),
                createBaseVNode("span", _hoisted_4$6, toDisplayString(unref(getToolDisplayName)(item.name)), 1),
                createBaseVNode("span", {
                  class: normalizeClass(["assistant-timeline__tool-status", `is-${item.status}`])
                }, toDisplayString(unref(t)(toolStatusKey(item.status))), 3),
                isConfirmedTool(item.id, void 0) && item.status === "awaiting_approval" && singleToolBatch.value && unref(countdown) && !unref(countdown).expired ? (openBlock(), createElementBlock("span", _hoisted_5$6, toDisplayString(unref(t)("assistant.tool-awaiting", { time: unref(countdown).label })), 1)) : createCommentVNode("", true),
                isConfirmedTool(item.id, void 0) && item.status === "awaiting_approval" && singleToolBatch.value?.scope ? (openBlock(), createBlock(AssistantScopeChip, {
                  key: 1,
                  scope: singleToolBatch.value.scope
                }, null, 8, ["scope"])) : createCommentVNode("", true),
                item.plan ? (openBlock(), createElementBlock("div", _hoisted_6$6, [
                  createBaseVNode("p", _hoisted_7$6, toDisplayString(item.plan.summary), 1),
                  (openBlock(true), createElementBlock(Fragment, null, renderList(item.plan.changes, (change, ci) => {
                    return openBlock(), createElementBlock("p", {
                      key: ci,
                      class: "assistant-timeline__plan-change"
                    }, toDisplayString(change.field) + ": " + toDisplayString(change.before) + " → " + toDisplayString(change.after), 1);
                  }), 128))
                ])) : createCommentVNode("", true),
                __props.confirmation && isConfirmedTool(item.id, void 0) && item.status === "awaiting_approval" && __props.confirmation.showActions && !unref(countdown)?.expired ? (openBlock(), createElementBlock("div", {
                  key: 3,
                  class: "assistant-timeline__confirm",
                  "data-testid": `assistant-confirm-${item.id}`
                }, [
                  createVNode(IaButton, {
                    variant: "secondary",
                    size: "sm",
                    disabled: __props.confirmation.submitting,
                    "data-testid": `assistant-reject-${item.id}`,
                    onClick: ($event) => emit2("decision", item.id, false)
                  }, {
                    default: withCtx(() => [
                      createTextVNode(toDisplayString(unref(t)("assistant.confirm-reject")), 1)
                    ]),
                    _: 1
                  }, 8, ["disabled", "data-testid", "onClick"]),
                  createVNode(IaButton, {
                    size: "sm",
                    disabled: __props.confirmation.submitting,
                    "data-testid": `assistant-approve-${item.id}`,
                    onClick: ($event) => emit2("decision", item.id, true)
                  }, {
                    default: withCtx(() => [
                      createTextVNode(toDisplayString(unref(t)("assistant.confirm-approve")), 1)
                    ]),
                    _: 1
                  }, 8, ["disabled", "data-testid", "onClick"])
                ], 8, _hoisted_8$5)) : createCommentVNode("", true),
                item.children && item.children.length ? (openBlock(), createElementBlock("div", _hoisted_9$4, [
                  createBaseVNode("button", {
                    type: "button",
                    class: "assistant-timeline__children-toggle",
                    "data-testid": `subagent-toggle-${index}`,
                    onClick: ($event) => toggleSubAgent(item.id)
                  }, [
                    createBaseVNode("i", {
                      class: normalizeClass(subAgentExpanded(item) ? "ri-arrow-down-s-line" : "ri-arrow-right-s-line")
                    }, null, 2),
                    subAgentProgress(item) ? (openBlock(), createElementBlock("span", _hoisted_11$4, toDisplayString(subAgentProgress(item)), 1)) : (openBlock(), createElementBlock("span", _hoisted_12$3, toDisplayString(item.agentName || unref(t)("assistant.subagent-default")), 1))
                  ], 8, _hoisted_10$4),
                  subAgentExpanded(item) ? (openBlock(), createElementBlock("div", _hoisted_13$2, [
                    (openBlock(true), createElementBlock(Fragment, null, renderList(item.children, (child, chi) => {
                      return openBlock(), createElementBlock(Fragment, {
                        key: `c-${chi}`
                      }, [
                        child.type === "reasoning" ? (openBlock(), createBlock(AssistantReasoning, {
                          key: 0,
                          text: child.text,
                          "started-at-ms": child.startedAtMs,
                          "duration-ms": child.durationMs,
                          class: "assistant-timeline__child-reasoning"
                        }, null, 8, ["text", "started-at-ms", "duration-ms"])) : child.type === "content" ? (openBlock(), createBlock(AssistantMarkdown, {
                          key: 1,
                          class: "assistant-timeline__sub-content",
                          compact: "",
                          content: child.text
                        }, null, 8, ["content"])) : (openBlock(), createElementBlock("div", _hoisted_14$2, [
                          createBaseVNode("span", _hoisted_15$2, toDisplayString(unref(getToolDisplayName)(child.name)), 1),
                          createBaseVNode("span", {
                            class: normalizeClass(["assistant-timeline__tool-status", `is-${child.status}`])
                          }, toDisplayString(unref(t)(toolStatusKey(child.status))), 3),
                          __props.confirmation && isConfirmedTool(child.id, item.id) && child.status === "awaiting_approval" && singleToolBatch.value && unref(countdown) && !unref(countdown).expired ? (openBlock(), createElementBlock("span", _hoisted_16$2, toDisplayString(unref(t)("assistant.tool-awaiting", { time: unref(countdown).label })), 1)) : createCommentVNode("", true),
                          __props.confirmation && isConfirmedTool(child.id, item.id) && child.status === "awaiting_approval" && singleToolBatch.value?.scope ? (openBlock(), createBlock(AssistantScopeChip, {
                            key: 1,
                            scope: singleToolBatch.value.scope
                          }, null, 8, ["scope"])) : createCommentVNode("", true),
                          __props.confirmation && isConfirmedTool(child.id, item.id) && child.status === "awaiting_approval" && __props.confirmation.showActions && !unref(countdown)?.expired ? (openBlock(), createElementBlock("div", {
                            key: 2,
                            class: "assistant-timeline__confirm",
                            "data-testid": `assistant-confirm-${child.id}`
                          }, [
                            createVNode(IaButton, {
                              variant: "secondary",
                              size: "sm",
                              disabled: __props.confirmation.submitting,
                              "data-testid": `assistant-reject-${child.id}`,
                              onClick: ($event) => emit2("decision", child.id, false)
                            }, {
                              default: withCtx(() => [
                                createTextVNode(toDisplayString(unref(t)("assistant.confirm-reject")), 1)
                              ]),
                              _: 1
                            }, 8, ["disabled", "data-testid", "onClick"]),
                            createVNode(IaButton, {
                              size: "sm",
                              disabled: __props.confirmation.submitting,
                              "data-testid": `assistant-approve-${child.id}`,
                              onClick: ($event) => emit2("decision", child.id, true)
                            }, {
                              default: withCtx(() => [
                                createTextVNode(toDisplayString(unref(t)("assistant.confirm-approve")), 1)
                              ]),
                              _: 1
                            }, 8, ["disabled", "data-testid", "onClick"])
                          ], 8, _hoisted_17$2)) : createCommentVNode("", true),
                          child.plan ? (openBlock(), createElementBlock("div", _hoisted_18$2, [
                            createBaseVNode("p", _hoisted_19$2, toDisplayString(child.plan.summary), 1),
                            (openBlock(true), createElementBlock(Fragment, null, renderList(child.plan.changes, (change, ci) => {
                              return openBlock(), createElementBlock("p", {
                                key: ci,
                                class: "assistant-timeline__plan-change"
                              }, toDisplayString(change.field) + ": " + toDisplayString(change.before) + " → " + toDisplayString(change.after), 1);
                            }), 128))
                          ])) : createCommentVNode("", true)
                        ]))
                      ], 64);
                    }), 128))
                  ])) : createCommentVNode("", true)
                ])) : createCommentVNode("", true),
                item.status !== "calling" && item.status !== "preparing" && item.status !== "awaiting_approval" && item.result ? (openBlock(), createBlock(AssistantMarkdown, {
                  key: 5,
                  class: "assistant-timeline__result",
                  compact: "",
                  content: item.result
                }, null, 8, ["content"])) : createCommentVNode("", true)
              ], 8, _hoisted_3$7)
            ])) : item.type === "reasoning" ? (openBlock(), createBlock(AssistantReasoning, {
              key: 1,
              class: "assistant-timeline__reasoning",
              text: item.text,
              "started-at-ms": item.startedAtMs,
              "duration-ms": item.durationMs,
              streaming: __props.streaming
            }, null, 8, ["text", "started-at-ms", "duration-ms", "streaming"])) : (openBlock(), createElementBlock(Fragment, { key: 2 }, [
              createVNode(AssistantMarkdown, {
                class: "assistant-timeline__content",
                "data-testid": `assistant-content-${index}`,
                content: contentParts(index).markdownContent
              }, null, 8, ["data-testid", "content"]),
              contentParts(index).mediaLinks.length ? (openBlock(), createElementBlock("div", _hoisted_20$2, [
                (openBlock(true), createElementBlock(Fragment, null, renderList(contentParts(index).mediaLinks, (link, linkIndex) => {
                  return openBlock(), createElementBlock("div", {
                    key: `${link.resolvedUrl}-${linkIndex}`,
                    class: "assistant-media-card"
                  }, [
                    createBaseVNode("div", _hoisted_21$2, [
                      createBaseVNode("p", _hoisted_22$2, toDisplayString(link.label), 1),
                      createBaseVNode("a", {
                        class: "assistant-media-card__url",
                        href: link.resolvedUrl,
                        target: "_blank",
                        rel: "noreferrer",
                        title: link.resolvedUrl
                      }, toDisplayString(link.resolvedUrl), 9, _hoisted_23$2)
                    ]),
                    createBaseVNode("a", {
                      class: "assistant-media-card__download",
                      href: link.resolvedUrl,
                      target: "_blank",
                      rel: "noreferrer",
                      download: ""
                    }, [
                      _cache[1] || (_cache[1] = createBaseVNode("svg", {
                        class: "assistant-media-card__dl-icon",
                        viewBox: "0 0 24 24",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "2",
                        "aria-hidden": "true"
                      }, [
                        createBaseVNode("path", {
                          d: "M12 3v12m0 0 4-4m-4 4-4-4",
                          "stroke-linecap": "round",
                          "stroke-linejoin": "round"
                        }),
                        createBaseVNode("path", {
                          d: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
                          "stroke-linecap": "round"
                        })
                      ], -1)),
                      createTextVNode(" " + toDisplayString(unref(t)("assistant.media-download")), 1)
                    ], 8, _hoisted_24$1)
                  ]);
                }), 128))
              ])) : createCommentVNode("", true)
            ], 64))
          ], 64);
        }), 128))
      ]);
    };
  }
});
const _style_0$a = '@charset "UTF-8";\n.assistant-timeline[data-v-69560def] {\n  min-width: 0;\n  width: 100%;\n  display: flex;\n  flex-direction: column;\n  gap: 10px;\n}\n.assistant-timeline__content[data-v-69560def] {\n  margin: 0;\n  font-size: 13px;\n  line-height: 1.7;\n  color: var(--app-text);\n  word-break: break-word;\n}\n\n/* 媒体链接卡片 (对齐旧 TaskMediaLinks: 标签+链接+下载视频) */\n.assistant-timeline__media-list[data-v-69560def] {\n  display: flex;\n  flex-direction: column;\n  gap: 12px;\n  margin-top: 8px;\n}\n.assistant-media-card[data-v-69560def] {\n  display: flex;\n  align-items: flex-start;\n  justify-content: space-between;\n  gap: 12px;\n  padding: 12px 14px;\n  border: 1px solid var(--app-border, rgba(0, 0, 0, 0.1));\n  border-radius: 12px;\n  background: var(--app-surface-muted, rgba(0, 0, 0, 0.03));\n}\n.assistant-media-card__info[data-v-69560def] {\n  min-width: 0;\n  flex: 1;\n}\n.assistant-media-card__label[data-v-69560def] {\n  margin: 0;\n  font-size: 12px;\n  font-weight: 500;\n  color: var(--app-text-secondary, var(--app-text));\n}\n.assistant-media-card__url[data-v-69560def] {\n  display: block;\n  margin-top: 4px;\n  font-size: 12px;\n  line-height: 1.6;\n  word-break: break-all;\n  color: var(--app-text-secondary, var(--app-text));\n  text-decoration: underline dotted;\n  text-underline-offset: 2px;\n}\n.assistant-media-card__url[data-v-69560def]:hover {\n  color: var(--app-text);\n}\n.assistant-media-card__dl-icon[data-v-69560def] {\n  width: 14px;\n  height: 14px;\n}\n.assistant-media-card__download[data-v-69560def] {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  flex-shrink: 0;\n  padding: 8px 12px;\n  border: 1px solid var(--app-primary, #409eff);\n  border-radius: 8px;\n  font-size: 12px;\n  font-weight: 500;\n  color: var(--app-primary, #409eff);\n  text-decoration: none;\n}\n.assistant-media-card__download[data-v-69560def]:hover {\n  background: color-mix(in srgb, var(--app-primary, #409eff) 12%, transparent);\n}\n.assistant-timeline__reasoning[data-v-69560def] {\n  font-size: 12px;\n  color: var(--app-text-secondary);\n}\n.assistant-timeline__reasoning summary[data-v-69560def] {\n  cursor: pointer;\n  color: var(--app-text-tertiary, var(--app-text-secondary));\n}\n.assistant-timeline__reasoning .assistant-timeline__reasoning-text[data-v-69560def] {\n  margin: 6px 0 0;\n}\n.assistant-timeline__tool-wrap[data-v-69560def] {\n  /* 长会话性能: 视口外工具行跳过布局/绘制 (旧 timeline.tsx:44-49) */\n  content-visibility: auto;\n  contain-intrinsic-size: auto 48px;\n}\n.assistant-timeline__tool[data-v-69560def],\n.assistant-timeline__child-tool[data-v-69560def] {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  flex-wrap: wrap;\n  padding: 8px 10px;\n  border-radius: 8px;\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter));\n  font-size: 12px;\n}\n.assistant-timeline__tool > i[data-v-69560def],\n.assistant-timeline__child-tool > i[data-v-69560def] {\n  color: var(--app-text-tertiary, var(--app-text-secondary));\n}\n.assistant-timeline__child-tool[data-v-69560def] {\n  padding: 6px 8px;\n}\n.assistant-timeline__tool-name[data-v-69560def] {\n  font-weight: 500;\n  color: var(--app-text);\n}\n.assistant-timeline__tool-status[data-v-69560def] {\n  margin-left: auto;\n  font-size: 11px;\n}\n.assistant-timeline__tool-status.is-awaiting_approval[data-v-69560def] {\n  color: var(--el-color-warning, #e6a23c);\n}\n.assistant-timeline__tool-status.is-done[data-v-69560def] {\n  color: var(--el-color-success, #67c23a);\n}\n.assistant-timeline__tool-status.is-error[data-v-69560def] {\n  color: var(--el-color-danger, #f56c6c);\n}\n.assistant-timeline__tool-status.is-cancelled[data-v-69560def], .assistant-timeline__tool-status.is-rejected[data-v-69560def], .assistant-timeline__tool-status.is-expired[data-v-69560def] {\n  color: var(--app-text-tertiary, #a8abb2);\n}\n.assistant-timeline__tool-status.is-calling[data-v-69560def], .assistant-timeline__tool-status.is-approved[data-v-69560def], .assistant-timeline__tool-status.is-preparing[data-v-69560def] {\n  color: var(--el-color-primary, #409eff);\n}\n.assistant-timeline__countdown[data-v-69560def] {\n  font-size: 11px;\n  color: var(--el-color-warning, #e6a23c);\n  font-variant-numeric: tabular-nums;\n}\n.assistant-timeline__confirm[data-v-69560def] {\n  width: 100%;\n  display: flex;\n  justify-content: flex-end;\n  gap: 8px;\n  padding-top: 6px;\n  border-top: 1px dashed var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-timeline__plan[data-v-69560def] {\n  width: 100%;\n  padding-top: 6px;\n  border-top: 1px dashed var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-timeline__plan-summary[data-v-69560def] {\n  margin: 0 0 4px;\n  color: var(--app-text);\n}\n.assistant-timeline__plan-change[data-v-69560def] {\n  margin: 2px 0 0;\n  font-size: 11px;\n  color: var(--app-text-secondary);\n  font-variant-numeric: tabular-nums;\n}\n.assistant-timeline__children-wrap[data-v-69560def] {\n  width: 100%;\n}\n.assistant-timeline__children-toggle[data-v-69560def] {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  padding: 2px 6px;\n  margin: 4px 0;\n  border: none;\n  border-radius: 6px;\n  background: transparent;\n  font-size: 12px;\n  color: var(--app-text-secondary, var(--app-text));\n  cursor: pointer;\n}\n.assistant-timeline__children-toggle[data-v-69560def]:hover {\n  background: var(--app-fill-color, rgba(0, 0, 0, 0.04));\n}\n.assistant-timeline__children[data-v-69560def] {\n  width: 100%;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n  padding: 8px 10px;\n  border-top: 1px dashed var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-timeline__sub-content[data-v-69560def] {\n  margin: 0;\n  font-size: 12px;\n  line-height: 1.6;\n  color: var(--app-text-secondary);\n  word-break: break-word;\n}\n.assistant-timeline__result[data-v-69560def] {\n  width: 100%;\n  margin: 0;\n  font-size: 11px;\n  color: var(--app-text-secondary);\n  word-break: break-word;\n  max-height: 120px;\n  overflow-y: auto;\n}';
const AssistantTimeline = /* @__PURE__ */ _export_sfc(_sfc_main$a, [["styles", [_style_0$a]], ["__scopeId", "data-v-69560def"]]);
const _hoisted_1$9 = {
  key: 0,
  class: "assistant-confirm-bar",
  "aria-live": "polite",
  "data-testid": "assistant-batch-approval"
};
const _hoisted_2$8 = { class: "assistant-confirm-bar__main" };
const _hoisted_3$6 = { class: "assistant-confirm-bar__title" };
const _hoisted_4$5 = { class: "assistant-confirm-bar__hint" };
const _hoisted_5$5 = {
  key: 0,
  class: "assistant-confirm-bar__actions"
};
const _hoisted_6$5 = {
  key: 0,
  class: "ri-loader-4-line is-spinning"
};
const _hoisted_7$5 = {
  key: 0,
  class: "ri-loader-4-line is-spinning"
};
const _hoisted_8$4 = {
  key: 1,
  class: "ri-check-double-line"
};
const _sfc_main$9 = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantToolConfirmBar" },
  __name: "AssistantToolConfirmBar",
  props: {
    toolCallIds: { type: Array },
    decisions: { type: Object },
    submitting: { type: Boolean },
    showActions: { type: Boolean },
    expiresAt: { type: String },
    scopeDigest: { type: [Object, null] }
  },
  emits: ["decision"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    const { t } = useI18n();
    const countdown = useToolConfirmationCountdown(() => props.expiresAt);
    const expired = computed(() => countdown.value?.expired ?? false);
    const selectedCount = computed(() => props.toolCallIds.filter((toolCallId) => Object.prototype.hasOwnProperty.call(props.decisions, toolCallId)).length);
    const batchDecision = computed(() => selectedBatchDecision(props.toolCallIds, props.decisions));
    const visible = computed(() => props.showActions || expired.value);
    const hint = computed(() => {
      if (expired.value) return t("assistant.confirm-batch-expired");
      if (props.submitting) return t("assistant.confirm-batch-submitting", { n: props.toolCallIds.length });
      const selected = selectedCount.value > 0 ? t("assistant.confirm-batch-selected", { n: selectedCount.value, total: props.toolCallIds.length }) : "";
      return t("assistant.confirm-batch-waiting", {
        n: props.toolCallIds.length,
        selected,
        time: countdown.value?.label ?? ""
      });
    });
    return (_ctx, _cache) => {
      return visible.value && __props.toolCallIds.length >= 2 ? (openBlock(), createElementBlock("section", _hoisted_1$9, [
        createBaseVNode("span", {
          class: normalizeClass(["assistant-confirm-bar__icon", { "is-spinning": __props.submitting && !expired.value }])
        }, [
          createBaseVNode("i", {
            class: normalizeClass(expired.value ? "ri-time-line" : __props.submitting ? "ri-loader-4-line" : "ri-shield-check-line")
          }, null, 2)
        ], 2),
        createBaseVNode("div", _hoisted_2$8, [
          createBaseVNode("p", _hoisted_3$6, toDisplayString(unref(t)("assistant.confirm-batch-title")), 1),
          createBaseVNode("p", _hoisted_4$5, toDisplayString(hint.value), 1),
          __props.scopeDigest ? (openBlock(), createBlock(AssistantScopeChip, {
            key: 0,
            scope: __props.scopeDigest
          }, null, 8, ["scope"])) : createCommentVNode("", true)
        ]),
        !expired.value ? (openBlock(), createElementBlock("div", _hoisted_5$5, [
          createVNode(IaButton, {
            variant: "secondary",
            size: "sm",
            disabled: __props.submitting,
            "data-testid": "assistant-reject-all",
            onClick: _cache[0] || (_cache[0] = ($event) => emit2("decision", false))
          }, {
            default: withCtx(() => [
              __props.submitting && batchDecision.value === false ? (openBlock(), createElementBlock("i", _hoisted_6$5)) : createCommentVNode("", true),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.confirm-reject-all")), 1)
            ]),
            _: 1
          }, 8, ["disabled"]),
          createVNode(IaButton, {
            size: "sm",
            disabled: __props.submitting,
            "data-testid": "assistant-approve-all",
            onClick: _cache[1] || (_cache[1] = ($event) => emit2("decision", true))
          }, {
            default: withCtx(() => [
              __props.submitting && batchDecision.value === true ? (openBlock(), createElementBlock("i", _hoisted_7$5)) : (openBlock(), createElementBlock("i", _hoisted_8$4)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.confirm-approve-all")), 1)
            ]),
            _: 1
          }, 8, ["disabled"])
        ])) : createCommentVNode("", true)
      ])) : createCommentVNode("", true);
    };
  }
});
const _style_0$9 = ".assistant-confirm-bar[data-v-fecc2fa5] {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  padding: 10px 12px;\n  border-radius: 12px;\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter));\n  background: var(--app-sidebar-item-hover-bg, var(--el-fill-color-light));\n}\n.assistant-confirm-bar__icon[data-v-fecc2fa5] {\n  flex-shrink: 0;\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  width: 30px;\n  height: 30px;\n  border-radius: 50%;\n  background: var(--el-color-primary-light-9, #ecf5ff);\n  color: var(--el-color-primary, #409eff);\n  font-size: 15px;\n}\n.assistant-confirm-bar__icon.is-spinning[data-v-fecc2fa5] {\n  animation: assistant-confirm-spin-fecc2fa5 1s linear infinite;\n}\n@keyframes assistant-confirm-spin-fecc2fa5 {\nfrom {\n    transform: rotate(0deg);\n}\nto {\n    transform: rotate(360deg);\n}\n}\n.assistant-confirm-bar__main[data-v-fecc2fa5] {\n  flex: 1;\n  min-width: 0;\n}\n.assistant-confirm-bar__main p[data-v-fecc2fa5] {\n  margin: 0;\n}\n.assistant-confirm-bar__title[data-v-fecc2fa5] {\n  font-size: 13px;\n  font-weight: 500;\n  color: var(--app-text);\n}\n.assistant-confirm-bar__hint[data-v-fecc2fa5] {\n  margin-top: 2px;\n  font-size: 11px;\n  color: var(--app-text-secondary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-confirm-bar__actions[data-v-fecc2fa5] {\n  flex-shrink: 0;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n.is-spinning[data-v-fecc2fa5] {\n  animation: assistant-confirm-spin-fecc2fa5 1s linear infinite;\n}";
const AssistantToolConfirmBar = /* @__PURE__ */ _export_sfc(_sfc_main$9, [["styles", [_style_0$9]], ["__scopeId", "data-v-fecc2fa5"]]);
const _hoisted_1$8 = ["src", "alt"];
const _hoisted_2$7 = ["aria-label"];
const _sfc_main$8 = /* @__PURE__ */ defineComponent({
  ...{ name: "IaSafeImage" },
  __name: "SafeImage",
  props: {
    src: { default: null, type: [String, null] },
    alt: { default: "", type: String }
  },
  emits: ["error", "load"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    const failed = /* @__PURE__ */ ref(false);
    watch(() => props.src, () => {
      failed.value = false;
    });
    const loadableSrc = computed(() => props.src && props.src.trim() ? props.src : null);
    return (_ctx, _cache) => {
      return !failed.value && loadableSrc.value ? (openBlock(), createElementBlock("img", {
        key: 0,
        src: loadableSrc.value,
        alt: __props.alt,
        loading: "lazy",
        onError: _cache[0] || (_cache[0] = () => {
          failed.value = true;
          emit2("error");
        }),
        onLoad: _cache[1] || (_cache[1] = ($event) => emit2("load"))
      }, null, 40, _hoisted_1$8)) : (openBlock(), createElementBlock("span", {
        key: 1,
        class: normalizeClass(["safe-image__fallback", { "is-error": failed.value }]),
        role: "img",
        "aria-label": __props.alt
      }, [..._cache[2] || (_cache[2] = [
        createBaseVNode("svg", {
          viewBox: "0 0 24 24",
          fill: "none",
          stroke: "currentColor",
          "stroke-width": "1.5",
          "aria-hidden": "true"
        }, [
          createBaseVNode("rect", {
            x: "3",
            y: "5",
            width: "18",
            height: "14",
            rx: "2"
          }),
          createBaseVNode("circle", {
            cx: "9",
            cy: "10",
            r: "1.6"
          }),
          createBaseVNode("path", {
            d: "m5 17 4.5-4.5L13 16l3-3 3 3",
            "stroke-linecap": "round",
            "stroke-linejoin": "round"
          })
        ], -1)
      ])], 10, _hoisted_2$7));
    };
  }
});
const _style_0$8 = "\nimg[data-v-9b5df25a] {\n  display: block;\n  max-width: 100%;\n}\n.safe-image__fallback[data-v-9b5df25a] {\n  display: grid;\n  place-items: center;\n  width: 100%;\n  height: 100%;\n  min-height: 44px;\n  border-radius: var(--app-radius-sm, 6px);\n  background: var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7));\n  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));\n}\n.safe-image__fallback.is-error[data-v-9b5df25a] { color: var(--app-color-danger, var(--ia-danger, #f56c6c));\n}\n.safe-image__fallback svg[data-v-9b5df25a] { width: 55%; height: 55%;\n}\n";
const SafeImage = /* @__PURE__ */ _export_sfc(_sfc_main$8, [["styles", [_style_0$8]], ["__scopeId", "data-v-9b5df25a"]]);
const MAX_INPUT_COUNT = 8;
const MAX_BASE64_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TOTAL_BASE64_SIZE = 20 * 1024 * 1024;
const MAX_URL_FILE_SIZE = 100 * 1024 * 1024;
const MIME_BY_EXTENSION = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mpeg: "video/mpeg",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json"
};
const ALLOWED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));
const INPUT_TYPE_LABEL_ZH = {
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件"
};
class AssistantAttachmentError extends Error {
  key;
  params;
  constructor(key, params, fallbackMessage) {
    super(fallbackMessage);
    this.name = "AssistantAttachmentError";
    this.key = key;
    this.params = params;
  }
}
function resolveMimeType(file) {
  const declared = file.type.toLowerCase().split(";", 1)[0]?.trim() ?? "";
  const extension = file.name.toLowerCase().split(".").pop() ?? "";
  const inferred = MIME_BY_EXTENSION[extension];
  const mimeType = ALLOWED_MIME_TYPES.has(declared) ? declared : inferred;
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new AssistantAttachmentError(
      "assistant.attachment-unsupported",
      { name: file.name },
      `${file.name} 不是支持的图片、视频、音频、PDF 或文本文件`
    );
  }
  return mimeType;
}
function inputTypeForMime(mimeType) {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}
const moduleReadFileAsBase64 = (file) => readFileAsBase64(file);
function readFileAsBase64(file) {
  return new Promise((resolve2, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new AssistantAttachmentError(
      "assistant.attachment-read-failed",
      { name: file.name },
      `读取 ${file.name} 失败`
    ));
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const separator = result.indexOf(",");
      if (separator < 0) {
        reject(new AssistantAttachmentError(
          "assistant.attachment-encode-failed",
          { name: file.name },
          `${file.name} 无法转换为 Base64`
        ));
        return;
      }
      resolve2(result.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}
function createAttachmentId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
async function prepareAssistantAttachments({
  files,
  model,
  existing,
  upload = uploadAttachment,
  readFileAsBase64: readFile = moduleReadFileAsBase64
}) {
  if (existing.length + files.length > MAX_INPUT_COUNT) {
    throw new AssistantAttachmentError(
      "assistant.attachment-count-limit",
      { n: MAX_INPUT_COUNT },
      `单次最多添加 ${MAX_INPUT_COUNT} 个附件`
    );
  }
  const existingKeys = new Set(existing.map((item) => `${item.name}:${item.size}`));
  const preparedFiles = files.filter((file) => {
    const key = `${file.name}:${file.size}`;
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
  let totalBase64Size = existing.filter((item) => item.transport === "base64").reduce((sum, item) => sum + item.size, 0);
  const plans = preparedFiles.map((file) => {
    const mimeType = resolveMimeType(file);
    const inputType = inputTypeForMime(mimeType);
    const supportedTransports = model.multimodalInputTransports[inputType] ?? [];
    if (!model.multimodalInputTypes.includes(inputType) || !supportedTransports.length) {
      throw new AssistantAttachmentError(
        "assistant.attachment-model-unsupported",
        { model: model.name, type: inputType },
        `${model.name} 不支持${INPUT_TYPE_LABEL_ZH[inputType]}输入`
      );
    }
    if (file.size <= 0 || file.size > MAX_URL_FILE_SIZE) {
      throw new AssistantAttachmentError(
        "assistant.attachment-size-limit",
        { name: file.name },
        `${file.name} 的大小必须在 1B 到 100MB 之间`
      );
    }
    let transport = null;
    if (supportedTransports.includes("base64") && file.size <= MAX_BASE64_FILE_SIZE && totalBase64Size + file.size <= MAX_TOTAL_BASE64_SIZE) {
      transport = "base64";
      totalBase64Size += file.size;
    } else if (supportedTransports.includes("url")) {
      transport = "url";
    }
    if (!transport) {
      throw new AssistantAttachmentError(
        "assistant.attachment-base64-limit",
        { name: file.name },
        `${file.name} 超出 Base64 限制，且当前模型未启用 URL 输入`
      );
    }
    return { file, mimeType, inputType, transport };
  });
  const results = await Promise.allSettled(plans.map(async ({
    file,
    mimeType,
    inputType,
    transport
  }) => {
    const id = createAttachmentId();
    const resourceUrl = await upload(file, model.id, transport);
    if (transport === "base64") {
      const data = await readFile(file);
      return {
        id,
        name: file.name,
        inputType,
        mimeType,
        transport,
        data,
        resourceUrl,
        size: file.size,
        previewUrl: inputType === "image" ? resolveMediaUrl(resourceUrl) ?? void 0 : void 0
      };
    }
    return {
      id,
      name: file.name,
      inputType,
      mimeType,
      transport,
      url: resourceUrl,
      resourceUrl,
      size: file.size,
      previewUrl: inputType === "image" ? resolveMediaUrl(resourceUrl) ?? void 0 : void 0
    };
  }));
  const failure = results.find((result) => result.status === "rejected");
  if (failure) {
    throw failure.reason;
  }
  return results.map((result) => result.value);
}
function attachmentCompatibilityError(model, attachments) {
  if (!attachments.length) return null;
  if (!model) return { key: "assistant.attachment-model-required", params: {} };
  for (const attachment of attachments) {
    const transports = model.multimodalInputTransports[attachment.inputType] ?? [];
    if (!model.multimodalInputTypes.includes(attachment.inputType) || !transports.includes(attachment.transport)) {
      return {
        key: "assistant.attachment-incompatible",
        params: { model: model.name, name: attachment.name, transport: attachment.transport.toUpperCase() }
      };
    }
  }
  return null;
}
function multimodalCapabilitySummary(model) {
  const types = model?.multimodalInputTypes ?? [];
  if (!model || !types.length) return { textOnly: true, parts: [] };
  return {
    textOnly: false,
    parts: types.map((type) => ({ type, transports: model.multimodalInputTransports[type] ?? [] }))
  };
}
function attachmentAccept(model) {
  const types = model?.multimodalInputTypes ?? [];
  return [
    types.includes("image") ? "image/*" : null,
    types.includes("video") ? "video/*" : null,
    types.includes("audio") ? "audio/*" : null,
    types.includes("file") ? ".pdf,.txt,.md,.csv,.json" : null
  ].filter(Boolean).join(",");
}
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function attachmentUrlFallbackHint(attachment) {
  return attachment.transport === "url" && attachment.size > MAX_BASE64_FILE_SIZE ? { key: "assistant.attachment-url-fallback", params: {} } : null;
}
const _hoisted_1$7 = ["data-testid", "title"];
const _hoisted_2$6 = {
  key: 1,
  class: "assistant-attachment-chip__icon"
};
const _hoisted_3$5 = { class: "assistant-attachment-chip__meta" };
const _hoisted_4$4 = { class: "assistant-attachment-chip__name" };
const _hoisted_5$4 = { class: "assistant-attachment-chip__size" };
const _hoisted_6$4 = {
  key: 0,
  class: "assistant-attachment-chip__hint",
  "data-testid": "assistant-attachment-url-hint"
};
const _hoisted_7$4 = ["data-testid", "disabled", "aria-label"];
const _sfc_main$7 = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantAttachmentChip" },
  __name: "AssistantAttachmentChip",
  props: {
    attachment: { type: Object },
    removable: { type: Boolean, default: false },
    removeDisabled: { type: Boolean, default: false },
    testId: { default: "", type: String },
    hint: { default: "", type: String }
  },
  emits: ["remove"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    const { t } = useI18n();
    const chipTestId = props.testId || `assistant-attachment-${props.attachment.id}`;
    function iconFor(inputType) {
      if (inputType === "video") return "ri-movie-2-line";
      if (inputType === "audio") return "ri-headphone-line";
      return "ri-file-text-line";
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", {
        class: "assistant-attachment-chip",
        "data-testid": unref(chipTestId),
        title: `${__props.attachment.name} · ${__props.attachment.transport.toUpperCase()}`
      }, [
        __props.attachment.inputType === "image" && __props.attachment.previewUrl ? (openBlock(), createBlock(SafeImage, {
          key: 0,
          src: __props.attachment.previewUrl,
          alt: __props.attachment.name,
          class: "assistant-attachment-chip__thumb"
        }, null, 8, ["src", "alt"])) : (openBlock(), createElementBlock("span", _hoisted_2$6, [
          createBaseVNode("i", {
            class: normalizeClass(iconFor(__props.attachment.inputType))
          }, null, 2)
        ])),
        createBaseVNode("span", _hoisted_3$5, [
          createBaseVNode("span", _hoisted_4$4, toDisplayString(__props.attachment.name), 1),
          createBaseVNode("span", _hoisted_5$4, toDisplayString(unref(formatFileSize)(__props.attachment.size)) + " · " + toDisplayString(__props.attachment.transport.toUpperCase()), 1),
          __props.hint ? (openBlock(), createElementBlock("span", _hoisted_6$4, toDisplayString(__props.hint), 1)) : createCommentVNode("", true)
        ]),
        __props.removable ? (openBlock(), createElementBlock("button", {
          key: 2,
          type: "button",
          class: "assistant-attachment-chip__remove fc-button-ghost",
          "data-testid": `assistant-attachment-remove-${__props.attachment.id}`,
          disabled: __props.removeDisabled,
          "aria-label": unref(t)("assistant.attachment-remove"),
          onClick: _cache[0] || (_cache[0] = ($event) => emit2("remove"))
        }, [..._cache[1] || (_cache[1] = [
          createBaseVNode("i", { class: "ri-close-line" }, null, -1)
        ])], 8, _hoisted_7$4)) : createCommentVNode("", true)
      ], 8, _hoisted_1$7);
    };
  }
});
const _style_0$7 = ".assistant-attachment-chip[data-v-7745d843] {\n  position: relative;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  min-width: 140px;\n  max-width: 190px;\n  padding: 6px;\n  border-radius: var(--app-radius-md);\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter));\n  background: var(--app-bg-card, transparent);\n}\n.assistant-attachment-chip__thumb[data-v-7745d843] {\n  width: 44px;\n  height: 44px;\n  flex-shrink: 0;\n  border-radius: var(--app-radius-sm);\n  object-fit: cover;\n}\n.assistant-attachment-chip__icon[data-v-7745d843] {\n  display: grid;\n  place-items: center;\n  width: 44px;\n  height: 44px;\n  flex-shrink: 0;\n  border-radius: var(--app-radius-sm);\n  color: var(--app-text-secondary);\n  font-size: 18px;\n}\n.assistant-attachment-chip__meta[data-v-7745d843] {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n  gap: 4px;\n}\n.assistant-attachment-chip__name[data-v-7745d843] {\n  font-size: 10px;\n  font-weight: 600;\n  color: var(--app-text);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-attachment-chip__size[data-v-7745d843] {\n  font-size: 9px;\n  color: var(--app-text-secondary);\n}\n.assistant-attachment-chip__hint[data-v-7745d843] {\n  font-size: 9px;\n  color: var(--app-color-warning, var(--el-color-warning, #e6a23c));\n}\n.assistant-attachment-chip__remove[data-v-7745d843] {\n  position: absolute;\n  top: 2px;\n  right: 2px;\n  display: grid;\n  place-items: center;\n  width: 18px;\n  height: 18px;\n  padding: 0;\n  border: none;\n  border-radius: var(--app-radius-full, 9999px);\n  background: none;\n  cursor: pointer;\n  font-size: 12px;\n  color: var(--app-text-secondary);\n}\n.assistant-attachment-chip__remove[data-v-7745d843]:hover {\n  color: var(--app-text);\n}";
const AssistantAttachmentChip = /* @__PURE__ */ _export_sfc(_sfc_main$7, [["styles", [_style_0$7]], ["__scopeId", "data-v-7745d843"]]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const INPUT_TYPES = /* @__PURE__ */ new Set(["image", "video", "audio", "file"]);
function messageAttachments(message) {
  const raw = message?.referencesJson;
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.attachments)) return [];
  const views = [];
  for (const item of parsed.attachments) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" && item.id.trim() ? item.id : "";
    const name = typeof item.name === "string" && item.name.trim() ? item.name : "";
    if (!id || !name) continue;
    const inputType = typeof item.inputType === "string" && INPUT_TYPES.has(item.inputType) ? item.inputType : "file";
    const resourceUrl = typeof item.resourceUrl === "string" && item.resourceUrl.trim() ? item.resourceUrl : void 0;
    views.push({
      id,
      name,
      inputType,
      mimeType: typeof item.mimeType === "string" && item.mimeType ? item.mimeType : "application/octet-stream",
      transport: item.transport === "url" ? "url" : "base64",
      size: typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? item.size : 0,
      ...resourceUrl ? { resourceUrl } : {},
      ...inputType === "image" && resourceUrl ? { previewUrl: resolveMediaUrl(resourceUrl) ?? void 0 } : {}
    });
  }
  return views;
}
const AT_BOTTOM_THRESHOLD_PX = 30;
const FOLLOW_SCROLL_DURATION_MS = 100;
const SCROLLABLE_THRESHOLD_PX = 20;
function useAssistantMessageScroll(options) {
  const { viewportRef, contentRef } = options;
  const viewportReady = /* @__PURE__ */ ref(false);
  const showBackToBottom = /* @__PURE__ */ ref(false);
  let isDetached = false;
  let isInitializing = true;
  let isScrollingToBottom = false;
  let isScrollbarDragging = false;
  let lastScrollTop = 0;
  let touchY = null;
  let followFrame = null;
  function cancelFollowAnimation() {
    if (followFrame !== null) {
      cancelAnimationFrame(followFrame);
      followFrame = null;
    }
    isScrollingToBottom = false;
  }
  function pinToBottom() {
    const element = viewportRef.value;
    if (!element) return;
    cancelFollowAnimation();
    element.scrollTop = element.scrollHeight;
    lastScrollTop = element.scrollTop;
  }
  function animateToBottom() {
    const element = viewportRef.value;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      pinToBottom();
      return;
    }
    if (followFrame !== null) return;
    const startTop = element.scrollTop;
    const startedAt = performance.now();
    isScrollingToBottom = true;
    const step = () => {
      const el = viewportRef.value;
      if (!el) {
        followFrame = null;
        isScrollingToBottom = false;
        return;
      }
      const targetTop = Math.max(0, el.scrollHeight - el.clientHeight);
      const progress = Math.min((performance.now() - startedAt) / FOLLOW_SCROLL_DURATION_MS, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      el.scrollTop = startTop + (targetTop - startTop) * easedProgress;
      lastScrollTop = el.scrollTop;
      if (progress < 1) {
        followFrame = requestAnimationFrame(step);
        return;
      }
      el.scrollTop = targetTop;
      lastScrollTop = el.scrollTop;
      followFrame = null;
      isScrollingToBottom = false;
    };
    followFrame = requestAnimationFrame(step);
  }
  function scheduleFollow() {
    if (followFrame !== null || isDetached || !options.running() && !isInitializing) return;
    animateToBottom();
  }
  function isScrollable() {
    const element = viewportRef.value;
    return !!element && element.scrollHeight > element.clientHeight + SCROLLABLE_THRESHOLD_PX;
  }
  watch(
    () => options.contentReady() && !!viewportRef.value,
    (ready) => {
      if (!ready) return;
      isDetached = false;
      pinToBottom();
      requestAnimationFrame(() => {
        if (!viewportRef.value) return;
        pinToBottom();
        requestAnimationFrame(() => {
          pinToBottom();
          isInitializing = false;
          showBackToBottom.value = false;
          viewportReady.value = true;
        });
      });
    },
    { immediate: true }
  );
  watch(
    () => options.running(),
    (now, was) => {
      if (now && !was) {
        isDetached = false;
        showBackToBottom.value = false;
        animateToBottom();
      }
    }
  );
  watch(
    () => options.contentVersion(),
    () => {
      if (viewportReady.value && options.running() && !isDetached) {
        animateToBottom();
      }
    }
  );
  let resizeObserver = null;
  watch(
    () => [contentRef.value, viewportRef.value],
    ([content, viewport]) => {
      resizeObserver?.disconnect();
      if (!content || !viewport || typeof ResizeObserver === "undefined") return;
      resizeObserver = new ResizeObserver(() => scheduleFollow());
      resizeObserver.observe(content);
      resizeObserver.observe(viewport);
    },
    { immediate: true }
  );
  const onScrollbarPointerDown = (event) => {
    if (event.button !== 0) return;
    if (isScrollable()) isScrollbarDragging = true;
  };
  const stopScrollbarDrag = () => {
    isScrollbarDragging = false;
  };
  window.addEventListener("pointerup", stopScrollbarDrag);
  window.addEventListener("pointercancel", stopScrollbarDrag);
  function detachFromBottom() {
    if (isDetached) return;
    isDetached = true;
    cancelFollowAnimation();
    const element = viewportRef.value;
    if (element) {
      showBackToBottom.value = element.scrollHeight > element.clientHeight + SCROLLABLE_THRESHOLD_PX;
    }
  }
  function onViewportScroll(event) {
    if (isInitializing) return;
    const element = event.currentTarget;
    if (!(element instanceof HTMLElement)) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    const atBottom = distance <= AT_BOTTOM_THRESHOLD_PX;
    const movedDown = element.scrollTop > lastScrollTop + 1;
    if (atBottom && (!isDetached || movedDown)) {
      isDetached = false;
      isScrollingToBottom = false;
      showBackToBottom.value = false;
    } else if (isDetached) {
      showBackToBottom.value = element.scrollHeight > element.clientHeight + SCROLLABLE_THRESHOLD_PX;
    } else if (isScrollbarDragging) {
      detachFromBottom();
    } else if (options.running() && !isScrollingToBottom) {
      scheduleFollow();
    }
    lastScrollTop = element.scrollTop;
  }
  function onWheel(event) {
    if (event.deltaY < 0 && isScrollable()) {
      detachFromBottom();
    }
  }
  function onKeyDown(event) {
    const scrollsUp = event.key === "ArrowUp" || event.key === "PageUp" || event.key === "Home" || event.key === " " && event.shiftKey;
    if (scrollsUp && isScrollable()) {
      detachFromBottom();
    }
  }
  function onTouchStart(event) {
    touchY = event.touches[0]?.clientY ?? null;
  }
  function onTouchMove(event) {
    const nextY = event.touches[0]?.clientY;
    if (nextY === void 0 || touchY === null) return;
    if (nextY > touchY && isScrollable()) {
      detachFromBottom();
    }
    touchY = nextY;
  }
  function scrollToBottom() {
    const element = viewportRef.value;
    if (!element) return;
    isDetached = false;
    showBackToBottom.value = false;
    animateToBottom();
  }
  onScopeDispose(() => {
    cancelFollowAnimation();
    resizeObserver?.disconnect();
    window.removeEventListener("pointerup", stopScrollbarDrag);
    window.removeEventListener("pointercancel", stopScrollbarDrag);
  });
  return {
    viewportReady,
    showBackToBottom,
    onViewportScroll,
    onWheel,
    onKeyDown,
    onTouchStart,
    onTouchMove,
    onScrollbarPointerDown,
    scrollToBottom
  };
}
const _hoisted_1$6 = {
  key: 0,
  class: "assistant-messages",
  "data-testid": "assistant-message-list"
};
const _hoisted_2$5 = ["data-ready"];
const _hoisted_3$4 = {
  key: 0,
  class: "assistant-messages__loading",
  "data-testid": "assistant-messages-loading"
};
const _hoisted_4$3 = {
  key: 0,
  class: "assistant-messages__user",
  "data-testid": "assistant-user-bubble"
};
const _hoisted_5$3 = { key: 0 };
const _hoisted_6$3 = {
  key: 1,
  class: "assistant-messages__user-attachments",
  "data-testid": "assistant-user-attachments"
};
const _hoisted_7$3 = {
  key: 2,
  class: "assistant-messages__thinking",
  "data-testid": "assistant-thinking"
};
const _hoisted_8$3 = {
  key: 3,
  class: "assistant-messages__reconnecting",
  "data-testid": "assistant-reconnecting"
};
const _hoisted_9$3 = {
  key: 4,
  class: "assistant-messages__error",
  "data-testid": "assistant-message-error"
};
const _hoisted_10$3 = { class: "assistant-messages__error-text" };
const _hoisted_11$3 = {
  key: 0,
  class: "assistant-messages__veil",
  "data-testid": "assistant-messages-veil"
};
const _hoisted_12$2 = {
  key: 2,
  class: "assistant-messages__batch"
};
const _sfc_main$6 = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantMessageList" },
  __name: "AssistantMessageList",
  props: {
    conversationId: { type: String }
  },
  setup(__props) {
    const props = __props;
    const { t } = useI18n();
    const store = useAssistantStore();
    const runtime2 = computed(() => store.conversationStates[props.conversationId]);
    const running = computed(() => !!runtime2.value && statusIsRunning(runtime2.value.status));
    const contentReady = computed(() => !!runtime2.value && (runtime2.value.messagesLoaded || !!runtime2.value.messagesError || showPipelineTimeline.value && runtime2.value.pipeline.timeline.length > 0));
    const showPipelineTimeline = computed(() => !!runtime2.value && (running.value || !runtime2.value.messagesLoaded));
    const activeRunId = computed(() => showPipelineTimeline.value ? runtime2.value?.pipeline.runId ?? runtime2.value?.knownRunId : void 0);
    const segments = computed(() => buildSegments(runtime2.value?.messages ?? [], activeRunId.value).map((segment) => ({
      ...segment,
      timeline: messagesToTimeline(segment.assistant),
      // [P2 #14] 用户消息附件视图(发送后气泡与历史回放同路径)
      attachments: segment.user ? messageAttachments(segment.user) : []
    })));
    const liveTimeline = computed(() => runtime2.value && showPipelineTimeline.value ? runtime2.value.pipeline.timeline : []);
    const errorMessage = computed(() => runtime2.value?.messagesError || runtime2.value?.pipeline.error || runtime2.value?.connectionError);
    const reconnecting = computed(() => !!runtime2.value?.reconnecting);
    const contentVersion = computed(() => runtime2.value ? `${runtime2.value.messagesLoaded}:${runtime2.value.messages.length}:${runtime2.value.pipeline.lastSequence}` : "pending");
    const viewportRef = /* @__PURE__ */ ref(null);
    const contentRef = /* @__PURE__ */ ref(null);
    const {
      viewportReady,
      showBackToBottom,
      onViewportScroll,
      onWheel,
      onKeyDown,
      onTouchStart,
      onTouchMove,
      onScrollbarPointerDown,
      scrollToBottom
    } = useAssistantMessageScroll({
      viewportRef,
      contentRef,
      contentReady: () => contentReady.value,
      contentVersion: () => contentVersion.value,
      running: () => running.value
    });
    const pendingConfirmation = computed(() => runtime2.value?.pipeline.pendingConfirmation);
    const batchConfirmation = computed(() => pendingConfirmation.value && (pendingConfirmation.value.toolCalls?.length ?? 0) > 1 ? pendingConfirmation.value : void 0);
    const showBatchApprovalBar = computed(() => !!batchConfirmation.value && runtime2.value?.pipeline.status !== "cancelling");
    const batchScopeDigest = computed(() => batchConfirmation.value ? pendingScopeDigest(batchConfirmation.value.toolCalls) : void 0);
    const singleToolScopeDigest = computed(() => {
      const pending = pendingConfirmation.value;
      if (!pending || (pending.toolCalls?.length ?? 0) !== 1) return void 0;
      return normalizeToolCallScope(pending.toolCalls?.[0]?.scope);
    });
    const confirmationBinding = computed(() => {
      const pending = pendingConfirmation.value;
      if (!pending) return void 0;
      return {
        toolCallIds: (pending.toolCalls ?? []).map((toolCall) => toolCall.toolCallId),
        parentToolCallId: pending.parentToolCallId,
        decisions: pending.decisions,
        submitting: pending.submitting,
        showActions: runtime2.value?.pipeline.status !== "cancelling",
        expiresAt: pending.expiresAt,
        ...singleToolScopeDigest.value ? { scope: singleToolScopeDigest.value } : {}
      };
    });
    watch(pendingConfirmation, (pending) => {
      if (!pending) return;
      const expiresAt = Date.parse(pending.expiresAt);
      if (!Number.isFinite(expiresAt)) {
        throw new Error("Tool confirmation expiry is invalid");
      }
      const expireIfNeeded = () => {
        if (Date.now() >= expiresAt) {
          void store.expireToolConfirmation();
        }
      };
      expireIfNeeded();
      const timer = setTimeout(expireIfNeeded, Math.max(0, expiresAt - Date.now()));
      window.addEventListener("focus", expireIfNeeded);
      document.addEventListener("visibilitychange", expireIfNeeded);
      watchCleanup(() => {
        clearTimeout(timer);
        window.removeEventListener("focus", expireIfNeeded);
        document.removeEventListener("visibilitychange", expireIfNeeded);
      });
    }, { immediate: true });
    function watchCleanup(fn) {
      if (getCurrentScope()) onScopeDispose(fn);
    }
    function retry() {
      void store.loadMessagesIfNeeded(props.conversationId);
      store.ensureContentConnection();
    }
    function hasContent() {
      return segments.value.length > 0 || liveTimeline.value.length > 0 || !!pendingConfirmation.value || !!errorMessage.value;
    }
    return (_ctx, _cache) => {
      return runtime2.value ? (openBlock(), createElementBlock("div", _hoisted_1$6, [
        createBaseVNode("div", {
          ref_key: "viewportRef",
          ref: viewportRef,
          class: "assistant-messages__scroll",
          tabindex: "0",
          "data-ready": unref(viewportReady) ? "true" : "false",
          "data-testid": "assistant-messages-viewport",
          onScrollPassive: _cache[1] || (_cache[1] = //@ts-ignore
          (...args) => unref(onViewportScroll) && unref(onViewportScroll)(...args)),
          onWheelPassive: _cache[2] || (_cache[2] = //@ts-ignore
          (...args) => unref(onWheel) && unref(onWheel)(...args)),
          onKeydown: _cache[3] || (_cache[3] = //@ts-ignore
          (...args) => unref(onKeyDown) && unref(onKeyDown)(...args)),
          onTouchstartPassive: _cache[4] || (_cache[4] = //@ts-ignore
          (...args) => unref(onTouchStart) && unref(onTouchStart)(...args)),
          onTouchmovePassive: _cache[5] || (_cache[5] = //@ts-ignore
          (...args) => unref(onTouchMove) && unref(onTouchMove)(...args)),
          onPointerdown: _cache[6] || (_cache[6] = //@ts-ignore
          (...args) => unref(onScrollbarPointerDown) && unref(onScrollbarPointerDown)(...args))
        }, [
          createBaseVNode("div", {
            ref_key: "contentRef",
            ref: contentRef,
            class: "assistant-messages__content"
          }, [
            runtime2.value.messagesLoading && runtime2.value.messages.length === 0 ? (openBlock(), createElementBlock("p", _hoisted_3$4, [
              _cache[9] || (_cache[9] = createBaseVNode("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.loading-messages")), 1)
            ])) : createCommentVNode("", true),
            !runtime2.value.messagesLoading && !hasContent() ? (openBlock(), createBlock(IaEmpty, {
              key: 1,
              type: "empty",
              title: unref(t)("assistant.empty-title"),
              description: unref(t)("assistant.empty-desc"),
              "data-testid": "assistant-empty"
            }, null, 8, ["title", "description"])) : createCommentVNode("", true),
            (openBlock(true), createElementBlock(Fragment, null, renderList(segments.value, (segment) => {
              return openBlock(), createElementBlock(Fragment, {
                key: segment.key
              }, [
                segment.user ? (openBlock(), createElementBlock("div", _hoisted_4$3, [
                  segment.user.content ? (openBlock(), createElementBlock("p", _hoisted_5$3, toDisplayString(segment.user.content), 1)) : createCommentVNode("", true),
                  segment.attachments?.length ? (openBlock(), createElementBlock("div", _hoisted_6$3, [
                    (openBlock(true), createElementBlock(Fragment, null, renderList(segment.attachments ?? [], (attachment) => {
                      return openBlock(), createBlock(AssistantAttachmentChip, {
                        key: attachment.id,
                        attachment,
                        "test-id": `assistant-message-attachment-${attachment.id}`
                      }, null, 8, ["attachment", "test-id"]);
                    }), 128))
                  ])) : createCommentVNode("", true)
                ])) : createCommentVNode("", true),
                createVNode(AssistantTimeline, {
                  class: "assistant-timeline-host",
                  items: segment.timeline
                }, null, 8, ["items"])
              ], 64);
            }), 128)),
            createVNode(AssistantTimeline, {
              class: "assistant-timeline-host",
              items: liveTimeline.value,
              confirmation: confirmationBinding.value,
              streaming: running.value,
              onDecision: _cache[0] || (_cache[0] = (toolCallId, approved) => void unref(store).respondToToolConfirmation(toolCallId, approved))
            }, null, 8, ["items", "confirmation", "streaming"]),
            running.value && liveTimeline.value.length === 0 && !pendingConfirmation.value ? (openBlock(), createElementBlock("p", _hoisted_7$3, [
              _cache[10] || (_cache[10] = createBaseVNode("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.thinking")), 1)
            ])) : createCommentVNode("", true),
            reconnecting.value ? (openBlock(), createElementBlock("p", _hoisted_8$3, [
              _cache[11] || (_cache[11] = createBaseVNode("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.reconnecting")), 1)
            ])) : createCommentVNode("", true),
            errorMessage.value ? (openBlock(), createElementBlock("div", _hoisted_9$3, [
              _cache[13] || (_cache[13] = createBaseVNode("i", {
                class: "ri-error-warning-line",
                "aria-hidden": "true"
              }, null, -1)),
              createBaseVNode("span", _hoisted_10$3, toDisplayString(errorMessage.value), 1),
              createVNode(IaButton, {
                variant: "danger",
                size: "sm",
                text: "",
                "data-testid": "assistant-retry",
                onClick: retry
              }, {
                default: withCtx(() => [
                  _cache[12] || (_cache[12] = createBaseVNode("i", { class: "ri-refresh-line" }, null, -1)),
                  createTextVNode(" " + toDisplayString(unref(t)("assistant.retry")), 1)
                ]),
                _: 1
              })
            ])) : createCommentVNode("", true)
          ], 512)
        ], 40, _hoisted_2$5),
        contentReady.value === false ? (openBlock(), createElementBlock("div", _hoisted_11$3, [
          _cache[14] || (_cache[14] = createBaseVNode("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
          createTextVNode(" " + toDisplayString(unref(t)("assistant.loading-messages")), 1)
        ])) : createCommentVNode("", true),
        unref(showBackToBottom) ? (openBlock(), createElementBlock("button", {
          key: 1,
          type: "button",
          class: "assistant-messages__back fc-button-ghost",
          "data-testid": "assistant-back-to-bottom",
          onClick: _cache[7] || (_cache[7] = //@ts-ignore
          (...args) => unref(scrollToBottom) && unref(scrollToBottom)(...args))
        }, [
          _cache[15] || (_cache[15] = createBaseVNode("i", {
            class: "ri-arrow-down-line",
            "aria-hidden": "true"
          }, null, -1)),
          createTextVNode(" " + toDisplayString(unref(t)("assistant.back-to-bottom")), 1)
        ])) : createCommentVNode("", true),
        showBatchApprovalBar.value && batchConfirmation.value ? (openBlock(), createElementBlock("div", _hoisted_12$2, [
          createVNode(AssistantToolConfirmBar, {
            "tool-call-ids": (batchConfirmation.value.toolCalls ?? []).map((toolCall) => toolCall.toolCallId),
            decisions: batchConfirmation.value.decisions,
            submitting: batchConfirmation.value.submitting,
            "show-actions": runtime2.value.pipeline.status !== "cancelling",
            "expires-at": batchConfirmation.value.expiresAt,
            "scope-digest": batchScopeDigest.value,
            onDecision: _cache[8] || (_cache[8] = (approved) => void unref(store).respondToAllToolConfirmations(approved))
          }, null, 8, ["tool-call-ids", "decisions", "submitting", "show-actions", "expires-at", "scope-digest"])
        ])) : createCommentVNode("", true)
      ])) : createCommentVNode("", true);
    };
  }
});
const _style_0$6 = '@charset "UTF-8";\n.assistant-messages[data-v-9e089995] {\n  position: relative;\n  min-height: 0;\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n}\n.assistant-messages__scroll[data-v-9e089995] {\n  min-height: 0;\n  flex: 1;\n  overflow-y: auto;\n  /* 揭示前不可见 (贴底初始化两帧后揭示, 旧 viewportReady opacity 过渡) */\n}\n.assistant-messages__scroll[data-ready=false][data-v-9e089995] {\n  opacity: 0;\n}\n.assistant-messages__scroll[data-ready=true][data-v-9e089995] {\n  opacity: 1;\n}\n.assistant-messages__scroll[data-v-9e089995] {\n  transition: opacity 0.4s ease-out;\n}\n.assistant-messages__back[data-v-9e089995] {\n  position: absolute;\n  left: 50%;\n  bottom: 12px;\n  z-index: 10;\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  transform: translateX(-50%);\n  padding: 6px 12px;\n  border-radius: 999px;\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter));\n  background: var(--app-bg-card, #fff);\n  color: var(--app-text);\n  font-size: 12px;\n  cursor: pointer;\n  box-shadow: var(--app-shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));\n  transition: background 0.15s ease;\n}\n.assistant-messages__back[data-v-9e089995]:hover {\n  background: var(--app-sidebar-item-hover-bg, #f5f5f7);\n}\n.assistant-messages__content[data-v-9e089995] {\n  max-width: 720px;\n  margin: 0 auto;\n  display: flex;\n  flex-direction: column;\n  gap: 14px;\n  padding: 18px 16px 28px;\n}\n.assistant-messages__loading[data-v-9e089995],\n.assistant-messages__thinking[data-v-9e089995] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin: 0;\n  padding: 10px 0;\n  font-size: 12px;\n  color: var(--app-text-secondary);\n}\n\n/* [P1 #5] 断流静默提示条(非阻断状态条, 对齐 Figma/Linear 断网横幅范式) */\n.assistant-messages__reconnecting[data-v-9e089995] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin: 0;\n  padding: 8px 10px;\n  border-radius: 10px;\n  border: 1px solid var(--el-color-warning-light-7, #f3d19e);\n  background: var(--el-color-warning-light-9, #fdf6ec);\n  font-size: 12px;\n  color: var(--app-color-warning, var(--el-color-warning, #e6a23c));\n}\n.is-spinning[data-v-9e089995] {\n  animation: assistant-msg-spin-9e089995 1s linear infinite;\n}\n@keyframes assistant-msg-spin-9e089995 {\nfrom {\n    transform: rotate(0deg);\n}\nto {\n    transform: rotate(360deg);\n}\n}\n.assistant-messages__user[data-v-9e089995],\n.assistant-timeline-host[data-v-9e089995] {\n  /* 长会话性能: 视口外行跳过布局/绘制, DOM 保持完整 (旧 timeline.tsx:44-49 同口径) */\n  content-visibility: auto;\n  contain-intrinsic-size: auto 72px;\n}\n.assistant-messages__user[data-v-9e089995] {\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  gap: 6px;\n}\n.assistant-messages__user p[data-v-9e089995] {\n  margin: 0;\n  max-width: 85%;\n  padding: 9px 12px;\n  border-radius: 14px;\n  background: var(--el-color-primary-light-9, #ecf5ff);\n  color: var(--app-text);\n  font-size: 13px;\n  line-height: 1.6;\n  white-space: pre-wrap;\n  word-break: break-word;\n}\n\n/* [P2 #14] 消息区附件行(缩略图/文件卡, 复用 composer chip 组件) */\n.assistant-messages__user-attachments[data-v-9e089995] {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 8px;\n  max-width: 85%;\n}\n.assistant-messages__error[data-v-9e089995] {\n  display: flex;\n  align-items: flex-start;\n  gap: 8px;\n  padding: 8px 10px;\n  border-radius: 10px;\n  border: 1px solid var(--el-color-danger-light-7, #fde2e2);\n  background: var(--el-color-danger-light-9, #fef0f0);\n  font-size: 12px;\n  color: var(--el-color-danger, #f56c6c);\n}\n.assistant-messages__error > i[data-v-9e089995] {\n  margin-top: 1px;\n}\n.assistant-messages__error-text[data-v-9e089995] {\n  flex: 1;\n  min-width: 0;\n  word-break: break-word;\n}\n.assistant-messages__veil[data-v-9e089995] {\n  position: absolute;\n  inset: 0;\n  z-index: 5;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  font-size: 12px;\n  color: var(--app-text-secondary);\n  background: color-mix(in srgb, var(--app-bg, #fff) 60%, transparent);\n}\n.assistant-messages__batch[data-v-9e089995] {\n  position: absolute;\n  left: 0;\n  right: 0;\n  bottom: 10px;\n  z-index: 6;\n  padding: 0 14px;\n  display: flex;\n  justify-content: center;\n}\n.assistant-messages__batch[data-v-9e089995] > * {\n  max-width: 720px;\n  width: 100%;\n}';
const AssistantMessageList = /* @__PURE__ */ _export_sfc(_sfc_main$6, [["styles", [_style_0$6]], ["__scopeId", "data-v-9e089995"]]);
const _hoisted_1$5 = ["value", "disabled"];
const _hoisted_2$4 = ["disabled"];
const _hoisted_3$3 = ["value", "disabled"];
const _sfc_main$5 = /* @__PURE__ */ defineComponent({
  ...{ name: "IaSelect", inheritAttrs: false },
  __name: "IaSelect",
  props: {
    modelValue: { default: void 0, type: [String, Number] },
    options: { default: () => [], type: Array },
    placeholder: { default: "", type: String },
    clearable: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false },
    loading: { type: Boolean, default: false },
    size: { default: "default", type: String }
  },
  emits: ["update:modelValue"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    function onChange(event) {
      const raw = event.target.value;
      if (props.clearable && raw === "__ia_placeholder__") {
        emit2("update:modelValue", void 0);
        return;
      }
      emit2("update:modelValue", raw);
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("select", mergeProps({
        class: ["ia-select", [`size-${__props.size}`, { "is-disabled": __props.disabled || __props.loading, "is-placeholder": __props.modelValue === void 0 }]],
        value: __props.modelValue === void 0 && __props.clearable ? "__ia_placeholder__" : __props.modelValue ?? "__ia_placeholder__",
        disabled: __props.disabled || __props.loading
      }, _ctx.$attrs, { onChange }), [
        __props.modelValue === void 0 || __props.clearable ? (openBlock(), createElementBlock("option", {
          key: 0,
          value: "__ia_placeholder__",
          disabled: !__props.clearable
        }, toDisplayString(__props.placeholder || " "), 9, _hoisted_2$4)) : createCommentVNode("", true),
        (openBlock(true), createElementBlock(Fragment, null, renderList(__props.options, (opt) => {
          return openBlock(), createElementBlock("option", {
            key: String(opt.value),
            value: opt.value,
            disabled: opt.disabled
          }, toDisplayString(opt.label), 9, _hoisted_3$3);
        }), 128))
      ], 16, _hoisted_1$5);
    };
  }
});
const _style_0$5 = `
.ia-select[data-v-acbc126c] {
  width: 100%;
  padding: 6px 26px 6px 10px;
  border: 1px solid var(--app-separator, var(--ia-separator, #dcdfe6));
  border-radius: var(--app-radius-md, 8px);
  background: var(--app-bg-card, var(--ia-bg-card, #fff));
  color: var(--app-text, var(--ia-text, #303133));
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23909399' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
}
.ia-select.size-small[data-v-acbc126c] { font-size: 12px; padding: 4px 24px 4px 8px;
}
.ia-select.size-large[data-v-acbc126c] { font-size: 14px;
}
.ia-select.is-placeholder[data-v-acbc126c] { color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));
}
.ia-select.is-disabled[data-v-acbc126c] {
  cursor: not-allowed;
  opacity: 0.55;
}
.ia-select[data-v-acbc126c]:focus {
  outline: none;
  border-color: var(--app-primary, var(--ia-primary, #409eff));
}
`;
const IaSelect = /* @__PURE__ */ _export_sfc(_sfc_main$5, [["styles", [_style_0$5]], ["__scopeId", "data-v-acbc126c"]]);
const _hoisted_1$4 = { class: "ia-tag__content" };
const _hoisted_2$3 = ["disabled"];
const _sfc_main$4 = /* @__PURE__ */ defineComponent({
  ...{ name: "IaTag" },
  __name: "IaTag",
  props: {
    color: { default: "primary", type: String },
    size: { default: "sm", type: String },
    closable: { type: Boolean, default: false },
    disabled: { type: Boolean, default: false }
  },
  emits: ["close"],
  setup(__props, { emit: __emit }) {
    const props = __props;
    const emit2 = __emit;
    const classes = computed(() => [
      "ia-tag",
      `color-${props.color}`,
      `size-${props.size}`,
      { "is-disabled": props.disabled }
    ]);
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("span", {
        class: normalizeClass(["ia-tag", classes.value])
      }, [
        createBaseVNode("span", _hoisted_1$4, [
          renderSlot(_ctx.$slots, "default", {}, void 0)
        ]),
        __props.closable ? (openBlock(), createElementBlock("button", {
          key: 0,
          type: "button",
          class: "ia-tag__close",
          "aria-label": "close",
          disabled: __props.disabled,
          onClick: _cache[0] || (_cache[0] = withModifiers(($event) => !__props.disabled && emit2("close"), ["stop"]))
        }, [..._cache[1] || (_cache[1] = [
          createBaseVNode("i", {
            class: "ri-close-line",
            "aria-hidden": "true"
          }, null, -1)
        ])], 8, _hoisted_2$3)) : createCommentVNode("", true)
      ], 2);
    };
  }
});
const _style_0$4 = "\n.ia-tag[data-v-2e18d538] {\n  display: inline-flex;\n  align-items: center;\n  gap: 4px;\n  max-width: 220px;\n  padding: 2px 8px;\n  border-radius: 9999px;\n  font-size: 11px;\n  line-height: 1.6;\n  border: 1px solid transparent;\n}\n.ia-tag.size-sm[data-v-2e18d538] { font-size: 11px;\n}\n.ia-tag.size-md[data-v-2e18d538] { font-size: 12px; padding: 3px 10px;\n}\n.ia-tag.size-lg[data-v-2e18d538] { font-size: 13px; padding: 4px 12px;\n}\n.ia-tag.color-primary[data-v-2e18d538],\n.ia-tag.color-brand[data-v-2e18d538] {\n  background: color-mix(in srgb, var(--app-primary, var(--ia-primary, #409eff)) 10%, transparent);\n  color: var(--app-primary, var(--ia-primary, #409eff));\n  border-color: color-mix(in srgb, var(--app-primary, var(--ia-primary, #409eff)) 25%, transparent);\n}\n.ia-tag.color-gray[data-v-2e18d538] {\n  background: var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7));\n  color: var(--app-text-secondary, var(--ia-text-secondary, #606266));\n  border-color: var(--app-separator, var(--ia-separator, #dcdfe6));\n}\n.ia-tag.color-success[data-v-2e18d538] {\n  background: color-mix(in srgb, var(--app-color-success, var(--ia-success, #67c23a)) 12%, transparent);\n  color: var(--app-color-success, var(--ia-success, #67c23a));\n}\n.ia-tag.color-warning[data-v-2e18d538] {\n  background: color-mix(in srgb, var(--app-color-warning, var(--ia-warning, #e6a23c)) 12%, transparent);\n  color: var(--app-color-warning, var(--ia-warning, #e6a23c));\n}\n.ia-tag.color-danger[data-v-2e18d538] {\n  background: color-mix(in srgb, var(--app-color-danger, var(--ia-danger, #f56c6c)) 12%, transparent);\n  color: var(--app-color-danger, var(--ia-danger, #f56c6c));\n}\n.ia-tag.is-disabled[data-v-2e18d538] { opacity: 0.5;\n}\n.ia-tag__content[data-v-2e18d538] {\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.ia-tag__close[data-v-2e18d538] {\n  flex-shrink: 0;\n  display: grid;\n  place-items: center;\n  width: 14px;\n  height: 14px;\n  padding: 0;\n  border: none;\n  border-radius: 50%;\n  background: none;\n  cursor: pointer;\n  font-size: 12px;\n  color: inherit;\n  opacity: 0.7;\n}\n.ia-tag__close[data-v-2e18d538]:hover { opacity: 1;\n}\n";
const IaTag = /* @__PURE__ */ _export_sfc(_sfc_main$4, [["styles", [_style_0$4]], ["__scopeId", "data-v-2e18d538"]]);
function detectReferenceTrigger(value, cursor) {
  const prefix = value.slice(0, cursor);
  const match = prefix.match(/(^|\s)([/@])([^\s/@]*)$/u);
  if (!match || match.index === void 0) return null;
  const leadingLength = match[1]?.length ?? 0;
  return {
    mode: match[2] === "@" ? "project" : "capability",
    query: match[3] ?? "",
    start: match.index + leadingLength,
    end: cursor
  };
}
function normalizeSearch(value) {
  return value.trim().toLocaleLowerCase();
}
function fuzzyScore(candidate, query) {
  if (!query) return 0;
  const normalizedCandidate = normalizeSearch(candidate);
  const normalizedQuery = normalizeSearch(query);
  const direct = normalizedCandidate.indexOf(normalizedQuery);
  if (direct >= 0) return direct;
  let queryIndex = 0;
  let distance = 0;
  for (let index = 0; index < normalizedCandidate.length && queryIndex < normalizedQuery.length; index += 1) {
    if (normalizedCandidate[index] === normalizedQuery[queryIndex]) {
      distance += index;
      queryIndex += 1;
    }
  }
  return queryIndex === normalizedQuery.length ? 100 + distance : Number.POSITIVE_INFINITY;
}
function filterPickerItems(items, query, textOf, limit = 12) {
  return items.map((item) => ({ item, score: fuzzyScore(textOf(item), query) })).filter((entry) => Number.isFinite(entry.score)).sort((left, right) => left.score - right.score).slice(0, limit).map((entry) => entry.item);
}
function capabilitySearchText(item) {
  if (item.kind === "skill") {
    return `${item.value.displayName} ${item.value.name} ${item.value.id} ${item.value.source} ${item.value.description}`;
  }
  return `${item.value.toolName} ${item.value.serverName} ${item.value.description}`;
}
function referenceItemKey(item) {
  if (item.kind === "project") return `project:${item.value.id}`;
  if (item.kind === "skill") return `skill:${item.value.id}`;
  if (item.kind === "mcp") return `mcp:${item.value.serverName}:${item.value.toolName}`;
  return `entity:${item.type}:${item.id}`;
}
function buildProjectReference(id, projects, fallbackName) {
  if (!id) return null;
  const project = projects.find((item) => item.id === id);
  return {
    id,
    name: project?.name || fallbackName,
    description: project?.description ?? void 0
  };
}
function buildEntityItems(refs) {
  const projectId = refs.find((ref2) => ref2.type === "project")?.id ?? null;
  return refs.filter((ref2) => ref2.type !== "project").map((ref2) => ({
    kind: "entity",
    type: ref2.type,
    id: ref2.id,
    name: ref2.name,
    projectId
  }));
}
function entitySearchText(item) {
  return [
    item.name,
    item.type,
    String(item.id),
    item.projectId != null ? String(item.projectId) : ""
  ].filter(Boolean).join(" ");
}
const REFERENCES_CACHE_TTL_MS = 3e4;
let cachedReferenceOptions = null;
let cachedReferenceOptionsAt = 0;
let referenceOptionsRequest = null;
let cachedProjects = null;
let cachedProjectsAt = 0;
let projectsRequest = null;
async function defaultLoadReferenceProjects() {
  return getAssistantPageContext().filter((ref2) => ref2.type === "project").map((ref2) => ({ id: ref2.id, name: ref2.name ?? `项目 #${ref2.id}` }));
}
function loadAssistantReferenceOptions() {
  if (cachedReferenceOptions && Date.now() - cachedReferenceOptionsAt < REFERENCES_CACHE_TTL_MS) {
    return Promise.resolve(cachedReferenceOptions);
  }
  if (!referenceOptionsRequest) {
    referenceOptionsRequest = getAssistantReferenceOptions().then((result) => {
      cachedReferenceOptions = result;
      cachedReferenceOptionsAt = Date.now();
      referenceOptionsRequest = null;
      return result;
    }).catch((error) => {
      referenceOptionsRequest = null;
      throw error;
    });
  }
  return referenceOptionsRequest;
}
function loadAssistantReferenceProjects() {
  const provider = defaultLoadReferenceProjects;
  if (cachedProjects && Date.now() - cachedProjectsAt < REFERENCES_CACHE_TTL_MS) {
    return Promise.resolve(cachedProjects);
  }
  if (!projectsRequest) {
    projectsRequest = provider().then((result) => {
      cachedProjects = result;
      cachedProjectsAt = Date.now();
      projectsRequest = null;
      return result;
    }).catch((error) => {
      projectsRequest = null;
      throw error;
    });
  }
  return projectsRequest;
}
const _hoisted_1$3 = {
  class: "assistant-composer",
  "data-testid": "assistant-composer"
};
const _hoisted_2$2 = {
  key: 0,
  class: "assistant-composer__alert",
  "data-testid": "assistant-composer-alert"
};
const _hoisted_3$2 = { class: "assistant-composer__alert-text" };
const _hoisted_4$2 = {
  key: 1,
  class: "assistant-composer__references",
  "data-testid": "assistant-references"
};
const _hoisted_5$2 = { class: "assistant-composer__references-label" };
const _hoisted_6$2 = {
  key: 2,
  class: "assistant-composer__attachments",
  "data-testid": "assistant-attachments"
};
const _hoisted_7$2 = ["value", "placeholder", "disabled", "aria-expanded"];
const _hoisted_8$2 = ["aria-label"];
const _hoisted_9$2 = { class: "assistant-composer__picker-head" };
const _hoisted_10$2 = { class: "assistant-composer__picker-badge" };
const _hoisted_11$2 = { class: "assistant-composer__picker-titles" };
const _hoisted_12$1 = { class: "assistant-composer__picker-title" };
const _hoisted_13$1 = { class: "assistant-composer__picker-hint" };
const _hoisted_14$1 = {
  key: 0,
  class: "assistant-composer__picker-state",
  "data-testid": "assistant-reference-loading"
};
const _hoisted_15$1 = {
  key: 1,
  class: "assistant-composer__picker-state is-error",
  "data-testid": "assistant-reference-error"
};
const _hoisted_16$1 = ["data-active", "aria-selected", "data-testid", "onMouseenter", "onClick"];
const _hoisted_17$1 = { class: "assistant-composer__picker-item-icon" };
const _hoisted_18$1 = { class: "assistant-composer__picker-item-main" };
const _hoisted_19$1 = { class: "assistant-composer__picker-item-eyebrow" };
const _hoisted_20$1 = { class: "assistant-composer__picker-item-label" };
const _hoisted_21$1 = { class: "assistant-composer__picker-item-desc" };
const _hoisted_22$1 = {
  key: 0,
  class: "ri-check-line assistant-composer__picker-item-check"
};
const _hoisted_23$1 = {
  key: 3,
  class: "assistant-composer__picker-state",
  "data-testid": "assistant-reference-empty"
};
const _hoisted_24 = { class: "assistant-composer__controls" };
const _hoisted_25 = ["accept"];
const ASSISTANT_MODELS_CACHE_TTL_MS = 3e4;
const _sfc_main$3 = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantComposer" },
  __name: "AssistantComposer",
  props: {
    projectId: { type: [Number, null] }
  },
  setup(__props) {
    const props = __props;
    const { t } = useI18n();
    const store = useAssistantStore();
    let cachedModels = null;
    let cachedAt = 0;
    let modelsRequest = null;
    function loadAssistantModels() {
      if (cachedModels && Date.now() - cachedAt < ASSISTANT_MODELS_CACHE_TTL_MS) {
        return Promise.resolve(cachedModels);
      }
      if (!modelsRequest) {
        modelsRequest = aiModelApi.listByType(1).then((result) => {
          cachedModels = result;
          cachedAt = Date.now();
          modelsRequest = null;
          return result;
        }).catch((error) => {
          modelsRequest = null;
          throw error;
        });
      }
      return modelsRequest;
    }
    const models = /* @__PURE__ */ ref([]);
    const modelsLoading = /* @__PURE__ */ ref(true);
    const modelsError = /* @__PURE__ */ ref(null);
    async function beginLoadModels() {
      modelsLoading.value = true;
      modelsError.value = null;
      try {
        const result = await loadAssistantModels();
        models.value = result;
        const currentSelectedModelId = store.selectedModelId;
        const preferred = currentSelectedModelId && result.some((model) => model.id === currentSelectedModelId) ? currentSelectedModelId : result.find((model) => model.defaultModel)?.id ?? result[0]?.id ?? null;
        if (preferred !== currentSelectedModelId) store.setSelectedModelId(preferred);
      } catch (error) {
        modelsError.value = error instanceof Error ? error.message : t("assistant.model-load-failed");
      } finally {
        modelsLoading.value = false;
      }
    }
    const selectedConversationId = computed(() => store.selectedConversationId);
    const runtime2 = computed(() => selectedConversationId.value ? store.conversationStates[selectedConversationId.value] : void 0);
    const text = computed({
      get: () => selectedConversationId.value ? runtime2.value?.draft ?? "" : store.newDraft,
      set: (value) => store.setDraft(selectedConversationId.value, value)
    });
    const running = computed(() => !!runtime2.value && statusIsRunning(runtime2.value.status));
    const cancelling = computed(() => runtime2.value?.status === "CANCEL_REQUESTED");
    const currentConnection = computed(() => store.connection?.conversationId === selectedConversationId.value);
    const runtimeMessagesError = computed(() => runtime2.value?.messagesError);
    const selectedModel = computed(() => models.value.find((model) => model.id === store.selectedModelId) ?? null);
    const reasoningEffort = /* @__PURE__ */ ref(null);
    const effortOptions = computed(() => (selectedModel.value?.supportReasoning ? selectedModel.value?.reasoningEffortLevels ?? [] : []).map((level) => ({ label: level, value: level })));
    watch(() => [
      selectedModel.value?.id,
      selectedModel.value?.supportReasoning,
      selectedModel.value?.reasoningEffortLevels
    ], () => {
      const model = selectedModel.value;
      reasoningEffort.value = model?.supportReasoning ? model.reasoningEffortLevels?.[0] ?? null : null;
    }, { immediate: true });
    const toolModeOptions = computed(() => ["DEFAULT", "ALWAYS_ASK", "ALWAYS_ALLOW", "FULL_ACCESS"].map((mode) => ({
      label: t(`assistant.tool-mode-${mode}`),
      value: mode
    })));
    const referenceOptions = /* @__PURE__ */ ref({ skills: [], mcpTools: [] });
    const selectedSkills = /* @__PURE__ */ ref([]);
    const selectedMcpTools = /* @__PURE__ */ ref([]);
    const projects = /* @__PURE__ */ ref([]);
    const capabilitiesLoading = /* @__PURE__ */ ref(true);
    const projectsLoading = /* @__PURE__ */ ref(true);
    const capabilitiesError = /* @__PURE__ */ ref(null);
    const projectsError = /* @__PURE__ */ ref(null);
    const projectOverride = /* @__PURE__ */ ref(void 0);
    const picker = /* @__PURE__ */ ref(null);
    const activeIndex = /* @__PURE__ */ ref(0);
    const conversationProjectId = computed(() => runtime2.value?.conversation.projectId ?? null);
    const effectiveProjectId = computed(() => selectedConversationId.value ? conversationProjectId.value : props.projectId ?? null);
    const inheritedProject = computed(() => buildProjectReference(
      effectiveProjectId.value,
      projects.value,
      t("assistant.reference-project-fallback", { id: effectiveProjectId.value ?? 0 })
    ));
    const selectedProject = computed(() => projectOverride.value === void 0 ? inheritedProject.value : projectOverride.value);
    const capabilityItems = computed(() => [
      ...referenceOptions.value.skills.map((value) => ({ kind: "skill", value })),
      ...referenceOptions.value.mcpTools.map((value) => ({ kind: "mcp", value }))
    ]);
    const projectPickerCandidates = computed(() => [
      ...buildEntityItems(getAssistantPageContext()),
      ...projects.value.map((project) => ({
        kind: "project",
        value: { id: project.id, name: project.name, description: project.description ?? void 0 }
      }))
    ]);
    function pickerSearchText(item) {
      if (item.kind === "project") {
        return `${item.value.name} ${item.value.id} ${item.value.description || ""}`;
      }
      if (item.kind === "entity") return entitySearchText(item);
      return capabilitySearchText(item);
    }
    const pickerItems = computed(() => {
      if (!picker.value) return [];
      const candidates = picker.value.mode === "project" ? projectPickerCandidates.value : capabilityItems.value;
      return filterPickerItems(candidates, picker.value.query, pickerSearchText);
    });
    const selectedKeys = computed(() => /* @__PURE__ */ new Set([
      ...selectedProject.value ? [`project:${selectedProject.value.id}`] : [],
      ...selectedSkills.value.map((skill) => `skill:${skill.id}`),
      ...selectedMcpTools.value.map((tool) => `mcp:${tool.serverName}:${tool.toolName}`)
    ]));
    const pickerTitle = computed(() => picker.value?.mode === "project" ? t("assistant.reference-project-title") : t("assistant.reference-capability-title"));
    const pickerHint = computed(() => picker.value?.query ? t("assistant.reference-searching", { query: picker.value.query }) : picker.value?.mode === "project" ? t("assistant.reference-project-hint") : t("assistant.reference-capability-hint"));
    const pickerLoading = computed(() => picker.value?.mode === "project" ? projectsLoading.value : capabilitiesLoading.value);
    const pickerError = computed(() => picker.value?.mode === "project" ? projectsError.value : capabilitiesError.value);
    const pickerEmptyText = computed(() => picker.value?.mode === "project" ? t("assistant.reference-empty-project") : t("assistant.reference-empty-capability"));
    const ENTITY_TYPE_LABEL_KEYS = {
      project: "assistant.entity-project",
      script: "assistant.entity-script",
      storyboard: "assistant.entity-storyboard",
      storyboardEpisode: "assistant.entity-storyboardEpisode",
      storyboardItem: "assistant.entity-storyboardItem",
      asset: "assistant.entity-asset"
    };
    function entityTypeLabel(type) {
      const key = ENTITY_TYPE_LABEL_KEYS[type];
      return key ? t(key) : type;
    }
    function itemEyebrow(item) {
      if (item.kind === "project") return t("assistant.reference-project-eyebrow", { id: item.value.id });
      if (item.kind === "skill") return t("assistant.reference-skill-eyebrow", { name: item.value.name });
      if (item.kind === "mcp") return t("assistant.reference-mcp-eyebrow", { server: item.value.serverName });
      return `${entityTypeLabel(item.type)} #${item.id}`;
    }
    function itemLabel(item) {
      if (item.kind === "project") return item.value.name;
      if (item.kind === "skill") return item.value.displayName;
      if (item.kind === "mcp") return item.value.toolName;
      return item.name || entityTypeLabel(item.type);
    }
    function itemDescription(item) {
      if (item.kind === "project") return item.value.description || t("assistant.reference-entity-context");
      if (item.kind === "skill") return item.value.description;
      if (item.kind === "mcp") return item.value.description || t("assistant.reference-mcp-default-desc");
      return t("assistant.reference-attach-project");
    }
    function itemIcon(item) {
      if (item.kind === "project") return "ri-folder-kanban-line";
      if (item.kind === "skill") return "ri-sparkling-2-line";
      if (item.kind === "mcp") return "ri-flashlight-line";
      if (item.type === "script") return "ri-file-text-line";
      if (item.type === "asset") return "ri-image-2-line";
      return "ri-movie-2-line";
    }
    function itemKey(item) {
      return referenceItemKey(item);
    }
    function itemSelected(item) {
      if (item.kind === "entity") {
        return item.projectId != null && selectedProject.value?.id === item.projectId;
      }
      return selectedKeys.value.has(referenceItemKey(item));
    }
    function updateText(value) {
      store.setDraft(selectedConversationId.value, value);
    }
    function updateTextWithTrigger(value, cursor) {
      updateText(value);
      const nextPicker = detectReferenceTrigger(value, cursor);
      const keepIndex = picker.value?.mode === nextPicker?.mode && picker.value?.query === nextPicker?.query;
      picker.value = nextPicker;
      if (!keepIndex) activeIndex.value = 0;
    }
    function closePicker() {
      if (picker.value) picker.value = null;
    }
    function replaceTrigger() {
      const current = picker.value;
      if (!current) return;
      const next = text.value.slice(0, current.start) + text.value.slice(current.end);
      updateText(next);
      const cursor = current.start;
      picker.value = null;
      void nextTick(() => {
        const element = textareaElement();
        element?.focus({ preventScroll: true });
        element?.setSelectionRange(cursor, cursor);
      });
    }
    function selectProject(project) {
      projectOverride.value = project;
    }
    function selectPickerItem(item) {
      if (item.kind === "project") {
        selectProject(item.value);
      } else if (item.kind === "entity") {
        if (item.projectId == null) return;
        selectProject(buildProjectReference(
          item.projectId,
          projects.value,
          t("assistant.reference-project-fallback", { id: item.projectId })
        ));
      } else if (item.kind === "skill") {
        if (!selectedSkills.value.some((skill) => skill.id === item.value.id)) {
          selectedSkills.value = [...selectedSkills.value, item.value];
        }
      } else if (!selectedMcpTools.value.some((tool) => tool.serverName === item.value.serverName && tool.toolName === item.value.toolName)) {
        selectedMcpTools.value = [...selectedMcpTools.value, item.value];
      }
      replaceTrigger();
    }
    function setActiveIndex(index) {
      activeIndex.value = index;
    }
    function handlePickerKeyDown(event) {
      if (!picker.value) return false;
      if (event.key === "Escape") {
        event.preventDefault();
        closePicker();
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (!pickerItems.value.length) return true;
        const total = pickerItems.value.length;
        activeIndex.value = event.key === "ArrowDown" ? (activeIndex.value + 1) % total : (activeIndex.value - 1 + total) % total;
        return true;
      }
      const active2 = pickerItems.value[activeIndex.value];
      if ((event.key === "Enter" || event.key === "Tab") && active2) {
        event.preventDefault();
        selectPickerItem(active2);
        return true;
      }
      return false;
    }
    const attachments = /* @__PURE__ */ ref([]);
    const uploading = /* @__PURE__ */ ref(false);
    const fileInput = /* @__PURE__ */ ref(null);
    let preparingAttachments = false;
    let attachmentsScope = 0;
    watch(selectedConversationId, () => {
      attachmentsScope += 1;
      attachments.value = [];
      projectOverride.value = void 0;
      selectedSkills.value = [];
      selectedMcpTools.value = [];
      picker.value = null;
      activeIndex.value = 0;
    });
    const canAddAttachments = computed(() => !!selectedModel.value?.multimodalInputTypes?.length);
    const attachmentInputAccept = computed(() => attachmentAccept(selectedModel.value));
    const capabilitySummary = computed(() => {
      const summary = multimodalCapabilitySummary(selectedModel.value);
      if (summary.textOnly) return t("assistant.attachment-text-only");
      const capabilities = summary.parts.map(({ type, transports }) => {
        const labels = transports.map((transport) => t(transport === "url" ? "assistant.attachment-capability-transport-url" : "assistant.attachment-capability-transport-base64"));
        const suffix = labels.length ? `（${labels.join("/")}）` : "";
        return `${t(`assistant.attachment-type-${type}`)}${suffix}`;
      });
      return t("assistant.attachment-capability-add", { capabilities: capabilities.join("、") });
    });
    const compatibilityError = computed(() => attachmentCompatibilityError(selectedModel.value, attachments.value));
    function localizedMessage(message) {
      if (!message) return null;
      const params = {};
      for (const [key, value] of Object.entries(message.params)) {
        params[key] = typeof value === "string" && /^(image|video|audio|file)$/.test(value) ? t(`assistant.attachment-type-${value}`) : value;
      }
      return t(message.key, params);
    }
    function attachmentError(error) {
      if (error instanceof AssistantAttachmentError) {
        return localizedMessage({ key: error.key, params: error.params }) ?? error.message;
      }
      return error instanceof Error ? error.message : t("assistant.send-failed");
    }
    async function addFiles(files) {
      if (!files.length) return;
      if (!selectedModel.value) {
        throw new AssistantAttachmentError("assistant.attachment-model-required", {}, "请先选择对话模型");
      }
      if (preparingAttachments) {
        throw new AssistantAttachmentError("assistant.attachment-busy", {}, "附件正在处理中，请稍候");
      }
      const scope = attachmentsScope;
      preparingAttachments = true;
      uploading.value = true;
      try {
        const next = await prepareAssistantAttachments({
          files,
          model: selectedModel.value,
          existing: attachments.value
        });
        if (scope !== attachmentsScope) return;
        attachments.value = [...attachments.value, ...next];
      } finally {
        preparingAttachments = false;
        uploading.value = false;
        if (fileInput.value) fileInput.value.value = "";
      }
    }
    function removeAttachment(id) {
      attachments.value = attachments.value.filter((item) => item.id !== id);
    }
    const urlFallbackHints = computed(() => {
      const hints = {};
      for (const attachment of attachments.value) {
        const hint = attachmentUrlFallbackHint(attachment);
        if (hint) hints[attachment.id] = t(hint.key, hint.params);
      }
      return hints;
    });
    function clearAttachments() {
      attachments.value = [];
    }
    function onFilesSelected(event) {
      const input = event.target;
      const files = Array.from(input.files ?? []);
      sendError.value = null;
      void addFiles(files).catch((error) => {
        sendError.value = attachmentError(error);
      });
    }
    function onPaste(event) {
      const items = Array.from(event.clipboardData?.items ?? []);
      const files = items.filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file) => !!file);
      if (!files.length) return;
      event.preventDefault();
      sendError.value = null;
      void addFiles(files).catch((error) => {
        sendError.value = attachmentError(error);
      });
    }
    const submitting = /* @__PURE__ */ ref(false);
    const sendError = /* @__PURE__ */ ref(null);
    const sendDisabled = computed(() => !text.value.trim() && !attachments.value.length || !store.selectedModelId || !models.value.length || submitting.value || uploading.value || !!compatibilityError.value || !!modelsError.value);
    const hasReferences = computed(() => !!selectedProject.value || selectedSkills.value.length > 0 || selectedMcpTools.value.length > 0);
    const alertMessage = computed(() => sendError.value || modelsError.value || runtimeMessagesError.value || localizedMessage(compatibilityError.value));
    async function submit() {
      if (!text.value.trim() && !attachments.value.length || submitting.value || running.value || !store.selectedModelId || !models.value.length || uploading.value || compatibilityError.value) return;
      submitting.value = true;
      sendError.value = null;
      try {
        const referencedProjectId = selectedProject.value?.id ?? null;
        if (selectedConversationId.value && referencedProjectId !== (conversationProjectId.value ?? null)) {
          store.setDraft(null, text.value);
          store.startNewConversation();
        }
        await store.sendMessage(
          text.value,
          store.selectedModelId,
          reasoningEffort.value,
          referencedProjectId,
          {
            project: selectedProject.value,
            skills: selectedSkills.value,
            mcpTools: selectedMcpTools.value,
            multimodalInputs: attachments.value.map((attachment) => ({
              id: attachment.id,
              name: attachment.name,
              inputType: attachment.inputType,
              mimeType: attachment.mimeType,
              transport: attachment.transport,
              url: attachment.url,
              data: attachment.data,
              resourceUrl: attachment.resourceUrl,
              size: attachment.size
            }))
          }
        );
        updateText("");
        clearAttachments();
        projectOverride.value = void 0;
        selectedSkills.value = [];
        selectedMcpTools.value = [];
      } catch (error) {
        sendError.value = error instanceof Error ? error.message : t("assistant.send-failed");
      } finally {
        submitting.value = false;
      }
    }
    let composing = false;
    function onCompositionStart() {
      composing = true;
    }
    function onCompositionEnd() {
      composing = false;
    }
    const inputRef = /* @__PURE__ */ ref(null);
    function textareaElement() {
      return inputRef.value ?? void 0;
    }
    function onTextInput(event) {
      const value = event.target.value;
      const element = textareaElement();
      const cursor = element?.selectionStart ?? value.length;
      updateTextWithTrigger(value, cursor);
    }
    function onKeydown(event) {
      if (handlePickerKeyDown(event)) return;
      if (event.key !== "Enter" || !event.ctrlKey || composing) return;
      event.preventDefault();
      void submit();
    }
    const activeItemRef = /* @__PURE__ */ ref(null);
    const pickerListRef = /* @__PURE__ */ ref(null);
    watch(activeIndex, () => {
      void nextTick(() => {
        const list = pickerListRef.value;
        if (!list) return;
        const active2 = list.querySelector('[data-active="true"]');
        if (active2 instanceof HTMLElement && active2 !== activeItemRef.value) {
          activeItemRef.value = active2;
        }
        activeItemRef.value?.scrollIntoView?.({ block: "nearest" });
      });
    });
    async function stop() {
      sendError.value = null;
      try {
        await store.stopGeneration();
      } catch (error) {
        sendError.value = error instanceof Error ? error.message : t("assistant.stop-failed");
      }
    }
    function beginLoadReferenceData() {
      void loadAssistantReferenceOptions().then((result) => {
        referenceOptions.value = result;
        capabilitiesError.value = null;
      }).catch((error) => {
        capabilitiesError.value = error instanceof Error ? error.message : t("assistant.reference-load-failed");
      }).finally(() => {
        capabilitiesLoading.value = false;
      });
      void loadAssistantReferenceProjects().then((result) => {
        projects.value = result;
        projectsError.value = null;
      }).catch((error) => {
        projectsError.value = error instanceof Error ? error.message : t("assistant.reference-projects-load-failed");
      }).finally(() => {
        projectsLoading.value = false;
      });
    }
    onMounted(() => {
      void beginLoadModels();
      beginLoadReferenceData();
    });
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", _hoisted_1$3, [
        alertMessage.value ? (openBlock(), createElementBlock("p", _hoisted_2$2, [
          createBaseVNode("span", _hoisted_3$2, toDisplayString(alertMessage.value), 1),
          modelsError.value ? (openBlock(), createElementBlock("button", {
            key: 0,
            type: "button",
            class: "assistant-composer__alert-retry fc-button-ghost",
            onClick: _cache[0] || (_cache[0] = ($event) => beginLoadModels())
          }, toDisplayString(unref(t)("assistant.retry")), 1)) : createCommentVNode("", true)
        ])) : createCommentVNode("", true),
        hasReferences.value ? (openBlock(), createElementBlock("div", _hoisted_4$2, [
          createBaseVNode("span", _hoisted_5$2, toDisplayString(unref(t)("assistant.reference-label")), 1),
          selectedProject.value ? (openBlock(), createBlock(IaTag, {
            key: 0,
            color: "brand",
            closable: true,
            "data-testid": `assistant-reference-chip-project:${selectedProject.value.id}`,
            onClose: _cache[1] || (_cache[1] = ($event) => selectProject(null))
          }, {
            default: withCtx(() => [
              createTextVNode(toDisplayString(selectedProject.value.name), 1)
            ]),
            _: 1
          }, 8, ["data-testid"])) : createCommentVNode("", true),
          (openBlock(true), createElementBlock(Fragment, null, renderList(selectedSkills.value, (skill) => {
            return openBlock(), createBlock(IaTag, {
              key: skill.id,
              color: "primary",
              closable: true,
              "data-testid": `assistant-reference-chip-skill:${skill.id}`,
              title: unref(t)("assistant.reference-skill-eyebrow", { name: skill.name }),
              onClose: ($event) => selectedSkills.value = selectedSkills.value.filter((item) => item.id !== skill.id)
            }, {
              default: withCtx(() => [
                createTextVNode(toDisplayString(skill.displayName), 1)
              ]),
              _: 2
            }, 1032, ["data-testid", "title", "onClose"]);
          }), 128)),
          (openBlock(true), createElementBlock(Fragment, null, renderList(selectedMcpTools.value, (tool) => {
            return openBlock(), createBlock(IaTag, {
              key: `${tool.serverName}:${tool.toolName}`,
              color: "primary",
              closable: true,
              "data-testid": `assistant-reference-chip-mcp:${tool.serverName}:${tool.toolName}`,
              title: unref(t)("assistant.reference-mcp-eyebrow", { server: tool.serverName }),
              onClose: ($event) => selectedMcpTools.value = selectedMcpTools.value.filter((item) => item.serverName !== tool.serverName || item.toolName !== tool.toolName)
            }, {
              default: withCtx(() => [
                createTextVNode(toDisplayString(tool.toolName), 1)
              ]),
              _: 2
            }, 1032, ["data-testid", "title", "onClose"]);
          }), 128))
        ])) : createCommentVNode("", true),
        attachments.value.length ? (openBlock(), createElementBlock("div", _hoisted_6$2, [
          (openBlock(true), createElementBlock(Fragment, null, renderList(attachments.value, (attachment) => {
            return openBlock(), createBlock(AssistantAttachmentChip, {
              key: attachment.id,
              attachment,
              removable: true,
              "remove-disabled": submitting.value || running.value,
              hint: urlFallbackHints.value[attachment.id],
              onRemove: ($event) => removeAttachment(attachment.id)
            }, null, 8, ["attachment", "remove-disabled", "hint", "onRemove"]);
          }), 128))
        ])) : createCommentVNode("", true),
        createBaseVNode("textarea", {
          ref_key: "inputRef",
          ref: inputRef,
          value: text.value,
          rows: "3",
          resize: "none",
          placeholder: unref(t)("assistant.input-placeholder-hint"),
          class: "assistant-composer__input",
          disabled: !models.value.length || modelsLoading.value || submitting.value || running.value,
          "aria-expanded": !!picker.value,
          "data-testid": "assistant-input",
          onInput: onTextInput,
          onCompositionstart: onCompositionStart,
          onCompositionend: onCompositionEnd,
          onPaste,
          onBlur: closePicker,
          onKeydown
        }, null, 40, _hoisted_7$2),
        picker.value ? (openBlock(), createElementBlock("div", {
          key: 3,
          class: "assistant-composer__picker",
          "data-testid": "assistant-reference-picker",
          role: "listbox",
          "aria-label": pickerTitle.value
        }, [
          createBaseVNode("div", _hoisted_9$2, [
            createBaseVNode("span", _hoisted_10$2, toDisplayString(picker.value.mode === "project" ? "@" : "/"), 1),
            createBaseVNode("span", _hoisted_11$2, [
              createBaseVNode("span", _hoisted_12$1, toDisplayString(pickerTitle.value), 1),
              createBaseVNode("span", _hoisted_13$1, toDisplayString(pickerHint.value), 1)
            ])
          ]),
          createBaseVNode("div", {
            ref_key: "pickerListRef",
            ref: pickerListRef,
            class: "assistant-composer__picker-list"
          }, [
            pickerLoading.value ? (openBlock(), createElementBlock("p", _hoisted_14$1, [
              _cache[7] || (_cache[7] = createBaseVNode("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.reference-loading")), 1)
            ])) : pickerError.value ? (openBlock(), createElementBlock("p", _hoisted_15$1, toDisplayString(pickerError.value), 1)) : pickerItems.value.length ? (openBlock(true), createElementBlock(Fragment, { key: 2 }, renderList(pickerItems.value, (item, index) => {
              return openBlock(), createElementBlock("button", {
                key: itemKey(item),
                type: "button",
                role: "option",
                class: normalizeClass(["assistant-composer__picker-item fc-button-ghost", { "is-active": index === activeIndex.value }]),
                "data-active": index === activeIndex.value,
                "aria-selected": itemSelected(item),
                "data-testid": `assistant-reference-item-${itemKey(item)}`,
                onMousedown: _cache[2] || (_cache[2] = withModifiers(() => {
                }, ["prevent"])),
                onMouseenter: ($event) => setActiveIndex(index),
                onClick: ($event) => selectPickerItem(item)
              }, [
                createBaseVNode("span", _hoisted_17$1, [
                  createBaseVNode("i", {
                    class: normalizeClass(itemIcon(item))
                  }, null, 2)
                ]),
                createBaseVNode("span", _hoisted_18$1, [
                  createBaseVNode("span", _hoisted_19$1, toDisplayString(itemEyebrow(item)), 1),
                  createBaseVNode("span", _hoisted_20$1, toDisplayString(itemLabel(item)), 1),
                  createBaseVNode("span", _hoisted_21$1, toDisplayString(itemDescription(item)), 1)
                ]),
                itemSelected(item) ? (openBlock(), createElementBlock("i", _hoisted_22$1)) : createCommentVNode("", true)
              ], 42, _hoisted_16$1);
            }), 128)) : (openBlock(), createElementBlock("p", _hoisted_23$1, toDisplayString(picker.value.query ? unref(t)("assistant.reference-no-match") : pickerEmptyText.value), 1))
          ], 512)
        ], 8, _hoisted_8$2)) : createCommentVNode("", true),
        createBaseVNode("div", _hoisted_24, [
          createVNode(IaSelect, {
            "model-value": unref(store).selectedModelId ?? void 0,
            options: models.value.map((model) => ({ label: model.name, value: model.id })),
            loading: modelsLoading.value,
            placeholder: unref(t)("assistant.model"),
            size: "small",
            class: "assistant-composer__model",
            "data-testid": "assistant-model-select",
            "onUpdate:modelValue": _cache[3] || (_cache[3] = (value) => unref(store).setSelectedModelId(value === void 0 ? null : Number(value)))
          }, null, 8, ["model-value", "options", "loading", "placeholder"]),
          effortOptions.value.length ? (openBlock(), createBlock(IaSelect, {
            key: 0,
            "model-value": reasoningEffort.value ?? void 0,
            options: effortOptions.value,
            placeholder: unref(t)("assistant.reasoning-effort"),
            size: "small",
            class: "assistant-composer__effort",
            "data-testid": "assistant-effort-select",
            "onUpdate:modelValue": _cache[4] || (_cache[4] = (value) => {
              reasoningEffort.value = value === void 0 ? null : String(value);
            })
          }, null, 8, ["model-value", "options", "placeholder"])) : createCommentVNode("", true),
          createVNode(IaSelect, {
            "model-value": selectedConversationId.value ? runtime2.value?.toolExecutionMode : unref(store).newToolExecutionMode,
            options: toolModeOptions.value,
            disabled: submitting.value || running.value,
            placeholder: unref(t)("assistant.tool-mode"),
            size: "small",
            class: "assistant-composer__tool-mode",
            "data-testid": "assistant-tool-mode",
            "onUpdate:modelValue": _cache[5] || (_cache[5] = (value) => unref(store).setToolExecutionMode(value))
          }, null, 8, ["model-value", "options", "disabled", "placeholder"]),
          _cache[12] || (_cache[12] = createBaseVNode("div", { class: "assistant-composer__spacer" }, null, -1)),
          createBaseVNode("input", {
            ref_key: "fileInput",
            ref: fileInput,
            type: "file",
            class: "assistant-composer__file-input",
            accept: attachmentInputAccept.value,
            multiple: "",
            "data-testid": "assistant-attachment-input",
            onChange: onFilesSelected
          }, null, 40, _hoisted_25),
          canAddAttachments.value ? (openBlock(), createBlock(IaButton, {
            key: 1,
            variant: "text",
            size: "sm",
            disabled: submitting.value || running.value,
            title: capabilitySummary.value,
            "aria-label": unref(t)("assistant.attachment-add"),
            "data-testid": "assistant-attachment-add",
            onClick: _cache[6] || (_cache[6] = ($event) => fileInput.value?.click())
          }, {
            default: withCtx(() => [..._cache[8] || (_cache[8] = [
              createBaseVNode("i", { class: "ri-attachment-2" }, null, -1)
            ])]),
            _: 1
          }, 8, ["disabled", "title", "aria-label"])) : createCommentVNode("", true),
          cancelling.value ? (openBlock(), createBlock(IaButton, {
            key: 2,
            variant: "danger",
            size: "sm",
            disabled: "",
            "data-testid": "assistant-cancelling"
          }, {
            default: withCtx(() => [
              _cache[9] || (_cache[9] = createBaseVNode("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.stopping")), 1)
            ]),
            _: 1
          })) : running.value || currentConnection.value ? (openBlock(), createBlock(IaButton, {
            key: 3,
            variant: "danger",
            size: "sm",
            "data-testid": "assistant-stop",
            onClick: stop
          }, {
            default: withCtx(() => [
              _cache[10] || (_cache[10] = createBaseVNode("i", { class: "ri-stop-line" }, null, -1)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.stop")), 1)
            ]),
            _: 1
          })) : (openBlock(), createBlock(IaButton, {
            key: 4,
            variant: "secondary",
            size: "sm",
            disabled: sendDisabled.value,
            loading: submitting.value,
            "data-testid": "assistant-send",
            onClick: submit
          }, {
            default: withCtx(() => [
              _cache[11] || (_cache[11] = createBaseVNode("i", { class: "ri-send-plane-2-line" }, null, -1)),
              createTextVNode(" " + toDisplayString(unref(t)("assistant.send")), 1)
            ]),
            _: 1
          }, 8, ["disabled", "loading"]))
        ])
      ]);
    };
  }
});
const _style_0$3 = ".assistant-composer[data-v-a5a64d4a] {\n  position: relative;\n  flex-shrink: 0;\n  padding: 10px 14px 14px;\n  border-top: 1px solid var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-composer__alert[data-v-a5a64d4a] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin: 0 0 8px;\n  padding: 6px 10px;\n  border-radius: var(--app-radius-md);\n  border: 1px solid var(--el-color-danger-light-7, #fde2e2);\n  background: var(--el-color-danger-light-9, #fef0f0);\n  font-size: 11px;\n  color: var(--el-color-danger, #f56c6c);\n}\n.assistant-composer__alert-text[data-v-a5a64d4a] {\n  flex: 1;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-composer__alert-retry[data-v-a5a64d4a] {\n  flex-shrink: 0;\n  border: none;\n  background: none;\n  cursor: pointer;\n  font-size: 11px;\n  color: var(--el-color-danger, #f56c6c);\n  text-decoration: underline;\n}\n.assistant-composer__references[data-v-a5a64d4a] {\n  display: flex;\n  flex-wrap: wrap;\n  align-items: center;\n  gap: 6px;\n  padding: 0 2px 8px;\n}\n.assistant-composer__references-label[data-v-a5a64d4a] {\n  font-size: 10px;\n  font-weight: 600;\n  color: var(--app-text-secondary);\n}\n.assistant-composer__attachments[data-v-a5a64d4a] {\n  display: flex;\n  gap: 8px;\n  overflow-x: auto;\n  padding: 0 2px 8px;\n}\n.assistant-composer__input[data-v-a5a64d4a] {\n  display: block;\n  width: 100%;\n  min-height: 60px;\n  padding: 8px 10px;\n  border: 1px solid var(--app-separator, var(--ia-separator, #dcdfe6));\n  border-radius: var(--app-radius-md, 8px);\n  background: var(--app-bg-card, var(--ia-bg-card, #fff));\n  color: var(--app-text, var(--ia-text, #303133));\n  font-size: 13px;\n  line-height: 1.6;\n  font-family: inherit;\n  box-sizing: border-box;\n}\n.assistant-composer__input[data-v-a5a64d4a]:focus {\n  outline: none;\n  border-color: var(--app-primary, var(--ia-primary, #409eff));\n}\n.assistant-composer__input[data-v-a5a64d4a]:disabled {\n  cursor: not-allowed;\n  opacity: 0.6;\n}\n.assistant-composer__input[data-v-a5a64d4a]::placeholder {\n  color: var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));\n  white-space: pre-line;\n}\n.assistant-composer__picker[data-v-a5a64d4a] {\n  position: absolute;\n  left: 14px;\n  right: 14px;\n  bottom: calc(100% - 6px);\n  z-index: 20;\n  display: flex;\n  flex-direction: column;\n  max-height: 280px;\n  padding: 8px;\n  border-radius: var(--app-radius-lg, 12px);\n  border: 1px solid var(--app-separator, var(--el-border-color-light));\n  background: var(--app-bg-card, var(--el-bg-color));\n  box-shadow: var(--app-shadow-lg, var(--el-box-shadow-light));\n}\n.assistant-composer__picker-head[data-v-a5a64d4a] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 2px 8px 8px;\n  border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-composer__picker-badge[data-v-a5a64d4a] {\n  display: grid;\n  place-items: center;\n  width: 26px;\n  height: 26px;\n  flex-shrink: 0;\n  border-radius: var(--app-radius-sm);\n  font-size: 13px;\n  font-weight: 700;\n  color: var(--app-text-secondary);\n  background: color-mix(in srgb, var(--app-primary) 10%, transparent);\n}\n.assistant-composer__picker-titles[data-v-a5a64d4a] {\n  display: flex;\n  flex-direction: column;\n  min-width: 0;\n}\n.assistant-composer__picker-title[data-v-a5a64d4a] {\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--app-text);\n}\n.assistant-composer__picker-hint[data-v-a5a64d4a] {\n  font-size: 10px;\n  color: var(--app-text-secondary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-composer__picker-list[data-v-a5a64d4a] {\n  min-height: 0;\n  overflow-y: auto;\n  padding-top: 4px;\n}\n.assistant-composer__picker-state[data-v-a5a64d4a] {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  margin: 0;\n  padding: 20px 12px;\n  font-size: 12px;\n  color: var(--app-text-secondary);\n}\n.assistant-composer__picker-state.is-error[data-v-a5a64d4a] {\n  color: var(--el-color-danger, #f56c6c);\n}\n.assistant-composer__picker-item[data-v-a5a64d4a] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  width: 100%;\n  min-height: 44px;\n  padding: 8px;\n  border: none;\n  border-radius: var(--app-radius-md);\n  background: none;\n  cursor: pointer;\n  text-align: left;\n}\n.assistant-composer__picker-item[data-v-a5a64d4a]:hover, .assistant-composer__picker-item.is-active[data-v-a5a64d4a] {\n  background: color-mix(in srgb, var(--app-primary) 8%, transparent);\n}\n.assistant-composer__picker-item-icon[data-v-a5a64d4a] {\n  display: grid;\n  place-items: center;\n  width: 30px;\n  height: 30px;\n  flex-shrink: 0;\n  border-radius: var(--app-radius-sm);\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter));\n  color: var(--app-text-secondary);\n}\n.assistant-composer__picker-item-main[data-v-a5a64d4a] {\n  display: flex;\n  flex-direction: column;\n  flex: 1;\n  min-width: 0;\n  line-height: 1.25;\n}\n.assistant-composer__picker-item-eyebrow[data-v-a5a64d4a],\n.assistant-composer__picker-item-desc[data-v-a5a64d4a] {\n  font-size: 10px;\n  color: var(--app-text-secondary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-composer__picker-item-label[data-v-a5a64d4a] {\n  margin-top: 1px;\n  font-size: 12px;\n  font-weight: 600;\n  color: var(--app-text);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-composer__picker-item-check[data-v-a5a64d4a] {\n  flex-shrink: 0;\n  font-size: 16px;\n  color: var(--app-primary);\n}\n.assistant-composer__controls[data-v-a5a64d4a] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  margin-top: 8px;\n}\n.assistant-composer__model[data-v-a5a64d4a] {\n  min-width: 150px;\n  max-width: 220px;\n}\n.assistant-composer__effort[data-v-a5a64d4a] {\n  width: 110px;\n}\n.assistant-composer__tool-mode[data-v-a5a64d4a] {\n  width: 150px;\n}\n.assistant-composer__spacer[data-v-a5a64d4a] {\n  flex: 1;\n}\n.assistant-composer__file-input[data-v-a5a64d4a] {\n  display: none;\n}\n.is-spinning[data-v-a5a64d4a] {\n  display: inline-block;\n  animation: assistant-composer-spin-a5a64d4a 1s linear infinite;\n}\n@keyframes assistant-composer-spin-a5a64d4a {\nfrom {\n    transform: rotate(0deg);\n}\nto {\n    transform: rotate(360deg);\n}\n}";
const AssistantComposer = /* @__PURE__ */ _export_sfc(_sfc_main$3, [["styles", [_style_0$3]], ["__scopeId", "data-v-a5a64d4a"]]);
const _hoisted_1$2 = {
  class: "assistant-window",
  "data-testid": "assistant-window"
};
const _hoisted_2$1 = { class: "assistant-window__head" };
const _hoisted_3$1 = { class: "assistant-window__brand" };
const _hoisted_4$1 = { class: "assistant-window__titles" };
const _hoisted_5$1 = { key: 0 };
const _hoisted_6$1 = {
  key: 1,
  class: /* @__PURE__ */ normalizeClass(`is-status`)
};
const _hoisted_7$1 = { class: "assistant-window__body" };
const _hoisted_8$1 = { class: "assistant-window__main" };
const _hoisted_9$1 = {
  key: 1,
  class: "assistant-window__empty",
  "data-testid": "assistant-welcome"
};
const _hoisted_10$1 = { class: "assistant-window__starters" };
const _hoisted_11$1 = ["onClick"];
const _sfc_main$2 = /* @__PURE__ */ defineComponent({
  ...{ name: "AssistantChatWindow" },
  __name: "AssistantChatWindow",
  props: {
    projectId: { type: [Number, null] }
  },
  setup(__props) {
    const props = __props;
    const { t } = useI18n();
    const store = useAssistantStore();
    onMounted(() => {
      try {
        store.initializeForUser(getSdkConfig().appKey);
      } catch {
      }
      store.setOpen(true);
    });
    onUnmounted(() => {
      store.setOpen(false);
    });
    const selectedRuntime = computed(() => store.selectedConversationId ? store.conversationStates[store.selectedConversationId] : void 0);
    const STARTER_PROMPTS = [
      "怎么把创意整理成视频脚本？",
      "能帮我设计一组连贯分镜吗？",
      "如何统一画面提示词的风格？",
      "有哪些适合短视频的创意方向？"
    ];
    function selectPrompt(prompt) {
      store.setDraft(null, prompt);
    }
    return (_ctx, _cache) => {
      const _component_IaButton = resolveComponent("IaButton");
      return openBlock(), createElementBlock("div", _hoisted_1$2, [
        createBaseVNode("header", _hoisted_2$1, [
          createVNode(_component_IaButton, {
            class: "assistant-window__menu",
            variant: "text",
            size: "sm",
            circle: "",
            title: unref(t)("assistant.conversations"),
            "aria-label": unref(t)("assistant.conversations"),
            "data-testid": "assistant-drawer-open",
            onClick: _cache[0] || (_cache[0] = ($event) => unref(store).setDrawerOpen(true))
          }, {
            default: withCtx(() => [..._cache[1] || (_cache[1] = [
              createBaseVNode("i", { class: "ri-menu-line" }, null, -1)
            ])]),
            _: 1
          }, 8, ["title", "aria-label"]),
          createBaseVNode("div", _hoisted_3$1, [
            _cache[2] || (_cache[2] = createBaseVNode("span", { class: "assistant-window__logo" }, [
              createBaseVNode("i", { class: "ri-sparkling-2-line" })
            ], -1)),
            createBaseVNode("div", _hoisted_4$1, [
              createBaseVNode("h3", null, toDisplayString(unref(t)("assistant.title")), 1),
              !selectedRuntime.value ? (openBlock(), createElementBlock("p", _hoisted_5$1, toDisplayString(unref(t)("assistant.subtitle")), 1)) : (openBlock(), createElementBlock("p", _hoisted_6$1, toDisplayString(selectedRuntime.value.conversation.title) + " · " + toDisplayString(unref(t)(unref(conversationStatusKey)(selectedRuntime.value.status))), 1))
            ])
          ])
        ]),
        createBaseVNode("div", _hoisted_7$1, [
          createVNode(AssistantConversationNav),
          createBaseVNode("section", _hoisted_8$1, [
            unref(store).selectedConversationId ? (openBlock(), createBlock(AssistantMessageList, {
              key: unref(store).selectedConversationId,
              "conversation-id": unref(store).selectedConversationId
            }, null, 8, ["conversation-id"])) : (openBlock(), createElementBlock("div", _hoisted_9$1, [
              _cache[4] || (_cache[4] = createBaseVNode("span", { class: "assistant-window__empty-logo" }, [
                createBaseVNode("i", { class: "ri-sparkling-2-line" })
              ], -1)),
              createBaseVNode("h2", null, toDisplayString(unref(t)("assistant.empty-title")), 1),
              createBaseVNode("p", null, toDisplayString(unref(t)("assistant.empty-desc")), 1),
              createBaseVNode("div", _hoisted_10$1, [
                (openBlock(), createElementBlock(Fragment, null, renderList(STARTER_PROMPTS, (prompt) => {
                  return createBaseVNode("button", {
                    key: prompt,
                    type: "button",
                    class: "assistant-window__starter fc-button-ghost",
                    onClick: ($event) => selectPrompt(prompt)
                  }, [
                    _cache[3] || (_cache[3] = createBaseVNode("i", { class: "ri-lightbulb-line" }, null, -1)),
                    createBaseVNode("span", null, toDisplayString(prompt), 1)
                  ], 8, _hoisted_11$1);
                }), 64))
              ])
            ])),
            createVNode(AssistantComposer, {
              "project-id": props.projectId
            }, null, 8, ["project-id"])
          ])
        ])
      ]);
    };
  }
});
const _style_0$2 = ".assistant-window[data-v-daa036b7] {\n  display: flex;\n  flex-direction: column;\n  height: 100%;\n  min-height: 0;\n  overflow: hidden;\n}\n.assistant-window__menu[data-v-daa036b7] {\n  display: none;\n}\n@media (max-width: 768px) {\n.assistant-window__menu[data-v-daa036b7] {\n    display: inline-flex;\n}\n}\n.assistant-window__head[data-v-daa036b7] {\n  flex-shrink: 0;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 12px 16px;\n  border-bottom: 1px solid var(--app-separator, var(--el-border-color-lighter));\n}\n.assistant-window__brand[data-v-daa036b7] {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  min-width: 0;\n}\n.assistant-window__logo[data-v-daa036b7],\n.assistant-window__empty-logo[data-v-daa036b7] {\n  display: inline-flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 12px;\n  background: var(--el-color-primary-light-9, #ecf5ff);\n  color: var(--el-color-primary, #409eff);\n}\n.assistant-window__logo[data-v-daa036b7] {\n  width: 32px;\n  height: 32px;\n  font-size: 17px;\n}\n.assistant-window__titles[data-v-daa036b7] {\n  min-width: 0;\n}\n.assistant-window__titles h3[data-v-daa036b7] {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--app-text);\n}\n.assistant-window__titles p[data-v-daa036b7] {\n  margin: 2px 0 0;\n  font-size: 11px;\n  color: var(--app-text-secondary);\n  overflow: hidden;\n  text-overflow: ellipsis;\n  white-space: nowrap;\n}\n.assistant-window__body[data-v-daa036b7] {\n  flex: 1;\n  min-height: 0;\n  display: flex;\n}\n.assistant-window__main[data-v-daa036b7] {\n  flex: 1;\n  min-width: 0;\n  min-height: 0;\n  display: flex;\n  flex-direction: column;\n  position: relative;\n}\n.assistant-window__loading[data-v-daa036b7] {\n  flex: 1;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  gap: 8px;\n  font-size: 12px;\n  color: var(--app-text-secondary);\n}\n.assistant-window__empty[data-v-daa036b7] {\n  flex: 1;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 10px;\n  padding: 24px;\n  text-align: center;\n  overflow-y: auto;\n}\n.assistant-window__empty h2[data-v-daa036b7] {\n  margin: 0;\n  font-size: 20px;\n  font-weight: 600;\n  color: var(--app-text);\n}\n.assistant-window__empty p[data-v-daa036b7] {\n  margin: 0;\n  font-size: 12px;\n  color: var(--app-text-secondary);\n  max-width: 360px;\n}\n.assistant-window__empty-logo[data-v-daa036b7] {\n  width: 56px;\n  height: 56px;\n  font-size: 28px;\n}\n.assistant-window__starters[data-v-daa036b7] {\n  display: grid;\n  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));\n  gap: 10px;\n  width: 100%;\n  max-width: 560px;\n  margin-top: 14px;\n}\n.assistant-window__starter[data-v-daa036b7] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  padding: 12px;\n  border-radius: 10px;\n  border: 1px solid var(--app-separator, var(--el-border-color-lighter));\n  background: var(--app-bg, transparent);\n  cursor: pointer;\n  text-align: left;\n  font-size: 12px;\n  color: var(--app-text);\n  transition: border-color 0.15s, background 0.15s;\n}\n.assistant-window__starter > i[data-v-daa036b7] {\n  color: var(--el-color-primary, #409eff);\n  font-size: 15px;\n}\n.assistant-window__starter[data-v-daa036b7]:hover {\n  border-color: var(--el-color-primary-light-5, #a0cfff);\n  background: var(--app-sidebar-item-hover-bg);\n}\n.is-spinning[data-v-daa036b7] {\n  animation: assistant-window-spin-daa036b7 1s linear infinite;\n}\n@keyframes assistant-window-spin-daa036b7 {\nfrom {\n    transform: rotate(0deg);\n}\nto {\n    transform: rotate(360deg);\n}\n}";
const AssistantChatWindow = /* @__PURE__ */ _export_sfc(_sfc_main$2, [["styles", [_style_0$2]], ["__scopeId", "data-v-daa036b7"]]);
const _hoisted_1$1 = {
  class: "ia-config",
  "data-testid": "ia-config-panel"
};
const _hoisted_2 = { class: "ia-config__header" };
const _hoisted_3 = { class: "ia-config__title" };
const _hoisted_4 = {
  key: 0,
  class: "ia-config__error",
  "data-testid": "ia-config-error"
};
const _hoisted_5 = { class: "ia-config__section" };
const _hoisted_6 = { class: "ia-config__section-title" };
const _hoisted_7 = { class: "ia-config__section-desc" };
const _hoisted_8 = {
  key: 0,
  class: "ia-config__empty",
  "data-testid": "ia-config-skills-empty"
};
const _hoisted_9 = {
  key: 1,
  class: "ia-config__list"
};
const _hoisted_10 = { class: "ia-config__item-main" };
const _hoisted_11 = { class: "ia-config__item-name" };
const _hoisted_12 = {
  key: 0,
  class: "ia-config__item-desc"
};
const _hoisted_13 = { class: "ia-config__section" };
const _hoisted_14 = { class: "ia-config__section-title" };
const _hoisted_15 = { class: "ia-config__section-desc" };
const _hoisted_16 = {
  key: 0,
  class: "ia-config__empty",
  "data-testid": "ia-config-mcp-empty"
};
const _hoisted_17 = {
  key: 1,
  class: "ia-config__list"
};
const _hoisted_18 = { class: "ia-config__item-main" };
const _hoisted_19 = { class: "ia-config__item-name" };
const _hoisted_20 = { class: "ia-config__item-desc" };
const _hoisted_21 = { class: "ia-config__item-meta" };
const _hoisted_22 = {
  key: 0,
  class: "ia-config__row-error",
  "data-testid": "ia-config-mcp-error"
};
const _hoisted_23 = { class: "ia-config__item-actions" };
const _sfc_main$1 = /* @__PURE__ */ defineComponent({
  ...{ name: "AgentConfigPanel" },
  __name: "AgentConfigPanel",
  setup(__props) {
    const { t } = useI18n();
    const loading = /* @__PURE__ */ ref(false);
    const loadError = /* @__PURE__ */ ref("");
    const referenceOptions = /* @__PURE__ */ ref(null);
    const servers = /* @__PURE__ */ ref([]);
    const busyIds = /* @__PURE__ */ ref(/* @__PURE__ */ new Set());
    const rowErrors = /* @__PURE__ */ ref(/* @__PURE__ */ new Map());
    const skills = computed(() => referenceOptions.value?.skills ?? []);
    onMounted(() => {
      void load();
    });
    async function load() {
      loading.value = true;
      loadError.value = "";
      const [optionsResult, serversResult] = await Promise.allSettled([
        meApi.referenceOptions(),
        mcpUserServersApi.list()
      ]);
      if (optionsResult.status === "fulfilled") referenceOptions.value = optionsResult.value;
      if (serversResult.status === "fulfilled") servers.value = serversResult.value;
      if (optionsResult.status === "rejected" || serversResult.status === "rejected") {
        loadError.value = t("config.load-failed");
      }
      loading.value = false;
    }
    function retry() {
      void load();
    }
    async function toggleServer(server) {
      if (busyIds.value.has(server.id)) return;
      rowErrors.value.delete(server.id);
      busyIds.value = new Set(busyIds.value).add(server.id);
      try {
        const updated = server.enabled ? await mcpUserServersApi.disable(server.id) : await mcpUserServersApi.enable(server.id);
        servers.value = servers.value.map((row) => row.id === updated.id ? updated : row);
      } catch {
        rowErrors.value = new Map(rowErrors.value).set(server.id, t("config.update-failed"));
      } finally {
        const next = new Set(busyIds.value);
        next.delete(server.id);
        busyIds.value = next;
      }
    }
    function authLabel(server) {
      return server.authType === "OAUTH" ? t("config.auth-oauth") : t("config.auth-static-header");
    }
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", _hoisted_1$1, [
        createBaseVNode("header", _hoisted_2, [
          createBaseVNode("h2", _hoisted_3, toDisplayString(unref(t)("config.title")), 1),
          createVNode(IaButton, {
            variant: "text",
            size: "sm",
            loading: loading.value,
            "data-testid": "ia-config-refresh",
            onClick: retry
          }, {
            default: withCtx(() => [
              createTextVNode(toDisplayString(unref(t)("config.action-refresh")), 1)
            ]),
            _: 1
          }, 8, ["loading"])
        ]),
        loadError.value ? (openBlock(), createElementBlock("div", _hoisted_4, [
          createBaseVNode("span", null, toDisplayString(loadError.value), 1),
          createVNode(IaButton, {
            variant: "secondary",
            size: "sm",
            "data-testid": "ia-config-retry",
            onClick: retry
          }, {
            default: withCtx(() => [
              createTextVNode(toDisplayString(unref(t)("config.action-refresh")), 1)
            ]),
            _: 1
          })
        ])) : createCommentVNode("", true),
        createBaseVNode("section", _hoisted_5, [
          createBaseVNode("h3", _hoisted_6, toDisplayString(unref(t)("config.skills")), 1),
          createBaseVNode("p", _hoisted_7, toDisplayString(unref(t)("config.skills-desc")), 1),
          !loading.value && skills.value.length === 0 ? (openBlock(), createElementBlock("p", _hoisted_8, toDisplayString(unref(t)("config.skills-empty")), 1)) : (openBlock(), createElementBlock("ul", _hoisted_9, [
            (openBlock(true), createElementBlock(Fragment, null, renderList(skills.value, (skill) => {
              return openBlock(), createElementBlock("li", {
                key: skill.id,
                class: "ia-config__item",
                "data-testid": "ia-config-skill-item"
              }, [
                createBaseVNode("div", _hoisted_10, [
                  createBaseVNode("span", _hoisted_11, toDisplayString(skill.displayName || skill.name), 1),
                  skill.source ? (openBlock(), createBlock(IaTag, {
                    key: 0,
                    size: "sm"
                  }, {
                    default: withCtx(() => [
                      createTextVNode(toDisplayString(skill.source), 1)
                    ]),
                    _: 2
                  }, 1024)) : createCommentVNode("", true)
                ]),
                skill.description ? (openBlock(), createElementBlock("p", _hoisted_12, toDisplayString(skill.description), 1)) : createCommentVNode("", true)
              ]);
            }), 128))
          ]))
        ]),
        createBaseVNode("section", _hoisted_13, [
          createBaseVNode("h3", _hoisted_14, toDisplayString(unref(t)("config.mcp")), 1),
          createBaseVNode("p", _hoisted_15, toDisplayString(unref(t)("config.mcp-desc")), 1),
          !loading.value && servers.value.length === 0 ? (openBlock(), createElementBlock("p", _hoisted_16, toDisplayString(unref(t)("config.mcp-empty")), 1)) : (openBlock(), createElementBlock("ul", _hoisted_17, [
            (openBlock(true), createElementBlock(Fragment, null, renderList(servers.value, (server) => {
              return openBlock(), createElementBlock("li", {
                key: server.id,
                class: "ia-config__item",
                "data-testid": "ia-config-mcp-item"
              }, [
                createBaseVNode("div", _hoisted_18, [
                  createBaseVNode("span", _hoisted_19, toDisplayString(server.name), 1),
                  createVNode(IaTag, { size: "sm" }, {
                    default: withCtx(() => [
                      createTextVNode(toDisplayString(server.serverKey), 1)
                    ]),
                    _: 2
                  }, 1024),
                  createVNode(IaTag, {
                    size: "sm",
                    color: server.enabled ? "success" : "gray"
                  }, {
                    default: withCtx(() => [
                      createTextVNode(toDisplayString(server.enabled ? unref(t)("config.mcp-enabled") : unref(t)("config.mcp-disabled")), 1)
                    ]),
                    _: 2
                  }, 1032, ["color"])
                ]),
                createBaseVNode("p", _hoisted_20, toDisplayString(server.endpointUrl), 1),
                createBaseVNode("p", _hoisted_21, [
                  createTextVNode(toDisplayString(authLabel(server)) + " ", 1),
                  server.credentialsMasked ? (openBlock(), createElementBlock(Fragment, { key: 0 }, [
                    createTextVNode(" · " + toDisplayString(server.credentialsMasked), 1)
                  ], 64)) : createCommentVNode("", true)
                ]),
                rowErrors.value.get(server.id) ? (openBlock(), createElementBlock("p", _hoisted_22, toDisplayString(rowErrors.value.get(server.id)), 1)) : createCommentVNode("", true),
                createBaseVNode("div", _hoisted_23, [
                  createVNode(IaButton, {
                    variant: server.enabled ? "secondary" : "primary",
                    size: "sm",
                    loading: busyIds.value.has(server.id),
                    "data-testid": `ia-config-mcp-toggle-${server.id}`,
                    onClick: ($event) => toggleServer(server)
                  }, {
                    default: withCtx(() => [
                      createTextVNode(toDisplayString(server.enabled ? unref(t)("config.action-disable") : unref(t)("config.action-enable")), 1)
                    ]),
                    _: 2
                  }, 1032, ["variant", "loading", "data-testid", "onClick"])
                ])
              ]);
            }), 128))
          ]))
        ])
      ]);
    };
  }
});
const _style_0$1 = "\n.ia-config[data-v-130f160c] {\n  height: 100%;\n  overflow-y: auto;\n  padding: 16px 18px 32px;\n  display: flex;\n  flex-direction: column;\n  gap: 18px;\n}\n.ia-config__header[data-v-130f160c] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n}\n.ia-config__title[data-v-130f160c] {\n  margin: 0;\n  font-size: 16px;\n  font-weight: 600;\n  color: var(--app-text);\n}\n.ia-config__error[data-v-130f160c] {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 8px;\n  padding: 8px 12px;\n  border: 1px solid var(--app-color-danger);\n  border-radius: 8px;\n  color: var(--app-color-danger);\n  font-size: 13px;\n  background: var(--app-bg-card);\n}\n.ia-config__section[data-v-130f160c] {\n  display: flex;\n  flex-direction: column;\n  gap: 6px;\n}\n.ia-config__section-title[data-v-130f160c] {\n  margin: 0;\n  font-size: 14px;\n  font-weight: 600;\n  color: var(--app-text);\n}\n.ia-config__section-desc[data-v-130f160c] {\n  margin: 0;\n  font-size: 12px;\n  color: var(--app-text-tertiary);\n}\n.ia-config__empty[data-v-130f160c] {\n  margin: 4px 0;\n  font-size: 13px;\n  color: var(--app-text-secondary);\n}\n.ia-config__list[data-v-130f160c] {\n  list-style: none;\n  margin: 0;\n  padding: 0;\n  display: flex;\n  flex-direction: column;\n  gap: 8px;\n}\n.ia-config__item[data-v-130f160c] {\n  border: 1px solid var(--app-separator);\n  border-radius: 10px;\n  background: var(--app-bg-card);\n  padding: 10px 12px;\n  display: flex;\n  flex-direction: column;\n  gap: 4px;\n}\n.ia-config__item-main[data-v-130f160c] {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n  flex-wrap: wrap;\n}\n.ia-config__item-name[data-v-130f160c] {\n  font-size: 13px;\n  font-weight: 600;\n  color: var(--app-text);\n}\n.ia-config__item-desc[data-v-130f160c] {\n  margin: 0;\n  font-size: 12px;\n  color: var(--app-text-secondary);\n  word-break: break-all;\n}\n.ia-config__item-meta[data-v-130f160c] {\n  margin: 0;\n  font-size: 11px;\n  color: var(--app-text-tertiary);\n}\n.ia-config__row-error[data-v-130f160c] {\n  margin: 0;\n  font-size: 12px;\n  color: var(--app-color-danger);\n}\n.ia-config__item-actions[data-v-130f160c] {\n  display: flex;\n  justify-content: flex-end;\n  margin-top: 2px;\n}\n";
const AgentConfigPanel = /* @__PURE__ */ _export_sfc(_sfc_main$1, [["styles", [_style_0$1]], ["__scopeId", "data-v-130f160c"]]);
const _hoisted_1 = {
  key: 0,
  class: "ia-chat-root__placeholder",
  "data-testid": "ia-view-placeholder"
};
const _sfc_main = /* @__PURE__ */ defineComponent({
  ...{ name: "InnerAgentChat" },
  __name: "InnerAgentChat.ce",
  props: {
    view: { default: "chat", type: String },
    projectId: { default: null, type: [Number, String, null] }
  },
  setup(__props) {
    const props = __props;
    const { t } = useI18n();
    const store = useAssistantStore();
    const rootRef = /* @__PURE__ */ ref(null);
    const projectIdNumber = computed(() => {
      const parsed = Number(props.projectId);
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
    });
    const isPlaceholderView = computed(() => props.view === "history");
    const pendingConfirmation = computed(() => {
      const conversationId = store.selectedConversationId;
      const runtime2 = conversationId ? store.conversationStates[conversationId] : void 0;
      return runtime2?.pipeline.pendingConfirmation ?? null;
    });
    let lastDispatchedConfirmationKey = "";
    watch(pendingConfirmation, (pending) => {
      if (!pending) return;
      const conversationId = store.selectedConversationId;
      const root = rootRef.value;
      if (!conversationId || !root) return;
      const confirmationKey = `${pending.runId}:${pending.replyId}`;
      if (confirmationKey === lastDispatchedConfirmationKey) return;
      lastDispatchedConfirmationKey = confirmationKey;
      root.dispatchEvent(new CustomEvent("SCOPE_RESOLVED", {
        bubbles: true,
        composed: true,
        detail: {
          conversationId,
          runId: pending.runId,
          replyId: pending.replyId,
          tools: (pending.toolCalls ?? []).map((toolCall) => ({
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            scope: normalizeToolCallScope(toolCall.scope)
          }))
        }
      }));
    });
    return (_ctx, _cache) => {
      return openBlock(), createElementBlock("div", {
        ref_key: "rootRef",
        ref: rootRef,
        class: "ia-chat-root"
      }, [
        isPlaceholderView.value ? (openBlock(), createElementBlock("div", _hoisted_1, [
          createBaseVNode("p", null, toDisplayString(unref(t)("assistant.title")) + ' · view="' + toDisplayString(__props.view) + '"', 1),
          _cache[0] || (_cache[0] = createBaseVNode("p", { class: "ia-chat-root__placeholder-desc" }, ' history 视图为占位; 当前实现: view="chat" / view="config"。 ', -1))
        ])) : __props.view === "config" ? (openBlock(), createBlock(AgentConfigPanel, { key: 1 })) : (openBlock(), createBlock(AssistantChatWindow, {
          key: 2,
          "project-id": projectIdNumber.value
        }, null, 8, ["project-id"]))
      ], 512);
    };
  }
});
const _style_0 = '/* [new] remixicon woff2-only 子集 — 由 remixicon@4.9.1 fonts/remixicon.css 机械生成:\n * - @font-face 仅保留 woff2 (data URI 内联, 其余 eot/ttf/svg/woff 剔除, 体积 ~6.5MB → ~0.4MB)\n * - 字形类定义逐行保留\n * 生成源: Apache License 2.0, (c) RemixIcon\n */\n@font-face {\n  font-family: "remixicon";\n  font-style: normal;\n  font-weight: 400;\n  font-display: block;\n  src: url("data:font/woff2;base64,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") format("woff2");\n}\n.ri-24-hours-fill:before { content: "\\ea01";\n}\n.ri-24-hours-line:before { content: "\\ea02";\n}\n.ri-4k-fill:before { content: "\\ea03";\n}\n.ri-4k-line:before { content: "\\ea04";\n}\n.ri-a-b:before { content: "\\ea05";\n}\n.ri-account-box-fill:before { content: "\\ea06";\n}\n.ri-account-box-line:before { content: "\\ea07";\n}\n.ri-account-circle-fill:before { content: "\\ea08";\n}\n.ri-account-circle-line:before { content: "\\ea09";\n}\n.ri-account-pin-box-fill:before { content: "\\ea0a";\n}\n.ri-account-pin-box-line:before { content: "\\ea0b";\n}\n.ri-account-pin-circle-fill:before { content: "\\ea0c";\n}\n.ri-account-pin-circle-line:before { content: "\\ea0d";\n}\n.ri-add-box-fill:before { content: "\\ea0e";\n}\n.ri-add-box-line:before { content: "\\ea0f";\n}\n.ri-add-circle-fill:before { content: "\\ea10";\n}\n.ri-add-circle-line:before { content: "\\ea11";\n}\n.ri-add-fill:before { content: "\\ea12";\n}\n.ri-add-line:before { content: "\\ea13";\n}\n.ri-admin-fill:before { content: "\\ea14";\n}\n.ri-admin-line:before { content: "\\ea15";\n}\n.ri-advertisement-fill:before { content: "\\ea16";\n}\n.ri-advertisement-line:before { content: "\\ea17";\n}\n.ri-airplay-fill:before { content: "\\ea18";\n}\n.ri-airplay-line:before { content: "\\ea19";\n}\n.ri-alarm-fill:before { content: "\\ea1a";\n}\n.ri-alarm-line:before { content: "\\ea1b";\n}\n.ri-alarm-warning-fill:before { content: "\\ea1c";\n}\n.ri-alarm-warning-line:before { content: "\\ea1d";\n}\n.ri-album-fill:before { content: "\\ea1e";\n}\n.ri-album-line:before { content: "\\ea1f";\n}\n.ri-alert-fill:before { content: "\\ea20";\n}\n.ri-alert-line:before { content: "\\ea21";\n}\n.ri-aliens-fill:before { content: "\\ea22";\n}\n.ri-aliens-line:before { content: "\\ea23";\n}\n.ri-align-bottom:before { content: "\\ea24";\n}\n.ri-align-center:before { content: "\\ea25";\n}\n.ri-align-justify:before { content: "\\ea26";\n}\n.ri-align-left:before { content: "\\ea27";\n}\n.ri-align-right:before { content: "\\ea28";\n}\n.ri-align-top:before { content: "\\ea29";\n}\n.ri-align-vertically:before { content: "\\ea2a";\n}\n.ri-alipay-fill:before { content: "\\ea2b";\n}\n.ri-alipay-line:before { content: "\\ea2c";\n}\n.ri-amazon-fill:before { content: "\\ea2d";\n}\n.ri-amazon-line:before { content: "\\ea2e";\n}\n.ri-anchor-fill:before { content: "\\ea2f";\n}\n.ri-anchor-line:before { content: "\\ea30";\n}\n.ri-ancient-gate-fill:before { content: "\\ea31";\n}\n.ri-ancient-gate-line:before { content: "\\ea32";\n}\n.ri-ancient-pavilion-fill:before { content: "\\ea33";\n}\n.ri-ancient-pavilion-line:before { content: "\\ea34";\n}\n.ri-android-fill:before { content: "\\ea35";\n}\n.ri-android-line:before { content: "\\ea36";\n}\n.ri-angularjs-fill:before { content: "\\ea37";\n}\n.ri-angularjs-line:before { content: "\\ea38";\n}\n.ri-anticlockwise-2-fill:before { content: "\\ea39";\n}\n.ri-anticlockwise-2-line:before { content: "\\ea3a";\n}\n.ri-anticlockwise-fill:before { content: "\\ea3b";\n}\n.ri-anticlockwise-line:before { content: "\\ea3c";\n}\n.ri-app-store-fill:before { content: "\\ea3d";\n}\n.ri-app-store-line:before { content: "\\ea3e";\n}\n.ri-apple-fill:before { content: "\\ea3f";\n}\n.ri-apple-line:before { content: "\\ea40";\n}\n.ri-apps-2-fill:before { content: "\\ea41";\n}\n.ri-apps-2-line:before { content: "\\ea42";\n}\n.ri-apps-fill:before { content: "\\ea43";\n}\n.ri-apps-line:before { content: "\\ea44";\n}\n.ri-archive-drawer-fill:before { content: "\\ea45";\n}\n.ri-archive-drawer-line:before { content: "\\ea46";\n}\n.ri-archive-fill:before { content: "\\ea47";\n}\n.ri-archive-line:before { content: "\\ea48";\n}\n.ri-arrow-down-circle-fill:before { content: "\\ea49";\n}\n.ri-arrow-down-circle-line:before { content: "\\ea4a";\n}\n.ri-arrow-down-fill:before { content: "\\ea4b";\n}\n.ri-arrow-down-line:before { content: "\\ea4c";\n}\n.ri-arrow-down-s-fill:before { content: "\\ea4d";\n}\n.ri-arrow-down-s-line:before { content: "\\ea4e";\n}\n.ri-arrow-drop-down-fill:before { content: "\\ea4f";\n}\n.ri-arrow-drop-down-line:before { content: "\\ea50";\n}\n.ri-arrow-drop-left-fill:before { content: "\\ea51";\n}\n.ri-arrow-drop-left-line:before { content: "\\ea52";\n}\n.ri-arrow-drop-right-fill:before { content: "\\ea53";\n}\n.ri-arrow-drop-right-line:before { content: "\\ea54";\n}\n.ri-arrow-drop-up-fill:before { content: "\\ea55";\n}\n.ri-arrow-drop-up-line:before { content: "\\ea56";\n}\n.ri-arrow-go-back-fill:before { content: "\\ea57";\n}\n.ri-arrow-go-back-line:before { content: "\\ea58";\n}\n.ri-arrow-go-forward-fill:before { content: "\\ea59";\n}\n.ri-arrow-go-forward-line:before { content: "\\ea5a";\n}\n.ri-arrow-left-circle-fill:before { content: "\\ea5b";\n}\n.ri-arrow-left-circle-line:before { content: "\\ea5c";\n}\n.ri-arrow-left-down-fill:before { content: "\\ea5d";\n}\n.ri-arrow-left-down-line:before { content: "\\ea5e";\n}\n.ri-arrow-left-fill:before { content: "\\ea5f";\n}\n.ri-arrow-left-line:before { content: "\\ea60";\n}\n.ri-arrow-left-right-fill:before { content: "\\ea61";\n}\n.ri-arrow-left-right-line:before { content: "\\ea62";\n}\n.ri-arrow-left-s-fill:before { content: "\\ea63";\n}\n.ri-arrow-left-s-line:before { content: "\\ea64";\n}\n.ri-arrow-left-up-fill:before { content: "\\ea65";\n}\n.ri-arrow-left-up-line:before { content: "\\ea66";\n}\n.ri-arrow-right-circle-fill:before { content: "\\ea67";\n}\n.ri-arrow-right-circle-line:before { content: "\\ea68";\n}\n.ri-arrow-right-down-fill:before { content: "\\ea69";\n}\n.ri-arrow-right-down-line:before { content: "\\ea6a";\n}\n.ri-arrow-right-fill:before { content: "\\ea6b";\n}\n.ri-arrow-right-line:before { content: "\\ea6c";\n}\n.ri-arrow-right-s-fill:before { content: "\\ea6d";\n}\n.ri-arrow-right-s-line:before { content: "\\ea6e";\n}\n.ri-arrow-right-up-fill:before { content: "\\ea6f";\n}\n.ri-arrow-right-up-line:before { content: "\\ea70";\n}\n.ri-arrow-up-circle-fill:before { content: "\\ea71";\n}\n.ri-arrow-up-circle-line:before { content: "\\ea72";\n}\n.ri-arrow-up-down-fill:before { content: "\\ea73";\n}\n.ri-arrow-up-down-line:before { content: "\\ea74";\n}\n.ri-arrow-up-fill:before { content: "\\ea75";\n}\n.ri-arrow-up-line:before { content: "\\ea76";\n}\n.ri-arrow-up-s-fill:before { content: "\\ea77";\n}\n.ri-arrow-up-s-line:before { content: "\\ea78";\n}\n.ri-artboard-2-fill:before { content: "\\ea79";\n}\n.ri-artboard-2-line:before { content: "\\ea7a";\n}\n.ri-artboard-fill:before { content: "\\ea7b";\n}\n.ri-artboard-line:before { content: "\\ea7c";\n}\n.ri-article-fill:before { content: "\\ea7d";\n}\n.ri-article-line:before { content: "\\ea7e";\n}\n.ri-aspect-ratio-fill:before { content: "\\ea7f";\n}\n.ri-aspect-ratio-line:before { content: "\\ea80";\n}\n.ri-asterisk:before { content: "\\ea81";\n}\n.ri-at-fill:before { content: "\\ea82";\n}\n.ri-at-line:before { content: "\\ea83";\n}\n.ri-attachment-2:before { content: "\\ea84";\n}\n.ri-attachment-fill:before { content: "\\ea85";\n}\n.ri-attachment-line:before { content: "\\ea86";\n}\n.ri-auction-fill:before { content: "\\ea87";\n}\n.ri-auction-line:before { content: "\\ea88";\n}\n.ri-award-fill:before { content: "\\ea89";\n}\n.ri-award-line:before { content: "\\ea8a";\n}\n.ri-baidu-fill:before { content: "\\ea8b";\n}\n.ri-baidu-line:before { content: "\\ea8c";\n}\n.ri-ball-pen-fill:before { content: "\\ea8d";\n}\n.ri-ball-pen-line:before { content: "\\ea8e";\n}\n.ri-bank-card-2-fill:before { content: "\\ea8f";\n}\n.ri-bank-card-2-line:before { content: "\\ea90";\n}\n.ri-bank-card-fill:before { content: "\\ea91";\n}\n.ri-bank-card-line:before { content: "\\ea92";\n}\n.ri-bank-fill:before { content: "\\ea93";\n}\n.ri-bank-line:before { content: "\\ea94";\n}\n.ri-bar-chart-2-fill:before { content: "\\ea95";\n}\n.ri-bar-chart-2-line:before { content: "\\ea96";\n}\n.ri-bar-chart-box-fill:before { content: "\\ea97";\n}\n.ri-bar-chart-box-line:before { content: "\\ea98";\n}\n.ri-bar-chart-fill:before { content: "\\ea99";\n}\n.ri-bar-chart-grouped-fill:before { content: "\\ea9a";\n}\n.ri-bar-chart-grouped-line:before { content: "\\ea9b";\n}\n.ri-bar-chart-horizontal-fill:before { content: "\\ea9c";\n}\n.ri-bar-chart-horizontal-line:before { content: "\\ea9d";\n}\n.ri-bar-chart-line:before { content: "\\ea9e";\n}\n.ri-barcode-box-fill:before { content: "\\ea9f";\n}\n.ri-barcode-box-line:before { content: "\\eaa0";\n}\n.ri-barcode-fill:before { content: "\\eaa1";\n}\n.ri-barcode-line:before { content: "\\eaa2";\n}\n.ri-barricade-fill:before { content: "\\eaa3";\n}\n.ri-barricade-line:before { content: "\\eaa4";\n}\n.ri-base-station-fill:before { content: "\\eaa5";\n}\n.ri-base-station-line:before { content: "\\eaa6";\n}\n.ri-basketball-fill:before { content: "\\eaa7";\n}\n.ri-basketball-line:before { content: "\\eaa8";\n}\n.ri-battery-2-charge-fill:before { content: "\\eaa9";\n}\n.ri-battery-2-charge-line:before { content: "\\eaaa";\n}\n.ri-battery-2-fill:before { content: "\\eaab";\n}\n.ri-battery-2-line:before { content: "\\eaac";\n}\n.ri-battery-charge-fill:before { content: "\\eaad";\n}\n.ri-battery-charge-line:before { content: "\\eaae";\n}\n.ri-battery-fill:before { content: "\\eaaf";\n}\n.ri-battery-line:before { content: "\\eab0";\n}\n.ri-battery-low-fill:before { content: "\\eab1";\n}\n.ri-battery-low-line:before { content: "\\eab2";\n}\n.ri-battery-saver-fill:before { content: "\\eab3";\n}\n.ri-battery-saver-line:before { content: "\\eab4";\n}\n.ri-battery-share-fill:before { content: "\\eab5";\n}\n.ri-battery-share-line:before { content: "\\eab6";\n}\n.ri-bear-smile-fill:before { content: "\\eab7";\n}\n.ri-bear-smile-line:before { content: "\\eab8";\n}\n.ri-behance-fill:before { content: "\\eab9";\n}\n.ri-behance-line:before { content: "\\eaba";\n}\n.ri-bell-fill:before { content: "\\eabb";\n}\n.ri-bell-line:before { content: "\\eabc";\n}\n.ri-bike-fill:before { content: "\\eabd";\n}\n.ri-bike-line:before { content: "\\eabe";\n}\n.ri-bilibili-fill:before { content: "\\eabf";\n}\n.ri-bilibili-line:before { content: "\\eac0";\n}\n.ri-bill-fill:before { content: "\\eac1";\n}\n.ri-bill-line:before { content: "\\eac2";\n}\n.ri-billiards-fill:before { content: "\\eac3";\n}\n.ri-billiards-line:before { content: "\\eac4";\n}\n.ri-bit-coin-fill:before { content: "\\eac5";\n}\n.ri-bit-coin-line:before { content: "\\eac6";\n}\n.ri-blaze-fill:before { content: "\\eac7";\n}\n.ri-blaze-line:before { content: "\\eac8";\n}\n.ri-bluetooth-connect-fill:before { content: "\\eac9";\n}\n.ri-bluetooth-connect-line:before { content: "\\eaca";\n}\n.ri-bluetooth-fill:before { content: "\\eacb";\n}\n.ri-bluetooth-line:before { content: "\\eacc";\n}\n.ri-blur-off-fill:before { content: "\\eacd";\n}\n.ri-blur-off-line:before { content: "\\eace";\n}\n.ri-body-scan-fill:before { content: "\\eacf";\n}\n.ri-body-scan-line:before { content: "\\ead0";\n}\n.ri-bold:before { content: "\\ead1";\n}\n.ri-book-2-fill:before { content: "\\ead2";\n}\n.ri-book-2-line:before { content: "\\ead3";\n}\n.ri-book-3-fill:before { content: "\\ead4";\n}\n.ri-book-3-line:before { content: "\\ead5";\n}\n.ri-book-fill:before { content: "\\ead6";\n}\n.ri-book-line:before { content: "\\ead7";\n}\n.ri-book-marked-fill:before { content: "\\ead8";\n}\n.ri-book-marked-line:before { content: "\\ead9";\n}\n.ri-book-open-fill:before { content: "\\eada";\n}\n.ri-book-open-line:before { content: "\\eadb";\n}\n.ri-book-read-fill:before { content: "\\eadc";\n}\n.ri-book-read-line:before { content: "\\eadd";\n}\n.ri-booklet-fill:before { content: "\\eade";\n}\n.ri-booklet-line:before { content: "\\eadf";\n}\n.ri-bookmark-2-fill:before { content: "\\eae0";\n}\n.ri-bookmark-2-line:before { content: "\\eae1";\n}\n.ri-bookmark-3-fill:before { content: "\\eae2";\n}\n.ri-bookmark-3-line:before { content: "\\eae3";\n}\n.ri-bookmark-fill:before { content: "\\eae4";\n}\n.ri-bookmark-line:before { content: "\\eae5";\n}\n.ri-boxing-fill:before { content: "\\eae6";\n}\n.ri-boxing-line:before { content: "\\eae7";\n}\n.ri-braces-fill:before { content: "\\eae8";\n}\n.ri-braces-line:before { content: "\\eae9";\n}\n.ri-brackets-fill:before { content: "\\eaea";\n}\n.ri-brackets-line:before { content: "\\eaeb";\n}\n.ri-briefcase-2-fill:before { content: "\\eaec";\n}\n.ri-briefcase-2-line:before { content: "\\eaed";\n}\n.ri-briefcase-3-fill:before { content: "\\eaee";\n}\n.ri-briefcase-3-line:before { content: "\\eaef";\n}\n.ri-briefcase-4-fill:before { content: "\\eaf0";\n}\n.ri-briefcase-4-line:before { content: "\\eaf1";\n}\n.ri-briefcase-5-fill:before { content: "\\eaf2";\n}\n.ri-briefcase-5-line:before { content: "\\eaf3";\n}\n.ri-briefcase-fill:before { content: "\\eaf4";\n}\n.ri-briefcase-line:before { content: "\\eaf5";\n}\n.ri-bring-forward:before { content: "\\eaf6";\n}\n.ri-bring-to-front:before { content: "\\eaf7";\n}\n.ri-broadcast-fill:before { content: "\\eaf8";\n}\n.ri-broadcast-line:before { content: "\\eaf9";\n}\n.ri-brush-2-fill:before { content: "\\eafa";\n}\n.ri-brush-2-line:before { content: "\\eafb";\n}\n.ri-brush-3-fill:before { content: "\\eafc";\n}\n.ri-brush-3-line:before { content: "\\eafd";\n}\n.ri-brush-4-fill:before { content: "\\eafe";\n}\n.ri-brush-4-line:before { content: "\\eaff";\n}\n.ri-brush-fill:before { content: "\\eb00";\n}\n.ri-brush-line:before { content: "\\eb01";\n}\n.ri-bubble-chart-fill:before { content: "\\eb02";\n}\n.ri-bubble-chart-line:before { content: "\\eb03";\n}\n.ri-bug-2-fill:before { content: "\\eb04";\n}\n.ri-bug-2-line:before { content: "\\eb05";\n}\n.ri-bug-fill:before { content: "\\eb06";\n}\n.ri-bug-line:before { content: "\\eb07";\n}\n.ri-building-2-fill:before { content: "\\eb08";\n}\n.ri-building-2-line:before { content: "\\eb09";\n}\n.ri-building-3-fill:before { content: "\\eb0a";\n}\n.ri-building-3-line:before { content: "\\eb0b";\n}\n.ri-building-4-fill:before { content: "\\eb0c";\n}\n.ri-building-4-line:before { content: "\\eb0d";\n}\n.ri-building-fill:before { content: "\\eb0e";\n}\n.ri-building-line:before { content: "\\eb0f";\n}\n.ri-bus-2-fill:before { content: "\\eb10";\n}\n.ri-bus-2-line:before { content: "\\eb11";\n}\n.ri-bus-fill:before { content: "\\eb12";\n}\n.ri-bus-line:before { content: "\\eb13";\n}\n.ri-bus-wifi-fill:before { content: "\\eb14";\n}\n.ri-bus-wifi-line:before { content: "\\eb15";\n}\n.ri-cactus-fill:before { content: "\\eb16";\n}\n.ri-cactus-line:before { content: "\\eb17";\n}\n.ri-cake-2-fill:before { content: "\\eb18";\n}\n.ri-cake-2-line:before { content: "\\eb19";\n}\n.ri-cake-3-fill:before { content: "\\eb1a";\n}\n.ri-cake-3-line:before { content: "\\eb1b";\n}\n.ri-cake-fill:before { content: "\\eb1c";\n}\n.ri-cake-line:before { content: "\\eb1d";\n}\n.ri-calculator-fill:before { content: "\\eb1e";\n}\n.ri-calculator-line:before { content: "\\eb1f";\n}\n.ri-calendar-2-fill:before { content: "\\eb20";\n}\n.ri-calendar-2-line:before { content: "\\eb21";\n}\n.ri-calendar-check-fill:before { content: "\\eb22";\n}\n.ri-calendar-check-line:before { content: "\\eb23";\n}\n.ri-calendar-event-fill:before { content: "\\eb24";\n}\n.ri-calendar-event-line:before { content: "\\eb25";\n}\n.ri-calendar-fill:before { content: "\\eb26";\n}\n.ri-calendar-line:before { content: "\\eb27";\n}\n.ri-calendar-todo-fill:before { content: "\\eb28";\n}\n.ri-calendar-todo-line:before { content: "\\eb29";\n}\n.ri-camera-2-fill:before { content: "\\eb2a";\n}\n.ri-camera-2-line:before { content: "\\eb2b";\n}\n.ri-camera-3-fill:before { content: "\\eb2c";\n}\n.ri-camera-3-line:before { content: "\\eb2d";\n}\n.ri-camera-fill:before { content: "\\eb2e";\n}\n.ri-camera-lens-fill:before { content: "\\eb2f";\n}\n.ri-camera-lens-line:before { content: "\\eb30";\n}\n.ri-camera-line:before { content: "\\eb31";\n}\n.ri-camera-off-fill:before { content: "\\eb32";\n}\n.ri-camera-off-line:before { content: "\\eb33";\n}\n.ri-camera-switch-fill:before { content: "\\eb34";\n}\n.ri-camera-switch-line:before { content: "\\eb35";\n}\n.ri-capsule-fill:before { content: "\\eb36";\n}\n.ri-capsule-line:before { content: "\\eb37";\n}\n.ri-car-fill:before { content: "\\eb38";\n}\n.ri-car-line:before { content: "\\eb39";\n}\n.ri-car-washing-fill:before { content: "\\eb3a";\n}\n.ri-car-washing-line:before { content: "\\eb3b";\n}\n.ri-caravan-fill:before { content: "\\eb3c";\n}\n.ri-caravan-line:before { content: "\\eb3d";\n}\n.ri-cast-fill:before { content: "\\eb3e";\n}\n.ri-cast-line:before { content: "\\eb3f";\n}\n.ri-cellphone-fill:before { content: "\\eb40";\n}\n.ri-cellphone-line:before { content: "\\eb41";\n}\n.ri-celsius-fill:before { content: "\\eb42";\n}\n.ri-celsius-line:before { content: "\\eb43";\n}\n.ri-centos-fill:before { content: "\\eb44";\n}\n.ri-centos-line:before { content: "\\eb45";\n}\n.ri-character-recognition-fill:before { content: "\\eb46";\n}\n.ri-character-recognition-line:before { content: "\\eb47";\n}\n.ri-charging-pile-2-fill:before { content: "\\eb48";\n}\n.ri-charging-pile-2-line:before { content: "\\eb49";\n}\n.ri-charging-pile-fill:before { content: "\\eb4a";\n}\n.ri-charging-pile-line:before { content: "\\eb4b";\n}\n.ri-chat-1-fill:before { content: "\\eb4c";\n}\n.ri-chat-1-line:before { content: "\\eb4d";\n}\n.ri-chat-2-fill:before { content: "\\eb4e";\n}\n.ri-chat-2-line:before { content: "\\eb4f";\n}\n.ri-chat-3-fill:before { content: "\\eb50";\n}\n.ri-chat-3-line:before { content: "\\eb51";\n}\n.ri-chat-4-fill:before { content: "\\eb52";\n}\n.ri-chat-4-line:before { content: "\\eb53";\n}\n.ri-chat-check-fill:before { content: "\\eb54";\n}\n.ri-chat-check-line:before { content: "\\eb55";\n}\n.ri-chat-delete-fill:before { content: "\\eb56";\n}\n.ri-chat-delete-line:before { content: "\\eb57";\n}\n.ri-chat-download-fill:before { content: "\\eb58";\n}\n.ri-chat-download-line:before { content: "\\eb59";\n}\n.ri-chat-follow-up-fill:before { content: "\\eb5a";\n}\n.ri-chat-follow-up-line:before { content: "\\eb5b";\n}\n.ri-chat-forward-fill:before { content: "\\eb5c";\n}\n.ri-chat-forward-line:before { content: "\\eb5d";\n}\n.ri-chat-heart-fill:before { content: "\\eb5e";\n}\n.ri-chat-heart-line:before { content: "\\eb5f";\n}\n.ri-chat-history-fill:before { content: "\\eb60";\n}\n.ri-chat-history-line:before { content: "\\eb61";\n}\n.ri-chat-new-fill:before { content: "\\eb62";\n}\n.ri-chat-new-line:before { content: "\\eb63";\n}\n.ri-chat-off-fill:before { content: "\\eb64";\n}\n.ri-chat-off-line:before { content: "\\eb65";\n}\n.ri-chat-poll-fill:before { content: "\\eb66";\n}\n.ri-chat-poll-line:before { content: "\\eb67";\n}\n.ri-chat-private-fill:before { content: "\\eb68";\n}\n.ri-chat-private-line:before { content: "\\eb69";\n}\n.ri-chat-quote-fill:before { content: "\\eb6a";\n}\n.ri-chat-quote-line:before { content: "\\eb6b";\n}\n.ri-chat-settings-fill:before { content: "\\eb6c";\n}\n.ri-chat-settings-line:before { content: "\\eb6d";\n}\n.ri-chat-smile-2-fill:before { content: "\\eb6e";\n}\n.ri-chat-smile-2-line:before { content: "\\eb6f";\n}\n.ri-chat-smile-3-fill:before { content: "\\eb70";\n}\n.ri-chat-smile-3-line:before { content: "\\eb71";\n}\n.ri-chat-smile-fill:before { content: "\\eb72";\n}\n.ri-chat-smile-line:before { content: "\\eb73";\n}\n.ri-chat-upload-fill:before { content: "\\eb74";\n}\n.ri-chat-upload-line:before { content: "\\eb75";\n}\n.ri-chat-voice-fill:before { content: "\\eb76";\n}\n.ri-chat-voice-line:before { content: "\\eb77";\n}\n.ri-check-double-fill:before { content: "\\eb78";\n}\n.ri-check-double-line:before { content: "\\eb79";\n}\n.ri-check-fill:before { content: "\\eb7a";\n}\n.ri-check-line:before { content: "\\eb7b";\n}\n.ri-checkbox-blank-circle-fill:before { content: "\\eb7c";\n}\n.ri-checkbox-blank-circle-line:before { content: "\\eb7d";\n}\n.ri-checkbox-blank-fill:before { content: "\\eb7e";\n}\n.ri-checkbox-blank-line:before { content: "\\eb7f";\n}\n.ri-checkbox-circle-fill:before { content: "\\eb80";\n}\n.ri-checkbox-circle-line:before { content: "\\eb81";\n}\n.ri-checkbox-fill:before { content: "\\eb82";\n}\n.ri-checkbox-indeterminate-fill:before { content: "\\eb83";\n}\n.ri-checkbox-indeterminate-line:before { content: "\\eb84";\n}\n.ri-checkbox-line:before { content: "\\eb85";\n}\n.ri-checkbox-multiple-blank-fill:before { content: "\\eb86";\n}\n.ri-checkbox-multiple-blank-line:before { content: "\\eb87";\n}\n.ri-checkbox-multiple-fill:before { content: "\\eb88";\n}\n.ri-checkbox-multiple-line:before { content: "\\eb89";\n}\n.ri-china-railway-fill:before { content: "\\eb8a";\n}\n.ri-china-railway-line:before { content: "\\eb8b";\n}\n.ri-chrome-fill:before { content: "\\eb8c";\n}\n.ri-chrome-line:before { content: "\\eb8d";\n}\n.ri-clapperboard-fill:before { content: "\\eb8e";\n}\n.ri-clapperboard-line:before { content: "\\eb8f";\n}\n.ri-clipboard-fill:before { content: "\\eb90";\n}\n.ri-clipboard-line:before { content: "\\eb91";\n}\n.ri-clockwise-2-fill:before { content: "\\eb92";\n}\n.ri-clockwise-2-line:before { content: "\\eb93";\n}\n.ri-clockwise-fill:before { content: "\\eb94";\n}\n.ri-clockwise-line:before { content: "\\eb95";\n}\n.ri-close-circle-fill:before { content: "\\eb96";\n}\n.ri-close-circle-line:before { content: "\\eb97";\n}\n.ri-close-fill:before { content: "\\eb98";\n}\n.ri-close-line:before { content: "\\eb99";\n}\n.ri-closed-captioning-fill:before { content: "\\eb9a";\n}\n.ri-closed-captioning-line:before { content: "\\eb9b";\n}\n.ri-cloud-fill:before { content: "\\eb9c";\n}\n.ri-cloud-line:before { content: "\\eb9d";\n}\n.ri-cloud-off-fill:before { content: "\\eb9e";\n}\n.ri-cloud-off-line:before { content: "\\eb9f";\n}\n.ri-cloud-windy-fill:before { content: "\\eba0";\n}\n.ri-cloud-windy-line:before { content: "\\eba1";\n}\n.ri-cloudy-2-fill:before { content: "\\eba2";\n}\n.ri-cloudy-2-line:before { content: "\\eba3";\n}\n.ri-cloudy-fill:before { content: "\\eba4";\n}\n.ri-cloudy-line:before { content: "\\eba5";\n}\n.ri-code-box-fill:before { content: "\\eba6";\n}\n.ri-code-box-line:before { content: "\\eba7";\n}\n.ri-code-fill:before { content: "\\eba8";\n}\n.ri-code-line:before { content: "\\eba9";\n}\n.ri-code-s-fill:before { content: "\\ebaa";\n}\n.ri-code-s-line:before { content: "\\ebab";\n}\n.ri-code-s-slash-fill:before { content: "\\ebac";\n}\n.ri-code-s-slash-line:before { content: "\\ebad";\n}\n.ri-code-view:before { content: "\\ebae";\n}\n.ri-codepen-fill:before { content: "\\ebaf";\n}\n.ri-codepen-line:before { content: "\\ebb0";\n}\n.ri-coin-fill:before { content: "\\ebb1";\n}\n.ri-coin-line:before { content: "\\ebb2";\n}\n.ri-coins-fill:before { content: "\\ebb3";\n}\n.ri-coins-line:before { content: "\\ebb4";\n}\n.ri-collage-fill:before { content: "\\ebb5";\n}\n.ri-collage-line:before { content: "\\ebb6";\n}\n.ri-command-fill:before { content: "\\ebb7";\n}\n.ri-command-line:before { content: "\\ebb8";\n}\n.ri-community-fill:before { content: "\\ebb9";\n}\n.ri-community-line:before { content: "\\ebba";\n}\n.ri-compass-2-fill:before { content: "\\ebbb";\n}\n.ri-compass-2-line:before { content: "\\ebbc";\n}\n.ri-compass-3-fill:before { content: "\\ebbd";\n}\n.ri-compass-3-line:before { content: "\\ebbe";\n}\n.ri-compass-4-fill:before { content: "\\ebbf";\n}\n.ri-compass-4-line:before { content: "\\ebc0";\n}\n.ri-compass-discover-fill:before { content: "\\ebc1";\n}\n.ri-compass-discover-line:before { content: "\\ebc2";\n}\n.ri-compass-fill:before { content: "\\ebc3";\n}\n.ri-compass-line:before { content: "\\ebc4";\n}\n.ri-compasses-2-fill:before { content: "\\ebc5";\n}\n.ri-compasses-2-line:before { content: "\\ebc6";\n}\n.ri-compasses-fill:before { content: "\\ebc7";\n}\n.ri-compasses-line:before { content: "\\ebc8";\n}\n.ri-computer-fill:before { content: "\\ebc9";\n}\n.ri-computer-line:before { content: "\\ebca";\n}\n.ri-contacts-book-2-fill:before { content: "\\ebcb";\n}\n.ri-contacts-book-2-line:before { content: "\\ebcc";\n}\n.ri-contacts-book-fill:before { content: "\\ebcd";\n}\n.ri-contacts-book-line:before { content: "\\ebce";\n}\n.ri-contacts-book-upload-fill:before { content: "\\ebcf";\n}\n.ri-contacts-book-upload-line:before { content: "\\ebd0";\n}\n.ri-contacts-fill:before { content: "\\ebd1";\n}\n.ri-contacts-line:before { content: "\\ebd2";\n}\n.ri-contrast-2-fill:before { content: "\\ebd3";\n}\n.ri-contrast-2-line:before { content: "\\ebd4";\n}\n.ri-contrast-drop-2-fill:before { content: "\\ebd5";\n}\n.ri-contrast-drop-2-line:before { content: "\\ebd6";\n}\n.ri-contrast-drop-fill:before { content: "\\ebd7";\n}\n.ri-contrast-drop-line:before { content: "\\ebd8";\n}\n.ri-contrast-fill:before { content: "\\ebd9";\n}\n.ri-contrast-line:before { content: "\\ebda";\n}\n.ri-copper-coin-fill:before { content: "\\ebdb";\n}\n.ri-copper-coin-line:before { content: "\\ebdc";\n}\n.ri-copper-diamond-fill:before { content: "\\ebdd";\n}\n.ri-copper-diamond-line:before { content: "\\ebde";\n}\n.ri-copyleft-fill:before { content: "\\ebdf";\n}\n.ri-copyleft-line:before { content: "\\ebe0";\n}\n.ri-copyright-fill:before { content: "\\ebe1";\n}\n.ri-copyright-line:before { content: "\\ebe2";\n}\n.ri-coreos-fill:before { content: "\\ebe3";\n}\n.ri-coreos-line:before { content: "\\ebe4";\n}\n.ri-coupon-2-fill:before { content: "\\ebe5";\n}\n.ri-coupon-2-line:before { content: "\\ebe6";\n}\n.ri-coupon-3-fill:before { content: "\\ebe7";\n}\n.ri-coupon-3-line:before { content: "\\ebe8";\n}\n.ri-coupon-4-fill:before { content: "\\ebe9";\n}\n.ri-coupon-4-line:before { content: "\\ebea";\n}\n.ri-coupon-5-fill:before { content: "\\ebeb";\n}\n.ri-coupon-5-line:before { content: "\\ebec";\n}\n.ri-coupon-fill:before { content: "\\ebed";\n}\n.ri-coupon-line:before { content: "\\ebee";\n}\n.ri-cpu-fill:before { content: "\\ebef";\n}\n.ri-cpu-line:before { content: "\\ebf0";\n}\n.ri-creative-commons-by-fill:before { content: "\\ebf1";\n}\n.ri-creative-commons-by-line:before { content: "\\ebf2";\n}\n.ri-creative-commons-fill:before { content: "\\ebf3";\n}\n.ri-creative-commons-line:before { content: "\\ebf4";\n}\n.ri-creative-commons-nc-fill:before { content: "\\ebf5";\n}\n.ri-creative-commons-nc-line:before { content: "\\ebf6";\n}\n.ri-creative-commons-nd-fill:before { content: "\\ebf7";\n}\n.ri-creative-commons-nd-line:before { content: "\\ebf8";\n}\n.ri-creative-commons-sa-fill:before { content: "\\ebf9";\n}\n.ri-creative-commons-sa-line:before { content: "\\ebfa";\n}\n.ri-creative-commons-zero-fill:before { content: "\\ebfb";\n}\n.ri-creative-commons-zero-line:before { content: "\\ebfc";\n}\n.ri-criminal-fill:before { content: "\\ebfd";\n}\n.ri-criminal-line:before { content: "\\ebfe";\n}\n.ri-crop-2-fill:before { content: "\\ebff";\n}\n.ri-crop-2-line:before { content: "\\ec00";\n}\n.ri-crop-fill:before { content: "\\ec01";\n}\n.ri-crop-line:before { content: "\\ec02";\n}\n.ri-css3-fill:before { content: "\\ec03";\n}\n.ri-css3-line:before { content: "\\ec04";\n}\n.ri-cup-fill:before { content: "\\ec05";\n}\n.ri-cup-line:before { content: "\\ec06";\n}\n.ri-currency-fill:before { content: "\\ec07";\n}\n.ri-currency-line:before { content: "\\ec08";\n}\n.ri-cursor-fill:before { content: "\\ec09";\n}\n.ri-cursor-line:before { content: "\\ec0a";\n}\n.ri-customer-service-2-fill:before { content: "\\ec0b";\n}\n.ri-customer-service-2-line:before { content: "\\ec0c";\n}\n.ri-customer-service-fill:before { content: "\\ec0d";\n}\n.ri-customer-service-line:before { content: "\\ec0e";\n}\n.ri-dashboard-2-fill:before { content: "\\ec0f";\n}\n.ri-dashboard-2-line:before { content: "\\ec10";\n}\n.ri-dashboard-3-fill:before { content: "\\ec11";\n}\n.ri-dashboard-3-line:before { content: "\\ec12";\n}\n.ri-dashboard-fill:before { content: "\\ec13";\n}\n.ri-dashboard-line:before { content: "\\ec14";\n}\n.ri-database-2-fill:before { content: "\\ec15";\n}\n.ri-database-2-line:before { content: "\\ec16";\n}\n.ri-database-fill:before { content: "\\ec17";\n}\n.ri-database-line:before { content: "\\ec18";\n}\n.ri-delete-back-2-fill:before { content: "\\ec19";\n}\n.ri-delete-back-2-line:before { content: "\\ec1a";\n}\n.ri-delete-back-fill:before { content: "\\ec1b";\n}\n.ri-delete-back-line:before { content: "\\ec1c";\n}\n.ri-delete-bin-2-fill:before { content: "\\ec1d";\n}\n.ri-delete-bin-2-line:before { content: "\\ec1e";\n}\n.ri-delete-bin-3-fill:before { content: "\\ec1f";\n}\n.ri-delete-bin-3-line:before { content: "\\ec20";\n}\n.ri-delete-bin-4-fill:before { content: "\\ec21";\n}\n.ri-delete-bin-4-line:before { content: "\\ec22";\n}\n.ri-delete-bin-5-fill:before { content: "\\ec23";\n}\n.ri-delete-bin-5-line:before { content: "\\ec24";\n}\n.ri-delete-bin-6-fill:before { content: "\\ec25";\n}\n.ri-delete-bin-6-line:before { content: "\\ec26";\n}\n.ri-delete-bin-7-fill:before { content: "\\ec27";\n}\n.ri-delete-bin-7-line:before { content: "\\ec28";\n}\n.ri-delete-bin-fill:before { content: "\\ec29";\n}\n.ri-delete-bin-line:before { content: "\\ec2a";\n}\n.ri-delete-column:before { content: "\\ec2b";\n}\n.ri-delete-row:before { content: "\\ec2c";\n}\n.ri-device-fill:before { content: "\\ec2d";\n}\n.ri-device-line:before { content: "\\ec2e";\n}\n.ri-device-recover-fill:before { content: "\\ec2f";\n}\n.ri-device-recover-line:before { content: "\\ec30";\n}\n.ri-dingding-fill:before { content: "\\ec31";\n}\n.ri-dingding-line:before { content: "\\ec32";\n}\n.ri-direction-fill:before { content: "\\ec33";\n}\n.ri-direction-line:before { content: "\\ec34";\n}\n.ri-disc-fill:before { content: "\\ec35";\n}\n.ri-disc-line:before { content: "\\ec36";\n}\n.ri-discord-fill:before { content: "\\ec37";\n}\n.ri-discord-line:before { content: "\\ec38";\n}\n.ri-discuss-fill:before { content: "\\ec39";\n}\n.ri-discuss-line:before { content: "\\ec3a";\n}\n.ri-dislike-fill:before { content: "\\ec3b";\n}\n.ri-dislike-line:before { content: "\\ec3c";\n}\n.ri-disqus-fill:before { content: "\\ec3d";\n}\n.ri-disqus-line:before { content: "\\ec3e";\n}\n.ri-divide-fill:before { content: "\\ec3f";\n}\n.ri-divide-line:before { content: "\\ec40";\n}\n.ri-donut-chart-fill:before { content: "\\ec41";\n}\n.ri-donut-chart-line:before { content: "\\ec42";\n}\n.ri-door-closed-fill:before { content: "\\ec43";\n}\n.ri-door-closed-line:before { content: "\\ec44";\n}\n.ri-door-fill:before { content: "\\ec45";\n}\n.ri-door-line:before { content: "\\ec46";\n}\n.ri-door-lock-box-fill:before { content: "\\ec47";\n}\n.ri-door-lock-box-line:before { content: "\\ec48";\n}\n.ri-door-lock-fill:before { content: "\\ec49";\n}\n.ri-door-lock-line:before { content: "\\ec4a";\n}\n.ri-door-open-fill:before { content: "\\ec4b";\n}\n.ri-door-open-line:before { content: "\\ec4c";\n}\n.ri-dossier-fill:before { content: "\\ec4d";\n}\n.ri-dossier-line:before { content: "\\ec4e";\n}\n.ri-douban-fill:before { content: "\\ec4f";\n}\n.ri-douban-line:before { content: "\\ec50";\n}\n.ri-double-quotes-l:before { content: "\\ec51";\n}\n.ri-double-quotes-r:before { content: "\\ec52";\n}\n.ri-download-2-fill:before { content: "\\ec53";\n}\n.ri-download-2-line:before { content: "\\ec54";\n}\n.ri-download-cloud-2-fill:before { content: "\\ec55";\n}\n.ri-download-cloud-2-line:before { content: "\\ec56";\n}\n.ri-download-cloud-fill:before { content: "\\ec57";\n}\n.ri-download-cloud-line:before { content: "\\ec58";\n}\n.ri-download-fill:before { content: "\\ec59";\n}\n.ri-download-line:before { content: "\\ec5a";\n}\n.ri-draft-fill:before { content: "\\ec5b";\n}\n.ri-draft-line:before { content: "\\ec5c";\n}\n.ri-drag-drop-fill:before { content: "\\ec5d";\n}\n.ri-drag-drop-line:before { content: "\\ec5e";\n}\n.ri-drag-move-2-fill:before { content: "\\ec5f";\n}\n.ri-drag-move-2-line:before { content: "\\ec60";\n}\n.ri-drag-move-fill:before { content: "\\ec61";\n}\n.ri-drag-move-line:before { content: "\\ec62";\n}\n.ri-dribbble-fill:before { content: "\\ec63";\n}\n.ri-dribbble-line:before { content: "\\ec64";\n}\n.ri-drive-fill:before { content: "\\ec65";\n}\n.ri-drive-line:before { content: "\\ec66";\n}\n.ri-drizzle-fill:before { content: "\\ec67";\n}\n.ri-drizzle-line:before { content: "\\ec68";\n}\n.ri-drop-fill:before { content: "\\ec69";\n}\n.ri-drop-line:before { content: "\\ec6a";\n}\n.ri-dropbox-fill:before { content: "\\ec6b";\n}\n.ri-dropbox-line:before { content: "\\ec6c";\n}\n.ri-dual-sim-1-fill:before { content: "\\ec6d";\n}\n.ri-dual-sim-1-line:before { content: "\\ec6e";\n}\n.ri-dual-sim-2-fill:before { content: "\\ec6f";\n}\n.ri-dual-sim-2-line:before { content: "\\ec70";\n}\n.ri-dv-fill:before { content: "\\ec71";\n}\n.ri-dv-line:before { content: "\\ec72";\n}\n.ri-dvd-fill:before { content: "\\ec73";\n}\n.ri-dvd-line:before { content: "\\ec74";\n}\n.ri-e-bike-2-fill:before { content: "\\ec75";\n}\n.ri-e-bike-2-line:before { content: "\\ec76";\n}\n.ri-e-bike-fill:before { content: "\\ec77";\n}\n.ri-e-bike-line:before { content: "\\ec78";\n}\n.ri-earth-fill:before { content: "\\ec79";\n}\n.ri-earth-line:before { content: "\\ec7a";\n}\n.ri-earthquake-fill:before { content: "\\ec7b";\n}\n.ri-earthquake-line:before { content: "\\ec7c";\n}\n.ri-edge-fill:before { content: "\\ec7d";\n}\n.ri-edge-line:before { content: "\\ec7e";\n}\n.ri-edit-2-fill:before { content: "\\ec7f";\n}\n.ri-edit-2-line:before { content: "\\ec80";\n}\n.ri-edit-box-fill:before { content: "\\ec81";\n}\n.ri-edit-box-line:before { content: "\\ec82";\n}\n.ri-edit-circle-fill:before { content: "\\ec83";\n}\n.ri-edit-circle-line:before { content: "\\ec84";\n}\n.ri-edit-fill:before { content: "\\ec85";\n}\n.ri-edit-line:before { content: "\\ec86";\n}\n.ri-eject-fill:before { content: "\\ec87";\n}\n.ri-eject-line:before { content: "\\ec88";\n}\n.ri-emotion-2-fill:before { content: "\\ec89";\n}\n.ri-emotion-2-line:before { content: "\\ec8a";\n}\n.ri-emotion-fill:before { content: "\\ec8b";\n}\n.ri-emotion-happy-fill:before { content: "\\ec8c";\n}\n.ri-emotion-happy-line:before { content: "\\ec8d";\n}\n.ri-emotion-laugh-fill:before { content: "\\ec8e";\n}\n.ri-emotion-laugh-line:before { content: "\\ec8f";\n}\n.ri-emotion-line:before { content: "\\ec90";\n}\n.ri-emotion-normal-fill:before { content: "\\ec91";\n}\n.ri-emotion-normal-line:before { content: "\\ec92";\n}\n.ri-emotion-sad-fill:before { content: "\\ec93";\n}\n.ri-emotion-sad-line:before { content: "\\ec94";\n}\n.ri-emotion-unhappy-fill:before { content: "\\ec95";\n}\n.ri-emotion-unhappy-line:before { content: "\\ec96";\n}\n.ri-empathize-fill:before { content: "\\ec97";\n}\n.ri-empathize-line:before { content: "\\ec98";\n}\n.ri-emphasis-cn:before { content: "\\ec99";\n}\n.ri-emphasis:before { content: "\\ec9a";\n}\n.ri-english-input:before { content: "\\ec9b";\n}\n.ri-equalizer-fill:before { content: "\\ec9c";\n}\n.ri-equalizer-line:before { content: "\\ec9d";\n}\n.ri-eraser-fill:before { content: "\\ec9e";\n}\n.ri-eraser-line:before { content: "\\ec9f";\n}\n.ri-error-warning-fill:before { content: "\\eca0";\n}\n.ri-error-warning-line:before { content: "\\eca1";\n}\n.ri-evernote-fill:before { content: "\\eca2";\n}\n.ri-evernote-line:before { content: "\\eca3";\n}\n.ri-exchange-box-fill:before { content: "\\eca4";\n}\n.ri-exchange-box-line:before { content: "\\eca5";\n}\n.ri-exchange-cny-fill:before { content: "\\eca6";\n}\n.ri-exchange-cny-line:before { content: "\\eca7";\n}\n.ri-exchange-dollar-fill:before { content: "\\eca8";\n}\n.ri-exchange-dollar-line:before { content: "\\eca9";\n}\n.ri-exchange-fill:before { content: "\\ecaa";\n}\n.ri-exchange-funds-fill:before { content: "\\ecab";\n}\n.ri-exchange-funds-line:before { content: "\\ecac";\n}\n.ri-exchange-line:before { content: "\\ecad";\n}\n.ri-external-link-fill:before { content: "\\ecae";\n}\n.ri-external-link-line:before { content: "\\ecaf";\n}\n.ri-eye-2-fill:before { content: "\\ecb0";\n}\n.ri-eye-2-line:before { content: "\\ecb1";\n}\n.ri-eye-close-fill:before { content: "\\ecb2";\n}\n.ri-eye-close-line:before { content: "\\ecb3";\n}\n.ri-eye-fill:before { content: "\\ecb4";\n}\n.ri-eye-line:before { content: "\\ecb5";\n}\n.ri-eye-off-fill:before { content: "\\ecb6";\n}\n.ri-eye-off-line:before { content: "\\ecb7";\n}\n.ri-facebook-box-fill:before { content: "\\ecb8";\n}\n.ri-facebook-box-line:before { content: "\\ecb9";\n}\n.ri-facebook-circle-fill:before { content: "\\ecba";\n}\n.ri-facebook-circle-line:before { content: "\\ecbb";\n}\n.ri-facebook-fill:before { content: "\\ecbc";\n}\n.ri-facebook-line:before { content: "\\ecbd";\n}\n.ri-fahrenheit-fill:before { content: "\\ecbe";\n}\n.ri-fahrenheit-line:before { content: "\\ecbf";\n}\n.ri-feedback-fill:before { content: "\\ecc0";\n}\n.ri-feedback-line:before { content: "\\ecc1";\n}\n.ri-file-2-fill:before { content: "\\ecc2";\n}\n.ri-file-2-line:before { content: "\\ecc3";\n}\n.ri-file-3-fill:before { content: "\\ecc4";\n}\n.ri-file-3-line:before { content: "\\ecc5";\n}\n.ri-file-4-fill:before { content: "\\ecc6";\n}\n.ri-file-4-line:before { content: "\\ecc7";\n}\n.ri-file-add-fill:before { content: "\\ecc8";\n}\n.ri-file-add-line:before { content: "\\ecc9";\n}\n.ri-file-chart-2-fill:before { content: "\\ecca";\n}\n.ri-file-chart-2-line:before { content: "\\eccb";\n}\n.ri-file-chart-fill:before { content: "\\eccc";\n}\n.ri-file-chart-line:before { content: "\\eccd";\n}\n.ri-file-cloud-fill:before { content: "\\ecce";\n}\n.ri-file-cloud-line:before { content: "\\eccf";\n}\n.ri-file-code-fill:before { content: "\\ecd0";\n}\n.ri-file-code-line:before { content: "\\ecd1";\n}\n.ri-file-copy-2-fill:before { content: "\\ecd2";\n}\n.ri-file-copy-2-line:before { content: "\\ecd3";\n}\n.ri-file-copy-fill:before { content: "\\ecd4";\n}\n.ri-file-copy-line:before { content: "\\ecd5";\n}\n.ri-file-damage-fill:before { content: "\\ecd6";\n}\n.ri-file-damage-line:before { content: "\\ecd7";\n}\n.ri-file-download-fill:before { content: "\\ecd8";\n}\n.ri-file-download-line:before { content: "\\ecd9";\n}\n.ri-file-edit-fill:before { content: "\\ecda";\n}\n.ri-file-edit-line:before { content: "\\ecdb";\n}\n.ri-file-excel-2-fill:before { content: "\\ecdc";\n}\n.ri-file-excel-2-line:before { content: "\\ecdd";\n}\n.ri-file-excel-fill:before { content: "\\ecde";\n}\n.ri-file-excel-line:before { content: "\\ecdf";\n}\n.ri-file-fill:before { content: "\\ece0";\n}\n.ri-file-forbid-fill:before { content: "\\ece1";\n}\n.ri-file-forbid-line:before { content: "\\ece2";\n}\n.ri-file-gif-fill:before { content: "\\ece3";\n}\n.ri-file-gif-line:before { content: "\\ece4";\n}\n.ri-file-history-fill:before { content: "\\ece5";\n}\n.ri-file-history-line:before { content: "\\ece6";\n}\n.ri-file-hwp-fill:before { content: "\\ece7";\n}\n.ri-file-hwp-line:before { content: "\\ece8";\n}\n.ri-file-info-fill:before { content: "\\ece9";\n}\n.ri-file-info-line:before { content: "\\ecea";\n}\n.ri-file-line:before { content: "\\eceb";\n}\n.ri-file-list-2-fill:before { content: "\\ecec";\n}\n.ri-file-list-2-line:before { content: "\\eced";\n}\n.ri-file-list-3-fill:before { content: "\\ecee";\n}\n.ri-file-list-3-line:before { content: "\\ecef";\n}\n.ri-file-list-fill:before { content: "\\ecf0";\n}\n.ri-file-list-line:before { content: "\\ecf1";\n}\n.ri-file-lock-fill:before { content: "\\ecf2";\n}\n.ri-file-lock-line:before { content: "\\ecf3";\n}\n.ri-file-marked-fill:before { content: "\\ecf4";\n}\n.ri-file-marked-line:before { content: "\\ecf5";\n}\n.ri-file-music-fill:before { content: "\\ecf6";\n}\n.ri-file-music-line:before { content: "\\ecf7";\n}\n.ri-file-paper-2-fill:before { content: "\\ecf8";\n}\n.ri-file-paper-2-line:before { content: "\\ecf9";\n}\n.ri-file-paper-fill:before { content: "\\ecfa";\n}\n.ri-file-paper-line:before { content: "\\ecfb";\n}\n.ri-file-pdf-fill:before { content: "\\ecfc";\n}\n.ri-file-pdf-line:before { content: "\\ecfd";\n}\n.ri-file-ppt-2-fill:before { content: "\\ecfe";\n}\n.ri-file-ppt-2-line:before { content: "\\ecff";\n}\n.ri-file-ppt-fill:before { content: "\\ed00";\n}\n.ri-file-ppt-line:before { content: "\\ed01";\n}\n.ri-file-reduce-fill:before { content: "\\ed02";\n}\n.ri-file-reduce-line:before { content: "\\ed03";\n}\n.ri-file-search-fill:before { content: "\\ed04";\n}\n.ri-file-search-line:before { content: "\\ed05";\n}\n.ri-file-settings-fill:before { content: "\\ed06";\n}\n.ri-file-settings-line:before { content: "\\ed07";\n}\n.ri-file-shield-2-fill:before { content: "\\ed08";\n}\n.ri-file-shield-2-line:before { content: "\\ed09";\n}\n.ri-file-shield-fill:before { content: "\\ed0a";\n}\n.ri-file-shield-line:before { content: "\\ed0b";\n}\n.ri-file-shred-fill:before { content: "\\ed0c";\n}\n.ri-file-shred-line:before { content: "\\ed0d";\n}\n.ri-file-text-fill:before { content: "\\ed0e";\n}\n.ri-file-text-line:before { content: "\\ed0f";\n}\n.ri-file-transfer-fill:before { content: "\\ed10";\n}\n.ri-file-transfer-line:before { content: "\\ed11";\n}\n.ri-file-unknow-fill:before { content: "\\ed12";\n}\n.ri-file-unknow-line:before { content: "\\ed13";\n}\n.ri-file-upload-fill:before { content: "\\ed14";\n}\n.ri-file-upload-line:before { content: "\\ed15";\n}\n.ri-file-user-fill:before { content: "\\ed16";\n}\n.ri-file-user-line:before { content: "\\ed17";\n}\n.ri-file-warning-fill:before { content: "\\ed18";\n}\n.ri-file-warning-line:before { content: "\\ed19";\n}\n.ri-file-word-2-fill:before { content: "\\ed1a";\n}\n.ri-file-word-2-line:before { content: "\\ed1b";\n}\n.ri-file-word-fill:before { content: "\\ed1c";\n}\n.ri-file-word-line:before { content: "\\ed1d";\n}\n.ri-file-zip-fill:before { content: "\\ed1e";\n}\n.ri-file-zip-line:before { content: "\\ed1f";\n}\n.ri-film-fill:before { content: "\\ed20";\n}\n.ri-film-line:before { content: "\\ed21";\n}\n.ri-filter-2-fill:before { content: "\\ed22";\n}\n.ri-filter-2-line:before { content: "\\ed23";\n}\n.ri-filter-3-fill:before { content: "\\ed24";\n}\n.ri-filter-3-line:before { content: "\\ed25";\n}\n.ri-filter-fill:before { content: "\\ed26";\n}\n.ri-filter-line:before { content: "\\ed27";\n}\n.ri-filter-off-fill:before { content: "\\ed28";\n}\n.ri-filter-off-line:before { content: "\\ed29";\n}\n.ri-find-replace-fill:before { content: "\\ed2a";\n}\n.ri-find-replace-line:before { content: "\\ed2b";\n}\n.ri-finder-fill:before { content: "\\ed2c";\n}\n.ri-finder-line:before { content: "\\ed2d";\n}\n.ri-fingerprint-2-fill:before { content: "\\ed2e";\n}\n.ri-fingerprint-2-line:before { content: "\\ed2f";\n}\n.ri-fingerprint-fill:before { content: "\\ed30";\n}\n.ri-fingerprint-line:before { content: "\\ed31";\n}\n.ri-fire-fill:before { content: "\\ed32";\n}\n.ri-fire-line:before { content: "\\ed33";\n}\n.ri-firefox-fill:before { content: "\\ed34";\n}\n.ri-firefox-line:before { content: "\\ed35";\n}\n.ri-first-aid-kit-fill:before { content: "\\ed36";\n}\n.ri-first-aid-kit-line:before { content: "\\ed37";\n}\n.ri-flag-2-fill:before { content: "\\ed38";\n}\n.ri-flag-2-line:before { content: "\\ed39";\n}\n.ri-flag-fill:before { content: "\\ed3a";\n}\n.ri-flag-line:before { content: "\\ed3b";\n}\n.ri-flashlight-fill:before { content: "\\ed3c";\n}\n.ri-flashlight-line:before { content: "\\ed3d";\n}\n.ri-flask-fill:before { content: "\\ed3e";\n}\n.ri-flask-line:before { content: "\\ed3f";\n}\n.ri-flight-land-fill:before { content: "\\ed40";\n}\n.ri-flight-land-line:before { content: "\\ed41";\n}\n.ri-flight-takeoff-fill:before { content: "\\ed42";\n}\n.ri-flight-takeoff-line:before { content: "\\ed43";\n}\n.ri-flood-fill:before { content: "\\ed44";\n}\n.ri-flood-line:before { content: "\\ed45";\n}\n.ri-flow-chart:before { content: "\\ed46";\n}\n.ri-flutter-fill:before { content: "\\ed47";\n}\n.ri-flutter-line:before { content: "\\ed48";\n}\n.ri-focus-2-fill:before { content: "\\ed49";\n}\n.ri-focus-2-line:before { content: "\\ed4a";\n}\n.ri-focus-3-fill:before { content: "\\ed4b";\n}\n.ri-focus-3-line:before { content: "\\ed4c";\n}\n.ri-focus-fill:before { content: "\\ed4d";\n}\n.ri-focus-line:before { content: "\\ed4e";\n}\n.ri-foggy-fill:before { content: "\\ed4f";\n}\n.ri-foggy-line:before { content: "\\ed50";\n}\n.ri-folder-2-fill:before { content: "\\ed51";\n}\n.ri-folder-2-line:before { content: "\\ed52";\n}\n.ri-folder-3-fill:before { content: "\\ed53";\n}\n.ri-folder-3-line:before { content: "\\ed54";\n}\n.ri-folder-4-fill:before { content: "\\ed55";\n}\n.ri-folder-4-line:before { content: "\\ed56";\n}\n.ri-folder-5-fill:before { content: "\\ed57";\n}\n.ri-folder-5-line:before { content: "\\ed58";\n}\n.ri-folder-add-fill:before { content: "\\ed59";\n}\n.ri-folder-add-line:before { content: "\\ed5a";\n}\n.ri-folder-chart-2-fill:before { content: "\\ed5b";\n}\n.ri-folder-chart-2-line:before { content: "\\ed5c";\n}\n.ri-folder-chart-fill:before { content: "\\ed5d";\n}\n.ri-folder-chart-line:before { content: "\\ed5e";\n}\n.ri-folder-download-fill:before { content: "\\ed5f";\n}\n.ri-folder-download-line:before { content: "\\ed60";\n}\n.ri-folder-fill:before { content: "\\ed61";\n}\n.ri-folder-forbid-fill:before { content: "\\ed62";\n}\n.ri-folder-forbid-line:before { content: "\\ed63";\n}\n.ri-folder-history-fill:before { content: "\\ed64";\n}\n.ri-folder-history-line:before { content: "\\ed65";\n}\n.ri-folder-info-fill:before { content: "\\ed66";\n}\n.ri-folder-info-line:before { content: "\\ed67";\n}\n.ri-folder-keyhole-fill:before { content: "\\ed68";\n}\n.ri-folder-keyhole-line:before { content: "\\ed69";\n}\n.ri-folder-line:before { content: "\\ed6a";\n}\n.ri-folder-lock-fill:before { content: "\\ed6b";\n}\n.ri-folder-lock-line:before { content: "\\ed6c";\n}\n.ri-folder-music-fill:before { content: "\\ed6d";\n}\n.ri-folder-music-line:before { content: "\\ed6e";\n}\n.ri-folder-open-fill:before { content: "\\ed6f";\n}\n.ri-folder-open-line:before { content: "\\ed70";\n}\n.ri-folder-received-fill:before { content: "\\ed71";\n}\n.ri-folder-received-line:before { content: "\\ed72";\n}\n.ri-folder-reduce-fill:before { content: "\\ed73";\n}\n.ri-folder-reduce-line:before { content: "\\ed74";\n}\n.ri-folder-settings-fill:before { content: "\\ed75";\n}\n.ri-folder-settings-line:before { content: "\\ed76";\n}\n.ri-folder-shared-fill:before { content: "\\ed77";\n}\n.ri-folder-shared-line:before { content: "\\ed78";\n}\n.ri-folder-shield-2-fill:before { content: "\\ed79";\n}\n.ri-folder-shield-2-line:before { content: "\\ed7a";\n}\n.ri-folder-shield-fill:before { content: "\\ed7b";\n}\n.ri-folder-shield-line:before { content: "\\ed7c";\n}\n.ri-folder-transfer-fill:before { content: "\\ed7d";\n}\n.ri-folder-transfer-line:before { content: "\\ed7e";\n}\n.ri-folder-unknow-fill:before { content: "\\ed7f";\n}\n.ri-folder-unknow-line:before { content: "\\ed80";\n}\n.ri-folder-upload-fill:before { content: "\\ed81";\n}\n.ri-folder-upload-line:before { content: "\\ed82";\n}\n.ri-folder-user-fill:before { content: "\\ed83";\n}\n.ri-folder-user-line:before { content: "\\ed84";\n}\n.ri-folder-warning-fill:before { content: "\\ed85";\n}\n.ri-folder-warning-line:before { content: "\\ed86";\n}\n.ri-folder-zip-fill:before { content: "\\ed87";\n}\n.ri-folder-zip-line:before { content: "\\ed88";\n}\n.ri-folders-fill:before { content: "\\ed89";\n}\n.ri-folders-line:before { content: "\\ed8a";\n}\n.ri-font-color:before { content: "\\ed8b";\n}\n.ri-font-size-2:before { content: "\\ed8c";\n}\n.ri-font-size:before { content: "\\ed8d";\n}\n.ri-football-fill:before { content: "\\ed8e";\n}\n.ri-football-line:before { content: "\\ed8f";\n}\n.ri-footprint-fill:before { content: "\\ed90";\n}\n.ri-footprint-line:before { content: "\\ed91";\n}\n.ri-forbid-2-fill:before { content: "\\ed92";\n}\n.ri-forbid-2-line:before { content: "\\ed93";\n}\n.ri-forbid-fill:before { content: "\\ed94";\n}\n.ri-forbid-line:before { content: "\\ed95";\n}\n.ri-format-clear:before { content: "\\ed96";\n}\n.ri-fridge-fill:before { content: "\\ed97";\n}\n.ri-fridge-line:before { content: "\\ed98";\n}\n.ri-fullscreen-exit-fill:before { content: "\\ed99";\n}\n.ri-fullscreen-exit-line:before { content: "\\ed9a";\n}\n.ri-fullscreen-fill:before { content: "\\ed9b";\n}\n.ri-fullscreen-line:before { content: "\\ed9c";\n}\n.ri-function-fill:before { content: "\\ed9d";\n}\n.ri-function-line:before { content: "\\ed9e";\n}\n.ri-functions:before { content: "\\ed9f";\n}\n.ri-funds-box-fill:before { content: "\\eda0";\n}\n.ri-funds-box-line:before { content: "\\eda1";\n}\n.ri-funds-fill:before { content: "\\eda2";\n}\n.ri-funds-line:before { content: "\\eda3";\n}\n.ri-gallery-fill:before { content: "\\eda4";\n}\n.ri-gallery-line:before { content: "\\eda5";\n}\n.ri-gallery-upload-fill:before { content: "\\eda6";\n}\n.ri-gallery-upload-line:before { content: "\\eda7";\n}\n.ri-game-fill:before { content: "\\eda8";\n}\n.ri-game-line:before { content: "\\eda9";\n}\n.ri-gamepad-fill:before { content: "\\edaa";\n}\n.ri-gamepad-line:before { content: "\\edab";\n}\n.ri-gas-station-fill:before { content: "\\edac";\n}\n.ri-gas-station-line:before { content: "\\edad";\n}\n.ri-gatsby-fill:before { content: "\\edae";\n}\n.ri-gatsby-line:before { content: "\\edaf";\n}\n.ri-genderless-fill:before { content: "\\edb0";\n}\n.ri-genderless-line:before { content: "\\edb1";\n}\n.ri-ghost-2-fill:before { content: "\\edb2";\n}\n.ri-ghost-2-line:before { content: "\\edb3";\n}\n.ri-ghost-fill:before { content: "\\edb4";\n}\n.ri-ghost-line:before { content: "\\edb5";\n}\n.ri-ghost-smile-fill:before { content: "\\edb6";\n}\n.ri-ghost-smile-line:before { content: "\\edb7";\n}\n.ri-gift-2-fill:before { content: "\\edb8";\n}\n.ri-gift-2-line:before { content: "\\edb9";\n}\n.ri-gift-fill:before { content: "\\edba";\n}\n.ri-gift-line:before { content: "\\edbb";\n}\n.ri-git-branch-fill:before { content: "\\edbc";\n}\n.ri-git-branch-line:before { content: "\\edbd";\n}\n.ri-git-commit-fill:before { content: "\\edbe";\n}\n.ri-git-commit-line:before { content: "\\edbf";\n}\n.ri-git-merge-fill:before { content: "\\edc0";\n}\n.ri-git-merge-line:before { content: "\\edc1";\n}\n.ri-git-pull-request-fill:before { content: "\\edc2";\n}\n.ri-git-pull-request-line:before { content: "\\edc3";\n}\n.ri-git-repository-commits-fill:before { content: "\\edc4";\n}\n.ri-git-repository-commits-line:before { content: "\\edc5";\n}\n.ri-git-repository-fill:before { content: "\\edc6";\n}\n.ri-git-repository-line:before { content: "\\edc7";\n}\n.ri-git-repository-private-fill:before { content: "\\edc8";\n}\n.ri-git-repository-private-line:before { content: "\\edc9";\n}\n.ri-github-fill:before { content: "\\edca";\n}\n.ri-github-line:before { content: "\\edcb";\n}\n.ri-gitlab-fill:before { content: "\\edcc";\n}\n.ri-gitlab-line:before { content: "\\edcd";\n}\n.ri-global-fill:before { content: "\\edce";\n}\n.ri-global-line:before { content: "\\edcf";\n}\n.ri-globe-fill:before { content: "\\edd0";\n}\n.ri-globe-line:before { content: "\\edd1";\n}\n.ri-goblet-fill:before { content: "\\edd2";\n}\n.ri-goblet-line:before { content: "\\edd3";\n}\n.ri-google-fill:before { content: "\\edd4";\n}\n.ri-google-line:before { content: "\\edd5";\n}\n.ri-google-play-fill:before { content: "\\edd6";\n}\n.ri-google-play-line:before { content: "\\edd7";\n}\n.ri-government-fill:before { content: "\\edd8";\n}\n.ri-government-line:before { content: "\\edd9";\n}\n.ri-gps-fill:before { content: "\\edda";\n}\n.ri-gps-line:before { content: "\\eddb";\n}\n.ri-gradienter-fill:before { content: "\\eddc";\n}\n.ri-gradienter-line:before { content: "\\eddd";\n}\n.ri-grid-fill:before { content: "\\edde";\n}\n.ri-grid-line:before { content: "\\eddf";\n}\n.ri-group-2-fill:before { content: "\\ede0";\n}\n.ri-group-2-line:before { content: "\\ede1";\n}\n.ri-group-fill:before { content: "\\ede2";\n}\n.ri-group-line:before { content: "\\ede3";\n}\n.ri-guide-fill:before { content: "\\ede4";\n}\n.ri-guide-line:before { content: "\\ede5";\n}\n.ri-h-1:before { content: "\\ede6";\n}\n.ri-h-2:before { content: "\\ede7";\n}\n.ri-h-3:before { content: "\\ede8";\n}\n.ri-h-4:before { content: "\\ede9";\n}\n.ri-h-5:before { content: "\\edea";\n}\n.ri-h-6:before { content: "\\edeb";\n}\n.ri-hail-fill:before { content: "\\edec";\n}\n.ri-hail-line:before { content: "\\eded";\n}\n.ri-hammer-fill:before { content: "\\edee";\n}\n.ri-hammer-line:before { content: "\\edef";\n}\n.ri-hand-coin-fill:before { content: "\\edf0";\n}\n.ri-hand-coin-line:before { content: "\\edf1";\n}\n.ri-hand-heart-fill:before { content: "\\edf2";\n}\n.ri-hand-heart-line:before { content: "\\edf3";\n}\n.ri-hand-sanitizer-fill:before { content: "\\edf4";\n}\n.ri-hand-sanitizer-line:before { content: "\\edf5";\n}\n.ri-handbag-fill:before { content: "\\edf6";\n}\n.ri-handbag-line:before { content: "\\edf7";\n}\n.ri-hard-drive-2-fill:before { content: "\\edf8";\n}\n.ri-hard-drive-2-line:before { content: "\\edf9";\n}\n.ri-hard-drive-fill:before { content: "\\edfa";\n}\n.ri-hard-drive-line:before { content: "\\edfb";\n}\n.ri-hashtag:before { content: "\\edfc";\n}\n.ri-haze-2-fill:before { content: "\\edfd";\n}\n.ri-haze-2-line:before { content: "\\edfe";\n}\n.ri-haze-fill:before { content: "\\edff";\n}\n.ri-haze-line:before { content: "\\ee00";\n}\n.ri-hd-fill:before { content: "\\ee01";\n}\n.ri-hd-line:before { content: "\\ee02";\n}\n.ri-heading:before { content: "\\ee03";\n}\n.ri-headphone-fill:before { content: "\\ee04";\n}\n.ri-headphone-line:before { content: "\\ee05";\n}\n.ri-health-book-fill:before { content: "\\ee06";\n}\n.ri-health-book-line:before { content: "\\ee07";\n}\n.ri-heart-2-fill:before { content: "\\ee08";\n}\n.ri-heart-2-line:before { content: "\\ee09";\n}\n.ri-heart-3-fill:before { content: "\\ee0a";\n}\n.ri-heart-3-line:before { content: "\\ee0b";\n}\n.ri-heart-add-fill:before { content: "\\ee0c";\n}\n.ri-heart-add-line:before { content: "\\ee0d";\n}\n.ri-heart-fill:before { content: "\\ee0e";\n}\n.ri-heart-line:before { content: "\\ee0f";\n}\n.ri-heart-pulse-fill:before { content: "\\ee10";\n}\n.ri-heart-pulse-line:before { content: "\\ee11";\n}\n.ri-hearts-fill:before { content: "\\ee12";\n}\n.ri-hearts-line:before { content: "\\ee13";\n}\n.ri-heavy-showers-fill:before { content: "\\ee14";\n}\n.ri-heavy-showers-line:before { content: "\\ee15";\n}\n.ri-history-fill:before { content: "\\ee16";\n}\n.ri-history-line:before { content: "\\ee17";\n}\n.ri-home-2-fill:before { content: "\\ee18";\n}\n.ri-home-2-line:before { content: "\\ee19";\n}\n.ri-home-3-fill:before { content: "\\ee1a";\n}\n.ri-home-3-line:before { content: "\\ee1b";\n}\n.ri-home-4-fill:before { content: "\\ee1c";\n}\n.ri-home-4-line:before { content: "\\ee1d";\n}\n.ri-home-5-fill:before { content: "\\ee1e";\n}\n.ri-home-5-line:before { content: "\\ee1f";\n}\n.ri-home-6-fill:before { content: "\\ee20";\n}\n.ri-home-6-line:before { content: "\\ee21";\n}\n.ri-home-7-fill:before { content: "\\ee22";\n}\n.ri-home-7-line:before { content: "\\ee23";\n}\n.ri-home-8-fill:before { content: "\\ee24";\n}\n.ri-home-8-line:before { content: "\\ee25";\n}\n.ri-home-fill:before { content: "\\ee26";\n}\n.ri-home-gear-fill:before { content: "\\ee27";\n}\n.ri-home-gear-line:before { content: "\\ee28";\n}\n.ri-home-heart-fill:before { content: "\\ee29";\n}\n.ri-home-heart-line:before { content: "\\ee2a";\n}\n.ri-home-line:before { content: "\\ee2b";\n}\n.ri-home-smile-2-fill:before { content: "\\ee2c";\n}\n.ri-home-smile-2-line:before { content: "\\ee2d";\n}\n.ri-home-smile-fill:before { content: "\\ee2e";\n}\n.ri-home-smile-line:before { content: "\\ee2f";\n}\n.ri-home-wifi-fill:before { content: "\\ee30";\n}\n.ri-home-wifi-line:before { content: "\\ee31";\n}\n.ri-honor-of-kings-fill:before { content: "\\ee32";\n}\n.ri-honor-of-kings-line:before { content: "\\ee33";\n}\n.ri-honour-fill:before { content: "\\ee34";\n}\n.ri-honour-line:before { content: "\\ee35";\n}\n.ri-hospital-fill:before { content: "\\ee36";\n}\n.ri-hospital-line:before { content: "\\ee37";\n}\n.ri-hotel-bed-fill:before { content: "\\ee38";\n}\n.ri-hotel-bed-line:before { content: "\\ee39";\n}\n.ri-hotel-fill:before { content: "\\ee3a";\n}\n.ri-hotel-line:before { content: "\\ee3b";\n}\n.ri-hotspot-fill:before { content: "\\ee3c";\n}\n.ri-hotspot-line:before { content: "\\ee3d";\n}\n.ri-hq-fill:before { content: "\\ee3e";\n}\n.ri-hq-line:before { content: "\\ee3f";\n}\n.ri-html5-fill:before { content: "\\ee40";\n}\n.ri-html5-line:before { content: "\\ee41";\n}\n.ri-ie-fill:before { content: "\\ee42";\n}\n.ri-ie-line:before { content: "\\ee43";\n}\n.ri-image-2-fill:before { content: "\\ee44";\n}\n.ri-image-2-line:before { content: "\\ee45";\n}\n.ri-image-add-fill:before { content: "\\ee46";\n}\n.ri-image-add-line:before { content: "\\ee47";\n}\n.ri-image-edit-fill:before { content: "\\ee48";\n}\n.ri-image-edit-line:before { content: "\\ee49";\n}\n.ri-image-fill:before { content: "\\ee4a";\n}\n.ri-image-line:before { content: "\\ee4b";\n}\n.ri-inbox-archive-fill:before { content: "\\ee4c";\n}\n.ri-inbox-archive-line:before { content: "\\ee4d";\n}\n.ri-inbox-fill:before { content: "\\ee4e";\n}\n.ri-inbox-line:before { content: "\\ee4f";\n}\n.ri-inbox-unarchive-fill:before { content: "\\ee50";\n}\n.ri-inbox-unarchive-line:before { content: "\\ee51";\n}\n.ri-increase-decrease-fill:before { content: "\\ee52";\n}\n.ri-increase-decrease-line:before { content: "\\ee53";\n}\n.ri-indent-decrease:before { content: "\\ee54";\n}\n.ri-indent-increase:before { content: "\\ee55";\n}\n.ri-indeterminate-circle-fill:before { content: "\\ee56";\n}\n.ri-indeterminate-circle-line:before { content: "\\ee57";\n}\n.ri-information-fill:before { content: "\\ee58";\n}\n.ri-information-line:before { content: "\\ee59";\n}\n.ri-infrared-thermometer-fill:before { content: "\\ee5a";\n}\n.ri-infrared-thermometer-line:before { content: "\\ee5b";\n}\n.ri-ink-bottle-fill:before { content: "\\ee5c";\n}\n.ri-ink-bottle-line:before { content: "\\ee5d";\n}\n.ri-input-cursor-move:before { content: "\\ee5e";\n}\n.ri-input-method-fill:before { content: "\\ee5f";\n}\n.ri-input-method-line:before { content: "\\ee60";\n}\n.ri-insert-column-left:before { content: "\\ee61";\n}\n.ri-insert-column-right:before { content: "\\ee62";\n}\n.ri-insert-row-bottom:before { content: "\\ee63";\n}\n.ri-insert-row-top:before { content: "\\ee64";\n}\n.ri-instagram-fill:before { content: "\\ee65";\n}\n.ri-instagram-line:before { content: "\\ee66";\n}\n.ri-install-fill:before { content: "\\ee67";\n}\n.ri-install-line:before { content: "\\ee68";\n}\n.ri-invision-fill:before { content: "\\ee69";\n}\n.ri-invision-line:before { content: "\\ee6a";\n}\n.ri-italic:before { content: "\\ee6b";\n}\n.ri-kakao-talk-fill:before { content: "\\ee6c";\n}\n.ri-kakao-talk-line:before { content: "\\ee6d";\n}\n.ri-key-2-fill:before { content: "\\ee6e";\n}\n.ri-key-2-line:before { content: "\\ee6f";\n}\n.ri-key-fill:before { content: "\\ee70";\n}\n.ri-key-line:before { content: "\\ee71";\n}\n.ri-keyboard-box-fill:before { content: "\\ee72";\n}\n.ri-keyboard-box-line:before { content: "\\ee73";\n}\n.ri-keyboard-fill:before { content: "\\ee74";\n}\n.ri-keyboard-line:before { content: "\\ee75";\n}\n.ri-keynote-fill:before { content: "\\ee76";\n}\n.ri-keynote-line:before { content: "\\ee77";\n}\n.ri-knife-blood-fill:before { content: "\\ee78";\n}\n.ri-knife-blood-line:before { content: "\\ee79";\n}\n.ri-knife-fill:before { content: "\\ee7a";\n}\n.ri-knife-line:before { content: "\\ee7b";\n}\n.ri-landscape-fill:before { content: "\\ee7c";\n}\n.ri-landscape-line:before { content: "\\ee7d";\n}\n.ri-layout-2-fill:before { content: "\\ee7e";\n}\n.ri-layout-2-line:before { content: "\\ee7f";\n}\n.ri-layout-3-fill:before { content: "\\ee80";\n}\n.ri-layout-3-line:before { content: "\\ee81";\n}\n.ri-layout-4-fill:before { content: "\\ee82";\n}\n.ri-layout-4-line:before { content: "\\ee83";\n}\n.ri-layout-5-fill:before { content: "\\ee84";\n}\n.ri-layout-5-line:before { content: "\\ee85";\n}\n.ri-layout-6-fill:before { content: "\\ee86";\n}\n.ri-layout-6-line:before { content: "\\ee87";\n}\n.ri-layout-bottom-2-fill:before { content: "\\ee88";\n}\n.ri-layout-bottom-2-line:before { content: "\\ee89";\n}\n.ri-layout-bottom-fill:before { content: "\\ee8a";\n}\n.ri-layout-bottom-line:before { content: "\\ee8b";\n}\n.ri-layout-column-fill:before { content: "\\ee8c";\n}\n.ri-layout-column-line:before { content: "\\ee8d";\n}\n.ri-layout-fill:before { content: "\\ee8e";\n}\n.ri-layout-grid-fill:before { content: "\\ee8f";\n}\n.ri-layout-grid-line:before { content: "\\ee90";\n}\n.ri-layout-left-2-fill:before { content: "\\ee91";\n}\n.ri-layout-left-2-line:before { content: "\\ee92";\n}\n.ri-layout-left-fill:before { content: "\\ee93";\n}\n.ri-layout-left-line:before { content: "\\ee94";\n}\n.ri-layout-line:before { content: "\\ee95";\n}\n.ri-layout-masonry-fill:before { content: "\\ee96";\n}\n.ri-layout-masonry-line:before { content: "\\ee97";\n}\n.ri-layout-right-2-fill:before { content: "\\ee98";\n}\n.ri-layout-right-2-line:before { content: "\\ee99";\n}\n.ri-layout-right-fill:before { content: "\\ee9a";\n}\n.ri-layout-right-line:before { content: "\\ee9b";\n}\n.ri-layout-row-fill:before { content: "\\ee9c";\n}\n.ri-layout-row-line:before { content: "\\ee9d";\n}\n.ri-layout-top-2-fill:before { content: "\\ee9e";\n}\n.ri-layout-top-2-line:before { content: "\\ee9f";\n}\n.ri-layout-top-fill:before { content: "\\eea0";\n}\n.ri-layout-top-line:before { content: "\\eea1";\n}\n.ri-leaf-fill:before { content: "\\eea2";\n}\n.ri-leaf-line:before { content: "\\eea3";\n}\n.ri-lifebuoy-fill:before { content: "\\eea4";\n}\n.ri-lifebuoy-line:before { content: "\\eea5";\n}\n.ri-lightbulb-fill:before { content: "\\eea6";\n}\n.ri-lightbulb-flash-fill:before { content: "\\eea7";\n}\n.ri-lightbulb-flash-line:before { content: "\\eea8";\n}\n.ri-lightbulb-line:before { content: "\\eea9";\n}\n.ri-line-chart-fill:before { content: "\\eeaa";\n}\n.ri-line-chart-line:before { content: "\\eeab";\n}\n.ri-line-fill:before { content: "\\eeac";\n}\n.ri-line-height:before { content: "\\eead";\n}\n.ri-line-line:before { content: "\\eeae";\n}\n.ri-link-m:before { content: "\\eeaf";\n}\n.ri-link-unlink-m:before { content: "\\eeb0";\n}\n.ri-link-unlink:before { content: "\\eeb1";\n}\n.ri-link:before { content: "\\eeb2";\n}\n.ri-linkedin-box-fill:before { content: "\\eeb3";\n}\n.ri-linkedin-box-line:before { content: "\\eeb4";\n}\n.ri-linkedin-fill:before { content: "\\eeb5";\n}\n.ri-linkedin-line:before { content: "\\eeb6";\n}\n.ri-links-fill:before { content: "\\eeb7";\n}\n.ri-links-line:before { content: "\\eeb8";\n}\n.ri-list-check-2:before { content: "\\eeb9";\n}\n.ri-list-check:before { content: "\\eeba";\n}\n.ri-list-ordered:before { content: "\\eebb";\n}\n.ri-list-settings-fill:before { content: "\\eebc";\n}\n.ri-list-settings-line:before { content: "\\eebd";\n}\n.ri-list-unordered:before { content: "\\eebe";\n}\n.ri-live-fill:before { content: "\\eebf";\n}\n.ri-live-line:before { content: "\\eec0";\n}\n.ri-loader-2-fill:before { content: "\\eec1";\n}\n.ri-loader-2-line:before { content: "\\eec2";\n}\n.ri-loader-3-fill:before { content: "\\eec3";\n}\n.ri-loader-3-line:before { content: "\\eec4";\n}\n.ri-loader-4-fill:before { content: "\\eec5";\n}\n.ri-loader-4-line:before { content: "\\eec6";\n}\n.ri-loader-5-fill:before { content: "\\eec7";\n}\n.ri-loader-5-line:before { content: "\\eec8";\n}\n.ri-loader-fill:before { content: "\\eec9";\n}\n.ri-loader-line:before { content: "\\eeca";\n}\n.ri-lock-2-fill:before { content: "\\eecb";\n}\n.ri-lock-2-line:before { content: "\\eecc";\n}\n.ri-lock-fill:before { content: "\\eecd";\n}\n.ri-lock-line:before { content: "\\eece";\n}\n.ri-lock-password-fill:before { content: "\\eecf";\n}\n.ri-lock-password-line:before { content: "\\eed0";\n}\n.ri-lock-unlock-fill:before { content: "\\eed1";\n}\n.ri-lock-unlock-line:before { content: "\\eed2";\n}\n.ri-login-box-fill:before { content: "\\eed3";\n}\n.ri-login-box-line:before { content: "\\eed4";\n}\n.ri-login-circle-fill:before { content: "\\eed5";\n}\n.ri-login-circle-line:before { content: "\\eed6";\n}\n.ri-logout-box-fill:before { content: "\\eed7";\n}\n.ri-logout-box-line:before { content: "\\eed8";\n}\n.ri-logout-box-r-fill:before { content: "\\eed9";\n}\n.ri-logout-box-r-line:before { content: "\\eeda";\n}\n.ri-logout-circle-fill:before { content: "\\eedb";\n}\n.ri-logout-circle-line:before { content: "\\eedc";\n}\n.ri-logout-circle-r-fill:before { content: "\\eedd";\n}\n.ri-logout-circle-r-line:before { content: "\\eede";\n}\n.ri-luggage-cart-fill:before { content: "\\eedf";\n}\n.ri-luggage-cart-line:before { content: "\\eee0";\n}\n.ri-luggage-deposit-fill:before { content: "\\eee1";\n}\n.ri-luggage-deposit-line:before { content: "\\eee2";\n}\n.ri-lungs-fill:before { content: "\\eee3";\n}\n.ri-lungs-line:before { content: "\\eee4";\n}\n.ri-mac-fill:before { content: "\\eee5";\n}\n.ri-mac-line:before { content: "\\eee6";\n}\n.ri-macbook-fill:before { content: "\\eee7";\n}\n.ri-macbook-line:before { content: "\\eee8";\n}\n.ri-magic-fill:before { content: "\\eee9";\n}\n.ri-magic-line:before { content: "\\eeea";\n}\n.ri-mail-add-fill:before { content: "\\eeeb";\n}\n.ri-mail-add-line:before { content: "\\eeec";\n}\n.ri-mail-check-fill:before { content: "\\eeed";\n}\n.ri-mail-check-line:before { content: "\\eeee";\n}\n.ri-mail-close-fill:before { content: "\\eeef";\n}\n.ri-mail-close-line:before { content: "\\eef0";\n}\n.ri-mail-download-fill:before { content: "\\eef1";\n}\n.ri-mail-download-line:before { content: "\\eef2";\n}\n.ri-mail-fill:before { content: "\\eef3";\n}\n.ri-mail-forbid-fill:before { content: "\\eef4";\n}\n.ri-mail-forbid-line:before { content: "\\eef5";\n}\n.ri-mail-line:before { content: "\\eef6";\n}\n.ri-mail-lock-fill:before { content: "\\eef7";\n}\n.ri-mail-lock-line:before { content: "\\eef8";\n}\n.ri-mail-open-fill:before { content: "\\eef9";\n}\n.ri-mail-open-line:before { content: "\\eefa";\n}\n.ri-mail-send-fill:before { content: "\\eefb";\n}\n.ri-mail-send-line:before { content: "\\eefc";\n}\n.ri-mail-settings-fill:before { content: "\\eefd";\n}\n.ri-mail-settings-line:before { content: "\\eefe";\n}\n.ri-mail-star-fill:before { content: "\\eeff";\n}\n.ri-mail-star-line:before { content: "\\ef00";\n}\n.ri-mail-unread-fill:before { content: "\\ef01";\n}\n.ri-mail-unread-line:before { content: "\\ef02";\n}\n.ri-mail-volume-fill:before { content: "\\ef03";\n}\n.ri-mail-volume-line:before { content: "\\ef04";\n}\n.ri-map-2-fill:before { content: "\\ef05";\n}\n.ri-map-2-line:before { content: "\\ef06";\n}\n.ri-map-fill:before { content: "\\ef07";\n}\n.ri-map-line:before { content: "\\ef08";\n}\n.ri-map-pin-2-fill:before { content: "\\ef09";\n}\n.ri-map-pin-2-line:before { content: "\\ef0a";\n}\n.ri-map-pin-3-fill:before { content: "\\ef0b";\n}\n.ri-map-pin-3-line:before { content: "\\ef0c";\n}\n.ri-map-pin-4-fill:before { content: "\\ef0d";\n}\n.ri-map-pin-4-line:before { content: "\\ef0e";\n}\n.ri-map-pin-5-fill:before { content: "\\ef0f";\n}\n.ri-map-pin-5-line:before { content: "\\ef10";\n}\n.ri-map-pin-add-fill:before { content: "\\ef11";\n}\n.ri-map-pin-add-line:before { content: "\\ef12";\n}\n.ri-map-pin-fill:before { content: "\\ef13";\n}\n.ri-map-pin-line:before { content: "\\ef14";\n}\n.ri-map-pin-range-fill:before { content: "\\ef15";\n}\n.ri-map-pin-range-line:before { content: "\\ef16";\n}\n.ri-map-pin-time-fill:before { content: "\\ef17";\n}\n.ri-map-pin-time-line:before { content: "\\ef18";\n}\n.ri-map-pin-user-fill:before { content: "\\ef19";\n}\n.ri-map-pin-user-line:before { content: "\\ef1a";\n}\n.ri-mark-pen-fill:before { content: "\\ef1b";\n}\n.ri-mark-pen-line:before { content: "\\ef1c";\n}\n.ri-markdown-fill:before { content: "\\ef1d";\n}\n.ri-markdown-line:before { content: "\\ef1e";\n}\n.ri-markup-fill:before { content: "\\ef1f";\n}\n.ri-markup-line:before { content: "\\ef20";\n}\n.ri-mastercard-fill:before { content: "\\ef21";\n}\n.ri-mastercard-line:before { content: "\\ef22";\n}\n.ri-mastodon-fill:before { content: "\\ef23";\n}\n.ri-mastodon-line:before { content: "\\ef24";\n}\n.ri-medal-2-fill:before { content: "\\ef25";\n}\n.ri-medal-2-line:before { content: "\\ef26";\n}\n.ri-medal-fill:before { content: "\\ef27";\n}\n.ri-medal-line:before { content: "\\ef28";\n}\n.ri-medicine-bottle-fill:before { content: "\\ef29";\n}\n.ri-medicine-bottle-line:before { content: "\\ef2a";\n}\n.ri-medium-fill:before { content: "\\ef2b";\n}\n.ri-medium-line:before { content: "\\ef2c";\n}\n.ri-men-fill:before { content: "\\ef2d";\n}\n.ri-men-line:before { content: "\\ef2e";\n}\n.ri-mental-health-fill:before { content: "\\ef2f";\n}\n.ri-mental-health-line:before { content: "\\ef30";\n}\n.ri-menu-2-fill:before { content: "\\ef31";\n}\n.ri-menu-2-line:before { content: "\\ef32";\n}\n.ri-menu-3-fill:before { content: "\\ef33";\n}\n.ri-menu-3-line:before { content: "\\ef34";\n}\n.ri-menu-4-fill:before { content: "\\ef35";\n}\n.ri-menu-4-line:before { content: "\\ef36";\n}\n.ri-menu-5-fill:before { content: "\\ef37";\n}\n.ri-menu-5-line:before { content: "\\ef38";\n}\n.ri-menu-add-fill:before { content: "\\ef39";\n}\n.ri-menu-add-line:before { content: "\\ef3a";\n}\n.ri-menu-fill:before { content: "\\ef3b";\n}\n.ri-menu-fold-fill:before { content: "\\ef3c";\n}\n.ri-menu-fold-line:before { content: "\\ef3d";\n}\n.ri-menu-line:before { content: "\\ef3e";\n}\n.ri-menu-unfold-fill:before { content: "\\ef3f";\n}\n.ri-menu-unfold-line:before { content: "\\ef40";\n}\n.ri-merge-cells-horizontal:before { content: "\\ef41";\n}\n.ri-merge-cells-vertical:before { content: "\\ef42";\n}\n.ri-message-2-fill:before { content: "\\ef43";\n}\n.ri-message-2-line:before { content: "\\ef44";\n}\n.ri-message-3-fill:before { content: "\\ef45";\n}\n.ri-message-3-line:before { content: "\\ef46";\n}\n.ri-message-fill:before { content: "\\ef47";\n}\n.ri-message-line:before { content: "\\ef48";\n}\n.ri-messenger-fill:before { content: "\\ef49";\n}\n.ri-messenger-line:before { content: "\\ef4a";\n}\n.ri-meteor-fill:before { content: "\\ef4b";\n}\n.ri-meteor-line:before { content: "\\ef4c";\n}\n.ri-mic-2-fill:before { content: "\\ef4d";\n}\n.ri-mic-2-line:before { content: "\\ef4e";\n}\n.ri-mic-fill:before { content: "\\ef4f";\n}\n.ri-mic-line:before { content: "\\ef50";\n}\n.ri-mic-off-fill:before { content: "\\ef51";\n}\n.ri-mic-off-line:before { content: "\\ef52";\n}\n.ri-mickey-fill:before { content: "\\ef53";\n}\n.ri-mickey-line:before { content: "\\ef54";\n}\n.ri-microscope-fill:before { content: "\\ef55";\n}\n.ri-microscope-line:before { content: "\\ef56";\n}\n.ri-microsoft-fill:before { content: "\\ef57";\n}\n.ri-microsoft-line:before { content: "\\ef58";\n}\n.ri-mind-map:before { content: "\\ef59";\n}\n.ri-mini-program-fill:before { content: "\\ef5a";\n}\n.ri-mini-program-line:before { content: "\\ef5b";\n}\n.ri-mist-fill:before { content: "\\ef5c";\n}\n.ri-mist-line:before { content: "\\ef5d";\n}\n.ri-money-cny-box-fill:before { content: "\\ef5e";\n}\n.ri-money-cny-box-line:before { content: "\\ef5f";\n}\n.ri-money-cny-circle-fill:before { content: "\\ef60";\n}\n.ri-money-cny-circle-line:before { content: "\\ef61";\n}\n.ri-money-dollar-box-fill:before { content: "\\ef62";\n}\n.ri-money-dollar-box-line:before { content: "\\ef63";\n}\n.ri-money-dollar-circle-fill:before { content: "\\ef64";\n}\n.ri-money-dollar-circle-line:before { content: "\\ef65";\n}\n.ri-money-euro-box-fill:before { content: "\\ef66";\n}\n.ri-money-euro-box-line:before { content: "\\ef67";\n}\n.ri-money-euro-circle-fill:before { content: "\\ef68";\n}\n.ri-money-euro-circle-line:before { content: "\\ef69";\n}\n.ri-money-pound-box-fill:before { content: "\\ef6a";\n}\n.ri-money-pound-box-line:before { content: "\\ef6b";\n}\n.ri-money-pound-circle-fill:before { content: "\\ef6c";\n}\n.ri-money-pound-circle-line:before { content: "\\ef6d";\n}\n.ri-moon-clear-fill:before { content: "\\ef6e";\n}\n.ri-moon-clear-line:before { content: "\\ef6f";\n}\n.ri-moon-cloudy-fill:before { content: "\\ef70";\n}\n.ri-moon-cloudy-line:before { content: "\\ef71";\n}\n.ri-moon-fill:before { content: "\\ef72";\n}\n.ri-moon-foggy-fill:before { content: "\\ef73";\n}\n.ri-moon-foggy-line:before { content: "\\ef74";\n}\n.ri-moon-line:before { content: "\\ef75";\n}\n.ri-more-2-fill:before { content: "\\ef76";\n}\n.ri-more-2-line:before { content: "\\ef77";\n}\n.ri-more-fill:before { content: "\\ef78";\n}\n.ri-more-line:before { content: "\\ef79";\n}\n.ri-motorbike-fill:before { content: "\\ef7a";\n}\n.ri-motorbike-line:before { content: "\\ef7b";\n}\n.ri-mouse-fill:before { content: "\\ef7c";\n}\n.ri-mouse-line:before { content: "\\ef7d";\n}\n.ri-movie-2-fill:before { content: "\\ef7e";\n}\n.ri-movie-2-line:before { content: "\\ef7f";\n}\n.ri-movie-fill:before { content: "\\ef80";\n}\n.ri-movie-line:before { content: "\\ef81";\n}\n.ri-music-2-fill:before { content: "\\ef82";\n}\n.ri-music-2-line:before { content: "\\ef83";\n}\n.ri-music-fill:before { content: "\\ef84";\n}\n.ri-music-line:before { content: "\\ef85";\n}\n.ri-mv-fill:before { content: "\\ef86";\n}\n.ri-mv-line:before { content: "\\ef87";\n}\n.ri-navigation-fill:before { content: "\\ef88";\n}\n.ri-navigation-line:before { content: "\\ef89";\n}\n.ri-netease-cloud-music-fill:before { content: "\\ef8a";\n}\n.ri-netease-cloud-music-line:before { content: "\\ef8b";\n}\n.ri-netflix-fill:before { content: "\\ef8c";\n}\n.ri-netflix-line:before { content: "\\ef8d";\n}\n.ri-newspaper-fill:before { content: "\\ef8e";\n}\n.ri-newspaper-line:before { content: "\\ef8f";\n}\n.ri-node-tree:before { content: "\\ef90";\n}\n.ri-notification-2-fill:before { content: "\\ef91";\n}\n.ri-notification-2-line:before { content: "\\ef92";\n}\n.ri-notification-3-fill:before { content: "\\ef93";\n}\n.ri-notification-3-line:before { content: "\\ef94";\n}\n.ri-notification-4-fill:before { content: "\\ef95";\n}\n.ri-notification-4-line:before { content: "\\ef96";\n}\n.ri-notification-badge-fill:before { content: "\\ef97";\n}\n.ri-notification-badge-line:before { content: "\\ef98";\n}\n.ri-notification-fill:before { content: "\\ef99";\n}\n.ri-notification-line:before { content: "\\ef9a";\n}\n.ri-notification-off-fill:before { content: "\\ef9b";\n}\n.ri-notification-off-line:before { content: "\\ef9c";\n}\n.ri-npmjs-fill:before { content: "\\ef9d";\n}\n.ri-npmjs-line:before { content: "\\ef9e";\n}\n.ri-number-0:before { content: "\\ef9f";\n}\n.ri-number-1:before { content: "\\efa0";\n}\n.ri-number-2:before { content: "\\efa1";\n}\n.ri-number-3:before { content: "\\efa2";\n}\n.ri-number-4:before { content: "\\efa3";\n}\n.ri-number-5:before { content: "\\efa4";\n}\n.ri-number-6:before { content: "\\efa5";\n}\n.ri-number-7:before { content: "\\efa6";\n}\n.ri-number-8:before { content: "\\efa7";\n}\n.ri-number-9:before { content: "\\efa8";\n}\n.ri-numbers-fill:before { content: "\\efa9";\n}\n.ri-numbers-line:before { content: "\\efaa";\n}\n.ri-nurse-fill:before { content: "\\efab";\n}\n.ri-nurse-line:before { content: "\\efac";\n}\n.ri-oil-fill:before { content: "\\efad";\n}\n.ri-oil-line:before { content: "\\efae";\n}\n.ri-omega:before { content: "\\efaf";\n}\n.ri-open-arm-fill:before { content: "\\efb0";\n}\n.ri-open-arm-line:before { content: "\\efb1";\n}\n.ri-open-source-fill:before { content: "\\efb2";\n}\n.ri-open-source-line:before { content: "\\efb3";\n}\n.ri-opera-fill:before { content: "\\efb4";\n}\n.ri-opera-line:before { content: "\\efb5";\n}\n.ri-order-play-fill:before { content: "\\efb6";\n}\n.ri-order-play-line:before { content: "\\efb7";\n}\n.ri-organization-chart:before { content: "\\efb8";\n}\n.ri-outlet-2-fill:before { content: "\\efb9";\n}\n.ri-outlet-2-line:before { content: "\\efba";\n}\n.ri-outlet-fill:before { content: "\\efbb";\n}\n.ri-outlet-line:before { content: "\\efbc";\n}\n.ri-page-separator:before { content: "\\efbd";\n}\n.ri-pages-fill:before { content: "\\efbe";\n}\n.ri-pages-line:before { content: "\\efbf";\n}\n.ri-paint-brush-fill:before { content: "\\efc0";\n}\n.ri-paint-brush-line:before { content: "\\efc1";\n}\n.ri-paint-fill:before { content: "\\efc2";\n}\n.ri-paint-line:before { content: "\\efc3";\n}\n.ri-palette-fill:before { content: "\\efc4";\n}\n.ri-palette-line:before { content: "\\efc5";\n}\n.ri-pantone-fill:before { content: "\\efc6";\n}\n.ri-pantone-line:before { content: "\\efc7";\n}\n.ri-paragraph:before { content: "\\efc8";\n}\n.ri-parent-fill:before { content: "\\efc9";\n}\n.ri-parent-line:before { content: "\\efca";\n}\n.ri-parentheses-fill:before { content: "\\efcb";\n}\n.ri-parentheses-line:before { content: "\\efcc";\n}\n.ri-parking-box-fill:before { content: "\\efcd";\n}\n.ri-parking-box-line:before { content: "\\efce";\n}\n.ri-parking-fill:before { content: "\\efcf";\n}\n.ri-parking-line:before { content: "\\efd0";\n}\n.ri-passport-fill:before { content: "\\efd1";\n}\n.ri-passport-line:before { content: "\\efd2";\n}\n.ri-patreon-fill:before { content: "\\efd3";\n}\n.ri-patreon-line:before { content: "\\efd4";\n}\n.ri-pause-circle-fill:before { content: "\\efd5";\n}\n.ri-pause-circle-line:before { content: "\\efd6";\n}\n.ri-pause-fill:before { content: "\\efd7";\n}\n.ri-pause-line:before { content: "\\efd8";\n}\n.ri-pause-mini-fill:before { content: "\\efd9";\n}\n.ri-pause-mini-line:before { content: "\\efda";\n}\n.ri-paypal-fill:before { content: "\\efdb";\n}\n.ri-paypal-line:before { content: "\\efdc";\n}\n.ri-pen-nib-fill:before { content: "\\efdd";\n}\n.ri-pen-nib-line:before { content: "\\efde";\n}\n.ri-pencil-fill:before { content: "\\efdf";\n}\n.ri-pencil-line:before { content: "\\efe0";\n}\n.ri-pencil-ruler-2-fill:before { content: "\\efe1";\n}\n.ri-pencil-ruler-2-line:before { content: "\\efe2";\n}\n.ri-pencil-ruler-fill:before { content: "\\efe3";\n}\n.ri-pencil-ruler-line:before { content: "\\efe4";\n}\n.ri-percent-fill:before { content: "\\efe5";\n}\n.ri-percent-line:before { content: "\\efe6";\n}\n.ri-phone-camera-fill:before { content: "\\efe7";\n}\n.ri-phone-camera-line:before { content: "\\efe8";\n}\n.ri-phone-fill:before { content: "\\efe9";\n}\n.ri-phone-find-fill:before { content: "\\efea";\n}\n.ri-phone-find-line:before { content: "\\efeb";\n}\n.ri-phone-line:before { content: "\\efec";\n}\n.ri-phone-lock-fill:before { content: "\\efed";\n}\n.ri-phone-lock-line:before { content: "\\efee";\n}\n.ri-picture-in-picture-2-fill:before { content: "\\efef";\n}\n.ri-picture-in-picture-2-line:before { content: "\\eff0";\n}\n.ri-picture-in-picture-exit-fill:before { content: "\\eff1";\n}\n.ri-picture-in-picture-exit-line:before { content: "\\eff2";\n}\n.ri-picture-in-picture-fill:before { content: "\\eff3";\n}\n.ri-picture-in-picture-line:before { content: "\\eff4";\n}\n.ri-pie-chart-2-fill:before { content: "\\eff5";\n}\n.ri-pie-chart-2-line:before { content: "\\eff6";\n}\n.ri-pie-chart-box-fill:before { content: "\\eff7";\n}\n.ri-pie-chart-box-line:before { content: "\\eff8";\n}\n.ri-pie-chart-fill:before { content: "\\eff9";\n}\n.ri-pie-chart-line:before { content: "\\effa";\n}\n.ri-pin-distance-fill:before { content: "\\effb";\n}\n.ri-pin-distance-line:before { content: "\\effc";\n}\n.ri-ping-pong-fill:before { content: "\\effd";\n}\n.ri-ping-pong-line:before { content: "\\effe";\n}\n.ri-pinterest-fill:before { content: "\\efff";\n}\n.ri-pinterest-line:before { content: "\\f000";\n}\n.ri-pinyin-input:before { content: "\\f001";\n}\n.ri-pixelfed-fill:before { content: "\\f002";\n}\n.ri-pixelfed-line:before { content: "\\f003";\n}\n.ri-plane-fill:before { content: "\\f004";\n}\n.ri-plane-line:before { content: "\\f005";\n}\n.ri-plant-fill:before { content: "\\f006";\n}\n.ri-plant-line:before { content: "\\f007";\n}\n.ri-play-circle-fill:before { content: "\\f008";\n}\n.ri-play-circle-line:before { content: "\\f009";\n}\n.ri-play-fill:before { content: "\\f00a";\n}\n.ri-play-line:before { content: "\\f00b";\n}\n.ri-play-list-2-fill:before { content: "\\f00c";\n}\n.ri-play-list-2-line:before { content: "\\f00d";\n}\n.ri-play-list-add-fill:before { content: "\\f00e";\n}\n.ri-play-list-add-line:before { content: "\\f00f";\n}\n.ri-play-list-fill:before { content: "\\f010";\n}\n.ri-play-list-line:before { content: "\\f011";\n}\n.ri-play-mini-fill:before { content: "\\f012";\n}\n.ri-play-mini-line:before { content: "\\f013";\n}\n.ri-playstation-fill:before { content: "\\f014";\n}\n.ri-playstation-line:before { content: "\\f015";\n}\n.ri-plug-2-fill:before { content: "\\f016";\n}\n.ri-plug-2-line:before { content: "\\f017";\n}\n.ri-plug-fill:before { content: "\\f018";\n}\n.ri-plug-line:before { content: "\\f019";\n}\n.ri-polaroid-2-fill:before { content: "\\f01a";\n}\n.ri-polaroid-2-line:before { content: "\\f01b";\n}\n.ri-polaroid-fill:before { content: "\\f01c";\n}\n.ri-polaroid-line:before { content: "\\f01d";\n}\n.ri-police-car-fill:before { content: "\\f01e";\n}\n.ri-police-car-line:before { content: "\\f01f";\n}\n.ri-price-tag-2-fill:before { content: "\\f020";\n}\n.ri-price-tag-2-line:before { content: "\\f021";\n}\n.ri-price-tag-3-fill:before { content: "\\f022";\n}\n.ri-price-tag-3-line:before { content: "\\f023";\n}\n.ri-price-tag-fill:before { content: "\\f024";\n}\n.ri-price-tag-line:before { content: "\\f025";\n}\n.ri-printer-cloud-fill:before { content: "\\f026";\n}\n.ri-printer-cloud-line:before { content: "\\f027";\n}\n.ri-printer-fill:before { content: "\\f028";\n}\n.ri-printer-line:before { content: "\\f029";\n}\n.ri-product-hunt-fill:before { content: "\\f02a";\n}\n.ri-product-hunt-line:before { content: "\\f02b";\n}\n.ri-profile-fill:before { content: "\\f02c";\n}\n.ri-profile-line:before { content: "\\f02d";\n}\n.ri-projector-2-fill:before { content: "\\f02e";\n}\n.ri-projector-2-line:before { content: "\\f02f";\n}\n.ri-projector-fill:before { content: "\\f030";\n}\n.ri-projector-line:before { content: "\\f031";\n}\n.ri-psychotherapy-fill:before { content: "\\f032";\n}\n.ri-psychotherapy-line:before { content: "\\f033";\n}\n.ri-pulse-fill:before { content: "\\f034";\n}\n.ri-pulse-line:before { content: "\\f035";\n}\n.ri-pushpin-2-fill:before { content: "\\f036";\n}\n.ri-pushpin-2-line:before { content: "\\f037";\n}\n.ri-pushpin-fill:before { content: "\\f038";\n}\n.ri-pushpin-line:before { content: "\\f039";\n}\n.ri-qq-fill:before { content: "\\f03a";\n}\n.ri-qq-line:before { content: "\\f03b";\n}\n.ri-qr-code-fill:before { content: "\\f03c";\n}\n.ri-qr-code-line:before { content: "\\f03d";\n}\n.ri-qr-scan-2-fill:before { content: "\\f03e";\n}\n.ri-qr-scan-2-line:before { content: "\\f03f";\n}\n.ri-qr-scan-fill:before { content: "\\f040";\n}\n.ri-qr-scan-line:before { content: "\\f041";\n}\n.ri-question-answer-fill:before { content: "\\f042";\n}\n.ri-question-answer-line:before { content: "\\f043";\n}\n.ri-question-fill:before { content: "\\f044";\n}\n.ri-question-line:before { content: "\\f045";\n}\n.ri-question-mark:before { content: "\\f046";\n}\n.ri-questionnaire-fill:before { content: "\\f047";\n}\n.ri-questionnaire-line:before { content: "\\f048";\n}\n.ri-quill-pen-fill:before { content: "\\f049";\n}\n.ri-quill-pen-line:before { content: "\\f04a";\n}\n.ri-radar-fill:before { content: "\\f04b";\n}\n.ri-radar-line:before { content: "\\f04c";\n}\n.ri-radio-2-fill:before { content: "\\f04d";\n}\n.ri-radio-2-line:before { content: "\\f04e";\n}\n.ri-radio-button-fill:before { content: "\\f04f";\n}\n.ri-radio-button-line:before { content: "\\f050";\n}\n.ri-radio-fill:before { content: "\\f051";\n}\n.ri-radio-line:before { content: "\\f052";\n}\n.ri-rainbow-fill:before { content: "\\f053";\n}\n.ri-rainbow-line:before { content: "\\f054";\n}\n.ri-rainy-fill:before { content: "\\f055";\n}\n.ri-rainy-line:before { content: "\\f056";\n}\n.ri-reactjs-fill:before { content: "\\f057";\n}\n.ri-reactjs-line:before { content: "\\f058";\n}\n.ri-record-circle-fill:before { content: "\\f059";\n}\n.ri-record-circle-line:before { content: "\\f05a";\n}\n.ri-record-mail-fill:before { content: "\\f05b";\n}\n.ri-record-mail-line:before { content: "\\f05c";\n}\n.ri-recycle-fill:before { content: "\\f05d";\n}\n.ri-recycle-line:before { content: "\\f05e";\n}\n.ri-red-packet-fill:before { content: "\\f05f";\n}\n.ri-red-packet-line:before { content: "\\f060";\n}\n.ri-reddit-fill:before { content: "\\f061";\n}\n.ri-reddit-line:before { content: "\\f062";\n}\n.ri-refresh-fill:before { content: "\\f063";\n}\n.ri-refresh-line:before { content: "\\f064";\n}\n.ri-refund-2-fill:before { content: "\\f065";\n}\n.ri-refund-2-line:before { content: "\\f066";\n}\n.ri-refund-fill:before { content: "\\f067";\n}\n.ri-refund-line:before { content: "\\f068";\n}\n.ri-registered-fill:before { content: "\\f069";\n}\n.ri-registered-line:before { content: "\\f06a";\n}\n.ri-remixicon-fill:before { content: "\\f06b";\n}\n.ri-remixicon-line:before { content: "\\f06c";\n}\n.ri-remote-control-2-fill:before { content: "\\f06d";\n}\n.ri-remote-control-2-line:before { content: "\\f06e";\n}\n.ri-remote-control-fill:before { content: "\\f06f";\n}\n.ri-remote-control-line:before { content: "\\f070";\n}\n.ri-repeat-2-fill:before { content: "\\f071";\n}\n.ri-repeat-2-line:before { content: "\\f072";\n}\n.ri-repeat-fill:before { content: "\\f073";\n}\n.ri-repeat-line:before { content: "\\f074";\n}\n.ri-repeat-one-fill:before { content: "\\f075";\n}\n.ri-repeat-one-line:before { content: "\\f076";\n}\n.ri-reply-all-fill:before { content: "\\f077";\n}\n.ri-reply-all-line:before { content: "\\f078";\n}\n.ri-reply-fill:before { content: "\\f079";\n}\n.ri-reply-line:before { content: "\\f07a";\n}\n.ri-reserved-fill:before { content: "\\f07b";\n}\n.ri-reserved-line:before { content: "\\f07c";\n}\n.ri-rest-time-fill:before { content: "\\f07d";\n}\n.ri-rest-time-line:before { content: "\\f07e";\n}\n.ri-restart-fill:before { content: "\\f07f";\n}\n.ri-restart-line:before { content: "\\f080";\n}\n.ri-restaurant-2-fill:before { content: "\\f081";\n}\n.ri-restaurant-2-line:before { content: "\\f082";\n}\n.ri-restaurant-fill:before { content: "\\f083";\n}\n.ri-restaurant-line:before { content: "\\f084";\n}\n.ri-rewind-fill:before { content: "\\f085";\n}\n.ri-rewind-line:before { content: "\\f086";\n}\n.ri-rewind-mini-fill:before { content: "\\f087";\n}\n.ri-rewind-mini-line:before { content: "\\f088";\n}\n.ri-rhythm-fill:before { content: "\\f089";\n}\n.ri-rhythm-line:before { content: "\\f08a";\n}\n.ri-riding-fill:before { content: "\\f08b";\n}\n.ri-riding-line:before { content: "\\f08c";\n}\n.ri-road-map-fill:before { content: "\\f08d";\n}\n.ri-road-map-line:before { content: "\\f08e";\n}\n.ri-roadster-fill:before { content: "\\f08f";\n}\n.ri-roadster-line:before { content: "\\f090";\n}\n.ri-robot-fill:before { content: "\\f091";\n}\n.ri-robot-line:before { content: "\\f092";\n}\n.ri-rocket-2-fill:before { content: "\\f093";\n}\n.ri-rocket-2-line:before { content: "\\f094";\n}\n.ri-rocket-fill:before { content: "\\f095";\n}\n.ri-rocket-line:before { content: "\\f096";\n}\n.ri-rotate-lock-fill:before { content: "\\f097";\n}\n.ri-rotate-lock-line:before { content: "\\f098";\n}\n.ri-rounded-corner:before { content: "\\f099";\n}\n.ri-route-fill:before { content: "\\f09a";\n}\n.ri-route-line:before { content: "\\f09b";\n}\n.ri-router-fill:before { content: "\\f09c";\n}\n.ri-router-line:before { content: "\\f09d";\n}\n.ri-rss-fill:before { content: "\\f09e";\n}\n.ri-rss-line:before { content: "\\f09f";\n}\n.ri-ruler-2-fill:before { content: "\\f0a0";\n}\n.ri-ruler-2-line:before { content: "\\f0a1";\n}\n.ri-ruler-fill:before { content: "\\f0a2";\n}\n.ri-ruler-line:before { content: "\\f0a3";\n}\n.ri-run-fill:before { content: "\\f0a4";\n}\n.ri-run-line:before { content: "\\f0a5";\n}\n.ri-safari-fill:before { content: "\\f0a6";\n}\n.ri-safari-line:before { content: "\\f0a7";\n}\n.ri-safe-2-fill:before { content: "\\f0a8";\n}\n.ri-safe-2-line:before { content: "\\f0a9";\n}\n.ri-safe-fill:before { content: "\\f0aa";\n}\n.ri-safe-line:before { content: "\\f0ab";\n}\n.ri-sailboat-fill:before { content: "\\f0ac";\n}\n.ri-sailboat-line:before { content: "\\f0ad";\n}\n.ri-save-2-fill:before { content: "\\f0ae";\n}\n.ri-save-2-line:before { content: "\\f0af";\n}\n.ri-save-3-fill:before { content: "\\f0b0";\n}\n.ri-save-3-line:before { content: "\\f0b1";\n}\n.ri-save-fill:before { content: "\\f0b2";\n}\n.ri-save-line:before { content: "\\f0b3";\n}\n.ri-scales-2-fill:before { content: "\\f0b4";\n}\n.ri-scales-2-line:before { content: "\\f0b5";\n}\n.ri-scales-3-fill:before { content: "\\f0b6";\n}\n.ri-scales-3-line:before { content: "\\f0b7";\n}\n.ri-scales-fill:before { content: "\\f0b8";\n}\n.ri-scales-line:before { content: "\\f0b9";\n}\n.ri-scan-2-fill:before { content: "\\f0ba";\n}\n.ri-scan-2-line:before { content: "\\f0bb";\n}\n.ri-scan-fill:before { content: "\\f0bc";\n}\n.ri-scan-line:before { content: "\\f0bd";\n}\n.ri-scissors-2-fill:before { content: "\\f0be";\n}\n.ri-scissors-2-line:before { content: "\\f0bf";\n}\n.ri-scissors-cut-fill:before { content: "\\f0c0";\n}\n.ri-scissors-cut-line:before { content: "\\f0c1";\n}\n.ri-scissors-fill:before { content: "\\f0c2";\n}\n.ri-scissors-line:before { content: "\\f0c3";\n}\n.ri-screenshot-2-fill:before { content: "\\f0c4";\n}\n.ri-screenshot-2-line:before { content: "\\f0c5";\n}\n.ri-screenshot-fill:before { content: "\\f0c6";\n}\n.ri-screenshot-line:before { content: "\\f0c7";\n}\n.ri-sd-card-fill:before { content: "\\f0c8";\n}\n.ri-sd-card-line:before { content: "\\f0c9";\n}\n.ri-sd-card-mini-fill:before { content: "\\f0ca";\n}\n.ri-sd-card-mini-line:before { content: "\\f0cb";\n}\n.ri-search-2-fill:before { content: "\\f0cc";\n}\n.ri-search-2-line:before { content: "\\f0cd";\n}\n.ri-search-eye-fill:before { content: "\\f0ce";\n}\n.ri-search-eye-line:before { content: "\\f0cf";\n}\n.ri-search-fill:before { content: "\\f0d0";\n}\n.ri-search-line:before { content: "\\f0d1";\n}\n.ri-secure-payment-fill:before { content: "\\f0d2";\n}\n.ri-secure-payment-line:before { content: "\\f0d3";\n}\n.ri-seedling-fill:before { content: "\\f0d4";\n}\n.ri-seedling-line:before { content: "\\f0d5";\n}\n.ri-send-backward:before { content: "\\f0d6";\n}\n.ri-send-plane-2-fill:before { content: "\\f0d7";\n}\n.ri-send-plane-2-line:before { content: "\\f0d8";\n}\n.ri-send-plane-fill:before { content: "\\f0d9";\n}\n.ri-send-plane-line:before { content: "\\f0da";\n}\n.ri-send-to-back:before { content: "\\f0db";\n}\n.ri-sensor-fill:before { content: "\\f0dc";\n}\n.ri-sensor-line:before { content: "\\f0dd";\n}\n.ri-separator:before { content: "\\f0de";\n}\n.ri-server-fill:before { content: "\\f0df";\n}\n.ri-server-line:before { content: "\\f0e0";\n}\n.ri-service-fill:before { content: "\\f0e1";\n}\n.ri-service-line:before { content: "\\f0e2";\n}\n.ri-settings-2-fill:before { content: "\\f0e3";\n}\n.ri-settings-2-line:before { content: "\\f0e4";\n}\n.ri-settings-3-fill:before { content: "\\f0e5";\n}\n.ri-settings-3-line:before { content: "\\f0e6";\n}\n.ri-settings-4-fill:before { content: "\\f0e7";\n}\n.ri-settings-4-line:before { content: "\\f0e8";\n}\n.ri-settings-5-fill:before { content: "\\f0e9";\n}\n.ri-settings-5-line:before { content: "\\f0ea";\n}\n.ri-settings-6-fill:before { content: "\\f0eb";\n}\n.ri-settings-6-line:before { content: "\\f0ec";\n}\n.ri-settings-fill:before { content: "\\f0ed";\n}\n.ri-settings-line:before { content: "\\f0ee";\n}\n.ri-shape-2-fill:before { content: "\\f0ef";\n}\n.ri-shape-2-line:before { content: "\\f0f0";\n}\n.ri-shape-fill:before { content: "\\f0f1";\n}\n.ri-shape-line:before { content: "\\f0f2";\n}\n.ri-share-box-fill:before { content: "\\f0f3";\n}\n.ri-share-box-line:before { content: "\\f0f4";\n}\n.ri-share-circle-fill:before { content: "\\f0f5";\n}\n.ri-share-circle-line:before { content: "\\f0f6";\n}\n.ri-share-fill:before { content: "\\f0f7";\n}\n.ri-share-forward-2-fill:before { content: "\\f0f8";\n}\n.ri-share-forward-2-line:before { content: "\\f0f9";\n}\n.ri-share-forward-box-fill:before { content: "\\f0fa";\n}\n.ri-share-forward-box-line:before { content: "\\f0fb";\n}\n.ri-share-forward-fill:before { content: "\\f0fc";\n}\n.ri-share-forward-line:before { content: "\\f0fd";\n}\n.ri-share-line:before { content: "\\f0fe";\n}\n.ri-shield-check-fill:before { content: "\\f0ff";\n}\n.ri-shield-check-line:before { content: "\\f100";\n}\n.ri-shield-cross-fill:before { content: "\\f101";\n}\n.ri-shield-cross-line:before { content: "\\f102";\n}\n.ri-shield-fill:before { content: "\\f103";\n}\n.ri-shield-flash-fill:before { content: "\\f104";\n}\n.ri-shield-flash-line:before { content: "\\f105";\n}\n.ri-shield-keyhole-fill:before { content: "\\f106";\n}\n.ri-shield-keyhole-line:before { content: "\\f107";\n}\n.ri-shield-line:before { content: "\\f108";\n}\n.ri-shield-star-fill:before { content: "\\f109";\n}\n.ri-shield-star-line:before { content: "\\f10a";\n}\n.ri-shield-user-fill:before { content: "\\f10b";\n}\n.ri-shield-user-line:before { content: "\\f10c";\n}\n.ri-ship-2-fill:before { content: "\\f10d";\n}\n.ri-ship-2-line:before { content: "\\f10e";\n}\n.ri-ship-fill:before { content: "\\f10f";\n}\n.ri-ship-line:before { content: "\\f110";\n}\n.ri-shirt-fill:before { content: "\\f111";\n}\n.ri-shirt-line:before { content: "\\f112";\n}\n.ri-shopping-bag-2-fill:before { content: "\\f113";\n}\n.ri-shopping-bag-2-line:before { content: "\\f114";\n}\n.ri-shopping-bag-3-fill:before { content: "\\f115";\n}\n.ri-shopping-bag-3-line:before { content: "\\f116";\n}\n.ri-shopping-bag-fill:before { content: "\\f117";\n}\n.ri-shopping-bag-line:before { content: "\\f118";\n}\n.ri-shopping-basket-2-fill:before { content: "\\f119";\n}\n.ri-shopping-basket-2-line:before { content: "\\f11a";\n}\n.ri-shopping-basket-fill:before { content: "\\f11b";\n}\n.ri-shopping-basket-line:before { content: "\\f11c";\n}\n.ri-shopping-cart-2-fill:before { content: "\\f11d";\n}\n.ri-shopping-cart-2-line:before { content: "\\f11e";\n}\n.ri-shopping-cart-fill:before { content: "\\f11f";\n}\n.ri-shopping-cart-line:before { content: "\\f120";\n}\n.ri-showers-fill:before { content: "\\f121";\n}\n.ri-showers-line:before { content: "\\f122";\n}\n.ri-shuffle-fill:before { content: "\\f123";\n}\n.ri-shuffle-line:before { content: "\\f124";\n}\n.ri-shut-down-fill:before { content: "\\f125";\n}\n.ri-shut-down-line:before { content: "\\f126";\n}\n.ri-side-bar-fill:before { content: "\\f127";\n}\n.ri-side-bar-line:before { content: "\\f128";\n}\n.ri-signal-tower-fill:before { content: "\\f129";\n}\n.ri-signal-tower-line:before { content: "\\f12a";\n}\n.ri-signal-wifi-1-fill:before { content: "\\f12b";\n}\n.ri-signal-wifi-1-line:before { content: "\\f12c";\n}\n.ri-signal-wifi-2-fill:before { content: "\\f12d";\n}\n.ri-signal-wifi-2-line:before { content: "\\f12e";\n}\n.ri-signal-wifi-3-fill:before { content: "\\f12f";\n}\n.ri-signal-wifi-3-line:before { content: "\\f130";\n}\n.ri-signal-wifi-error-fill:before { content: "\\f131";\n}\n.ri-signal-wifi-error-line:before { content: "\\f132";\n}\n.ri-signal-wifi-fill:before { content: "\\f133";\n}\n.ri-signal-wifi-line:before { content: "\\f134";\n}\n.ri-signal-wifi-off-fill:before { content: "\\f135";\n}\n.ri-signal-wifi-off-line:before { content: "\\f136";\n}\n.ri-sim-card-2-fill:before { content: "\\f137";\n}\n.ri-sim-card-2-line:before { content: "\\f138";\n}\n.ri-sim-card-fill:before { content: "\\f139";\n}\n.ri-sim-card-line:before { content: "\\f13a";\n}\n.ri-single-quotes-l:before { content: "\\f13b";\n}\n.ri-single-quotes-r:before { content: "\\f13c";\n}\n.ri-sip-fill:before { content: "\\f13d";\n}\n.ri-sip-line:before { content: "\\f13e";\n}\n.ri-skip-back-fill:before { content: "\\f13f";\n}\n.ri-skip-back-line:before { content: "\\f140";\n}\n.ri-skip-back-mini-fill:before { content: "\\f141";\n}\n.ri-skip-back-mini-line:before { content: "\\f142";\n}\n.ri-skip-forward-fill:before { content: "\\f143";\n}\n.ri-skip-forward-line:before { content: "\\f144";\n}\n.ri-skip-forward-mini-fill:before { content: "\\f145";\n}\n.ri-skip-forward-mini-line:before { content: "\\f146";\n}\n.ri-skull-2-fill:before { content: "\\f147";\n}\n.ri-skull-2-line:before { content: "\\f148";\n}\n.ri-skull-fill:before { content: "\\f149";\n}\n.ri-skull-line:before { content: "\\f14a";\n}\n.ri-skype-fill:before { content: "\\f14b";\n}\n.ri-skype-line:before { content: "\\f14c";\n}\n.ri-slack-fill:before { content: "\\f14d";\n}\n.ri-slack-line:before { content: "\\f14e";\n}\n.ri-slice-fill:before { content: "\\f14f";\n}\n.ri-slice-line:before { content: "\\f150";\n}\n.ri-slideshow-2-fill:before { content: "\\f151";\n}\n.ri-slideshow-2-line:before { content: "\\f152";\n}\n.ri-slideshow-3-fill:before { content: "\\f153";\n}\n.ri-slideshow-3-line:before { content: "\\f154";\n}\n.ri-slideshow-4-fill:before { content: "\\f155";\n}\n.ri-slideshow-4-line:before { content: "\\f156";\n}\n.ri-slideshow-fill:before { content: "\\f157";\n}\n.ri-slideshow-line:before { content: "\\f158";\n}\n.ri-smartphone-fill:before { content: "\\f159";\n}\n.ri-smartphone-line:before { content: "\\f15a";\n}\n.ri-snapchat-fill:before { content: "\\f15b";\n}\n.ri-snapchat-line:before { content: "\\f15c";\n}\n.ri-snowy-fill:before { content: "\\f15d";\n}\n.ri-snowy-line:before { content: "\\f15e";\n}\n.ri-sort-asc:before { content: "\\f15f";\n}\n.ri-sort-desc:before { content: "\\f160";\n}\n.ri-sound-module-fill:before { content: "\\f161";\n}\n.ri-sound-module-line:before { content: "\\f162";\n}\n.ri-soundcloud-fill:before { content: "\\f163";\n}\n.ri-soundcloud-line:before { content: "\\f164";\n}\n.ri-space-ship-fill:before { content: "\\f165";\n}\n.ri-space-ship-line:before { content: "\\f166";\n}\n.ri-space:before { content: "\\f167";\n}\n.ri-spam-2-fill:before { content: "\\f168";\n}\n.ri-spam-2-line:before { content: "\\f169";\n}\n.ri-spam-3-fill:before { content: "\\f16a";\n}\n.ri-spam-3-line:before { content: "\\f16b";\n}\n.ri-spam-fill:before { content: "\\f16c";\n}\n.ri-spam-line:before { content: "\\f16d";\n}\n.ri-speaker-2-fill:before { content: "\\f16e";\n}\n.ri-speaker-2-line:before { content: "\\f16f";\n}\n.ri-speaker-3-fill:before { content: "\\f170";\n}\n.ri-speaker-3-line:before { content: "\\f171";\n}\n.ri-speaker-fill:before { content: "\\f172";\n}\n.ri-speaker-line:before { content: "\\f173";\n}\n.ri-spectrum-fill:before { content: "\\f174";\n}\n.ri-spectrum-line:before { content: "\\f175";\n}\n.ri-speed-fill:before { content: "\\f176";\n}\n.ri-speed-line:before { content: "\\f177";\n}\n.ri-speed-mini-fill:before { content: "\\f178";\n}\n.ri-speed-mini-line:before { content: "\\f179";\n}\n.ri-split-cells-horizontal:before { content: "\\f17a";\n}\n.ri-split-cells-vertical:before { content: "\\f17b";\n}\n.ri-spotify-fill:before { content: "\\f17c";\n}\n.ri-spotify-line:before { content: "\\f17d";\n}\n.ri-spy-fill:before { content: "\\f17e";\n}\n.ri-spy-line:before { content: "\\f17f";\n}\n.ri-stack-fill:before { content: "\\f180";\n}\n.ri-stack-line:before { content: "\\f181";\n}\n.ri-stack-overflow-fill:before { content: "\\f182";\n}\n.ri-stack-overflow-line:before { content: "\\f183";\n}\n.ri-stackshare-fill:before { content: "\\f184";\n}\n.ri-stackshare-line:before { content: "\\f185";\n}\n.ri-star-fill:before { content: "\\f186";\n}\n.ri-star-half-fill:before { content: "\\f187";\n}\n.ri-star-half-line:before { content: "\\f188";\n}\n.ri-star-half-s-fill:before { content: "\\f189";\n}\n.ri-star-half-s-line:before { content: "\\f18a";\n}\n.ri-star-line:before { content: "\\f18b";\n}\n.ri-star-s-fill:before { content: "\\f18c";\n}\n.ri-star-s-line:before { content: "\\f18d";\n}\n.ri-star-smile-fill:before { content: "\\f18e";\n}\n.ri-star-smile-line:before { content: "\\f18f";\n}\n.ri-steam-fill:before { content: "\\f190";\n}\n.ri-steam-line:before { content: "\\f191";\n}\n.ri-steering-2-fill:before { content: "\\f192";\n}\n.ri-steering-2-line:before { content: "\\f193";\n}\n.ri-steering-fill:before { content: "\\f194";\n}\n.ri-steering-line:before { content: "\\f195";\n}\n.ri-stethoscope-fill:before { content: "\\f196";\n}\n.ri-stethoscope-line:before { content: "\\f197";\n}\n.ri-sticky-note-2-fill:before { content: "\\f198";\n}\n.ri-sticky-note-2-line:before { content: "\\f199";\n}\n.ri-sticky-note-fill:before { content: "\\f19a";\n}\n.ri-sticky-note-line:before { content: "\\f19b";\n}\n.ri-stock-fill:before { content: "\\f19c";\n}\n.ri-stock-line:before { content: "\\f19d";\n}\n.ri-stop-circle-fill:before { content: "\\f19e";\n}\n.ri-stop-circle-line:before { content: "\\f19f";\n}\n.ri-stop-fill:before { content: "\\f1a0";\n}\n.ri-stop-line:before { content: "\\f1a1";\n}\n.ri-stop-mini-fill:before { content: "\\f1a2";\n}\n.ri-stop-mini-line:before { content: "\\f1a3";\n}\n.ri-store-2-fill:before { content: "\\f1a4";\n}\n.ri-store-2-line:before { content: "\\f1a5";\n}\n.ri-store-3-fill:before { content: "\\f1a6";\n}\n.ri-store-3-line:before { content: "\\f1a7";\n}\n.ri-store-fill:before { content: "\\f1a8";\n}\n.ri-store-line:before { content: "\\f1a9";\n}\n.ri-strikethrough-2:before { content: "\\f1aa";\n}\n.ri-strikethrough:before { content: "\\f1ab";\n}\n.ri-subscript-2:before { content: "\\f1ac";\n}\n.ri-subscript:before { content: "\\f1ad";\n}\n.ri-subtract-fill:before { content: "\\f1ae";\n}\n.ri-subtract-line:before { content: "\\f1af";\n}\n.ri-subway-fill:before { content: "\\f1b0";\n}\n.ri-subway-line:before { content: "\\f1b1";\n}\n.ri-subway-wifi-fill:before { content: "\\f1b2";\n}\n.ri-subway-wifi-line:before { content: "\\f1b3";\n}\n.ri-suitcase-2-fill:before { content: "\\f1b4";\n}\n.ri-suitcase-2-line:before { content: "\\f1b5";\n}\n.ri-suitcase-3-fill:before { content: "\\f1b6";\n}\n.ri-suitcase-3-line:before { content: "\\f1b7";\n}\n.ri-suitcase-fill:before { content: "\\f1b8";\n}\n.ri-suitcase-line:before { content: "\\f1b9";\n}\n.ri-sun-cloudy-fill:before { content: "\\f1ba";\n}\n.ri-sun-cloudy-line:before { content: "\\f1bb";\n}\n.ri-sun-fill:before { content: "\\f1bc";\n}\n.ri-sun-foggy-fill:before { content: "\\f1bd";\n}\n.ri-sun-foggy-line:before { content: "\\f1be";\n}\n.ri-sun-line:before { content: "\\f1bf";\n}\n.ri-superscript-2:before { content: "\\f1c0";\n}\n.ri-superscript:before { content: "\\f1c1";\n}\n.ri-surgical-mask-fill:before { content: "\\f1c2";\n}\n.ri-surgical-mask-line:before { content: "\\f1c3";\n}\n.ri-surround-sound-fill:before { content: "\\f1c4";\n}\n.ri-surround-sound-line:before { content: "\\f1c5";\n}\n.ri-survey-fill:before { content: "\\f1c6";\n}\n.ri-survey-line:before { content: "\\f1c7";\n}\n.ri-swap-box-fill:before { content: "\\f1c8";\n}\n.ri-swap-box-line:before { content: "\\f1c9";\n}\n.ri-swap-fill:before { content: "\\f1ca";\n}\n.ri-swap-line:before { content: "\\f1cb";\n}\n.ri-switch-fill:before { content: "\\f1cc";\n}\n.ri-switch-line:before { content: "\\f1cd";\n}\n.ri-sword-fill:before { content: "\\f1ce";\n}\n.ri-sword-line:before { content: "\\f1cf";\n}\n.ri-syringe-fill:before { content: "\\f1d0";\n}\n.ri-syringe-line:before { content: "\\f1d1";\n}\n.ri-t-box-fill:before { content: "\\f1d2";\n}\n.ri-t-box-line:before { content: "\\f1d3";\n}\n.ri-t-shirt-2-fill:before { content: "\\f1d4";\n}\n.ri-t-shirt-2-line:before { content: "\\f1d5";\n}\n.ri-t-shirt-air-fill:before { content: "\\f1d6";\n}\n.ri-t-shirt-air-line:before { content: "\\f1d7";\n}\n.ri-t-shirt-fill:before { content: "\\f1d8";\n}\n.ri-t-shirt-line:before { content: "\\f1d9";\n}\n.ri-table-2:before { content: "\\f1da";\n}\n.ri-table-alt-fill:before { content: "\\f1db";\n}\n.ri-table-alt-line:before { content: "\\f1dc";\n}\n.ri-table-fill:before { content: "\\f1dd";\n}\n.ri-table-line:before { content: "\\f1de";\n}\n.ri-tablet-fill:before { content: "\\f1df";\n}\n.ri-tablet-line:before { content: "\\f1e0";\n}\n.ri-takeaway-fill:before { content: "\\f1e1";\n}\n.ri-takeaway-line:before { content: "\\f1e2";\n}\n.ri-taobao-fill:before { content: "\\f1e3";\n}\n.ri-taobao-line:before { content: "\\f1e4";\n}\n.ri-tape-fill:before { content: "\\f1e5";\n}\n.ri-tape-line:before { content: "\\f1e6";\n}\n.ri-task-fill:before { content: "\\f1e7";\n}\n.ri-task-line:before { content: "\\f1e8";\n}\n.ri-taxi-fill:before { content: "\\f1e9";\n}\n.ri-taxi-line:before { content: "\\f1ea";\n}\n.ri-taxi-wifi-fill:before { content: "\\f1eb";\n}\n.ri-taxi-wifi-line:before { content: "\\f1ec";\n}\n.ri-team-fill:before { content: "\\f1ed";\n}\n.ri-team-line:before { content: "\\f1ee";\n}\n.ri-telegram-fill:before { content: "\\f1ef";\n}\n.ri-telegram-line:before { content: "\\f1f0";\n}\n.ri-temp-cold-fill:before { content: "\\f1f1";\n}\n.ri-temp-cold-line:before { content: "\\f1f2";\n}\n.ri-temp-hot-fill:before { content: "\\f1f3";\n}\n.ri-temp-hot-line:before { content: "\\f1f4";\n}\n.ri-terminal-box-fill:before { content: "\\f1f5";\n}\n.ri-terminal-box-line:before { content: "\\f1f6";\n}\n.ri-terminal-fill:before { content: "\\f1f7";\n}\n.ri-terminal-line:before { content: "\\f1f8";\n}\n.ri-terminal-window-fill:before { content: "\\f1f9";\n}\n.ri-terminal-window-line:before { content: "\\f1fa";\n}\n.ri-test-tube-fill:before { content: "\\f1fb";\n}\n.ri-test-tube-line:before { content: "\\f1fc";\n}\n.ri-text-direction-l:before { content: "\\f1fd";\n}\n.ri-text-direction-r:before { content: "\\f1fe";\n}\n.ri-text-spacing:before { content: "\\f1ff";\n}\n.ri-text-wrap:before { content: "\\f200";\n}\n.ri-text:before { content: "\\f201";\n}\n.ri-thermometer-fill:before { content: "\\f202";\n}\n.ri-thermometer-line:before { content: "\\f203";\n}\n.ri-thumb-down-fill:before { content: "\\f204";\n}\n.ri-thumb-down-line:before { content: "\\f205";\n}\n.ri-thumb-up-fill:before { content: "\\f206";\n}\n.ri-thumb-up-line:before { content: "\\f207";\n}\n.ri-thunderstorms-fill:before { content: "\\f208";\n}\n.ri-thunderstorms-line:before { content: "\\f209";\n}\n.ri-ticket-2-fill:before { content: "\\f20a";\n}\n.ri-ticket-2-line:before { content: "\\f20b";\n}\n.ri-ticket-fill:before { content: "\\f20c";\n}\n.ri-ticket-line:before { content: "\\f20d";\n}\n.ri-time-fill:before { content: "\\f20e";\n}\n.ri-time-line:before { content: "\\f20f";\n}\n.ri-timer-2-fill:before { content: "\\f210";\n}\n.ri-timer-2-line:before { content: "\\f211";\n}\n.ri-timer-fill:before { content: "\\f212";\n}\n.ri-timer-flash-fill:before { content: "\\f213";\n}\n.ri-timer-flash-line:before { content: "\\f214";\n}\n.ri-timer-line:before { content: "\\f215";\n}\n.ri-todo-fill:before { content: "\\f216";\n}\n.ri-todo-line:before { content: "\\f217";\n}\n.ri-toggle-fill:before { content: "\\f218";\n}\n.ri-toggle-line:before { content: "\\f219";\n}\n.ri-tools-fill:before { content: "\\f21a";\n}\n.ri-tools-line:before { content: "\\f21b";\n}\n.ri-tornado-fill:before { content: "\\f21c";\n}\n.ri-tornado-line:before { content: "\\f21d";\n}\n.ri-trademark-fill:before { content: "\\f21e";\n}\n.ri-trademark-line:before { content: "\\f21f";\n}\n.ri-traffic-light-fill:before { content: "\\f220";\n}\n.ri-traffic-light-line:before { content: "\\f221";\n}\n.ri-train-fill:before { content: "\\f222";\n}\n.ri-train-line:before { content: "\\f223";\n}\n.ri-train-wifi-fill:before { content: "\\f224";\n}\n.ri-train-wifi-line:before { content: "\\f225";\n}\n.ri-translate-2:before { content: "\\f226";\n}\n.ri-translate:before { content: "\\f227";\n}\n.ri-travesti-fill:before { content: "\\f228";\n}\n.ri-travesti-line:before { content: "\\f229";\n}\n.ri-treasure-map-fill:before { content: "\\f22a";\n}\n.ri-treasure-map-line:before { content: "\\f22b";\n}\n.ri-trello-fill:before { content: "\\f22c";\n}\n.ri-trello-line:before { content: "\\f22d";\n}\n.ri-trophy-fill:before { content: "\\f22e";\n}\n.ri-trophy-line:before { content: "\\f22f";\n}\n.ri-truck-fill:before { content: "\\f230";\n}\n.ri-truck-line:before { content: "\\f231";\n}\n.ri-tumblr-fill:before { content: "\\f232";\n}\n.ri-tumblr-line:before { content: "\\f233";\n}\n.ri-tv-2-fill:before { content: "\\f234";\n}\n.ri-tv-2-line:before { content: "\\f235";\n}\n.ri-tv-fill:before { content: "\\f236";\n}\n.ri-tv-line:before { content: "\\f237";\n}\n.ri-twitch-fill:before { content: "\\f238";\n}\n.ri-twitch-line:before { content: "\\f239";\n}\n.ri-twitter-fill:before { content: "\\f23a";\n}\n.ri-twitter-line:before { content: "\\f23b";\n}\n.ri-typhoon-fill:before { content: "\\f23c";\n}\n.ri-typhoon-line:before { content: "\\f23d";\n}\n.ri-u-disk-fill:before { content: "\\f23e";\n}\n.ri-u-disk-line:before { content: "\\f23f";\n}\n.ri-ubuntu-fill:before { content: "\\f240";\n}\n.ri-ubuntu-line:before { content: "\\f241";\n}\n.ri-umbrella-fill:before { content: "\\f242";\n}\n.ri-umbrella-line:before { content: "\\f243";\n}\n.ri-underline:before { content: "\\f244";\n}\n.ri-uninstall-fill:before { content: "\\f245";\n}\n.ri-uninstall-line:before { content: "\\f246";\n}\n.ri-unsplash-fill:before { content: "\\f247";\n}\n.ri-unsplash-line:before { content: "\\f248";\n}\n.ri-upload-2-fill:before { content: "\\f249";\n}\n.ri-upload-2-line:before { content: "\\f24a";\n}\n.ri-upload-cloud-2-fill:before { content: "\\f24b";\n}\n.ri-upload-cloud-2-line:before { content: "\\f24c";\n}\n.ri-upload-cloud-fill:before { content: "\\f24d";\n}\n.ri-upload-cloud-line:before { content: "\\f24e";\n}\n.ri-upload-fill:before { content: "\\f24f";\n}\n.ri-upload-line:before { content: "\\f250";\n}\n.ri-usb-fill:before { content: "\\f251";\n}\n.ri-usb-line:before { content: "\\f252";\n}\n.ri-user-2-fill:before { content: "\\f253";\n}\n.ri-user-2-line:before { content: "\\f254";\n}\n.ri-user-3-fill:before { content: "\\f255";\n}\n.ri-user-3-line:before { content: "\\f256";\n}\n.ri-user-4-fill:before { content: "\\f257";\n}\n.ri-user-4-line:before { content: "\\f258";\n}\n.ri-user-5-fill:before { content: "\\f259";\n}\n.ri-user-5-line:before { content: "\\f25a";\n}\n.ri-user-6-fill:before { content: "\\f25b";\n}\n.ri-user-6-line:before { content: "\\f25c";\n}\n.ri-user-add-fill:before { content: "\\f25d";\n}\n.ri-user-add-line:before { content: "\\f25e";\n}\n.ri-user-fill:before { content: "\\f25f";\n}\n.ri-user-follow-fill:before { content: "\\f260";\n}\n.ri-user-follow-line:before { content: "\\f261";\n}\n.ri-user-heart-fill:before { content: "\\f262";\n}\n.ri-user-heart-line:before { content: "\\f263";\n}\n.ri-user-line:before { content: "\\f264";\n}\n.ri-user-location-fill:before { content: "\\f265";\n}\n.ri-user-location-line:before { content: "\\f266";\n}\n.ri-user-received-2-fill:before { content: "\\f267";\n}\n.ri-user-received-2-line:before { content: "\\f268";\n}\n.ri-user-received-fill:before { content: "\\f269";\n}\n.ri-user-received-line:before { content: "\\f26a";\n}\n.ri-user-search-fill:before { content: "\\f26b";\n}\n.ri-user-search-line:before { content: "\\f26c";\n}\n.ri-user-settings-fill:before { content: "\\f26d";\n}\n.ri-user-settings-line:before { content: "\\f26e";\n}\n.ri-user-shared-2-fill:before { content: "\\f26f";\n}\n.ri-user-shared-2-line:before { content: "\\f270";\n}\n.ri-user-shared-fill:before { content: "\\f271";\n}\n.ri-user-shared-line:before { content: "\\f272";\n}\n.ri-user-smile-fill:before { content: "\\f273";\n}\n.ri-user-smile-line:before { content: "\\f274";\n}\n.ri-user-star-fill:before { content: "\\f275";\n}\n.ri-user-star-line:before { content: "\\f276";\n}\n.ri-user-unfollow-fill:before { content: "\\f277";\n}\n.ri-user-unfollow-line:before { content: "\\f278";\n}\n.ri-user-voice-fill:before { content: "\\f279";\n}\n.ri-user-voice-line:before { content: "\\f27a";\n}\n.ri-video-add-fill:before { content: "\\f27b";\n}\n.ri-video-add-line:before { content: "\\f27c";\n}\n.ri-video-chat-fill:before { content: "\\f27d";\n}\n.ri-video-chat-line:before { content: "\\f27e";\n}\n.ri-video-download-fill:before { content: "\\f27f";\n}\n.ri-video-download-line:before { content: "\\f280";\n}\n.ri-video-fill:before { content: "\\f281";\n}\n.ri-video-line:before { content: "\\f282";\n}\n.ri-video-upload-fill:before { content: "\\f283";\n}\n.ri-video-upload-line:before { content: "\\f284";\n}\n.ri-vidicon-2-fill:before { content: "\\f285";\n}\n.ri-vidicon-2-line:before { content: "\\f286";\n}\n.ri-vidicon-fill:before { content: "\\f287";\n}\n.ri-vidicon-line:before { content: "\\f288";\n}\n.ri-vimeo-fill:before { content: "\\f289";\n}\n.ri-vimeo-line:before { content: "\\f28a";\n}\n.ri-vip-crown-2-fill:before { content: "\\f28b";\n}\n.ri-vip-crown-2-line:before { content: "\\f28c";\n}\n.ri-vip-crown-fill:before { content: "\\f28d";\n}\n.ri-vip-crown-line:before { content: "\\f28e";\n}\n.ri-vip-diamond-fill:before { content: "\\f28f";\n}\n.ri-vip-diamond-line:before { content: "\\f290";\n}\n.ri-vip-fill:before { content: "\\f291";\n}\n.ri-vip-line:before { content: "\\f292";\n}\n.ri-virus-fill:before { content: "\\f293";\n}\n.ri-virus-line:before { content: "\\f294";\n}\n.ri-visa-fill:before { content: "\\f295";\n}\n.ri-visa-line:before { content: "\\f296";\n}\n.ri-voice-recognition-fill:before { content: "\\f297";\n}\n.ri-voice-recognition-line:before { content: "\\f298";\n}\n.ri-voiceprint-fill:before { content: "\\f299";\n}\n.ri-voiceprint-line:before { content: "\\f29a";\n}\n.ri-volume-down-fill:before { content: "\\f29b";\n}\n.ri-volume-down-line:before { content: "\\f29c";\n}\n.ri-volume-mute-fill:before { content: "\\f29d";\n}\n.ri-volume-mute-line:before { content: "\\f29e";\n}\n.ri-volume-off-vibrate-fill:before { content: "\\f29f";\n}\n.ri-volume-off-vibrate-line:before { content: "\\f2a0";\n}\n.ri-volume-up-fill:before { content: "\\f2a1";\n}\n.ri-volume-up-line:before { content: "\\f2a2";\n}\n.ri-volume-vibrate-fill:before { content: "\\f2a3";\n}\n.ri-volume-vibrate-line:before { content: "\\f2a4";\n}\n.ri-vuejs-fill:before { content: "\\f2a5";\n}\n.ri-vuejs-line:before { content: "\\f2a6";\n}\n.ri-walk-fill:before { content: "\\f2a7";\n}\n.ri-walk-line:before { content: "\\f2a8";\n}\n.ri-wallet-2-fill:before { content: "\\f2a9";\n}\n.ri-wallet-2-line:before { content: "\\f2aa";\n}\n.ri-wallet-3-fill:before { content: "\\f2ab";\n}\n.ri-wallet-3-line:before { content: "\\f2ac";\n}\n.ri-wallet-fill:before { content: "\\f2ad";\n}\n.ri-wallet-line:before { content: "\\f2ae";\n}\n.ri-water-flash-fill:before { content: "\\f2af";\n}\n.ri-water-flash-line:before { content: "\\f2b0";\n}\n.ri-webcam-fill:before { content: "\\f2b1";\n}\n.ri-webcam-line:before { content: "\\f2b2";\n}\n.ri-wechat-2-fill:before { content: "\\f2b3";\n}\n.ri-wechat-2-line:before { content: "\\f2b4";\n}\n.ri-wechat-fill:before { content: "\\f2b5";\n}\n.ri-wechat-line:before { content: "\\f2b6";\n}\n.ri-wechat-pay-fill:before { content: "\\f2b7";\n}\n.ri-wechat-pay-line:before { content: "\\f2b8";\n}\n.ri-weibo-fill:before { content: "\\f2b9";\n}\n.ri-weibo-line:before { content: "\\f2ba";\n}\n.ri-whatsapp-fill:before { content: "\\f2bb";\n}\n.ri-whatsapp-line:before { content: "\\f2bc";\n}\n.ri-wheelchair-fill:before { content: "\\f2bd";\n}\n.ri-wheelchair-line:before { content: "\\f2be";\n}\n.ri-wifi-fill:before { content: "\\f2bf";\n}\n.ri-wifi-line:before { content: "\\f2c0";\n}\n.ri-wifi-off-fill:before { content: "\\f2c1";\n}\n.ri-wifi-off-line:before { content: "\\f2c2";\n}\n.ri-window-2-fill:before { content: "\\f2c3";\n}\n.ri-window-2-line:before { content: "\\f2c4";\n}\n.ri-window-fill:before { content: "\\f2c5";\n}\n.ri-window-line:before { content: "\\f2c6";\n}\n.ri-windows-fill:before { content: "\\f2c7";\n}\n.ri-windows-line:before { content: "\\f2c8";\n}\n.ri-windy-fill:before { content: "\\f2c9";\n}\n.ri-windy-line:before { content: "\\f2ca";\n}\n.ri-wireless-charging-fill:before { content: "\\f2cb";\n}\n.ri-wireless-charging-line:before { content: "\\f2cc";\n}\n.ri-women-fill:before { content: "\\f2cd";\n}\n.ri-women-line:before { content: "\\f2ce";\n}\n.ri-wubi-input:before { content: "\\f2cf";\n}\n.ri-xbox-fill:before { content: "\\f2d0";\n}\n.ri-xbox-line:before { content: "\\f2d1";\n}\n.ri-xing-fill:before { content: "\\f2d2";\n}\n.ri-xing-line:before { content: "\\f2d3";\n}\n.ri-youtube-fill:before { content: "\\f2d4";\n}\n.ri-youtube-line:before { content: "\\f2d5";\n}\n.ri-zcool-fill:before { content: "\\f2d6";\n}\n.ri-zcool-line:before { content: "\\f2d7";\n}\n.ri-zhihu-fill:before { content: "\\f2d8";\n}\n.ri-zhihu-line:before { content: "\\f2d9";\n}\n.ri-zoom-in-fill:before { content: "\\f2da";\n}\n.ri-zoom-in-line:before { content: "\\f2db";\n}\n.ri-zoom-out-fill:before { content: "\\f2dc";\n}\n.ri-zoom-out-line:before { content: "\\f2dd";\n}\n.ri-zzz-fill:before { content: "\\f2de";\n}\n.ri-zzz-line:before { content: "\\f2df";\n}\n.ri-arrow-down-double-fill:before { content: "\\f2e0";\n}\n.ri-arrow-down-double-line:before { content: "\\f2e1";\n}\n.ri-arrow-left-double-fill:before { content: "\\f2e2";\n}\n.ri-arrow-left-double-line:before { content: "\\f2e3";\n}\n.ri-arrow-right-double-fill:before { content: "\\f2e4";\n}\n.ri-arrow-right-double-line:before { content: "\\f2e5";\n}\n.ri-arrow-turn-back-fill:before { content: "\\f2e6";\n}\n.ri-arrow-turn-back-line:before { content: "\\f2e7";\n}\n.ri-arrow-turn-forward-fill:before { content: "\\f2e8";\n}\n.ri-arrow-turn-forward-line:before { content: "\\f2e9";\n}\n.ri-arrow-up-double-fill:before { content: "\\f2ea";\n}\n.ri-arrow-up-double-line:before { content: "\\f2eb";\n}\n.ri-bard-fill:before { content: "\\f2ec";\n}\n.ri-bard-line:before { content: "\\f2ed";\n}\n.ri-bootstrap-fill:before { content: "\\f2ee";\n}\n.ri-bootstrap-line:before { content: "\\f2ef";\n}\n.ri-box-1-fill:before { content: "\\f2f0";\n}\n.ri-box-1-line:before { content: "\\f2f1";\n}\n.ri-box-2-fill:before { content: "\\f2f2";\n}\n.ri-box-2-line:before { content: "\\f2f3";\n}\n.ri-box-3-fill:before { content: "\\f2f4";\n}\n.ri-box-3-line:before { content: "\\f2f5";\n}\n.ri-brain-fill:before { content: "\\f2f6";\n}\n.ri-brain-line:before { content: "\\f2f7";\n}\n.ri-candle-fill:before { content: "\\f2f8";\n}\n.ri-candle-line:before { content: "\\f2f9";\n}\n.ri-cash-fill:before { content: "\\f2fa";\n}\n.ri-cash-line:before { content: "\\f2fb";\n}\n.ri-contract-left-fill:before { content: "\\f2fc";\n}\n.ri-contract-left-line:before { content: "\\f2fd";\n}\n.ri-contract-left-right-fill:before { content: "\\f2fe";\n}\n.ri-contract-left-right-line:before { content: "\\f2ff";\n}\n.ri-contract-right-fill:before { content: "\\f300";\n}\n.ri-contract-right-line:before { content: "\\f301";\n}\n.ri-contract-up-down-fill:before { content: "\\f302";\n}\n.ri-contract-up-down-line:before { content: "\\f303";\n}\n.ri-copilot-fill:before { content: "\\f304";\n}\n.ri-copilot-line:before { content: "\\f305";\n}\n.ri-corner-down-left-fill:before { content: "\\f306";\n}\n.ri-corner-down-left-line:before { content: "\\f307";\n}\n.ri-corner-down-right-fill:before { content: "\\f308";\n}\n.ri-corner-down-right-line:before { content: "\\f309";\n}\n.ri-corner-left-down-fill:before { content: "\\f30a";\n}\n.ri-corner-left-down-line:before { content: "\\f30b";\n}\n.ri-corner-left-up-fill:before { content: "\\f30c";\n}\n.ri-corner-left-up-line:before { content: "\\f30d";\n}\n.ri-corner-right-down-fill:before { content: "\\f30e";\n}\n.ri-corner-right-down-line:before { content: "\\f30f";\n}\n.ri-corner-right-up-fill:before { content: "\\f310";\n}\n.ri-corner-right-up-line:before { content: "\\f311";\n}\n.ri-corner-up-left-double-fill:before { content: "\\f312";\n}\n.ri-corner-up-left-double-line:before { content: "\\f313";\n}\n.ri-corner-up-left-fill:before { content: "\\f314";\n}\n.ri-corner-up-left-line:before { content: "\\f315";\n}\n.ri-corner-up-right-double-fill:before { content: "\\f316";\n}\n.ri-corner-up-right-double-line:before { content: "\\f317";\n}\n.ri-corner-up-right-fill:before { content: "\\f318";\n}\n.ri-corner-up-right-line:before { content: "\\f319";\n}\n.ri-cross-fill:before { content: "\\f31a";\n}\n.ri-cross-line:before { content: "\\f31b";\n}\n.ri-edge-new-fill:before { content: "\\f31c";\n}\n.ri-edge-new-line:before { content: "\\f31d";\n}\n.ri-equal-fill:before { content: "\\f31e";\n}\n.ri-equal-line:before { content: "\\f31f";\n}\n.ri-expand-left-fill:before { content: "\\f320";\n}\n.ri-expand-left-line:before { content: "\\f321";\n}\n.ri-expand-left-right-fill:before { content: "\\f322";\n}\n.ri-expand-left-right-line:before { content: "\\f323";\n}\n.ri-expand-right-fill:before { content: "\\f324";\n}\n.ri-expand-right-line:before { content: "\\f325";\n}\n.ri-expand-up-down-fill:before { content: "\\f326";\n}\n.ri-expand-up-down-line:before { content: "\\f327";\n}\n.ri-flickr-fill:before { content: "\\f328";\n}\n.ri-flickr-line:before { content: "\\f329";\n}\n.ri-forward-10-fill:before { content: "\\f32a";\n}\n.ri-forward-10-line:before { content: "\\f32b";\n}\n.ri-forward-15-fill:before { content: "\\f32c";\n}\n.ri-forward-15-line:before { content: "\\f32d";\n}\n.ri-forward-30-fill:before { content: "\\f32e";\n}\n.ri-forward-30-line:before { content: "\\f32f";\n}\n.ri-forward-5-fill:before { content: "\\f330";\n}\n.ri-forward-5-line:before { content: "\\f331";\n}\n.ri-graduation-cap-fill:before { content: "\\f332";\n}\n.ri-graduation-cap-line:before { content: "\\f333";\n}\n.ri-home-office-fill:before { content: "\\f334";\n}\n.ri-home-office-line:before { content: "\\f335";\n}\n.ri-hourglass-2-fill:before { content: "\\f336";\n}\n.ri-hourglass-2-line:before { content: "\\f337";\n}\n.ri-hourglass-fill:before { content: "\\f338";\n}\n.ri-hourglass-line:before { content: "\\f339";\n}\n.ri-javascript-fill:before { content: "\\f33a";\n}\n.ri-javascript-line:before { content: "\\f33b";\n}\n.ri-loop-left-fill:before { content: "\\f33c";\n}\n.ri-loop-left-line:before { content: "\\f33d";\n}\n.ri-loop-right-fill:before { content: "\\f33e";\n}\n.ri-loop-right-line:before { content: "\\f33f";\n}\n.ri-memories-fill:before { content: "\\f340";\n}\n.ri-memories-line:before { content: "\\f341";\n}\n.ri-meta-fill:before { content: "\\f342";\n}\n.ri-meta-line:before { content: "\\f343";\n}\n.ri-microsoft-loop-fill:before { content: "\\f344";\n}\n.ri-microsoft-loop-line:before { content: "\\f345";\n}\n.ri-nft-fill:before { content: "\\f346";\n}\n.ri-nft-line:before { content: "\\f347";\n}\n.ri-notion-fill:before { content: "\\f348";\n}\n.ri-notion-line:before { content: "\\f349";\n}\n.ri-openai-fill:before { content: "\\f34a";\n}\n.ri-openai-line:before { content: "\\f34b";\n}\n.ri-overline:before { content: "\\f34c";\n}\n.ri-p2p-fill:before { content: "\\f34d";\n}\n.ri-p2p-line:before { content: "\\f34e";\n}\n.ri-presentation-fill:before { content: "\\f34f";\n}\n.ri-presentation-line:before { content: "\\f350";\n}\n.ri-replay-10-fill:before { content: "\\f351";\n}\n.ri-replay-10-line:before { content: "\\f352";\n}\n.ri-replay-15-fill:before { content: "\\f353";\n}\n.ri-replay-15-line:before { content: "\\f354";\n}\n.ri-replay-30-fill:before { content: "\\f355";\n}\n.ri-replay-30-line:before { content: "\\f356";\n}\n.ri-replay-5-fill:before { content: "\\f357";\n}\n.ri-replay-5-line:before { content: "\\f358";\n}\n.ri-school-fill:before { content: "\\f359";\n}\n.ri-school-line:before { content: "\\f35a";\n}\n.ri-shining-2-fill:before { content: "\\f35b";\n}\n.ri-shining-2-line:before { content: "\\f35c";\n}\n.ri-shining-fill:before { content: "\\f35d";\n}\n.ri-shining-line:before { content: "\\f35e";\n}\n.ri-sketching:before { content: "\\f35f";\n}\n.ri-skip-down-fill:before { content: "\\f360";\n}\n.ri-skip-down-line:before { content: "\\f361";\n}\n.ri-skip-left-fill:before { content: "\\f362";\n}\n.ri-skip-left-line:before { content: "\\f363";\n}\n.ri-skip-right-fill:before { content: "\\f364";\n}\n.ri-skip-right-line:before { content: "\\f365";\n}\n.ri-skip-up-fill:before { content: "\\f366";\n}\n.ri-skip-up-line:before { content: "\\f367";\n}\n.ri-slow-down-fill:before { content: "\\f368";\n}\n.ri-slow-down-line:before { content: "\\f369";\n}\n.ri-sparkling-2-fill:before { content: "\\f36a";\n}\n.ri-sparkling-2-line:before { content: "\\f36b";\n}\n.ri-sparkling-fill:before { content: "\\f36c";\n}\n.ri-sparkling-line:before { content: "\\f36d";\n}\n.ri-speak-fill:before { content: "\\f36e";\n}\n.ri-speak-line:before { content: "\\f36f";\n}\n.ri-speed-up-fill:before { content: "\\f370";\n}\n.ri-speed-up-line:before { content: "\\f371";\n}\n.ri-tiktok-fill:before { content: "\\f372";\n}\n.ri-tiktok-line:before { content: "\\f373";\n}\n.ri-token-swap-fill:before { content: "\\f374";\n}\n.ri-token-swap-line:before { content: "\\f375";\n}\n.ri-unpin-fill:before { content: "\\f376";\n}\n.ri-unpin-line:before { content: "\\f377";\n}\n.ri-wechat-channels-fill:before { content: "\\f378";\n}\n.ri-wechat-channels-line:before { content: "\\f379";\n}\n.ri-wordpress-fill:before { content: "\\f37a";\n}\n.ri-wordpress-line:before { content: "\\f37b";\n}\n.ri-blender-fill:before { content: "\\f37c";\n}\n.ri-blender-line:before { content: "\\f37d";\n}\n.ri-emoji-sticker-fill:before { content: "\\f37e";\n}\n.ri-emoji-sticker-line:before { content: "\\f37f";\n}\n.ri-git-close-pull-request-fill:before { content: "\\f380";\n}\n.ri-git-close-pull-request-line:before { content: "\\f381";\n}\n.ri-instance-fill:before { content: "\\f382";\n}\n.ri-instance-line:before { content: "\\f383";\n}\n.ri-megaphone-fill:before { content: "\\f384";\n}\n.ri-megaphone-line:before { content: "\\f385";\n}\n.ri-pass-expired-fill:before { content: "\\f386";\n}\n.ri-pass-expired-line:before { content: "\\f387";\n}\n.ri-pass-pending-fill:before { content: "\\f388";\n}\n.ri-pass-pending-line:before { content: "\\f389";\n}\n.ri-pass-valid-fill:before { content: "\\f38a";\n}\n.ri-pass-valid-line:before { content: "\\f38b";\n}\n.ri-ai-generate:before { content: "\\f38c";\n}\n.ri-calendar-close-fill:before { content: "\\f38d";\n}\n.ri-calendar-close-line:before { content: "\\f38e";\n}\n.ri-draggable:before { content: "\\f38f";\n}\n.ri-font-family:before { content: "\\f390";\n}\n.ri-font-mono:before { content: "\\f391";\n}\n.ri-font-sans-serif:before { content: "\\f392";\n}\n.ri-hard-drive-3-fill:before { content: "\\f393";\n}\n.ri-hard-drive-3-line:before { content: "\\f394";\n}\n.ri-kick-fill:before { content: "\\f395";\n}\n.ri-kick-line:before { content: "\\f396";\n}\n.ri-list-check-3:before { content: "\\f397";\n}\n.ri-list-indefinite:before { content: "\\f398";\n}\n.ri-list-ordered-2:before { content: "\\f399";\n}\n.ri-list-radio:before { content: "\\f39a";\n}\n.ri-openbase-fill:before { content: "\\f39b";\n}\n.ri-openbase-line:before { content: "\\f39c";\n}\n.ri-planet-fill:before { content: "\\f39d";\n}\n.ri-planet-line:before { content: "\\f39e";\n}\n.ri-prohibited-fill:before { content: "\\f39f";\n}\n.ri-prohibited-line:before { content: "\\f3a0";\n}\n.ri-quote-text:before { content: "\\f3a1";\n}\n.ri-seo-fill:before { content: "\\f3a2";\n}\n.ri-seo-line:before { content: "\\f3a3";\n}\n.ri-slash-commands:before { content: "\\f3a4";\n}\n.ri-archive-2-fill:before { content: "\\f3a5";\n}\n.ri-archive-2-line:before { content: "\\f3a6";\n}\n.ri-inbox-2-fill:before { content: "\\f3a7";\n}\n.ri-inbox-2-line:before { content: "\\f3a8";\n}\n.ri-shake-hands-fill:before { content: "\\f3a9";\n}\n.ri-shake-hands-line:before { content: "\\f3aa";\n}\n.ri-supabase-fill:before { content: "\\f3ab";\n}\n.ri-supabase-line:before { content: "\\f3ac";\n}\n.ri-water-percent-fill:before { content: "\\f3ad";\n}\n.ri-water-percent-line:before { content: "\\f3ae";\n}\n.ri-yuque-fill:before { content: "\\f3af";\n}\n.ri-yuque-line:before { content: "\\f3b0";\n}\n.ri-crosshair-2-fill:before { content: "\\f3b1";\n}\n.ri-crosshair-2-line:before { content: "\\f3b2";\n}\n.ri-crosshair-fill:before { content: "\\f3b3";\n}\n.ri-crosshair-line:before { content: "\\f3b4";\n}\n.ri-file-close-fill:before { content: "\\f3b5";\n}\n.ri-file-close-line:before { content: "\\f3b6";\n}\n.ri-infinity-fill:before { content: "\\f3b7";\n}\n.ri-infinity-line:before { content: "\\f3b8";\n}\n.ri-rfid-fill:before { content: "\\f3b9";\n}\n.ri-rfid-line:before { content: "\\f3ba";\n}\n.ri-slash-commands-2:before { content: "\\f3bb";\n}\n.ri-user-forbid-fill:before { content: "\\f3bc";\n}\n.ri-user-forbid-line:before { content: "\\f3bd";\n}\n.ri-beer-fill:before { content: "\\f3be";\n}\n.ri-beer-line:before { content: "\\f3bf";\n}\n.ri-circle-fill:before { content: "\\f3c0";\n}\n.ri-circle-line:before { content: "\\f3c1";\n}\n.ri-dropdown-list:before { content: "\\f3c2";\n}\n.ri-file-image-fill:before { content: "\\f3c3";\n}\n.ri-file-image-line:before { content: "\\f3c4";\n}\n.ri-file-pdf-2-fill:before { content: "\\f3c5";\n}\n.ri-file-pdf-2-line:before { content: "\\f3c6";\n}\n.ri-file-video-fill:before { content: "\\f3c7";\n}\n.ri-file-video-line:before { content: "\\f3c8";\n}\n.ri-folder-image-fill:before { content: "\\f3c9";\n}\n.ri-folder-image-line:before { content: "\\f3ca";\n}\n.ri-folder-video-fill:before { content: "\\f3cb";\n}\n.ri-folder-video-line:before { content: "\\f3cc";\n}\n.ri-hexagon-fill:before { content: "\\f3cd";\n}\n.ri-hexagon-line:before { content: "\\f3ce";\n}\n.ri-menu-search-fill:before { content: "\\f3cf";\n}\n.ri-menu-search-line:before { content: "\\f3d0";\n}\n.ri-octagon-fill:before { content: "\\f3d1";\n}\n.ri-octagon-line:before { content: "\\f3d2";\n}\n.ri-pentagon-fill:before { content: "\\f3d3";\n}\n.ri-pentagon-line:before { content: "\\f3d4";\n}\n.ri-rectangle-fill:before { content: "\\f3d5";\n}\n.ri-rectangle-line:before { content: "\\f3d6";\n}\n.ri-robot-2-fill:before { content: "\\f3d7";\n}\n.ri-robot-2-line:before { content: "\\f3d8";\n}\n.ri-shapes-fill:before { content: "\\f3d9";\n}\n.ri-shapes-line:before { content: "\\f3da";\n}\n.ri-square-fill:before { content: "\\f3db";\n}\n.ri-square-line:before { content: "\\f3dc";\n}\n.ri-tent-fill:before { content: "\\f3dd";\n}\n.ri-tent-line:before { content: "\\f3de";\n}\n.ri-threads-fill:before { content: "\\f3df";\n}\n.ri-threads-line:before { content: "\\f3e0";\n}\n.ri-tree-fill:before { content: "\\f3e1";\n}\n.ri-tree-line:before { content: "\\f3e2";\n}\n.ri-triangle-fill:before { content: "\\f3e3";\n}\n.ri-triangle-line:before { content: "\\f3e4";\n}\n.ri-twitter-x-fill:before { content: "\\f3e5";\n}\n.ri-twitter-x-line:before { content: "\\f3e6";\n}\n.ri-verified-badge-fill:before { content: "\\f3e7";\n}\n.ri-verified-badge-line:before { content: "\\f3e8";\n}\n.ri-armchair-fill:before { content: "\\f3e9";\n}\n.ri-armchair-line:before { content: "\\f3ea";\n}\n.ri-bnb-fill:before { content: "\\f3eb";\n}\n.ri-bnb-line:before { content: "\\f3ec";\n}\n.ri-bread-fill:before { content: "\\f3ed";\n}\n.ri-bread-line:before { content: "\\f3ee";\n}\n.ri-btc-fill:before { content: "\\f3ef";\n}\n.ri-btc-line:before { content: "\\f3f0";\n}\n.ri-calendar-schedule-fill:before { content: "\\f3f1";\n}\n.ri-calendar-schedule-line:before { content: "\\f3f2";\n}\n.ri-dice-1-fill:before { content: "\\f3f3";\n}\n.ri-dice-1-line:before { content: "\\f3f4";\n}\n.ri-dice-2-fill:before { content: "\\f3f5";\n}\n.ri-dice-2-line:before { content: "\\f3f6";\n}\n.ri-dice-3-fill:before { content: "\\f3f7";\n}\n.ri-dice-3-line:before { content: "\\f3f8";\n}\n.ri-dice-4-fill:before { content: "\\f3f9";\n}\n.ri-dice-4-line:before { content: "\\f3fa";\n}\n.ri-dice-5-fill:before { content: "\\f3fb";\n}\n.ri-dice-5-line:before { content: "\\f3fc";\n}\n.ri-dice-6-fill:before { content: "\\f3fd";\n}\n.ri-dice-6-line:before { content: "\\f3fe";\n}\n.ri-dice-fill:before { content: "\\f3ff";\n}\n.ri-dice-line:before { content: "\\f400";\n}\n.ri-drinks-fill:before { content: "\\f401";\n}\n.ri-drinks-line:before { content: "\\f402";\n}\n.ri-equalizer-2-fill:before { content: "\\f403";\n}\n.ri-equalizer-2-line:before { content: "\\f404";\n}\n.ri-equalizer-3-fill:before { content: "\\f405";\n}\n.ri-equalizer-3-line:before { content: "\\f406";\n}\n.ri-eth-fill:before { content: "\\f407";\n}\n.ri-eth-line:before { content: "\\f408";\n}\n.ri-flower-fill:before { content: "\\f409";\n}\n.ri-flower-line:before { content: "\\f40a";\n}\n.ri-glasses-2-fill:before { content: "\\f40b";\n}\n.ri-glasses-2-line:before { content: "\\f40c";\n}\n.ri-glasses-fill:before { content: "\\f40d";\n}\n.ri-glasses-line:before { content: "\\f40e";\n}\n.ri-goggles-fill:before { content: "\\f40f";\n}\n.ri-goggles-line:before { content: "\\f410";\n}\n.ri-image-circle-fill:before { content: "\\f411";\n}\n.ri-image-circle-line:before { content: "\\f412";\n}\n.ri-info-i:before { content: "\\f413";\n}\n.ri-money-rupee-circle-fill:before { content: "\\f414";\n}\n.ri-money-rupee-circle-line:before { content: "\\f415";\n}\n.ri-news-fill:before { content: "\\f416";\n}\n.ri-news-line:before { content: "\\f417";\n}\n.ri-robot-3-fill:before { content: "\\f418";\n}\n.ri-robot-3-line:before { content: "\\f419";\n}\n.ri-share-2-fill:before { content: "\\f41a";\n}\n.ri-share-2-line:before { content: "\\f41b";\n}\n.ri-sofa-fill:before { content: "\\f41c";\n}\n.ri-sofa-line:before { content: "\\f41d";\n}\n.ri-svelte-fill:before { content: "\\f41e";\n}\n.ri-svelte-line:before { content: "\\f41f";\n}\n.ri-vk-fill:before { content: "\\f420";\n}\n.ri-vk-line:before { content: "\\f421";\n}\n.ri-xrp-fill:before { content: "\\f422";\n}\n.ri-xrp-line:before { content: "\\f423";\n}\n.ri-xtz-fill:before { content: "\\f424";\n}\n.ri-xtz-line:before { content: "\\f425";\n}\n.ri-archive-stack-fill:before { content: "\\f426";\n}\n.ri-archive-stack-line:before { content: "\\f427";\n}\n.ri-bowl-fill:before { content: "\\f428";\n}\n.ri-bowl-line:before { content: "\\f429";\n}\n.ri-calendar-view:before { content: "\\f42a";\n}\n.ri-carousel-view:before { content: "\\f42b";\n}\n.ri-code-block:before { content: "\\f42c";\n}\n.ri-color-filter-fill:before { content: "\\f42d";\n}\n.ri-color-filter-line:before { content: "\\f42e";\n}\n.ri-contacts-book-3-fill:before { content: "\\f42f";\n}\n.ri-contacts-book-3-line:before { content: "\\f430";\n}\n.ri-contract-fill:before { content: "\\f431";\n}\n.ri-contract-line:before { content: "\\f432";\n}\n.ri-drinks-2-fill:before { content: "\\f433";\n}\n.ri-drinks-2-line:before { content: "\\f434";\n}\n.ri-export-fill:before { content: "\\f435";\n}\n.ri-export-line:before { content: "\\f436";\n}\n.ri-file-check-fill:before { content: "\\f437";\n}\n.ri-file-check-line:before { content: "\\f438";\n}\n.ri-focus-mode:before { content: "\\f439";\n}\n.ri-folder-6-fill:before { content: "\\f43a";\n}\n.ri-folder-6-line:before { content: "\\f43b";\n}\n.ri-folder-check-fill:before { content: "\\f43c";\n}\n.ri-folder-check-line:before { content: "\\f43d";\n}\n.ri-folder-close-fill:before { content: "\\f43e";\n}\n.ri-folder-close-line:before { content: "\\f43f";\n}\n.ri-folder-cloud-fill:before { content: "\\f440";\n}\n.ri-folder-cloud-line:before { content: "\\f441";\n}\n.ri-gallery-view-2:before { content: "\\f442";\n}\n.ri-gallery-view:before { content: "\\f443";\n}\n.ri-hand:before { content: "\\f444";\n}\n.ri-import-fill:before { content: "\\f445";\n}\n.ri-import-line:before { content: "\\f446";\n}\n.ri-information-2-fill:before { content: "\\f447";\n}\n.ri-information-2-line:before { content: "\\f448";\n}\n.ri-kanban-view-2:before { content: "\\f449";\n}\n.ri-kanban-view:before { content: "\\f44a";\n}\n.ri-list-view:before { content: "\\f44b";\n}\n.ri-lock-star-fill:before { content: "\\f44c";\n}\n.ri-lock-star-line:before { content: "\\f44d";\n}\n.ri-puzzle-2-fill:before { content: "\\f44e";\n}\n.ri-puzzle-2-line:before { content: "\\f44f";\n}\n.ri-puzzle-fill:before { content: "\\f450";\n}\n.ri-puzzle-line:before { content: "\\f451";\n}\n.ri-ram-2-fill:before { content: "\\f452";\n}\n.ri-ram-2-line:before { content: "\\f453";\n}\n.ri-ram-fill:before { content: "\\f454";\n}\n.ri-ram-line:before { content: "\\f455";\n}\n.ri-receipt-fill:before { content: "\\f456";\n}\n.ri-receipt-line:before { content: "\\f457";\n}\n.ri-shadow-fill:before { content: "\\f458";\n}\n.ri-shadow-line:before { content: "\\f459";\n}\n.ri-sidebar-fold-fill:before { content: "\\f45a";\n}\n.ri-sidebar-fold-line:before { content: "\\f45b";\n}\n.ri-sidebar-unfold-fill:before { content: "\\f45c";\n}\n.ri-sidebar-unfold-line:before { content: "\\f45d";\n}\n.ri-slideshow-view:before { content: "\\f45e";\n}\n.ri-sort-alphabet-asc:before { content: "\\f45f";\n}\n.ri-sort-alphabet-desc:before { content: "\\f460";\n}\n.ri-sort-number-asc:before { content: "\\f461";\n}\n.ri-sort-number-desc:before { content: "\\f462";\n}\n.ri-stacked-view:before { content: "\\f463";\n}\n.ri-sticky-note-add-fill:before { content: "\\f464";\n}\n.ri-sticky-note-add-line:before { content: "\\f465";\n}\n.ri-swap-2-fill:before { content: "\\f466";\n}\n.ri-swap-2-line:before { content: "\\f467";\n}\n.ri-swap-3-fill:before { content: "\\f468";\n}\n.ri-swap-3-line:before { content: "\\f469";\n}\n.ri-table-3:before { content: "\\f46a";\n}\n.ri-table-view:before { content: "\\f46b";\n}\n.ri-text-block:before { content: "\\f46c";\n}\n.ri-text-snippet:before { content: "\\f46d";\n}\n.ri-timeline-view:before { content: "\\f46e";\n}\n.ri-blogger-fill:before { content: "\\f46f";\n}\n.ri-blogger-line:before { content: "\\f470";\n}\n.ri-chat-thread-fill:before { content: "\\f471";\n}\n.ri-chat-thread-line:before { content: "\\f472";\n}\n.ri-discount-percent-fill:before { content: "\\f473";\n}\n.ri-discount-percent-line:before { content: "\\f474";\n}\n.ri-exchange-2-fill:before { content: "\\f475";\n}\n.ri-exchange-2-line:before { content: "\\f476";\n}\n.ri-git-fork-fill:before { content: "\\f477";\n}\n.ri-git-fork-line:before { content: "\\f478";\n}\n.ri-input-field:before { content: "\\f479";\n}\n.ri-progress-1-fill:before { content: "\\f47a";\n}\n.ri-progress-1-line:before { content: "\\f47b";\n}\n.ri-progress-2-fill:before { content: "\\f47c";\n}\n.ri-progress-2-line:before { content: "\\f47d";\n}\n.ri-progress-3-fill:before { content: "\\f47e";\n}\n.ri-progress-3-line:before { content: "\\f47f";\n}\n.ri-progress-4-fill:before { content: "\\f480";\n}\n.ri-progress-4-line:before { content: "\\f481";\n}\n.ri-progress-5-fill:before { content: "\\f482";\n}\n.ri-progress-5-line:before { content: "\\f483";\n}\n.ri-progress-6-fill:before { content: "\\f484";\n}\n.ri-progress-6-line:before { content: "\\f485";\n}\n.ri-progress-7-fill:before { content: "\\f486";\n}\n.ri-progress-7-line:before { content: "\\f487";\n}\n.ri-progress-8-fill:before { content: "\\f488";\n}\n.ri-progress-8-line:before { content: "\\f489";\n}\n.ri-remix-run-fill:before { content: "\\f48a";\n}\n.ri-remix-run-line:before { content: "\\f48b";\n}\n.ri-signpost-fill:before { content: "\\f48c";\n}\n.ri-signpost-line:before { content: "\\f48d";\n}\n.ri-time-zone-fill:before { content: "\\f48e";\n}\n.ri-time-zone-line:before { content: "\\f48f";\n}\n.ri-arrow-down-wide-fill:before { content: "\\f490";\n}\n.ri-arrow-down-wide-line:before { content: "\\f491";\n}\n.ri-arrow-left-wide-fill:before { content: "\\f492";\n}\n.ri-arrow-left-wide-line:before { content: "\\f493";\n}\n.ri-arrow-right-wide-fill:before { content: "\\f494";\n}\n.ri-arrow-right-wide-line:before { content: "\\f495";\n}\n.ri-arrow-up-wide-fill:before { content: "\\f496";\n}\n.ri-arrow-up-wide-line:before { content: "\\f497";\n}\n.ri-bluesky-fill:before { content: "\\f498";\n}\n.ri-bluesky-line:before { content: "\\f499";\n}\n.ri-expand-height-fill:before { content: "\\f49a";\n}\n.ri-expand-height-line:before { content: "\\f49b";\n}\n.ri-expand-width-fill:before { content: "\\f49c";\n}\n.ri-expand-width-line:before { content: "\\f49d";\n}\n.ri-forward-end-fill:before { content: "\\f49e";\n}\n.ri-forward-end-line:before { content: "\\f49f";\n}\n.ri-forward-end-mini-fill:before { content: "\\f4a0";\n}\n.ri-forward-end-mini-line:before { content: "\\f4a1";\n}\n.ri-friendica-fill:before { content: "\\f4a2";\n}\n.ri-friendica-line:before { content: "\\f4a3";\n}\n.ri-git-pr-draft-fill:before { content: "\\f4a4";\n}\n.ri-git-pr-draft-line:before { content: "\\f4a5";\n}\n.ri-play-reverse-fill:before { content: "\\f4a6";\n}\n.ri-play-reverse-line:before { content: "\\f4a7";\n}\n.ri-play-reverse-mini-fill:before { content: "\\f4a8";\n}\n.ri-play-reverse-mini-line:before { content: "\\f4a9";\n}\n.ri-rewind-start-fill:before { content: "\\f4aa";\n}\n.ri-rewind-start-line:before { content: "\\f4ab";\n}\n.ri-rewind-start-mini-fill:before { content: "\\f4ac";\n}\n.ri-rewind-start-mini-line:before { content: "\\f4ad";\n}\n.ri-scroll-to-bottom-fill:before { content: "\\f4ae";\n}\n.ri-scroll-to-bottom-line:before { content: "\\f4af";\n}\n.ri-add-large-fill:before { content: "\\f4b0";\n}\n.ri-add-large-line:before { content: "\\f4b1";\n}\n.ri-aed-electrodes-fill:before { content: "\\f4b2";\n}\n.ri-aed-electrodes-line:before { content: "\\f4b3";\n}\n.ri-aed-fill:before { content: "\\f4b4";\n}\n.ri-aed-line:before { content: "\\f4b5";\n}\n.ri-alibaba-cloud-fill:before { content: "\\f4b6";\n}\n.ri-alibaba-cloud-line:before { content: "\\f4b7";\n}\n.ri-align-item-bottom-fill:before { content: "\\f4b8";\n}\n.ri-align-item-bottom-line:before { content: "\\f4b9";\n}\n.ri-align-item-horizontal-center-fill:before { content: "\\f4ba";\n}\n.ri-align-item-horizontal-center-line:before { content: "\\f4bb";\n}\n.ri-align-item-left-fill:before { content: "\\f4bc";\n}\n.ri-align-item-left-line:before { content: "\\f4bd";\n}\n.ri-align-item-right-fill:before { content: "\\f4be";\n}\n.ri-align-item-right-line:before { content: "\\f4bf";\n}\n.ri-align-item-top-fill:before { content: "\\f4c0";\n}\n.ri-align-item-top-line:before { content: "\\f4c1";\n}\n.ri-align-item-vertical-center-fill:before { content: "\\f4c2";\n}\n.ri-align-item-vertical-center-line:before { content: "\\f4c3";\n}\n.ri-apps-2-add-fill:before { content: "\\f4c4";\n}\n.ri-apps-2-add-line:before { content: "\\f4c5";\n}\n.ri-close-large-fill:before { content: "\\f4c6";\n}\n.ri-close-large-line:before { content: "\\f4c7";\n}\n.ri-collapse-diagonal-2-fill:before { content: "\\f4c8";\n}\n.ri-collapse-diagonal-2-line:before { content: "\\f4c9";\n}\n.ri-collapse-diagonal-fill:before { content: "\\f4ca";\n}\n.ri-collapse-diagonal-line:before { content: "\\f4cb";\n}\n.ri-dashboard-horizontal-fill:before { content: "\\f4cc";\n}\n.ri-dashboard-horizontal-line:before { content: "\\f4cd";\n}\n.ri-expand-diagonal-2-fill:before { content: "\\f4ce";\n}\n.ri-expand-diagonal-2-line:before { content: "\\f4cf";\n}\n.ri-expand-diagonal-fill:before { content: "\\f4d0";\n}\n.ri-expand-diagonal-line:before { content: "\\f4d1";\n}\n.ri-firebase-fill:before { content: "\\f4d2";\n}\n.ri-firebase-line:before { content: "\\f4d3";\n}\n.ri-flip-horizontal-2-fill:before { content: "\\f4d4";\n}\n.ri-flip-horizontal-2-line:before { content: "\\f4d5";\n}\n.ri-flip-horizontal-fill:before { content: "\\f4d6";\n}\n.ri-flip-horizontal-line:before { content: "\\f4d7";\n}\n.ri-flip-vertical-2-fill:before { content: "\\f4d8";\n}\n.ri-flip-vertical-2-line:before { content: "\\f4d9";\n}\n.ri-flip-vertical-fill:before { content: "\\f4da";\n}\n.ri-flip-vertical-line:before { content: "\\f4db";\n}\n.ri-formula:before { content: "\\f4dc";\n}\n.ri-function-add-fill:before { content: "\\f4dd";\n}\n.ri-function-add-line:before { content: "\\f4de";\n}\n.ri-goblet-2-fill:before { content: "\\f4df";\n}\n.ri-goblet-2-line:before { content: "\\f4e0";\n}\n.ri-golf-ball-fill:before { content: "\\f4e1";\n}\n.ri-golf-ball-line:before { content: "\\f4e2";\n}\n.ri-group-3-fill:before { content: "\\f4e3";\n}\n.ri-group-3-line:before { content: "\\f4e4";\n}\n.ri-heart-add-2-fill:before { content: "\\f4e5";\n}\n.ri-heart-add-2-line:before { content: "\\f4e6";\n}\n.ri-id-card-fill:before { content: "\\f4e7";\n}\n.ri-id-card-line:before { content: "\\f4e8";\n}\n.ri-information-off-fill:before { content: "\\f4e9";\n}\n.ri-information-off-line:before { content: "\\f4ea";\n}\n.ri-java-fill:before { content: "\\f4eb";\n}\n.ri-java-line:before { content: "\\f4ec";\n}\n.ri-layout-grid-2-fill:before { content: "\\f4ed";\n}\n.ri-layout-grid-2-line:before { content: "\\f4ee";\n}\n.ri-layout-horizontal-fill:before { content: "\\f4ef";\n}\n.ri-layout-horizontal-line:before { content: "\\f4f0";\n}\n.ri-layout-vertical-fill:before { content: "\\f4f1";\n}\n.ri-layout-vertical-line:before { content: "\\f4f2";\n}\n.ri-menu-fold-2-fill:before { content: "\\f4f3";\n}\n.ri-menu-fold-2-line:before { content: "\\f4f4";\n}\n.ri-menu-fold-3-fill:before { content: "\\f4f5";\n}\n.ri-menu-fold-3-line:before { content: "\\f4f6";\n}\n.ri-menu-fold-4-fill:before { content: "\\f4f7";\n}\n.ri-menu-fold-4-line:before { content: "\\f4f8";\n}\n.ri-menu-unfold-2-fill:before { content: "\\f4f9";\n}\n.ri-menu-unfold-2-line:before { content: "\\f4fa";\n}\n.ri-menu-unfold-3-fill:before { content: "\\f4fb";\n}\n.ri-menu-unfold-3-line:before { content: "\\f4fc";\n}\n.ri-menu-unfold-4-fill:before { content: "\\f4fd";\n}\n.ri-menu-unfold-4-line:before { content: "\\f4fe";\n}\n.ri-mobile-download-fill:before { content: "\\f4ff";\n}\n.ri-mobile-download-line:before { content: "\\f500";\n}\n.ri-nextjs-fill:before { content: "\\f501";\n}\n.ri-nextjs-line:before { content: "\\f502";\n}\n.ri-nodejs-fill:before { content: "\\f503";\n}\n.ri-nodejs-line:before { content: "\\f504";\n}\n.ri-pause-large-fill:before { content: "\\f505";\n}\n.ri-pause-large-line:before { content: "\\f506";\n}\n.ri-play-large-fill:before { content: "\\f507";\n}\n.ri-play-large-line:before { content: "\\f508";\n}\n.ri-play-reverse-large-fill:before { content: "\\f509";\n}\n.ri-play-reverse-large-line:before { content: "\\f50a";\n}\n.ri-police-badge-fill:before { content: "\\f50b";\n}\n.ri-police-badge-line:before { content: "\\f50c";\n}\n.ri-prohibited-2-fill:before { content: "\\f50d";\n}\n.ri-prohibited-2-line:before { content: "\\f50e";\n}\n.ri-shopping-bag-4-fill:before { content: "\\f50f";\n}\n.ri-shopping-bag-4-line:before { content: "\\f510";\n}\n.ri-snowflake-fill:before { content: "\\f511";\n}\n.ri-snowflake-line:before { content: "\\f512";\n}\n.ri-square-root:before { content: "\\f513";\n}\n.ri-stop-large-fill:before { content: "\\f514";\n}\n.ri-stop-large-line:before { content: "\\f515";\n}\n.ri-tailwind-css-fill:before { content: "\\f516";\n}\n.ri-tailwind-css-line:before { content: "\\f517";\n}\n.ri-tooth-fill:before { content: "\\f518";\n}\n.ri-tooth-line:before { content: "\\f519";\n}\n.ri-video-off-fill:before { content: "\\f51a";\n}\n.ri-video-off-line:before { content: "\\f51b";\n}\n.ri-video-on-fill:before { content: "\\f51c";\n}\n.ri-video-on-line:before { content: "\\f51d";\n}\n.ri-webhook-fill:before { content: "\\f51e";\n}\n.ri-webhook-line:before { content: "\\f51f";\n}\n.ri-weight-fill:before { content: "\\f520";\n}\n.ri-weight-line:before { content: "\\f521";\n}\n.ri-book-shelf-fill:before { content: "\\f522";\n}\n.ri-book-shelf-line:before { content: "\\f523";\n}\n.ri-brain-2-fill:before { content: "\\f524";\n}\n.ri-brain-2-line:before { content: "\\f525";\n}\n.ri-chat-search-fill:before { content: "\\f526";\n}\n.ri-chat-search-line:before { content: "\\f527";\n}\n.ri-chat-unread-fill:before { content: "\\f528";\n}\n.ri-chat-unread-line:before { content: "\\f529";\n}\n.ri-collapse-horizontal-fill:before { content: "\\f52a";\n}\n.ri-collapse-horizontal-line:before { content: "\\f52b";\n}\n.ri-collapse-vertical-fill:before { content: "\\f52c";\n}\n.ri-collapse-vertical-line:before { content: "\\f52d";\n}\n.ri-dna-fill:before { content: "\\f52e";\n}\n.ri-dna-line:before { content: "\\f52f";\n}\n.ri-dropper-fill:before { content: "\\f530";\n}\n.ri-dropper-line:before { content: "\\f531";\n}\n.ri-expand-diagonal-s-2-fill:before { content: "\\f532";\n}\n.ri-expand-diagonal-s-2-line:before { content: "\\f533";\n}\n.ri-expand-diagonal-s-fill:before { content: "\\f534";\n}\n.ri-expand-diagonal-s-line:before { content: "\\f535";\n}\n.ri-expand-horizontal-fill:before { content: "\\f536";\n}\n.ri-expand-horizontal-line:before { content: "\\f537";\n}\n.ri-expand-horizontal-s-fill:before { content: "\\f538";\n}\n.ri-expand-horizontal-s-line:before { content: "\\f539";\n}\n.ri-expand-vertical-fill:before { content: "\\f53a";\n}\n.ri-expand-vertical-line:before { content: "\\f53b";\n}\n.ri-expand-vertical-s-fill:before { content: "\\f53c";\n}\n.ri-expand-vertical-s-line:before { content: "\\f53d";\n}\n.ri-gemini-fill:before { content: "\\f53e";\n}\n.ri-gemini-line:before { content: "\\f53f";\n}\n.ri-reset-left-fill:before { content: "\\f540";\n}\n.ri-reset-left-line:before { content: "\\f541";\n}\n.ri-reset-right-fill:before { content: "\\f542";\n}\n.ri-reset-right-line:before { content: "\\f543";\n}\n.ri-stairs-fill:before { content: "\\f544";\n}\n.ri-stairs-line:before { content: "\\f545";\n}\n.ri-telegram-2-fill:before { content: "\\f546";\n}\n.ri-telegram-2-line:before { content: "\\f547";\n}\n.ri-triangular-flag-fill:before { content: "\\f548";\n}\n.ri-triangular-flag-line:before { content: "\\f549";\n}\n.ri-user-minus-fill:before { content: "\\f54a";\n}\n.ri-user-minus-line:before { content: "\\f54b";\n}\n.ri-account-box-2-fill:before { content: "\\f54c";\n}\n.ri-account-box-2-line:before { content: "\\f54d";\n}\n.ri-account-circle-2-fill:before { content: "\\f54e";\n}\n.ri-account-circle-2-line:before { content: "\\f54f";\n}\n.ri-alarm-snooze-fill:before { content: "\\f550";\n}\n.ri-alarm-snooze-line:before { content: "\\f551";\n}\n.ri-arrow-down-box-fill:before { content: "\\f552";\n}\n.ri-arrow-down-box-line:before { content: "\\f553";\n}\n.ri-arrow-left-box-fill:before { content: "\\f554";\n}\n.ri-arrow-left-box-line:before { content: "\\f555";\n}\n.ri-arrow-left-down-box-fill:before { content: "\\f556";\n}\n.ri-arrow-left-down-box-line:before { content: "\\f557";\n}\n.ri-arrow-left-up-box-fill:before { content: "\\f558";\n}\n.ri-arrow-left-up-box-line:before { content: "\\f559";\n}\n.ri-arrow-right-box-fill:before { content: "\\f55a";\n}\n.ri-arrow-right-box-line:before { content: "\\f55b";\n}\n.ri-arrow-right-down-box-fill:before { content: "\\f55c";\n}\n.ri-arrow-right-down-box-line:before { content: "\\f55d";\n}\n.ri-arrow-right-up-box-fill:before { content: "\\f55e";\n}\n.ri-arrow-right-up-box-line:before { content: "\\f55f";\n}\n.ri-arrow-up-box-fill:before { content: "\\f560";\n}\n.ri-arrow-up-box-line:before { content: "\\f561";\n}\n.ri-bar-chart-box-ai-fill:before { content: "\\f562";\n}\n.ri-bar-chart-box-ai-line:before { content: "\\f563";\n}\n.ri-brush-ai-fill:before { content: "\\f564";\n}\n.ri-brush-ai-line:before { content: "\\f565";\n}\n.ri-camera-ai-fill:before { content: "\\f566";\n}\n.ri-camera-ai-line:before { content: "\\f567";\n}\n.ri-chat-ai-fill:before { content: "\\f568";\n}\n.ri-chat-ai-line:before { content: "\\f569";\n}\n.ri-chat-smile-ai-fill:before { content: "\\f56a";\n}\n.ri-chat-smile-ai-line:before { content: "\\f56b";\n}\n.ri-chat-voice-ai-fill:before { content: "\\f56c";\n}\n.ri-chat-voice-ai-line:before { content: "\\f56d";\n}\n.ri-code-ai-fill:before { content: "\\f56e";\n}\n.ri-code-ai-line:before { content: "\\f56f";\n}\n.ri-color-filter-ai-fill:before { content: "\\f570";\n}\n.ri-color-filter-ai-line:before { content: "\\f571";\n}\n.ri-custom-size:before { content: "\\f572";\n}\n.ri-fediverse-fill:before { content: "\\f573";\n}\n.ri-fediverse-line:before { content: "\\f574";\n}\n.ri-flag-off-fill:before { content: "\\f575";\n}\n.ri-flag-off-line:before { content: "\\f576";\n}\n.ri-home-9-fill:before { content: "\\f577";\n}\n.ri-home-9-line:before { content: "\\f578";\n}\n.ri-image-ai-fill:before { content: "\\f579";\n}\n.ri-image-ai-line:before { content: "\\f57a";\n}\n.ri-image-circle-ai-fill:before { content: "\\f57b";\n}\n.ri-image-circle-ai-line:before { content: "\\f57c";\n}\n.ri-info-card-fill:before { content: "\\f57d";\n}\n.ri-info-card-line:before { content: "\\f57e";\n}\n.ri-landscape-ai-fill:before { content: "\\f57f";\n}\n.ri-landscape-ai-line:before { content: "\\f580";\n}\n.ri-letter-spacing-2:before { content: "\\f581";\n}\n.ri-line-height-2:before { content: "\\f582";\n}\n.ri-mail-ai-fill:before { content: "\\f583";\n}\n.ri-mail-ai-line:before { content: "\\f584";\n}\n.ri-mic-2-ai-fill:before { content: "\\f585";\n}\n.ri-mic-2-ai-line:before { content: "\\f586";\n}\n.ri-mic-ai-fill:before { content: "\\f587";\n}\n.ri-mic-ai-line:before { content: "\\f588";\n}\n.ri-movie-ai-fill:before { content: "\\f589";\n}\n.ri-movie-ai-line:before { content: "\\f58a";\n}\n.ri-music-ai-fill:before { content: "\\f58b";\n}\n.ri-music-ai-line:before { content: "\\f58c";\n}\n.ri-notification-snooze-fill:before { content: "\\f58d";\n}\n.ri-notification-snooze-line:before { content: "\\f58e";\n}\n.ri-php-fill:before { content: "\\f58f";\n}\n.ri-php-line:before { content: "\\f590";\n}\n.ri-pix-fill:before { content: "\\f591";\n}\n.ri-pix-line:before { content: "\\f592";\n}\n.ri-pulse-ai-fill:before { content: "\\f593";\n}\n.ri-pulse-ai-line:before { content: "\\f594";\n}\n.ri-quill-pen-ai-fill:before { content: "\\f595";\n}\n.ri-quill-pen-ai-line:before { content: "\\f596";\n}\n.ri-speak-ai-fill:before { content: "\\f597";\n}\n.ri-speak-ai-line:before { content: "\\f598";\n}\n.ri-star-off-fill:before { content: "\\f599";\n}\n.ri-star-off-line:before { content: "\\f59a";\n}\n.ri-translate-ai-2:before { content: "\\f59b";\n}\n.ri-translate-ai:before { content: "\\f59c";\n}\n.ri-user-community-fill:before { content: "\\f59d";\n}\n.ri-user-community-line:before { content: "\\f59e";\n}\n.ri-vercel-fill:before { content: "\\f59f";\n}\n.ri-vercel-line:before { content: "\\f5a0";\n}\n.ri-video-ai-fill:before { content: "\\f5a1";\n}\n.ri-video-ai-line:before { content: "\\f5a2";\n}\n.ri-video-on-ai-fill:before { content: "\\f5a3";\n}\n.ri-video-on-ai-line:before { content: "\\f5a4";\n}\n.ri-voice-ai-fill:before { content: "\\f5a5";\n}\n.ri-voice-ai-line:before { content: "\\f5a6";\n}\n.ri-ai-generate-2:before { content: "\\f5a7";\n}\n.ri-ai-generate-text:before { content: "\\f5a8";\n}\n.ri-anthropic-fill:before { content: "\\f5a9";\n}\n.ri-anthropic-line:before { content: "\\f5aa";\n}\n.ri-apps-2-ai-fill:before { content: "\\f5ab";\n}\n.ri-apps-2-ai-line:before { content: "\\f5ac";\n}\n.ri-camera-lens-ai-fill:before { content: "\\f5ad";\n}\n.ri-camera-lens-ai-line:before { content: "\\f5ae";\n}\n.ri-clapperboard-ai-fill:before { content: "\\f5af";\n}\n.ri-clapperboard-ai-line:before { content: "\\f5b0";\n}\n.ri-claude-fill:before { content: "\\f5b1";\n}\n.ri-claude-line:before { content: "\\f5b2";\n}\n.ri-closed-captioning-ai-fill:before { content: "\\f5b3";\n}\n.ri-closed-captioning-ai-line:before { content: "\\f5b4";\n}\n.ri-dvd-ai-fill:before { content: "\\f5b5";\n}\n.ri-dvd-ai-line:before { content: "\\f5b6";\n}\n.ri-film-ai-fill:before { content: "\\f5b7";\n}\n.ri-film-ai-line:before { content: "\\f5b8";\n}\n.ri-font-size-ai:before { content: "\\f5b9";\n}\n.ri-mixtral-fill:before { content: "\\f5ba";\n}\n.ri-mixtral-line:before { content: "\\f5bb";\n}\n.ri-movie-2-ai-fill:before { content: "\\f5bc";\n}\n.ri-movie-2-ai-line:before { content: "\\f5bd";\n}\n.ri-mv-ai-fill:before { content: "\\f5be";\n}\n.ri-mv-ai-line:before { content: "\\f5bf";\n}\n.ri-perplexity-fill:before { content: "\\f5c0";\n}\n.ri-perplexity-line:before { content: "\\f5c1";\n}\n.ri-poker-clubs-fill:before { content: "\\f5c2";\n}\n.ri-poker-clubs-line:before { content: "\\f5c3";\n}\n.ri-poker-diamonds-fill:before { content: "\\f5c4";\n}\n.ri-poker-diamonds-line:before { content: "\\f5c5";\n}\n.ri-poker-hearts-fill:before { content: "\\f5c6";\n}\n.ri-poker-hearts-line:before { content: "\\f5c7";\n}\n.ri-poker-spades-fill:before { content: "\\f5c8";\n}\n.ri-poker-spades-line:before { content: "\\f5c9";\n}\n.ri-safe-3-fill:before { content: "\\f5ca";\n}\n.ri-safe-3-line:before { content: "\\f5cb";\n}\n.ri-accessibility-fill:before { content: "\\f5cc";\n}\n.ri-accessibility-line:before { content: "\\f5cd";\n}\n.ri-alarm-add-fill:before { content: "\\f5ce";\n}\n.ri-alarm-add-line:before { content: "\\f5cf";\n}\n.ri-arrow-down-long-fill:before { content: "\\f5d0";\n}\n.ri-arrow-down-long-line:before { content: "\\f5d1";\n}\n.ri-arrow-left-down-long-fill:before { content: "\\f5d2";\n}\n.ri-arrow-left-down-long-line:before { content: "\\f5d3";\n}\n.ri-arrow-left-long-fill:before { content: "\\f5d4";\n}\n.ri-arrow-left-long-line:before { content: "\\f5d5";\n}\n.ri-arrow-left-up-long-fill:before { content: "\\f5d6";\n}\n.ri-arrow-left-up-long-line:before { content: "\\f5d7";\n}\n.ri-arrow-right-down-long-fill:before { content: "\\f5d8";\n}\n.ri-arrow-right-down-long-line:before { content: "\\f5d9";\n}\n.ri-arrow-right-long-fill:before { content: "\\f5da";\n}\n.ri-arrow-right-long-line:before { content: "\\f5db";\n}\n.ri-arrow-right-up-long-fill:before { content: "\\f5dc";\n}\n.ri-arrow-right-up-long-line:before { content: "\\f5dd";\n}\n.ri-arrow-up-long-fill:before { content: "\\f5de";\n}\n.ri-arrow-up-long-line:before { content: "\\f5df";\n}\n.ri-chess-fill:before { content: "\\f5e0";\n}\n.ri-chess-line:before { content: "\\f5e1";\n}\n.ri-diamond-fill:before { content: "\\f5e2";\n}\n.ri-diamond-line:before { content: "\\f5e3";\n}\n.ri-diamond-ring-fill:before { content: "\\f5e4";\n}\n.ri-diamond-ring-line:before { content: "\\f5e5";\n}\n.ri-figma-fill:before { content: "\\f5e6";\n}\n.ri-figma-line:before { content: "\\f5e7";\n}\n.ri-firefox-browser-fill:before { content: "\\f5e8";\n}\n.ri-firefox-browser-line:before { content: "\\f5e9";\n}\n.ri-jewelry-fill:before { content: "\\f5ea";\n}\n.ri-jewelry-line:before { content: "\\f5eb";\n}\n.ri-multi-image-fill:before { content: "\\f5ec";\n}\n.ri-multi-image-line:before { content: "\\f5ed";\n}\n.ri-no-credit-card-fill:before { content: "\\f5ee";\n}\n.ri-no-credit-card-line:before { content: "\\f5ef";\n}\n.ri-service-bell-fill:before { content: "\\f5f0";\n}\n.ri-service-bell-line:before { content: "\\f5f1";\n}\n.ri-ai-agent-fill:before { content: "\\f5f2";\n}\n.ri-ai-agent-line:before { content: "\\f5f3";\n}\n.ri-ai-generate-2-fill:before { content: "\\f5f4";\n}\n.ri-ai-generate-2-line:before { content: "\\f5f5";\n}\n.ri-ai-generate-3d-fill:before { content: "\\f5f6";\n}\n.ri-ai-generate-3d-line:before { content: "\\f5f7";\n}\n.ri-ai:before { content: "\\f5f8";\n}\n.ri-apps-ai-fill:before { content: "\\f5f9";\n}\n.ri-apps-ai-line:before { content: "\\f5fa";\n}\n.ri-atom-fill:before { content: "\\f5fb";\n}\n.ri-atom-line:before { content: "\\f5fc";\n}\n.ri-book-ai-fill:before { content: "\\f5fd";\n}\n.ri-book-ai-line:before { content: "\\f5fe";\n}\n.ri-brain-3-fill:before { content: "\\f5ff";\n}\n.ri-brain-3-line:before { content: "\\f600";\n}\n.ri-brain-ai-3-fill:before { content: "\\f601";\n}\n.ri-brain-ai-3-line:before { content: "\\f602";\n}\n.ri-brush-ai-3-fill:before { content: "\\f603";\n}\n.ri-brush-ai-3-line:before { content: "\\f604";\n}\n.ri-camera-4-fill:before { content: "\\f605";\n}\n.ri-camera-4-line:before { content: "\\f606";\n}\n.ri-camera-ai-2-fill:before { content: "\\f607";\n}\n.ri-camera-ai-2-line:before { content: "\\f608";\n}\n.ri-chat-ai-2-fill:before { content: "\\f609";\n}\n.ri-chat-ai-2-line:before { content: "\\f60a";\n}\n.ri-chat-ai-3-fill:before { content: "\\f60b";\n}\n.ri-chat-ai-3-line:before { content: "\\f60c";\n}\n.ri-chat-ai-4-fill:before { content: "\\f60d";\n}\n.ri-chat-ai-4-line:before { content: "\\f60e";\n}\n.ri-chat-smile-ai-3-fill:before { content: "\\f60f";\n}\n.ri-chat-smile-ai-3-line:before { content: "\\f610";\n}\n.ri-deepseek-fill:before { content: "\\f611";\n}\n.ri-deepseek-line:before { content: "\\f612";\n}\n.ri-file-ai-2-fill:before { content: "\\f613";\n}\n.ri-file-ai-2-line:before { content: "\\f614";\n}\n.ri-file-ai-fill:before { content: "\\f615";\n}\n.ri-file-ai-line:before { content: "\\f616";\n}\n.ri-function-ai-fill:before { content: "\\f617";\n}\n.ri-function-ai-line:before { content: "\\f618";\n}\n.ri-game-2-fill:before { content: "\\f619";\n}\n.ri-game-2-line:before { content: "\\f61a";\n}\n.ri-goblet-broken-fill:before { content: "\\f61b";\n}\n.ri-goblet-broken-line:before { content: "\\f61c";\n}\n.ri-lightbulb-ai-fill:before { content: "\\f61d";\n}\n.ri-lightbulb-ai-line:before { content: "\\f61e";\n}\n.ri-loop-left-ai-fill:before { content: "\\f61f";\n}\n.ri-loop-left-ai-line:before { content: "\\f620";\n}\n.ri-loop-right-ai-fill:before { content: "\\f621";\n}\n.ri-loop-right-ai-line:before { content: "\\f622";\n}\n.ri-message-ai-3-fill:before { content: "\\f623";\n}\n.ri-message-ai-3-line:before { content: "\\f624";\n}\n.ri-painting-ai-fill:before { content: "\\f625";\n}\n.ri-painting-ai-line:before { content: "\\f626";\n}\n.ri-painting-fill:before { content: "\\f627";\n}\n.ri-painting-line:before { content: "\\f628";\n}\n.ri-pencil-ai-2-fill:before { content: "\\f629";\n}\n.ri-pencil-ai-2-line:before { content: "\\f62a";\n}\n.ri-pencil-ai-fill:before { content: "\\f62b";\n}\n.ri-pencil-ai-line:before { content: "\\f62c";\n}\n.ri-remix-fill:before { content: "\\f62d";\n}\n.ri-remix-line:before { content: "\\f62e";\n}\n.ri-search-ai-2-fill:before { content: "\\f62f";\n}\n.ri-search-ai-2-line:before { content: "\\f630";\n}\n.ri-search-ai-3-fill:before { content: "\\f631";\n}\n.ri-search-ai-3-line:before { content: "\\f632";\n}\n.ri-search-ai-4-fill:before { content: "\\f633";\n}\n.ri-search-ai-4-line:before { content: "\\f634";\n}\n.ri-search-ai-fill:before { content: "\\f635";\n}\n.ri-search-ai-line:before { content: "\\f636";\n}\n.ri-speech-to-text-fill:before { content: "\\f637";\n}\n.ri-speech-to-text-line:before { content: "\\f638";\n}\n.ri-target-fill:before { content: "\\f639";\n}\n.ri-target-line:before { content: "\\f63a";\n}\n.ri-text-to-speech-fill:before { content: "\\f63b";\n}\n.ri-text-to-speech-line:before { content: "\\f63c";\n}\n.ri-wrench-fill:before { content: "\\f63d";\n}\n.ri-wrench-line:before { content: "\\f63e";\n}\n.ri-area-chart-fill:before { content: "\\f63f";\n}\n.ri-area-chart-line:before { content: "\\f640";\n}\n.ri-baseball-fill:before { content: "\\f641";\n}\n.ri-baseball-line:before { content: "\\f642";\n}\n.ri-binoculars-fill:before { content: "\\f643";\n}\n.ri-binoculars-line:before { content: "\\f644";\n}\n.ri-cursor-hand:before { content: "\\f645";\n}\n.ri-emotion-add-fill:before { content: "\\f646";\n}\n.ri-emotion-add-line:before { content: "\\f647";\n}\n.ri-file-scan-fill:before { content: "\\f648";\n}\n.ri-file-scan-line:before { content: "\\f649";\n}\n.ri-fiverr-fill:before { content: "\\f64a";\n}\n.ri-fiverr-line:before { content: "\\f64b";\n}\n.ri-font-serif:before { content: "\\f64c";\n}\n.ri-ghost-3-fill:before { content: "\\f64d";\n}\n.ri-ghost-3-line:before { content: "\\f64e";\n}\n.ri-gitee-fill:before { content: "\\f64f";\n}\n.ri-gitee-line:before { content: "\\f650";\n}\n.ri-global-off-fill:before { content: "\\f651";\n}\n.ri-global-off-line:before { content: "\\f652";\n}\n.ri-image-download-fill:before { content: "\\f653";\n}\n.ri-image-download-line:before { content: "\\f654";\n}\n.ri-image-upload-fill:before { content: "\\f655";\n}\n.ri-image-upload-line:before { content: "\\f656";\n}\n.ri-issues-fill:before { content: "\\f657";\n}\n.ri-issues-line:before { content: "\\f658";\n}\n.ri-issues-reopen-fill:before { content: "\\f659";\n}\n.ri-issues-reopen-line:before { content: "\\f65a";\n}\n.ri-network-error-fill:before { content: "\\f65b";\n}\n.ri-network-error-line:before { content: "\\f65c";\n}\n.ri-network-fill:before { content: "\\f65d";\n}\n.ri-network-line:before { content: "\\f65e";\n}\n.ri-network-off-fill:before { content: "\\f65f";\n}\n.ri-network-off-line:before { content: "\\f660";\n}\n.ri-piano-fill:before { content: "\\f661";\n}\n.ri-piano-grand-fill:before { content: "\\f662";\n}\n.ri-piano-grand-line:before { content: "\\f663";\n}\n.ri-piano-line:before { content: "\\f664";\n}\n.ri-plug-3-fill:before { content: "\\f665";\n}\n.ri-plug-3-line:before { content: "\\f666";\n}\n.ri-send-ins-fill:before { content: "\\f667";\n}\n.ri-send-ins-line:before { content: "\\f668";\n}\n.ri-signal-cellular-1-fill:before { content: "\\f669";\n}\n.ri-signal-cellular-1-line:before { content: "\\f66a";\n}\n.ri-signal-cellular-2-fill:before { content: "\\f66b";\n}\n.ri-signal-cellular-2-line:before { content: "\\f66c";\n}\n.ri-signal-cellular-3-fill:before { content: "\\f66d";\n}\n.ri-signal-cellular-3-line:before { content: "\\f66e";\n}\n.ri-signal-cellular-off-fill:before { content: "\\f66f";\n}\n.ri-signal-cellular-off-line:before { content: "\\f670";\n}\n.ri-stacked-chart-fill:before { content: "\\f671";\n}\n.ri-stacked-chart-line:before { content: "\\f672";\n}\n.ri-upwork-fill:before { content: "\\f673";\n}\n.ri-upwork-line:before { content: "\\f674";\n}\n.ri-brain-4-fill:before { content: "\\f675";\n}\n.ri-brain-4-line:before { content: "\\f676";\n}\n.ri-certificate-2-fill:before { content: "\\f677";\n}\n.ri-certificate-2-line:before { content: "\\f678";\n}\n.ri-certificate-fill:before { content: "\\f679";\n}\n.ri-certificate-line:before { content: "\\f67a";\n}\n.ri-cookie-fill:before { content: "\\f67b";\n}\n.ri-cookie-line:before { content: "\\f67c";\n}\n.ri-cursor-ai-fill:before { content: "\\f67d";\n}\n.ri-cursor-ai-line:before { content: "\\f67e";\n}\n.ri-draw-fill:before { content: "\\f67f";\n}\n.ri-draw-line:before { content: "\\f680";\n}\n.ri-ghost-4-fill:before { content: "\\f681";\n}\n.ri-ghost-4-line:before { content: "\\f682";\n}\n.ri-gitbook-fill:before { content: "\\f683";\n}\n.ri-gitbook-line:before { content: "\\f684";\n}\n.ri-grok-ai-fill:before { content: "\\f685";\n}\n.ri-grok-ai-line:before { content: "\\f686";\n}\n.ri-hand-2:before { content: "\\f687";\n}\n.ri-megaphone-2-fill:before { content: "\\f688";\n}\n.ri-megaphone-2-line:before { content: "\\f689";\n}\n.ri-microsoft-copilot-fill:before { content: "\\f68a";\n}\n.ri-microsoft-copilot-line:before { content: "\\f68b";\n}\n.ri-mosaic-fill:before { content: "\\f68c";\n}\n.ri-mosaic-line:before { content: "\\f68d";\n}\n.ri-qr-scan-ai-fill:before { content: "\\f68e";\n}\n.ri-qr-scan-ai-line:before { content: "\\f68f";\n}\n.ri-qwen-ai-fill:before { content: "\\f690";\n}\n.ri-qwen-ai-line:before { content: "\\f691";\n}\n.ri-reddit-2-fill:before { content: "\\f692";\n}\n.ri-reddit-2-line:before { content: "\\f693";\n}\n.ri-sim-card-warning-fill:before { content: "\\f694";\n}\n.ri-sim-card-warning-line:before { content: "\\f695";\n}\n.ri-space-ship-2-fill:before { content: "\\f696";\n}\n.ri-space-ship-2-line:before { content: "\\f697";\n}\n.ri-subreddit-fill:before { content: "\\f698";\n}\n.ri-subreddit-line:before { content: "\\f699";\n}\n.ri-zhipu-ai-fill:before { content: "\\f69a";\n}\n.ri-zhipu-ai-line:before { content: "\\f69b";\n}\n.ri-connector-fill:before { content: "\\f69c";\n}\n.ri-connector-line:before { content: "\\f69d";\n}\n\n';
const _style_1 = "\n/* ---- :host 主题令牌 (02-技术方案 §8.1: --ia-* 12 令牌) 与 --app-* 映射 ----\n * 宿主可在元素或 document root 上覆写 --ia-*; init({ theme }) 亦可全局注入。 */\n:host {\n  /* 默认令牌 */\n  --ia-primary: #409eff;\n  --ia-primary-contrast: #ffffff;\n  --ia-bg: #ffffff;\n  --ia-bg-card: #ffffff;\n  --ia-bg-muted: #f5f5f7;\n  --ia-text: #303133;\n  --ia-text-secondary: #606266;\n  --ia-text-tertiary: #a8abb2;\n  --ia-separator: #e4e7ed;\n  --ia-danger: #f56c6c;\n  --ia-warning: #e6a23c;\n  --ia-success: #67c23a;\n\n  /* 组件消费的 --app-* 映射 (源组件沿用宿主 --app-* 变量名) */\n  --app-primary: var(--ia-primary);\n  --app-on-primary: var(--ia-primary-contrast);\n  --app-bg: var(--ia-bg);\n  --app-bg-card: var(--ia-bg-card);\n  --app-bg-muted: var(--ia-bg-muted);\n  --app-text: var(--ia-text);\n  --app-text-secondary: var(--ia-text-secondary);\n  --app-text-tertiary: var(--ia-text-tertiary);\n  --app-separator: var(--ia-separator);\n  --app-color-danger: var(--ia-danger);\n  --app-color-warning: var(--ia-warning);\n  --app-color-success: var(--ia-success);\n\n  display: block;\n  height: 100%;\n  min-height: 320px;\n  background: var(--ia-bg);\n  color: var(--ia-text);\n  font-family: system-ui, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;\n}\n*,\n*::before,\n*::after {\n  box-sizing: border-box;\n}\n.ia-chat-root {\n  height: 100%;\n  min-height: 0;\n}\n.ia-chat-root__placeholder {\n  height: 100%;\n  display: flex;\n  flex-direction: column;\n  align-items: center;\n  justify-content: center;\n  gap: 6px;\n  padding: 24px;\n  text-align: center;\n  color: var(--ia-text-secondary);\n  font-size: 13px;\n}\n.ia-chat-root__placeholder-desc {\n  margin: 0;\n  font-size: 11px;\n  color: var(--ia-text-tertiary);\n}\n";
const InnerAgentChat = /* @__PURE__ */ _export_sfc(_sfc_main, [["styles", [_style_0, _style_1]]]);
const InnerAgentChatElement = /* @__PURE__ */ defineCustomElement(InnerAgentChat, {
  configureApp(app) {
    app.use(createPinia());
  }
});
function registerInnerAgentChat(tagName = "inneragent-chat") {
  if (typeof customElements === "undefined") {
    throw new Error("<inneragent-chat> requires a browser environment with customElements");
  }
  if (!customElements.get(tagName)) {
    customElements.define(tagName, InnerAgentChatElement);
  }
}
const IA_BRIDGE_NAMESPACE = "inneragent.bridge";
const IA_BRIDGE_VERSION = 1;
const BRIDGE_NONCE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
function createNonce() {
  let nonce = "";
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) nonce += BRIDGE_NONCE_ALPHABET[byte % BRIDGE_NONCE_ALPHABET.length];
    return nonce;
  }
  for (let i = 0; i < 16; i += 1) {
    nonce += BRIDGE_NONCE_ALPHABET[Math.floor(Math.random() * BRIDGE_NONCE_ALPHABET.length)];
  }
  return nonce;
}
function createMessage(type, payload, ack) {
  const message = {
    ns: IA_BRIDGE_NAMESPACE,
    v: IA_BRIDGE_VERSION,
    type,
    nonce: createNonce()
  };
  if (ack !== void 0) message.ack = ack;
  if (payload !== void 0) message.payload = payload;
  return message;
}
const KNOWN_TYPES = /* @__PURE__ */ new Set([
  "hello",
  "ready",
  "token",
  "token-request",
  "context",
  "set-theme",
  "event",
  "ack"
]);
function isBridgeEnvelope(data) {
  if (data === null || typeof data !== "object") return false;
  const candidate = data;
  if (candidate.ns !== IA_BRIDGE_NAMESPACE) return false;
  if (candidate.v !== IA_BRIDGE_VERSION) return false;
  if (typeof candidate.type !== "string" || !KNOWN_TYPES.has(candidate.type)) return false;
  if (typeof candidate.nonce !== "string" || candidate.nonce.length === 0) return false;
  if (candidate.ack !== void 0 && typeof candidate.ack !== "string") return false;
  return true;
}
function windowTransport(options) {
  const { win } = options;
  const resolveRemote = () => {
    const remote = typeof options.remote === "function" ? options.remote() : options.remote;
    if (!remote) throw new Error("inneragent bridge: remote window is not available yet");
    return remote;
  };
  return {
    post(message, targetOrigin) {
      if (targetOrigin === "*") {
        throw new Error('inneragent bridge: targetOrigin "*" is forbidden (token 安全: 显式 origin 校验)');
      }
      resolveRemote().postMessage(message, targetOrigin);
    },
    onMessage(handler) {
      const listener = (event) => {
        handler({ origin: event.origin, data: event.data, source: event.source ?? null });
      };
      win.addEventListener("message", listener);
      return () => win.removeEventListener("message", listener);
    }
  };
}
function createMemoryTransportPair(originA = "https://host.example", originB = "https://frame.example") {
  const listeners = { a: /* @__PURE__ */ new Set(), b: /* @__PURE__ */ new Set() };
  const delivered = [];
  function makeTransport(self2) {
    const peer = self2 === "a" ? "b" : "a";
    const selfOrigin = self2 === "a" ? originA : originB;
    return {
      post(message) {
        delivered.push({ from: self2, to: peer, message });
        for (const handler of listeners[peer]) {
          handler({ origin: selfOrigin, data: structuredCloneSafe(message), source: null });
        }
      },
      onMessage(handler) {
        listeners[self2].add(handler);
        return () => listeners[self2].delete(handler);
      }
    };
  }
  return {
    a: makeTransport("a"),
    b: makeTransport("b"),
    inject(side, data, origin) {
      for (const handler of listeners[side]) {
        handler({ origin, data, source: null });
      }
    },
    log: () => delivered.map((entry) => ({ ...entry }))
  };
}
function structuredCloneSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
let active = null;
function __resetIframeAgentForTests() {
  active = null;
}
function mountIframeAgent(options = {}) {
  if (active) {
    throw new Error("inneragent iframe child: mountIframeAgent already called (destroy 后可重挂)");
  }
  const allowedOrigins = new Set(
    options.allowedParentOrigins ?? (typeof location !== "undefined" && location.origin ? [location.origin] : [])
  );
  const outboundOrigin = options.allowedParentOrigins?.[0] ?? (typeof location !== "undefined" && location.origin ? location.origin : "");
  if (allowedOrigins.size === 0 || !outboundOrigin) {
    throw new Error("inneragent iframe child: 无法确定宿主来源 (请配置 allowedParentOrigins)");
  }
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 15e3;
  const helloRetryIntervalMs = options.helloRetryIntervalMs ?? 400;
  const tokenAckTimeoutMs = options.tokenAckTimeoutMs ?? 1e4;
  let destroyed = false;
  let status = "handshaking";
  let rejectedCount = 0;
  let lastHelloNonce = null;
  let initialized = false;
  let tokenCache = void 0;
  const pendingTokens = /* @__PURE__ */ new Set();
  const transport = options.transport ?? windowTransport({ win: window, remote: window.parent });
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve2, reject) => {
    resolveReady = resolve2;
    rejectReady = reject;
  });
  void ready.catch(() => {
  });
  function emit2(event) {
    if (destroyed) return;
    try {
      transport.post(createMessage("event", event), outboundOrigin);
    } catch {
    }
  }
  function settlePendingTokens(token) {
    for (const pending of pendingTokens) {
      clearTimeout(pending.timer);
      pending.resolve(token);
    }
    pendingTokens.clear();
    tokenCache = token;
  }
  function requestToken(reason) {
    return new Promise((resolve2) => {
      if (destroyed) {
        resolve2(null);
        return;
      }
      const pending = {
        resolve: resolve2,
        timer: setTimeout(() => {
          pendingTokens.delete(pending);
          resolve2(null);
        }, tokenAckTimeoutMs)
      };
      pendingTokens.add(pending);
      transport.post(
        createMessage("token-request", { reason }),
        outboundOrigin
      );
    });
  }
  async function bridgeTokenGetter() {
    if (tokenCache !== void 0) return tokenCache;
    return requestToken("initial");
  }
  function requestTokenRefresh() {
    tokenCache = void 0;
    return requestToken("refresh");
  }
  function sendHello() {
    if (destroyed || status !== "handshaking") return;
    const hello = createMessage("hello", { protocolVersion: IA_BRIDGE_VERSION });
    lastHelloNonce = hello.nonce;
    transport.post(hello, outboundOrigin);
  }
  const handshakeTimer = setTimeout(() => {
    if (status === "handshaking" && !destroyed) {
      status = "failed";
      emit2({ kind: "error", code: "handshake-timeout", message: "handshake timeout", fatal: true });
      rejectReady(new Error("inneragent iframe child: handshake timeout (宿主未应答 hello)"));
    }
  }, handshakeTimeoutMs);
  const helloTimer = setInterval(sendHello, helloRetryIntervalMs);
  function resolveTarget() {
    if (options.target === void 0) {
      if (typeof document === "undefined" || !document.body) {
        throw new Error("inneragent iframe child: target is required (no document.body)");
      }
      return document.body;
    }
    if (typeof options.target === "string") {
      const found = document.querySelector(options.target);
      if (!found) throw new Error(`inneragent iframe child: target "${options.target}" not found`);
      return found;
    }
    return options.target;
  }
  function mountElement(target) {
    if (options.elementFactory) {
      target.appendChild(options.elementFactory());
      return;
    }
    registerInnerAgentChat();
    const element = document.createElement("inneragent-chat");
    element.setAttribute("view", "chat");
    target.appendChild(element);
  }
  async function bootstrap(payload) {
    initialized = true;
    const appKey = options.appKey ?? payload.appKey;
    if (!appKey) {
      throw new Error("inneragent iframe child: appKey missing (宿主 ready 载荷或 options.appKey 必须提供)");
    }
    if (payload.theme) applyTheme(payload.theme);
    if (payload.locale) setIaLocale(payload.locale);
    init({
      appKey,
      tokenGetter: bridgeTokenGetter,
      ...payload.agentType !== void 0 ? { agentType: payload.agentType } : {},
      ...payload.baseURL !== void 0 ? { baseURL: payload.baseURL } : {}
    });
    setAssistantEventHooks({
      onRunTerminal: () => emit2({ kind: "run-terminal" }),
      onToolFinished: (toolName) => emit2({ kind: "tool-finished", toolName }),
      onUnauthorized: () => {
        tokenCache = void 0;
        void requestToken("refresh");
      }
    });
    await requestToken("initial");
    if (destroyed) return;
    mountElement(resolveTarget());
    status = "ready";
    emit2({ kind: "status", status: "ready" });
    resolveReady();
  }
  function ackMessage(nonce) {
    transport.post(createMessage("ack", void 0, nonce), outboundOrigin);
  }
  const offMessage = transport.onMessage((incoming) => {
    if (destroyed) return;
    if (!isBridgeEnvelope(incoming.data)) return;
    if (!allowedOrigins.has(incoming.origin)) {
      rejectedCount += 1;
      return;
    }
    const message = incoming.data;
    switch (message.type) {
      case "ready": {
        if (lastHelloNonce === null || message.ack !== lastHelloNonce) {
          rejectedCount += 1;
          return;
        }
        if (status !== "handshaking") return;
        clearInterval(helloTimer);
        clearTimeout(handshakeTimer);
        void bootstrap(message.payload).catch((error) => {
          status = "failed";
          emit2({
            kind: "error",
            code: "bootstrap-failed",
            message: error instanceof Error ? error.message : String(error),
            fatal: true
          });
          rejectReady(error instanceof Error ? error : new Error(String(error)));
        });
        break;
      }
      case "token": {
        const payload = message.payload;
        settlePendingTokens(payload.token);
        ackMessage(message.nonce);
        break;
      }
      case "context": {
        const payload = message.payload ?? {};
        setRunContext({ page: payload.page, object: payload.object });
        ackMessage(message.nonce);
        break;
      }
      case "set-theme": {
        const payload = message.payload ?? {};
        applyTheme(payload.tokens ?? {});
        ackMessage(message.nonce);
        break;
      }
    }
  });
  const handle = {
    ready,
    get status() {
      return status;
    },
    get rejectedMessageCount() {
      return rejectedCount;
    },
    requestTokenRefresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      status = "destroyed";
      clearInterval(helloTimer);
      clearTimeout(handshakeTimer);
      for (const pending of pendingTokens) clearTimeout(pending.timer);
      pendingTokens.clear();
      offMessage();
      rejectReady(new Error("inneragent iframe child: destroyed"));
      if (initialized) {
        setAssistantEventHooks(void 0);
      }
      if (active === handle) {
        active = null;
      }
    }
  };
  active = handle;
  sendHello();
  return handle;
}
const TOKEN_PARAM_PATTERN = /(^|_)(token|access[-_]?token|refresh[-_]?token|id[-_]?token|jwt|api[-_]?key|secret|authorization|credential)(_|$)/i;
function resolveSrc(src) {
  let url;
  try {
    url = new URL(src, typeof location !== "undefined" ? location.href : "https://localhost/");
  } catch {
    throw new Error(`inneragent iframe embed: invalid src "${src}"`);
  }
  for (const name of url.searchParams.keys()) {
    if (TOKEN_PARAM_PATTERN.test(name)) {
      throw new Error(
        `inneragent iframe embed: src query 参数 "${name}" 疑似携带凭证 — token 不入 URL (02-技术方案 §7.3); token 经 postMessage 桥 (tokenGetter) 传递`
      );
    }
  }
  return url;
}
function createIframeEmbed(options) {
  if (!options.src) throw new Error("inneragent iframe embed: src is required");
  if (!options.appKey) throw new Error("inneragent iframe embed: appKey is required");
  if (typeof options.tokenGetter !== "function") {
    throw new Error("inneragent iframe embed: tokenGetter is required");
  }
  const srcUrl = resolveSrc(options.src);
  const childOrigin = srcUrl.origin;
  const allowedOrigins = new Set(options.allowedOrigins ?? [childOrigin]);
  if (!allowedOrigins.has(childOrigin)) {
    throw new Error(`inneragent iframe embed: child origin ${childOrigin} 不在 allowedOrigins 内`);
  }
  const handshakeTimeoutMs = options.handshakeTimeoutMs ?? 15e3;
  const ackTimeoutMs = options.ackTimeoutMs ?? 5e3;
  const onEvent = options.onEvent;
  let iframe = null;
  let transport;
  if (options.transport) {
    transport = options.transport;
  } else {
    const container = options.container ?? (typeof document !== "undefined" ? document.body : void 0);
    if (!container) throw new Error("inneragent iframe embed: container is required (no document.body)");
    const factory = options.createElement ?? (() => document.createElement("iframe"));
    iframe = factory();
    if (options.iframeAttrs) {
      for (const [name, value] of Object.entries(options.iframeAttrs)) {
        iframe.setAttribute(name, value);
      }
    }
    container.appendChild(iframe);
    transport = windowTransport({ win: window, remote: () => iframe?.contentWindow ?? null });
    iframe.setAttribute("src", options.src);
  }
  let destroyed = false;
  let handshakeDone = false;
  let rejectedCount = 0;
  const pendingAcks = /* @__PURE__ */ new Map();
  const queued = [];
  const currentPage = {};
  const currentObject = {};
  let resolveReady;
  let rejectReady;
  const ready = new Promise((resolve2, reject) => {
    resolveReady = resolve2;
    rejectReady = reject;
  });
  void ready.catch(() => {
  });
  const handshakeTimer = setTimeout(() => {
    if (!handshakeDone && !destroyed) {
      rejectReady(new Error("inneragent iframe embed: handshake timeout (child 未在时限内发起 hello)"));
    }
  }, handshakeTimeoutMs);
  function post(message) {
    transport.post(message, childOrigin);
  }
  function sendWithAck(message) {
    return new Promise((resolve2, reject) => {
      const attempt = (remaining) => {
        if (destroyed) {
          reject(new Error("inneragent iframe embed: destroyed"));
          return;
        }
        const timer = setTimeout(() => {
          pendingAcks.delete(message.nonce);
          if (remaining > 0) {
            attempt(remaining - 1);
          } else {
            reject(new Error(`inneragent iframe embed: ack timeout for ${message.type}`));
          }
        }, ackTimeoutMs);
        pendingAcks.set(message.nonce, () => {
          clearTimeout(timer);
          pendingAcks.delete(message.nonce);
          resolve2();
        });
        post(message);
      };
      attempt(1);
    });
  }
  function ackMessage(nonce) {
    post(createMessage("ack", void 0, nonce));
  }
  function flushQueued() {
    while (queued.length > 0) {
      const message = queued.shift();
      post(message);
    }
  }
  function buildReadyPayload() {
    const payload = {
      protocolVersion: IA_BRIDGE_VERSION,
      appKey: options.appKey
    };
    if (options.agentType !== void 0) payload.agentType = options.agentType;
    if (options.baseURL !== void 0) payload.baseURL = options.baseURL;
    if (options.locale !== void 0) payload.locale = options.locale;
    if (options.theme !== void 0) payload.theme = options.theme;
    return payload;
  }
  async function serveTokenRequest(request2) {
    try {
      const token = await options.tokenGetter();
      if (destroyed) return;
      const reply = createMessage("token", {
        token,
        reason: request2.payload?.reason ?? "refresh"
      }, request2.nonce);
      await sendWithAck(reply);
    } catch (error) {
      onEvent?.({
        kind: "error",
        code: "token-getter-failed",
        message: error instanceof Error ? error.message : String(error)
      }, { origin: childOrigin });
    }
  }
  const offMessage = transport.onMessage((incoming) => {
    if (destroyed) return;
    if (!isBridgeEnvelope(incoming.data)) return;
    if (!allowedOrigins.has(incoming.origin)) {
      rejectedCount += 1;
      return;
    }
    if (incoming.source && iframe?.contentWindow && incoming.source !== iframe.contentWindow) {
      rejectedCount += 1;
      return;
    }
    const message = incoming.data;
    switch (message.type) {
      case "hello": {
        post(createMessage("ready", buildReadyPayload(), message.nonce));
        if (!handshakeDone) {
          handshakeDone = true;
          clearTimeout(handshakeTimer);
          flushQueued();
          resolveReady();
        }
        break;
      }
      case "token-request":
        void serveTokenRequest(message);
        break;
      case "event":
        ackMessage(message.nonce);
        onEvent?.(message.payload, { origin: incoming.origin });
        break;
      case "ack": {
        if (message.ack) {
          const resolver = pendingAcks.get(message.ack);
          if (resolver) resolver();
        }
        break;
      }
    }
  });
  function pushContext() {
    const payload = {};
    if ("value" in currentPage && currentPage.value !== void 0) payload.page = currentPage.value;
    if ("value" in currentObject && currentObject.value !== void 0) payload.object = currentObject.value;
    const message = createMessage("context", payload);
    if (handshakeDone) post(message);
    else queued.push(message);
  }
  return {
    iframe,
    ready,
    handshakeOrigin: childOrigin,
    get rejectedMessageCount() {
      return rejectedCount;
    },
    setPage(page) {
      currentPage.value = page;
      pushContext();
    },
    setObject(object) {
      currentObject.value = object;
      pushContext();
    },
    clearContext() {
      delete currentPage.value;
      delete currentObject.value;
      pushContext();
    },
    setTheme(tokens) {
      const message = createMessage("set-theme", { tokens });
      if (handshakeDone) post(message);
      else queued.push(message);
    },
    async refreshToken() {
      const token = await options.tokenGetter();
      const reply = createMessage("token", { token, reason: "refresh" });
      await sendWithAck(reply);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(handshakeTimer);
      for (const resolver of pendingAcks.values()) resolver();
      pendingAcks.clear();
      offMessage();
      if (!handshakeDone) {
        rejectReady(new Error("inneragent iframe embed: destroyed before handshake"));
      }
      iframe?.remove();
      iframe = null;
    }
  };
}
export {
  IA_BRIDGE_NAMESPACE,
  IA_BRIDGE_VERSION,
  __resetIframeAgentForTests,
  createIframeEmbed,
  createMemoryTransportPair,
  createMessage,
  createNonce,
  isBridgeEnvelope,
  mountIframeAgent,
  windowTransport
};
