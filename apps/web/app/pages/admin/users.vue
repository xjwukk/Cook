<script lang="ts" setup>
import dayjs from 'dayjs'
import { confirmDestructive, promptPassword, showAlert } from '~/utils/dialog'

definePageMeta({
  layout: 'child',
  title: '用户管理',
})

interface AdminUser {
  id: number
  username: string
  role: 'admin' | 'user'
  createdAt: number
  dataUpdatedAt: number | null
}

const { user, isAuthenticated } = useAccount()
const router = useRouter()

const users = ref<AdminUser[]>([])
const loading = ref(true)
const error = ref('')

async function load(): Promise<void> {
  error.value = ''
  loading.value = true
  try {
    const response = await fetch('/api/admin/users', { credentials: 'same-origin' })
    if (response.status === 401 || response.status === 403) {
      await router.replace('/my')
      return
    }
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    users.value = (await response.json()).users
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '加载失败'
  }
  finally {
    loading.value = false
  }
}

watch(isAuthenticated, (value) => {
  if (!value && user.value === null)
    void router.replace('/my')
  else
    void load()
}, { immediate: true })

async function removeUser(item: AdminUser): Promise<void> {
  if (!await confirmDestructive({
    header: `删除账号「${item.username}」？`,
    message: '该账号的收藏和历史会一并删除，无法恢复。',
    confirmText: '删除账号',
  })) {
    return
  }
  const response = await fetch(`/api/admin/users/${item.id}`, { method: 'DELETE', credentials: 'same-origin' })
  if (response.status === 204) {
    users.value = users.value.filter(entry => entry.id !== item.id)
    void yunleHaptic('success')
    return
  }
  const body = await response.json().catch(() => ({}))
  await showAlert('删除失败', body?.error || '请稍后重试')
}

async function resetPassword(item: AdminUser): Promise<void> {
  const next = await promptPassword({
    header: `重置「${item.username}」的密码`,
    message: '输入新密码，至少 8 位。对方需要用新密码重新登录。',
    okText: '重置',
  })
  if (!next)
    return
  const response = await fetch(`/api/admin/users/${item.id}/password`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword: next }),
  })
  if (response.status === 204) {
    void yunleHaptic('success')
    await showAlert('已重置', '对方下次登录请使用新密码。')
    return
  }
  const body = await response.json().catch(() => ({}))
  await showAlert('重置失败', body?.error || '请稍后重试')
}
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/my" />
        </ion-buttons>
        <ion-title>用户管理</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <p v-if="loading" class="admin-status">
        正在加载账号…
      </p>
      <p v-else-if="error" class="admin-status admin-error" role="alert">
        {{ error }}
      </p>

      <ion-list v-else :inset="true">
        <ion-item v-for="item in users" :key="item.id">
          <ion-label>
            <h2>
              {{ item.username }}
              <ion-note v-if="item.role === 'admin'" class="admin-role">
                管理员
              </ion-note>
            </h2>
            <p>
              注册于 {{ dayjs(item.createdAt).format('YYYY-MM-DD HH:mm') }}
              <template v-if="item.dataUpdatedAt">
                · 数据更新于 {{ dayjs(item.dataUpdatedAt).format('YYYY-MM-DD HH:mm') }}
              </template>
            </p>
          </ion-label>
          <div slot="end" class="admin-row-actions">
            <button type="button" class="cook-btn cook-btn--quiet cook-btn--xs" @click="resetPassword(item)">
              重置密码
            </button>
            <button
              type="button"
              class="cook-btn cook-btn--quiet cook-btn--xs admin-row-danger"
              :disabled="item.id === user?.id"
              @click="removeUser(item)"
            >
              删除
            </button>
          </div>
        </ion-item>
      </ion-list>

      <p class="admin-footnote">
        管理员只能查看账号列表，不能查看其他用户的收藏与历史内容。
      </p>
    </ion-content>
  </ion-page>
</template>

<style scoped>
.admin-status {
  margin: 24px 20px;
  color: var(--c-ink-2);
  font-size: var(--fs-base);
}
.admin-error {
  color: var(--c-alert);
}
.admin-role {
  margin-inline-start: 6px;
  color: var(--c-brand-ink);
  font-size: var(--fs-xs);
}
/* 行内操作：主操作文字化，危险操作只靠颜色区分，不做实心按钮 */
.admin-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}
.admin-row-danger {
  color: var(--c-alert);
  text-decoration-color: color-mix(in srgb, var(--c-alert) 40%, transparent);
}
.admin-row-danger:hover {
  color: var(--c-alert);
  text-decoration-color: currentcolor;
}
.admin-footnote {
  margin: 8px 24px 48px;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
</style>
