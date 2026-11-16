import { Buffer } from 'node:buffer'

/**
 * 官方菜谱覆盖层：管理员修改后的整份菜谱。
 * 这里只做字段形状校验，不依赖 887 条官方数据——菜谱本身是否存在于
 * recipe.csv 由客户端和管理页负责，服务端只保证存进去的东西是干净的。
 */

export const RECIPE_OVERRIDE_FIELDS = ['id', 'name', 'stuff', 'bv', 'difficulty', 'tags', 'methods', 'tools', 'link']
export const RECIPE_OVERRIDE_LIMIT = 8 * 1024

const DIFFICULTIES = new Set(['简单', '普通', '困难', ''])
const VIDEO_ID_RE = /^(?:BV[0-9A-Za-z]{10}|av\d+)$/
const LINK_RE = /^https:\/\/\S+$/
const NAME_MAX = 60

/** 非空字符串数组；allowEmpty 时接受空数组，但仍拒绝空字符串元素 */
function toStringArray(value, allowEmpty = false) {
  if (!Array.isArray(value))
    return null
  const items = []
  for (const item of value) {
    if (typeof item !== 'string')
      return null
    const text = item.trim()
    if (!text)
      return null
    items.push(text)
  }
  if (!allowEmpty && !items.length)
    return null
  return [...new Set(items)]
}

function optionalText(value) {
  if (value === undefined || value === null)
    return ''
  return typeof value === 'string' ? value.trim() : null
}

/** 只保留白名单字段，避免把缓存里多出来的键写进公开接口 */
export function pickRecipeOverride(data) {
  const result = {}
  for (const field of RECIPE_OVERRIDE_FIELDS) {
    if (field in data)
      result[field] = data[field]
  }
  return result
}

/**
 * 校验 PUT body，返回 { data } 或 { error }。
 * data 是规范化后的完整覆盖对象，空的可选字段保留为空字符串，
 * 这样清空视频号 / 图文链接时能覆盖掉原值。
 */
export function validateRecipeOverride(input, expectedId) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { error: '菜谱数据格式不正确' }

  if (typeof input.id !== 'number' || !Number.isInteger(input.id) || input.id < 0 || input.id !== expectedId)
    return { error: '菜谱 id 与地址不一致' }

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name)
    return { error: '菜名不能为空' }
  if ([...name].length > NAME_MAX)
    return { error: `菜名不能超过 ${NAME_MAX} 个字` }

  const stuff = toStringArray(input.stuff)
  if (!stuff)
    return { error: '食材必须是非空字符串列表' }

  const tools = toStringArray(input.tools)
  if (!tools)
    return { error: '厨具必须是非空字符串列表' }

  const tags = toStringArray(input.tags ?? [], true)
  if (!tags)
    return { error: '标签必须是字符串列表' }

  const methods = toStringArray(input.methods ?? [], true)
  if (!methods)
    return { error: '做法必须是字符串列表' }

  const difficulty = input.difficulty ?? ''
  if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty))
    return { error: '难度只能是「简单 / 普通 / 困难」或留空' }

  const bv = optionalText(input.bv)
  if (bv === null)
    return { error: '视频号格式不正确' }
  if (bv && !VIDEO_ID_RE.test(bv))
    return { error: '视频号应为 BV 号或 av 号' }

  const link = optionalText(input.link)
  if (link === null)
    return { error: '图文链接格式不正确' }
  if (link && !LINK_RE.test(link))
    return { error: '图文链接应以 https:// 开头' }

  const data = { id: input.id, name, stuff, bv, difficulty, tags, methods, tools, link }

  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > RECIPE_OVERRIDE_LIMIT)
    return { error: '单条菜谱数据不能超过 8 KB' }

  return { data }
}
