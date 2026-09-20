package com.inneragent.agent.tool.builtin;

import cn.hutool.core.util.StrUtil;
import cn.hutool.json.JSONObject;
import cn.hutool.json.JSONUtil;
import com.inneragent.agent.tool.ToolExecutionContext;
import com.inneragent.agent.tool.ToolExecutor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/**
 * 内置只读工具:读取白名单目录内的文本文件(工具名 {@code parse_text_file})。
 * <p>
 * P0 冒烟/演示链路的内置工具之一:只读、并发安全、低风险(READ_ONLY 自动放行)。
 * <p>
 * 安全约束(防目录穿越):
 * <ul>
 *   <li>只允许读取 Agent 工作区({@code app.agent-workspace.local-base-path})与
 *       额外白名单目录({@code inneragent.tools.parse-text-file.allowed-roots},逗号分隔)
 *       之下的文件;</li>
 *   <li>入参路径先做 {@link Path#normalize()},再用
 *       {@link Path#toRealPath()} 消解符号链接后做白名单前缀校验,
 *       符号链接逃逸与 {@code ../} 穿越一律拒绝;</li>
 *   <li>只接受普通文件,超过 4 MB 拒绝读取,内容截断到 8 KB 并标记 {@code truncated}。</li>
 * </ul>
 * 返回 JSON:{@code {"status":"success","path":...,"encoding":...,"truncated":false,"content":...}};
 * 拒绝/失败返回 {@code {"status":"error","message":...}},不泄漏服务器路径细节以外的信息。
 */
@Component
@Slf4j
public class ParseTextFileToolExecutor implements ToolExecutor {

    /** 返回内容最大字符数(8 KB)。 */
    private static final int MAX_CONTENT_CHARS = 8 * 1024;

    /** 允许读取的文件最大字节数,防御性上限,避免把大文件整体载入内存。 */
    private static final long MAX_FILE_BYTES = 4L * 1024 * 1024;

    private final List<Path> allowedRoots;

    public ParseTextFileToolExecutor(
            @Value("${app.agent-workspace.local-base-path:./data/agent-workspace}")
            String workspaceLocalPath,
            @Value("${inneragent.tools.parse-text-file.allowed-roots:}") String additionalRoots) {
        List<Path> roots = new ArrayList<>();
        addRoot(roots, workspaceLocalPath);
        for (String root : StrUtil.nullToEmpty(additionalRoots).split("[,;]")) {
            addRoot(roots, root);
        }
        if (roots.isEmpty()) {
            throw new IllegalStateException(
                    "parse_text_file 工具没有可用白名单目录:请配置 app.agent-workspace.local-base-path"
                            + " 或 inneragent.tools.parse-text-file.allowed-roots");
        }
        this.allowedRoots = List.copyOf(roots);
        log.info("[ParseTextFileToolExecutor] 白名单目录: {}", roots);
    }

    @Override
    public String getToolName() {
        return "parse_text_file";
    }

    @Override
    public String getDisplayName() {
        return "读取文本文件";
    }

    @Override
    public String getToolDescription() {
        return "读取白名单目录(Agent 工作区)内的文本文件并返回前 8 KB 内容。"
                + "入参 path 为相对白名单目录的路径或目录内绝对路径,"
                + "encoding 为可选文件编码(缺省 UTF-8)。工作区之外的路径会被拒绝。";
    }

    @Override
    public String getParametersSchema() {
        return """
                {
                  "type": "object",
                  "properties": {
                    "path": {
                      "type": "string",
                      "description": "文本文件路径:相对白名单目录的相对路径,或位于白名单目录内的绝对路径"
                    },
                    "encoding": {
                      "type": "string",
                      "description": "可选文件编码(如 UTF-8、GBK),缺省 UTF-8"
                    }
                  },
                  "required": ["path"],
                  "additionalProperties": false
                }""";
    }

    @Override
    public boolean isReadOnly() {
        return true;
    }

    @Override
    public boolean isConcurrencySafe() {
        return true;
    }

    @Override
    public String execute(String toolInput, ToolExecutionContext context) {
        JSONObject input;
        try {
            input = StrUtil.isBlank(toolInput)
                    ? JSONUtil.createObj()
                    : JSONUtil.parseObj(toolInput);
        } catch (Exception invalidInput) {
            return error("入参不是合法 JSON 对象");
        }
        String rawPath = input.getStr("path");
        if (StrUtil.isBlank(rawPath)) {
            return error("缺少必填参数 path");
        }
        String encodingName = StrUtil.blankToDefault(input.getStr("encoding"), "UTF-8");
        Charset charset;
        try {
            charset = Charset.forName(encodingName.trim());
        } catch (Exception invalidCharset) {
            return error("非法编码: " + encodingName);
        }

        Path target;
        try {
            target = Path.of(rawPath.trim()).toAbsolutePath().normalize();
        } catch (Exception invalidPath) {
            return error("非法路径");
        }
        Path whitelisted = resolveInsideWhitelist(target);
        if (whitelisted == null) {
            return error("路径不在允许读取的白名单目录内");
        }
        if (!Files.isRegularFile(whitelisted)) {
            return error("目标不是普通文件或不存在");
        }
        try {
            if (Files.size(whitelisted) > MAX_FILE_BYTES) {
                return error("文件超过 4 MB,拒绝读取");
            }
            String content = Files.readString(whitelisted, charset);
            boolean truncated = content.length() > MAX_CONTENT_CHARS;
            return JSONUtil.createObj()
                    .set("status", "success")
                    .set("path", rawPath.trim())
                    .set("encoding", charset.name())
                    .set("totalChars", content.length())
                    .set("truncated", truncated)
                    .set("content", truncated ? content.substring(0, MAX_CONTENT_CHARS) : content)
                    .toString();
        } catch (IOException readFailure) {
            log.warn("[ParseTextFileToolExecutor] 读取失败: path={}", rawPath, readFailure);
            return error("读取失败: " + readFailure.getClass().getSimpleName());
        }
    }

    /**
     * 把目标路径消解真实路径后与白名单目录逐一前缀比对;不在白名单内返回 null。
     * <p>
     * 白名单目录与目标路径都可能含符号链接(如 macOS /tmp、部分挂载点),
     * 因此先按字面/真实路径任一匹配定位到白名单目录,再强制要求
     * 消解符号链接后的目标仍位于该目录的真实路径之下。
     */
    private Path resolveInsideWhitelist(Path target) {
        for (Path root : allowedRoots) {
            Path realRoot = toRealPathQuiet(root);
            Path realTarget = toRealPathQuiet(target);
            if (realRoot == null || realTarget == null) {
                continue;
            }
            boolean literalMatch = target.startsWith(root) || target.startsWith(realRoot);
            if (literalMatch && realTarget.startsWith(realRoot)) {
                return realTarget;
            }
        }
        return null;
    }

    private static Path toRealPathQuiet(Path path) {
        try {
            return path.toRealPath();
        } catch (IOException unavailable) {
            return null;
        }
    }

    private static void addRoot(List<Path> roots, String root) {
        if (StrUtil.isBlank(root)) {
            return;
        }
        roots.add(Path.of(root.trim()).toAbsolutePath().normalize());
    }

    private static String error(String message) {
        return JSONUtil.createObj()
                .set("status", "error")
                .set("message", message)
                .toString();
    }
}
