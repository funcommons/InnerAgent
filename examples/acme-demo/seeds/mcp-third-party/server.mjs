#!/usr/bin/env node
// =============================================================================
// server.mjs — ACME 三方 MCP 演示服务器(零依赖 Node ≥18,streamable-http)
//
// 协议面(与 InnerAgent HttpClientStreamableHttpTransport 对齐的最小实现):
//   POST /mcp  initialize            → JSON-RPC result + Mcp-Session-Id 响应头
//   POST /mcp  notifications/initialized 等 Notification → 202(无体)
//   POST /mcp  tools/list            → echo 工具清单
//   POST /mcp  tools/call echo       → 文本回显
//   POST /mcp  ping                  → {}
//   GET  /mcp                       → 405(无服务器→客户端 SSE 流)
// 鉴权:静态头(STATIC_HEADER 语义)——每次请求必须携带
//   ${HEADER_NAME:-X-ACME-Token}: ${ECHO_TOKEN:-acme-echo-secret},否则 401。
//
// 用法:
//   node server.mjs                 # 起服务(默认 127.0.0.1:9401)
//   node server.mjs --selftest      # 自测:initialize → tools/list → tools/call
// 自测脚本全绿后再经管理面注册,排障口诀:先 401 后 404,最后才看 JSON-RPC。
// =============================================================================
import http from "node:http";

const PORT = Number(process.env.PORT || 9401);
const HOST = process.env.HOST || "127.0.0.1";
const HEADER_NAME = (process.env.HEADER_NAME || "X-ACME-Token").toLowerCase();
const ECHO_TOKEN = process.env.ECHO_TOKEN || "acme-echo-secret";
const SERVER_INFO = { name: "acme-echo-mcp", version: "1.0.0" };
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const ECHO_TOOL = {
  name: "echo",
  description: "回显工具:原样返回 message,并附服务器时间;用于三方 MCP 链路演示。",
  inputSchema: {
    type: "object",
    properties: {
      message: { type: "string", description: "要回显的消息文本" },
    },
    required: ["message"],
    additionalProperties: false,
  },
};

// ---------- JSON-RPC 组装 ----------

const jsonRpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const jsonRpcError = (id, code, message) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

const ERR_PARSE = -32700;
const ERR_INVALID_REQUEST = -32600;
const ERR_METHOD_NOT_FOUND = -32601;
const ERR_INVALID_PARAMS = -32602;

function handleRpc(msg) {
  if (msg === null || typeof msg !== "object" || Array.isArray(msg)) {
    return { http: 400, body: jsonRpcError(null, ERR_INVALID_REQUEST, "请求必须为 JSON-RPC 对象") };
  }
  const isNotification = msg.id === undefined || msg.id === null;
  switch (msg.method) {
    case "initialize": {
      if (isNotification) {
        return { http: 400, body: jsonRpcError(null, ERR_INVALID_REQUEST, "initialize 不允许作为通知") };
      }
      const requested = msg.params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[1];
      return {
        http: 200,
        headers: { "Mcp-Session-Id": `acme-echo-${Date.now()}` },
        body: jsonRpcResult(msg.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        }),
      };
    }
    case "tools/list":
      return isNotification
        ? { http: 202 }
        : { http: 200, body: jsonRpcResult(msg.id, { tools: [ECHO_TOOL] }) };
    case "tools/call": {
      if (isNotification) return { http: 202 };
      if (msg.params?.name !== ECHO_TOOL.name) {
        return {
          http: 200,
          body: jsonRpcResult(msg.id, {
            content: [{ type: "text", text: `未知工具: ${msg.params?.name}` }],
            isError: true,
          }),
        };
      }
      const message = msg.params?.arguments?.message;
      if (typeof message !== "string" || message.length === 0) {
        return {
          http: 200,
          body: jsonRpcResult(msg.id, {
            content: [{ type: "text", text: "参数 message 必须为非空字符串" }],
            isError: true,
          }),
        };
      }
      return {
        http: 200,
        body: jsonRpcResult(msg.id, {
          content: [{
            type: "text",
            text: `[acme-echo @ ${new Date().toISOString()}] ${message}`,
          }],
        }),
      };
    }
    case "ping":
      return isNotification ? { http: 202 } : { http: 200, body: jsonRpcResult(msg.id, {}) };
    default:
      // Notification(如 notifications/initialized)按 202 静默;未知请求回 -32601
      return isNotification
        ? { http: 202 }
        : { http: 200, body: jsonRpcError(msg.id, ERR_METHOD_NOT_FOUND, `未知方法: ${msg.method}`) };
  }
}

