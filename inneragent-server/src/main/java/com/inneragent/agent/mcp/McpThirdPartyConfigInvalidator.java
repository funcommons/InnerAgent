package com.inneragent.agent.mcp;

/**
 * 三方 MCP 服务器配置变更失效端口(P4-W13)。
 *
 * <p>应用级/用户级服务器注册、更新、启停、删除后由服务层调用:失效每服务器
 * 工具清单 LRU 缓存与已建 MCP 客户端(端点/凭据变更后按新配置重建)。实现方
 * 为 {@code McpThirdPartyToolListCache}(P4-W13);服务侧经 ObjectProvider
 * 注入,Bean 未就绪时静默跳过(测试/裁剪部署,对齐 {@code ToolCatalogInvalidator}
 * 模式)。
 */
@FunctionalInterface
public interface McpThirdPartyConfigInvalidator {

    /** 任一三方服务器配置变更后的全量失效(LRU 懒回填,代价可接受)。 */
    void invalidateThirdPartyConfigs();
}
