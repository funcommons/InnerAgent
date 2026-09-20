#!/usr/bin/env zsh
# P0 冒烟:建会话 → SSE 出流 → 断开 → Last-Event-ID 重连续流(开发计划 §3.4)
# 依赖:P0-T5 的演示 Agent 与匿名演示头(X-IA-Demo-User);BASE 默认本机 18090
set -euo pipefail
BASE=${IA_BASE:-http://localhost:18090}
DEMO_USER=${IA_DEMO_USER:-12993}
JAR=$(mktemp); trap 'rm -f $JAR' EXIT

echo "[1] 发起运行(SSE 前 8 个事件)…"
curl -sN -X POST "$BASE/api/ai/pipeline/run" \
  -H "Content-Type: application/json" \
  -H "X-IA-Demo-User: $DEMO_USER" \
  -d '{"conversationId":null,"content":"现在几点了?","enabledSkills":[]}' \
  | tee "$JAR.raw" &
CURL_PID=$!
sleep 3; kill $CURL_PID 2>/dev/null || true
head -16 "$JAR.raw"

RUN_ID=$(grep -oE '"runId":"[a-zA-Z0-9-]+"' "$JAR.raw" | head -1 | cut -d'"' -f4)
LAST_ID=$(grep -oE '^id: .*' "$JAR.raw" | tail -1 | awk '{print $2}')
[[ -z "$RUN_ID" || -z "$LAST_ID" ]] && { echo "SMOKE FAIL: 未取得 runId/lastEventId"; exit 1; }
echo "[2] runId=$RUN_ID lastEventId=$LAST_ID;断开后重连…"
curl -sN "$BASE/api/ai/pipeline/reconnect?runId=$RUN_ID" \
  -H "Last-Event-ID: $LAST_ID" -H "X-IA-Demo-User: $DEMO_USER" \
  | head -16
echo "[3] 校验落库(runId:seq 连续)由调用方人工/测试类执行;SMOKE DONE"
