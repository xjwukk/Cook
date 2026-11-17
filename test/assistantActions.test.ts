import { describe, expect, it } from 'vitest'
import { draftToCustomRecipeInput, normalizeDraftRecipe } from '../apps/web/app/utils/assistantActions'

describe('normalizeDraftRecipe', () => {
  it('returns undefined for missing or malformed drafts', () => {
    expect(normalizeDraftRecipe(undefined)).toBeUndefined()
    expect(normalizeDraftRecipe('x' as never)).toBeUndefined()
    expect(normalizeDraftRecipe({ name: '', stuff: ['蛋'] })).toBeUndefined()
    expect(normalizeDraftRecipe({ name: '菜', stuff: [] })).toBeUndefined()
  })

  it('trims, dedupes and clips fields', () => {
    const result = normalizeDraftRecipe({
      name: '  可乐鸡翅 ',
      stuff: ['鸡翅', '鸡翅', '', '可乐', 'x'.repeat(200)],
      tools: ['炒锅', '炒锅'],
      note: ` ${'注'.repeat(21_000)} `,
      editId: ` ${'custom-abc'} `,
    })
    expect(result?.name).toBe('可乐鸡翅')
    // uniqueStuff 做别名归一（鸡翅→鸡肉）
    expect(result?.stuff).toEqual(['鸡肉', '可乐', 'x'.repeat(100)])
    expect(result?.tools).toEqual(['炒锅'])
    expect(result?.note.length).toBe(20_000)
    expect(result?.editId).toBe('custom-abc')
  })

  it('omits editId when blank', () => {
    expect(normalizeDraftRecipe({ name: '菜', stuff: ['蛋'], editId: '  ' })?.editId).toBeUndefined()
  })
})

describe('draftToCustomRecipeInput', () => {
  it('maps a draft to the form input shape without a source', () => {
    const input = draftToCustomRecipeInput({ name: '可乐鸡翅', stuff: ['鸡肉'], tools: ['炒锅'], note: '炖' })
    expect(input).toEqual({ name: '可乐鸡翅', stuff: ['鸡肉'], tools: ['炒锅'], note: '炖' })
    expect('source' in input).toBe(false)
  })
})
