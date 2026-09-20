package com.inneragent.platform.convert.ai;

import com.inneragent.server.controller.vo.ApiConfigRespVO;
import com.inneragent.model.entity.ApiConfig;
import org.mapstruct.Mapper;
import org.mapstruct.Mapping;
import org.mapstruct.factory.Mappers;

import java.util.List;

/**
 * API配置 Convert
 */
@Mapper
public interface ApiConfigConvert {

    ApiConfigConvert INSTANCE = Mappers.getMapper(ApiConfigConvert.class);

    @Mapping(source = "platformAppId", target = "appId") // [adapt] 列改名,VO 对外字段保持 appId
    ApiConfigRespVO convert(ApiConfig config);

    List<ApiConfigRespVO> convertList(List<ApiConfig> configs);
}
