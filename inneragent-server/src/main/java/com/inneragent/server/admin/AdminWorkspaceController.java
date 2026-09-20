package com.inneragent.server.admin;

import com.inneragent.agent.entity.AgentWorkspaceConfig;
import com.inneragent.agent.entity.AgentWorkspaceMigration;
import com.inneragent.agent.workspace.AgentWorkspaceConfigService;
import com.inneragent.agent.workspace.AgentWorkspaceMigrationService;
import com.inneragent.platform.common.CommonResult;
import com.inneragent.server.controller.vo.AgentWorkspaceConfigRespVO;
import com.inneragent.server.controller.vo.AgentWorkspaceMigrateReqVO;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import static com.inneragent.platform.common.CommonResult.success;

/**
 * 工作空间存储 admin API(P2-srv me 语义归位)。
 *
 * <p>路由 {@code /ia/api/v1/admin/workspace*};由 {@link AdminTokenFilter} 以
 * {@code X-IA-Admin-Key} 鉴权。P1-T3b 时这些端点曾落 {@code /ia/api/v1/me/workspace*};
 * 其语义为<strong>应用级</strong>存储后端选择/迁移(全局单配置,非用户数据),
 * 归 admin 面(SDK me.ts 不消费;sdk-js 注释即标注「AgentWorkspace/迁移端点属
 * 服务端自管,同理裁剪」)。旧 {@code /me/workspace*} 路径删除不留别名。
 */
@Tag(name = "工作空间存储(管理面)")
@RestController
@RequestMapping("/ia/api/v1/admin/workspace")
@RequiredArgsConstructor
@Validated
public class AdminWorkspaceController {

    private final AgentWorkspaceConfigService workspaceConfigService;
    private final AgentWorkspaceMigrationService migrationService;

    @GetMapping
    @Operation(summary = "获取工作空间配置与用量")
    public CommonResult<AgentWorkspaceConfigRespVO> workspace() {
        AgentWorkspaceConfig config = workspaceConfigService.getCurrent();
        AgentWorkspaceConfigService.WorkspaceUsage usage = workspaceConfigService.usage();
        return success(new AgentWorkspaceConfigRespVO(
                config.getBackendType(),
                config.getStorageConfigId(),
                config.getLocalPath(),
                config.getMigrationStatus(),
                config.getActiveMigrationId(),
                usage.entryCount(),
                usage.contentBytes(),
                migrationService.latest()));
    }

    @PostMapping("/test")
    @Operation(summary = "测试目标存储可达性")
    public CommonResult<Boolean> test(@Valid @RequestBody AgentWorkspaceMigrateReqVO request) {
        migrationService.test(request.backendType(), request.storageConfigId(),
                request.localPath());
        return success(true);
    }

    @PostMapping("/migrations")
    @Operation(summary = "迁移并切换工作空间存储")
    public CommonResult<Long> migrate(@Valid @RequestBody AgentWorkspaceMigrateReqVO request) {
        return success(migrationService.start(
                request.backendType(), request.storageConfigId(), request.localPath()));
    }

    @GetMapping("/migrations/{id}")
    @Operation(summary = "获取迁移进度")
    public CommonResult<AgentWorkspaceMigration> migration(@PathVariable Long id) {
        return success(migrationService.get(id));
    }

    @PostMapping("/migrations/{id}/rollback")
    @Operation(summary = "回滚已完成的迁移")
    public CommonResult<Boolean> rollback(@PathVariable Long id) {
        migrationService.rollback(id);
        return success(true);
    }

    @PostMapping("/migrations/{id}/dismiss-failure")
    @Operation(summary = "解除失败迁移对工作空间写入的锁定")
    public CommonResult<Boolean> dismissFailure(@PathVariable Long id) {
        migrationService.dismissFailure(id);
        return success(true);
    }
}
