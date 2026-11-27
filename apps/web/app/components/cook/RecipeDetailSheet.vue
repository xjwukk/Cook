<script lang="ts" setup>
import type { RecipeMatch, RecipeTextBlock } from '@yunyoujun/cook'
import type { RecipeItem } from '~/types'
import { uniqueStuff } from '@yunyoujun/cook/recommend'
import { isFavorited, toggleFavorite } from '~/composables/store/favorite'
import { addRecipeHistory } from '~/composables/store/history'
import { getEmojisFromStuff } from '~/utils'
import { trackCookEvent } from '~/utils/analytics'
import { isCustomRecipe } from '~/utils/customRecipe'
import { getRecipeLink, getRecipeTextLink } from '~/utils/recipe'
import { reviewedPreparationLink } from '~/utils/reviewed-recipes'
import { yunleHaptic } from '~/utils/yunleHost'

/**
 * 菜品详情：已有 / 缺少 / 常备分开列出，可以收藏或去 B 站看做法
 */
const props = defineProps<{
  recipe?: RecipeItem
  match?: RecipeMatch
}>()
const open = defineModel<boolean>('open', { required: true })

const stuff = computed(() => props.recipe ? uniqueStuff(props.recipe.stuff) : [])
const thumb = computed(() => props.recipe?.tags?.includes('杂烩') ? '🍲' : getEmojisFromStuff(stuff.value)[0] ?? '🍽️')
const tools = computed(() => props.recipe?.tools ?? [])
const meta = computed(() => {
  if (!props.recipe)
    return ''
  const tags = props.recipe.tags?.slice(0, 3).join(' · ') ?? ''
  const difficulty = props.recipe.difficulty ?? ''
  return [tags, difficulty].filter(Boolean).join(' · ')
})
const groups = computed(() => {
  const match = props.match
  if (!match)
    return [{ label: '食材', items: stuff.value, tone: 'neutral' }]
  return [
    { label: '已有', items: match.matchedStuff, tone: 'have' },
    { label: '还缺', items: match.missingStuff, tone: 'missing' },
    { label: '常备调料', items: match.pantryStuff, tone: 'neutral' },
    { label: '还能加', items: match.optionalStuff, tone: 'neutral' },
  ].filter(group => group.items.length)
})

/**
 * 文字步骤：官方菜谱取 recipe-text.json 的「操作」；
 * 自建菜谱和投稿发布的菜谱没有那个文件，用菜谱自带的 note。
 */
interface StepBlock {
  type: 'paragraph' | 'ordered' | 'unordered'
  text?: string
  items?: string[]
}

const rawSteps = shallowRef<RecipeTextBlock[]>([])
const stepsLoading = ref(false)
let stepRequest = 0

watch([() => props.recipe?.id, () => props.recipe?.note], async ([id]) => {
  const request = ++stepRequest
  rawSteps.value = []
  // 自建菜谱没有数字 id，但有自己的步骤备注。
  if (props.recipe?.note?.trim()) {
    stepsLoading.value = false
    return
  }
  if (typeof id !== 'number') {
    stepsLoading.value = false
    return
  }
  stepsLoading.value = true
  try {
    await loadRecipeTexts()
    if (request !== stepRequest)
      return
    rawSteps.value = extractRecipeSteps(findRecipeText(id))
  }
  finally {
    if (request === stepRequest)
      stepsLoading.value = false
  }
}, { immediate: true })

const steps = computed<StepBlock[]>(() => {
  const result: StepBlock[] = []
  for (const block of rawSteps.value) {
    if (block.type === 'paragraph')
      result.push({ type: 'paragraph', text: block.text })
    else if (block.type === 'list')
      result.push({ type: block.ordered ? 'ordered' : 'unordered', items: block.items })
  }
  return result
})

const custom = computed(() => props.recipe && isCustomRecipe(props.recipe) ? props.recipe : undefined)
/** 菜谱自带的做法步骤：自建菜谱与投稿发布的菜谱都有，官方菜谱的步骤在 recipe-text.json。 */
const noteText = computed(() => props.recipe?.note?.trim() ?? '')
const rStore = useRecipeStore()
const institutionEntry = computed(() => rStore.discoveryScene === 'institutional-low-gi'
  ? rStore.institutionalReview(props.recipe?.id)
  : undefined)
