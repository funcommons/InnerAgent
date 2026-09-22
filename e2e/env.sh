#!/usr/bin/env zsh
# =============================================================================
# e2e/env.sh — InnerAgent E2E 测试环境起停(测试基建,不改产品代码)
#
# 用法:
#   source e2e/env.sh up      # 起 compose + 主服务 + web 网关(幂等,错峰安全)
#   source e2e/env.sh down    # 停本脚本所起进程 + compose down(贴清理证据)
#   source e2e/env.sh status  # 探测各组件状态
#
# 环境约定:
#   - 主服务 18090:IA_ADMIN_KEY=test-key;管理站引导账号 admin/Admin#12345
#     (AdminAuthService 启动时 ia_admin_account 为空则 bootstrap 首个管理员)。
#   - 库容器错峰:15432/16379 常被其他项目容器占用(e2e 机器实况,2026-09-21
#     实测 mmagix-token-postgres/ragflow-redis-1),沿用 scripts/dev-compose.e2e-ports.yml
#     覆盖到 35432/36379;主服务经 IA_DB_PORT/IA_REDIS_PORT 对齐(application.yml 原生支持)。
#   - web 真服务模式:vite dev 挂 msw(web/src/main.ts 仅 DEV 分支启用),故以
#     `pnpm build` 产物 + e2e/gateway.mjs(静态 18081 + /ia 反代 18090)提供真服务。
# =============================================================================
REPO="${REPO:-$(cd "$(dirname "${(%):-%x}")/.." && pwd)}"
E2E="$REPO/e2e"
LOGDIR="${E2E_LOGDIR:-/tmp/ia-e2e-logs}"
mkdir -p "$LOGDIR"

ADMIN_KEY="test-key"
ADMIN_USER="admin"
ADMIN_PASSWORD='Admin#12345'
DB_PORT=35432
REDIS_PORT=36379
GATEWAY_PORT=18081
export IA_BASE_URL="http://localhost:18090"
export GATEWAY_URL="http://localhost:${GATEWAY_PORT}"

wait_url() { # wait_url <url> <最长秒>
  local url="$1" max="${2:-180}" i code
  for i in $(seq 1 "$max"); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)
    [[ "$code" != "000" && "$code" != "" ]] && { echo "$url → $code (${i}s)"; return 0; }
    sleep 1
  done
  echo "TIMEOUT waiting $url" >&2
  return 1
}

pg_ready() {
  docker exec inneragent-postgres pg_isready -U inneragent -d inneragent >/dev/null 2>&1
}

