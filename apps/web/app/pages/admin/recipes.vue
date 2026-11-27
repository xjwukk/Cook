<script lang="ts" setup>
import type { IonSearchbarCustomEvent, SearchbarInputEventDetail } from '@ionic/core'
import type { RecipeItem } from '@yunyoujun/cook'
import type { DbRecipeItem } from '~/utils/db'
import { recipesToCsv } from '@yunyoujun/cook'
import dayjs from 'dayjs'
import { useIndexedDB } from '~/composables/db'
import { customRecipes } from '~/composables/store/customRecipe'
import { publicationOf } from '~/composables/store/recipePublications'
import {
  applyRecipeOverrides,
  hasRecipeOverride,
  removeRecipeOverride,
  setRecipeOverrides,
  upsertRecipeOverride,
} from '~/composables/useRecipeOverrides'
import { db } from '~/utils/db'
import { confirmDestructive, showAlert } from '~/utils/dialog'
import { yunleHaptic } from '~/utils/yunleHost'

definePageMeta({
  layout: 'child',
  title: '全量菜谱',
})

interface AdminOverrideRow {
  id: number
  data: RecipeItem
  updatedAt: number
  updatedBy: number | null
  updatedByName: string | null
}

const { state, user } = useAccount()
const router = useRouter()

const baseRecipes = shallowRef<DbRecipeItem[]>([])
const overridesMeta = shallowRef(new Map<number, AdminOverrideRow>())
const loading = ref(true)
const error = ref('')
const keyword = ref('')
const onlyModified = ref(false)
const limit = ref(100)
const detail = shallowRef<RecipeItem>()
const detailOpen = ref(false)
const editing = shallowRef<RecipeItem | null>(null)
const editorOpen = ref(false)
const saving = ref(false)

/** 投稿发布的菜谱 id 从这里开始，和服务端 COOK_PUBLISHED_ID_BASE 对齐。 */
const PUBLISHED_ID_BASE = 10000

/** 官方菜谱 / 我的菜谱 两种视角：新增的与改过的都能一眼找到。 */
const segment = ref<'official' | 'mine'>('official')

const effective = computed(() => applyRecipeOverrides(baseRecipes.value))
const isPublished = (recipe: RecipeItem) => typeof recipe.id === 'number' && recipe.id >= PUBLISHED_ID_BASE
/** 可以导出补丁 CSV 的只有官方菜谱的修订——发布菜谱没有 note 列，回灌 CSV 会丢步骤。 */
const modifiedCount = computed(() => effective.value.filter(recipe => hasRecipeOverride(recipe.id) && !isPublished(recipe)).length)
const publishedCount = computed(() => effective.value.filter(isPublished).length)
const filtered = computed(() => {
  const text = keyword.value.trim()
  return effective.value.filter((recipe) => {
    if (onlyModified.value && !hasRecipeOverride(recipe.id))
      return false
    if (!text)
      return true
    return recipe.name.includes(text) || recipe.stuff.some(item => item.includes(text))
  })
})
const visible = computed(() => filtered.value.slice(0, limit.value))

/** 「我的菜谱」段：客户端本地的私人菜谱 + 投稿状态。 */
const myRecipes = computed(() => [...customRecipes.value].sort((a, b) => b.updatedAt - a.updatedAt))

function publicationLabel(customId: string): { text: string, tone: string } {
  const publication = publicationOf(customId)
  if (!publication)
    return { text: '未投稿', tone: 'none' }
  if (publication.status === 'approved' && publication.publishedRecipeId != null)
    return { text: `已发布 #${publication.publishedRecipeId}`, tone: 'approved' }
  if (publication.status === 'rejected')
    return { text: `已驳回：${publication.reviewNote || '未写明原因'}`, tone: 'rejected' }
  if (publication.status === 'revoked')
    return { text: '已撤回', tone: 'rejected' }
  return { text: '待审核', tone: 'pending' }
}

watch([keyword, onlyModified], () => {
  limit.value = 100
})

