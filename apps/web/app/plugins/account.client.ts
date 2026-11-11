import { storageUid } from '~/utils/storageScope'

/**
 * 启动时确认登录态。
 * 本机存储按 cook_uid Cookie 分命名空间；若会话有效但 Cookie 缺失（例如旧会话），
 * 补齐后刷新一次，保证后续读写落在账号空间里。
 */
export default defineNuxtPlugin(async () => {
  const account = useAccount()
  await account.refresh()

  const uid = account.user.value?.id
  if (uid && storageUid !== String(uid)) {
    document.cookie = `cook_uid=${uid}; path=/; max-age=${30 * 24 * 60 * 60}; samesite=lax`
    if (!sessionStorage.getItem('cook-uid-reloaded')) {
      sessionStorage.setItem('cook-uid-reloaded', '1')
      window.location.reload()
      return
    }
  }
  sessionStorage.removeItem('cook-uid-reloaded')

  useAccountSync()
})
