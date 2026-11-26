import process from 'node:process'
import { AssistantError } from './assistant-error.mjs'
import { buildImageParts, looksLikeUnsupportedVision, visionUnsupportedError } from './assistant-images.mjs'
// 料理助手的模型代理：把本地检索出的候选菜谱交给模型挑��并组织语言。
//
// 设计约束（见 docs/decisions/0021-cooking-assistant.md）：
// - 模型只在候选池里挑菜，不能编造菜谱、用料或步骤
// - 每道菜的理由必须基于候选里的 matched / missing 字段
// - 服务端与客户端都会校验引用的菜谱 id，候选之外的一律丢弃

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'
const DEFAULT_TIMEOUT = 30_000
const DEFAULT_MAX_CANDIDATES = 50
const DEFAULT_MAX_IMAGES = 4
const DEFAULT_MAX_IMAGE_BYTES = 700 * 1024
const MAX_ANSWER_PARAGRAPHS = 12
const MAX_TEXT_LENGTH = 400
const MAX_FOLLOWUPS = 4
const MAX_ACTIONS = 3
const MAX_DRAFT_STUFF = 32
const MAX_DRAFT_NOTE = 20_000
const MAX_ADD_NAMES = 10
// 推理型模型（reasoning_content）会占用同一份 max_tokens，答案本身就很短，
// 上限给得太紧会出现「模型没有返回内容」。
const MAX_OUTPUT_TOKENS = 2000
// 带图时答案更长（步骤要抄全），单独放宽。
const MAX_OUTPUT_TOKENS_VISION = 3000
// 带图时候选池收紧：图片本身才是重点，候选只是可选的推荐。
const IMAGE_CANDIDATE_LIMIT = 10
// 带图时一次可以给出多份草稿（多张图可能是多道菜）。
export const MAX_IMAGE_ACTIONS = 6

export { AssistantError }

/** 读取服务端配置；缺 Key 或未启用时 enabled 为 false，页面据此禁用输入。 */
export function readAssistantConfig(env = process.env) {
  const enabled = env.COOK_AI_ENABLED === '1'
  const apiKey = env.COOK_AI_API_KEY || ''
  const baseUrl = (env.COOK_AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const model = env.COOK_AI_MODEL || DEFAULT_MODEL
  const timeout = Number(env.COOK_AI_TIMEOUT_MS || DEFAULT_TIMEOUT)
  const maxCandidates = Math.max(1, Number(env.COOK_AI_MAX_CANDIDATES || DEFAULT_MAX_CANDIDATES))
  const dailyLimit = Math.max(0, Number(env.COOK_AI_USER_DAILY_LIMIT || 100))
  const minuteLimit = Math.max(0, Number(env.COOK_AI_USER_MINUTE_LIMIT || 10))
  const visionModel = String(env.COOK_AI_VISION_MODEL || '').trim()
  const maxImages = Math.max(0, Number(env.COOK_AI_MAX_IMAGES || DEFAULT_MAX_IMAGES))
  const maxImageBytes = Math.max(1, Number(env.COOK_AI_MAX_IMAGE_BYTES || DEFAULT_MAX_IMAGE_BYTES))
  return {
    enabled: enabled && Boolean(apiKey),
    configured: enabled && Boolean(apiKey),
    baseUrl,
    model,
    visionModel,
    apiKey,
    timeout: Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT,
    maxCandidates,
    dailyLimit,
    minuteLimit,
    maxImages,
    maxImageBytes,
  }
}

/** 只允许 http/https；http 仅放行本机地址，避免把 Key 明文发到外网。 */
/**
 * 接受三种写法，都归一成「base URL」：
 * - https://api.deepseek.com/v1
 * - https://api.deepseek.com/v1/
 * - https://api.deepseek.com/v1/chat/completions（完整 endpoint）
 * 之后统一请求 `${base}/chat/completions` 与 `${base}/models`。
 */
export function normalizeBaseUrl(value) {
  let text = String(value ?? '').trim().replace(/\/+$/, '')
  if (!text)
    throw new AssistantError('INVALID_CONFIG', '请填写模型服务地址', 400)
  if (/\/chat\/completions$/i.test(text))
    text = text.replace(/\/chat\/completions$/i, '')
  let url
  try {
    url = new URL(text)
  }
  catch {
    throw new AssistantError('INVALID_CONFIG', '模型服务地址不是合法 URL', 400)
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new AssistantError('INVALID_CONFIG', '模型服务地址只支持 http 或 https', 400)
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new AssistantError('INVALID_CONFIG', '非本机地址必须使用 https', 400)
  return text
}

/** 拉取服务商提供的模型列表，供设置页下拉选择。 */
export async function listAssistantModels({ baseUrl, apiKey, timeout = 15_000 }) {
  let response
  try {
    response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(Math.min(timeout, 15_000)),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    })
  }
  catch (error) {
    if (error?.name === 'TimeoutError')
      throw new AssistantError('MODEL_TIMEOUT', '获取模型列表超时', 504)
    throw new AssistantError('SERVICE_UNAVAILABLE', '无法连接模型服务，请检查地址', 503)
  }

  if (response.status === 401 || response.status === 403)
    throw new AssistantError('INVALID_CONFIG', 'API Key 无效或没有权限', 400)
  if (response.status === 404)
    throw new AssistantError('NO_MODEL_LIST', '该服务不提供模型列表，请手动填写模型名称', 404)
  if (!response.ok)
    throw new AssistantError('SERVICE_UNAVAILABLE', `获取模型列表失败（${response.status}）`, 503)

  let body
  try {
    body = await response.json()
  }
  catch {
    throw new AssistantError('NO_MODEL_LIST', '模型列表不是合法 JSON，请手动填写模型名称', 502)
  }

  const raw = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
  const models = [...new Set(raw
    .map(item => (typeof item === 'string' ? item : item?.id ?? item?.name))
    .filter(item => typeof item === 'string' && item.trim())
    .map(item => item.trim()))]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 200)

  if (!models.length)
    throw new AssistantError('NO_MODEL_LIST', '该服务没有返回可用模型，请手动填写模型名称', 404)
  return models
}

