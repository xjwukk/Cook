import { describe, expect, it } from 'vitest'
import {
  cleanIngredientName,
  matchCatalogIngredient,
  normalizeCatalogIngredients,
} from '../apps/web/app/utils/ingredientCatalog'

const CATALOG = ['虾', '土豆', '猪肉', '番茄', '葱', '姜', '蒜', '油', '盐', '蚝油', '鸡蛋']

describe('cleanIngredientName', () => {
  it('drops amounts written after the ingredient name', () => {
    expect(cleanIngredientName('土豆(2个)')).toBe('土豆')
    expect(cleanIngredientName('盐适量')).toBe('盐')
    expect(cleanIngredientName('鲜虾500g')).toBe('鲜虾')
    expect(cleanIngredientName('五花肉300克')).toBe('五花肉')
    expect(cleanIngredientName('姜蒜粒（切末）')).toBe('姜蒜粒')
  })

  it('keeps plain names untouched', () => {
    expect(cleanIngredientName('鸡蛋')).toBe('鸡蛋')
    expect(cleanIngredientName('')).toBe('')
  })
})

describe('matchCatalogIngredient', () => {
  it('matches a name that is already in the menu', () => {
    expect(matchCatalogIngredient('虾', CATALOG)).toEqual(['虾'])
    expect(matchCatalogIngredient('土豆', CATALOG)).toEqual(['土豆'])
  })

  it('expands a descriptive name into menu names', () => {
    expect(matchCatalogIngredient('鲜虾', CATALOG)).toEqual(['虾'])
    expect(matchCatalogIngredient('葱花', CATALOG)).toEqual(['葱'])
    expect(matchCatalogIngredient('姜蒜粒', CATALOG)).toEqual(['姜', '蒜'])
  })

  it('returns nothing for names that are not in the menu', () => {
    expect(matchCatalogIngredient('外星肉', CATALOG)).toEqual([])
  })
})

describe('normalizeCatalogIngredients', () => {
  it('maps names onto the menu and keeps unknown ones', () => {
    const result = normalizeCatalogIngredients(['鲜虾', '姜蒜粒', '外星肉'], CATALOG)
    expect(result.names).toEqual(['虾', '姜', '蒜', '外星肉'])
    expect(result.unknown).toEqual(['外星肉'])
  })

  it('removes amounts before matching', () => {
    const result = normalizeCatalogIngredients(['鲜虾500g'], CATALOG)
    expect(result.names).toEqual(['虾'])
    expect(result.unknown).toEqual([])
  })
})
