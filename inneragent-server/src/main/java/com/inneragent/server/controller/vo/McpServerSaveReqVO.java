package com.inneragent.server.controller.vo;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 三方 MCP 服务器注册/更新请求体(P4-W13;应用级与用户级同形)。
 *
 * <p>字段校验在服务层(McpThirdPartyServerSupport):serverKey 字符集、
 * transport=streamable-http、STATIC_HEADER 头名/值必填、OAUTH 配置即 501。
 * {@code credentials} 为静态头值(落库 TEXT,加密可延后,值不进审计/日志,
 * 响应中永以打码形回显)。
 *
 * <p><strong>credentials 空值语义(K③定案)</strong>:注册必填(缺省 400);
 * 更新 null/空串 = 保持原值(编辑流回传打码形前的省略写法),显式非空 =
 * 覆盖;不提供「清空」语义(STATIC_HEADER 无值即残废;撤销凭据请删除该
 * 三方服务)。
 */
@Schema(description = "三方 MCP 服务器注册/更新请求")
public record McpServerSaveReqVO(
        @Schema(description = "服务器键(FQN 命名空间,字母/数字/连字符)") String serverKey,
        @Schema(description = "展示名") String name,
        @Schema(description = "Streamable HTTP 端点 URL") String endpointUrl,
        @Schema(description = "传输方式(缺省 streamable-http)") String transport,
        @Schema(description = "鉴权策略:STATIC_HEADER(缺省)/OAUTH(501)") String authType,
        @Schema(description = "静态头名(STATIC_HEADER 必填)") String headerName,
        @Schema(description = "静态头值(注册必填;更新 null/空串=保持原值,"
                + "显式非空=覆盖;响应永打码回显)") String credentials,
        @Schema(description = "tools/call 超时(秒,1-600,缺省 30)") Integer timeoutSeconds,
        @Schema(description = "是否启用(缺省 true)") Boolean enabled) {
}
