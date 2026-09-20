#!/usr/bin/env zsh
# [port] 机械移植脚本:融光 ai-fusion-video 内核 → inneragent-server
# 规则(技术方案 §4.1):
#   1) 目录级映射(见 map_dir),文件级映射(见 map_file)
#   2) 全文 FQN 替换:文件级(最长)先行,再目录级;未映射的 com.stonewu.fusion.* → com.inneragent.platform.*(T2 兼容层同名提供)
#   3) 实体 @TableName 中 afv_ → ia_
#   4) onetoken 栈不移植(Onetoken* 一律 SKIP)
#   5) 收尾将所有 package 声明归一化为目录实际包名(规避目录级中间名残留)
# 产出报告到 scripts/port-report.txt;不做任何语义修改,语义修改一律走 [adapt] 提交。
set -euo pipefail

SRC=/Users/justin/codes/funcommons/mmagix-minicuts-backup/ai-fusion-video/src/main/java/com/stonewu/fusion
RES_SRC=/Users/justin/codes/funcommons/mmagix-minicuts-backup/ai-fusion-video/src/main/resources
DST=/Users/justin/codes/funcommons/InnerAgent/inneragent-server/src/main/java/com/inneragent
RES_DST=/Users/justin/codes/funcommons/InnerAgent/inneragent-server/src/main/resources
OLDJ=com.stonewu.fusion

# ---------- 目录级映射 ----------
typeset -A map_dir
map_dir=(
  service/ai/run            agent/run
  service/ai/agentscope/kernel     agent/kernel
  service/ai/agentscope/state      agent/state
  service/ai/agentscope/workspace  agent/workspace
  service/ai/agentscope/mcp        agent/mcp
  service/ai/agentscope/skill      agent/skill
  service/ai/agentscope/context    agent/context
  service/ai/agentscope/runtime    agent/runtime
  service/ai/agentscope/message    agent/message
  service/ai/agentscope/permission agent/permission
  service/ai/agentscope/tool       agent/tool
  service/ai/provider       model/provider
  controller/ai             server/controller
)

# ---------- 文件级映射(root files,源相对 $SRC → 目标相对 $DST) ----------
typeset -A map_file
map_file=(
  # agentscope 根 4 文件 → agent/kernel
  service/ai/agentscope/AgentScopePipelineRunService.java   agent/kernel/AgentScopePipelineRunService.java
  service/ai/agentscope/AgentScopeToolAdapter.java          agent/kernel/AgentScopeToolAdapter.java
  service/ai/agentscope/AgentScopeSubAgentToolAdapter.java  agent/kernel/AgentScopeSubAgentToolAdapter.java
  service/ai/agentscope/AgentScopeModelFactory.java         agent/kernel/AgentScopeModelFactory.java
  # service/ai 根文件
  service/ai/AgentConversationService.java                  agent/conversation/AgentConversationService.java
  service/ai/AgentMessageService.java                       agent/conversation/AgentMessageService.java
  service/ai/AiAgentService.java                            agent/definition/AiAgentService.java
  service/ai/AiToolConfigService.java                       agent/tool/AiToolConfigService.java
  service/ai/ToolExecutionContext.java                      agent/tool/ToolExecutionContext.java
  service/ai/ToolExecutor.java                              agent/tool/ToolExecutor.java
  service/ai/ToolExecutorRegistry.java                      agent/tool/ToolExecutorRegistry.java
  service/ai/ToolPermissionRisk.java                        agent/tool/ToolPermissionRisk.java
  service/ai/AiModelService.java                            model/config/AiModelService.java
  service/ai/ApiConfigService.java                          model/config/ApiConfigService.java
  service/ai/ChatModelFactory.java                          model/config/ChatModelFactory.java
  service/ai/ModelPresetService.java                        model/config/ModelPresetService.java
  service/ai/AiModelMultimodalCapabilities.java             model/config/AiModelMultimodalCapabilities.java
  service/ai/AiStreamRedisService.java                      agent/run/AiStreamRedisService.java
  # 实体:Agent 系列 → agent/entity;AiModel/ApiConfig → model/entity(ComfyUI 不移植)
  entity/ai/AgentConversation.java                          agent/entity/AgentConversation.java
  entity/ai/AgentEvent.java                                 agent/entity/AgentEvent.java
  entity/ai/AgentMcpServer.java                             agent/entity/AgentMcpServer.java
  entity/ai/AgentMessage.java                               agent/entity/AgentMessage.java
  entity/ai/AgentModelCallUsage.java                        agent/entity/AgentModelCallUsage.java
  entity/ai/AgentRun.java                                   agent/entity/AgentRun.java
  entity/ai/AgentStateCleanupPolicy.java                    agent/entity/AgentStateCleanupPolicy.java
  entity/ai/AgentWorkspaceConfig.java                       agent/entity/AgentWorkspaceConfig.java
  entity/ai/AgentWorkspaceEntry.java                        agent/entity/AgentWorkspaceEntry.java
  entity/ai/AgentWorkspaceMigration.java                    agent/entity/AgentWorkspaceMigration.java
  entity/ai/AgentWorkspaceMigrationItem.java                agent/entity/AgentWorkspaceMigrationItem.java
  entity/ai/AiModel.java                                    model/entity/AiModel.java
  entity/ai/ApiConfig.java                                  model/entity/ApiConfig.java
  # mapper:Agent 系列 + AiModel/ApiConfig(ComfyUI 不移植)
  mapper/ai/AgentConversationMapper.java                    agent/mapper/AgentConversationMapper.java
  mapper/ai/AgentEventMapper.java                           agent/mapper/AgentEventMapper.java
  mapper/ai/AgentMcpServerMapper.java                       agent/mapper/AgentMcpServerMapper.java
  mapper/ai/AgentMessageMapper.java                         agent/mapper/AgentMessageMapper.java
  mapper/ai/AgentModelCallUsageMapper.java                  agent/mapper/AgentModelCallUsageMapper.java
  mapper/ai/AgentRunMapper.java                             agent/mapper/AgentRunMapper.java
  mapper/ai/AgentStateCleanupPolicyMapper.java              agent/mapper/AgentStateCleanupPolicyMapper.java
  mapper/ai/AgentWorkspaceConfigMapper.java                 agent/mapper/AgentWorkspaceConfigMapper.java
  mapper/ai/AgentWorkspaceEntryMapper.java                  agent/mapper/AgentWorkspaceEntryMapper.java
  mapper/ai/AgentWorkspaceMigrationMapper.java              agent/mapper/AgentWorkspaceMigrationMapper.java
  mapper/ai/AgentWorkspaceMigrationItemMapper.java          agent/mapper/AgentWorkspaceMigrationItemMapper.java
  mapper/ai/AiModelMapper.java                              model/mapper/AiModelMapper.java
  mapper/ai/ApiConfigMapper.java                            model/mapper/ApiConfigMapper.java
)

