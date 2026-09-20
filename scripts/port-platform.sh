#!/usr/bin/env zsh
# [adapt] T2 platform 兼容层:融光平台支撑类 → com.inneragent.platform.*
# 规则:
#   1) 从融光同相对路径复制,全文 com.stonewu.fusion.* 中"已映射到内核新包"的 FQN 先行改写,
#      其余 com.stonewu.fusion.* → com.inneragent.platform.*
#   2) onetoken 栈 / ComfyUI 域 / plan(依赖 Project/Storyboard 重业务域)不复制,调用点 [adapt] 去耦
#   3) platform 下 entity/mapper 的 afv_ → ia_(与内核实体同规则)
set -euo pipefail

SRC=/Users/justin/codes/funcommons/mmagix-minicuts-backup/ai-fusion-video/src/main/java/com/stonewu/fusion
DST=/Users/justin/codes/funcommons/InnerAgent/inneragent-server/src/main/java/com/inneragent/platform
PLAT=com.inneragent.platform

# ---------- 复制清单(融光相对路径) ----------
files=(
  common/BaseEntity.java
  common/TenantBaseEntity.java
  common/BusinessException.java
  common/CommonResult.java
  common/PageParam.java
  common/PageResult.java
  common/handler/JsonbTypeHandler.java
  tenant/TenantContext.java
  config/AgentScopeV2Properties.java
  config/AgentScopeRuntimeProperties.java
  config/ai/AiAgentDefinition.java
  config/ai/AiAgentRegistry.java
  enums/ai/AgentModelCallStatus.java
  enums/ai/AgentRunStatus.java
  enums/ai/AgentRuntimeErrorCode.java
  enums/ai/AgentTerminalOutputType.java
  enums/ai/AiModelTypeEnum.java
  repository/ai/AgentEventRepository.java
  repository/ai/AgentModelCallUsageRepository.java
  repository/ai/AgentRunRepository.java
  repository/ai/MySqlAgentEventRepository.java
  repository/ai/MybatisAgentModelCallUsageRepository.java
  entity/storage/StorageConfig.java
  mapper/storage/StorageConfigMapper.java
  service/storage/StorageConfigService.java
  service/storage/S3ClientFactory.java
  service/storage/S3StorageConfigResolver.java
  service/storage/StorageConfigReferenceGuard.java
  service/storage/ResolvedS3StorageConfig.java
  service/storage/StorageTypes.java
  service/storage/LocalMediaPathUtils.java
  service/storage/StorageProviderProfile.java
  service/storage/StorageProviderRegistry.java
  service/storage/StorageConfigOptions.java
  security/SecurityUtils.java
  security/SecurityUserDetails.java
  service/ai/model/AiModelMetadata.java
  service/ai/model/AiModelMetadataResolver.java
  service/ai/model/AiModelRequestOptions.java
  service/ai/model/RemoteModelMetadata.java
  service/ai/dashscope/DashScopeGenerationSupport.java
  service/ai/proxy/AiProxySupport.java
  convert/ai/AiModelConvert.java
  convert/ai/ApiConfigConvert.java
)

for f in $files; do
  mkdir -p "$DST/$(dirname $f)"
  cp "$SRC/$f" "$DST/$f"
  echo "platform: $f"
done

# ---------- FQN 改写:已移植到内核新包的 FQN 先行(长→短),其余归 platform ----------
apply_x() { find "$DST" -name '*.java' -print0 | xargs -0 perl -pi -e "$1"; }

