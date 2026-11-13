<script lang="ts" setup>
import { showAlert } from '~/utils/dialog'

definePageMeta({
  layout: 'child',
  title: '助手设置',
})

interface AssistantConfig {
  configured: boolean
  enabled: boolean
  baseUrl: string
  model: string
  keyHint: string
  source: 'user' | 'server' | 'none'
  serverModel: string
}

const account = useAccount()

const config = ref<AssistantConfig | null>(null)
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const errorMessage = ref('')
const successMessage = ref('')

const baseUrl = ref('https://api.deepseek.com/v1')
const model = ref('deepseek-chat')
const apiKey = ref('')
const enabled = ref(true)
const models = ref<string[]>([])
const loadingModels = ref(false)
const modelListError = ref('')

const providerPresets = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
]

const canSubmit = computed(() => Boolean(account.isAuthenticated.value) && !saving.value && !testing.value)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const response = await fetch('/api/assistant/config', { credentials: 'same-origin' })
    if (response.status === 401) {
      config.value = null
      return
    }
    const body = await response.json() as AssistantConfig
    config.value = body
    if (body.baseUrl)
      baseUrl.value = body.baseUrl
    if (body.model)
      model.value = body.model
  }
  catch {
    errorMessage.value = '无法读取当前配置'
  }
  finally {
    loading.value = false
  }
}

function applyPreset(preset: typeof providerPresets[number]): void {
  baseUrl.value = preset.baseUrl
  model.value = preset.model
}

async function fetchModels(): Promise<void> {
  modelListError.value = ''
  if (!baseUrl.value.trim()) {
    modelListError.value = '请先填写服务地址'
    return
  }
  if (!apiKey.value.trim() && !config.value?.keyHint) {
    modelListError.value = '请先填写 API Key'
    return
  }
  loadingModels.value = true
  try {
    const response = await fetch('/api/assistant/models', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: baseUrl.value.trim(), apiKey: apiKey.value.trim() }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok)
      throw new Error(body?.error || `获取失败（${response.status}）`)
    models.value = body.models ?? []
    if (!models.value.includes(model.value) && models.value.length)
      model.value = models.value[0]!
    void yunleHaptic('success')
  }
  catch (error) {
    models.value = []
    modelListError.value = error instanceof Error ? error.message : '获取模型列表失败'
  }
  finally {
    loadingModels.value = false
  }
}

async function testConnection(): Promise<void> {
  errorMessage.value = ''
  successMessage.value = ''
  if (!baseUrl.value.trim() || !model.value.trim()) {
    errorMessage.value = '请先填写服务地址和模型名称'
    return
  }
  if (!apiKey.value.trim() && !config.value?.keyHint) {
    errorMessage.value = '请先填写 API Key'
    return
  }
  testing.value = true
  try {
    const response = await fetch('/api/assistant/config/test', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: baseUrl.value.trim(), model: model.value.trim(), apiKey: apiKey.value.trim() }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok)
      throw new Error(body?.error || `测试失败（${response.status}）`)
    successMessage.value = '连接成功，可以保存了'
    void yunleHaptic('success')
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '测试失败'
  }
  finally {
    testing.value = false
  }
}

async function save(): Promise<void> {
  errorMessage.value = ''
  successMessage.value = ''
  if (!baseUrl.value.trim() || !model.value.trim()) {
    errorMessage.value = '请填写服务地址和模型名称'
    return
  }
  if (!apiKey.value.trim() && !config.value?.keyHint) {
    errorMessage.value = '请填写 API Key'
    return
  }
  saving.value = true
  try {
    const response = await fetch('/api/assistant/config', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        apiKey: apiKey.value.trim(),
        enabled: enabled.value,
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok)
      throw new Error(body?.error || '保存失败')
    apiKey.value = ''
    successMessage.value = '已保存。回到料理助手就能使用了。'
    void yunleHaptic('success')
    await load()
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '保存失败'
  }
  finally {
    saving.value = false
  }
}

