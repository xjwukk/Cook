import type { RecipeItem } from '~/types'
import { useStorage } from '@vueuse/core'
import { scopedKey } from '~/utils/storageScope'
import { userDataMeta } from './userDataMeta'

export interface RecipeHistoryItem {
  recipe: RecipeItem
  time: number
}

export const recipeHistories = useStorage<RecipeHistoryItem[]>(scopedKey('history'), [])

export function addRecipeHistory(recipe: RecipeItem) {
  recipeHistories.value.push({ recipe, time: Date.now() })
}

export function removeRecipeHistory(history: RecipeHistoryItem) {
  recipeHistories.value = recipeHistories.value.filter(h => h !== history)
  userDataMeta.value = {
    ...userDataMeta.value,
    historyRemovals: [
      ...userDataMeta.value.historyRemovals,
      { name: history.recipe.name, time: history.time },
    ],
  }
}

export function clearRecipeHistories() {
  const latest = recipeHistories.value.reduce((max, h) => Math.max(max, h.time), Date.now())
  recipeHistories.value = []
  userDataMeta.value = {
    ...userDataMeta.value,
    historyClearedAt: latest,
    historyRemovals: [],
  }
}
