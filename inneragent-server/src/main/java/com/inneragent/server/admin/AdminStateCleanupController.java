package com.inneragent.server.admin;

import com.inneragent.agent.entity.AgentStateCleanupPolicy;
import com.inneragent.agent.state.AgentStateCleanupPolicyService;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.controller.vo.AgentStateCleanupPolicyRespVO;
import com.inneragent.server.controller.vo.AgentStateCleanupPolicySaveReqVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * AgentState 清理策略 admin API(P2-srv me 语义归位)。
 *
 * <p>路由 {@code /ia/api/v1/admin/state-cleanup};由 {@link AdminTokenFilter} 以
 * {@code X-IA-Admin-Key} 鉴权。清理策略是<strong>应用级</strong>全局单行配置
 * (ia_agent_state_cleanup_policy,非用户数据),P1-T3b 时曾落
 * {@code /ia/api/v1/me/state-cleanup},归 admin 面(SDK me.ts 不消费);
 * 旧 {@code /me/state-cleanup} 路径删除不留别名。
 */
@Tag(name = "AgentState 清理策略(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/state-cleanup")
@RequiredArgsConstructor
@Validated
public class AdminStateCleanupController {

    private final AgentStateCleanupPolicyService stateCleanupPolicyService;

    @GetMapping
    @Operation(summary = "获取 AgentState 清理配置")
    public CommonResult<AgentStateCleanupPolicyRespVO> stateCleanupPolicy() {
        return success(toResponse(stateCleanupPolicyService.getCurrent()));
    }

    @PutMapping
    @Operation(summary = "更新 AgentState 清理配置(清理间隔/保留期)")
    public CommonResult<AgentStateCleanupPolicyRespVO> update(
            @Valid @RequestBody AgentStateCleanupPolicySaveReqVO request) {
        return success(toResponse(stateCleanupPolicyService.update(
                request.cleanupIntervalDays(), request.retentionDays())));
    }

    private static AgentStateCleanupPolicyRespVO toResponse(AgentStateCleanupPolicy policy) {
        return new AgentStateCleanupPolicyRespVO(
                policy.getCleanupIntervalDays(),
                policy.getRetentionDays(),
                toInstant(policy.getNextCleanupAt()),
                toInstant(policy.getLastCleanupAt()));
    }

    private static Instant toInstant(LocalDateTime value) {
        return value == null ? null : value.toInstant(ZoneOffset.UTC);
    }
}
