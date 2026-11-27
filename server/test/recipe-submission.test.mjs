import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cook-recipe-submission-test-'))
const port = 23000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}`

const PUBLISHED_ID_BASE = 10000

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

async function publicOverrides() {
  const response = await fetch(`${base}/api/recipes/overrides`)
  assert.equal(response.status, 200)
  return response.json()
}

const submission = {
  name: '油焖大虾',
  stuff: ['虾'],
  tools: ['一口大锅'],
  note: '1. 锅中倒入稍多油\n2. 平铺下锅煎到变色',
  difficulty: '简单',
  methods: ['焖'],
  tags: [],
  bv: '',
  link: '',
}

before(async () => {
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
      COOK_PUBLISHED_ID_BASE: String(PUBLISHED_ID_BASE),
    },
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

describe('recipe submissions', () => {
  it('requires a session to submit', async () => {
    const response = await post('/api/recipes/submissions', { recipe: submission })
    assert.equal(response.status, 401)
  })

  it('accepts a submission and lists it for the author', async () => {
    const response = await post('/api/recipes/submissions', { recipe: submission }, normalCookie)
    assert.equal(response.status, 201)
    const body = await response.json()
    assert.equal(body.submission.status, 'pending')

    const mine = await fetch(`${base}/api/recipes/submissions/mine`, { headers: { Cookie: normalCookie } })
    const rows = (await mine.json()).submissions
    assert.equal(rows.length, 1)
    assert.equal(rows[0].recipe.name, '油焖大虾')
    assert.equal(rows[0].status, 'pending')
  })

  it('rejects malformed submissions', async () => {
    const cases = [
      { ...submission, name: '' },
      { ...submission, stuff: [] },
      { ...submission, tools: '一口大锅' },
      { ...submission, difficulty: '地狱' },
      { ...submission, link: 'http://example.com/x' },
      { ...submission, bv: 'not-a-bv' },
    ]
    for (const recipe of cases) {
      const response = await post('/api/recipes/submissions', { recipe }, normalCookie)
      assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(recipe).slice(0, 60)}`)
    }
  })

  it('keeps approval and rejection to admins', async () => {
    const mine = await fetch(`${base}/api/recipes/submissions/mine`, { headers: { Cookie: normalCookie } })
    const id = (await mine.json()).submissions[0].id

    const forbidden = await post(`/api/admin/recipe-submissions/${id}/approve`, {}, normalCookie)
    assert.equal(forbidden.status, 403)

    const list = await fetch(`${base}/api/admin/recipe-submissions`, { headers: { Cookie: normalCookie } })
    assert.equal(list.status, 403)
  })

  it('publishes an approved submission with a fresh id that everyone can read', async () => {
    const mine = await fetch(`${base}/api/recipes/submissions/mine`, { headers: { Cookie: normalCookie } })
    const id = (await mine.json()).submissions[0].id

    const approved = await post(`/api/admin/recipe-submissions/${id}/approve`, {}, adminCookie)
    assert.equal(approved.status, 200)
    const publishedId = (await approved.json()).submission.publishedRecipeId
    assert.ok(publishedId >= PUBLISHED_ID_BASE, `expected id >= ${PUBLISHED_ID_BASE}, got ${publishedId}`)

    const overrides = await publicOverrides()
    const published = overrides.overrides.find(item => item.id === publishedId)
    assert.ok(published, 'published recipe should be readable by anonymous visitors')
    assert.equal(published.name, '油焖大虾')
    assert.deepEqual(published.stuff, ['虾'])
    assert.equal(published.note, submission.note)
  })

  it('lists the recipes the current user touched', async () => {
    const mine = await fetch(`${base}/api/recipes/overrides/mine`, { headers: { Cookie: normalCookie } })
    assert.equal(mine.status, 200)
    const rows = (await mine.json()).overrides
    // 投稿的作者也能看到自己发布的那一条（覆盖行的 updated_by 记的是审核人）。
    assert.ok(rows.length >= 1)
    assert.ok(rows.every(row => row.id >= PUBLISHED_ID_BASE))
  })

  it('does not reuse an id after the published recipe is withdrawn', async () => {
    const overrides = await publicOverrides()
    const publishedId = overrides.overrides.find(item => item.id >= PUBLISHED_ID_BASE).id

    const removed = await fetch(`${base}/api/admin/recipes/${publishedId}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(removed.status, 204)

    const again = await post('/api/recipes/submissions', { recipe: { ...submission, name: '第二道菜' } }, normalCookie)
    assert.equal(again.status, 201)
    const id = (await again.json()).submission.id
    const approved = await post(`/api/admin/recipe-submissions/${id}/approve`, {}, adminCookie)
    assert.equal(approved.status, 200)
    const nextId = (await approved.json()).submission.publishedRecipeId
    assert.ok(nextId > publishedId, `expected a new id after ${publishedId}, got ${nextId}`)
  })

  it('requires a reason when rejecting', async () => {
    const mine = await fetch(`${base}/api/recipes/submissions/mine`, { headers: { Cookie: normalCookie } })
    const rows = (await mine.json()).submissions
    const pending = rows.find(row => row.status === 'pending')
    if (!pending)
      return
    const withoutReason = await post(`/api/admin/recipe-submissions/${pending.id}/reject`, {}, adminCookie)
    assert.equal(withoutReason.status, 400)

    const rejected = await post(`/api/admin/recipe-submissions/${pending.id}/reject`, { reviewNote: '食材要来自词典' }, adminCookie)
    assert.equal(rejected.status, 200)

    const after = await fetch(`${base}/api/recipes/submissions/mine`, { headers: { Cookie: normalCookie } })
    const updated = (await after.json()).submissions.find(row => row.id === pending.id)
    assert.equal(updated.status, 'rejected')
    assert.equal(updated.reviewNote, '食材要来自词典')
  })
})
