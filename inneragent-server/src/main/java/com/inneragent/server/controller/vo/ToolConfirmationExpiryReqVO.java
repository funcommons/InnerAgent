package com.inneragent.server.controller.vo;

import lombok.Data;

/** Identifies an approval whose visible countdown has elapsed. */
@Data
public class ToolConfirmationExpiryReqVO {

    private String runId;
    private String replyId;
}
