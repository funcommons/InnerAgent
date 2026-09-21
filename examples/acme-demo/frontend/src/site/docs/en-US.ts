import type { DocLocaleContent } from './types'

/**
 * Documentation content (English). Internalized from docs/接入指南.md and
 * rewritten for the public docs site. Must stay structurally identical to
 * zh-CN.ts (same sections, block types, table shapes) — enforced by tests.
 * Port baseline: InnerAgent server 18090, host backend 9300.
 */
const enUS: DocLocaleContent = [
  {
    id: 'quickstart',
    title: 'Quick Start',
    summary: 'Zero to a working conversation in three steps: starter → bridge config → embed.',
    next: 'app-registration',
    blocks: [
      { type: 'p', text: 'Prerequisites: InnerAgent server deployed (port 18090 in the examples); the host is a Spring Boot Servlet web app (Java 21). Finish the three steps below and your users can drive the app with natural language.' },
      { type: 'h', text: '1. Add the starter + write tools' },
      { type: 'code', lang: 'xml', code: '<dependency>\n  <groupId>com.inneragent</groupId>\n  <artifactId>inneragent-spring-boot-starter</artifactId>\n  <version>0.1.0-SNAPSHOT</version>\n</dependency>' },
      { type: 'p', text: 'The starter auto-wires the /ia-mcp bridge and X-IA-Act verification (conditional on a Servlet web app and inneragent.bridge.enabled=true, default true) — no @EnableXxx annotations needed. Expose business capabilities as MCP tools with @IaTool; see the Tool Bridge chapter.' },
      { type: 'callout', tone: 'warn', text: 'Tool parameter names rely on the -parameters compiler flag; if your module does not enable it, always write @IaToolParam(value="...") explicitly — missing names throw immediately.' },
      { type: 'h', text: '2. Bridge config (minimal yaml)' },
      { type: 'code', lang: 'yaml', code: 'inneragent:\n  bridge:\n    # InnerAgent server base (the host pulls JWKS from here to verify act tokens)\n    server-base: http://localhost:18090\n    act:\n      # The one critical line: must exactly match the endpoint_url registered in the admin plane\n      audiences:\n        - http://localhost:18091/ia-mcp' },
      { type: 'p', text: 'act.audiences ships with a placeholder — leaving it wrong is the classic failure. InnerAgent issues act tokens with aud = the registered endpoint_url; the host filter matches exactly, and a mismatch means every /ia-mcp call returns 401 (fail-closed). Troubleshooting rule: align "yaml audiences = admin-side endpoint_url" first, everything else second.' },
      { type: 'h', text: '3. Embed the frontend' },
      { type: 'code', lang: 'js', code: "const sdk = await import('/js/inneragent-chat.js')\n\nsdk.init({\n  appKey: 'my-host-app',         // matches the appKey registered in the admin plane\n  baseURL: '/ia/api/v1',         // absolute URL for cross-domain deployments\n  agentType: 'my_agent',\n  tokenGetter: async () => {     // cache + refresh near expiry; must be callable repeatedly\n    const res = await fetch('/host/api/embed-token', { credentials: 'include' })\n    return res.ok ? res.text() : null\n  },\n})\nsdk.registerInnerAgentChat()     // registers <inneragent-chat> (idempotent)" },
      { type: 'p', text: 'The full tokenGetter contract (lazy loading, 401 re-fetch, null semantics) is in the Frontend Embed chapter. After embedding, finish app onboarding in the admin plane and the loop is closed.' },
    ],
  },
  {
    id: 'app-registration',
    title: 'App Onboarding & Public Key',
    summary: 'Register the app, its RSA public key and tool entries in the admin plane — once; runtime does not depend on it.',
    next: 'embed-token',
    blocks: [
      { type: 'p', text: 'The admin plane authenticates two ways: automation/scripts use the X-IA-Admin-Key header (the server-side IA_ADMIN_KEY env; the admin plane is 403-closed when unset), humans use an admin login session. These examples use the key header.' },
      { type: 'h', text: 'Register the app (upload the RSA public key)' },
      { type: 'code', lang: 'bash', code: '# Generate the host signing keypair (private key stays with the host; register the public key)\nopenssl genrsa 2048 | openssl rsa -pubout\n\ncurl -s -X POST "http://localhost:18090/ia/api/v1/admin/apps" \\\n  -H "X-IA-Admin-Key: ${IA_ADMIN_KEY}" -H \'Content-Type: application/json\' -d \'{\n    "appKey": "my-host-app",\n    "name": "ACME Demo App",\n    "signPublicKey": "-----BEGIN PUBLIC KEY-----\\n...\\n-----END PUBLIC KEY-----",\n    "webhookUrl": "https://host.example.com/ia/webhook",\n    "webhookSecret": "whsec-9f2c1ab77d"\n  }\'' },
      { type: 'list', items: [
        'signPublicKey accepts RSA public-key PEM only; invalid PEM → 400; duplicate appKey → 409.',
        'The response data.signKeyFingerprint (first 16 hex chars of SHA-256) is for verifying the key pairing.',
        'webhook can be provided at registration or later via PUT /ia/api/v1/admin/webhooks/config.',
      ] },
      { type: 'h', text: 'Register tools (the host bridge does not push)' },
      { type: 'p', text: 'At startup the starter registers @IaTool methods into the in-process MCP server inside the host; InnerAgent discovers the catalog by fingerprint-polling tools/list against endpoint_url periodically. Registry entries are written by the host via the admin API:' },
      { type: 'code', lang: 'bash', code: 'curl -s -X POST "http://localhost:18090/ia/api/v1/admin/tools" \\\n  -H "X-IA-Admin-Key: ${IA_ADMIN_KEY}" -H \'Content-Type: application/json\' -d \'{\n  "serverKey": "my-host-app",\n  "toolName": "get_customer",\n  "description": "Look up customer info by ID",\n  "riskLevel": "low",\n  "source": "host_app",\n  "endpointUrl": "http://localhost:18091/ia-mcp",\n  "parametersSchema": "{\\"type\\":\\"object\\",\\"properties\\":{\\"customer_id\\":{\\"type\\":\\"string\\"}},\\"required\\":[\\"customer_id\\"]}"\n}\'' },
      { type: 'list', items: [
        'endpointUrl is the host bridge address and must exactly match act.audiences.',
        'serverKey allows letters/digits/hyphens only (no underscores); source is host_app or third_party.',
        'The model-visible name is the deterministic FQN: mcp__<serverKey>__<toolName>.',
        'riskLevel vocabulary is low/medium/high (the starter annotation vocabulary READ/WRITE/DESTRUCTIVE applies to tool methods only).',
      ] },
      { type: 'callout', tone: 'info', text: 'Write-tool grants normally come from the user on the confirm card (once / this conversation / always / deny); admins can pre-grant via POST /ia/api/v1/admin/grants (scope = permanent | conversation).' },
    ],
  },
  {
    id: 'embed-token',
    title: 'embed token',
    summary: 'The user token signed by the host private key: claims table, lifecycle and rotation grace.',
    next: 'frontend-embed',
    blocks: [
      { type: 'p', text: 'The embed token is signed RS256 by the host backend (the private key never leaves the host) and presented by the SDK to InnerAgent. Required claims: iss / sub / exp.' },
      { type: 'table', head: ['claim', 'required', 'meaning'], rows: [
        ['iss', 'yes', 'the appKey; the server locates the app row by it'],
        ['sub', 'yes', 'end-user ID (numeric string) from the host user system'],
        ['exp', 'yes', 'expiry, chosen by the host; the server suggests 12h'],
        ['tenantId', 'no', 'optional tenant ID'],
        ['aud', '—', 'no such claim; the RS256 algorithm is strictly enforced'],
      ] },
      { type: 'h', text: 'Lifecycle (what the SDK does)' },
      { type: 'list', items: [
        'The SDK calls tokenGetter before every HTTP request and every SSE connection — cache inside the callback and refresh near expiry instead of hitting the host endpoint per request.',
        'On 401 the SDK re-calls tokenGetter and retries exactly once with the new token; concurrent 401s are merged (single-flight).',
        'Returning null means the host explicitly has no token: the SDK does not retry and throws 401 (never signal "no token" by throwing).',
      ] },
      { type: 'h', text: 'Issuing endpoint example (nimbus-jose-jwt skeleton)' },
      { type: 'code', lang: 'java', code: '@GetMapping("/host/api/embed-token")\npublic String token() throws JOSEException {\n    long now = System.currentTimeMillis() / 1000;\n    JWTClaimsSet claims = new JWTClaimsSet.Builder()\n            .issuer("my-host-app")          // iss = appKey\n            .subject("10086")               // sub = host user ID (numeric string)\n            .claim("tenantId", 1L)          // optional\n            .issueTime(new Date(now * 1000))\n            .expirationTime(new Date((now + 12 * 3600) * 1000)) // suggested 12h\n            .build();\n    SignedJWT jwt = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).build(), claims);\n    jwt.sign(new RSASSASigner(privateKey)); // pairs with the registered signPublicKey\n    return jwt.serialize();\n}' },
      { type: 'h', text: 'Key rotation & the 72h dual-key grace' },
      { type: 'p', text: 'Submitting a different signPublicKey in the admin plane triggers rotation: the old public key moves into a grace window (embed-key-grace, default 72h; accepts 30m/7d etc.; 0 disables). Tokens signed by the old key keep verifying during the grace window — publish the new private key to your issuing service within the window and existing users are never bulk-signed-out.' },
    ],
  },
  {
    id: 'frontend-embed',
    title: 'Frontend Embed',
    summary: 'Two modes — WC mount (recommended) and iframe postMessage. The token never goes in the URL.',
    next: 'tool-bridge',
    blocks: [
      { type: 'h', text: 'Mode 1: Web Component mount (recommended)' },
      { type: 'code', lang: 'html', code: '<inneragent-chat id="chat" view="chat"></inneragent-chat>\n<style> inneragent-chat { display: block; height: 560px; } </style>\n<script type="module">\n  const sdk = await import(\'/js/inneragent-chat.js\')\n\n  sdk.init({\n    appKey: \'my-host-app\',\n    baseURL: \'/ia/api/v1\',            // default; absolute URL for cross-domain\n    agentType: \'my_agent\',\n    tokenGetter: async () => {\n      const res = await fetch(\'/host/api/embed-token\', { credentials: \'include\' })\n      if (!res.ok) return null         // no token → SDK does not retry, throws 401\n      return res.text()\n    },\n    // theme: { \'--ia-primary\': \'#0ea5e9\' },  // optional theme tokens\n  })\n  sdk.registerInnerAgentChat()         // registers <inneragent-chat> (idempotent)\n<\/script>' },
      { type: 'list', items: [
        'Lazy loading: tokenGetter runs before every request/connection — cache and refresh near exp inside the callback.',
        '401 re-fetch: the SDK retries exactly once with the fresh token, concurrent 401s single-flight — the callback must tolerate repeated calls.',
        'null semantics: null = explicitly no token, no retry.',
      ] },
      { type: 'h', text: 'Mode 2: iframe postMessage' },
      { type: 'p', text: 'The frame src carries only a page URL, never a token; after the handshake (origin verification) the token is delivered over the message bridge. Choose this when you need a stronger isolation boundary.' },
      { type: 'code', lang: 'js', code: "import { createIframeEmbed } from '/js/iframe-host.js'\n\nconst embed = createIframeEmbed({\n  src: 'https://host.example.com/ia/frame.html', // src carries no token\n  appKey: 'my-host-app',\n  tokenGetter: async () => fetch('/host/api/embed-token').then(r => r.text()),\n  container: document.getElementById('chat'),\n})\nawait embed.ready   // resolves once the handshake (origin check) succeeds" },
      { type: 'callout', tone: 'warn', text: 'For production, add an explicit sandbox to the iframe and configure the origin allowlist and CSP for your deployment domains.' },
    ],
  },
  {
    id: 'tool-bridge',
    title: 'Tool Bridge',
    summary: '@IaTool annotations, risk levels vs. confirmation behavior, and the bridge config switches.',
    next: 'webhook',
    blocks: [
      { type: 'h', text: '@IaTool / @IaToolParam' },
      { type: 'table', head: ['Annotation', 'Meaning', 'Default'], rows: [
        ['@IaTool.name', 'MCP tool name (unique within the bridge)', 'method name'],
        ['@IaTool.description', 'Model-visible description', 'tool name'],
        ['@IaTool.riskLevel', 'READ / WRITE / DESTRUCTIVE', 'WRITE'],
        ['@IaToolParam.value', 'Parameter name', 'reflected name (needs -parameters)'],
        ['@IaToolParam.description', 'Parameter description (into the schema)', 'none'],
        ['@IaToolParam.required', 'Included in the schema required array', 'true (conservative)'],
      ] },
      { type: 'h', text: 'A read + a write example' },
      { type: 'code', lang: 'java', code: '@Component\npublic class CrmTools {\n\n    /** READ → auto-executed at the DEFAULT level, no interruption */\n    @IaTool(name = "get_customer",\n            description = "Look up customer info by ID",\n            riskLevel = ToolRiskLevel.READ)\n    public Map<String, Object> getCustomer(\n            @IaToolParam(value = "customer_id") String customerId,\n            IaActClaims claims) {                    // trailing act identity (optional)\n        ...\n    }\n\n    /** WRITE → confirm first at the DEFAULT level; "always allow" available */\n    @IaTool(name = "update_customer_level",\n            description = "Update customer level (normal/silver/gold)",\n            riskLevel = ToolRiskLevel.WRITE)\n    public Map<String, Object> updateCustomerLevel(\n            @IaToolParam(value = "customer_id") String customerId,\n            @IaToolParam(value = "level") String level,\n            IaActClaims claims) {\n        ... // final row-level authorization stays on the host — see Security Boundaries\n    }\n}' },
      { type: 'list', items: [
        'READ → readOnlyHint=true, auto-executed at DEFAULT; WRITE → confirm first, with the four-option card: once / this conversation / always / deny.',
        'DESTRUCTIVE → destructiveHint=true, forced high-risk at registration, always confirmed.',
        'Returned Maps go into structuredContent as-is; any thrown exception → isError=true + {"status":"error"} fed back to the model — the run does not terminate.',
      ] },
      { type: 'h', text: 'Bridge config & switches' },
      { type: 'table', head: ['Key', 'Default', 'Meaning'], rows: [
        ['inneragent.bridge.enabled', 'true', 'false = do not wire the bridge (one-switch off)'],
        ['inneragent.bridge.server-base', 'none', 'server base; missing → /ia-mcp 401s wholesale (JWKS unreachable)'],
        ['inneragent.bridge.endpoint', '/ia-mcp', 'host bridge MCP endpoint path'],
        ['inneragent.bridge.tool-packages', 'empty', 'packages to scan for non-bean tool classes'],
        ['inneragent.bridge.scan.fail-fast', 'true', 'block startup on duplicate tools / schema failures'],
        ['inneragent.bridge.act.audiences', '[ia-mcp] (placeholder)', 'expected aud — must become the real endpointUrl'],
        ['inneragent.bridge.act.cache-ttl', '5m', 'JWKS periodic refresh'],
        ['inneragent.bridge.act.key-retention', '72h', 'local retention for disappeared keys (rotation grace)'],
      ] },
      { type: 'callout', tone: 'warn', text: 'Troubleshooting rule: align "yaml act.audiences = the endpoint_url registered in the admin plane" first; mismatches return a uniform 401 invalid_act_token with no failure detail.' },
    ],
  },
  {
    id: 'webhook',
    title: 'Webhook',
    summary: 'Run-terminal callbacks: subscribable events, HMAC verification essentials, retry semantics.',
    next: 'security',
    blocks: [
      { type: 'p', text: 'Subscribable events: run.finished / run.failed / run.cancelled. Non-2xx responses back off 1m → 5m → 30m → 2h → 12h, at most 5 attempts (including the first); after EXHAUSTED only a manual redeliver helps. Payload: {event, appId, runId, status, finishedAt, errorCode?, errorMessage?}.' },
      { type: 'h', text: 'Verification essentials' },
      { type: 'list', items: [
        'Four headers: X-IA-Signature, X-IA-Timestamp (epoch ms), X-IA-Nonce, X-IA-Delivery (your idempotency key).',
        'The signature is HMAC-SHA256(secret, "timestamp.nonce.body"), lowercase hex; recompute over the raw bytes — never over a re-serialized body.',
        'Deduplicate by X-IA-Delivery; validate the timestamp window to block replays.',
        'Fail fast with non-2xx on bad signatures; with no secret configured, answer 503 uniformly (an ops problem — do not attempt verification).',
      ] },
      { type: 'code', lang: 'js', code: "import crypto from 'node:crypto'\n\nconst expected = crypto.createHmac('sha256', webhookSecret)\n  .update(`${timestamp}.${nonce}.${rawBody}`)\n  .digest('hex')\nif (expected !== signature) return res.status(401).end()\n\nif (await seenBefore(deliveryId)) return res.status(200).end()  // idempotency\nawait handleEvent(JSON.parse(rawBody))\nres.status(200).end()                                           // ack fast" },
      { type: 'callout', tone: 'info', text: 'Connectivity check: POST /ia/api/v1/admin/webhooks/config/test in the admin plane sends one really-signed delivery and returns {ok, signatureValid, httpStatus}.' },
    ],
  },
  {
    id: 'security',
    title: 'Security Boundaries',
    summary: 'What the platform guards vs. what you guard; the pre-production checklist.',
    next: 'endpoints',
    blocks: [
      { type: 'table', head: ['Dimension', 'Host (you)', 'InnerAgent'], rows: [
        ['Signing keys', 'RSA private key never leaves the host', 'Stores the public key only; 72h rotation grace'],
        ['User identity', 'Issue embed tokens only to authenticated users', 'RS256 strict verification; 60s act-token inner loop'],
        ['Authorization', 'Row-level checks on IaActClaims.userId inside tools', 'Only transports and presents resolve_scope'],
        ['Write confirmation', 'Implement resolve_scope to avoid degraded UX', 'Without it, writes always ASK and grants cannot bypass'],
        ['Audit', 'Self-evident compliance on the tool side', 'Append-only audit + read-time masking + decision_source'],
      ] },
      { type: 'p', text: 'resolve_scope is a host contract: implementing the same-named tool in your catalog counts as "implemented"; all four returned arrays are lenient (missing fields read as empty) — the host is the final arbiter of the protocol. Not implementing it is not unsafe, but every write then requires confirmation (scopeDegraded).' },
      { type: 'h', text: 'Pre-production checklist' },
      { type: 'list', items: [
        'Turn off allow-anonymous-demo (never enable in production).',
        'Inject IA_ADMIN_KEY / IA_ADMIN_SESSION_SECRET / IA_ACT_KEY_PEM (act keys are ephemeral if unset — rotated on restart).',
        'Remove mock model configs; align act.audiences with endpoint_url.',
        'iframe mode: explicit sandbox + deployment-scoped allowedOrigins and CSP.',
        'webhook secret configured; verification recomputes over raw bytes and deduplicates.',
        'Attachments: base64 ≤ 10MB works out of the box; url transport requires the model provider to reach the InnerAgent API (a deployment precondition).',
      ] },
    ],
  },
  {
    id: 'endpoints',
    title: 'Endpoints Cheat Sheet',
    summary: 'Common endpoints of this demo host backend and the InnerAgent server.',
    next: null,
    blocks: [
      { type: 'p', text: 'Port baseline: InnerAgent server 18090, this demo host backend 9300. In frontend dev mode /api proxies to :9300 and /ia proxies to :18090.' },
      { type: 'table', head: ['Method', 'Path', 'Purpose', 'Auth'], rows: [
        ['POST', '/api/demo/login', 'Demo login (any username), returns a session token', 'public'],
        ['GET', '/api/ia/embed-token', 'Issues the embed token (RS256, iss=appKey, sub=user ID, exp 12h)', 'demo session'],
        ['GET', '/api/ia/server-status', 'Onboarding self-check (registered/not_registered/unreachable/admin_key_missing)', 'demo session'],
        ['GET', '/api/demo/config', 'Public config (inneragentBaseUrl / appKey / agentType)', 'public'],
        ['POST', '/ia/api/v1/runs', 'Start a run (SSE stream; agentType in the body)', 'embed token'],
        ['POST', '/ia/api/v1/runs/{runId}/confirm', 'Tool confirmation (approve/deny per toolCallId)', 'embed token'],
        ['GET', '/.well-known/jwks.json', 'act-token JWKS (server root, no /ia prefix)', 'public'],
        ['POST', '/ia-mcp', 'Host bridge MCP endpoint (tools/list · tools/call, stateless)', 'X-IA-Act (60s)'],
        ['POST', '/ia/webhook', 'Run-terminal callback (X-IA-Signature HMAC)', 'HMAC'],
      ] },
      { type: 'callout', tone: 'info', text: 'Want to mint an embed token yourself? Open the API playground — any username runs the full login → issue → claims-decode flow.' },
    ],
  },
]

export default enUS
