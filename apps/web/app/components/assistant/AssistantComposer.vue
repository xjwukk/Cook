<script lang="ts" setup>
const props = defineProps<{
  disabled?: boolean
  sending?: boolean
  placeholder?: string
  /** 禁用原因，展示在输入框上方 */
  hint?: string
}>()

const emit = defineEmits<{ send: [text: string] }>()

const text = ref('')
const canSend = computed(() => text.value.trim().length > 0 && !props.disabled && !props.sending)

function submit(): void {
  if (!canSend.value)
    return
  emit('send', text.value.trim())
  text.value = ''
}
</script>

<template>
  <div class="assistant-composer">
    <p v-if="hint" class="assistant-composer-hint" role="status">
      {{ hint }}
    </p>
    <div class="assistant-composer-row">
      <textarea
        v-model="text"
        class="assistant-composer-input"
        :disabled="disabled"
        :placeholder="disabled ? (hint || '暂时无法提问') : (placeholder || '问点什么')"
        rows="1"
        enterkeyhint="send"
        aria-label="向料理助手提问"
        @keydown.enter.exact.prevent="submit"
      />
      <button
        type="button"
        class="cook-btn cook-btn--primary assistant-composer-send"
        :disabled="!canSend"
        :aria-busy="sending"
        :aria-label="sending ? '正在回答' : '发送'"
        @click="submit"
      >
        <ion-spinner v-if="sending" class="cook-btn__spinner" name="crescent" />
        <span class="cook-btn__label">{{ sending ? '回答中' : '发送' }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.assistant-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.assistant-composer-hint {
  margin: 0;
  color: var(--c-warn);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.assistant-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.assistant-composer-input {
  flex: 1;
  min-height: 48px;
  max-height: 140px;
  padding: 12px 14px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-paper-sunk);
  color: var(--c-ink);
  font-family: inherit;
  font-size: var(--fs-base);
  line-height: 1.5;
  resize: none;
}
.assistant-composer-input:focus {
  border-color: var(--c-brand);
  outline: 2px solid color-mix(in srgb, var(--c-brand) 30%, transparent);
  outline-offset: 1px;
}
.assistant-composer-input:disabled {
  opacity: var(--cook-btn-disabled-opacity);
  cursor: not-allowed;
}
.assistant-composer-send {
  flex: none;
  min-width: 88px;
}
</style>
