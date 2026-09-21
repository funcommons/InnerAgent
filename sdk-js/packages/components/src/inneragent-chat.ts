/**
 * [new] <inneragent-chat> Web Component 注册入口 (任务 P1-T3a)。
 *
 * 用法:
 * ```html
 * <script type="module">
 *   import { init } from '@inneragent/sdk-core'
 *   import { registerInnerAgentChat } from '@inneragent/sdk-components'
 *
 *   init({ appKey: 'demo', tokenGetter: async () => null })
 *   registerInnerAgentChat()          // 注册 <inneragent-chat>
 *   document.body.innerHTML = '<inneragent-chat view="chat" project-id="7" />'
 * </script>
 * ```
 * - mode: 'wc' (默认): 本入口; mode: 'iframe': P4/W15 postMessage 桥 (init 占位报错)。
 * - defineCustomElement + configureApp 注入独立 pinia 实例 (与宿主应用隔离)。
 */
import { defineCustomElement } from 'vue'
import { createPinia } from 'pinia'
import InnerAgentChat from './InnerAgentChat.ce.vue'

export const InnerAgentChatElement = defineCustomElement(InnerAgentChat, {
  configureApp(app) {
    app.use(createPinia())
  },
})

/** 注册 <inneragent-chat>; 重复调用幂等 (已注册时跳过)。 */
export function registerInnerAgentChat(tagName = 'inneragent-chat'): void {
  if (typeof customElements === 'undefined') {
    throw new Error('<inneragent-chat> requires a browser environment with customElements')
  }
  if (!customElements.get(tagName)) {
    customElements.define(tagName, InnerAgentChatElement)
  }
}

export { InnerAgentChat as InnerAgentChatComponent }
export { setIaLocale, type IaLocale } from './i18n'
export {
  setAssistantReferenceProjectsProvider,
  resetAssistantReferenceCaches,
} from './assistant/assistantReferences'

// ---- 契约入口 re-export (宿主单脚本接入: init + 页面上下文, 免装 core) ----
export {
  init,
  resetSdkConfig,
  applyTheme,
  setRunContext,
  clearRunContext,
  setAssistantPageContext,
  clearAssistantPageContext,
  setAssistantToolDisplayNames,
  setSubAgentToolNames,
  setAssistantEventHooks,
  IA_THEME_TOKENS,
} from '@inneragent/sdk-core'

// ---- [new] P4/W15 配置视图 headless API (用户级 Skill/MCP; WC view="config" 消费同源) ----
export {
  mcpUserServersApi,
  meApi,
  getAssistantReferenceOptions,
  type McpUserServer,
  type McpUserServerSaveReq,
  type AssistantReferenceOptions,
  type AssistantSkillReferenceOption,
  type AssistantMcpToolReferenceOption,
} from '@inneragent/sdk-core'
