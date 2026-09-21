package com.inneragent.agent.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.agent.entity.McpUserServer;
import org.apache.ibatis.annotations.Mapper;

/**
 * ia_mcp_user_server 读写 Mapper(V18 用户级三方 MCP 服务器;包路径命中
 * {@code @MapperScan("com.inneragent.**.mapper")})。
 */
@Mapper
public interface McpUserServerMapper extends BaseMapper<McpUserServer> {
}
