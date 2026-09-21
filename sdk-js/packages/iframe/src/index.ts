/**
 * @inneragent/sdk-iframe — InnerAgent SDK iframe 模式 (P4/W15)。
 *
 * 宿主页: createIframeEmbed({ src, appKey, tokenGetter, ... })
 * 被嵌页: mountIframeAgent({ allowedParentOrigins, ... })
 *
 * 协议与安全决策见 ./protocol.ts 头注释 (token 只走 postMessage `token`
 * 消息; origin allowlist; nonce+ack; 严格 CSP 可用)。
 */
export {
  IA_BRIDGE_NAMESPACE,
  IA_BRIDGE_VERSION,
  createMessage,
  createNonce,
  isBridgeEnvelope,
  type BridgeMessageType,
  type BridgeEnvelope,
  type BridgeHelloPayload,
  type BridgeReadyPayload,
  type BridgeTokenPayload,
  type BridgeTokenRequestPayload,
  type BridgeContextPayload,
  type BridgeThemePayload,
  type BridgeEventPayload,
} from './protocol'
export {
  windowTransport,
  createMemoryTransportPair,
  type BridgeTransport,
  type BridgeIncomingMessage,
  type MemoryTransportPair,
} from './transport'
export {
  createIframeEmbed,
  type IframeEmbed,
  type IframeEmbedOptions,
} from './host'
export {
  mountIframeAgent,
  __resetIframeAgentForTests,
  type IframeAgentHandle,
  type MountIframeAgentOptions,
} from './child'