const dietaryEntry = computed(() => rStore.dietaryReview(props.recipe?.id))
const lunchEntry = computed(() => rStore.discoveryScene === 'next-day-lunch'
  ? rStore.lunchReview(props.recipe?.id)
  : undefined)
const reviewedTextLink = computed(() => {
  if (institutionEntry.value)
    return institutionEntry.value.sourceURL
  if (props.recipe?.link && (dietaryEntry.value || lunchEntry.value))
    return reviewedPreparationLink(rStore.reviewedCatalog, props.recipe.id)
  return ''
})
const videoLink = computed(() => props.recipe?.bv ? `https://www.bilibili.com/video/${props.recipe.bv}` : '')
const normalLink = computed(() => props.recipe ? getRecipeLink(props.recipe) : '')
const link = computed(() => reviewedTextLink.value || normalLink.value)
const textLink = computed(() => !reviewedTextLink.value && props.recipe ? getRecipeTextLink(props.recipe) : '')
const primaryIsVideo = computed(() => Boolean(link.value && link.value === videoLink.value))
const linkLabel = computed(() => {
  if (institutionEntry.value)
    return '打开机构英文原方'
  if (reviewedTextLink.value)
    return '看审核时的图文原文'
  if (primaryIsVideo.value || link.value.includes('bilibili.com'))
    return '去 B 站看做法'
  // 收录的菜没有视频时，链接就是图文做法
  return custom.value ? '看做法' : '看图文做法'
})

const canFavorite = computed(() => typeof (props.recipe as { id?: number } | undefined)?.id === 'number')
const favorited = computed(() => props.recipe ? isFavorited(props.recipe) : false)

function onFavorite() {
  if (!props.recipe)
    return
  toggleFavorite(props.recipe)
  void yunleHaptic(favorited.value ? 'success' : 'light')
}

function openPrimary() {
  if (!props.recipe)
    return
  addRecipeHistory(props.recipe)
  trackCookEvent('click_dish')
  if (link.value)
    window.open(link.value, '_blank')
}

function readText() {
  if (!props.recipe || !textLink.value)
    return
  addRecipeHistory(props.recipe)
  trackCookEvent('click_dish')
  window.open(textLink.value, '_blank')
}

function watchOtherVideo() {
  if (!videoLink.value || !props.recipe)
    return
  addRecipeHistory(props.recipe)
  trackCookEvent('click_dish')
  window.open(videoLink.value, '_blank')
}

function onPresented() {
  if (open.value && props.recipe)
    trackCookEvent('view_recipe_detail')
}
</script>

