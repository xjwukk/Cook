import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildAssistantMessages, validateAssistantAnswer } from '../src/assistant.mjs'

const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cook-assistant-test-'))
const port = 19000 + Math.floor(Math.random() * 1000)
const modelPort = port + 1000
const base = `http://127.0.0.1:${port}`

let child
let model
let modelReply = { picked: [], answer: ['默认回答'] }
let modelStatus = 200

function cookieFrom(response) {
  return response.headers.get('set-cookie')?.split(';')[0] ?? ''
}

async function post(path, body, cookie) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}

async function loginAs(username, password) {
  const response = await post('/api/auth/login', { username, password })
  assert.equal(response.status, 200)
  return cookieFrom(response)
}

before(async () => {
  // 本地 mock 模型：按固定格式回包，便于断言校验与排序行为。
  model = createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    res.writeHead(modelStatus, { 'Content-Type': 'application/json' })
    if (modelStatus !== 200) {
      res.end(JSON.stringify({ error: 'upstream failed' }))
      return
    }
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: JSON.stringify(modelReply) }, finish_reason: 'stop' }],
    }))
  })
  await new Promise(resolve => model.listen(modelPort, '127.0.0.1', resolve))

  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      COOK_DB_PATH: join(dir, 'test.sqlite'),
      COOK_INVITE_CODE: 'invite-123',
      COOK_ADMIN_USERNAME: 'theadmin',
      COOK_ADMIN_PASSWORD: 'adminpass123',
      COOK_RATE_LIMIT: '1000',
      COOK_AI_ENABLED: '1',
      COOK_AI_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      COOK_AI_API_KEY: 'test-key',
      COOK_AI_MODEL: 'test-model',
      COOK_AI_USER_DAILY_LIMIT: '1000',
      COOK_AI_USER_MINUTE_LIMIT: '1000',
    },
    stdio: 'ignore',
  })

  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok)
        return
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('server did not start')
})

after(async () => {
  if (child) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill()
    await exited
  }
  await new Promise(resolve => model.close(resolve))
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  catch {}
})

const candidates = [
  { id: 7, name: '番茄炒蛋', stuff: ['番茄', '鸡蛋'], matched: ['番茄', '鸡蛋'], missing: [], tools: ['炒锅'], methods: ['炒'], difficulty: '简单', tags: [] },
  { id: 23, name: '红烧肉', stuff: ['猪肉', '五花肉'], matched: ['猪肉'], missing: ['五花肉'], tools: ['炒锅'], methods: ['炖'], difficulty: '普通', tags: [] },
]

describe('assistant answer validation', () => {
  it('drops recipe ids outside the candidate pool and keeps model order', () => {
    const result = validateAssistantAnswer({
      picked: [{ id: 23, why: '只差五花肉' }, { id: 999, why: '编的' }, { id: 7, why: '现有食材就能做' }],
      answer: ['先做这道'],
      followups: ['还有别的吗'],
    }, [7, 23])
    assert.deepEqual(result.picked.map(item => item.id), [23, 7])
    assert.equal(result.followups.length, 1)
  })

  it('rejects an answer with nothing usable', () => {
    assert.throws(() => validateAssistantAnswer({ picked: [{ id: 999 }], answer: [] }, [7, 23]))
  })
})

describe('assistant prompt', () => {
  it('only forwards whitelisted candidate fields', () => {
    const messages = buildAssistantMessages({
      question: '有什么能做的',
      inventory: { ingredients: ['土豆'], tools: ['炒锅'], pantry: ['油'] },
      candidates: [{ ...candidates[0], extraField: '不应出现' }],
    })
    const payload = messages.at(-1).content
    assert.ok(payload.includes('土豆'))
    assert.ok(payload.includes('番茄炒蛋'))
    assert.ok(!payload.includes('extraField'))
    assert.ok(!payload.includes('不应出现'))
  })
})

describe('assistant api', () => {
  it('reports status without requiring login', async () => {
    const response = await fetch(`${base}/api/assistant/status`)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.enabled, true)
    assert.equal(body.model, 'test-model')
  })

  it('requires a session', async () => {
    const response = await post('/api/assistant/chat', { question: '你好', candidates })
    assert.equal(response.status, 401)
  })

  it('returns the model ordering and filters fabricated ids', async () => {
    const cookie = await loginAs('theadmin', 'adminpass123')
    modelReply = {
      picked: [{ id: 23, why: '只差五花肉' }, { id: 7, why: '现有食材就能做' }, { id: 404, why: '不存在的菜' }],
      answer: ['根据你有的食材，推荐这两道。'],
      followups: ['要不要看做法？'],
    }
    const response = await post('/api/assistant/chat', { question: '土豆和猪肉能做什么', candidates }, cookie)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.deepEqual(body.picked.map(item => item.id), [23, 7])
    assert.equal(body.answer[0], '根据你有的食材，推荐这两道。')
  })

  it('maps upstream failures to 502 without leaking model output', async () => {
    const cookie = await loginAs('theadmin', 'adminpass123')
    modelStatus = 500
    try {
      const response = await post('/api/assistant/chat', { question: '随便', candidates }, cookie)
      assert.equal(response.status, 502)
      const body = await response.json()
      assert.ok(!JSON.stringify(body).includes('upstream failed'))
    }
    finally {
      modelStatus = 200
    }
  })

  it('rejects invalid model json', async () => {
    const cookie = await loginAs('theadmin', 'adminpass123')
    modelReply = { picked: 'not-an-array', answer: [] }
    const response = await post('/api/assistant/chat', { question: '随便', candidates }, cookie)
    assert.equal(response.status, 502)
    modelReply = { picked: [], answer: ['默认回答'] }
  })
})
