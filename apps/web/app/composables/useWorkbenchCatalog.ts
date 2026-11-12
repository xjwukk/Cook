import type { MaybeRefOrGetter } from 'vue'
import type { StuffItem } from '~/types'
import { computed, toValue } from 'vue'
import { useKitchenStore } from '~/composables/store/kitchen'
import * as base from '~/data/food'
import { usePersonalCatalog } from './usePersonalCatalog'

export function useWorkbenchCatalog(selectedTool: MaybeRefOrGetter<string>, onlyOwned: MaybeRefOrGetter<boolean> = false) {
  const catalog = usePersonalCatalog()
  const kitchen = useKitchenStore()
  const sections = computed(() => {
    if (!toValue(onlyOwned))
      return catalog.sections.value
    const assigned = new Set<string>()
    return catalog.sections.value.map((section, index) => {
      const known = [...base[section.category], ...section.items]
      const items = kitchen.ingredients.flatMap((name) => {
        const item = known.find(item => item.name === name)
        // Unknown/removed custom entries still belong to the kitchen.
        const knownElsewhere = catalog.sections.value.some(group => [...base[group.category], ...group.items].some(item => item.name === name))
        if (assigned.has(name) || (!item && (index !== 2 || knownElsewhere)))
          return []
        assigned.add(name)
        return [item || { name, emoji: '🥬' }]
      })
      return { ...section, items }
    })
  })
  const ingredients = computed(() => sections.value.flatMap(section => section.items))
  const tools = computed<StuffItem[]>(() => {
    const visible = catalog.food.value.tools
    if (toValue(onlyOwned))
      return kitchen.tools.map(name => [...base.tools, ...visible].find(item => item.name === name) || { name, emoji: '🍳' })
    const selected = toValue(selectedTool)
    return selected && !visible.some(item => item.name === selected)
      ? [...visible, { name: selected, emoji: '🍳' }]
      : visible
  })

  function acceptsIngredient(name: string) {
    return ingredients.value.some(item => item.name === name)
  }

  return { sections, ingredients, tools, acceptsIngredient }
}
