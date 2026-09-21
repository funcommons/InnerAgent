package fun.commons.acmedemo.common;

import lombok.Getter;

/**
 * 业务异常:code 语义对齐《05-微剧场微中台接入指南》§8.2 错误码速查
 * (400 参数 / 401 认证 / 403 越权 / 404 不存在 / 429 限流锁定配额 / 500 / 503)。
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
