import type { PrivateRecipe } from '@yunyoujun/cook/custom-recipes'
import type { KitchenData } from './kitchen'
import type { RecipeItem } from '~/types'
import { validatePrivateRecipe } from '@yunyoujun/cook/custom-recipes'
import { createEmptyKitchen, mergeKitchen, normalizeKitchen } from './kitchen'

/**
 * Favorites and browsing history, plus the tombstones needed to sync deletions.
 *
 * Merging is a pure, commutative and idempotent function, so local data, cloud
 * data and imported files can be combined in any order and any number of times.
 */

export const USER_DATA_VERSION = 1
export const HISTORY_LIMIT = 200
export const TOMBSTONE_LIMIT = 500
export const TOMBSTONE_TTL = 180 * 24 * 60 * 60 * 1000
/** 我的菜谱同步：条数上限与体积上限，超出的部分只留在本机。 */
export const CUSTOM_RECIPE_SYNC_LIMIT = 2000
export const CUSTOM_RECIPE_SYNC_BUDGET_BYTES = 2 * 1024 * 1024
export const CUSTOM_RECIPE_TOMBSTONE_LIMIT = 1000

export interface FavoriteEntry { id: number, time: number }
export interface FavoriteRemoval { id: number, time: number }
export interface HistoryEntry { recipe: RecipeItem, time: number }
/** Identifies one removed history record by its recipe name and visit time. */
export interface HistoryRemoval { name: string, time: number }
/** Identifies one removed private recipe by its id and removal time. */
export interface CustomRecipeRemoval { customId: string, time: number }

export interface UserData {
  kitchen: KitchenData
  favorites: FavoriteEntry[]
  favoriteRemovals: FavoriteRemoval[]
  histories: HistoryEntry[]
  historyRemovals: HistoryRemoval[]
  /** Records visited at or before this time were cleared. */
  historyClearedAt: number
  /** 用户自己添加的菜谱：与备份文件同一套字段口径。 */
  customRecipes: PrivateRecipe[]
  customRecipeRemovals: CustomRecipeRemoval[]
}

export interface UserDataExportFile extends UserData {
  app: 'cook'
  version: typeof USER_DATA_VERSION
  exportedAt: number
}

export function createEmptyUserData(): UserData {
  return {
    kitchen: createEmptyKitchen(),
    favorites: [],
    favoriteRemovals: [],
    histories: [],
    historyRemovals: [],
    historyClearedAt: 0,
    customRecipes: [],
    customRecipeRemovals: [],
  }
}

export function mergeUserData(a: UserData, b: UserData, now = Date.now()): UserData {
  const historyClearedAt = Math.max(a.historyClearedAt, b.historyClearedAt)
  const { favorites, favoriteRemovals } = mergeFavorites(
    [...a.favorites, ...b.favorites],
    [...a.favoriteRemovals, ...b.favoriteRemovals],
    now,
  )
  const { histories, historyRemovals } = mergeHistories(
    [...a.histories, ...b.histories],
    [...a.historyRemovals, ...b.historyRemovals],
    historyClearedAt,
    now,
  )
  const { customRecipes, customRecipeRemovals } = mergeCustomRecipes(
    [...a.customRecipes, ...b.customRecipes],
    [...a.customRecipeRemovals, ...b.customRecipeRemovals],
    now,
  )
  return {
    kitchen: mergeKitchen(a.kitchen, b.kitchen),
    favorites,
    favoriteRemovals,
    histories,
    historyRemovals,
    historyClearedAt,
    customRecipes,
    customRecipeRemovals,
  }
}

/** 同一道菜谱的规范写法：字段顺序固定，两台设备算出来的字符串才能一致。 */
function canonicalCustomRecipe(recipe: PrivateRecipe): string {
  return JSON.stringify([
    recipe.customId,
    recipe.name,
    recipe.stuff,
    recipe.tools,
    recipe.bv ?? '',
    recipe.link ?? '',
    recipe.note ?? '',
    recipe.tags ?? [],
    recipe.methods ?? [],
    recipe.difficulty ?? '',
    recipe.createdAt,
    recipe.updatedAt,
    recipe.copiedFrom ?? '',
  ])
}

