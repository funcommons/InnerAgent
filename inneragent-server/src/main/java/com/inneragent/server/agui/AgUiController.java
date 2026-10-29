package com.inneragent.server.agui;

import com.inneragent.agent.kernel.AgentScopePipelineRunService;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Sinks;

import java.time.Duration;
import java.util.Map;
import java.util.function.Function;

import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * AG-UI 协议端点(批次 E2):RunAgentInput 进,SSE 出。
 * <p>[adapt] AG-UI 线格式只写 {@code data:JSON}(事件内 {@code type} 判别,
 * 不写 SSE {@code event:}/id 行,与原生 {@code AiPipelineController#toSse}
 * 投影不同);鉴权与原生 {@code POST /runs} 完全同源。同一条运行管道的事件投影,
 * 不改变编排/工具/确认语义 —— 确认卡以 CUSTOM 事件透出,批准/拒绝仍走平台原生
 * confirm API。runId 空 → 新运行;非空 → 复用 streamContinuation 续跑语义。
 */
@Tag(name = "AG-UI")
@RestController
@RequestMapping("/ia/api/v1/ag-ui")
@RequiredArgsConstructor
public class AgUiController {

    private final AgentScopePipelineRunService pipelineRuns;

    @Operation(summary = "AG-UI 运行（SSE 流式,AG-UI 1.0 事件）")
    @PostMapping(value = "/runs", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<Map<String, Object>>> run(
            @RequestBody AgUiRunInput input) {
        long currentUserId = requireCurrentUserId();
        // 400 校验前置到响应未提交时(defer 内抛错只会变成 SSE 错误流,映射不到 400)
        AiChatReqVO chatRequest = input.toAiChatReq();
        boolean continuation = input.getRunId() != null && !input.getRunId().isBlank();
        // 订阅级独立状态(RUN_STARTED 一次性 + 边界合成),RUN_STARTED 保证流首
        return withKeepAlive(Flux.defer(() -> {
            AgUiRunStream stream = new AgUiRunStream();
            Flux<AiChatStreamRespVO> frames = continuation
                    ? pipelineRuns.streamContinuation(input.getRunId(), currentUserId)
                    : pipelineRuns.stream(chatRequest, currentUserId);
            return frames.map(stream::onFrame)
                    .flatMapIterable(Function.identity())
                    .map(AgUiController::toSse)
                    .startWith(toSse(stream.runStarted(
                            input.getThreadId(), input.getRunId())));
        }));
    }

    /**
     * SSE 保活注释行({@code : keep-alive},30s 一跳,流完成即停)——
     * 与原生 {@code AiPipelineController#withKeepAlive} 同参(周期写用于暴露
     * 半开连接的惰性取消,见彼处 O-3 说明)。
     */
    private Flux<ServerSentEvent<Map<String, Object>>> withKeepAlive(
            Flux<ServerSentEvent<Map<String, Object>>> body) {
        Sinks.One<Boolean> completed = Sinks.one();
        return body.doFinally(ignored -> completed.tryEmitValue(Boolean.TRUE))
                .mergeWith(Flux.interval(Duration.ofSeconds(30))
                        .map(ignored -> ServerSentEvent
                                .<Map<String, Object>>builder()
                                .comment("keep-alive")
                                .build())
                        .takeUntilOther(completed.asMono()));
    }

    // AG-UI 线格式:只写 data 行(JSON),不写 event:/id 行
    private static ServerSentEvent<Map<String, Object>> toSse(
            Map<String, Object> event) {
        return ServerSentEvent.builder(event).build();
    }
}
