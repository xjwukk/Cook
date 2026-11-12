import { createSharedComposable, watchDebounced } from '@vueuse/core'
import { favoriteEntries } from '~/composables/store/favorite'
import { recipeHistories } from '~/composables/store/history'
import { useKitchenStore } from '~/composables/store/kitchen'
import { readLocalUserData, writeLocalUserData } from '~/composables/store/userData'
import { userDataMeta } from '~/composables/store/userDataMeta'
import { storageUid } from '~/utils/storageScope'
import {
  createEmptyUserData,
  isSameUserData,
  mergeUserData,
  normalizeUserData,
} from '~/utils/userData'

type SyncStatus = 'idle' | 'syncing' | 'synced' | 'error'

/**
 * 收藏与历史的跨设备同步：本地优先，登录后与服务器合并，改动防抖上传。
 * 服务端只存整份数据，合并规则与导出/导入共用 mergeUserData。
 */
export const useAccountSync = createSharedComposable(() => {
  const account = useAccount()
  const kitchen = useKitchenStore()
  const status = ref<SyncStatus>('idle')
  const lastSyncedAt = ref(0)
  const errorMessage = ref('')
  let running: Promise<void> | undefined
  let lastUploadedJson = ''
  let pendingUpload = false
  let uploading = false

  function reset(): void {
    status.value = 'idle'
    lastSyncedAt.value = 0
    errorMessage.value = ''
    lastUploadedJson = ''
    // 登出后不得让上一个账号遗留的待传标记触发一次多余上传。
    pendingUpload = false
  }

  async function readRemote(): Promise<{ data: ReturnType<typeof createEmptyUserData> | null, updatedAt: number } | null> {
    try {
      const response = await fetch('/api/user-data', { credentials: 'same-origin' })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      const body = await response.json() as { data: unknown, updatedAt?: number }
      if (body.data == null)
        return { data: null, updatedAt: 0 }
      const normalized = normalizeUserData(body.data)
      if (!normalized)
        throw new Error('云端数据格式无法识别')
      return { data: normalized, updatedAt: Number(body.updatedAt) || 0 }
    }
    catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '同步失败'
      return null
    }
  }

  function isCurrentScope(): boolean {
    return !!account.user.value && storageUid === String(account.user.value.id)
  }

  async function upload(data = readLocalUserData()): Promise<boolean> {
    if (!isCurrentScope())
      return false
    const json = JSON.stringify(data)
    if (json === lastUploadedJson)
      return true
    try {
      const response = await fetch('/api/user-data', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      lastUploadedJson = json
      lastSyncedAt.value = Date.now()
      return true
    }
    catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '上传失败'
      return false
    }
  }

  async function run(forceMerge?: boolean): Promise<void> {
    const user = account.user.value
    if (!user || !isCurrentScope())
      return
    if (running)
      return running

    status.value = 'syncing'
    errorMessage.value = ''
    running = (async () => {
      const remote = await readRemote()
      if (!isCurrentScope() || account.user.value?.id !== user.id)
        return
      if (!remote) {
        status.value = 'error'
        return
      }

      const lastUid = userDataMeta.value.lastUid
      // 首次登录把本机数据并入账号；切换账号时不把上一个账号的数据带过去。
      const mergeLocal = forceMerge ?? (lastUid === '' || lastUid === String(user.id))
      const local = readLocalUserData()
      const data = mergeLocal
        ? mergeUserData(local, remote.data ?? createEmptyUserData())
        : (remote.data ?? createEmptyUserData())

      writeLocalUserData(data)
      userDataMeta.value = { ...userDataMeta.value, lastUid: String(user.id) }

      if (!remote.data || !isSameUserData(data, remote.data)) {
        if (!await upload(data)) {
          status.value = 'error'
          return
        }
      }
      else {
        lastUploadedJson = JSON.stringify(data)
        lastSyncedAt.value = Date.now()
      }
      status.value = 'synced'
    })().catch((error) => {
      errorMessage.value = error instanceof Error ? error.message : '同步失败'
      status.value = 'error'
    }).finally(() => {
      running = undefined
      if (pendingUpload)
        void flushUploads()
    })

    return running
  }

  const syncNow = () => run(true)

  async function flushUploads(): Promise<void> {
    if (running || uploading || !isCurrentScope())
      return
    uploading = true
    let succeeded = false
    try {
      while (pendingUpload && isCurrentScope()) {
        pendingUpload = false
        status.value = 'syncing'
        const snapshot = readLocalUserData()
        const ok = await upload(snapshot)
        if (!ok) {
          status.value = 'error'
          break
        }
        succeeded = true
        // A slow PUT must not swallow edits made while its snapshot was in flight.
        pendingUpload ||= !isSameUserData(snapshot, readLocalUserData())
        status.value = 'synced'
      }
    }
    catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '同步失败'
      status.value = 'error'
    }
    finally {
      uploading = false
      // A watcher may have set pendingUpload while the last upload was in flight,
      // and its flushUploads() call was skipped because uploading was still true.
      // Only retry after a successful upload, so a failing network cannot loop.
      if (succeeded && pendingUpload && !running && isCurrentScope())
        void flushUploads()
    }
  }

  watchDebounced(
    [favoriteEntries, recipeHistories, userDataMeta, () => kitchen.data],
    () => {
      if (!account.isAuthenticated.value || !isCurrentScope())
        return
      pendingUpload = true
      void flushUploads()
    },
    { debounce: 1500, deep: true },
  )

  watch(() => account.user.value?.id, (id) => {
    if (id)
      void run()
    else
      reset()
  }, { immediate: true })

  return {
    status: readonly(status),
    lastSyncedAt: readonly(lastSyncedAt),
    errorMessage: readonly(errorMessage),
    syncNow,
  }
})
