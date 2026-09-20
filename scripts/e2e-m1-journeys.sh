#!/usr/bin/env zsh
# =============================================================================
# M1 验收 · demo-spring-host 真机旅程(U2 商品简介 / U3 流程模板 / U5 登录记录)
# =============================================================================
# 与 scripts/e2e-host-journey.sh(U1)互补,合成 PRD M1 验收锚点 U1–U3、U5:
#   U5(只读):list_login_records → DEFAULT 模式工具直通执行(无确认事件,
#              与 U1/U2 写确认对照)→ DONE → 宿主调用计数 +1 → 无确认审计行;
#   U2(写):  update_product_brief → USER_CONFIRMATION_REQUIRED → 批准 →
#              宿主执行(简介更新 + 版本 +1 + 历史 +1)→ DONE → audit allowed
#              (decision_source=live-confirm);
#   U3(写):  copy_flow_template → 确认等待 → 拒绝 → 宿主数据不变(工具未执行)
#              → audit denied(live-confirm)。
# 每路径含宿主侧 act token 证据断言(/ia-demo/state lastClaims.actSub=inneragent-run:*),
# 另有无头/伪造 X-IA-Act 401 fail-closed 前置。
#
# 依赖:docker compose、主服务 18090(IA_ADMIN_KEY)、宿主 18091、curl/python3/psql。
# 环境:IA_JOURNEY_SKIP_START=1 复用已起的三进程;IA_JOURNEY_KEEP=1 结束不清理;
#       IA_ADMIN_KEY(默认 test-key)、IA_DEMO_USER(默认 12993)。
# 错峰:18090/18091 被占(并行任务)先让位等待,绝不代杀;compose 容器已在跑则复用。
# 口径:FAIL 不中断,汇总结论后非零退出;宿主为进程内存态,断言一律「前→后」相对值。
set -uo pipefail

