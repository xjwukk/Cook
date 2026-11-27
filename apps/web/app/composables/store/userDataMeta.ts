import type { CustomRecipeRemoval, FavoriteRemoval, HistoryRemoval } from '~/utils/userData'
import { useStorage } from '@vueuse/core'
import { scopedKey } from '~/utils/storageScope'

/**
 * Sync bookkeeping kept next to `cook:favorites` and `cook:history`, which stay
 * in their original format. Deletions are recorded even when logged out so they
 * can be applied to the cloud after the next login.
 */
export interface UserDataMeta {
  favoriteRemovals: FavoriteRemoval[]
  historyRemovals: HistoryRemoval[]
  /** Deletions of the user's own recipes, so they are not resurrected by the cloud. */
  customRecipeRemovals: CustomRecipeRemoval[]
  historyClearedAt: number
  /** The account this device last synced with. */
  lastUid: string
}

export const userDataMeta = useStorage<UserDataMeta>(scopedKey('sync'), {
  favoriteRemovals: [],
  historyRemovals: [],
  customRecipeRemovals: [],
  historyClearedAt: 0,
  lastUid: '',
}, undefined, { mergeDefaults: true })
