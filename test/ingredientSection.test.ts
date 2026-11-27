import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import IngredientSection from '../apps/web/app/components/cook/IngredientSection.vue'

const globalOptions = {
  stubs: {
    'IngredientSectionLabel': { props: ['title', 'icon'], template: '<span class="section-label">{{ title }}</span>' },
    'ion-icon': true,
  },
  mocks: {
    ioniconsChevronUp: 'chevron-up',
    ioniconsChevronDown: 'chevron-down',
  },
}

describe('ingredientSection', () => {
  it('keeps the original layout when not collapsible', () => {
    const wrapper = mount(IngredientSection, {
      props: { title: '蔬菜', note: '已选 2 种' },
      slots: { default: '<span class="chip">番茄</span>' },
      global: globalOptions,
    })

    expect(wrapper.find('button').exists()).toBe(false)
    expect(wrapper.get('.ingredient-section-card').isVisible()).toBe(true)
    expect(wrapper.text()).toContain('已选 2 种')
  })

  it('is collapsed by default when collapsible', () => {
    const wrapper = mount(IngredientSection, {
      props: { title: '蔬菜', note: '已选 2 种', collapsible: true },
      slots: { default: '<span class="chip">番茄</span>' },
      global: globalOptions,
    })

    const button = wrapper.get('button')
    const card = wrapper.get('.ingredient-section-card')
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(card.attributes('id')).toBe(button.attributes('aria-controls'))
    expect(card.isVisible()).toBe(false)
  })

  it('can start expanded and emits the next state', async () => {
    const onUpdate = vi.fn()
    const wrapper = mount(IngredientSection, {
      props: { 'title': '蔬菜', 'collapsible': true, 'expanded': true, 'onUpdate:expanded': onUpdate },
      slots: { default: '<span class="chip">番茄</span>' },
      global: globalOptions,
    })

    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.ingredient-section-card').isVisible()).toBe(true)

    await wrapper.get('button').trigger('click')
    expect(onUpdate).toHaveBeenCalledWith(false)
  })

  it('keeps the actions slot outside the toggle button', () => {
    const wrapper = mount(IngredientSection, {
      props: { title: '蔬菜', collapsible: true },
      slots: { actions: '<button class="manage">管理</button>' },
      global: globalOptions,
    })

    expect(wrapper.get('h2').find('.manage').exists()).toBe(false)
    expect(wrapper.find('.manage').exists()).toBe(true)
  })
})
