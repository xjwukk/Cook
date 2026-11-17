import type { PersonalCatalog } from '@yunyoujun/cook/personal-catalog'
import type { StuffItem } from '~/types'
import { tryOnMounted, useEventListener } from '@vueuse/core'
import { catalogItems, emptyPersonalCatalog } from '@yunyoujun/cook/personal-catalog'
import { computed, shallowRef } from 'vue'
import * as base from '~/data/food'
import { readPersonalCatalog, updatePersonalCatalog } from '~/utils/personalCatalogStorage'
import { scopedKey } from '~/utils/storageScope'

const key = scopedKey('personal-catalog')
const value = shallowRef(emptyPersonalCatalog())
const error = shallowRef('')
export const catalogTitles = { vegetable: '蔬菜', meat: '肉和蛋', staple: '主食', tools: '厨具' }
const emoji = { vegetable: '🥬', meat: '🥩', staple: '🍚', tools: '🍳' }

function refresh() {
  try {
    value.value = readPersonalCatalog(localStorage, key)
    error.value = ''
  }
  catch {
    error.value = '本机食材和厨具配置读取失败，原始数据已保留；请重试或先备份浏览器数据。'
  }
}

// 监听器只注册一次：这个 composable 也可能在 setup 之外被调用（例如助手写操作）。
if (typeof window !== 'undefined') {
  useEventListener('storage', (event: StorageEvent) => {
    if (event.key === key || event.key === null)
      refresh()
  })
}

export function usePersonalCatalog() {
  // 只有在组件里才挂载时刷新；setup 之外的调用（如助手）直接读写存储即可。
  tryOnMounted(refresh)

  function update(change: (current: PersonalCatalog) => PersonalCatalog) {
    value.value = updatePersonalCatalog(localStorage, key, change)
    error.value = ''
  }
  const food = computed(() => Object.fromEntries(Object.entries(base).map(([category, items]) => {
    const group = category as keyof typeof base
    return [group, catalogItems(items, value.value, group, name => ({ name, emoji: emoji[group] }))]
  })) as Record<keyof typeof base, StuffItem[]>)
  const sections = computed(() => (['vegetable', 'meat', 'staple'] as const).map(category => ({ category, title: catalogTitles[category], items: food.value[category] })))
  const ingredients = computed(() => sections.value.flatMap(section => section.items))
  return { value, error, refresh, update, food, sections, ingredients }
}
