package fun.commons.acmedemo.common;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 全局异常 → {code,msg,data} 信封(《05-微剧场微中台接入指南》§8.2 错误码语义)。
 *
 * 映射规则:BizException → HTTP 状态 = code;参数校验失败 → 400;其余兜底 → 500。
 * 日志红线(§6-1/§3.5):任何密钥类字段(tenantSecret/webhookSecret)不进日志。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** BizException → HTTP 状态 = code(非 HTTP 合法区间时钳为 500,防御性兜底)。 */
    @ExceptionHandler(BizException.class)
    public ResponseEntity<R<Void>> biz(BizException e) {
        int status = (e.getCode() >= 400 && e.getCode() <= 599) ? e.getCode() : 500;
        return ResponseEntity.status(status).body(R.error(e.getCode(), e.getMessage()));
    }

    /** @Valid 请求体校验失败(MethodArgumentNotValidException 是 BindException 子类)→ 400。 */
    @ExceptionHandler({MethodArgumentNotValidException.class, BindException.class})
    public ResponseEntity<R<Void>> invalidBody(BindException e) {
        FieldError fe = e.getBindingResult().getFieldError();
        String msg = fe == null ? "参数校验失败" : fe.getField() + " " + fe.getDefaultMessage();
        return ResponseEntity.badRequest().body(R.error(400, msg));
    }

    /** 方法级约束(@Validated 参数校验)→ 400。 */
    @ExceptionHandler(jakarta.validation.ConstraintViolationException.class)
    public ResponseEntity<R<Void>> constraint(jakarta.validation.ConstraintViolationException e) {
        return ResponseEntity.badRequest().body(R.error(400, e.getMessage()));
    }

    /** 请求体缺失/非法 JSON → 400。 */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<R<Void>> unreadable(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(R.error(400, "请求体不可读"));
    }

    /** 兜底 500:不把异常细节(可能含敏感上下文)回给客户端。 */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<R<Void>> fallback(Exception e) {
        log.error("未处理异常", e);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(R.error(500, "系统内部错误"));
    }
}
