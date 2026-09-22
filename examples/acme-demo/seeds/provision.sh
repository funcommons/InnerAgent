#!/usr/bin/env zsh
# =============================================================================
# provision.sh — acme-demo 五个仿真场景 Agent 一键 provisioning(幂等,可重复执行)
#
# 前置:InnerAgent server 已起(zsh e2e/env.sh up;IA_ADMIN_KEY=test-key)
# 用法:zsh seeds/provision.sh
#
# 步骤:
#   [1] 解析/创建应用(appKey=acme-demo;宿主签名密钥首次自动生成于 seeds/.local/)
#   [2] dryRun 导入 agent-bundle.json(5 main + 3 sub;0 error 才继续)
#   [3] 真实导入 bundle(conflictPolicy=overwrite)并回查确认
#   [4] Skill report-style:构建 + 预览 + 导入 + 激活(激活上限 8,先查已激活)
#   [5] 摄取 KB 文档(同名文档按 PUT 更新重分块,幂等)
#   [6] 注册宿主桥工具(create_ticket/list_tickets/resolve_scope/query_sales;已注册跳过)
#   [7] 注册三方 MCP 演示服务器 acme-echo(ACME_SKIP_MCP=1 可跳过)
# 最后输出「场景 × 能力」矩阵小结。
# =============================================================================

set -euo pipefail
SEEDS_DIR="${0:A:h}"
BASE_URL="${IA_BASE_URL:-http://localhost:18090}"
ADMIN_KEY="${IA_ADMIN_KEY:-test-key}"
ACME_APP_KEY="${ACME_APP_KEY:-acme-demo}"
ACME_APP_NAME="${ACME_APP_NAME:-ACME 演示应用}"
ACME_WEBHOOK_URL="${ACME_WEBHOOK_URL:-http://localhost:9300/ia/webhook}"
ACME_WEBHOOK_SECRET="${ACME_WEBHOOK_SECRET:-whsec-acme-demo-seed}"
KEYS_DIR="$SEEDS_DIR/.local"
TMP_JSON="$(mktemp "${TMPDIR:-/tmp}/acme-provision.XXXXXX")"
trap 'rm -f "$TMP_JSON"' EXIT

step() { print -P "\n%F{cyan}== $* ==%f"; }
ok()   { print -P "  %F{green}✓%f $*"; }
warn() { print -P "  %F{yellow}!%f $*"; }
fail() { print -P "  %F{red}✗%f $*" >&2; exit 1; }

# ---------- API 小工具 ----------
# api <method> <route> [curl extra args...];结果:REPLY_CODE / REPLY_BODY
# 注意:zsh 的 path 是 PATH 的绑定数组,严禁用作局部变量名(会静默清空 PATH)
api() {
  local method="$1" route="$2"; shift 2
  REPLY_CODE=$(curl -sS -o "$TMP_JSON" -w '%{http_code}' -X "$method" \
    "${BASE_URL}${route}" -H "X-IA-Admin-Key: ${ADMIN_KEY}" "$@") \
    || fail "请求失败: $method $route(服务是否已起?${BASE_URL})"
  REPLY_BODY=$(cat "$TMP_JSON")
}

# jpy <expr>:对 REPLY_BODY(JSON)求 python 表达式(数据绑定为变量 d)
jpy() {
  python3 -c '
import json, sys
d = json.loads(sys.stdin.read())
v = eval(sys.argv[1])
print(v if isinstance(v, (str, int, float, bool)) or v is None
      else json.dumps(v, ensure_ascii=False))' "$1" <<< "$REPLY_BODY"
}

# ---------------------------------------------------------------------------
step "[0/7] 连通 InnerAgent: ${BASE_URL}(admin key **尾3位 ${ADMIN_KEY: -3})"
api GET "/.well-known/jwks.json"
[[ "$REPLY_CODE" == "200" ]] || fail "服务不可达: HTTP $REPLY_CODE"
ok "服务在线"

