package fun.commons.acmedemo.common;

import lombok.Getter;

/**
 * 业务异常:code 语义对齐接入指南 §6.5 错误语义表
 * (400 参数 / 401 认证 / 403 越权 / 404 不存在 / 409 冲突 / 500 / 502 / 503)。
 * GlobalExceptionHandler 会把 code 映射为 HTTP 状态码。
 */
@Getter
public class BizException extends RuntimeException {

    private final int code;

    public BizException(int code, String msg) {
        super(msg);
        this.code = code;
    }
}
