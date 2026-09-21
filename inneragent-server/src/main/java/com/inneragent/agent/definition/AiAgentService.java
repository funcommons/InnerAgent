package com.inneragent.agent.definition;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.config.ai.AiAgentDefinition;
import com.inneragent.platform.config.ai.AiAgentRegistry;
import com.inneragent.platform.context.AppContext;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * AI Agent 定义解析服务(P4 数据驱动内核的运行面解析口)。
 *
 * <p><strong>解析优先级</strong>(全内核统一,消费方含
 * {@code AgentKernelSpecFactory}(根/子规格与工具白名单)、
 * {@code AiToolConfigService}(工具面)、
 * {@code PlatformAgentKernelToolRegistry}(运行期工具注册表)):
 * <ol>
 *   <li><strong>DB 优先</strong>:ia_agent_definition(app 隔离,启用态)命中
 *       即数据驱动——管理面(导入/提示词编辑/规格修改)改完即生效,无需发版;
 *       命中时落一条调试级解析日志(需求口径:只留痕,不设审计码值)。</li>
 *   <li><strong>回落代码注册表</strong>({@link AiAgentRegistry}):DB 未命中
 *       (缺行/停用/端口缺失)时按既有代码定义解析,既有 agentType 全部零回归。
 *       DB 行与代码定义同名的优先级即「DB 优先」;同名行停用后自动回落代码,
 *       是管理面「下线数据定义」的现成开关。</li>
 * </ol>
 *
 * <p>kind 不参与解析过滤:main/sub 同走一张定义表,kind 由播种/导入按
 * 引用关系(subAgentTools.refAgentType)派生,「子 Agent 即工具」的引用本身
 * 已表达方向;代码注册表侧 sub 类型(如 episode_scene_writer)历来可被同口
 * 解析,DB 侧不收紧(子 Agent 引用解析亦依赖本口,见 createChild 链)。
 *
 * <p><strong>同型补缺</strong>:DB 行优先,但 ia_agent_definition 表未承载的
 * 槽位(defaultUserMessage,随 bundle schemaVersion 升版引入)以代码注册表
 * 同型定义补齐——保证播种自代码的定义在无消息 Pipeline 场景行为不变;DB 独有
 * 定义无代码孪生,维持 null(缺消息时按既有语义拒绝)。
 *
 * <p><strong>遗留</strong>:greeting(开场白)DB 已承载,但运行入口为
 * 流式 run 语义、无「会话首条」承接点,暂不消费(未接上,属后续批次)。
 */
@Service
@Slf4j
public class AiAgentService {

    private final AiAgentRegistry agentRegistry;
    /** 定义数据端口(测试直构可空;可空时仅代码注册表,即切换前行为)。 */
    private final AgentDefinitionDataPort dataPort;

    /** 兼容直构(切换前行为:仅代码注册表)。 */
    public AiAgentService(AiAgentRegistry agentRegistry) {
        this(agentRegistry, null);
    }

    @Autowired
    public AiAgentService(AiAgentRegistry agentRegistry, AgentDefinitionDataPort dataPort) {
        this.agentRegistry = agentRegistry;
        this.dataPort = dataPort;
    }

    /**
     * 获取所有代码注册表定义(仅供播种/对账侧;运行面解析走 {@link #getByType},
     * 管理面列表走 AgentDefinitionAdminService)。
     */
    public List<AiAgentDefinition> getAll() {
        return agentRegistry.getAll();
    }

    /**
     * 根据类型解析 Agent 定义(DB 优先,回落代码注册表;语义见类注)。
     *
     * @param type Agent 类型
     * @return Agent 定义,不存在返回 null
     */
    public AiAgentDefinition getByType(String type) {
        AiAgentDefinition fromDefinitionStore = loadFromDefinitionStore(type);
        return fromDefinitionStore != null ? fromDefinitionStore : agentRegistry.getByType(type);
    }

    /**
     * 根据类型获取 Agent 定义(不存在则抛异常)
     *
     * @param type Agent 类型
     * @return Agent 定义
     * @throws BusinessException 如果类型不存在
     */
    public AiAgentDefinition getRequiredByType(String type) {
        AiAgentDefinition definition = getByType(type);
        if (definition == null) {
            throw new BusinessException("Agent 类型不存在: " + type);
        }
        return definition;
    }

    /**
     * DB 优先侧:端口缺失(测试直构)或未命中(缺行/停用)返回 null 回落;
     * 端口实现按契约 fail-closed(规格 JSON 不可解析抛真实原因,不静默回落)。
     */
    private AiAgentDefinition loadFromDefinitionStore(String type) {
        if (dataPort == null || type == null || type.isBlank()) {
            return null;
        }
        AiAgentDefinition definition = dataPort.loadEnabled(AppContext.currentOrDefault(), type);
        if (definition == null) {
            return null;
        }
        if (definition.getDefaultUserMessage() == null) {
            AiAgentDefinition codeTwin = agentRegistry.getByType(type);
            if (codeTwin != null) {
                definition.setDefaultUserMessage(codeTwin.getDefaultUserMessage());
            }
        }
        log.debug("运行定义解析命中 ia_agent_definition(数据驱动): appId={}, agentType={}",
                AppContext.currentOrDefault(), type);
        return definition;
    }
}