# ---------------------------------------------------------------------------
step "[1/7] 宿主签名密钥 + 应用解析/创建(appKey=${ACME_APP_KEY})"
mkdir -p "$KEYS_DIR"
NEW_KEYS=0
if [[ ! -f "$KEYS_DIR/host.key" ]]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 \
    -out "$KEYS_DIR/host.key" 2>/dev/null
  openssl pkey -in "$KEYS_DIR/host.key" -pubout -out "$KEYS_DIR/host.pub" 2>/dev/null
  NEW_KEYS=1
  ok "已生成宿主签名密钥对: $KEYS_DIR/host.key(+host.pub)"
else
  ok "复用既有宿主签名密钥: $KEYS_DIR/host.key"
fi
api GET "/ia/api/v1/admin/apps"
[[ "$REPLY_CODE" == "200" ]] || fail "应用列表失败: HTTP $REPLY_CODE"
APP_ID=$(jpy "next((a['id'] for a in d['data'] if a['appKey']=='${ACME_APP_KEY}'), None)")
if [[ "$APP_ID" != "None" && -n "$APP_ID" ]]; then
  ok "应用已存在: appId=${APP_ID}"
  # 幂等公钥对齐:seeds/.local 密钥再生(目录丢失/换机)后,已登记公钥会与本机
  # host.pub 脱钩 → embed token 全部 401「签名不匹配」(2026-09-22 真机踩坑:
  # 只在创建时注册公钥,已存在仅告警,不变量悄悄断掉)。此处检测不一致即轮换对齐。
  api GET "/ia/api/v1/admin/apps/${APP_ID}"
  [[ "$REPLY_CODE" == "200" ]] || fail "应用详情失败: HTTP $REPLY_CODE"
  # 指纹口径与 server 一致:sha256(DER) 前 16 hex 位(signKeyFingerprint)
  LOCAL_FP=$(openssl rsa -in "$KEYS_DIR/host.key" -pubout -outform DER 2>/dev/null \
    | openssl dgst -sha256 | awk '{print substr($2, 1, 16)}')
  REMOTE_FP=$(jpy "d['data'].get('signKeyFingerprint') or ''")
  if [[ -n "$REMOTE_FP" && "$REMOTE_FP" != "$LOCAL_FP" ]]; then
    SIGN_PUB=$(python3 -c 'import sys; print(open(sys.argv[1]).read())' "$KEYS_DIR/host.pub")
    python3 -c 'import json,sys
print(json.dumps({"signPublicKey": sys.argv[1]}))' "$SIGN_PUB" > "$TMP_JSON"
    api PUT "/ia/api/v1/admin/apps/${APP_ID}" -H 'Content-Type: application/json' \
      --data-binary @"$TMP_JSON"
    [[ "$REPLY_CODE" == "200" ]] || fail "公钥轮换对齐失败: HTTP $REPLY_CODE $(cat "$TMP_JSON")"
    ok "已登记公钥(${REMOTE_FP}…)与本机 host.pub(${LOCAL_FP}…)不一致 → 已轮换对齐"
  else
    ok "已登记公钥与本机 host.pub 一致(${LOCAL_FP}…)"
  fi
else
  SIGN_PUB=$(python3 -c 'import sys; print(open(sys.argv[1]).read())' "$KEYS_DIR/host.pub")
  python3 -c '
import json, sys
print(json.dumps({
    "appKey": sys.argv[1], "name": sys.argv[2],
    "signPublicKey": sys.argv[3],
    "webhookUrl": sys.argv[4], "webhookSecret": sys.argv[5]}, ensure_ascii=False))' \
    "$ACME_APP_KEY" "$ACME_APP_NAME" "$SIGN_PUB" "$ACME_WEBHOOK_URL" "$ACME_WEBHOOK_SECRET" \
    > "$TMP_JSON"
  api POST "/ia/api/v1/admin/apps" -H 'Content-Type: application/json' \
    --data-binary @"$TMP_JSON"
  [[ "$REPLY_CODE" == "200" ]] || fail "应用创建失败: HTTP $REPLY_CODE $(cat "$TMP_JSON")"
  APP_ID=$(jpy "d['data']['id']")
  ok "应用已创建: appId=${APP_ID}"
