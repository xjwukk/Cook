import type { RecipeItem } from '~/types'
import { shallowRef } from 'vue'

/**
 * 官方菜谱覆盖层。
 *
 * 服务端返回管理员修订过的整份菜谱，按 `recipe.csv` 的 id 覆盖本地 IndexedDB 里的官方版本。
 * 覆盖层只在内存里合并，不写回 IndexedDB，也不改 schema 版本号；离线时用 localStorage 缓存兜底。
 */
const CACHE_KEY = 'cook:recipe-overrides'

/** 公开接口允许出现的字段，和 server/src/recipe-override.mjs 保持一致 */
const OVERRIDE_FIELDS = ['id', 'name', 'stuff', 'bv', 'difficulty', 'tags', 'methods', 'tools', 'link', 'note'] as const

interface OverrideCache {
  version: number
  overrides: RecipeItem[]
}

export const recipeOverrides = shallowRef(new Map<number, RecipeItem>())
export const recipeOverridesVersion = shallowRef(0)

let refreshing: Promise<void> | undefined

function pickOverride(data: RecipeItem): RecipeItem {
  const picked: Record<string, unknown> = {}
  for (const field of OVERRIDE_FIELDS) {
    if (field in data)
      picked[field] = data[field]
  }
  return picked as unknown as RecipeItem
}

function setId(recipe: RecipeItem, id: number): RecipeItem {
  return { ...recipe, id }
}

function applyOne<T extends RecipeItem>(recipe: T, override: RecipeItem): T {
  const next: RecipeItem = {
    ...recipe,
    id: recipe.id,
    name: override.name ?? recipe.name,
    stuff: override.stuff ?? recipe.stuff,
    tools: override.tools ?? recipe.tools,
    tags: override.tags ?? recipe.tags,
    methods: override.methods ?? recipe.methods,
    difficulty: override.difficulty ?? recipe.difficulty,
    bv: override.bv ?? recipe.bv,
    link: override.link ?? recipe.link,
    note: override.note ?? recipe.note,
  }
  return next as T
}

/**
 * 投稿发布的新菜谱：本地数据集里没有这个 id，整个对象都来自覆盖层。
 * 空字符串的可选字段直接丢掉，避免 link/bv 为空串时被当成"有链接"。
 */
function overrideToRecipe(override: RecipeItem, id: number): RecipeItem {
  return {
    id,
    name: override.name ?? '',
    stuff: override.stuff ?? [],
    tools: override.tools ?? [],
    ...(override.tags?.length ? { tags: [...override.tags] } : {}),
    ...(override.methods?.length ? { methods: [...override.methods] } : {}),
    ...(override.difficulty ? { difficulty: override.difficulty } : {}),
    ...(override.bv ? { bv: override.bv } : {}),
    ...(override.link ? { link: override.link } : {}),
    ...(override.note ? { note: override.note } : {}),
  }
}

function persist(version = recipeOverridesVersion.value): void {
  if (typeof localStorage === 'undefined')
    return
  try {
    const cache: OverrideCache = { version, overrides: [...recipeOverrides.value.values()] }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
  }
  catch {
    // 存储不可用时只保留内存里的覆盖层，不影响浏览。
  }
}

function readCache(): OverrideCache | null {
  if (typeof localStorage === 'undefined')
    return null
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw)
      return null
    const parsed = JSON.parse(raw) as Partial<OverrideCache>
    if (!Array.isArray(parsed.overrides))
      return null
    return {
      version: Number(parsed.version) || 0,
      overrides: parsed.overrides.filter(item => item && typeof item === 'object') as RecipeItem[],
    }
  }
  catch {
    return null
  }
}

/** 替换整个覆盖层；写内存、缓存，必要时通知所有引用它的列表重新计算 */
export function setRecipeOverrides(overrides: RecipeItem[], version = 0, writeCache = true): void {
  const map = new Map<number, RecipeItem>()
  for (const item of overrides) {
    const id = Number(item.id)
    if (!Number.isInteger(id) || id < 0)
      continue
    map.set(id, setId(pickOverride(item), id))
  }
  recipeOverrides.value = map
  recipeOverridesVersion.value = Number(version) || 0
  if (writeCache)
    persist()
}

export function upsertRecipeOverride(recipe: RecipeItem, version = Date.now()): void {
  const id = Number(recipe.id)
  if (!Number.isInteger(id) || id < 0)
    return
  const map = new Map(recipeOverrides.value)
  map.set(id, setId(pickOverride(recipe), id))
  recipeOverrides.value = map
  recipeOverridesVersion.value = version
  persist(version)
}

export function removeRecipeOverride(id: number, version = Date.now()): void {
  if (!recipeOverrides.value.has(id))
    return
  const map = new Map(recipeOverrides.value)
  map.delete(id)
  recipeOverrides.value = map
  recipeOverridesVersion.value = version
  persist(version)
}

export function getRecipeOverride(id: number | undefined | null): RecipeItem | undefined {
  return typeof id === 'number' ? recipeOverrides.value.get(id) : undefined
}

export function hasRecipeOverride(id: number | undefined | null): boolean {
  return typeof id === 'number' && recipeOverrides.value.has(id)
}

/**
 * 按 id 用覆盖值替换，并把本地数据集里没有的补丁追加到末尾。
 *
 * 追加的那部分就是「投稿发布的新菜谱」——它们没有本地基表，整个对象来自覆盖层。
 * 以前只做替换，所以发布的新菜谱永远看不到。
 */
export function applyRecipeOverrides<T extends RecipeItem>(recipes: T[]): RecipeItem[] {
  const overrides = recipeOverrides.value
  if (!overrides.size)
    return recipes
  const baseIds = new Set<number>()
  let changed = false
  const next = recipes.map((recipe) => {
    const id = typeof recipe.id === 'number' ? recipe.id : undefined
    if (id !== undefined)
      baseIds.add(id)
    const override = id === undefined ? undefined : overrides.get(id)
    if (!override)
      return recipe
    changed = true
    return applyOne(recipe, override)
  })

  const appended: RecipeItem[] = []
  for (const id of [...overrides.keys()].sort((a, b) => a - b)) {
    if (baseIds.has(id))
      continue
    const override = overrides.get(id)
    if (override)
      appended.push(overrideToRecipe(override, id))
  }

  return changed || appended.length ? [...next, ...appended] : recipes
}

/** 启动时拉取最新覆盖层；失败时回落到本机缓存 */
export function refreshRecipeOverrides(): Promise<void> {
  if (refreshing)
    return refreshing
  refreshing = (async () => {
    try {
      const response = await fetch('/api/recipes/overrides', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!response.ok)
        throw new Error(`HTTP ${response.status}`)
      const body = await response.json() as Partial<OverrideCache>
      if (Array.isArray(body.overrides))
        setRecipeOverrides(body.overrides, Number(body.version) || 0)
    }
    catch {
      const cached = readCache()
      if (cached)
        setRecipeOverrides(cached.overrides, cached.version)
    }
  })().finally(() => {
    refreshing = undefined
  })
  return refreshing
}

// 页面可能在 refresh 之前就开始渲染，先读一次缓存
const cachedAtStart = readCache()
if (cachedAtStart)
  setRecipeOverrides(cachedAtStart.overrides, cachedAtStart.version, false)
