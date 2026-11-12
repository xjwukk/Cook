import { Buffer } from 'node:buffer'
import { createServer } from 'node:http'
import process from 'node:process'
import {
  createSessionToken,
  hashPassword,
  hashSessionToken,
  validateCredentials,
  verifyPassword,
} from './auth.mjs'
import {
  createSessionRepository,
  createUserDataRepository,
  createUserRepository,
  openDatabase,
} from './db.mjs'
import { isValidUserData } from './user-data.mjs'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const DB_PATH = process.env.COOK_DB_PATH || 'data/cook.sqlite'
const SESSION_DAYS = Number(process.env.COOK_SESSION_DAYS || 30)
const SESSION_TTL = SESSION_DAYS * 24 * 60 * 60 * 1000
const COOKIE_SECURE = process.env.COOK_COOKIE_SECURE === '1'
const COOKIE_NAME = 'cook_session'
const BODY_LIMIT = 8 * 1024 * 1024
const INVITE_CODE = process.env.COOK_INVITE_CODE || ''
const ALLOWED_ORIGINS = (process.env.COOK_ALLOWED_ORIGINS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean)

const db = openDatabase(DB_PATH)
const users = createUserRepository(db)
const sessions = createSessionRepository(db)
const userData = createUserDataRepository(db)

// 预置管理员：只在首次启动时创建；已存在时只补角色，不覆盖密码。
const ADMIN_USERNAME = process.env.COOK_ADMIN_USERNAME || ''
const ADMIN_PASSWORD = process.env.COOK_ADMIN_PASSWORD || ''
async function seedAdmin() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD)
    return
  const existing = users.findByUsername(ADMIN_USERNAME)
  if (!existing) {
    users.create(ADMIN_USERNAME, await hashPassword(ADMIN_PASSWORD), 'admin')
    process.stdout.write(`[cook-server] created admin account "${ADMIN_USERNAME}"\n`)
  }
  else if (existing.role !== 'admin') {
    users.setRole(existing.id, 'admin')
    process.stdout.write(`[cook-server] promoted "${ADMIN_USERNAME}" to admin\n`)
  }
}

sessions.deleteExpired()
setInterval(() => sessions.deleteExpired(), 60 * 60 * 1000).unref()

// ---------- 基础工具 ----------

function sendJson(res, status, payload, headers = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(body)
}

function parseCookies(header = '') {
  const result = Object.create(null)
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0)
      continue
    const key = part.slice(0, index).trim()
    if (key)
      result[key] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return result
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > BODY_LIMIT)
      throw Object.assign(new Error('请求体过大'), { status: 413 })
    chunks.push(chunk)
  }
  if (!chunks.length)
    return {}
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('not an object')
    return value
  }
  catch {
    throw Object.assign(new Error('请求体不是合法 JSON 对象'), { status: 400 })
  }
}

function originAllowed(req) {
  const origin = req.headers.origin
  // 同源 fetch 会带 Origin；没有 Origin 的请求来自 curl 或同站表单，交给 SameSite 保护。
  if (!origin)
    return true
  if (ALLOWED_ORIGINS.length)
    return ALLOWED_ORIGINS.includes(origin)
  try {
    return new URL(origin).host === req.headers.host
  }
  catch {
    return false
  }
}

// ---------- 登录限流 ----------

const attempts = new Map()
const ATTEMPT_WINDOW = 10 * 60 * 1000
const ATTEMPT_LIMIT = Number(process.env.COOK_RATE_LIMIT || 10)

function tooManyAttempts(key) {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.reset <= now) {
    attempts.set(key, { count: 0, reset: now + ATTEMPT_WINDOW })
    return false
  }
  return entry.count >= ATTEMPT_LIMIT
}

function recordAttempt(key) {
  const entry = attempts.get(key)
  if (entry)
    entry.count += 1
}

setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of attempts) {
    if (entry.reset <= now)
      attempts.delete(key)
  }
}, ATTEMPT_WINDOW).unref()

// ---------- 会话 ----------

function sessionCookie(token, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (COOKIE_SECURE)
    parts.push('Secure')
  return parts.join('; ')
}

