#!/usr/bin/env zsh
# =============================================================================
# P1 出口验收 · demo-spring-host 全流程真机旅程(U1 写确认双路径)
# =============================================================================
# 依赖:docker compose(docker/dev-compose.yml)、主服务 18090(IA_ADMIN_KEY)、
#       宿主 18091(examples/demo-spring-host)、curl/python3/psql(经 docker exec)。
# 环境:IA_JOURNEY_SKIP_START=1 复用已起的三进程;IA_JOURNEY_KEEP=1 结束后不清理;
#       IA_ADMIN_KEY(默认 test-key)、IA_DEMO_USER(默认 12993)。
# 断言:U1 批准路径(create_host_record → SSE 确认等待 → 批准 → 宿主进程执行 →
#       DONE → ia_audit_log allowed 行)、拒绝路径(→ 拒绝 → 宿主未执行 → denied 行)、
#       act token(宿主 /ia-mcp 无头 401)。另含「确认流实弹」真机补充证据
#       (ALWAYS_ASK + 内置 get_current_time,证明 SSE→confirm→resume→DONE 链路)。
# 口径:FAIL 不中断,汇总结论后非零退出;FAIL 行即缺陷证据(编号见报告)。
set -uo pipefail

BASE=${IA_BASE:-http://localhost:18090}
HOST_BASE=${IA_HOST_BASE:-http://localhost:18091}
ADMIN_KEY=${IA_ADMIN_KEY:-test-key}
DEMO_USER=${IA_DEMO_USER:-12993}
SERVER_KEY=demo-spring-host
WRITE_FQN="mcp__${SERVER_KEY}__create_host_record"
REPO=${REPO:-$(cd "$(dirname "$0")/.." && pwd)}
WORK=$(mktemp -d /tmp/ia-host-journey.XXXXXX)
PASS=0; FAIL=0
STARTED_MINE=${IA_JOURNEY_SKIP_START:-0}
[[ "$STARTED_MINE" == "1" ]] && STARTED_MINE="" || STARTED_MINE=1
SERVER_PID=""; HOST_PID=""

say()  { printf '%s\n' "$*"; }
pass() { PASS=$((PASS+1)); say "  PASS: $*"; }
fail() { FAIL=$((FAIL+1)); say "  FAIL: $*"; }
section() { say ""; say "== $* =="; }

cleanup() {
  if [[ "${IA_JOURNEY_KEEP:-0}" != "1" && -n "$STARTED_MINE" ]]; then
    say ""
    say "[cleanup] 停止本脚本启动的进程/容器…"
    [[ -n "$HOST_PID" ]] && kill "$HOST_PID" 2>/dev/null
    [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null
    sleep 2
    docker compose -f "$REPO/docker/dev-compose.yml" -f "$REPO/scripts/dev-compose.e2e-ports.yml" down >/dev/null 2>&1
    say "[cleanup] 完成。工作目录(证据)保留: $WORK"
  else
    say "[cleanup] 保留现场(IA_JOURNEY_KEEP=1 或复用外部进程)。证据目录: $WORK"
  fi
}
trap cleanup EXIT

jqget() { python3 -c "
import sys,json,functools
try:
    d=json.load(sys.stdin)
    print(functools.reduce(lambda a,k: a[int(k)] if isinstance(a,list) else a[k], '$1'.split('.'), d))
except Exception as e:
    print('')" 2>/dev/null; }

# 从 SSE 文本的 data: 行抽取 JSON 字段(eval 表达式,真值才收集)
sse_extract() { python3 - "$1" "$2" <<'PY'
import json, sys
path, expr = sys.argv[1], sys.argv[2]
out = []
try:
    handle = open(path, encoding="utf-8", errors="replace")
except OSError:
    print(""); raise SystemExit
for line in handle:
    if not line.startswith("data:"):
        continue
    try:
        payload = json.loads(line[5:].strip())
    except Exception:
        continue
    try:
        value = eval(expr, {"d": payload, "json": json})
        if value:
            out.append(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False))
    except Exception:
        continue
print("\n".join(out))
PY
}

wait_url() { # wait_url <url> [extra curl args...] — 轮询 200,最长 180s
  local url="$1" i code
  shift || true
  for i in {1..180}; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url" "$@" 2>/dev/null || true)
    [[ "$code" == "200" ]] && return 0
    sleep 1
  done
  return 1
}

# 终止后台 curl(勿用 wait:pid 可能已被系统回收复用,zsh wait 会卡死)
kill_curl() {
  [[ -n "$1" ]] || return 0
  kill "$1" 2>/dev/null
  sleep 0.3
  kill -9 "$1" 2>/dev/null
}

psqlq() { docker exec inneragent-postgres psql -U inneragent -d inneragent -tAc "$1" 2>/dev/null; }

# 等待 SSE 文件出现终态(DONE/ERROR/CANCELLED);curl 进程退出也视为流结束
wait_terminal() { # wait_terminal <file> <max_seconds> <curl_pid>
  local file="$1" max="$2" pid="${3:-}"
  local i
  for i in $(seq 1 "$max"); do
    if grep -qE '"outputType":"(DONE|ERROR|CANCELLED)"' "$file" 2>/dev/null; then return 0; fi
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      grep -qE '"outputType"' "$file" 2>/dev/null && return 0
      return 1
    fi
    sleep 1
  done
  return 1
}

# 等待 SSE 出现「暂停点」:终态或确认等待(流保持连接,后续事件继续入文件)
wait_pause() { # wait_pause <file> <max_seconds> <curl_pid>
  local file="$1" max="$2" pid="$3"
  local i
  for i in $(seq 1 "$max"); do
    if grep -qE '"outputType":"(DONE|ERROR|CANCELLED|USER_CONFIRMATION_REQUIRED)"' "$file" 2>/dev/null; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then return 1; fi
    sleep 1
  done
  return 1
}

# run_and_wait <outfile> <request-body-json> → 输出 runId(可能为空)
# 在确认等待处暂停:保留 SSE 连接(全局 RUN_CURL_PID),由 drive_to_terminal 收尾
RUN_CURL_PID=""
run_and_wait() {
  local outfile="$1" body="$2"
  if [[ -n "$RUN_CURL_PID" ]]; then
    kill_curl "$RUN_CURL_PID"
    RUN_CURL_PID=""
  fi
  : > "$outfile"
  curl -sN -X POST "$BASE/ia/api/v1/runs" \
    -H 'Content-Type: application/json' -H "X-IA-Demo-User: $DEMO_USER" \
    -d "$body" > "$outfile" 2>/dev/null &
  RUN_CURL_PID=$!
  wait_pause "$outfile" 150 "$RUN_CURL_PID" || true
  sse_extract "$outfile" "d.get('runId')" | head -1
}

confirm_run() { # confirm_run <runId> <replyId> <toolCallId> <true|false> <outfile>
  curl -s -X POST "$BASE/ia/api/v1/runs/$1/confirm" \
    -H 'Content-Type: application/json' -H "X-IA-Demo-User: $DEMO_USER" \
    -d "{\"replyId\":\"$2\",\"decisions\":[{\"toolCallId\":\"$3\",\"approved\":$4}]}" > "$5"
  say "  confirm 响应: $(head -c 200 "$5")"
}

# 确认决策后跟随 SSE 至终态:优先生存连接,必要时 Last-Event-ID 重连续流
drive_to_terminal() { # drive_to_terminal <file> <runId>
  local file="$1" rid="$2"
  if ! wait_terminal "$file" 60 "$RUN_CURL_PID"; then
    local last_id
    last_id=$(grep -E '^id:' "$file" | tail -1 | cut -c4- | tr -d '\r')
    kill_curl "$RUN_CURL_PID"
    curl -sN "$BASE/ia/api/v1/runs/$rid/events" -H "Last-Event-ID: $last_id" \
      -H "X-IA-Demo-User: $DEMO_USER" >> "$file" 2>/dev/null &
    RUN_CURL_PID=$!
    wait_terminal "$file" 120 "$RUN_CURL_PID" || true
  fi
  kill_curl "$RUN_CURL_PID"
  RUN_CURL_PID=""
}

# =============================================================================
section "[0] 预检"
command -v curl >/dev/null || { say "需要 curl"; exit 2; }
command -v python3 >/dev/null || { say "需要 python3"; exit 2; }
docker info >/dev/null 2>&1 || { say "需要 Docker"; exit 2; }
say "  证据目录: $WORK"
if [[ -z "$STARTED_MINE" ]]; then
  curl -s -o /dev/null "$BASE/ia/api-docs" || { say "SKIP_START=1 但主服务不可达"; exit 2; }
  curl -s -o /dev/null "$HOST_BASE/ia-demo/state" || { say "SKIP_START=1 但宿主不可达"; exit 2; }
  pass "复用已起环境(主服务 $BASE / 宿主 $HOST_BASE)"
fi

# =============================================================================
if [[ -n "$STARTED_MINE" ]]; then
section "[1] 起环境(compose → 主服务 18090 → 宿主 18091)"
  # 库端口用 scripts/dev-compose.e2e-ports.yml 覆盖到 35432/36379
  #(15432/16379 常被其他项目容器占用);主服务经 IA_DB_PORT/IA_REDIS_PORT 对齐
  COMPOSE=(docker compose -f "$REPO/docker/dev-compose.yml" -f "$REPO/scripts/dev-compose.e2e-ports.yml")
  "${COMPOSE[@]}" up -d || { fail "compose up"; exit 2; }
  for i in $(seq 1 60); do
    [[ "$(docker inspect -f '{{.State.Health.Status}}' inneragent-postgres 2>/dev/null)" == "healthy" ]] && break
    sleep 1
  done
  pass "compose 健康(PG 35432 / Redis 36379)"

  ( cd "$REPO/inneragent-server" && export JAVA_HOME=$(/usr/libexec/java_home -v 21) && \
    IA_ADMIN_KEY="$ADMIN_KEY" IA_DB_PORT=35432 IA_REDIS_PORT=36379 mvn -q spring-boot:run ) > "$WORK/server.log" 2>&1 &
  SERVER_PID=$!
  wait_url "$BASE/.well-known/jwks.json" || { fail "主服务 18090 未就绪(日志 $WORK/server.log)"; exit 2; }
  pass "主服务 18090 就绪(JWKS 200)"

  ( cd "$REPO" && export JAVA_HOME=$(/usr/libexec/java_home -v 21) && \
    mvn -q -f examples/demo-spring-host/pom.xml spring-boot:run ) > "$WORK/host.log" 2>&1 &
  HOST_PID=$!
  wait_url "$HOST_BASE/ia-demo/state" || { fail "宿主 18091 未就绪(日志 $WORK/host.log)"; exit 2; }
  pass "宿主 18091 就绪"
fi

# =============================================================================
section "[2] admin API 注册两工具(endpointUrl=$HOST_BASE/ia-mcp)"
REG1=$(curl -s -X POST "$BASE/ia/api/v1/admin/tools" \
  -H "X-IA-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d @- <<'JSON'
{
  "serverKey":"demo-spring-host","toolName":"get_host_time",
  "description":"查询宿主进程当前时间(演示只读工具)","riskLevel":"low",
  "source":"host_app","endpointUrl":"http://localhost:18091/ia-mcp",
  "parametersSchema":"{\"type\":\"object\",\"properties\":{\"zone\":{\"type\":\"string\",\"description\":\"IANA 时区,缺省宿主时区\"}}}"
}
JSON
)
REG2=$(curl -s -X POST "$BASE/ia/api/v1/admin/tools" \
  -H "X-IA-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d @- <<'JSON'
{
  "serverKey":"demo-spring-host","toolName":"create_host_record",
  "description":"在宿主内存中创建一条记录并返回记录 id(演示写工具)","riskLevel":"medium",
  "source":"host_app","endpointUrl":"http://localhost:18091/ia-mcp",
  "parametersSchema":"{\"type\":\"object\",\"properties\":{\"title\":{\"type\":\"string\",\"description\":\"记录标题\"},\"content\":{\"type\":\"string\",\"description\":\"记录内容\"}},\"required\":[\"title\"]}"
}
JSON
)
printf '%s' "$REG1" > "$WORK/register-get-host-time.json"
printf '%s' "$REG2" > "$WORK/register-create-host-record.json"
# 可复跑:首次 200(带 fqn),复跑 409「工具已注册」同样视为就绪
reg_ok() { python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print('yes' if (d.get('code')==0 and d.get('data',{}).get('fqn')=='$1') or '已注册' in str(d.get('msg','')) else 'no')
except Exception:
    print('no')"; }
[[ "$(printf '%s' "$REG1" | reg_ok 'mcp__demo-spring-host__get_host_time')" == "yes" ]] \
  && pass "get_host_time 注册成功(fqn=mcp__demo-spring-host__get_host_time)" \
  || fail "get_host_time 注册异常: $REG1"
[[ "$(printf '%s' "$REG2" | reg_ok "$WRITE_FQN")" == "yes" ]] \
  && pass "create_host_record 注册成功(fqn=$WRITE_FQN)" \
  || fail "create_host_record 注册异常: $REG2"

LIST=$(curl -s "$BASE/ia/api/v1/admin/tools?serverKey=$SERVER_KEY" -H "X-IA-Admin-Key: $ADMIN_KEY")
printf '%s' "$LIST" > "$WORK/admin-tools-list.json"
read -r REG_COUNT AUD_OK <<< "$(printf '%s' "$LIST" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)['data']
    print(len(d), all(t['endpointUrl']=='http://localhost:18091/ia-mcp' and t['enabled'] for t in d))
except Exception:
    print(0, False)")"
[[ "$REG_COUNT" == "2" && "$AUD_OK" == "True" ]] \
  && pass "ia_tool_registry 两行均 enabled 且 endpointUrl=http://localhost:18091/ia-mcp" \
  || fail "注册表断言失败 count=$REG_COUNT aud_ok=$AUD_OK"

# =============================================================================
section "[3] act token 证据:宿主 /ia-mcp 验签 fail-closed"
ANON=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HOST_BASE/ia-mcp" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
[[ "$ANON" == "401" ]] && pass "无头请求 → 401(fail-closed)" || fail "无头请求期望 401,实际 $ANON"
GARBAGE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$HOST_BASE/ia-mcp" \
  -H 'Content-Type: application/json' -H 'X-IA-Act: not.a.jwt' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')
[[ "$GARBAGE" == "401" ]] && pass "伪造 X-IA-Act → 401" || fail "伪造令牌期望 401,实际 $GARBAGE"
say "  (合法 act token 的宿主侧证据:批准路径执行后断言 /ia-demo/state 的 lastClaims)"

# =============================================================================
section "[4] U1 批准路径:create_host_record(写)→ 确认等待 → 批准 → 宿主执行 → 审计"
PRE_STATE=$(curl -s "$HOST_BASE/ia-demo/state")
printf '%s' "$PRE_STATE" > "$WORK/host-state-before-approve.json"
PRE_RECORDS=$(printf '%s' "$PRE_STATE" | jqget 'recordCount'); [[ -z "$PRE_RECORDS" ]] && PRE_RECORDS=0

RUN_BODY='{"conversationId":null,"message":"请调用 create_host_record 工具,创建一条标题为「U1验收-批准路径」的宿主记录。","agentType":"demo","toolExecutionMode":"DEFAULT","enabledSkills":[],"context":{"page":{"id":"journey-approve"},"object":{"type":"doc"}}}'
APPROVE_FILE="$WORK/approve-path.sse"
RUN_ID=$(run_and_wait "$APPROVE_FILE" "$RUN_BODY")
say "  runId=$RUN_ID(SSE 证据: $APPROVE_FILE)"

CONFIRM_EVT=$(sse_extract "$APPROVE_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and json.dumps(d,ensure_ascii=False)" | head -1)
if [[ -n "$CONFIRM_EVT" ]]; then
  pass "SSE 收到 USER_CONFIRMATION_REQUIRED(内核确认等待)"
  REPLY_ID=$(sse_extract "$APPROVE_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('replyId')" | head -1)
  TOOL_CALL_ID=$(sse_extract "$APPROVE_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolCallId')" | head -1)
  PENDING_TOOL=$(sse_extract "$APPROVE_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolName')" | head -1)
  say "  replyId=$REPLY_ID toolCallId=$TOOL_CALL_ID pendingTool=$PENDING_TOOL"
  say "  POST /runs/$RUN_ID/confirm → approved=true"
  confirm_run "$RUN_ID" "$REPLY_ID" "$TOOL_CALL_ID" true "$WORK/approve-confirm.json"
  drive_to_terminal "$APPROVE_FILE" "$RUN_ID"
else
  fail "[D2] 全程未出现 USER_CONFIRMATION_REQUIRED —— 写工具未被模型调用(MockAiProvider 脚本硬编码只调 get_current_time,见缺陷清单)"
fi

grep -q '"outputType":"DONE"' "$APPROVE_FILE" \
  && pass "运行到达 DONE" || fail "运行未到达 DONE(终态事件缺失)"
grep -q 'create_host_record' "$APPROVE_FILE" \
  && pass "SSE 出现 create_host_record 痕迹" \
  || fail "[D1/D2] SSE 全程无 create_host_record —— 注册的宿主写工具未进入内核工具面/未被调用"

POST_STATE=$(curl -s "$HOST_BASE/ia-demo/state")
printf '%s' "$POST_STATE" > "$WORK/host-state-after-approve.json"
POST_RECORDS=$(printf '%s' "$POST_STATE" | jqget 'recordCount'); [[ -z "$POST_RECORDS" ]] && POST_RECORDS=-1
WRITE_CALLS=$(printf '%s' "$POST_STATE" | jqget 'invocations.create_host_record'); [[ -z "$WRITE_CALLS" ]] && WRITE_CALLS=0
if [[ "$WRITE_CALLS" -ge 1 ]]; then
  pass "宿主进程执行证据:create_host_record 调用次数=$WRITE_CALLS, 内存记录 $PRE_RECORDS→$POST_RECORDS"
  CLAIMS=$(printf '%s' "$POST_STATE" | python3 -c "
import json,sys
try: print(json.dumps(json.load(sys.stdin)['lastClaims'].get('create_host_record',{}),ensure_ascii=False))
except Exception: print('{}')")
  say "  宿主观测 act claims: $CLAIMS"
  CLAIMS_OK=$(printf '%s' "$CLAIMS" | grep -c 'inneragent-run:')
  [[ "$CLAIMS_OK" -ge 1 ]] && pass "宿主侧 act 证据:验签后 claims(act.sub=inneragent-run:*)到达工具" \
    || fail "宿主 lastClaims 缺 act.sub 证据"
else
  fail "[D1/D2] 宿主内存零新记录(invocations.create_host_record=$WRITE_CALLS)—— 工具从未在宿主进程执行"
fi

sleep 1
AUDIT_ALLOWED=$(psqlq "select count(*) from ia_audit_log where decision='allowed'")
[[ "$AUDIT_ALLOWED" =~ ^[0-9]+$ && "$AUDIT_ALLOWED" -ge 1 ]] \
  && pass "ia_audit_log 存在 allowed 行(count=$AUDIT_ALLOWED)" \
  || fail "[D3] ia_audit_log 无 allowed 行(count=${AUDIT_ALLOWED:-ERR})—— 确认流实弹审计未落库"

# =============================================================================
section "[5] U1 拒绝路径:再次触发写 → 拒绝 → 宿主未执行 → denied 审计"
PRE_RECORDS_REJ="$POST_RECORDS"
REJ_FILE="$WORK/reject-path.sse"
RUN_BODY_REJ='{"conversationId":null,"message":"请调用 create_host_record 工具,创建一条标题为「U1验收-拒绝路径」的宿主记录。","agentType":"demo","toolExecutionMode":"DEFAULT","enabledSkills":[],"context":{"page":{"id":"journey-reject"},"object":{"type":"doc"}}}'
RUN_ID_REJ=$(run_and_wait "$REJ_FILE" "$RUN_BODY_REJ")
say "  runId=$RUN_ID_REJ(SSE 证据: $REJ_FILE)"
CONFIRM_REJ=$(sse_extract "$REJ_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and json.dumps(d,ensure_ascii=False)" | head -1)
if [[ -n "$CONFIRM_REJ" ]]; then
  pass "SSE 收到 USER_CONFIRMATION_REQUIRED"
  REPLY_ID_REJ=$(sse_extract "$REJ_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('replyId')" | head -1)
  TOOL_CALL_ID_REJ=$(sse_extract "$REJ_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolCallId')" | head -1)
  say "  POST /runs/$RUN_ID_REJ/confirm → approved=false(拒绝)"
  confirm_run "$RUN_ID_REJ" "$REPLY_ID_REJ" "$TOOL_CALL_ID_REJ" false "$WORK/reject-confirm.json"
  drive_to_terminal "$REJ_FILE" "$RUN_ID_REJ"
  REJ_RESULT=$(sse_extract "$REJ_FILE" "d.get('outputType')=='USER_CONFIRM_RESULT' and json.dumps(d,ensure_ascii=False)" | head -1)
  [[ -n "$REJ_RESULT" ]] && pass "SSE 收到 USER_CONFIRM_RESULT" || say "  (无 USER_CONFIRM_RESULT 事件)"
else
  fail "[D2] 拒绝路径同样未出现确认等待(同 D2:mock 模型无法触发写工具)"
fi
grep -qE '"outputType":"(DONE|ERROR|CANCELLED)"' "$REJ_FILE" \
  && pass "拒绝路径运行到达终态" || fail "拒绝路径运行未到达终态"

POST_STATE_REJ=$(curl -s "$HOST_BASE/ia-demo/state")
printf '%s' "$POST_STATE_REJ" > "$WORK/host-state-after-reject.json"
REJ_RECORDS=$(printf '%s' "$POST_STATE_REJ" | jqget 'recordCount'); [[ -z "$REJ_RECORDS" ]] && REJ_RECORDS=-1
[[ "$REJ_RECORDS" == "$PRE_RECORDS_REJ" ]] \
  && pass "宿主未执行:内存记录数不变($PRE_RECORDS_REJ→$REJ_RECORDS)" \
  || fail "宿主内存记录数变化 $PRE_RECORDS_REJ→$REJ_RECORDS(拒绝后仍执行?)"

AUDIT_DENIED=$(psqlq "select count(*) from ia_audit_log where decision='denied'")
[[ "$AUDIT_DENIED" =~ ^[0-9]+$ && "$AUDIT_DENIED" -ge 1 ]] \
  && pass "ia_audit_log 存在 denied 行(count=$AUDIT_DENIED)" \
  || fail "[D3] ia_audit_log 无 denied 行(count=${AUDIT_DENIED:-ERR})"

# =============================================================================
section "[6] 缺陷证据 D1 定点:enabledMcpTools 指名请求宿主工具 → 内核工具面拒绝"
PROBE_FILE="$WORK/probe-enabled-mcp.txt"
HTTP_CODE=$(curl -s -o "$PROBE_FILE" -w '%{http_code}' -X POST "$BASE/ia/api/v1/runs" \
  -H 'Content-Type: application/json' -H "X-IA-Demo-User: $DEMO_USER" -d @- <<JSON
{"conversationId":null,"message":"触发 create_host_record","agentType":"demo","toolExecutionMode":"DEFAULT","enabledSkills":[],"enabledMcpTools":["$WRITE_FQN"]}
JSON
)
say "  HTTP $HTTP_CODE;响应: $(head -c 400 "$PROBE_FILE" | tr -d '\n')"
# 全局异常处理器会把 IllegalArgumentException 掩成 500「系统内部错误」;
# 真实消息「Requested AgentScope MCP tools are unavailable: [fqn]」在主服务日志中
LOGHIT=$( { grep -l "Requested AgentScope MCP tools are unavailable" "$WORK/server.log" \
                /tmp/ia-host-journey.*/server.log 2>/dev/null || true; } | head -1)
if grep -qi "unavailable" "$PROBE_FILE" || [[ -n "$LOGHIT" ]]; then
  pass "内核明证:指名 MCP 工具被拒『Requested AgentScope MCP tools are unavailable: [$WRITE_FQN]』——ia_tool_registry 注册项不在内核工具清单${LOGHIT:+(日志: $LOGHIT)}"
else
  say "  (响应与日志均未含 unavailable 字样,人工复核 $PROBE_FILE)"
fi

# =============================================================================
section "[7] 补充证据:确认流实弹真机(ALWAYS_ASK + 内置 get_current_time)"
FB_FILE="$WORK/confirm-live-approve.sse"
RUN_BODY_FB='{"conversationId":null,"message":"现在几点了?","agentType":"demo","toolExecutionMode":"ALWAYS_ASK","enabledSkills":[],"context":{"page":{"id":"journey-confirm-live"},"object":{"type":"doc"}}}'
RUN_ID_FB=$(run_and_wait "$FB_FILE" "$RUN_BODY_FB")
say "  runId=$RUN_ID_FB"
FB_CONFIRM=$(sse_extract "$FB_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and json.dumps(d,ensure_ascii=False)" | head -1)
if [[ -n "$FB_CONFIRM" ]]; then
  pass "SSE 收到 USER_CONFIRMATION_REQUIRED(实弹确认,ALWAYS_ASK)"
  REPLY_ID_FB=$(sse_extract "$FB_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('replyId')" | head -1)
  TOOL_CALL_ID_FB=$(sse_extract "$FB_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolCallId')" | head -1)
  say "  POST /runs/$RUN_ID_FB/confirm → approved=true"
  confirm_run "$RUN_ID_FB" "$REPLY_ID_FB" "$TOOL_CALL_ID_FB" true "$WORK/confirm-live-approve.json"
  drive_to_terminal "$FB_FILE" "$RUN_ID_FB"
  grep -q '"outputType":"DONE"' "$FB_FILE" \
    && pass "批准 → 恢复执行 → DONE(内核确认-恢复链真机走通)" || fail "批准后未达 DONE"
  grep -q '"outputType":"CONTENT"' "$FB_FILE" \
    && pass "批准后产生 CONTENT(工具结果回灌模型)" || fail "批准后无 CONTENT"
else
  fail "补充路径未触发确认(ALWAYS_ASK 应对所有工具 ASK)——检查主服务版本"
fi

# =============================================================================
section "[8] 落库证据(psql)"
psqlq "select id,server_key,tool_name,fqn,risk_level,enabled,endpoint_url from ia_tool_registry where server_key='$SERVER_KEY' order by id" \
  > "$WORK/psql-tool-registry.txt" 2>&1
say "  ia_tool_registry:"; sed 's/^/    /' "$WORK/psql-tool-registry.txt"
psqlq "select coalesce(count(*),0) from ia_audit_log" > "$WORK/psql-audit-count.txt" 2>&1
say "  ia_audit_log 总行数: $(cat "$WORK/psql-audit-count.txt")"
psqlq "select decision, decision_source, tool_fqn, run_id from ia_audit_log order by id desc limit 10" \
  > "$WORK/psql-audit-rows.txt" 2>&1
say "  ia_audit_log 最近行(≤10):"; sed 's/^/    /' "$WORK/psql-audit-rows.txt"
psqlq "select run_id,status from ia_agent_run where run_id in ('$RUN_ID','$RUN_ID_REJ','$RUN_ID_FB') order by create_time" \
  > "$WORK/psql-runs.txt" 2>&1
say "  本旅程 ia_agent_run:"; sed 's/^/    /' "$WORK/psql-runs.txt"

# =============================================================================
section "[9] 结论"
say "  PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  say ""
  say "  U1 写确认真机旅程未全通:FAIL 行即缺陷证据(D1/D2/D3 编号对应验收报告)。"
  exit 1
fi
say "  U1 全流程真机旅程:全部通过。"
exit 0
