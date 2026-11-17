<script lang="ts" setup>
import type { AssistantRecipeDraft } from '~/utils/assistantActions'
import { getCustomRecipe } from '~/composables/store/customRecipe'

const props = defineProps<{
  draft: AssistantRecipeDraft
  status?: 'pending' | 'saved' | 'error'
  savedId?: string
}>()

defineEmits<{ save: [], edit: [] }>()

const existing = computed(() => props.draft.editId ? getCustomRecipe(props.draft.editId) : undefined)
const saved = computed(() => props.status === 'saved')
const note = computed(() => props.draft.note.trim())
</script>

<template>
  <div class="assistant-draft" :class="{ 'is-saved': saved }">
    <p class="assistant-draft-label">
      {{ existing ? `修改草稿 · 将覆盖你已有的《${existing.name}》` : '菜谱草稿' }}
    </p>
    <p class="assistant-draft-name">
      {{ draft.name }}
    </p>
    <p class="assistant-draft-field">
      食材：{{ draft.stuff.join('、') }}
    </p>
    <p v-if="draft.tools.length" class="assistant-draft-field">
      厨具：{{ draft.tools.join('、') }}
    </p>
    <p v-if="note" class="assistant-draft-note">
      {{ note }}
    </p>
    <div v-if="!saved" class="assistant-draft-actions">
      <button type="button" class="assistant-draft-save" @click="$emit('save')">
        保存到我的菜谱
      </button>
      <button type="button" class="assistant-draft-edit" @click="$emit('edit')">
        去编辑
      </button>
    </div>
    <p v-else class="assistant-draft-saved" role="status">
      已保存到我的菜谱，可继续在表单里补充做法链接。
    </p>
  </div>
</template>

<style scoped>
.assistant-draft {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-paper-alt);
}
.assistant-draft.is-saved {
  border-color: color-mix(in srgb, var(--c-herb) 40%, transparent);
}
.assistant-draft-label {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
}
.assistant-draft-name {
  margin: 0;
  color: var(--c-ink);
  font-size: var(--fs-md);
  font-weight: 600;
}
.assistant-draft-field {
  margin: 0;
  color: var(--c-ink-2);
  font-size: var(--fs-sm);
  overflow-wrap: anywhere;
}
.assistant-draft-note {
  margin: 0;
  color: var(--c-ink-2);
  font-size: var(--fs-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.assistant-draft-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.assistant-draft-save,
.assistant-draft-edit {
  min-height: 36px;
  padding: 6px 14px;
  border-radius: var(--r-pill);
  border: 1px solid var(--c-brand);
  font-family: inherit;
  font-size: var(--fs-sm);
  cursor: pointer;
  transition:
    background-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}
.assistant-draft-save {
  background: var(--c-brand);
  color: var(--c-brand-contrast);
}
.assistant-draft-save:hover {
  background: var(--c-brand-ink);
  border-color: var(--c-brand-ink);
}
.assistant-draft-edit {
  background: transparent;
  color: var(--c-brand-ink);
}
.assistant-draft-edit:hover {
  background: color-mix(in srgb, var(--c-brand) 10%, transparent);
}
.assistant-draft-save:focus-visible,
.assistant-draft-edit:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}
.assistant-draft-saved {
  margin: 0;
  color: var(--c-herb);
  font-size: var(--fs-sm);
}
</style>
