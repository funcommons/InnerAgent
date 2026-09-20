package com.inneragent.server.controller.vo.comfyui;

import com.inneragent.platform.common.PageParam;
import lombok.Data;
import lombok.EqualsAndHashCode;

@Data
@EqualsAndHashCode(callSuper = true)
public class ComfyUiWorkflowPageReqVO extends PageParam {

    private String name;

    private String code;

    private Long apiConfigId;

    private Integer modelType;

    private Integer status;
}
