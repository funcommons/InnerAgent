-- =====================================================================
-- InnerAgent V4:P0 冒烟演示数据(seed)
-- 内容:
--   * ia_model_api_config:platform='mock' 的演示接入配置(MockAiProvider)。
--   * ia_ai_model:挂接该配置的 mock 文本模型 mock-text,并设为默认对话模型
--     (model_type=1;Pipeline 未显式传 modelId 时即命中,见
--     AiModelService.getDefaultByType)。
-- 目的:scripts/smoke-sse.sh 等冒烟链路在没有真实 API Key 的环境下,
--   经 MockAiProvider(确定性脚本模型)跑通"发起运行 → 模型 → 内置工具 →
--   流式回复 → DONE"全链路。
-- 风险提示:mock 模型回复为脚本固定文案,不代表真实模型推理结果;
--   生产环境严禁保留 platform='mock' 的配置(见 MockAiProvider 类注释,
--   演示模型名统一以 mock- 前缀标识)。文档:README「P0 冒烟」章节。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. mock 接入配置 + 默认 mock 文本模型(单语句原子写入)
-- ---------------------------------------------------------------------
WITH mock_api_config AS (
    INSERT INTO ia_model_api_config (
        app_id, name, platform, text_protocol, api_type,
        api_url, api_key, status, remark
    ) VALUES (
        1,
        'Mock Provider',
        'mock',
        'mock',
        1,
        'mock://local',
        'mock-not-a-real-key',
        1,
        'P0 冒烟专用 mock 平台配置;仅用于演示/测试,生产禁用(见 MockAiProvider 类注释)'
    )
    RETURNING id
)
INSERT INTO ia_ai_model (
    app_id, name, code, model_type, description,
    sort, status, default_model, max_concurrency,
    api_config_id, context_window
)
SELECT
    1,
    'mock-text',
    'mock-text',
    1,
    'P0 冒烟 mock 文本模型(MockAiProvider,确定性脚本输出,生产禁用)',
    999,
    1,
    TRUE,
    5,
    mock_api_config.id,
    8192
FROM mock_api_config;
