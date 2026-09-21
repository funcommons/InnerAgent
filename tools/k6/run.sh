#!/usr/bin/env bash
# =============================================================================
# tools/k6/run.sh — InnerAgent 性能压测一键入口(03-开发计划 §7.1 W16 / §7.4)
#
# 职责:compose 起环境 → 等健康 → (按需)构建并起 server → 校准 mock 模型并发
#       → 依次跑 k6 场景 → 每场后收 Prometheus 快照 + PG 慢查询 + Redis 快照。
#       不改任何产品代码与 docs/;报告骨架见 capacity-report-TEMPLATE.md。
#
# 用法:
#   tools/k6/run.sh                          # 默认只跑 smoke(门禁)
#   SCENARIOS="smoke,steady" tools/k6/run.sh # 验收 7 主场景(30 分钟)
#   SCENARIOS="smoke,steady,idle,ramp" tools/k6/run.sh   # 验收 7 全量
#   SCENARIOS="smoke" KEEP=1 tools/k6/run.sh # 结束后保留 server/compose 供排查
#
# 环境变量(均可选):
#   IA_BASE_URL        服务基址(默认 http://localhost:18090;run.sh 本机起服务时固定)
#   IA_DEMO_USER       匿名演示用户(默认 12993;与 scripts/smoke-sse.sh 同源)
#   IA_ADMIN_KEY       管理面密钥(默认 test-key;所有权校验/快照)
#   IA_MOCK_MAX_CONCURRENCY  mock 模型并发校准值(默认 1000;IA_CALIBRATE=0 跳过)
#   IA_CALIBRATE       是否 UPDATE mock 模型 max_concurrency(默认 1)
#   IA_STEADY_* / IA_IDLE_* / IA_RAMP_* / IA_THRESHOLD_*
#                      透传给 k6 场景,口径与默认值见 tools/k6/README.md
#   KEEP               1 = 结束后不回收 server/compose(默认 0 = 贴清理证据)
#   PORTS_MODE         compose 端口:stacked(默认,35432/36379 错峰,同 e2e 先例)
#                      | default(15432/16379,dev-compose 原值)
#
# 依赖:k6(含 k6/x/sse 扩展解析,见 README「依赖」)、docker、curl、mvn
#       (无 jar 时自动 mvn -DskipTests package,约 1-3 分钟)。
# =============================================================================
set -euo pipefail

REPO="${REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
K6DIR="$REPO/tools/k6"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RESULT_DIR="${RESULT_DIR:-$K6DIR/results/$STAMP}"
LOGDIR="${K6_LOGDIR:-/tmp/ia-k6-logs}"
mkdir -p "$RESULT_DIR" "$LOGDIR"

IA_BASE_URL="${IA_BASE_URL:-http://localhost:18090}"
ADMIN_KEY="${IA_ADMIN_KEY:-test-key}"
ADMIN_USER="${IA_ADMIN_BOOTSTRAP_USERNAME:-admin}"
ADMIN_PASSWORD="${IA_ADMIN_BOOTSTRAP_PASSWORD:-Admin#12345}"
DB_PORT="${IA_DB_PORT:-35432}"
REDIS_PORT="${IA_REDIS_PORT:-36379}"
PG_CONTAINER="${PG_CONTAINER:-inneragent-postgres}"
REDIS_CONTAINER="${REDIS_CONTAINER:-inneragent-redis}"
SCENARIOS="${SCENARIOS:-smoke}"
IA_CALIBRATE="${IA_CALIBRATE:-1}"
IA_MOCK_MAX_CONCURRENCY="${IA_MOCK_MAX_CONCURRENCY:-1000}"
PORTS_MODE="${PORTS_MODE:-stacked}"

