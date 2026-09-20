#!/usr/bin/env zsh
# [audit] 移植差异审计(技术方案 §3.4 / 开发计划 P0-T6)
# 原理:用 port-report.txt 的 src->dst 全量清单生成 FQN 改名对(文件级,最具体),
#       加包级改名与 package 声明归一化,把融光原文件规范化后与移植产物逐文件 diff。
#       预期:除 platform 目录与 [adapt] 白名单外零差异。
# 用法:scripts/audit-port-diff.sh [白名单文件(每行一个 dst 相对路径)]
set -euo pipefail

FUSION_J=/Users/justin/codes/funcommons/mmagix-minicuts-backup/ai-fusion-video/src/main/java/com/stonewu/fusion
DST=/Users/justin/codes/funcommons/InnerAgent/inneragent-server/src/main/java/com/inneragent
REPORT=/Users/justin/codes/funcommons/InnerAgent/scripts/port-report.txt
WHITELIST=${1:-/dev/null}
TMP=$(mktemp -d)
trap 'rm -rf $TMP' EXIT

# 包级改名(先长后短;兜底 platform 之前用)
PAIRS="$TMP/pairs.pl":  # 文件级改名对 perl 代码,下面生成
PAIRS="${PAIRS%:}"
: > "$PAIRS"
while IFS= read -r line; do
  [[ "$line" != *" -> "* ]] && continue
  s=${line%% -> *}; d=${line#* -> }
  [[ "$s" == *.java ]] || continue
  o="com.stonewu.fusion.${s%.java}"; o=${o//\//.}
  n="com.inneragent.${d%.java}"; n=${n//\//.}
  printf 's/\\Q%s\\E/%s/g;\n' "$o" "$n" >> "$PAIRS"
done < "$REPORT"

# 包级改名 perl(子包先于父包)
cat > "$TMP/pkg.pl" <<'PERL'
s/\Qcom.stonewu.fusion.service.ai.agentscope.kernel\E/com.inneragent.agent.kernel/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.state\E/com.inneragent.agent.state/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.workspace\E/com.inneragent.agent.workspace/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.mcp\E/com.inneragent.agent.mcp/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.skill\E/com.inneragent.agent.skill/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.context\E/com.inneragent.agent.context/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.runtime\E/com.inneragent.agent.runtime/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.message\E/com.inneragent.agent.message/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.permission\E/com.inneragent.agent.permission/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope.tool\E/com.inneragent.agent.tool/g;
s/\Qcom.stonewu.fusion.service.ai.agentscope\E/com.inneragent.agent.kernel/g;
s/\Qcom.stonewu.fusion.service.ai.run\E/com.inneragent.agent.run/g;
s/\Qcom.stonewu.fusion.service.ai.provider\E/com.inneragent.model.provider/g;
s/\Qcom.stonewu.fusion.entity.ai\E/com.inneragent.agent.entity/g;
s/\Qcom.stonewu.fusion.mapper.ai\E/com.inneragent.agent.mapper/g;
s/\Qcom.stonewu.fusion.controller.ai\E/com.inneragent.server.controller/g;
s/com\.stonewu\.fusion\./com.inneragent.platform./g;
s/afv_/ia_/g;
PERL

diffs=0; clean=0; adapt=0
while IFS= read -r line; do
  [[ "$line" != *" -> "* ]] && continue
  src=${line%% -> *}; dst=${line#* -> }
  [[ ! -f "$FUSION_J/$src" || ! -f "$DST/$dst" ]] && continue
  if grep -qxF "$dst" "$WHITELIST" 2>/dev/null; then adapt=$((adapt+1)); continue; fi
  norm="$TMP/$dst"
  mkdir -p "$(dirname "$norm")"
  cp "$FUSION_J/$src" "$norm"
  perl -pi -e "$(cat "$PAIRS")" "$norm"       # 文件级 FQN 全量
  perl -pi -e "$(cat "$TMP/pkg.pl")" "$norm"  # 包级 + platform 兜底
  dstpkg="com.inneragent.${dst%/*}"; dstpkg=${dstpkg//\//.}
  perl -pi -e "s/^package .+;/package $dstpkg;/" "$norm"
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
