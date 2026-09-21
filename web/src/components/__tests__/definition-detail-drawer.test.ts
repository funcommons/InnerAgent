/**
 * [new] 定义详情抽屉测试(P2-W5):三槽只读展示 + 按 slot 分编辑入口 +
 * systemPrompt 空白客户端拦截 + 保存走 PUT 并刷新(审计文案透出)。
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import DefinitionDetailDrawer from '../DefinitionDetailDrawer.vue'
import { setAdminKeyGetter } from '@/api/request'

async function mountDrawer(definitionId: number) {
  setActivePinia(createPinia())
  const wrapper = mount(DefinitionDetailDrawer, {
    props: { definitionId, visible: false },
    global: { plugins: [ElementPlus] },
  })
  // el-drawer 首开才渲染 body:显式触发 visible 变更(与真实交互一致)
  await wrapper.setProps({ visible: true })
  await flushPromises()
  await flushPromises()
  return wrapper
}

describe('DefinitionDetailDrawer 定义详情抽屉(提示词三槽)', () => {
  beforeEach(() => setAdminKeyGetter(() => 'k'))

  it('回显三槽与规格 spec;三槽各自有「编辑」入口', async () => {
    const wrapper = await mountDrawer(82)
    expect(wrapper.text()).toContain('demo')
    expect(wrapper.text()).toContain('系统提示词(systemPrompt)')
    expect(wrapper.text()).toContain('指令模板(instructionTemplate)')
    expect(wrapper.text()).toContain('问候语(greeting)')
    expect(wrapper.text()).toContain('演示助手,负责演示工具调用与确认流')
    // spec 摘要(与 bundle specJson 同构)
    expect(wrapper.text()).toContain('toolWhitelist')
    expect(wrapper.text()).toContain('get_user, update_user')
    const editButtons = wrapper.findAll('button').filter(b => b.text().includes('编辑'))
    expect(editButtons.length).toBe(3) // 按 slot 分入口
    // 审计留痕文案
    expect(wrapper.text()).toContain('definition-updated')
    wrapper.unmount()
  })

  it('未配置槽位显示占位;编辑 greeting 保存 → PUT 落库并回显新值', async () => {
    const wrapper = await mountDrawer(81) // ai_media:instructionTemplate 未配置
    expect(wrapper.text()).toContain('(未配置)')
    const editButtons = wrapper.findAll('button').filter(b => b.text().includes('编辑'))
    await editButtons[2]!.trigger('click') // greeting
    await flushPromises()
    const textarea = wrapper.find('textarea')
    expect(textarea.exists()).toBe(true)
    await textarea.setValue('你好呀,我是默认助手')
    const saveBtn = wrapper.findAll('button').find(b => b.text().includes('保存'))
    await saveBtn!.trigger('click')
    await flushPromises()
    await flushPromises()
    // 保存后回读行:新问候语已回显,编辑态退出
    expect(wrapper.text()).toContain('你好呀,我是默认助手')
    expect(wrapper.find('textarea').exists()).toBe(false)
    wrapper.unmount()
  })

  it('systemPrompt 清空保存被客户端拦截(服务端同口径:非空白强制)', async () => {
    const wrapper = await mountDrawer(83)
    const editButtons = wrapper.findAll('button').filter(b => b.text().includes('编辑'))
    await editButtons[0]!.trigger('click') // systemPrompt
    await flushPromises()
    await wrapper.find('textarea').setValue('   ')
    const saveBtn = wrapper.findAll('button').find(b => b.text().includes('保存'))
    await saveBtn!.trigger('click')
    await flushPromises()
    // 仍处编辑态(未保存成功)
    expect(wrapper.find('textarea').exists()).toBe(true)
    wrapper.unmount()
  })
})
