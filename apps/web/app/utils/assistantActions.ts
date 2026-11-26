import type { CustomRecipeInput } from '~/utils/customRecipe'
import { uniqueStuff } from '@yunyoujun/cook/recommend'
import { useKitchenStore } from '~/composables/store/kitchen'
import { usePersonalCatalog } from '~/composables/usePersonalCatalog'
import * as base from '~/data/food'
import { normalizeCatalogIngredients } from '~/utils/ingredientCatalog'
import { readPersonalCatalog } from '~/utils/personalCatalogStorage'
import { scopedKey } from '~/utils/storageScope'

/**
 * 助手写操作的客户端落地：服务端已做过一层校验，这里在执行前再截断与归一一次，
 * 存储层（validatePrivateRecipe）是最后一道兜底。
 */

export const DRAFT_NAME_MAX = 30
export const DRAFT_STUFF_MAX = 32
export const DRAFT_NOTE_MAX = 20_000

export interface AssistantRecipeDraft {
  name: string
  stuff: string[]
  tools: string[]
  note: string
  /** 用户要求修改自己已有菜谱时携带的 customId */
  editId?: string
}

/** 服务端 normalizeActions 的客户端镜像：截断 + 去重，产出可交给 buildCustomRecipe 的输入。 */
export function normalizeDraftRecipe(draft: Partial<AssistantRecipeDraft> | undefined | null): AssistantRecipeDraft | undefined {
  if (!draft || typeof draft !== 'object')
    return undefined
  const name = String(draft.name ?? '').trim().slice(0, DRAFT_NAME_MAX)
  // 食材名对到「现有菜谱菜单」：鲜虾→虾、葱花→葱；对不上的原样保留，不丢主料。
  const { names } = normalizeCatalogIngredients((Array.isArray(draft.stuff) ? draft.stuff : [])
    .map(item => String(item ?? '').trim().slice(0, 100))
    .filter(Boolean))
  const stuff = names.slice(0, DRAFT_STUFF_MAX)
  const tools = [...new Set((Array.isArray(draft.tools) ? draft.tools : [])
    .map(item => String(item ?? '').trim().slice(0, 100))
    .filter(Boolean))].slice(0, 16)
  const note = String(draft.note ?? '').trim().slice(0, DRAFT_NOTE_MAX)
  const editId = String(draft.editId ?? '').trim().slice(0, 160) || undefined
  if (!name || !stuff.length)
    return undefined
  return { name, stuff, tools, note, ...(editId ? { editId } : {}) }
}

/** 草稿 → 表单输入；editId 命中已有菜谱时由调用方传入 existing 完成覆盖保存。 */
export function draftToCustomRecipeInput(draft: AssistantRecipeDraft): CustomRecipeInput {
  return { name: draft.name, stuff: draft.stuff, tools: draft.tools, note: draft.note }
}

function catalogHas(name: string): boolean {
  return [...base.vegetable, ...base.meat, ...base.staple].some(item => item.name === name)
}

/**
 * 把食材加入「我的厨房」：先归一别名（西红柿→番茄），词典外条目写入个人目录
 * （与「我的厨房」页 createAndAdd 的行为一致），再入库。返回实际添加的名字。
 */
export function executeAddIngredients(rawNames: string[]): string[] {
  const kitchen = useKitchenStore()
  const catalog = usePersonalCatalog()
  // uniqueStuff 内部会做别名归一与顿号拆分（西红柿→番茄）。
  const names = uniqueStuff((Array.isArray(rawNames) ? rawNames : [])
    .map(item => String(item ?? '').trim().slice(0, 100))
    .filter(Boolean))
    .slice(0, 10)
  if (!names.length)
    return []

  const owned = new Set(kitchen.ingredients)
  const fresh = [...new Set(names.filter(name => !owned.has(name)))]
  if (!fresh.length)
    return []

  // 与 kitchen.vue createAndAdd 相同的兜底：词典外食材先写个人目录再入库。
  // 目录内容从存储读，避免内存里的旧快照导致重复写入。
  const personalNames = new Set(readPersonalCatalog(localStorage, scopedKey('personal-catalog')).items.map(item => item.name))
  const missing = fresh.filter(name => !catalogHas(name) && !personalNames.has(name))
  if (missing.length) {
    catalog.update(current => ({
      ...current,
      items: [...current.items, ...missing.map(name => ({ category: 'vegetable' as const, name }))],
    }))
  }
  kitchen.addIngredients(fresh)
  return fresh
}
