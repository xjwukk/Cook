import type { KitchenMatchInventory, KitchenMatchRecipe } from '../apps/web/app/utils/kitchenMatch'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canCookWithKitchen, normalizeKitchenNames } from '../apps/web/app/utils/kitchenMatch'
import { parseRecipeCsv } from '../packages/cook/src/utils/csv'

const recipe: KitchenMatchRecipe = { stuff: ['番茄', '鸡蛋', '盐'], tools: ['一口大锅'] }
function kitchen(overrides: Partial<KitchenMatchInventory> = {}): KitchenMatchInventory {
  return { ingredients: ['番茄', '鸡蛋'], pantry: ['盐'], tools: ['一口大锅'], initialized: true, ...overrides }
}

// Tracked CSV, not generated JSON, is the source of truth for multi-tool regressions.
const recipes = parseRecipeCsv(readFileSync('packages/data/recipe.csv', 'utf8'))

describe('canCookWithKitchen', () => {
  it('matches all recorded requirements with explicit ingredients and pantry', () => {
    expect(canCookWithKitchen(recipe, kitchen())).toBe(true)
    expect(canCookWithKitchen(recipe, kitchen({ ingredients: ['番茄', '鸡蛋', '盐'], pantry: [] }))).toBe(true)
    expect(canCookWithKitchen(recipe, kitchen({ ingredients: [], pantry: ['番茄', '鸡蛋', '盐'] }))).toBe(true)
  })

  it('reuses catalog aliases, trims, splits and deduplicates names on both sides', () => {
    expect(normalizeKitchenNames([' 西红柿 ', '番茄、虾仁', '虾', ''])).toEqual(['番茄', '虾'])
    expect(canCookWithKitchen({ stuff: ['西红柿、鸡蛋', '鸡蛋', ' 盐 '], tools: [' 一口大锅 '] }, kitchen())).toBe(true)
    expect(canCookWithKitchen(recipe, kitchen({ ingredients: [' 西红柿，鸡蛋 ', '番茄'] }))).toBe(true)
    expect(canCookWithKitchen({ stuff: ['虾'], tools: ['一口大锅'] }, kitchen({ ingredients: ['虾仁'] }))).toBe(true)
  })

  it('requires every ingredient and does not infer requirements from a recipe name', () => {
    expect(canCookWithKitchen(recipe, kitchen({ ingredients: ['鸡蛋'] }))).toBe(false)
    expect(canCookWithKitchen(recipe, kitchen({ ingredients: ['番茄'] }))).toBe(false)
    expect(canCookWithKitchen({ stuff: ['腊肉'], tools: ['一口大锅'] }, kitchen({ ingredients: ['腊肠'] }))).toBe(false)
  })

  it('never assumes pantry defaults or permits unrecorded condiment substitutions', () => {
    expect(canCookWithKitchen(recipe, kitchen({ pantry: [] }))).toBe(false)
    expect(canCookWithKitchen(recipe, kitchen({ pantry: ['糖', '油'] }))).toBe(false)
    expect(canCookWithKitchen({ stuff: ['鸡蛋'], tools: ['一口大锅'] }, kitchen({ pantry: [] }))).toBe(true)
  })

  it('does not apply discovery catch-all optional-ingredient exceptions', () => {
    const stuff = Array.from({ length: 10 }, (_, index) => `食材${index}`)
    const catchAll = { stuff, tools: ['一口大锅'] }
    expect(canCookWithKitchen(catchAll, kitchen({ ingredients: stuff.slice(0, 2) }))).toBe(false)
    expect(canCookWithKitchen(catchAll, kitchen({ ingredients: stuff }))).toBe(true)
  })

  it('requires all listed tools, accepts extra tools and never invents tool aliases', () => {
    const combination = { stuff: ['鸡蛋'], tools: ['一口大锅、烤箱'] }
    expect(canCookWithKitchen(combination, kitchen({ tools: ['一口大锅'] }))).toBe(false)
    expect(canCookWithKitchen(combination, kitchen({ tools: ['烤箱'] }))).toBe(false)
    expect(canCookWithKitchen(combination, kitchen({ tools: [' 一口大锅 ', '烤箱', '料理机'] }))).toBe(true)
    expect(canCookWithKitchen(recipe, kitchen({ tools: ['炒锅'] }))).toBe(false)
    expect(canCookWithKitchen(recipe, kitchen({ tools: [] }))).toBe(false)
  })

  it.each([881, 882, 884, 886])('requires the real combination recorded by audited recipe %i', (id) => {
    const actual = recipes.find(item => item.id === id)!
    expect(actual.tools.length).toBeGreaterThan(1)
    expect(canCookWithKitchen(actual, kitchen({ ingredients: actual.stuff, tools: actual.tools }))).toBe(true)
    for (const tool of actual.tools)
      expect(canCookWithKitchen(actual, kitchen({ ingredients: actual.stuff, tools: [tool] }))).toBe(false)
  })

  it('rejects uninitialized kitchens even when all requirements are owned', () => {
    expect(canCookWithKitchen(recipe, kitchen({ initialized: false }))).toBe(false)
  })

  it.each<KitchenMatchRecipe>([
    {},
    { tools: ['一口大锅'] },
    { stuff: ['鸡蛋'] },
    { stuff: [], tools: ['一口大锅'] },
    { stuff: ['鸡蛋'], tools: [] },
    { stuff: [' 、； '], tools: ['一口大锅'] },
    { stuff: ['鸡蛋'], tools: [' ，； '] },
  ])('treats missing or effectively empty metadata as unknown: %j', (incomplete) => {
    expect(canCookWithKitchen(incomplete, kitchen())).toBe(false)
  })

  it('does not mutate recipe or inventory arrays', () => {
    const input = Object.freeze({
      ingredients: Object.freeze(['西红柿', '鸡蛋']),
      pantry: Object.freeze(['盐']),
      tools: Object.freeze(['一口大锅']),
      initialized: true,
    })
    const required = Object.freeze({ stuff: Object.freeze(['番茄', '鸡蛋', '盐']), tools: Object.freeze(['一口大锅']) })
    expect(canCookWithKitchen(required, input)).toBe(true)
    expect(input.ingredients).toEqual(['西红柿', '鸡蛋'])
    expect(required.stuff).toEqual(['番茄', '鸡蛋', '盐'])
  })
})