<template>
  <ion-modal class="recipe-detail-modal" :is-open="open" @did-present="onPresented" @did-dismiss="open = false">
    <ion-header>
      <ion-toolbar>
        <ion-title>菜谱详情</ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" @click="open = false">
            完成
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content v-if="recipe">
      <div class="recipe-detail-hero">
        <div class="recipe-detail-heading">
          <span class="recipe-detail-thumb" aria-hidden="true">{{ thumb }}</span>
          <h2>{{ recipe.name }}</h2>
        </div>
        <p v-if="meta">
          {{ meta }}
        </p>
      </div>

      <div class="recipe-detail-actions">
        <ion-button v-if="link" expand="block" class="recipe-detail-primary" @click="openPrimary">
          <ion-icon slot="start" :icon="primaryIsVideo ? ioniconsPlayCircle : ioniconsDocumentTextOutline" />
          {{ linkLabel }}
        </ion-button>
        <ion-button v-if="textLink" fill="clear" class="recipe-detail-fav" aria-label="看图文做法" title="看图文做法" @click="readText">
          <ion-icon slot="icon-only" :icon="ioniconsDocumentTextOutline" />
        </ion-button>
        <ion-button
          v-if="custom"
          :expand="link ? undefined : 'block'"
          :fill="link ? 'clear' : 'solid'"
          :class="link ? 'recipe-detail-fav' : 'recipe-detail-primary'"
          :router-link="`/recipes/new?id=${custom.customId}`"
          aria-label="编辑菜谱"
          @click="open = false"
        >
          <ion-icon :slot="link ? 'icon-only' : 'start'" :icon="ioniconsCreateOutline" />
          <template v-if="!link">
            编辑菜谱
          </template>
        </ion-button>
        <ion-button v-if="canFavorite" fill="clear" class="recipe-detail-fav" :aria-pressed="favorited" :aria-label="favorited ? '取消收藏' : '收藏'" @click="onFavorite">
          <ion-icon slot="icon-only" :icon="favorited ? ioniconsStar : ioniconsStarOutline" color="warning" />
        </ion-button>
      </div>
      <ion-button v-if="reviewedTextLink && videoLink" expand="block" fill="outline" class="recipe-detail-other-source" @click="watchOtherVideo">
        其他视频做法（未核对）
      </ion-button>

      <RecipeReviewSection :recipe="recipe" />

      <section class="recipe-detail-facts" aria-label="食材与厨具">
        <div v-for="group in groups" :key="group.label" class="recipe-detail-fact-row">
          <span class="recipe-detail-fact-label">{{ group.label }}</span>
          <div class="recipe-detail-fact-values">
            <span v-for="name in group.items" :key="name" class="recipe-detail-chip" :class="`is-${group.tone}`">{{ name }}</span>
          </div>
        </div>
        <div v-if="tools.length" class="recipe-detail-fact-row">
          <span class="recipe-detail-fact-label">厨具</span>
          <div class="recipe-detail-fact-values">
            <span v-for="tool in tools" :key="tool" class="recipe-detail-chip is-neutral">{{ tool === '一口大锅' ? '炒锅' : tool }}</span>
          </div>
        </div>
      </section>

      <section aria-label="步骤">
        <h3 class="recipe-detail-steps-title">
          步骤
        </h3>
        <div v-if="noteText || steps.length || stepsLoading" class="recipe-detail-steps">
          <p v-if="stepsLoading" class="recipe-detail-step-loading">
            正在加载文字步骤…
          </p>
          <p v-else-if="noteText" class="recipe-detail-step-paragraph">
            {{ noteText }}
          </p>
          <template v-for="(step, index) in steps" :key="index">
            <p v-if="step.type === 'paragraph'" class="recipe-detail-step-paragraph">
              <RecipeInlineText :text="step.text ?? ''" />
            </p>
            <ol v-else-if="step.type === 'ordered'" class="recipe-detail-step-list">
              <li v-for="(item, itemIndex) in step.items" :key="itemIndex">
                <RecipeInlineText :text="item" />
              </li>
            </ol>
            <ul v-else class="recipe-detail-step-list">
              <li v-for="(item, itemIndex) in step.items" :key="itemIndex">
                <RecipeInlineText :text="item" />
              </li>
            </ul>
          </template>
        </div>
        <p v-else class="recipe-detail-empty">
          这道菜还没有录入文字步骤，可以直接查看视频或图文做法。
        </p>
      </section>

      <section v-if="link" aria-label="视频链接">
        <h3 class="cook-group-header">
          {{ videoLink ? '视频链接' : '做法链接' }}
        </h3>
        <a
          class="recipe-detail-link"
          :href="link"
          target="_blank"
          rel="noopener noreferrer"
          @click.prevent="openPrimary"
        >{{ link }}</a>
      </section>

      <p class="cook-group-footer recipe-detail-note">
        <template v-if="custom">
          这是你自己添加的菜谱。登录后会同步到你的账号，换设备也能看到。
        </template>
        <template v-else>
          食材来自菜谱记录，用量和调味以{{ reviewedTextLink || !recipe.bv ? '做法原文' : '视频' }}为准。
        </template>
      </p>
    </ion-content>
  </ion-modal>
</template>

