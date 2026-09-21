package com.inneragent.platform.toolhub;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.inneragent.agent.mcp.McpToolHealthChecker;
import com.inneragent.platform.common.BusinessException;
import com.inneragent.platform.tenant.TenantContext;
import com.inneragent.platform.toolhub.mapper.ToolRegistryMapper;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 工具体检 v1(P2-safety 批次②;PRD §6.8 M8「工具体检」+ 03-开发计划 W5)。
 *
 * <p>对单个注册工具做健康检查并落库(ia_tool_registry.health_status /
 * last_checked_at / health_detail_json,V16),列表/详情接口回显体检位。
 * 检查项与结论矩阵(结论语义见 {@link ToolHealthStatus}):
 * <ol>
 *   <li><strong>endpoint_reachable</strong>:MCP initialize + listTools 握手
 *       (探活通道 {@link McpToolHealthChecker});失败 → <em>unreachable</em>,
 *       后续宿主侧检查跳过;</li>
 *   <li><strong>tool_present</strong>:toolName 在宿主清单中;缺失 →
 *       <em>degraded</em>(自拟语义,v1 不设第四态——宿主已下线的工具注册行
 *       仍可达 endpoint,以漂移档呈现并建议注销/核对);</li>
 *   <li><strong>schema_fingerprint</strong>:宿主 inputSchema 的 canonical
 *       sha256 与注册 {@code schema_sha256} 一致;漂移 → <em>degraded</em>
 *       (注册快照过期,建议重发 /schema 走活刷新分诊);</li>
 *   <li><strong>annotations_diff</strong>:宿主上报注解与注册
 *       annotations_json 归一 diff;有差异 → <em>degraded</em>(readOnlyHint
 *       等策略软输入漂移,建议复核风险级)。</li>
 * </ol>
 * 全部通过 → <em>ok</em>。体检只读注册行 + 回写体检位,不改 schema/注解
 * 生效内容(分诊唯一入口仍是 /schema 活刷新),不影响运行级快照 pinning。
 *
 * <p>API:单工具同步体检(POST /admin/tools/{id}/check);批量/全量异步体检
 * (POST /admin/tools/check-batch,单线程逐个执行,结果落各自注册行,
 * 经 GET /admin/tools/{id} 可查)。
 */
@Service
@Slf4j
public class ToolHealthService {

    /** 检查项码值(health_detail_json.checks[].check)。 */
    static final String CHECK_ENDPOINT = "endpoint_reachable";
    static final String CHECK_TOOL_PRESENT = "tool_present";
    static final String CHECK_SCHEMA_FINGERPRINT = "schema_fingerprint";
    static final String CHECK_ANNOTATIONS_DIFF = "annotations_diff";

    /** 体检明细 JSON 中的结论码值(pass=通过 / drift=漂移)。 */
    static final String ITEM_PASS = "pass";
    static final String ITEM_DRIFT = "drift";

    private static final int MAX_DETAIL_LENGTH = 8192;

    private final ToolRegistryMapper registryMapper;
    private final McpToolHealthChecker healthChecker;
    private final ToolHealthProperties properties;
    private final ObjectMapper objectMapper;

