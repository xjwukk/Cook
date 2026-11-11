<script lang="ts" setup>
import type { RecipeItem } from '~/types'
import type { DbRecipeItem } from '~/utils/db'
import { tools } from '~/data/food'
import { getEmojisFromStuff } from '~/utils'

const props = defineProps<{
  dish: RecipeItem | DbRecipeItem
}>()

const dishEmojis = computed(() => {
  return getEmojisFromStuff(props.dish.stuff)
})
</script>

<template>
  <span class="inline-flex items-center gap-1">
    <ion-label class="dish-label-stamp" aria-hidden="true">
      {{ dish.tags?.includes('杂烩') ? '🍲' : dishEmojis.join(' ') }}
    </ion-label>

    <ion-label>
      {{ dish.name }}
    </ion-label>

    <template v-for="tool, i in tools">
      <span
        v-if="dish.tools?.includes(tool.name)"
        :key="i" class="inline-block" :class="tool.icon"
      />
    </template>
  </span>
</template>

<style scoped>
/* 食材 emoji 的纸章容器：一个 emoji 时是圆，多个时是药丸 */
.dish-label-stamp {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  flex: none;
  padding: 0 6px;
  border-radius: var(--r-pill);
  background: var(--c-emoji-wash);
  font-size: 14px;
  line-height: 1;
}
</style>