BASE=${IA_BASE:-http://localhost:18090}
HOST_BASE=${IA_HOST_BASE:-http://localhost:18091}
ADMIN_KEY=${IA_ADMIN_KEY:-test-key}
DEMO_USER=${IA_DEMO_USER:-12993}
SERVER_KEY=demo-spring-host
ENDPOINT="$HOST_BASE/ia-mcp"
PROD_READ_FQN="mcp__${SERVER_KEY}__get_product_brief"
PROD_WRITE_FQN="mcp__${SERVER_KEY}__update_product_brief"
FLOW_FQN="mcp__${SERVER_KEY}__copy_flow_template"
LOGIN_FQN="mcp__${SERVER_KEY}__list_login_records"
REPO=${REPO:-$(cd "$(dirname "$0")/.." && pwd)}
WORK=$(mktemp -d /tmp/ia-m1-journeys.XXXXXX)
PASS=0; FAIL=0
STARTED_MINE=${IA_JOURNEY_SKIP_START:-0}
[[ "$STARTED_MINE" == "1" ]] && STARTED_MINE="" || STARTED_MINE=1
SERVER_PID=""; HOST_PID=""; DB_PORT=35432; REDIS_PORT=36379
RUN_CURL_PID=""

source "$REPO/scripts/journey-lib.sh"

cleanup() {
  set_mock_script "" 2>/dev/null || true
  if [[ "${IA_JOURNEY_KEEP:-0}" != "1" && -n "$STARTED_MINE" ]]; then
    say ""
    say "[cleanup] 停止本脚本启动的进程/容器…"
    [[ -n "$HOST_PID" ]] && kill_tree "$HOST_PID"
    [[ -n "$SERVER_PID" ]] && kill_tree "$SERVER_PID"
    # 兜底:仅当环境是本脚本起的,才清残留端口 JVM(否则可能误杀并行任务进程)
    local orphan
    for orphan in $(lsof -ti :18090 :18091 2>/dev/null || true); do
      say "[cleanup] 清理本环境残留端口进程: $orphan"
      kill_tree "$orphan"
    done
    sleep 2
    if [[ "${COMPOSE_STARTED:-}" == "1" ]]; then
      docker compose -f "$REPO/docker/dev-compose.yml" -f "$REPO/scripts/dev-compose.e2e-ports.yml" down > "$WORK/compose-down.log" 2>&1 \
        || say "[cleanup] compose down 异常(证据: $WORK/compose-down.log)"
    fi
    say "[cleanup] 完成。工作目录(证据)保留: $WORK"
  else
    say "[cleanup] 保留现场(IA_JOURNEY_KEEP=1 或复用外部进程)。证据目录: $WORK"
  fi
}
trap cleanup EXIT

# admin 注册可复跑:首次 200(带 fqn),复跑 409「工具已注册」同样视为就绪
reg_file_ok() { # reg_file_ok <注册响应文件> <期望 fqn> → yes/no
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    ok = (d.get('code') == 0 and d.get('data', {}).get('fqn') == sys.argv[2]) \
        or '已注册' in str(d.get('msg', ''))
    print('yes' if ok else 'no')
except Exception:
    print('no')
PY
}

register_tool() { # register_tool <toolName> <description> <riskLevel> <parametersSchema> <annotationsJson> <outfile>
  # annotationsJson(已预转义):V15 注解为策略软输入——host_app 可信宿主采信,
  # readOnlyHint=true 的 READ 工具在 DEFAULT 档位直通(注册即生效,不等指纹轮询)。
  curl -s -X POST "$BASE/ia/api/v1/admin/tools" \
    -H "X-IA-Admin-Key: $ADMIN_KEY" -H 'Content-Type: application/json' -d @- > "$6" <<JSON
{
  "serverKey":"$SERVER_KEY","toolName":"$1",
  "description":"$2","riskLevel":"$3",
  "source":"host_app","endpointUrl":"$ENDPOINT",
  "parametersSchema":"$4",
  "annotationsJson":"$5"
}
JSON
}

host_state() { curl -s "$HOST_BASE/ia-demo/state"; }

# =============================================================================
section "[0] 预检"
command -v curl >/dev/null || { say "需要 curl"; exit 2; }
command -v python3 >/dev/null || { say "需要 python3"; exit 2; }
docker info >/dev/null 2>&1 || { say "需要 Docker"; exit 2; }
say "  证据目录: $WORK"
if [[ -z "$STARTED_MINE" ]]; then
  curl -s -o /dev/null "$BASE/ia/api-docs" || { say "SKIP_START=1 但主服务不可达"; exit 2; }
  curl -s "$HOST_BASE/ia-demo/state" | grep -q productCount || { say "SKIP_START=1 但宿主不可达/未含 M1 扩充状态"; exit 2; }
  pass "复用已起环境(主服务 $BASE / 宿主 $HOST_BASE)"
else
  wait_ports_free 600 || { say "  SKIP:端口让位超时,旅程待错峰窗口复跑"; exit 3; }
  [[ -n "$BUSY_WAITED" ]] && pass "端口错峰等待后释放(未触碰并行任务进程)" || pass "端口 18090/18091 空闲"
fi

# =============================================================================
if [[ -n "$STARTED_MINE" ]]; then
section "[1] 起环境(compose → 主服务 18090 → 宿主 18091)"
  start_db_containers || { fail "compose 起库"; exit 2; }
  start_server
  server_rc=$?
  if [[ "$server_rc" == "0" ]]; then
    pass "主服务 18090 就绪(JWKS 200 + admin key 所有权校验通过)"
  elif [[ "$server_rc" == "2" ]]; then
    say "  SKIP:主服务端口被并行任务环境占用,旅程待错峰窗口复跑(日志 $WORK/server.log)"
    exit 3
  else
    fail "主服务 18090 未就绪(重试一次后仍失败,日志 $WORK/server.log)"
    exit 2
  fi
  if start_host; then
    pass "宿主 18091 就绪"
  else
    fail "宿主 18091 未就绪(日志 $WORK/host.log)"
    exit 2
  fi
fi

# =============================================================================
section "[2] admin API 注册 M1 四工具(endpointUrl=$ENDPOINT)"
# 复跑收敛:清掉本 serverKey 的既有注册行(两表均无外键;授权按 fqn 引用一并清理),
# 使本轮四工具以「当前 schema + 注解」全新落库 —— 绕开 409 已注册与 BREAKING
# 确认链(V14)对复跑的干扰;ia_tool_registry 上游唯一写入方就是 admin API。
psqlq "delete from ia_tool_schema_history where tool_id in (select id from ia_tool_registry where server_key='$SERVER_KEY')" >/dev/null
psqlq "delete from ia_tool_grant where tool_fqn like 'mcp__${SERVER_KEY}__%'" >/dev/null
RESET_N=$(psqlq "delete from ia_tool_registry where server_key='$SERVER_KEY'; select count(*) from ia_tool_registry where server_key='$SERVER_KEY'")
printf '%s' "$RESET_N" > "$WORK/registry-reset-count.txt"
say "  旧注册行已清理(删后残留 ${RESET_N:-0} 行)"
# parametersSchema 为「JSON 内嵌 JSON」:引号须预转义(与 e2e-host-journey.sh 同款)
SCHEMA_GET_PRODUCT_BRIEF='{\"type\":\"object\",\"properties\":{\"productId\":{\"type\":\"string\",\"description\":\"商品 ID,如 88\"}},\"required\":[\"productId\"]}'
SCHEMA_UPDATE_PRODUCT_BRIEF='{\"type\":\"object\",\"properties\":{\"productId\":{\"type\":\"string\",\"description\":\"商品 ID,如 88\"},\"brief\":{\"type\":\"string\",\"description\":\"优化后的商品简介\"}},\"required\":[\"productId\",\"brief\"]}'
SCHEMA_COPY_FLOW_TEMPLATE='{\"type\":\"object\",\"properties\":{\"sourceTemplateId\":{\"type\":\"string\",\"description\":\"源流程模板 ID,如 3432\"},\"newTemplateName\":{\"type\":\"string\",\"description\":\"新流程模板名称(不可与既有模板重名)\"},\"extraNode\":{\"type\":\"string\",\"description\":\"追加到流程末尾的节点名(可空)\"}},\"required\":[\"sourceTemplateId\",\"newTemplateName\"]}'
SCHEMA_LIST_LOGIN_RECORDS='{\"type\":\"object\",\"properties\":{\"userId\":{\"type\":\"string\",\"description\":\"按用户 ID 过滤(可空=全部)\"},\"days\":{\"type\":\"integer\",\"description\":\"最近多少天,缺省 30\"},\"limit\":{\"type\":\"integer\",\"description\":\"最多返回条数,缺省 20\"}}}'
ANNOT_READ='{\"readOnlyHint\":true}'
ANNOT_WRITE='{\"readOnlyHint\":false}'
register_tool "get_product_brief" "查询宿主内存商品表中的商品简介与当前版本号(演示只读工具)" "low" \
  "$SCHEMA_GET_PRODUCT_BRIEF" "$ANNOT_READ" \
  "$WORK/register-get-product-brief.json"
register_tool "update_product_brief" "更新宿主内存商品表的商品简介,版本号 +1 并留版本历史(演示写工具)" "medium" \
  "$SCHEMA_UPDATE_PRODUCT_BRIEF" "$ANNOT_WRITE" \
  "$WORK/register-update-product-brief.json"
register_tool "copy_flow_template" "以源流程模板为底稿复制出新流程模板,可追加一个节点;目标名已存在则返回冲突(演示写工具)" "medium" \
  "$SCHEMA_COPY_FLOW_TEMPLATE" "$ANNOT_WRITE" \
  "$WORK/register-copy-flow-template.json"
register_tool "list_login_records" "查询宿主内存登录记录,支持按 userId 过滤与最近 N 天窗口(演示只读工具)" "low" \
  "$SCHEMA_LIST_LOGIN_RECORDS" "$ANNOT_READ" \
  "$WORK/register-list-login-records.json"

for entry in \
  "get_product_brief|$PROD_READ_FQN|$WORK/register-get-product-brief.json" \
  "update_product_brief|$PROD_WRITE_FQN|$WORK/register-update-product-brief.json" \
  "copy_flow_template|$FLOW_FQN|$WORK/register-copy-flow-template.json" \
  "list_login_records|$LOGIN_FQN|$WORK/register-list-login-records.json"; do
  tool=${entry%%|*}; rest=${entry#*|}; fqn=${rest%%|*}; file=${rest#*|}
  [[ "$(reg_file_ok "$file" "$fqn")" == "yes" ]] \
    && pass "$tool 注册成功(fqn=$fqn)" \
    || fail "$tool 注册异常: $(cat "$file")"
done

LIST=$(curl -s "$BASE/ia/api/v1/admin/tools?serverKey=$SERVER_KEY" -H "X-IA-Admin-Key: $ADMIN_KEY")
printf '%s' "$LIST" > "$WORK/admin-tools-list.json"
cat > "$WORK/registry-check.py" <<'PY'
import json, sys
try:
    data = json.load(sys.stdin)['data']
    risk = {t['toolName']: t['riskLevel'] for t in data}
    m1 = {'get_product_brief': 'low', 'update_product_brief': 'medium',
          'copy_flow_template': 'medium', 'list_login_records': 'low'}

    def ro(t):
        raw = t.get('annotationsJson')
        if not raw:
            return None
        try:
            return json.loads(raw).get('readOnlyHint')
        except Exception:
            return None
    ann = {t['toolName']: ro(t) for t in data}
    ann_expect = {'get_product_brief': True, 'list_login_records': True,
                  'update_product_brief': False, 'copy_flow_template': False}
    print(len(data),
          all(t['endpointUrl'] == sys.argv[1] and t['enabled'] for t in data),
          all(risk.get(k) == v for k, v in m1.items()),
          all(any(t['toolName'] == k for t in data) for k in m1),
          all(ann.get(k) is v for k, v in ann_expect.items()))
except Exception:
    print(0, False, False, False, False)
PY
read -r REG_COUNT AUD_OK RISK_OK M1_OK ANN_OK \
  <<< "$(printf '%s' "$LIST" | python3 "$WORK/registry-check.py" "$ENDPOINT")"
[[ -z "$REG_COUNT" ]] && REG_COUNT=0
# 独立跑本脚本时 registry 恰 4 行(U1 两工具由 e2e-host-journey.sh 自行注册);全量对齐即可
[[ "$REG_COUNT" -ge 4 && "$AUD_OK" == "True" && "$RISK_OK" == "True" && "$M1_OK" == "True" && "$ANN_OK" == "True" ]] \
  && pass "ia_tool_registry ${REG_COUNT} 行 enabled、endpointUrl 对齐、风险级与 readOnlyHint 注解齐备" \
  || fail "注册表断言失败 count=$REG_COUNT aud_ok=$AUD_OK risk_ok=$RISK_OK m1_ok=$M1_OK ann_ok=$ANN_OK"

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
say "  (合法 act token 的宿主侧证据:各旅程执行后断言 /ia-demo/state 的 lastClaims)"

# =============================================================================
section "[4] U5 只读直通:list_login_records → 无确认 → 宿主执行 → 无确认审计(与 U1 写确认对照)"
PRE_STATE=$(host_state); printf '%s' "$PRE_STATE" > "$WORK/host-state-before-u5.json"
PRE_LOGIN_CALLS=$(printf '%s' "$PRE_STATE" | jqget 'invocations.list_login_records'); [[ -z "$PRE_LOGIN_CALLS" ]] && PRE_LOGIN_CALLS=0

set_mock_script "{\"mockScript\":[{\"tool\":\"${LOGIN_FQN}\",\"args\":{\"userId\":\"12993\",\"days\":30}}]}"
RUN_BODY_U5='{"conversationId":null,"message":"查一下用户 12993 最近 30 天的登录记录。","agentType":"demo","toolExecutionMode":"DEFAULT","enabledSkills":[],"context":{"page":{"id":"journey-u5-login-records"},"object":{"type":"doc"}}}'
U5_FILE="$WORK/u5-read-through.sse"
RUN_ID_U5=$(run_and_wait "$U5_FILE" "$RUN_BODY_U5")
set_mock_script ""
say "  runId=$RUN_ID_U5(SSE 证据: $U5_FILE)"

CONFIRM_COUNT_U5=$(grep -c 'USER_CONFIRMATION_REQUIRED' "$U5_FILE" 2>/dev/null || true)
[[ "$CONFIRM_COUNT_U5" == "0" ]] \
  && pass "全程无 USER_CONFIRMATION_REQUIRED(只读直通;对照 U1/U2 写工具必确认)" \
  || fail "只读工具出现确认事件 ${CONFIRM_COUNT_U5} 次(应为 0)"
grep -q '"outputType":"DONE"' "$U5_FILE" \
  && pass "运行到达 DONE" || fail "运行未到达 DONE(终态事件缺失)"
grep -q 'list_login_records' "$U5_FILE" \
  && pass "SSE 出现 list_login_records 工具痕迹(TOOL_CALL 事件)" \
  || fail "SSE 全程无 list_login_records"

POST_STATE_U5=$(host_state); printf '%s' "$POST_STATE_U5" > "$WORK/host-state-after-u5.json"
LOGIN_CALLS=$(printf '%s' "$POST_STATE_U5" | jqget 'invocations.list_login_records'); [[ -z "$LOGIN_CALLS" ]] && LOGIN_CALLS=0
if [[ "$LOGIN_CALLS" -eq $((PRE_LOGIN_CALLS + 1)) ]]; then
  pass "宿主进程执行证据:list_login_records 调用次数 ${PRE_LOGIN_CALLS}→${LOGIN_CALLS}"
  CLAIMS_U5=$(printf '%s' "$POST_STATE_U5" | python3 -c "
import json,sys
try: print(json.dumps(json.load(sys.stdin)['lastClaims'].get('list_login_records',{}),ensure_ascii=False))
except Exception: print('{}')")
  say "  宿主观测 act claims: $CLAIMS_U5"
  grep -q 'inneragent-run:' <<< "$CLAIMS_U5" \
    && pass "宿主侧 act 证据:验签后 claims(act.sub=inneragent-run:*)到达只读工具" \
    || fail "宿主 lastClaims 缺 act.sub 证据"
else
  fail "宿主未按预期执行一次(invocations.list_login_records ${PRE_LOGIN_CALLS}→${LOGIN_CALLS})"
fi
sleep 1
U5_AUDIT=$(audit_count "run_id='$RUN_ID_U5'")
[[ "$U5_AUDIT" == "0" ]] \
  && pass "该 run 无 ia_audit_log 行(只读直通不产生确认审计;对照 U2/U3 的 live-confirm 行)" \
  || fail "只读 run 出现审计行 count=$U5_AUDIT(期望 0)"

# =============================================================================
section "[5] U2 写+确认(批准):update_product_brief → 批准 → 简介更新 + 版本 +1 → audit allowed"
PRE_VERSION=$(printf '%s' "$POST_STATE_U5" | jqget 'products.88.briefVersion'); [[ -z "$PRE_VERSION" ]] && PRE_VERSION=1
PRE_HISTORY=$(printf '%s' "$POST_STATE_U5" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)['products']['88']['briefHistory']))
except Exception: print(0)")
PRE_WRITE_CALLS=$(printf '%s' "$POST_STATE_U5" | jqget 'invocations.update_product_brief'); [[ -z "$PRE_WRITE_CALLS" ]] && PRE_WRITE_CALLS=0

U2_BRIEF="M1验收-优化简介:磁吸一贴即充,20W 快充,90 天只换不修。"
set_mock_script "{\"mockScript\":[{\"tool\":\"${PROD_WRITE_FQN}\",\"args\":{\"productId\":\"88\",\"brief\":\"${U2_BRIEF}\"}}]}"
RUN_BODY_U2='{"conversationId":null,"message":"把商品 88 的简介优化一下。","agentType":"demo","toolExecutionMode":"DEFAULT","enabledSkills":[],"context":{"page":{"id":"journey-u2-product-brief"},"object":{"type":"doc"}}}'
U2_FILE="$WORK/u2-approve.sse"
RUN_ID_U2=$(run_and_wait "$U2_FILE" "$RUN_BODY_U2")
say "  runId=$RUN_ID_U2(SSE 证据: $U2_FILE)"

CONFIRM_EVT_U2=$(sse_extract "$U2_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and json.dumps(d,ensure_ascii=False)" | head -1)
if [[ -n "$CONFIRM_EVT_U2" ]]; then
  pass "SSE 收到 USER_CONFIRMATION_REQUIRED(低危写工具 DEFAULT 档位确认)"
  REPLY_ID_U2=$(sse_extract "$U2_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('replyId')" | head -1)
  TOOL_CALL_ID_U2=$(sse_extract "$U2_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolCallId')" | head -1)
  PENDING_TOOL_U2=$(sse_extract "$U2_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolName')" | head -1)
  say "  replyId=$REPLY_ID_U2 toolCallId=$TOOL_CALL_ID_U2 pendingTool=$PENDING_TOOL_U2"
  [[ "$PENDING_TOOL_U2" == *update_product_brief* ]] \
    && pass "待审批工具为 $PROD_WRITE_FQN" \
    || fail "待审批工具异常: $PENDING_TOOL_U2"
  say "  POST /runs/$RUN_ID_U2/confirm → approved=true"
  confirm_run "$RUN_ID_U2" "$REPLY_ID_U2" "$TOOL_CALL_ID_U2" true "$WORK/u2-confirm.json"
  drive_to_terminal "$U2_FILE" "$RUN_ID_U2"
else
  fail "未出现 USER_CONFIRMATION_REQUIRED —— U2 写工具未被调用或未被拦确认"
fi
set_mock_script ""

grep -q '"outputType":"DONE"' "$U2_FILE" \
  && pass "批准 → 恢复执行 → DONE" || fail "U2 批准后未达 DONE"

POST_STATE_U2=$(host_state); printf '%s' "$POST_STATE_U2" > "$WORK/host-state-after-u2.json"
POST_VERSION=$(printf '%s' "$POST_STATE_U2" | jqget 'products.88.briefVersion'); [[ -z "$POST_VERSION" ]] && POST_VERSION=-1
POST_HISTORY=$(printf '%s' "$POST_STATE_U2" | python3 -c "
import json,sys
try: print(len(json.load(sys.stdin)['products']['88']['briefHistory']))
except Exception: print(-1)")
WRITE_CALLS=$(printf '%s' "$POST_STATE_U2" | jqget 'invocations.update_product_brief'); [[ -z "$WRITE_CALLS" ]] && WRITE_CALLS=0
U2_BRIEF_NOW=$(printf '%s' "$POST_STATE_U2" | jqget 'products.88.brief')
if [[ "$POST_VERSION" -eq $((PRE_VERSION + 1)) && "$POST_HISTORY" -eq $((PRE_HISTORY + 1)) ]]; then
  pass "宿主简介写路径:briefVersion ${PRE_VERSION}→${POST_VERSION},版本历史 ${PRE_HISTORY}→${POST_HISTORY} 条"
else
  fail "宿主简介版本/历史未 +1(version ${PRE_VERSION}→${POST_VERSION}, history ${PRE_HISTORY}→${POST_HISTORY})"
fi
[[ "$U2_BRIEF_NOW" == "$U2_BRIEF" ]] \
  && pass "简介内容已更新为批准的优化文案" || fail "简介内容不符: $U2_BRIEF_NOW"
if [[ "$WRITE_CALLS" -eq $((PRE_WRITE_CALLS + 1)) ]]; then
  pass "宿主进程执行证据:update_product_brief 调用次数 ${PRE_WRITE_CALLS}→${WRITE_CALLS}"
  CLAIMS_U2=$(printf '%s' "$POST_STATE_U2" | python3 -c "
import json,sys
try: print(json.dumps(json.load(sys.stdin)['lastClaims'].get('update_product_brief',{}),ensure_ascii=False))
except Exception: print('{}')")
  say "  宿主观测 act claims: $CLAIMS_U2"
  grep -q 'inneragent-run:' <<< "$CLAIMS_U2" \
    && pass "宿主侧 act 证据:验签后 claims(act.sub=inneragent-run:*)到达写工具" \
    || fail "宿主 lastClaims 缺 act.sub 证据"
else
  fail "宿主写工具未按预期执行一次(invocations.update_product_brief ${PRE_WRITE_CALLS}→${WRITE_CALLS})"
fi
sleep 1
U2_ALLOWED=$(audit_count "run_id='$RUN_ID_U2' and decision='allowed' and decision_source='live-confirm'")
[[ "$U2_ALLOWED" == "1" ]] \
  && pass "ia_audit_log:该 run 恰 1 条 allowed(live-confirm)行" \
  || fail "U2 审计断言失败 allowed(live-confirm) count=${U2_ALLOWED:-ERR}"

# =============================================================================
section "[6] U3 写+确认(拒绝):copy_flow_template → 拒绝 → 宿主数据不变 → audit denied"
PRE_TEMPLATES=$(printf '%s' "$POST_STATE_U2" | jqget 'flowTemplateCount'); [[ -z "$PRE_TEMPLATES" ]] && PRE_TEMPLATES=0
PRE_COPY_CALLS=$(printf '%s' "$POST_STATE_U2" | jqget 'invocations.copy_flow_template'); [[ -z "$PRE_COPY_CALLS" ]] && PRE_COPY_CALLS=0

U3_NAME="M1验收-U3流程"
set_mock_script "{\"mockScript\":[{\"tool\":\"${FLOW_FQN}\",\"args\":{\"sourceTemplateId\":\"3432\",\"newTemplateName\":\"${U3_NAME}\",\"extraNode\":\"用户退款审核\"}}]}"
RUN_BODY_U3='{"conversationId":null,"message":"以流程模板 3432 为底稿复制一个新流程模板,命名为「M1验收-U3流程」,并在末尾加上用户退款审核环节。","agentType":"demo","toolExecutionMode":"DEFAULT","enabledSkills":[],"context":{"page":{"id":"journey-u3-copy-flow"},"object":{"type":"doc"}}}'
U3_FILE="$WORK/u3-reject.sse"
RUN_ID_U3=$(run_and_wait "$U3_FILE" "$RUN_BODY_U3")
say "  runId=$RUN_ID_U3(SSE 证据: $U3_FILE)"

CONFIRM_EVT_U3=$(sse_extract "$U3_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and json.dumps(d,ensure_ascii=False)" | head -1)
if [[ -n "$CONFIRM_EVT_U3" ]]; then
  pass "SSE 收到 USER_CONFIRMATION_REQUIRED(模板复制写入前拦截确认)"
  REPLY_ID_U3=$(sse_extract "$U3_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('replyId')" | head -1)
  TOOL_CALL_ID_U3=$(sse_extract "$U3_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolCallId')" | head -1)
  PENDING_TOOL_U3=$(sse_extract "$U3_FILE" "d.get('outputType')=='USER_CONFIRMATION_REQUIRED' and d.get('pendingToolCalls',[{}])[0].get('toolName')" | head -1)
  [[ "$PENDING_TOOL_U3" == *copy_flow_template* ]] \
    && pass "待审批工具为 $FLOW_FQN" \
    || fail "待审批工具异常: $PENDING_TOOL_U3"
  say "  POST /runs/$RUN_ID_U3/confirm → approved=false(拒绝)"
  confirm_run "$RUN_ID_U3" "$REPLY_ID_U3" "$TOOL_CALL_ID_U3" false "$WORK/u3-confirm.json"
  drive_to_terminal "$U3_FILE" "$RUN_ID_U3"
  REJ_RESULT_U3=$(sse_extract "$U3_FILE" "d.get('outputType')=='USER_CONFIRM_RESULT' and json.dumps(d,ensure_ascii=False)" | head -1)
  [[ -n "$REJ_RESULT_U3" ]] && pass "SSE 收到 USER_CONFIRM_RESULT" || say "  (无 USER_CONFIRM_RESULT 事件)"
else
  fail "未出现 USER_CONFIRMATION_REQUIRED —— U3 写工具未被拦截确认"
fi
set_mock_script ""

grep -qE '"outputType":"(DONE|ERROR|CANCELLED)"' "$U3_FILE" \
  && pass "拒绝路径运行到达终态" || fail "拒绝路径运行未到达终态"

POST_STATE_U3=$(host_state); printf '%s' "$POST_STATE_U3" > "$WORK/host-state-after-u3.json"
POST_TEMPLATES=$(printf '%s' "$POST_STATE_U3" | jqget 'flowTemplateCount'); [[ -z "$POST_TEMPLATES" ]] && POST_TEMPLATES=-1
COPY_CALLS=$(printf '%s' "$POST_STATE_U3" | jqget 'invocations.copy_flow_template'); [[ -z "$COPY_CALLS" ]] && COPY_CALLS=0
NAME_EXISTS=$(printf '%s' "$POST_STATE_U3" | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print('yes' if any(t.get('name')=='$U3_NAME' for t in d['flowTemplates'].values()) else 'no')
except Exception:
    print('err')")
[[ "$POST_TEMPLATES" == "$PRE_TEMPLATES" ]] \
  && pass "宿主未执行:模板数不变(${PRE_TEMPLATES}→${POST_TEMPLATES})" \
  || fail "宿主模板数变化 ${PRE_TEMPLATES}→${POST_TEMPLATES}(拒绝后仍执行?)"
[[ "$NAME_EXISTS" == "no" ]] \
  && pass "无名为「$U3_NAME」的新模板(复制确实未落)" \
  || fail "拒绝后仍出现新模板名(name_exists=$NAME_EXISTS)"
[[ "$COPY_CALLS" == "$PRE_COPY_CALLS" ]] \
  && pass "工具零进入:copy_flow_template 宿主调用计数 ${PRE_COPY_CALLS}→${COPY_CALLS}(确认在宿主之前拦截)" \
  || fail "拒绝后宿主仍收到工具调用(${PRE_COPY_CALLS}→${COPY_CALLS})"
sleep 1
U3_DENIED=$(audit_count "run_id='$RUN_ID_U3' and decision='denied' and decision_source='live-confirm'")
[[ "$U3_DENIED" == "1" ]] \
  && pass "ia_audit_log:该 run 恰 1 条 denied(live-confirm)行" \
  || fail "U3 审计断言失败 denied(live-confirm) count=${U3_DENIED:-ERR}"

# =============================================================================
section "[7] 落库证据(psql)"
psqlq "select id,server_key,tool_name,fqn,risk_level,enabled,endpoint_url from ia_tool_registry where server_key='$SERVER_KEY' order by id" \
  > "$WORK/psql-tool-registry.txt" 2>&1
say "  ia_tool_registry:"; sed 's/^/    /' "$WORK/psql-tool-registry.txt"
psqlq "select run_id,decision,decision_source,tool_fqn from ia_audit_log where run_id in ('$RUN_ID_U5','$RUN_ID_U2','$RUN_ID_U3') order by id" \
  > "$WORK/psql-audit-m1-runs.txt" 2>&1
say "  本旅程三 run 的 ia_audit_log:"; sed 's/^/    /' "$WORK/psql-audit-m1-runs.txt"
psqlq "select run_id,status from ia_agent_run where run_id in ('$RUN_ID_U5','$RUN_ID_U2','$RUN_ID_U3') order by create_time" \
  > "$WORK/psql-runs.txt" 2>&1
say "  本旅程 ia_agent_run:"; sed 's/^/    /' "$WORK/psql-runs.txt"

# =============================================================================
section "[8] 结论"
say "  PASS=$PASS FAIL=$FAIL"
if [[ "$FAIL" -gt 0 ]]; then
  say ""
  say "  M1 U2/U3/U5 真机旅程未全通:FAIL 行即缺陷证据。"
  exit 1
fi
say "  M1 U2/U3/U5 真机旅程:全部通过(U1 见 scripts/e2e-host-journey.sh)。"
exit 0