fi
ok "宿主后端 IA_SIGN_PRIVATE_KEY 用: $KEYS_DIR/host.key"

# ---------------------------------------------------------------------------
step "[2/7] dryRun 导入 agent bundle(5 main + 3 sub)"
python3 -c '
import json, sys
bundle = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps({"bundle": bundle, "conflictPolicy": "overwrite", "dryRun": True},
                 ensure_ascii=False))' \
  "$SEEDS_DIR/agent-bundle.json" > "$TMP_JSON"
api POST "/ia/api/v1/admin/definitions/import?appId=${APP_ID}" \
  -H 'Content-Type: application/json' --data-binary @"$TMP_JSON"
[[ "$REPLY_CODE" == "200" ]] || fail "dryRun 请求失败: HTTP $REPLY_CODE $(cat "$TMP_JSON")"
DRY_ERR=$(jpy "len(d['data']['errors'])")
ok "dryRun 预演: created=$(jpy "d['data']['created']") updated=$(jpy "d['data']['updated']") errors=${DRY_ERR}"
if [[ "$DRY_ERR" != "0" ]]; then
  jpy "d['data']['errors']"
  fail "bundle 校验有错,中止(先修 agent-bundle.json 再重跑)"
fi

# ---------------------------------------------------------------------------
step "[3/7] 真实导入 bundle(conflictPolicy=overwrite)"
python3 -c '
import json, sys
bundle = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps({"bundle": bundle, "conflictPolicy": "overwrite", "dryRun": False},
                 ensure_ascii=False))' \
  "$SEEDS_DIR/agent-bundle.json" > "$TMP_JSON"
api POST "/ia/api/v1/admin/definitions/import?appId=${APP_ID}" \
  -H 'Content-Type: application/json' --data-binary @"$TMP_JSON"
[[ "$REPLY_CODE" == "200" ]] || fail "导入失败: HTTP $REPLY_CODE"
IMP_ERRORS=$(jpy "len(d['data']['errors'])")
ok "导入完成: created=$(jpy "d['data']['created']") updated=$(jpy "d['data']['updated']") errors=${IMP_ERRORS}"
[[ "$IMP_ERRORS" == "0" ]] || fail "导入出现条目级错误,中止"
# 回查:按 kind 分别确认 main/sub 定义都在库
api GET "/ia/api/v1/admin/definitions?appId=${APP_ID}&kind=main&pageNo=1&pageSize=50"
MAIN_N=$(jpy "d['data']['total']")
api GET "/ia/api/v1/admin/definitions?appId=${APP_ID}&kind=sub&pageNo=1&pageSize=50"
SUB_N=$(jpy "d['data']['total']")
ok "库内回查: main=${MAIN_N} sub=${SUB_N}(期望 5+3)"
[[ "$MAIN_N" == "5" && "$SUB_N" == "3" ]] || warn "定义数量与预期不符(5+3)"

# ---------------------------------------------------------------------------
# Skill:导入/激活 API 无显式 appId 面,行级拦截器按默认应用(id=1)回填——
# 与 KB/工具注册/三方 MCP 同居默认应用,保证「导入 → 激活 → 进运行上下文」通链
step "[4/7] Skill report-style:构建 + 预览 + 导入 + 激活(默认应用)"
zsh "$SEEDS_DIR/skills/build-skills.sh" > /dev/null
ok "zip 已构建: seeds/skills/report-style.zip"
api POST "/ia/api/v1/admin/skills/import/preview" \
  -F "file=@$SEEDS_DIR/skills/report-style.zip;type=application/zip"
[[ "$REPLY_CODE" == "200" ]] || fail "Skill 预览请求失败: HTTP $REPLY_CODE"
[[ "$(jpy "d['data']['valid']")" == "True" && "$(jpy "len(d['data']['errors'])")" == "0" ]] \
  || { jpy "d['data']['errors']"; fail "Skill 包校验未通过"; }
