import type { RecipeItem } from '../apps/web/app/types'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useKitchenStore } from '../apps/web/app/composables/store/kitchen'
import { useRecipeStore } from '../apps/web/app/composables/store/recipe'
import { db } from '../apps/web/app/utils/db'
import { normalizeKitchen } from '../apps/web/app/utils/kitchen'
import { canCookWithKitchen } from '../apps/web/app/utils/kitchenMatch'

const fixtures: RecipeItem[] = [
  { id: 1, name: '番茄炒蛋', stuff: ['番茄', '鸡蛋'], tools: ['一口大锅'] },
  { id: 2, name: '盐煎蛋', stuff: ['鸡蛋', '盐'], tools: ['一口大锅'] },
  { id: 3, name: '牛肉炒蛋', stuff: ['鸡蛋', '牛肉'], tools: ['一口大锅'] },
  { id: 4, name: '烤鸡蛋', stuff: ['鸡蛋'], tools: ['烤箱'] },
  { id: 5, name: '先炒后烤鸡蛋', stuff: ['鸡蛋'], tools: ['一口大锅', '烤箱'] },
  { id: 6, name: '材料待核对', stuff: [], tools: ['一口大锅'] },
  { id: 7, name: '厨具待核对', stuff: ['鸡蛋'], tools: [] },
]

beforeEach(async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  await db.recipes.clear()
  await db.recipes.bulkAdd(fixtures)
})
afterEach(() => localStorage.clear())

function stockKitchen() {
  const kitchen = useKitchenStore()
  kitchen.replaceData(normalizeKitchen({
    ingredients: ['西红柿', '鸡蛋'],
    tools: ['一口大锅'],
    pantry: [],
    initialized: true,
  }))
  return kitchen
}

async function setupStockedStore() {
  const kitchen = stockKitchen()
  const store = useRecipeStore()
  await store.loadRecipes()
  return { kitchen, store }
}

describe('recipe store kitchen integration', () => {
  it('filters effective selections without destroying non-owned ingredients or tools', async () => {
    const { store } = await setupStockedStore()
    store.addStuff('西红柿、鸡蛋、牛肉')
    store.curTool = '烤箱'
    expect(store.selectedStuff).toEqual(['番茄', '鸡蛋', '牛肉'])
    expect(store.effectiveTool).toBe('烤箱')

    store.onlyOwned = true
    expect(store.selectedStuff).toEqual(['番茄', '鸡蛋'])
    expect(store.effectiveTool).toBe('')
    expect(store.excludedSelectionCount).toBe(2)
    expect(store.curTool).toBe('烤箱')

    store.onlyOwned = false
    expect(store.selectedStuff).toEqual(['番茄', '鸡蛋', '牛肉'])
    expect(store.effectiveTool).toBe('烤箱')
    expect(store.excludedSelectionCount).toBe(0)
  })

  it('keeps hidden selections when toggling another ingredient or applying sentence input', async () => {
    const { store } = await setupStockedStore()
    store.addStuff('鸡蛋、牛肉')
    store.curTool = '烤箱'
    store.onlyOwned = true
    store.toggleStuff('番茄')
    store.applyQuery(store.parseText('鸡蛋'))
    store.onlyOwned = false
    expect(store.selectedStuff).toEqual(['鸡蛋', '牛肉', '番茄'])
    expect(store.curTool).toBe('烤箱')
  })

  it('never exposes cookable candidates before the kitchen is initialized', async () => {
    const store = useRecipeStore()
    const kitchen = useKitchenStore()
    expect(kitchen.initialized).toBe(false)
    await store.loadRecipes()
    store.onlyOwned = true
    store.addStuff('鸡蛋')
    store.curTool = '一口大锅'
    expect(store.selectedStuff).toEqual([])
    expect(store.effectiveTool).toBe('')
    expect(store.recipeMatches).toEqual([])
    expect(store.browseRecipes).toEqual([])
    expect(store.reviewedBrowseRecipes).toEqual([])
    expect(store.toolRecipes).toEqual([])
    expect(store.randomPool).toEqual([])
    expect(store.resultCount).toBe(0)
  })

  it('browses owned recipes at zero effective selections, including hidden non-owned selections', async () => {
    const { store } = await setupStockedStore()
    expect(store.browseRecipes).toEqual([])
    store.onlyOwned = true
    expect(store.selectedStuff).toEqual([])
    expect(store.recipeMatches).toEqual([])
    expect(store.browseRecipes.map(recipe => recipe.id)).toEqual([1])
    expect(store.reviewedBrowseRecipes.map(recipe => recipe.id)).toEqual([1])
    expect(store.randomPool.map(recipe => recipe.id)).toEqual([1])
    expect(store.resultCount).toBe(1)

    store.addStuff('牛肉')
    store.curTool = '烤箱'
    expect(store.selectedStuff).toEqual([])
    expect(store.effectiveTool).toBe('')
    expect(store.browseRecipes.map(recipe => recipe.id)).toEqual([1])
    expect(store.resultCount).toBe(1)
  })

  it('requires the full inventory while allowing owned unselected ingredients to complete a match', async () => {
    const { kitchen, store } = await setupStockedStore()
    store.addStuff('鸡蛋')
    expect(store.recipeMatches.some(match => match.recipe.id === 2)).toBe(true)
    expect(store.selectedPantry).toEqual(['油', '盐'])
    store.onlyOwned = true
    expect(store.selectedPantry).toEqual([])
    expect(store.recipeMatches.map(match => match.recipe.id)).toEqual([1])
    expect(store.recipeMatches[0]?.missingStuff).toEqual([])
    expect(store.recipeMatches[0]?.pantryStuff).toEqual(['番茄'])
    expect(store.recommendWithPantry(['盐']).map(match => match.recipe.id)).toEqual([1])
    expect(store.randomPool.map(recipe => recipe.id)).toEqual([1])
    expect(store.unlockSuggestions).toEqual([])
    expect(store.recipeMatches.every(match => canCookWithKitchen(match.recipe, kitchen))).toBe(true)

    kitchen.setPantry(['盐'])
    expect(store.recipeMatches.map(match => match.recipe.id)).toEqual([1, 2])
    kitchen.setTools(['一口大锅', '烤箱'])
    expect(new Set(store.recipeMatches.map(match => match.recipe.id))).toEqual(new Set([1, 2, 4, 5]))
    kitchen.removeIngredient('鸡蛋')
    expect(store.selectedStuff).toEqual([])
    expect(store.browseRecipes).toEqual([])
    expect(store.randomPool).toEqual([])
    expect(store.resultCount).toBe(0)

    store.onlyOwned = false
    expect(store.selectedStuff).toEqual(['鸡蛋'])
    expect(store.selectedPantry).toEqual(['油', '盐'])
    expect(store.recipeMatches.some(match => match.recipe.id === 3)).toBe(true)
  })
})
