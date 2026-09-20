---
name: inneragent-implementation-state
description: InnerAgent 无人值守实现的目标协议、构建命令与阶段进度锚点
metadata:
  type: project
---

InnerAgent(/Users/justin/codes/funcommons/InnerAgent)正在无人值守实现四份文档(01-PRD V1.3 / 02-技术方案 V1.1 / 03-开发计划 V1.1 / 04-对标调研)。参考代码只读:/Users/justin/codes/funcommons/mmagix-minicuts-backup/(前端 frontend/,后端 ai-fusion-video/)。

**Why:** 目标是 /goal 持久指令(实现全部文档,多子agent分工,每步≤1000行,写测试→写代码→测试→修复循环,单任务测试仅测对应代码且由子agent异步执行,>10%或>1000行或>10任务触发全量测试);会话压缩后需凭此恢复。

**How to apply:**
- 构建命令:`export JAVA_HOME=$(/usr/libexec/java_home -v 21) && cd inneragent-server && mvn -q compile`(系统 mvn 默认 JDK17,必须覆盖)。
- 移植:scripts/port-kernel.sh(机械复制+改名,244 文件);审计:scripts/audit-port-diff.sh(依据 scripts/port-report.txt);规范:移植改动 `[port]`、定向改造 `[adapt]`。
- 融光 service/ai/agentscope 子包映射到 com.inneragent.agent.{kernel,state,workspace,mcp,skill,context,runtime,message,permission,tool};run→agent.run;provider→model.provider;未移植依赖一律 com.inneragent.platform.*(从融光同路径复制改名)。
- 开发库:docker/dev-compose.yml(PG 15432 / Redis 16379);迁移规范见 inneragent-server/src/main/resources/db/migration/README.md(ia_ 前缀、app_id NOT NULL DEFAULT 1、event.schema_version)。
- 阶段:P0 移植基座(6 任务)→ P1 工具中枢/MCP/starter → P2 管理站/MVP → P3 融光灰度 → P4 增强。进度以任务列表(TaskList)为准。
