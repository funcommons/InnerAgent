package com.inneragent.platform.toolhub;

/**
 * 工具目录缓存失效端口(P1-T2a [new])。
 *
 * <p>注册表发生任何变更(注册/分诊/启停/删除)后由管理服务调用,
 * {@link com.inneragent.agent.mcp.McpToolCatalog} 实现并使 caffeine 缓存失效。
 * 服务侧经 ObjectProvider 注入:目录 Bean 未就绪时静默跳过(测试/裁剪部署)。
 */
@FunctionalInterface
public interface ToolCatalogInvalidator {

    /** 失效指定应用的目录缓存。 */
    void invalidate(long appId);
}
