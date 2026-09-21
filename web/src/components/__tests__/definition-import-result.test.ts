/**
 * [new] 定义导入结果表测试(P2-W5):计数四件套 + dryRun 预演标注 +
 * 条目级错误表(agentType null 兜底「解析失败」)。
 */
import { describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import DefinitionImportResult from '../DefinitionImportResult.vue'
import type { DefinitionImportResult as DefinitionImportResultModel } from '@/api/types'

async function mountResult(result: DefinitionImportResultModel) {
  const wrapper = mount(DefinitionImportResult, {
    props: { result },
    global: { plugins: [ElementPlus] },
  })
  // el-table 单元格经内部布局流程渲染:flush 后断言
  await flushPromises()
  return wrapper
}

describe('DefinitionImportResult 定义导入结果表', () => {
  it('计数四件套(created/updated/skipped/errors)与 dryRun 预演标注', async () => {
    const wrapper = await mountResult({
      dryRun: true, created: 2, updated: 1, skipped: 3,
      errors: [{ agentType: 'bad', reason: '未知提示词槽位' }],
    })
    expect(wrapper.text()).toContain('预演(dryRun,零副作用)')
    expect(wrapper.text()).toContain('有效条目 6 条')
    const counts = wrapper.findAll('.count__num').map(n => n.text())
    expect(counts).toEqual(['2', '1', '3', '1'])
    expect(wrapper.text()).toContain('新建')
    expect(wrapper.text()).toContain('覆盖更新')
    expect(wrapper.text()).toContain('冲突跳过')
    expect(wrapper.text()).toContain('条目错误')
  })

  it('正式导入标注「导入完成」;错误表渲染 agentType/reason', async () => {
    const wrapper = await mountResult({
      dryRun: false, created: 1, updated: 0, skipped: 0,
      errors: [
        { agentType: 'bad_entry', reason: 'name 不能为空: bad_entry' },
        { agentType: null, reason: '定义条目必须为 JSON 对象' },
      ],
    })
    expect(wrapper.text()).toContain('导入完成')
    const rows = wrapper.findAll('.el-table__row')
    expect(rows).toHaveLength(2)
    expect(wrapper.text()).toContain('bad_entry')
    expect(wrapper.text()).toContain('name 不能为空: bad_entry')
    // agentType null → 兜底展示(不静默吞)
    expect(wrapper.text()).toContain('(解析失败,无法回显)')
  })

  it('无错误时不渲染错误表,给明确口径文案', async () => {
    const wrapper = await mountResult({ dryRun: false, created: 0, updated: 2, skipped: 1, errors: [] })
    expect(wrapper.findAll('.el-table__row')).toHaveLength(0)
    expect(wrapper.text()).toContain('无条目级错误')
  })
})
