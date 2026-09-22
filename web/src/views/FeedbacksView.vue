<script setup lang="ts">
/**
 * [new] 用户反馈视图(W15,视图清单 #12;AdminFeedbackController)。
 * 列表(rating 图标 👍/👎 + 会话/运行/消息维度锚点 + comment + 时间)+
 * 过滤(rating/时间区间)+ 北极星卡片(好评率=👍÷(👍+👎);带反馈完成率代理=
 * COMPLETED÷(COMPLETED+FAILED),CANCELLED 单列观察;口径见
 * AdminUsageController swagger 注释/docs 灰度与指标大盘 B4)。
 */
import { computed, onMounted, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import IaEmpty from '@/components/IaEmpty.vue'
import IaListPage from '@/components/IaListPage.vue'
import IaPageContainer from '@/components/IaPageContainer.vue'
import IaPagination from '@/components/IaPagination.vue'
import IaTime from '@/components/IaTime.vue'
import { useFeedbacksStore } from '@/stores/feedbacks'
import { useAppContextStore } from '@/stores/appContext'
import type { IaFeedback } from '@/api/types'

const store = useFeedbacksStore()
const appContext = useAppContextStore()

onMounted(() => {
  void store.load()
  void store.loadNorthStar()
})

/** 顶栏应用上下文切换 → 重置分页并按新应用重查列表与北极星卡 */
watch(() => appContext.currentAppId, () => {
  store.search()
  void store.loadNorthStar()
})

/** 比率百分比(null=窗口无样本不出数,不虚报) */
function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

const northStar = computed(() => store.northStar)

/** 维度锚点(会话/运行/消息;空值折叠为 —) */
function anchors(row: IaFeedback): Array<{ label: string; value: string | null }> {
  return [
    { label: '会话', value: row.conversationId },
    { label: '运行', value: row.runId },
    { label: '消息', value: row.messageId },
  ]
}

function refreshAll() {
  void store.search()
  void store.loadNorthStar()
}
</script>

<template>
  <IaPageContainer subtitle="宿主用户反馈明细:重复反馈按覆盖计(展示最近覆盖时间);管理面跨用户视图">
    <template #action>
      <el-button :icon="Refresh" @click="refreshAll">查询</el-button>
    </template>

    <!-- 北极星卡片(口径:docs/灰度与指标大盘 B4) -->
    <div class="ns-cards">
      <el-card shadow="never" class="ns-card">
        <div class="ns-card__label">好评率</div>
        <div class="ns-card__num" data-testid="ns-positive">{{ pct(northStar?.positiveRate ?? null) }}</div>
        <div class="ns-card__foot dim">👍 {{ northStar?.thumbsUp ?? 0 }} ÷(👍+👎 {{ northStar?.thumbsDown ?? 0 }}),窗口内全部反馈</div>
      </el-card>
      <el-card shadow="never" class="ns-card">
        <div class="ns-card__label">带反馈完成率(代理)</div>
        <div class="ns-card__num" data-testid="ns-completion">{{ pct(northStar?.feedbackLinkedCompletionRate ?? null) }}</div>
        <div class="ns-card__foot dim">
          仅带反馈的根运行:完成 {{ northStar?.feedbackLinkedCompletedRuns ?? 0 }} /
          失败 {{ northStar?.feedbackLinkedFailedRuns ?? 0 }} /
          取消(单列观察){{ northStar?.feedbackLinkedCancelledRuns ?? 0 }}
        </div>
      </el-card>
      <el-card shadow="never" class="ns-card">
        <div class="ns-card__label">口径说明</div>
        <div class="ns-card__note dim">
          好评率 = 👍 ÷ (👍+👎);带反馈完成率为任务完成率的反馈质量佐证(B4),
          窗口无样本时不出数(null),不虚报。时间按反馈 create_time。
        </div>
      </el-card>
    </div>

    <IaListPage :loading="store.loading">
      <template #filters>
        <div class="toolbar">
          <el-select v-model="store.filters.rating" class="toolbar__rating" placeholder="评分" clearable @change="refreshAll">
            <el-option label="👍 好评(UP)" value="UP" />
            <el-option label="👎 差评(DOWN)" value="DOWN" />
          </el-select>
          <el-date-picker
            v-model="store.filters.from"
            type="datetime"
            placeholder="起始时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="toolbar__date"
            @change="refreshAll"
          />
          <el-date-picker
            v-model="store.filters.to"
            type="datetime"
            placeholder="结束时间"
            value-format="YYYY-MM-DDTHH:mm:ss"
            class="toolbar__date"
            @change="refreshAll"
          />
          <span class="dim">rating 过滤仅支持 UP/DOWN;数据范围随顶栏应用上下文</span>
        </div>
      </template>

      <el-table :data="store.list" row-key="id">
        <template #empty>
          <IaEmpty description="窗口内没有用户反馈" hint="用户在宿主对话中点 👍/👎 后,明细会汇总到这里">
            <template #action>
              <el-button :icon="Refresh" @click="refreshAll">重新查询</el-button>
            </template>
          </IaEmpty>
        </template>
        <el-table-column label="评分" width="72">
          <template #default="{ row }">
            <span class="rating" :class="row.rating === 'UP' ? 'rating--up' : 'rating--down'">
              {{ row.rating === 'UP' ? '👍' : '👎' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column prop="userId" label="用户" width="90">
          <template #default="{ row }">{{ row.userId ?? '—' }}</template>
        </el-table-column>
        <el-table-column prop="comment" label="评论" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.comment ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="维度锚点" min-width="230">
          <template #default="{ row }">
            <div class="anchors">
              <span v-for="a in anchors(row)" :key="a.label" class="anchor">
                <span class="anchor__label dim">{{ a.label }}</span>
                <span class="mono" :title="a.value ?? ''">{{ a.value ?? '—' }}</span>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="首次反馈" min-width="110">
          <template #default="{ row }"><IaTime :value="row.createTime" /></template>
        </el-table-column>
        <el-table-column label="最近覆盖" min-width="110">
          <template #default="{ row }"><IaTime :value="row.updateTime" /></template>
        </el-table-column>
      </el-table>
      <IaPagination
        v-model:page="store.filters.pageNo"
        v-model:size="store.filters.pageSize"
        :total="store.total"
        @page-change="store.load()"
        @size-change="store.load()"
      />
    </IaListPage>
  </IaPageContainer>
</template>

<style scoped>
.ns-cards { display: grid; grid-template-columns: 1fr 1.3fr 1.2fr; gap: 12px; }
.ns-card__label { color: #909399; font-size: 12px; }
.ns-card__num { font-size: 26px; font-weight: 600; margin: 6px 0 2px; font-variant-numeric: tabular-nums; }
.ns-card__foot { font-size: 12px; line-height: 1.5; }
.ns-card__note { font-size: 12px; line-height: 1.6; }
.dim { color: #909399; font-size: 12px; }
.toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.toolbar__rating { width: 150px; }
.toolbar__date { width: 180px; }
.rating { font-size: 16px; }
.anchors { display: flex; flex-direction: column; gap: 2px; }
.anchor { display: flex; gap: 6px; align-items: baseline; }
.anchor__label { flex: none; width: 28px; }
.mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
</style>