async function load(): Promise<void> {
  error.value = ''
  loading.value = true
  try {
    await useIndexedDB().init()
    const [recipes, response] = await Promise.all([
      db.recipes.toArray(),
      fetch('/api/admin/recipes', { credentials: 'same-origin', cache: 'no-store' }),
    ])
    if (response.status === 401 || response.status === 403) {
      await router.replace('/my')
      return
    }
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)

    const body = await response.json() as { overrides?: AdminOverrideRow[] }
    const rows = Array.isArray(body.overrides) ? body.overrides : []
    const meta = new Map<number, AdminOverrideRow>()
    for (const row of rows) {
      if (Number.isInteger(row.id))
        meta.set(row.id, row)
    }
    overridesMeta.value = meta
    setRecipeOverrides(rows.map(row => row.data), Math.max(0, ...rows.map(row => Number(row.updatedAt) || 0)))
    baseRecipes.value = recipes
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载失败'
  }
  finally {
    loading.value = false
  }
}

watch(() => state.status, (status) => {
  if (status === 'checking')
    return
  if (status !== 'authenticated' || user.value?.role !== 'admin') {
    void router.replace('/my')
    return
  }
  void load()
}, { immediate: true })

function onInput(ev: IonSearchbarCustomEvent<SearchbarInputEventDetail>) {
  keyword.value = ev.detail.value ?? ''
}

function showDetail(recipe: RecipeItem) {
  detail.value = recipe
  detailOpen.value = true
}

function edit(recipe: RecipeItem) {
  detailOpen.value = false
  editing.value = {
    ...recipe,
    stuff: [...recipe.stuff],
    tools: [...recipe.tools],
    tags: [...(recipe.tags ?? [])],
    methods: [...(recipe.methods ?? [])],
  }
  editorOpen.value = true
}

function closeEditor() {
  editorOpen.value = false
  editing.value = null
}