/**
 * 同一道菜谱谁赢：更新时间新的赢；时间一样时取规范写法字典序小的，
 * 这样两台设备合并的结果一定相同（合并必须可交换）。
 */
function compareCustomRecipe(a: PrivateRecipe, b: PrivateRecipe): number {
  if (a.updatedAt !== b.updatedAt)
    return a.updatedAt - b.updatedAt
  const left = canonicalCustomRecipe(a)
  const right = canonicalCustomRecipe(b)
  return left < right ? 1 : left > right ? -1 : 0
}

/**
 * 合并我的菜谱：按 customId 取最新的一份，删除墓碑胜过同刻写入。
 * 与 mergeFavorites 同一套写法，保证可交换、幂等。
 */
export function mergeCustomRecipes(
  adds: PrivateRecipe[],
  removals: CustomRecipeRemoval[],
  now = Date.now(),
): Pick<UserData, 'customRecipes' | 'customRecipeRemovals'> {
  const latestAdd = new Map<string, PrivateRecipe>()
  for (const recipe of Array.isArray(adds) ? adds : []) {
    if (!recipe || typeof recipe.customId !== 'string' || !recipe.customId)
      continue
    const previous = latestAdd.get(recipe.customId)
    if (!previous || compareCustomRecipe(recipe, previous) > 0)
      latestAdd.set(recipe.customId, recipe)
  }
  const latestRemoval = latestByKey(Array.isArray(removals) ? removals : [], removal => removal.customId)

  // 同一时刻删除胜过写入。
  const customRecipes = [...latestAdd.values()]
    .filter(recipe => (latestRemoval.get(recipe.customId)?.time ?? -1) < recipe.updatedAt)
    .sort((a, b) => a.customId < b.customId ? -1 : a.customId > b.customId ? 1 : 0)

  // 写入严格晚于删除的，墓碑才作废（重新加回来的菜谱会复活）。
  const customRecipeRemovals = pruneTombstones(
    [...latestRemoval.values()].filter(removal => (latestAdd.get(removal.customId)?.updatedAt ?? -1) <= removal.time),
    now,
    (a, b) => a.customId < b.customId ? -1 : a.customId > b.customId ? 1 : 0,
    CUSTOM_RECIPE_TOMBSTONE_LIMIT,
  )
    .map(({ customId, time }) => ({ customId, time }))
    .sort((x, y) => y.time - x.time || (x.customId < y.customId ? -1 : x.customId > y.customId ? 1 : 0))

  return { customRecipes, customRecipeRemovals }
}

/**
 * 挑出能放进同步文档的菜谱：按更新时间从新到旧装，装不下的跳过。
 * 是合并结果的纯函数 → 两台设备选出的子集一致，不会来回抖。
 */
export function fitCustomRecipesToBudget(
  recipes: PrivateRecipe[],
  budget = CUSTOM_RECIPE_SYNC_BUDGET_BYTES,
): { recipes: PrivateRecipe[], omitted: number } {
  const sorted = [...(Array.isArray(recipes) ? recipes : [])]
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.customId < b.customId ? -1 : a.customId > b.customId ? 1 : 0))
  const kept: PrivateRecipe[] = []
  let bytes = 0
  for (const recipe of sorted) {
    if (kept.length >= CUSTOM_RECIPE_SYNC_LIMIT)
      break
    const size = JSON.stringify(recipe).length
    if (bytes + size > budget)
      continue
    kept.push(recipe)
    bytes += size
  }
  return { recipes: kept, omitted: sorted.length - kept.length }
}

export function isSameUserData(a: UserData, b: UserData): boolean {
  return JSON.stringify(toPlain(a)) === JSON.stringify(toPlain(b))
}

