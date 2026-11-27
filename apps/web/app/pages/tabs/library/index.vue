<script lang="ts" setup>
import type { IonSearchbarCustomEvent, SearchbarInputEventDetail } from '@ionic/core'
import type { RecipeItem } from '~/types'
import { useStorage } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { favoriteRecipeIds } from '~/composables/store/favorite'
import { useKitchenStore } from '~/composables/store/kitchen'
import { useRecipeStore } from '~/composables/store/recipe'
import { cookDocumentHead, publicPages } from '~/constants'
import { canCookWithKitchen } from '~/utils/kitchenMatch'
import { scopedKey } from '~/utils/storageScope'
import { yunleHaptic } from '~/utils/yunleHost'

definePageMeta({
  alias: ['/library'],
})

useHead(cookDocumentHead(publicPages.library))

const keyword = ref('')
const kitchen = useKitchenStore()
const rStore = useRecipeStore()
const onlyOwned = useStorage(scopedKey('library-only-owned'), false)
// 菜谱数据复用 recipe store：它已经在首页加载过，避免切到菜谱库时再读一次 IndexedDB。
const loading = computed(() => rStore.isSearching)
const recipes = computed(() => rStore.recipes)
const view = ref<'all' | 'fav'>('all')
const detail = shallowRef<RecipeItem>()
const detailOpen = ref(false)

function openDetail(dish: RecipeItem) {
  detail.value = dish
  detailOpen.value = true
}

const favoriteIdSet = computed(() => new Set(favoriteRecipeIds.value))
const isFav = (r: RecipeItem) => r.id != null && favoriteIdSet.value.has(r.id)

const filtered = computed(() => {
  const text = keyword.value.trim()
  const eligible = onlyOwned.value ? recipes.value.filter(recipe => canCookWithKitchen(recipe, kitchen)) : recipes.value
  return text ? eligible.filter(r => r.name.includes(text)) : eligible
})
const displayed = computed(() => view.value === 'fav' ? filtered.value.filter(isFav) : filtered.value)
const favCount = computed(() => recipes.value.filter(isFav).length)

const showToast = ref(false)
const toastMessage = ref('')

function onViewChange(value: unknown) {
  view.value = value === 'fav' ? 'fav' : 'all'
  void yunleHaptic('light')
}

function onInput(ev: IonSearchbarCustomEvent<SearchbarInputEventDetail>) {
  keyword.value = ev.detail.value ?? ''
}

function onToggled(favorited: boolean) {
  toastMessage.value = favorited ? '已添加到收藏' : '已从收藏移除'
  showToast.value = true
}

// 首屏只渲染前 30 行，滚动接近底部时再追加 50 行。
// 不再在空闲时一次补齐 887 行：那会在切到菜谱库时产生一个 1s+ 的长任务，
// 887 组 ion-item-sliding 也会阻塞主线程。行加入 DOM 后仍然保留，滚动不需要重新创建。
const FIRST_BATCH = 30
const PAGE_SIZE = 50
const renderCount = ref(FIRST_BATCH)
const rendered = computed(() => displayed.value.slice(0, renderCount.value))

// 每 50 行一组，组外用 content-visibility 跳过布局：滚动时只在进入新的一组时布局一次，
// 而不是每一帧都布局。
const CHUNK_SIZE = 50
const chunks = computed(() => {
  const list = rendered.value
  const result: RecipeItem[][] = []
  for (let i = 0; i < list.length; i += CHUNK_SIZE)
    result.push(list.slice(i, i + CHUNK_SIZE))
  return result
})

// 滚动到接近底部时追加下一批。用 IntersectionObserver 而不是 scroll 事件，
// 避免滚动过程中频繁执行 JS。
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | undefined

function loadMore() {
  const next = Math.min(renderCount.value + PAGE_SIZE, displayed.value.length)
  if (next !== renderCount.value)
    renderCount.value = next
}

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting))
      loadMore()
  }, { rootMargin: '600px 0px' })
  if (sentinel.value)
    observer.observe(sentinel.value)
})

watch(sentinel, (el, prev) => {
  if (prev)
    observer?.unobserve(prev)
  if (el)
    observer?.observe(el)
})

