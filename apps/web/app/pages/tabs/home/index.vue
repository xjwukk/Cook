<script lang="ts" setup>
import type { RecipeMatch } from '@yunyoujun/cook'
import type { CookingStyle } from '~/composables/useCookingStyle'
import type { RecipeItem } from '~/types'
import { onIonViewDidEnter, onIonViewWillLeave } from '@ionic/vue'
import { useCookingStyle } from '~/composables/useCookingStyle'
import { cookDocumentHead, publicPages } from '~/constants'
import { yunleHaptic } from '~/utils/yunleHost'

definePageMeta({
  alias: ['/', '/home', '/tabs'],
})

useHead(cookDocumentHead(publicPages.home))

const rStore = useRecipeStore()
const nuxtApp = useNuxtApp()
const { style: cookingStyle, pantry: workbenchPantry, canPersist } = useCookingStyle()
const desktop = useMediaQuery('(min-width: 768px)')
const active = shallowRef(false)
onIonViewDidEnter(() => {
  active.value = true
  void nuxtApp.callHook('cook:home-ready')
})
onIonViewWillLeave(() => {
  active.value = false
})
const panelRef = ref<{ $el: HTMLElement }>()
const flightTarget = computed(() => panelRef.value?.$el)
const contentRef = ref<{ $el: HTMLIonContentElement }>()
const styleSwitchRef = useTemplateRef<{ focus: () => void }>('styleSwitch')
const reducedMotion = usePreferredReducedMotion()

async function changeCookingStyle(style: CookingStyle) {
  cookingStyle.value = style
  await nextTick()
  void contentRef.value?.$el.scrollToTop(0)
  styleSwitchRef.value?.focus()
}

/** 结果弹层遮住的高度，留作页面底部空白 */
const panelInset = ref(0)

const hasSelection = computed(() => rStore.selectedStuff.length > 0 || Boolean(rStore.curTool) || rStore.hasReviewedSelection)

function reset() {
  rStore.reset()
  void yunleHaptic('medium')
}

function scrollTop() {
  void contentRef.value?.$el.scrollToTop(reducedMotion.value === 'reduce' ? 0 : 300)
}

const detail = shallowRef<{ recipe: RecipeItem, match?: RecipeMatch }>()
const detailOpen = ref(false)
function openDetail(recipe: RecipeItem, match?: RecipeMatch) {
  detail.value = { recipe, match }
  detailOpen.value = true
}
</script>

<template>
  <ion-page class="cooking-page">
    <ion-header :key="cookingStyle" :translucent="true">
      <ion-toolbar>
        <ion-buttons :slot="desktop ? 'end' : 'start'">
          <CookingStyleSwitch ref="styleSwitch" :desktop="desktop" :model-value="cookingStyle" @update:model-value="changeCookingStyle" />
        </ion-buttons>
        <ion-buttons slot="end">
          <ReviewedRecipeFilters
            :goal-options="rStore.reviewedGoalOptions"
            :scene-options="rStore.reviewedSceneOptions"
            :selected-goal="rStore.dietaryGoal"
            :selected-scene="rStore.discoveryScene"
            :loading="rStore.isReviewingRecipes"
            :loaded="rStore.hasLoadedReviewedRecipes"
            :unavailable-message="rStore.reviewedCatalogError"
            @select-goal="rStore.toggleDietaryGoal"
            @select-scene="rStore.toggleDiscoveryScene"
            @load="rStore.loadReviewedRecipes()"
          />
          <ion-button class="cooking-clear" :disabled="!hasSelection" @click="reset">
            清空
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content ref="contentRef" :class="{ 'workbench-content': cookingStyle === 'workbench', 'desktop-classic-content': desktop && cookingStyle === 'classic' }" :style="{ '--padding-bottom': `${cookingStyle === 'classic' && !desktop ? panelInset + 16 : 16}px` }">
      <p v-if="!canPersist" class="style-storage-note" role="status">
        浏览器暂时无法保存样式偏好，本次仍可切换使用。
      </p>
      <LazyCookingWorkbench v-if="cookingStyle === 'workbench'" v-model:pantry="workbenchPantry" :desktop="desktop" @detail="openDetail" />
      <ChooseFood v-else :desktop="desktop" :flight-target="flightTarget" />
    </ion-content>

    <ResultsPanel v-if="cookingStyle === 'classic'" ref="panelRef" v-model:inset="panelInset" :desktop="desktop" :active="active" @scroll-top="scrollTop" @detail="openDetail" />
    <LazyRecipeDetailSheet v-if="detail" v-model:open="detailOpen" :recipe="detail.recipe" :match="detail.match" />
  </ion-page>
</template>

<style scoped>
.cooking-page {
  /* 平板：结果栏更窄，把宽度留给筛选区 */
  --cook-results-width: clamp(300px, 42%, 460px);
}
.desktop-classic-content {
  --padding-start: 8px;
  --padding-end: calc(var(--cook-results-width) + 32px);
  --padding-top: 8px;
}
.style-storage-note {
  margin: 12px 20px;
  font-size: 14px;
  text-align: center;
}
.cooking-clear {
  min-height: 44px;
  --padding-top: 7px;
  --padding-bottom: 7px;
}
@media (min-width: 768px) {
  .cooking-clear {
    margin-inline-start: 14px;
    font-size: 13px;
  }
}
@media (min-width: 1200px) {
  .cooking-page {
    --cook-results-width: clamp(360px, 42%, 560px);
  }
}
</style>
