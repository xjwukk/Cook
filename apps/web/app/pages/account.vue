<script lang="ts" setup>
import { migrateAnonymousStorage } from '~/utils/storageScope'

definePageMeta({
  layout: 'child',
  title: '账号',
})

const { user, isAuthenticated, errorMessage, busy, login, register, logout, clearError } = useAccount()
const router = useRouter()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const inviteCode = ref('')
const localError = ref('')

const submitting = computed(() => busy.value)

function switchMode(next: 'login' | 'register'): void {
  mode.value = next
  localError.value = ''
  clearError()
}

async function submit(): Promise<void> {
  localError.value = ''
  const name = username.value.trim()
  if (!name || !password.value) {
    localError.value = '请填写用户名和密码'
    return
  }
  if (mode.value === 'register' && password.value.length < 8) {
    localError.value = '密码至少 8 位'
    return
  }
  if (mode.value === 'register' && !inviteCode.value.trim()) {
    localError.value = '请填写邀请码'
    return
  }

  const ok = mode.value === 'login'
    ? await login(name, password.value)
    : await register(name, password.value, inviteCode.value.trim())

  if (!ok)
    return

  // 登录态由 Cookie 维护：先把匿名数据复制到该账号，再刷新让本机存储切换命名空间。
  if (user.value?.id)
    migrateAnonymousStorage(user.value.id)
  password.value = ''
  inviteCode.value = ''
  void yunleHaptic('success')
  router.replace('/my')
  setTimeout(() => window.location.reload(), 0)
}

async function signOut(): Promise<void> {
  await logout()
  void yunleHaptic('light')
  router.replace('/my')
  setTimeout(() => window.location.reload(), 0)
}

// 已登录时进入本页，直接给出退出入口，避免误以为要重新登录。
const signedIn = computed(() => isAuthenticated.value)

const currentPassword = ref('')
const newPassword = ref('')
const passwordMessage = ref('')
const passwordError = ref('')
const changingPassword = ref(false)

async function changePassword(): Promise<void> {
  passwordMessage.value = ''
  passwordError.value = ''
  if (!currentPassword.value || !newPassword.value) {
    passwordError.value = '请填写当前密码和新密码'
    return
  }
  if (newPassword.value.length < 8) {
    passwordError.value = '新密码至少 8 位'
    return
  }
  changingPassword.value = true
  try {
    const response = await fetch('/api/auth/password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value }),
    })
    if (response.status === 204) {
      currentPassword.value = ''
      newPassword.value = ''
      passwordMessage.value = '密码已更新'
      void yunleHaptic('success')
      return
    }
    const body = await response.json().catch(() => ({}))
    passwordError.value = body?.error || '修改失败，请稍后重试'
  }
  catch {
    passwordError.value = '无法连接服务器，请稍后重试'
  }
  finally {
    changingPassword.value = false
  }
}

