package com.inneragent.platform.kb;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.kb.mapper.IaKbExternalMapper;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Objects;

/**
 * 外部知识库登记服务(管理面,应用级;契约源 06-外部知识库API规范.md §2):
 * 登记/列表/软删/调试外呼。形态对齐三方 MCP 应用级注册——由平台管理员登记、
 * 对应用内所有用户生效;凭证只存管理面,永不出现在审计日志。脱敏:出参
 * {@link KbExternalView} 的 credentials <strong>恒 null</strong>(service 层内置,
 * VO 契约「只写不读出」,登记后不回显)。每应用暂限 1 个(§6,超限 400);
 * 软删行不占额度与唯一键(V26 部分唯一索引),同应用删除后可重新登记。
 */
@Service
@Slf4j
public class KbExternalConfigService {

    public static final String AUTH_NONE = "NONE";
    public static final String AUTH_STATIC_HEADER = "STATIC_HEADER";

    /** 每应用外接源数上限(§6:暂限 1 个,后续按需放开)。 */
    private static final int MAX_SOURCES_PER_APP = 1;

    /** 超时缺省(§3:默认 10s)。 */
    private static final int DEFAULT_TIMEOUT_MS = 10_000;

    private final IaKbExternalMapper mapper;
    private final KbExternalRetrievalClient client;

    public KbExternalConfigService(IaKbExternalMapper mapper, KbExternalRetrievalClient client) {
        this.mapper = Objects.requireNonNull(mapper, "mapper must not be null");
        this.client = Objects.requireNonNull(client, "client must not be null");
    }

    /** 登记:校验 → 每应用上限判定 → 落库(active);STATIC_HEADER 头成对必填。 */
    @Transactional
    public KbExternalView register(long appId, String name, String endpointUrl,
                                   String authType, String headerName,
                                   String credentials, Integer timeoutMs) {
        String safeName = requireField(name, "外接源名称", 128);
        String safeEndpoint = requireField(endpointUrl, "检索端点 URL", 2048);
        String safeAuth = authType == null || authType.isBlank()
                ? AUTH_NONE : authType.trim();
        if (!AUTH_NONE.equals(safeAuth) && !AUTH_STATIC_HEADER.equals(safeAuth)) {
            throw new BusinessException(400, "authType 仅支持 NONE / STATIC_HEADER");
        }
        if (AUTH_STATIC_HEADER.equals(safeAuth)) {
            requireField(headerName, "静态头名", 128); // §2:成对必填
            requireField(credentials, "静态头值", 4096);
        }
        int safeTimeout = timeoutMs == null ? DEFAULT_TIMEOUT_MS : timeoutMs;
        if (safeTimeout <= 0) {
            throw new BusinessException(400, "timeoutMs 须为正整数(毫秒)");
        }
        if (mapper.countActive(appId) >= MAX_SOURCES_PER_APP) {
            throw new BusinessException(400, "每应用外接源数已达上限(暂限 1 个),请先删除现有登记");
        }
        boolean withHeader = AUTH_STATIC_HEADER.equals(safeAuth);
        IaKbExternal row = new IaKbExternal();
        row.setAppId(appId);
        row.setName(safeName);
        row.setEndpointUrl(safeEndpoint);
        row.setAuthType(safeAuth);
        row.setHeaderName(withHeader ? headerName.trim() : null);
        row.setCredentials(withHeader ? credentials : null);
        row.setStatus("active");
        row.setTimeoutMs(safeTimeout);
        mapper.insert(row);
        log.info("外部知识库登记: appId={}, id={}, name={}, auth={}",
                appId, row.getId(), safeName, safeAuth);
        return toView(row);
    }

    /** 应用内登记清单(id 升序);credentials 恒 null(脱敏,只写不读出)。 */
    public List<KbExternalView> list(long appId) {
        return mapper.selectList(new LambdaQueryWrapper<IaKbExternal>()
                        .eq(IaKbExternal::getAppId, appId)
                        .orderByAsc(IaKbExternal::getId))
                .stream().map(KbExternalConfigService::toView).toList();
    }

    /** 软删(幂等;活跃行不占唯一键与额度,删除后可重新登记)。 */
    @Transactional
    public boolean delete(long appId, long id) {
        return mapper.softDelete(appId, id) == 1;
    }

    /** 检索调试:直呼宿主端点看原始命中(管理面排障用;失败按零命中)。 */
    public List<KbExternalRetrievalClient.Hit> debug(
            long appId, long id, String query, Integer topK) {
        return client.retrieve(requireRow(appId, id), query, topK);
    }

    private IaKbExternal requireRow(long appId, long id) {
        IaKbExternal row = mapper.selectById(id);
        if (row == null || row.getAppId() == null || row.getAppId() != appId) {
            throw new BusinessException(404, "外部知识库登记不存在: " + id);
        }
        return row;
    }

    /** 脱敏点:credentials 传 null——登记后不回显(审计/日志亦不出值)。 */
    private static KbExternalView toView(IaKbExternal row) {
        return new KbExternalView(row.getId(), row.getAppId(), row.getName(),
                row.getEndpointUrl(), row.getAuthType(), row.getHeaderName(),
                row.getStatus(), row.getTimeoutMs(), null);
    }

    /** 非空必填(登记契约);返回 trim 后值,空白或超长即 400。 */
    private static String requireField(String value, String label, int maxLength) {
        String safe = value == null || value.isBlank() ? null : value.trim();
        if (safe == null) {
            throw new BusinessException(400, label + "不能为空");
        }
        if (safe.length() > maxLength) {
            throw new BusinessException(400, label + "不能超过 " + maxLength + " 个字符");
        }
        return safe;
    }

    /** 列表/登记出参:credentials 恒 null(只写不读出,service 层脱敏)。 */
    public record KbExternalView(
            Long id,
            Long appId,
            String name,
            String endpointUrl,
            String authType,
            String headerName,
            String status,
            Integer timeoutMs,
            String credentials) {
    }
}
