#!/usr/bin/env zsh
# [audit] 移植差异审计(技术方案 §3.4 / 开发计划 P0-T6)
# 原理:用 port-report.txt 的 src->dst 清单,把融光原文件按同一套改名规则规范化,
#       再与移植产物逐文件 diff。预期:除 platform 目录与 [adapt] 白名单外零差异。
# 用法:scripts/audit-port-diff.sh [白名单文件(每行一个 dst 相对路径)]
set -euo pipefail

FUSION_J=/Users/justin/codes/funcommons/mmagix-minicuts-backup/ai-fusion-video/src/main/java/com/stonewu/fusion
DST=/Users/justin/codes/funcommons/InnerAgent/inneragent-server/src/main/java/com/inneragent
REPORT=/Users/justin/codes/funcommons/InnerAgent/scripts/port-report.txt
WHITELIST=${1:-/dev/null}
TMP=$(mktemp -d)
trap 'rm -rf $TMP' EXIT

# 与 port-kernel.sh 相同的包级改名(先长后短)
typeset -a renames
renames=(
  "com.stonewu.fusion.service.ai.agentscope.kernel|com.inneragent.agent.kernel"
  "com.stonewu.fusion.service.ai.agentscope.state|com.inneragent.agent.state"
  "com.stonewu.fusion.service.ai.agentscope.workspace|com.inneragent.agent.workspace"
  "com.stonewu.fusion.service.ai.agentscope.mcp|com.inneragent.agent.mcp"
  "com.stonewu.fusion.service.ai.agentscope.skill|com.inneragent.agent.skill"
  "com.stonewu.fusion.service.ai.agentscope.context|com.inneragent.agent.context"
  "com.stonewu.fusion.service.ai.agentscope.runtime|com.inneragent.agent.runtime"
  "com.stonewu.fusion.service.ai.agentscope.message|com.inneragent.agent.message"
  "com.stonewu.fusion.service.ai.agentscope.permission|com.inneragent.agent.permission"
  "com.stonewu.fusion.service.ai.agentscope.tool|com.inneragent.agent.tool"
  "com.stonewu.fusion.service.ai.agentscope|com.inneragent.agent.kernel"
  "com.stonewu.fusion.service.ai.run|com.inneragent.agent.run"
  "com.stonewu.fusion.service.ai.provider|com.inneragent.model.provider"
)

diffs=0; clean=0; skipped=0; adapt=0
while IFS= read -r line; do
  [[ "$line" != *" -> "* ]] && continue
  src=${line%% -> *}; dst=${line#* -> }
  [[ ! -f "$FUSION_J/$src" || ! -f "$DST/$dst" ]] && continue
  # 平台兼容层与已知 [adapt] 文件不在机械移植断言范围
  if grep -qxF "$dst" "$WHITELIST" 2>/dev/null; then adapt=$((adapt+1)); continue; fi
  norm="$TMP/$dst"
  mkdir -p "$(dirname "$norm")"
  cp "$FUSION_J/$src" "$norm"
  for r in $renames; do
    old=${r%%|*}; new=${r#*|}
    perl -pi -e "s/\Q$old\E/$new/g" "$norm"
  done
  perl -pi -e 's/com\.stonewu\.fusion\./com.inneragent.platform./g' "$norm"
  if diff -q "$norm" "$DST/$dst" >/dev/null; then
    clean=$((clean+1))
  else
    diffs=$((diffs+1))
    echo "DIFF: $dst"
    diff "$norm" "$DST/$dst" | head -6
  fi
done < "$REPORT"

echo "=============================="
echo "clean=$clean diff=$diffs adapt-whitelist=$adapt"
[[ "$diffs" -eq 0 ]] && echo "AUDIT PASS" || echo "AUDIT FAIL"
exit $((diffs > 0 ? 1 : 0))
