import type { KitchenData } from '~/utils/kitchen'
import { useEventListener } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { createEmptyKitchen, mergeKitchen, normalizeKitchen } from '~/utils/kitchen'
import { scopedKey } from '~/utils/storageScope'

const storageKey = scopedKey('kitchen')

function readStorage(): KitchenData {
  try {
    const raw = localStorage.getItem(storageKey)
    return raw ? normalizeKitchen(JSON.parse(raw)) : createEmptyKitchen()
  }
  catch {
    return createEmptyKitchen()
  }
}

/** Pinia unwraps refs on the returned store. Mutations persist before updating UI. */
export const useKitchenStore = defineStore('kitchen', () => {
  const data = ref<KitchenData>(readStorage())
  const ingredients = computed(() => data.value.ingredients.map(entry => entry.name))
  const tools = computed(() => data.value.tools.map(entry => entry.name))
  const pantry = computed(() => data.value.pantry.map(entry => entry.name))
  const initialized = computed(() => data.value.initialized)

  function replaceData(value: KitchenData, persist = true): void {
    const normalized = normalizeKitchen(value)
    // Quota/security errors are deliberately propagated; never pretend a save succeeded.
    if (persist)
      localStorage.setItem(storageKey, JSON.stringify(normalized))
    data.value = normalized
  }

  function nextTime(current: KitchenData): number {
    // Keep timestamps safe integers; refusing at the boundary is preferable to
    // writing a value that normalizeKitchen would silently discard.
    const allEntries = [current.ingredients, current.ingredientRemovals, current.tools, current.toolRemovals, current.pantry, current.pantryRemovals].flat()
    const max = allEntries.reduce((value, entry) => Math.max(value, entry.time), Date.now())
    if (max >= Number.MAX_SAFE_INTEGER)
      throw new Error('厨房时间戳已达到上限，无法继续修改')
    return max + 1
  }

  function update(kind: 'ingredients' | 'tools' | 'pantry', names: string[], replace: boolean): void {
    const current = mergeKitchen(data.value, readStorage())
    const removals = { ingredients: 'ingredientRemovals', tools: 'toolRemovals', pantry: 'pantryRemovals' } as const
    const selected = new Set(normalizeKitchen({ [kind]: names })[kind].map(entry => entry.name))
    // Monotonic per-device time permits remove/re-add within one millisecond.
    const time = nextTime(current)
    const next = { ...current, initialized: true }
    next[kind] = [...current[kind], ...[...selected].map(name => ({ name, time }))]
    if (replace) {
      next[removals[kind]] = [...current[removals[kind]], ...current[kind].filter(entry => !selected.has(entry.name)).map(({ name }) => ({ name, time }))]
    }
    replaceData(next)
  }

  function addIngredients(names: string[]): void {
    update('ingredients', names, false)
  }

  function removeIngredient(name: string): void {
    // Read fresh storage before deriving the replacement, preserving other tabs' additions.
    const current = mergeKitchen(data.value, readStorage())
    const normalizedName = name.trim()
    if (!normalizedName || normalizedName.length > 200)
      return
    const time = nextTime(current)
    replaceData({ ...current, initialized: true, ingredientRemovals: [...current.ingredientRemovals, { name: normalizedName, time }] })
  }

  useEventListener(typeof window === 'undefined' ? undefined : window, 'storage', (event: StorageEvent) => {
    if (event.key === storageKey)
      data.value = mergeKitchen(data.value, readStorage())
  })

  return {
    data: computed(() => data.value),
    ingredients,
    tools,
    pantry,
    initialized,
    addIngredients,
    removeIngredient,
    setTools: (names: string[]) => update('tools', names, true),
    setPantry: (names: string[]) => update('pantry', names, true),
    replaceData,
  }
})
