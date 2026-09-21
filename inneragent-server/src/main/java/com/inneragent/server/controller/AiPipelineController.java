package com.inneragent.server.controller;

import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.controller.vo.AiChatReqVO;
import com.inneragent.server.controller.vo.AiChatStreamRespVO;
import com.inneragent.server.controller.vo.PipelineRunStatusRespVO;
import com.inneragent.server.controller.vo.RunningPipelineRunRespVO;
import com.inneragent.server.controller.vo.ToolConfirmationReqVO;
import com.inneragent.server.controller.vo.ToolConfirmationExpiryReqVO;
import com.inneragent.agent.kernel.AgentScopePipelineRunService;
import com.inneragent.agent.run.AgentRunQueryService;
import com.inneragent.agent.run.AgentRunReplayService;
import com.inneragent.agent.run.CancellationCoordinator;
import com.inneragent.agent.run.AgentConfirmationService;
import com.inneragent.agent.run.AgentConfirmationExpiryCoordinator;
import com.inneragent.agent.run.PipelineCursorParser;
import com.inneragent.agent.run.model.RunCursor;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.http.codec.ServerSentEvent;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

import java.util.List;

import static com.inneragent.platform.security.SecurityUtils.requireCurrentUserId;

/**
 * Durable, user-authorized pipeline HTTP and SSE API.
 *
 * <p>[adapt] P1-T3b 契约收口(02-技术方案 §7.1 ADR-T4,一次性切换不留旧别名):
 * 融光 {@code /api/ai/pipeline/*} 重映射为 {@code /ia/api/v1/runs*},SSE 事件协议
 * (id = {@code runId:sequence}、outputType 全集)不变:
 * <ul>
 *   <li>POST /run|continue → POST {@code /runs}、{@code /runs/{runId}/continue}
 *       (run 请求体含可选 {@code context{page,object}},并入运行上下文);</li>
 *   <li>GET /reconnect → GET {@code /runs/{runId}/events}(Last-Event-ID 头语义不变,
 *       仅发头即可,省略头时从头重放;afterSequence 查询参数可选,与头冲突时 400);</li>
 *   <li>POST cancel|confirm|confirm/expire → POST {@code /runs/{runId}/cancel|confirm|confirm/expire};
 *       乐观会话尚无 runId 时保留 {@code POST /runs/cancel?conversationId=…} 兜底
 *       (SDK runs.cancelRun 契约;无活动 run 时 404);</li>
 *   <li>GET status|running → GET {@code /runs/{runId}}、{@code /runs/running}
 *       (running 支持可选 conversationId 过滤)。</li>
 * </ul>
 */
@Tag(name = "AI Pipeline")
@RestController
@RequestMapping("/ia/api/v1/runs")
@RequiredArgsConstructor
public class AiPipelineController {

    private final AgentScopePipelineRunService pipelineRuns;
    private final AgentRunQueryService runQueries;
    private final AgentRunReplayService replayService;
    private final PipelineCursorParser cursorParser;
    private final CancellationCoordinator cancellations;
    private final AgentConfirmationService confirmations;
    private final AgentConfirmationExpiryCoordinator confirmationExpiry;
    /** [adapt] IA-4 会话级重连计数(ia_reconnect_total;P4 差距收口,可空免装配)。 */
    private final com.inneragent.platform.metrics.IaBusinessMetrics businessMetrics;

