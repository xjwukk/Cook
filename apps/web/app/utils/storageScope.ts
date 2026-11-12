import { namespace } from '~/constants'

/**
 * 本机数据按账号隔离：登录后读写 `cook:u<id>:<name>`，未登录读写 `cook:<name>`。
 * 账号 id 来自服务端设置的可读 Cookie（cook_uid）。它不是凭据，
 * 只决定这台浏览器把数据放在哪个命名空间；服务端仍以 HttpOnly 会话判定身份。
 */
function readUidCookie(): string {
  if (typeof document === 'undefined')
    return ''
  const match = document.cookie.match(/(?:^|;\s*)cook_uid=(\d+)/)
  return match?.[1] ?? ''
}

/** 在模块加载时读一次：页面刷新后才切换账号空间，避免运行中一半数据换了键。 */
export const storageUid = readUidCookie()

export function scopedKey(name: string): string {
  return storageUid ? `${namespace}:u${storageUid}:${name}` : `${namespace}:${name}`
}

export function accountKey(name: string, uid: string | number): string {
  return `${namespace}:u${uid}:${name}`
}

export function anonymousKey(name: string): string {
  return `${namespace}:${name}`
}

const MIGRATION_FLAG = `${namespace}:anonymous-migrated`
const MIGRATED_NAMES = ['favorites', 'history', 'custom-recipes', 'personal-catalog', 'sync', 'kitchen']

/**
 * 首次登录时把匿名空间的数据复制到当前账号，只复制一次。
 * 之后注册的账号不会继承前一个匿名用户的数据。
 */
export function migrateAnonymousStorage(uid: string | number): void {
  try {
    if (localStorage.getItem(MIGRATION_FLAG))
      return
    for (const name of MIGRATED_NAMES) {
      const target = accountKey(name, uid)
      if (localStorage.getItem(target) === null) {
        const source = localStorage.getItem(anonymousKey(name))
        if (source !== null)
          localStorage.setItem(target, source)
      }
    }
    localStorage.setItem(MIGRATION_FLAG, '1')
  }
  catch {
    // 存储不可用时保持匿名空间，不影响登录与同步。
  }
}
