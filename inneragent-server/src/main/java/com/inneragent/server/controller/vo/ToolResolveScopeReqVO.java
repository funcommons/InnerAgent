package com.inneragent.server.controller.vo;

import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;

import java.util.Map;

/**
 * resolve_scope 反查 REST 入参(PRD §6.1.4 前端上下文字段)。
 *
 * <p>[adapt] P1-T3c 收口裁决:保留为薄 REST 封装(包 ResolveScopeService)。
 * 字段对齐 inneragent-starter {@code InnerAgentBridgeClient.ResolveScopeRequest};
 * userId/tenantId 仅作上报留档,身份以当前认证(embed token/演示头)为准。
 */
@Schema(description = "resolve_scope 反查入参")
@Data
public class ToolResolveScopeReqVO {

    /** 上报用户(不作为身份依据;服务端取当前认证身份) */
    private String userId;

    /** 上报租户(不作为身份依据) */
    private String tenantId;

    /** 当前页标识(SDK setPage 上报) */
    private String pageId;

    /** 当前页名称 */
    private String pageName;

    /** 当前对象标识(SDK setObject 上报) */
    private String objectId;

    /** 当前对象域(如 user/product) */
    private String objectType;

    /** 扩展键值(SDK setContext 透传) */
    private Map<String, String> custom;
}
