import { uniqueStuff } from '@yunyoujun/cook/recommend'

/** Structural input keeps the matcher independent of persistence and stores. */
export interface KitchenMatchInventory {
  ingredients: readonly string[]
  pantry: readonly string[]
  tools: readonly string[]
  initialized: boolean
}

export interface KitchenMatchRecipe {
  stuff?: readonly string[]
  tools?: readonly string[]
}

/** Ingredient aliases must stay identical to recommendation/catalog aliases. */
export function normalizeKitchenNames(names: readonly string[]): string[] {
  return uniqueStuff([...names])
}

/** Tools have no ingredient aliases; only normalize recorded separators and whitespace. */
function normalizeTools(names: readonly string[]): string[] {
  return [...new Set(names.flatMap(name => name.split(/[,，、;；\n]/)).map(name => name.trim()).filter(Boolean))]
}

/**
 * Conservative eligibility based on recorded requirements, not a cooking guarantee.
 * Every recorded ingredient and tool is required, including catch-all recipes.
 * Missing metadata is unknown; pantry contents are never assumed.
 * Multi-tool records are combinations (see decision 0021), unlike discovery filters.
 */
export function canCookWithKitchen(recipe: KitchenMatchRecipe, kitchen: KitchenMatchInventory): boolean {
  if (!kitchen.initialized)
    return false

  const requiredStuff = normalizeKitchenNames(recipe.stuff ?? [])
  const requiredTools = normalizeTools(recipe.tools ?? [])
  if (!requiredStuff.length || !requiredTools.length)
    return false

  const ownedStuff = new Set(normalizeKitchenNames([...kitchen.ingredients, ...kitchen.pantry]))
  const ownedTools = new Set(normalizeTools(kitchen.tools))
  return requiredStuff.every(name => ownedStuff.has(name))
    && requiredTools.every(name => ownedTools.has(name))
}
