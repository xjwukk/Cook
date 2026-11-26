<script lang="ts" setup>
import type { AssistantAttachment } from '~/utils/assistantImages'
import { prepareImages } from '~/utils/assistantImages'

const props = defineProps<{
  disabled?: boolean
  sending?: boolean
  placeholder?: string
  /** 禁用原因，展示在输入框上方 */
  hint?: string
  /** 是否可以附图（助手已配置模型） */
  visionAvailable?: boolean
}>()

const emit = defineEmits<{ send: [text: string, attachments: AssistantAttachment[]] }>()

const text = ref('')
const attachments = ref<AssistantAttachment[]>([])
const imageError = ref('')
const fileInput = ref<HTMLInputElement>()

const canSend = computed(() =>
  (text.value.trim().length > 0 || attachments.value.length > 0) && !props.disabled && !props.sending,
)

function submit(): void {
  if (!canSend.value)
    return
  emit('send', text.value.trim(), attachments.value)
  text.value = ''
  attachments.value = []
  imageError.value = ''
}

/** 统一的图片入口：选择、粘贴、拖拽都走这里。 */
async function addFiles(files: FileList | File[] | null): Promise<void> {
  if (!files || !files.length)
    return
  const { images, errors } = await prepareImages(files, attachments.value)
  attachments.value = [...attachments.value, ...images]
  imageError.value = errors.join('；')
}

async function onFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  await addFiles(input.files)
  input.value = ''
}

async function onPaste(event: ClipboardEvent): Promise<void> {
  const items = event.clipboardData?.items
  if (!items?.length)
    return
  const files: File[] = []
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file)
        files.push(file)
    }
  }
  if (!files.length)
    return
  event.preventDefault()
  await addFiles(files)
}

async function onDrop(event: DragEvent): Promise<void> {
  if (!event.dataTransfer?.files?.length)
    return
  event.preventDefault()
  await addFiles(event.dataTransfer.files)
}

function removeAttachment(id: string): void {
  attachments.value = attachments.value.filter(item => item.id !== id)
}
</script>

<template>
  <div
    class="assistant-composer"
    @dragover.prevent
    @drop="onDrop"
  >
    <p v-if="hint" class="assistant-composer-hint" role="status">
      {{ hint }}
    </p>
    <p v-if="imageError" class="assistant-composer-error" role="alert">
      {{ imageError }}
    </p>

    <AssistantImageStrip
      v-if="attachments.length"
      :images="attachments"
      removable
      @remove="removeAttachment"
    />

    <div class="assistant-composer-row">
      <button
        v-if="visionAvailable"
        type="button"
        class="assistant-composer-attach"
        :disabled="disabled || sending"
        aria-label="添加图片"
        @click="fileInput?.click()"
      >
        <ion-icon :icon="ioniconsImageOutline" aria-hidden="true" />
      </button>
      <input
        ref="fileInput"
        type="file"
        accept="image/*"
        multiple
        class="assistant-composer-file"
        aria-hidden="true"
        tabindex="-1"
        @change="onFileChange"
      >

      <textarea
        v-model="text"
        class="assistant-composer-input"
        :disabled="disabled"
        :placeholder="disabled ? (hint || '暂时无法提问') : (placeholder || '问点什么')"
        rows="1"
        enterkeyhint="send"
        aria-label="向料理助手提问"
        @keydown.enter.exact.prevent="submit"
        @paste="onPaste"
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
.assistant-composer-error {
  margin: 0;
  color: var(--c-alert);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.assistant-composer-row {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}
.assistant-composer-attach {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  flex: none;
  padding: 0;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-paper-sunk);
  color: var(--c-ink-2);
  font-size: 22px;
  cursor: pointer;
  transition:
    border-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
}
.assistant-composer-attach:hover:not(:disabled) {
  border-color: var(--c-rule-strong);
  color: var(--c-ink);
}
.assistant-composer-attach:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}
.assistant-composer-attach:disabled {
  opacity: var(--cook-btn-disabled-opacity);
  cursor: not-allowed;
}
.assistant-composer-file {
  display: none;
}
.assistant-composer-input {
  flex: 1;
  min-width: 0;
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
