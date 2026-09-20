package com.inneragent.platform.convert.ai;

import com.inneragent.server.controller.vo.AiModelRespVO;
import com.inneragent.model.entity.AiModel;
import org.mapstruct.Mapper;
import org.mapstruct.factory.Mappers;

import java.util.List;

/**
 * AI模型 Convert
 */
@Mapper
public interface AiModelConvert {

    AiModelConvert INSTANCE = Mappers.getMapper(AiModelConvert.class);

    AiModelRespVO convert(AiModel model);

    List<AiModelRespVO> convertList(List<AiModel> models);
}