log() { echo "[ia-k6] $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

compose_files() {
  if [[ "$PORTS_MODE" == "stacked" ]]; then
    echo "-f $REPO/docker/dev-compose.yml -f $REPO/scripts/dev-compose.e2e-ports.yml"
  else
    echo "-f $REPO/docker/dev-compose.yml"
  fi
}

# ── 前置检查 ───────────────────────────────────────────────────────────────
preflight() {
  have curl || { log "FATAL: 缺 curl"; exit 2; }
  have docker || { log "FATAL: 缺 docker(compose 起库必需)"; exit 2; }
  if ! have k6; then
    log "FATAL: 缺 k6(https://grafana.com/docs/k6/latest/set-up/)"
    log "       本工具脚本要求 k6 + k6/x/sse 扩展解析能力,见 tools/k6/README.md「依赖」"
    exit 2
  fi
  log "k6 $(k6 version 2>/dev/null | head -1)"
  log "结果目录 $RESULT_DIR,日志目录 $LOGDIR"
}

# ── [1/5] compose(PG + Redis)─────────────────────────────────────────────
compose_up() {
  if docker ps --format '{{.Names}}' | grep -q "^${PG_CONTAINER}$"; then
    log "compose:$PG_CONTAINER 已在跑,复用"
  else
    log "compose 起库(端口 ${DB_PORT}/${REDIS_PORT})"
    # shellcheck disable=SC2046
    docker compose $(compose_files) up -d || return 2
  fi
  local i
  for i in $(seq 1 60); do
    docker exec "$PG_CONTAINER" pg_isready -U inneragent -d inneragent >/dev/null 2>&1 && break
    sleep 1
  done
  docker exec "$PG_CONTAINER" pg_isready -U inneragent -d inneragent >/dev/null 2>&1 \
    || { log "FATAL: PG 未就绪"; return 2; }
  log "PG healthy"
}

# ── [2/5] server(有 jar 直接跑;无 jar 先构建)────────────────────────────
server_up() {
  if lsof -ti :18090 >/dev/null 2>&1; then
    log "18090 已有监听,复用既有进程(不代杀)"
    wait_health || { log "FATAL: 复用的 18090 不健康,先清理再跑"; return 2; }
    return 0
  fi
  local jar="$REPO/inneragent-server/target/inneragent-server-0.1.0-SNAPSHOT.jar"
  if [[ ! -f "$jar" ]]; then
    log "未发现 jar,构建(mvn -DskipTests package,首次 1-3 分钟)…"
    ( cd "$REPO/inneragent-server" && mvn -q -DskipTests package ) \
      > "$LOGDIR/mvn-build.log" 2>&1 \
      || { log "FATAL: 构建失败,见 $LOGDIR/mvn-build.log"; return 2; }
  fi
  log "起 server 18090(IA_ADMIN_KEY=***,演示鉴权头可用)"
  ( cd "$REPO/inneragent-server" \
    && IA_ADMIN_KEY="$ADMIN_KEY" \
       IA_ADMIN_BOOTSTRAP_USERNAME="$ADMIN_USER" \
       IA_ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASSWORD" \
       IA_DB_PORT="$DB_PORT" IA_REDIS_PORT="$REDIS_PORT" \
       exec java -jar target/inneragent-server-0.1.0-SNAPSHOT.jar ) \
    > "$LOGDIR/server.log" 2>&1 &
  echo $! > "$LOGDIR/server.pid"
  log "server pid=$(cat "$LOGDIR/server.pid"),日志 $LOGDIR/server.log"
  wait_health || return 2
  # 所有权校验:admin API 必须认本脚本的 IA_ADMIN_KEY(端口被并行环境抢占则失败)
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' \
    "$IA_BASE_URL/ia/api/v1/admin/tools" -H "X-IA-Admin-Key: $ADMIN_KEY")
  [[ "$code" == "200" ]] || { log "FATAL: 18090 不认本环境 IA_ADMIN_KEY(admin=$code)"; return 3; }
  log "admin API 鉴权 OK"
}

wait_health() {
  local i code
  for i in $(seq 1 240); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$IA_BASE_URL/actuator/health" 2>/dev/null || true)
    [[ "$code" == "200" ]] && { log "server healthy(${i}s)"; return 0; }
    sleep 1
  done
  log "TIMEOUT 等 /actuator/health(240s);尾部日志:"
  tail -5 "$LOGDIR/server.log" 2>/dev/null || true
  return 1
}

# ── [3/5] mock 模型并发校准(测吞吐的前提,见 ramp-events.js 头注)─────────
calibrate() {
  [[ "$IA_CALIBRATE" == "1" ]] || { log "跳过 mock 模型校准(IA_CALIBRATE=0)"; return 0; }
  log "校准 mock 模型 max_concurrency → ${IA_MOCK_MAX_CONCURRENCY}(默认 5,吞吐压测瓶颈)"
  docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -c \
    "UPDATE ia_ai_model SET max_concurrency = ${IA_MOCK_MAX_CONCURRENCY}
       WHERE code = 'mock-text' AND deleted = false;" \
    || log "WARN: 校准 UPDATE 失败(吞吐场景可能受模型并发闸限制)"
}

# ── [4/5] 场景与快照 ──────────────────────────────────────────────────────
snapshot_prometheus() { # snapshot_prometheus <文件名前缀>
  local out="$RESULT_DIR/$1-prometheus.txt"
  if curl -s -m 10 "$IA_BASE_URL/actuator/prometheus" -o "$out" && [[ -s "$out" ]]; then
    log "  Prometheus 快照 → $out($(wc -l < "$out" | tr -d ' ') 行)"
  else
    log "  WARN: Prometheus 快照失败($IA_BASE_URL/actuator/prometheus)"
  fi
}

snapshot_redis() { # snapshot_redis <文件名前缀>
  local out="$RESULT_DIR/$1-redis.txt"
  {
    echo "## redis INFO memory"; docker exec "$REDIS_CONTAINER" redis-cli INFO memory 2>&1 || echo "unavailable";
    echo "## redis INFO clients"; docker exec "$REDIS_CONTAINER" redis-cli INFO clients 2>&1 || true;
    echo "## redis INFO stats(连接相关)"; docker exec "$REDIS_CONTAINER" redis-cli INFO stats 2>&1 | grep -E "total_(net_input|connections)|rejected_connections" || true;
    echo "## redis CONFIG maxmemory"; docker exec "$REDIS_CONTAINER" redis-cli CONFIG GET maxmemory 2>&1 || true;
  } > "$out"
  log "  Redis 快照 → $out(used_memory_human / maxmemory_policy / connected_clients 见文件)"
}

snapshot_pg() { # snapshot_pg <文件名前缀>
  local out="$RESULT_DIR/$1-pg-slow-queries.txt"
  local ext
  ext=$(docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -Atc \
    "SELECT count(*) FROM pg_extension WHERE extname='pg_stat_statements';" 2>/dev/null || echo 0)
  {
    echo "## PG 慢查询审查快照($(date -u +%FT%TZ))"
    echo "## 口径:优先 pg_stat_statements(mean_exec_time 降序 TOP20);"
    echo "##       扩展未启用时给出备选位(activity 长事务 + 序扫 TOP),并在容量报告注明部署侧需启用 pg_stat_statements。"
    if [[ "$ext" == "1" ]]; then
      echo
      echo "### pg_stat_statements TOP20 by mean_exec_time"
      docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -c \
        "SELECT calls, round(mean_exec_time::numeric,2) AS mean_ms,
                round(total_exec_time::numeric,1) AS total_ms, rows, left(query,120) AS query
           FROM pg_stat_statements
          ORDER BY mean_exec_time DESC LIMIT 20;"
      echo "### pg_stat_statements TOP10 by total_exec_time"
      docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -c \
        "SELECT calls, round(total_exec_time::numeric,1) AS total_ms, left(query,120) AS query
           FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10;"
    else
      echo
      echo "### pg_stat_statements 未启用(shared_preload_libraries 未加载)"
      echo "### 部署侧启用方式:compose/command 追加 -c shared_preload_libraries=pg_stat_statements"
      echo "### 并 CREATE EXTENSION pg_stat_statements;快照降级为下列备选:"
      echo
      echo "### pg_stat_activity:超 1s 的活动查询"
      docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -c \
        "SELECT pid, state, now()-query_start AS running_for, left(query,120) AS query
           FROM pg_stat_activity
          WHERE state <> 'idle' AND now()-query_start > interval '1 second'
          ORDER BY running_for DESC LIMIT 20;" 2>&1
      echo "### pg_stat_user_tables:顺序扫描 TOP(库容量/索引健康观察位)"
      docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -c \
        "SELECT relname, seq_scan, n_live_tup, n_dead_tup
           FROM pg_stat_user_tables ORDER BY seq_scan DESC LIMIT 15;" 2>&1
    fi
    echo
    echo "### 库容量(容量报告「环境规格」回填位)"
    docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -Atc \
      "SELECT 'db_size_bytes=' || pg_database_size('inneragent');"
    docker exec "$PG_CONTAINER" psql -U inneragent -d inneragent -c \
      "SELECT relname, n_live_tup FROM pg_stat_user_tables
        WHERE relname LIKE 'ia_%' ORDER BY n_live_tup DESC LIMIT 20;" 2>&1
  } > "$out"
  log "  PG 快照 → $out"
}

run_scenario() { # run_scenario <脚本名> <场景标签>
  local script="$1" tag="$2"
  log "── 场景 $tag(k6 run scenarios/$script)──"
  IA_BASE_URL="$IA_BASE_URL" \
  IA_ADMIN_KEY="$ADMIN_KEY" \
  IA_RESULT_DIR="$RESULT_DIR" \
  k6 run --summary-export "$RESULT_DIR/$tag-summary.json" \
    "$K6DIR/scenarios/$script" 2>&1 | tee "$RESULT_DIR/$tag-run.log"
  local rc=${PIPESTATUS[0]}
  snapshot_prometheus "$tag-after"
  snapshot_redis "$tag-after"
  snapshot_pg "$tag-after"
  [[ "$rc" == "0" ]] || { log "FATAL: 场景 $tag 退出码 $rc(阈值未过或运行失败)"; return "$rc"; }
  log "── 场景 $tag 完成 ──"
}

run_all() {
  # 场景前基线快照
  snapshot_prometheus "baseline"
  snapshot_redis "baseline"
  snapshot_pg "baseline"
  # 记录本次压测口径(容量报告引用)
  {
    echo "base_url=$IA_BASE_URL"
    echo "db_port=$DB_PORT redis_port=$REDIS_PORT ports_mode=$PORTS_MODE"
    echo "mock_max_concurrency=$IA_MOCK_MAX_CONCURRENCY calibrate=$IA_CALIBRATE"
    echo "scenarios=$SCENARIOS"
    env | grep -E "^IA_(STEADY|IDLE|RAMP|THRESHOLD|DEMO_USER)" | sort || true
  } > "$RESULT_DIR/env.txt"

  local IFS=','
  for s in $SCENARIOS; do
    case "$s" in
      smoke) run_scenario "smoke.js" "smoke" || return $? ;;
      steady|steady-30min) run_scenario "steady-30min.js" "steady-30min" || return $? ;;
      idle|idle-sessions) run_scenario "idle-sessions.js" "idle-sessions" || return $? ;;
      ramp|ramp-events) run_scenario "ramp-events.js" "ramp-events" || return $? ;;
      *) log "WARN: 未知场景 $s(可选 smoke|steady|idle|ramp)"; ;;
    esac
  done
}

