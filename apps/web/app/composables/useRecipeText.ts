import type { RecipeText, RecipeTextBlock, RecipeTextData } from '@yunyoujun/cook'
import { shallowRef } from 'vue'

/**
 * 图文做法的正文来自 packages/data/recipe-text.json（约 800 KB，只有部分菜谱有）。
 * 第一次打开详情时才按需加载，之后一直复用同一份内存数据。
 */
const textData = shallowRef<RecipeTextData | null>(null)
let loading: Promise<RecipeTextData> | undefined

export function loadRecipeTexts(): Promise<RecipeTextData> {
  if (textData.value)
    return Promise.resolve(textData.value)
  loading ??= import('@cook/data/recipe-text.json')
    .then(({ default: data }) => {
      textData.value = data as RecipeTextData
      return textData.value
    })
    .catch((error) => {
      // 失败时清掉缓存，否则「重试」会一直拿到同一个 rejected promise
      loading = undefined
      throw error
    })
  return loading
}

export function findRecipeText(id: number | undefined): RecipeText | undefined {
  if (typeof id !== 'number' || !textData.value)
    return undefined
  return textData.value.recipes[String(id)]
}

/**
 * 只取「操作」这一节作为步骤；没有该标题时退回到所有有序列表。
 * 配图不放进卡片，保持纯文字流程。
 */
export function extractRecipeSteps(text: RecipeText | undefined): RecipeTextBlock[] {
  if (!text)
    return []
  const blocks = text.blocks
  const start = blocks.findIndex(block => block.type === 'heading' && /操作|步骤/.test(block.text))
  if (start >= 0) {
    const result: RecipeTextBlock[] = []
    for (let i = start + 1; i < blocks.length; i++) {
      const block = blocks[i]
      if (!block || block.type === 'heading')
        break
      if (block.type !== 'image')
        result.push(block)
    }
    return result
  }
  return blocks.filter(block => block.type === 'list' && block.ordered)
}

function plainInline(text: string): string {
  return text
    .replace(/\[([^\]\n]+)\]\(https?:\/\/[^)\s]+\)/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}

/**
 * 把步骤块转成可编辑的纯文本：段落空行分隔，有序列表编号，无序列表用 -。
 * 行内 Markdown 只保留文字，供编辑器的预览和文本框共用。
 */
export function stepsToPlainText(blocks: RecipeTextBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'paragraph') {
      parts.push(plainInline(block.text))
    }
    else if (block.type === 'list') {
      const start = block.start ?? 1
      parts.push(block.items
        .map((item, index) => `${block.ordered ? `${start + index}. ` : '- '}${plainInline(item)}`)
        .join('\n'))
    }
  }
  return parts.filter(part => part.trim()).join('\n\n')
}
