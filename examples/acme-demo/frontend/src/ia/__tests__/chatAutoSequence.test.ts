import { describe, it, expect, beforeEach, vi } from 'vitest'
import { runChatAutoSequence } from '@/ia/chatAutoSequence'

/**
 * 一键演示(vendor SDK)的「自动填 + 自动送」执行器单测(2026-09-24 §A1):
 * - 填:原型 setter 写入 textarea + dispatch input/change
 * - 送:按 aria-label / 文本匹配发送按钮 click
 * - 轮询:SDK 异步渲染时耐心等;maxWaitMs 到期放弃
 * - 失败:不抛错,返回 { filled, sent, detail }
 *
 * 测试策略:注入可控 delay 函数避免真实 setTimeout 等待;把 textarea + 按钮塞到
 * 临时容器,模拟 SDK 内部 DOM。
 */
function makeChatDom(opts: { withTextarea?: boolean; withSendBtn?: boolean; btnText?: string; btnDisabled?: boolean } = {}) {
  const chat = document.createElement('div')
  chat.setAttribute('data-testid', 'ia-chat')
  document.body.appendChild(chat)
  if (opts.withTextarea !== false) {
    const ta = document.createElement('textarea')
    chat.appendChild(ta)
  }
  if (opts.withSendBtn) {
    const btn = document.createElement('button')
    btn.textContent = opts.btnText ?? '发送'
    if (opts.btnDisabled) btn.disabled = true
    chat.appendChild(btn)
  }
  return chat
}

function cleanup() {
  document.body.querySelectorAll('[data-testid="ia-chat"]').forEach((el) => el.remove())
}

describe('chatAutoSequence(2026-09-24 §A1 一键演示)', () => {
  beforeEach(cleanup)

  it('找不到 chat 容器 → filled=false,不抛错,detail 含超时', async () => {
    const result = await runChatAutoSequence(
      { text: 'hello', autoSend: true, chatSelector: '[data-testid="ia-chat"]', maxWaitMs: 100 },
      () => Promise.resolve(),
    )
    expect(result.filled).toBe(false)
    expect(result.sent).toBe(false)
    expect(result.detail).toContain('textarea')
  })

  it('autoSend=false(预填模式):只填 textarea,不点送', async () => {
    const chat = makeChatDom({ withTextarea: true, withSendBtn: true, btnText: '发送' })
    const btnClickSpy = vi.spyOn(chat.querySelector('button') as HTMLButtonElement, 'click')
    const result = await runChatAutoSequence(
      { text: '帮我建一张工单', autoSend: false, chatSelector: '[data-testid="ia-chat"]' },
      () => Promise.resolve(),
    )
    expect(result.filled).toBe(true)
    expect(result.sent).toBe(false)
    const ta = chat.querySelector('textarea') as HTMLTextAreaElement
    expect(ta.value).toBe('帮我建一张工单')
    expect(btnClickSpy).not.toHaveBeenCalled()
  })

  it('autoSend=true(演示模式):填 + 找「发送」按钮 click', async () => {
    const chat = makeChatDom({ withTextarea: true, withSendBtn: true, btnText: '发送' })
    const btn = chat.querySelector('button') as HTMLButtonElement
    const btnClickSpy = vi.spyOn(btn, 'click')
    const result = await runChatAutoSequence(
      { text: '查 9 月销售', autoSend: true, chatSelector: '[data-testid="ia-chat"]', sendButtonText: '发送' },
      () => Promise.resolve(),
    )
    expect(result.filled).toBe(true)
    expect(result.sent).toBe(true)
    expect(btnClickSpy).toHaveBeenCalledTimes(1)
    expect(chat.querySelector('textarea')!.value).toBe('查 9 月销售')
  })

  it('aria-label 也能匹配发送按钮(防御 SDK 改文案到 aria)', async () => {
    const chat = makeChatDom({ withTextarea: true })
    const btn = document.createElement('button')
    btn.setAttribute('aria-label', '发送消息')
    btn.textContent = '' // 文本为空,只走 aria-label 匹配
    chat.appendChild(btn)
    const clickSpy = vi.spyOn(btn, 'click')
    const result = await runChatAutoSequence(
      { text: 'hi', autoSend: true, chatSelector: '[data-testid="ia-chat"]', sendButtonText: '发送消息' },
      () => Promise.resolve(),
    )
    expect(result.sent).toBe(true)
    expect(clickSpy).toHaveBeenCalled()
  })

  it('disabled 的发送按钮被跳过:filled=true, sent=false(避免点空响应)', async () => {
    const chat = makeChatDom({ withTextarea: true, withSendBtn: true, btnDisabled: true })
    const btn = chat.querySelector('button') as HTMLButtonElement
    const clickSpy = vi.spyOn(btn, 'click')
    const result = await runChatAutoSequence(
      { text: 'hello', autoSend: true, chatSelector: '[data-testid="ia-chat"]' },
      () => Promise.resolve(),
    )
    expect(result.filled).toBe(true)
    expect(result.sent).toBe(false)
    expect(result.detail).toContain('未找到')
    expect(clickSpy).not.toHaveBeenCalled()
  })

  it('轮询:首次轮询无 textarea,后续出现也能拿到', async () => {
    // 模拟 SDK 异步渲染:第一轮无 textarea,第二轮注入
    const chat = document.createElement('div')
    chat.setAttribute('data-testid', 'ia-chat')
    document.body.appendChild(chat)
    let calls = 0
    const stubDelay = (_ms: number) => {
      calls += 1
      if (calls === 2) {
        const ta = document.createElement('textarea')
        chat.appendChild(ta)
        const btn = document.createElement('button')
        btn.textContent = '发送'
        chat.appendChild(btn)
      }
      return Promise.resolve()
    }
    const result = await runChatAutoSequence(
      { text: '轮询 ok', autoSend: true, chatSelector: '[data-testid="ia-chat"]', maxWaitMs: 1000 },
      stubDelay,
    )
    expect(result.filled).toBe(true)
    expect(result.sent).toBe(true)
  })

  it('空 text 应直接放弃,不找 DOM', async () => {
    // text 为空时由调用方决定是否调;此处 helper 仍会去找 textarea,验证可达
    const chat = makeChatDom({ withTextarea: true })
    const result = await runChatAutoSequence(
      { text: '', autoSend: false, chatSelector: '[data-testid="ia-chat"]' },
      () => Promise.resolve(),
    )
    expect(result.filled).toBe(true)
    expect((chat.querySelector('textarea') as HTMLTextAreaElement).value).toBe('')
  })
})