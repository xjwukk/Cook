import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { decryptSecret, encryptSecret, loadSecret } from '../src/secret.mjs'

const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cook-assistant-config-'))
const port = 20000 + Math.floor(Math.random() * 1000)
const modelPort = port + 1000
const base = `http://127.0.0.1:${port}`

let child
let model

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

async function register(username) {
  const response = await post('/api/auth/register', { username, password: 'password123', inviteCode: 'invite-123' })
  assert.equal(response.status, 201)
  return cookieFrom(response)
}

function saveConfig(cookie, body) {
  return fetch(`${base}/api/assistant/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify(body),
  })
}

before(async () => {
  model = createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{
        message: {
          role: 'assistant',
          content: JSON.stringify({ picked: [], answer: ['来自用户配置'] }),
        },
        finish_reason: 'stop',
      }],
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
      COOK_RATE_LIMIT: '1000',
      // 服务端也配了一套，用来验证「用户配置优先、环境变量兜底」
      COOK_AI_ENABLED: '1',
      COOK_AI_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      COOK_AI_API_KEY: 'server-key',
      COOK_AI_MODEL: 'server-model',
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok)
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
  model.closeAllConnections?.()
  await new Promise(resolve => model.close(resolve))
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  catch {}
})

describe('assistant secret storage', () => {
  it('round-trips and rejects tampered payloads', () => {
    const key = loadSecret({ env: { COOK_SECRET_KEY: 'unit-test' }, dbPath: join(dir, 'x.sqlite') })
    const cipher = encryptSecret(key, 'sk-abcdef123456')
    assert.equal(decryptSecret(key, cipher), 'sk-abcdef123456')
    assert.equal(decryptSecret(key, `${cipher}00`), '')
    assert.notEqual(cipher, encryptSecret(key, 'sk-abcdef123456'))
  })
})

describe('assistant per-user config', () => {
  it('saves a key encrypted and never returns it', async () => {
    const cookie = await register('configuser')
    const save = await saveConfig(cookie, {
      baseUrl: `http://127.0.0.1:${modelPort}/v1`,
      model: 'user-model',
      apiKey: 'sk-test-12345678',
    })
    assert.equal(save.status, 200)

    const response = await fetch(`${base}/api/assistant/config`, { headers: { Cookie: cookie } })
    const body = await response.json()
    assert.equal(body.configured, true)
    assert.equal(body.model, 'user-model')
    assert.equal(body.keyHint, 'sk-…5678')
    assert.equal(body.apiKey, undefined)
    assert.ok(!JSON.stringify(body).includes('sk-test-12345678'))
  })

  it('rejects remote http endpoints and a missing key', async () => {
    const cookie = await register('configcheck')
    const insecure = await saveConfig(cookie, {
      baseUrl: 'http://api.example.com/v1',
      model: 'x',
      apiKey: 'sk-test-12345678',
    })
    assert.equal(insecure.status, 400)

    const noKey = await saveConfig(cookie, { baseUrl: 'https://api.example.com/v1', model: 'x' })
    assert.equal(noKey.status, 400)
  })

  it('keeps the stored key when the key field is left blank', async () => {
    const cookie = await register('keepuser')
    await saveConfig(cookie, { baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: 'first', apiKey: 'sk-keep-12345678' })
    const update = await saveConfig(cookie, { baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: 'second' })
    assert.equal(update.status, 200)
    const body = await (await fetch(`${base}/api/assistant/config`, { headers: { Cookie: cookie } })).json()
    assert.equal(body.model, 'second')
    assert.equal(body.keyHint, 'sk-…5678')
  })

  it('prefers the user config and reports the source', async () => {
    const cookie = await register('sourceuser')
    await saveConfig(cookie, { baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: 'user-model', apiKey: 'sk-source-12345678' })

    const status = await (await fetch(`${base}/api/assistant/status`, { headers: { Cookie: cookie } })).json()
    assert.equal(status.source, 'user')
    assert.equal(status.model, 'user-model')

    const chat = await post('/api/assistant/chat', { question: '随便', candidates: [{ id: 1 }] }, cookie)
    assert.equal(chat.status, 200)
    assert.equal((await chat.json()).answer[0], '来自用户配置')
  })

  it('falls back to the server config when the account has none', async () => {
    const cookie = await register('fallbackuser')
    const status = await (await fetch(`${base}/api/assistant/status`, { headers: { Cookie: cookie } })).json()
    assert.equal(status.enabled, true)
    assert.equal(status.source, 'server')
  })

  it('tests the connection before saving', async () => {
    const cookie = await register('testuser')
    const ok = await fetch(`${base}/api/assistant/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: 'm', apiKey: 'sk-test-12345678' }),
    })
    assert.equal(ok.status, 200)

    const bad = await fetch(`${base}/api/assistant/config/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ baseUrl: 'not-a-url', model: 'm', apiKey: 'sk-test-12345678' }),
    })
    assert.equal(bad.status, 400)
  })

  it('deletes the config and falls back to the server default', async () => {
    const cookie = await register('deleteuser')
    await saveConfig(cookie, { baseUrl: `http://127.0.0.1:${modelPort}/v1`, model: 'm', apiKey: 'sk-delete-12345678' })
    const removed = await fetch(`${base}/api/assistant/config`, { method: 'DELETE', headers: { Cookie: cookie } })
    assert.equal(removed.status, 204)
    const status = await (await fetch(`${base}/api/assistant/status`, { headers: { Cookie: cookie } })).json()
    assert.equal(status.source, 'server')
  })
})