# ── [5/5] 清理(贴清理证据,对齐 e2e/env.sh 惯例)─────────────────────────
teardown() {
  if [[ "${KEEP:-0}" == "1" ]]; then
    log "KEEP=1:保留 server 与 compose(结果在 $RESULT_DIR)"
    return 0
  fi
  log "清理:server + compose down"
  if [[ -f "$LOGDIR/server.pid" ]]; then
    local pid
    pid=$(cat "$LOGDIR/server.pid")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null; sleep 1
      kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
    fi
    rm -f "$LOGDIR/server.pid"
  fi
  # shellcheck disable=SC2046
  docker compose $(compose_files) down 2>&1 | tail -2 || true
  for port in 18090 "$DB_PORT" "$REDIS_PORT"; do
    if lsof -ti :"$port" >/dev/null 2>&1 || docker ps --format '{{.Ports}}' | grep -q ":$port->"; then
      log "  警告:端口 $port 仍被占用"
    else
      log "  端口 $port 已释放 ✓"
    fi
  done
}

main() {
  preflight
  compose_up || { log "FATAL: compose 失败"; exit 2; }
  server_up || { log "FATAL: server 起动失败(见 $LOGDIR/server.log)"; teardown; exit 2; }
  calibrate
  local rc=0
  run_all || rc=$?
  log "结果目录:$RESULT_DIR"
  log "下一步:按 tools/k6/capacity-report-TEMPLATE.md 回填数值(摘要见各 *.ia-summary.json)"
  teardown
  exit "$rc"
}

main "$@"
