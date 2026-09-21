/**
 * [new] 被嵌页自包含产物入口 (dist/iframe-child.js)。
 *
 * 与 src/index.ts 的差异: 显式引入 child 侧依赖图 (sdk-core + sdk-components
 * 的 <inneragent-chat>), 让构建把 vue/pinia (runtime-only) 一并内联 —— 被嵌页
 * 单个 <script type="module" src=".../iframe-child.js"> 即可, 无需 import map。
 * 宿主侧产物入口是 src/host.ts (零框架依赖)。
 */
export * from './child'
export {
  IA_BRIDGE_NAMESPACE,
  IA_BRIDGE_VERSION,
  createMessage,
  createNonce,
  isBridgeEnvelope,
} from './protocol'
export { windowTransport, createMemoryTransportPair } from './transport'
export { createIframeEmbed } from './host'
