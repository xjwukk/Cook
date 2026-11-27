<script lang="ts" setup>
import type { CustomRecipe } from '~/composables/store/customRecipe'
import type { RecipeItem } from '~/types'
import { customRecipes, removeCustomRecipe } from '~/composables/store/customRecipe'
import { showAlert } from '~/utils/dialog'
import { getRecipeLink, openRecipe } from '~/utils/recipe'
import { yunleHaptic } from '~/utils/yunleHost'

definePageMeta({
  layout: 'child',
  title: '我的菜谱',
})

const account = useAccount()
const { refresh: refreshSubmissions, publicationOf } = useRecipeSubmissions()
const { omittedRecipes, status: syncStatus } = useAccountSync()

/**
 * 有来源时直接打开；详情入口保留备注和编辑。
 */
const detail = shallowRef<CustomRecipe>()
const detailOpen = ref(false)
const sorted = computed(() => [...customRecipes.value].sort((a, b) => b.updatedAt - a.updatedAt))

const publishTarget = shallowRef<CustomRecipe>()
const publishOpen = ref(false)

/** 我亲手改过的官方菜谱：只有管理员能改，所以这一段也只对管理员出现。 */
const editedOfficial = shallowRef<{ id: number, data: RecipeItem, updatedAt: number, source: string }[]>([])
const editedLoading = ref(false)

function showDetails(recipe: CustomRecipe) {
  detail.value = recipe
  detailOpen.value = true
}
function open(recipe: CustomRecipe) {
  if (getRecipeLink(recipe))
    openRecipe(recipe)
  else
    showDetails(recipe)
}

async function remove(recipe: CustomRecipe) {
  try {
    removeCustomRecipe(recipe.customId)
    void yunleHaptic('medium')
  }
  catch {
    await showAlert('删除失败', '没能保存更改，原有菜谱未改变。')
  }
}

function openPublish(recipe: CustomRecipe) {
  publishTarget.value = recipe
  publishOpen.value = true
}

function statusLabel(customId: string): { text: string, tone: 'published' | 'pending' | 'rejected' } | undefined {
  const publication = publicationOf(customId)
  if (!publication)
    return undefined
  if (publication.status === 'approved' && publication.publishedRecipeId != null)
    return { text: `已收录 #${publication.publishedRecipeId}`, tone: 'published' }
  if (publication.status === 'pending')
    return { text: '待审核', tone: 'pending' }
  if (publication.status === 'rejected')
    return { text: `未通过：${publication.reviewNote || '未写明原因'}`, tone: 'rejected' }
  return { text: '已撤回', tone: 'rejected' }
}

async function loadEditedOfficial(): Promise<void> {
  if (account.user.value?.role !== 'admin')
    return
  editedLoading.value = true
  try {
    const response = await fetch('/api/recipes/overrides/mine', { credentials: 'same-origin' })
    if (response.ok)
      editedOfficial.value = (await response.json()).overrides ?? []
  }
  catch {
    // 这一段只是快捷入口，拉不到不影响本页其余内容。
  }
  finally {
    editedLoading.value = false
  }
}