function mergeFavorites(
  adds: FavoriteEntry[],
  removals: FavoriteRemoval[],
  now: number,
): Pick<UserData, 'favorites' | 'favoriteRemovals'> {
  const latestAdd = latestBy(adds, entry => entry.id)
  const latestRemoval = latestBy(removals, entry => entry.id)

  // Last write wins per recipe id; a removal at the same instant wins.
  const favorites = [...latestAdd.values()]
    .filter(add => (latestRemoval.get(add.id)?.time ?? -1) < add.time)
    .map(({ id, time }) => ({ id, time }))
    .sort((x, y) => x.time - y.time || x.id - y.id)
  const favoriteRemovals = pruneTombstones(
    [...latestRemoval.values()].filter(removal => (latestAdd.get(removal.id)?.time ?? -1) <= removal.time),
    now,
    (x, y) => x.id - y.id,
  )
    .map(({ id, time }) => ({ id, time }))
    .sort((x, y) => x.time - y.time || x.id - y.id)

  return { favorites, favoriteRemovals }
}

function mergeHistories(
  entries: HistoryEntry[],
  removals: HistoryRemoval[],
  clearedAt: number,
  now: number,
): Pick<UserData, 'histories' | 'historyRemovals'> {
  const historyRemovals = pruneTombstones(
    uniqueBy(removals.filter(removal => removal.time > clearedAt), removal => historyKey(removal.name, removal.time)),
    now,
    (x, y) => compareNames(x.name, y.name),
  )
    .map(({ name, time }) => ({ name, time }))
    .sort((x, y) => x.time - y.time || compareNames(x.name, y.name))
  const removed = new Set(historyRemovals.map(removal => historyKey(removal.name, removal.time)))

  // Oldest first, matching how the app appends visits. Recipes are rebuilt in a
  // canonical shape so local and cloud copies of the same visit compare equal.
  const histories = canonicalVisits(
    entries.filter(entry => entry.time > clearedAt && !removed.has(historyKey(entry.recipe.name, entry.time))),
  )
    .sort((x, y) => x.time - y.time || compareNames(x.recipe.name, y.recipe.name))
    .slice(-HISTORY_LIMIT)

  return { histories, historyRemovals }
}

function compareNames(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1
}

function canonicalVisits(entries: HistoryEntry[]): HistoryEntry[] {
  const selected = new Map<string, HistoryEntry>()
  const recipeKey = (recipe: RecipeItem) => JSON.stringify([
    recipe.name,
    recipe.stuff,
    recipe.tools,
    recipe.link ?? null,
    recipe.bv ?? null,
    recipe.difficulty ?? null,
    recipe.emojis ?? null,
    recipe.tags ?? null,
    recipe.methods ?? null,
  ])
  for (const entry of entries) {
    const value = { recipe: readRecipe(entry.recipe) ?? entry.recipe, time: entry.time }
    const key = historyKey(value.recipe.name, value.time)
    const previous = selected.get(key)
    if (!previous || recipeKey(value.recipe) < recipeKey(previous.recipe))
      selected.set(key, value)
  }
  return [...selected.values()]
}

function historyKey(name: string, time: number): string {
  return `${name}\u0000${time}`
}

function latestBy<T extends { time: number }>(list: T[], key: (item: T) => number): Map<number, T> {
  return latestByKey(list, key)
}

/** 与 latestBy 相同，但键可以是字符串（我的菜谱用 customId）。 */
function latestByKey<T extends { time: number }, K>(list: T[], key: (item: T) => K): Map<K, T> {
  const map = new Map<K, T>()
  for (const item of list) {
    const current = map.get(key(item))
    if (!current || item.time > current.time)
      map.set(key(item), item)
  }
  return map
}

function uniqueBy<T>(list: T[], key: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of list) {
    if (!map.has(key(item)))
      map.set(key(item), item)
  }
  return [...map.values()]
}

function pruneTombstones<T extends { time: number }>(list: T[], now: number, breakTie: (a: T, b: T) => number, limit = TOMBSTONE_LIMIT): T[] {
  return list
    .filter(item => item.time >= now - TOMBSTONE_TTL)
    .sort((x, y) => y.time - x.time || breakTie(x, y))
    .slice(0, limit)
}

