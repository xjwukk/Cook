import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEmptyKitchen, mergeKitchen, normalizeKitchen } from '../apps/web/app/utils/kitchen'
import { createEmptyUserData, createUserDataExport, mergeUserData, normalizeUserData, parseUserDataExport } from '../apps/web/app/utils/userData'

const entry = (name: string, time: number) => ({ name, time })

describe('kitchen data', () => {
  it('normalizes names, malformed records, duplicates and legacy lists deterministically', () => {
    expect(normalizeKitchen({ ingredients: [' 番茄 ', '', 3, entry('番茄', 5), entry('坏数据', -1)], tools: ['锅'] })).toEqual({
      ...createEmptyKitchen(),
      ingredients: [entry('番茄', 5)],
      tools: [entry('锅', 0)],
      initialized: true,
    })
    expect(normalizeKitchen(null)).toEqual(createEmptyKitchen())
  })

  it('retains removals forever and makes deletion win ties', () => {
    const stale = normalizeKitchen({ ingredients: [entry('番茄', 10)] })
    const removed = normalizeKitchen({ ingredientRemovals: [entry('番茄', 10)], initialized: true })
    const merged = mergeKitchen(stale, removed)
    expect(merged.ingredients).toEqual([])
    expect(mergeKitchen(merged, stale)).toEqual(merged)
    expect(mergeKitchen(merged, normalizeKitchen({ ingredients: [entry('番茄', 11)] })).ingredients).toEqual([entry('番茄', 11)])
  })

  it('is commutative, associative, idempotent across all three sets', () => {
    const a = normalizeKitchen({ ingredients: [entry('番茄', 1)], tools: [entry('锅', 1)], pantry: ['盐'] })
    const b = normalizeKitchen({ ingredients: [entry('鸡蛋', 2)], toolRemovals: [entry('锅', 2)] })
    const c = normalizeKitchen({ ingredientRemovals: [entry('番茄', 3)], pantryRemovals: [entry('盐', 1)] })
    expect(mergeKitchen(a, b)).toEqual(mergeKitchen(b, a))
    expect(mergeKitchen(mergeKitchen(a, b), c)).toEqual(mergeKitchen(a, mergeKitchen(b, c)))
    expect(mergeKitchen(a, a)).toEqual(a)
  })

  it('round-trips new backups and reads old v1 backups without inventing inventory', () => {
    const data = { ...createEmptyUserData(), kitchen: normalizeKitchen({ ingredients: ['番茄'], toolRemovals: [entry('锅', 4)] }) }
    expect(parseUserDataExport(JSON.stringify(createUserDataExport(data)))).toEqual(data)
    const old = parseUserDataExport(JSON.stringify({ app: 'cook', version: 1, favorites: [{ id: 1, time: 1 }] }))!
    expect(old.kitchen).toEqual(createEmptyKitchen())
    expect(mergeUserData(data, old).kitchen).toEqual(data.kitchen)
    expect(normalizeUserData({ kitchen: data.kitchen })!.kitchen).toEqual(data.kitchen)
  })
})

