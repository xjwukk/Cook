<script lang="ts" setup>
import type { RecipeMatch } from '@yunyoujun/cook/recommend'
import type { RecipeItem } from '~/types'
import { cookDocumentHead, publicPages } from '~/constants'
import { trackCookEvent } from '~/utils/analytics'

definePageMeta({
  alias: ['/assistant', '/apps'],
})

useHead(cookDocumentHead(publicPages.assistant))

const {
  messages,
  status,
  enabled,
  modelName,
  checking,
  isAuthenticated,
  refreshStatus,
  send,
} = useAssistant()

const desktop = useMediaQuery('(min-width: 768px)')
const scroller = ref<{ $el: HTMLIonContentElement }>()

const suggestions = [
  '家里有土豆和猪肉，能做什么？',
  '想做个简单的素菜，20 分钟内能好',
  '我有鸡蛋、番茄和面食',
]

const disabledReason = computed(() => {
  if (!isAuthenticated.value)
    return '登录后即可使用料理助手'
  if (checking.value)
    return '正在检查助手状态…'
  if (!enabled.value)
    return '服务器尚未配置大模型，请联系管理员'
  return ''
})

const canAsk = computed(() => !disabledReason.value)

async function ask(text: string): Promise<void> {
  if (!canAsk.value)
    return
  await send(text)
  await nextTick()
  scrollToBottom()
}

function scrollToBottom(): void {
  // ion-content 是自定义元素，滚动要用它自己的方法，而不是 DOM scrollTo。
  void scroller.value?.$el?.scrollToBottom(300)
}

const detail = shallowRef<{ recipe: RecipeItem, match?: RecipeMatch }>()
const detailOpen = ref(false)

function openDetail(match: RecipeMatch): void {
  detail.value = { recipe: match.recipe, match }
  detailOpen.value = true
  trackCookEvent('click_assistant_recipe')
}

onMounted(() => {
  void refreshStatus()
})

watch(() => messages.value.length, scrollToBottom)
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>料理助手</ion-title>
        <ion-buttons slot="end">
          <span v-if="modelName && enabled" class="assistant-model">{{ modelName }}</span>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content ref="scroller" :fullscreen="true">
      <div class="assistant-shell" :class="{ 'is-desktop': desktop }">
        <div v-if="!messages.length" class="assistant-empty">
          <p class="assistant-empty-title">
            想吃什么，问我
          </p>
          <p class="assistant-empty-body">
            我会先按你的食材和厨具在本地 887 道菜里找，再挑几道适合的给你——不会编造菜谱。
          </p>
          <div class="assistant-suggestions">
            <button
              v-for="text in suggestions"
              :key="text"
              type="button"
              class="assistant-suggestion"
              :disabled="!canAsk"
              @click="ask(text)"
            >
              {{ text }}
            </button>
          </div>
        </div>

        <div v-else class="assistant-thread" role="log" aria-live="polite">
          <AssistantMessage
            v-for="(message, index) in messages"
            :key="index"
            :message="message"
            @open-recipe="openDetail"
            @followup="ask"
          />
          <div v-if="status === 'sending'" class="assistant-thinking" role="status">
            <span class="assistant-dot" /><span class="assistant-dot" /><span class="assistant-dot" />
            <span class="assistant-thinking-text">正在查菜谱并组织回答…</span>
          </div>
        </div>
      </div>
    </ion-content>

    <ion-footer class="assistant-footer">
      <div class="assistant-shell" :class="{ 'is-desktop': desktop }">
        <AssistantComposer
          :disabled="!canAsk"
          :sending="status === 'sending'"
          :hint="disabledReason"
          @send="ask"
        />
      </div>
    </ion-footer>

    <LazyRecipeDetailSheet v-if="detail" v-model:open="detailOpen" :recipe="detail.recipe" :match="detail.match" />
  </ion-page>
</template>

<style scoped>
.assistant-shell {
  width: 100%;
  max-width: 760px;
  margin: 0 auto;
  padding: 16px;
}
.assistant-model {
  padding-inline-end: 12px;
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
}
.assistant-empty {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 40px 8px;
}
.assistant-empty-title {
  margin: 0;
  color: var(--c-ink);
  font-size: var(--fs-xl);
  font-weight: 650;
}
.assistant-empty-body {
  margin: 0;
  color: var(--c-ink-2);
  font-size: var(--fs-base);
  line-height: 1.8;
}
.assistant-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  align-items: flex-start;
}
.assistant-suggestion {
  min-height: 44px;
  padding: 10px 16px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-pill);
  background: var(--c-surface);
  color: var(--c-ink-2);
  font-family: inherit;
  font-size: var(--fs-base);
  text-align: start;
  cursor: pointer;
  transition:
    border-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out);
}
.assistant-suggestion:hover:not(:disabled) {
  border-color: var(--c-rule-strong);
  background: var(--c-paper-alt);
  color: var(--c-ink);
}
.assistant-suggestion:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}
.assistant-suggestion:disabled {
  opacity: var(--cook-btn-disabled-opacity);
  cursor: not-allowed;
}
.assistant-thread {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 8px;
}
.assistant-thinking {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-inline-start: 36px;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
}
.assistant-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--c-ink-3);
  animation: assistant-bounce 1.1s infinite ease-in-out;
}
.assistant-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.assistant-dot:nth-child(3) {
  animation-delay: 0.3s;
}
.assistant-thinking-text {
  margin-inline-start: 4px;
}
@keyframes assistant-bounce {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  40% {
    opacity: 1;
    transform: translateY(-3px);
  }
}
.assistant-footer {
  border-top: 1px solid var(--c-rule);
  background: var(--c-paper);
  padding-bottom: env(safe-area-inset-bottom, 0);
}
@media (prefers-reduced-motion: reduce) {
  .assistant-dot {
    animation: none;
  }
}
</style>