    /** 批量体检执行器(单线程逐个;v1 不并发扫描宿主桥)。 */
    private final ExecutorService batchExecutor = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "tool-health-batch");
        thread.setDaemon(true);
        return thread;
    });

    public ToolHealthService(ToolRegistryMapper registryMapper,
                             McpToolHealthChecker healthChecker,
                             ToolHealthProperties properties,
                             ObjectMapper objectMapper) {
        this.registryMapper = Objects.requireNonNull(registryMapper, "registryMapper must not be null");
        this.healthChecker = Objects.requireNonNull(healthChecker, "healthChecker must not be null");
        this.properties = Objects.requireNonNull(properties, "properties must not be null");
        this.objectMapper = Objects.requireNonNull(objectMapper, "objectMapper must not be null");
    }

    // ------------------------------------------------------------------
    // 单工具同步体检
    // ------------------------------------------------------------------

    /**
     * 同步体检一个工具:执行检查矩阵,落库体检位,返回完整结果
     * (结果同时持久化,GET /admin/tools/{id} 可回读)。
     */
    public ToolCheckResult checkOne(long toolId) {
        ToolRegistryEntry entry = requireEntry(toolId);
        return executeAndPersist(entry);
    }

    // ------------------------------------------------------------------
    // 批量/全量异步体检
    // ------------------------------------------------------------------

    /**
     * 受理批量体检:ids 为空 → 全量(全部未删除注册行);否则按给定 id 集
     * (去重,未知 id 计入 skipped 并在响应注明)。任务单线程逐个执行,
     * 立即返回受理结果;每工具结果即时落库,经 GET /admin/tools/{id} 可查。
     */
    public CheckBatchReceipt checkBatch(List<Long> ids) {
        List<ToolRegistryEntry> targets;
        List<Long> skipped = List.of();
        if (ids == null || ids.isEmpty()) {
            targets = TenantContext.runAsSystem(() -> registryMapper.selectList(null));
        } else {
            List<Long> distinct = ids.stream().distinct().toList();
            Set<Long> wanted = new LinkedHashSet<>(distinct);
            targets = TenantContext.runAsSystem(() -> registryMapper.selectBatchIds(wanted));
            Set<Long> found = new LinkedHashSet<>();
            targets.forEach(entry -> found.add(entry.getId()));
            skipped = distinct.stream().filter(id -> !found.contains(id)).toList();
        }
        // 注册表快照复制到任务内(异步线程不再依赖请求线程的会话/上下文)
        List<ToolRegistryEntry> snapshot = List.copyOf(targets);
        int total = snapshot.size();
        batchExecutor.submit(() -> runBatch(snapshot));
        log.info("批量体检已受理: total={}, skipped={}, 全量={}", total, skipped.size(),
                ids == null || ids.isEmpty());
        return new CheckBatchReceipt(true, total, skipped);
    }

    private void runBatch(List<ToolRegistryEntry> snapshot) {
        for (ToolRegistryEntry entry : snapshot) {
            try {
                TenantContext.runAsSystem(() -> {
                    executeAndPersist(entry);
                    return null;
                });
            } catch (Exception unexpected) {
                // 单工具体检失败不阻断批内后续;该工具落 unreachable 可查
                log.warn("批量体检单工具失败: fqn={}, cause={}",
                        entry.getFqn(), String.valueOf(unexpected.getMessage()));
                persistResult(entry, ToolHealthStatus.UNREACHABLE, List.of(
                        new CheckItem(CHECK_ENDPOINT, ITEM_DRIFT,
                                null, "体检执行失败: " + unexpected.getMessage())));
            }
        }
        log.info("批量体检完成: total={}", snapshot.size());
    }

    // ------------------------------------------------------------------
    // 检查矩阵
    // ------------------------------------------------------------------

    private ToolCheckResult executeAndPersist(ToolRegistryEntry entry) {
        List<CheckItem> checks = new ArrayList<>();
        ToolHealthStatus status;
        McpToolHealthChecker.ProbeOutcome probe =
                healthChecker.probe(entry.getAppId() == null ? 1L : entry.getAppId(),
                        entry, properties.getProbeTimeout());
        if (!probe.reachable()) {
            checks.add(new CheckItem(CHECK_ENDPOINT, ITEM_DRIFT, probe.failureReason(),
                    "宿主端点不可达:核对 endpoint_url 与宿主桥可用性,或注销该工具"));
            status = ToolHealthStatus.UNREACHABLE;
        } else {
            checks.add(new CheckItem(CHECK_ENDPOINT, ITEM_PASS,
                    "MCP initialize/listTools 握手成功", null));
            status = checkHostManifest(entry, probe.tools(), checks);
        }
        return persistResult(entry, status, checks);
    }

    /** 宿主侧三项检查(清单/指纹/注解);任一漂移 → degraded。 */
    private ToolHealthStatus checkHostManifest(
            ToolRegistryEntry entry, List<McpToolHealthChecker.HostTool> tools,
            List<CheckItem> checks) {
        ToolHealthStatus status = ToolHealthStatus.OK;
        McpToolHealthChecker.HostTool hostTool = null;
        for (McpToolHealthChecker.HostTool candidate : tools) {
            if (entry.getToolName().equals(candidate.name())) {
                hostTool = candidate;
                break;
            }
        }
        if (hostTool == null) {
            checks.add(new CheckItem(CHECK_TOOL_PRESENT, ITEM_DRIFT,
                    "宿主清单 " + tools.size() + " 个工具中不含 " + entry.getToolName(),
                    "宿主可能已下线/改名该工具:核对宿主,或注销注册行(v1 归入 degraded 档)"));
            return ToolHealthStatus.DEGRADED;
        }
        checks.add(new CheckItem(CHECK_TOOL_PRESENT, ITEM_PASS,
                "toolName 在宿主清单中", null));

        // schema 指纹:宿主 inputSchema canonical sha256 vs 注册 schema_sha256。
        // 注册行为无 schema 工具(schema_sha256 空)→ 跳过比对(自拟语义:
        // 无法比对的空基准不产生漂移,完整性建议写入明细)
        boolean registeredSchemaBlank =
                entry.getSchemaSha256() == null || entry.getSchemaSha256().isBlank();
        if (registeredSchemaBlank) {
            checks.add(new CheckItem(CHECK_SCHEMA_FINGERPRINT, ITEM_PASS,
                    "注册行无 schema,跳过指纹比对",
                    hostSchemaBlank(hostTool)
                            ? null
                            : "宿主已上报 schema 而注册行为空:建议重发 /schema 补齐注册快照"));
        } else {
            String hostSha = hostSchemaBlank(hostTool)
                    ? ToolSchemaFingerprint.of(objectMapper, "")
                    : ToolSchemaFingerprint.of(objectMapper,
                            ToolSchemaFingerprint.canonicalJson(objectMapper, hostTool.inputSchemaJson()));
            if (hostSha.equals(entry.getSchemaSha256())) {
                checks.add(new CheckItem(CHECK_SCHEMA_FINGERPRINT, ITEM_PASS,
                        "指纹一致: " + shortSha(hostSha), null));
            } else {
                checks.add(new CheckItem(CHECK_SCHEMA_FINGERPRINT, ITEM_DRIFT,
                        "注册 " + shortSha(entry.getSchemaSha256()) + " ≠ 宿主 "
                                + shortSha(hostSha),
                        "schema 指纹漂移:建议经 POST /admin/tools/{id}/schema 重发走活刷新分诊"));
                status = ToolHealthStatus.DEGRADED;
            }
        }

        // 注解 diff:归一 JSON 对比(readOnlyHint 等策略软输入的漂移告警)
        ToolAnnotations registered = ToolAnnotations.parse(objectMapper, entry.getAnnotationsJson());
        ToolAnnotations host = hostTool.annotations(objectMapper);
        List<String> differingKeys = diffKeys(registered.rawJson(), host.rawJson());
        if (differingKeys.isEmpty()) {
            checks.add(new CheckItem(CHECK_ANNOTATIONS_DIFF, ITEM_PASS, "注解一致", null));
        } else {
            checks.add(new CheckItem(CHECK_ANNOTATIONS_DIFF, ITEM_DRIFT,
                    "差异键: " + differingKeys,
                    "注解与宿主上报存在差异(readOnlyHint/idempotentHint 等策略软输入):建议复核风险级与 resumeSafe"));
            status = ToolHealthStatus.DEGRADED;
        }
        return status;
    }

    // ------------------------------------------------------------------
    // 落库与结果形状
    // ------------------------------------------------------------------

    private ToolCheckResult persistResult(
            ToolRegistryEntry entry, ToolHealthStatus status, List<CheckItem> checks) {
        String detailJson = detailJson(status, checks);
        ToolRegistryEntry row = registryMapper.selectById(entry.getId());
        if (row == null) {
            // 批量执行途中被注销:无处落体检位,结果仅返回(不复活死行,DEF-03 同训)
            log.info("体检目标已注销,结果仅返回不落库: fqn={}", entry.getFqn());
        } else {
            row.setHealthStatus(status.code());
            row.setLastCheckedAt(LocalDateTime.now());
            row.setHealthDetailJson(detailJson);
            registryMapper.updateById(row);
        }
        return new ToolCheckResult(entry.getId(), entry.getFqn(), entry.getToolName(),
                status.code(), checks, detailJson);
    }

    /** 明细 JSON:{"status":..., "checks":[{"check","status","detail","advice"}...]}。 */
    private String detailJson(ToolHealthStatus status, List<CheckItem> checks) {
        try {
            ObjectNode root = objectMapper.createObjectNode();
            root.put("status", status.code());
            ArrayNode items = root.putArray("checks");
            for (CheckItem item : checks) {
                ObjectNode node = items.addObject();
                node.put("check", item.check());
                node.put("status", item.status());
                if (item.detail() != null) {
                    node.put("detail", item.detail());
                }
                if (item.advice() != null) {
                    node.put("advice", item.advice());
                }
            }
            String json = objectMapper.writeValueAsString(root);
            return json.length() > MAX_DETAIL_LENGTH
                    ? json.substring(0, MAX_DETAIL_LENGTH)
                    : json;
        } catch (Exception serializationFailure) {
            // 明细序列化失败不影响体检结论落库(结论列是权威字段)
            return "{\"status\":\"" + status.code() + "\",\"detailSerializationFailed\":true}";
        }
    }

    // ------------------------------------------------------------------
    // helpers
    // ------------------------------------------------------------------

    private ToolRegistryEntry requireEntry(long toolId) {
        ToolRegistryEntry entry = registryMapper.selectById(toolId);
        if (entry == null) {
            throw new BusinessException(404, "工具不存在: " + toolId);
        }
        return entry;
    }

    private static boolean hostSchemaBlank(McpToolHealthChecker.HostTool hostTool) {
        return hostTool.inputSchemaJson() == null || hostTool.inputSchemaJson().isBlank();
    }

    private static String shortSha(String sha) {
        if (sha == null || sha.isBlank()) {
            return "(empty)";
        }
        return sha.length() <= 8 ? sha : sha.substring(0, 8) + "…";
    }

    /**
     * 两个注解 JSON 的差异键(解析为树后按顶层 key 对比;值不等或单侧缺失
     * 记为差异;解析失败按整文档差异处理)。
     */
    private List<String> diffKeys(String registeredJson, String hostJson) {
        try {
            JsonNode registered = objectMapper.readTree(
                    registeredJson == null || registeredJson.isBlank() ? "{}" : registeredJson);
            JsonNode host = objectMapper.readTree(
                    hostJson == null || hostJson.isBlank() ? "{}" : hostJson);
            Set<String> keys = new LinkedHashSet<>();
            registered.fieldNames().forEachRemaining(keys::add);
            host.fieldNames().forEachRemaining(keys::add);
            List<String> differing = new ArrayList<>();
            for (String key : keys) {
                if (!registered.path(key).equals(host.path(key))) {
                    differing.add(key);
                }
            }
            return differing;
        } catch (Exception invalidAnnotations) {
            return List.of("(unparseable)");
        }
    }

    @PreDestroy
    void shutdown() {
        batchExecutor.shutdownNow();
    }

    // ------------------------------------------------------------------
    // 结果 VO(服务层 record:admin API 与落库共用同一形状)
    // ------------------------------------------------------------------

    /** 单检查项结论(status=pass/drift;drift 携带 detail 与整改建议 advice)。 */
    public record CheckItem(String check, String status, String detail, String advice) {
    }

    /** 单工具体检结果(同步响应体 + 落库明细同源)。 */
    public record ToolCheckResult(
            Long toolId,
            String fqn,
            String toolName,
            String status,
            List<CheckItem> checks,
            String detailJson) {

        public String status() {
            return status == null ? null : status.toLowerCase(Locale.ROOT);
        }
    }

    /** 批量体检受理回执(异步执行;结果经 GET /admin/tools/{id} 可查)。 */
    public record CheckBatchReceipt(boolean accepted, int total, List<Long> skipped) {
    }
}
