package com.inneragent.platform.toolhub;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.inneragent.platform.common.BaseEntity;
import lombok.Data;
import lombok.EqualsAndHashCode;

import java.time.LocalDateTime;

/**
 * 应用工具注册条目(ia_tool_registry,V2 DDL + V6 分诊列;02-技术方案 §5.1)。
 *
 * <p>MCP 工具清单快照与治理策略:唯一键 (app_id, fqn);schema_sha256 为
 * 活刷新分诊(V14)的对比基准。行级双列拦截器对本表注入/过滤 app_id
 * (P1-T2a 已从 AppTenantLineInnerInterceptor.IGNORED_TABLES 移除)。
 */
@Data
@EqualsAndHashCode(callSuper = true)
@TableName("ia_tool_registry")
public class ToolRegistryEntry extends BaseEntity {

    /** 主键 ID */
    @TableId(type = IdType.AUTO)
    private Long id;

    /** 所属应用(单应用部署固定 1;由行级拦截器显式注入) */
    private Long appId;

    /** MCP 服务标识(serverKey,FQN 组成部分) */
    private String serverKey;

    /** 工具名(MCP tools/list 返回的 name;应用内唯一,冲突保护 PRD §6.2.1) */
    private String toolName;

    /** 工具全限定名 mcp__&lt;serverKey&gt;__&lt;toolName&gt;(唯一键 app_id+fqn,04-调研 V25) */
    private String fqn;

    /** 工具描述 */
    private String description;

    /** 入参 JSON Schema 快照(指纹计算与运行快照锁定用) */
    private String parametersSchema;

    /** MCP 注解原始 JSON(readOnlyHint/destructiveHint/idempotentHint/openWorldHint;仅可信宿主采信,V15) */
    private String annotationsJson;

    /** 风险等级:low/medium/high(注解生成默认+人工覆盖,PRD §6.2.1) */
    private String riskLevel;

    /** 管理员策略:force-ask/force-allow/deny;NULL-不强制 */
    private String adminPolicy;

    /** 可被 continue 重执行(默认取 idempotentHint,PRD §6.2.1/V34) */
    private Boolean resumeSafe;

    /** 是否并发安全 */
    private Boolean concurrencySafe;

    /** 来源:host_app/third_party/builtin */
    private String source;

    /** 三方 MCP 端点(host_app 经宿主桥暴露时为空;T2b 作 act token audience 绑定) */
    private String endpointUrl;

    /** 三方凭证(加密存储) */
    private String credentialsEnc;

    /** schema SHA-256 指纹(canonical JSON;注册时计算,V14 分诊基准) */
    private String schemaSha256;

    /** 工具版本/来源版本号(宿主上报,可空) */
    private String toolVersion;

    /** 活刷新分诊:存在安全相关差异待重新确认(V14;TRUE 时旧 schema 继续生效) */
    private Boolean revalidateRequired;

    /** BREAKING 分诊暂存的新 schema(重新确认通过后生效) */
    private String pendingSchema;

    /** BREAKING 分诊暂存的新注解 JSON */
    private String pendingAnnotationsJson;

    /** BREAKING 分诊暂存新 schema 指纹 */
    private String pendingSchemaSha256;

    /** 暂存写入时间 */
    private LocalDateTime pendingRefreshAt;

    /** 是否启用(停用从白名单摘除并级联失效授权,PRD §6.2.1) */
    private Boolean enabled;

    /** 最近一次工具体检/连通性测试结果 */
    private String lastTestStatus;
}
