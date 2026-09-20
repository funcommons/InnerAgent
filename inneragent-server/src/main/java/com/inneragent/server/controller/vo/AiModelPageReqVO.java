package com.inneragent.server.controller.vo;

import com.inneragent.platform.common.PageParam;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Schema(description = "AI模型分页查询请求")
@Data
@EqualsAndHashCode(callSuper = true)
public class AiModelPageReqVO extends PageParam {
    private String name;
    private String code;
    private Integer modelType;
    private Integer status;
}
