package com.inneragent.platform.common;

import java.io.IOException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 全局异常处理器
 * <p>
 * [port] 自融光 com.stonewu.fusion.common.GlobalExceptionHandler(P1 遗留台账①):
 * 之前 BusinessException 一路变成 500,现按错误码映射 4xx;参数校验错误统一 400;
 * 兜底 500 并记录可追踪堆栈。包位置对齐融合(common 包与 BusinessException/
 * CommonResult 同级),仅类名与包名迁移,分支语义保持一致。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * [port] 业务异常按错误码映射 HTTP 状态;code 无法解析为标准状态,
     * 或落在 2xx/3xx(不是错误语义)时回退 500,响应体仍携带原始 code。
     */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<CommonResult<?>> handleBusinessException(BusinessException e) {
        log.warn("业务异常: {}", e.getMessage());
        HttpStatus status = HttpStatus.resolve(e.getCode());
        if (status == null || status.is2xxSuccessful() || status.is3xxRedirection()) {
            status = HttpStatus.INTERNAL_SERVER_ERROR;
        }
        return ResponseEntity.status(status)
                .body(CommonResult.error(e.getCode(), e.getMessage()));
    }

    /** [port] @Valid 请求体校验失败 → 400,消息取第一条字段错误。 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public CommonResult<?> handleValidationException(MethodArgumentNotValidException e) {
        String message = e.getBindingResult().getAllErrors().getFirst().getDefaultMessage();
        return CommonResult.error(400, message);
    }

    /** [port] 表单绑定失败 → 400,消息取第一条全局/字段错误。 */
    @ExceptionHandler(BindException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public CommonResult<?> handleBindException(BindException e) {
        String message = e.getBindingResult().getAllErrors().getFirst().getDefaultMessage();
        return CommonResult.error(400, message);
    }

    /**
     * [port] 认证/鉴权异常兜底映射。注意:此处理器位于 platform/common,
     * 不在 server/security 边界内;若 P1 身份层后续落地自己的 advice,
     * 以身份层的实现为准(合并时二选一)。
     */
    @ExceptionHandler(BadCredentialsException.class)
    @ResponseStatus(HttpStatus.UNAUTHORIZED)
    public CommonResult<?> handleBadCredentialsException(BadCredentialsException e) {
        return CommonResult.error(401, "用户名或密码错误");
    }

    /** [port] 同上:AccessDenied 兜底 403,正常链路仍由安全过滤链先行处理。 */
    @ExceptionHandler(AccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public CommonResult<?> handleAccessDeniedException(AccessDeniedException e) {
        return CommonResult.error(403, "没有权限访问");
    }

    /** [port] 无匹配处理器/静态资源未找到 → 404。 */
    @ExceptionHandler(NoResourceFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public CommonResult<?> handleNoResourceFoundException(NoResourceFoundException e) {
        log.warn("静态资源未找到: {}", e.getMessage());
        return CommonResult.error(404, "资源未找到");
    }

    /**
     * [port] SSE / 长连接客户端断开时触发的 IOException,属于正常行为,
     * 降级为 DEBUG 日志。注意:SSE 端点的 Content-Type 已经是
     * text/event-stream,此时不能返回 CommonResult(没有匹配的
     * HttpMessageConverter),直接 swallow 即可。
     */
    @ExceptionHandler(IOException.class)
    public void handleIOException(IOException e) {
        String msg = e.getMessage();
        if (msg != null && (msg.contains("已建立的连接") || msg.contains("Broken pipe")
                || msg.contains("Connection reset"))) {
            log.debug("客户端连接断开（SSE/长连接正常行为）: {}", msg);
        } else {
            log.error("IO 异常", e);
        }
        // 连接已断开，无法写回响应，直接返回
    }

    /** [port] 兜底 500:记录完整堆栈便于追踪,响应体不泄露内部细节。 */
    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public CommonResult<?> handleException(Exception e) {
        log.error("系统异常", e);
        return CommonResult.error(500, "系统内部错误");
    }
}
