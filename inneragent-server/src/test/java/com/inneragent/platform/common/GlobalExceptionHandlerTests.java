package com.inneragent.platform.common;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.mock.http.MockHttpInputMessage;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.util.unit.DataSize;
import org.springframework.validation.BeanPropertyBindingResult;
import org.springframework.validation.BindException;
import org.springframework.validation.FieldError;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.net.ConnectException;
import java.net.SocketTimeoutException;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * P1 遗留台账①:GlobalExceptionHandler 缺失,BusinessException 一路变 500。
 * 覆盖 BusinessException 错误码 → HTTP 状态矩阵、参数校验 400 与兜底 500。
 */
class GlobalExceptionHandlerTests {

    private static final HttpStatus[] RESOLVABLE_ERROR_STATUSES = {
            HttpStatus.BAD_REQUEST,
            HttpStatus.UNAUTHORIZED,
            HttpStatus.PAYMENT_REQUIRED,
            HttpStatus.FORBIDDEN,
            HttpStatus.NOT_FOUND,
            HttpStatus.CONFLICT,
            HttpStatus.TOO_MANY_REQUESTS,
            HttpStatus.INTERNAL_SERVER_ERROR,
            HttpStatus.NOT_IMPLEMENTED,
    };

    private GlobalExceptionHandler handler;

    @BeforeEach
    void setUp() {
        handler = new GlobalExceptionHandler();
    }

    @Test
    void mapsBusinessExceptionCodesToResolvableErrorStatuses() {
        for (HttpStatus expected : RESOLVABLE_ERROR_STATUSES) {
            ResponseEntity<CommonResult<?>> response = handler.handleBusinessException(
                    new BusinessException(expected.value(), "业务失败-" + expected.value()));

            assertThat(response.getStatusCode())
                    .as("code %s 应映射为 %s", expected.value(), expected)
                    .isEqualTo(expected);
            assertThat(response.getBody()).isNotNull();
            assertThat(response.getBody().getCode()).isEqualTo(expected.value());
            assertThat(response.getBody().getMsg()).isEqualTo("业务失败-" + expected.value());
        }
    }

    @Test
    void fallsBackTo500WhenCodeUnresolvableOrNonError() {
        for (Integer nonError : new Integer[] {
                200, 201, 302, // 2xx/3xx 不是错误语义
                250, 599, 999, // 无法解析为标准状态
        }) {
            ResponseEntity<CommonResult<?>> response = handler.handleBusinessException(
                    new BusinessException(nonError, "非错误码-" + nonError));

            assertThat(response.getStatusCode())
                    .as("code %s 应回退 500", nonError)
                    .isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
            assertThat(response.getBody()).isNotNull();
            assertThat(response.getBody().getCode()).isEqualTo(nonError);
        }
    }

