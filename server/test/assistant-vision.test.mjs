import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildImageParts, normalizeImages } from '../src/assistant-images.mjs'
import { buildAssistantMessages, validateAssistantAnswer } from '../src/assistant.mjs'

const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cook-assistant-vision-test-'))
const port = 21000 + Math.floor(Math.random() * 1000)
const modelPort = port + 1000
const base = `http://127.0.0.1:${port}`

let child
let model
let modelReply = { picked: [], answer: ['默认回答'] }
let modelStatus = 200
let modelErrorBody = { error: 'upstream failed' }
let lastRequest = null

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

// 一张 1x1 的合法 JPEG，够用来跑通整条链路。
const JPEG = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q=='
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

before(async () => {
  model = createServer((req, res) => {
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      try {
        lastRequest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      }
      catch {
        lastRequest = null
      }
      res.writeHead(modelStatus, { 'Content-Type': 'application/json' })
      if (modelStatus !== 200) {
        res.end(JSON.stringify(modelErrorBody))
        return
      }
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(modelReply) }, finish_reason: 'stop' }],
      }))
    })
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

describe('normalizeImages', () => {
  it('accepts jpg, png and webp base64 payloads', () => {
    assert.deepEqual(normalizeImages([{ mime: 'image/jpeg', data: JPEG }]), [{ mime: 'image/jpeg', data: JPEG }])
    assert.deepEqual(normalizeImages([{ mime: 'image/png', data: PNG }]), [{ mime: 'image/png', data: PNG }])
  })

  it('accepts a full data URL', () => {
    const images = normalizeImages([{ dataUrl: `data:image/jpeg;base64,${JPEG}` }])
    assert.equal(images[0].mime, 'image/jpeg')
    assert.equal(images[0].data, JPEG)
  })

  it('drops every field except mime and data', () => {
    const images = normalizeImages([{ mime: 'image/jpeg', data: JPEG, evil: 'x' }])
    assert.deepEqual(Object.keys(images[0]).sort(), ['data', 'mime'])
  })

  it('rejects formats that are not raster images', () => {
    assert.throws(() => normalizeImages([{ mime: 'image/svg+xml', data: JPEG }]), /只支持 JPG/)
    assert.throws(() => normalizeImages([{ mime: 'image/gif', data: JPEG }]), /只支持 JPG/)
  })

  it('rejects malformed base64', () => {
    assert.throws(() => normalizeImages([{ mime: 'image/jpeg', data: 'not base64!!' }]))
    assert.throws(() => normalizeImages([{ mime: 'image/jpeg', data: 'YWJ' }]))
  })

  it('rejects too many images', () => {
    const many = Array.from({ length: 5 }).fill({ mime: 'image/jpeg', data: JPEG })
    assert.throws(() => normalizeImages(many), /最多上传/)
  })

  it('rejects an oversized image', () => {
    const big = 'A'.repeat(1024 * 1024)
    assert.throws(() => normalizeImages([{ mime: 'image/jpeg', data: big }]), /KB/)
  })

  it('returns an empty list for a missing payload', () => {
    assert.deepEqual(normalizeImages(undefined), [])
    assert.deepEqual(normalizeImages([]), [])
  })
})

describe('buildImageParts', () => {
  it('builds OpenAI compatible image parts', () => {
    const parts = buildImageParts([{ mime: 'image/jpeg', data: JPEG }])
    assert.equal(parts[0].type, 'image_url')
    assert.ok(parts[0].image_url.url.startsWith('data:image/jpeg;base64,'))
  })
})

