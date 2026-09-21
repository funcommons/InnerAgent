package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.McpServerConfig;
import org.apache.ibatis.annotations.Mapper;

/**
 * ia_mcp_server_config 读写 Mapper(V18 应用级三方 MCP 服务器;包路径命中
 * {@code @MapperScan("com.inneragent.**.mapper")})。
 */
@Mapper
public interface McpServerConfigMapper extends BaseMapper<McpServerConfig> {
}
