function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Validate the optional kitchen extension without stripping any sync fields. */
export function isValidUserData(data) {
  if (!record(data))
    return false
  if (data.kitchen === undefined)
    return true // Existing v1 clients/backups remain valid.
  const kitchen = data.kitchen
  if (!record(kitchen) || typeof kitchen.initialized !== 'boolean')
    return false
  for (const key of ['ingredients', 'ingredientRemovals', 'tools', 'toolRemovals', 'pantry', 'pantryRemovals']) {
    if (!Array.isArray(kitchen[key]) || !kitchen[key].every(entry => record(entry)
      && typeof entry.name === 'string' && entry.name.trim().length > 0 && entry.name.length <= 200
      && Number.isSafeInteger(entry.time) && entry.time >= 0)) {
      return false
    }
  }
  return true
}
