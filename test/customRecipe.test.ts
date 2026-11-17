import { describe, expect, it } from 'vitest'
import { buildCustomRecipe, isCustomRecipe, parseRecipeSource } from '../apps/web/app/utils/customRecipe'
import { getRecipeLink } from '../apps/web/app/utils/recipe'
import { recommendRecipes } from '../packages/cook/src/utils/recommend'

const input = { name: ' 外婆的红烧肉 ', stuff: ['五花肉', '西红柿', '番茄'], tools: ['一口大锅', '一口大锅'], source: '', note: '' }

describe('parseRecipeSource', () => {
  it('reads a bv id from a bilibili url or bare id', () => {
    expect(parseRecipeSource('https://www.bilibili.com/video/BV1GJ411x7h7/?p=2')).toEqual({ bv: 'BV1GJ411x7h7' })
    expect(parseRecipeSource('bv1GJ411x7h7')).toEqual({ bv: 'BV1GJ411x7h7' })
  })

  it('keeps other links and rejects plain text', () => {
    expect(parseRecipeSource('https://b23.tv/abc')).toEqual({ link: 'https://b23.tv/abc' })
    expect(parseRecipeSource('https://example.com/xbv1234567890a')).toEqual({ link: 'https://example.com/xbv1234567890a' })
    expect(parseRecipeSource('  ')).toEqual({})
    expect(parseRecipeSource('看小红书')).toBeUndefined()
  })
})

describe('buildCustomRecipe', () => {
  it('normalizes the form into a recipe', () => {
    const result = buildCustomRecipe({ ...input, source: 'BV1GJ411x7h7', note: ' 少放糖 ' }, undefined, 1)
    expect(result).toMatchObject({
      recipe: { name: '外婆的红烧肉', stuff: ['猪肉', '番茄'], tools: ['一口大锅'], bv: 'BV1GJ411x7h7', note: '少放糖', createdAt: 1, updatedAt: 1 },
    })
    if ('recipe' in result) {
      expect(isCustomRecipe(result.recipe)).toBe(true)
      expect(getRecipeLink(result.recipe)).toBe('https://www.bilibili.com/video/BV1GJ411x7h7')
    }
  })

  it('keeps the id when editing', () => {
    const result = buildCustomRecipe(input, { customId: 'custom-a', createdAt: 1 }, 2)
    expect(result).toMatchObject({ recipe: { customId: 'custom-a', createdAt: 1, updatedAt: 2 } })
  })

  it('explains what is missing', () => {
    expect(buildCustomRecipe({ ...input, name: '' })).toEqual({ error: '给菜起个名字吧' })
    expect(buildCustomRecipe({ ...input, stuff: [] })).toEqual({ error: '至少选一样食材，才能被匹配到' })
    expect(buildCustomRecipe({ ...input, source: '小红书' })).toHaveProperty('error')
  })

  it('takes part in matching like any other recipe', () => {
    const result = buildCustomRecipe(input)
    if (!('recipe' in result))
      throw new Error(result.error)
    const [match] = recommendRecipes([result.recipe], { stuff: ['五花肉', '西红柿'], mode: 'strict' })
    expect(match?.recipe.name).toBe('外婆的红烧肉')
    expect(getRecipeLink(result.recipe)).toBe('')
  })

  it('accepts an assistant draft without any source link', () => {
    const result = buildCustomRecipe({ name: '可乐鸡翅', stuff: ['鸡翅', '可乐'], tools: ['炒锅'], note: '炖 15 分钟' })
    expect(result).toMatchObject({
      // uniqueStuff 会做别名归一（鸡翅→鸡肉）
      recipe: { name: '可乐鸡翅', stuff: ['鸡肉', '可乐'], tools: ['炒锅'], note: '炖 15 分钟' },
    })
    if ('recipe' in result) {
      expect(result.recipe.bv).toBeUndefined()
      expect(result.recipe.link).toBeUndefined()
      expect(getRecipeLink(result.recipe)).toBe('')
    }
  })

  it('keeps the existing source when an edit draft leaves it blank', () => {
    const existing = { customId: 'custom-b', createdAt: 1, bv: 'BV1GJ411x7h7' as const, stuff: ['鸡翅'], tools: [] }
    const result = buildCustomRecipe({ name: '可乐鸡翅', stuff: ['鸡翅'], tools: [], source: '', note: '' }, existing, 2)
    expect(result).toMatchObject({ recipe: { customId: 'custom-b', bv: 'BV1GJ411x7h7' } })
  })
})
