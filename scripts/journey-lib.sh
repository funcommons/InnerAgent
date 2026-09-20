#!/usr/bin/env zsh
# =============================================================================
# journey-lib.sh — E2E 真机旅程共享函数库(scripts/e2e-m1-journeys.sh 引用)
# =============================================================================
# 与 scripts/e2e-host-journey.sh 内联同款实现保持一致(该脚本为 U1 验收证据,
# 保持自包含不回改;新旅程脚本一律 source 本库,勿再复制函数体)。
#
# 引用方须先定义的全局:
#   BASE/ADMIN_KEY/DEMO_USER  主服务地址与管理配置
#   WORK                      证据目录(mktemp -d)
#   REPO                      仓库根目录
#   RUN_CURL_PID              run_and_wait/drive_to_terminal 的后台 SSE curl pid
# 库自身不执行任何动作,仅定义函数(say/pass/fail 维护 PASS/FAIL 计数)。
# =============================================================================

say()  { printf '%s\n' "$*"; }
pass() { PASS=$((PASS+1)); say "  PASS: $*"; }
fail() { FAIL=$((FAIL+1)); say "  FAIL: $*"; }
section() { say ""; say "== $* =="; }

# 终止 mvn 包装进程及其 fork 的 JVM(spring-boot:run 会 fork 子 Java 进程,
# 仅 kill 包装进程会留下孤儿 JVM 占住 18090/18091,复跑即端口冲突)。
# 注:变量展开保持不加引号的分词形态,zsh/bash 双兼容(勿用 zsh 专属 ${=})。
kill_tree() {
  [[ -n "$1" ]] || return 0
  local children
  children=$(pgrep -P "$1" 2>/dev/null || true)
  kill "$1" 2>/dev/null
  for child in $children; do kill_tree "$child"; done
  sleep 0.3
  kill -9 "$1" 2>/dev/null
}

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
# [M1] 环境起停(m1 旅程新增;错峰安全:不杀他人进程/复用已在跑容器)
# =============================================================================

# 端口错峰守卫:18090/18091 被占(可能是并行任务的环境)则等待让位,绝不代杀。
# 全局输出 BUSY_WAITED=1 表示发生过让位等待。
wait_ports_free() { # wait_ports_free <最长等待秒>
  local max="$1" waited=0 busy
  BUSY_WAITED=""
  while :; do
    busy=$(lsof -ti :18090 :18091 2>/dev/null || true)
    [[ -z "$busy" ]] && return 0
    if (( waited >= max )); then
      say "  端口 18090/18091 仍被占用(并行任务环境?): $busy"
      return 1
    fi
    if [[ -z "$BUSY_WAITED" ]]; then
      BUSY_WAITED=1
      say "  端口被占,错峰等待(最多 ${max}s,不代杀他人进程)…"
    fi
    sleep 15
    waited=$((waited + 15))
  done
}

# 起库容器:已在跑则复用(探测实际映射端口),否则用 e2e 端口覆盖起 35432/36379。
# 全局输出:COMPOSE_STARTED=1(本脚本起的容器)/ DB_PORT / REDIS_PORT。
start_db_containers() {
  COMPOSE_STARTED=""
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^inneragent-postgres$'; then
    DB_PORT=$(docker port inneragent-postgres 5432 2>/dev/null | head -1 | sed 's/.*://')
    REDIS_PORT=$(docker port inneragent-redis 6379 2>/dev/null | head -1 | sed 's/.*://')
    say "  复用已在跑的 compose 容器(PG ${DB_PORT:-?} / Redis ${REDIS_PORT:-?})"
  else
    local compose=(docker compose -f "$REPO/docker/dev-compose.yml" -f "$REPO/scripts/dev-compose.e2e-ports.yml")
    "${compose[@]}" up -d || { fail "compose up"; exit 2; }
    local i
    for i in $(seq 1 60); do
      [[ "$(docker inspect -f '{{.State.Health.Status}}' inneragent-postgres 2>/dev/null)" == "healthy" ]] && break
      sleep 1
    done
    COMPOSE_STARTED=1
    DB_PORT=35432
    REDIS_PORT=36379
    pass "compose 健康(PG 35432 / Redis 36379)"
  fi
}

# 起主服务 18090(并行改动中可能编译失败:首轮 wait 失败后等 2 分钟重试一次)。
# 起来后做「所有权校验」:admin API 必须认本脚本的 IA_ADMIN_KEY —— 否则说明
# 端口被并行任务的主服务抢占(JWKS 谁起都能 200),此时返回非零,调用方应
# 错峰让位而非继续(否则 admin 403 / run 失败一路假 FAIL)。
start_server() {
  ( cd "$REPO/inneragent-server" && export JAVA_HOME=$(/usr/libexec/java_home -v 21) && \
    IA_ADMIN_KEY="$ADMIN_KEY" IA_DB_PORT="${DB_PORT:-35432}" IA_REDIS_PORT="${REDIS_PORT:-36379}" \
    mvn -q spring-boot:run ) > "$WORK/server.log" 2>&1 &
  SERVER_PID=$!
  if ! wait_url "$BASE/.well-known/jwks.json"; then
    say "  主服务首轮未就绪,按任务口径等 2 分钟重试一次…"
    sleep 120
    wait_url "$BASE/.well-known/jwks.json" || return 1
  fi
  local i code
  for i in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w '%{http_code}' \
      "$BASE/ia/api/v1/admin/tools" -H "X-IA-Admin-Key: $ADMIN_KEY" 2>/dev/null)
    [[ "$code" == "200" ]] && return 0
    sleep 3
  done
  say "  18090 主服务不认本脚本 IA_ADMIN_KEY(admin=$code)——端口被并行任务环境占用"
  return 2
}

# 起宿主 18091(examples/demo-spring-host;HOST_PID 全局带回)
start_host() {
  ( cd "$REPO" && export JAVA_HOME=$(/usr/libexec/java_home -v 21) && \
    mvn -q -f examples/demo-spring-host/pom.xml spring-boot:run ) > "$WORK/host.log" 2>&1 &
  HOST_PID=$!
  wait_host_ready
}

# mock 模型脚本化配置(D2 同款):按轮驱动指定工具调用;留空参数即恢复 legacy
set_mock_script() { # set_mock_script <mockScript JSON 或空>
  if [[ -n "$1" ]]; then
    psqlq "update ia_ai_model set config='$1' where code='mock-text'" >/dev/null
  else
    psqlq "update ia_ai_model set config=null where code='mock-text'" >/dev/null
  fi
}

# 宿主状态就绪探测:等待 /ia-demo/state 可用且含 M1 扩充键
wait_host_ready() {
  local i
  for i in $(seq 1 180); do
    curl -s "$HOST_BASE/ia-demo/state" 2>/dev/null | grep -q productCount && return 0
    sleep 1
  done
  return 1
}

audit_count() { # audit_count <where 子句> → ia_audit_log 匹配行数
  psqlq "select count(*) from ia_audit_log where $1"
}
