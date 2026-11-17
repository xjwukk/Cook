<script lang="ts" setup>
import type { AssistantMessage } from '~/composables/useAssistant'
import { normalizeDraftRecipe } from '~/utils/assistantActions'

const props = defineProps<{
  message: AssistantMessage
}>()

defineEmits<{
  openRecipe: [match: NonNullable<AssistantMessage['matches']>[number]]
  followup: [text: string]
  saveDraft: [draftIndex: number]
  editDraft: [draftIndex: number]
}>()

/** 服务端已校验过，这里再归一一次用于渲染；畸形条目不显示。 */
const drafts = computed(() =>
  (props.message.answer?.actions ?? [])
    .filter(action => action.type === 'draft_recipe')
    .map(action => normalizeDraftRecipe(action.recipe))
    .filter((draft): draft is NonNullable<typeof draft> => Boolean(draft)),
)
</script>

<template>
  <div class="assistant-message" :class="`is-${message.role}`">
    <div v-if="message.role === 'assistant'" class="assistant-avatar" aria-hidden="true">
      🍳
    </div>

    <div class="assistant-bubble" :class="{ 'is-error': message.error }">
      <!-- 纯文本段落渲染，不解析 HTML -->
      <p v-for="(paragraph, index) in message.answer?.answer ?? [message.content]" :key="index">
        {{ paragraph }}
      </p>

      <ul v-if="message.matches?.length" class="assistant-recipes">
        <AssistantRecipeCard
          v-for="match in message.matches"
          :key="match.recipe.id"
          :match="match"
          :why="message.answer?.picked.find(pick => Number(pick.id) === Number(match.recipe.id))?.why"
          @open="$emit('openRecipe', match)"
        />
      </ul>

      <p v-if="message.answer?.needs?.length" class="assistant-needs">
        还缺：{{ message.answer.needs.join('、') }}
      </p>

      <p v-for="(result, index) in message.actionResults" :key="`result-${index}`" class="assistant-action-result" role="status">
        {{ result }}
      </p>

      <div v-if="drafts.length" class="assistant-drafts">
        <AssistantRecipeDraftCard
          v-for="(draft, draftIndex) in drafts"
          :key="`${draft.name}-${draftIndex}`"
          :draft="draft"
          :status="message.draftStatus"
          @save="$emit('saveDraft', draftIndex)"
          @edit="$emit('editDraft', draftIndex)"
        />
      </div>

      <div v-if="message.answer?.followups?.length" class="assistant-followups">
        <button
          v-for="text in message.answer.followups"
          :key="text"
          type="button"
          class="assistant-followup"
          @click="$emit('followup', text)"
        >
          {{ text }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.assistant-message {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  /* 消息是 flex 行的子项，同样要允许收缩，否则窄屏会横向溢出 */
  min-width: 0;
}
.assistant-message.is-user {
  justify-content: flex-end;
}
.assistant-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  margin-top: 2px;
  border-radius: var(--r-pill);
  background: var(--c-emoji-wash);
  font-size: 15px;
}
.assistant-bubble {
  /* flex 子项默认 min-width:auto，会被 nowrap 的菜谱卡片撑破容器，必须允许收缩 */
  min-width: 0;
  max-width: min(100%, 34em);
  overflow-wrap: break-word;
  padding: 12px 14px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-lg);
  background: var(--c-surface);
  color: var(--c-ink);
  font-size: var(--fs-base);
  line-height: 1.7;
}
.is-user .assistant-bubble {
  border-color: var(--c-brand);
  background: var(--c-brand);
  color: var(--c-brand-contrast);
}
.assistant-bubble.is-error {
  border-color: color-mix(in srgb, var(--c-alert) 40%, transparent);
  background: color-mix(in srgb, var(--c-alert) 8%, var(--c-surface));
  color: var(--c-alert);
}
.assistant-bubble p {
  margin: 0;
  white-space: pre-wrap;
}
.assistant-bubble p + p,
.assistant-bubble p + ul,
.assistant-bubble ul + p {
  margin-top: 10px;
}
.assistant-recipes {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
}
.assistant-needs {
  color: var(--c-warn);
  font-size: var(--fs-sm);
}
.assistant-action-result {
  margin: 10px 0 0;
  color: var(--c-herb);
  font-size: var(--fs-sm);
}
.assistant-drafts {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.assistant-followups {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.assistant-followup {
  min-height: 36px;
  padding: 6px 12px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-pill);
  background: var(--c-paper-alt);
  color: var(--c-ink-2);
  font-family: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    background-color var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}
.assistant-followup:hover {
  border-color: var(--c-rule-strong);
  color: var(--c-ink);
}
.assistant-followup:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}
</style>
