export interface KitchenEntry { name: string, time: number }

/** Per-name LWW sets. Tombstones never expire: old backups must not revive removals. */
export interface KitchenData {
  ingredients: KitchenEntry[]
  ingredientRemovals: KitchenEntry[]
  tools: KitchenEntry[]
  toolRemovals: KitchenEntry[]
  pantry: KitchenEntry[]
  pantryRemovals: KitchenEntry[]
  initialized: boolean
}

export function createEmptyKitchen(): KitchenData {
  return { ingredients: [], ingredientRemovals: [], tools: [], toolRemovals: [], pantry: [], pantryRemovals: [], initialized: false }
}

function readEntries(value: unknown): KitchenEntry[] {
  if (!Array.isArray(value))
    return []
  return value.flatMap((entry) => {
    // Read simple lists from early/local backups using a deterministic epoch.
    if (typeof entry === 'string')
      entry = { name: entry, time: 0 }
    if (!entry || typeof entry !== 'object')
      return []
    const { name, time } = entry
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 200 || typeof time !== 'number' || !Number.isSafeInteger(time) || time < 0)
      return []
    return [{ name: name.trim(), time }]
  })
}

function latest(entries: KitchenEntry[]): Map<string, KitchenEntry> {
  const result = new Map<string, KitchenEntry>()
  for (const entry of entries) {
    if (!result.has(entry.name) || result.get(entry.name)!.time < entry.time)
      result.set(entry.name, entry)
  }
  return result
}

function compare(a: KitchenEntry, b: KitchenEntry): number {
  return a.name === b.name ? 0 : a.name < b.name ? -1 : 1
}

export function normalizeKitchen(value: unknown): KitchenData {
  const data = createEmptyKitchen()
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return data
  const record = value as Record<string, unknown>
  for (const [adds, removes] of [['ingredients', 'ingredientRemovals'], ['tools', 'toolRemovals'], ['pantry', 'pantryRemovals']] as const) {
    const active = latest(readEntries(record[adds]))
    const removed = latest(readEntries(record[removes]))
    data[adds] = [...active.values()].filter(entry => (removed.get(entry.name)?.time ?? -1) < entry.time).sort(compare)
    // Keep removal records even when superseded by a newer add, for monotonic merge.
    data[removes] = [...removed.values()].sort(compare)
  }
  data.initialized = record.initialized === true || data.ingredients.length > 0 || data.tools.length > 0 || data.pantry.length > 0
  return data
}

export function mergeKitchen(a: KitchenData, b: KitchenData): KitchenData {
  const left = normalizeKitchen(a)
  const right = normalizeKitchen(b)
  return normalizeKitchen({
    ingredients: [...left.ingredients, ...right.ingredients],
    ingredientRemovals: [...left.ingredientRemovals, ...right.ingredientRemovals],
    tools: [...left.tools, ...right.tools],
    toolRemovals: [...left.toolRemovals, ...right.toolRemovals],
    pantry: [...left.pantry, ...right.pantry],
    pantryRemovals: [...left.pantryRemovals, ...right.pantryRemovals],
    initialized: left.initialized || right.initialized,
  })
}
