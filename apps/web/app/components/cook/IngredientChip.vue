<script lang="ts" setup>
/**
 * 食材 / 厨具选择按钮：未选中是纸白底 + 墨线边框 + emoji 纸章容器，
 * 选中后填成陶土橙的「印章」并显示勾
 */
defineProps<{
  label: string
  selected: boolean
  emoji?: string
  icon?: string
  disabled?: boolean
}>()
</script>

<template>
  <button type="button" class="ingredient-chip" :aria-pressed="selected" :disabled="disabled">
    <ion-icon v-if="selected" class="ingredient-chip-check" :icon="ioniconsCheckmark" aria-hidden="true" />
    <span v-else-if="emoji" class="ingredient-chip-mark" aria-hidden="true">{{ emoji }}</span>
    <span v-else-if="icon" class="ingredient-chip-icon" :class="icon" aria-hidden="true" />
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.ingredient-chip {
  --ingredient-chip-gap: 6px;
  --ingredient-chip-height: 44px;
  --ingredient-chip-padding-block: 7px;
  --ingredient-chip-padding-inline: 13px;
  --ingredient-chip-padding-inline-start: 8px;
  --ingredient-chip-radius: var(--r-pill);
  --ingredient-chip-mark-size: 26px;
  --ingredient-chip-font-size: var(--fs-base);
  display: inline-flex;
  align-items: center;
  gap: var(--ingredient-chip-gap);
  min-height: var(--ingredient-chip-height);
  padding: var(--ingredient-chip-padding-block) var(--ingredient-chip-padding-inline)
    var(--ingredient-chip-padding-block) var(--ingredient-chip-padding-inline-start);
  border: 1px solid var(--c-rule);
  border-radius: var(--ingredient-chip-radius);
  background: var(--c-paper);
  color: var(--c-ink-2);
  font-size: var(--ingredient-chip-font-size);
  line-height: 1.4;
  transition:
    transform var(--dur-base) var(--ease-out),
    background-color var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out);
  -webkit-user-select: none;
  user-select: none;
}
.ingredient-chip:hover:not([aria-pressed='true']) {
  border-color: var(--c-rule-strong);
  background: var(--c-surface);
  color: var(--c-ink);
}
.ingredient-chip:active {
  transform: scale(var(--cook-btn-press-scale));
}
/* 印章：选中即陶土橙实底 */
.ingredient-chip[aria-pressed='true'] {
  --ingredient-chip-padding-inline-start: var(--ingredient-chip-padding-inline);
  border-color: var(--c-brand);
  background: var(--c-brand);
  color: var(--c-brand-contrast);
  font-weight: 500;
  animation: ingredient-chip-pop var(--dur-slow) var(--ease-spring);
}
/* emoji 纸章：统一圆形容器，避免不同 emoji 视觉杂乱 */
.ingredient-chip-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ingredient-chip-mark-size);
  height: var(--ingredient-chip-mark-size);
  flex: none;
  border-radius: var(--r-pill);
  background: var(--c-emoji-wash);
  font-size: 15px;
  line-height: 1;
}
.ingredient-chip-check {
  flex: none;
  width: 20px;
  height: 20px;
}
.ingredient-chip-icon {
  flex: none;
  width: 20px;
  height: 20px;
}
.ingredient-chip:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}
.ingredient-chip:disabled {
  opacity: var(--cook-btn-disabled-opacity);
  cursor: not-allowed;
  transform: none;
}
@keyframes ingredient-chip-pop {
  0% {
    transform: scale(0.92);
  }
  60% {
    transform: scale(1.04);
  }
  100% {
    transform: scale(1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .ingredient-chip {
    transition: none;
  }
  .ingredient-chip:active {
    transform: none;
  }
  .ingredient-chip[aria-pressed='true'] {
    animation: none;
  }
}
</style>
