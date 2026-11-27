<script lang="ts" setup>
import type { RecipeItem } from '~/types'
import dayjs from 'dayjs'
import { confirmDestructive, promptText, showAlert } from '~/utils/dialog'
import { yunleHaptic } from '~/utils/yunleHost'

definePageMeta({
  layout: 'child',
  title: '投稿审核',
})

interface SubmissionRow {
  id: number
  status: 'pending' | 'approved' | 'rejected' | 'revoked'
  submittedBy: number | null
  submittedByName: string | null
  submittedAt: number
  reviewedAt: number | null
  reviewNote: string
  publishedRecipeId: number | null
  recipe: RecipeItem
}

const { user } = useAccount()
const router = useRouter()

const rows = shallowRef<SubmissionRow[]>([])
const loading = ref(true)
const error = ref('')
const working = ref<number | null>(null)
const onlyPending = ref(true)

const visible = computed(() => onlyPending.value ? rows.value.filter(row => row.status === 'pending') : rows.value)
const pendingCount = computed(() => rows.value.filter(row => row.status === 'pending').length)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch('/api/admin/recipe-submissions', { credentials: 'same-origin' })
    if (response.status === 403) {
      router.replace('/my')
      return
    }
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    rows.value = (await response.json()).submissions ?? []
  }
  catch {
    error.value = '没能读取投稿列表，请稍后重试。'
  }
  finally {
    loading.value = false
  }
}

async function approve(row: SubmissionRow): Promise<void> {
  const ok = await confirmDestructive({
    header: `发布《${row.recipe.name}》？`,
    message: '发布后所有用户都能在菜谱库里看到这道菜',
    confirmText: '发布',
  })
  if (!ok)
    return
  working.value = row.id
  try {
    const response = await fetch(`/api/admin/recipe-submissions/${row.id}/approve`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok)
      throw new Error(body?.error || `发布失败（${response.status}）`)
    void yunleHaptic('success')
    await showAlert('已发布', `这道菜已收录，编号 #${body.submission?.publishedRecipeId ?? ''}。`)
    await load()
  }
  catch (failure) {
    await showAlert('发布失败', failure instanceof Error ? failure.message : '请稍后重试。')
  }
  finally {
    working.value = null
  }
}

async function reject(row: SubmissionRow): Promise<void> {
  const reason = await promptText({
    header: '驳回投稿',
    message: '写下需要修改的地方，投稿人能看到',
    placeholder: '例如：食材请用收录词典里的名字',
    okText: '驳回',
  })
  if (reason === undefined)
    return
  if (!reason.trim()) {
    await showAlert('需要填写原因', '驳回时请写明原因。')
    return
  }
  working.value = row.id
  try {
    const response = await fetch(`/api/admin/recipe-submissions/${row.id}/reject`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviewNote: reason.trim() }),
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body?.error || `驳回失败（${response.status}）`)
    }
    void yunleHaptic('medium')
    await load()
  }
  catch (failure) {
    await showAlert('驳回失败', failure instanceof Error ? failure.message : '请稍后重试。')
  }
  finally {
    working.value = null
  }
}

function statusText(row: SubmissionRow): string {
  if (row.status === 'approved')
    return row.publishedRecipeId ? `已发布 #${row.publishedRecipeId}` : '已发布'
  if (row.status === 'rejected')
    return `已驳回：${row.reviewNote || '未写明原因'}`
  if (row.status === 'revoked')
    return '已撤回'
  return '待审核'
}

onMounted(() => {
  if (user.value?.role !== 'admin') {
    router.replace('/my')
    return
  }
  void load()
})
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/my" />
        </ion-buttons>
        <ion-title>投稿审核</ion-title>
      </ion-toolbar>
      <ion-toolbar>
        <ion-segment :value="onlyPending ? 'pending' : 'all'" @ion-change="onlyPending = ($event as CustomEvent).detail.value === 'pending'">
          <ion-segment-button value="pending">
            <ion-label>待审核 {{ pendingCount }}</ion-label>
          </ion-segment-button>
          <ion-segment-button value="all">
            <ion-label>全部</ion-label>
          </ion-segment-button>
        </ion-segment>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <p v-if="loading" class="submissions-note">
        正在加载…
      </p>
      <p v-else-if="error" class="submissions-error" role="alert">
        {{ error }}
      </p>
      <p v-else-if="!visible.length" class="submissions-note">
        {{ onlyPending ? '没有待审核的投稿。' : '还没有任何投稿。' }}
      </p>

      <ul v-else class="submissions-list">
        <li v-for="row in visible" :key="row.id" class="submission-card">
          <header class="submission-head">
            <h2>{{ row.recipe.name }}</h2>
            <span class="submission-status" :class="`is-${row.status}`">{{ statusText(row) }}</span>
          </header>
          <p class="submission-meta">
            {{ row.submittedByName || '已注销账号' }} · {{ dayjs(row.submittedAt).format('YYYY-MM-DD HH:mm') }}
          </p>

          <dl class="submission-body">
            <dt>食材</dt>
            <dd>{{ row.recipe.stuff.join('、') }}</dd>
            <template v-if="row.recipe.tools?.length">
              <dt>厨具</dt>
              <dd>{{ row.recipe.tools.join('、') }}</dd>
            </template>
            <template v-if="row.recipe.note">
              <dt>步骤</dt>
              <dd class="submission-note">
                {{ row.recipe.note }}
              </dd>
            </template>
          </dl>

          <div v-if="row.status === 'pending'" class="submission-actions">
            <button
              type="button"
              class="cook-btn cook-btn--secondary cook-btn--sm"
              :disabled="working === row.id"
              @click="reject(row)"
            >
              驳回
            </button>
            <button
              type="button"
              class="cook-btn cook-btn--primary cook-btn--sm"
              :disabled="working === row.id"
              :aria-busy="working === row.id"
              @click="approve(row)"
            >
              发布
            </button>
          </div>
        </li>
      </ul>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.submissions-note,
.submissions-error {
  margin: 20px;
  color: var(--c-ink-3);
  font-size: var(--fs-base);
}
.submissions-error {
  color: var(--c-alert);
}
.submissions-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 16px;
  list-style: none;
}
.submission-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-surface);
}
.submission-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  justify-content: space-between;
}
.submission-head h2 {
  margin: 0;
  color: var(--c-ink);
  font-size: var(--fs-md);
}
.submission-status {
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
}
.submission-status.is-pending {
  color: var(--c-warn);
}
.submission-status.is-approved {
  color: var(--c-herb);
}
.submission-status.is-rejected,
.submission-status.is-revoked {
  color: var(--c-alert);
}
.submission-meta {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
}
.submission-body {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 10px;
  margin: 0;
  font-size: var(--fs-sm);
}
.submission-body dt {
  color: var(--c-ink-3);
}
.submission-body dd {
  margin: 0;
  color: var(--c-ink-2);
  overflow-wrap: anywhere;
}
.submission-note {
  white-space: pre-wrap;
}
.submission-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 4px;
}
</style>