    @Test
    void defaultsTo500BodyWhenBusinessExceptionUsesSingleArgConstructor() {
        ResponseEntity<CommonResult<?>> response = handler.handleBusinessException(
                new BusinessException("默认 500"));

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.INTERNAL_SERVER_ERROR);
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().getCode()).isEqualTo(500);
        assertThat(response.getBody().getMsg()).isEqualTo("默认 500");
    }

    @Test
    void mapsValidationFailuresTo400() throws Exception {
        Object target = new ValidationTarget();
        BeanPropertyBindingResult bindingResult = new BeanPropertyBindingResult(
                target, "validationTarget");
        bindingResult.addError(new FieldError(
                "validationTarget", "content", "内容不能为空"));
        MethodArgumentNotValidException failure = new MethodArgumentNotValidException(
                new org.springframework.core.MethodParameter(probeMethod(), -1),
                bindingResult);

        CommonResult<?> result = handler.handleValidationException(failure);

        assertThat(result.getCode()).isEqualTo(400);
        assertThat(result.getMsg()).isEqualTo("内容不能为空");
    }

    @Test
    void mapsBindFailuresTo400() {
        BeanPropertyBindingResult bindingResult = new BeanPropertyBindingResult(
                new Object(), "form");
        bindingResult.addError(new FieldError("form", "name", "名称不能为空"));
        BindException failure = new BindException(bindingResult);

        CommonResult<?> result = handler.handleBindException(failure);

        assertThat(result.getCode()).isEqualTo(400);
        assertThat(result.getMsg()).isEqualTo("名称不能为空");
    }

    @Test
    void mapsMissingResourceTo404() {
        CommonResult<?> result = handler.handleNoResourceFoundException(
                new NoResourceFoundException(null, "missing.css"));

        assertThat(result.getCode()).isEqualTo(404);
        assertThat(result.getMsg()).isEqualTo("资源未找到");
    }

    @Test
    void mapsAuthenticationFailuresTo401AndDeniedTo403() {
        assertThat(handler.handleBadCredentialsException(
                new BadCredentialsException("bad credentials")).getCode()).isEqualTo(401);
        assertThat(handler.handleAccessDeniedException(
                new AccessDeniedException("denied")).getCode()).isEqualTo(403);
    }

    @Test
    void fallsBackTo500WithGenericMessage() {
        CommonResult<?> result = handler.handleException(
                new IllegalStateException("internal detail"));

        assertThat(result.getCode()).isEqualTo(500);
        assertThat(result.getMsg()).isEqualTo("系统内部错误");
    }

    @Test
    void swallowsClientDisconnectIOExceptions() {
        assertThatCode(() -> handler.handleIOException(
                new java.io.IOException("Broken pipe"))).doesNotThrowAnyException();
        assertThatCode(() -> handler.handleIOException(
                new java.io.IOException("已建立的连接"))).doesNotThrowAnyException();
        assertThatCode(() -> handler.handleIOException(
                new java.io.IOException("Connection reset"))).doesNotThrowAnyException();
        assertThatCode(() -> handler.handleIOException(
                new java.io.IOException("disk failure"))).doesNotThrowAnyException();
    }

    @Test
    void mvcPipelineReturns400ForInvalidBodyAndMapsBusinessAndFallbackErrors()
            throws Exception {
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ProbeController())
                .setControllerAdvice(handler)
                .build();

        mockMvc.perform(post("/probe/validate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"content\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg").value("内容不能为空"));

        mockMvc.perform(get("/probe/conflict"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value(409))
                .andExpect(jsonPath("$.msg").value("已有运行中的任务"));

        mockMvc.perform(get("/probe/crash"))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value(500))
                .andExpect(jsonPath("$.msg").value("系统内部错误"));
    }

    // ==================== 优化建议 #4:上传超限 413 ====================

    @Test
    void mapsUploadSizeExceededTo413WithConfiguredLimitInMessage() {
        GlobalExceptionHandler withCustomLimit = new GlobalExceptionHandler("5MB");

        CommonResult<?> result = withCustomLimit.handleMaxUploadSize(
                new MaxUploadSizeExceededException(Long.valueOf(5 * 1024 * 1024)));

        assertThat(result.getCode()).isEqualTo(413);
        assertThat(result.getMsg())
                .contains("附件大小不能超过 5MB")
                .contains("请压缩或拆分文件后重新上传");
    }

    @Test
    void defaultHandlerCarriesDefault20MbLimit() {
        CommonResult<?> result = handler.handleMaxUploadSize(
                new MaxUploadSizeExceededException(1));

        assertThat(result.getCode()).isEqualTo(413);
        assertThat(result.getMsg()).contains("附件大小不能超过 20MB");
    }

    @Test
    void humanizesDataSizeForLimitMessage() {
        assertThat(GlobalExceptionHandler.humanize(DataSize.parse("20MB"))).isEqualTo("20MB");
        assertThat(GlobalExceptionHandler.humanize(DataSize.parse("512KB"))).isEqualTo("512KB");
        assertThat(GlobalExceptionHandler.humanize(DataSize.parse("2GB"))).isEqualTo("2GB");
        assertThat(GlobalExceptionHandler.humanize(DataSize.ofBytes(1024))).isEqualTo("1KB");
        assertThat(GlobalExceptionHandler.humanize(DataSize.ofBytes(7))).isEqualTo("7B");
    }

    @Test
    void fallsBackToDefaultLimitWhenConfiguredValueUnparseable() {
        GlobalExceptionHandler brokenConfig = new GlobalExceptionHandler("not-a-size");

        CommonResult<?> result = brokenConfig.handleMaxUploadSize(
                new MaxUploadSizeExceededException(1));

        assertThat(result.getMsg()).contains("20MB");
    }

    @Test
    void mvcPipelineReturns413ForMultipartSizeExceeded() throws Exception {
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ProbeController())
                .setControllerAdvice(handler)
                .build();

        mockMvc.perform(post("/probe/upload").content("x"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.code").value(413))
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("附件大小不能超过 20MB")));
    }

    // ==================== 优化建议 #22:错误语义表 ====================

    @Test
    void mapsDataIntegrityViolationTo409() {
        CommonResult<?> result = handler.handleDataIntegrityViolation(
                new DataIntegrityViolationException("uk_ia_app_key"));

        assertThat(result.getCode()).isEqualTo(409);
        assertThat(result.getMsg())
                .contains("数据状态冲突")
                .contains("请刷新后重试");
    }

    @Test
    void mapsUnreadableBodyMissingParamAndTypeMismatchTo400() throws Exception {
        CommonResult<?> unreadable = handler.handleUnreadableBody(
                new HttpMessageNotReadableException("bad json", new MockHttpInputMessage("x".getBytes())));
        assertThat(unreadable.getCode()).isEqualTo(400);
        assertThat(unreadable.getMsg()).contains("请求体格式不正确").contains("请按接口文档检查请求体");

        CommonResult<?> missing = handler.handleMissingParameter(
                new MissingServletRequestParameterException("conversationId", "String"));
        assertThat(missing.getCode()).isEqualTo(400);
        assertThat(missing.getMsg()).contains("conversationId").contains("请补齐必填参数");

        CommonResult<?> mismatch = handler.handleTypeMismatch(
                new MethodArgumentTypeMismatchException("x", Long.class, "pageNo", null, new RuntimeException()));
        assertThat(mismatch.getCode()).isEqualTo(400);
        assertThat(mismatch.getMsg()).contains("pageNo").contains("请核对参数类型");
    }

    @Test
    void mapsMethodNotSupportedTo405() {
        CommonResult<?> result = handler.handleMethodNotSupported(
                new HttpRequestMethodNotSupportedException("DELETE"));

        assertThat(result.getCode()).isEqualTo(405);
        assertThat(result.getMsg()).contains("请求方法不支持").contains("HTTP 方法");
    }

    @Test
    void mapsUpstreamAccessFailureTo502WithReadableCause() {
        ResourceAccessException timeout = new ResourceAccessException("I/O error",
                new SocketTimeoutException("Read timed out"));
        CommonResult<?> result = handler.handleUpstreamUnavailable(timeout);
        assertThat(result.getCode()).isEqualTo(502);
        assertThat(result.getMsg()).contains("上游服务暂时不可达").contains("连接超时").contains("请稍后重试");

        ResourceAccessException refused = new ResourceAccessException("I/O error",
                new ConnectException("Connection refused"));
        assertThat(handler.handleUpstreamUnavailable(refused).getMsg()).contains("连接失败");
    }

    @Test
    void errorSemanticsTableIsCompleteAndActionable() {
        for (GlobalExceptionHandler.ErrorSemantics entry :
                GlobalExceptionHandler.ErrorSemantics.values()) {
            HttpStatus status = entry.status();
            assertThat(status.isError())
                    .as("语义表 %s 必须映射到 4xx/5xx", entry.name())
                    .isTrue();
            assertThat(entry.message()).as("%s 文案", entry.name()).isNotBlank();
            assertThat(entry.userAction())
                    .as("%s 必须带「用户该做什么」行动指引", entry.name())
                    .isNotBlank();
            assertThat(entry.fullMessage()).contains(entry.userAction());
        }
    }

    @Test
    void mvcPipelineReturns400ForMalformedJsonAnd405ForWrongMethod() throws Exception {
        MockMvc mockMvc = MockMvcBuilders.standaloneSetup(new ProbeController())
                .setControllerAdvice(handler)
                .build();

        mockMvc.perform(post("/probe/validate")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{broken-json"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400))
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("请求体格式不正确")));

        mockMvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                        .delete("/probe/conflict"))
                .andExpect(status().isMethodNotAllowed())
                .andExpect(jsonPath("$.code").value(405))
                .andExpect(jsonPath("$.msg").value(
                        org.hamcrest.Matchers.containsString("请求方法不支持")));
    }

    private Method probeMethod() throws NoSuchMethodException {
        return ProbeController.class.getDeclaredMethod("validate", ValidationTarget.class);
    }

    static class ValidationTarget {

        @NotBlank(message = "内容不能为空")
        private String content;

        public String getContent() {
            return content;
        }

        public void setContent(String content) {
            this.content = content;
        }
    }

    @RestController
    static class ProbeController {

        @PostMapping("/probe/validate")
        CommonResult<String> validate(@Valid @RequestBody ValidationTarget request) {
            return CommonResult.success(request.getContent());
        }

        @GetMapping("/probe/conflict")
        CommonResult<String> conflict() {
            throw new BusinessException(409, "已有运行中的任务");
        }

        @GetMapping("/probe/crash")
        CommonResult<String> crash() {
            throw new IllegalStateException("internal detail");
        }

        /** [#4] 模拟 multipart 解析阶段的超限异常(经 advice 映射 413)。 */
        @PostMapping("/probe/upload")
        CommonResult<String> upload() {
            throw new MaxUploadSizeExceededException(1);
        }
    }
}
