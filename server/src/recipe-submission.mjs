import { Buffer } from 'node:buffer'

/**
 * 用户投稿：提交到全量菜谱的菜谱，等管理员审核。
 *
 * 字段口径与私人菜谱协议一致（packages/cook/src/utils/custom-recipes.ts），
 * 但服务端零依赖，白名单在这里复制一份。
 */

export const SUBMISSION_FIELDS = ['name', 'stuff', 'tools', 'note', 'bv', 'link', 'difficulty', 'tags', 'methods']
export const SUBMISSION_LIMIT = 96 * 1024
export const SUBMISSION_NAME_MAX = 30
export const SUBMISSION_NOTE_MAX = 20_000
export const SUBMISSION_LIST_MAX = 64
export const SUBMISSION_ITEM_MAX = 100

const DIFFICULTIES = new Set(['简单', '普通', '困难', ''])
const BV = /^BV[0-9a-z]{10}$/i
const LINK_MAX = 4096

function toStringArray(value, allowEmpty = false) {
  if (!Array.isArray(value))
    return null
  const items = []
  for (const item of value) {
    if (typeof item !== 'string')
      return null
    const text = item.trim()
    if (!text || text.length > SUBMISSION_ITEM_MAX)
      return null
    items.push(text)
  }
  if (!allowEmpty && !items.length)
    return null
  if (items.length > SUBMISSION_LIST_MAX)
    return null
  return [...new Set(items)]
}

function optionalText(value, max) {
  if (value === undefined || value === null)
    return ''
  if (typeof value !== 'string')
    return null
  const text = value.trim()
  return text.length > max ? null : text
}

function isHttpsLink(value) {
  if (!value)
    return true
  if (value.length > LINK_MAX || /\s/.test(value))
    return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
  }
  catch {
    return false
  }
}

/**
 * 校验投稿内容，返回 { data } 或 { error }。
 * data 是规范化后的菜谱（不含 id——id 由管理员审核通过时分配）。
 */
export function validateSubmission(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    return { error: '投稿内容格式不正确' }

  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name)
    return { error: '菜名不能为空' }
  if ([...name].length > SUBMISSION_NAME_MAX)
    return { error: `菜名不能超过 ${SUBMISSION_NAME_MAX} 个字` }

  const stuff = toStringArray(input.stuff)
  if (!stuff)
    return { error: '食材必须是非空字符串列表' }

  const tools = toStringArray(input.tools ?? [], true)
  if (!tools)
    return { error: '厨具必须是字符串列表' }

  const note = optionalText(input.note, SUBMISSION_NOTE_MAX)
  if (note === null)
    return { error: `做法备注不能超过 ${SUBMISSION_NOTE_MAX} 个字` }

  const bv = optionalText(input.bv, 160)
  if (bv === null)
    return { error: '视频号格式不正确' }
  if (bv && !BV.test(bv))
    return { error: '视频号应为 BV 号' }

  const link = optionalText(input.link, LINK_MAX)
  if (link === null)
    return { error: '图文链接格式不正确' }
  if (!isHttpsLink(link))
    return { error: '图文链接应以 https:// 开头' }

  const difficulty = input.difficulty ?? ''
  if (typeof difficulty !== 'string' || !DIFFICULTIES.has(difficulty))
    return { error: '难度只能是「简单 / 普通 / 困难」或留空' }

  const tags = toStringArray(input.tags ?? [], true)
  if (!tags)
    return { error: '标签必须是字符串列表' }

  const methods = toStringArray(input.methods ?? [], true)
  if (!methods)
    return { error: '做法必须是字符串列表' }

  const data = { name, stuff, tools, note, bv, link, difficulty, tags, methods }

  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > SUBMISSION_LIMIT)
    return { error: '单条投稿不能超过 96 KB' }

  return { data }
}