export function normalizeModel(value) {
  const text = String(value ?? '').trim()
  if (!text)
    throw new AssistantError('INVALID_CONFIG', '请填写模型名称', 400)
  if (text.length > 80)
    throw new AssistantError('INVALID_CONFIG', '模型名称过长', 400)
  return text
}

/** 用一条极小的请求验证地址与 Key 是否可用。 */
export async function testAssistantConnection(config) {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 8,
      stream: false,
    }),
    signal: AbortSignal.timeout(Math.min(config.timeout, 15_000)),
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  })
  if (response.status === 401 || response.status === 403)
    throw new AssistantError('INVALID_CONFIG', 'API Key 无效或没有权限', 400)
  if (!response.ok)
    throw new AssistantError('SERVICE_UNAVAILABLE', `模型服务返回 ${response.status}`, 503)
  return true
}

const SYSTEM_PROMPT = [
  '你是「料理手帐」的做菜助手。你只能根据给定的候选菜谱和用户的库存回答。',
  '规则：',
  '1. 只能引用候选池里的菜名与 id，绝不编造菜谱、用料、步骤或用量。',
  '2. 自主挑选最合适的那几道并给出你自己的排序，不要只是照抄候选顺序；候选里没有能做的菜时，就说明还缺什么，不要硬凑。',
  '3. 每道菜的理由只能引用候选里的 matched（已有）与 missing（还缺）字段，不要自己计算。',
  '4. 中文回答，简洁直接，总共不超过 200 字，先给结论再给理由。',
  '5. 不给营养、医疗、减脂或价格建议。',
  '6. 严格输出 JSON，不要输出 JSON 以外的任何内容：',
  '{"picked":[{"id":0,"why":"一句话理由"}],"answer":["段落一","段落二"],"needs":["还缺的关键食材"],"followups":["建议的下一个问题"],"warnings":["看不清或需要核对的地方"],"actions":[]}',
  '说明：picked 按推荐顺序排列，可为空；answer 是回答段落数组；needs、followups、warnings 可省略。',
  '7. 用户可能让你「记一道菜」「把某道菜改成…」「把某食材加入厨房」。这类写操作放进 actions 数组，不要只写在 answer 里：',
  '   - 新增或修改用户的菜谱：{"type":"draft_recipe","recipe":{"name":"菜名","stuff":["食材"],"tools":["厨具"],"note":"做法备注，可为空","editId":"仅当用户要求修改「我的菜谱」里的某道菜时，填它的 customId"}}。官方收录的菜谱是只读的，不要为它们生成 draft_recipe。',
  '   - 添加食材到厨房：{"type":"add_ingredients","names":["食材1","食材2"]}。',
  '   - editId 只能从上下文「我的菜谱」的 customId 里原样取；用户说的菜不在「我的菜谱」里就不要填 editId。',
  '   - 不确定时不要编造 editId；用户没说清是哪道菜时，先在 answer 里问一句。',
].join('\n')

