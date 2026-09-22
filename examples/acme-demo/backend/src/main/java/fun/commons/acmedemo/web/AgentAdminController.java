package fun.commons.acmedemo.web;

import com.fasterxml.jackson.databind.JsonNode;
import fun.commons.acmedemo.common.R;
import fun.commons.acmedemo.ia.IaAgentAdminService;
import fun.commons.acmedemo.session.DemoAuthInterceptor;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * DEMO「Agent 管理」页端点(创建 / 管理 / 配置 InnerAgent Agent 定义)。
 *
 * <p>前端仅持演示登录态;管理面密钥与签名私钥留在宿主后端,由
 * {@link IaAgentAdminService} 编排管理面 definitions API 与用户面模型列表。
 * 演示语义:任意登录用户可管理(生产实现必须换成宿主真实权限体系)。
 */
@RestController
@RequestMapping("/api/ia/agent-admin")
@RequiredArgsConstructor
public class AgentAdminController {

    private final IaAgentAdminService agentAdminService;

    /** 定义分页列表(agentType 升序;含提示词与规格)。 */
    @GetMapping("/definitions")
    public R<JsonNode> definitions() {
        requireSession();
        return R.ok(agentAdminService.listDefinitions());
    }

    /** 表单下拉聚合:工具注册表 + 对话模型 + 可挂子 Agent。 */
    @GetMapping("/options")
    public R<Map<String, Object>> options() {
        requireSession();
        IaAgentAdminService.AgentOptions options = agentAdminService.options();
        return R.ok(Map.of(
                "tools", options.tools(),
                "models", options.models(),
                "subAgents", options.subAgents()));
    }

    /** 创建 / 覆盖更新单条定义(definitionId 空=创建;bundle overwrite 通道)。 */
    @PostMapping("/save")
    public R<JsonNode> save(@RequestBody IaAgentAdminService.SaveReq request) {
        requireSession();
        return R.ok(agentAdminService.save(request));
    }

    private void requireSession() {
        if (DemoAuthInterceptor.current() == null) {
            throw new fun.commons.acmedemo.common.BizException(401, "未登录或演示会话无效");
        }
    }
}
