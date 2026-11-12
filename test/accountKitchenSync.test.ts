import type { EffectScope } from 'vue'
import type { UserData } from '../apps/web/app/utils/userData'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, effectScope, nextTick, readonly, ref, watch } from 'vue'
import { setFavoriteEntries } from '../apps/web/app/composables/store/favorite'
import { recipeHistories } from '../apps/web/app/composables/store/history'
import { useKitchenStore } from '../apps/web/app/composables/store/kitchen'
import { readLocalUserData } from '../apps/web/app/composables/store/userData'
import { userDataMeta } from '../apps/web/app/composables/store/userDataMeta'
import { createEmptyUserData, isSameUserData } from '../apps/web/app/utils/userData'

vi.mock('../apps/web/app/utils/storageScope', () => ({
  storageUid: '42',
  scopedKey: (name: string) => `cook:u42:${name}`,
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function response(data: UserData | null = null): Response {
  return { ok: true, status: 200, json: async () => ({ data, updatedAt: 1 }) } as Response
}

// Flush Vue's watchers and fetch/json/finally continuations without advancing debounce time.
async function settle() {
  await nextTick()
  for (let index = 0; index < 12; index++)
    await Promise.resolve()
  await nextTick()
}

let scope: EffectScope
let user: ReturnType<typeof ref<{ id: number } | null>>
let sync: Awaited<ReturnType<typeof startSync>>
let putBodies: UserData[]
let slowGet: ReturnType<typeof deferred<Response>> | undefined
let slowPut: ReturnType<typeof deferred<Response>> | undefined

async function startSync() {
  const { useAccountSync } = await import('../apps/web/app/composables/useAccountSync')
  return scope.run(() => useAccountSync())!
}

beforeEach(async () => {
  vi.useFakeTimers()
  localStorage.clear()
  setActivePinia(createPinia())
  setFavoriteEntries([])
  recipeHistories.value = []
  userDataMeta.value = { favoriteRemovals: [], historyRemovals: [], historyClearedAt: 0, lastUid: '42' }
  user = ref<{ id: number } | null>(null)
  putBodies = []
  slowGet = undefined
  slowPut = undefined
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('readonly', readonly)
  vi.stubGlobal('watch', watch)
  vi.stubGlobal('useAccount', () => ({ user, isAuthenticated: computed(() => !!user.value) }))
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      putBodies.push(JSON.parse(String(init.body)).data)
      // Only the next PUT is held; subsequent uploads can finish normally.
      const pending = slowPut
      slowPut = undefined
      return pending ? pending.promise : response()
    }
    return slowGet ? slowGet.promise : response(createEmptyUserData())
  }))
  scope = effectScope()
  sync = await startSync()
})

afterEach(() => {
  scope.stop()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
})

async function debounce() {
  await nextTick()
  await vi.advanceTimersByTimeAsync(1600)
  await settle()
}

function expectLatestUploaded() {
  expect(putBodies.length).toBeGreaterThan(0)
  expect(isSameUserData(putBodies.at(-1)!, readLocalUserData())).toBe(true)
  expect(sync.status.value).toBe('synced')
  expect(sync.errorMessage.value).toBe('')
}

describe('account sync retains kitchen edits during in-flight requests', () => {
  it('uploads a fresh snapshot after edits made during a slow debounced PUT', async () => {
    user.value = { id: 42 }
    await settle()
    await debounce()
    expect(sync.status.value).toBe('synced')
    expect(putBodies).toHaveLength(0)

    const kitchen = useKitchenStore()
    const pending = deferred<Response>()
    slowPut = pending
    kitchen.addIngredients(['鸡蛋'])
    await debounce()
    expect(putBodies).toHaveLength(1)
    expect(putBodies[0].kitchen.ingredients.map(entry => entry.name)).toEqual(['鸡蛋'])

    kitchen.addIngredients(['番茄'])
    kitchen.setPantry(['盐'])
    // Let the watcher fire while the first PUT is still blocked.
    await debounce()
    expect(putBodies).toHaveLength(1)
    pending.resolve(response())
    await settle()
    expect(putBodies).toHaveLength(2)
    expect(new Set(putBodies[1].kitchen.ingredients.map(entry => entry.name))).toEqual(new Set(['鸡蛋', '番茄']))
    expect(putBodies[1].kitchen.pantry.map(entry => entry.name)).toEqual(['盐'])
    expectLatestUploaded()
    await debounce()
    expect(putBodies).toHaveLength(2)
  })

  it('flushes edits made while the initial merge PUT is still running', async () => {
    const kitchen = useKitchenStore()
    kitchen.addIngredients(['鸡蛋'])
    const pending = deferred<Response>()
    slowPut = pending
    user.value = { id: 42 }
    await settle()
    expect(putBodies).toHaveLength(1)

    kitchen.removeIngredient('鸡蛋')
    kitchen.addIngredients(['豆腐'])
    kitchen.setTools(['一口大锅'])
    await debounce()
    expect(putBodies).toHaveLength(1)
    pending.resolve(response())
    await settle()
    expect(putBodies).toHaveLength(2)
    expect(putBodies[1].kitchen.ingredients.map(entry => entry.name)).toEqual(['豆腐'])
    expect(putBodies[1].kitchen.ingredientRemovals.map(entry => entry.name)).toContain('鸡蛋')
    expect(putBodies[1].kitchen.tools.map(entry => entry.name)).toEqual(['一口大锅'])
    expectLatestUploaded()
  })

  it('merges edits made during a slow GET with remote kitchen data and uploads both', async () => {
    const pending = deferred<Response>()
    slowGet = pending
    user.value = { id: 42 }
    await settle()
    expect(sync.status.value).toBe('syncing')
    const kitchen = useKitchenStore()
    kitchen.addIngredients(['鸡蛋'])
    kitchen.setPantry(['盐'])
    await debounce()
    expect(putBodies).toHaveLength(0)

    const remote = createEmptyUserData()
    remote.kitchen.tools = [{ name: '烤箱', time: 1 }]
    remote.kitchen.initialized = true
    pending.resolve(response(remote))
    await settle()
    await debounce()
    expect(kitchen.ingredients).toEqual(['鸡蛋'])
    expect(kitchen.pantry).toEqual(['盐'])
    expect(kitchen.tools).toEqual(['烤箱'])
    expect(putBodies).toHaveLength(1)
    expectLatestUploaded()
  })
})