// 带图时额外追加的规则：告诉模型怎么把截图里的菜谱抄成结构化草稿。
// 见 docs/decisions/0024-assistant-image-input.md。
const IMAGE_PROMPT = [
  '这次用户上传了图片，请按图片顺序阅读。',
  '图片通常是手机截图：一张「食材准备」表（菜名、用料、用量）和若干「做菜步骤」截图。',
  '1. 先判断每张图属于哪道菜：同一道菜的「食材图」和「步骤图」必须合并成一份 draft_recipe；属于不同菜就各自出一份 draft_recipe。',
  '2. stuff 只能用「可用食材名」里的名字，不得自创。图中「鲜虾」写「虾」，「葱花」写「葱」，「姜蒜粒」写「姜」「蒜」；用量不要写进 stuff。',
  '3. note 写编号步骤，用量直接写进步骤句里，格式与现有菜谱步骤一致，例如：',
  '1. 锅中倒入稍多油，油热平铺下锅',
  '2. 煎至底面微焦变色再翻面，按压虾头煎出虾油',
  '3. 加姜蒜粒炒香',
  '4. 生抽2勺、蚝油1勺、糖半勺、陈醋1勺、番茄酱1勺、少许水倒入，小火翻炒焖2分钟入味',
  '5. 大火收汁，撒葱花出锅',
  '4. 看不清的地方标「（存疑）」，并在 warnings 里写明哪张图无法辨认；不要把猜测写进 stuff 或步骤。',
  '5. 图片与做菜无关时，说明这一点，不产出草稿。',
  '6. 图片里的菜不在候选池也要出 draft_recipe：候选池只用于推荐，不是草稿的来源。',
].join('\n')

function clip(text, max = MAX_TEXT_LENGTH) {
  return String(text ?? '').trim().slice(0, max)
}

function normalizeList(value, max = 8) {
  if (!Array.isArray(value))
    return []
  return value.map(item => clip(item)).filter(Boolean).slice(0, max)
}

/**
 * 校验模型给出的写操作：逐条白名单校验，非法条目静默丢弃（不整体报错），
 * 保证没有 actions 或 actions 畸形时行为与旧版完全一致。
 */
export function normalizeActions(raw, max = MAX_ACTIONS) {
  if (!Array.isArray(raw))
    return []
  const actions = []
  for (const item of raw.slice(0, max)) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      continue
    if (item.type === 'draft_recipe') {
      const recipe = item.recipe && typeof item.recipe === 'object' && !Array.isArray(item.recipe) ? item.recipe : null
      const name = clip(recipe?.name, 30)
      const stuff = normalizeList(recipe?.stuff, MAX_DRAFT_STUFF)
      if (!name || !stuff.length)
        continue
      const editId = clip(recipe?.editId, 160)
      actions.push({
        type: 'draft_recipe',
        recipe: {
          name,
          stuff,
          tools: normalizeList(recipe.tools, 16),
          note: clip(recipe?.note, MAX_DRAFT_NOTE),
          ...(editId ? { editId } : {}),
        },
      })
    }
    else if (item.type === 'add_ingredients') {
      const names = normalizeList(item.names, MAX_ADD_NAMES)
      if (!names.length)
        continue
      actions.push({ type: 'add_ingredients', names })
    }
    // 其它 type 一律丢弃：客户端不认识的操作绝不透传。
  }
  return actions
}

/** 把请求体整理成模型可用的上下文；只保留必要字段，控制 token。 */
export function buildAssistantMessages(input) {
  const question = clip(input?.question, 1000)
  const images = Array.isArray(input?.images) ? input.images : []
  if (!question && !images.length)
    throw new AssistantError('INVALID_REQUEST', '请先输入问题', 400)

  const allCandidates = Array.isArray(input?.candidates) ? input.candidates : []
  // 带图时候选池收紧：图片才是这一轮的重点，候选只是可选的推荐。
  const candidates = images.length ? allCandidates.slice(0, IMAGE_CANDIDATE_LIMIT) : allCandidates
  const inventory = input?.inventory && typeof input.inventory === 'object' ? input.inventory : {}
  const myRecipes = Array.isArray(input?.myRecipes) ? input.myRecipes : []
  const context = {
    question,
    库存: {
      食材: normalizeList(inventory.ingredients, 60),
      厨具: normalizeList(inventory.tools, 20),
      调料: normalizeList(inventory.pantry, 20),
    },
    收藏过的菜: normalizeList(input?.favorites, 30),
    最近做过的菜: normalizeList(input?.historyRecipes, 20),
    我的菜谱: myRecipes.slice(0, 20).map(recipe => ({
      customId: clip(recipe?.customId, 160),
      菜名: clip(recipe?.name, 60),
      食材: normalizeList(recipe?.stuff, 20),
      厨具: normalizeList(recipe?.tools, 10),
      备注: clip(recipe?.note, 300),
    })).filter(recipe => recipe.customId && recipe.菜名),
    候选菜谱: candidates.map(candidate => ({
      id: candidate.id,
      菜名: candidate.name,
      需要: normalizeList(candidate.stuff, 12),
      已有: normalizeList(candidate.matched, 12),
      还缺: normalizeList(candidate.missing, 12),
      厨具: normalizeList(candidate.tools, 4),
      做法: normalizeList(candidate.methods, 4),
      难度: clip(candidate.difficulty, 6),
      标签: normalizeList(candidate.tags, 5),
    })),
  }

  // 带图时把「可选食材名」交给模型，模型不得自创食材名。
  if (images.length) {
    context.图片 = `用户上传了 ${images.length} 张图片`
    context.可用食材名 = normalizeList(input?.ingredientNames, 200)
  }

  const history = Array.isArray(input?.history)
    ? input.history
        .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
        .slice(-6)
        .map(item => ({ role: item.role, content: clip(item.content, 1000) }))
    : []

  const system = images.length ? `${SYSTEM_PROMPT}\n\n${IMAGE_PROMPT}` : SYSTEM_PROMPT
  const userContent = images.length
    ? [{ type: 'text', text: JSON.stringify(context) }, ...buildImageParts(images)]
    : JSON.stringify(context)

  return [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: userContent },
  ]
}