typeset -a renames
renames=(
  # service/ai 根文件(文件级映射,先于其父包规则)
  "com.stonewu.fusion.service.ai.ApiConfigService|com.inneragent.model.config.ApiConfigService"
  "com.stonewu.fusion.service.ai.AiModelService|com.inneragent.model.config.AiModelService"
  "com.stonewu.fusion.service.ai.ChatModelFactory|com.inneragent.model.config.ChatModelFactory"
  "com.stonewu.fusion.service.ai.AgentConversationService|com.inneragent.agent.conversation.AgentConversationService"
  "com.stonewu.fusion.service.ai.AgentMessageService|com.inneragent.agent.conversation.AgentMessageService"
  "com.stonewu.fusion.service.ai.AiAgentService|com.inneragent.agent.definition.AiAgentService"
  "com.stonewu.fusion.service.ai.AiToolConfigService|com.inneragent.agent.tool.AiToolConfigService"
  "com.stonewu.fusion.service.ai.ToolExecutionContext|com.inneragent.agent.tool.ToolExecutionContext"
  "com.stonewu.fusion.service.ai.ToolExecutorRegistry|com.inneragent.agent.tool.ToolExecutorRegistry"
  "com.stonewu.fusion.service.ai.ToolExecutor|com.inneragent.agent.tool.ToolExecutor"
  "com.stonewu.fusion.service.ai.ToolPermissionRisk|com.inneragent.agent.tool.ToolPermissionRisk"
  # 内核 service/ai/run.* → agent/run.*
  "com.stonewu.fusion.service.ai.run|com.inneragent.agent.run"
  # 实体(文件级,先于 entity.ai 父包)
  "com.stonewu.fusion.entity.ai.AgentConversation|com.inneragent.agent.entity.AgentConversation"
  "com.stonewu.fusion.entity.ai.AgentEvent|com.inneragent.agent.entity.AgentEvent"
  "com.stonewu.fusion.entity.ai.AgentMcpServer|com.inneragent.agent.entity.AgentMcpServer"
  "com.stonewu.fusion.entity.ai.AgentMessage|com.inneragent.agent.entity.AgentMessage"
  "com.stonewu.fusion.entity.ai.AgentModelCallUsage|com.inneragent.agent.entity.AgentModelCallUsage"
  "com.stonewu.fusion.entity.ai.AgentRun|com.inneragent.agent.entity.AgentRun"
  "com.stonewu.fusion.entity.ai.AgentStateCleanupPolicy|com.inneragent.agent.entity.AgentStateCleanupPolicy"
  "com.stonewu.fusion.entity.ai.AgentWorkspaceConfig|com.inneragent.agent.entity.AgentWorkspaceConfig"
  "com.stonewu.fusion.entity.ai.AgentWorkspaceEntry|com.inneragent.agent.entity.AgentWorkspaceEntry"
  "com.stonewu.fusion.entity.ai.AgentWorkspaceMigrationItem|com.inneragent.agent.entity.AgentWorkspaceMigrationItem"
  "com.stonewu.fusion.entity.ai.AgentWorkspaceMigration|com.inneragent.agent.entity.AgentWorkspaceMigration"
  "com.stonewu.fusion.entity.ai.AiModel|com.inneragent.model.entity.AiModel"
  "com.stonewu.fusion.entity.ai.ApiConfig|com.inneragent.model.entity.ApiConfig"
  # mapper(文件级,先于 mapper.ai 父包)
  "com.stonewu.fusion.mapper.ai.AgentConversationMapper|com.inneragent.agent.mapper.AgentConversationMapper"
  "com.stonewu.fusion.mapper.ai.AgentEventMapper|com.inneragent.agent.mapper.AgentEventMapper"
  "com.stonewu.fusion.mapper.ai.AgentMcpServerMapper|com.inneragent.agent.mapper.AgentMcpServerMapper"
  "com.stonewu.fusion.mapper.ai.AgentMessageMapper|com.inneragent.agent.mapper.AgentMessageMapper"
  "com.stonewu.fusion.mapper.ai.AgentModelCallUsageMapper|com.inneragent.agent.mapper.AgentModelCallUsageMapper"
  "com.stonewu.fusion.mapper.ai.AgentRunMapper|com.inneragent.agent.mapper.AgentRunMapper"
  "com.stonewu.fusion.mapper.ai.AgentStateCleanupPolicyMapper|com.inneragent.agent.mapper.AgentStateCleanupPolicyMapper"
  "com.stonewu.fusion.mapper.ai.AgentWorkspaceConfigMapper|com.inneragent.agent.mapper.AgentWorkspaceConfigMapper"
  "com.stonewu.fusion.mapper.ai.AgentWorkspaceEntryMapper|com.inneragent.agent.mapper.AgentWorkspaceEntryMapper"
  "com.stonewu.fusion.mapper.ai.AgentWorkspaceMigrationItemMapper|com.inneragent.agent.mapper.AgentWorkspaceMigrationItemMapper"
  "com.stonewu.fusion.mapper.ai.AgentWorkspaceMigrationMapper|com.inneragent.agent.mapper.AgentWorkspaceMigrationMapper"
  "com.stonewu.fusion.mapper.ai.AiModelMapper|com.inneragent.model.mapper.AiModelMapper"
  "com.stonewu.fusion.mapper.ai.ApiConfigMapper|com.inneragent.model.mapper.ApiConfigMapper"
  # 控制器 VO(供 convert 使用)
  "com.stonewu.fusion.controller.ai.vo.comfyui|com.inneragent.server.controller.vo.comfyui"
  "com.stonewu.fusion.controller.ai.vo|com.inneragent.server.controller.vo"
  "com.stonewu.fusion.controller.ai|com.inneragent.server.controller"
)
for r in $renames; do
  old=${r%%|*}; new=${r#*|}
  apply_x "s/\Q$old\E/$new/g"
done
# 其余 com.stonewu.fusion.* → com.inneragent.platform.*
apply_x "s/com\\.stonewu\\.fusion\\./$PLAT./g"
# platform 下实体/表名 afv_ → ia_(与内核实体同规则)
apply_x 's/afv_/ia_/g'

# ---------- [adapt] SecurityUserDetails 接口窄化 ----------
# 融光版有两个依赖 entity.system.User/Role(用户域,不移植)的便捷构造器;
# 保留纯值构造器,删除实体构造器,Spring Security UserDetails 契约不变。
perl -0pi -e 's/\n    public SecurityUserDetails\(User user, List<Role> roles(?:, Long currentTeamId)?\) \{\n.*?\n    \}\n//sg' "$DST/security/SecurityUserDetails.java"
perl -pi -e 's/^import com\.inneragent\.platform\.entity\.system\.(Role|User);$//' "$DST/security/SecurityUserDetails.java"

# ---------- package 声明归一化 ----------
for f in $(find "$DST" -name '*.java'); do
  rel=${f#$DST/}; dirpkg="com.inneragent.platform.${${rel%/*}//\//.}"
  declared=$(grep -m1 '^package ' "$f" | sed 's/package //;s/;//' || true)
  if [[ "$dirpkg" != "$declared" ]]; then
    perl -pi -e "s/^package \Q${declared}\E;/package $dirpkg;/" "$f"
  fi
done

echo "platform files: $(find "$DST" -name '*.java' | wc -l | tr -d ' ')"