// 只在筛选条件变化时回到首批；收藏状态变化不应该把用户滚到一半的列表收回去。
watch([keyword, view, onlyOwned], async () => {
  renderCount.value = FIRST_BATCH
  await nextTick()
  // 列表很短或视口很高时，哨兵可能在视口内却不会再触发一次 intersection。
  if (sentinel.value && sentinel.value.getBoundingClientRect().top < window.innerHeight + 600)
    loadMore()
})

onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>菜谱</ion-title>
        <ion-buttons slot="end">
          <ion-button title="添加菜谱" router-link="/recipes/new">
            <ion-icon slot="icon-only" :icon="ioniconsAddCircleOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-header collapse="condense">
        <ion-toolbar>
          <ion-title size="large">
            菜谱
          </ion-title>
        </ion-toolbar>
        <ion-toolbar>
          <ion-searchbar
            placeholder="搜索菜谱"
            :debounce="150"
            show-clear-button="focus"
            @ion-input="onInput"
          />
        </ion-toolbar>
        <ion-toolbar class="library-segment">
          <ion-segment
            :value="view"
            @ion-change="onViewChange($event.detail.value)"
          >
            <ion-segment-button value="all">
              <ion-label>全部</ion-label>
            </ion-segment-button>
            <ion-segment-button value="fav">
              <ion-label>收藏 ({{ favCount }})</ion-label>
            </ion-segment-button>
          </ion-segment>
        </ion-toolbar>
      </ion-header>

      <section class="library-kitchen-filter" aria-label="厨房库存筛选">
        <ion-toggle v-model="onlyOwned" justify="space-between">
          仅看我的厨房可做
        </ion-toggle>
        <p v-if="onlyOwned">
          {{ kitchen.initialized ? '按已记录的食材、厨具和调料筛选，不默认有油盐。' : '尚未配置厨房，请先添加现有食材、厨具并确认调料。' }}
          <NuxtLink to="/kitchen">去我的厨房</NuxtLink>
        </p>
      </section>
      <ion-list v-if="loading" aria-busy="true" aria-label="正在加载菜谱">
        <ion-item v-for="i in 12" :key="i">
          <ion-label>
            <ion-skeleton-text :animated="true" :style="{ width: `${40 + (i * 37) % 45}%` }" />
          </ion-label>
        </ion-item>
      </ion-list>

      <ion-list v-else-if="displayed.length">
        <div
          v-for="(chunk, i) in chunks"
          :key="i"
          class="library-chunk"
          :style="{ containIntrinsicSize: `auto ${chunk.length * 44}px` }"
        >
          <RecipeListRow
            v-for="dish in chunk"
            :key="dish.id ?? dish.name"
            class="library-row"
            :dish="dish"
            @select="openDetail"
            @toggled="onToggled"
          />
        </div>
      </ion-list>

      <div v-else class="cook-empty">
        <ion-icon :icon="view === 'fav' && !keyword ? ioniconsStarOutline : ioniconsSearchOutline" />
        <h3>{{ onlyOwned ? '暂无库存可做的菜谱' : keyword ? '没有找到相关菜谱' : '还没有收藏的菜谱' }}</h3>
        <p>{{ onlyOwned ? '调整厨房库存、取消其他筛选或关闭库存筛选试试' : keyword ? '换个关键词试试' : '左滑菜谱或点星标即可收藏' }}</p>
      </div>

      <div
        v-if="!loading && displayed.length && renderCount < displayed.length"
        ref="sentinel"
        class="library-sentinel"
        aria-hidden="true"
      />
    </ion-content>
    <RecipeDetailSheet v-if="detail" v-model:open="detailOpen" :recipe="detail" />
    <ion-toast
      :is-open="showToast"
      :message="toastMessage"
      duration="1200"
      position="top"
      @did-dismiss="showToast = false"
    />
  </ion-page>
</template>

<style scoped>
.library-kitchen-filter {
  margin: var(--sp-3) var(--sp-4);
  padding: var(--sp-3) var(--sp-4);
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-ink);
}
.library-kitchen-filter ion-toggle {
  width: 100%;
  min-height: 44px;
}
.library-kitchen-filter p {
  margin-block: var(--sp-2) 0;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--c-ink-2);
}
.library-kitchen-filter a {
  color: var(--c-brand-ink);
  text-decoration: underline;
}
.library-segment {
  --padding-bottom: 8px;
}
.library-chunk {
  content-visibility: auto;
}
.library-row {
  height: 44px;
}
.library-sentinel {
  height: 1px;
}
</style>
