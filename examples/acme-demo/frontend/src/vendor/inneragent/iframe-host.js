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
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
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
    return new Promise((resolve, reject) => {
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
          resolve();
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
  async function serveTokenRequest(request) {
    try {
      const token = await options.tokenGetter();
      if (destroyed) return;
      const reply = createMessage("token", {
        token,
        reason: request.payload?.reason ?? "refresh"
      }, request.nonce);
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
  createIframeEmbed
};