const isAdmin = computed(() => user.value?.role === 'admin')
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/my" />
        </ion-buttons>
        <ion-title>账号</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <div class="account-shell">
        <template v-if="signedIn">
          <h1 class="account-title">
            已登录
          </h1>
          <p class="account-subtitle">
            {{ user?.username }}
          </p>
          <p class="account-hint">
            收藏和历史会在这台设备和服务器之间同步。
          </p>

          <form class="account-form account-password" @submit.prevent="changePassword">
            <h2 class="account-section-title">
              修改密码
            </h2>
            <label class="account-field">
              <span>当前密码</span>
              <input v-model="currentPassword" type="password" autocomplete="current-password">
            </label>
            <label class="account-field">
              <span>新密码</span>
              <input v-model="newPassword" type="password" autocomplete="new-password" minlength="8">
            </label>
            <p v-if="passwordError" class="account-error" role="alert">
              {{ passwordError }}
            </p>
            <p v-else-if="passwordMessage" class="account-success" role="status">
              {{ passwordMessage }}
            </p>
            <button
              type="submit"
              class="cook-btn cook-btn--secondary cook-btn--block"
              :aria-busy="changingPassword"
              :disabled="changingPassword"
            >
              <ion-spinner v-if="changingPassword" class="cook-btn__spinner" name="crescent" />
              <span class="cook-btn__label">更新密码</span>
            </button>
          </form>

          <div class="account-actions">
            <NuxtLink v-if="isAdmin" class="cook-btn cook-btn--quiet" to="/admin/users">
              用户管理
            </NuxtLink>
            <button
              type="button"
              class="cook-btn cook-btn--danger"
              :disabled="submitting"
              @click="signOut"
            >
              退出登录
            </button>
          </div>
        </template>

        <template v-else>
          <h1 class="account-title">
            {{ mode === 'login' ? '登录账号' : '注册账号' }}
          </h1>
          <p class="account-subtitle">
            {{ mode === 'login' ? '登录后收藏和历史可在多台设备间同步' : '账号保存在你自己的服务器上' }}
          </p>

          <div class="account-tabs" role="tablist" aria-label="登录或注册" :data-mode="mode">
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'login'"
              @click="switchMode('login')"
            >
              登录
            </button>
            <button
              type="button"
              role="tab"
              :aria-selected="mode === 'register'"
              @click="switchMode('register')"
            >
              注册
            </button>
          </div>

          <form class="account-form" @submit.prevent="submit">
            <label class="account-field">
              <span>用户名</span>
              <input
                v-model="username"
                type="text"
                autocomplete="username"
                autocapitalize="none"
                spellcheck="false"
                maxlength="32"
                required
              >
            </label>
            <label class="account-field">
              <span>密码</span>
              <input
                v-model="password"
                type="password"
                :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
                :minlength="mode === 'register' ? 8 : undefined"
                required
              >
            </label>
            <label v-if="mode === 'register'" class="account-field">
              <span>邀请码</span>
              <input
                v-model="inviteCode"
                type="text"
                autocomplete="off"
                required
              >
            </label>

            <p v-if="localError || errorMessage" class="account-error" role="alert">
              {{ localError || errorMessage }}
            </p>

            <button
              type="submit"
              class="cook-btn cook-btn--primary cook-btn--block"
              :aria-busy="submitting"
              :disabled="submitting"
            >
              <ion-spinner v-if="submitting" class="cook-btn__spinner" name="crescent" />
              <span class="cook-btn__label">{{ mode === 'login' ? '登录' : '注册并登录' }}</span>
            </button>
          </form>

          <p class="account-hint">
            未登录也能正常找菜：收藏和历史只保存在这台设备上。
          </p>
        </template>
      </div>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.account-shell {
  max-width: 420px;
  margin: 0 auto;
  padding: 28px 20px 48px;
}
.account-title {
  margin: 0;
  font-size: var(--fs-xl);
  font-weight: 650;
  color: var(--c-ink);
}
.account-subtitle {
  margin: 6px 0 22px;
  color: var(--c-ink-2);
  font-size: var(--fs-base);
}
/* 分段控件：滑动指示条在两段之间移动 */
.account-tabs {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 20px;
  padding: 4px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-pill);
  background: var(--c-paper-alt);
}
.account-tabs::before {
  position: absolute;
  top: 4px;
  bottom: 4px;
  left: 4px;
  width: calc(50% - 4px);
  border-radius: var(--r-pill);
  background: var(--c-surface);
  box-shadow: var(--shadow-1);
  content: '';
  transition: transform var(--dur-base) var(--ease-out);
}
.account-tabs[data-mode='register']::before {
  transform: translateX(100%);
}
.account-tabs button {
  position: relative;
  min-height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--c-ink-2);
  font-family: inherit;
  font-size: var(--fs-base);
  cursor: pointer;
  transition: color var(--dur-base) var(--ease-out);
}
.account-tabs button[aria-selected='true'] {
  color: var(--c-ink);
  font-weight: 600;
}
.account-tabs button:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
  border-radius: var(--r-pill);
}
.account-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.account-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--c-ink-2);
  font-size: var(--fs-sm);
}
.account-field input {
  min-height: 48px;
  padding: 0 14px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-paper-sunk);
  color: var(--c-ink);
  font-size: var(--fs-md);
}
.account-field input:focus {
  border-color: var(--c-brand);
  outline: 2px solid color-mix(in srgb, var(--c-brand) 30%, transparent);
  outline-offset: 1px;
}
.account-error {
  margin: 0;
  color: var(--c-alert);
  font-size: var(--fs-sm);
}
.account-success {
  margin: 0;
  color: var(--c-herb);
  font-size: var(--fs-sm);
}
.account-section-title {
  margin: 0;
  font-size: var(--fs-md);
  font-weight: 600;
  color: var(--c-ink);
}
.account-password {
  margin-top: 28px;
  padding-top: 22px;
  border-top: 1px solid var(--c-rule);
}
/* 次要操作并排一行，且都降权：危险操作不与主操作争视线 */
.account-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 20px;
}
.account-hint {
  margin-top: 20px;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
.account-tabs button:focus-visible,
ion-button:focus-visible {
  outline: 2px solid var(--c-brand);
  outline-offset: 2px;
}
</style>
