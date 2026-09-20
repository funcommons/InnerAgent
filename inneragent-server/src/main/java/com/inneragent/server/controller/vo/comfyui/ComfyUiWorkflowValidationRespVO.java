package com.inneragent.server.controller.vo.comfyui;

import lombok.Builder;
import lombok.Value;

import java.util.List;

@Value
@Builder
public class ComfyUiWorkflowValidationRespVO {

    boolean valid;
    int checkedNodeCount;
    List<String> missingNodeClasses;
    List<String> invalidModelInputs;
    String message;
}
