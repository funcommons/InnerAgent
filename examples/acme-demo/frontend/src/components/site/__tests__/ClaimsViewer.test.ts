import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ClaimsViewer from '@/components/site/ClaimsViewer.vue'
import { decodeJwt } from '@/site/jwt'

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('ClaimsViewer(claims 可视化,jwt.io 式)', () => {
  const token = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({
    iss: 'acme-demo', sub: '10086', iat: 1700000000, exp: 1700036000,
  })}.signature-part`

  const decoded = decodeJwt(token)

  function mountViewer() {
    return mount(ClaimsViewer, { props: { decoded, parts: token.split('.') } })
  }

  it('三段分色原文条:header/payload/signature 各一段', () => {
    const w = mountViewer()
    expect(w.find('[data-testid="claims-raw"]').exists()).toBe(true)
    expect(w.find('.claims-raw__seg.is-header').text()).toContain(b64url({ alg: 'RS256', typ: 'JWT' }).slice(0, 6))
    expect(w.find('.claims-raw__seg.is-payload').exists()).toBe(true)
    expect(w.find('.claims-raw__seg.is-signature').text()).toContain('signature-part')
    w.unmount()
  })

  it('header/payload claims 表:键值与行数一致,iss/sub 在列', () => {
    const w = mountViewer()
    const headerTable = w.find('[data-testid="claims-header"]')
    const payloadTable = w.find('[data-testid="claims-payload"]')
    expect(headerTable.findAll('tbody tr')).toHaveLength(2)
    expect(payloadTable.findAll('tbody tr')).toHaveLength(4)
    const payloadText = payloadTable.text()
    expect(payloadText).toContain('iss')
    expect(payloadText).toContain('acme-demo')
    expect(payloadText).toContain('sub')
    expect(payloadText).toContain('10086')
    w.unmount()
  })

  it('exp/iat 显示本地时间附注(人类可读)', () => {
    const w = mountViewer()
    const text = w.find('[data-testid="claims-payload"]').text()
    expect(text).toContain('exp')
    expect(text).toContain('1700000000(')  // iat 原值 + '(' + 本地时间
    w.unmount()
  })

  it('不传 parts 时不渲染原文条,仅 claims 表', () => {
    const w = mount(ClaimsViewer, { props: { decoded } })
    expect(w.find('[data-testid="claims-raw"]').exists()).toBe(false)
    expect(w.find('[data-testid="claims-header"]').exists()).toBe(true)
    w.unmount()
  })
})