onMounted(() => {
  void refreshSubmissions()
  void loadEditedOfficial()
})
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/my" />
        </ion-buttons>
        <ion-title>我的菜谱</ion-title>
        <ion-buttons slot="end">
          <ion-button title="添加菜谱" router-link="/recipes/new">
            <ion-icon slot="icon-only" :icon="ioniconsAddCircleOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <p v-if="omittedRecipes > 0" class="sync-banner" role="status">
        有 {{ omittedRecipes }} 道菜谱没有上传（只保存在本机）。可以先把备份导出到其它设备。
      </p>

      <ion-list v-if="sorted.length" :inset="true">
        <TransitionGroup name="cook-row" tag="div" class="cook-row-group">
          <ion-item-sliding v-for="recipe in sorted" :key="recipe.customId">
            <ion-item :button="true" @click="open(recipe)">
              <ion-label>
                <h3>{{ recipe.name }}</h3>
                <p>{{ recipe.stuff.join(' · ') }}</p>
                <p
                  v-if="statusLabel(recipe.customId)"
                  class="publish-status"
                  :class="`is-${statusLabel(recipe.customId)!.tone}`"
                >
                  {{ statusLabel(recipe.customId)!.text }}
                </p>
              </ion-label>
              <ion-button slot="end" fill="clear" :aria-label="`查看${recipe.name}详情`" @click.stop="showDetails(recipe)">
                详情
              </ion-button>
            </ion-item>

            <ion-item-options side="end" @ion-swipe="remove(recipe)">
              <ion-item-option color="primary" @click="openPublish(recipe)">
                投稿
              </ion-item-option>
              <ion-item-option color="danger" :expandable="true" @click="remove(recipe)">
                删除
              </ion-item-option>
            </ion-item-options>
          </ion-item-sliding>
        </TransitionGroup>
      </ion-list>

      <div v-else class="cook-empty">
        <ion-icon :icon="ioniconsBookOutline" />
        <h3>还没有自己的菜谱</h3>
        <p>添加家里常做的菜，搭配推荐和「吃什么」都会算上它</p>
        <ion-button fill="clear" router-link="/recipes/new">
          添加菜谱
        </ion-button>
      </div>

      <section v-if="sorted.length" class="mine-footer">
        <p class="mine-footer-hint">
          {{ syncStatus === 'error' ? '同步暂时没有成功，菜谱仍保存在本机。' : '登录后这些菜谱会同步到你自己的账号。' }}
        </p>
        <p class="mine-footer-hint">
          向左滑动一条菜谱，可以「投稿」到全量菜谱或删除。
        </p>
      </section>

      <section
        v-if="account.user.value?.role === 'admin'"
        class="edited-official"
        aria-label="我修改过的官方菜谱"
      >
        <h2>我修改过的官方菜谱</h2>
        <p v-if="editedLoading" class="edited-official-hint">
          正在加载…
        </p>
        <ul v-else-if="editedOfficial.length" class="edited-official-list">
          <li v-for="row in editedOfficial" :key="row.id">
            <NuxtLink to="/admin/recipes" class="edited-official-link">
              <span class="edited-official-name">{{ row.data.name }}</span>
              <span class="edited-official-meta">#{{ row.id }}{{ row.source === 'submission' ? ' · 投稿发布' : ' · 官方修订' }}</span>
            </NuxtLink>
          </li>
        </ul>
        <p v-else class="edited-official-hint">
          还没有改过官方菜谱。在「全量菜谱」里改动后，这里会列出来。
        </p>
        <p class="edited-official-hint">
          这一节只是快捷入口，官方菜谱仍然只有一份，编辑在「全量菜谱」里做。
        </p>
      </section>

      <details class="private-backup">
        <summary>备份与迁移</summary>
        <PrivateRecipeBackup />
      </details>

      <RecipeDetailSheet v-model:open="detailOpen" :recipe="detail" />
      <SubmitRecipeSheet v-model:open="publishOpen" :recipe="publishTarget" />
    </ion-content>
  </ion-page>
</template>

<style scoped>
.sync-banner {
  margin: 12px 16px 0;
  padding: 10px 14px;
  border-radius: var(--r-md);
  background: color-mix(in srgb, var(--c-warn) 10%, var(--c-surface));
  color: var(--c-warn);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.publish-status {
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
}
.publish-status.is-published {
  color: var(--c-herb);
}
.publish-status.is-pending {
  color: var(--c-warn);
}
.publish-status.is-rejected {
  color: var(--c-alert);
}
.mine-footer {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 16px 0;
}
.mine-footer-hint {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
}
.edited-official {
  margin: 24px 16px 0;
}
.edited-official h2 {
  margin: 0 0 8px;
  color: var(--c-ink);
  font-size: var(--fs-md);
}
.edited-official-list {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.edited-official-link {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  color: var(--c-ink);
  text-decoration: none;
}
.edited-official-name {
  font-size: var(--fs-base);
}
.edited-official-meta {
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
  white-space: nowrap;
}
.edited-official-hint {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.private-backup {
  margin: 24px 16px;
  padding-bottom: 16px;
  border-radius: 12px;
  background: var(--ion-item-background, #fff);
}
.private-backup:not([open]) {
  padding-bottom: 0;
}
.private-backup summary {
  min-height: 48px;
  padding: 14px 20px;
  cursor: pointer;
  font-size: 17px;
}
.private-backup summary:focus-visible {
  outline: 2px solid var(--ion-color-primary);
  outline-offset: 2px;
}
</style>