// ---------- HTTP 面 ----------

function authed(req) {
  return req.headers[HEADER_NAME] === ECHO_TOKEN;
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/mcp") {
    res.writeHead(405, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "本演示服务器不提供服务器→客户端 SSE 流(GET)" }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/mcp") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "仅支持 POST /mcp" }));
    return;
  }
  if (!authed(req)) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify(jsonRpcError(null, ERR_INVALID_REQUEST, `缺少或错误的静态头 ${HEADER_NAME}`)));
    return;
  }
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "null");
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify(jsonRpcError(null, ERR_PARSE, "请求体不是合法 JSON")));
      return;
    }
    const isBatch = Array.isArray(parsed);
    const messages = isBatch ? parsed : [parsed];
    if (messages.length === 0) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify(jsonRpcError(null, ERR_INVALID_REQUEST, "批量请求不允许为空数组")));
      return;
    }
    const results = [];
    let httpStatus = 200;
    let headers = {};
    for (const message of messages) {
      const outcome = handleRpc(message);
      if (outcome.http !== 200) httpStatus = outcome.http;
      if (outcome.headers) headers = { ...headers, ...outcome.headers };
      if (outcome.body && (message.id !== undefined && message.id !== null)) results.push(outcome.body);
    }
    const head = { "content-type": "application/json", ...headers };
    if (results.length === 0) {
      // 纯通知:202 无响应体
      res.writeHead(httpStatus === 200 ? 202 : httpStatus, head);
      res.end();
      return;
    }
    res.writeHead(httpStatus, head);
    res.end(JSON.stringify(isBatch ? results : results[0]));
  });
});

// ---------- 自测 ----------

async function selftest() {
  await new Promise((resolve) => server.listen(0, HOST, resolve));
  const base = `http://${HOST}:${server.address().port}/mcp`;
  const call = async (body, headers = {}, omitAuth = false) => {
    const response = await fetch(base, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(omitAuth ? {} : { [HEADER_NAME]: ECHO_TOKEN }),
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, sessionId: response.headers.get("mcp-session-id"), text };
  };
  const assert = (cond, label) => {
    if (!cond) {
      console.error(`SELFTEST FAIL: ${label}`);
      process.exitCode = 1;
    } else {
      console.log(`SELFTEST ok: ${label}`);
    }
  };
  const noAuth = await call({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {}, true);
  assert(noAuth.status === 401, "缺静态头 → 401(STATIC_HEADER 语义)");
  const init = await call({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "selftest", version: "0" } },
  });
  assert(init.status === 200 && init.text.includes("serverInfo"), "initialize 应答 serverInfo");
  assert(!!init.sessionId, "initialize 下发 Mcp-Session-Id");
  const inited = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert(inited.status === 202, "notifications/initialized → 202");
  const list = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { "mcp-session-id": init.sessionId });
  assert(list.status === 200 && list.text.includes("echo"), "tools/list 暴露 echo");
  const echoed = await call(
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { message: "你好,InnerAgent" } } },
    { "mcp-session-id": init.sessionId },
  );
  assert(echoed.status === 200 && echoed.text.includes("你好,InnerAgent"), "tools/call echo 回显成功");
  server.close();
}

const selftestRequested = process.argv.includes("--selftest");
if (selftestRequested) {
  await selftest();
} else {
  server.listen(PORT, HOST, () => {
    console.log(`acme-echo-mcp listening on http://${HOST}:${PORT}/mcp (header=${HEADER_NAME})`);
  });
}