describe('kitchen local store', () => {
  beforeEach(async () => {
    localStorage.clear()
    document.cookie = 'cook_uid=; max-age=0; path=/'
    vi.resetModules()
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
  })

  it('persists mutations, removals and explicit empty setup; supports same-tick re-add', async () => {
    const { useKitchenStore } = await import('../apps/web/app/composables/store/kitchen')
    const store = useKitchenStore()
    expect(store.initialized).toBe(false)
    store.addIngredients([' 番茄 ', '番茄', '鸡蛋'])
    store.removeIngredient('番茄')
    expect(store.ingredients).toEqual(['鸡蛋'])
    const removed = JSON.parse(localStorage.getItem('cook:kitchen')!)
    expect(removed.ingredientRemovals).toHaveLength(1)
    store.addIngredients(['番茄'])
    expect(store.ingredients).toEqual(['番茄', '鸡蛋'])
    store.setTools(['锅'])
    store.setTools([])
    store.setPantry([])
    expect(store.tools).toEqual([])
    expect(store.initialized).toBe(true)
    const { createPinia, setActivePinia } = await import('pinia')
    setActivePinia(createPinia())
    expect(useKitchenStore().data).toEqual(store.data)
  })

  it('never commits failed writes to UI', async () => {
    const { useKitchenStore } = await import('../apps/web/app/composables/store/kitchen')
    const store = useKitchenStore()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => store.addIngredients(['番茄'])).toThrow('quota')
    expect(store.ingredients).toEqual([])
    expect(store.initialized).toBe(false)
    spy.mockRestore()
  })

  it('explicitly rejects clock exhaustion without changing state or storage', async () => {
    const { useKitchenStore } = await import('../apps/web/app/composables/store/kitchen')
    const store = useKitchenStore()
    store.replaceData(normalizeKitchen({ ingredients: [entry('番茄', Number.MAX_SAFE_INTEGER)] }))
    const previous = localStorage.getItem('cook:kitchen')
    for (const mutate of [() => store.addIngredients(['鸡蛋']), () => store.removeIngredient('番茄'), () => store.setTools(['锅']), () => store.setPantry([])]) {
      expect(mutate).toThrow('时间戳已达到上限')
      expect(localStorage.getItem('cook:kitchen')).toBe(previous)
      expect(store.ingredients).toEqual(['番茄'])
    }
  })

  it('rolls back every successful backup write before committing reactive state', async () => {
    const { readLocalUserData, writeLocalUserData } = await import('../apps/web/app/composables/store/userData')
    const { useKitchenStore } = await import('../apps/web/app/composables/store/kitchen')
    const before = readLocalUserData()
    const keys = ['cook:kitchen', 'cook:favorites', 'cook:history', 'cook:sync']
    for (const key of keys)
      localStorage.setItem(key, `previous:${key}`)
    const snapshots = keys.map(key => localStorage.getItem(key))
    const original = Storage.prototype.setItem
    for (const failureKey of keys) {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
        if (key === failureKey)
          throw new Error('quota')
        return original.call(this, key, value)
      })
      try {
        const data = createEmptyUserData()
        data.kitchen = normalizeKitchen({ ingredients: ['番茄'] })
        expect(() => writeLocalUserData(data)).toThrow('quota')
        expect(keys.map(key => localStorage.getItem(key))).toEqual(snapshots)
        expect(readLocalUserData()).toEqual(before)
        expect(useKitchenStore().ingredients).toEqual([])
      }
      finally {
        spy.mockRestore()
      }
    }
  })

  it('uses separate anonymous and account storage namespaces', async () => {
    localStorage.setItem('cook:kitchen', JSON.stringify(normalizeKitchen({ ingredients: ['匿名'] })))
    localStorage.setItem('cook:u42:kitchen', JSON.stringify(normalizeKitchen({ ingredients: ['账号42'] })))
    document.cookie = 'cook_uid=42; path=/'
    const { useKitchenStore } = await import('../apps/web/app/composables/store/kitchen')
    const store = useKitchenStore()
    expect(store.ingredients).toEqual(['账号42'])
    store.addIngredients(['番茄'])
    expect(JSON.parse(localStorage.getItem('cook:kitchen')!).ingredients).toEqual([entry('匿名', 0)])
    expect(localStorage.getItem('cook:u43:kitchen')).toBeNull()
  })

  it('migrates anonymous kitchen once without overwriting existing accounts', async () => {
    const { migrateAnonymousStorage } = await import('../apps/web/app/utils/storageScope')
    const kitchen = JSON.stringify(normalizeKitchen({ ingredients: ['匿名'] }))
    localStorage.setItem('cook:kitchen', kitchen)
    migrateAnonymousStorage(42)
    expect(localStorage.getItem('cook:u42:kitchen')).toBe(kitchen)
    migrateAnonymousStorage(43)
    expect(localStorage.getItem('cook:u43:kitchen')).toBeNull()
  })

  it('surfaces import write failures to the caller instead of failing silently', async () => {
    const { importLocalUserData } = await import('../apps/web/app/composables/store/userData')
    const exported = JSON.stringify(createUserDataExport(createEmptyUserData(), 1))
    const original = Storage.prototype.setItem
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'cook:history')
        throw new Error('quota')
      return original.call(this, key, value)
    })
    try {
      // The settings page relies on this throw to tell the user why the import failed.
      expect(() => importLocalUserData(exported)).toThrow('quota')
    }
    finally {
      spy.mockRestore()
    }
  })
})