ok "预览校验通过(0 error)"
api POST "/ia/api/v1/admin/skills/import?overwrite=true" \
  -F "file=@$SEEDS_DIR/skills/report-style.zip;type=application/zip" \
  -F "displayName=ACME 报告写作规范"
[[ "$REPLY_CODE" == "200" ]] || fail "Skill 导入失败: HTTP $REPLY_CODE $(cat "$TMP_JSON")"
SKILL_ID=$(jpy "d['data']['id']")
ok "Skill 已导入(overwrite=true,同名覆盖): id=${SKILL_ID}"
if [[ "$(jpy "d['data']['active']")" == "True" ]]; then
  ok "Skill 已是激活态(跳过激活)"
else
  # 激活上限保护:应用内同时激活上限 8;已满则停用 id 最小(最早)的一个让位
  api GET "/ia/api/v1/admin/skills?pageNo=1&pageSize=100"
  ACTIVE_N=$(jpy "sum(1 for s in d['data']['list'] if s['active'])")
  if [[ "${ACTIVE_N:-0}" -ge 8 ]]; then
    OLDEST_ID=$(jpy "min(d['data']['list'], key=lambda s: s['id'])['id']")
    api POST "/ia/api/v1/admin/skills/${OLDEST_ID}/deactivate"
    [[ "$REPLY_CODE" == "200" ]] || fail "停用让位 Skill 失败: HTTP $REPLY_CODE"
    warn "激活已达 8 上限,已停用最早的 id=${OLDEST_ID} 让位(如需恢复请到管理站)"
  fi
  api POST "/ia/api/v1/admin/skills/${SKILL_ID}/activate"
  [[ "$REPLY_CODE" == "200" ]] || fail "Skill 激活失败: HTTP $REPLY_CODE $(cat "$TMP_JSON")"
  ok "Skill 已激活(应用内同时激活 ≤8)"
fi

