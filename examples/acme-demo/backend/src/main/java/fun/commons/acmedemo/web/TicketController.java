package fun.commons.acmedemo.web;

import fun.commons.acmedemo.common.R;
import fun.commons.acmedemo.session.DemoAuthInterceptor;
import fun.commons.acmedemo.session.DemoSessionService;
import fun.commons.acmedemo.tool.AcmeTicketTools;
import jakarta.validation.constraints.NotBlank;
import java.util.List;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 工具调用演示(宿主 REST 面;取代微剧场 DEMO 的「产片提交/轮询」)。
 *
 * 与 {@code AcmeTicketTools} 共用同一内存存储:本控制器是「宿主表单直建」
 * 通道(channel=direct);经 InnerAgent 会话触发的 create_ticket 走
 * /ia-mcp 桥(channel=agent,createdBy 来自 act token)。
 * 前端工具演示页轮询本接口,即可看到两条通道的工单混排。
 */
@Validated
@RestController
@RequestMapping("/api/tickets")
@RequiredArgsConstructor
public class TicketController {

    private final AcmeTicketTools tools;

    public record CreateReq(@NotBlank(message = "title 不能为空") String title,
                            String description,
                            String priority) {
    }

    @PostMapping
    public R<Map<String, Object>> create(@Validated @RequestBody CreateReq req) {
        DemoSessionService.Session session = DemoAuthInterceptor.current();
        long userId = session == null ? 0L : session.userId();
        return R.ok(tools.createDirect(req.title(), req.description(), req.priority(), userId));
    }

    @GetMapping
    public R<List<Map<String, Object>>> list() {
        return R.ok(tools.snapshot());
    }
}
