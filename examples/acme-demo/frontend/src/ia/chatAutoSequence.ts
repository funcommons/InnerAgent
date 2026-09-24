/**
 * vendor SDK 内置对话框的「自动填 + 自动送」执行器(2026-09-24 §A1 一键演示)。
 *
 * 背景:
 * - <inneragent-chat> 是 vendor 产物(SDK),host 不修改 SDK 内部,只能经 DOM 操控
 * - SDK 加载 + 内部组件挂载是异步的;典型需等 1.5–2.5s 才出现 textarea
 * - SDK 通常用受控组件(value prop),直接 textarea.value = 'xxx' 不触发 onChange,
 *   需经原型 setter 调 + 派 input 事件(Vue/React 通用做法)
 * - 「发送」按钮的文案按 locale 不同(中文「发送」、英文「Send」),按文本匹配
 *
 * 设计取舍:
 * - 把「找 textarea / 找按钮 / 写入 / 点击」封成纯函数:可单测、无 Vue 依赖
 * - 任何一步失败都返回带 detail 的结果,不抛错——主流程(挂载态)由上层保证不破
 * - 等待用轮询而非单一 setTimeout——SDK 渲染时间因网速/资源/语言差异较大
 */
export interface ChatAutoSequenceOptions {
  /** 要写入输入框的文本 */
  text: string
  /** 是否在写入后自动点发送;为 false 则只填不送(预填模式) */
  autoSend: boolean
  /** 聊天容器选择器(WC 是 <inneragent-chat data-testid="ia-chat">) */
  chatSelector: string
  /** 发送按钮的本地化文案(默认「发送」;en-US 可传「Send」) */
  sendButtonText?: string
  /** 单次轮询最大等待时长(覆盖 SDK 异步渲染时间,默认 5000ms) */
  maxWaitMs?: number
}

export interface ChatAutoSequenceResult {
  /** 是否成功把 text 写到 textarea */
  filled: boolean
  /** 是否成功点发送(autoSend=false 时总是 false) */
  sent: boolean
  /** 详细结果,落日志用 */
  detail: string
  /** 写入的文本前 30 字(success 时) */
  text?: string
}

/** 延时辅助:可被测试桩替换 */
const defaultDelay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 用原型 setter 写 textarea 值并派 input 事件(让 SDK 的受控组件感知)。
 * - SDK 监听 'input' / 'change' 事件(Vue v-model / React onChange)同步内部 state
 * - 直接 textarea.value = text 在 React 受控组件里会被下次 render 覆盖
 */
function fillTextarea(textarea: HTMLTextAreaElement, text: string): void {
  const proto = Object.getPrototypeOf(textarea) as HTMLTextAreaElement
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) {
    setter.call(textarea, text)
  } else {
    textarea.value = text
  }
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

/**
 * 在 chat 容器下找发送按钮:按 aria-label / 文本「发送」「Send」匹配,
 * 排除非发送类按钮(如「停止」「重新生成」)。
 */
function findSendButton(chatEl: Element, expectedText: string): HTMLButtonElement | null {
  const candidates = Array.from(chatEl.querySelectorAll('button'))
  for (const btn of candidates) {
    if (btn.disabled) continue
    const ariaLabel = btn.getAttribute('aria-label') ?? ''
    const text = (btn.textContent ?? '').trim()
    if (ariaLabel.includes(expectedText) || text.includes(expectedText)) {
      return btn
    }
  }
  return null
}

/**
 * 一键演示自动序列入口。
 *
 * 步骤:
 * 1. 轮询 chatSelector 内是否出现 textarea(SDK 异步渲染,默认最多 5s)
 * 2. 写入 text + 派 input/change 事件
 * 3. 若 autoSend:轮询找发送按钮(等 SDK 内部状态同步,通常紧跟其后)→ click
 *
 * 返回结果而非抛错:vendor SDK 不可控,失败不能连累主流程。
 */
export async function runChatAutoSequence(
  opts: ChatAutoSequenceOptions,
  delay: (ms: number) => Promise<void> = defaultDelay,
): Promise<ChatAutoSequenceResult> {
  const { text, autoSend, chatSelector, sendButtonText = '发送', maxWaitMs = 5000 } = opts
  const t0 = Date.now()

  // 1. 轮询等 textarea
  let chatEl: Element | null = null
  let textarea: HTMLTextAreaElement | null = null
  while (Date.now() - t0 < maxWaitMs) {
    chatEl = document.querySelector(chatSelector)
    const candidate = chatEl?.querySelector('textarea') as HTMLTextAreaElement | null
    if (candidate) {
      chatEl = chatEl
      textarea = candidate
      break
    }
    await delay(150)
  }
  if (!textarea || !chatEl) {
    return {
      filled: false,
      sent: false,
      detail: `${maxWaitMs}ms 内未找到 ${chatSelector} 内的 textarea(SDK 未渲染?)`,
    }
  }

  // 2. 写入
  fillTextarea(textarea, text)

  // 3. 自动送(demoMode=guided 才有;预填模式只填不送)
  if (!autoSend) {
    return {
      filled: true,
      sent: false,
      detail: `已预填 ${text.length} 字符(未自动送)`,
      text: text.slice(0, 30),
    }
  }

  // 等 SDK 内部 input 同步(组件可能需要重新 render 把「发送」按钮 enable)
  await delay(300)
  const sendBtn = findSendButton(chatEl, sendButtonText)
  if (!sendBtn) {
    return {
      filled: true,
      sent: false,
      detail: `已预填但未找到「${sendButtonText}」按钮`,
      text: text.slice(0, 30),
    }
  }
  sendBtn.click()
  return {
    filled: true,
    sent: true,
    detail: `已自动送(找按钮 ${Date.now() - t0}ms)`,
    text: text.slice(0, 30),
  }
}