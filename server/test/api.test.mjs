import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const entry = fileURLToPath(new URL('../src/index.mjs', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'cook-server-test-'))
const port = 18000 + Math.floor(Math.random() * 1000)
const base = `http://127.0.0.1:${port}`

let child

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

before(async () => {
  child = spawn(process.execPath, [entry], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', COOK_DB_PATH: join(dir, 'test.sqlite'), COOK_INVITE_CODE: 'invite-123', COOK_ADMIN_USERNAME: 'theadmin', COOK_ADMIN_PASSWORD: 'adminpass123', COOK_RATE_LIMIT: '1000' },
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
  // Windows 上 SQLite 的 WAL 文件可能比进程晚一步释放，清理失败不影响测试结论
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  catch {}
})

describe('account api', () => {
  it('registers, keeps a session and logs out', async () => {
    const register = await post('/api/auth/register', { username: '测试用户', password: 'password123', inviteCode: 'invite-123' })
    assert.equal(register.status, 201)
    const body = await register.json()
    assert.equal(body.user.username, '测试用户')
    assert.equal(body.user.passwordHash, undefined)
    const cookie = cookieFrom(register)
    assert.match(cookie, /^cook_session=/)

    const me = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })
    assert.equal(me.status, 200)
    assert.equal((await me.json()).user.username, '测试用户')

    const logout = await post('/api/auth/logout', {}, cookie)
    assert.equal(logout.status, 204)

    const after = await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })
    assert.equal(after.status, 401)
  })

  it('rejects duplicate usernames and wrong passwords without leaking which one failed', async () => {
    await post('/api/auth/register', { username: 'dupuser', password: 'password123', inviteCode: 'invite-123' })
    const duplicate = await post('/api/auth/register', { username: 'dupuser', password: 'password123', inviteCode: 'invite-123' })
    assert.equal(duplicate.status, 409)

    const wrong = await post('/api/auth/login', { username: 'dupuser', password: 'not-the-password' })
    const missing = await post('/api/auth/login', { username: 'nobody-here', password: 'not-the-password' })
    assert.equal(wrong.status, 401)
    assert.equal(missing.status, 401)
    assert.equal((await wrong.json()).error, (await missing.json()).error)
  })

  it('validates credentials', async () => {
    const short = await post('/api/auth/register', { username: 'okuser', password: 'short', inviteCode: 'invite-123' })
    assert.equal(short.status, 400)

    const badName = await post('/api/auth/register', { username: 'has space', password: 'password123', inviteCode: 'invite-123' })
    assert.equal(badName.status, 400)
  })

  it('stores user data per account', async () => {
    const a = await post('/api/auth/register', { username: 'usera', password: 'password123', inviteCode: 'invite-123' })
    const b = await post('/api/auth/register', { username: 'userb', password: 'password123', inviteCode: 'invite-123' })
    const cookieA = cookieFrom(a)
    const cookieB = cookieFrom(b)

    const empty = await fetch(`${base}/api/user-data`, { headers: { Cookie: cookieA } })
    assert.deepEqual(await empty.json(), { data: null, updatedAt: 0 })

    const data = {
      favorites: [{ id: 1, time: 1 }],
      histories: [],
      kitchen: {
        ingredients: [{ name: '番茄', time: 2 }],
        ingredientRemovals: [{ name: '鸡蛋', time: 3 }],
        tools: [{ name: '锅', time: 4 }],
        toolRemovals: [],
        pantry: [],
        pantryRemovals: [{ name: '盐', time: 5 }],
        initialized: true,
      },
    }
    const put = await fetch(`${base}/api/user-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieA },
      body: JSON.stringify({ data }),
    })
    assert.equal(put.status, 200)

    const readA = await (await fetch(`${base}/api/user-data`, { headers: { Cookie: cookieA } })).json()
    assert.deepEqual(readA.data, data)

    const readB = await (await fetch(`${base}/api/user-data`, { headers: { Cookie: cookieB } })).json()
    assert.equal(readB.data, null)

    for (const kitchen of [null, {}, { ...data.kitchen, ingredients: [{ name: '番茄', time: -1 }] }]) {
      const invalid = await fetch(`${base}/api/user-data`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Cookie': cookieA },
        body: JSON.stringify({ data: { ...data, kitchen } }),
      })
      assert.equal(invalid.status, 400)
    }
    const unchanged = await (await fetch(`${base}/api/user-data`, { headers: { Cookie: cookieA } })).json()
    assert.deepEqual(unchanged.data, data)

    const legacy = { favorites: [{ id: 2, time: 10 }], histories: [] }
    const legacyPut = await fetch(`${base}/api/user-data`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookieA },
      body: JSON.stringify({ data: legacy }),
    })
    assert.equal(legacyPut.status, 200)
    const afterLegacy = await (await fetch(`${base}/api/user-data`, { headers: { Cookie: cookieA } })).json()
    assert.deepEqual(afterLegacy.data, { ...legacy, kitchen: data.kitchen })
  })

  it('requires a session for user data', async () => {
    const response = await fetch(`${base}/api/user-data`)
    assert.equal(response.status, 401)
  })

  it('rejects registration without the invite code', async () => {
    const missing = await post('/api/auth/register', { username: 'noinvite', password: 'password123' })
    const wrong = await post('/api/auth/register', { username: 'noinvite', password: 'password123', inviteCode: 'wrong' })
    assert.equal(missing.status, 403)
    assert.equal(wrong.status, 403)
  })

  it('seeds an admin who can list and delete accounts, but not itself', async () => {
    const login = await post('/api/auth/login', { username: 'theadmin', password: 'adminpass123' })
    assert.equal(login.status, 200)
    assert.equal((await login.json()).user.role, 'admin')
    const adminCookie = cookieFrom(login)

    const list = await fetch(`${base}/api/admin/users`, { headers: { Cookie: adminCookie } })
    assert.equal(list.status, 200)
    const rows = (await list.json()).users
    assert.ok(rows.some(row => row.username === 'theadmin' && row.role === 'admin'))
    assert.equal(rows[0].passwordHash, undefined)

    const normal = await post('/api/auth/register', { username: 'normal', password: 'password123', inviteCode: 'invite-123' })
    const normalUser = (await normal.json()).user
    const normalCookie = cookieFrom(normal)
    const forbidden = await fetch(`${base}/api/admin/users`, { headers: { Cookie: normalCookie } })
    assert.equal(forbidden.status, 403)

    const self = rows.find(row => row.username === 'theadmin')
    const selfDelete = await fetch(`${base}/api/admin/users/${self.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    assert.equal(selfDelete.status, 400)

    const deleted = await fetch(`${base}/api/admin/users/${normalUser.id}`, { method: 'DELETE', headers: { Cookie: adminCookie } })
    assert.equal(deleted.status, 204)
  })

  it('lets a signed-in user change their own password', async () => {
    const register = await post('/api/auth/register', { username: 'pwuser', password: 'password123', inviteCode: 'invite-123' })
    const cookie = cookieFrom(register)

    const wrong = await fetch(`${base}/api/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ currentPassword: 'nope', newPassword: 'newpassword123' }),
    })
    assert.equal(wrong.status, 401)

    const changed = await fetch(`${base}/api/auth/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': cookie },
      body: JSON.stringify({ currentPassword: 'password123', newPassword: 'newpassword123' }),
    })
    assert.equal(changed.status, 204)

    const login = await post('/api/auth/login', { username: 'pwuser', password: 'newpassword123' })
    assert.equal(login.status, 200)
  })
})
