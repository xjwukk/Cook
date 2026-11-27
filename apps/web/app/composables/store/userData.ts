import type { UserData, UserDataExportFile } from '~/utils/userData'
import { toSyncCustomRecipe } from '~/utils/customRecipe'
import { normalizeKitchen } from '~/utils/kitchen'
import { scopedKey } from '~/utils/storageScope'
import {
  createEmptyUserData,
  createUserDataExport,
  mergeCustomRecipes,
  mergeUserData,
  parseUserDataExport,
} from '~/utils/userData'
import { customRecipes, setCustomRecipes } from './customRecipe'
import { favoriteEntries, setFavoriteEntries } from './favorite'
import { recipeHistories } from './history'
import { useKitchenStore } from './kitchen'
import { userDataMeta } from './userDataMeta'

export function readLocalUserData(): UserData {
  const meta = userDataMeta.value
  return {
    kitchen: useKitchenStore().data,
    favorites: favoriteEntries.value,
    favoriteRemovals: meta.favoriteRemovals ?? [],
    histories: recipeHistories.value,
    historyRemovals: meta.historyRemovals ?? [],
    historyClearedAt: meta.historyClearedAt ?? 0,
    customRecipes: customRecipes.value.map(toSyncCustomRecipe),
    customRecipeRemovals: meta.customRecipeRemovals ?? [],
  }
}

export function writeLocalUserData(data: UserData): void {
  const kitchen = normalizeKitchen(data.kitchen)
  // 我的菜谱只做并集，不做替换：账号切换时云端文档不含本机菜谱，
  // 整体替换会把它们抹掉。删除由墓碑在合并里生效。
  const { customRecipes: recipes, customRecipeRemovals: removals } = mergeCustomRecipes(
    [...customRecipes.value.map(toSyncCustomRecipe), ...data.customRecipes],
    [...(userDataMeta.value.customRecipeRemovals ?? []), ...data.customRecipeRemovals],
  )
  const meta = {
    ...userDataMeta.value,
    favoriteRemovals: data.favoriteRemovals,
    historyRemovals: data.historyRemovals,
    customRecipeRemovals: removals,
    historyClearedAt: data.historyClearedAt,
  }
  // Serialize everything before writing; VueUse persistence is asynchronous and
  // catches quota errors, so it cannot serve as the import transaction boundary.
  const writes = [
    [scopedKey('kitchen'), JSON.stringify(kitchen)],
    [scopedKey('favorites'), JSON.stringify(data.favorites)],
    [scopedKey('history'), JSON.stringify(data.histories)],
    [scopedKey('custom-recipes'), JSON.stringify(recipes)],
    [scopedKey('sync'), JSON.stringify(meta)],
  ] as const
  const previous = writes.map(([key]) => localStorage.getItem(key))
  let written = 0
  try {
    for (const [key, value] of writes) {
      localStorage.setItem(key, value)
      written++
    }
  }
  catch (error) {
    // Restore only successful writes; setItem itself is atomic on failure.
    let rollbackFailed = false
    for (let index = written - 1; index >= 0; index--) {
      const entry = writes[index]
      const old = previous[index]
      if (!entry || old === undefined)
        continue
      const [key] = entry
      try {
        if (old === null)
          localStorage.removeItem(key)
        else
          localStorage.setItem(key, old)
      }
      catch {
        rollbackFailed = true
      }
    }
    if (rollbackFailed)
      throw new Error('导入失败，部分本地数据无法恢复，请检查存储空间后重新导入', { cause: error })
    throw error
  }
  // No reactive state changes until every persistent write has succeeded.
  useKitchenStore().replaceData(kitchen, false)
  setFavoriteEntries(data.favorites)
  recipeHistories.value = data.histories
  setCustomRecipes(recipes)
  userDataMeta.value = meta
}

export function exportLocalUserData(now = Date.now()): UserDataExportFile {
  return createUserDataExport(mergeUserData(readLocalUserData(), createEmptyUserData(), now), now)
}

/**
 * Merge an exported file into local data, using the same rules as cloud sync.
 * Returns null when the text is not a Cook export.
 */
export function importLocalUserData(text: string, now = Date.now()): { favorites: number, histories: number } | null {
  const imported = parseUserDataExport(text)
  if (!imported)
    return null
  const merged = mergeUserData(readLocalUserData(), imported, now)
  writeLocalUserData(merged)
  return { favorites: merged.favorites.length, histories: merged.histories.length }
}
