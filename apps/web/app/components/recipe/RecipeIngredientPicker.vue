<script lang="ts" setup>
import type { StuffItem } from '~/types'

/**
 * 菜谱编辑器的食材选择：输入框 + 按分类折叠的食材卡片。
 * 已选食材仍然显示在输入框下方，收起分类不会丢掉它们。
 */
const props = defineProps<{ selected: string[] }>()
const emit = defineEmits<{ add: [name: string], toggle: [name: string] }>()

const { sections } = usePersonalCatalog()

/** 用 Set + helper 避免 noUncheckedIndexedAccess 下标访问；初始为空 = 全部收起 */
const expandedSections = ref(new Set<string>())

function isExpanded(key: string) {
  return expandedSections.value.has(key)
}

function setExpanded(key: string, value: boolean) {
  const next = new Set(expandedSections.value)
  if (value)
    next.add(key)
  else
    next.delete(key)
  expandedSections.value = next
}

function selectedNote(items: StuffItem[]) {
  const count = items.filter(item => props.selected.includes(item.name)).length
  return count ? `已选 ${count} 种` : ''
}
</script>

<template>
  <div class="recipe-ingredient-picker">
    <IngredientInput
      :selected="selected"
      @add="emit('add', $event)"
      @remove="emit('toggle', $event)"
    />
    <IngredientSection
      v-for="section in sections"
      :key="section.category"
      collapsible
      :title="section.title"
      :note="selectedNote(section.items)"
      :expanded="isExpanded(section.category)"
      @update:expanded="value => setExpanded(section.category, value)"
    >
      <IngredientChip
        v-for="item in section.items"
        :key="item.name"
        :label="item.name"
        :emoji="item.emoji"
        :selected="selected.includes(item.name)"
        @click="emit('toggle', item.name)"
      />
    </IngredientSection>
  </div>
</template>
