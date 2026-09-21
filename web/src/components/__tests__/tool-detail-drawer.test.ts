/**
 * [new] 工具详情抽屉测试:体检位回显(徽标/最近体检/明细 checks 表)+
 * 「立即体检」同步结果刷新(msw:种子 id7=degraded 清单缺失;id8=指纹漂移)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import ToolDetailDrawer from '../ToolDetailDrawer.vue'
import { setAdminKeyGetter } from '@/api/request'

async function mountDrawer(toolId: number) {
  setActivePinia(createPinia())
  const wrapper = mount(ToolDetailDrawer, {
    props: { toolId, visible: false },
    global: { plugins: [ElementPlus] },
  })
  // el-drawer 首开才渲染 body:显式触发 visible 变更(与真实交互一致)
  await wrapper.setProps({ visible: true })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('ToolDetailDrawer 工具详情抽屉(V17 体检位落点)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('回显注册行字段与落库体检明细(degraded:tool_present 漂移含建议)', async () => {
    const wrapper = await mountDrawer(7)
    expect(wrapper.text()).toContain('mcp__crm__update_customer_note')
    expect(wrapper.text()).toContain('漂移') // 徽标
    expect(wrapper.text()).toContain('宿主清单') // 检查明细
    expect(wrapper.text()).toContain('宿主可能已下线') // 整改建议
    expect(wrapper.text()).toContain('最近体检')
    wrapper.unmount()
  })

  it('「立即体检」同步返回并刷新:结论徽标与 checks 表更新(ok 行)', async () => {
    const wrapper = await mountDrawer(2) // update_user 种子未体检 → 明细空态
    expect(wrapper.text()).toContain('暂无体检明细')
    const checkBtn = wrapper.findAll('button').find(b => b.text().includes('立即体检'))
    expect(checkBtn).toBeTruthy()
    await checkBtn!.trigger('click')
    await flushPromises()
    await flushPromises()
    // 同步结果即时展示:四项全过 → ok
    expect(wrapper.text()).toContain('健康')
    expect(wrapper.text()).toContain('端点可达')
    expect(wrapper.text()).toContain('schema 指纹')
    expect(wrapper.text()).toContain('注解一致')
    wrapper.unmount()
  })
})