env_up() {
  echo "== [1/4] compose(PG ${DB_PORT} / Redis ${REDIS_PORT},端口错峰覆盖)=="
  if docker ps --format '{{.Names}}' | grep -q '^inneragent-postgres$'; then
    echo "  inneragent-postgres 已在跑,复用"
  else
    docker compose -f "$REPO/docker/dev-compose.yml" -f "$REPO/scripts/dev-compose.e2e-ports.yml" up -d || return 2
  fi
  local i
  for i in $(seq 1 60); do pg_ready && break; sleep 1; done
  pg_ready && echo "  PG healthy" || { echo "  PG 未就绪"; return 2; }

  echo "== [2/4] 主服务 18090(java -jar;IA_ADMIN_KEY=${ADMIN_KEY},bootstrap=${ADMIN_USER})=="
  if lsof -ti :18090 >/dev/null 2>&1; then
    echo "  18090 已被占用,复用既有进程(不代杀)"
  else
    ( cd "$REPO/inneragent-server" && \
      export JAVA_HOME=$(/usr/libexec/java_home -v 21) && \
      IA_ADMIN_KEY="$ADMIN_KEY" \
      IA_ADMIN_BOOTSTRAP_USERNAME="$ADMIN_USER" \
      IA_ADMIN_BOOTSTRAP_PASSWORD="$ADMIN_PASSWORD" \
      IA_DB_PORT="$DB_PORT" IA_REDIS_PORT="$REDIS_PORT" \
      IA_CORS_ALLOWED_ORIGINS="${IA_CORS_ALLOWED_ORIGINS:-http://localhost:9203,http://localhost:18081}" \
      exec java -jar target/inneragent-server-0.1.0-SNAPSHOT.jar ) > "$LOGDIR/server.log" 2>&1 &
    echo $! > "$LOGDIR/server.pid"
    echo "  server pid=$(cat "$LOGDIR/server.pid"),日志 $LOGDIR/server.log"
  fi
  wait_url "$IA_BASE_URL/.well-known/jwks.json" 240 || return 2
  # 所有权校验:admin API 必须认本脚本的 IA_ADMIN_KEY(端口被并行环境抢占则失败)
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$IA_BASE_URL/ia/api/v1/admin/tools" -H "X-IA-Admin-Key: $ADMIN_KEY")
  [[ "$code" == "200" ]] || { echo "  18090 不认本环境 IA_ADMIN_KEY(admin=$code),错峰让位"; return 3; }
  echo "  admin API 鉴权 OK(X-IA-Admin-Key)"

  echo "== [3/4] web 生产构建(绕开 dev 模式 msw)=="
  if [[ ! -f "$REPO/web/dist/index.html" || "$REPO/web/src" -nt "$REPO/web/dist/index.html" ]]; then
    ( cd "$REPO/web" && pnpm build ) > "$LOGDIR/web-build.log" 2>&1 \
      && echo "  pnpm build OK" || { echo "  pnpm build FAILED(见 $LOGDIR/web-build.log)"; return 2; }
  else
    echo "  dist 已是最新,跳过构建"
  fi

  echo "== [4/4] 网关 18081(静态 dist + /ia 反代)=="
  if lsof -ti :${GATEWAY_PORT} >/dev/null 2>&1; then
    echo "  ${GATEWAY_PORT} 已被占用,复用既有网关"
  else
    ( node "$E2E/gateway.mjs" ) > "$LOGDIR/gateway.log" 2>&1 &
    echo $! > "$LOGDIR/gateway.pid"
    echo "  gateway pid=$(cat "$LOGDIR/gateway.pid")"
  fi
  wait_url "$GATEWAY_URL/" 30 || return 2
  curl -s -o /dev/null -w '  反代探测 /ia/api/v1/admin/auth/login(POST 探测略)→ %{http_code}\n' "$GATEWAY_URL/"
  echo "== 环境就绪:管理站 $GATEWAY_URL · 主服务 $IA_BASE_URL =="
}

env_down() {
  echo "== 清理 =="
  for name in gateway server; do
    local pidfile="$LOGDIR/$name.pid"
    if [[ -f "$pidfile" ]]; then
      local pid
      pid=$(cat "$pidfile")
      if kill -0 "$pid" 2>/dev/null; then
        # java -jar 由 exec 启动无包装进程;gateway 为 node;直接 kill 并确认退出
        kill "$pid" 2>/dev/null; sleep 1
        kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null
        echo "  $name(pid=$pid)已停止"
      else
        echo "  $name(pid=$pid)已不在运行"
      fi
      rm -f "$pidfile"
    fi
  done
  # 端口兜底核查(只报不杀非本脚本的进程)
  for port in 18090 18081; do
    if lsof -ti :$port >/dev/null 2>&1; then
      echo "  警告:端口 $port 仍有监听:$(lsof -ti :$port | tr '\n' ' ')"
    else
      echo "  端口 $port 无监听 ✓"
    fi
  done
  echo "== compose down =="
  docker compose -f "$REPO/docker/dev-compose.yml" -f "$REPO/scripts/dev-compose.e2e-ports.yml" down 2>&1 | tail -2
  sleep 1
  for port in 35432 36379; do
    if docker ps --format '{{.Ports}}' | grep -q ":$port->"; then
      echo "  警告:容器端口 $port 仍在映射"
    else
      echo "  容器端口 $port 已释放 ✓"
    fi
  done
}

env_status() {
  echo "compose: $(docker ps --format '{{.Names}} {{.Status}}' | grep inneragent || echo '未运行')"
  echo "18090:  $(lsof -ti :18090 >/dev/null 2>&1 && echo UP || echo down)"
  echo "18081:  $(lsof -ti :18081 >/dev/null 2>&1 && echo UP || echo down)"
}

case "$1" in
  up) env_up ;;
  down) env_down ;;
  status) env_status ;;
  *) echo "用法: source e2e/env.sh {up|down|status}" ;;
esac
