package com.inneragent.platform.toolhub;

import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.toolhub.mapper.ToolGrantMapper;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 用户工具授权服务测试(P1-T2a;PRD §6.2.4/V18):授予快照、
 * 作用域校验、撤销、级联自动失效、确认档位输入(permanent FQN 集)。
 */
class ToolGrantServiceTests {

    private static final String FQN = "mcp__crm__list_users";

    private ToolGrantMapper grantMapper;
    private ToolRegistryMapper registryMapper;
    private ToolAuditService auditService;
    private ToolGrantService service;

    @BeforeEach
    void setUp() {
        grantMapper = Mockito.mock(ToolGrantMapper.class);
        registryMapper = Mockito.mock(ToolRegistryMapper.class);
        auditService = Mockito.mock(ToolAuditService.class);
        service = new ToolGrantService(grantMapper, registryMapper, auditService);
        ToolRegistryEntry tool = new ToolRegistryEntry();
        tool.setId(7L);
        tool.setToolName("list_users");
        tool.setFqn(FQN);
        tool.setRiskLevel("medium");
        tool.setSchemaSha256("a".repeat(64));
        tool.setEnabled(true);
        lenient().when(registryMapper.selectActiveByToolName("list_users")).thenReturn(tool);
        lenient().when(grantMapper.selectActiveByUserAndFqn(anyLong(), anyString()))
                .thenReturn(List.of());
    }

    private static long userId() {
        return 12993L;
    }

    @Test
    @DisplayName("授予 permanent:快照风险级+schema 指纹,决策记录落审计")
    void grantSnapshotsRiskAndFingerprint() {
        service.grant(userId(), "list_users", "permanent", null, "运营白名单");

        ArgumentCaptor<ToolGrant> captor = ArgumentCaptor.forClass(ToolGrant.class);
        verify(grantMapper).insert(captor.capture());
        ToolGrant row = captor.getValue();
        assertThat(row.getToolFqn()).isEqualTo(FQN);
        assertThat(row.getScope()).isEqualTo("permanent");
        assertThat(row.getRiskAtGrant()).isEqualTo("medium");
        assertThat(row.getSchemaSha256()).isEqualTo("a".repeat(64));
        assertThat(row.getSource()).isEqualTo("admin");
        assertThat(row.getDecisionNote()).isEqualTo("运营白名单");
        verify(auditService).append(any(ToolAuditService.ToolAuditEntry.class));
    }

    @Test
    @DisplayName("conversation 授权必须带会话 ID;permanent 不得带")
    void scopeConversationValidation() {
        assertThatThrownBy(() -> service.grant(userId(), "list_users", "conversation", null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("会话");
        assertThatThrownBy(() -> service.grant(userId(), "list_users", "permanent", "conv-1", null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("permanent");
        assertThatThrownBy(() -> service.grant(userId(), "list_users", "weekly", null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("scope");
    }

    @Test
    @DisplayName("重复同作用域授权 409;停用工具不可授予")
    void duplicateGrantAndDisabledToolRejected() {
        ToolGrant existing = new ToolGrant();
        existing.setToolFqn(FQN);
        existing.setScope("permanent");
        existing.setConversationId(null);
        existing.setDeleted(false);
        existing.setInvalidated(false);
        when(grantMapper.selectActiveByUserAndFqn(userId(), FQN)).thenReturn(List.of(existing));

        assertThatThrownBy(() -> service.grant(userId(), "list_users", "permanent", null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("已存在");

        ToolRegistryEntry disabled = new ToolRegistryEntry();
        disabled.setToolName("stopped_tool");
        disabled.setFqn("mcp__crm__stopped_tool");
        disabled.setEnabled(false);
        when(registryMapper.selectActiveByToolName("stopped_tool")).thenReturn(disabled);
        assertThatThrownBy(() -> service.grant(userId(), "stopped_tool", "permanent", null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("停用");
    }

    @Test
    @DisplayName("DEF-04:插入命中活跃行唯一键(并发窗口)→ 409 业务语义,不再裸 500")
    void duplicateKeyOnInsertMapsToConflict409() {
        // 服务层查重通过(查无活跃行),但 INSERT 撞活跃行部分唯一索引(并发窗口)
        when(grantMapper.selectActiveByUserAndFqn(userId(), FQN)).thenReturn(List.of());
        org.mockito.Mockito.doThrow(new org.springframework.dao.DuplicateKeyException(
                "uk_ia_tool_grant_active"))
                .when(grantMapper).insert(any(ToolGrant.class));

        assertThatThrownBy(() -> service.grant(userId(), "list_users", "permanent", null, null))
                .isInstanceOf(BusinessException.class)
                .hasMessageContaining("已存在")
                .satisfies(e -> assertThat(((BusinessException) e).getCode()).isEqualTo(409));
        // 冲突路径不落「granted」审计
        verify(auditService, never()).append(any(ToolAuditService.ToolAuditEntry.class));
    }

    @Test
    @DisplayName("撤销:deleteById 逻辑删除 + 审计")
    void revokeDeletesAndAudits() {
        ToolGrant row = new ToolGrant();
        row.setId(3L);
        row.setUserId(userId());
        row.setToolFqn(FQN);
        row.setScope("permanent");
        row.setRiskAtGrant("medium");
        when(grantMapper.selectById(3L)).thenReturn(row);

        service.revoke(3L, "用户撤销");
        verify(grantMapper).deleteById(3L);
        verify(auditService).append(any(ToolAuditService.ToolAuditEntry.class));
    }

    @Test
    @DisplayName("级联自动失效:置 invalidated+reason 并逐条审计")
    void invalidateByFqnMarksRowsAndAudits() {
        ToolGrant first = new ToolGrant();
        first.setId(1L);
        first.setUserId(userId());
        first.setToolFqn(FQN);
        ToolGrant second = new ToolGrant();
        second.setId(2L);
        second.setUserId(2L);
        second.setToolFqn(FQN);
        when(grantMapper.selectActiveByFqn(FQN)).thenReturn(List.of(first, second));

        int count = service.invalidateByFqn(FQN, "risk_upgrade");

        assertThat(count).isEqualTo(2);
        assertThat(first.getInvalidated()).isTrue();
        assertThat(first.getInvalidatedReason()).isEqualTo("risk_upgrade");
        assertThat(second.getInvalidated()).isTrue();
        verify(grantMapper).updateById(first);
        verify(grantMapper).updateById(second);
        verify(auditService, Mockito.times(2)).append(any(ToolAuditService.ToolAuditEntry.class));
    }

    @Test
    @DisplayName("无授权时级联失效为 0 且不写审计")
    void invalidateNothingIsNoop() {
        when(grantMapper.selectActiveByFqn(FQN)).thenReturn(List.of());
        assertThat(service.invalidateByFqn(FQN, "risk_upgrade")).isZero();
        verify(auditService, never()).append(any());
    }

    @Test
    @DisplayName("permanent FQN 集合 = 确认档位映射输入")
    void activePermanentFqnsFeedPolicyMapping() {
        ToolGrant permanent = new ToolGrant();
        permanent.setToolFqn(FQN);
        ToolGrant conversation = new ToolGrant();
        conversation.setToolFqn("mcp__crm__update_user");
        when(grantMapper.selectActivePermanentByUser(userId()))
                .thenReturn(List.of(permanent, conversation));

        assertThat(service.activePermanentFqns(userId()))
                .containsExactlyInAnyOrder(FQN, "mcp__crm__update_user");
    }
}