async function clearConfig(): Promise<void> {
  saving.value = true
  try {
    const response = await fetch('/api/assistant/config', { method: 'DELETE', credentials: 'same-origin' })
    if (!response.ok)
      throw new Error('清除失败')
    config.value = null
    apiKey.value = ''
    successMessage.value = '已清除，将使用服务器的默认配置'
    void yunleHaptic('success')
    await load()
  }
  catch (error) {
    await showAlert('清除失败', error instanceof Error ? error.message : '请稍后重试')
  }
  finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/my" />
        </ion-buttons>
        <ion-title>助手设置</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div class="assistant-settings">
        <p v-if="!account.isAuthenticated.value" class="settings-note">
          登录后才能保存自己的模型配置。未登录时助手不可用。
        </p>

        <template v-else>
          <p v-if="loading" class="settings-note">
            正在读取当前配置…
          </p>

          <template v-else>
            <p v-if="config?.source === 'server'" class="settings-note">
              当前使用服务器提供的模型（{{ config.serverModel || '已配置' }}）。填写下面的内容可以改用你自己的模型。
            </p>
            <p v-else-if="config?.source === 'user'" class="settings-note">
              当前使用你自己的模型配置。
            </p>
            <p v-else class="settings-note settings-warn">
              还没有可用的模型配置，助手暂时不可用。
            </p>

            <h2 class="settings-section">
              快速填入
            </h2>
            <div class="settings-presets">
              <button
                v-for="preset in providerPresets"
                :key="preset.label"
                type="button"
                class="cook-btn cook-btn--secondary cook-btn--sm"
                @click="applyPreset(preset)"
              >
                {{ preset.label }}
              </button>
            </div>

            <form class="settings-form" @submit.prevent="save">
              <label class="settings-field">
                <span>服务地址</span>
                <input v-model="baseUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://api.deepseek.com/v1">
                <small class="settings-field-help">填 base URL 或完整的 /chat/completions 地址都可以。</small>
              </label>

              <label class="settings-field">
                <span>API Key</span>
                <input
                  v-model="apiKey"
                  type="password"
                  autocomplete="off"
                  spellcheck="false"
                  :placeholder="config?.keyHint ? `已保存 ${config.keyHint}，留空则不修改` : 'sk-...'"
                >
              </label>

              <div class="settings-field">
                <span>模型</span>
                <div class="settings-model-row">
                  <input
                    v-model="model"
                    type="text"
                    autocomplete="off"
                    list="assistant-models"
                    placeholder="deepseek-chat"
                  >
                  <button
                    type="button"
                    class="cook-btn cook-btn--secondary cook-btn--sm settings-model-fetch"
                    :disabled="loadingModels"
                    :aria-busy="loadingModels"
                    @click="fetchModels"
                  >
                    <ion-spinner v-if="loadingModels" class="cook-btn__spinner" name="crescent" />
                    <span class="cook-btn__label">{{ loadingModels ? '获取中' : '获取模型' }}</span>
                  </button>
                </div>
                <datalist id="assistant-models">
                  <option v-for="name in models" :key="name" :value="name" />
                </datalist>
                <p v-if="modelListError" class="settings-model-hint settings-model-error">
                  {{ modelListError }}
                </p>
                <p v-else-if="models.length" class="settings-model-hint">
                  已获取 {{ models.length }} 个模型，可从下拉里选，也可以手动填写。
                </p>
                <p v-else class="settings-model-hint">
                  填好地址和 Key 后点「获取模型」，服务商不支持列表时可以直接手填。
                </p>
              </div>

              <label class="settings-toggle">
                <input v-model="enabled" type="checkbox">
                <span>启用这个模型配置</span>
              </label>

              <p v-if="errorMessage" class="settings-error" role="alert">
                {{ errorMessage }}
              </p>
              <p v-else-if="successMessage" class="settings-success" role="status">
                {{ successMessage }}
              </p>

              <div class="settings-actions">
                <button
                  type="button"
                  class="cook-btn cook-btn--secondary"
                  :disabled="saving || testing"
                  :aria-busy="testing"
                  @click="testConnection"
                >
                  <ion-spinner v-if="testing" class="cook-btn__spinner" name="crescent" />
                  <span class="cook-btn__label">{{ testing ? '测试中' : '测试连接' }}</span>
                </button>
                <button
                  type="submit"
                  class="cook-btn cook-btn--primary"
                  :disabled="!canSubmit"
                  :aria-busy="saving"
                >
                  <ion-spinner v-if="saving" class="cook-btn__spinner" name="crescent" />
                  <span class="cook-btn__label">{{ saving ? '保存中' : '保存' }}</span>
                </button>
              </div>

              <button
                v-if="config?.source === 'user'"
                type="button"
                class="cook-btn cook-btn--danger cook-btn--block settings-clear"
                :disabled="saving"
                @click="clearConfig"
              >
                清除我的配置
              </button>
            </form>

            <p class="settings-footnote">
              Key 加密保存在你自己的服务器上，页面不会回显完整 Key。请求由服务器转发给模型服务商；你提问时的食材、厨具、调料与收藏菜名会一并发送。
            </p>
          </template>
        </template>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.assistant-settings {
  max-width: 560px;
  margin: 0 auto;
  padding: 20px 20px 48px;
}
.settings-note {
  margin: 0 0 18px;
  color: var(--c-ink-2);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
.settings-warn {
  color: var(--c-warn);
}
.settings-section {
  margin: 0 0 10px;
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.settings-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
}
.settings-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.settings-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--c-ink-2);
  font-size: var(--fs-sm);
}
.settings-field input {
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-paper-sunk);
  color: var(--c-ink);
  font-family: inherit;
  font-size: var(--fs-base);
}
.settings-field input:focus {
  border-color: var(--c-brand);
  outline: 2px solid color-mix(in srgb, var(--c-brand) 30%, transparent);
  outline-offset: 1px;
}
.settings-model-row {
  display: flex;
  gap: 8px;
}
.settings-model-row input {
  flex: 1;
  min-width: 0;
}
.settings-model-fetch {
  flex: none;
  min-height: 48px;
}
.settings-field-help,
.settings-model-hint {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-xs);
  line-height: 1.6;
}
.settings-model-error {
  color: var(--c-alert);
}
.settings-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  color: var(--c-ink-2);
  font-size: var(--fs-base);
}
.settings-error {
  margin: 0;
  color: var(--c-alert);
  font-size: var(--fs-sm);
}
.settings-success {
  margin: 0;
  color: var(--c-herb);
  font-size: var(--fs-sm);
}
.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.settings-actions .cook-btn {
  flex: 1;
  min-width: 140px;
}
.settings-clear {
  margin-top: 4px;
}
.settings-footnote {
  margin: 20px 0 0;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
</style>
