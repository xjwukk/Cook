import process from 'node:process'
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
const MAX_ANSWER_PARAGRAPHS = 12
const MAX_TEXT_LENGTH = 400
const MAX_FOLLOWUPS = 4

export class AssistantError extends Error {
  constructor(code, message, status = 502) {
    super(message)
    this.code = code
    this.status = status
  }
}

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
  return {
    enabled: enabled && Boolean(apiKey),
    configured: enabled && Boolean(apiKey),
    baseUrl,
    model,
    apiKey,
    timeout: Number.isFinite(timeout) ? timeout : DEFAULT_TIMEOUT,
    maxCandidates,
    dailyLimit,
    minuteLimit,
  }
}

/** 只允许 http/https；http 仅放行本机地址，避免把 Key 明文发到外网。 */
export function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim().replace(/\/+$/, '')
  if (!text)
    throw new AssistantError('INVALID_CONFIG', '请填写模型服务地址', 400)
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
  '{"picked":[{"id":0,"why":"一句话理由"}],"answer":["段落一","段落二"],"needs":["还缺的关键食材"],"followups":["建议的下一个问题"]}',
  '说明：picked 按推荐顺序排列，可为空；answer 是回答段落数组；needs 与 followups 可省略。',
].join('\n')

function clip(text, max = MAX_TEXT_LENGTH) {
  return String(text ?? '').trim().slice(0, max)
}

function normalizeList(value, max = 8) {
  if (!Array.isArray(value))
    return []
  return value.map(item => clip(item)).filter(Boolean).slice(0, max)
}

/** 把请求体整理成模型可用的上下文；只保留必要字段，控制 token。 */
export function buildAssistantMessages(input) {
  const question = clip(input?.question, 1000)
  if (!question)
    throw new AssistantError('INVALID_REQUEST', '请先输入问题', 400)

  const candidates = Array.isArray(input?.candidates) ? input.candidates : []
  const inventory = input?.inventory && typeof input.inventory === 'object' ? input.inventory : {}
  const context = {
    question,
    库存: {
      食材: normalizeList(inventory.ingredients, 60),
      厨具: normalizeList(inventory.tools, 20),
      调料: normalizeList(inventory.pantry, 20),
    },
    收藏过的菜: normalizeList(input?.favorites, 30),
    最近做过的菜: normalizeList(input?.historyRecipes, 20),
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

  const history = Array.isArray(input?.history)
    ? input.history
        .filter(item => item && (item.role === 'user' || item.role === 'assistant'))
        .slice(-6)
        .map(item => ({ role: item.role, content: clip(item.content, 1000) }))
    : []

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: JSON.stringify(context) },
  ]
}

/**
 * 校验模型输出：只保留候选池里的菜谱 id，段落与追问做长度与数量限制。
 * 返回 { picked, answer, needs, followups }。
 */
export function validateAssistantAnswer(raw, candidateIds) {
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

  if (!answer.length && !picked.length && !needs.length)
    throw new AssistantError('INVALID_MODEL_RESPONSE', '模型没有给出可用内容', 502)

  return { picked, answer, needs, followups }
}

/** 调用模型并解析出结构化结果。 */
export async function callAssistantModel(config, messages) {
  if (!config.enabled)
    throw new AssistantError('SERVICE_UNAVAILABLE', '服务器尚未配置模型', 503)

  const body = {
    model: config.model,
    messages,
    temperature: 0.4,
    max_tokens: 1200,
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

  if (!response.ok)
    throw new AssistantError('MODEL_ERROR', `模型服务返回 ${response.status}`, 502)

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
