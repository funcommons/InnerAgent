/**
 * e2e/vendor/devtools-api-stub.js — 测试基建桩件(非产品代码)。
 *
 * 背景: sdk-js/packages/components/dist/inneragent-chat.js 以 bare specifier
 * 引 'vue'/'pinia'(rollupOptions.external), 宿主需自行供模块。e2e 断流中转页
 * 用 import map 把裸名映射到本地 vendor 文件; pinia 的 dev 构建引
 * '@vue/devtools-api', 演示/测试环境无 devtools 需求 → 以空实现桩住。
 */
export function setupDevtoolsPlugin() { /* e2e: devtools not needed */ }
export default { setupDevtoolsPlugin }
