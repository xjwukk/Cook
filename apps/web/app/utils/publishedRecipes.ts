import type { CustomRecipe } from '~/utils/customRecipe'
import { uniqueStuff } from '@yunyoujun/cook/recommend'
import * as base from '~/data/food'
import { pantryOptions } from '~/data/pantry'

/**
 * 投稿到全量菜谱前的「将要发布什么」预览。
 *
 * 官方菜谱的食材/厨具必须来自 packages/data/food.json 的词典，
 * 否则补丁 CSV 合回 recipe.csv 时过不了 pnpm validate。
 * 葱姜蒜、油盐酱醋不在词典里（它们在常备调料里单独计算），发布时剔除。
 */

export interface PublishPreview {
  name: string
  stuff: string[]
  tools: string[]
  note: string
  bv: string
  link: string
  difficulty: CustomRecipe['difficulty']
  tags: string[]
  methods: string[]
  /** 被剔除的常备调料（它们在「常备」里单独计算） */
  droppedCondiments: string[]
  /** 被剔除的其它词典外食材 */
  droppedUnknown: string[]
  /** 被剔除的词典外厨具 */
  droppedTools: string[]
  /** 剔除之后一样食材都不剩，不能投稿 */
  blocked: boolean
}

const officialStuff = new Set([...base.vegetable, ...base.meat, ...base.staple].map(item => item.name))
const officialTools = new Set(base.tools.map(item => item.name))
const condiments = new Set(pantryOptions)

/** 把菜谱整理成可发布的样子，并列出被剔除的条目。 */
export function buildPublishPreview(recipe: CustomRecipe): PublishPreview {
  const stuff: string[] = []
  const droppedCondiments: string[] = []
  const droppedUnknown: string[] = []
  const seen = new Set<string>()

  for (const raw of uniqueStuff(recipe.stuff ?? [])) {
    const name = raw.trim()
    if (!name || seen.has(name))
      continue
    seen.add(name)
    if (officialStuff.has(name)) {
      stuff.push(name)
      continue
    }
    if (condiments.has(name))
      droppedCondiments.push(name)
    else
      droppedUnknown.push(name)
  }

  const tools: string[] = []
  const droppedTools: string[] = []
  for (const raw of recipe.tools ?? []) {
    const name = String(raw ?? '').trim()
    if (!name)
      continue
    if (officialTools.has(name)) {
      if (!tools.includes(name))
        tools.push(name)
    }
    else if (!droppedTools.includes(name)) {
      droppedTools.push(name)
    }
  }

  return {
    name: recipe.name,
    stuff,
    tools,
    note: recipe.note ?? '',
    bv: recipe.bv ?? '',
    link: recipe.link ?? '',
    difficulty: recipe.difficulty ?? '',
    tags: recipe.tags ?? [],
    methods: recipe.methods ?? [],
    droppedCondiments,
    droppedUnknown,
    droppedTools,
    blocked: stuff.length === 0,
  }
}

/** 预览里是否剔掉了东西（用来决定要不要在确认页提醒）。 */
export function hasDroppedItems(preview: PublishPreview): boolean {
  return preview.droppedCondiments.length > 0
    || preview.droppedUnknown.length > 0
    || preview.droppedTools.length > 0
}

/** 投稿接口的请求体：只带菜谱内容，id 由服务端分配。 */
export function publishPayload(preview: PublishPreview) {
  return {
    recipe: {
      name: preview.name,
      stuff: preview.stuff,
      tools: preview.tools,
      note: preview.note,
      bv: preview.bv,
      link: preview.link,
      difficulty: preview.difficulty,
      tags: preview.tags,
      methods: preview.methods,
    },
  }
}