describe('assistant prompt with images', () => {
  it('turns the user turn into a multimodal content array', () => {
    const messages = buildAssistantMessages({
      question: '',
      images: [{ mime: 'image/jpeg', data: JPEG }],
      ingredientNames: ['虾', '姜', '蒜', '葱'],
      candidates: [],
    })
    const content = messages.at(-1).content
    assert.ok(Array.isArray(content))
    assert.equal(content[0].type, 'text')
    assert.equal(content[1].type, 'image_url')
    assert.ok(content[0].text.includes('可用食材名'))
    assert.ok(content[0].text.includes('虾'))
    assert.ok(messages[0].content.includes('图片'))
  })

  it('keeps the user turn a plain string when there are no images', () => {
    const messages = buildAssistantMessages({ question: '有什么能做的', candidates: [] })
    assert.equal(typeof messages.at(-1).content, 'string')
  })

  it('still requires a question when there are no images', () => {
    assert.throws(() => buildAssistantMessages({ question: '   ', candidates: [] }), /请先输入问题/)
  })

  it('trims the candidate pool when images are attached', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => ({ id: index, name: `菜${index}` }))
    const withImages = buildAssistantMessages({ question: '', images: [{ mime: 'image/jpeg', data: JPEG }], candidates })
    assert.equal(JSON.parse(withImages.at(-1).content[0].text).候选菜谱.length, 10)
    const withoutImages = buildAssistantMessages({ question: '能做什么', candidates })
    assert.equal(JSON.parse(withoutImages.at(-1).content).候选菜谱.length, 30)
  })
})

describe('assistant answer validation with images', () => {
  it('accepts a reply that only carries a draft', () => {
    const result = validateAssistantAnswer({
      answer: [],
      actions: [{ type: 'draft_recipe', recipe: { name: '油焖大虾', stuff: ['虾'], tools: [], note: '1. 热锅下油' } }],
    }, [])
    assert.equal(result.actions.length, 1)
    assert.equal(result.actions[0].recipe.name, '油焖大虾')
  })

  it('keeps the model warnings and clips them', () => {
    const result = validateAssistantAnswer({
      answer: ['抄好了'],
      warnings: Array.from({ length: 8 }, (_, index) => `第${index + 1}张看不清`),
    }, [])
    assert.equal(result.warnings.length, 4)
  })
})

describe('assistant api with images', () => {
  it('sends the images to the model and returns the draft', async () => {
    const cookie = await loginAs('theadmin', 'adminpass123')
    modelReply = {
      picked: [],
      answer: ['抄好了'],
      warnings: ['第 2 张图步骤看不清'],
      actions: [{
        type: 'draft_recipe',
        recipe: { name: '油焖大虾', stuff: ['虾', '姜', '蒜'], tools: ['一口大锅'], note: '1. 锅中倒入稍多油\n2. 平铺下锅' },
      }],
    }
    const response = await post('/api/assistant/chat', {
      question: '',
      images: [{ mime: 'image/jpeg', data: JPEG }],
      ingredientNames: ['虾', '姜', '蒜'],
      candidates: [],
    }, cookie)
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.actions[0].recipe.name, '油焖大虾')
    assert.equal(body.warnings[0], '第 2 张图步骤看不清')
    // 图片确实以多模态片段发给了模型。
    assert.ok(Array.isArray(lastRequest.messages.at(-1).content))
    assert.equal(lastRequest.messages.at(-1).content[1].type, 'image_url')
  })

  it('rejects an unsupported image format before calling the model', async () => {
    const cookie = await loginAs('theadmin', 'adminpass123')
    const response = await post('/api/assistant/chat', {
      question: '',
      images: [{ mime: 'image/svg+xml', data: JPEG }],
      candidates: [],
    }, cookie)
    assert.equal(response.status, 400)
    const body = await response.json()
    assert.ok(body.error.includes('只支持 JPG'))
  })

  it('turns a model that refuses images into an actionable message', async () => {
    const cookie = await loginAs('theadmin', 'adminpass123')
    modelStatus = 400
    modelErrorBody = { error: { message: 'This model does not support image input' } }
    try {
      const response = await post('/api/assistant/chat', {
        question: '',
        images: [{ mime: 'image/jpeg', data: JPEG }],
        candidates: [],
      }, cookie)
      assert.equal(response.status, 400)
      const body = await response.json()
      assert.ok(body.error.includes('图片模型'))
    }
    finally {
      modelStatus = 200
      modelErrorBody = { error: 'upstream failed' }
    }
  })
})
