import type { RecipeTextBlock } from '../packages/cook/src/types/recipe-text'
import { describe, expect, it } from 'vitest'
import { stepsToPlainText } from '../apps/web/app/composables/useRecipeText'
import { resolveNoteForSave } from '../apps/web/app/utils/recipeNote'

describe('stepsToPlainText', () => {
  it('converts paragraphs and lists into editable text', () => {
    const blocks: RecipeTextBlock[] = [
      { type: 'heading', text: '操作' },
      { type: 'paragraph', text: '准备**食材**。' },
      { type: 'list', ordered: true, items: ['切番茄', '打[鸡蛋](https://example.com)'] },
      { type: 'list', ordered: false, items: ['热锅', '下油'] },
      { type: 'image', src: 'step.webp', width: 100, height: 100 },
      { type: 'paragraph', text: '完成。' },
    ]

    expect(stepsToPlainText(blocks)).toBe([
      '准备食材。',
      '1. 切番茄\n2. 打鸡蛋',
      '- 热锅\n- 下油',
      '完成。',
    ].join('\n\n'))
  })

  it('honours the ordered list start and strips inline code', () => {
    const blocks: RecipeTextBlock[] = [
      { type: 'list', ordered: true, start: 3, items: ['加入 `盐`', '出锅'] },
    ]

    expect(stepsToPlainText(blocks)).toBe('3. 加入 盐\n4. 出锅')
  })

  it('returns an empty string for empty blocks', () => {
    expect(stepsToPlainText([])).toBe('')
  })
})

describe('resolveNoteForSave', () => {
  it('omits empty or whitespace-only notes', () => {
    expect(resolveNoteForSave({ note: '', officialText: '1. 原步骤', isPublished: false })).toBeUndefined()
    expect(resolveNoteForSave({ note: '   ', officialText: '1. 原步骤', isPublished: false })).toBeUndefined()
  })

  it('omits unchanged official steps', () => {
    expect(resolveNoteForSave({
      note: ' 1. 原步骤 ',
      officialText: '1. 原步骤',
      isPublished: false,
    })).toBeUndefined()
  })

  it('keeps edited official steps', () => {
    expect(resolveNoteForSave({
      note: '1. 新步骤',
      officialText: '1. 原步骤',
      isPublished: false,
    })).toBe('1. 新步骤')
  })

  it('keeps a note when no official text is available', () => {
    expect(resolveNoteForSave({
      note: '1. 自己写的步骤',
      officialText: '',
      isPublished: false,
    })).toBe('1. 自己写的步骤')
  })

  it('always keeps non-empty notes on published recipes', () => {
    expect(resolveNoteForSave({
      note: ' 1. 投稿步骤 ',
      officialText: '1. 原步骤',
      isPublished: true,
    })).toBe('1. 投稿步骤')
  })
})
