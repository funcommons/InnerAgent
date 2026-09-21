package com.inneragent.platform.common;

import java.io.IOException;
import java.net.ConnectException;
import java.net.SocketTimeoutException;
import java.util.Locale;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.BindException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import org.springframework.web.client.ResourceAccessException;

/**
 * 全局异常处理器
 * <p>
 * [port] 自融光 com.stonewu.fusion.common.GlobalExceptionHandler(P1 遗留台账①):
 * 之前 BusinessException 一路变成 500,现按错误码映射 4xx;参数校验错误统一 400;
 * 兜底 500 并记录可追踪堆栈。包位置对齐融合(common 包与 BusinessException/
 * CommonResult 同级),仅类名与包名迁移,分支语义保持一致。
 *
 * <p><strong>错误码语义表(优化建议 #22,单点映射·全景)</strong>——前后端与宿主
 * 接入方对本表的错误预期保持一致;每条含「用户该做什么」(值域见
 * {@link ErrorSemantics},单元测试守护其完备性):
 * <pre>
 * ┌──────┬────────────────────────────────────────────┬──────────────────────────────────────────┐
 * │ HTTP │ 触发                                       │ 用户该做什么                              │
 * ├──────┼────────────────────────────────────────────┼──────────────────────────────────────────┤
 * │ 400  │ @Valid 校验失败/表单绑定失败/请求体非法     │ 修正参数/JSON 后重试                      │
 * │      │ JSON、缺必填参数、参数类型不匹配            │                                          │
 * │ 401  │ 管理会话 token 无效/embed 验签失败          │ 重新登录或重新签发 embed token            │
 * │ 403  │ 管理面凭据缺失/错误、无权限、紧急停用       │ 补凭据或联系管理员;停用期间等待恢复       │
 * │ 404  │ 资源/路由不存在                             │ 核对 ID 与路径                            │
 * │ 405  │ HTTP 方法不支持                             │ 核对接口的 HTTP 方法                      │
 * │ 409  │ 业务状态冲突(唯一约束/重复授权/状态竞态)   │ 刷新后重试;重复提交无需重试               │
 * │ 413  │ 上传体积超限                                │ 压缩或拆分文件后重传(文案携带实际上限)  │
 * │ 500  │ 未预期异常                                  │ 稍后重试;持续失败联系管理员              │
 * │ 502  │ 上游(模型接入/宿主桥/Webhook 目标)不可达   │ 稍后重试;检查对应上游配置与网络           │
 * └──────┴────────────────────────────────────────────┴──────────────────────────────────────────┘
 * </pre>
 * 业务异常(BusinessException)按其 code 直接映射;新增映射一律先补本表与
 * {@link ErrorSemantics},不在业务代码里散落裸 5xx。
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 错误语义常量表(#22):每条 = 语义键 + HTTP 状态 + 可读文案 + 用户行动指引。
     * 处理器按触发异常取对应项组装响应;表中不允许出现 2xx/3xx(非错误语义)。
     */
    public enum ErrorSemantics {
        /** @Valid/表单校验失败(消息取第一条字段错误,本身已可读) */
        VALIDATION_FAILED(HttpStatus.BAD_REQUEST, "请求参数校验失败", "请修正参数后重试"),
        /** 请求体不是合法 JSON / 无法反序列化 */
        MALFORMED_BODY(HttpStatus.BAD_REQUEST, "请求体格式不正确", "请按接口文档检查请求体后重试"),
        /** 缺少必填查询/表单参数 */
        MISSING_PARAMETER(HttpStatus.BAD_REQUEST, "缺少必填参数", "请补齐必填参数后重试"),
        /** 参数类型与契约不匹配(如数字位传了字符串) */
        PARAMETER_TYPE_MISMATCH(HttpStatus.BAD_REQUEST, "参数类型不正确", "请核对参数类型后重试"),
        /** 请求语义错误(IllegalArgumentException,如指名不存在的工具) */
        REQUEST_SEMANTIC_ERROR(HttpStatus.BAD_REQUEST, "请求语义错误", "请按接口文档修正请求后重试"),
        /** HTTP 方法不支持 */
        METHOD_NOT_SUPPORTED(HttpStatus.METHOD_NOT_ALLOWED, "请求方法不支持", "请核对接口的 HTTP 方法后重试"),
        /** 数据库完整性约束冲突(唯一键/非空/外键;业务层已预判的冲突走 409 业务码) */
        DATA_CONFLICT(HttpStatus.CONFLICT, "数据状态冲突(唯一性/完整性约束未通过)", "请刷新后重试;若为重复提交无需重试"),
        /** 上传体积超过上限(文案由处理器追加实际上限数值) */
        PAYLOAD_TOO_LARGE(HttpStatus.PAYLOAD_TOO_LARGE, "请求体超过大小上限", "请压缩或拆分文件后重新上传"),
        /** 上游服务不可达(连接失败/超时:模型接入、宿主桥、Webhook 目标等) */
        UPSTREAM_UNAVAILABLE(HttpStatus.BAD_GATEWAY, "上游服务暂时不可达", "请稍后重试;持续失败请检查对应模型/宿主配置与网络"),
        /** 兜底未预期异常 */
        INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "系统内部错误", "请稍后重试;持续失败请联系管理员");

        private final HttpStatus status;
        private final String message;
        private final String userAction;

        ErrorSemantics(HttpStatus status, String message, String userAction) {
            this.status = status;
            this.message = message;
            this.userAction = userAction;
        }

        public HttpStatus status() {
            return status;
        }

        public String message() {
            return message;
        }

        /** 用户该做什么(每条映射必填,面向最终用户的行动指引)。 */
        public String userAction() {
            return userAction;
        }

        /** 组装面向用户的完整文案:文案 + 「,」 + 行动指引。 */
        public String fullMessage() {
            return message + "," + userAction;
        }
    }

    /** 上传单文件大小上限(读 spring.servlet.multipart.max-file-size;#4 文案携带)。 */
    private final DataSize maxFileSize;

    /** Spring 装配:注入实际上限配置。 */
    @org.springframework.beans.factory.annotation.Autowired
    public GlobalExceptionHandler(
            @Value("${spring.servlet.multipart.max-file-size:20MB}") String maxFileSize) {
        this.maxFileSize = parseSizeOrDefault(maxFileSize);
    }

    /** 测试便捷构造(与缺省配置等价,20MB)。 */
    public GlobalExceptionHandler() {
        this("20MB");
    }

    private static DataSize parseSizeOrDefault(String configured) {
        try {
            return DataSize.parse(configured == null ? "20MB" : configured.trim());
        } catch (IllegalArgumentException invalidConfig) {
            log.warn("spring.servlet.multipart.max-file-size 配置无法解析: {},按缺省 20MB 提示",
                    configured);
            return DataSize.parse("20MB");
        }
    }

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
     * [#22] 请求体不是合法 JSON(HttpMessageNotReadableException 是 IOException
     * 子类,无本处理器会被下方 swallow 语义的 IOException 处理器吞掉)→ 400。
     */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public CommonResult<?> handleUnreadableBody(HttpMessageNotReadableException e) {
        log.debug("请求体解析失败: {}", e.getMessage());
        return CommonResult.error(400, ErrorSemantics.MALFORMED_BODY.fullMessage());
    }

    /** [#22] 缺少必填参数 → 400,点名缺失参数。 */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public CommonResult<?> handleMissingParameter(MissingServletRequestParameterException e) {
        return CommonResult.error(400, "缺少必填参数: " + e.getParameterName()
                + "," + ErrorSemantics.MISSING_PARAMETER.userAction());
    }

    /** [#22] 参数类型不匹配 → 400,点名参数。 */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public CommonResult<?> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return CommonResult.error(400, "参数类型不正确: " + e.getName()
                + "," + ErrorSemantics.PARAMETER_TYPE_MISMATCH.userAction());
    }

    /** [#22] HTTP 方法不支持 → 405(此前落入兜底 500)。 */
    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    @ResponseStatus(HttpStatus.METHOD_NOT_ALLOWED)
    public CommonResult<?> handleMethodNotSupported(HttpRequestMethodNotSupportedException e) {
        return CommonResult.error(405, ErrorSemantics.METHOD_NOT_SUPPORTED.fullMessage());
    }

    /** [adapt] U1/D1:请求语义错误(IllegalArgumentException,如 enabledMcpTools
     * 指名请求不存在的工具)→ 400 透传明确错误消息,不再被兜底处理器掩成
     * 500「系统内部错误」;消息缺失时回退语义表文案。 */
    @ExceptionHandler(IllegalArgumentException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public CommonResult<?> handleIllegalArgumentException(IllegalArgumentException e) {
        log.warn("请求语义错误: {}", e.getMessage());
        String message = e.getMessage();
        if (message == null || message.isBlank()) {
            message = ErrorSemantics.REQUEST_SEMANTIC_ERROR.fullMessage();
        }
        return CommonResult.error(400, message);
    }

    /**
     * [#4/#22] 上传超限 → 413,文案携带实际上限(spring.servlet.multipart
     * .max-file-size,缺省 20MB),把「系统故障」变「使用指引」。
     */
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    @ResponseStatus(HttpStatus.PAYLOAD_TOO_LARGE)
    public CommonResult<?> handleMaxUploadSize(MaxUploadSizeExceededException e) {
        log.warn("上传超限: {}", e.getMessage());
        return CommonResult.error(413, "附件大小不能超过 " + humanize(maxFileSize)
                + "," + ErrorSemantics.PAYLOAD_TOO_LARGE.userAction());
    }

    /**
     * [#22] 数据库完整性约束冲突(未在业务层预判的兜底映射)→ 409。
     * 业务层已显式预判的冲突(如 appKey 重复)仍以 BusinessException(409)
     * 携带精确文案先行命中,不受本处理器影响。
     */
    @ExceptionHandler(DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.CONFLICT)
    public CommonResult<?> handleDataIntegrityViolation(DataIntegrityViolationException e) {
        log.warn("数据完整性约束冲突: {}", e.getMessage());
        return CommonResult.error(409, ErrorSemantics.DATA_CONFLICT.fullMessage());
    }

    /**
     * [#22] 上游不可达(连接失败/超时)→ 502 + 可读文案。覆盖模型连通性
     * 测试、宿主桥、Webhook 测试等出站 HTTP 链路的传输层失败。
     */
    @ExceptionHandler(ResourceAccessException.class)
    @ResponseStatus(HttpStatus.BAD_GATEWAY)
    public CommonResult<?> handleUpstreamUnavailable(ResourceAccessException e) {
        log.warn("上游服务不可达: {}", e.getMessage());
        String cause = e.getCause() instanceof ConnectException ? "连接失败"
                : e.getCause() instanceof SocketTimeoutException ? "连接超时"
                : e.getClass().getSimpleName();
        return CommonResult.error(502,
                ErrorSemantics.UPSTREAM_UNAVAILABLE.message() + "(" + cause + "): "
                        + e.getMessage() + "," + ErrorSemantics.UPSTREAM_UNAVAILABLE.userAction());
    }

    /** [port] 认证/鉴权异常兜底映射。注意:此处理器位于 platform/common,
     * 不在 server/security 边界内;若 P1 身份层后续落地自己的 advice,
     * 以身份层的实现为准(合并时二选一)。 */
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
     * (请求体非法 JSON 的 IOException 子类已由上方 400 处理器优先命中。)
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

    /**
     * DataSize → 人类可读上限文案(#4):恰好整数值按 KB/MB/GB 展示,
     * 否则展示字节数。20MB → "20MB"、512KB → "512KB"、10GB → "10GB"。
     */
    static String humanize(DataSize size) {
        long bytes = size.toBytes();
        if (bytes <= 0) {
            return bytes + "B";
        }
        if (bytes % (1024L * 1024 * 1024) == 0) {
            return bytes / (1024L * 1024 * 1024) + "GB";
        }
        if (bytes % (1024L * 1024) == 0) {
            return bytes / (1024L * 1024) + "MB";
        }
        if (bytes % 1024 == 0) {
            return bytes / 1024 + "KB";
        }
        return String.format(Locale.ROOT, "%dB", bytes);
    }
}
