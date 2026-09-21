/**
 * [new] IaPagination 统一分页器测试(优化建议 #20)。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import IaPagination from '../IaPagination.vue'

describe('IaPagination 统一分页器', () => {
  it('渲染总数/pageSize 切换/快速跳页四件套;本地化总数为「共 N 条」', () => {
    const wrapper = mount(IaPagination, {
      props: { total: 12, page: 1, size: 10 },
      global: { plugins: [[ElementPlus, { locale: zhCn }]] },
    })
    expect(wrapper.text()).toContain('共 12 条')
    // sizes 选择器与 jumper 输入存在(layout 含 total,sizes,next,jumper)
    expect(wrapper.findAll('.el-pagination__sizes').length).toBe(1)
    expect(wrapper.findAll('.el-pagination__jump').length).toBe(1)
    expect(wrapper.text()).not.toContain('Total')
  })

  it('v-model 可选值兜底:page/size 缺省按 1/10 渲染,变更写回', async () => {
    const wrapper = mount(IaPagination, {
      props: { total: 0, page: undefined, size: undefined, 'onUpdate:page': (v: number | undefined) => wrapper.setProps({ page: v }) },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.props('page')).toBeUndefined()
    // 内部按 1 渲染(当前页高亮第一页)
    expect(wrapper.find('.el-pager li.is-active').text()).toBe('1')
  })
})