<style scoped>
.recipe-detail-modal {
  --width: min(760px, calc(100vw - 48px));
  --height: min(88vh, 900px);
  --border-radius: 20px;
  --backdrop-opacity: 0.45;
  --box-shadow: 0 24px 80px rgba(0, 0, 0, 0.24);
}
@media (max-width: 767px) {
  .recipe-detail-modal {
    --width: calc(100vw - 24px);
    --height: calc(100vh - 48px);
    --border-radius: 16px;
  }
}
.recipe-detail-steps-title {
  margin: 22px 16px 8px;
  color: var(--c-ink);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
.recipe-detail-steps-title::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 16px;
  margin-inline-end: 8px;
  border-radius: 2px;
  background: var(--c-brand);
  vertical-align: -2px;
}
.recipe-detail-steps {
  margin: 0 16px;
  padding: 16px 20px;
  border-radius: 10px;
  background: var(--ion-item-background, #fff);
  font-size: 16px;
  line-height: 1.8;
}
.recipe-detail-step-paragraph {
  margin: 0 0 12px;
  white-space: pre-wrap;
}
.recipe-detail-step-paragraph:last-child {
  margin-bottom: 0;
}
.recipe-detail-step-list {
  margin: 0 0 12px;
  padding-inline-start: 22px;
}
.recipe-detail-step-list:last-child {
  margin-bottom: 0;
}
.recipe-detail-step-list li {
  margin-block: 8px;
  white-space: pre-wrap;
}
.recipe-detail-step-list li::marker {
  color: var(--c-brand);
  font-weight: 600;
}
.recipe-detail-step-loading {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
}
.recipe-detail-empty {
  margin: 0 16px;
  padding: 14px 16px;
  border-radius: 10px;
  background: var(--ion-item-background, #fff);
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
.recipe-detail-link {
  display: block;
  margin: 0 16px;
  padding: 12px 16px;
  border-radius: 10px;
  background: var(--ion-item-background, #fff);
  color: var(--c-brand-ink);
  font-size: var(--fs-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.recipe-detail-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 4px 24px 0;
  text-align: center;
}
.recipe-detail-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-width: 0;
}
.recipe-detail-thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  flex: none;
  border-radius: 14px;
  background: var(--ion-item-background, #fff);
  font-size: 30px;
  animation: recipe-detail-pop 0.42s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.recipe-detail-hero h2 {
  min-width: 0;
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  line-height: 30px;
  overflow-wrap: anywhere;
}
.recipe-detail-hero p {
  margin: 0;
  font-size: 15px;
  color: var(--c-ink-3);
}
.recipe-detail-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 16px 4px;
}
.recipe-detail-primary {
  flex: 1;
  margin: 0;
  --border-radius: 12px;
  min-height: 50px;
  font-size: 17px;
  font-weight: 600;
}
.recipe-detail-fav {
  flex: none;
  width: 50px;
  height: 50px;
  margin: 0;
  --border-radius: 12px;
  --background: var(--ion-item-background, #fff);
  font-size: 22px;
}
.recipe-detail-fav[aria-pressed='true'] ion-icon {
  animation: recipe-detail-pop 0.36s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.recipe-detail-other-source {
  margin: 8px 16px 0;
  --border-radius: 10px;
  --border-color: var(--c-rule);
  min-height: 44px;
}
.recipe-detail-facts {
  margin: 12px 16px 0;
  padding: 4px 14px;
  border-radius: 10px;
  background: var(--ion-item-background, #fff);
}
.recipe-detail-fact-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 7px 0;
}
.recipe-detail-fact-row + .recipe-detail-fact-row {
  border-top: 1px solid var(--c-rule);
}
.recipe-detail-fact-label {
  flex: none;
  width: 42px;
  padding-top: 3px;
  color: var(--c-ink-3);
  font-size: 13px;
}
.recipe-detail-fact-values {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}
.recipe-detail-chip {
  display: inline-flex;
  align-items: center;
  height: 26px;
  padding: 0 10px;
  border-radius: 13px;
  font-size: 14px;
}
.recipe-detail-chip.is-have {
  background: var(--c-brand-wash);
  color: var(--c-brand-ink);
  font-weight: 500;
}
.recipe-detail-chip.is-missing {
  background: color-mix(in srgb, var(--c-warn) 14%, transparent);
  color: var(--c-warn);
  font-weight: 500;
}
.recipe-detail-chip.is-neutral {
  background: var(--cook-fill);
}
.recipe-detail-note {
  margin-top: 8px;
  padding-bottom: 32px;
}
@keyframes recipe-detail-pop {
  0% {
    transform: scale(0.7);
  }
  60% {
    transform: scale(1.08);
  }
  100% {
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .recipe-detail-thumb,
  .recipe-detail-fav[aria-pressed='true'] ion-icon {
    animation: none;
  }
}
</style>
