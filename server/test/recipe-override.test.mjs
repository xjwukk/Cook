import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cook-recipe-override-test-'))
const port = 19000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}`

let child
let adminCookie
let normalCookie

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

async function putRecipe(id, body, cookie) {
  return fetch(`${base}/api/admin/recipes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  })
}

async function publicOverrides() {
  const response = await fetch(`${base}/api/recipes/overrides`)
  assert.equal(response.status, 200)
  return response.json()
}

const recipe = {
  id: 23,
  name: '修订版番茄炒蛋',
  stuff: ['番茄', '鸡蛋'],
  bv: 'BV1xx411c7mD',
  difficulty: '简单',
  tags: ['下饭', '快手菜'],
  methods: ['炒'],
  tools: ['一口大锅'],
  link: 'https://example.com/tomato',
}

before(async () => {
  child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', COOK_DB_PATH: join(dir, 'test.sqlite'), COOK_INVITE_CODE: 'invite-123', COOK_ADMIN_USERNAME: 'theadmin', COOK_ADMIN_PASSWORD: 'adminpass123', COOK_RATE_LIMIT: '1000' },
    stdio: 'ignore',
  })
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok)
        break
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  const login = await post('/api/auth/login', { username: 'theadmin', password: 'adminpass123' })
  adminCookie = cookieFrom(login)
  const register = await post('/api/auth/register', { username: 'normal', password: 'password123', inviteCode: 'invite-123' })
  normalCookie = cookieFrom(register)
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

describe('recipe overrides', () => {
  it('starts empty and is readable without a session', async () => {
    const body = await publicOverrides()
    assert.equal(body.version, 0)
    assert.deepEqual(body.overrides, [])
  })

  it('rejects writes from anonymous and non-admin users', async () => {
    const anonymous = await putRecipe(recipe.id, recipe)
    assert.equal(anonymous.status, 401)

    const forbidden = await putRecipe(recipe.id, recipe, normalCookie)
    assert.equal(forbidden.status, 403)

    const list = await fetch(`${base}/api/admin/recipes`, { headers: { Cookie: normalCookie } })
    assert.equal(list.status, 403)
  })

  it('lets an admin save an override that every visitor can read', async () => {
    const saved = await putRecipe(recipe.id, recipe, adminCookie)
    assert.equal(saved.status, 200)
    const savedBody = await saved.json()
    assert.equal(savedBody.override.data.name, recipe.name)
    assert.equal(savedBody.override.updatedByName, 'theadmin')

    const body = await publicOverrides()
    assert.ok(body.version > 0)
    assert.equal(body.overrides.length, 1)
    assert.deepEqual(body.overrides[0], recipe)

    const list = await fetch(`${base}/api/admin/recipes`, { headers: { Cookie: adminCookie } })
    assert.equal(list.status, 200)
    const rows = (await list.json()).overrides
    assert.equal(rows.length, 1)
    assert.equal(rows[0].data.name, recipe.name)
    assert.equal(rows[0].updatedByName, 'theadmin')
  })

  it('rejects invalid overrides', async () => {
    const cases = [
      { ...recipe, name: '' },
      { ...recipe, difficulty: '地狱' },
      { ...recipe, bv: 'not-a-bv' },
      { ...recipe, link: 'http://example.com/tomato' },
      { ...recipe, stuff: [] },
      { ...recipe, stuff: [''] },
      { ...recipe, tools: '一口大锅' },
      { ...recipe, id: 24 },
      { ...recipe, stuff: Array.from({ length: 400 }, (_, i) => `很长的食材名字${i}`) },
    ]
    for (const body of cases) {
      const response = await putRecipe(recipe.id, body, adminCookie)
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body).slice(0, 80)}`)
    }

    const unchanged = await publicOverrides()
    assert.equal(unchanged.overrides.length, 1)
    assert.equal(unchanged.overrides[0].name, recipe.name)
  })

  it('keeps one row per recipe when saved twice', async () => {
    const updated = { ...recipe, name: '再修订的番茄炒蛋' }
    const response = await putRecipe(recipe.id, updated, adminCookie)
    assert.equal(response.status, 200)

    const body = await publicOverrides()
    assert.equal(body.overrides.length, 1)
    assert.equal(body.overrides[0].name, updated.name)
  })

  it('stores step text in note and removes it when cleared', async () => {
    const withNote = { ...recipe, note: '1. 番茄切块\n2. 下锅翻炒' }
    const saved = await putRecipe(recipe.id, withNote, adminCookie)
    assert.equal(saved.status, 200)

    let body = await publicOverrides()
    assert.equal(body.overrides[0].note, withNote.note)

    const cleared = await putRecipe(recipe.id, recipe, adminCookie)
    assert.equal(cleared.status, 200)

    body = await publicOverrides()
    assert.equal('note' in body.overrides[0], false)
  })

  it('removes the override and falls back to the official version', async () => {
    const removed = await fetch(`${base}/api/admin/recipes/${recipe.id}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(removed.status, 204)

    const body = await publicOverrides()
    assert.deepEqual(body.overrides, [])
  })
})
