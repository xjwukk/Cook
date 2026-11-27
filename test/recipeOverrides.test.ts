import type { RecipeItem } from '../apps/web/app/types'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  applyRecipeOverrides,
  recipeOverrides,
  recipeOverridesVersion,
  setRecipeOverrides,
} from '../apps/web/app/composables/useRecipeOverrides'

const PUBLISHED_ID = 10012

function base(id: number, name: string): RecipeItem {
  return { id, name, stuff: ['番茄'], tools: ['一口大锅'] }
}

describe('applyRecipeOverrides', () => {
  beforeEach(() => {
    setRecipeOverrides([], 0, false)
    recipeOverrides.value = new Map()
    recipeOverridesVersion.value = 0
  })

  it('returns the original array when there are no overrides', () => {
    const recipes = [base(1, '番茄炒蛋')]
    expect(applyRecipeOverrides(recipes)).toBe(recipes)
  })

  it('patches an existing recipe by id', () => {
    setRecipeOverrides([{ id: 1, name: '改过的番茄炒蛋', stuff: ['番茄'], tools: ['一口大锅'] }], 1, false)
    const result = applyRecipeOverrides([base(1, '番茄炒蛋'), base(2, '红烧肉')])
    expect(result).toHaveLength(2)
    expect(result[0]!.name).toBe('改过的番茄炒蛋')
    expect(result[1]!.name).toBe('红烧肉')
  })

  it('appends an override whose id is not in the local dataset', () => {
    // 投稿发布的菜谱：本地 887 道里没有这个 id，以前会被静默丢掉。
    setRecipeOverrides([{
      id: PUBLISHED_ID,
      name: '油焖大虾',
      stuff: ['虾'],
      tools: [],
      note: '1. 热锅下油',
    }], 1, false)

    const result = applyRecipeOverrides([base(1, '番茄炒蛋')])
    expect(result).toHaveLength(2)
    const published = result.find(item => item.id === PUBLISHED_ID)
    expect(published).toBeDefined()
    expect(published!.name).toBe('油焖大虾')
    expect(published!.note).toBe('1. 热锅下油')
    expect(published!.stuff).toEqual(['虾'])
  })

  it('carries the steps note through a patch', () => {
    setRecipeOverrides([{ id: 1, name: '番茄炒蛋', stuff: ['番茄'], tools: ['一口大锅'], note: '1. 先炒蛋' }], 1, false)
    const result = applyRecipeOverrides([base(1, '番茄炒蛋')])
    expect(result[0]!.note).toBe('1. 先炒蛋')
  })

  it('drops empty optional fields when appending', () => {
    setRecipeOverrides([{ id: PUBLISHED_ID, name: '新菜', stuff: ['虾'], tools: [], bv: '', link: '' }], 1, false)
    const published = applyRecipeOverrides([])[0]!
    expect('bv' in published).toBe(false)
    expect('link' in published).toBe(false)
  })
})