report=/Users/justin/codes/funcommons/InnerAgent/scripts/port-report.txt
: > $report
copied=0

copy_one() { # $1=源相对  $2=目标相对
  mkdir -p "$DST/$(dirname $2)"
  cp "$SRC/$1" "$DST/$2"
  echo "$1 -> $2" >> $report
}

# 目录级:排除 GoogleFlow 与 ComfyUI
for k in ${(k)map_dir}; do
  if [[ -d "$SRC/$k" ]]; then
    for f in $(find "$SRC/$k" -name '*.java' | sort); do
      base=${f#$SRC/$k/}
      [[ "$base" == *GoogleFlow* ]] && { echo "SKIP(业务): $k/$base" >> $report; continue; }
      [[ "$base" == Onetoken* ]] && { echo "SKIP(onetoken): $k/$base" >> $report; continue; }
      [[ "$k" == entity/ai || "$k" == mapper/ai ]] && continue   # 实体与mapper走文件级(不可能到达,防御性保留)
      copy_one "$k/$base" "${map_dir[$k]}/$base"
      copied=$((copied+1))
    done
  fi
done

for k in ${(k)map_file}; do
  if [[ -f "$SRC/$k" ]]; then
    copy_one "$k" "${map_file[$k]}"
    copied=$((copied+1))
  else
    echo "MISSING: $k" >> $report
  fi
done

echo "copied=$copied" >> $report

# ---------- FQN 替换(文件级 FQN 先行,其次硬编码子包,最后目录级;避免父包规则抢先吃掉子路径) ----------
typeset -a renames
renames=()
# 1) 文件级 FQN(最长、最具体,必须最先)
for k in ${(k)map_file}; do
  oldfqn="$OLDJ.${k%.java}"
  oldfqn=${oldfqn//\//.}
  newfqn="com.inneragent.${${map_file[$k]}%.java}"
  newfqn=${newfqn//\//.}
  renames+=("$oldfqn|$newfqn")
done
# 2) 硬编码子包(agent.* 子域先于 service.ai 父包)
renames+=(
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
# 3) 目录级包声明
for k in ${(k)map_dir}; do
  oldpkg="$OLDJ.${k%/}"
  oldpkg=${oldpkg//\//.}
  newpkg="com.inneragent.${${map_dir[$k]}%/}"
  newpkg=${newpkg//\//.}
  renames+=("$oldpkg|$newpkg")
done

# 应用替换到所有移植文件(find -print0 | xargs -0 规避 zsh 不分词问题)
apply_x() { find "$DST" -name '*.java' -print0 | xargs -0 perl -pi -e "$1"; }
for r in $renames; do
  old=${r%%|*}; new=${r#*|}
  [[ -z "$old" ]] && continue
  apply_x "s/\Q$old\E/$new/g"
done
# 其余 com.stonewu.fusion.* → com.inneragent.platform.*(T2 同名提供)
apply_x 's/com\.stonewu\.fusion\./com.inneragent.platform./g'
# 实体表名 afv_ → ia_(仅 agent/model entity 与 mapper)
find "$DST/agent/entity" "$DST/model/entity" "$DST/agent/mapper" "$DST/model/mapper" -name '*.java' -print0 2>/dev/null | xargs -0 perl -pi -e 's/afv_/ia_/g' || true
# ---------- package 声明归一化:声明包 == 目录派生包 ----------
for f in $(find "$DST" -name '*.java'); do
  rel=${f#$DST/}; dirpkg="com.inneragent.${${rel%/*}//\//.}"
  declared=$(grep -m1 '^package ' "$f" | sed 's/package //;s/;//' || true)
  if [[ "$dirpkg" != "$declared" ]]; then
    perl -pi -e "s/^package \Q${declared}\E;/package $dirpkg;/" "$f"
  fi
done

# ---------- 资源(提示词/模型预设/agentscope skill 目录) ----------
for r in prompts/agents model-presets agentscope; do
  if [[ -e "$RES_SRC/$r" ]]; then
    mkdir -p "$RES_DST/$(dirname $r)"
    cp -R "$RES_SRC/$r" "$RES_DST/$r"
    echo "resource: $r" >> $report
  fi
done

echo "=== 剩余 com.stonewu 引用(应为 0) ===" >> $report
grep -rl 'com\.stonewu' "$DST" --include='*.java' >> $report 2>/dev/null || echo "none" >> $report
echo "=== 移植文件总数 ===" >> $report
find "$DST" -name '*.java' | wc -l >> $report
cat $report
