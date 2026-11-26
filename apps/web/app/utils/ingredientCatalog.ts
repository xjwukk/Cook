import { uniqueStuff } from '@yunyoujun/cook/recommend'
import { useKitchenStore } from '~/composables/store/kitchen'
import { usePersonalCatalog } from '~/composables/usePersonalCatalog'
import * as base from '~/data/food'
import { pantryOptions } from '~/data/pantry'

// 「现有菜谱菜单」里的食材白名单。
//
// 助手读图得到的食材名必须落在这份名单上，否则菜谱没法和「我的厨房」匹配。
// 名单 = 收录的食材（packages/data/food.json）+ 常备调料 + 用户自己的食材。

const BRACKET_SEGMENT = /[（(【[［][^）)】\]］]*[）)】\]］]/g
const TRAILING_AMOUNT = /[\d.]+\s*(?:(千克|公斤|毫升|[克斤两升勺个只根瓣块片把碗杯gl]|汤匙|茶匙|kg|ml)\s*)?$/i
const TRAILING_VAGUE = /(适量|少许|若干|一点点|些许|若干个|一点点儿)+$/

/** 去掉食材名里的用量尾巴：「土豆(2个)」→「土豆」，「盐适量」→「盐」。 */
export function cleanIngredientName(name: string): string {
  let text = String(name ?? '').trim()
  if (!text)
    return ''
  text = text.replace(BRACKET_SEGMENT, ' ')
  text = text.replace(TRAILING_AMOUNT, '')
  text = text.replace(TRAILING_VAGUE, '')
  text = text.replace(/\s+/g, ' ').trim()
  text = text.replace(/^[,，、;；\s]+/, '').replace(/[,，、;；\s]+$/, '')
  return text
}

/** 菜单里所有可选的食材名：收录食材 + 常备调料 + 用户自己的食材。 */
export function catalogIngredientNames(): string[] {
  const names = new Set<string>()
  for (const item of [...base.vegetable, ...base.meat, ...base.staple])
    names.add(item.name)
  for (const item of pantryOptions)
    names.add(item)
  try {
    for (const item of useKitchenStore().pantry)
      names.add(item)
  }
  catch {
    // 厨房还没初始化时不影响主流程。
  }
  try {
    for (const item of usePersonalCatalog().ingredients.value)
      names.add(item.name)
  }
  catch {
    // 同上。
  }
  return [...names]
}

/**
 * 把模型给的食材名对到菜单名：精确命中 → 别名归一 → 子串展开。
 * 对不上时返回空数组，调用方据此剔除并提示用户。
 */
export function matchCatalogIngredient(name: string, catalog?: string[]): string[] {
  const cleaned = cleanIngredientName(name)
  if (!cleaned)
    return []

  const names = catalog ?? catalogIngredientNames()
  const set = new Set(names)
  if (set.has(cleaned))
    return [cleaned]

  // 别名归一：西红柿→番茄、鸡翅→鸡肉。
  const aliased = uniqueStuff([cleaned])[0]
  if (aliased && set.has(aliased))
    return [aliased]

  // 子串展开：鲜虾→虾、葱花→葱、姜蒜粒→姜+蒜。
  const hits = names
    .filter(item => item && cleaned.includes(item))
    .sort((a, b) => b.length - a.length)
  if (!hits.length)
    return []
  // 只保留最长的那一批命中，避免「金枪鱼罐头」和「鱼」重复计入。
  return hits.filter(item => !hits.some(other => other !== item && other.length > item.length && other.includes(item)))
}

/**
 * 批量归一模型给的食材名。
 *
 * names 里同时给出「对到菜单的名字」和「菜单里没有的原名」：
 * 对得上的换成菜单名（鲜虾→虾），对不上的原样保留，
 * 以免主料被悄悄丢掉；unknown 用来提示用户「这几个不在菜单里」。
 */
export function normalizeCatalogIngredients(
  names: string[],
  catalog?: string[],
): { names: string[], unknown: string[] } {
  const list = Array.isArray(names) ? names : []
  const pool = catalog ?? catalogIngredientNames()
  const kept: string[] = []
  const unknown: string[] = []
  for (const item of list) {
    const cleaned = cleanIngredientName(item)
    if (!cleaned)
      continue
    const matched = matchCatalogIngredient(cleaned, pool)
    if (!matched.length) {
      unknown.push(cleaned)
      kept.push(cleaned)
      continue
    }
    kept.push(...matched)
  }
  return { names: uniqueStuff(kept), unknown }
}
