package com.inneragent.platform.toolhub.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.toolhub.ToolSchemaHistory;
import org.apache.ibatis.annotations.Mapper;

/**
 * ia_tool_schema_history 只写 Mapper(schema 指纹变更留痕,仅追加)。
 */
@Mapper
public interface ToolSchemaHistoryMapper extends BaseMapper<ToolSchemaHistory> {
}
