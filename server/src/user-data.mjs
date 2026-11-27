function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

// 私人菜谱的白名单与 packages/cook/src/utils/custom-recipes.ts 保持一致：
// 服务端零运行时依赖，这里复制一份形状校验，不引入任何字段。
const RECIPE_FIELDS = new Set(['customId', 'name', 'stuff', 'tools', 'bv', 'link', 'note', 'tags', 'methods', 'difficulty', 'createdAt', 'updatedAt', 'copiedFrom'])
const CUSTOM_ID = /^[\w:-]{1,160}$/
const BV = /^BV[0-9a-z]{10}$/i
const DIFFICULTIES = new Set(['', '简单', '普通', '困难'])
const MAX_RECIPES = 5000
const MAX_LIST = 64
const MAX_ITEM = 100
const MAX_NOTE = 20_000
const MAX_LINK = 4096

function stringList(value, allowEmpty) {
  if (!Array.isArray(value) || value.length > MAX_LIST)
    return false
  if (!allowEmpty && !value.length)
    return false
  return value.every(item => typeof item === 'string' && item.trim().length > 0 && item.length <= MAX_ITEM)
}

function isHttpsLink(value) {
  if (value.length > MAX_LINK || /\s/.test(value))
    return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  }
  catch {
    return false
  }
}

function isValidCustomRecipe(value) {
  if (!record(value))
    return false
  if (Object.keys(value).some(key => !RECIPE_FIELDS.has(key)))
    return false
  if (typeof value.customId !== 'string' || !CUSTOM_ID.test(value.customId))
    return false
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 30)
    return false
  if (!stringList(value.stuff, false) || !stringList(value.tools, true))
    return false
  if (!Number.isSafeInteger(value.createdAt) || value.createdAt < 0)
    return false
  if (!Number.isSafeInteger(value.updatedAt) || value.updatedAt < value.createdAt)
    return false
  for (const key of ['tags', 'methods']) {
    if (value[key] !== undefined && !stringList(value[key], true))
      return false
  }
  if (value.bv !== undefined && (typeof value.bv !== 'string' || (value.bv && !BV.test(value.bv))))
    return false
  if (value.link !== undefined && (typeof value.link !== 'string' || !isHttpsLink(value.link)))
    return false
  if (value.note !== undefined && (typeof value.note !== 'string' || value.note.length > MAX_NOTE))
    return false
  if (value.difficulty !== undefined && (typeof value.difficulty !== 'string' || !DIFFICULTIES.has(value.difficulty)))
    return false
  if (value.copiedFrom !== undefined && (typeof value.copiedFrom !== 'string' || !CUSTOM_ID.test(value.copiedFrom)))
    return false
  return true
}

/** Validate the optional kitchen extension without stripping any sync fields. */
export function isValidUserData(data) {
  if (!record(data))
    return false
  if (data.kitchen === undefined)
    return true // Existing v1 clients/backups remain valid.
  const kitchen = data.kitchen
  if (!record(kitchen) || typeof kitchen.initialized !== 'boolean')
    return false
  for (const key of ['ingredients', 'ingredientRemovals', 'tools', 'toolRemovals', 'pantry', 'pantryRemovals']) {
    if (!Array.isArray(kitchen[key]) || !kitchen[key].every(entry => record(entry)
      && typeof entry.name === 'string' && entry.name.trim().length > 0 && entry.name.length <= 200
      && Number.isSafeInteger(entry.time) && entry.time >= 0)) {
      return false
    }
  }
  return true
}

/** 我的菜谱同步：字段形状与条数校验；非法条目整份拒绝（客户端已经先筛过一遍）。 */
export function isValidCustomRecipeSync(data) {
  if (!record(data))
    return false
  if (data.customRecipes !== undefined) {
    if (!Array.isArray(data.customRecipes) || data.customRecipes.length > MAX_RECIPES)
      return false
    if (!data.customRecipes.every(isValidCustomRecipe))
      return false
  }
  if (data.customRecipeRemovals !== undefined) {
    if (!Array.isArray(data.customRecipeRemovals) || data.customRecipeRemovals.length > MAX_RECIPES)
      return false
    if (!data.customRecipeRemovals.every(entry => record(entry)
      && typeof entry.customId === 'string' && CUSTOM_ID.test(entry.customId)
      && Number.isSafeInteger(entry.time) && entry.time >= 0)) {
      return false
    }
  }
  return true
}