/** 可读的账号 id，用于前端按账号隔离本机存储；它不是凭据，服务端仍以会话判定身份。 */
function uidCookie(userId, maxAgeSeconds) {
  const parts = [`cook_uid=${userId}`, 'Path=/', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
  if (COOKIE_SECURE)
    parts.push('Secure')
  return parts.join('; ')
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (!token)
    return null
  const row = sessions.findUser(hashSessionToken(token))
  if (!row || row.expiresAt <= Date.now())
    return null
  return { id: row.id, username: row.username, role: row.role }
}

function requireAdmin(req, res) {
  const user = currentUser(req)
  if (!user) {
    sendJson(res, 401, { error: '未登录' })
    return null
  }
  if (user.role !== 'admin') {
    sendJson(res, 403, { error: '需要管理员权限' })
    return null
  }
  return user
}

function startSession(res, user) {
  const token = createSessionToken()
  sessions.create(hashSessionToken(token), user.id, SESSION_TTL)
  const maxAge = Math.floor(SESSION_TTL / 1000)
  res.setHeader('Set-Cookie', [sessionCookie(token, maxAge), uidCookie(user.id, maxAge)])
}

function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE_NAME]
  if (token)
    sessions.delete(hashSessionToken(token))
  res.setHeader('Set-Cookie', [sessionCookie('', 0), uidCookie('', 0)])
}

// ---------- 路由 ----------

