#!/usr/bin/env zsh
# P0 冒烟:建会话 → SSE 出流 → 断开 → Last-Event-ID 重连续流(开发计划 §3.4)
# 依赖:P0-T5 的演示 Agent(agentType=demo)+ mock 模型(V4__demo_seed.sql)+
#       匿名演示头(X-IA-Demo-User);BASE 默认本机 18090。
# 请求体字段以 AiChatReqVO 为准:message/agentType/toolExecutionMode/enabledSkills。
# 断言:输出需含 CONTENT 增量事件与终态 DONE 事件;落库(seq 连续)由调用方 psql 断言。
set -euo pipefail
BASE=${IA_BASE:-http://localhost:18090}
DEMO_USER=${IA_DEMO_USER:-12993}
JAR=$(mktemp); RECONNECT=$(mktemp); trap 'rm -f $JAR $RECONNECT' EXIT

echo "[1] 发起运行(SSE 前 12 个事件)…"
curl -sN -X POST "$BASE/api/ai/pipeline/run" \
  -H "Content-Type: application/json" \
  -H "X-IA-Demo-User: $DEMO_USER" \
  -d '{"conversationId":null,"message":"现在几点了?","agentType":"demo","toolExecutionMode":"DEFAULT","enabledSkills":[]}' \
  | tee "$JAR" &
CURL_PID=$!
sleep 3; kill $CURL_PID 2>/dev/null || true
head -24 "$JAR"

RUN_ID=$(grep -oE '"runId":"[a-zA-Z0-9-]+"' "$JAR" | head -1 | cut -d'"' -f4)
# SSE 行形如 "id:<runId>:<sequence>";cut -c4- 去掉 "id:" 前缀(兼容 BSD/GNU sed 差异)
LAST_ID=$(grep -E '^id:' "$JAR" | tail -1 | cut -c4- | tr -d '\r')
[[ -z "$RUN_ID" || -z "$LAST_ID" ]] && { echo "SMOKE FAIL: 未取得 runId/lastEventId"; exit 1; }
echo "[2] runId=$RUN_ID lastEventId=$LAST_ID;断开后重连…"
curl -sN "$BASE/api/ai/pipeline/reconnect?runId=$RUN_ID" \
  -H "Last-Event-ID: $LAST_ID" -H "X-IA-Demo-User: $DEMO_USER" \
  | head -64 | tee "$RECONNECT"

echo "[3] 断言 CONTENT 增量与终态 DONE…"
grep -q '"outputType":"CONTENT"' "$JAR" "$RECONNECT" \
  || { echo "SMOKE FAIL: 未出现 CONTENT 增量事件"; exit 1; }
grep -q '"outputType":"DONE"' "$JAR" "$RECONNECT" \
  || { echo "SMOKE FAIL: 未出现终态 DONE 事件"; exit 1; }
echo "SMOKE DONE"