# ---------------------------------------------------------------------------
step "[5/7] KB 文档摄取(同名更新重分块,幂等)"
api GET "/ia/api/v1/admin/kb/documents?pageNo=1&pageSize=100"
[[ "$REPLY_CODE" == "200" ]] || fail "KB 列表失败: HTTP $REPLY_CODE"
KB_LIST_JSON=$(jpy "d['data']['list']")
KB_IMPORTED=0
KB_UPDATED=0
for doc in "$SEEDS_DIR"/kb-docs/*.md(N); do
  DOC_TITLE=$(basename "$doc")
  DOC_ID=$(python3 -c '
import json, sys
rows, want = json.loads(sys.argv[1]), sys.argv[2]
print(next((r["id"] for r in rows if r["title"] == want), ""))' \
    "$KB_LIST_JSON" "$DOC_TITLE")
  python3 -c '
import json, sys
print(json.dumps({"title": sys.argv[1], "source": "seeds/kb-docs",
                  "content": open(sys.argv[2], encoding="utf-8").read(),
                  "metadata": json.dumps({"demo": "acme-seeds"}, ensure_ascii=False)},
                 ensure_ascii=False))' \
    "$DOC_TITLE" "$doc" > "$TMP_JSON"
  if [[ -n "$DOC_ID" ]]; then
    api PUT "/ia/api/v1/admin/kb/documents/${DOC_ID}" \
      -H 'Content-Type: application/json' --data-binary @"$TMP_JSON"
    [[ "$REPLY_CODE" == "200" ]] || fail "KB 更新失败(${DOC_TITLE}): HTTP $REPLY_CODE $(cat "$TMP_JSON")"
    ok "同名文档已更新并重分块: ${DOC_TITLE}(id=${DOC_ID}, $(jpy "d['data']['chunkCount']") 段)"
    KB_UPDATED=$((KB_UPDATED + 1))
  else
    api POST "/ia/api/v1/admin/kb/documents/import" \
      -H 'Content-Type: application/json' --data-binary @"$TMP_JSON"
    [[ "$REPLY_CODE" == "200" ]] || fail "KB 导入失败(${DOC_TITLE}): HTTP $REPLY_CODE $(cat "$TMP_JSON")"
    ok "文档已导入: ${DOC_TITLE}(id=$(jpy "d['data']['id']"), $(jpy "d['data']['chunkCount']") 段)"
    KB_IMPORTED=$((KB_IMPORTED + 1))
  fi
done
ok "KB 计数: 新导入 ${KB_IMPORTED} 篇 / 更新 ${KB_UPDATED} 篇"
# 检索冒烟:验证检索链路可用(有命中即 tsvector/分块正常)
Q=$(python3 -c 'from urllib.parse import quote; print(quote("年假有几天"))')
api GET "/ia/api/v1/admin/kb/documents/search?q=${Q}&topK=3"
if [[ "$REPLY_CODE" == "200" ]]; then
  HITS=$(jpy "len(d['data']['hits'])")
  [[ "${HITS:-0}" -gt 0 ]] \
    && ok "检索冒烟: q=年假有几天 → ${HITS} 条命中" \
    || warn "检索冒烟无命中(检查分块/降级标记 degraded)"
else
  warn "检索冒烟请求失败: HTTP $REPLY_CODE(跳过,不影响导入结果)"
fi

# ---------------------------------------------------------------------------
step "[6/7] 宿主桥工具注册(已注册跳过;endpoint 需与 demo 后端 act.audiences 一致)"
BRIDGE_ENDPOINT="${ACME_BRIDGE_ENDPOINT:-http://localhost:9300/ia-mcp}"
register_tool() { # register_tool <toolName> <description> <schemaJSON>
  local tool="$1" desc="$2" schema="$3"
  api GET "/ia/api/v1/admin/tools?serverKey=${ACME_APP_KEY}"
  [[ "$REPLY_CODE" == "200" ]] || fail "工具列表失败: HTTP $REPLY_CODE"
  if [[ "$(jpy "any(t['toolName']=='${tool}' for t in d['data'])")" == "True" ]]; then
    ok "已注册,跳过: ${tool}"
    return 0
  fi
  python3 -c '
import json, sys
print(json.dumps({"serverKey": sys.argv[1], "toolName": sys.argv[2],
                  "description": sys.argv[3], "riskLevel": "low",
                  "source": "host_app", "endpointUrl": sys.argv[4],
                  "parametersSchema": sys.argv[5]}, ensure_ascii=False))' \
    "$ACME_APP_KEY" "$tool" "$desc" "$BRIDGE_ENDPOINT" "$schema" > "$TMP_JSON"
  api POST "/ia/api/v1/admin/tools" -H 'Content-Type: application/json' \
    --data-binary @"$TMP_JSON"
  if [[ "$REPLY_CODE" == "200" ]]; then
    ok "工具已注册: ${tool}"
  elif [[ "$REPLY_CODE" == "409" ]]; then
    # 同 fqn 活跃行=幂等跳过;工具名被他 serverKey 占用=真冲突,把 msg 亮出来
    if [[ "$(jpy "'重名冲突' in (d['msg'] or '')")" == "True" ]]; then
      warn "工具名占用(409): ${tool} — $(jpy "d['msg']")(排查: GET /admin/tools 看 fqn)"
    else
      ok "已注册(409 幂等跳过): ${tool}"
    fi
  else
    fail "工具注册失败(${tool}): HTTP $REPLY_CODE $(cat "$TMP_JSON")"
  fi
}
register_tool "create_ticket" "在 ACME 宿主系统中创建一张工单,返回工单号" \
  '{"type":"object","properties":{"title":{"type":"string","description":"工单标题"},"description":{"type":"string"},"priority":{"type":"string","description":"low/normal/high"}}}'
register_tool "list_tickets" "列出 ACME 宿主系统中的工单(可按状态过滤)" \
  '{"type":"object","properties":{"status":{"type":"string","description":"open/done,缺省全部"}}}'
register_tool "resolve_scope" "返回当前页面上下文的可见域/可写字段/禁止操作" \
  '{"type":"object","properties":{"pageId":{"type":"string"},"objectId":{"type":"string"},"objectType":{"type":"string"}}}'
register_tool "query_sales" "查询 ACME 销售数据(区域×月份×产品,单位元)" \
  '{"type":"object","properties":{"month":{"type":"string","description":"YYYY-MM"},"region":{"type":"string","description":"华东/华北/华南"}}}'

# ---------------------------------------------------------------------------
MCP_NOTE="跳过(ACME_SKIP_MCP=1)"
if [[ "${ACME_SKIP_MCP:-0}" != "1" ]]; then
  step "[7/7] 三方 MCP 演示服务器(acme-echo)+ 管理面注册"
  MCP_PORT="${ACME_MCP_PORT:-9401}"
  MCP_URL="http://127.0.0.1:${MCP_PORT}/mcp"
  if curl -sS -o /dev/null --max-time 2 "$MCP_URL" 2>/dev/null; then
    ok "echo MCP 已在 ${MCP_URL} 运行,复用(不代起)"
    MCP_NOTE="复用既有进程"
  else
    ( cd "$SEEDS_DIR/mcp-third-party" && \
      PORT="$MCP_PORT" nohup node server.mjs > "${TMPDIR:-/tmp}/acme-echo-mcp.log" 2>&1 & echo $! > "${TMPDIR:-/tmp}/acme-echo-mcp.pid" )
    sleep 1
    if curl -sS -o /dev/null --max-time 2 "$MCP_URL" 2>/dev/null; then
      ok "echo MCP 已后台启动: ${MCP_URL}(pid $(cat "${TMPDIR:-/tmp}/acme-echo-mcp.pid"),日志 /tmp/acme-echo-mcp.log)"
      MCP_NOTE="本次启动"
    else
      warn "echo MCP 启动失败(见 /tmp/acme-echo-mcp.log);继续注册配置,联调时再排查"
    fi
  fi
  api GET "/ia/api/v1/admin/mcp-servers"
  [[ "$REPLY_CODE" == "200" ]] || fail "三方 MCP 列表失败: HTTP $REPLY_CODE"
  if [[ "$(jpy "any(s['serverKey']=='acme-echo' for s in d['data'])")" == "True" ]]; then
    ok "三方 MCP 配置已存在,跳过: serverKey=acme-echo"
  else
    python3 -c '
import json, sys
print(json.dumps({"serverKey": "acme-echo", "name": "ACME Echo 演示",
                  "endpointUrl": sys.argv[1], "transport": "streamable-http",
                  "authType": "STATIC_HEADER", "headerName": "X-ACME-Token",
                  "credentials": "acme-echo-secret", "timeoutSeconds": 30,
                  "enabled": True}, ensure_ascii=False))' \
      "$MCP_URL" > "$TMP_JSON"
    api POST "/ia/api/v1/admin/mcp-servers" -H 'Content-Type: application/json' \
      --data-binary @"$TMP_JSON"
    [[ "$REPLY_CODE" == "200" ]] || fail "三方 MCP 注册失败: HTTP $REPLY_CODE $(cat "$TMP_JSON")"
    ok "三方 MCP 已注册: serverKey=acme-echo(工具 FQN mcp__acme-echo__echo)"
  fi
else
  step "[7/7] 三方 MCP(ACME_SKIP_MCP=1,跳过)"
fi

# ---------------------------------------------------------------------------
step "能力矩阵小结(5 场景 × 能力)"
cat <<'MATRIX'
  场景 agentType        桥工具(WRITE 确认)   KB 检索   Skill 注入   子 Agent 编排
  -------------------   -------------------   -------   ----------   -------------
  ticket-assistant       ●(create_ticket)      -          -            -
  knowledge-qa                  -              ●          -            -
  report-writer                 -              -          ●            -
  ops-analyst                   -              -          -      ●(2 sub)
  master-demo            ●(create_ticket)       ●          ●       ●(1 sub)
MATRIX
print ""
ok "provisioning 全部完成(appId=${APP_ID};MCP:${MCP_NOTE})"
ok "定义见管理站「Agent 定义」页;演示剧本见 seeds/README.md"
