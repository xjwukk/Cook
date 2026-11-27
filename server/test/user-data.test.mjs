import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isValidCustomRecipeSync } from '../src/user-data.mjs'

const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cook-user-data-test-'))
const port = 24000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}`

let child
let cookie

function recipe(customId, updatedAt = 1) {
  return { customId, name: customId, stuff: ['虾'], tools: [], createdAt: 1, updatedAt }
}

async function put(data) {
  return fetch(`${base}/api/user-data`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
    body: JSON.stringify({ data }),
  })
}

async function get() {
  return (await fetch(`${base}/api/user-data`, { headers: { Cookie: cookie } })).json()
}

before(async () => {
  child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      COOK_DB_PATH: join(dir, 'test.sqlite'),
      COOK_INVITE_CODE: 'invite-123',
      COOK_RATE_LIMIT: '1000',
    },
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok)
        break
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const response = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'syncer', password: 'password123', inviteCode: 'invite-123' }),
  })
  cookie = response.headers.get('set-cookie')?.split(';')[0] ?? ''
})

after(async () => {
  if (child) {
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill()
    await exited
  }
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  catch {}
})

describe('custom recipe sync validation', () => {
  it('accepts a well-formed document', () => {
    assert.equal(isValidCustomRecipeSync({ customRecipes: [recipe('custom-a')], customRecipeRemovals: [] }), true)
  })

  it('rejects unknown fields on a synced recipe', () => {
    assert.equal(isValidCustomRecipeSync({ customRecipes: [{ ...recipe('a'), unknown: 1 }] }), false)
  })

  it('rejects malformed identities, names and timestamps', () => {
    assert.equal(isValidCustomRecipeSync({ customRecipes: [{ ...recipe('a'), customId: '' }] }), false)
    assert.equal(isValidCustomRecipeSync({ customRecipes: [{ ...recipe('a'), name: '' }] }), false)
    assert.equal(isValidCustomRecipeSync({ customRecipes: [{ ...recipe('a'), updatedAt: 0 }] }), false)
    assert.equal(isValidCustomRecipeSync({ customRecipes: [{ ...recipe('a'), stuff: [] }] }), false)
  })

  it('rejects malformed removal tombstones', () => {
    assert.equal(isValidCustomRecipeSync({ customRecipeRemovals: [{ customId: 'a', time: -1 }] }), false)
    assert.equal(isValidCustomRecipeSync({ customRecipeRemovals: [{ time: 1 }] }), false)
  })

  it('accepts documents that do not mention custom recipes at all', () => {
    assert.equal(isValidCustomRecipeSync({ kitchen: {} }), true)
  })
})

describe('custom recipe sync round trip', () => {
  it('stores recipes per account and returns them verbatim', async () => {
    const data = { customRecipes: [recipe('custom-a', 5)], customRecipeRemovals: [] }
    assert.equal((await put(data)).status, 200)
    const stored = await get()
    assert.deepEqual(stored.data.customRecipes, data.customRecipes)
  })

  it('keeps the stored recipes when an old client omits the key', async () => {
    // 旧客户端整份上传时不知道 customRecipes，不能把云端的菜谱抹掉。
    const legacy = { favorites: [], histories: [] }
    assert.equal((await put(legacy)).status, 200)
    const stored = await get()
    assert.equal(stored.data.customRecipes.length, 1)
    assert.equal(stored.data.customRecipes[0].customId, 'custom-a')
  })

  it('honours an explicit empty array as "deleted everything"', async () => {
    assert.equal((await put({ customRecipes: [], customRecipeRemovals: [] })).status, 200)
    const stored = await get()
    assert.deepEqual(stored.data.customRecipes, [])
  })
})
