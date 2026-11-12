import type { VueWrapper } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useKitchenStore } from '../apps/web/app/composables/store/kitchen'
import { usePersonalCatalog } from '../apps/web/app/composables/usePersonalCatalog'
import { useWorkbenchCatalog } from '../apps/web/app/composables/useWorkbenchCatalog'
import { emptyPersonalCatalog, parsePersonalCatalog } from '../packages/cook/src/utils/personal-catalog'
import fixture from '../packages/data/fixtures/personal-catalog.json'

vi.unmock('vue')
const wrappers: VueWrapper[] = []

function mountCatalog(initialTool = '', initialOnlyOwned = false) {
  const selectedTool = ref(initialTool)
  const onlyOwned = ref(initialOnlyOwned)
  let catalog: ReturnType<typeof usePersonalCatalog>
  let workbench: ReturnType<typeof useWorkbenchCatalog>
  const wrapper = mount(defineComponent({
    setup() {
      catalog = usePersonalCatalog()
      workbench = useWorkbenchCatalog(() => selectedTool.value, () => onlyOwned.value)
      return () => h('div')
    },
  }))
  wrappers.push(wrapper)
  return { catalog: catalog!, workbench: workbench!, selectedTool, onlyOwned, kitchen: useKitchenStore() }
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => wrappers.splice(0).forEach(wrapper => wrapper.unmount()))

describe('workbench shares the personal catalog', () => {
  it('uses custom and hidden entries for categories, search ingredients and accepted drops', () => {
    const { catalog, workbench } = mountCatalog()
    catalog.update(() => parsePersonalCatalog(JSON.stringify(fixture)))

    expect(workbench.sections.value.find(section => section.category === 'vegetable')?.items.map(item => item.name)).toContain('鹰嘴豆')
    expect(workbench.sections.value.find(section => section.category === 'meat')?.items.map(item => item.name)).toContain('鹌鹑')
    expect(workbench.sections.value.find(section => section.category === 'staple')?.items.map(item => item.name)).toContain('藜麦')
    expect(workbench.ingredients.value.map(item => item.name)).not.toContain('番茄')
    expect(workbench.tools.value.map(item => item.name)).toContain('塔吉锅')
    expect(workbench.acceptsIngredient('鹰嘴豆')).toBe(true)
    expect(workbench.acceptsIngredient('番茄')).toBe(false)
    expect(workbench.acceptsIngredient('外部拖入的未知食材')).toBe(false)
  })

  it('updates an already mounted workbench when another catalog consumer adds, hides or restores entries', () => {
    const { catalog, workbench } = mountCatalog()
    catalog.update(() => ({
      ...emptyPersonalCatalog(),
      items: [{ category: 'vegetable', name: '合成食材' }],
      hidden: [{ category: 'vegetable', name: '番茄' }],
    }))
    expect(workbench.acceptsIngredient('合成食材')).toBe(true)
    expect(workbench.acceptsIngredient('番茄')).toBe(false)
    catalog.update(() => emptyPersonalCatalog())
    expect(workbench.acceptsIngredient('合成食材')).toBe(false)
    expect(workbench.acceptsIngredient('番茄')).toBe(true)
  })

  it('keeps a hidden selected tool available until it is deselected, and restores it without duplicates', () => {
    const { catalog, workbench, selectedTool } = mountCatalog('一口大锅')
    catalog.update(() => ({ ...emptyPersonalCatalog(), hidden: [{ category: 'tools', name: '一口大锅' }] }))
    expect(workbench.tools.value.map(item => item.name)).toContain('一口大锅')
    expect(selectedTool.value).toBe('一口大锅')
    selectedTool.value = ''
    expect(workbench.tools.value.map(item => item.name)).not.toContain('一口大锅')
    selectedTool.value = '一口大锅'
    catalog.update(() => emptyPersonalCatalog())
    expect(workbench.tools.value.filter(item => item.name === '一口大锅')).toHaveLength(1)
  })

  it('shows only inventory entries, retaining hidden and deleted names without treating pantry as ingredients', () => {
    const { catalog, workbench, kitchen } = mountCatalog('非库存厨具', true)
    catalog.update(() => ({
      ...emptyPersonalCatalog(),
      hidden: [
        { category: 'vegetable', name: '番茄' },
        { category: 'tools', name: '一口大锅' },
      ],
    }))
    kitchen.addIngredients(['番茄', '已删除自定义食材'])
    kitchen.setTools(['一口大锅', '已删除自定义厨具'])
    kitchen.setPantry(['盐'])

    expect(workbench.ingredients.value.map(item => item.name).sort()).toEqual(['已删除自定义食材', '番茄'].sort())
    expect(workbench.sections.value.find(section => section.category === 'vegetable')?.items.map(item => item.name)).toContain('番茄')
    expect(workbench.tools.value.map(item => item.name).sort()).toEqual(['一口大锅', '已删除自定义厨具'].sort())
    expect(workbench.acceptsIngredient('番茄')).toBe(true)
    expect(workbench.acceptsIngredient('已删除自定义食材')).toBe(true)
    expect(workbench.acceptsIngredient('盐')).toBe(false)
    expect(workbench.acceptsIngredient('鸡蛋')).toBe(false)
    expect(catalog.ingredients.value.map(item => item.name)).not.toContain('番茄')
    expect(catalog.food.value.tools.map(item => item.name)).not.toContain('一口大锅')
  })

  it('reacts to inventory mutations and mode changes without remounting', () => {
    const { catalog, workbench, kitchen, onlyOwned } = mountCatalog('', true)
    expect(workbench.ingredients.value).toEqual([])
    expect(workbench.tools.value).toEqual([])
    kitchen.addIngredients(['番茄'])
    kitchen.setTools(['一口大锅'])
    expect(workbench.acceptsIngredient('番茄')).toBe(true)
    expect(workbench.tools.value.map(item => item.name)).toEqual(['一口大锅'])

    catalog.update(() => ({ ...emptyPersonalCatalog(), hidden: [{ category: 'vegetable', name: '番茄' }] }))
    expect(workbench.acceptsIngredient('番茄')).toBe(true)
    onlyOwned.value = false
    expect(workbench.acceptsIngredient('番茄')).toBe(false)
    expect(workbench.acceptsIngredient('鸡蛋')).toBe(true)
    onlyOwned.value = true
    expect(workbench.acceptsIngredient('番茄')).toBe(true)
    expect(workbench.acceptsIngredient('鸡蛋')).toBe(false)

    kitchen.removeIngredient('番茄')
    kitchen.setTools([])
    expect(workbench.ingredients.value).toEqual([])
    expect(workbench.tools.value).toEqual([])
  })

  it('keeps a deleted custom tool available for cancellation without adding it back to the catalog', () => {
    const { catalog, workbench, selectedTool } = mountCatalog('塔吉锅')
    catalog.update(() => parsePersonalCatalog(JSON.stringify(fixture)))
    catalog.update(current => ({ ...current, items: current.items.filter(item => item.category !== 'tools') }))
    expect(workbench.tools.value.map(item => item.name)).toContain('塔吉锅')
    expect(catalog.food.value.tools.map(item => item.name)).not.toContain('塔吉锅')
    selectedTool.value = ''
    expect(workbench.tools.value.map(item => item.name)).not.toContain('塔吉锅')
  })
})
