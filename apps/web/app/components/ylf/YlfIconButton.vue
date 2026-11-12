<script lang="ts" setup>
defineProps<{
  icon?: string
  /** 无障碍名称；纯图标按钮必须提供 */
  label?: string
}>()
</script>

<template>
  <button
    type="button"
    class="ylf-icon-button"
    :aria-label="label"
    :title="label"
  >
    <slot>
      <div v-if="icon" text-xl :class="icon" aria-hidden="true" />
    </slot>
  </button>
</template>

<style scoped>
/* 图标按钮：40px 命中区，暖色悬停，焦点环与其它按钮一致 */
.ylf-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition:
    background-color var(--dur-base) var(--ease-out),
    color var(--dur-base) var(--ease-out),
    transform var(--dur-fast) var(--ease-out);
}

.ylf-icon-button:hover {
  background: var(--c-paper-alt);
  color: var(--c-saffron-ink);
}

.ylf-icon-button:active {
  transform: scale(0.94);
}

.ylf-icon-button:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}

.ylf-icon-button:disabled {
  opacity: var(--cook-btn-disabled-opacity);
  cursor: not-allowed;
}

@media (pointer: coarse) {
  .ylf-icon-button {
    width: 44px;
    height: 44px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ylf-icon-button {
    transition: background-color var(--dur-fast) linear;
  }
  .ylf-icon-button:active {
    transform: none;
  }
}
</style>
