import type { PrivateRecipe } from '@yunyoujun/cook/custom-recipes'
import type { CustomRecipe } from '~/utils/customRecipe'
import { useStorage } from '@vueuse/core'
import { updatePrivateRecipeStorage } from '~/utils/privateRecipeStorage'
import { scopedKey } from '~/utils/storageScope'
import { userDataMeta } from './userDataMeta'

export type { CustomRecipe }

// 和收藏、历史一样保存在本机，并随账号同步到云端
export const customRecipes = useStorage<CustomRecipe[]>(scopedKey('custom-recipes'), [])

/** Read current storage at commit time so another tab's additions are preserved. */
export function updateCustomRecipes(update: (current: CustomRecipe[]) => CustomRecipe[]) {
  // 写入必须和读取用同一个 key，否则登录状态下会把菜谱落到匿名空间。
  const recipes = updatePrivateRecipeStorage(localStorage, scopedKey('custom-recipes'), update)
  customRecipes.value = recipes
}

export function getCustomRecipe(customId: string) {
  return customRecipes.value.find(recipe => recipe.customId === customId)
}

export function saveCustomRecipe(recipe: CustomRecipe) {
  updateCustomRecipes((current) => {
    const exists = current.some(item => item.customId === recipe.customId)
    return exists ? current.map(item => item.customId === recipe.customId ? recipe : item) : [recipe, ...current]
  })
}

/**
 * 删除时留一条墓碑：别的设备同步时才知道这道菜是被删掉的，
 * 而不是「那台设备还没有这道菜」。
 */
export function removeCustomRecipe(customId: string) {
  const existing = customRecipes.value.find(recipe => recipe.customId === customId)
  updateCustomRecipes(current => current.filter(recipe => recipe.customId !== customId))
  if (!existing)
    return
  // 墓碑时间要压过菜谱自己的更新时间：设备时钟慢时也不至于删不掉。
  const time = Math.max(Date.now(), existing.updatedAt + 1)
  userDataMeta.value = {
    ...userDataMeta.value,
    customRecipeRemovals: [
      ...userDataMeta.value.customRecipeRemovals.filter(item => item.customId !== customId),
      { customId, time },
    ],
  }
}

/** 云端同步把合并后的菜谱写回本机。 */
export function setCustomRecipes(recipes: PrivateRecipe[]) {
  customRecipes.value = recipes as CustomRecipe[]
}