async function save(recipe: RecipeItem) {
  if (typeof recipe.id !== 'number')
    return
  saving.value = true
  try {
    const response = await fetch(`/api/admin/recipes/${recipe.id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(recipe),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      await showAlert('保存失败', body?.error || '请稍后重试')
      return
    }
    const override = body?.override as AdminOverrideRow | undefined
    const saved = override?.data ?? recipe
    upsertRecipeOverride(saved, Number(override?.updatedAt) || Date.now())
    if (override) {
      const meta = new Map(overridesMeta.value)
      meta.set(recipe.id, override)
      overridesMeta.value = meta
    }
    closeEditor()
    void yunleHaptic('success')
  }
  catch {
    await showAlert('保存失败', '无法连接服务器，请检查网络后重试。')
  }
  finally {
    saving.value = false
  }
}

async function revert() {
  const recipe = editing.value
  if (!recipe || typeof recipe.id !== 'number')
    return
  if (!await confirmDestructive({
    header: `撤销对「${recipe.name}」的修改？`,
    message: '撤销后所有访客都会回到官方版本。',
    confirmText: '撤销修改',
  })) {
    return
  }
  saving.value = true
  try {
    const response = await fetch(`/api/admin/recipes/${recipe.id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      await showAlert('撤销失败', body?.error || '请稍后重试')
      return
    }
    removeRecipeOverride(recipe.id)
    const meta = new Map(overridesMeta.value)
    meta.delete(recipe.id)
    overridesMeta.value = meta
    closeEditor()
    void yunleHaptic('success')
  }
  catch {
    await showAlert('撤销失败', '无法连接服务器，请检查网络后重试。')
  }
  finally {
    saving.value = false
  }
}

async function exportPatch() {
  // 只导出官方菜谱的修订：发布菜谱的步骤在 note 里，CSV 没有这一列。
  const modified = effective.value.filter(recipe => hasRecipeOverride(recipe.id) && !isPublished(recipe))
  if (!modified.length) {
    await showAlert('没有可导出的修改', '先编辑至少一道菜谱，再导出补丁 CSV。')
    return
  }
  const withSteps = modified.filter(recipe => recipe.note?.trim())
  if (withSteps.length && !await confirmDestructive({
    header: '步骤不会进入补丁 CSV',
    message: `有 ${withSteps.length} 道菜谱的步骤改动只保存在覆盖层。补丁 CSV 只有 9 列、不含步骤；合回 recipe.csv 时需要另外同步步骤。`,
    confirmText: '仍然导出',
  })) {
    return
  }
  const csv = recipesToCsv(modified)
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `recipe-patch-${dayjs().format('YYYY-MM-DD')}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  void yunleHaptic('success')
}

function metaText(recipe: RecipeItem) {
  const meta = typeof recipe.id === 'number' ? overridesMeta.value.get(recipe.id) : undefined
  if (!meta)
    return ''
  const who = meta.updatedByName ? `${meta.updatedByName} · ` : ''
  return `${who}${dayjs(meta.updatedAt).format('YYYY-MM-DD HH:mm')}`
}
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/my" />
        </ion-buttons>
        <ion-title>全量菜谱</ion-title>
        <ion-buttons slot="end">
          <ion-button title="投稿审核" router-link="/admin/submissions">
            投稿审核
          </ion-button>
          <ion-button :disabled="!modifiedCount" title="导出补丁 CSV" @click="exportPatch">
            导出补丁
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">
            全量菜谱
          </ion-title>
        </ion-toolbar>
        <ion-toolbar>
          <ion-searchbar
            placeholder="按菜名或食材搜索"
            :debounce="150"
            show-clear-button="focus"
            @ion-input="onInput"
          />
        </ion-toolbar>
      </ion-header>

      <ion-segment v-model="segment" class="admin-recipes-segment">
        <ion-segment-button value="official">
          <ion-label>官方菜谱</ion-label>
        </ion-segment-button>
        <ion-segment-button value="mine">
          <ion-label>我的菜谱</ion-label>
        </ion-segment-button>
      </ion-segment>

      <template v-if="segment === 'official'">
        <section class="admin-recipes-toolbar" aria-label="筛选">
          <ion-toggle v-model="onlyModified" justify="space-between">
            只看已修改
          </ion-toggle>
          <p>
            共 {{ effective.length }} 道，已修订 {{ modifiedCount }} 道<template v-if="publishedCount">
              · 投稿发布 {{ publishedCount }} 道
            </template><template v-if="filtered.length !== effective.length">
              · 当前筛出 {{ filtered.length }} 道
            </template>
          </p>
        </section>
      </template>

      <p v-if="loading" class="admin-recipes-status">
        正在加载菜谱…
      </p>
      <p v-else-if="error" class="admin-recipes-status admin-recipes-error" role="alert">
        {{ error }}
      </p>

      <section v-else-if="segment === 'mine'" class="admin-my-recipes">
        <ul v-if="myRecipes.length" class="admin-my-list">
          <li v-for="recipe in myRecipes" :key="recipe.customId" class="admin-my-card">
            <div class="admin-my-head">
              <h3>{{ recipe.name }}</h3>
              <span class="admin-my-status" :class="`is-${publicationLabel(recipe.customId).tone}`">
                {{ publicationLabel(recipe.customId).text }}
              </span>
            </div>
            <p class="admin-my-meta">
              {{ recipe.stuff.join(' · ') }}
            </p>
            <div class="admin-my-actions">
              <ion-button fill="clear" size="small" router-link="/recipes/mine">
                在我的菜谱里管理
              </ion-button>
              <ion-button
                v-if="publicationLabel(recipe.customId).tone === 'none'"
                fill="clear"
                size="small"
                router-link="/recipes/mine"
              >
                去投稿
              </ion-button>
            </div>
          </li>
        </ul>
        <p v-else class="admin-recipes-status">
          还没有自己的菜谱。
        </p>
      </section>

      <ion-list v-else-if="visible.length" :inset="true">
        <ion-item
          v-for="recipe in visible"
          :key="recipe.id"
          :button="true"
          :detail="false"
          @click="showDetail(recipe)"
        >
          <ion-label class="admin-recipe-label">
            <DishLabel :dish="recipe" />
            <p>{{ recipe.stuff.join(' · ') }}</p>
          </ion-label>
          <span v-if="isPublished(recipe)" class="admin-recipe-badge is-published" title="用户投稿发布">
            投稿
          </span>
          <span v-else-if="hasRecipeOverride(recipe.id)" class="admin-recipe-badge" :title="metaText(recipe)">
            已修改
          </span>
          <ion-button slot="end" fill="clear" :aria-label="`编辑${recipe.name}`" @click.stop="edit(recipe)">
            编辑
          </ion-button>
        </ion-item>
      </ion-list>

      <div v-else class="cook-empty">
        <ion-icon :icon="ioniconsSearchOutline" />
        <h3>{{ onlyModified ? '还没有修改过的菜谱' : '没有找到相关菜谱' }}</h3>
        <p>{{ onlyModified ? '编辑任意一道菜后，它会出现在这里' : '换个关键词试试' }}</p>
      </div>

      <div v-if="!loading && !error && filtered.length > visible.length" class="admin-recipes-more">
        <ion-button fill="clear" @click="limit += 100">
          再看 {{ Math.min(100, filtered.length - visible.length) }} 道（还有 {{ filtered.length - visible.length }} 道）
        </ion-button>
      </div>

      <p class="cook-group-footer admin-recipes-footnote">
        修改立即对所有访客生效；导出补丁 CSV 后合回 recipe.csv，并通过 pnpm validate，再删除对应覆盖记录即可永久固化。步骤改动只保存在覆盖层，不会进入补丁 CSV。
      </p>
    </ion-content>

    <RecipeDetailSheet v-if="detail" v-model:open="detailOpen" :recipe="detail" />

    <AdminRecipeEditor
      :recipe="editing"
      :open="editorOpen"
      :saving="saving"
      :modified="Boolean(editing && hasRecipeOverride(editing.id))"
      @cancel="closeEditor"
      @save="save"
      @revert="revert"
    />
  </ion-page>
</template>

<style scoped>
.admin-recipes-segment {
  margin: var(--sp-3) var(--sp-4) 0;
}
.admin-my-recipes {
  padding: 0 var(--sp-4) var(--sp-6);
}
.admin-my-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.admin-my-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-surface);
}
.admin-my-head {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: baseline;
  justify-content: space-between;
}
.admin-my-head h3 {
  margin: 0;
  color: var(--c-ink);
  font-size: var(--fs-base);
}
.admin-my-status {
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
}
.admin-my-status.is-approved {
  color: var(--c-herb);
}
.admin-my-status.is-pending {
  color: var(--c-warn);
}
.admin-my-status.is-rejected {
  color: var(--c-alert);
}
.admin-my-meta {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
.admin-my-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-inline-start: -8px;
}
.admin-recipes-toolbar {
  margin: var(--sp-3) var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-ink);
}
.admin-recipes-toolbar ion-toggle {
  width: 100%;
  min-height: 44px;
}
.admin-recipes-toolbar p {
  margin-block: var(--sp-2) 0;
  color: var(--c-ink-2);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.admin-recipes-status {
  margin: 24px 20px;
  color: var(--c-ink-2);
  font-size: var(--fs-base);
}
.admin-recipes-error {
  color: var(--c-alert);
}
.admin-recipe-label p {
  margin-top: 2px;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
}
.admin-recipe-badge {
  flex: none;
  margin-inline-end: 4px;
  padding: 2px 8px;
  border-radius: var(--r-pill);
  background: var(--c-saffron);
  color: var(--c-saffron-ink);
  font-size: var(--fs-xs);
  font-weight: 600;
}
.admin-recipe-badge.is-published {
  background: color-mix(in srgb, var(--c-herb) 18%, var(--c-surface));
  color: var(--c-herb);
}
.admin-recipes-more {
  display: flex;
  justify-content: center;
}
.admin-recipes-footnote {
  margin-bottom: 40px;
}
</style>