    @Operation(summary = "启动 Run（SSE 流式）")
    @PostMapping(produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<AiChatStreamRespVO>> run(
            @RequestBody AiChatReqVO request) {
        long currentUserId = requireCurrentUserId();
        return runQueries.authorizeConversationForStart(
                request.getConversationId(), currentUserId)
                .thenMany(Flux.defer(() -> pipelineRuns.stream(
                        request, currentUserId)))
                .map(this::toSse);
    }

    @Operation(summary = "继续失败或已取消的 Run（SSE 流式）")
    @PostMapping(value = "/{runId}/continue", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<AiChatStreamRespVO>> continueRun(
            @PathVariable String runId) {
        long currentUserId = requireCurrentUserId();
        return pipelineRuns.streamContinuation(runId, currentUserId)
                .map(this::toSse);
    }

    @Operation(summary = "取消 Run")
    @PostMapping("/{runId}/cancel")
    public Mono<CommonResult<Boolean>> cancel(
            @PathVariable String runId) {
        return doCancel(runId, null);
    }

    /**
     * [adapt] SDK 乐观会话兜底:仅持 conversationId 时按会话解析活动根运行取消。
     * 字面量路径优先于 {@code /{runId}/cancel} 匹配,不会落入 runId 语义。
     */
    @Operation(summary = "按会话取消运行中的 Run")
    @PostMapping("/cancel")
    public Mono<CommonResult<Boolean>> cancelByConversation(
            @RequestParam String conversationId) {
        return doCancel(null, conversationId);
    }

    @Operation(summary = "批准或拒绝等待中的工具调用")
    @PostMapping("/{runId}/confirm")
    public Mono<CommonResult<Boolean>> confirm(
            @PathVariable String runId,
            @RequestBody ToolConfirmationReqVO request) {
        long currentUserId = requireCurrentUserId();
        // 路径参数是唯一 runId 来源(SDK 确认请求体仅携带 replyId/decisions)
        request.setRunId(runId);
        return confirmations.respond(request, currentUserId)
                .thenReturn(CommonResult.success(true));
    }

    @Operation(summary = "结束已超时的工具审批")
    @PostMapping("/{runId}/confirm/expire")
    public Mono<CommonResult<Boolean>> expireConfirmation(
            @PathVariable String runId,
            @RequestBody ToolConfirmationExpiryReqVO request) {
        long currentUserId = requireCurrentUserId();
        request.setRunId(runId);
        return confirmationExpiry.expireAuthorized(
                        request.getRunId(), request.getReplyId(), currentUserId)
                .map(CommonResult::success);
    }

    @Operation(summary = "重连 Run 事件流（Last-Event-ID 断点续传）")
    @GetMapping(value = "/{runId}/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public Flux<ServerSentEvent<AiChatStreamRespVO>> events(
            @PathVariable String runId,
            @RequestParam(required = false) Long afterSequence,
            @RequestHeader(name = "Last-Event-ID", required = false) String lastEventId) {
        long currentUserId = requireCurrentUserId();
        // [adapt] IA-4 会话级重连计数(ia_reconnect_total{app,result}):仅计
        // 真重连(带 Last-Event-ID/afterSequence);resumed=流正常完结(终态
        // 事件送达追平),failed=流出错;客户端断连(cancel)两侧都不计。
        // businessMetrics 可空(测试直构免装配)
        boolean resume = afterSequence != null
                || (lastEventId != null && !lastEventId.isBlank());
        long appId = com.inneragent.platform.context.AppContext.currentOrDefault();
        return runQueries.requireAuthorizedRun(runId, currentUserId)
                .flatMapMany(run -> {
                    RunCursor cursor = cursorParser.parse(
                            run.getRunId(), afterSequence, lastEventId);
                    return replayService.replayThenLive(
                            cursor.runId(), cursor.afterSequence())
                            .concatMap(event -> runQueries.project(run, event))
                            .map(this::toSse);
                })
                .doOnComplete(() -> {
                    if (resume && businessMetrics != null) {
                        businessMetrics.reconnect(appId,
                                com.inneragent.platform.metrics.IaBusinessMetrics
                                        .RECONNECT_RESUMED);
                    }
                })
                .doOnError(failure -> {
                    if (resume && businessMetrics != null) {
                        businessMetrics.reconnect(appId,
                                com.inneragent.platform.metrics.IaBusinessMetrics
                                        .RECONNECT_FAILED);
                    }
                });
    }

    @Operation(summary = "查询 Run 运行状态")
    @GetMapping("/{runId}")
    public Mono<CommonResult<PipelineRunStatusRespVO>> getStatus(
            @PathVariable String runId) {
        long currentUserId = requireCurrentUserId();
        return runQueries.status(runId, null, currentUserId)
                .map(CommonResult::success);
    }

    @Operation(summary = "查询运行中的 Run 列表")
    @GetMapping("/running")
    public Mono<CommonResult<List<RunningPipelineRunRespVO>>> listRunning(
            @RequestParam(required = false) String conversationId) {
        long currentUserId = requireCurrentUserId();
        return runQueries.listRunning(conversationId, currentUserId)
                .map(CommonResult::success);
    }

    private Mono<CommonResult<Boolean>> doCancel(String runId, String conversationId) {
        long currentUserId = requireCurrentUserId();
        return runQueries.resolveAuthorizedTarget(runId, conversationId, currentUserId)
                .flatMap(run -> cancellations.cancel(
                        run.getRunId(), currentUserId))
                .thenReturn(CommonResult.success(true));
    }

    private ServerSentEvent<AiChatStreamRespVO> toSse(
            AiChatStreamRespVO event) {
        ServerSentEvent.Builder<AiChatStreamRespVO> builder = ServerSentEvent.<AiChatStreamRespVO>builder(event)
                .event("pipeline-event");
        if (event.getRunId() == null && event.getSequence() == null) {
            return builder.build();
        }
        if (event.getRunId() == null || event.getRunId().isBlank()
                || event.getSequence() == null || event.getSequence() <= 0) {
            throw new IllegalStateException(
                    "Pipeline SSE event has incomplete durable identity");
        } else {
            builder.id(event.getRunId() + ':' + event.getSequence());
        }
        return builder.build();
    }
}