function toPlain(data: UserData): UserData {
  return {
    kitchen: normalizeKitchen(data.kitchen),
    favorites: data.favorites.map(({ id, time }) => ({ id, time })),
    favoriteRemovals: data.favoriteRemovals.map(({ id, time }) => ({ id, time })),
    histories: data.histories.map(({ recipe, time }) => ({ recipe, time })),
    historyRemovals: data.historyRemovals.map(({ name, time }) => ({ name, time })),
    historyClearedAt: data.historyClearedAt,
    customRecipes: data.customRecipes.map(recipe => ({ ...recipe })),
    customRecipeRemovals: data.customRecipeRemovals.map(({ customId, time }) => ({ customId, time })),
  }
}

/**
 * Validate untrusted data (a cloud document or an imported file).
 * Returns null when the shape is not recognisable; invalid entries are dropped.
 */
export function normalizeUserData(value: unknown): UserData | null {
  if (!isRecord(value))
    return null
  if (value.version !== undefined && value.version !== USER_DATA_VERSION)
    return null

  return {
    kitchen: normalizeKitchen(value.kitchen),
    favorites: readList(value.favorites, readFavorite),
    favoriteRemovals: readList(value.favoriteRemovals, readFavorite),
    histories: readList(value.histories, readHistory),
    historyRemovals: readList(value.historyRemovals, readHistoryRemoval),
    historyClearedAt: isTime(value.historyClearedAt) ? value.historyClearedAt : 0,
    customRecipes: readList(value.customRecipes, readCustomRecipe),
    customRecipeRemovals: readList(value.customRecipeRemovals, readCustomRecipeRemoval),
  }
}

export function createUserDataExport(data: UserData, now = Date.now()): UserDataExportFile {
  return {
    app: 'cook',
    version: USER_DATA_VERSION,
    exportedAt: now,
    ...toPlain(data),
  }
}

export function parseUserDataExport(text: string): UserData | null {
  let value: unknown
  try {
    value = JSON.parse(text)
  }
  catch {
    return null
  }
  if (!isRecord(value) || value.app !== 'cook' || value.version !== USER_DATA_VERSION)
    return null
  return normalizeUserData(value)
}

function readList<T>(value: unknown, read: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value))
    return []
  return value.map(read).filter((item): item is T => item !== null)
}

function readFavorite(value: unknown): FavoriteEntry | null {
  if (!isRecord(value) || !Number.isInteger(value.id) || (value.id as number) < 0 || !isTime(value.time))
    return null
  return { id: value.id as number, time: value.time }
}

function readHistoryRemoval(value: unknown): HistoryRemoval | null {
  if (!isRecord(value) || !isName(value.name) || !isTime(value.time))
    return null
  return { name: value.name, time: value.time }
}

/** 我的菜谱：与备份文件用同一套校验，非法的整条丢掉，不影响其余。 */
function readCustomRecipe(value: unknown): PrivateRecipe | null {
  try {
    return validatePrivateRecipe(value)
  }
  catch {
    return null
  }
}

function readCustomRecipeRemoval(value: unknown): CustomRecipeRemoval | null {
  if (!isRecord(value) || typeof value.customId !== 'string' || !value.customId || !isTime(value.time))
    return null
  return { customId: value.customId, time: value.time }
}

function readHistory(value: unknown): HistoryEntry | null {
  if (!isRecord(value) || !isTime(value.time))
    return null
  const recipe = readRecipe(value.recipe)
  return recipe ? { recipe, time: value.time } : null
}

function readRecipe(value: unknown): RecipeItem | null {
  if (!isRecord(value) || !isName(value.name))
    return null

  const recipe: RecipeItem = {
    name: value.name,
    stuff: readStrings(value.stuff),
    tools: readStrings(value.tools),
  }
  for (const key of ['link', 'bv', 'difficulty'] as const) {
    if (typeof value[key] === 'string')
      (recipe as unknown as Record<string, unknown>)[key] = value[key]
  }
  for (const key of ['emojis', 'tags', 'methods'] as const) {
    if (Array.isArray(value[key]))
      (recipe as unknown as Record<string, unknown>)[key] = readStrings(value[key])
  }
  return recipe
}

function readStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
