import { ref as N, computed as R, defineComponent as ye, openBlock as b, createElementBlock as m, mergeProps as cn, createCommentVNode as B, renderSlot as Qe, watch as Te, onScopeDispose as fn, createElementVNode as u, normalizeStyle as yi, toDisplayString as h, normalizeClass as ve, unref as f, createVNode as ie, withCtx as ne, createTextVNode as H, Fragment as ue, renderList as Ee, withKeys as gn, withModifiers as At, useSlots as wi, onBeforeUnmount as xi, toRef as Pt, toValue as ki, onUnmounted as Zn, createBlock as se, getCurrentScope as Ei, nextTick as hn, onMounted as dn, resolveComponent as Ci, defineCustomElement as Ai } from "vue";
import { defineStore as Ii, createPinia as Si } from "pinia";
const Ti = [
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
], Kn = "/ia/api/v1", Mi = "ai_media", Ri = "inneragent-assistant";
let $e = null;
function xc(e) {
  if (!e.appKey || !e.appKey.trim())
    throw new Error("@inneragent/sdk init: appKey is required");
  if (typeof e.tokenGetter != "function")
    throw new Error("@inneragent/sdk init: tokenGetter is required");
  return $e = {
    appKey: e.appKey,
    baseURL: (e.baseURL ?? Kn).replace(/\/+$/, ""),
    mode: e.mode ?? "wc",
    agentType: e.agentType ?? Mi,
    storagePrefix: e.storagePrefix ?? Ri,
    tokenGetter: e.tokenGetter
  }, e.theme && Li(e.theme), $e;
}
function kc() {
  $e = null;
}
function bt() {
  if (!$e)
    throw new Error("@inneragent/sdk is not initialized; call init({ appKey, tokenGetter }) first");
  return $e;
}
function Tt() {
  return $e?.baseURL ?? Kn;
}
function Li(e) {
  if (!(typeof document > "u"))
    for (const n of Ti) {
      const t = e[n];
      t && document.documentElement.style.setProperty(n, t);
    }
}
const Ve = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500
};
class Wt extends Error {
  code;
  status;
  traceId;
  details;
  silent;
  constructor(n, t, i = {}) {
    super(t), this.name = "ApiError", this.code = n, this.status = i.status, this.traceId = i.traceId, this.details = i.details, i.silent && (this.silent = !0);
  }
  /** 源实现语义: 业务码 10200 或 HTTP 401 视为未认证 */
  isAuthError() {
    return this.code === 10200 || this.status === 401;
  }
}
const Jn = {};
let kt = Jn;
function Ec(e) {
  kt = e ?? Jn;
}
const It = {
  onToolFinished(e) {
    try {
      kt.onToolFinished?.(e);
    } catch {
    }
  },
  onRunTerminal() {
    try {
      kt.onRunTerminal?.();
    } catch {
    }
  },
  onUnauthorized() {
    try {
      kt.onUnauthorized?.();
    } catch {
    }
  }
}, tn = "inneragent:trace-id";
function Ui() {
  let e = "";
  try {
    e = sessionStorage.getItem(tn) || "";
  } catch {
  }
  if (!e) {
    e = Di();
    try {
      sessionStorage.setItem(tn, e);
    } catch {
    }
  }
  return e;
}
function Di() {
  return typeof crypto < "u" && "randomUUID" in crypto ? crypto.randomUUID() : `trace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
let xt = null;
function Gn() {
  if (!xt) {
    const { tokenGetter: e } = bt();
    xt = Promise.resolve().then(() => e()).finally(() => {
      xt = null;
    });
  }
  return xt;
}
async function Vn(e) {
  if (e !== void 0) return e;
  const { tokenGetter: n } = bt();
  return Promise.resolve().then(() => n());
}
function Hn(e) {
  return typeof FormData < "u" && e instanceof FormData;
}
function qi(e) {
  const { body: n } = e;
  if (n != null)
    return Hn(n) || typeof n == "string" || n instanceof URLSearchParams ? n : JSON.stringify(n);
}
function zi(e) {
  const n = new Headers(e.headers), { body: t } = e;
  return Hn(t) ? n.delete("Content-Type") : typeof t == "string" ? n.has("Content-Type") || n.set("Content-Type", "application/json") : t != null && !(t instanceof URLSearchParams) && n.set("Content-Type", "application/json"), n;
}
function Fi(e) {
  return Array.isArray(e) ? e.filter((n) => n != null && typeof n == "object" && typeof n.message == "string").map((n) => ({
    field: typeof n.field == "string" ? n.field : "",
    code: typeof n.code == "string" ? n.code : void 0,
    message: n.message,
    rejectedValue: n.rejectedValue
  })) : [];
}
function Zt(e, n) {
  const i = e.get("x-trace-id") || "" || n?.trace_id || "";
  if (i)
    try {
      sessionStorage.setItem(tn, i);
    } catch {
    }
  return i;
}
function ji(e, n, t) {
  if (!t) return fetch(e, n);
  const i = new AbortController(), o = setTimeout(() => i.abort(new DOMException("Timeout", "AbortError")), t), r = n.signal ? AbortSignal.any([n.signal, i.signal]) : i.signal;
  return fetch(e, { ...n, signal: r }).finally(() => clearTimeout(o));
}
async function ct(e, n = {}) {
  const t = /^https?:\/\//.test(e);
  let i = e;
  if (!t) {
    const o = Tt();
    i = o !== "" && (e === o || e.startsWith(`${o}/`)) ? e : `${o}${e.startsWith("/") ? "" : "/"}${e}`;
  }
  return Yn(i, n);
}
async function Yn(e, n) {
  const t = zi(n), i = await Vn(n.__overrideToken);
  i && t.set("Authorization", `Bearer ${i}`), t.set("X-Trace-Id", Ui());
  let o;
  try {
    o = await ji(e, {
      method: n.method ?? "GET",
      headers: t,
      body: qi(n)
    }, n.timeoutMs ?? 3e4);
  } catch {
    throw new Wt(0, "网络错误，请稍后重试", { silent: n.silent });
  }
  if (o.status === Ve.UNAUTHORIZED && (It.onUnauthorized(), !n.__retried)) {
    const a = await Gn().catch(() => null);
    if (a)
      return Yn(e, { ...n, __retried: !0, __overrideToken: a });
  }
  if (!o.ok) {
    const { message: a, body: c } = await Ni(o);
    throw new Wt(o.status, a, {
      status: o.status,
      silent: n.silent,
      traceId: Zt(o.headers, c)
    });
  }
  const r = await o.json().catch(() => null);
  if (r === null || r.code === void 0)
    return r;
  if (r.code === 0)
    return Zt(o.headers, r), r.data;
  throw new Wt(r.code, r.message || r.msg || "请求失败", {
    silent: n.silent,
    traceId: Zt(o.headers, r),
    details: Fi(r.error)
  });
}
async function Ni(e) {
  let n = null;
  try {
    const i = await e.text();
    i.trim() && (n = JSON.parse(i));
  } catch {
    n = null;
  }
  let t = "请求失败";
  switch (e.status) {
    case Ve.BAD_REQUEST:
      t = n?.message || "请求参数错误";
      break;
    case Ve.UNAUTHORIZED:
      t = n?.msg || n?.message || "登录已过期，请重新登录";
      break;
    case Ve.FORBIDDEN:
      t = "没有权限访问";
      break;
    case Ve.NOT_FOUND:
      t = "请求的资源不存在";
      break;
    case Ve.INTERNAL_SERVER_ERROR:
      t = n?.message || "服务器内部错误";
      break;
    default:
      t = n?.message || `请求失败 (${e.status})`;
  }
  return { message: t, body: n };
}
const pe = {
  get(e, n) {
    return ct(e, { ...n, method: "GET" });
  },
  post(e, n, t) {
    return ct(e, { ...t, method: "POST", body: n });
  },
  put(e, n, t) {
    return ct(e, { ...t, method: "PUT", body: n });
  },
  delete(e, n) {
    return ct(e, { ...n, method: "DELETE" });
  },
  patch(e, n, t) {
    return ct(e, { ...t, method: "PATCH", body: n });
  }
};
async function Xn(e, n) {
  const t = new Headers(n?.headers), i = await Vn();
  i && t.set("Authorization", `Bearer ${i}`);
  const o = await fetch(e, { ...n, headers: t });
  if (o.status === 401) {
    It.onUnauthorized();
    const r = await Gn().catch(() => null);
    if (r)
      return t.set("Authorization", `Bearer ${r}`), fetch(e, { ...n, headers: t });
  }
  return o;
}
const Bi = /* @__PURE__ */ new Set([
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
function _n(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
function Oi(e) {
  if (!_n(e)) return null;
  const n = e.msg ?? e.message;
  return typeof n == "string" && n.trim() ? n.trim() : null;
}
async function Qi(e) {
  try {
    const n = await e.text();
    if (n.trim())
      try {
        const t = Oi(JSON.parse(n));
        if (t) return t;
      } catch {
      }
  } catch {
  }
  return "请求失败";
}
function Pi(e) {
  const n = e.lastIndexOf(":");
  if (n <= 0 || n === e.length - 1)
    throw new Error("Pipeline SSE id is invalid");
  const t = e.slice(0, n), i = e.slice(n + 1);
  if (!/^\d+$/.test(i))
    throw new Error("Pipeline SSE id sequence is invalid");
  const o = Number(i);
  if (!Number.isSafeInteger(o) || o <= 0)
    throw new Error("Pipeline SSE id sequence is outside the safe range");
  return { runId: t, sequence: o };
}
function Wi(e) {
  let n;
  try {
    n = JSON.parse(e);
  } catch {
    throw new Error("Pipeline SSE data is not valid JSON");
  }
  if (!_n(n))
    throw new Error("Pipeline SSE data must be an object");
  if (n.schemaVersion !== 1)
    throw new Error("Unsupported Pipeline SSE schema version");
  if (typeof n.runId != "string" || n.runId.trim() !== n.runId || !n.runId)
    throw new Error("Pipeline SSE runId is invalid");
  if (!Number.isSafeInteger(n.sequence) || n.sequence <= 0)
    throw new Error("Pipeline SSE sequence is invalid");
  if (typeof n.outputType != "string" || !Bi.has(n.outputType))
    throw new Error("Pipeline SSE outputType is invalid");
  return n;
}
function Zi(e) {
  return !e.parentToolCallId && !e.agentName && (e.outputType === "DONE" || e.outputType === "ERROR" || e.outputType === "CANCELLED");
}
function $n(e, n, t) {
  const i = [], o = [];
  for (const g of e.split(`
`)) {
    const x = g.trimEnd();
    !x || x.startsWith(":") || (x.startsWith("data:") ? i.push(x.slice(5).trimStart()) : x.startsWith("id:") && o.push(x.slice(3).trimStart()));
  }
  const r = i.join(`
`).trim();
  if (!r) return;
  const a = o[0];
  if (o.length !== 1 || a === void 0)
    throw new Error("Pipeline SSE event must contain exactly one id field");
  const c = Pi(a), d = Wi(r);
  if (d.runId !== c.runId || d.sequence !== c.sequence)
    throw new Error("Pipeline SSE id does not match its data identity");
  if (t.runId && d.runId !== t.runId)
    throw new Error("Pipeline SSE switched to a different run");
  d.sequence <= t.lastSequence || (n.onEvent(d), t.runId = d.runId, t.lastSequence = d.sequence, Zi(d) && (t.terminalSeen = !0));
}
function Ki(e, n, t) {
  const o = e.replace(/\r\n/g, `
`).replace(/\r/g, `
`).split(`

`), r = o.pop() || "";
  for (const a of o)
    $n(a, n, t);
  return r;
}
async function Ji(e, n, t) {
  if (!e.ok)
    throw new Error(await Qi(e));
  const i = e.body?.getReader();
  if (!i)
    throw new Error("无法获取 Pipeline 响应流");
  const o = new TextDecoder();
  let r = "";
  for (; ; ) {
    const { done: a, value: c } = await i.read();
    if (a) break;
    r += o.decode(c, { stream: !0 }), r = Ki(r, n, t);
  }
  if (r += o.decode(), r.trim() && $n(r.replace(/\r\n/g, `
`), n, t), !t.terminalSeen)
    throw new Error("Pipeline SSE ended before a terminal journal event");
  n.onComplete?.();
}
function ei(e, n, t, i) {
  (async () => {
    try {
      await Ji(await e(), n, t);
    } catch (o) {
      if (i.signal.aborted) return;
      n.onError?.(
        o instanceof Error ? o : new Error(String(o))
      );
    }
  })();
}
function Gi(e, n) {
  const t = new AbortController();
  return ei(
    () => Xn(`${Tt()}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(e),
      signal: t.signal
    }),
    n,
    { lastSequence: 0, terminalSeen: !1 },
    t
  ), t;
}
function Vi(e, n, t) {
  if (!e || e.trim() !== e)
    throw new Error("runId is required for Run reconnect");
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("afterSequence must be a non-negative safe integer");
  const i = new AbortController(), o = {
    runId: e,
    lastSequence: n,
    terminalSeen: !1
  }, r = `${e}:${n}`;
  return ei(
    () => Xn(
      `${Tt()}/runs/${encodeURIComponent(e)}/events`,
      {
        method: "GET",
        headers: { "Last-Event-ID": r },
        signal: i.signal
      }
    ),
    t,
    o,
    i
  ), i;
}
async function Hi(e) {
  if (e.runId) {
    await pe.post(`/runs/${encodeURIComponent(e.runId)}/cancel`);
    return;
  }
  const n = e.conversationId;
  if (!n)
    throw new Error("cancelRun requires runId or conversationId");
  const t = new URLSearchParams({ conversationId: n });
  await pe.post(`/runs/cancel?${t.toString()}`);
}
async function Yi(e) {
  const { runId: n, ...t } = e;
  await pe.post(`/runs/${encodeURIComponent(n)}/confirm`, t);
}
async function Xi(e) {
  const { runId: n, ...t } = e;
  await pe.post(`/runs/${encodeURIComponent(n)}/confirm/expire`, t);
}
const _i = 500;
let ft = null;
function $i() {
  if (ft && Date.now() - ft.at < _i)
    return ft.promise;
  const e = pe.get("/runs/running");
  return ft = { at: Date.now(), promise: e }, e.catch(() => {
    ft = null;
  }), e;
}
async function vn(e) {
  if (e.runId)
    return pe.get(
      `/runs/${encodeURIComponent(e.runId)}`
    );
  const t = (await $i()).find((i) => i.conversationId === e.conversationId);
  return t ? {
    runId: t.runId,
    status: t.status,
    lastSequence: t.lastSequence,
    waitingReplyId: t.waitingReplyId
  } : { runId: "", status: "COMPLETED", lastSequence: 0 };
}
async function eo() {
  return pe.get("/me/reference-options");
}
async function yn(e) {
  const n = new URLSearchParams({
    pageNo: String(e.pageNo),
    pageSize: String(e.pageSize)
  });
  return e.category && n.set("category", e.category), pe.get(
    `/conversations?${n}`
  );
}
async function to(e) {
  return pe.get(
    `/conversations/${encodeURIComponent(e)}/messages`
  );
}
async function no(e) {
  await pe.delete(`/conversations/${e}`);
}
async function io(e) {
  await pe.delete(
    `/conversations/by-conversation-id/${encodeURIComponent(e)}`
  );
}
const oo = {
  /** 按类型获取可用模型列表 (composer 仅消费 type=1 对话模型) */
  listByType: (e) => (
    // [DEF-05] 相对路径: baseURL 由 client.request() 统一拼接, 调用点不再自带前缀
    pe.get(`/me/models?type=${e}`)
  )
}, ro = {
  /** 助手可引用 Skill/MCP 工具 (原 /api/ai/assistant/reference-options) */
  referenceOptions: () => (
    // [DEF-05] 同上
    pe.get("/me/reference-options")
  )
};
async function ao(e, n, t) {
  const i = new FormData();
  return i.append("file", e), i.append("modelId", String(n)), i.append("transport", t), pe.post("/attachments", i, { timeoutMs: 0 });
}
function St(e) {
  return e ? e.startsWith("data:") || e.startsWith("http://") || e.startsWith("https://") ? e : e.startsWith("/") ? `${Tt()}${e}` : e : null;
}
const Kt = {
  /** 本人的三方 MCP 服务器列表 (含停用; 配置视图主列表) */
  list() {
    return pe.get("/mcp-servers");
  },
  /** 详情 */
  get(e) {
    return pe.get(`/mcp-servers/${e}`);
  },
  /** 注册 (防 SSRF 拒绝本机/内网地址; OAUTH 即 501) */
  register(e) {
    return pe.post("/mcp-servers", e);
  },
  /** 更新 (credentials 不传/空 → 保持原值口径由服务端定, 见差距清单) */
  update(e, n) {
    return pe.put(`/mcp-servers/${e}`, n);
  },
  /** 启用 */
  enable(e) {
    return pe.post(`/mcp-servers/${e}/enable`);
  },
  /** 停用 (从本人目录摘除其全部三方工具) */
  disable(e) {
    return pe.post(`/mcp-servers/${e}/disable`);
  },
  /** 删除 */
  remove(e) {
    return pe.delete(`/mcp-servers/${e}`);
  }
};
let bn = [], un = {};
function Cc(e) {
  bn = e;
}
function Ac() {
  bn = [];
}
function pn() {
  return bn;
}
function Ic(e) {
  un = { ...e };
}
function Sc() {
  un = {};
}
function lo() {
  return un;
}
let ti = {}, ni = [];
function Tc(e) {
  ti = e ? { ...e } : {};
}
function wn(e) {
  return ti[e] ?? e;
}
function Mc(e) {
  ni = e ? [...e] : [];
}
function so() {
  return ni;
}
function co() {
  return {
    status: "idle",
    reasoningText: "",
    timeline: [],
    lastSequence: 0
  };
}
function fo() {
  return {
    status: "reasoning",
    reasoningText: "",
    timeline: [],
    lastSequence: 0
  };
}
function bo(e) {
  return {
    ...fo(),
    conversationId: e,
    lastSequence: 0
  };
}
function ge(e) {
  return e === "running" || e === "pending" || e === "RUNNING" || e === "WAITING_CONFIRMATION" || e === "WAITING_EXTERNAL" || e === "CANCEL_REQUESTED";
}
function xn(e) {
  switch (e) {
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
function uo(e) {
  return e.trim().replace(/\s+/g, " ").slice(0, 50) || "新对话";
}
function po(e) {
  return !e.parentToolCallId && !e.agentName && (e.outputType === "DONE" || e.outputType === "ERROR" || e.outputType === "CANCELLED");
}
function mo(e) {
  return e.outputType === "DONE" ? "completed" : e.outputType === "ERROR" ? "failed" : "cancelled";
}
function kn(e) {
  return e.pipeline.timeline.length > 0 || e.pipeline.reasoningText.trim().length > 0;
}
function ii(e) {
  if (e === "success" || e === "done") return "done";
  if (e === "error") return "error";
  if (e === "cancelled") return "cancelled";
  throw new Error(`Unsupported finished tool status: ${String(e)}`);
}
function nn(e) {
  return e === "running" ? "calling" : e === "rejected" ? "rejected" : e === "expired" ? "expired" : ii(e);
}
function go(e, n, t) {
  const i = e[e.length - 1];
  return i && i.type === "reasoning" ? [
    ...e.slice(0, -1),
    {
      ...i,
      text: i.text + n,
      startedAtMs: i.startedAtMs ?? t
    }
  ] : [
    ...e,
    {
      type: "reasoning",
      text: n,
      ...t !== void 0 ? { startedAtMs: t } : {}
    }
  ];
}
function ho(e, n) {
  for (let t = e.length - 1; t >= 0; t--) {
    const i = e[t];
    if (i !== void 0 && i.type === "reasoning")
      return e.map(
        (o, r) => r === t && o.type === "reasoning" ? { ...o, durationMs: n } : o
      );
  }
  return e;
}
function vo(e, n, t) {
  const i = e[e.length - 1];
  return i && i.type === "reasoning" ? [
    ...e.slice(0, -1),
    {
      ...i,
      text: i.text + n,
      startedAtMs: i.startedAtMs ?? t
    }
  ] : [
    ...e,
    {
      type: "reasoning",
      text: n,
      ...t !== void 0 ? { startedAtMs: t } : {}
    }
  ];
}
function on(e, n) {
  for (let t = e.length - 1; t >= 0; t--) {
    const i = e[t];
    if (i !== void 0 && i.type === "reasoning")
      return e.map(
        (o, r) => r === t && o.type === "reasoning" ? { ...o, durationMs: n } : o
      );
  }
  return e;
}
function En(e, n, t) {
  return e.map(
    (i) => i.type === "tool" && i.id === n ? { ...i, status: t } : i
  );
}
function oi(e) {
  return e === "preparing" || e === "calling" || e === "awaiting_approval" || e === "approved";
}
function yo(e) {
  let n = !1;
  const t = e.map((i) => i.type !== "tool" || !oi(i.status) ? i : (n = !0, { ...i, status: "cancelled" }));
  return n ? t : e;
}
function ri(e) {
  let n = !1;
  const t = e.map((i) => {
    if (i.type !== "tool") return i;
    const o = i.children ? yo(i.children) : i.children, r = oi(i.status) ? "cancelled" : i.status;
    return r === i.status && o === i.children ? i : (n = !0, { ...i, status: r, children: o });
  });
  return n ? t : e;
}
function Jt(e, n, t) {
  if (t.size === 0)
    throw new Error("Tool confirmation must contain at least one decision");
  const i = (o) => {
    for (const [r, a] of t) {
      const c = o.filter(
        (g) => g.type === "tool" && g.id === r
      );
      if (c.length !== 1)
        throw new Error(`Expected one child tool call for confirmation: ${r}`);
      const d = c[0];
      if (d?.type !== "tool")
        throw new Error(`Invalid confirmation state for child tool call: ${r}`);
      if (a.expectedName !== void 0 && d.name !== a.expectedName)
        throw new Error(`Confirmation tool name mismatch: ${r}`);
    }
    return o.map((r) => {
      if (r.type !== "tool") return r;
      const a = t.get(r.id);
      return a ? a.plan ? { ...r, status: a.status, plan: a.plan } : { ...r, status: a.status } : r;
    });
  };
  if (n) {
    const o = e.filter(
      (r) => r.type === "tool" && r.id === n
    );
    if (o.length !== 1 || o[0]?.type !== "tool" || !o[0].children)
      throw new Error(`Confirmation parent tool call is missing: ${n}`);
    return e.map((r) => r.type === "tool" && r.id === n ? { ...r, children: i(r.children ?? []) } : r);
  }
  for (const [o, r] of t) {
    const a = e.filter(
      (d) => d.type === "tool" && d.id === o
    ), c = a[0];
    if (a.length !== 1 || c?.type !== "tool")
      throw new Error(`Expected one tool call for confirmation: ${o}`);
    if (c.status !== r.expectedStatus)
      throw new Error(`Invalid confirmation state for tool call: ${o}`);
    if (r.expectedName !== void 0 && c.name !== r.expectedName)
      throw new Error(`Confirmation tool name mismatch: ${o}`);
  }
  return e.map((o) => {
    if (o.type !== "tool") return o;
    const r = t.get(o.id);
    return r ? r.plan ? { ...o, status: r.status, plan: r.plan } : { ...o, status: r.status } : o;
  });
}
function wo(e, n) {
  if (!e.replyId || e.replyId !== n.replyId)
    throw new Error("USER_CONFIRM_RESULT replyId does not match the pending confirmation");
  if (e.parentToolCallId !== n.parentToolCallId)
    throw new Error("USER_CONFIRM_RESULT parent tool identity does not match");
  if (!e.decisions?.length)
    throw new Error("USER_CONFIRM_RESULT has no decisions");
  const t = /* @__PURE__ */ new Map();
  for (const o of e.decisions) {
    if (!o.toolCallId || typeof o.approved != "boolean")
      throw new Error("USER_CONFIRM_RESULT contains an invalid decision");
    if (t.has(o.toolCallId))
      throw new Error(`USER_CONFIRM_RESULT contains a duplicate decision: ${o.toolCallId}`);
    t.set(o.toolCallId, o.approved);
  }
  const i = new Set(
    (n.toolCalls ?? []).map((o) => o.toolCallId)
  );
  if (i.size !== (n.toolCalls ?? []).length || t.size !== i.size || [...t.keys()].some((o) => !i.has(o)))
    throw new Error("USER_CONFIRM_RESULT decisions do not match the pending tool calls");
  return t;
}
function xo(e, n, t, i, o) {
  const r = (d) => d === "calling" || d === "approved";
  if (n) {
    const d = e.filter(
      (y) => y.type === "tool" && y.id === n
    ), g = d[0];
    if (d.length !== 1 || g?.type !== "tool" || !g.children)
      throw new Error(`Finished tool parent is missing: ${n}`);
    const v = g.children.filter(
      (y) => y.type === "tool" && y.id === t
    ), k = v[0];
    if (v.length !== 1 || k?.type !== "tool" || !r(k.status))
      throw new Error(`Finished child tool has no valid in-progress call: ${t}`);
    return e.map((y) => y.type === "tool" && y.id === n ? {
      ...y,
      children: (y.children ?? []).map((w) => w.type === "tool" && w.id === t ? { ...w, status: i, result: o } : w)
    } : y);
  }
  const a = e.filter(
    (d) => d.type === "tool" && d.id === t
  ), c = a[0];
  if (a.length !== 1 || c?.type !== "tool" || !r(c.status))
    throw new Error(`Finished tool has no valid in-progress call: ${t}`);
  return e.map((d) => d.type === "tool" && d.id === t ? { ...d, status: i, result: o } : d);
}
function Je(e, n, t) {
  return e.map(
    (i) => i.type === "tool" && i.id === n ? { ...i, children: t(i.children ?? []) } : i
  );
}
function ko(e, n) {
  const t = [...e], i = t[t.length - 1];
  return i && i.type === "content" ? [
    ...t.slice(0, -1),
    { ...i, text: i.text + n }
  ] : [...t, { type: "content", text: n }];
}
function Gt(e, n) {
  const t = e[e.length - 1];
  return t && t.type === "content" ? [
    ...e.slice(0, -1),
    { ...t, text: t.text + n }
  ] : [...e, { type: "content", text: n }];
}
function Eo(e) {
  return typeof e == "number" && Number.isFinite(e) && e > 0 ? e : void 0;
}
function ai(e) {
  return typeof e == "number" && Number.isFinite(e) && e >= 0 ? e : void 0;
}
function Co(e, n) {
  if (e.runId && e.runId !== n.runId)
    throw new Error("Pipeline event belongs to a different run");
  if (n.sequence <= e.lastSequence)
    return e;
  const t = {
    ...e,
    timeline: [...e.timeline],
    runId: n.runId,
    lastSequence: n.sequence,
    error: void 0
  };
  n.conversationId && (t.conversationId = n.conversationId);
  const i = !!n.parentToolCallId, o = ai(n.reasoningDurationMs);
  switch (o !== void 0 && (i ? t.timeline = Je(
    t.timeline,
    n.parentToolCallId ?? "",
    (r) => ho(r, o)
  ) : (t.reasoningDurationMs = o, t.timeline = on(t.timeline, o))), n.outputType) {
    case "REASONING":
      if (n.reasoningContent) {
        const r = Eo(n.reasoningStartTime);
        if (i)
          t.timeline = Je(
            t.timeline,
            n.parentToolCallId ?? "",
            (a) => go(a, n.reasoningContent ?? "", r)
          );
        else {
          t.status = e.status === "cancelling" ? "cancelling" : "reasoning";
          const a = t.timeline[t.timeline.length - 1];
          !a || a.type !== "reasoning" ? (t.reasoningText = "", t.reasoningDurationMs = void 0, t.reasoningStartTime = r) : t.reasoningStartTime === void 0 && (t.reasoningStartTime = r), t.reasoningText += n.reasoningContent, t.timeline = vo(
            t.timeline,
            n.reasoningContent,
            r
          );
        }
      }
      return t;
    case "CONTENT":
      return t.status = e.status === "cancelling" ? "cancelling" : "running", n.content && (i ? t.timeline = Je(
        t.timeline,
        n.parentToolCallId ?? "",
        (r) => ko(r, n.content ?? "")
      ) : t.timeline = Gt(t.timeline, n.content)), t;
    case "TOOL_CALL_STARTED":
      if (t.status = e.status === "cancelling" ? "cancelling" : "running", !n.replyId || !n.toolCalls?.length)
        throw new Error("TOOL_CALL_STARTED event has no replyId or tool calls");
      for (const r of n.toolCalls)
        if (i)
          t.timeline = Je(
            t.timeline,
            n.parentToolCallId ?? "",
            (a) => {
              if (a.some((c) => c.type === "tool" && c.id === r.id))
                throw new Error(`Tool call already started: ${r.id}`);
              return [
                ...a,
                {
                  type: "tool",
                  id: r.id,
                  name: r.name,
                  arguments: "",
                  batchId: n.replyId,
                  status: "preparing"
                }
              ];
            }
          );
        else {
          if (t.timeline.some((a) => a.type === "tool" && a.id === r.id))
            throw new Error(`Tool call already started: ${r.id}`);
          t.timeline.push({
            type: "tool",
            id: r.id,
            name: r.name,
            arguments: "",
            batchId: n.replyId,
            status: "preparing",
            agentName: n.agentName
          });
        }
      return t;
    case "TOOL_CALL":
      if (t.status = e.status === "cancelling" ? "cancelling" : "running", !n.replyId || !n.toolCalls?.length)
        throw new Error("TOOL_CALL event has no replyId or tool calls");
      for (const r of n.toolCalls)
        if (i)
          t.timeline = Je(
            t.timeline,
            n.parentToolCallId ?? "",
            (a) => {
              const c = a.find(
                (d) => d.type === "tool" && d.id === r.id
              );
              if (c?.type === "tool") {
                if (c.status !== "preparing" || c.name !== r.name)
                  throw new Error(`Invalid completed tool call definition: ${r.id}`);
                return a.map((d) => d.type === "tool" && d.id === r.id ? {
                  ...d,
                  arguments: r.arguments,
                  batchId: n.replyId,
                  status: "calling"
                } : d);
              }
              return [
                ...a,
                {
                  type: "tool",
                  id: r.id,
                  name: r.name,
                  arguments: r.arguments,
                  batchId: n.replyId,
                  status: "calling"
                }
              ];
            }
          );
        else {
          const a = t.timeline.find(
            (c) => c.type === "tool" && c.id === r.id
          );
          if (a?.type === "tool") {
            if (a.status !== "preparing" || a.name !== r.name)
              throw new Error(`Invalid completed tool call definition: ${r.id}`);
            t.timeline = t.timeline.map((c) => c.type === "tool" && c.id === r.id ? {
              ...c,
              arguments: r.arguments,
              batchId: n.replyId,
              status: "calling"
            } : c);
          } else
            t.timeline.push({
              type: "tool",
              id: r.id,
              name: r.name,
              arguments: r.arguments,
              batchId: n.replyId,
              status: "calling",
              agentName: n.agentName
            });
        }
      return t;
    case "TOOL_FINISHED":
      if (!n.toolCallId)
        throw new Error("TOOL_FINISHED event has no toolCallId");
      return t.timeline = xo(
        t.timeline,
        n.parentToolCallId,
        n.toolCallId,
        ii(n.toolStatus),
        n.toolResult
      ), t;
    case "SUB_AGENT_FINISHED":
      return i && (t.timeline = En(
        t.timeline,
        n.parentToolCallId ?? "",
        "done"
      )), t;
    case "USER_CONFIRMATION_REQUIRED":
      if (!n.replyId || !n.pendingToolCalls?.length || !n.expiresAt)
        throw new Error("Invalid USER_CONFIRMATION_REQUIRED event");
      {
        const r = e.pendingConfirmation;
        if (r && (r.runId !== n.runId || r.replyId !== n.replyId || r.parentToolCallId !== n.parentToolCallId || r.expiresAt !== n.expiresAt))
          throw new Error("Concurrent tool confirmation batches have different identities");
        const a = new Map(
          (r?.toolCalls ?? []).map((g) => [g.toolCallId, g])
        ), c = /* @__PURE__ */ new Map(), d = [];
        for (const g of n.pendingToolCalls) {
          if (c.has(g.toolCallId))
            throw new Error(`Duplicate pending tool call: ${g.toolCallId}`);
          const x = a.get(g.toolCallId);
          if (x && (x.toolName !== g.toolName || x.argumentsPreview !== g.argumentsPreview))
            throw new Error(`Pending tool call changed within its batch: ${g.toolCallId}`);
          c.set(g.toolCallId, {
            status: "awaiting_approval",
            expectedStatus: x ? "awaiting_approval" : "calling",
            expectedName: g.toolName,
            ...g.plan ? { plan: g.plan } : {}
          }), x || d.push(g);
        }
        if (r && (r.submitting || Object.keys(r.decisions).length > 0) && d.length > 0)
          throw new Error("Tool confirmation batch changed after a decision was submitted");
        t.timeline = Jt(
          t.timeline,
          n.parentToolCallId,
          c
        ), t.pendingConfirmation = r ? {
          ...r,
          toolCalls: [...r.toolCalls ?? [], ...d]
        } : {
          runId: n.runId,
          replyId: n.replyId,
          ...n.parentToolCallId ? { parentToolCallId: n.parentToolCallId } : {},
          toolCalls: n.pendingToolCalls,
          expiresAt: n.expiresAt,
          decisions: {},
          submitting: !1
        };
      }
      return t.status = e.status === "cancelling" ? "cancelling" : "running", t;
    case "USER_CONFIRM_RESULT":
      if (!e.pendingConfirmation)
        throw new Error("USER_CONFIRM_RESULT has no pending confirmation");
      {
        const r = wo(n, e.pendingConfirmation), a = /* @__PURE__ */ new Map();
        for (const [c, d] of r)
          a.set(c, {
            status: d ? "approved" : "rejected",
            expectedStatus: "awaiting_approval"
          });
        t.timeline = Jt(
          t.timeline,
          n.parentToolCallId,
          a
        );
      }
      return t.pendingConfirmation = void 0, t.status = e.status === "cancelling" ? "cancelling" : "running", t;
    case "DONE":
      return n.parentToolCallId || n.agentName || (t.status = "done", t.pendingConfirmation = void 0, n.content && (t.timeline = Gt(t.timeline, n.content))), t;
    case "ERROR":
      return i ? (t.timeline = En(
        t.timeline,
        n.parentToolCallId ?? "",
        "error"
      ), t.timeline = Je(
        t.timeline,
        n.parentToolCallId ?? "",
        (r) => [
          ...r,
          {
            type: "content",
            text: `❌ ${n.agentName || "子Agent"} 出错: ${n.error || "未知错误"}`
          }
        ]
      )) : (t.status = "error", t.pendingConfirmation = void 0, t.error = n.error || "未知错误"), t;
    case "CANCELLED":
      if (!n.parentToolCallId && !n.agentName) {
        if (t.status = "cancelled", n.cancellationReason === "CONFIRMATION_EXPIRED" && e.pendingConfirmation) {
          const r = /* @__PURE__ */ new Map();
          for (const a of e.pendingConfirmation.toolCalls ?? [])
            r.set(a.toolCallId, {
              status: "expired",
              expectedStatus: "awaiting_approval",
              expectedName: a.toolName
            });
          t.timeline = Jt(
            t.timeline,
            e.pendingConfirmation.parentToolCallId,
            r
          );
        } else
          t.timeline = ri(t.timeline);
        t.pendingConfirmation = void 0, n.content && (t.timeline = Gt(t.timeline, n.content));
      }
      return t;
    default:
      return t;
  }
}
function Ao(e, n) {
  const t = Co(e, n);
  return e.status === "cancelling" && t.status === "cancelling" ? { ...t, timeline: ri(t.timeline) } : t;
}
function Io(e) {
  return so().includes(e);
}
function rn(e, n) {
  if (!n || !e || !Io(e))
    return n;
  try {
    const t = JSON.parse(n);
    if (typeof t != "object" || t === null || Array.isArray(t))
      return n;
    const i = t.result;
    if (typeof i == "string" && i.trim())
      return i;
    const o = t.error;
    if (typeof o == "string" && o.trim())
      return o;
  } catch {
  }
  return n;
}
function So(e) {
  if (!e.toolCallId)
    throw new Error(`Persisted tool message ${e.id} has no toolCallId`);
  if (!e.toolName)
    throw new Error(`Persisted tool message ${e.id} has no toolName`);
  return { toolCallId: e.toolCallId, toolName: e.toolName };
}
function Cn(e, n, t, i, o) {
  if (e.name !== t)
    throw new Error(`Persisted ${o ? "child " : ""}tool name changed: ${n}`);
  if (e.status === "calling")
    throw new Error(`Persisted ${o ? "child " : ""}tool call is duplicated: ${n}`);
  e.arguments = i;
}
function An(e, n, t, i, o) {
  const r = nn(t);
  if (r === "cancelled") {
    if (typeof i != "string")
      throw new Error(`Persisted cancelled ${o ? "child " : ""}tool ${e} has no arguments`);
    return {
      type: "tool",
      id: e,
      name: n,
      arguments: i,
      status: r
    };
  }
  return {
    type: "tool",
    id: e,
    name: n,
    arguments: "",
    status: r,
    result: rn(n, i)
  };
}
function To(e, n, t) {
  const i = e[e.length - 1];
  if (i && i.type === "reasoning") {
    i.text += n, t !== void 0 && (i.durationMs = t);
    return;
  }
  e.push({
    type: "reasoning",
    text: n,
    ...t !== void 0 ? { durationMs: t } : {}
  });
}
function Mo(e, n) {
  const t = e[e.length - 1];
  if (t && t.type === "content") {
    t.text = t.text.endsWith(`

`) ? t.text + n : t.text.endsWith(`
`) ? `${t.text}
${n}` : `${t.text}

${n}`;
    return;
  }
  e.push({ type: "content", text: n });
}
function In(e, n) {
  for (let t = e.length - 1; t >= 0; t--) {
    const i = e[t];
    if (i && i.type === "reasoning") {
      i.durationMs = n;
      return;
    }
  }
}
function li(e) {
  const n = [], t = /* @__PURE__ */ new Map(), i = /* @__PURE__ */ new Map(), o = (a, c) => {
    t.set(a, c);
    const d = i.get(a);
    if (!d?.length) return;
    const g = n[c];
    if (g?.type === "tool") {
      g.children || (g.children = []);
      for (const x of d)
        x(g.children);
      i.delete(a);
    }
  }, r = (a, c) => {
    const d = t.get(a);
    if (d === void 0) {
      const x = i.get(a) ?? [];
      x.push(c), i.set(a, x);
      return;
    }
    const g = n[d];
    g?.type === "tool" && (g.children || (g.children = []), c(g.children));
  };
  for (const a of e) {
    const c = ai(a.reasoningDurationMs ?? void 0);
    if (a.role === "tool") {
      const { toolCallId: d, toolName: g } = So(a);
      if (a.parentToolCallId) {
        r(a.parentToolCallId, (k) => {
          if (a.toolStatus === "running") {
            if (typeof a.content != "string")
              throw new Error(`Persisted tool call ${d} has no arguments`);
            const w = k.find(
              (I) => I.type === "tool" && I.id === d
            );
            if (w?.type === "tool") {
              Cn(w, d, g, a.content, !0);
              return;
            }
            k.push({
              type: "tool",
              id: d,
              name: g,
              arguments: a.content,
              status: "calling"
            });
            return;
          }
          const y = k.find(
            (w) => w.type === "tool" && w.id === d
          );
          if (y && y.type === "tool") {
            if (y.name !== g)
              throw new Error(`Persisted child tool name changed: ${d}`);
            y.status = nn(a.toolStatus), y.result = rn(g, a.content);
            return;
          }
          k.push(An(d, g, a.toolStatus, a.content, !0));
        });
        continue;
      }
      const x = t.get(d);
      if (a.toolStatus === "running") {
        if (typeof a.content != "string")
          throw new Error(`Persisted tool call ${d} has no arguments`);
        if (x !== void 0) {
          const y = n[x];
          y?.type === "tool" && Cn(y, d, g, a.content, !1);
          continue;
        }
        const k = n.length;
        n.push({
          type: "tool",
          id: d,
          name: g,
          arguments: a.content,
          status: "calling"
        }), o(d, k);
        continue;
      }
      if (x !== void 0) {
        const k = n[x];
        if (k?.type === "tool") {
          if (k.name !== g)
            throw new Error(`Persisted tool name changed: ${d}`);
          k.status = nn(a.toolStatus), k.result = rn(g, a.content);
        }
        continue;
      }
      const v = n.length;
      n.push(An(d, g, a.toolStatus, a.content, !1)), o(d, v);
      continue;
    }
    if (a.parentToolCallId) {
      r(a.parentToolCallId, (d) => {
        a.reasoningContent ? Ro(d, a.reasoningContent, c) : c !== void 0 && In(d, c), a.content && (c !== void 0 && In(d, c), Lo(d, a.content));
      });
      continue;
    }
    a.reasoningContent ? To(n, a.reasoningContent, c) : c !== void 0 && on(n, c), a.content && (c !== void 0 && on(n, c), Mo(n, a.content));
  }
  return n;
}
function Ro(e, n, t) {
  const i = e[e.length - 1];
  if (i && i.type === "reasoning") {
    i.text += n, t !== void 0 && (i.durationMs = t);
    return;
  }
  e.push({
    type: "reasoning",
    text: n,
    ...t !== void 0 ? { durationMs: t } : {}
  });
}
function Lo(e, n) {
  const t = e[e.length - 1];
  if (t && t.type === "content") {
    t.text = t.text.endsWith(`

`) ? t.text + n : t.text.endsWith(`
`) ? `${t.text}
${n}` : `${t.text}

${n}`;
    return;
  }
  e.push({ type: "content", text: n });
}
function Uo(e) {
  return e.role === "user" && e.messageOrder > 0 ? `user:${e.conversationId}:${e.messageOrder}:${e.content ?? ""}` : e.id > 0 ? `id:${e.id}` : e.runId && e.projectionKey ? `projection:${e.runId}:${e.projectionKey}` : [e.role, e.messageOrder, e.content ?? "", e.toolCallId ?? ""].join(":");
}
function Do(e, n) {
  const t = /* @__PURE__ */ new Map();
  for (const i of [...e, ...n]) t.set(Uo(i), i);
  return [...t.values()].sort((i, o) => (i.messageOrder ?? 0) - (o.messageOrder ?? 0));
}
function qo(e) {
  return li(e.filter((n) => n.role !== "user"));
}
function zo(e, n) {
  const t = new Map(e.map((i) => [i.conversationId, i]));
  for (const i of n) t.set(i.conversationId, i);
  return [...t.values()].sort((i, o) => {
    const r = new Date(i.lastMessageTime ?? i.createTime ?? 0).getTime();
    return new Date(o.lastMessageTime ?? o.createTime ?? 0).getTime() - r;
  });
}
const si = Object.freeze({
  resolved: !1,
  degraded: !0
});
function Fo(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
function mn(e) {
  if (!Fo(e)) return { ...si };
  const n = typeof e.summary == "string" && e.summary.trim() ? e.summary : void 0, t = (i) => n ? { ...i, summary: n } : i;
  return e.degraded !== !1 ? t({ resolved: !1, degraded: !0 }) : e.resolved === !0 ? t({ resolved: !0, degraded: !1 }) : t({ resolved: !1, degraded: !0 });
}
function jo(e) {
  let n = !1, t, i, o = 0;
  for (const a of e ?? []) {
    o++;
    const c = mn(a?.scope);
    c.degraded ? (n = !0, t = t ?? c.summary) : i = i ?? c.summary;
  }
  const r = t ?? i;
  return o === 0 || n ? r ? { resolved: !1, degraded: !0, summary: r } : { ...si } : r ? { resolved: !0, degraded: !1, summary: r } : { resolved: !0, degraded: !1 };
}
const Ge = "assistant", No = "__new__";
function Bo() {
  try {
    return bt().agentType;
  } catch {
    return "ai_media";
  }
}
const Sn = 20;
function Vt(e, n, t, i) {
  const o = e.conversationId, r = t[o];
  return {
    conversation: e,
    messages: [],
    pipeline: {
      ...co(),
      conversationId: o,
      runId: r,
      lastSequence: 0
    },
    draft: n[o] ?? "",
    status: e.status || "completed",
    statusConfirmed: !ge(e.status),
    knownRunId: r,
    messagesLoaded: !1,
    messagesLoading: !1,
    reconnecting: !1,
    unread: !1,
    toolExecutionMode: i
  };
}
const Mt = 1;
let Xe = null;
function ci(e) {
  let n = Oo;
  try {
    n = bt().storagePrefix;
  } catch {
  }
  return `${n}:${e}:v${Mt}`;
}
const Oo = "inneragent-assistant";
function fi(e) {
  return e === "DEFAULT" || e === "ALWAYS_ASK" || e === "ALWAYS_ALLOW" || e === "FULL_ACCESS";
}
function Tn(e) {
  if (!e || typeof e != "object" || Array.isArray(e)) return {};
  const n = {};
  for (const [t, i] of Object.entries(e))
    typeof i == "string" && i.trim() && (n[t] = i);
  return n;
}
function Qo(e) {
  if (!e || typeof e != "object" || Array.isArray(e)) return {};
  const n = {};
  for (const [t, i] of Object.entries(e))
    typeof i == "number" && Number.isFinite(i) && i >= 0 && (n[t] = Math.floor(i));
  return n;
}
function Po(e) {
  if (!e || typeof e != "object" || Array.isArray(e)) return {};
  const n = {};
  for (const [t, i] of Object.entries(e))
    fi(i) && (n[t] = i);
  return n;
}
function Wo(e) {
  if (typeof window > "u") return {};
  try {
    const n = localStorage.getItem(ci(e));
    if (!n) return {};
    const t = JSON.parse(n);
    if (!t || typeof t != "object") return {};
    const i = t;
    return i.schemaVersion === Mt ? i : {};
  } catch {
    return {};
  }
}
function Mn(e) {
  const n = Wo(e);
  return {
    schemaVersion: Mt,
    selectedConversationId: typeof n.selectedConversationId == "string" ? n.selectedConversationId : null,
    selectedModelId: typeof n.selectedModelId == "number" && Number.isSafeInteger(n.selectedModelId) ? n.selectedModelId : null,
    drafts: Tn(n.drafts),
    runIds: Tn(n.runIds),
    lastSequences: Qo(n.lastSequences),
    toolExecutionModes: Po(n.toolExecutionModes),
    newToolExecutionMode: fi(n.newToolExecutionMode) ? n.newToolExecutionMode : "DEFAULT"
  };
}
function Rn() {
  Xe && clearTimeout(Xe), Xe = null;
}
const Ht = /* @__PURE__ */ new Set(), Ln = /* @__PURE__ */ new Map();
function Un(e, n, t) {
  const i = e[n];
  return i === void 0 ? t : i;
}
function Zo(e, n) {
  const t = pn();
  if (!t.length) return;
  const i = t.find((r) => r.type === "project")?.id ?? null, o = e ?? n ?? i;
  return i !== null && o !== null && i !== o ? [{ type: "project", id: o }] : t;
}
const ut = Ii("assistant", () => {
  const e = N(null), n = N(!1), t = N(!1), i = N(null), o = N(null), r = N([]), a = N({}), c = N(""), d = N("DEFAULT"), g = N(!1), x = N(!1), v = N(void 0), k = N(!1), y = N(0), w = N(null), I = N(0);
  function P() {
    if (typeof window > "u" || !e.value) return;
    const l = { __new__: c.value }, p = {}, D = {}, S = {};
    for (const [j, z] of Object.entries(a.value)) {
      S[j] = z.toolExecutionMode, z.draft && (l[j] = z.draft);
      const X = z.knownRunId || z.pipeline.runId;
      X && (p[j] = X);
      const U = z.pipeline.runId, F = Math.max(0, Math.floor(z.pipeline.lastSequence));
      F > 0 && U && U === X && (D[j] = F);
    }
    const T = {
      schemaVersion: Mt,
      selectedConversationId: i.value,
      selectedModelId: o.value,
      drafts: l,
      runIds: p,
      lastSequences: D,
      toolExecutionModes: S,
      newToolExecutionMode: d.value
    };
    try {
      localStorage.setItem(ci(e.value), JSON.stringify(T));
    } catch {
    }
  }
  function q() {
    Xe || (Xe = setTimeout(() => {
      Xe = null, P();
    }, 250));
  }
  function C() {
    P();
  }
  function L(l, p) {
    const D = a.value[l];
    D && (a.value = {
      ...a.value,
      [l]: p(D)
    });
  }
  let M = null, oe = null, O = 0, re = 0, $ = 0, Y = null, ce = null;
  const Q = /* @__PURE__ */ new Map(), V = /* @__PURE__ */ new Map(), Me = (l) => {
    const p = (V.get(l) ?? 0) + 1;
    return V.set(l, p), p;
  }, Ae = (l) => {
    V.set(
      l,
      (V.get(l) ?? 0) + 1
    );
  }, fe = (l, p) => V.get(l) === p, _ = () => {
    $ += 1, Y = null, ce && clearTimeout(ce), ce = null;
  }, me = (l) => {
    if (!t.value || i.value !== l) return;
    const p = a.value[l];
    !p || kn(p) || je(l);
  }, ee = 5, W = 4500, Z = /* @__PURE__ */ new Map(), de = /* @__PURE__ */ new Map(), Rt = ee, Be = /* @__PURE__ */ new Map(), Lt = (l) => l.status === "done" || l.status === "error" || l.status === "cancelled", Fe = (l) => {
    const p = a.value[l];
    return !p || !kn(p) || Lt(p.pipeline) || !(p.pipeline.runId || p.knownRunId) ? !1 : t.value && i.value === l;
  }, et = (l) => {
    const p = a.value[l], D = p?.pipeline.runId || p?.knownRunId;
    if (!p || !D) return !1;
    if (w.value?.conversationId === l) return !0;
    const S = Date.now(), T = de.get(l);
    if (T !== void 0 && S - T < W) return !0;
    if ((Z.get(l) ?? 0) >= ee) return !1;
    Z.set(l, (Z.get(l) ?? 0) + 1), de.set(l, S);
    const j = p.pipeline.runId === D ? p.pipeline.lastSequence : 0;
    return Oe(l, "reconnect", void 0, D, j), !0;
  }, Pe = (l) => {
    Z.delete(l), de.delete(l);
  }, Ut = (l) => {
    Be.delete(l) && L(l, (p) => ({ ...p, reconnecting: !1 }));
  }, tt = (l = 5e3) => {
    if (ce) return;
    const p = $;
    ce = setTimeout(() => {
      ce = null, p === $ && Ue();
    }, l);
  }, Le = () => {
    _();
    const l = w.value;
    l && Ln.get(l.connectionGeneration)?.abort();
    const p = I.value + 1;
    return w.value = null, I.value = p, ae(), p;
  }, nt = (l) => {
    const p = w.value;
    !p || p.connectionGeneration !== l || (w.value = null, I.value = l + 1);
  }, it = () => {
    M && clearTimeout(M), M = null;
  }, We = () => {
    const l = w.value?.conversationId;
    return r.value.filter((p) => {
      if (p.conversationId === l || p.conversationId === Y?.conversationId) return !1;
      const D = a.value[p.conversationId];
      return ge(D?.status ?? p.status);
    });
  }, Dt = (l, p, D, S, T) => {
    if (D !== re || !fe(l, S)) return;
    const j = xn(p.status), z = !ge(j);
    let X = !1;
    const U = a.value[l];
    if (U && w.value?.conversationId !== l && fe(l, S) && !(T && U.statusConfirmed && ge(U.status) && U.knownRunId !== T)) {
      if (z && Fe(l) && et(l)) return;
      const F = !!U.knownRunId && !!p.runId && U.knownRunId !== p.runId, K = { ...U.conversation, status: j };
      X = !0, r.value = r.value.map((Ie) => Ie.conversationId === l ? K : Ie), L(l, () => ({
        ...U,
        conversation: K,
        status: j,
        statusConfirmed: !0,
        knownRunId: p.runId || U.knownRunId,
        remoteLastSequence: p.lastSequence,
        connectionError: z ? void 0 : U.connectionError,
        // [P1 #5] 服务端终态落地 → 重连提示态一并清除
        reconnecting: z ? !1 : U.reconnecting,
        // A background completion makes the persisted transcript stale,
        // but it still must not trigger a content request while closed.
        messagesLoaded: z || F ? !1 : U.messagesLoaded,
        unread: z && (!t.value || i.value !== l) ? !0 : U.unread
      }));
    }
    X && z && (Pe(l), me(l));
  }, ae = () => {
    if (M || oe !== null || We().length === 0) return;
    const l = typeof document < "u" && document.visibilityState === "hidden", D = Math.min(5e3, (l ? 5e3 : 1e3) * 2 ** O), S = l ? Math.max(5e3, D) : D;
    M = setTimeout(() => {
      M = null, qt();
    }, S);
  }, qt = async () => {
    if (oe !== null) return;
    const l = re, p = We().map((S) => ({
      conversation: S,
      expectedRunId: a.value[S.conversationId]?.knownRunId,
      metadataGeneration: Me(S.conversationId)
    }));
    if (p.length === 0) {
      it();
      return;
    }
    oe = l;
    let D = 0;
    try {
      await Promise.all(p.map(async ({
        conversation: S,
        expectedRunId: T,
        metadataGeneration: j
      }) => {
        try {
          const z = await vn({ conversationId: S.conversationId });
          Dt(
            S.conversationId,
            z,
            l,
            j,
            T
          );
        } catch {
          D += 1;
        }
      }));
    } finally {
      if (l !== re || oe !== l) return;
      oe = null, O = D === p.length ? Math.min(O + 1, 4) : 0, We().length > 0 ? ae() : it();
    }
  }, pt = (l, p) => {
    let D = 0;
    const S = a.value[l];
    if (S) {
      const T = S.pipeline.runId === p;
      D = T ? S.pipeline.lastSequence : 0, T && D === S.pipeline.lastSequence ? L(l, (z) => ({ ...z, knownRunId: p })) : L(l, (z) => ({
        ...z,
        knownRunId: p,
        pipeline: {
          ...z.pipeline,
          runId: p,
          conversationId: l,
          lastSequence: D,
          reasoningText: "",
          reasoningStartTime: void 0,
          reasoningDurationMs: void 0,
          error: void 0
        }
      }));
    }
    return D;
  }, Oe = (l, p, D, S, T = 0) => {
    if (!t.value || i.value !== l) return;
    const j = a.value[l];
    if (!j || !ge(j.status) || w.value?.conversationId === l || p === "reconnect" && !S) return;
    const z = Le();
    Ae(l), L(l, (F) => ({
      ...F,
      connectionError: void 0
    }));
    const X = {
      onEvent: (F) => {
        const K = w.value;
        if (!K || K.connectionGeneration !== z || K.conversationId !== l || K.runId && F.runId !== K.runId) return;
        Ae(l);
        const Ie = `${l}:${F.runId}`, be = Q.get(Ie) ?? /* @__PURE__ */ new Set();
        Q.set(Ie, be);
        const G = `${F.sequence}:${F.messageId ?? F.outputType}`;
        if (be.has(G)) return;
        be.add(G);
        const te = a.value[l];
        if (!(!te || te.pipeline.runId && te.pipeline.runId !== F.runId || F.sequence <= te.pipeline.lastSequence)) {
          Ut(l);
          try {
            const Se = Ao(te.pipeline, F), ke = po(F), qe = ke ? mo(F) : te.status === "CANCEL_REQUESTED" ? "CANCEL_REQUESTED" : F.outputType === "USER_CONFIRMATION_REQUIRED" ? "WAITING_CONFIRMATION" : F.outputType === "EXTERNAL_EXECUTION_REQUIRED" ? "WAITING_EXTERNAL" : "running";
            F.outputType === "TOOL_FINISHED" && F.toolName && F.toolStatus !== "error" ? It.onToolFinished(F.toolName) : ke && It.onRunTerminal(), L(l, (Ce) => ({
              ...Ce,
              pipeline: {
                ...Se,
                runId: F.runId,
                conversationId: l,
                lastSequence: F.sequence
              },
              status: qe,
              statusConfirmed: !0,
              knownRunId: F.runId,
              remoteLastSequence: Math.max(Ce.remoteLastSequence ?? 0, F.sequence),
              connectionError: void 0,
              messagesLoaded: ke ? !1 : Ce.messagesLoaded,
              conversation: { ...Ce.conversation, status: qe },
              unread: ke && (!t.value || i.value !== l)
            })), ke && Pe(l);
            const Ne = r.value.find(
              (Ce) => Ce.conversationId === l
            );
            Ne && Ne.status !== qe && (r.value = r.value.map((Ce) => Ce.conversationId === l ? { ...Ce, status: qe } : Ce)), w.value?.connectionGeneration === z && (w.value = { ...w.value, runId: F.runId });
          } catch (Se) {
            L(l, (ke) => ({
              ...ke,
              connectionError: Se instanceof Error ? Se.message : "无法处理助手事件"
            }));
          }
        }
      },
      onError: (F) => {
        const K = w.value;
        if (!K || K.connectionGeneration !== z || K.conversationId !== l) return;
        if (K.connectionMode === "start" && !K.runId) {
          L(l, (te) => ({
            ...te,
            reconnecting: !1,
            connectionError: F.message,
            status: "failed",
            statusConfirmed: !0,
            conversation: { ...te.conversation, status: "failed" }
          })), r.value = r.value.map((te) => te.conversationId === l ? { ...te, status: "failed" } : te), nt(z);
          return;
        }
        const be = (Be.get(l) ?? 0) + 1;
        Be.set(l, be);
        const G = be >= Rt;
        L(l, (te) => ({
          ...te,
          reconnecting: !G,
          connectionError: G ? `连接中断，自动重连未成功：${F.message}` : void 0
        })), nt(z), G || tt(), ae();
      },
      onComplete: () => {
        const F = w.value;
        if (!F || F.connectionGeneration !== z || F.conversationId !== l) return;
        nt(z);
        const K = a.value[l];
        K && !ge(K.status) && me(l), ae();
      }
    };
    let U;
    try {
      if (p === "start") {
        if (!D) throw new Error("缺少助手请求");
        U = Gi(D, X);
      } else
        U = Vi(
          S ?? "",
          T,
          X
        );
    } catch (F) {
      L(l, (K) => ({
        ...K,
        connectionError: F instanceof Error ? F.message : "无法连接助手"
      })), tt(), ae();
      return;
    }
    Ln.set(z, U), w.value = {
      conversationId: l,
      runId: S,
      connectionGeneration: z,
      connectionMode: p
    };
  }, mt = (l) => {
    if (Y?.conversationId === l) return;
    const p = ++$, D = I.value, S = Me(l);
    Y = { conversationId: l, generation: p }, vn({ conversationId: l }).then((T) => {
      if (p !== $ || I.value !== D || !fe(l, S)) return;
      const j = xn(T.status), z = a.value[l];
      if (z && !ge(j) && Fe(l) && et(l)) {
        ae();
        return;
      }
      if (z && I.value === D && fe(l, S)) {
        const U = { ...z.conversation, status: j };
        r.value = r.value.map((F) => F.conversationId === l ? U : F), L(l, () => ({
          ...z,
          conversation: U,
          status: j,
          statusConfirmed: !0,
          knownRunId: T.runId,
          remoteLastSequence: T.lastSequence,
          connectionError: ge(j) ? z.connectionError : void 0,
          reconnecting: ge(j) ? z.reconnecting : !1,
          messagesLoaded: ge(j) ? z.messagesLoaded : !1
        }));
      }
      if (!ge(j)) {
        me(l), ae();
        return;
      }
      if (!t.value || i.value !== l || w.value || !T.runId) {
        ae();
        return;
      }
      const X = pt(l, T.runId);
      Oe(l, "reconnect", void 0, T.runId, X);
    }).catch(() => {
      p === $ && tt(), ae();
    }).finally(() => {
      Y?.generation === p && (Y = null);
    });
  }, Ue = () => {
    const l = i.value;
    if (!t.value || !l) {
      ae();
      return;
    }
    const p = a.value[l];
    if (!p || !ge(p.status)) {
      ae();
      return;
    }
    if (w.value?.conversationId === l) return;
    if (je(l), !p.statusConfirmed || !p.knownRunId) {
      mt(l);
      return;
    }
    if (Fe(l)) {
      if (et(l)) return;
      ae();
      return;
    }
    const D = pt(l, p.knownRunId);
    Oe(l, "reconnect", void 0, p.knownRunId, D);
  }, gt = () => {
    re += 1, Le(), it(), oe = null, O = 0, Q.clear(), V.clear(), Z.clear(), de.clear(), Be.clear();
  };
  async function ot(l) {
    const p = i.value;
    if (!p)
      throw new Error("Tool confirmation requires a selected conversation");
    const D = a.value[p];
    if (!D)
      throw new Error(`Missing assistant runtime for ${p}`);
    const S = D.pipeline.pendingConfirmation;
    if (!S)
      throw new Error(`Conversation ${p} has no pending tool confirmation`);
    if (S.submitting)
      throw new Error(`Conversation ${p} is submitting tool decisions`);
    const T = Date.parse(S.expiresAt);
    if (!Number.isFinite(T))
      throw new Error("Tool confirmation expiry is invalid");
    if (Date.now() >= T) {
      ae();
      return;
    }
    const j = S.toolCalls ?? [], z = new Set(j.map((G) => G.toolCallId));
    if (z.size !== j.length)
      throw new Error("Tool confirmation contains duplicate toolCallIds");
    if (l.kind === "single" && !z.has(l.toolCallId))
      throw new Error(`Tool confirmation does not contain ${l.toolCallId}`);
    if (Object.keys(S.decisions).some((G) => !z.has(G) || typeof S.decisions[G] != "boolean"))
      throw new Error("Pending tool confirmation contains invalid local decisions");
    const U = l.kind === "all" ? Object.fromEntries(j.map((G) => [
      G.toolCallId,
      l.approved
    ])) : { [l.toolCallId]: l.approved }, F = {
      ...S.decisions,
      ...U
    }, K = Object.keys(F).length === z.size, Ie = K ? j.map((G) => ({
      toolCallId: G.toolCallId,
      approved: F[G.toolCallId] ?? !1
    })) : void 0, be = S;
    if (L(p, (G) => {
      const te = G.pipeline.pendingConfirmation;
      if (te !== be)
        throw new Error("Pending tool confirmation changed before submission");
      return {
        ...G,
        connectionError: void 0,
        pipeline: {
          ...G.pipeline,
          pendingConfirmation: {
            ...te,
            decisions: F,
            submitting: K
          }
        }
      };
    }), !!Ie)
      try {
        await Yi({
          runId: S.runId,
          replyId: S.replyId,
          decisions: Ie
        }), Le(), Ue(), ae();
      } catch (G) {
        const te = Date.now() >= T;
        L(p, (Se) => {
          const ke = Se.pipeline.pendingConfirmation;
          if (!ke || ke.replyId !== S.replyId || !ke.submitting)
            throw new Error("Pending tool confirmation changed after submission failure");
          return {
            ...Se,
            connectionError: te ? void 0 : G instanceof Error ? G.message : String(G),
            pipeline: {
              ...Se.pipeline,
              pendingConfirmation: {
                ...ke,
                submitting: !1
              }
            }
          };
        }), te && ae();
      }
  }
  function zt(l) {
    if (typeof l != "number" && typeof l != "string" || typeof l == "number" && (!Number.isSafeInteger(l) || l <= 0) || typeof l == "string" && !l.trim() || n.value && e.value === l) return;
    e.value && C(), gt(), Rn();
    const p = Mn(l), D = p.drafts, S = p.selectedConversationId;
    e.value = l, n.value = !0, i.value = null, o.value = p.selectedModelId, r.value = [], a.value = {}, c.value = D[No] ?? "", d.value = p.newToolExecutionMode, g.value = !1, x.value = !0, v.value = void 0, k.value = !1, y.value = 0, yn({ pageNo: 1, pageSize: Sn, category: Ge }).then((T) => {
      if (e.value !== l) return;
      const j = T.list.filter((F) => !F.category || F.category === Ge), z = {};
      for (const F of j)
        z[F.conversationId] = Vt(
          F,
          D,
          p.runIds,
          Un(
            p.toolExecutionModes,
            F.conversationId,
            p.newToolExecutionMode
          )
        );
      const X = S && z[S] ? S : null;
      r.value = j, a.value = z, i.value = X, x.value = !1, y.value = 1, k.value = j.length < T.total, v.value = void 0, ae();
      const U = i.value;
      t.value && U && (je(U), Ue());
    }).catch((T) => {
      e.value === l && (x.value = !1, v.value = T instanceof Error ? T.message : "加载助手会话失败");
    });
  }
  function rt() {
    e.value && C(), gt(), Rn(), e.value = null, n.value = !1, t.value = !1, i.value = null, o.value = null, r.value = [], a.value = {}, c.value = "", d.value = "DEFAULT", g.value = !1, x.value = !1, v.value = void 0, k.value = !1, y.value = 0, w.value = null;
  }
  function ht() {
    if (x.value || !k.value || !e.value) return;
    const l = y.value + 1, p = e.value;
    x.value = !0, yn({ pageNo: l, pageSize: Sn, category: Ge }).then((D) => {
      if (e.value !== p) return;
      const S = D.list.filter((X) => !X.category || X.category === Ge), T = zo(r.value, S), j = Mn(p), z = { ...a.value };
      for (const X of S) {
        const U = z[X.conversationId];
        z[X.conversationId] = U ? {
          ...U,
          conversation: { ...X, status: U.status }
        } : Vt(
          X,
          j.drafts,
          j.runIds,
          Un(
            j.toolExecutionModes,
            X.conversationId,
            j.newToolExecutionMode
          )
        );
      }
      r.value = T, a.value = z, x.value = !1, y.value = l, k.value = T.length < D.total, ae();
    }).catch((D) => {
      e.value === p && (x.value = !1, v.value = D instanceof Error ? D.message : "加载更多会话失败");
    });
  }
  function Ft(l) {
    if (l && !a.value[l])
      throw new Error(`Cannot select conversation without runtime: ${l}`);
    if (i.value !== l && Le(), !l)
      i.value = null, g.value = !1;
    else {
      if (!a.value[l])
        throw new Error(`Conversation runtime disappeared during selection: ${l}`);
      i.value = l, g.value = !1, L(l, (D) => ({ ...D, unread: !1 }));
    }
    q(), ae(), l && t.value && (je(l), Ue());
  }
  function jt() {
    (w.value || i.value) && Le(), i.value = null, g.value = !1, q();
  }
  function xe(l, p) {
    l ? L(l, (D) => ({ ...D, draft: p })) : c.value = p, q();
  }
  function Ze(l) {
    o.value = l, q();
  }
  function Ke(l) {
    const p = i.value;
    d.value = l, p && L(p, (D) => ({ ...D, toolExecutionMode: l })), q();
  }
  async function at(l, p, D, S, T) {
    const j = T?.multimodalInputs ?? [], z = l.trim() || (j.length ? "请分析这些附件。" : "");
    if (!z) return;
    if (w.value) throw new Error("当前会话仍在生成中");
    const X = i.value;
    let U = X;
    const F = uo(z);
    if (!U) {
      U = typeof crypto < "u" && "randomUUID" in crypto ? crypto.randomUUID() : `assistant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const le = {
        id: -Date.now(),
        conversationId: U,
        userId: 0,
        projectId: S ?? null,
        category: Ge,
        title: F,
        messageCount: 0,
        status: "completed"
      }, s = {
        ...Vt(le, {}, {}, d.value),
        // The optimistic conversation has no server history yet. Treat its
        // empty local transcript as loaded so connection recovery cannot
        // race the create request with a history lookup that must 404.
        messagesLoaded: !0
      };
      r.value = [le, ...r.value], a.value = { ...a.value, [U]: s }, i.value = U, c.value = "";
    }
    const K = a.value[U];
    if (!K) throw new Error("会话尚未准备好");
    if (X && ge(K.status))
      throw new Error("当前会话仍在生成中");
    const Ie = !X || K.conversation.title === "新对话";
    let be = K;
    be.pipeline.timeline.length > 0 && !be.messagesLoaded && (await je(U), be = a.value[U] ?? be);
    const G = S !== void 0 ? S : be.conversation.projectId ?? null, te = {
      // [adapt] 契约: 请求体增 context{page,object} (02-技术方案 §7.1)。
      // 宿主经 pageContext.setRunContext 注册; 未注册时字段缺省。
      ...lo()
    };
    T?.mcpTools.length && (te.activeMcpReferences = T.mcpTools.map((le) => `${le.serverName}/${le.toolName}`).join(`
`));
    const Se = T && (G !== null || T.skills.length > 0 || T.mcpTools.length > 0 || j.length > 0) ? JSON.stringify({
      version: 2,
      projectId: G,
      project: T.project ?? null,
      skills: T.skills,
      mcpTools: T.mcpTools,
      attachments: j.map(({
        id: le,
        name: s,
        inputType: E,
        mimeType: A,
        transport: J,
        resourceUrl: De,
        size: Qt
      }) => ({
        id: le,
        name: s,
        inputType: E,
        mimeType: A,
        transport: J,
        resourceUrl: De,
        size: Qt
      }))
    }) : void 0, ke = {
      id: -Date.now(),
      conversationId: U,
      role: "user",
      content: z,
      referencesJson: Se,
      messageOrder: Math.max(0, ...be.messages.map((le) => le.messageOrder ?? 0)) + 1
    }, qe = {
      ...bo(U),
      // Keep an already visible answer until the persisted projection is
      // available; new events append to this same reducer state.
      timeline: be.messagesLoaded ? [] : be.pipeline.timeline
    }, Ne = be.conversation.title === "新对话" ? F : be.conversation.title;
    L(U, (le) => ({
      ...le,
      messages: [...le.messages, ke],
      pipeline: qe,
      status: "running",
      statusConfirmed: !0,
      knownRunId: void 0,
      remoteLastSequence: 0,
      messagesError: void 0,
      connectionError: void 0,
      reconnecting: !1,
      conversation: {
        ...le.conversation,
        status: "running",
        title: Ne,
        projectId: G
      }
    })), Be.delete(U), r.value = r.value.map((le) => le.conversationId === U ? { ...le, status: "running", title: Ne, projectId: G } : le), q();
    const Ce = {
      message: z,
      conversationId: U,
      modelId: p ?? void 0,
      reasoningEffort: D ?? void 0,
      agentType: Bo(),
      category: Ge,
      title: Ie ? F : void 0,
      projectId: G ?? void 0,
      context: Object.keys(te).length ? te : void 0,
      autoReferences: Zo(
        S,
        G
      ),
      // [DEF-07] 空数组/未选择时不下发该字段(undefined → JSON 剔除): 服务端把
      // "enabledMcpTools":[] 视作「显式空白名单」过滤 → ia_tool_registry 注册
      // 工具在 UI 会话中全部不可达; 缺省(不传)才是「未指定 = 跟随授权目录」。
      // enabledSkills 同口径(服务端对 null/[] 语义一致, 见 resolveActiveSkills)。
      enabledSkills: T?.skills.length ? T.skills.map((le) => le.name) : void 0,
      enabledMcpTools: T?.mcpTools.length ? T.mcpTools.map((le) => le.toolName) : void 0,
      multimodalInputs: j,
      referencesJson: Se,
      toolExecutionMode: be.toolExecutionMode
    };
    Pe(U), Oe(U, "start", Ce), ae();
  }
  async function lt() {
    const l = i.value, p = l ? a.value[l] : void 0, S = (w.value?.conversationId === l ? w.value.runId : void 0) || p?.pipeline.runId || p?.knownRunId;
    if (!l || !p || p.status === "CANCEL_REQUESTED") return;
    const T = p.status, j = p.conversation.status, z = p.pipeline.status, X = r.value.find(
      (U) => U.conversationId === l
    )?.status;
    L(l, (U) => ({
      ...U,
      status: "CANCEL_REQUESTED",
      connectionError: void 0,
      reconnecting: !1,
      pipeline: {
        ...U.pipeline,
        status: "cancelling"
      },
      conversation: { ...U.conversation, status: "CANCEL_REQUESTED" }
    })), r.value = r.value.map((U) => U.conversationId === l ? { ...U, status: "CANCEL_REQUESTED" } : U);
    try {
      await Hi(S ? { runId: S } : { conversationId: l }), ae();
    } catch (U) {
      const F = U instanceof Error ? U.message : String(U);
      throw L(l, (K) => K.status === "CANCEL_REQUESTED" ? {
        ...K,
        status: T,
        connectionError: `取消请求失败：${F}`,
        pipeline: {
          ...K.pipeline,
          status: z
        },
        conversation: {
          ...K.conversation,
          status: j
        }
      } : K), r.value = r.value.map((K) => K.conversationId === l && K.status === "CANCEL_REQUESTED" ? { ...K, status: X ?? T } : K), U;
    }
  }
  function Nt(l, p) {
    return ot({ kind: "single", toolCallId: l, approved: p });
  }
  function Bt(l) {
    return ot({ kind: "all", approved: l });
  }
  async function Ot() {
    const l = i.value;
    if (!l) return;
    const p = a.value[l]?.pipeline.pendingConfirmation;
    if (!p) return;
    const D = Date.parse(p.expiresAt);
    if (!Number.isFinite(D))
      throw new Error("Tool confirmation expiry is invalid");
    if (Date.now() < D) return;
    const S = `${p.runId}:${p.replyId}`;
    if (!Ht.has(S)) {
      Ht.add(S);
      try {
        await Xi({
          runId: p.runId,
          replyId: p.replyId
        }), Le(), Ue();
      } catch (T) {
        console.warn("[Assistant] 审批超时状态同步失败", T);
      } finally {
        Ht.delete(S), ae();
      }
    }
  }
  function st(l) {
    L(l, (p) => ({ ...p, unread: !1 }));
  }
  async function vt(l, p) {
    const D = a.value[l];
    if (D && ge(D.status)) throw new Error("运行中的会话不能删除");
    p < 0 ? await io(l) : await no(p), i.value === l && Le();
    const S = { ...a.value };
    delete S[l], r.value = r.value.filter((T) => T.conversationId !== l), a.value = S, i.value === l && (i.value = null), q();
  }
  function yt(l) {
    if (t.value === l) return;
    if (t.value = l, !l) {
      Le(), g.value = !1, ae();
      return;
    }
    g.value = !1;
    const p = i.value;
    p && (a.value[p]?.unread && L(p, (S) => ({ ...S, unread: !1 })), je(p), Ue());
  }
  function wt(l) {
    g.value = l;
  }
  async function je(l) {
    if (!l) return;
    const p = e.value, D = a.value[l];
    if (!(!D || D.messagesLoaded || D.messagesLoading)) {
      L(l, (S) => ({
        ...S,
        messagesLoading: !0,
        messagesError: void 0
      }));
      try {
        const S = await to(l);
        if (e.value !== p) return;
        const T = a.value[l];
        if (!T) return;
        const j = Do(T.messages, S), z = !w.value && !ge(T.status);
        a.value = {
          ...a.value,
          [l]: {
            ...T,
            messages: j,
            messagesLoaded: !0,
            messagesLoading: !1,
            messagesError: void 0,
            pipeline: z ? {
              ...T.pipeline,
              timeline: qo(j),
              conversationId: l
            } : T.pipeline
          }
        };
      } catch (S) {
        L(l, (T) => ({
          ...T,
          messagesLoading: !1,
          messagesError: S instanceof Error ? S.message : "加载消息失败"
        }));
      }
    }
  }
  return {
    // state
    hydratedUserId: e,
    initialized: n,
    open: t,
    selectedConversationId: i,
    selectedModelId: o,
    conversations: r,
    conversationStates: a,
    newDraft: c,
    newToolExecutionMode: d,
    drawerOpen: g,
    conversationsLoading: x,
    conversationsError: v,
    hasMoreConversations: k,
    conversationPage: y,
    connection: w,
    connectionGeneration: I,
    // actions
    initializeForUser: zt,
    resetForUser: rt,
    loadMoreConversations: ht,
    selectConversation: Ft,
    startNewConversation: jt,
    setDraft: xe,
    setSelectedModelId: Ze,
    setToolExecutionMode: Ke,
    sendMessage: at,
    stopGeneration: lt,
    respondToToolConfirmation: Nt,
    respondToAllToolConfirmations: Bt,
    expireToolConfirmation: Ot,
    markConversationRead: st,
    deleteConversation: vt,
    setOpen: yt,
    setDrawerOpen: wt,
    loadMessagesIfNeeded: je,
    ensureContentConnection: Ue
  };
}), Ko = {
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
  "assistant.input-placeholder-hint": `发挥想象…
使用 {'@'} 引用页面上下文，/ 引用 Skill`,
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
}, Jo = {
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
  "assistant.input-placeholder-hint": `Imagine…
Use {'@'} for page context, / for Skills`,
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
}, Go = {
  "zh-CN": Ko,
  "en-US": Jo
}, an = N("zh-CN");
function Rc(e) {
  an.value = e;
}
function Vo(e, n) {
  let t = e.replace(/\{'([^']*)'\}/g, "$1");
  return n && (t = t.replace(/\{(\w+)\}/g, (i, o) => Object.prototype.hasOwnProperty.call(n, o) ? String(n[o]) : i)), t;
}
function Re() {
  const e = R(() => Go[an.value]);
  return { t: (i, o) => {
    const r = e.value[i];
    return r === void 0 ? i : Vo(r, o);
  }, te: (i) => e.value[i] !== void 0, locale: an };
}
function di(e) {
  return e === "CANCEL_REQUESTED" ? "assistant.status-cancelling" : e === "WAITING_CONFIRMATION" ? "assistant.status-waiting-confirm" : e === "WAITING_EXTERNAL" ? "assistant.status-waiting-external" : ge(e) ? "assistant.status-running" : e === "failed" || e === "error" ? "assistant.status-failed" : e === "cancelled" ? "assistant.status-cancelled" : "assistant.status-completed";
}
function Yt(e, n) {
  return e === "CANCEL_REQUESTED" ? "running" : e === "WAITING_CONFIRMATION" || e === "WAITING_EXTERNAL" ? "waiting" : ge(e) ? "running" : e === "failed" || e === "error" ? "failed" : e === "cancelled" ? "cancelled" : n ? "unread" : "done";
}
function Dn(e, n = Date.now()) {
  if (!e) return { key: "assistant.time-now" };
  const t = new Date(e).getTime();
  if (!Number.isFinite(t)) return { key: "assistant.time-now" };
  const i = Math.max(0, Math.round((n - t) / 1e3));
  return i < 60 ? { key: "assistant.time-now" } : i < 3600 ? { key: "assistant.time-minutes-ago", n: Math.floor(i / 60) } : i < 86400 ? { key: "assistant.time-hours-ago", n: Math.floor(i / 3600) } : i < 604800 ? { key: "assistant.time-days-ago", n: Math.floor(i / 86400) } : { key: "assistant.time-days-ago", n: Math.floor(i / 86400) };
}
function Ho(e, n) {
  const t = [];
  let i = { key: "prelude", assistant: [] };
  const o = () => {
    (i.user || i.assistant.length > 0) && t.push(i);
  };
  for (const r of e) {
    if (r.role === "user") {
      o(), i = {
        key: `segment-${r.id}-${r.messageOrder}`,
        user: r,
        assistant: []
      };
      continue;
    }
    n && r.runId === n || i.assistant.push(r);
  }
  return o(), t;
}
function Yo(e, n) {
  if (e.some((i) => !Object.prototype.hasOwnProperty.call(n, i)))
    return;
  const t = n[e[0] ?? ""];
  return e.every((i) => n[i] === t) ? t : void 0;
}
const Xo = ["type", "disabled"], _o = {
  key: 0,
  class: "ri-loader-4-line is-spinning",
  "aria-hidden": "true"
}, $o = /* @__PURE__ */ ye({
  name: "IaButton",
  inheritAttrs: !1,
  __name: "IaButton",
  props: {
    variant: { default: "primary", type: String },
    size: { default: "md", type: String },
    loading: { type: Boolean, default: !1 },
    disabled: { type: Boolean, default: !1 },
    circle: { type: Boolean, default: !1 },
    block: { type: Boolean, default: !1 },
    nativeType: { default: "button", type: String }
  },
  emits: ["click"],
  setup(e, { emit: n }) {
    const t = e, i = n, o = R(() => [
      "ia-button",
      `variant-${t.variant}`,
      `size-${t.size}`,
      {
        "is-loading": t.loading,
        "is-disabled": t.disabled || t.loading,
        "is-circle": t.circle,
        "is-block": t.block
      }
    ]);
    function r(a) {
      !t.disabled && !t.loading && i("click", a);
    }
    return (a, c) => (b(), m("button", cn({
      class: o.value,
      type: e.nativeType,
      disabled: e.disabled || e.loading
    }, a.$attrs, { onClick: r }), [
      e.loading ? (b(), m("i", _o)) : B("", !0),
      Qe(a.$slots, "default", {}, void 0, !0)
    ], 16, Xo));
  }
}), er = ".ia-button[data-v-a3698f19]{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:7px 14px;border:1px solid transparent;border-radius:var(--app-radius-md, 8px);font-weight:600;line-height:1.2;cursor:pointer;transition:background .15s ease,color .15s ease,border-color .15s ease,box-shadow .15s ease,transform .1s ease;-webkit-user-select:none;user-select:none}.ia-button[data-v-a3698f19]:active:not(.is-disabled){transform:scale(.97)}.ia-button.is-disabled[data-v-a3698f19]{cursor:not-allowed;opacity:.55}.ia-button.is-block[data-v-a3698f19]{width:100%;display:flex}.ia-button.is-circle[data-v-a3698f19]{border-radius:9999px;padding-left:10px;padding-right:10px}.ia-button.size-sm[data-v-a3698f19]{font-size:12px;padding:5px 10px}.ia-button.size-md[data-v-a3698f19]{font-size:13px}.ia-button.size-lg[data-v-a3698f19]{font-size:14px;padding:9px 18px}.ia-button.variant-primary[data-v-a3698f19]:not(.is-disabled){background:var(--app-primary, var(--ia-primary, #409eff));border-color:var(--app-primary, var(--ia-primary, #409eff));color:var(--app-on-primary, var(--ia-primary-contrast, #fff))}.ia-button.variant-primary[data-v-a3698f19]:not(.is-disabled):hover{filter:brightness(.95);box-shadow:var(--app-shadow-sm, 0 2px 8px rgba(0, 0, 0, .08))}.ia-button.variant-secondary[data-v-a3698f19]{background:var(--app-bg-card, var(--ia-bg-card, #fff));border-color:var(--app-separator, var(--ia-separator, #dcdfe6));color:var(--app-text, var(--ia-text, #303133))}.ia-button.variant-secondary[data-v-a3698f19]:not(.is-disabled):hover{border-color:var(--app-primary, var(--ia-primary, #409eff));color:var(--app-primary, var(--ia-primary, #409eff))}.ia-button.variant-text[data-v-a3698f19]{background:none;border-color:transparent;color:var(--app-primary, var(--ia-primary, #409eff))}.ia-button.variant-text[data-v-a3698f19]:not(.is-disabled):hover{background:#409eff14}.ia-button.variant-danger[data-v-a3698f19]:not(.is-disabled){background:var(--app-color-danger, var(--ia-danger, #f56c6c));border-color:var(--app-color-danger, var(--ia-danger, #f56c6c));color:#fff}.ia-button.variant-danger[data-v-a3698f19]:not(.is-disabled):hover{filter:brightness(.95);box-shadow:var(--app-shadow-sm, 0 2px 8px rgba(0, 0, 0, .08))}.is-spinning[data-v-a3698f19]{animation:ia-button-spin-a3698f19 1s linear infinite}@keyframes ia-button-spin-a3698f19{0%{transform:rotate(0)}to{transform:rotate(360deg)}}", we = (e, n) => {
  const t = e.__vccOpts || e;
  for (const [i, o] of n)
    t[i] = o;
  return t;
}, he = /* @__PURE__ */ we($o, [["styles", [er]], ["__scopeId", "data-v-a3698f19"]]), tr = { class: "ia-dialog__head" }, nr = { class: "ia-dialog__title" }, ir = { class: "ia-dialog__body" }, or = {
  key: 0,
  class: "ia-dialog__footer"
}, rr = /* @__PURE__ */ ye({
  name: "IaDialog",
  inheritAttrs: !1,
  __name: "IaDialog",
  props: {
    open: { type: Boolean, default: !1 },
    title: { default: "", type: String },
    width: { default: "420px", type: [String, Number] },
    closeOnClickModal: { type: Boolean, default: !1 }
  },
  emits: ["update:open", "close"],
  setup(e, { emit: n }) {
    const t = e, i = n;
    function o() {
      i("update:open", !1), i("close");
    }
    function r() {
      t.closeOnClickModal && o();
    }
    let a = null;
    function c() {
      a && (document.removeEventListener("keydown", a), a = null);
    }
    return Te(() => t.open, (d) => {
      c(), d && (a = (g) => {
        g.key === "Escape" && o();
      }, document.addEventListener("keydown", a));
    }), fn(c), (d, g) => e.open ? (b(), m("div", cn({
      key: 0,
      class: "ia-dialog",
      role: "dialog",
      "aria-modal": "true"
    }, d.$attrs), [
      u("div", {
        class: "ia-dialog__mask",
        onClick: r
      }),
      u("div", {
        class: "ia-dialog__card",
        style: yi({ width: typeof e.width == "number" ? `${e.width}px` : e.width })
      }, [
        u("header", tr, [
          u("h3", nr, h(e.title), 1),
          u("button", {
            type: "button",
            class: "ia-dialog__close",
            "aria-label": "close",
            onClick: o
          }, [...g[0] || (g[0] = [
            u("i", {
              class: "ri-close-line",
              "aria-hidden": "true"
            }, null, -1)
          ])])
        ]),
        u("div", ir, [
          Qe(d.$slots, "default", {}, void 0, !0)
        ]),
        d.$slots.footer ? (b(), m("footer", or, [
          Qe(d.$slots, "footer", {}, void 0, !0)
        ])) : B("", !0)
      ], 4)
    ], 16)) : B("", !0);
  }
}), ar = ".ia-dialog[data-v-1a2cb564]{position:fixed;inset:0;z-index:100;display:grid;place-items:center}.ia-dialog__mask[data-v-1a2cb564]{position:absolute;inset:0;background:#00000073}.ia-dialog__card[data-v-1a2cb564]{position:relative;max-width:calc(100vw - 48px);border-radius:12px;background:var(--app-bg-card, var(--ia-bg-card, #fff));box-shadow:0 12px 40px #0003;overflow:hidden}.ia-dialog__head[data-v-1a2cb564]{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:14px 16px 10px}.ia-dialog__title[data-v-1a2cb564]{margin:0;font-size:14px;font-weight:600;color:var(--app-text, var(--ia-text, #303133))}.ia-dialog__close[data-v-1a2cb564]{display:grid;place-items:center;width:24px;height:24px;border:none;border-radius:6px;background:none;cursor:pointer;color:var(--app-text-secondary, var(--ia-text-secondary, #606266))}.ia-dialog__close[data-v-1a2cb564]:hover{background:var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7))}.ia-dialog__body[data-v-1a2cb564]{padding:0 16px 16px;font-size:13px;color:var(--app-text, var(--ia-text, #303133));line-height:1.6}.ia-dialog__footer[data-v-1a2cb564]{display:flex;justify-content:flex-end;gap:8px;padding:10px 16px 14px}", lr = /* @__PURE__ */ we(rr, [["styles", [ar]], ["__scopeId", "data-v-1a2cb564"]]), sr = { class: "assistant-nav__head" }, cr = { class: "assistant-nav__title" }, fr = { class: "assistant-nav__sub" }, dr = {
  key: 0,
  class: "assistant-nav__empty",
  "data-testid": "assistant-nav-empty"
}, br = ["data-testid", "onClick", "onKeydown"], ur = { class: "assistant-nav__main" }, pr = ["title"], mr = { class: "assistant-nav__meta" }, gr = ["title"], hr = ["title", "disabled", "data-testid", "onClick"], vr = {
  key: 1,
  class: "assistant-nav__loading"
}, yr = { class: "assistant-nav__delete-desc" }, wr = {
  key: 0,
  class: "assistant-nav__delete-error",
  "data-testid": "assistant-delete-error"
}, xr = { class: "assistant-nav__delete-actions" }, kr = /* @__PURE__ */ ye({
  name: "AssistantConversationNav",
  __name: "AssistantConversationNav",
  emits: ["selected"],
  setup(e, { emit: n }) {
    const t = n, { t: i } = Re(), o = ut(), r = {
      running: "ri-loader-4-line",
      waiting: "ri-error-warning-line",
      failed: "ri-close-circle-line",
      cancelled: "ri-ban-line",
      unread: "ri-error-warning-line",
      done: "ri-checkbox-circle-line"
    };
    function a(P, q) {
      return `is-${Yt(P, q)}`;
    }
    function c(P) {
      return !!P && ["running", "pending", "RUNNING", "WAITING_CONFIRMATION", "WAITING_EXTERNAL", "CANCEL_REQUESTED"].includes(P);
    }
    function d(P) {
      const q = P.currentTarget;
      o.hasMoreConversations && !o.conversationsLoading && q.scrollHeight - q.scrollTop - q.clientHeight < 80 && o.loadMoreConversations();
    }
    const g = N(null), x = N(null), v = N(!1), k = R({
      get: () => g.value !== null,
      set: (P) => {
        P || (g.value = null);
      }
    });
    function y(P, q, C) {
      x.value = null, g.value = { conversationId: P, id: q, title: C };
    }
    async function w() {
      if (g.value) {
        v.value = !0;
        try {
          await o.deleteConversation(g.value.conversationId, g.value.id), g.value = null;
        } catch (P) {
          x.value = P instanceof Error ? P.message : i("assistant.delete-failed");
        } finally {
          v.value = !1;
        }
      }
    }
    function I(P) {
      try {
        o.selectConversation(P), t("selected");
      } catch (q) {
        console.error(`[inneragent-chat] ${i("assistant.delete-failed")}`, q);
      }
    }
    return (P, q) => (b(), m("aside", {
      class: ve(["assistant-nav", { "is-drawer": f(o).drawerOpen }]),
      "data-testid": "assistant-nav"
    }, [
      f(o).drawerOpen ? (b(), m("div", {
        key: 0,
        class: "assistant-nav__mask",
        onClick: q[0] || (q[0] = (C) => f(o).setDrawerOpen(!1))
      })) : B("", !0),
      u("div", sr, [
        u("div", null, [
          u("p", cr, h(f(i)("assistant.conversations")), 1),
          u("p", fr, h(f(i)("assistant.conversations-only")), 1)
        ]),
        ie(he, {
          class: "assistant-nav__close",
          variant: "secondary",
          size: "sm",
          circle: "",
          title: f(i)("common.close"),
          "aria-label": f(i)("common.close"),
          "data-testid": "assistant-drawer-close",
          onClick: q[1] || (q[1] = (C) => f(o).setDrawerOpen(!1))
        }, {
          default: ne(() => [...q[7] || (q[7] = [
            u("i", { class: "ri-close-line" }, null, -1)
          ])]),
          _: 1
        }, 8, ["title", "aria-label"]),
        ie(he, {
          variant: "secondary",
          size: "sm",
          circle: "",
          title: f(i)("assistant.new-conversation"),
          "data-testid": "assistant-new-conversation",
          onClick: q[2] || (q[2] = (C) => f(o).startNewConversation())
        }, {
          default: ne(() => [...q[8] || (q[8] = [
            u("i", { class: "ri-add-line" }, null, -1)
          ])]),
          _: 1
        }, 8, ["title"])
      ]),
      u("div", {
        class: "assistant-nav__list",
        onScroll: d
      }, [
        f(o).conversations.length === 0 && !f(o).conversationsLoading ? (b(), m("div", dr, [
          q[9] || (q[9] = u("i", { class: "ri-chat-new-line" }, null, -1)),
          u("p", null, h(f(i)("assistant.empty-conversations")), 1),
          ie(he, {
            variant: "secondary",
            size: "sm",
            onClick: q[3] || (q[3] = (C) => f(o).startNewConversation())
          }, {
            default: ne(() => [
              H(h(f(i)("assistant.start-new")), 1)
            ]),
            _: 1
          })
        ])) : B("", !0),
        (b(!0), m(ue, null, Ee(f(o).conversations, (C) => (b(), m("div", {
          key: C.conversationId,
          role: "button",
          tabindex: "0",
          class: ve(["assistant-nav__item", { "is-selected": C.conversationId === f(o).selectedConversationId }]),
          "data-testid": `assistant-conversation-${C.conversationId}`,
          onClick: (L) => I(C.conversationId),
          onKeydown: [
            gn((L) => I(C.conversationId), ["enter"]),
            gn(At((L) => I(C.conversationId), ["prevent"]), ["space"])
          ]
        }, [
          u("i", {
            class: ve(["assistant-nav__status", [
              r[f(Yt)(
                f(o).conversationStates[C.conversationId]?.status,
                f(o).conversationStates[C.conversationId]?.unread ?? !1
              )],
              a(
                f(o).conversationStates[C.conversationId]?.status,
                f(o).conversationStates[C.conversationId]?.unread ?? !1
              ),
              { "is-spinning": f(Yt)(
                f(o).conversationStates[C.conversationId]?.status,
                f(o).conversationStates[C.conversationId]?.unread ?? !1
              ) === "running" }
            ]])
          }, null, 2),
          u("span", ur, [
            u("span", {
              class: "assistant-nav__name",
              title: C.title
            }, h(C.title || f(i)("assistant.new-conversation")), 9, pr),
            u("span", mr, [
              u("span", null, h(f(i)(f(di)(f(o).conversationStates[C.conversationId]?.status))), 1),
              q[10] || (q[10] = u("span", { "aria-hidden": "true" }, "·", -1)),
              u("span", null, h(f(i)(f(Dn)(C.lastMessageTime ?? C.createTime).key, {
                n: f(Dn)(C.lastMessageTime ?? C.createTime).n ?? 0
              })), 1),
              f(o).conversationStates[C.conversationId]?.unread ? (b(), m("span", {
                key: 0,
                class: "assistant-nav__unread",
                title: f(i)("assistant.unread")
              }, null, 8, gr)) : B("", !0)
            ])
          ]),
          u("button", {
            type: "button",
            class: "assistant-nav__delete fc-button-ghost",
            title: c(f(o).conversationStates[C.conversationId]?.status) ? f(i)("assistant.running-delete-disabled") : f(i)("assistant.delete-conversation"),
            disabled: c(f(o).conversationStates[C.conversationId]?.status),
            "data-testid": `assistant-delete-${C.conversationId}`,
            onClick: At((L) => y(C.conversationId, C.id, C.title), ["stop"])
          }, [...q[11] || (q[11] = [
            u("i", { class: "ri-delete-bin-line" }, null, -1)
          ])], 8, hr)
        ], 42, br))), 128)),
        f(o).conversationsLoading ? (b(), m("p", vr, [
          q[12] || (q[12] = u("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
          H(" " + h(f(i)("assistant.loading")), 1)
        ])) : f(o).hasMoreConversations ? (b(), m("button", {
          key: 2,
          type: "button",
          class: "assistant-nav__more fc-button-ghost",
          "data-testid": "assistant-load-more",
          onClick: q[4] || (q[4] = (C) => f(o).loadMoreConversations())
        }, h(f(i)("assistant.load-more")), 1)) : B("", !0)
      ], 32),
      ie(lr, {
        open: k.value,
        "onUpdate:open": q[6] || (q[6] = (C) => k.value = C),
        title: f(i)("assistant.delete-title"),
        width: "400px"
      }, {
        footer: ne(() => [
          u("div", xr, [
            ie(he, {
              variant: "secondary",
              size: "sm",
              onClick: q[5] || (q[5] = (C) => k.value = !1)
            }, {
              default: ne(() => [
                H(h(f(i)("assistant.cancel")), 1)
              ]),
              _: 1
            }),
            ie(he, {
              variant: "danger",
              size: "sm",
              loading: v.value,
              "data-testid": "assistant-delete-confirm",
              onClick: w
            }, {
              default: ne(() => [
                H(h(f(i)("assistant.delete-confirm")), 1)
              ]),
              _: 1
            }, 8, ["loading"])
          ])
        ]),
        default: ne(() => [
          u("p", yr, h(f(i)("assistant.delete-desc", { title: g.value?.title || f(i)("assistant.new-conversation") })), 1),
          x.value ? (b(), m("p", wr, h(x.value), 1)) : B("", !0)
        ]),
        _: 1
      }, 8, ["open", "title"])
    ], 2));
  }
}), Er = ".assistant-nav__mask[data-v-c847562e]{position:fixed;inset:0;z-index:55;background:#0006}.assistant-nav__close[data-v-c847562e]{display:none}.assistant-nav[data-v-c847562e]{width:220px;position:relative}@media(max-width:768px){.assistant-nav[data-v-c847562e]:not(.is-drawer){display:none}.assistant-nav.is-drawer[data-v-c847562e]{position:fixed;inset:0 auto 0 0;width:260px;z-index:60;background:var(--app-bg, var(--el-bg-color));box-shadow:0 8px 30px #0000002e}.assistant-nav.is-drawer .assistant-nav__close[data-v-c847562e]{display:inline-flex}}.assistant-nav[data-v-c847562e]{flex-shrink:0;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--app-separator, var(--el-border-color-lighter))}.assistant-nav__head[data-v-c847562e]{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 12px 10px;border-bottom:1px solid var(--app-separator, var(--el-border-color-lighter))}.assistant-nav__head>div[data-v-c847562e]{min-width:0}.assistant-nav__title[data-v-c847562e]{margin:0;font-size:13px;font-weight:600;color:var(--app-text)}.assistant-nav__sub[data-v-c847562e]{margin:2px 0 0;font-size:10px;color:var(--app-text-tertiary, var(--app-text-secondary))}.assistant-nav__list[data-v-c847562e]{flex:1;min-height:0;overflow-y:auto;padding:8px}.assistant-nav__empty[data-v-c847562e]{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px;text-align:center;color:var(--app-text-secondary);font-size:12px}.assistant-nav__empty i[data-v-c847562e]{font-size:26px;opacity:.4}.assistant-nav__empty p[data-v-c847562e]{margin:0}.assistant-nav__item[data-v-c847562e]{width:100%;display:flex;align-items:flex-start;gap:8px;padding:8px 10px;margin-bottom:2px;border:none;border-radius:10px;background:none;cursor:pointer;text-align:left;transition:background .15s}.assistant-nav__item[data-v-c847562e]:hover{background:var(--app-sidebar-item-hover-bg)}.assistant-nav__item:hover .assistant-nav__delete[data-v-c847562e]{opacity:1}.assistant-nav__item.is-selected[data-v-c847562e]{background:var(--el-color-primary-light-9, #ecf5ff)}.assistant-nav__status[data-v-c847562e]{flex-shrink:0;margin-top:2px;font-size:13px}.assistant-nav__status.is-running[data-v-c847562e]{color:var(--el-color-primary, #409eff)}.assistant-nav__status.is-waiting[data-v-c847562e]{color:var(--el-color-warning, #e6a23c)}.assistant-nav__status.is-failed[data-v-c847562e]{color:var(--el-color-danger, #f56c6c)}.assistant-nav__status.is-cancelled[data-v-c847562e]{color:var(--app-text-tertiary, #a8abb2)}.assistant-nav__status.is-unread[data-v-c847562e]{color:var(--el-color-warning, #e6a23c)}.assistant-nav__status.is-done[data-v-c847562e]{color:var(--el-color-success, #67c23a)}.assistant-nav__status.is-spinning[data-v-c847562e]{animation:assistant-nav-spin-c847562e 1s linear infinite}@keyframes assistant-nav-spin-c847562e{0%{transform:rotate(0)}to{transform:rotate(360deg)}}.assistant-nav__main[data-v-c847562e]{flex:1;min-width:0;display:flex;flex-direction:column}.assistant-nav__name[data-v-c847562e]{font-size:12px;font-weight:500;color:var(--app-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-nav__meta[data-v-c847562e]{display:flex;align-items:center;gap:4px;margin-top:2px;font-size:10px;color:var(--app-text-secondary)}.assistant-nav__unread[data-v-c847562e]{width:6px;height:6px;border-radius:50%;background:var(--el-color-primary, #409eff)}.assistant-nav__delete[data-v-c847562e]{flex-shrink:0;border:none;background:none;cursor:pointer;padding:2px 4px;border-radius:6px;font-size:13px;color:var(--app-text-tertiary, var(--app-text-secondary));opacity:0;transition:opacity .15s,color .15s}.assistant-nav__delete[data-v-c847562e]:hover:not(:disabled){color:var(--el-color-danger, #f56c6c)}.assistant-nav__delete[data-v-c847562e]:disabled{cursor:not-allowed;opacity:.35}.assistant-nav__loading[data-v-c847562e],.assistant-nav__more[data-v-c847562e]{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;padding:10px 0;font-size:11px;color:var(--app-text-secondary);background:none;border:none;cursor:pointer}.assistant-nav__loading[data-v-c847562e]:hover,.assistant-nav__more[data-v-c847562e]:hover{color:var(--app-text)}.is-spinning[data-v-c847562e]{animation:assistant-nav-spin-c847562e 1s linear infinite}.assistant-nav__delete-desc[data-v-c847562e]{margin:0;font-size:13px;color:var(--app-text);line-height:1.6}.assistant-nav__delete-error[data-v-c847562e]{margin:8px 0 0;font-size:12px;color:var(--el-color-danger, #f56c6c)}.assistant-nav__delete-actions[data-v-c847562e]{display:flex;justify-content:flex-end;gap:8px}", Cr = /* @__PURE__ */ we(kr, [["styles", [Er]], ["__scopeId", "data-v-c847562e"]]), Ar = {
  key: 0,
  class: "ia-empty__icon"
}, Ir = {
  key: 0,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
}, Sr = {
  key: 1,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
}, Tr = {
  key: 2,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
}, Mr = {
  key: 3,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": "1.5"
}, Rr = {
  key: 1,
  class: "ia-empty__icon"
}, Lr = {
  key: 2,
  class: "ia-empty__title"
}, Ur = {
  key: 3,
  class: "ia-empty__title"
}, Dr = {
  key: 4,
  class: "ia-empty__desc"
}, qr = {
  key: 5,
  class: "ia-empty__action"
}, zr = /* @__PURE__ */ ye({
  name: "IaEmpty",
  __name: "IaEmpty",
  props: {
    type: { default: "empty", type: String },
    title: { default: "", type: String },
    description: { default: "", type: String }
  },
  setup(e) {
    const n = e, t = wi(), { t: i } = Re(), o = R(() => n.title || i("emptyState.empty")), r = R(() => !!t.icon);
    return (a, c) => (b(), m("div", {
      class: ve(["ia-empty", [`type-${e.type}`]]),
      role: "status"
    }, [
      r.value ? (b(), m("div", Rr, [
        Qe(a.$slots, "icon", {}, void 0, !0)
      ])) : (b(), m("div", Ar, [
        e.type === "empty" ? (b(), m("svg", Ir, [...c[0] || (c[0] = [
          u("path", {
            d: "M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10",
            "stroke-linecap": "round",
            "stroke-linejoin": "round"
          }, null, -1)
        ])])) : e.type === "error" ? (b(), m("svg", Sr, [...c[1] || (c[1] = [
          u("circle", {
            cx: "12",
            cy: "12",
            r: "10"
          }, null, -1),
          u("path", {
            d: "M12 8v4m0 4h.01",
            "stroke-linecap": "round"
          }, null, -1)
        ])])) : e.type === "search" ? (b(), m("svg", Tr, [...c[2] || (c[2] = [
          u("circle", {
            cx: "11",
            cy: "11",
            r: "8"
          }, null, -1),
          u("path", {
            d: "m21 21-4.35-4.35",
            "stroke-linecap": "round"
          }, null, -1)
        ])])) : (b(), m("svg", Mr, [...c[3] || (c[3] = [
          u("circle", {
            cx: "11",
            cy: "11",
            r: "8"
          }, null, -1),
          u("path", {
            d: "m21 21-4.35-4.35M8 8l6 6M14 8l-6 6",
            "stroke-linecap": "round"
          }, null, -1)
        ])]))
      ])),
      a.$slots.default ? (b(), m("p", Ur, [
        Qe(a.$slots, "default", {}, void 0, !0)
      ])) : (b(), m("p", Lr, h(o.value), 1)),
      e.description ? (b(), m("p", Dr, h(e.description), 1)) : B("", !0),
      a.$slots.action ? (b(), m("div", qr, [
        Qe(a.$slots, "action", {}, void 0, !0)
      ])) : B("", !0)
    ], 2));
  }
}), Fr = ".ia-empty[data-v-ec016e8e]{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;text-align:center;color:var(--app-text-secondary, var(--ia-text-secondary, #606266))}.ia-empty__icon[data-v-ec016e8e]{width:64px;height:64px;color:var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));margin-bottom:12px}.ia-empty__icon svg[data-v-ec016e8e]{width:100%;height:100%;display:block}.ia-empty__title[data-v-ec016e8e]{margin:0;font-size:14px;font-weight:500;color:var(--app-text-secondary, var(--ia-text-secondary, #606266))}.ia-empty__desc[data-v-ec016e8e]{margin:6px 0 0;font-size:12px;color:var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));max-width:320px}.ia-empty__action[data-v-ec016e8e]{margin-top:12px;display:flex;gap:8px;align-items:center}", jr = /* @__PURE__ */ we(zr, [["styles", [Fr]], ["__scopeId", "data-v-ec016e8e"]]);
function Nr(e) {
  return e.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const qn = /^https?:\/\//i;
function Br(e, n) {
  return {
    html: [
      '<div class="md-codeblock">',
      `<div class="md-codeblock__head"><span class="md-code-lang">${(e.trim().split(/\s+/)[0] ?? "") || "text"}</span></div>`,
      `<pre class="md-pre"><code class="md-code">${n.replace(/\n$/, "")}</code></pre>`,
      "</div>"
    ].join("")
  };
}
function Ye(e) {
  const n = [];
  let t = e.replace(/`([^`]+)`/g, (i, o) => (n.push(o), `\0${n.length - 1}\0`));
  return t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (i, o, r) => qn.test(r) ? `<img class="md-img" src="${r}" alt="${o}" loading="lazy">` : `${o} (${r})`), t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (i, o, r) => qn.test(r) ? `<a href="${r}" target="_blank" rel="noopener noreferrer">${o}</a>` : `${o} (${r})`), t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>").replace(/~~([^~]+)~~/g, "<del>$1</del>"), t.replace(/\x00(\d+)\x00/g, (i, o) => `<code class="md-code">${n[Number(o)] ?? ""}</code>`);
}
function Or(e) {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(e);
}
function zn(e) {
  return e.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((n) => n.trim());
}
function Qr(e, n) {
  const t = `<thead><tr>${e.map((o) => `<th>${Ye(o)}</th>`).join("")}</tr></thead>`, i = `<tbody>${n.map((o) => `<tr>${o.map((r) => `<td>${Ye(r)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `<table class="md-table">${t}${i}</table>`;
}
function Pr(e) {
  if (!e || !e.trim()) return "";
  const n = Nr(e.replace(/\r\n?/g, `
`)).split(`
`), t = [];
  let i = [], o = [], r = !1, a = [];
  const c = () => {
    i.length !== 0 && (t.push(`<p class="md-p">${Ye(i.join("<br>"))}</p>`), i = []);
  }, d = () => {
    if (o.length === 0) return;
    const v = r ? "ol" : "ul", k = r ? " md-list--ordered" : "";
    t.push(`<${v} class="md-list${k}">${o.map((y) => `<li>${Ye(y)}</li>`).join("")}</${v}>`), o = [];
  }, g = () => {
    a.length !== 0 && (t.push(`<blockquote class="md-quote">${Ye(a.join("<br>"))}</blockquote>`), a = []);
  }, x = () => {
    c(), d(), g();
  };
  for (let v = 0; v < n.length; v++) {
    const k = n[v] ?? "", y = k.match(/^\s*(`{3,}|~{3,})\s*(.*)$/);
    if (y) {
      x();
      const C = y[1] ?? "```", L = y[2] ?? "", M = [];
      let oe = !1;
      for (v = v + 1; v < n.length; v++) {
        if (new RegExp(`^\\s*${C[0]}{3,}\\s*$`).test(n[v] ?? "")) {
          oe = !0;
          break;
        }
        M.push(n[v] ?? "");
      }
      if (t.push(Br(L, M.join(`
`)).html), !oe) break;
      continue;
    }
    if (/^\s*&gt;\s?/.test(k) || /^\s*>\s?/.test(k)) {
      c(), d(), a.push(k.replace(/^\s*(&gt;|>)\s?/, ""));
      continue;
    }
    g();
    const w = n[v + 1] ?? "";
    if (k.includes("|") && Or(w)) {
      x();
      const C = zn(k), L = [];
      for (v += 2; v < n.length && (n[v] ?? "").includes("|"); )
        L.push(zn(n[v] ?? "")), v += 1;
      v -= 1, t.push(Qr(C, L));
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(k)) {
      x(), t.push('<hr class="md-hr">');
      continue;
    }
    const I = k.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (I) {
      x();
      const C = (I[1] ?? "#").length;
      t.push(`<h${C} class="md-heading">${Ye(I[2] ?? "")}</h${C}>`);
      continue;
    }
    const P = k.match(/^\s*[-*+]\s+(.+)$/), q = k.match(/^\s*\d+[.)]\s+(.+)$/);
    if (P || q) {
      c();
      const C = !!q;
      o.length > 0 && C !== r && d(), r = C, o.push((P?.[1] ?? q?.[1] ?? "").trim());
      continue;
    }
    if (d(), !k.trim()) {
      c();
      continue;
    }
    i.push(k.trim());
  }
  return x(), t.join("");
}
const Wr = ["innerHTML"], Zr = /* @__PURE__ */ ye({
  name: "AssistantMarkdown",
  __name: "AssistantMarkdown",
  props: {
    content: { type: String },
    compact: { type: Boolean, default: !1 }
  },
  setup(e) {
    const n = e, t = R(() => Pr(n.content));
    return (i, o) => (b(), m("div", {
      class: ve(["assistant-markdown", { "is-compact": e.compact }]),
      "data-testid": "assistant-markdown",
      innerHTML: t.value
    }, null, 10, Wr));
  }
}), Kr = ".assistant-markdown[data-v-50a42f8f]{min-width:0;font-size:13px;line-height:1.7;color:var(--app-text);word-break:break-word}.assistant-markdown[data-v-50a42f8f] .md-p{margin:0 0 8px;white-space:pre-wrap}.assistant-markdown[data-v-50a42f8f] .md-p:last-child{margin-bottom:0}.assistant-markdown[data-v-50a42f8f] .md-heading{margin:10px 0 6px;font-weight:600;line-height:1.4}.assistant-markdown[data-v-50a42f8f] .md-heading:first-child{margin-top:0}.assistant-markdown[data-v-50a42f8f] h1.md-heading{font-size:17px}.assistant-markdown[data-v-50a42f8f] h2.md-heading{font-size:16px}.assistant-markdown[data-v-50a42f8f] h3.md-heading{font-size:15px}.assistant-markdown[data-v-50a42f8f] h4.md-heading{font-size:14px}.assistant-markdown[data-v-50a42f8f] h5.md-heading,.assistant-markdown[data-v-50a42f8f] h6.md-heading{font-size:13px}.assistant-markdown[data-v-50a42f8f] .md-list{margin:0 0 8px;padding-left:20px}.assistant-markdown[data-v-50a42f8f] .md-list:last-child{margin-bottom:0}.assistant-markdown[data-v-50a42f8f] .md-list li{margin:2px 0}.assistant-markdown[data-v-50a42f8f] .md-quote{margin:0 0 8px;padding:4px 10px;border-left:3px solid var(--app-separator, var(--el-border-color, #dcdfe6));color:var(--app-text-secondary)}.assistant-markdown[data-v-50a42f8f] .md-quote:last-child{margin-bottom:0}.assistant-markdown[data-v-50a42f8f] .md-hr{margin:10px 0;border:none;border-top:1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5))}.assistant-markdown[data-v-50a42f8f] .md-table{display:block;width:100%;margin:0 0 8px;overflow-x:auto;border-collapse:collapse;font-size:12px;border:1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));border-radius:6px}.assistant-markdown[data-v-50a42f8f] .md-table:last-child{margin-bottom:0}.assistant-markdown[data-v-50a42f8f] .md-table th,.assistant-markdown[data-v-50a42f8f] .md-table td{padding:6px 10px;text-align:left;border-bottom:1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5))}.assistant-markdown[data-v-50a42f8f] .md-table th{font-weight:600;white-space:nowrap;background:var(--app-bg-muted, #f5f5f7)}.assistant-markdown[data-v-50a42f8f] .md-table tbody tr:last-child td{border-bottom:none}.assistant-markdown[data-v-50a42f8f] .md-codeblock{margin:0 0 8px;overflow:hidden;border:1px solid var(--app-separator, var(--el-border-color-lighter, #ebeef5));border-radius:8px}.assistant-markdown[data-v-50a42f8f] .md-codeblock:last-child{margin-bottom:0}.assistant-markdown[data-v-50a42f8f] .md-codeblock__head{display:flex;align-items:center;padding:4px 10px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;font-weight:600;color:var(--app-text-secondary);background:var(--app-bg-muted, #f5f5f7)}.assistant-markdown[data-v-50a42f8f] .md-pre{margin:0;padding:10px 12px;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;background:var(--app-bg-muted, #f5f5f7)}.assistant-markdown[data-v-50a42f8f] .md-code{padding:1px 5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.86em;border-radius:4px;background:var(--app-bg-muted, #f5f5f7)}.assistant-markdown[data-v-50a42f8f] .md-pre .md-code{padding:0;background:transparent}.assistant-markdown[data-v-50a42f8f] a{color:var(--el-color-primary, #409eff);text-decoration:none}.assistant-markdown[data-v-50a42f8f] a:hover{text-decoration:underline}.assistant-markdown[data-v-50a42f8f] .md-img{max-width:100%;border-radius:8px}.assistant-markdown.is-compact[data-v-50a42f8f]{font-size:12px;line-height:1.6;color:var(--app-text-secondary)}.assistant-markdown.is-compact[data-v-50a42f8f] .md-heading{font-size:12px}", Et = /* @__PURE__ */ we(Zr, [["styles", [Kr]], ["__scopeId", "data-v-50a42f8f"]]), Jr = 100;
function Gr(e, n, t) {
  const i = N(Date.now());
  let o = null;
  const r = R(
    () => t.value && n.value === void 0 && e.value !== void 0
  ), a = () => {
    i.value = Date.now();
  };
  return Te(
    r,
    (c) => {
      c && o === null ? (a(), o = setInterval(a, Jr), window.addEventListener("focus", a), document.addEventListener("visibilitychange", a)) : !c && o !== null && (clearInterval(o), o = null, window.removeEventListener("focus", a), document.removeEventListener("visibilitychange", a));
    },
    { immediate: !0 }
  ), xi(() => {
    o !== null && clearInterval(o), o = null, window.removeEventListener("focus", a), document.removeEventListener("visibilitychange", a);
  }), R(() => {
    if (n.value !== void 0) return n.value;
    if (!(!r.value || e.value === void 0))
      return Math.max(0, i.value - e.value);
  });
}
const Vr = { class: "assistant-reasoning" }, Hr = /* @__PURE__ */ ye({
  name: "AssistantReasoning",
  __name: "AssistantReasoning",
  props: {
    text: { type: String },
    startedAtMs: { type: Number },
    durationMs: { type: Number },
    streaming: { type: Boolean, default: !1 }
  },
  setup(e) {
    const n = e, { t } = Re(), i = Gr(
      Pt(n, "startedAtMs"),
      Pt(n, "durationMs"),
      Pt(n, "streaming")
    ), o = R(() => {
      const r = i.value;
      return r !== void 0 ? t("notification.reasoning-duration", { s: (r / 1e3).toFixed(1) }) : t("notification.reasoning");
    });
    return (r, a) => (b(), m("details", Vr, [
      u("summary", null, h(o.value), 1),
      ie(Et, {
        compact: "",
        content: e.text
      }, null, 8, ["content"])
    ]));
  }
}), Yr = ".assistant-reasoning[data-v-429b7d26]{min-width:0}.assistant-reasoning summary[data-v-429b7d26]{cursor:pointer;font-size:12px;color:var(--app-text-secondary, var(--app-text));-webkit-user-select:none;user-select:none}", Fn = /* @__PURE__ */ we(Hr, [["styles", [Yr]], ["__scopeId", "data-v-429b7d26"]]), Xr = ["title"], _r = /* @__PURE__ */ ye({
  name: "AssistantScopeChip",
  __name: "AssistantScopeChip",
  props: {
    scope: { type: Object }
  },
  setup(e) {
    const { t: n } = Re();
    return (t, i) => (b(), m("p", {
      class: ve(["assistant-scope-chip", { "is-degraded": e.scope.degraded }]),
      title: e.scope.summary || void 0,
      "data-testid": "assistant-confirm-scope"
    }, [
      u("i", {
        class: ve(e.scope.degraded ? "ri-shield-keyhole-line" : "ri-guide-line")
      }, null, 2),
      u("span", null, h(e.scope.degraded ? f(n)("assistant.confirm-scope-degraded") : e.scope.summary ? f(n)("assistant.confirm-scope-resolved", { summary: e.scope.summary }) : f(n)("assistant.confirm-scope-resolved-default")), 1)
    ], 10, Xr));
  }
}), $r = '@charset "UTF-8";.assistant-scope-chip[data-v-943d20a0]{display:inline-flex;align-items:center;gap:4px;max-width:100%;margin:4px 0 0;padding:2px 8px;border-radius:999px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-scope-chip>i[data-v-943d20a0]{flex-shrink:0;font-size:12px}.assistant-scope-chip[data-v-943d20a0]{color:var(--app-text-secondary);background:var(--app-bg-muted, #f5f5f7)}.assistant-scope-chip.is-degraded[data-v-943d20a0]{color:var(--app-color-warning, var(--el-color-warning, #e6a23c));background:var(--el-color-warning-light-9, #fdf6ec)}', ln = /* @__PURE__ */ we(_r, [["styles", [$r]], ["__scopeId", "data-v-943d20a0"]]), ea = /((?:视频地址|下载地址)[:：]\s*)(https?:\/\/[^\s)]+|\/media\/[^\s)]+)/g;
function ta(e) {
  const n = [];
  return {
    markdownContent: e.split(/\r?\n/).map((i) => {
      let o = !1;
      const r = i.replace(
        ea,
        (a, c, d) => {
          const g = St(d) || d;
          return n.push({
            label: c.replace(/[:：]\s*$/, "").trim() || "下载地址",
            rawUrl: d,
            resolvedUrl: g
          }), o = !0, "";
        }
      );
      return o ? r.replace(/[·:：\s-]+$/g, "").trimEnd() : i;
    }).join(`
`).replace(/\n{3,}/g, `

`).trim(),
    mediaLinks: n
  };
}
function na(e) {
  const n = Math.max(0, Math.ceil(e / 1e3)), t = Math.floor(n / 86400), i = Math.floor(n % 86400 / 3600), o = Math.floor(n % 3600 / 60), r = n % 60;
  return t > 0 ? `${t} 天 ${i} 小时` : i > 0 ? `${i} 小时 ${o} 分` : `${o} 分 ${r} 秒`;
}
function bi(e, n = !0) {
  const t = R(() => {
    const c = ki(e);
    if (c === void 0) return;
    const d = Date.parse(c);
    if (!Number.isFinite(d))
      throw new Error("Tool confirmation expiry is invalid");
    return d;
  }), i = N(Date.now());
  let o = null;
  const r = () => {
    o && (n ? clearInterval(o) : clearTimeout(o), o = null);
  }, a = () => {
    i.value = Date.now();
  };
  return typeof window < "u" && (Te(t, () => {
    r(), a(), t.value !== void 0 && (o = n ? setInterval(a, 1e3) : setTimeout(a, Math.max(0, t.value - Date.now())));
  }, { immediate: !0 }), window.addEventListener("focus", a), document.addEventListener("visibilitychange", a), Zn(() => {
    r(), window.removeEventListener("focus", a), document.removeEventListener("visibilitychange", a);
  })), R(() => {
    if (t.value === void 0) return;
    const c = Math.max(0, t.value - i.value);
    return {
      expired: c === 0,
      label: na(c)
    };
  });
}
const ia = {
  class: "assistant-timeline",
  "data-testid": "assistant-timeline"
}, oa = {
  key: 0,
  class: "assistant-timeline__tool-wrap"
}, ra = ["data-testid"], aa = { class: "assistant-timeline__tool-name" }, la = {
  key: 0,
  class: "assistant-timeline__countdown"
}, sa = {
  key: 2,
  class: "assistant-timeline__plan"
}, ca = { class: "assistant-timeline__plan-summary" }, fa = ["data-testid"], da = {
  key: 4,
  class: "assistant-timeline__children-wrap"
}, ba = ["data-testid", "onClick"], ua = { key: 0 }, pa = { key: 1 }, ma = {
  key: 0,
  class: "assistant-timeline__children"
}, ga = {
  key: 2,
  class: "assistant-timeline__child-tool"
}, ha = { class: "assistant-timeline__tool-name" }, va = {
  key: 0,
  class: "assistant-timeline__countdown"
}, ya = ["data-testid"], wa = {
  key: 3,
  class: "assistant-timeline__plan"
}, xa = { class: "assistant-timeline__plan-summary" }, ka = {
  key: 0,
  class: "assistant-timeline__media-list"
}, Ea = { class: "assistant-media-card__info" }, Ca = { class: "assistant-media-card__label" }, Aa = ["href", "title"], Ia = ["href"], Sa = /* @__PURE__ */ ye({
  name: "AssistantTimeline",
  __name: "AssistantTimeline",
  props: {
    items: { type: Array },
    confirmation: { type: Object },
    streaming: { type: Boolean }
  },
  emits: ["decision"],
  setup(e, { emit: n }) {
    const t = e, i = n, { t: o } = Re(), r = ["done", "error", "cancelled", "rejected", "expired"], a = ["calling", "awaiting_approval", "approved"], c = N(/* @__PURE__ */ new Set());
    function d(C) {
      return C.status === "calling" ? !0 : c.value.has(C.id);
    }
    function g(C) {
      const L = new Set(c.value);
      L.has(C) ? L.delete(C) : L.add(C), c.value = L;
    }
    function x(C) {
      const L = C.children ?? [], M = L.filter((re) => re.type === "tool").length;
      if (M === 0) return "";
      const oe = L.filter((re) => re.type === "tool" && r.includes(re.status)).length, O = L.filter((re) => re.type === "tool" && a.includes(re.status)).length;
      return C.status === "calling" ? O > 0 ? o("assistant.subagent-progress-doing", { label: `${oe}/${M}` }) : o("assistant.subagent-progress-ran", { label: M }) : o("assistant.subagent-progress-done", { label: M });
    }
    const v = { markdownContent: "", mediaLinks: [] }, k = R(
      () => t.items.map(
        (C) => C.type === "content" ? ta(C.text) : v
      )
    );
    function y(C) {
      return k.value[C] ?? v;
    }
    const w = R(() => t.confirmation?.toolCallIds.length === 1 ? t.confirmation : void 0);
    function I(C, L) {
      const M = t.confirmation;
      return !M || (M.parentToolCallId ?? void 0) !== (L ?? void 0) ? !1 : M.toolCallIds.includes(C);
    }
    const P = bi(
      () => w.value ? w.value.expiresAt : void 0
    );
    function q(C) {
      switch (C) {
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
    return (C, L) => (b(), m("div", ia, [
      (b(!0), m(ue, null, Ee(e.items, (M, oe) => (b(), m(ue, {
        key: `${M.type}-${oe}`
      }, [
        M.type === "tool" ? (b(), m("div", oa, [
          u("div", {
            class: "assistant-timeline__tool",
            "data-testid": `assistant-tool-${oe}`
          }, [
            L[0] || (L[0] = u("i", {
              class: "ri-tools-line",
              "aria-hidden": "true"
            }, null, -1)),
            u("span", aa, h(f(wn)(M.name)), 1),
            u("span", {
              class: ve(["assistant-timeline__tool-status", `is-${M.status}`])
            }, h(f(o)(q(M.status))), 3),
            I(M.id, void 0) && M.status === "awaiting_approval" && w.value && f(P) && !f(P).expired ? (b(), m("span", la, h(f(o)("assistant.tool-awaiting", { time: f(P).label })), 1)) : B("", !0),
            I(M.id, void 0) && M.status === "awaiting_approval" && w.value?.scope ? (b(), se(ln, {
              key: 1,
              scope: w.value.scope
            }, null, 8, ["scope"])) : B("", !0),
            M.plan ? (b(), m("div", sa, [
              u("p", ca, h(M.plan.summary), 1),
              (b(!0), m(ue, null, Ee(M.plan.changes, (O, re) => (b(), m("p", {
                key: re,
                class: "assistant-timeline__plan-change"
              }, h(O.field) + ": " + h(O.before) + " → " + h(O.after), 1))), 128))
            ])) : B("", !0),
            e.confirmation && I(M.id, void 0) && M.status === "awaiting_approval" && e.confirmation.showActions && !f(P)?.expired ? (b(), m("div", {
              key: 3,
              class: "assistant-timeline__confirm",
              "data-testid": `assistant-confirm-${M.id}`
            }, [
              ie(he, {
                variant: "secondary",
                size: "sm",
                disabled: e.confirmation.submitting,
                "data-testid": `assistant-reject-${M.id}`,
                onClick: (O) => i("decision", M.id, !1)
              }, {
                default: ne(() => [
                  H(h(f(o)("assistant.confirm-reject")), 1)
                ]),
                _: 1
              }, 8, ["disabled", "data-testid", "onClick"]),
              ie(he, {
                size: "sm",
                disabled: e.confirmation.submitting,
                "data-testid": `assistant-approve-${M.id}`,
                onClick: (O) => i("decision", M.id, !0)
              }, {
                default: ne(() => [
                  H(h(f(o)("assistant.confirm-approve")), 1)
                ]),
                _: 1
              }, 8, ["disabled", "data-testid", "onClick"])
            ], 8, fa)) : B("", !0),
            M.children && M.children.length ? (b(), m("div", da, [
              u("button", {
                type: "button",
                class: "assistant-timeline__children-toggle",
                "data-testid": `subagent-toggle-${oe}`,
                onClick: (O) => g(M.id)
              }, [
                u("i", {
                  class: ve(d(M) ? "ri-arrow-down-s-line" : "ri-arrow-right-s-line")
                }, null, 2),
                x(M) ? (b(), m("span", ua, h(x(M)), 1)) : (b(), m("span", pa, h(M.agentName || f(o)("assistant.subagent-default")), 1))
              ], 8, ba),
              d(M) ? (b(), m("div", ma, [
                (b(!0), m(ue, null, Ee(M.children, (O, re) => (b(), m(ue, {
                  key: `c-${re}`
                }, [
                  O.type === "reasoning" ? (b(), se(Fn, {
                    key: 0,
                    text: O.text,
                    "started-at-ms": O.startedAtMs,
                    "duration-ms": O.durationMs,
                    class: "assistant-timeline__child-reasoning"
                  }, null, 8, ["text", "started-at-ms", "duration-ms"])) : O.type === "content" ? (b(), se(Et, {
                    key: 1,
                    class: "assistant-timeline__sub-content",
                    compact: "",
                    content: O.text
                  }, null, 8, ["content"])) : (b(), m("div", ga, [
                    u("span", ha, h(f(wn)(O.name)), 1),
                    u("span", {
                      class: ve(["assistant-timeline__tool-status", `is-${O.status}`])
                    }, h(f(o)(q(O.status))), 3),
                    e.confirmation && I(O.id, M.id) && O.status === "awaiting_approval" && w.value && f(P) && !f(P).expired ? (b(), m("span", va, h(f(o)("assistant.tool-awaiting", { time: f(P).label })), 1)) : B("", !0),
                    e.confirmation && I(O.id, M.id) && O.status === "awaiting_approval" && w.value?.scope ? (b(), se(ln, {
                      key: 1,
                      scope: w.value.scope
                    }, null, 8, ["scope"])) : B("", !0),
                    e.confirmation && I(O.id, M.id) && O.status === "awaiting_approval" && e.confirmation.showActions && !f(P)?.expired ? (b(), m("div", {
                      key: 2,
                      class: "assistant-timeline__confirm",
                      "data-testid": `assistant-confirm-${O.id}`
                    }, [
                      ie(he, {
                        variant: "secondary",
                        size: "sm",
                        disabled: e.confirmation.submitting,
                        "data-testid": `assistant-reject-${O.id}`,
                        onClick: ($) => i("decision", O.id, !1)
                      }, {
                        default: ne(() => [
                          H(h(f(o)("assistant.confirm-reject")), 1)
                        ]),
                        _: 1
                      }, 8, ["disabled", "data-testid", "onClick"]),
                      ie(he, {
                        size: "sm",
                        disabled: e.confirmation.submitting,
                        "data-testid": `assistant-approve-${O.id}`,
                        onClick: ($) => i("decision", O.id, !0)
                      }, {
                        default: ne(() => [
                          H(h(f(o)("assistant.confirm-approve")), 1)
                        ]),
                        _: 1
                      }, 8, ["disabled", "data-testid", "onClick"])
                    ], 8, ya)) : B("", !0),
                    O.plan ? (b(), m("div", wa, [
                      u("p", xa, h(O.plan.summary), 1),
                      (b(!0), m(ue, null, Ee(O.plan.changes, ($, Y) => (b(), m("p", {
                        key: Y,
                        class: "assistant-timeline__plan-change"
                      }, h($.field) + ": " + h($.before) + " → " + h($.after), 1))), 128))
                    ])) : B("", !0)
                  ]))
                ], 64))), 128))
              ])) : B("", !0)
            ])) : B("", !0),
            M.status !== "calling" && M.status !== "preparing" && M.status !== "awaiting_approval" && M.result ? (b(), se(Et, {
              key: 5,
              class: "assistant-timeline__result",
              compact: "",
              content: M.result
            }, null, 8, ["content"])) : B("", !0)
          ], 8, ra)
        ])) : M.type === "reasoning" ? (b(), se(Fn, {
          key: 1,
          class: "assistant-timeline__reasoning",
          text: M.text,
          "started-at-ms": M.startedAtMs,
          "duration-ms": M.durationMs,
          streaming: e.streaming
        }, null, 8, ["text", "started-at-ms", "duration-ms", "streaming"])) : (b(), m(ue, { key: 2 }, [
          ie(Et, {
            class: "assistant-timeline__content",
            "data-testid": `assistant-content-${oe}`,
            content: y(oe).markdownContent
          }, null, 8, ["data-testid", "content"]),
          y(oe).mediaLinks.length ? (b(), m("div", ka, [
            (b(!0), m(ue, null, Ee(y(oe).mediaLinks, (O, re) => (b(), m("div", {
              key: `${O.resolvedUrl}-${re}`,
              class: "assistant-media-card"
            }, [
              u("div", Ea, [
                u("p", Ca, h(O.label), 1),
                u("a", {
                  class: "assistant-media-card__url",
                  href: O.resolvedUrl,
                  target: "_blank",
                  rel: "noreferrer",
                  title: O.resolvedUrl
                }, h(O.resolvedUrl), 9, Aa)
              ]),
              u("a", {
                class: "assistant-media-card__download",
                href: O.resolvedUrl,
                target: "_blank",
                rel: "noreferrer",
                download: ""
              }, [
                L[1] || (L[1] = u("svg", {
                  class: "assistant-media-card__dl-icon",
                  viewBox: "0 0 24 24",
                  fill: "none",
                  stroke: "currentColor",
                  "stroke-width": "2",
                  "aria-hidden": "true"
                }, [
                  u("path", {
                    d: "M12 3v12m0 0 4-4m-4 4-4-4",
                    "stroke-linecap": "round",
                    "stroke-linejoin": "round"
                  }),
                  u("path", {
                    d: "M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2",
                    "stroke-linecap": "round"
                  })
                ], -1)),
                H(" " + h(f(o)("assistant.media-download")), 1)
              ], 8, Ia)
            ]))), 128))
          ])) : B("", !0)
        ], 64))
      ], 64))), 128))
    ]));
  }
}), Ta = '@charset "UTF-8";.assistant-timeline[data-v-c0250d96]{min-width:0;width:100%;display:flex;flex-direction:column;gap:10px}.assistant-timeline__content[data-v-c0250d96]{margin:0;font-size:13px;line-height:1.7;color:var(--app-text);word-break:break-word}.assistant-timeline__media-list[data-v-c0250d96]{display:flex;flex-direction:column;gap:12px;margin-top:8px}.assistant-media-card[data-v-c0250d96]{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--app-border, rgba(0, 0, 0, .1));border-radius:12px;background:var(--app-surface-muted, rgba(0, 0, 0, .03))}.assistant-media-card__info[data-v-c0250d96]{min-width:0;flex:1}.assistant-media-card__label[data-v-c0250d96]{margin:0;font-size:12px;font-weight:500;color:var(--app-text-secondary, var(--app-text))}.assistant-media-card__url[data-v-c0250d96]{display:block;margin-top:4px;font-size:12px;line-height:1.6;word-break:break-all;color:var(--app-text-secondary, var(--app-text));text-decoration:underline dotted;text-underline-offset:2px}.assistant-media-card__url[data-v-c0250d96]:hover{color:var(--app-text)}.assistant-media-card__dl-icon[data-v-c0250d96]{width:14px;height:14px}.assistant-media-card__download[data-v-c0250d96]{display:inline-flex;align-items:center;gap:6px;flex-shrink:0;padding:8px 12px;border:1px solid var(--app-primary, #409eff);border-radius:8px;font-size:12px;font-weight:500;color:var(--app-primary, #409eff);text-decoration:none}.assistant-media-card__download[data-v-c0250d96]:hover{background:color-mix(in srgb,var(--app-primary, #409eff) 12%,transparent)}.assistant-timeline__reasoning[data-v-c0250d96]{font-size:12px;color:var(--app-text-secondary)}.assistant-timeline__reasoning summary[data-v-c0250d96]{cursor:pointer;color:var(--app-text-tertiary, var(--app-text-secondary))}.assistant-timeline__reasoning .assistant-timeline__reasoning-text[data-v-c0250d96]{margin:6px 0 0}.assistant-timeline__tool-wrap[data-v-c0250d96]{content-visibility:auto;contain-intrinsic-size:auto 48px}.assistant-timeline__tool[data-v-c0250d96],.assistant-timeline__child-tool[data-v-c0250d96]{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border-radius:8px;border:1px solid var(--app-separator, var(--el-border-color-lighter));font-size:12px}.assistant-timeline__tool>i[data-v-c0250d96],.assistant-timeline__child-tool>i[data-v-c0250d96]{color:var(--app-text-tertiary, var(--app-text-secondary))}.assistant-timeline__child-tool[data-v-c0250d96]{padding:6px 8px}.assistant-timeline__tool-name[data-v-c0250d96]{font-weight:500;color:var(--app-text)}.assistant-timeline__tool-status[data-v-c0250d96]{margin-left:auto;font-size:11px}.assistant-timeline__tool-status.is-awaiting_approval[data-v-c0250d96]{color:var(--el-color-warning, #e6a23c)}.assistant-timeline__tool-status.is-done[data-v-c0250d96]{color:var(--el-color-success, #67c23a)}.assistant-timeline__tool-status.is-error[data-v-c0250d96]{color:var(--el-color-danger, #f56c6c)}.assistant-timeline__tool-status.is-cancelled[data-v-c0250d96],.assistant-timeline__tool-status.is-rejected[data-v-c0250d96],.assistant-timeline__tool-status.is-expired[data-v-c0250d96]{color:var(--app-text-tertiary, #a8abb2)}.assistant-timeline__tool-status.is-calling[data-v-c0250d96],.assistant-timeline__tool-status.is-approved[data-v-c0250d96],.assistant-timeline__tool-status.is-preparing[data-v-c0250d96]{color:var(--el-color-primary, #409eff)}.assistant-timeline__countdown[data-v-c0250d96]{font-size:11px;color:var(--el-color-warning, #e6a23c);font-variant-numeric:tabular-nums}.assistant-timeline__confirm[data-v-c0250d96]{width:100%;display:flex;justify-content:flex-end;gap:8px;padding-top:6px;border-top:1px dashed var(--app-separator, var(--el-border-color-lighter))}.assistant-timeline__plan[data-v-c0250d96]{width:100%;padding-top:6px;border-top:1px dashed var(--app-separator, var(--el-border-color-lighter))}.assistant-timeline__plan-summary[data-v-c0250d96]{margin:0 0 4px;color:var(--app-text)}.assistant-timeline__plan-change[data-v-c0250d96]{margin:2px 0 0;font-size:11px;color:var(--app-text-secondary);font-variant-numeric:tabular-nums}.assistant-timeline__children-wrap[data-v-c0250d96]{width:100%}.assistant-timeline__children-toggle[data-v-c0250d96]{display:inline-flex;align-items:center;gap:4px;padding:2px 6px;margin:4px 0;border:none;border-radius:6px;background:transparent;font-size:12px;color:var(--app-text-secondary, var(--app-text));cursor:pointer}.assistant-timeline__children-toggle[data-v-c0250d96]:hover{background:var(--app-fill-color, rgba(0, 0, 0, .04))}.assistant-timeline__children[data-v-c0250d96]{width:100%;display:flex;flex-direction:column;gap:8px;padding:8px 10px;border-top:1px dashed var(--app-separator, var(--el-border-color-lighter))}.assistant-timeline__sub-content[data-v-c0250d96]{margin:0;font-size:12px;line-height:1.6;color:var(--app-text-secondary);word-break:break-word}.assistant-timeline__result[data-v-c0250d96]{width:100%;margin:0;font-size:11px;color:var(--app-text-secondary);word-break:break-word;max-height:120px;overflow-y:auto}', jn = /* @__PURE__ */ we(Sa, [["styles", [Ta]], ["__scopeId", "data-v-c0250d96"]]), Ma = {
  key: 0,
  class: "assistant-confirm-bar",
  "aria-live": "polite",
  "data-testid": "assistant-batch-approval"
}, Ra = { class: "assistant-confirm-bar__main" }, La = { class: "assistant-confirm-bar__title" }, Ua = { class: "assistant-confirm-bar__hint" }, Da = {
  key: 0,
  class: "assistant-confirm-bar__actions"
}, qa = {
  key: 0,
  class: "ri-loader-4-line is-spinning"
}, za = {
  key: 0,
  class: "ri-loader-4-line is-spinning"
}, Fa = {
  key: 1,
  class: "ri-check-double-line"
}, ja = /* @__PURE__ */ ye({
  name: "AssistantToolConfirmBar",
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
  setup(e, { emit: n }) {
    const t = e, i = n, { t: o } = Re(), r = bi(() => t.expiresAt), a = R(() => r.value?.expired ?? !1), c = R(() => t.toolCallIds.filter((v) => Object.prototype.hasOwnProperty.call(t.decisions, v)).length), d = R(() => Yo(t.toolCallIds, t.decisions)), g = R(() => t.showActions || a.value), x = R(() => {
      if (a.value) return o("assistant.confirm-batch-expired");
      if (t.submitting) return o("assistant.confirm-batch-submitting", { n: t.toolCallIds.length });
      const v = c.value > 0 ? o("assistant.confirm-batch-selected", { n: c.value, total: t.toolCallIds.length }) : "";
      return o("assistant.confirm-batch-waiting", {
        n: t.toolCallIds.length,
        selected: v,
        time: r.value?.label ?? ""
      });
    });
    return (v, k) => g.value && e.toolCallIds.length >= 2 ? (b(), m("section", Ma, [
      u("span", {
        class: ve(["assistant-confirm-bar__icon", { "is-spinning": e.submitting && !a.value }])
      }, [
        u("i", {
          class: ve(a.value ? "ri-time-line" : e.submitting ? "ri-loader-4-line" : "ri-shield-check-line")
        }, null, 2)
      ], 2),
      u("div", Ra, [
        u("p", La, h(f(o)("assistant.confirm-batch-title")), 1),
        u("p", Ua, h(x.value), 1),
        e.scopeDigest ? (b(), se(ln, {
          key: 0,
          scope: e.scopeDigest
        }, null, 8, ["scope"])) : B("", !0)
      ]),
      a.value ? B("", !0) : (b(), m("div", Da, [
        ie(he, {
          variant: "secondary",
          size: "sm",
          disabled: e.submitting,
          "data-testid": "assistant-reject-all",
          onClick: k[0] || (k[0] = (y) => i("decision", !1))
        }, {
          default: ne(() => [
            e.submitting && d.value === !1 ? (b(), m("i", qa)) : B("", !0),
            H(" " + h(f(o)("assistant.confirm-reject-all")), 1)
          ]),
          _: 1
        }, 8, ["disabled"]),
        ie(he, {
          size: "sm",
          disabled: e.submitting,
          "data-testid": "assistant-approve-all",
          onClick: k[1] || (k[1] = (y) => i("decision", !0))
        }, {
          default: ne(() => [
            e.submitting && d.value === !0 ? (b(), m("i", za)) : (b(), m("i", Fa)),
            H(" " + h(f(o)("assistant.confirm-approve-all")), 1)
          ]),
          _: 1
        }, 8, ["disabled"])
      ]))
    ])) : B("", !0);
  }
}), Na = ".assistant-confirm-bar[data-v-5f00f5f8]{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid var(--app-separator, var(--el-border-color-lighter));background:var(--app-sidebar-item-hover-bg, var(--el-fill-color-light))}.assistant-confirm-bar__icon[data-v-5f00f5f8]{flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:var(--el-color-primary-light-9, #ecf5ff);color:var(--el-color-primary, #409eff);font-size:15px}.assistant-confirm-bar__icon.is-spinning[data-v-5f00f5f8]{animation:assistant-confirm-spin-5f00f5f8 1s linear infinite}@keyframes assistant-confirm-spin-5f00f5f8{0%{transform:rotate(0)}to{transform:rotate(360deg)}}.assistant-confirm-bar__main[data-v-5f00f5f8]{flex:1;min-width:0}.assistant-confirm-bar__main p[data-v-5f00f5f8]{margin:0}.assistant-confirm-bar__title[data-v-5f00f5f8]{font-size:13px;font-weight:500;color:var(--app-text)}.assistant-confirm-bar__hint[data-v-5f00f5f8]{margin-top:2px;font-size:11px;color:var(--app-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-confirm-bar__actions[data-v-5f00f5f8]{flex-shrink:0;display:flex;align-items:center;gap:8px}.is-spinning[data-v-5f00f5f8]{animation:assistant-confirm-spin-5f00f5f8 1s linear infinite}", Ba = /* @__PURE__ */ we(ja, [["styles", [Na]], ["__scopeId", "data-v-5f00f5f8"]]), Oa = ["src", "alt"], Qa = ["aria-label"], Pa = /* @__PURE__ */ ye({
  name: "IaSafeImage",
  __name: "SafeImage",
  props: {
    src: { default: null, type: [String, null] },
    alt: { default: "", type: String }
  },
  emits: ["error", "load"],
  setup(e, { emit: n }) {
    const t = e, i = n, o = N(!1);
    Te(() => t.src, () => {
      o.value = !1;
    });
    const r = R(() => t.src && t.src.trim() ? t.src : null);
    return (a, c) => !o.value && r.value ? (b(), m("img", {
      key: 0,
      src: r.value,
      alt: e.alt,
      loading: "lazy",
      onError: c[0] || (c[0] = () => {
        o.value = !0, i("error");
      }),
      onLoad: c[1] || (c[1] = (d) => i("load"))
    }, null, 40, Oa)) : (b(), m("span", {
      key: 1,
      class: ve(["safe-image__fallback", { "is-error": o.value }]),
      role: "img",
      "aria-label": e.alt
    }, [...c[2] || (c[2] = [
      u("svg", {
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        "stroke-width": "1.5",
        "aria-hidden": "true"
      }, [
        u("rect", {
          x: "3",
          y: "5",
          width: "18",
          height: "14",
          rx: "2"
        }),
        u("circle", {
          cx: "9",
          cy: "10",
          r: "1.6"
        }),
        u("path", {
          d: "m5 17 4.5-4.5L13 16l3-3 3 3",
          "stroke-linecap": "round",
          "stroke-linejoin": "round"
        })
      ], -1)
    ])], 10, Qa));
  }
}), Wa = "img[data-v-5684bc6b]{display:block;max-width:100%}.safe-image__fallback[data-v-5684bc6b]{display:grid;place-items:center;width:100%;height:100%;min-height:44px;border-radius:var(--app-radius-sm, 6px);background:var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7));color:var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2))}.safe-image__fallback.is-error[data-v-5684bc6b]{color:var(--app-color-danger, var(--ia-danger, #f56c6c))}.safe-image__fallback svg[data-v-5684bc6b]{width:55%;height:55%}", Za = /* @__PURE__ */ we(Pa, [["styles", [Wa]], ["__scopeId", "data-v-5684bc6b"]]), Xt = 8, ui = 10 * 1024 * 1024, Ka = 20 * 1024 * 1024, Ja = 100 * 1024 * 1024, pi = {
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
}, Nn = new Set(Object.values(pi)), Ga = {
  image: "图片",
  video: "视频",
  audio: "音频",
  file: "文件"
};
class ze extends Error {
  key;
  params;
  constructor(n, t, i) {
    super(i), this.name = "AssistantAttachmentError", this.key = n, this.params = t;
  }
}
function Va(e) {
  const n = e.type.toLowerCase().split(";", 1)[0]?.trim() ?? "", t = e.name.toLowerCase().split(".").pop() ?? "", i = pi[t], o = Nn.has(n) ? n : i;
  if (!o || !Nn.has(o))
    throw new ze(
      "assistant.attachment-unsupported",
      { name: e.name },
      `${e.name} 不是支持的图片、视频、音频、PDF 或文本文件`
    );
  return o;
}
function Ha(e) {
  return e.startsWith("image/") ? "image" : e.startsWith("video/") ? "video" : e.startsWith("audio/") ? "audio" : "file";
}
const Ya = (e) => Xa(e);
function Xa(e) {
  return new Promise((n, t) => {
    const i = new FileReader();
    i.onerror = () => t(new ze(
      "assistant.attachment-read-failed",
      { name: e.name },
      `读取 ${e.name} 失败`
    )), i.onload = () => {
      const o = typeof i.result == "string" ? i.result : "", r = o.indexOf(",");
      if (r < 0) {
        t(new ze(
          "assistant.attachment-encode-failed",
          { name: e.name },
          `${e.name} 无法转换为 Base64`
        ));
        return;
      }
      n(o.slice(r + 1));
    }, i.readAsDataURL(e);
  });
}
function _a() {
  return typeof crypto < "u" && "randomUUID" in crypto ? crypto.randomUUID() : `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
async function $a({
  files: e,
  model: n,
  existing: t,
  upload: i = ao,
  readFileAsBase64: o = Ya
}) {
  if (t.length + e.length > Xt)
    throw new ze(
      "assistant.attachment-count-limit",
      { n: Xt },
      `单次最多添加 ${Xt} 个附件`
    );
  const r = new Set(t.map((v) => `${v.name}:${v.size}`)), a = e.filter((v) => {
    const k = `${v.name}:${v.size}`;
    return r.has(k) ? !1 : (r.add(k), !0);
  });
  let c = t.filter((v) => v.transport === "base64").reduce((v, k) => v + k.size, 0);
  const d = a.map((v) => {
    const k = Va(v), y = Ha(k), w = n.multimodalInputTransports[y] ?? [];
    if (!n.multimodalInputTypes.includes(y) || !w.length)
      throw new ze(
        "assistant.attachment-model-unsupported",
        { model: n.name, type: y },
        `${n.name} 不支持${Ga[y]}输入`
      );
    if (v.size <= 0 || v.size > Ja)
      throw new ze(
        "assistant.attachment-size-limit",
        { name: v.name },
        `${v.name} 的大小必须在 1B 到 100MB 之间`
      );
    let I = null;
    if (w.includes("base64") && v.size <= ui && c + v.size <= Ka ? (I = "base64", c += v.size) : w.includes("url") && (I = "url"), !I)
      throw new ze(
        "assistant.attachment-base64-limit",
        { name: v.name },
        `${v.name} 超出 Base64 限制，且当前模型未启用 URL 输入`
      );
    return { file: v, mimeType: k, inputType: y, transport: I };
  }), g = await Promise.allSettled(d.map(async ({
    file: v,
    mimeType: k,
    inputType: y,
    transport: w
  }) => {
    const I = _a(), P = await i(v, n.id, w);
    if (w === "base64") {
      const q = await o(v);
      return {
        id: I,
        name: v.name,
        inputType: y,
        mimeType: k,
        transport: w,
        data: q,
        resourceUrl: P,
        size: v.size,
        previewUrl: y === "image" ? St(P) ?? void 0 : void 0
      };
    }
    return {
      id: I,
      name: v.name,
      inputType: y,
      mimeType: k,
      transport: w,
      url: P,
      resourceUrl: P,
      size: v.size,
      previewUrl: y === "image" ? St(P) ?? void 0 : void 0
    };
  })), x = g.find((v) => v.status === "rejected");
  if (x)
    throw x.reason;
  return g.map((v) => v.value);
}
function el(e, n) {
  if (!n.length) return null;
  if (!e) return { key: "assistant.attachment-model-required", params: {} };
  for (const t of n) {
    const i = e.multimodalInputTransports[t.inputType] ?? [];
    if (!e.multimodalInputTypes.includes(t.inputType) || !i.includes(t.transport))
      return {
        key: "assistant.attachment-incompatible",
        params: { model: e.name, name: t.name, transport: t.transport.toUpperCase() }
      };
  }
  return null;
}
function tl(e) {
  const n = e?.multimodalInputTypes ?? [];
  return !e || !n.length ? { textOnly: !0, parts: [] } : {
    textOnly: !1,
    parts: n.map((t) => ({ type: t, transports: e.multimodalInputTransports[t] ?? [] }))
  };
}
function nl(e) {
  const n = e?.multimodalInputTypes ?? [];
  return [
    n.includes("image") ? "image/*" : null,
    n.includes("video") ? "video/*" : null,
    n.includes("audio") ? "audio/*" : null,
    n.includes("file") ? ".pdf,.txt,.md,.csv,.json" : null
  ].filter(Boolean).join(",");
}
function il(e) {
  return e < 1024 ? `${e} B` : e < 1024 * 1024 ? `${Math.ceil(e / 1024)} KB` : `${(e / 1024 / 1024).toFixed(1)} MB`;
}
function ol(e) {
  return e.transport === "url" && e.size > ui ? { key: "assistant.attachment-url-fallback", params: {} } : null;
}
const rl = ["data-testid", "title"], al = {
  key: 1,
  class: "assistant-attachment-chip__icon"
}, ll = { class: "assistant-attachment-chip__meta" }, sl = { class: "assistant-attachment-chip__name" }, cl = { class: "assistant-attachment-chip__size" }, fl = {
  key: 0,
  class: "assistant-attachment-chip__hint",
  "data-testid": "assistant-attachment-url-hint"
}, dl = ["data-testid", "disabled", "aria-label"], bl = /* @__PURE__ */ ye({
  name: "AssistantAttachmentChip",
  __name: "AssistantAttachmentChip",
  props: {
    attachment: { type: Object },
    removable: { type: Boolean, default: !1 },
    removeDisabled: { type: Boolean, default: !1 },
    testId: { default: "", type: String },
    hint: { default: "", type: String }
  },
  emits: ["remove"],
  setup(e, { emit: n }) {
    const t = e, i = n, { t: o } = Re(), r = t.testId || `assistant-attachment-${t.attachment.id}`;
    function a(c) {
      return c === "video" ? "ri-movie-2-line" : c === "audio" ? "ri-headphone-line" : "ri-file-text-line";
    }
    return (c, d) => (b(), m("div", {
      class: "assistant-attachment-chip",
      "data-testid": f(r),
      title: `${e.attachment.name} · ${e.attachment.transport.toUpperCase()}`
    }, [
      e.attachment.inputType === "image" && e.attachment.previewUrl ? (b(), se(Za, {
        key: 0,
        src: e.attachment.previewUrl,
        alt: e.attachment.name,
        class: "assistant-attachment-chip__thumb"
      }, null, 8, ["src", "alt"])) : (b(), m("span", al, [
        u("i", {
          class: ve(a(e.attachment.inputType))
        }, null, 2)
      ])),
      u("span", ll, [
        u("span", sl, h(e.attachment.name), 1),
        u("span", cl, h(f(il)(e.attachment.size)) + " · " + h(e.attachment.transport.toUpperCase()), 1),
        e.hint ? (b(), m("span", fl, h(e.hint), 1)) : B("", !0)
      ]),
      e.removable ? (b(), m("button", {
        key: 2,
        type: "button",
        class: "assistant-attachment-chip__remove fc-button-ghost",
        "data-testid": `assistant-attachment-remove-${e.attachment.id}`,
        disabled: e.removeDisabled,
        "aria-label": f(o)("assistant.attachment-remove"),
        onClick: d[0] || (d[0] = (g) => i("remove"))
      }, [...d[1] || (d[1] = [
        u("i", { class: "ri-close-line" }, null, -1)
      ])], 8, dl)) : B("", !0)
    ], 8, rl));
  }
}), ul = ".assistant-attachment-chip[data-v-40f73d97]{position:relative;display:flex;align-items:center;gap:8px;min-width:140px;max-width:190px;padding:6px;border-radius:var(--app-radius-md);border:1px solid var(--app-separator, var(--el-border-color-lighter));background:var(--app-bg-card, transparent)}.assistant-attachment-chip__thumb[data-v-40f73d97]{width:44px;height:44px;flex-shrink:0;border-radius:var(--app-radius-sm);object-fit:cover}.assistant-attachment-chip__icon[data-v-40f73d97]{display:grid;place-items:center;width:44px;height:44px;flex-shrink:0;border-radius:var(--app-radius-sm);color:var(--app-text-secondary);font-size:18px}.assistant-attachment-chip__meta[data-v-40f73d97]{display:flex;flex-direction:column;min-width:0;gap:4px}.assistant-attachment-chip__name[data-v-40f73d97]{font-size:10px;font-weight:600;color:var(--app-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-attachment-chip__size[data-v-40f73d97]{font-size:9px;color:var(--app-text-secondary)}.assistant-attachment-chip__hint[data-v-40f73d97]{font-size:9px;color:var(--app-color-warning, var(--el-color-warning, #e6a23c))}.assistant-attachment-chip__remove[data-v-40f73d97]{position:absolute;top:2px;right:2px;display:grid;place-items:center;width:18px;height:18px;padding:0;border:none;border-radius:var(--app-radius-full, 9999px);background:none;cursor:pointer;font-size:12px;color:var(--app-text-secondary)}.assistant-attachment-chip__remove[data-v-40f73d97]:hover{color:var(--app-text)}", mi = /* @__PURE__ */ we(bl, [["styles", [ul]], ["__scopeId", "data-v-40f73d97"]]);
function Bn(e) {
  return typeof e == "object" && e !== null && !Array.isArray(e);
}
const pl = /* @__PURE__ */ new Set(["image", "video", "audio", "file"]);
function ml(e) {
  const n = e?.referencesJson;
  if (!n) return [];
  let t;
  try {
    t = JSON.parse(n);
  } catch {
    return [];
  }
  if (!Bn(t) || !Array.isArray(t.attachments)) return [];
  const i = [];
  for (const o of t.attachments) {
    if (!Bn(o)) continue;
    const r = typeof o.id == "string" && o.id.trim() ? o.id : "", a = typeof o.name == "string" && o.name.trim() ? o.name : "";
    if (!r || !a) continue;
    const c = typeof o.inputType == "string" && pl.has(o.inputType) ? o.inputType : "file", d = typeof o.resourceUrl == "string" && o.resourceUrl.trim() ? o.resourceUrl : void 0;
    i.push({
      id: r,
      name: a,
      inputType: c,
      mimeType: typeof o.mimeType == "string" && o.mimeType ? o.mimeType : "application/octet-stream",
      transport: o.transport === "url" ? "url" : "base64",
      size: typeof o.size == "number" && Number.isFinite(o.size) && o.size >= 0 ? o.size : 0,
      ...d ? { resourceUrl: d } : {},
      ...c === "image" && d ? { previewUrl: St(d) ?? void 0 } : {}
    });
  }
  return i;
}
const gl = 30, hl = 100, _t = 20;
function vl(e) {
  const { viewportRef: n, contentRef: t } = e, i = N(!1), o = N(!1);
  let r = !1, a = !0, c = !1, d = !1, g = 0, x = null, v = null;
  function k() {
    v !== null && (cancelAnimationFrame(v), v = null), c = !1;
  }
  function y() {
    const Q = n.value;
    Q && (k(), Q.scrollTop = Q.scrollHeight, g = Q.scrollTop);
  }
  function w() {
    const Q = n.value;
    if (!Q) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      y();
      return;
    }
    if (v !== null) return;
    const V = Q.scrollTop, Me = performance.now();
    c = !0;
    const Ae = () => {
      const fe = n.value;
      if (!fe) {
        v = null, c = !1;
        return;
      }
      const _ = Math.max(0, fe.scrollHeight - fe.clientHeight), me = Math.min((performance.now() - Me) / hl, 1), ee = 1 - Math.pow(1 - me, 3);
      if (fe.scrollTop = V + (_ - V) * ee, g = fe.scrollTop, me < 1) {
        v = requestAnimationFrame(Ae);
        return;
      }
      fe.scrollTop = _, g = fe.scrollTop, v = null, c = !1;
    };
    v = requestAnimationFrame(Ae);
  }
  function I() {
    v !== null || r || !e.running() && !a || w();
  }
  function P() {
    const Q = n.value;
    return !!Q && Q.scrollHeight > Q.clientHeight + _t;
  }
  Te(
    () => e.contentReady() && !!n.value,
    (Q) => {
      Q && (r = !1, y(), requestAnimationFrame(() => {
        n.value && (y(), requestAnimationFrame(() => {
          y(), a = !1, o.value = !1, i.value = !0;
        }));
      }));
    },
    { immediate: !0 }
  ), Te(
    () => e.running(),
    (Q, V) => {
      Q && !V && (r = !1, o.value = !1, w());
    }
  ), Te(
    () => e.contentVersion(),
    () => {
      i.value && e.running() && !r && w();
    }
  );
  let q = null;
  Te(
    () => [t.value, n.value],
    ([Q, V]) => {
      q?.disconnect(), !(!Q || !V || typeof ResizeObserver > "u") && (q = new ResizeObserver(() => I()), q.observe(Q), q.observe(V));
    },
    { immediate: !0 }
  );
  const C = (Q) => {
    Q.button === 0 && P() && (d = !0);
  }, L = () => {
    d = !1;
  };
  window.addEventListener("pointerup", L), window.addEventListener("pointercancel", L);
  function M() {
    if (r) return;
    r = !0, k();
    const Q = n.value;
    Q && (o.value = Q.scrollHeight > Q.clientHeight + _t);
  }
  function oe(Q) {
    if (a) return;
    const V = Q.currentTarget;
    if (!(V instanceof HTMLElement)) return;
    const Ae = V.scrollHeight - V.scrollTop - V.clientHeight <= gl, fe = V.scrollTop > g + 1;
    Ae && (!r || fe) ? (r = !1, c = !1, o.value = !1) : r ? o.value = V.scrollHeight > V.clientHeight + _t : d ? M() : e.running() && !c && I(), g = V.scrollTop;
  }
  function O(Q) {
    Q.deltaY < 0 && P() && M();
  }
  function re(Q) {
    (Q.key === "ArrowUp" || Q.key === "PageUp" || Q.key === "Home" || Q.key === " " && Q.shiftKey) && P() && M();
  }
  function $(Q) {
    x = Q.touches[0]?.clientY ?? null;
  }
  function Y(Q) {
    const V = Q.touches[0]?.clientY;
    V === void 0 || x === null || (V > x && P() && M(), x = V);
  }
  function ce() {
    n.value && (r = !1, o.value = !1, w());
  }
  return fn(() => {
    k(), q?.disconnect(), window.removeEventListener("pointerup", L), window.removeEventListener("pointercancel", L);
  }), {
    viewportReady: i,
    showBackToBottom: o,
    onViewportScroll: oe,
    onWheel: O,
    onKeyDown: re,
    onTouchStart: $,
    onTouchMove: Y,
    onScrollbarPointerDown: C,
    scrollToBottom: ce
  };
}
const yl = {
  key: 0,
  class: "assistant-messages",
  "data-testid": "assistant-message-list"
}, wl = ["data-ready"], xl = {
  key: 0,
  class: "assistant-messages__loading",
  "data-testid": "assistant-messages-loading"
}, kl = {
  key: 0,
  class: "assistant-messages__user",
  "data-testid": "assistant-user-bubble"
}, El = { key: 0 }, Cl = {
  key: 1,
  class: "assistant-messages__user-attachments",
  "data-testid": "assistant-user-attachments"
}, Al = {
  key: 2,
  class: "assistant-messages__thinking",
  "data-testid": "assistant-thinking"
}, Il = {
  key: 3,
  class: "assistant-messages__reconnecting",
  "data-testid": "assistant-reconnecting"
}, Sl = {
  key: 4,
  class: "assistant-messages__error",
  "data-testid": "assistant-message-error"
}, Tl = { class: "assistant-messages__error-text" }, Ml = {
  key: 0,
  class: "assistant-messages__veil",
  "data-testid": "assistant-messages-veil"
}, Rl = {
  key: 2,
  class: "assistant-messages__batch"
}, Ll = /* @__PURE__ */ ye({
  name: "AssistantMessageList",
  __name: "AssistantMessageList",
  props: {
    conversationId: { type: String }
  },
  setup(e) {
    const n = e, { t } = Re(), i = ut(), o = R(() => i.conversationStates[n.conversationId]), r = R(() => !!o.value && ge(o.value.status)), a = R(() => !!o.value && (o.value.messagesLoaded || !!o.value.messagesError || c.value && o.value.pipeline.timeline.length > 0)), c = R(() => !!o.value && (r.value || !o.value.messagesLoaded)), d = R(() => c.value ? o.value?.pipeline.runId ?? o.value?.knownRunId : void 0), g = R(() => Ho(o.value?.messages ?? [], d.value).map((ee) => ({
      ...ee,
      timeline: li(ee.assistant),
      // [P2 #14] 用户消息附件视图(发送后气泡与历史回放同路径)
      attachments: ee.user ? ml(ee.user) : []
    }))), x = R(() => o.value && c.value ? o.value.pipeline.timeline : []), v = R(() => o.value?.messagesError || o.value?.pipeline.error || o.value?.connectionError), k = R(() => !!o.value?.reconnecting), y = R(() => o.value ? `${o.value.messagesLoaded}:${o.value.messages.length}:${o.value.pipeline.lastSequence}` : "pending"), w = N(null), I = N(null), {
      viewportReady: P,
      showBackToBottom: q,
      onViewportScroll: C,
      onWheel: L,
      onKeyDown: M,
      onTouchStart: oe,
      onTouchMove: O,
      onScrollbarPointerDown: re,
      scrollToBottom: $
    } = vl({
      viewportRef: w,
      contentRef: I,
      contentReady: () => a.value,
      contentVersion: () => y.value,
      running: () => r.value
    }), Y = R(() => o.value?.pipeline.pendingConfirmation), ce = R(() => Y.value && (Y.value.toolCalls?.length ?? 0) > 1 ? Y.value : void 0), Q = R(() => !!ce.value && o.value?.pipeline.status !== "cancelling"), V = R(() => ce.value ? jo(ce.value.toolCalls) : void 0), Me = R(() => {
      const ee = Y.value;
      if (!(!ee || (ee.toolCalls?.length ?? 0) !== 1))
        return mn(ee.toolCalls?.[0]?.scope);
    }), Ae = R(() => {
      const ee = Y.value;
      if (ee)
        return {
          toolCallIds: (ee.toolCalls ?? []).map((W) => W.toolCallId),
          parentToolCallId: ee.parentToolCallId,
          decisions: ee.decisions,
          submitting: ee.submitting,
          showActions: o.value?.pipeline.status !== "cancelling",
          expiresAt: ee.expiresAt,
          ...Me.value ? { scope: Me.value } : {}
        };
    });
    Te(Y, (ee) => {
      if (!ee) return;
      const W = Date.parse(ee.expiresAt);
      if (!Number.isFinite(W))
        throw new Error("Tool confirmation expiry is invalid");
      const Z = () => {
        Date.now() >= W && i.expireToolConfirmation();
      };
      Z();
      const de = setTimeout(Z, Math.max(0, W - Date.now()));
      window.addEventListener("focus", Z), document.addEventListener("visibilitychange", Z), fe(() => {
        clearTimeout(de), window.removeEventListener("focus", Z), document.removeEventListener("visibilitychange", Z);
      });
    }, { immediate: !0 });
    function fe(ee) {
      Ei() && fn(ee);
    }
    function _() {
      i.loadMessagesIfNeeded(n.conversationId), i.ensureContentConnection();
    }
    function me() {
      return g.value.length > 0 || x.value.length > 0 || !!Y.value || !!v.value;
    }
    return (ee, W) => o.value ? (b(), m("div", yl, [
      u("div", {
        ref_key: "viewportRef",
        ref: w,
        class: "assistant-messages__scroll",
        tabindex: "0",
        "data-ready": f(P) ? "true" : "false",
        "data-testid": "assistant-messages-viewport",
        onScrollPassive: W[1] || (W[1] = //@ts-ignore
        (...Z) => f(C) && f(C)(...Z)),
        onWheelPassive: W[2] || (W[2] = //@ts-ignore
        (...Z) => f(L) && f(L)(...Z)),
        onKeydown: W[3] || (W[3] = //@ts-ignore
        (...Z) => f(M) && f(M)(...Z)),
        onTouchstartPassive: W[4] || (W[4] = //@ts-ignore
        (...Z) => f(oe) && f(oe)(...Z)),
        onTouchmovePassive: W[5] || (W[5] = //@ts-ignore
        (...Z) => f(O) && f(O)(...Z)),
        onPointerdown: W[6] || (W[6] = //@ts-ignore
        (...Z) => f(re) && f(re)(...Z))
      }, [
        u("div", {
          ref_key: "contentRef",
          ref: I,
          class: "assistant-messages__content"
        }, [
          o.value.messagesLoading && o.value.messages.length === 0 ? (b(), m("p", xl, [
            W[9] || (W[9] = u("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
            H(" " + h(f(t)("assistant.loading-messages")), 1)
          ])) : B("", !0),
          !o.value.messagesLoading && !me() ? (b(), se(jr, {
            key: 1,
            type: "empty",
            title: f(t)("assistant.empty-title"),
            description: f(t)("assistant.empty-desc"),
            "data-testid": "assistant-empty"
          }, null, 8, ["title", "description"])) : B("", !0),
          (b(!0), m(ue, null, Ee(g.value, (Z) => (b(), m(ue, {
            key: Z.key
          }, [
            Z.user ? (b(), m("div", kl, [
              Z.user.content ? (b(), m("p", El, h(Z.user.content), 1)) : B("", !0),
              Z.attachments?.length ? (b(), m("div", Cl, [
                (b(!0), m(ue, null, Ee(Z.attachments ?? [], (de) => (b(), se(mi, {
                  key: de.id,
                  attachment: de,
                  "test-id": `assistant-message-attachment-${de.id}`
                }, null, 8, ["attachment", "test-id"]))), 128))
              ])) : B("", !0)
            ])) : B("", !0),
            ie(jn, {
              class: "assistant-timeline-host",
              items: Z.timeline
            }, null, 8, ["items"])
          ], 64))), 128)),
          ie(jn, {
            class: "assistant-timeline-host",
            items: x.value,
            confirmation: Ae.value,
            streaming: r.value,
            onDecision: W[0] || (W[0] = (Z, de) => {
              f(i).respondToToolConfirmation(Z, de);
            })
          }, null, 8, ["items", "confirmation", "streaming"]),
          r.value && x.value.length === 0 && !Y.value ? (b(), m("p", Al, [
            W[10] || (W[10] = u("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
            H(" " + h(f(t)("assistant.thinking")), 1)
          ])) : B("", !0),
          k.value ? (b(), m("p", Il, [
            W[11] || (W[11] = u("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
            H(" " + h(f(t)("assistant.reconnecting")), 1)
          ])) : B("", !0),
          v.value ? (b(), m("div", Sl, [
            W[13] || (W[13] = u("i", {
              class: "ri-error-warning-line",
              "aria-hidden": "true"
            }, null, -1)),
            u("span", Tl, h(v.value), 1),
            ie(he, {
              variant: "danger",
              size: "sm",
              text: "",
              "data-testid": "assistant-retry",
              onClick: _
            }, {
              default: ne(() => [
                W[12] || (W[12] = u("i", { class: "ri-refresh-line" }, null, -1)),
                H(" " + h(f(t)("assistant.retry")), 1)
              ]),
              _: 1
            })
          ])) : B("", !0)
        ], 512)
      ], 40, wl),
      a.value === !1 ? (b(), m("div", Ml, [
        W[14] || (W[14] = u("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
        H(" " + h(f(t)("assistant.loading-messages")), 1)
      ])) : B("", !0),
      f(q) ? (b(), m("button", {
        key: 1,
        type: "button",
        class: "assistant-messages__back fc-button-ghost",
        "data-testid": "assistant-back-to-bottom",
        onClick: W[7] || (W[7] = //@ts-ignore
        (...Z) => f($) && f($)(...Z))
      }, [
        W[15] || (W[15] = u("i", {
          class: "ri-arrow-down-line",
          "aria-hidden": "true"
        }, null, -1)),
        H(" " + h(f(t)("assistant.back-to-bottom")), 1)
      ])) : B("", !0),
      Q.value && ce.value ? (b(), m("div", Rl, [
        ie(Ba, {
          "tool-call-ids": (ce.value.toolCalls ?? []).map((Z) => Z.toolCallId),
          decisions: ce.value.decisions,
          submitting: ce.value.submitting,
          "show-actions": o.value.pipeline.status !== "cancelling",
          "expires-at": ce.value.expiresAt,
          "scope-digest": V.value,
          onDecision: W[8] || (W[8] = (Z) => {
            f(i).respondToAllToolConfirmations(Z);
          })
        }, null, 8, ["tool-call-ids", "decisions", "submitting", "show-actions", "expires-at", "scope-digest"])
      ])) : B("", !0)
    ])) : B("", !0);
  }
}), Ul = '@charset "UTF-8";.assistant-messages[data-v-f2cab1b5]{position:relative;min-height:0;flex:1;display:flex;flex-direction:column}.assistant-messages__scroll[data-v-f2cab1b5]{min-height:0;flex:1;overflow-y:auto}.assistant-messages__scroll[data-ready=false][data-v-f2cab1b5]{opacity:0}.assistant-messages__scroll[data-ready=true][data-v-f2cab1b5]{opacity:1}.assistant-messages__scroll[data-v-f2cab1b5]{transition:opacity .4s ease-out}.assistant-messages__back[data-v-f2cab1b5]{position:absolute;left:50%;bottom:12px;z-index:10;display:inline-flex;align-items:center;gap:4px;transform:translate(-50%);padding:6px 12px;border-radius:999px;border:1px solid var(--app-separator, var(--el-border-color-lighter));background:var(--app-bg-card, #fff);color:var(--app-text);font-size:12px;cursor:pointer;box-shadow:var(--app-shadow-md, 0 4px 12px rgba(0, 0, 0, .08));transition:background .15s ease}.assistant-messages__back[data-v-f2cab1b5]:hover{background:var(--app-sidebar-item-hover-bg, #f5f5f7)}.assistant-messages__content[data-v-f2cab1b5]{max-width:720px;margin:0 auto;display:flex;flex-direction:column;gap:14px;padding:18px 16px 28px}.assistant-messages__loading[data-v-f2cab1b5],.assistant-messages__thinking[data-v-f2cab1b5]{display:flex;align-items:center;gap:8px;margin:0;padding:10px 0;font-size:12px;color:var(--app-text-secondary)}.assistant-messages__reconnecting[data-v-f2cab1b5]{display:flex;align-items:center;gap:8px;margin:0;padding:8px 10px;border-radius:10px;border:1px solid var(--el-color-warning-light-7, #f3d19e);background:var(--el-color-warning-light-9, #fdf6ec);font-size:12px;color:var(--app-color-warning, var(--el-color-warning, #e6a23c))}.is-spinning[data-v-f2cab1b5]{animation:assistant-msg-spin-f2cab1b5 1s linear infinite}@keyframes assistant-msg-spin-f2cab1b5{0%{transform:rotate(0)}to{transform:rotate(360deg)}}.assistant-messages__user[data-v-f2cab1b5],.assistant-timeline-host[data-v-f2cab1b5]{content-visibility:auto;contain-intrinsic-size:auto 72px}.assistant-messages__user[data-v-f2cab1b5]{display:flex;flex-direction:column;align-items:flex-end;gap:6px}.assistant-messages__user p[data-v-f2cab1b5]{margin:0;max-width:85%;padding:9px 12px;border-radius:14px;background:var(--el-color-primary-light-9, #ecf5ff);color:var(--app-text);font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word}.assistant-messages__user-attachments[data-v-f2cab1b5]{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;max-width:85%}.assistant-messages__error[data-v-f2cab1b5]{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-radius:10px;border:1px solid var(--el-color-danger-light-7, #fde2e2);background:var(--el-color-danger-light-9, #fef0f0);font-size:12px;color:var(--el-color-danger, #f56c6c)}.assistant-messages__error>i[data-v-f2cab1b5]{margin-top:1px}.assistant-messages__error-text[data-v-f2cab1b5]{flex:1;min-width:0;word-break:break-word}.assistant-messages__veil[data-v-f2cab1b5]{position:absolute;inset:0;z-index:5;display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:var(--app-text-secondary);background:color-mix(in srgb,var(--app-bg, #fff) 60%,transparent)}.assistant-messages__batch[data-v-f2cab1b5]{position:absolute;left:0;right:0;bottom:10px;z-index:6;padding:0 14px;display:flex;justify-content:center}.assistant-messages__batch[data-v-f2cab1b5]>*{max-width:720px;width:100%}', Dl = /* @__PURE__ */ we(Ll, [["styles", [Ul]], ["__scopeId", "data-v-f2cab1b5"]]), ql = ["value", "disabled"], zl = ["disabled"], Fl = ["value", "disabled"], jl = /* @__PURE__ */ ye({
  name: "IaSelect",
  inheritAttrs: !1,
  __name: "IaSelect",
  props: {
    modelValue: { default: void 0, type: [String, Number] },
    options: { default: () => [], type: Array },
    placeholder: { default: "", type: String },
    clearable: { type: Boolean, default: !1 },
    disabled: { type: Boolean, default: !1 },
    loading: { type: Boolean, default: !1 },
    size: { default: "default", type: String }
  },
  emits: ["update:modelValue"],
  setup(e, { emit: n }) {
    const t = e, i = n;
    function o(r) {
      const a = r.target.value;
      if (t.clearable && a === "__ia_placeholder__") {
        i("update:modelValue", void 0);
        return;
      }
      i("update:modelValue", a);
    }
    return (r, a) => (b(), m("select", cn({
      class: ["ia-select", [`size-${e.size}`, { "is-disabled": e.disabled || e.loading, "is-placeholder": e.modelValue === void 0 }]],
      value: e.modelValue === void 0 && e.clearable ? "__ia_placeholder__" : e.modelValue ?? "__ia_placeholder__",
      disabled: e.disabled || e.loading
    }, r.$attrs, { onChange: o }), [
      e.modelValue === void 0 || e.clearable ? (b(), m("option", {
        key: 0,
        value: "__ia_placeholder__",
        disabled: !e.clearable
      }, h(e.placeholder || " "), 9, zl)) : B("", !0),
      (b(!0), m(ue, null, Ee(e.options, (c) => (b(), m("option", {
        key: String(c.value),
        value: c.value,
        disabled: c.disabled
      }, h(c.label), 9, Fl))), 128))
    ], 16, ql));
  }
}), Nl = `.ia-select[data-v-10fee617]{width:100%;padding:6px 26px 6px 10px;border:1px solid var(--app-separator, var(--ia-separator, #dcdfe6));border-radius:var(--app-radius-md, 8px);background:var(--app-bg-card, var(--ia-bg-card, #fff));color:var(--app-text, var(--ia-text, #303133));font-size:13px;line-height:1.4;cursor:pointer;appearance:none;background-image:url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23909399' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 8px center}.ia-select.size-small[data-v-10fee617]{font-size:12px;padding:4px 24px 4px 8px}.ia-select.size-large[data-v-10fee617]{font-size:14px}.ia-select.is-placeholder[data-v-10fee617]{color:var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2))}.ia-select.is-disabled[data-v-10fee617]{cursor:not-allowed;opacity:.55}.ia-select[data-v-10fee617]:focus{outline:none;border-color:var(--app-primary, var(--ia-primary, #409eff))}`, $t = /* @__PURE__ */ we(jl, [["styles", [Nl]], ["__scopeId", "data-v-10fee617"]]), Bl = { class: "ia-tag__content" }, Ol = ["disabled"], Ql = /* @__PURE__ */ ye({
  name: "IaTag",
  __name: "IaTag",
  props: {
    color: { default: "primary", type: String },
    size: { default: "sm", type: String },
    closable: { type: Boolean, default: !1 },
    disabled: { type: Boolean, default: !1 }
  },
  emits: ["close"],
  setup(e, { emit: n }) {
    const t = e, i = n, o = R(() => [
      "ia-tag",
      `color-${t.color}`,
      `size-${t.size}`,
      { "is-disabled": t.disabled }
    ]);
    return (r, a) => (b(), m("span", {
      class: ve(["ia-tag", o.value])
    }, [
      u("span", Bl, [
        Qe(r.$slots, "default", {}, void 0, !0)
      ]),
      e.closable ? (b(), m("button", {
        key: 0,
        type: "button",
        class: "ia-tag__close",
        "aria-label": "close",
        disabled: e.disabled,
        onClick: a[0] || (a[0] = At((c) => !e.disabled && i("close"), ["stop"]))
      }, [...a[1] || (a[1] = [
        u("i", {
          class: "ri-close-line",
          "aria-hidden": "true"
        }, null, -1)
      ])], 8, Ol)) : B("", !0)
    ], 2));
  }
}), Pl = ".ia-tag[data-v-18de382f]{display:inline-flex;align-items:center;gap:4px;max-width:220px;padding:2px 8px;border-radius:9999px;font-size:11px;line-height:1.6;border:1px solid transparent}.ia-tag.size-sm[data-v-18de382f]{font-size:11px}.ia-tag.size-md[data-v-18de382f]{font-size:12px;padding:3px 10px}.ia-tag.size-lg[data-v-18de382f]{font-size:13px;padding:4px 12px}.ia-tag.color-primary[data-v-18de382f],.ia-tag.color-brand[data-v-18de382f]{background:color-mix(in srgb,var(--app-primary, var(--ia-primary, #409eff)) 10%,transparent);color:var(--app-primary, var(--ia-primary, #409eff));border-color:color-mix(in srgb,var(--app-primary, var(--ia-primary, #409eff)) 25%,transparent)}.ia-tag.color-gray[data-v-18de382f]{background:var(--app-bg-muted, var(--ia-bg-muted, #f5f5f7));color:var(--app-text-secondary, var(--ia-text-secondary, #606266));border-color:var(--app-separator, var(--ia-separator, #dcdfe6))}.ia-tag.color-success[data-v-18de382f]{background:color-mix(in srgb,var(--app-color-success, var(--ia-success, #67c23a)) 12%,transparent);color:var(--app-color-success, var(--ia-success, #67c23a))}.ia-tag.color-warning[data-v-18de382f]{background:color-mix(in srgb,var(--app-color-warning, var(--ia-warning, #e6a23c)) 12%,transparent);color:var(--app-color-warning, var(--ia-warning, #e6a23c))}.ia-tag.color-danger[data-v-18de382f]{background:color-mix(in srgb,var(--app-color-danger, var(--ia-danger, #f56c6c)) 12%,transparent);color:var(--app-color-danger, var(--ia-danger, #f56c6c))}.ia-tag.is-disabled[data-v-18de382f]{opacity:.5}.ia-tag__content[data-v-18de382f]{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ia-tag__close[data-v-18de382f]{flex-shrink:0;display:grid;place-items:center;width:14px;height:14px;padding:0;border:none;border-radius:50%;background:none;cursor:pointer;font-size:12px;color:inherit;opacity:.7}.ia-tag__close[data-v-18de382f]:hover{opacity:1}", _e = /* @__PURE__ */ we(Ql, [["styles", [Pl]], ["__scopeId", "data-v-18de382f"]]);
function Wl(e, n) {
  const i = e.slice(0, n).match(/(^|\s)([/@])([^\s/@]*)$/u);
  if (!i || i.index === void 0) return null;
  const o = i[1]?.length ?? 0;
  return {
    mode: i[2] === "@" ? "project" : "capability",
    query: i[3] ?? "",
    start: i.index + o,
    end: n
  };
}
function On(e) {
  return e.trim().toLocaleLowerCase();
}
function Zl(e, n) {
  if (!n) return 0;
  const t = On(e), i = On(n), o = t.indexOf(i);
  if (o >= 0) return o;
  let r = 0, a = 0;
  for (let c = 0; c < t.length && r < i.length; c += 1)
    t[c] === i[r] && (a += c, r += 1);
  return r === i.length ? 100 + a : Number.POSITIVE_INFINITY;
}
function Kl(e, n, t, i = 12) {
  return e.map((o) => ({ item: o, score: Zl(t(o), n) })).filter((o) => Number.isFinite(o.score)).sort((o, r) => o.score - r.score).slice(0, i).map((o) => o.item);
}
function Jl(e) {
  return e.kind === "skill" ? `${e.value.displayName} ${e.value.name} ${e.value.id} ${e.value.source} ${e.value.description}` : `${e.value.toolName} ${e.value.serverName} ${e.value.description}`;
}
function Qn(e) {
  return e.kind === "project" ? `project:${e.value.id}` : e.kind === "skill" ? `skill:${e.value.id}` : e.kind === "mcp" ? `mcp:${e.value.serverName}:${e.value.toolName}` : `entity:${e.type}:${e.id}`;
}
function Pn(e, n, t) {
  if (!e) return null;
  const i = n.find((o) => o.id === e);
  return {
    id: e,
    name: i?.name || t,
    description: i?.description ?? void 0
  };
}
function Gl(e) {
  const n = e.find((t) => t.type === "project")?.id ?? null;
  return e.filter((t) => t.type !== "project").map((t) => ({
    kind: "entity",
    type: t.type,
    id: t.id,
    name: t.name,
    projectId: n
  }));
}
function Vl(e) {
  return [
    e.name,
    e.type,
    String(e.id),
    e.projectId != null ? String(e.projectId) : ""
  ].filter(Boolean).join(" ");
}
const gi = 3e4;
let Ct = null, sn = 0, He = null, en = null, Wn = 0, dt = null, hi = null;
function Lc(e) {
  hi = e ?? null;
}
async function Hl() {
  return pn().filter((e) => e.type === "project").map((e) => ({ id: e.id, name: e.name ?? `项目 #${e.id}` }));
}
function Uc() {
  Ct = null, sn = 0, He = null;
}
function Yl() {
  return Ct && Date.now() - sn < gi ? Promise.resolve(Ct) : (He || (He = eo().then((e) => (Ct = e, sn = Date.now(), He = null, e)).catch((e) => {
    throw He = null, e;
  })), He);
}
function Xl() {
  const e = hi ?? Hl;
  return en && Date.now() - Wn < gi ? Promise.resolve(en) : (dt || (dt = e().then((n) => (en = n, Wn = Date.now(), dt = null, n)).catch((n) => {
    throw dt = null, n;
  })), dt);
}
const _l = {
  class: "assistant-composer",
  "data-testid": "assistant-composer"
}, $l = {
  key: 0,
  class: "assistant-composer__alert",
  "data-testid": "assistant-composer-alert"
}, es = { class: "assistant-composer__alert-text" }, ts = {
  key: 1,
  class: "assistant-composer__references",
  "data-testid": "assistant-references"
}, ns = { class: "assistant-composer__references-label" }, is = {
  key: 2,
  class: "assistant-composer__attachments",
  "data-testid": "assistant-attachments"
}, os = ["value", "placeholder", "disabled", "aria-expanded"], rs = ["aria-label"], as = { class: "assistant-composer__picker-head" }, ls = { class: "assistant-composer__picker-badge" }, ss = { class: "assistant-composer__picker-titles" }, cs = { class: "assistant-composer__picker-title" }, fs = { class: "assistant-composer__picker-hint" }, ds = {
  key: 0,
  class: "assistant-composer__picker-state",
  "data-testid": "assistant-reference-loading"
}, bs = {
  key: 1,
  class: "assistant-composer__picker-state is-error",
  "data-testid": "assistant-reference-error"
}, us = ["data-active", "aria-selected", "data-testid", "onMouseenter", "onClick"], ps = { class: "assistant-composer__picker-item-icon" }, ms = { class: "assistant-composer__picker-item-main" }, gs = { class: "assistant-composer__picker-item-eyebrow" }, hs = { class: "assistant-composer__picker-item-label" }, vs = { class: "assistant-composer__picker-item-desc" }, ys = {
  key: 0,
  class: "ri-check-line assistant-composer__picker-item-check"
}, ws = {
  key: 3,
  class: "assistant-composer__picker-state",
  "data-testid": "assistant-reference-empty"
}, xs = { class: "assistant-composer__controls" }, ks = ["accept"], Es = 3e4, Cs = /* @__PURE__ */ ye({
  name: "AssistantComposer",
  __name: "AssistantComposer",
  props: {
    projectId: { type: [Number, null] }
  },
  setup(e) {
    const n = e, { t } = Re(), i = ut();
    let o = null, r = 0, a = null;
    function c() {
      return o && Date.now() - r < Es ? Promise.resolve(o) : (a || (a = oo.listByType(1).then((s) => (o = s, r = Date.now(), a = null, s)).catch((s) => {
        throw a = null, s;
      })), a);
    }
    const d = N([]), g = N(!0), x = N(null);
    async function v() {
      g.value = !0, x.value = null;
      try {
        const s = await c();
        d.value = s;
        const E = i.selectedModelId, A = E && s.some((J) => J.id === E) ? E : s.find((J) => J.defaultModel)?.id ?? s[0]?.id ?? null;
        A !== E && i.setSelectedModelId(A);
      } catch (s) {
        x.value = s instanceof Error ? s.message : t("assistant.model-load-failed");
      } finally {
        g.value = !1;
      }
    }
    const k = R(() => i.selectedConversationId), y = R(() => k.value ? i.conversationStates[k.value] : void 0), w = R({
      get: () => k.value ? y.value?.draft ?? "" : i.newDraft,
      set: (s) => i.setDraft(k.value, s)
    }), I = R(() => !!y.value && ge(y.value.status)), P = R(() => y.value?.status === "CANCEL_REQUESTED"), q = R(() => i.connection?.conversationId === k.value), C = R(() => y.value?.messagesError), L = R(() => d.value.find((s) => s.id === i.selectedModelId) ?? null), M = N(null), oe = R(() => (L.value?.supportReasoning ? L.value?.reasoningEffortLevels ?? [] : []).map((s) => ({ label: s, value: s })));
    Te(() => [
      L.value?.id,
      L.value?.supportReasoning,
      L.value?.reasoningEffortLevels
    ], () => {
      const s = L.value;
      M.value = s?.supportReasoning ? s.reasoningEffortLevels?.[0] ?? null : null;
    }, { immediate: !0 });
    const O = R(() => ["DEFAULT", "ALWAYS_ASK", "ALWAYS_ALLOW", "FULL_ACCESS"].map((s) => ({
      label: t(`assistant.tool-mode-${s}`),
      value: s
    }))), re = N({ skills: [], mcpTools: [] }), $ = N([]), Y = N([]), ce = N([]), Q = N(!0), V = N(!0), Me = N(null), Ae = N(null), fe = N(void 0), _ = N(null), me = N(0), ee = R(() => y.value?.conversation.projectId ?? null), W = R(() => k.value ? ee.value : n.projectId ?? null), Z = R(() => Pn(
      W.value,
      ce.value,
      t("assistant.reference-project-fallback", { id: W.value ?? 0 })
    )), de = R(() => fe.value === void 0 ? Z.value : fe.value), Rt = R(() => [
      ...re.value.skills.map((s) => ({ kind: "skill", value: s })),
      ...re.value.mcpTools.map((s) => ({ kind: "mcp", value: s }))
    ]), Be = R(() => [
      ...Gl(pn()),
      ...ce.value.map((s) => ({
        kind: "project",
        value: { id: s.id, name: s.name, description: s.description ?? void 0 }
      }))
    ]);
    function Lt(s) {
      return s.kind === "project" ? `${s.value.name} ${s.value.id} ${s.value.description || ""}` : s.kind === "entity" ? Vl(s) : Jl(s);
    }
    const Fe = R(() => {
      if (!_.value) return [];
      const s = _.value.mode === "project" ? Be.value : Rt.value;
      return Kl(s, _.value.query, Lt);
    }), et = R(() => /* @__PURE__ */ new Set([
      ...de.value ? [`project:${de.value.id}`] : [],
      ...$.value.map((s) => `skill:${s.id}`),
      ...Y.value.map((s) => `mcp:${s.serverName}:${s.toolName}`)
    ])), Pe = R(() => _.value?.mode === "project" ? t("assistant.reference-project-title") : t("assistant.reference-capability-title")), Ut = R(() => _.value?.query ? t("assistant.reference-searching", { query: _.value.query }) : _.value?.mode === "project" ? t("assistant.reference-project-hint") : t("assistant.reference-capability-hint")), tt = R(() => _.value?.mode === "project" ? V.value : Q.value), Le = R(() => _.value?.mode === "project" ? Ae.value : Me.value), nt = R(() => _.value?.mode === "project" ? t("assistant.reference-empty-project") : t("assistant.reference-empty-capability")), it = {
      project: "assistant.entity-project",
      script: "assistant.entity-script",
      storyboard: "assistant.entity-storyboard",
      storyboardEpisode: "assistant.entity-storyboardEpisode",
      storyboardItem: "assistant.entity-storyboardItem",
      asset: "assistant.entity-asset"
    };
    function We(s) {
      const E = it[s];
      return E ? t(E) : s;
    }
    function Dt(s) {
      return s.kind === "project" ? t("assistant.reference-project-eyebrow", { id: s.value.id }) : s.kind === "skill" ? t("assistant.reference-skill-eyebrow", { name: s.value.name }) : s.kind === "mcp" ? t("assistant.reference-mcp-eyebrow", { server: s.value.serverName }) : `${We(s.type)} #${s.id}`;
    }
    function ae(s) {
      return s.kind === "project" ? s.value.name : s.kind === "skill" ? s.value.displayName : s.kind === "mcp" ? s.value.toolName : s.name || We(s.type);
    }
    function qt(s) {
      return s.kind === "project" ? s.value.description || t("assistant.reference-entity-context") : s.kind === "skill" ? s.value.description : s.kind === "mcp" ? s.value.description || t("assistant.reference-mcp-default-desc") : t("assistant.reference-attach-project");
    }
    function pt(s) {
      return s.kind === "project" ? "ri-folder-kanban-line" : s.kind === "skill" ? "ri-sparkling-2-line" : s.kind === "mcp" ? "ri-flashlight-line" : s.type === "script" ? "ri-file-text-line" : s.type === "asset" ? "ri-image-2-line" : "ri-movie-2-line";
    }
    function Oe(s) {
      return Qn(s);
    }
    function mt(s) {
      return s.kind === "entity" ? s.projectId != null && de.value?.id === s.projectId : et.value.has(Qn(s));
    }
    function Ue(s) {
      i.setDraft(k.value, s);
    }
    function gt(s, E) {
      Ue(s);
      const A = Wl(s, E), J = _.value?.mode === A?.mode && _.value?.query === A?.query;
      _.value = A, J || (me.value = 0);
    }
    function ot() {
      _.value && (_.value = null);
    }
    function zt() {
      const s = _.value;
      if (!s) return;
      const E = w.value.slice(0, s.start) + w.value.slice(s.end);
      Ue(E);
      const A = s.start;
      _.value = null, hn(() => {
        const J = te();
        J?.focus({ preventScroll: !0 }), J?.setSelectionRange(A, A);
      });
    }
    function rt(s) {
      fe.value = s;
    }
    function ht(s) {
      if (s.kind === "project")
        rt(s.value);
      else if (s.kind === "entity") {
        if (s.projectId == null) return;
        rt(Pn(
          s.projectId,
          ce.value,
          t("assistant.reference-project-fallback", { id: s.projectId })
        ));
      } else s.kind === "skill" ? $.value.some((E) => E.id === s.value.id) || ($.value = [...$.value, s.value]) : Y.value.some((E) => E.serverName === s.value.serverName && E.toolName === s.value.toolName) || (Y.value = [...Y.value, s.value]);
      zt();
    }
    function Ft(s) {
      me.value = s;
    }
    function jt(s) {
      if (!_.value) return !1;
      if (s.key === "Escape")
        return s.preventDefault(), ot(), !0;
      if (s.key === "ArrowDown" || s.key === "ArrowUp") {
        if (s.preventDefault(), !Fe.value.length) return !0;
        const A = Fe.value.length;
        return me.value = s.key === "ArrowDown" ? (me.value + 1) % A : (me.value - 1 + A) % A, !0;
      }
      const E = Fe.value[me.value];
      return (s.key === "Enter" || s.key === "Tab") && E ? (s.preventDefault(), ht(E), !0) : !1;
    }
    const xe = N([]), Ze = N(!1), Ke = N(null);
    let at = !1, lt = 0;
    Te(k, () => {
      lt += 1, xe.value = [], fe.value = void 0, $.value = [], Y.value = [], _.value = null, me.value = 0;
    });
    const Nt = R(() => !!L.value?.multimodalInputTypes?.length), Bt = R(() => nl(L.value)), Ot = R(() => {
      const s = tl(L.value);
      if (s.textOnly) return t("assistant.attachment-text-only");
      const E = s.parts.map(({ type: A, transports: J }) => {
        const De = J.map((vi) => t(vi === "url" ? "assistant.attachment-capability-transport-url" : "assistant.attachment-capability-transport-base64")), Qt = De.length ? `（${De.join("/")}）` : "";
        return `${t(`assistant.attachment-type-${A}`)}${Qt}`;
      });
      return t("assistant.attachment-capability-add", { capabilities: E.join("、") });
    }), st = R(() => el(L.value, xe.value));
    function vt(s) {
      if (!s) return null;
      const E = {};
      for (const [A, J] of Object.entries(s.params))
        E[A] = typeof J == "string" && /^(image|video|audio|file)$/.test(J) ? t(`assistant.attachment-type-${J}`) : J;
      return t(s.key, E);
    }
    function yt(s) {
      return s instanceof ze ? vt({ key: s.key, params: s.params }) ?? s.message : s instanceof Error ? s.message : t("assistant.send-failed");
    }
    async function wt(s) {
      if (!s.length) return;
      if (!L.value)
        throw new ze("assistant.attachment-model-required", {}, "请先选择对话模型");
      if (at)
        throw new ze("assistant.attachment-busy", {}, "附件正在处理中，请稍候");
      const E = lt;
      at = !0, Ze.value = !0;
      try {
        const A = await $a({
          files: s,
          model: L.value,
          existing: xe.value
        });
        if (E !== lt) return;
        xe.value = [...xe.value, ...A];
      } finally {
        at = !1, Ze.value = !1, Ke.value && (Ke.value.value = "");
      }
    }
    function je(s) {
      xe.value = xe.value.filter((E) => E.id !== s);
    }
    const l = R(() => {
      const s = {};
      for (const E of xe.value) {
        const A = ol(E);
        A && (s[E.id] = t(A.key, A.params));
      }
      return s;
    });
    function p() {
      xe.value = [];
    }
    function D(s) {
      const E = s.target, A = Array.from(E.files ?? []);
      j.value = null, wt(A).catch((J) => {
        j.value = yt(J);
      });
    }
    function S(s) {
      const A = Array.from(s.clipboardData?.items ?? []).filter((J) => J.kind === "file").map((J) => J.getAsFile()).filter((J) => !!J);
      A.length && (s.preventDefault(), j.value = null, wt(A).catch((J) => {
        j.value = yt(J);
      }));
    }
    const T = N(!1), j = N(null), z = R(() => !w.value.trim() && !xe.value.length || !i.selectedModelId || !d.value.length || T.value || Ze.value || !!st.value || !!x.value), X = R(() => !!de.value || $.value.length > 0 || Y.value.length > 0), U = R(() => j.value || x.value || C.value || vt(st.value));
    async function F() {
      if (!(!w.value.trim() && !xe.value.length || T.value || I.value || !i.selectedModelId || !d.value.length || Ze.value || st.value)) {
        T.value = !0, j.value = null;
        try {
          const s = de.value?.id ?? null;
          k.value && s !== (ee.value ?? null) && (i.setDraft(null, w.value), i.startNewConversation()), await i.sendMessage(
            w.value,
            i.selectedModelId,
            M.value,
            s,
            {
              project: de.value,
              skills: $.value,
              mcpTools: Y.value,
              multimodalInputs: xe.value.map((E) => ({
                id: E.id,
                name: E.name,
                inputType: E.inputType,
                mimeType: E.mimeType,
                transport: E.transport,
                url: E.url,
                data: E.data,
                resourceUrl: E.resourceUrl,
                size: E.size
              }))
            }
          ), Ue(""), p(), fe.value = void 0, $.value = [], Y.value = [];
        } catch (s) {
          j.value = s instanceof Error ? s.message : t("assistant.send-failed");
        } finally {
          T.value = !1;
        }
      }
    }
    let K = !1;
    function Ie() {
      K = !0;
    }
    function be() {
      K = !1;
    }
    const G = N(null);
    function te() {
      return G.value ?? void 0;
    }
    function Se(s) {
      const E = s.target.value, J = te()?.selectionStart ?? E.length;
      gt(E, J);
    }
    function ke(s) {
      jt(s) || s.key !== "Enter" || !s.ctrlKey || K || (s.preventDefault(), F());
    }
    const qe = N(null), Ne = N(null);
    Te(me, () => {
      hn(() => {
        const s = Ne.value;
        if (!s) return;
        const E = s.querySelector('[data-active="true"]');
        E instanceof HTMLElement && E !== qe.value && (qe.value = E), qe.value?.scrollIntoView?.({ block: "nearest" });
      });
    });
    async function Ce() {
      j.value = null;
      try {
        await i.stopGeneration();
      } catch (s) {
        j.value = s instanceof Error ? s.message : t("assistant.stop-failed");
      }
    }
    function le() {
      Yl().then((s) => {
        re.value = s, Me.value = null;
      }).catch((s) => {
        Me.value = s instanceof Error ? s.message : t("assistant.reference-load-failed");
      }).finally(() => {
        Q.value = !1;
      }), Xl().then((s) => {
        ce.value = s, Ae.value = null;
      }).catch((s) => {
        Ae.value = s instanceof Error ? s.message : t("assistant.reference-projects-load-failed");
      }).finally(() => {
        V.value = !1;
      });
    }
    return dn(() => {
      v(), le();
    }), (s, E) => (b(), m("div", _l, [
      U.value ? (b(), m("p", $l, [
        u("span", es, h(U.value), 1),
        x.value ? (b(), m("button", {
          key: 0,
          type: "button",
          class: "assistant-composer__alert-retry fc-button-ghost",
          onClick: E[0] || (E[0] = (A) => v())
        }, h(f(t)("assistant.retry")), 1)) : B("", !0)
      ])) : B("", !0),
      X.value ? (b(), m("div", ts, [
        u("span", ns, h(f(t)("assistant.reference-label")), 1),
        de.value ? (b(), se(_e, {
          key: 0,
          color: "brand",
          closable: !0,
          "data-testid": `assistant-reference-chip-project:${de.value.id}`,
          onClose: E[1] || (E[1] = (A) => rt(null))
        }, {
          default: ne(() => [
            H(h(de.value.name), 1)
          ]),
          _: 1
        }, 8, ["data-testid"])) : B("", !0),
        (b(!0), m(ue, null, Ee($.value, (A) => (b(), se(_e, {
          key: A.id,
          color: "primary",
          closable: !0,
          "data-testid": `assistant-reference-chip-skill:${A.id}`,
          title: f(t)("assistant.reference-skill-eyebrow", { name: A.name }),
          onClose: (J) => $.value = $.value.filter((De) => De.id !== A.id)
        }, {
          default: ne(() => [
            H(h(A.displayName), 1)
          ]),
          _: 2
        }, 1032, ["data-testid", "title", "onClose"]))), 128)),
        (b(!0), m(ue, null, Ee(Y.value, (A) => (b(), se(_e, {
          key: `${A.serverName}:${A.toolName}`,
          color: "primary",
          closable: !0,
          "data-testid": `assistant-reference-chip-mcp:${A.serverName}:${A.toolName}`,
          title: f(t)("assistant.reference-mcp-eyebrow", { server: A.serverName }),
          onClose: (J) => Y.value = Y.value.filter((De) => De.serverName !== A.serverName || De.toolName !== A.toolName)
        }, {
          default: ne(() => [
            H(h(A.toolName), 1)
          ]),
          _: 2
        }, 1032, ["data-testid", "title", "onClose"]))), 128))
      ])) : B("", !0),
      xe.value.length ? (b(), m("div", is, [
        (b(!0), m(ue, null, Ee(xe.value, (A) => (b(), se(mi, {
          key: A.id,
          attachment: A,
          removable: !0,
          "remove-disabled": T.value || I.value,
          hint: l.value[A.id],
          onRemove: (J) => je(A.id)
        }, null, 8, ["attachment", "remove-disabled", "hint", "onRemove"]))), 128))
      ])) : B("", !0),
      u("textarea", {
        ref_key: "inputRef",
        ref: G,
        value: w.value,
        rows: "3",
        resize: "none",
        placeholder: f(t)("assistant.input-placeholder-hint"),
        class: "assistant-composer__input",
        disabled: !d.value.length || g.value || T.value || I.value,
        "aria-expanded": !!_.value,
        "data-testid": "assistant-input",
        onInput: Se,
        onCompositionstart: Ie,
        onCompositionend: be,
        onPaste: S,
        onBlur: ot,
        onKeydown: ke
      }, null, 40, os),
      _.value ? (b(), m("div", {
        key: 3,
        class: "assistant-composer__picker",
        "data-testid": "assistant-reference-picker",
        role: "listbox",
        "aria-label": Pe.value
      }, [
        u("div", as, [
          u("span", ls, h(_.value.mode === "project" ? "@" : "/"), 1),
          u("span", ss, [
            u("span", cs, h(Pe.value), 1),
            u("span", fs, h(Ut.value), 1)
          ])
        ]),
        u("div", {
          ref_key: "pickerListRef",
          ref: Ne,
          class: "assistant-composer__picker-list"
        }, [
          tt.value ? (b(), m("p", ds, [
            E[7] || (E[7] = u("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
            H(" " + h(f(t)("assistant.reference-loading")), 1)
          ])) : Le.value ? (b(), m("p", bs, h(Le.value), 1)) : Fe.value.length ? (b(!0), m(ue, { key: 2 }, Ee(Fe.value, (A, J) => (b(), m("button", {
            key: Oe(A),
            type: "button",
            role: "option",
            class: ve(["assistant-composer__picker-item fc-button-ghost", { "is-active": J === me.value }]),
            "data-active": J === me.value,
            "aria-selected": mt(A),
            "data-testid": `assistant-reference-item-${Oe(A)}`,
            onMousedown: E[2] || (E[2] = At(() => {
            }, ["prevent"])),
            onMouseenter: (De) => Ft(J),
            onClick: (De) => ht(A)
          }, [
            u("span", ps, [
              u("i", {
                class: ve(pt(A))
              }, null, 2)
            ]),
            u("span", ms, [
              u("span", gs, h(Dt(A)), 1),
              u("span", hs, h(ae(A)), 1),
              u("span", vs, h(qt(A)), 1)
            ]),
            mt(A) ? (b(), m("i", ys)) : B("", !0)
          ], 42, us))), 128)) : (b(), m("p", ws, h(_.value.query ? f(t)("assistant.reference-no-match") : nt.value), 1))
        ], 512)
      ], 8, rs)) : B("", !0),
      u("div", xs, [
        ie($t, {
          "model-value": f(i).selectedModelId ?? void 0,
          options: d.value.map((A) => ({ label: A.name, value: A.id })),
          loading: g.value,
          placeholder: f(t)("assistant.model"),
          size: "small",
          class: "assistant-composer__model",
          "data-testid": "assistant-model-select",
          "onUpdate:modelValue": E[3] || (E[3] = (A) => f(i).setSelectedModelId(A === void 0 ? null : Number(A)))
        }, null, 8, ["model-value", "options", "loading", "placeholder"]),
        oe.value.length ? (b(), se($t, {
          key: 0,
          "model-value": M.value ?? void 0,
          options: oe.value,
          placeholder: f(t)("assistant.reasoning-effort"),
          size: "small",
          class: "assistant-composer__effort",
          "data-testid": "assistant-effort-select",
          "onUpdate:modelValue": E[4] || (E[4] = (A) => {
            M.value = A === void 0 ? null : String(A);
          })
        }, null, 8, ["model-value", "options", "placeholder"])) : B("", !0),
        ie($t, {
          "model-value": k.value ? y.value?.toolExecutionMode : f(i).newToolExecutionMode,
          options: O.value,
          disabled: T.value || I.value,
          placeholder: f(t)("assistant.tool-mode"),
          size: "small",
          class: "assistant-composer__tool-mode",
          "data-testid": "assistant-tool-mode",
          "onUpdate:modelValue": E[5] || (E[5] = (A) => f(i).setToolExecutionMode(A))
        }, null, 8, ["model-value", "options", "disabled", "placeholder"]),
        E[12] || (E[12] = u("div", { class: "assistant-composer__spacer" }, null, -1)),
        u("input", {
          ref_key: "fileInput",
          ref: Ke,
          type: "file",
          class: "assistant-composer__file-input",
          accept: Bt.value,
          multiple: "",
          "data-testid": "assistant-attachment-input",
          onChange: D
        }, null, 40, ks),
        Nt.value ? (b(), se(he, {
          key: 1,
          variant: "text",
          size: "sm",
          disabled: T.value || I.value,
          title: Ot.value,
          "aria-label": f(t)("assistant.attachment-add"),
          "data-testid": "assistant-attachment-add",
          onClick: E[6] || (E[6] = (A) => Ke.value?.click())
        }, {
          default: ne(() => [...E[8] || (E[8] = [
            u("i", { class: "ri-attachment-2" }, null, -1)
          ])]),
          _: 1
        }, 8, ["disabled", "title", "aria-label"])) : B("", !0),
        P.value ? (b(), se(he, {
          key: 2,
          variant: "danger",
          size: "sm",
          disabled: "",
          "data-testid": "assistant-cancelling"
        }, {
          default: ne(() => [
            E[9] || (E[9] = u("i", { class: "ri-loader-4-line is-spinning" }, null, -1)),
            H(" " + h(f(t)("assistant.stopping")), 1)
          ]),
          _: 1
        })) : I.value || q.value ? (b(), se(he, {
          key: 3,
          variant: "danger",
          size: "sm",
          "data-testid": "assistant-stop",
          onClick: Ce
        }, {
          default: ne(() => [
            E[10] || (E[10] = u("i", { class: "ri-stop-line" }, null, -1)),
            H(" " + h(f(t)("assistant.stop")), 1)
          ]),
          _: 1
        })) : (b(), se(he, {
          key: 4,
          variant: "secondary",
          size: "sm",
          disabled: z.value,
          loading: T.value,
          "data-testid": "assistant-send",
          onClick: F
        }, {
          default: ne(() => [
            E[11] || (E[11] = u("i", { class: "ri-send-plane-2-line" }, null, -1)),
            H(" " + h(f(t)("assistant.send")), 1)
          ]),
          _: 1
        }, 8, ["disabled", "loading"]))
      ])
    ]));
  }
}), As = ".assistant-composer[data-v-aae1812f]{position:relative;flex-shrink:0;padding:10px 14px 14px;border-top:1px solid var(--app-separator, var(--el-border-color-lighter))}.assistant-composer__alert[data-v-aae1812f]{display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:6px 10px;border-radius:var(--app-radius-md);border:1px solid var(--el-color-danger-light-7, #fde2e2);background:var(--el-color-danger-light-9, #fef0f0);font-size:11px;color:var(--el-color-danger, #f56c6c)}.assistant-composer__alert-text[data-v-aae1812f]{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-composer__alert-retry[data-v-aae1812f]{flex-shrink:0;border:none;background:none;cursor:pointer;font-size:11px;color:var(--el-color-danger, #f56c6c);text-decoration:underline}.assistant-composer__references[data-v-aae1812f]{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:0 2px 8px}.assistant-composer__references-label[data-v-aae1812f]{font-size:10px;font-weight:600;color:var(--app-text-secondary)}.assistant-composer__attachments[data-v-aae1812f]{display:flex;gap:8px;overflow-x:auto;padding:0 2px 8px}.assistant-composer__input[data-v-aae1812f]{display:block;width:100%;min-height:60px;padding:8px 10px;border:1px solid var(--app-separator, var(--ia-separator, #dcdfe6));border-radius:var(--app-radius-md, 8px);background:var(--app-bg-card, var(--ia-bg-card, #fff));color:var(--app-text, var(--ia-text, #303133));font-size:13px;line-height:1.6;font-family:inherit;box-sizing:border-box}.assistant-composer__input[data-v-aae1812f]:focus{outline:none;border-color:var(--app-primary, var(--ia-primary, #409eff))}.assistant-composer__input[data-v-aae1812f]:disabled{cursor:not-allowed;opacity:.6}.assistant-composer__input[data-v-aae1812f]::placeholder{color:var(--app-text-tertiary, var(--ia-text-tertiary, #a8abb2));white-space:pre-line}.assistant-composer__picker[data-v-aae1812f]{position:absolute;left:14px;right:14px;bottom:calc(100% - 6px);z-index:20;display:flex;flex-direction:column;max-height:280px;padding:8px;border-radius:var(--app-radius-lg, 12px);border:1px solid var(--app-separator, var(--el-border-color-light));background:var(--app-bg-card, var(--el-bg-color));box-shadow:var(--app-shadow-lg, var(--el-box-shadow-light))}.assistant-composer__picker-head[data-v-aae1812f]{display:flex;align-items:center;gap:8px;padding:2px 8px 8px;border-bottom:1px solid var(--app-separator, var(--el-border-color-lighter))}.assistant-composer__picker-badge[data-v-aae1812f]{display:grid;place-items:center;width:26px;height:26px;flex-shrink:0;border-radius:var(--app-radius-sm);font-size:13px;font-weight:700;color:var(--app-text-secondary);background:color-mix(in srgb,var(--app-primary) 10%,transparent)}.assistant-composer__picker-titles[data-v-aae1812f]{display:flex;flex-direction:column;min-width:0}.assistant-composer__picker-title[data-v-aae1812f]{font-size:12px;font-weight:600;color:var(--app-text)}.assistant-composer__picker-hint[data-v-aae1812f]{font-size:10px;color:var(--app-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-composer__picker-list[data-v-aae1812f]{min-height:0;overflow-y:auto;padding-top:4px}.assistant-composer__picker-state[data-v-aae1812f]{display:flex;align-items:center;justify-content:center;gap:6px;margin:0;padding:20px 12px;font-size:12px;color:var(--app-text-secondary)}.assistant-composer__picker-state.is-error[data-v-aae1812f]{color:var(--el-color-danger, #f56c6c)}.assistant-composer__picker-item[data-v-aae1812f]{display:flex;align-items:center;gap:8px;width:100%;min-height:44px;padding:8px;border:none;border-radius:var(--app-radius-md);background:none;cursor:pointer;text-align:left}.assistant-composer__picker-item[data-v-aae1812f]:hover,.assistant-composer__picker-item.is-active[data-v-aae1812f]{background:color-mix(in srgb,var(--app-primary) 8%,transparent)}.assistant-composer__picker-item-icon[data-v-aae1812f]{display:grid;place-items:center;width:30px;height:30px;flex-shrink:0;border-radius:var(--app-radius-sm);border:1px solid var(--app-separator, var(--el-border-color-lighter));color:var(--app-text-secondary)}.assistant-composer__picker-item-main[data-v-aae1812f]{display:flex;flex-direction:column;flex:1;min-width:0;line-height:1.25}.assistant-composer__picker-item-eyebrow[data-v-aae1812f],.assistant-composer__picker-item-desc[data-v-aae1812f]{font-size:10px;color:var(--app-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-composer__picker-item-label[data-v-aae1812f]{margin-top:1px;font-size:12px;font-weight:600;color:var(--app-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-composer__picker-item-check[data-v-aae1812f]{flex-shrink:0;font-size:16px;color:var(--app-primary)}.assistant-composer__controls[data-v-aae1812f]{display:flex;align-items:center;gap:8px;margin-top:8px}.assistant-composer__model[data-v-aae1812f]{min-width:150px;max-width:220px}.assistant-composer__effort[data-v-aae1812f]{width:110px}.assistant-composer__tool-mode[data-v-aae1812f]{width:150px}.assistant-composer__spacer[data-v-aae1812f]{flex:1}.assistant-composer__file-input[data-v-aae1812f]{display:none}.is-spinning[data-v-aae1812f]{display:inline-block;animation:assistant-composer-spin-aae1812f 1s linear infinite}@keyframes assistant-composer-spin-aae1812f{0%{transform:rotate(0)}to{transform:rotate(360deg)}}", Is = /* @__PURE__ */ we(Cs, [["styles", [As]], ["__scopeId", "data-v-aae1812f"]]), Ss = {
  class: "assistant-window",
  "data-testid": "assistant-window"
}, Ts = { class: "assistant-window__head" }, Ms = { class: "assistant-window__brand" }, Rs = { class: "assistant-window__titles" }, Ls = { key: 0 }, Us = {
  key: 1,
  class: /* @__PURE__ */ ve("is-status")
}, Ds = { class: "assistant-window__body" }, qs = { class: "assistant-window__main" }, zs = {
  key: 1,
  class: "assistant-window__empty",
  "data-testid": "assistant-welcome"
}, Fs = { class: "assistant-window__starters" }, js = ["onClick"], Ns = /* @__PURE__ */ ye({
  name: "AssistantChatWindow",
  __name: "AssistantChatWindow",
  props: {
    projectId: { type: [Number, null] }
  },
  setup(e) {
    const n = e, { t } = Re(), i = ut();
    dn(() => {
      try {
        i.initializeForUser(bt().appKey);
      } catch {
      }
      i.setOpen(!0);
    }), Zn(() => {
      i.setOpen(!1);
    });
    const o = R(() => i.selectedConversationId ? i.conversationStates[i.selectedConversationId] : void 0), r = [
      "怎么把创意整理成视频脚本？",
      "能帮我设计一组连贯分镜吗？",
      "如何统一画面提示词的风格？",
      "有哪些适合短视频的创意方向？"
    ];
    function a(c) {
      i.setDraft(null, c);
    }
    return (c, d) => {
      const g = Ci("IaButton");
      return b(), m("div", Ss, [
        u("header", Ts, [
          ie(g, {
            class: "assistant-window__menu",
            variant: "text",
            size: "sm",
            circle: "",
            title: f(t)("assistant.conversations"),
            "aria-label": f(t)("assistant.conversations"),
            "data-testid": "assistant-drawer-open",
            onClick: d[0] || (d[0] = (x) => f(i).setDrawerOpen(!0))
          }, {
            default: ne(() => [...d[1] || (d[1] = [
              u("i", { class: "ri-menu-line" }, null, -1)
            ])]),
            _: 1
          }, 8, ["title", "aria-label"]),
          u("div", Ms, [
            d[2] || (d[2] = u("span", { class: "assistant-window__logo" }, [
              u("i", { class: "ri-sparkling-2-line" })
            ], -1)),
            u("div", Rs, [
              u("h3", null, h(f(t)("assistant.title")), 1),
              o.value ? (b(), m("p", Us, h(o.value.conversation.title) + " · " + h(f(t)(f(di)(o.value.status))), 1)) : (b(), m("p", Ls, h(f(t)("assistant.subtitle")), 1))
            ])
          ])
        ]),
        u("div", Ds, [
          ie(Cr),
          u("section", qs, [
            f(i).selectedConversationId ? (b(), se(Dl, {
              key: f(i).selectedConversationId,
              "conversation-id": f(i).selectedConversationId
            }, null, 8, ["conversation-id"])) : (b(), m("div", zs, [
              d[4] || (d[4] = u("span", { class: "assistant-window__empty-logo" }, [
                u("i", { class: "ri-sparkling-2-line" })
              ], -1)),
              u("h2", null, h(f(t)("assistant.empty-title")), 1),
              u("p", null, h(f(t)("assistant.empty-desc")), 1),
              u("div", Fs, [
                (b(), m(ue, null, Ee(r, (x) => u("button", {
                  key: x,
                  type: "button",
                  class: "assistant-window__starter fc-button-ghost",
                  onClick: (v) => a(x)
                }, [
                  d[3] || (d[3] = u("i", { class: "ri-lightbulb-line" }, null, -1)),
                  u("span", null, h(x), 1)
                ], 8, js)), 64))
              ])
            ])),
            ie(Is, {
              "project-id": n.projectId
            }, null, 8, ["project-id"])
          ])
        ])
      ]);
    };
  }
}), Bs = ".assistant-window[data-v-2f81bb88]{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}.assistant-window__menu[data-v-2f81bb88]{display:none}@media(max-width:768px){.assistant-window__menu[data-v-2f81bb88]{display:inline-flex}}.assistant-window__head[data-v-2f81bb88]{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--app-separator, var(--el-border-color-lighter))}.assistant-window__brand[data-v-2f81bb88]{display:flex;align-items:center;gap:10px;min-width:0}.assistant-window__logo[data-v-2f81bb88],.assistant-window__empty-logo[data-v-2f81bb88]{display:inline-flex;align-items:center;justify-content:center;border-radius:12px;background:var(--el-color-primary-light-9, #ecf5ff);color:var(--el-color-primary, #409eff)}.assistant-window__logo[data-v-2f81bb88]{width:32px;height:32px;font-size:17px}.assistant-window__titles[data-v-2f81bb88]{min-width:0}.assistant-window__titles h3[data-v-2f81bb88]{margin:0;font-size:14px;font-weight:600;color:var(--app-text)}.assistant-window__titles p[data-v-2f81bb88]{margin:2px 0 0;font-size:11px;color:var(--app-text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.assistant-window__body[data-v-2f81bb88]{flex:1;min-height:0;display:flex}.assistant-window__main[data-v-2f81bb88]{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;position:relative}.assistant-window__loading[data-v-2f81bb88]{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:var(--app-text-secondary)}.assistant-window__empty[data-v-2f81bb88]{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;text-align:center;overflow-y:auto}.assistant-window__empty h2[data-v-2f81bb88]{margin:0;font-size:20px;font-weight:600;color:var(--app-text)}.assistant-window__empty p[data-v-2f81bb88]{margin:0;font-size:12px;color:var(--app-text-secondary);max-width:360px}.assistant-window__empty-logo[data-v-2f81bb88]{width:56px;height:56px;font-size:28px}.assistant-window__starters[data-v-2f81bb88]{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;width:100%;max-width:560px;margin-top:14px}.assistant-window__starter[data-v-2f81bb88]{display:flex;align-items:center;gap:8px;padding:12px;border-radius:10px;border:1px solid var(--app-separator, var(--el-border-color-lighter));background:var(--app-bg, transparent);cursor:pointer;text-align:left;font-size:12px;color:var(--app-text);transition:border-color .15s,background .15s}.assistant-window__starter>i[data-v-2f81bb88]{color:var(--el-color-primary, #409eff);font-size:15px}.assistant-window__starter[data-v-2f81bb88]:hover{border-color:var(--el-color-primary-light-5, #a0cfff);background:var(--app-sidebar-item-hover-bg)}.is-spinning[data-v-2f81bb88]{animation:assistant-window-spin-2f81bb88 1s linear infinite}@keyframes assistant-window-spin-2f81bb88{0%{transform:rotate(0)}to{transform:rotate(360deg)}}", Os = /* @__PURE__ */ we(Ns, [["styles", [Bs]], ["__scopeId", "data-v-2f81bb88"]]), Qs = {
  class: "ia-config",
  "data-testid": "ia-config-panel"
}, Ps = { class: "ia-config__header" }, Ws = { class: "ia-config__title" }, Zs = {
  key: 0,
  class: "ia-config__error",
  "data-testid": "ia-config-error"
}, Ks = { class: "ia-config__section" }, Js = { class: "ia-config__section-title" }, Gs = { class: "ia-config__section-desc" }, Vs = {
  key: 0,
  class: "ia-config__empty",
  "data-testid": "ia-config-skills-empty"
}, Hs = {
  key: 1,
  class: "ia-config__list"
}, Ys = { class: "ia-config__item-main" }, Xs = { class: "ia-config__item-name" }, _s = {
  key: 0,
  class: "ia-config__item-desc"
}, $s = { class: "ia-config__section" }, ec = { class: "ia-config__section-title" }, tc = { class: "ia-config__section-desc" }, nc = {
  key: 0,
  class: "ia-config__empty",
  "data-testid": "ia-config-mcp-empty"
}, ic = {
  key: 1,
  class: "ia-config__list"
}, oc = { class: "ia-config__item-main" }, rc = { class: "ia-config__item-name" }, ac = { class: "ia-config__item-desc" }, lc = { class: "ia-config__item-meta" }, sc = {
  key: 0,
  class: "ia-config__row-error",
  "data-testid": "ia-config-mcp-error"
}, cc = { class: "ia-config__item-actions" }, fc = /* @__PURE__ */ ye({
  name: "AgentConfigPanel",
  __name: "AgentConfigPanel",
  setup(e) {
    const { t: n } = Re(), t = N(!1), i = N(""), o = N(null), r = N([]), a = N(/* @__PURE__ */ new Set()), c = N(/* @__PURE__ */ new Map()), d = R(() => o.value?.skills ?? []);
    dn(() => {
      g();
    });
    async function g() {
      t.value = !0, i.value = "";
      const [y, w] = await Promise.allSettled([
        ro.referenceOptions(),
        Kt.list()
      ]);
      y.status === "fulfilled" && (o.value = y.value), w.status === "fulfilled" && (r.value = w.value), (y.status === "rejected" || w.status === "rejected") && (i.value = n("config.load-failed")), t.value = !1;
    }
    function x() {
      g();
    }
    async function v(y) {
      if (!a.value.has(y.id)) {
        c.value.delete(y.id), a.value = new Set(a.value).add(y.id);
        try {
          const w = y.enabled ? await Kt.disable(y.id) : await Kt.enable(y.id);
          r.value = r.value.map((I) => I.id === w.id ? w : I);
        } catch {
          c.value = new Map(c.value).set(y.id, n("config.update-failed"));
        } finally {
          const w = new Set(a.value);
          w.delete(y.id), a.value = w;
        }
      }
    }
    function k(y) {
      return y.authType === "OAUTH" ? n("config.auth-oauth") : n("config.auth-static-header");
    }
    return (y, w) => (b(), m("div", Qs, [
      u("header", Ps, [
        u("h2", Ws, h(f(n)("config.title")), 1),
        ie(he, {
          variant: "text",
          size: "sm",
          loading: t.value,
          "data-testid": "ia-config-refresh",
          onClick: x
        }, {
          default: ne(() => [
            H(h(f(n)("config.action-refresh")), 1)
          ]),
          _: 1
        }, 8, ["loading"])
      ]),
      i.value ? (b(), m("div", Zs, [
        u("span", null, h(i.value), 1),
        ie(he, {
          variant: "secondary",
          size: "sm",
          "data-testid": "ia-config-retry",
          onClick: x
        }, {
          default: ne(() => [
            H(h(f(n)("config.action-refresh")), 1)
          ]),
          _: 1
        })
      ])) : B("", !0),
      u("section", Ks, [
        u("h3", Js, h(f(n)("config.skills")), 1),
        u("p", Gs, h(f(n)("config.skills-desc")), 1),
        !t.value && d.value.length === 0 ? (b(), m("p", Vs, h(f(n)("config.skills-empty")), 1)) : (b(), m("ul", Hs, [
          (b(!0), m(ue, null, Ee(d.value, (I) => (b(), m("li", {
            key: I.id,
            class: "ia-config__item",
            "data-testid": "ia-config-skill-item"
          }, [
            u("div", Ys, [
              u("span", Xs, h(I.displayName || I.name), 1),
              I.source ? (b(), se(_e, {
                key: 0,
                size: "sm"
              }, {
                default: ne(() => [
                  H(h(I.source), 1)
                ]),
                _: 2
              }, 1024)) : B("", !0)
            ]),
            I.description ? (b(), m("p", _s, h(I.description), 1)) : B("", !0)
          ]))), 128))
        ]))
      ]),
      u("section", $s, [
        u("h3", ec, h(f(n)("config.mcp")), 1),
        u("p", tc, h(f(n)("config.mcp-desc")), 1),
        !t.value && r.value.length === 0 ? (b(), m("p", nc, h(f(n)("config.mcp-empty")), 1)) : (b(), m("ul", ic, [
          (b(!0), m(ue, null, Ee(r.value, (I) => (b(), m("li", {
            key: I.id,
            class: "ia-config__item",
            "data-testid": "ia-config-mcp-item"
          }, [
            u("div", oc, [
              u("span", rc, h(I.name), 1),
              ie(_e, { size: "sm" }, {
                default: ne(() => [
                  H(h(I.serverKey), 1)
                ]),
                _: 2
              }, 1024),
              ie(_e, {
                size: "sm",
                color: I.enabled ? "success" : "gray"
              }, {
                default: ne(() => [
                  H(h(I.enabled ? f(n)("config.mcp-enabled") : f(n)("config.mcp-disabled")), 1)
                ]),
                _: 2
              }, 1032, ["color"])
            ]),
            u("p", ac, h(I.endpointUrl), 1),
            u("p", lc, [
              H(h(k(I)) + " ", 1),
              I.credentialsMasked ? (b(), m(ue, { key: 0 }, [
                H(" · " + h(I.credentialsMasked), 1)
              ], 64)) : B("", !0)
            ]),
            c.value.get(I.id) ? (b(), m("p", sc, h(c.value.get(I.id)), 1)) : B("", !0),
            u("div", cc, [
              ie(he, {
                variant: I.enabled ? "secondary" : "primary",
                size: "sm",
                loading: a.value.has(I.id),
                "data-testid": `ia-config-mcp-toggle-${I.id}`,
                onClick: (P) => v(I)
              }, {
                default: ne(() => [
                  H(h(I.enabled ? f(n)("config.action-disable") : f(n)("config.action-enable")), 1)
                ]),
                _: 2
              }, 1032, ["variant", "loading", "data-testid", "onClick"])
            ])
          ]))), 128))
        ]))
      ])
    ]));
  }
}), dc = ".ia-config[data-v-6cf7c1a2]{height:100%;overflow-y:auto;padding:16px 18px 32px;display:flex;flex-direction:column;gap:18px}.ia-config__header[data-v-6cf7c1a2]{display:flex;align-items:center;justify-content:space-between;gap:8px}.ia-config__title[data-v-6cf7c1a2]{margin:0;font-size:16px;font-weight:600;color:var(--app-text)}.ia-config__error[data-v-6cf7c1a2]{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px;border:1px solid var(--app-color-danger);border-radius:8px;color:var(--app-color-danger);font-size:13px;background:var(--app-bg-card)}.ia-config__section[data-v-6cf7c1a2]{display:flex;flex-direction:column;gap:6px}.ia-config__section-title[data-v-6cf7c1a2]{margin:0;font-size:14px;font-weight:600;color:var(--app-text)}.ia-config__section-desc[data-v-6cf7c1a2]{margin:0;font-size:12px;color:var(--app-text-tertiary)}.ia-config__empty[data-v-6cf7c1a2]{margin:4px 0;font-size:13px;color:var(--app-text-secondary)}.ia-config__list[data-v-6cf7c1a2]{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}.ia-config__item[data-v-6cf7c1a2]{border:1px solid var(--app-separator);border-radius:10px;background:var(--app-bg-card);padding:10px 12px;display:flex;flex-direction:column;gap:4px}.ia-config__item-main[data-v-6cf7c1a2]{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ia-config__item-name[data-v-6cf7c1a2]{font-size:13px;font-weight:600;color:var(--app-text)}.ia-config__item-desc[data-v-6cf7c1a2]{margin:0;font-size:12px;color:var(--app-text-secondary);word-break:break-all}.ia-config__item-meta[data-v-6cf7c1a2]{margin:0;font-size:11px;color:var(--app-text-tertiary)}.ia-config__row-error[data-v-6cf7c1a2]{margin:0;font-size:12px;color:var(--app-color-danger)}.ia-config__item-actions[data-v-6cf7c1a2]{display:flex;justify-content:flex-end;margin-top:2px}", bc = /* @__PURE__ */ we(fc, [["styles", [dc]], ["__scopeId", "data-v-6cf7c1a2"]]), uc = {
  key: 0,
  class: "ia-chat-root__placeholder",
  "data-testid": "ia-view-placeholder"
}, pc = /* @__PURE__ */ ye({
  name: "InnerAgentChat",
  __name: "InnerAgentChat.ce",
  props: {
    view: { default: "chat", type: String },
    projectId: { default: null, type: [Number, String, null] }
  },
  setup(e) {
    const n = e, { t } = Re(), i = ut(), o = N(null), r = R(() => {
      const g = Number(n.projectId);
      return Number.isSafeInteger(g) && g > 0 ? g : null;
    }), a = R(() => n.view === "history"), c = R(() => {
      const g = i.selectedConversationId;
      return (g ? i.conversationStates[g] : void 0)?.pipeline.pendingConfirmation ?? null;
    });
    let d = "";
    return Te(c, (g) => {
      if (!g) return;
      const x = i.selectedConversationId, v = o.value;
      if (!x || !v) return;
      const k = `${g.runId}:${g.replyId}`;
      k !== d && (d = k, v.dispatchEvent(new CustomEvent("SCOPE_RESOLVED", {
        bubbles: !0,
        composed: !0,
        detail: {
          conversationId: x,
          runId: g.runId,
          replyId: g.replyId,
          tools: (g.toolCalls ?? []).map((y) => ({
            toolCallId: y.toolCallId,
            toolName: y.toolName,
            scope: mn(y.scope)
          }))
        }
      })));
    }), (g, x) => (b(), m("div", {
      ref_key: "rootRef",
      ref: o,
      class: "ia-chat-root"
    }, [
      a.value ? (b(), m("div", uc, [
        u("p", null, h(f(t)("assistant.title")) + ' · view="' + h(e.view) + '"', 1),
        x[0] || (x[0] = u("p", { class: "ia-chat-root__placeholder-desc" }, ' history 视图为占位; 当前实现: view="chat" / view="config"。 ', -1))
      ])) : e.view === "config" ? (b(), se(bc, { key: 1 })) : (b(), se(Os, {
        key: 2,
        "project-id": r.value
      }, null, 8, ["project-id"]))
    ], 512));
  }
}), mc = '@font-face{font-family:remixicon;font-style:normal;font-weight:400;font-display:block;src:url(data:font/woff2;base64,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) format("woff2")}.ri-24-hours-fill:before{content:""}.ri-24-hours-line:before{content:""}.ri-4k-fill:before{content:""}.ri-4k-line:before{content:""}.ri-a-b:before{content:""}.ri-account-box-fill:before{content:""}.ri-account-box-line:before{content:""}.ri-account-circle-fill:before{content:""}.ri-account-circle-line:before{content:""}.ri-account-pin-box-fill:before{content:""}.ri-account-pin-box-line:before{content:""}.ri-account-pin-circle-fill:before{content:""}.ri-account-pin-circle-line:before{content:""}.ri-add-box-fill:before{content:""}.ri-add-box-line:before{content:""}.ri-add-circle-fill:before{content:""}.ri-add-circle-line:before{content:""}.ri-add-fill:before{content:""}.ri-add-line:before{content:""}.ri-admin-fill:before{content:""}.ri-admin-line:before{content:""}.ri-advertisement-fill:before{content:""}.ri-advertisement-line:before{content:""}.ri-airplay-fill:before{content:""}.ri-airplay-line:before{content:""}.ri-alarm-fill:before{content:""}.ri-alarm-line:before{content:""}.ri-alarm-warning-fill:before{content:""}.ri-alarm-warning-line:before{content:""}.ri-album-fill:before{content:""}.ri-album-line:before{content:""}.ri-alert-fill:before{content:""}.ri-alert-line:before{content:""}.ri-aliens-fill:before{content:""}.ri-aliens-line:before{content:""}.ri-align-bottom:before{content:""}.ri-align-center:before{content:""}.ri-align-justify:before{content:""}.ri-align-left:before{content:""}.ri-align-right:before{content:""}.ri-align-top:before{content:""}.ri-align-vertically:before{content:""}.ri-alipay-fill:before{content:""}.ri-alipay-line:before{content:""}.ri-amazon-fill:before{content:""}.ri-amazon-line:before{content:""}.ri-anchor-fill:before{content:""}.ri-anchor-line:before{content:""}.ri-ancient-gate-fill:before{content:""}.ri-ancient-gate-line:before{content:""}.ri-ancient-pavilion-fill:before{content:""}.ri-ancient-pavilion-line:before{content:""}.ri-android-fill:before{content:""}.ri-android-line:before{content:""}.ri-angularjs-fill:before{content:""}.ri-angularjs-line:before{content:""}.ri-anticlockwise-2-fill:before{content:""}.ri-anticlockwise-2-line:before{content:""}.ri-anticlockwise-fill:before{content:""}.ri-anticlockwise-line:before{content:""}.ri-app-store-fill:before{content:""}.ri-app-store-line:before{content:""}.ri-apple-fill:before{content:""}.ri-apple-line:before{content:""}.ri-apps-2-fill:before{content:""}.ri-apps-2-line:before{content:""}.ri-apps-fill:before{content:""}.ri-apps-line:before{content:""}.ri-archive-drawer-fill:before{content:""}.ri-archive-drawer-line:before{content:""}.ri-archive-fill:before{content:""}.ri-archive-line:before{content:""}.ri-arrow-down-circle-fill:before{content:""}.ri-arrow-down-circle-line:before{content:""}.ri-arrow-down-fill:before{content:""}.ri-arrow-down-line:before{content:""}.ri-arrow-down-s-fill:before{content:""}.ri-arrow-down-s-line:before{content:""}.ri-arrow-drop-down-fill:before{content:""}.ri-arrow-drop-down-line:before{content:""}.ri-arrow-drop-left-fill:before{content:""}.ri-arrow-drop-left-line:before{content:""}.ri-arrow-drop-right-fill:before{content:""}.ri-arrow-drop-right-line:before{content:""}.ri-arrow-drop-up-fill:before{content:""}.ri-arrow-drop-up-line:before{content:""}.ri-arrow-go-back-fill:before{content:""}.ri-arrow-go-back-line:before{content:""}.ri-arrow-go-forward-fill:before{content:""}.ri-arrow-go-forward-line:before{content:""}.ri-arrow-left-circle-fill:before{content:""}.ri-arrow-left-circle-line:before{content:""}.ri-arrow-left-down-fill:before{content:""}.ri-arrow-left-down-line:before{content:""}.ri-arrow-left-fill:before{content:""}.ri-arrow-left-line:before{content:""}.ri-arrow-left-right-fill:before{content:""}.ri-arrow-left-right-line:before{content:""}.ri-arrow-left-s-fill:before{content:""}.ri-arrow-left-s-line:before{content:""}.ri-arrow-left-up-fill:before{content:""}.ri-arrow-left-up-line:before{content:""}.ri-arrow-right-circle-fill:before{content:""}.ri-arrow-right-circle-line:before{content:""}.ri-arrow-right-down-fill:before{content:""}.ri-arrow-right-down-line:before{content:""}.ri-arrow-right-fill:before{content:""}.ri-arrow-right-line:before{content:""}.ri-arrow-right-s-fill:before{content:""}.ri-arrow-right-s-line:before{content:""}.ri-arrow-right-up-fill:before{content:""}.ri-arrow-right-up-line:before{content:""}.ri-arrow-up-circle-fill:before{content:""}.ri-arrow-up-circle-line:before{content:""}.ri-arrow-up-down-fill:before{content:""}.ri-arrow-up-down-line:before{content:""}.ri-arrow-up-fill:before{content:""}.ri-arrow-up-line:before{content:""}.ri-arrow-up-s-fill:before{content:""}.ri-arrow-up-s-line:before{content:""}.ri-artboard-2-fill:before{content:""}.ri-artboard-2-line:before{content:""}.ri-artboard-fill:before{content:""}.ri-artboard-line:before{content:""}.ri-article-fill:before{content:""}.ri-article-line:before{content:""}.ri-aspect-ratio-fill:before{content:""}.ri-aspect-ratio-line:before{content:""}.ri-asterisk:before{content:""}.ri-at-fill:before{content:""}.ri-at-line:before{content:""}.ri-attachment-2:before{content:""}.ri-attachment-fill:before{content:""}.ri-attachment-line:before{content:""}.ri-auction-fill:before{content:""}.ri-auction-line:before{content:""}.ri-award-fill:before{content:""}.ri-award-line:before{content:""}.ri-baidu-fill:before{content:""}.ri-baidu-line:before{content:""}.ri-ball-pen-fill:before{content:""}.ri-ball-pen-line:before{content:""}.ri-bank-card-2-fill:before{content:""}.ri-bank-card-2-line:before{content:""}.ri-bank-card-fill:before{content:""}.ri-bank-card-line:before{content:""}.ri-bank-fill:before{content:""}.ri-bank-line:before{content:""}.ri-bar-chart-2-fill:before{content:""}.ri-bar-chart-2-line:before{content:""}.ri-bar-chart-box-fill:before{content:""}.ri-bar-chart-box-line:before{content:""}.ri-bar-chart-fill:before{content:""}.ri-bar-chart-grouped-fill:before{content:""}.ri-bar-chart-grouped-line:before{content:""}.ri-bar-chart-horizontal-fill:before{content:""}.ri-bar-chart-horizontal-line:before{content:""}.ri-bar-chart-line:before{content:""}.ri-barcode-box-fill:before{content:""}.ri-barcode-box-line:before{content:""}.ri-barcode-fill:before{content:""}.ri-barcode-line:before{content:""}.ri-barricade-fill:before{content:""}.ri-barricade-line:before{content:""}.ri-base-station-fill:before{content:""}.ri-base-station-line:before{content:""}.ri-basketball-fill:before{content:""}.ri-basketball-line:before{content:""}.ri-battery-2-charge-fill:before{content:""}.ri-battery-2-charge-line:before{content:""}.ri-battery-2-fill:before{content:""}.ri-battery-2-line:before{content:""}.ri-battery-charge-fill:before{content:""}.ri-battery-charge-line:before{content:""}.ri-battery-fill:before{content:""}.ri-battery-line:before{content:""}.ri-battery-low-fill:before{content:""}.ri-battery-low-line:before{content:""}.ri-battery-saver-fill:before{content:""}.ri-battery-saver-line:before{content:""}.ri-battery-share-fill:before{content:""}.ri-battery-share-line:before{content:""}.ri-bear-smile-fill:before{content:""}.ri-bear-smile-line:before{content:""}.ri-behance-fill:before{content:""}.ri-behance-line:before{content:""}.ri-bell-fill:before{content:""}.ri-bell-line:before{content:""}.ri-bike-fill:before{content:""}.ri-bike-line:before{content:""}.ri-bilibili-fill:before{content:""}.ri-bilibili-line:before{content:""}.ri-bill-fill:before{content:""}.ri-bill-line:before{content:""}.ri-billiards-fill:before{content:""}.ri-billiards-line:before{content:""}.ri-bit-coin-fill:before{content:""}.ri-bit-coin-line:before{content:""}.ri-blaze-fill:before{content:""}.ri-blaze-line:before{content:""}.ri-bluetooth-connect-fill:before{content:""}.ri-bluetooth-connect-line:before{content:""}.ri-bluetooth-fill:before{content:""}.ri-bluetooth-line:before{content:""}.ri-blur-off-fill:before{content:""}.ri-blur-off-line:before{content:""}.ri-body-scan-fill:before{content:""}.ri-body-scan-line:before{content:""}.ri-bold:before{content:""}.ri-book-2-fill:before{content:""}.ri-book-2-line:before{content:""}.ri-book-3-fill:before{content:""}.ri-book-3-line:before{content:""}.ri-book-fill:before{content:""}.ri-book-line:before{content:""}.ri-book-marked-fill:before{content:""}.ri-book-marked-line:before{content:""}.ri-book-open-fill:before{content:""}.ri-book-open-line:before{content:""}.ri-book-read-fill:before{content:""}.ri-book-read-line:before{content:""}.ri-booklet-fill:before{content:""}.ri-booklet-line:before{content:""}.ri-bookmark-2-fill:before{content:""}.ri-bookmark-2-line:before{content:""}.ri-bookmark-3-fill:before{content:""}.ri-bookmark-3-line:before{content:""}.ri-bookmark-fill:before{content:""}.ri-bookmark-line:before{content:""}.ri-boxing-fill:before{content:""}.ri-boxing-line:before{content:""}.ri-braces-fill:before{content:""}.ri-braces-line:before{content:""}.ri-brackets-fill:before{content:""}.ri-brackets-line:before{content:""}.ri-briefcase-2-fill:before{content:""}.ri-briefcase-2-line:before{content:""}.ri-briefcase-3-fill:before{content:""}.ri-briefcase-3-line:before{content:""}.ri-briefcase-4-fill:before{content:""}.ri-briefcase-4-line:before{content:""}.ri-briefcase-5-fill:before{content:""}.ri-briefcase-5-line:before{content:""}.ri-briefcase-fill:before{content:""}.ri-briefcase-line:before{content:""}.ri-bring-forward:before{content:""}.ri-bring-to-front:before{content:""}.ri-broadcast-fill:before{content:""}.ri-broadcast-line:before{content:""}.ri-brush-2-fill:before{content:""}.ri-brush-2-line:before{content:""}.ri-brush-3-fill:before{content:""}.ri-brush-3-line:before{content:""}.ri-brush-4-fill:before{content:""}.ri-brush-4-line:before{content:""}.ri-brush-fill:before{content:""}.ri-brush-line:before{content:""}.ri-bubble-chart-fill:before{content:""}.ri-bubble-chart-line:before{content:""}.ri-bug-2-fill:before{content:""}.ri-bug-2-line:before{content:""}.ri-bug-fill:before{content:""}.ri-bug-line:before{content:""}.ri-building-2-fill:before{content:""}.ri-building-2-line:before{content:""}.ri-building-3-fill:before{content:""}.ri-building-3-line:before{content:""}.ri-building-4-fill:before{content:""}.ri-building-4-line:before{content:""}.ri-building-fill:before{content:""}.ri-building-line:before{content:""}.ri-bus-2-fill:before{content:""}.ri-bus-2-line:before{content:""}.ri-bus-fill:before{content:""}.ri-bus-line:before{content:""}.ri-bus-wifi-fill:before{content:""}.ri-bus-wifi-line:before{content:""}.ri-cactus-fill:before{content:""}.ri-cactus-line:before{content:""}.ri-cake-2-fill:before{content:""}.ri-cake-2-line:before{content:""}.ri-cake-3-fill:before{content:""}.ri-cake-3-line:before{content:""}.ri-cake-fill:before{content:""}.ri-cake-line:before{content:""}.ri-calculator-fill:before{content:""}.ri-calculator-line:before{content:""}.ri-calendar-2-fill:before{content:""}.ri-calendar-2-line:before{content:""}.ri-calendar-check-fill:before{content:""}.ri-calendar-check-line:before{content:""}.ri-calendar-event-fill:before{content:""}.ri-calendar-event-line:before{content:""}.ri-calendar-fill:before{content:""}.ri-calendar-line:before{content:""}.ri-calendar-todo-fill:before{content:""}.ri-calendar-todo-line:before{content:""}.ri-camera-2-fill:before{content:""}.ri-camera-2-line:before{content:""}.ri-camera-3-fill:before{content:""}.ri-camera-3-line:before{content:""}.ri-camera-fill:before{content:""}.ri-camera-lens-fill:before{content:""}.ri-camera-lens-line:before{content:""}.ri-camera-line:before{content:""}.ri-camera-off-fill:before{content:""}.ri-camera-off-line:before{content:""}.ri-camera-switch-fill:before{content:""}.ri-camera-switch-line:before{content:""}.ri-capsule-fill:before{content:""}.ri-capsule-line:before{content:""}.ri-car-fill:before{content:""}.ri-car-line:before{content:""}.ri-car-washing-fill:before{content:""}.ri-car-washing-line:before{content:""}.ri-caravan-fill:before{content:""}.ri-caravan-line:before{content:""}.ri-cast-fill:before{content:""}.ri-cast-line:before{content:""}.ri-cellphone-fill:before{content:""}.ri-cellphone-line:before{content:""}.ri-celsius-fill:before{content:""}.ri-celsius-line:before{content:""}.ri-centos-fill:before{content:""}.ri-centos-line:before{content:""}.ri-character-recognition-fill:before{content:""}.ri-character-recognition-line:before{content:""}.ri-charging-pile-2-fill:before{content:""}.ri-charging-pile-2-line:before{content:""}.ri-charging-pile-fill:before{content:""}.ri-charging-pile-line:before{content:""}.ri-chat-1-fill:before{content:""}.ri-chat-1-line:before{content:""}.ri-chat-2-fill:before{content:""}.ri-chat-2-line:before{content:""}.ri-chat-3-fill:before{content:""}.ri-chat-3-line:before{content:""}.ri-chat-4-fill:before{content:""}.ri-chat-4-line:before{content:""}.ri-chat-check-fill:before{content:""}.ri-chat-check-line:before{content:""}.ri-chat-delete-fill:before{content:""}.ri-chat-delete-line:before{content:""}.ri-chat-download-fill:before{content:""}.ri-chat-download-line:before{content:""}.ri-chat-follow-up-fill:before{content:""}.ri-chat-follow-up-line:before{content:""}.ri-chat-forward-fill:before{content:""}.ri-chat-forward-line:before{content:""}.ri-chat-heart-fill:before{content:""}.ri-chat-heart-line:before{content:""}.ri-chat-history-fill:before{content:""}.ri-chat-history-line:before{content:""}.ri-chat-new-fill:before{content:""}.ri-chat-new-line:before{content:""}.ri-chat-off-fill:before{content:""}.ri-chat-off-line:before{content:""}.ri-chat-poll-fill:before{content:""}.ri-chat-poll-line:before{content:""}.ri-chat-private-fill:before{content:""}.ri-chat-private-line:before{content:""}.ri-chat-quote-fill:before{content:""}.ri-chat-quote-line:before{content:""}.ri-chat-settings-fill:before{content:""}.ri-chat-settings-line:before{content:""}.ri-chat-smile-2-fill:before{content:""}.ri-chat-smile-2-line:before{content:""}.ri-chat-smile-3-fill:before{content:""}.ri-chat-smile-3-line:before{content:""}.ri-chat-smile-fill:before{content:""}.ri-chat-smile-line:before{content:""}.ri-chat-upload-fill:before{content:""}.ri-chat-upload-line:before{content:""}.ri-chat-voice-fill:before{content:""}.ri-chat-voice-line:before{content:""}.ri-check-double-fill:before{content:""}.ri-check-double-line:before{content:""}.ri-check-fill:before{content:""}.ri-check-line:before{content:""}.ri-checkbox-blank-circle-fill:before{content:""}.ri-checkbox-blank-circle-line:before{content:""}.ri-checkbox-blank-fill:before{content:""}.ri-checkbox-blank-line:before{content:""}.ri-checkbox-circle-fill:before{content:""}.ri-checkbox-circle-line:before{content:""}.ri-checkbox-fill:before{content:""}.ri-checkbox-indeterminate-fill:before{content:""}.ri-checkbox-indeterminate-line:before{content:""}.ri-checkbox-line:before{content:""}.ri-checkbox-multiple-blank-fill:before{content:""}.ri-checkbox-multiple-blank-line:before{content:""}.ri-checkbox-multiple-fill:before{content:""}.ri-checkbox-multiple-line:before{content:""}.ri-china-railway-fill:before{content:""}.ri-china-railway-line:before{content:""}.ri-chrome-fill:before{content:""}.ri-chrome-line:before{content:""}.ri-clapperboard-fill:before{content:""}.ri-clapperboard-line:before{content:""}.ri-clipboard-fill:before{content:""}.ri-clipboard-line:before{content:""}.ri-clockwise-2-fill:before{content:""}.ri-clockwise-2-line:before{content:""}.ri-clockwise-fill:before{content:""}.ri-clockwise-line:before{content:""}.ri-close-circle-fill:before{content:""}.ri-close-circle-line:before{content:""}.ri-close-fill:before{content:""}.ri-close-line:before{content:""}.ri-closed-captioning-fill:before{content:""}.ri-closed-captioning-line:before{content:""}.ri-cloud-fill:before{content:""}.ri-cloud-line:before{content:""}.ri-cloud-off-fill:before{content:""}.ri-cloud-off-line:before{content:""}.ri-cloud-windy-fill:before{content:""}.ri-cloud-windy-line:before{content:""}.ri-cloudy-2-fill:before{content:""}.ri-cloudy-2-line:before{content:""}.ri-cloudy-fill:before{content:""}.ri-cloudy-line:before{content:""}.ri-code-box-fill:before{content:""}.ri-code-box-line:before{content:""}.ri-code-fill:before{content:""}.ri-code-line:before{content:""}.ri-code-s-fill:before{content:""}.ri-code-s-line:before{content:""}.ri-code-s-slash-fill:before{content:""}.ri-code-s-slash-line:before{content:""}.ri-code-view:before{content:""}.ri-codepen-fill:before{content:""}.ri-codepen-line:before{content:""}.ri-coin-fill:before{content:""}.ri-coin-line:before{content:""}.ri-coins-fill:before{content:""}.ri-coins-line:before{content:""}.ri-collage-fill:before{content:""}.ri-collage-line:before{content:""}.ri-command-fill:before{content:""}.ri-command-line:before{content:""}.ri-community-fill:before{content:""}.ri-community-line:before{content:""}.ri-compass-2-fill:before{content:""}.ri-compass-2-line:before{content:""}.ri-compass-3-fill:before{content:""}.ri-compass-3-line:before{content:""}.ri-compass-4-fill:before{content:""}.ri-compass-4-line:before{content:""}.ri-compass-discover-fill:before{content:""}.ri-compass-discover-line:before{content:""}.ri-compass-fill:before{content:""}.ri-compass-line:before{content:""}.ri-compasses-2-fill:before{content:""}.ri-compasses-2-line:before{content:""}.ri-compasses-fill:before{content:""}.ri-compasses-line:before{content:""}.ri-computer-fill:before{content:""}.ri-computer-line:before{content:""}.ri-contacts-book-2-fill:before{content:""}.ri-contacts-book-2-line:before{content:""}.ri-contacts-book-fill:before{content:""}.ri-contacts-book-line:before{content:""}.ri-contacts-book-upload-fill:before{content:""}.ri-contacts-book-upload-line:before{content:""}.ri-contacts-fill:before{content:""}.ri-contacts-line:before{content:""}.ri-contrast-2-fill:before{content:""}.ri-contrast-2-line:before{content:""}.ri-contrast-drop-2-fill:before{content:""}.ri-contrast-drop-2-line:before{content:""}.ri-contrast-drop-fill:before{content:""}.ri-contrast-drop-line:before{content:""}.ri-contrast-fill:before{content:""}.ri-contrast-line:before{content:""}.ri-copper-coin-fill:before{content:""}.ri-copper-coin-line:before{content:""}.ri-copper-diamond-fill:before{content:""}.ri-copper-diamond-line:before{content:""}.ri-copyleft-fill:before{content:""}.ri-copyleft-line:before{content:""}.ri-copyright-fill:before{content:""}.ri-copyright-line:before{content:""}.ri-coreos-fill:before{content:""}.ri-coreos-line:before{content:""}.ri-coupon-2-fill:before{content:""}.ri-coupon-2-line:before{content:""}.ri-coupon-3-fill:before{content:""}.ri-coupon-3-line:before{content:""}.ri-coupon-4-fill:before{content:""}.ri-coupon-4-line:before{content:""}.ri-coupon-5-fill:before{content:""}.ri-coupon-5-line:before{content:""}.ri-coupon-fill:before{content:""}.ri-coupon-line:before{content:""}.ri-cpu-fill:before{content:""}.ri-cpu-line:before{content:""}.ri-creative-commons-by-fill:before{content:""}.ri-creative-commons-by-line:before{content:""}.ri-creative-commons-fill:before{content:""}.ri-creative-commons-line:before{content:""}.ri-creative-commons-nc-fill:before{content:""}.ri-creative-commons-nc-line:before{content:""}.ri-creative-commons-nd-fill:before{content:""}.ri-creative-commons-nd-line:before{content:""}.ri-creative-commons-sa-fill:before{content:""}.ri-creative-commons-sa-line:before{content:""}.ri-creative-commons-zero-fill:before{content:""}.ri-creative-commons-zero-line:before{content:""}.ri-criminal-fill:before{content:""}.ri-criminal-line:before{content:""}.ri-crop-2-fill:before{content:""}.ri-crop-2-line:before{content:""}.ri-crop-fill:before{content:""}.ri-crop-line:before{content:""}.ri-css3-fill:before{content:""}.ri-css3-line:before{content:""}.ri-cup-fill:before{content:""}.ri-cup-line:before{content:""}.ri-currency-fill:before{content:""}.ri-currency-line:before{content:""}.ri-cursor-fill:before{content:""}.ri-cursor-line:before{content:""}.ri-customer-service-2-fill:before{content:""}.ri-customer-service-2-line:before{content:""}.ri-customer-service-fill:before{content:""}.ri-customer-service-line:before{content:""}.ri-dashboard-2-fill:before{content:""}.ri-dashboard-2-line:before{content:""}.ri-dashboard-3-fill:before{content:""}.ri-dashboard-3-line:before{content:""}.ri-dashboard-fill:before{content:""}.ri-dashboard-line:before{content:""}.ri-database-2-fill:before{content:""}.ri-database-2-line:before{content:""}.ri-database-fill:before{content:""}.ri-database-line:before{content:""}.ri-delete-back-2-fill:before{content:""}.ri-delete-back-2-line:before{content:""}.ri-delete-back-fill:before{content:""}.ri-delete-back-line:before{content:""}.ri-delete-bin-2-fill:before{content:""}.ri-delete-bin-2-line:before{content:""}.ri-delete-bin-3-fill:before{content:""}.ri-delete-bin-3-line:before{content:""}.ri-delete-bin-4-fill:before{content:""}.ri-delete-bin-4-line:before{content:""}.ri-delete-bin-5-fill:before{content:""}.ri-delete-bin-5-line:before{content:""}.ri-delete-bin-6-fill:before{content:""}.ri-delete-bin-6-line:before{content:""}.ri-delete-bin-7-fill:before{content:""}.ri-delete-bin-7-line:before{content:""}.ri-delete-bin-fill:before{content:""}.ri-delete-bin-line:before{content:""}.ri-delete-column:before{content:""}.ri-delete-row:before{content:""}.ri-device-fill:before{content:""}.ri-device-line:before{content:""}.ri-device-recover-fill:before{content:""}.ri-device-recover-line:before{content:""}.ri-dingding-fill:before{content:""}.ri-dingding-line:before{content:""}.ri-direction-fill:before{content:""}.ri-direction-line:before{content:""}.ri-disc-fill:before{content:""}.ri-disc-line:before{content:""}.ri-discord-fill:before{content:""}.ri-discord-line:before{content:""}.ri-discuss-fill:before{content:""}.ri-discuss-line:before{content:""}.ri-dislike-fill:before{content:""}.ri-dislike-line:before{content:""}.ri-disqus-fill:before{content:""}.ri-disqus-line:before{content:""}.ri-divide-fill:before{content:""}.ri-divide-line:before{content:""}.ri-donut-chart-fill:before{content:""}.ri-donut-chart-line:before{content:""}.ri-door-closed-fill:before{content:""}.ri-door-closed-line:before{content:""}.ri-door-fill:before{content:""}.ri-door-line:before{content:""}.ri-door-lock-box-fill:before{content:""}.ri-door-lock-box-line:before{content:""}.ri-door-lock-fill:before{content:""}.ri-door-lock-line:before{content:""}.ri-door-open-fill:before{content:""}.ri-door-open-line:before{content:""}.ri-dossier-fill:before{content:""}.ri-dossier-line:before{content:""}.ri-douban-fill:before{content:""}.ri-douban-line:before{content:""}.ri-double-quotes-l:before{content:""}.ri-double-quotes-r:before{content:""}.ri-download-2-fill:before{content:""}.ri-download-2-line:before{content:""}.ri-download-cloud-2-fill:before{content:""}.ri-download-cloud-2-line:before{content:""}.ri-download-cloud-fill:before{content:""}.ri-download-cloud-line:before{content:""}.ri-download-fill:before{content:""}.ri-download-line:before{content:""}.ri-draft-fill:before{content:""}.ri-draft-line:before{content:""}.ri-drag-drop-fill:before{content:""}.ri-drag-drop-line:before{content:""}.ri-drag-move-2-fill:before{content:""}.ri-drag-move-2-line:before{content:""}.ri-drag-move-fill:before{content:""}.ri-drag-move-line:before{content:""}.ri-dribbble-fill:before{content:""}.ri-dribbble-line:before{content:""}.ri-drive-fill:before{content:""}.ri-drive-line:before{content:""}.ri-drizzle-fill:before{content:""}.ri-drizzle-line:before{content:""}.ri-drop-fill:before{content:""}.ri-drop-line:before{content:""}.ri-dropbox-fill:before{content:""}.ri-dropbox-line:before{content:""}.ri-dual-sim-1-fill:before{content:""}.ri-dual-sim-1-line:before{content:""}.ri-dual-sim-2-fill:before{content:""}.ri-dual-sim-2-line:before{content:""}.ri-dv-fill:before{content:""}.ri-dv-line:before{content:""}.ri-dvd-fill:before{content:""}.ri-dvd-line:before{content:""}.ri-e-bike-2-fill:before{content:""}.ri-e-bike-2-line:before{content:""}.ri-e-bike-fill:before{content:""}.ri-e-bike-line:before{content:""}.ri-earth-fill:before{content:""}.ri-earth-line:before{content:""}.ri-earthquake-fill:before{content:""}.ri-earthquake-line:before{content:""}.ri-edge-fill:before{content:""}.ri-edge-line:before{content:""}.ri-edit-2-fill:before{content:""}.ri-edit-2-line:before{content:""}.ri-edit-box-fill:before{content:""}.ri-edit-box-line:before{content:""}.ri-edit-circle-fill:before{content:""}.ri-edit-circle-line:before{content:""}.ri-edit-fill:before{content:""}.ri-edit-line:before{content:""}.ri-eject-fill:before{content:""}.ri-eject-line:before{content:""}.ri-emotion-2-fill:before{content:""}.ri-emotion-2-line:before{content:""}.ri-emotion-fill:before{content:""}.ri-emotion-happy-fill:before{content:""}.ri-emotion-happy-line:before{content:""}.ri-emotion-laugh-fill:before{content:""}.ri-emotion-laugh-line:before{content:""}.ri-emotion-line:before{content:""}.ri-emotion-normal-fill:before{content:""}.ri-emotion-normal-line:before{content:""}.ri-emotion-sad-fill:before{content:""}.ri-emotion-sad-line:before{content:""}.ri-emotion-unhappy-fill:before{content:""}.ri-emotion-unhappy-line:before{content:""}.ri-empathize-fill:before{content:""}.ri-empathize-line:before{content:""}.ri-emphasis-cn:before{content:""}.ri-emphasis:before{content:""}.ri-english-input:before{content:""}.ri-equalizer-fill:before{content:""}.ri-equalizer-line:before{content:""}.ri-eraser-fill:before{content:""}.ri-eraser-line:before{content:""}.ri-error-warning-fill:before{content:""}.ri-error-warning-line:before{content:""}.ri-evernote-fill:before{content:""}.ri-evernote-line:before{content:""}.ri-exchange-box-fill:before{content:""}.ri-exchange-box-line:before{content:""}.ri-exchange-cny-fill:before{content:""}.ri-exchange-cny-line:before{content:""}.ri-exchange-dollar-fill:before{content:""}.ri-exchange-dollar-line:before{content:""}.ri-exchange-fill:before{content:""}.ri-exchange-funds-fill:before{content:""}.ri-exchange-funds-line:before{content:""}.ri-exchange-line:before{content:""}.ri-external-link-fill:before{content:""}.ri-external-link-line:before{content:""}.ri-eye-2-fill:before{content:""}.ri-eye-2-line:before{content:""}.ri-eye-close-fill:before{content:""}.ri-eye-close-line:before{content:""}.ri-eye-fill:before{content:""}.ri-eye-line:before{content:""}.ri-eye-off-fill:before{content:""}.ri-eye-off-line:before{content:""}.ri-facebook-box-fill:before{content:""}.ri-facebook-box-line:before{content:""}.ri-facebook-circle-fill:before{content:""}.ri-facebook-circle-line:before{content:""}.ri-facebook-fill:before{content:""}.ri-facebook-line:before{content:""}.ri-fahrenheit-fill:before{content:""}.ri-fahrenheit-line:before{content:""}.ri-feedback-fill:before{content:""}.ri-feedback-line:before{content:""}.ri-file-2-fill:before{content:""}.ri-file-2-line:before{content:""}.ri-file-3-fill:before{content:""}.ri-file-3-line:before{content:""}.ri-file-4-fill:before{content:""}.ri-file-4-line:before{content:""}.ri-file-add-fill:before{content:""}.ri-file-add-line:before{content:""}.ri-file-chart-2-fill:before{content:""}.ri-file-chart-2-line:before{content:""}.ri-file-chart-fill:before{content:""}.ri-file-chart-line:before{content:""}.ri-file-cloud-fill:before{content:""}.ri-file-cloud-line:before{content:""}.ri-file-code-fill:before{content:""}.ri-file-code-line:before{content:""}.ri-file-copy-2-fill:before{content:""}.ri-file-copy-2-line:before{content:""}.ri-file-copy-fill:before{content:""}.ri-file-copy-line:before{content:""}.ri-file-damage-fill:before{content:""}.ri-file-damage-line:before{content:""}.ri-file-download-fill:before{content:""}.ri-file-download-line:before{content:""}.ri-file-edit-fill:before{content:""}.ri-file-edit-line:before{content:""}.ri-file-excel-2-fill:before{content:""}.ri-file-excel-2-line:before{content:""}.ri-file-excel-fill:before{content:""}.ri-file-excel-line:before{content:""}.ri-file-fill:before{content:""}.ri-file-forbid-fill:before{content:""}.ri-file-forbid-line:before{content:""}.ri-file-gif-fill:before{content:""}.ri-file-gif-line:before{content:""}.ri-file-history-fill:before{content:""}.ri-file-history-line:before{content:""}.ri-file-hwp-fill:before{content:""}.ri-file-hwp-line:before{content:""}.ri-file-info-fill:before{content:""}.ri-file-info-line:before{content:""}.ri-file-line:before{content:""}.ri-file-list-2-fill:before{content:""}.ri-file-list-2-line:before{content:""}.ri-file-list-3-fill:before{content:""}.ri-file-list-3-line:before{content:""}.ri-file-list-fill:before{content:""}.ri-file-list-line:before{content:""}.ri-file-lock-fill:before{content:""}.ri-file-lock-line:before{content:""}.ri-file-marked-fill:before{content:""}.ri-file-marked-line:before{content:""}.ri-file-music-fill:before{content:""}.ri-file-music-line:before{content:""}.ri-file-paper-2-fill:before{content:""}.ri-file-paper-2-line:before{content:""}.ri-file-paper-fill:before{content:""}.ri-file-paper-line:before{content:""}.ri-file-pdf-fill:before{content:""}.ri-file-pdf-line:before{content:""}.ri-file-ppt-2-fill:before{content:""}.ri-file-ppt-2-line:before{content:""}.ri-file-ppt-fill:before{content:""}.ri-file-ppt-line:before{content:""}.ri-file-reduce-fill:before{content:""}.ri-file-reduce-line:before{content:""}.ri-file-search-fill:before{content:""}.ri-file-search-line:before{content:""}.ri-file-settings-fill:before{content:""}.ri-file-settings-line:before{content:""}.ri-file-shield-2-fill:before{content:""}.ri-file-shield-2-line:before{content:""}.ri-file-shield-fill:before{content:""}.ri-file-shield-line:before{content:""}.ri-file-shred-fill:before{content:""}.ri-file-shred-line:before{content:""}.ri-file-text-fill:before{content:""}.ri-file-text-line:before{content:""}.ri-file-transfer-fill:before{content:""}.ri-file-transfer-line:before{content:""}.ri-file-unknow-fill:before{content:""}.ri-file-unknow-line:before{content:""}.ri-file-upload-fill:before{content:""}.ri-file-upload-line:before{content:""}.ri-file-user-fill:before{content:""}.ri-file-user-line:before{content:""}.ri-file-warning-fill:before{content:""}.ri-file-warning-line:before{content:""}.ri-file-word-2-fill:before{content:""}.ri-file-word-2-line:before{content:""}.ri-file-word-fill:before{content:""}.ri-file-word-line:before{content:""}.ri-file-zip-fill:before{content:""}.ri-file-zip-line:before{content:""}.ri-film-fill:before{content:""}.ri-film-line:before{content:""}.ri-filter-2-fill:before{content:""}.ri-filter-2-line:before{content:""}.ri-filter-3-fill:before{content:""}.ri-filter-3-line:before{content:""}.ri-filter-fill:before{content:""}.ri-filter-line:before{content:""}.ri-filter-off-fill:before{content:""}.ri-filter-off-line:before{content:""}.ri-find-replace-fill:before{content:""}.ri-find-replace-line:before{content:""}.ri-finder-fill:before{content:""}.ri-finder-line:before{content:""}.ri-fingerprint-2-fill:before{content:""}.ri-fingerprint-2-line:before{content:""}.ri-fingerprint-fill:before{content:""}.ri-fingerprint-line:before{content:""}.ri-fire-fill:before{content:""}.ri-fire-line:before{content:""}.ri-firefox-fill:before{content:""}.ri-firefox-line:before{content:""}.ri-first-aid-kit-fill:before{content:""}.ri-first-aid-kit-line:before{content:""}.ri-flag-2-fill:before{content:""}.ri-flag-2-line:before{content:""}.ri-flag-fill:before{content:""}.ri-flag-line:before{content:""}.ri-flashlight-fill:before{content:""}.ri-flashlight-line:before{content:""}.ri-flask-fill:before{content:""}.ri-flask-line:before{content:""}.ri-flight-land-fill:before{content:""}.ri-flight-land-line:before{content:""}.ri-flight-takeoff-fill:before{content:""}.ri-flight-takeoff-line:before{content:""}.ri-flood-fill:before{content:""}.ri-flood-line:before{content:""}.ri-flow-chart:before{content:""}.ri-flutter-fill:before{content:""}.ri-flutter-line:before{content:""}.ri-focus-2-fill:before{content:""}.ri-focus-2-line:before{content:""}.ri-focus-3-fill:before{content:""}.ri-focus-3-line:before{content:""}.ri-focus-fill:before{content:""}.ri-focus-line:before{content:""}.ri-foggy-fill:before{content:""}.ri-foggy-line:before{content:""}.ri-folder-2-fill:before{content:""}.ri-folder-2-line:before{content:""}.ri-folder-3-fill:before{content:""}.ri-folder-3-line:before{content:""}.ri-folder-4-fill:before{content:""}.ri-folder-4-line:before{content:""}.ri-folder-5-fill:before{content:""}.ri-folder-5-line:before{content:""}.ri-folder-add-fill:before{content:""}.ri-folder-add-line:before{content:""}.ri-folder-chart-2-fill:before{content:""}.ri-folder-chart-2-line:before{content:""}.ri-folder-chart-fill:before{content:""}.ri-folder-chart-line:before{content:""}.ri-folder-download-fill:before{content:""}.ri-folder-download-line:before{content:""}.ri-folder-fill:before{content:""}.ri-folder-forbid-fill:before{content:""}.ri-folder-forbid-line:before{content:""}.ri-folder-history-fill:before{content:""}.ri-folder-history-line:before{content:""}.ri-folder-info-fill:before{content:""}.ri-folder-info-line:before{content:""}.ri-folder-keyhole-fill:before{content:""}.ri-folder-keyhole-line:before{content:""}.ri-folder-line:before{content:""}.ri-folder-lock-fill:before{content:""}.ri-folder-lock-line:before{content:""}.ri-folder-music-fill:before{content:""}.ri-folder-music-line:before{content:""}.ri-folder-open-fill:before{content:""}.ri-folder-open-line:before{content:""}.ri-folder-received-fill:before{content:""}.ri-folder-received-line:before{content:""}.ri-folder-reduce-fill:before{content:""}.ri-folder-reduce-line:before{content:""}.ri-folder-settings-fill:before{content:""}.ri-folder-settings-line:before{content:""}.ri-folder-shared-fill:before{content:""}.ri-folder-shared-line:before{content:""}.ri-folder-shield-2-fill:before{content:""}.ri-folder-shield-2-line:before{content:""}.ri-folder-shield-fill:before{content:""}.ri-folder-shield-line:before{content:""}.ri-folder-transfer-fill:before{content:""}.ri-folder-transfer-line:before{content:""}.ri-folder-unknow-fill:before{content:""}.ri-folder-unknow-line:before{content:""}.ri-folder-upload-fill:before{content:""}.ri-folder-upload-line:before{content:""}.ri-folder-user-fill:before{content:""}.ri-folder-user-line:before{content:""}.ri-folder-warning-fill:before{content:""}.ri-folder-warning-line:before{content:""}.ri-folder-zip-fill:before{content:""}.ri-folder-zip-line:before{content:""}.ri-folders-fill:before{content:""}.ri-folders-line:before{content:""}.ri-font-color:before{content:""}.ri-font-size-2:before{content:""}.ri-font-size:before{content:""}.ri-football-fill:before{content:""}.ri-football-line:before{content:""}.ri-footprint-fill:before{content:""}.ri-footprint-line:before{content:""}.ri-forbid-2-fill:before{content:""}.ri-forbid-2-line:before{content:""}.ri-forbid-fill:before{content:""}.ri-forbid-line:before{content:""}.ri-format-clear:before{content:""}.ri-fridge-fill:before{content:""}.ri-fridge-line:before{content:""}.ri-fullscreen-exit-fill:before{content:""}.ri-fullscreen-exit-line:before{content:""}.ri-fullscreen-fill:before{content:""}.ri-fullscreen-line:before{content:""}.ri-function-fill:before{content:""}.ri-function-line:before{content:""}.ri-functions:before{content:""}.ri-funds-box-fill:before{content:""}.ri-funds-box-line:before{content:""}.ri-funds-fill:before{content:""}.ri-funds-line:before{content:""}.ri-gallery-fill:before{content:""}.ri-gallery-line:before{content:""}.ri-gallery-upload-fill:before{content:""}.ri-gallery-upload-line:before{content:""}.ri-game-fill:before{content:""}.ri-game-line:before{content:""}.ri-gamepad-fill:before{content:""}.ri-gamepad-line:before{content:""}.ri-gas-station-fill:before{content:""}.ri-gas-station-line:before{content:""}.ri-gatsby-fill:before{content:""}.ri-gatsby-line:before{content:""}.ri-genderless-fill:before{content:""}.ri-genderless-line:before{content:""}.ri-ghost-2-fill:before{content:""}.ri-ghost-2-line:before{content:""}.ri-ghost-fill:before{content:""}.ri-ghost-line:before{content:""}.ri-ghost-smile-fill:before{content:""}.ri-ghost-smile-line:before{content:""}.ri-gift-2-fill:before{content:""}.ri-gift-2-line:before{content:""}.ri-gift-fill:before{content:""}.ri-gift-line:before{content:""}.ri-git-branch-fill:before{content:""}.ri-git-branch-line:before{content:""}.ri-git-commit-fill:before{content:""}.ri-git-commit-line:before{content:""}.ri-git-merge-fill:before{content:""}.ri-git-merge-line:before{content:""}.ri-git-pull-request-fill:before{content:""}.ri-git-pull-request-line:before{content:""}.ri-git-repository-commits-fill:before{content:""}.ri-git-repository-commits-line:before{content:""}.ri-git-repository-fill:before{content:""}.ri-git-repository-line:before{content:""}.ri-git-repository-private-fill:before{content:""}.ri-git-repository-private-line:before{content:""}.ri-github-fill:before{content:""}.ri-github-line:before{content:""}.ri-gitlab-fill:before{content:""}.ri-gitlab-line:before{content:""}.ri-global-fill:before{content:""}.ri-global-line:before{content:""}.ri-globe-fill:before{content:""}.ri-globe-line:before{content:""}.ri-goblet-fill:before{content:""}.ri-goblet-line:before{content:""}.ri-google-fill:before{content:""}.ri-google-line:before{content:""}.ri-google-play-fill:before{content:""}.ri-google-play-line:before{content:""}.ri-government-fill:before{content:""}.ri-government-line:before{content:""}.ri-gps-fill:before{content:""}.ri-gps-line:before{content:""}.ri-gradienter-fill:before{content:""}.ri-gradienter-line:before{content:""}.ri-grid-fill:before{content:""}.ri-grid-line:before{content:""}.ri-group-2-fill:before{content:""}.ri-group-2-line:before{content:""}.ri-group-fill:before{content:""}.ri-group-line:before{content:""}.ri-guide-fill:before{content:""}.ri-guide-line:before{content:""}.ri-h-1:before{content:""}.ri-h-2:before{content:""}.ri-h-3:before{content:""}.ri-h-4:before{content:""}.ri-h-5:before{content:""}.ri-h-6:before{content:""}.ri-hail-fill:before{content:""}.ri-hail-line:before{content:""}.ri-hammer-fill:before{content:""}.ri-hammer-line:before{content:""}.ri-hand-coin-fill:before{content:""}.ri-hand-coin-line:before{content:""}.ri-hand-heart-fill:before{content:""}.ri-hand-heart-line:before{content:""}.ri-hand-sanitizer-fill:before{content:""}.ri-hand-sanitizer-line:before{content:""}.ri-handbag-fill:before{content:""}.ri-handbag-line:before{content:""}.ri-hard-drive-2-fill:before{content:""}.ri-hard-drive-2-line:before{content:""}.ri-hard-drive-fill:before{content:""}.ri-hard-drive-line:before{content:""}.ri-hashtag:before{content:""}.ri-haze-2-fill:before{content:""}.ri-haze-2-line:before{content:""}.ri-haze-fill:before{content:""}.ri-haze-line:before{content:""}.ri-hd-fill:before{content:""}.ri-hd-line:before{content:""}.ri-heading:before{content:""}.ri-headphone-fill:before{content:""}.ri-headphone-line:before{content:""}.ri-health-book-fill:before{content:""}.ri-health-book-line:before{content:""}.ri-heart-2-fill:before{content:""}.ri-heart-2-line:before{content:""}.ri-heart-3-fill:before{content:""}.ri-heart-3-line:before{content:""}.ri-heart-add-fill:before{content:""}.ri-heart-add-line:before{content:""}.ri-heart-fill:before{content:""}.ri-heart-line:before{content:""}.ri-heart-pulse-fill:before{content:""}.ri-heart-pulse-line:before{content:""}.ri-hearts-fill:before{content:""}.ri-hearts-line:before{content:""}.ri-heavy-showers-fill:before{content:""}.ri-heavy-showers-line:before{content:""}.ri-history-fill:before{content:""}.ri-history-line:before{content:""}.ri-home-2-fill:before{content:""}.ri-home-2-line:before{content:""}.ri-home-3-fill:before{content:""}.ri-home-3-line:before{content:""}.ri-home-4-fill:before{content:""}.ri-home-4-line:before{content:""}.ri-home-5-fill:before{content:""}.ri-home-5-line:before{content:""}.ri-home-6-fill:before{content:""}.ri-home-6-line:before{content:""}.ri-home-7-fill:before{content:""}.ri-home-7-line:before{content:""}.ri-home-8-fill:before{content:""}.ri-home-8-line:before{content:""}.ri-home-fill:before{content:""}.ri-home-gear-fill:before{content:""}.ri-home-gear-line:before{content:""}.ri-home-heart-fill:before{content:""}.ri-home-heart-line:before{content:""}.ri-home-line:before{content:""}.ri-home-smile-2-fill:before{content:""}.ri-home-smile-2-line:before{content:""}.ri-home-smile-fill:before{content:""}.ri-home-smile-line:before{content:""}.ri-home-wifi-fill:before{content:""}.ri-home-wifi-line:before{content:""}.ri-honor-of-kings-fill:before{content:""}.ri-honor-of-kings-line:before{content:""}.ri-honour-fill:before{content:""}.ri-honour-line:before{content:""}.ri-hospital-fill:before{content:""}.ri-hospital-line:before{content:""}.ri-hotel-bed-fill:before{content:""}.ri-hotel-bed-line:before{content:""}.ri-hotel-fill:before{content:""}.ri-hotel-line:before{content:""}.ri-hotspot-fill:before{content:""}.ri-hotspot-line:before{content:""}.ri-hq-fill:before{content:""}.ri-hq-line:before{content:""}.ri-html5-fill:before{content:""}.ri-html5-line:before{content:""}.ri-ie-fill:before{content:""}.ri-ie-line:before{content:""}.ri-image-2-fill:before{content:""}.ri-image-2-line:before{content:""}.ri-image-add-fill:before{content:""}.ri-image-add-line:before{content:""}.ri-image-edit-fill:before{content:""}.ri-image-edit-line:before{content:""}.ri-image-fill:before{content:""}.ri-image-line:before{content:""}.ri-inbox-archive-fill:before{content:""}.ri-inbox-archive-line:before{content:""}.ri-inbox-fill:before{content:""}.ri-inbox-line:before{content:""}.ri-inbox-unarchive-fill:before{content:""}.ri-inbox-unarchive-line:before{content:""}.ri-increase-decrease-fill:before{content:""}.ri-increase-decrease-line:before{content:""}.ri-indent-decrease:before{content:""}.ri-indent-increase:before{content:""}.ri-indeterminate-circle-fill:before{content:""}.ri-indeterminate-circle-line:before{content:""}.ri-information-fill:before{content:""}.ri-information-line:before{content:""}.ri-infrared-thermometer-fill:before{content:""}.ri-infrared-thermometer-line:before{content:""}.ri-ink-bottle-fill:before{content:""}.ri-ink-bottle-line:before{content:""}.ri-input-cursor-move:before{content:""}.ri-input-method-fill:before{content:""}.ri-input-method-line:before{content:""}.ri-insert-column-left:before{content:""}.ri-insert-column-right:before{content:""}.ri-insert-row-bottom:before{content:""}.ri-insert-row-top:before{content:""}.ri-instagram-fill:before{content:""}.ri-instagram-line:before{content:""}.ri-install-fill:before{content:""}.ri-install-line:before{content:""}.ri-invision-fill:before{content:""}.ri-invision-line:before{content:""}.ri-italic:before{content:""}.ri-kakao-talk-fill:before{content:""}.ri-kakao-talk-line:before{content:""}.ri-key-2-fill:before{content:""}.ri-key-2-line:before{content:""}.ri-key-fill:before{content:""}.ri-key-line:before{content:""}.ri-keyboard-box-fill:before{content:""}.ri-keyboard-box-line:before{content:""}.ri-keyboard-fill:before{content:""}.ri-keyboard-line:before{content:""}.ri-keynote-fill:before{content:""}.ri-keynote-line:before{content:""}.ri-knife-blood-fill:before{content:""}.ri-knife-blood-line:before{content:""}.ri-knife-fill:before{content:""}.ri-knife-line:before{content:""}.ri-landscape-fill:before{content:""}.ri-landscape-line:before{content:""}.ri-layout-2-fill:before{content:""}.ri-layout-2-line:before{content:""}.ri-layout-3-fill:before{content:""}.ri-layout-3-line:before{content:""}.ri-layout-4-fill:before{content:""}.ri-layout-4-line:before{content:""}.ri-layout-5-fill:before{content:""}.ri-layout-5-line:before{content:""}.ri-layout-6-fill:before{content:""}.ri-layout-6-line:before{content:""}.ri-layout-bottom-2-fill:before{content:""}.ri-layout-bottom-2-line:before{content:""}.ri-layout-bottom-fill:before{content:""}.ri-layout-bottom-line:before{content:""}.ri-layout-column-fill:before{content:""}.ri-layout-column-line:before{content:""}.ri-layout-fill:before{content:""}.ri-layout-grid-fill:before{content:""}.ri-layout-grid-line:before{content:""}.ri-layout-left-2-fill:before{content:""}.ri-layout-left-2-line:before{content:""}.ri-layout-left-fill:before{content:""}.ri-layout-left-line:before{content:""}.ri-layout-line:before{content:""}.ri-layout-masonry-fill:before{content:""}.ri-layout-masonry-line:before{content:""}.ri-layout-right-2-fill:before{content:""}.ri-layout-right-2-line:before{content:""}.ri-layout-right-fill:before{content:""}.ri-layout-right-line:before{content:""}.ri-layout-row-fill:before{content:""}.ri-layout-row-line:before{content:""}.ri-layout-top-2-fill:before{content:""}.ri-layout-top-2-line:before{content:""}.ri-layout-top-fill:before{content:""}.ri-layout-top-line:before{content:""}.ri-leaf-fill:before{content:""}.ri-leaf-line:before{content:""}.ri-lifebuoy-fill:before{content:""}.ri-lifebuoy-line:before{content:""}.ri-lightbulb-fill:before{content:""}.ri-lightbulb-flash-fill:before{content:""}.ri-lightbulb-flash-line:before{content:""}.ri-lightbulb-line:before{content:""}.ri-line-chart-fill:before{content:""}.ri-line-chart-line:before{content:""}.ri-line-fill:before{content:""}.ri-line-height:before{content:""}.ri-line-line:before{content:""}.ri-link-m:before{content:""}.ri-link-unlink-m:before{content:""}.ri-link-unlink:before{content:""}.ri-link:before{content:""}.ri-linkedin-box-fill:before{content:""}.ri-linkedin-box-line:before{content:""}.ri-linkedin-fill:before{content:""}.ri-linkedin-line:before{content:""}.ri-links-fill:before{content:""}.ri-links-line:before{content:""}.ri-list-check-2:before{content:""}.ri-list-check:before{content:""}.ri-list-ordered:before{content:""}.ri-list-settings-fill:before{content:""}.ri-list-settings-line:before{content:""}.ri-list-unordered:before{content:""}.ri-live-fill:before{content:""}.ri-live-line:before{content:""}.ri-loader-2-fill:before{content:""}.ri-loader-2-line:before{content:""}.ri-loader-3-fill:before{content:""}.ri-loader-3-line:before{content:""}.ri-loader-4-fill:before{content:""}.ri-loader-4-line:before{content:""}.ri-loader-5-fill:before{content:""}.ri-loader-5-line:before{content:""}.ri-loader-fill:before{content:""}.ri-loader-line:before{content:""}.ri-lock-2-fill:before{content:""}.ri-lock-2-line:before{content:""}.ri-lock-fill:before{content:""}.ri-lock-line:before{content:""}.ri-lock-password-fill:before{content:""}.ri-lock-password-line:before{content:""}.ri-lock-unlock-fill:before{content:""}.ri-lock-unlock-line:before{content:""}.ri-login-box-fill:before{content:""}.ri-login-box-line:before{content:""}.ri-login-circle-fill:before{content:""}.ri-login-circle-line:before{content:""}.ri-logout-box-fill:before{content:""}.ri-logout-box-line:before{content:""}.ri-logout-box-r-fill:before{content:""}.ri-logout-box-r-line:before{content:""}.ri-logout-circle-fill:before{content:""}.ri-logout-circle-line:before{content:""}.ri-logout-circle-r-fill:before{content:""}.ri-logout-circle-r-line:before{content:""}.ri-luggage-cart-fill:before{content:""}.ri-luggage-cart-line:before{content:""}.ri-luggage-deposit-fill:before{content:""}.ri-luggage-deposit-line:before{content:""}.ri-lungs-fill:before{content:""}.ri-lungs-line:before{content:""}.ri-mac-fill:before{content:""}.ri-mac-line:before{content:""}.ri-macbook-fill:before{content:""}.ri-macbook-line:before{content:""}.ri-magic-fill:before{content:""}.ri-magic-line:before{content:""}.ri-mail-add-fill:before{content:""}.ri-mail-add-line:before{content:""}.ri-mail-check-fill:before{content:""}.ri-mail-check-line:before{content:""}.ri-mail-close-fill:before{content:""}.ri-mail-close-line:before{content:""}.ri-mail-download-fill:before{content:""}.ri-mail-download-line:before{content:""}.ri-mail-fill:before{content:""}.ri-mail-forbid-fill:before{content:""}.ri-mail-forbid-line:before{content:""}.ri-mail-line:before{content:""}.ri-mail-lock-fill:before{content:""}.ri-mail-lock-line:before{content:""}.ri-mail-open-fill:before{content:""}.ri-mail-open-line:before{content:""}.ri-mail-send-fill:before{content:""}.ri-mail-send-line:before{content:""}.ri-mail-settings-fill:before{content:""}.ri-mail-settings-line:before{content:""}.ri-mail-star-fill:before{content:""}.ri-mail-star-line:before{content:""}.ri-mail-unread-fill:before{content:""}.ri-mail-unread-line:before{content:""}.ri-mail-volume-fill:before{content:""}.ri-mail-volume-line:before{content:""}.ri-map-2-fill:before{content:""}.ri-map-2-line:before{content:""}.ri-map-fill:before{content:""}.ri-map-line:before{content:""}.ri-map-pin-2-fill:before{content:""}.ri-map-pin-2-line:before{content:""}.ri-map-pin-3-fill:before{content:""}.ri-map-pin-3-line:before{content:""}.ri-map-pin-4-fill:before{content:""}.ri-map-pin-4-line:before{content:""}.ri-map-pin-5-fill:before{content:""}.ri-map-pin-5-line:before{content:""}.ri-map-pin-add-fill:before{content:""}.ri-map-pin-add-line:before{content:""}.ri-map-pin-fill:before{content:""}.ri-map-pin-line:before{content:""}.ri-map-pin-range-fill:before{content:""}.ri-map-pin-range-line:before{content:""}.ri-map-pin-time-fill:before{content:""}.ri-map-pin-time-line:before{content:""}.ri-map-pin-user-fill:before{content:""}.ri-map-pin-user-line:before{content:""}.ri-mark-pen-fill:before{content:""}.ri-mark-pen-line:before{content:""}.ri-markdown-fill:before{content:""}.ri-markdown-line:before{content:""}.ri-markup-fill:before{content:""}.ri-markup-line:before{content:""}.ri-mastercard-fill:before{content:""}.ri-mastercard-line:before{content:""}.ri-mastodon-fill:before{content:""}.ri-mastodon-line:before{content:""}.ri-medal-2-fill:before{content:""}.ri-medal-2-line:before{content:""}.ri-medal-fill:before{content:""}.ri-medal-line:before{content:""}.ri-medicine-bottle-fill:before{content:""}.ri-medicine-bottle-line:before{content:""}.ri-medium-fill:before{content:""}.ri-medium-line:before{content:""}.ri-men-fill:before{content:""}.ri-men-line:before{content:""}.ri-mental-health-fill:before{content:""}.ri-mental-health-line:before{content:""}.ri-menu-2-fill:before{content:""}.ri-menu-2-line:before{content:""}.ri-menu-3-fill:before{content:""}.ri-menu-3-line:before{content:""}.ri-menu-4-fill:before{content:""}.ri-menu-4-line:before{content:""}.ri-menu-5-fill:before{content:""}.ri-menu-5-line:before{content:""}.ri-menu-add-fill:before{content:""}.ri-menu-add-line:before{content:""}.ri-menu-fill:before{content:""}.ri-menu-fold-fill:before{content:""}.ri-menu-fold-line:before{content:""}.ri-menu-line:before{content:""}.ri-menu-unfold-fill:before{content:""}.ri-menu-unfold-line:before{content:""}.ri-merge-cells-horizontal:before{content:""}.ri-merge-cells-vertical:before{content:""}.ri-message-2-fill:before{content:""}.ri-message-2-line:before{content:""}.ri-message-3-fill:before{content:""}.ri-message-3-line:before{content:""}.ri-message-fill:before{content:""}.ri-message-line:before{content:""}.ri-messenger-fill:before{content:""}.ri-messenger-line:before{content:""}.ri-meteor-fill:before{content:""}.ri-meteor-line:before{content:""}.ri-mic-2-fill:before{content:""}.ri-mic-2-line:before{content:""}.ri-mic-fill:before{content:""}.ri-mic-line:before{content:""}.ri-mic-off-fill:before{content:""}.ri-mic-off-line:before{content:""}.ri-mickey-fill:before{content:""}.ri-mickey-line:before{content:""}.ri-microscope-fill:before{content:""}.ri-microscope-line:before{content:""}.ri-microsoft-fill:before{content:""}.ri-microsoft-line:before{content:""}.ri-mind-map:before{content:""}.ri-mini-program-fill:before{content:""}.ri-mini-program-line:before{content:""}.ri-mist-fill:before{content:""}.ri-mist-line:before{content:""}.ri-money-cny-box-fill:before{content:""}.ri-money-cny-box-line:before{content:""}.ri-money-cny-circle-fill:before{content:""}.ri-money-cny-circle-line:before{content:""}.ri-money-dollar-box-fill:before{content:""}.ri-money-dollar-box-line:before{content:""}.ri-money-dollar-circle-fill:before{content:""}.ri-money-dollar-circle-line:before{content:""}.ri-money-euro-box-fill:before{content:""}.ri-money-euro-box-line:before{content:""}.ri-money-euro-circle-fill:before{content:""}.ri-money-euro-circle-line:before{content:""}.ri-money-pound-box-fill:before{content:""}.ri-money-pound-box-line:before{content:""}.ri-money-pound-circle-fill:before{content:""}.ri-money-pound-circle-line:before{content:""}.ri-moon-clear-fill:before{content:""}.ri-moon-clear-line:before{content:""}.ri-moon-cloudy-fill:before{content:""}.ri-moon-cloudy-line:before{content:""}.ri-moon-fill:before{content:""}.ri-moon-foggy-fill:before{content:""}.ri-moon-foggy-line:before{content:""}.ri-moon-line:before{content:""}.ri-more-2-fill:before{content:""}.ri-more-2-line:before{content:""}.ri-more-fill:before{content:""}.ri-more-line:before{content:""}.ri-motorbike-fill:before{content:""}.ri-motorbike-line:before{content:""}.ri-mouse-fill:before{content:""}.ri-mouse-line:before{content:""}.ri-movie-2-fill:before{content:""}.ri-movie-2-line:before{content:""}.ri-movie-fill:before{content:""}.ri-movie-line:before{content:""}.ri-music-2-fill:before{content:""}.ri-music-2-line:before{content:""}.ri-music-fill:before{content:""}.ri-music-line:before{content:""}.ri-mv-fill:before{content:""}.ri-mv-line:before{content:""}.ri-navigation-fill:before{content:""}.ri-navigation-line:before{content:""}.ri-netease-cloud-music-fill:before{content:""}.ri-netease-cloud-music-line:before{content:""}.ri-netflix-fill:before{content:""}.ri-netflix-line:before{content:""}.ri-newspaper-fill:before{content:""}.ri-newspaper-line:before{content:""}.ri-node-tree:before{content:""}.ri-notification-2-fill:before{content:""}.ri-notification-2-line:before{content:""}.ri-notification-3-fill:before{content:""}.ri-notification-3-line:before{content:""}.ri-notification-4-fill:before{content:""}.ri-notification-4-line:before{content:""}.ri-notification-badge-fill:before{content:""}.ri-notification-badge-line:before{content:""}.ri-notification-fill:before{content:""}.ri-notification-line:before{content:""}.ri-notification-off-fill:before{content:""}.ri-notification-off-line:before{content:""}.ri-npmjs-fill:before{content:""}.ri-npmjs-line:before{content:""}.ri-number-0:before{content:""}.ri-number-1:before{content:""}.ri-number-2:before{content:""}.ri-number-3:before{content:""}.ri-number-4:before{content:""}.ri-number-5:before{content:""}.ri-number-6:before{content:""}.ri-number-7:before{content:""}.ri-number-8:before{content:""}.ri-number-9:before{content:""}.ri-numbers-fill:before{content:""}.ri-numbers-line:before{content:""}.ri-nurse-fill:before{content:""}.ri-nurse-line:before{content:""}.ri-oil-fill:before{content:""}.ri-oil-line:before{content:""}.ri-omega:before{content:""}.ri-open-arm-fill:before{content:""}.ri-open-arm-line:before{content:""}.ri-open-source-fill:before{content:""}.ri-open-source-line:before{content:""}.ri-opera-fill:before{content:""}.ri-opera-line:before{content:""}.ri-order-play-fill:before{content:""}.ri-order-play-line:before{content:""}.ri-organization-chart:before{content:""}.ri-outlet-2-fill:before{content:""}.ri-outlet-2-line:before{content:""}.ri-outlet-fill:before{content:""}.ri-outlet-line:before{content:""}.ri-page-separator:before{content:""}.ri-pages-fill:before{content:""}.ri-pages-line:before{content:""}.ri-paint-brush-fill:before{content:""}.ri-paint-brush-line:before{content:""}.ri-paint-fill:before{content:""}.ri-paint-line:before{content:""}.ri-palette-fill:before{content:""}.ri-palette-line:before{content:""}.ri-pantone-fill:before{content:""}.ri-pantone-line:before{content:""}.ri-paragraph:before{content:""}.ri-parent-fill:before{content:""}.ri-parent-line:before{content:""}.ri-parentheses-fill:before{content:""}.ri-parentheses-line:before{content:""}.ri-parking-box-fill:before{content:""}.ri-parking-box-line:before{content:""}.ri-parking-fill:before{content:""}.ri-parking-line:before{content:""}.ri-passport-fill:before{content:""}.ri-passport-line:before{content:""}.ri-patreon-fill:before{content:""}.ri-patreon-line:before{content:""}.ri-pause-circle-fill:before{content:""}.ri-pause-circle-line:before{content:""}.ri-pause-fill:before{content:""}.ri-pause-line:before{content:""}.ri-pause-mini-fill:before{content:""}.ri-pause-mini-line:before{content:""}.ri-paypal-fill:before{content:""}.ri-paypal-line:before{content:""}.ri-pen-nib-fill:before{content:""}.ri-pen-nib-line:before{content:""}.ri-pencil-fill:before{content:""}.ri-pencil-line:before{content:""}.ri-pencil-ruler-2-fill:before{content:""}.ri-pencil-ruler-2-line:before{content:""}.ri-pencil-ruler-fill:before{content:""}.ri-pencil-ruler-line:before{content:""}.ri-percent-fill:before{content:""}.ri-percent-line:before{content:""}.ri-phone-camera-fill:before{content:""}.ri-phone-camera-line:before{content:""}.ri-phone-fill:before{content:""}.ri-phone-find-fill:before{content:""}.ri-phone-find-line:before{content:""}.ri-phone-line:before{content:""}.ri-phone-lock-fill:before{content:""}.ri-phone-lock-line:before{content:""}.ri-picture-in-picture-2-fill:before{content:""}.ri-picture-in-picture-2-line:before{content:""}.ri-picture-in-picture-exit-fill:before{content:""}.ri-picture-in-picture-exit-line:before{content:""}.ri-picture-in-picture-fill:before{content:""}.ri-picture-in-picture-line:before{content:""}.ri-pie-chart-2-fill:before{content:""}.ri-pie-chart-2-line:before{content:""}.ri-pie-chart-box-fill:before{content:""}.ri-pie-chart-box-line:before{content:""}.ri-pie-chart-fill:before{content:""}.ri-pie-chart-line:before{content:""}.ri-pin-distance-fill:before{content:""}.ri-pin-distance-line:before{content:""}.ri-ping-pong-fill:before{content:""}.ri-ping-pong-line:before{content:""}.ri-pinterest-fill:before{content:""}.ri-pinterest-line:before{content:""}.ri-pinyin-input:before{content:""}.ri-pixelfed-fill:before{content:""}.ri-pixelfed-line:before{content:""}.ri-plane-fill:before{content:""}.ri-plane-line:before{content:""}.ri-plant-fill:before{content:""}.ri-plant-line:before{content:""}.ri-play-circle-fill:before{content:""}.ri-play-circle-line:before{content:""}.ri-play-fill:before{content:""}.ri-play-line:before{content:""}.ri-play-list-2-fill:before{content:""}.ri-play-list-2-line:before{content:""}.ri-play-list-add-fill:before{content:""}.ri-play-list-add-line:before{content:""}.ri-play-list-fill:before{content:""}.ri-play-list-line:before{content:""}.ri-play-mini-fill:before{content:""}.ri-play-mini-line:before{content:""}.ri-playstation-fill:before{content:""}.ri-playstation-line:before{content:""}.ri-plug-2-fill:before{content:""}.ri-plug-2-line:before{content:""}.ri-plug-fill:before{content:""}.ri-plug-line:before{content:""}.ri-polaroid-2-fill:before{content:""}.ri-polaroid-2-line:before{content:""}.ri-polaroid-fill:before{content:""}.ri-polaroid-line:before{content:""}.ri-police-car-fill:before{content:""}.ri-police-car-line:before{content:""}.ri-price-tag-2-fill:before{content:""}.ri-price-tag-2-line:before{content:""}.ri-price-tag-3-fill:before{content:""}.ri-price-tag-3-line:before{content:""}.ri-price-tag-fill:before{content:""}.ri-price-tag-line:before{content:""}.ri-printer-cloud-fill:before{content:""}.ri-printer-cloud-line:before{content:""}.ri-printer-fill:before{content:""}.ri-printer-line:before{content:""}.ri-product-hunt-fill:before{content:""}.ri-product-hunt-line:before{content:""}.ri-profile-fill:before{content:""}.ri-profile-line:before{content:""}.ri-projector-2-fill:before{content:""}.ri-projector-2-line:before{content:""}.ri-projector-fill:before{content:""}.ri-projector-line:before{content:""}.ri-psychotherapy-fill:before{content:""}.ri-psychotherapy-line:before{content:""}.ri-pulse-fill:before{content:""}.ri-pulse-line:before{content:""}.ri-pushpin-2-fill:before{content:""}.ri-pushpin-2-line:before{content:""}.ri-pushpin-fill:before{content:""}.ri-pushpin-line:before{content:""}.ri-qq-fill:before{content:""}.ri-qq-line:before{content:""}.ri-qr-code-fill:before{content:""}.ri-qr-code-line:before{content:""}.ri-qr-scan-2-fill:before{content:""}.ri-qr-scan-2-line:before{content:""}.ri-qr-scan-fill:before{content:""}.ri-qr-scan-line:before{content:""}.ri-question-answer-fill:before{content:""}.ri-question-answer-line:before{content:""}.ri-question-fill:before{content:""}.ri-question-line:before{content:""}.ri-question-mark:before{content:""}.ri-questionnaire-fill:before{content:""}.ri-questionnaire-line:before{content:""}.ri-quill-pen-fill:before{content:""}.ri-quill-pen-line:before{content:""}.ri-radar-fill:before{content:""}.ri-radar-line:before{content:""}.ri-radio-2-fill:before{content:""}.ri-radio-2-line:before{content:""}.ri-radio-button-fill:before{content:""}.ri-radio-button-line:before{content:""}.ri-radio-fill:before{content:""}.ri-radio-line:before{content:""}.ri-rainbow-fill:before{content:""}.ri-rainbow-line:before{content:""}.ri-rainy-fill:before{content:""}.ri-rainy-line:before{content:""}.ri-reactjs-fill:before{content:""}.ri-reactjs-line:before{content:""}.ri-record-circle-fill:before{content:""}.ri-record-circle-line:before{content:""}.ri-record-mail-fill:before{content:""}.ri-record-mail-line:before{content:""}.ri-recycle-fill:before{content:""}.ri-recycle-line:before{content:""}.ri-red-packet-fill:before{content:""}.ri-red-packet-line:before{content:""}.ri-reddit-fill:before{content:""}.ri-reddit-line:before{content:""}.ri-refresh-fill:before{content:""}.ri-refresh-line:before{content:""}.ri-refund-2-fill:before{content:""}.ri-refund-2-line:before{content:""}.ri-refund-fill:before{content:""}.ri-refund-line:before{content:""}.ri-registered-fill:before{content:""}.ri-registered-line:before{content:""}.ri-remixicon-fill:before{content:""}.ri-remixicon-line:before{content:""}.ri-remote-control-2-fill:before{content:""}.ri-remote-control-2-line:before{content:""}.ri-remote-control-fill:before{content:""}.ri-remote-control-line:before{content:""}.ri-repeat-2-fill:before{content:""}.ri-repeat-2-line:before{content:""}.ri-repeat-fill:before{content:""}.ri-repeat-line:before{content:""}.ri-repeat-one-fill:before{content:""}.ri-repeat-one-line:before{content:""}.ri-reply-all-fill:before{content:""}.ri-reply-all-line:before{content:""}.ri-reply-fill:before{content:""}.ri-reply-line:before{content:""}.ri-reserved-fill:before{content:""}.ri-reserved-line:before{content:""}.ri-rest-time-fill:before{content:""}.ri-rest-time-line:before{content:""}.ri-restart-fill:before{content:""}.ri-restart-line:before{content:""}.ri-restaurant-2-fill:before{content:""}.ri-restaurant-2-line:before{content:""}.ri-restaurant-fill:before{content:""}.ri-restaurant-line:before{content:""}.ri-rewind-fill:before{content:""}.ri-rewind-line:before{content:""}.ri-rewind-mini-fill:before{content:""}.ri-rewind-mini-line:before{content:""}.ri-rhythm-fill:before{content:""}.ri-rhythm-line:before{content:""}.ri-riding-fill:before{content:""}.ri-riding-line:before{content:""}.ri-road-map-fill:before{content:""}.ri-road-map-line:before{content:""}.ri-roadster-fill:before{content:""}.ri-roadster-line:before{content:""}.ri-robot-fill:before{content:""}.ri-robot-line:before{content:""}.ri-rocket-2-fill:before{content:""}.ri-rocket-2-line:before{content:""}.ri-rocket-fill:before{content:""}.ri-rocket-line:before{content:""}.ri-rotate-lock-fill:before{content:""}.ri-rotate-lock-line:before{content:""}.ri-rounded-corner:before{content:""}.ri-route-fill:before{content:""}.ri-route-line:before{content:""}.ri-router-fill:before{content:""}.ri-router-line:before{content:""}.ri-rss-fill:before{content:""}.ri-rss-line:before{content:""}.ri-ruler-2-fill:before{content:""}.ri-ruler-2-line:before{content:""}.ri-ruler-fill:before{content:""}.ri-ruler-line:before{content:""}.ri-run-fill:before{content:""}.ri-run-line:before{content:""}.ri-safari-fill:before{content:""}.ri-safari-line:before{content:""}.ri-safe-2-fill:before{content:""}.ri-safe-2-line:before{content:""}.ri-safe-fill:before{content:""}.ri-safe-line:before{content:""}.ri-sailboat-fill:before{content:""}.ri-sailboat-line:before{content:""}.ri-save-2-fill:before{content:""}.ri-save-2-line:before{content:""}.ri-save-3-fill:before{content:""}.ri-save-3-line:before{content:""}.ri-save-fill:before{content:""}.ri-save-line:before{content:""}.ri-scales-2-fill:before{content:""}.ri-scales-2-line:before{content:""}.ri-scales-3-fill:before{content:""}.ri-scales-3-line:before{content:""}.ri-scales-fill:before{content:""}.ri-scales-line:before{content:""}.ri-scan-2-fill:before{content:""}.ri-scan-2-line:before{content:""}.ri-scan-fill:before{content:""}.ri-scan-line:before{content:""}.ri-scissors-2-fill:before{content:""}.ri-scissors-2-line:before{content:""}.ri-scissors-cut-fill:before{content:""}.ri-scissors-cut-line:before{content:""}.ri-scissors-fill:before{content:""}.ri-scissors-line:before{content:""}.ri-screenshot-2-fill:before{content:""}.ri-screenshot-2-line:before{content:""}.ri-screenshot-fill:before{content:""}.ri-screenshot-line:before{content:""}.ri-sd-card-fill:before{content:""}.ri-sd-card-line:before{content:""}.ri-sd-card-mini-fill:before{content:""}.ri-sd-card-mini-line:before{content:""}.ri-search-2-fill:before{content:""}.ri-search-2-line:before{content:""}.ri-search-eye-fill:before{content:""}.ri-search-eye-line:before{content:""}.ri-search-fill:before{content:""}.ri-search-line:before{content:""}.ri-secure-payment-fill:before{content:""}.ri-secure-payment-line:before{content:""}.ri-seedling-fill:before{content:""}.ri-seedling-line:before{content:""}.ri-send-backward:before{content:""}.ri-send-plane-2-fill:before{content:""}.ri-send-plane-2-line:before{content:""}.ri-send-plane-fill:before{content:""}.ri-send-plane-line:before{content:""}.ri-send-to-back:before{content:""}.ri-sensor-fill:before{content:""}.ri-sensor-line:before{content:""}.ri-separator:before{content:""}.ri-server-fill:before{content:""}.ri-server-line:before{content:""}.ri-service-fill:before{content:""}.ri-service-line:before{content:""}.ri-settings-2-fill:before{content:""}.ri-settings-2-line:before{content:""}.ri-settings-3-fill:before{content:""}.ri-settings-3-line:before{content:""}.ri-settings-4-fill:before{content:""}.ri-settings-4-line:before{content:""}.ri-settings-5-fill:before{content:""}.ri-settings-5-line:before{content:""}.ri-settings-6-fill:before{content:""}.ri-settings-6-line:before{content:""}.ri-settings-fill:before{content:""}.ri-settings-line:before{content:""}.ri-shape-2-fill:before{content:""}.ri-shape-2-line:before{content:""}.ri-shape-fill:before{content:""}.ri-shape-line:before{content:""}.ri-share-box-fill:before{content:""}.ri-share-box-line:before{content:""}.ri-share-circle-fill:before{content:""}.ri-share-circle-line:before{content:""}.ri-share-fill:before{content:""}.ri-share-forward-2-fill:before{content:""}.ri-share-forward-2-line:before{content:""}.ri-share-forward-box-fill:before{content:""}.ri-share-forward-box-line:before{content:""}.ri-share-forward-fill:before{content:""}.ri-share-forward-line:before{content:""}.ri-share-line:before{content:""}.ri-shield-check-fill:before{content:""}.ri-shield-check-line:before{content:""}.ri-shield-cross-fill:before{content:""}.ri-shield-cross-line:before{content:""}.ri-shield-fill:before{content:""}.ri-shield-flash-fill:before{content:""}.ri-shield-flash-line:before{content:""}.ri-shield-keyhole-fill:before{content:""}.ri-shield-keyhole-line:before{content:""}.ri-shield-line:before{content:""}.ri-shield-star-fill:before{content:""}.ri-shield-star-line:before{content:""}.ri-shield-user-fill:before{content:""}.ri-shield-user-line:before{content:""}.ri-ship-2-fill:before{content:""}.ri-ship-2-line:before{content:""}.ri-ship-fill:before{content:""}.ri-ship-line:before{content:""}.ri-shirt-fill:before{content:""}.ri-shirt-line:before{content:""}.ri-shopping-bag-2-fill:before{content:""}.ri-shopping-bag-2-line:before{content:""}.ri-shopping-bag-3-fill:before{content:""}.ri-shopping-bag-3-line:before{content:""}.ri-shopping-bag-fill:before{content:""}.ri-shopping-bag-line:before{content:""}.ri-shopping-basket-2-fill:before{content:""}.ri-shopping-basket-2-line:before{content:""}.ri-shopping-basket-fill:before{content:""}.ri-shopping-basket-line:before{content:""}.ri-shopping-cart-2-fill:before{content:""}.ri-shopping-cart-2-line:before{content:""}.ri-shopping-cart-fill:before{content:""}.ri-shopping-cart-line:before{content:""}.ri-showers-fill:before{content:""}.ri-showers-line:before{content:""}.ri-shuffle-fill:before{content:""}.ri-shuffle-line:before{content:""}.ri-shut-down-fill:before{content:""}.ri-shut-down-line:before{content:""}.ri-side-bar-fill:before{content:""}.ri-side-bar-line:before{content:""}.ri-signal-tower-fill:before{content:""}.ri-signal-tower-line:before{content:""}.ri-signal-wifi-1-fill:before{content:""}.ri-signal-wifi-1-line:before{content:""}.ri-signal-wifi-2-fill:before{content:""}.ri-signal-wifi-2-line:before{content:""}.ri-signal-wifi-3-fill:before{content:""}.ri-signal-wifi-3-line:before{content:""}.ri-signal-wifi-error-fill:before{content:""}.ri-signal-wifi-error-line:before{content:""}.ri-signal-wifi-fill:before{content:""}.ri-signal-wifi-line:before{content:""}.ri-signal-wifi-off-fill:before{content:""}.ri-signal-wifi-off-line:before{content:""}.ri-sim-card-2-fill:before{content:""}.ri-sim-card-2-line:before{content:""}.ri-sim-card-fill:before{content:""}.ri-sim-card-line:before{content:""}.ri-single-quotes-l:before{content:""}.ri-single-quotes-r:before{content:""}.ri-sip-fill:before{content:""}.ri-sip-line:before{content:""}.ri-skip-back-fill:before{content:""}.ri-skip-back-line:before{content:""}.ri-skip-back-mini-fill:before{content:""}.ri-skip-back-mini-line:before{content:""}.ri-skip-forward-fill:before{content:""}.ri-skip-forward-line:before{content:""}.ri-skip-forward-mini-fill:before{content:""}.ri-skip-forward-mini-line:before{content:""}.ri-skull-2-fill:before{content:""}.ri-skull-2-line:before{content:""}.ri-skull-fill:before{content:""}.ri-skull-line:before{content:""}.ri-skype-fill:before{content:""}.ri-skype-line:before{content:""}.ri-slack-fill:before{content:""}.ri-slack-line:before{content:""}.ri-slice-fill:before{content:""}.ri-slice-line:before{content:""}.ri-slideshow-2-fill:before{content:""}.ri-slideshow-2-line:before{content:""}.ri-slideshow-3-fill:before{content:""}.ri-slideshow-3-line:before{content:""}.ri-slideshow-4-fill:before{content:""}.ri-slideshow-4-line:before{content:""}.ri-slideshow-fill:before{content:""}.ri-slideshow-line:before{content:""}.ri-smartphone-fill:before{content:""}.ri-smartphone-line:before{content:""}.ri-snapchat-fill:before{content:""}.ri-snapchat-line:before{content:""}.ri-snowy-fill:before{content:""}.ri-snowy-line:before{content:""}.ri-sort-asc:before{content:""}.ri-sort-desc:before{content:""}.ri-sound-module-fill:before{content:""}.ri-sound-module-line:before{content:""}.ri-soundcloud-fill:before{content:""}.ri-soundcloud-line:before{content:""}.ri-space-ship-fill:before{content:""}.ri-space-ship-line:before{content:""}.ri-space:before{content:""}.ri-spam-2-fill:before{content:""}.ri-spam-2-line:before{content:""}.ri-spam-3-fill:before{content:""}.ri-spam-3-line:before{content:""}.ri-spam-fill:before{content:""}.ri-spam-line:before{content:""}.ri-speaker-2-fill:before{content:""}.ri-speaker-2-line:before{content:""}.ri-speaker-3-fill:before{content:""}.ri-speaker-3-line:before{content:""}.ri-speaker-fill:before{content:""}.ri-speaker-line:before{content:""}.ri-spectrum-fill:before{content:""}.ri-spectrum-line:before{content:""}.ri-speed-fill:before{content:""}.ri-speed-line:before{content:""}.ri-speed-mini-fill:before{content:""}.ri-speed-mini-line:before{content:""}.ri-split-cells-horizontal:before{content:""}.ri-split-cells-vertical:before{content:""}.ri-spotify-fill:before{content:""}.ri-spotify-line:before{content:""}.ri-spy-fill:before{content:""}.ri-spy-line:before{content:""}.ri-stack-fill:before{content:""}.ri-stack-line:before{content:""}.ri-stack-overflow-fill:before{content:""}.ri-stack-overflow-line:before{content:""}.ri-stackshare-fill:before{content:""}.ri-stackshare-line:before{content:""}.ri-star-fill:before{content:""}.ri-star-half-fill:before{content:""}.ri-star-half-line:before{content:""}.ri-star-half-s-fill:before{content:""}.ri-star-half-s-line:before{content:""}.ri-star-line:before{content:""}.ri-star-s-fill:before{content:""}.ri-star-s-line:before{content:""}.ri-star-smile-fill:before{content:""}.ri-star-smile-line:before{content:""}.ri-steam-fill:before{content:""}.ri-steam-line:before{content:""}.ri-steering-2-fill:before{content:""}.ri-steering-2-line:before{content:""}.ri-steering-fill:before{content:""}.ri-steering-line:before{content:""}.ri-stethoscope-fill:before{content:""}.ri-stethoscope-line:before{content:""}.ri-sticky-note-2-fill:before{content:""}.ri-sticky-note-2-line:before{content:""}.ri-sticky-note-fill:before{content:""}.ri-sticky-note-line:before{content:""}.ri-stock-fill:before{content:""}.ri-stock-line:before{content:""}.ri-stop-circle-fill:before{content:""}.ri-stop-circle-line:before{content:""}.ri-stop-fill:before{content:""}.ri-stop-line:before{content:""}.ri-stop-mini-fill:before{content:""}.ri-stop-mini-line:before{content:""}.ri-store-2-fill:before{content:""}.ri-store-2-line:before{content:""}.ri-store-3-fill:before{content:""}.ri-store-3-line:before{content:""}.ri-store-fill:before{content:""}.ri-store-line:before{content:""}.ri-strikethrough-2:before{content:""}.ri-strikethrough:before{content:""}.ri-subscript-2:before{content:""}.ri-subscript:before{content:""}.ri-subtract-fill:before{content:""}.ri-subtract-line:before{content:""}.ri-subway-fill:before{content:""}.ri-subway-line:before{content:""}.ri-subway-wifi-fill:before{content:""}.ri-subway-wifi-line:before{content:""}.ri-suitcase-2-fill:before{content:""}.ri-suitcase-2-line:before{content:""}.ri-suitcase-3-fill:before{content:""}.ri-suitcase-3-line:before{content:""}.ri-suitcase-fill:before{content:""}.ri-suitcase-line:before{content:""}.ri-sun-cloudy-fill:before{content:""}.ri-sun-cloudy-line:before{content:""}.ri-sun-fill:before{content:""}.ri-sun-foggy-fill:before{content:""}.ri-sun-foggy-line:before{content:""}.ri-sun-line:before{content:""}.ri-superscript-2:before{content:""}.ri-superscript:before{content:""}.ri-surgical-mask-fill:before{content:""}.ri-surgical-mask-line:before{content:""}.ri-surround-sound-fill:before{content:""}.ri-surround-sound-line:before{content:""}.ri-survey-fill:before{content:""}.ri-survey-line:before{content:""}.ri-swap-box-fill:before{content:""}.ri-swap-box-line:before{content:""}.ri-swap-fill:before{content:""}.ri-swap-line:before{content:""}.ri-switch-fill:before{content:""}.ri-switch-line:before{content:""}.ri-sword-fill:before{content:""}.ri-sword-line:before{content:""}.ri-syringe-fill:before{content:""}.ri-syringe-line:before{content:""}.ri-t-box-fill:before{content:""}.ri-t-box-line:before{content:""}.ri-t-shirt-2-fill:before{content:""}.ri-t-shirt-2-line:before{content:""}.ri-t-shirt-air-fill:before{content:""}.ri-t-shirt-air-line:before{content:""}.ri-t-shirt-fill:before{content:""}.ri-t-shirt-line:before{content:""}.ri-table-2:before{content:""}.ri-table-alt-fill:before{content:""}.ri-table-alt-line:before{content:""}.ri-table-fill:before{content:""}.ri-table-line:before{content:""}.ri-tablet-fill:before{content:""}.ri-tablet-line:before{content:""}.ri-takeaway-fill:before{content:""}.ri-takeaway-line:before{content:""}.ri-taobao-fill:before{content:""}.ri-taobao-line:before{content:""}.ri-tape-fill:before{content:""}.ri-tape-line:before{content:""}.ri-task-fill:before{content:""}.ri-task-line:before{content:""}.ri-taxi-fill:before{content:""}.ri-taxi-line:before{content:""}.ri-taxi-wifi-fill:before{content:""}.ri-taxi-wifi-line:before{content:""}.ri-team-fill:before{content:""}.ri-team-line:before{content:""}.ri-telegram-fill:before{content:""}.ri-telegram-line:before{content:""}.ri-temp-cold-fill:before{content:""}.ri-temp-cold-line:before{content:""}.ri-temp-hot-fill:before{content:""}.ri-temp-hot-line:before{content:""}.ri-terminal-box-fill:before{content:""}.ri-terminal-box-line:before{content:""}.ri-terminal-fill:before{content:""}.ri-terminal-line:before{content:""}.ri-terminal-window-fill:before{content:""}.ri-terminal-window-line:before{content:""}.ri-test-tube-fill:before{content:""}.ri-test-tube-line:before{content:""}.ri-text-direction-l:before{content:""}.ri-text-direction-r:before{content:""}.ri-text-spacing:before{content:""}.ri-text-wrap:before{content:""}.ri-text:before{content:""}.ri-thermometer-fill:before{content:""}.ri-thermometer-line:before{content:""}.ri-thumb-down-fill:before{content:""}.ri-thumb-down-line:before{content:""}.ri-thumb-up-fill:before{content:""}.ri-thumb-up-line:before{content:""}.ri-thunderstorms-fill:before{content:""}.ri-thunderstorms-line:before{content:""}.ri-ticket-2-fill:before{content:""}.ri-ticket-2-line:before{content:""}.ri-ticket-fill:before{content:""}.ri-ticket-line:before{content:""}.ri-time-fill:before{content:""}.ri-time-line:before{content:""}.ri-timer-2-fill:before{content:""}.ri-timer-2-line:before{content:""}.ri-timer-fill:before{content:""}.ri-timer-flash-fill:before{content:""}.ri-timer-flash-line:before{content:""}.ri-timer-line:before{content:""}.ri-todo-fill:before{content:""}.ri-todo-line:before{content:""}.ri-toggle-fill:before{content:""}.ri-toggle-line:before{content:""}.ri-tools-fill:before{content:""}.ri-tools-line:before{content:""}.ri-tornado-fill:before{content:""}.ri-tornado-line:before{content:""}.ri-trademark-fill:before{content:""}.ri-trademark-line:before{content:""}.ri-traffic-light-fill:before{content:""}.ri-traffic-light-line:before{content:""}.ri-train-fill:before{content:""}.ri-train-line:before{content:""}.ri-train-wifi-fill:before{content:""}.ri-train-wifi-line:before{content:""}.ri-translate-2:before{content:""}.ri-translate:before{content:""}.ri-travesti-fill:before{content:""}.ri-travesti-line:before{content:""}.ri-treasure-map-fill:before{content:""}.ri-treasure-map-line:before{content:""}.ri-trello-fill:before{content:""}.ri-trello-line:before{content:""}.ri-trophy-fill:before{content:""}.ri-trophy-line:before{content:""}.ri-truck-fill:before{content:""}.ri-truck-line:before{content:""}.ri-tumblr-fill:before{content:""}.ri-tumblr-line:before{content:""}.ri-tv-2-fill:before{content:""}.ri-tv-2-line:before{content:""}.ri-tv-fill:before{content:""}.ri-tv-line:before{content:""}.ri-twitch-fill:before{content:""}.ri-twitch-line:before{content:""}.ri-twitter-fill:before{content:""}.ri-twitter-line:before{content:""}.ri-typhoon-fill:before{content:""}.ri-typhoon-line:before{content:""}.ri-u-disk-fill:before{content:""}.ri-u-disk-line:before{content:""}.ri-ubuntu-fill:before{content:""}.ri-ubuntu-line:before{content:""}.ri-umbrella-fill:before{content:""}.ri-umbrella-line:before{content:""}.ri-underline:before{content:""}.ri-uninstall-fill:before{content:""}.ri-uninstall-line:before{content:""}.ri-unsplash-fill:before{content:""}.ri-unsplash-line:before{content:""}.ri-upload-2-fill:before{content:""}.ri-upload-2-line:before{content:""}.ri-upload-cloud-2-fill:before{content:""}.ri-upload-cloud-2-line:before{content:""}.ri-upload-cloud-fill:before{content:""}.ri-upload-cloud-line:before{content:""}.ri-upload-fill:before{content:""}.ri-upload-line:before{content:""}.ri-usb-fill:before{content:""}.ri-usb-line:before{content:""}.ri-user-2-fill:before{content:""}.ri-user-2-line:before{content:""}.ri-user-3-fill:before{content:""}.ri-user-3-line:before{content:""}.ri-user-4-fill:before{content:""}.ri-user-4-line:before{content:""}.ri-user-5-fill:before{content:""}.ri-user-5-line:before{content:""}.ri-user-6-fill:before{content:""}.ri-user-6-line:before{content:""}.ri-user-add-fill:before{content:""}.ri-user-add-line:before{content:""}.ri-user-fill:before{content:""}.ri-user-follow-fill:before{content:""}.ri-user-follow-line:before{content:""}.ri-user-heart-fill:before{content:""}.ri-user-heart-line:before{content:""}.ri-user-line:before{content:""}.ri-user-location-fill:before{content:""}.ri-user-location-line:before{content:""}.ri-user-received-2-fill:before{content:""}.ri-user-received-2-line:before{content:""}.ri-user-received-fill:before{content:""}.ri-user-received-line:before{content:""}.ri-user-search-fill:before{content:""}.ri-user-search-line:before{content:""}.ri-user-settings-fill:before{content:""}.ri-user-settings-line:before{content:""}.ri-user-shared-2-fill:before{content:""}.ri-user-shared-2-line:before{content:""}.ri-user-shared-fill:before{content:""}.ri-user-shared-line:before{content:""}.ri-user-smile-fill:before{content:""}.ri-user-smile-line:before{content:""}.ri-user-star-fill:before{content:""}.ri-user-star-line:before{content:""}.ri-user-unfollow-fill:before{content:""}.ri-user-unfollow-line:before{content:""}.ri-user-voice-fill:before{content:""}.ri-user-voice-line:before{content:""}.ri-video-add-fill:before{content:""}.ri-video-add-line:before{content:""}.ri-video-chat-fill:before{content:""}.ri-video-chat-line:before{content:""}.ri-video-download-fill:before{content:""}.ri-video-download-line:before{content:""}.ri-video-fill:before{content:""}.ri-video-line:before{content:""}.ri-video-upload-fill:before{content:""}.ri-video-upload-line:before{content:""}.ri-vidicon-2-fill:before{content:""}.ri-vidicon-2-line:before{content:""}.ri-vidicon-fill:before{content:""}.ri-vidicon-line:before{content:""}.ri-vimeo-fill:before{content:""}.ri-vimeo-line:before{content:""}.ri-vip-crown-2-fill:before{content:""}.ri-vip-crown-2-line:before{content:""}.ri-vip-crown-fill:before{content:""}.ri-vip-crown-line:before{content:""}.ri-vip-diamond-fill:before{content:""}.ri-vip-diamond-line:before{content:""}.ri-vip-fill:before{content:""}.ri-vip-line:before{content:""}.ri-virus-fill:before{content:""}.ri-virus-line:before{content:""}.ri-visa-fill:before{content:""}.ri-visa-line:before{content:""}.ri-voice-recognition-fill:before{content:""}.ri-voice-recognition-line:before{content:""}.ri-voiceprint-fill:before{content:""}.ri-voiceprint-line:before{content:""}.ri-volume-down-fill:before{content:""}.ri-volume-down-line:before{content:""}.ri-volume-mute-fill:before{content:""}.ri-volume-mute-line:before{content:""}.ri-volume-off-vibrate-fill:before{content:""}.ri-volume-off-vibrate-line:before{content:""}.ri-volume-up-fill:before{content:""}.ri-volume-up-line:before{content:""}.ri-volume-vibrate-fill:before{content:""}.ri-volume-vibrate-line:before{content:""}.ri-vuejs-fill:before{content:""}.ri-vuejs-line:before{content:""}.ri-walk-fill:before{content:""}.ri-walk-line:before{content:""}.ri-wallet-2-fill:before{content:""}.ri-wallet-2-line:before{content:""}.ri-wallet-3-fill:before{content:""}.ri-wallet-3-line:before{content:""}.ri-wallet-fill:before{content:""}.ri-wallet-line:before{content:""}.ri-water-flash-fill:before{content:""}.ri-water-flash-line:before{content:""}.ri-webcam-fill:before{content:""}.ri-webcam-line:before{content:""}.ri-wechat-2-fill:before{content:""}.ri-wechat-2-line:before{content:""}.ri-wechat-fill:before{content:""}.ri-wechat-line:before{content:""}.ri-wechat-pay-fill:before{content:""}.ri-wechat-pay-line:before{content:""}.ri-weibo-fill:before{content:""}.ri-weibo-line:before{content:""}.ri-whatsapp-fill:before{content:""}.ri-whatsapp-line:before{content:""}.ri-wheelchair-fill:before{content:""}.ri-wheelchair-line:before{content:""}.ri-wifi-fill:before{content:""}.ri-wifi-line:before{content:""}.ri-wifi-off-fill:before{content:""}.ri-wifi-off-line:before{content:""}.ri-window-2-fill:before{content:""}.ri-window-2-line:before{content:""}.ri-window-fill:before{content:""}.ri-window-line:before{content:""}.ri-windows-fill:before{content:""}.ri-windows-line:before{content:""}.ri-windy-fill:before{content:""}.ri-windy-line:before{content:""}.ri-wireless-charging-fill:before{content:""}.ri-wireless-charging-line:before{content:""}.ri-women-fill:before{content:""}.ri-women-line:before{content:""}.ri-wubi-input:before{content:""}.ri-xbox-fill:before{content:""}.ri-xbox-line:before{content:""}.ri-xing-fill:before{content:""}.ri-xing-line:before{content:""}.ri-youtube-fill:before{content:""}.ri-youtube-line:before{content:""}.ri-zcool-fill:before{content:""}.ri-zcool-line:before{content:""}.ri-zhihu-fill:before{content:""}.ri-zhihu-line:before{content:""}.ri-zoom-in-fill:before{content:""}.ri-zoom-in-line:before{content:""}.ri-zoom-out-fill:before{content:""}.ri-zoom-out-line:before{content:""}.ri-zzz-fill:before{content:""}.ri-zzz-line:before{content:""}.ri-arrow-down-double-fill:before{content:""}.ri-arrow-down-double-line:before{content:""}.ri-arrow-left-double-fill:before{content:""}.ri-arrow-left-double-line:before{content:""}.ri-arrow-right-double-fill:before{content:""}.ri-arrow-right-double-line:before{content:""}.ri-arrow-turn-back-fill:before{content:""}.ri-arrow-turn-back-line:before{content:""}.ri-arrow-turn-forward-fill:before{content:""}.ri-arrow-turn-forward-line:before{content:""}.ri-arrow-up-double-fill:before{content:""}.ri-arrow-up-double-line:before{content:""}.ri-bard-fill:before{content:""}.ri-bard-line:before{content:""}.ri-bootstrap-fill:before{content:""}.ri-bootstrap-line:before{content:""}.ri-box-1-fill:before{content:""}.ri-box-1-line:before{content:""}.ri-box-2-fill:before{content:""}.ri-box-2-line:before{content:""}.ri-box-3-fill:before{content:""}.ri-box-3-line:before{content:""}.ri-brain-fill:before{content:""}.ri-brain-line:before{content:""}.ri-candle-fill:before{content:""}.ri-candle-line:before{content:""}.ri-cash-fill:before{content:""}.ri-cash-line:before{content:""}.ri-contract-left-fill:before{content:""}.ri-contract-left-line:before{content:""}.ri-contract-left-right-fill:before{content:""}.ri-contract-left-right-line:before{content:""}.ri-contract-right-fill:before{content:""}.ri-contract-right-line:before{content:""}.ri-contract-up-down-fill:before{content:""}.ri-contract-up-down-line:before{content:""}.ri-copilot-fill:before{content:""}.ri-copilot-line:before{content:""}.ri-corner-down-left-fill:before{content:""}.ri-corner-down-left-line:before{content:""}.ri-corner-down-right-fill:before{content:""}.ri-corner-down-right-line:before{content:""}.ri-corner-left-down-fill:before{content:""}.ri-corner-left-down-line:before{content:""}.ri-corner-left-up-fill:before{content:""}.ri-corner-left-up-line:before{content:""}.ri-corner-right-down-fill:before{content:""}.ri-corner-right-down-line:before{content:""}.ri-corner-right-up-fill:before{content:""}.ri-corner-right-up-line:before{content:""}.ri-corner-up-left-double-fill:before{content:""}.ri-corner-up-left-double-line:before{content:""}.ri-corner-up-left-fill:before{content:""}.ri-corner-up-left-line:before{content:""}.ri-corner-up-right-double-fill:before{content:""}.ri-corner-up-right-double-line:before{content:""}.ri-corner-up-right-fill:before{content:""}.ri-corner-up-right-line:before{content:""}.ri-cross-fill:before{content:""}.ri-cross-line:before{content:""}.ri-edge-new-fill:before{content:""}.ri-edge-new-line:before{content:""}.ri-equal-fill:before{content:""}.ri-equal-line:before{content:""}.ri-expand-left-fill:before{content:""}.ri-expand-left-line:before{content:""}.ri-expand-left-right-fill:before{content:""}.ri-expand-left-right-line:before{content:""}.ri-expand-right-fill:before{content:""}.ri-expand-right-line:before{content:""}.ri-expand-up-down-fill:before{content:""}.ri-expand-up-down-line:before{content:""}.ri-flickr-fill:before{content:""}.ri-flickr-line:before{content:""}.ri-forward-10-fill:before{content:""}.ri-forward-10-line:before{content:""}.ri-forward-15-fill:before{content:""}.ri-forward-15-line:before{content:""}.ri-forward-30-fill:before{content:""}.ri-forward-30-line:before{content:""}.ri-forward-5-fill:before{content:""}.ri-forward-5-line:before{content:""}.ri-graduation-cap-fill:before{content:""}.ri-graduation-cap-line:before{content:""}.ri-home-office-fill:before{content:""}.ri-home-office-line:before{content:""}.ri-hourglass-2-fill:before{content:""}.ri-hourglass-2-line:before{content:""}.ri-hourglass-fill:before{content:""}.ri-hourglass-line:before{content:""}.ri-javascript-fill:before{content:""}.ri-javascript-line:before{content:""}.ri-loop-left-fill:before{content:""}.ri-loop-left-line:before{content:""}.ri-loop-right-fill:before{content:""}.ri-loop-right-line:before{content:""}.ri-memories-fill:before{content:""}.ri-memories-line:before{content:""}.ri-meta-fill:before{content:""}.ri-meta-line:before{content:""}.ri-microsoft-loop-fill:before{content:""}.ri-microsoft-loop-line:before{content:""}.ri-nft-fill:before{content:""}.ri-nft-line:before{content:""}.ri-notion-fill:before{content:""}.ri-notion-line:before{content:""}.ri-openai-fill:before{content:""}.ri-openai-line:before{content:""}.ri-overline:before{content:""}.ri-p2p-fill:before{content:""}.ri-p2p-line:before{content:""}.ri-presentation-fill:before{content:""}.ri-presentation-line:before{content:""}.ri-replay-10-fill:before{content:""}.ri-replay-10-line:before{content:""}.ri-replay-15-fill:before{content:""}.ri-replay-15-line:before{content:""}.ri-replay-30-fill:before{content:""}.ri-replay-30-line:before{content:""}.ri-replay-5-fill:before{content:""}.ri-replay-5-line:before{content:""}.ri-school-fill:before{content:""}.ri-school-line:before{content:""}.ri-shining-2-fill:before{content:""}.ri-shining-2-line:before{content:""}.ri-shining-fill:before{content:""}.ri-shining-line:before{content:""}.ri-sketching:before{content:""}.ri-skip-down-fill:before{content:""}.ri-skip-down-line:before{content:""}.ri-skip-left-fill:before{content:""}.ri-skip-left-line:before{content:""}.ri-skip-right-fill:before{content:""}.ri-skip-right-line:before{content:""}.ri-skip-up-fill:before{content:""}.ri-skip-up-line:before{content:""}.ri-slow-down-fill:before{content:""}.ri-slow-down-line:before{content:""}.ri-sparkling-2-fill:before{content:""}.ri-sparkling-2-line:before{content:""}.ri-sparkling-fill:before{content:""}.ri-sparkling-line:before{content:""}.ri-speak-fill:before{content:""}.ri-speak-line:before{content:""}.ri-speed-up-fill:before{content:""}.ri-speed-up-line:before{content:""}.ri-tiktok-fill:before{content:""}.ri-tiktok-line:before{content:""}.ri-token-swap-fill:before{content:""}.ri-token-swap-line:before{content:""}.ri-unpin-fill:before{content:""}.ri-unpin-line:before{content:""}.ri-wechat-channels-fill:before{content:""}.ri-wechat-channels-line:before{content:""}.ri-wordpress-fill:before{content:""}.ri-wordpress-line:before{content:""}.ri-blender-fill:before{content:""}.ri-blender-line:before{content:""}.ri-emoji-sticker-fill:before{content:""}.ri-emoji-sticker-line:before{content:""}.ri-git-close-pull-request-fill:before{content:""}.ri-git-close-pull-request-line:before{content:""}.ri-instance-fill:before{content:""}.ri-instance-line:before{content:""}.ri-megaphone-fill:before{content:""}.ri-megaphone-line:before{content:""}.ri-pass-expired-fill:before{content:""}.ri-pass-expired-line:before{content:""}.ri-pass-pending-fill:before{content:""}.ri-pass-pending-line:before{content:""}.ri-pass-valid-fill:before{content:""}.ri-pass-valid-line:before{content:""}.ri-ai-generate:before{content:""}.ri-calendar-close-fill:before{content:""}.ri-calendar-close-line:before{content:""}.ri-draggable:before{content:""}.ri-font-family:before{content:""}.ri-font-mono:before{content:""}.ri-font-sans-serif:before{content:""}.ri-hard-drive-3-fill:before{content:""}.ri-hard-drive-3-line:before{content:""}.ri-kick-fill:before{content:""}.ri-kick-line:before{content:""}.ri-list-check-3:before{content:""}.ri-list-indefinite:before{content:""}.ri-list-ordered-2:before{content:""}.ri-list-radio:before{content:""}.ri-openbase-fill:before{content:""}.ri-openbase-line:before{content:""}.ri-planet-fill:before{content:""}.ri-planet-line:before{content:""}.ri-prohibited-fill:before{content:""}.ri-prohibited-line:before{content:""}.ri-quote-text:before{content:""}.ri-seo-fill:before{content:""}.ri-seo-line:before{content:""}.ri-slash-commands:before{content:""}.ri-archive-2-fill:before{content:""}.ri-archive-2-line:before{content:""}.ri-inbox-2-fill:before{content:""}.ri-inbox-2-line:before{content:""}.ri-shake-hands-fill:before{content:""}.ri-shake-hands-line:before{content:""}.ri-supabase-fill:before{content:""}.ri-supabase-line:before{content:""}.ri-water-percent-fill:before{content:""}.ri-water-percent-line:before{content:""}.ri-yuque-fill:before{content:""}.ri-yuque-line:before{content:""}.ri-crosshair-2-fill:before{content:""}.ri-crosshair-2-line:before{content:""}.ri-crosshair-fill:before{content:""}.ri-crosshair-line:before{content:""}.ri-file-close-fill:before{content:""}.ri-file-close-line:before{content:""}.ri-infinity-fill:before{content:""}.ri-infinity-line:before{content:""}.ri-rfid-fill:before{content:""}.ri-rfid-line:before{content:""}.ri-slash-commands-2:before{content:""}.ri-user-forbid-fill:before{content:""}.ri-user-forbid-line:before{content:""}.ri-beer-fill:before{content:""}.ri-beer-line:before{content:""}.ri-circle-fill:before{content:""}.ri-circle-line:before{content:""}.ri-dropdown-list:before{content:""}.ri-file-image-fill:before{content:""}.ri-file-image-line:before{content:""}.ri-file-pdf-2-fill:before{content:""}.ri-file-pdf-2-line:before{content:""}.ri-file-video-fill:before{content:""}.ri-file-video-line:before{content:""}.ri-folder-image-fill:before{content:""}.ri-folder-image-line:before{content:""}.ri-folder-video-fill:before{content:""}.ri-folder-video-line:before{content:""}.ri-hexagon-fill:before{content:""}.ri-hexagon-line:before{content:""}.ri-menu-search-fill:before{content:""}.ri-menu-search-line:before{content:""}.ri-octagon-fill:before{content:""}.ri-octagon-line:before{content:""}.ri-pentagon-fill:before{content:""}.ri-pentagon-line:before{content:""}.ri-rectangle-fill:before{content:""}.ri-rectangle-line:before{content:""}.ri-robot-2-fill:before{content:""}.ri-robot-2-line:before{content:""}.ri-shapes-fill:before{content:""}.ri-shapes-line:before{content:""}.ri-square-fill:before{content:""}.ri-square-line:before{content:""}.ri-tent-fill:before{content:""}.ri-tent-line:before{content:""}.ri-threads-fill:before{content:""}.ri-threads-line:before{content:""}.ri-tree-fill:before{content:""}.ri-tree-line:before{content:""}.ri-triangle-fill:before{content:""}.ri-triangle-line:before{content:""}.ri-twitter-x-fill:before{content:""}.ri-twitter-x-line:before{content:""}.ri-verified-badge-fill:before{content:""}.ri-verified-badge-line:before{content:""}.ri-armchair-fill:before{content:""}.ri-armchair-line:before{content:""}.ri-bnb-fill:before{content:""}.ri-bnb-line:before{content:""}.ri-bread-fill:before{content:""}.ri-bread-line:before{content:""}.ri-btc-fill:before{content:""}.ri-btc-line:before{content:""}.ri-calendar-schedule-fill:before{content:""}.ri-calendar-schedule-line:before{content:""}.ri-dice-1-fill:before{content:""}.ri-dice-1-line:before{content:""}.ri-dice-2-fill:before{content:""}.ri-dice-2-line:before{content:""}.ri-dice-3-fill:before{content:""}.ri-dice-3-line:before{content:""}.ri-dice-4-fill:before{content:""}.ri-dice-4-line:before{content:""}.ri-dice-5-fill:before{content:""}.ri-dice-5-line:before{content:""}.ri-dice-6-fill:before{content:""}.ri-dice-6-line:before{content:""}.ri-dice-fill:before{content:""}.ri-dice-line:before{content:""}.ri-drinks-fill:before{content:""}.ri-drinks-line:before{content:""}.ri-equalizer-2-fill:before{content:""}.ri-equalizer-2-line:before{content:""}.ri-equalizer-3-fill:before{content:""}.ri-equalizer-3-line:before{content:""}.ri-eth-fill:before{content:""}.ri-eth-line:before{content:""}.ri-flower-fill:before{content:""}.ri-flower-line:before{content:""}.ri-glasses-2-fill:before{content:""}.ri-glasses-2-line:before{content:""}.ri-glasses-fill:before{content:""}.ri-glasses-line:before{content:""}.ri-goggles-fill:before{content:""}.ri-goggles-line:before{content:""}.ri-image-circle-fill:before{content:""}.ri-image-circle-line:before{content:""}.ri-info-i:before{content:""}.ri-money-rupee-circle-fill:before{content:""}.ri-money-rupee-circle-line:before{content:""}.ri-news-fill:before{content:""}.ri-news-line:before{content:""}.ri-robot-3-fill:before{content:""}.ri-robot-3-line:before{content:""}.ri-share-2-fill:before{content:""}.ri-share-2-line:before{content:""}.ri-sofa-fill:before{content:""}.ri-sofa-line:before{content:""}.ri-svelte-fill:before{content:""}.ri-svelte-line:before{content:""}.ri-vk-fill:before{content:""}.ri-vk-line:before{content:""}.ri-xrp-fill:before{content:""}.ri-xrp-line:before{content:""}.ri-xtz-fill:before{content:""}.ri-xtz-line:before{content:""}.ri-archive-stack-fill:before{content:""}.ri-archive-stack-line:before{content:""}.ri-bowl-fill:before{content:""}.ri-bowl-line:before{content:""}.ri-calendar-view:before{content:""}.ri-carousel-view:before{content:""}.ri-code-block:before{content:""}.ri-color-filter-fill:before{content:""}.ri-color-filter-line:before{content:""}.ri-contacts-book-3-fill:before{content:""}.ri-contacts-book-3-line:before{content:""}.ri-contract-fill:before{content:""}.ri-contract-line:before{content:""}.ri-drinks-2-fill:before{content:""}.ri-drinks-2-line:before{content:""}.ri-export-fill:before{content:""}.ri-export-line:before{content:""}.ri-file-check-fill:before{content:""}.ri-file-check-line:before{content:""}.ri-focus-mode:before{content:""}.ri-folder-6-fill:before{content:""}.ri-folder-6-line:before{content:""}.ri-folder-check-fill:before{content:""}.ri-folder-check-line:before{content:""}.ri-folder-close-fill:before{content:""}.ri-folder-close-line:before{content:""}.ri-folder-cloud-fill:before{content:""}.ri-folder-cloud-line:before{content:""}.ri-gallery-view-2:before{content:""}.ri-gallery-view:before{content:""}.ri-hand:before{content:""}.ri-import-fill:before{content:""}.ri-import-line:before{content:""}.ri-information-2-fill:before{content:""}.ri-information-2-line:before{content:""}.ri-kanban-view-2:before{content:""}.ri-kanban-view:before{content:""}.ri-list-view:before{content:""}.ri-lock-star-fill:before{content:""}.ri-lock-star-line:before{content:""}.ri-puzzle-2-fill:before{content:""}.ri-puzzle-2-line:before{content:""}.ri-puzzle-fill:before{content:""}.ri-puzzle-line:before{content:""}.ri-ram-2-fill:before{content:""}.ri-ram-2-line:before{content:""}.ri-ram-fill:before{content:""}.ri-ram-line:before{content:""}.ri-receipt-fill:before{content:""}.ri-receipt-line:before{content:""}.ri-shadow-fill:before{content:""}.ri-shadow-line:before{content:""}.ri-sidebar-fold-fill:before{content:""}.ri-sidebar-fold-line:before{content:""}.ri-sidebar-unfold-fill:before{content:""}.ri-sidebar-unfold-line:before{content:""}.ri-slideshow-view:before{content:""}.ri-sort-alphabet-asc:before{content:""}.ri-sort-alphabet-desc:before{content:""}.ri-sort-number-asc:before{content:""}.ri-sort-number-desc:before{content:""}.ri-stacked-view:before{content:""}.ri-sticky-note-add-fill:before{content:""}.ri-sticky-note-add-line:before{content:""}.ri-swap-2-fill:before{content:""}.ri-swap-2-line:before{content:""}.ri-swap-3-fill:before{content:""}.ri-swap-3-line:before{content:""}.ri-table-3:before{content:""}.ri-table-view:before{content:""}.ri-text-block:before{content:""}.ri-text-snippet:before{content:""}.ri-timeline-view:before{content:""}.ri-blogger-fill:before{content:""}.ri-blogger-line:before{content:""}.ri-chat-thread-fill:before{content:""}.ri-chat-thread-line:before{content:""}.ri-discount-percent-fill:before{content:""}.ri-discount-percent-line:before{content:""}.ri-exchange-2-fill:before{content:""}.ri-exchange-2-line:before{content:""}.ri-git-fork-fill:before{content:""}.ri-git-fork-line:before{content:""}.ri-input-field:before{content:""}.ri-progress-1-fill:before{content:""}.ri-progress-1-line:before{content:""}.ri-progress-2-fill:before{content:""}.ri-progress-2-line:before{content:""}.ri-progress-3-fill:before{content:""}.ri-progress-3-line:before{content:""}.ri-progress-4-fill:before{content:""}.ri-progress-4-line:before{content:""}.ri-progress-5-fill:before{content:""}.ri-progress-5-line:before{content:""}.ri-progress-6-fill:before{content:""}.ri-progress-6-line:before{content:""}.ri-progress-7-fill:before{content:""}.ri-progress-7-line:before{content:""}.ri-progress-8-fill:before{content:""}.ri-progress-8-line:before{content:""}.ri-remix-run-fill:before{content:""}.ri-remix-run-line:before{content:""}.ri-signpost-fill:before{content:""}.ri-signpost-line:before{content:""}.ri-time-zone-fill:before{content:""}.ri-time-zone-line:before{content:""}.ri-arrow-down-wide-fill:before{content:""}.ri-arrow-down-wide-line:before{content:""}.ri-arrow-left-wide-fill:before{content:""}.ri-arrow-left-wide-line:before{content:""}.ri-arrow-right-wide-fill:before{content:""}.ri-arrow-right-wide-line:before{content:""}.ri-arrow-up-wide-fill:before{content:""}.ri-arrow-up-wide-line:before{content:""}.ri-bluesky-fill:before{content:""}.ri-bluesky-line:before{content:""}.ri-expand-height-fill:before{content:""}.ri-expand-height-line:before{content:""}.ri-expand-width-fill:before{content:""}.ri-expand-width-line:before{content:""}.ri-forward-end-fill:before{content:""}.ri-forward-end-line:before{content:""}.ri-forward-end-mini-fill:before{content:""}.ri-forward-end-mini-line:before{content:""}.ri-friendica-fill:before{content:""}.ri-friendica-line:before{content:""}.ri-git-pr-draft-fill:before{content:""}.ri-git-pr-draft-line:before{content:""}.ri-play-reverse-fill:before{content:""}.ri-play-reverse-line:before{content:""}.ri-play-reverse-mini-fill:before{content:""}.ri-play-reverse-mini-line:before{content:""}.ri-rewind-start-fill:before{content:""}.ri-rewind-start-line:before{content:""}.ri-rewind-start-mini-fill:before{content:""}.ri-rewind-start-mini-line:before{content:""}.ri-scroll-to-bottom-fill:before{content:""}.ri-scroll-to-bottom-line:before{content:""}.ri-add-large-fill:before{content:""}.ri-add-large-line:before{content:""}.ri-aed-electrodes-fill:before{content:""}.ri-aed-electrodes-line:before{content:""}.ri-aed-fill:before{content:""}.ri-aed-line:before{content:""}.ri-alibaba-cloud-fill:before{content:""}.ri-alibaba-cloud-line:before{content:""}.ri-align-item-bottom-fill:before{content:""}.ri-align-item-bottom-line:before{content:""}.ri-align-item-horizontal-center-fill:before{content:""}.ri-align-item-horizontal-center-line:before{content:""}.ri-align-item-left-fill:before{content:""}.ri-align-item-left-line:before{content:""}.ri-align-item-right-fill:before{content:""}.ri-align-item-right-line:before{content:""}.ri-align-item-top-fill:before{content:""}.ri-align-item-top-line:before{content:""}.ri-align-item-vertical-center-fill:before{content:""}.ri-align-item-vertical-center-line:before{content:""}.ri-apps-2-add-fill:before{content:""}.ri-apps-2-add-line:before{content:""}.ri-close-large-fill:before{content:""}.ri-close-large-line:before{content:""}.ri-collapse-diagonal-2-fill:before{content:""}.ri-collapse-diagonal-2-line:before{content:""}.ri-collapse-diagonal-fill:before{content:""}.ri-collapse-diagonal-line:before{content:""}.ri-dashboard-horizontal-fill:before{content:""}.ri-dashboard-horizontal-line:before{content:""}.ri-expand-diagonal-2-fill:before{content:""}.ri-expand-diagonal-2-line:before{content:""}.ri-expand-diagonal-fill:before{content:""}.ri-expand-diagonal-line:before{content:""}.ri-firebase-fill:before{content:""}.ri-firebase-line:before{content:""}.ri-flip-horizontal-2-fill:before{content:""}.ri-flip-horizontal-2-line:before{content:""}.ri-flip-horizontal-fill:before{content:""}.ri-flip-horizontal-line:before{content:""}.ri-flip-vertical-2-fill:before{content:""}.ri-flip-vertical-2-line:before{content:""}.ri-flip-vertical-fill:before{content:""}.ri-flip-vertical-line:before{content:""}.ri-formula:before{content:""}.ri-function-add-fill:before{content:""}.ri-function-add-line:before{content:""}.ri-goblet-2-fill:before{content:""}.ri-goblet-2-line:before{content:""}.ri-golf-ball-fill:before{content:""}.ri-golf-ball-line:before{content:""}.ri-group-3-fill:before{content:""}.ri-group-3-line:before{content:""}.ri-heart-add-2-fill:before{content:""}.ri-heart-add-2-line:before{content:""}.ri-id-card-fill:before{content:""}.ri-id-card-line:before{content:""}.ri-information-off-fill:before{content:""}.ri-information-off-line:before{content:""}.ri-java-fill:before{content:""}.ri-java-line:before{content:""}.ri-layout-grid-2-fill:before{content:""}.ri-layout-grid-2-line:before{content:""}.ri-layout-horizontal-fill:before{content:""}.ri-layout-horizontal-line:before{content:""}.ri-layout-vertical-fill:before{content:""}.ri-layout-vertical-line:before{content:""}.ri-menu-fold-2-fill:before{content:""}.ri-menu-fold-2-line:before{content:""}.ri-menu-fold-3-fill:before{content:""}.ri-menu-fold-3-line:before{content:""}.ri-menu-fold-4-fill:before{content:""}.ri-menu-fold-4-line:before{content:""}.ri-menu-unfold-2-fill:before{content:""}.ri-menu-unfold-2-line:before{content:""}.ri-menu-unfold-3-fill:before{content:""}.ri-menu-unfold-3-line:before{content:""}.ri-menu-unfold-4-fill:before{content:""}.ri-menu-unfold-4-line:before{content:""}.ri-mobile-download-fill:before{content:""}.ri-mobile-download-line:before{content:""}.ri-nextjs-fill:before{content:""}.ri-nextjs-line:before{content:""}.ri-nodejs-fill:before{content:""}.ri-nodejs-line:before{content:""}.ri-pause-large-fill:before{content:""}.ri-pause-large-line:before{content:""}.ri-play-large-fill:before{content:""}.ri-play-large-line:before{content:""}.ri-play-reverse-large-fill:before{content:""}.ri-play-reverse-large-line:before{content:""}.ri-police-badge-fill:before{content:""}.ri-police-badge-line:before{content:""}.ri-prohibited-2-fill:before{content:""}.ri-prohibited-2-line:before{content:""}.ri-shopping-bag-4-fill:before{content:""}.ri-shopping-bag-4-line:before{content:""}.ri-snowflake-fill:before{content:""}.ri-snowflake-line:before{content:""}.ri-square-root:before{content:""}.ri-stop-large-fill:before{content:""}.ri-stop-large-line:before{content:""}.ri-tailwind-css-fill:before{content:""}.ri-tailwind-css-line:before{content:""}.ri-tooth-fill:before{content:""}.ri-tooth-line:before{content:""}.ri-video-off-fill:before{content:""}.ri-video-off-line:before{content:""}.ri-video-on-fill:before{content:""}.ri-video-on-line:before{content:""}.ri-webhook-fill:before{content:""}.ri-webhook-line:before{content:""}.ri-weight-fill:before{content:""}.ri-weight-line:before{content:""}.ri-book-shelf-fill:before{content:""}.ri-book-shelf-line:before{content:""}.ri-brain-2-fill:before{content:""}.ri-brain-2-line:before{content:""}.ri-chat-search-fill:before{content:""}.ri-chat-search-line:before{content:""}.ri-chat-unread-fill:before{content:""}.ri-chat-unread-line:before{content:""}.ri-collapse-horizontal-fill:before{content:""}.ri-collapse-horizontal-line:before{content:""}.ri-collapse-vertical-fill:before{content:""}.ri-collapse-vertical-line:before{content:""}.ri-dna-fill:before{content:""}.ri-dna-line:before{content:""}.ri-dropper-fill:before{content:""}.ri-dropper-line:before{content:""}.ri-expand-diagonal-s-2-fill:before{content:""}.ri-expand-diagonal-s-2-line:before{content:""}.ri-expand-diagonal-s-fill:before{content:""}.ri-expand-diagonal-s-line:before{content:""}.ri-expand-horizontal-fill:before{content:""}.ri-expand-horizontal-line:before{content:""}.ri-expand-horizontal-s-fill:before{content:""}.ri-expand-horizontal-s-line:before{content:""}.ri-expand-vertical-fill:before{content:""}.ri-expand-vertical-line:before{content:""}.ri-expand-vertical-s-fill:before{content:""}.ri-expand-vertical-s-line:before{content:""}.ri-gemini-fill:before{content:""}.ri-gemini-line:before{content:""}.ri-reset-left-fill:before{content:""}.ri-reset-left-line:before{content:""}.ri-reset-right-fill:before{content:""}.ri-reset-right-line:before{content:""}.ri-stairs-fill:before{content:""}.ri-stairs-line:before{content:""}.ri-telegram-2-fill:before{content:""}.ri-telegram-2-line:before{content:""}.ri-triangular-flag-fill:before{content:""}.ri-triangular-flag-line:before{content:""}.ri-user-minus-fill:before{content:""}.ri-user-minus-line:before{content:""}.ri-account-box-2-fill:before{content:""}.ri-account-box-2-line:before{content:""}.ri-account-circle-2-fill:before{content:""}.ri-account-circle-2-line:before{content:""}.ri-alarm-snooze-fill:before{content:""}.ri-alarm-snooze-line:before{content:""}.ri-arrow-down-box-fill:before{content:""}.ri-arrow-down-box-line:before{content:""}.ri-arrow-left-box-fill:before{content:""}.ri-arrow-left-box-line:before{content:""}.ri-arrow-left-down-box-fill:before{content:""}.ri-arrow-left-down-box-line:before{content:""}.ri-arrow-left-up-box-fill:before{content:""}.ri-arrow-left-up-box-line:before{content:""}.ri-arrow-right-box-fill:before{content:""}.ri-arrow-right-box-line:before{content:""}.ri-arrow-right-down-box-fill:before{content:""}.ri-arrow-right-down-box-line:before{content:""}.ri-arrow-right-up-box-fill:before{content:""}.ri-arrow-right-up-box-line:before{content:""}.ri-arrow-up-box-fill:before{content:""}.ri-arrow-up-box-line:before{content:""}.ri-bar-chart-box-ai-fill:before{content:""}.ri-bar-chart-box-ai-line:before{content:""}.ri-brush-ai-fill:before{content:""}.ri-brush-ai-line:before{content:""}.ri-camera-ai-fill:before{content:""}.ri-camera-ai-line:before{content:""}.ri-chat-ai-fill:before{content:""}.ri-chat-ai-line:before{content:""}.ri-chat-smile-ai-fill:before{content:""}.ri-chat-smile-ai-line:before{content:""}.ri-chat-voice-ai-fill:before{content:""}.ri-chat-voice-ai-line:before{content:""}.ri-code-ai-fill:before{content:""}.ri-code-ai-line:before{content:""}.ri-color-filter-ai-fill:before{content:""}.ri-color-filter-ai-line:before{content:""}.ri-custom-size:before{content:""}.ri-fediverse-fill:before{content:""}.ri-fediverse-line:before{content:""}.ri-flag-off-fill:before{content:""}.ri-flag-off-line:before{content:""}.ri-home-9-fill:before{content:""}.ri-home-9-line:before{content:""}.ri-image-ai-fill:before{content:""}.ri-image-ai-line:before{content:""}.ri-image-circle-ai-fill:before{content:""}.ri-image-circle-ai-line:before{content:""}.ri-info-card-fill:before{content:""}.ri-info-card-line:before{content:""}.ri-landscape-ai-fill:before{content:""}.ri-landscape-ai-line:before{content:""}.ri-letter-spacing-2:before{content:""}.ri-line-height-2:before{content:""}.ri-mail-ai-fill:before{content:""}.ri-mail-ai-line:before{content:""}.ri-mic-2-ai-fill:before{content:""}.ri-mic-2-ai-line:before{content:""}.ri-mic-ai-fill:before{content:""}.ri-mic-ai-line:before{content:""}.ri-movie-ai-fill:before{content:""}.ri-movie-ai-line:before{content:""}.ri-music-ai-fill:before{content:""}.ri-music-ai-line:before{content:""}.ri-notification-snooze-fill:before{content:""}.ri-notification-snooze-line:before{content:""}.ri-php-fill:before{content:""}.ri-php-line:before{content:""}.ri-pix-fill:before{content:""}.ri-pix-line:before{content:""}.ri-pulse-ai-fill:before{content:""}.ri-pulse-ai-line:before{content:""}.ri-quill-pen-ai-fill:before{content:""}.ri-quill-pen-ai-line:before{content:""}.ri-speak-ai-fill:before{content:""}.ri-speak-ai-line:before{content:""}.ri-star-off-fill:before{content:""}.ri-star-off-line:before{content:""}.ri-translate-ai-2:before{content:""}.ri-translate-ai:before{content:""}.ri-user-community-fill:before{content:""}.ri-user-community-line:before{content:""}.ri-vercel-fill:before{content:""}.ri-vercel-line:before{content:""}.ri-video-ai-fill:before{content:""}.ri-video-ai-line:before{content:""}.ri-video-on-ai-fill:before{content:""}.ri-video-on-ai-line:before{content:""}.ri-voice-ai-fill:before{content:""}.ri-voice-ai-line:before{content:""}.ri-ai-generate-2:before{content:""}.ri-ai-generate-text:before{content:""}.ri-anthropic-fill:before{content:""}.ri-anthropic-line:before{content:""}.ri-apps-2-ai-fill:before{content:""}.ri-apps-2-ai-line:before{content:""}.ri-camera-lens-ai-fill:before{content:""}.ri-camera-lens-ai-line:before{content:""}.ri-clapperboard-ai-fill:before{content:""}.ri-clapperboard-ai-line:before{content:""}.ri-claude-fill:before{content:""}.ri-claude-line:before{content:""}.ri-closed-captioning-ai-fill:before{content:""}.ri-closed-captioning-ai-line:before{content:""}.ri-dvd-ai-fill:before{content:""}.ri-dvd-ai-line:before{content:""}.ri-film-ai-fill:before{content:""}.ri-film-ai-line:before{content:""}.ri-font-size-ai:before{content:""}.ri-mixtral-fill:before{content:""}.ri-mixtral-line:before{content:""}.ri-movie-2-ai-fill:before{content:""}.ri-movie-2-ai-line:before{content:""}.ri-mv-ai-fill:before{content:""}.ri-mv-ai-line:before{content:""}.ri-perplexity-fill:before{content:""}.ri-perplexity-line:before{content:""}.ri-poker-clubs-fill:before{content:""}.ri-poker-clubs-line:before{content:""}.ri-poker-diamonds-fill:before{content:""}.ri-poker-diamonds-line:before{content:""}.ri-poker-hearts-fill:before{content:""}.ri-poker-hearts-line:before{content:""}.ri-poker-spades-fill:before{content:""}.ri-poker-spades-line:before{content:""}.ri-safe-3-fill:before{content:""}.ri-safe-3-line:before{content:""}.ri-accessibility-fill:before{content:""}.ri-accessibility-line:before{content:""}.ri-alarm-add-fill:before{content:""}.ri-alarm-add-line:before{content:""}.ri-arrow-down-long-fill:before{content:""}.ri-arrow-down-long-line:before{content:""}.ri-arrow-left-down-long-fill:before{content:""}.ri-arrow-left-down-long-line:before{content:""}.ri-arrow-left-long-fill:before{content:""}.ri-arrow-left-long-line:before{content:""}.ri-arrow-left-up-long-fill:before{content:""}.ri-arrow-left-up-long-line:before{content:""}.ri-arrow-right-down-long-fill:before{content:""}.ri-arrow-right-down-long-line:before{content:""}.ri-arrow-right-long-fill:before{content:""}.ri-arrow-right-long-line:before{content:""}.ri-arrow-right-up-long-fill:before{content:""}.ri-arrow-right-up-long-line:before{content:""}.ri-arrow-up-long-fill:before{content:""}.ri-arrow-up-long-line:before{content:""}.ri-chess-fill:before{content:""}.ri-chess-line:before{content:""}.ri-diamond-fill:before{content:""}.ri-diamond-line:before{content:""}.ri-diamond-ring-fill:before{content:""}.ri-diamond-ring-line:before{content:""}.ri-figma-fill:before{content:""}.ri-figma-line:before{content:""}.ri-firefox-browser-fill:before{content:""}.ri-firefox-browser-line:before{content:""}.ri-jewelry-fill:before{content:""}.ri-jewelry-line:before{content:""}.ri-multi-image-fill:before{content:""}.ri-multi-image-line:before{content:""}.ri-no-credit-card-fill:before{content:""}.ri-no-credit-card-line:before{content:""}.ri-service-bell-fill:before{content:""}.ri-service-bell-line:before{content:""}.ri-ai-agent-fill:before{content:""}.ri-ai-agent-line:before{content:""}.ri-ai-generate-2-fill:before{content:""}.ri-ai-generate-2-line:before{content:""}.ri-ai-generate-3d-fill:before{content:""}.ri-ai-generate-3d-line:before{content:""}.ri-ai:before{content:""}.ri-apps-ai-fill:before{content:""}.ri-apps-ai-line:before{content:""}.ri-atom-fill:before{content:""}.ri-atom-line:before{content:""}.ri-book-ai-fill:before{content:""}.ri-book-ai-line:before{content:""}.ri-brain-3-fill:before{content:""}.ri-brain-3-line:before{content:""}.ri-brain-ai-3-fill:before{content:""}.ri-brain-ai-3-line:before{content:""}.ri-brush-ai-3-fill:before{content:""}.ri-brush-ai-3-line:before{content:""}.ri-camera-4-fill:before{content:""}.ri-camera-4-line:before{content:""}.ri-camera-ai-2-fill:before{content:""}.ri-camera-ai-2-line:before{content:""}.ri-chat-ai-2-fill:before{content:""}.ri-chat-ai-2-line:before{content:""}.ri-chat-ai-3-fill:before{content:""}.ri-chat-ai-3-line:before{content:""}.ri-chat-ai-4-fill:before{content:""}.ri-chat-ai-4-line:before{content:""}.ri-chat-smile-ai-3-fill:before{content:""}.ri-chat-smile-ai-3-line:before{content:""}.ri-deepseek-fill:before{content:""}.ri-deepseek-line:before{content:""}.ri-file-ai-2-fill:before{content:""}.ri-file-ai-2-line:before{content:""}.ri-file-ai-fill:before{content:""}.ri-file-ai-line:before{content:""}.ri-function-ai-fill:before{content:""}.ri-function-ai-line:before{content:""}.ri-game-2-fill:before{content:""}.ri-game-2-line:before{content:""}.ri-goblet-broken-fill:before{content:""}.ri-goblet-broken-line:before{content:""}.ri-lightbulb-ai-fill:before{content:""}.ri-lightbulb-ai-line:before{content:""}.ri-loop-left-ai-fill:before{content:""}.ri-loop-left-ai-line:before{content:""}.ri-loop-right-ai-fill:before{content:""}.ri-loop-right-ai-line:before{content:""}.ri-message-ai-3-fill:before{content:""}.ri-message-ai-3-line:before{content:""}.ri-painting-ai-fill:before{content:""}.ri-painting-ai-line:before{content:""}.ri-painting-fill:before{content:""}.ri-painting-line:before{content:""}.ri-pencil-ai-2-fill:before{content:""}.ri-pencil-ai-2-line:before{content:""}.ri-pencil-ai-fill:before{content:""}.ri-pencil-ai-line:before{content:""}.ri-remix-fill:before{content:""}.ri-remix-line:before{content:""}.ri-search-ai-2-fill:before{content:""}.ri-search-ai-2-line:before{content:""}.ri-search-ai-3-fill:before{content:""}.ri-search-ai-3-line:before{content:""}.ri-search-ai-4-fill:before{content:""}.ri-search-ai-4-line:before{content:""}.ri-search-ai-fill:before{content:""}.ri-search-ai-line:before{content:""}.ri-speech-to-text-fill:before{content:""}.ri-speech-to-text-line:before{content:""}.ri-target-fill:before{content:""}.ri-target-line:before{content:""}.ri-text-to-speech-fill:before{content:""}.ri-text-to-speech-line:before{content:""}.ri-wrench-fill:before{content:""}.ri-wrench-line:before{content:""}.ri-area-chart-fill:before{content:""}.ri-area-chart-line:before{content:""}.ri-baseball-fill:before{content:""}.ri-baseball-line:before{content:""}.ri-binoculars-fill:before{content:""}.ri-binoculars-line:before{content:""}.ri-cursor-hand:before{content:""}.ri-emotion-add-fill:before{content:""}.ri-emotion-add-line:before{content:""}.ri-file-scan-fill:before{content:""}.ri-file-scan-line:before{content:""}.ri-fiverr-fill:before{content:""}.ri-fiverr-line:before{content:""}.ri-font-serif:before{content:""}.ri-ghost-3-fill:before{content:""}.ri-ghost-3-line:before{content:""}.ri-gitee-fill:before{content:""}.ri-gitee-line:before{content:""}.ri-global-off-fill:before{content:""}.ri-global-off-line:before{content:""}.ri-image-download-fill:before{content:""}.ri-image-download-line:before{content:""}.ri-image-upload-fill:before{content:""}.ri-image-upload-line:before{content:""}.ri-issues-fill:before{content:""}.ri-issues-line:before{content:""}.ri-issues-reopen-fill:before{content:""}.ri-issues-reopen-line:before{content:""}.ri-network-error-fill:before{content:""}.ri-network-error-line:before{content:""}.ri-network-fill:before{content:""}.ri-network-line:before{content:""}.ri-network-off-fill:before{content:""}.ri-network-off-line:before{content:""}.ri-piano-fill:before{content:""}.ri-piano-grand-fill:before{content:""}.ri-piano-grand-line:before{content:""}.ri-piano-line:before{content:""}.ri-plug-3-fill:before{content:""}.ri-plug-3-line:before{content:""}.ri-send-ins-fill:before{content:""}.ri-send-ins-line:before{content:""}.ri-signal-cellular-1-fill:before{content:""}.ri-signal-cellular-1-line:before{content:""}.ri-signal-cellular-2-fill:before{content:""}.ri-signal-cellular-2-line:before{content:""}.ri-signal-cellular-3-fill:before{content:""}.ri-signal-cellular-3-line:before{content:""}.ri-signal-cellular-off-fill:before{content:""}.ri-signal-cellular-off-line:before{content:""}.ri-stacked-chart-fill:before{content:""}.ri-stacked-chart-line:before{content:""}.ri-upwork-fill:before{content:""}.ri-upwork-line:before{content:""}.ri-brain-4-fill:before{content:""}.ri-brain-4-line:before{content:""}.ri-certificate-2-fill:before{content:""}.ri-certificate-2-line:before{content:""}.ri-certificate-fill:before{content:""}.ri-certificate-line:before{content:""}.ri-cookie-fill:before{content:""}.ri-cookie-line:before{content:""}.ri-cursor-ai-fill:before{content:""}.ri-cursor-ai-line:before{content:""}.ri-draw-fill:before{content:""}.ri-draw-line:before{content:""}.ri-ghost-4-fill:before{content:""}.ri-ghost-4-line:before{content:""}.ri-gitbook-fill:before{content:""}.ri-gitbook-line:before{content:""}.ri-grok-ai-fill:before{content:""}.ri-grok-ai-line:before{content:""}.ri-hand-2:before{content:""}.ri-megaphone-2-fill:before{content:""}.ri-megaphone-2-line:before{content:""}.ri-microsoft-copilot-fill:before{content:""}.ri-microsoft-copilot-line:before{content:""}.ri-mosaic-fill:before{content:""}.ri-mosaic-line:before{content:""}.ri-qr-scan-ai-fill:before{content:""}.ri-qr-scan-ai-line:before{content:""}.ri-qwen-ai-fill:before{content:""}.ri-qwen-ai-line:before{content:""}.ri-reddit-2-fill:before{content:""}.ri-reddit-2-line:before{content:""}.ri-sim-card-warning-fill:before{content:""}.ri-sim-card-warning-line:before{content:""}.ri-space-ship-2-fill:before{content:""}.ri-space-ship-2-line:before{content:""}.ri-subreddit-fill:before{content:""}.ri-subreddit-line:before{content:""}.ri-zhipu-ai-fill:before{content:""}.ri-zhipu-ai-line:before{content:""}.ri-connector-fill:before{content:""}.ri-connector-line:before{content:""}', gc = ":host{--ia-primary: #409eff;--ia-primary-contrast: #ffffff;--ia-bg: #ffffff;--ia-bg-card: #ffffff;--ia-bg-muted: #f5f5f7;--ia-text: #303133;--ia-text-secondary: #606266;--ia-text-tertiary: #a8abb2;--ia-separator: #e4e7ed;--ia-danger: #f56c6c;--ia-warning: #e6a23c;--ia-success: #67c23a;--app-primary: var(--ia-primary);--app-on-primary: var(--ia-primary-contrast);--app-bg: var(--ia-bg);--app-bg-card: var(--ia-bg-card);--app-bg-muted: var(--ia-bg-muted);--app-text: var(--ia-text);--app-text-secondary: var(--ia-text-secondary);--app-text-tertiary: var(--ia-text-tertiary);--app-separator: var(--ia-separator);--app-color-danger: var(--ia-danger);--app-color-warning: var(--ia-warning);--app-color-success: var(--ia-success);display:block;height:100%;min-height:320px;background:var(--ia-bg);color:var(--ia-text);font-family:system-ui,-apple-system,PingFang SC,Microsoft YaHei,sans-serif}*,*:before,*:after{box-sizing:border-box}.ia-chat-root{height:100%;min-height:0}.ia-chat-root__placeholder{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:24px;text-align:center;color:var(--ia-text-secondary);font-size:13px}.ia-chat-root__placeholder-desc{margin:0;font-size:11px;color:var(--ia-text-tertiary)}", hc = /* @__PURE__ */ we(pc, [["styles", [mc, gc]]]), vc = Ai(hc, {
  configureApp(e) {
    e.use(Si());
  }
});
function Dc(e = "inneragent-chat") {
  if (typeof customElements > "u")
    throw new Error("<inneragent-chat> requires a browser environment with customElements");
  customElements.get(e) || customElements.define(e, vc);
}
export {
  Ti as IA_THEME_TOKENS,
  hc as InnerAgentChatComponent,
  vc as InnerAgentChatElement,
  Li as applyTheme,
  Ac as clearAssistantPageContext,
  Sc as clearRunContext,
  eo as getAssistantReferenceOptions,
  xc as init,
  Kt as mcpUserServersApi,
  ro as meApi,
  Dc as registerInnerAgentChat,
  Uc as resetAssistantReferenceCaches,
  kc as resetSdkConfig,
  Ec as setAssistantEventHooks,
  Cc as setAssistantPageContext,
  Lc as setAssistantReferenceProjectsProvider,
  Tc as setAssistantToolDisplayNames,
  Rc as setIaLocale,
  Ic as setRunContext,
  Mc as setSubAgentToolNames
};
