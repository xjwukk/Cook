<script lang="ts" setup>
import type { RecipeMatch } from '@yunyoujun/cook/recommend'

const props = defineProps<{
  match: RecipeMatch
  why?: string
}>()

defineEmits<{ open: [] }>()

const recipe = computed(() => props.match.recipe)
const thumb = computed(() => getEmojisFromStuff(props.match.matchedStuff.length ? props.match.matchedStuff : recipe.value.stuff ?? [])[0] ?? '🍽️')
const missing = computed(() => props.match.missingStuff)
const tool = computed(() => recipe.value.tools?.[0] === '一口大锅' ? '炒锅' : recipe.value.tools?.[0])
</script>

<template>
  <li class="assistant-recipe">
    <button type="button" class="assistant-recipe-main" :aria-label="`打开${recipe.name}`" @click="$emit('open')">
      <span class="assistant-recipe-thumb" aria-hidden="true">{{ thumb }}</span>
      <span class="assistant-recipe-copy">
        <strong>{{ recipe.name }}</strong>
        <span v-if="why" class="assistant-recipe-why">{{ why }}</span>
        <span v-else-if="missing.length" class="assistant-recipe-missing">还缺 {{ missing.join('、') }}</span>
        <span v-else class="assistant-recipe-ready">现在就能做</span>
      </span>
      <span v-if="tool" class="assistant-recipe-tool">{{ tool }}</span>
    </button>
  </li>
</template>

<style scoped>
.assistant-recipe {
  list-style: none;
}
.assistant-recipe-main {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 60px;
  padding: 10px 12px;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-ink);
  text-align: start;
  cursor: pointer;
  transition:
    border-color var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}
.assistant-recipe-main:hover {
  border-color: var(--c-rule-strong);
  background: var(--c-paper-alt);
}
.assistant-recipe-main:active {
  transform: scale(var(--cook-btn-press-scale));
}
.assistant-recipe-main:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}
.assistant-recipe-thumb {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: var(--r-pill);
  background: var(--c-emoji-wash);
  font-size: 19px;
  line-height: 1;
}
.assistant-recipe-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 3px;
}
.assistant-recipe-copy strong {
  overflow: hidden;
  font-size: var(--fs-md);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assistant-recipe-why,
.assistant-recipe-ready,
.assistant-recipe-missing {
  overflow: hidden;
  font-size: var(--fs-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.assistant-recipe-why,
.assistant-recipe-ready {
  color: var(--c-ink-2);
}
.assistant-recipe-missing {
  color: var(--c-warn);
}
.assistant-recipe-tool {
  flex: none;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
}
</style>