/**
 * 校验模型输出：只保留候选池里的菜谱 id，段落与追问做长度与数量限制。
 * 返回 { picked, answer, needs, followups, actions }。
 */
export function validateAssistantAnswer(raw, candidateIds, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AssistantError('INVALID_MODEL_RESPONSE', '模型返回的内容不是合法 JSON 对象', 502)

  const allowed = new Set(candidateIds)
  const picked = []
  const seen = new Set()
  if (Array.isArray(raw.picked)) {
    for (const item of raw.picked.slice(0, 12)) {
      if (!item || typeof item !== 'object')
        continue
      const id = Number(item.id)
      if (!Number.isInteger(id) || !allowed.has(id) || seen.has(id))
        continue
      seen.add(id)
      picked.push({ id, why: clip(item.why, 120) })
    }
  }

  const answer = normalizeList(raw.answer, MAX_ANSWER_PARAGRAPHS)
  const needs = normalizeList(raw.needs, 8)
  const followups = normalizeList(raw.followups, MAX_FOLLOWUPS)
  const warnings = normalizeList(raw.warnings, 4)
  const actions = normalizeActions(raw.actions, options.maxActions ?? MAX_ACTIONS)

  // 只给出草稿（actions）也算有内容：读图识菜谱时模型常常只回草稿。
  if (!answer.length && !picked.length && !needs.length && !actions.length)
    throw new AssistantError('INVALID_MODEL_RESPONSE', '模型没有给出可用内容', 502)

  return { picked, answer, needs, followups, warnings, actions }
}

/** 调用模型并解析出结构化结果。 */
export async function callAssistantModel(config, messages, options = {}) {
  if (!config.enabled)
    throw new AssistantError('SERVICE_UNAVAILABLE', '服务器尚未配置模型', 503)

  const imageCount = Number(options.imageCount || 0)
  // 带图时优先用专门配置的「图片模型」；没配就用主模型试。
  const model = imageCount && config.visionModel ? config.visionModel : config.model

  const body = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: imageCount ? MAX_OUTPUT_TOKENS_VISION : MAX_OUTPUT_TOKENS,
    stream: false,
    response_format: { type: 'json_object' },
  }

  let response
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeout),
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    })
  }
  catch (error) {
    if (error?.name === 'TimeoutError')
      throw new AssistantError('MODEL_TIMEOUT', '模型响应超时，请稍后重试', 504)
    throw new AssistantError('SERVICE_UNAVAILABLE', '无法连接模型服务', 503)
  }

  if (!response.ok) {
    // 上游不收图片时给一条能照着做的提示，而不是干巴巴的状态码。
    const text = await response.text().catch(() => '')
    if (imageCount && looksLikeUnsupportedVision(response.status, text))
      throw visionUnsupportedError()
    throw new AssistantError('MODEL_ERROR', `模型服务返回 ${response.status}`, 502)
  }

  let envelope
  try {
    envelope = await response.json()
  }
  catch {
    throw new AssistantError('INVALID_MODEL_RESPONSE', '模型返回的内容不是合法 JSON', 502)
  }

  const choice = Array.isArray(envelope?.choices) ? envelope.choices[0] : null
  const content = choice?.message?.content
  if (typeof content !== 'string')
    throw new AssistantError('INVALID_MODEL_RESPONSE', '模型没有返回内容', 502)

  try {
    return JSON.parse(content)
  }
  catch {
    throw new AssistantError('INVALID_MODEL_RESPONSE', '模型返回的内容不是合法 JSON', 502)
  }
}
