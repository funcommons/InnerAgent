package com.inneragent.platform.circuit.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.inneragent.platform.circuit.CircuitEvent;
import org.apache.ibatis.annotations.Mapper;

/**
 * 熔断事件流水 Mapper(V14;包路径命中 {@code @MapperScan("com.inneragent.**.mapper")})。
 * 仅追加 + 按 appId/id 倒序读最近事件,BaseMapper 通用方法即够用。
 */
@Mapper
public interface CircuitEventMapper extends BaseMapper<CircuitEvent> {
}