const routes = [
  ['GET', /^\/api\/health$/, async (req, res) => {
    sendJson(res, 200, { ok: true, users: users.count() })
  }],

  ['POST', /^\/api\/auth\/register$/, async (req, res) => {
    const ip = req.socket.remoteAddress || 'unknown'
    if (tooManyAttempts(`register:${ip}`)) {
      sendJson(res, 429, { error: '尝试次数过多，请稍后再试' })
      return
    }
    recordAttempt(`register:${ip}`)

    if (!INVITE_CODE) {
      sendJson(res, 503, { error: '服务器尚未配置邀请码，注册已关闭' })
      return
    }

    const body = await readJson(req)
    if (String(body.inviteCode ?? '') !== INVITE_CODE) {
      sendJson(res, 403, { error: '邀请码不正确' })
      return
    }
    const username = String(body.username ?? '').trim()
    const password = String(body.password ?? '')
    const invalid = validateCredentials(username, password)
    if (invalid) {
      sendJson(res, 400, { error: invalid })
      return
    }
    if (users.findByUsername(username)) {
      sendJson(res, 409, { error: '这个用户名已经被注册' })
      return
    }
    const user = users.create(username, await hashPassword(password))
    startSession(res, user)
    sendJson(res, 201, { user })
  }],

  ['POST', /^\/api\/auth\/login$/, async (req, res) => {
    const body = await readJson(req)
    const username = String(body.username ?? '').trim()
    const password = String(body.password ?? '')
    const key = `login:${req.socket.remoteAddress || 'unknown'}:${username}`
    if (tooManyAttempts(key)) {
      sendJson(res, 429, { error: '尝试次数过多，请稍后再试' })
      return
    }
    const record = users.findByUsername(username)
    const ok = record ? await verifyPassword(password, record.passwordHash) : false
    if (!ok) {
      recordAttempt(key)
      // 不区分「用户不存在」和「密码错误」，避免枚举账号。
      sendJson(res, 401, { error: '用户名或密码不正确' })
      return
    }
    const user = { id: record.id, username: record.username, role: record.role }
    startSession(res, user)
    sendJson(res, 200, { user })
  }],

  ['POST', /^\/api\/auth\/password$/, async (req, res) => {
    const user = currentUser(req)
    if (!user) {
      sendJson(res, 401, { error: '未登录' })
      return
    }
    const body = await readJson(req)
    const record = users.findByUsername(user.username)
    if (!record || !await verifyPassword(String(body.currentPassword ?? ''), record.passwordHash)) {
      sendJson(res, 401, { error: '当前密码不正确' })
      return
    }
    const next = String(body.newPassword ?? '')
    const invalid = validateCredentials(user.username, next)
    if (invalid) {
      sendJson(res, 400, { error: invalid })
      return
    }
    users.updatePassword(user.id, await hashPassword(next))
    sendJson(res, 204)
  }],

  ['GET', /^\/api\/admin\/users$/, async (req, res) => {
    if (!requireAdmin(req, res))
      return
    sendJson(res, 200, { users: users.list() })
  }],

  ['DELETE', /^\/api\/admin\/users\/(\d+)$/, async (req, res, match) => {
    const admin = requireAdmin(req, res)
    if (!admin)
      return
    const id = Number(match[1])
    if (id === admin.id) {
      sendJson(res, 400, { error: '不能删除当前登录的管理员账号' })
      return
    }
    const target = users.findById(id)
    if (!target) {
      sendJson(res, 404, { error: '账号不存在' })
      return
    }
    if (target.role === 'admin' && users.countAdmins() <= 1) {
      sendJson(res, 400, { error: '至少保留一个管理员账号' })
      return
    }
    users.remove(id)
    sendJson(res, 204)
  }],

  ['POST', /^\/api\/admin\/users\/(\d+)\/password$/, async (req, res, match) => {
    if (!requireAdmin(req, res))
      return
    const id = Number(match[1])
    const target = users.findById(id)
    if (!target) {
      sendJson(res, 404, { error: '账号不存在' })
      return
    }
    const body = await readJson(req)
    const next = String(body.newPassword ?? '')
    const invalid = validateCredentials(target.username, next)
    if (invalid) {
      sendJson(res, 400, { error: invalid })
      return
    }
    users.updatePassword(id, await hashPassword(next))
    sendJson(res, 204)
  }],

  ['POST', /^\/api\/auth\/logout$/, async (req, res) => {
    endSession(req, res)
    sendJson(res, 204)
  }],

  ['GET', /^\/api\/auth\/me$/, async (req, res) => {
    const user = currentUser(req)
    if (!user)
      sendJson(res, 401, { error: '未登录' })
    else
      sendJson(res, 200, { user })
  }],

  ['GET', /^\/api\/user-data$/, async (req, res) => {
    const user = currentUser(req)
    if (!user) {
      sendJson(res, 401, { error: '未登录' })
      return
    }
    const stored = userData.get(user.id)
    sendJson(res, 200, stored ?? { data: null, updatedAt: 0 })
  }],

  ['PUT', /^\/api\/user-data$/, async (req, res) => {
    const user = currentUser(req)
    if (!user) {
      sendJson(res, 401, { error: '未登录' })
      return
    }
    const body = await readJson(req)
    if (!isValidUserData(body.data)) {
      sendJson(res, 400, { error: '数据格式不正确' })
      return
    }
    // Old v1 clients do not know the kitchen extension. Their full-document
    // upload must not erase inventory or its permanent deletion tombstones.
    const data = body.data
    if (data.kitchen === undefined) {
      const previousKitchen = userData.get(user.id)?.data?.kitchen
      if (previousKitchen !== undefined)
        data.kitchen = previousKitchen
    }
    const saved = userData.put(user.id, data)
    sendJson(res, 200, saved)
  }],
]

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  const method = req.method || 'GET'

  try {
    if (method !== 'GET' && method !== 'HEAD' && !originAllowed(req)) {
      sendJson(res, 403, { error: '请求来源不受信任' })
      return
    }

    for (const [routeMethod, pattern, handler] of routes) {
      if (routeMethod !== method)
        continue
      const match = url.pathname.match(pattern)
      if (!match)
        continue
      await handler(req, res, match)
      return
    }

    sendJson(res, 404, { error: '接口不存在' })
  }
  catch (error) {
    const status = Number(error?.status) || 500
    if (status >= 500)
      console.error('[cook-server]', error)
    sendJson(res, status, { error: status >= 500 ? '服务器内部错误' : error.message })
  }
})

// 先准备好管理员账号再开始接收请求，避免注册接口与预置账号竞争同一个用户名。
seedAdmin().then(() => {
  server.listen(PORT, HOST, () => {
    process.stdout.write(`[cook-server] listening on http://${HOST}:${PORT}, db=${DB_PATH}\n`)
  })
}, (error) => {
  console.error('[cook-server] failed to seed admin', error)
  process.exit(1)
})

function shutdown() {
  server.close(() => {
    db.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
