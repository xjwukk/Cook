<script lang="ts" setup>
import type { RecipeMatch } from '@yunyoujun/cook/recommend'
import type { AssistantMessage } from '~/composables/useAssistant'
import type { RecipeItem } from '~/types'
import type { AssistantAttachment } from '~/utils/assistantImages'
import { onIonViewWillEnter } from '@ionic/vue'
import { getCustomRecipe, saveCustomRecipe } from '~/composables/store/customRecipe'
import { cookDocumentHead, publicPages } from '~/constants'
import { trackCookEvent } from '~/utils/analytics'
import { draftToCustomRecipeInput, normalizeDraftRecipe } from '~/utils/assistantActions'
import { buildCustomRecipe } from '~/utils/customRecipe'

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
  imagesSupported,
  isAuthenticated,
  refreshStatus,
  send,
  setDraftStatus,
} = useAssistant()

const desktop = useMediaQuery('(min-width: 768px)')
const router = useRouter()
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
    return '还没有配置模型，去「我的 → 助手设置」填写'
  return ''
})

const canAsk = computed(() => !disabledReason.value)

async function ask(text: string, attachments: AssistantAttachment[] = []): Promise<void> {
  if (!canAsk.value)
    return
  await send(text, attachments)
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

/** 从一条 assistant 消息里取第 draftIndex 个 draft_recipe（与服务端 actions 顺序一致）。 */
function draftOf(message: AssistantMessage | undefined, draftIndex: number) {
  const drafts = (message?.answer?.actions ?? [])
    .filter(action => action.type === 'draft_recipe')
    .map(action => normalizeDraftRecipe(action.recipe))
  return drafts[draftIndex]
}

/** 确认保存草稿：只有用户自己的 customId 才允许覆盖；官方 id 或编造的 editId 一律按新建处理。 */
function commitDraft(messageIndex: number, draftIndex: number): string | undefined {
  const draft = draftOf(messages.value[messageIndex], draftIndex)
  if (!draft)
    return undefined
  const existing = draft.editId ? getCustomRecipe(draft.editId) : undefined
  const result = buildCustomRecipe(draftToCustomRecipeInput(draft), existing)
  if ('error' in result) {
    setDraftStatus(messageIndex, 'error')
    return undefined
  }
  saveCustomRecipe(result.recipe)
  setDraftStatus(messageIndex, 'saved')
  return result.recipe.customId
}

function saveDraft(messageIndex: number, draftIndex: number): void {
  if (commitDraft(messageIndex, draftIndex))
    trackCookEvent('assistant_action_draft_save')
}

/** 「去编辑」：未保存的草稿先落库（方案 A），再走已有的 /recipes/new?id= 回填链路。 */
function editDraft(messageIndex: number, draftIndex: number): void {
  const customId = commitDraft(messageIndex, draftIndex)
  if (!customId)
    return
  trackCookEvent('assistant_action_draft_edit')
  router.push(`/recipes/new?id=${encodeURIComponent(customId)}`)
}

onMounted(() => {
  void refreshStatus()
})

// 从「助手设置」返回时页面被缓存，重新检查一次配置是否已可用。
onIonViewWillEnter(() => {
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
          <p class="assistant-empty-body">
            也可以直接发菜谱截图，我帮你把食材和步骤抄成菜谱。
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
            @save-draft="draftIndex => saveDraft(index, draftIndex)"
            @edit-draft="draftIndex => editDraft(index, draftIndex)"
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
          :vision-available="imagesSupported"
          @send="ask"
        />
        <NuxtLink
          v-if="isAuthenticated && !checking && !enabled"
          class="assistant-config-link"
          to="/assistant-settings"
        >
          去配置模型
        </NuxtLink>
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
.assistant-config-link {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  margin-top: 4px;
  color: var(--c-brand-ink);
  font-size: var(--fs-base);
  text-decoration: underline;
  text-underline-offset: 0.2em;
}
@media (prefers-reduced-motion: reduce) {
  .assistant-dot {
    animation: none;
  }
}
</style>
