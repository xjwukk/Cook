<script lang="ts" setup>
import { useId } from 'vue'

/**
 * iOS 分组：灰色小标题 + 白色圆角卡片，卡片里是一组可换行的按钮。
 * 传 collapsible 后标题变成按钮，默认收起；展开状态由 v-model:expanded 控制。
 */
defineProps<{
  title: string
  /** Decorative symbol; the title remains the accessible category label. */
  icon?: string
  /** 标题右侧的说明，例如「已选 2 种」 */
  note?: string
  /** 标题可点击展开/收起，默认 false */
  collapsible?: boolean
}>()

const expanded = defineModel<boolean>('expanded', { default: false })
const contentId = `ingredient-section-${useId()}`

function toggle() {
  expanded.value = !expanded.value
}
</script>

<template>
  <section class="ingredient-section" :aria-label="title">
    <div v-if="collapsible" class="ingredient-section-collapsible">
      <div class="ingredient-section-collapsible-header">
        <h2 class="ingredient-section-collapsible-heading">
          <button
            type="button"
            class="ingredient-section-toggle"
            :aria-expanded="expanded"
            :aria-controls="contentId"
            @click="toggle"
          >
            <span class="ingredient-section-toggle-label">
              <IngredientSectionLabel :title="title" :icon="icon" />
              <span v-if="note" class="ingredient-section-note">{{ note }}</span>
            </span>
            <ion-icon
              class="ingredient-section-chevron"
              aria-hidden="true"
              :icon="expanded ? ioniconsChevronUp : ioniconsChevronDown"
            />
          </button>
        </h2>
        <span v-if="$slots.actions" class="ingredient-section-actions">
          <slot name="actions" />
        </span>
      </div>
      <div v-show="expanded" :id="contentId" class="ingredient-section-card">
        <slot />
      </div>
    </div>

    <template v-else>
      <h2 class="cook-group-header ingredient-section-header">
        <IngredientSectionLabel :title="title" :icon="icon" />
        <span v-if="note || $slots.actions" class="ingredient-section-actions">
          <span v-if="note" class="ingredient-section-note">{{ note }}</span>
          <slot name="actions" />
        </span>
      </h2>
      <div class="ingredient-section-card">
        <slot />
      </div>
    </template>
  </section>
</template>

<style scoped>
.ingredient-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: var(--ingredient-section-heading-min-height, 0px);
  margin: var(--ingredient-section-heading-margin, 24px 0 0);
  padding: var(--ingredient-section-heading-padding, 0 36px 6px);
  color: var(--ingredient-section-heading-color, var(--ion-text-color-step-400, #6d6d72));
  font-weight: var(--ingredient-section-heading-weight, 400);
}
.ingredient-section-collapsible-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: var(--ingredient-section-heading-min-height, 0px);
  margin: var(--ingredient-section-heading-margin, 24px 0 0);
  padding: var(--ingredient-section-heading-padding, 0 36px 6px);
  color: var(--ingredient-section-heading-color, var(--ion-text-color-step-400, #6d6d72));
  font-weight: var(--ingredient-section-heading-weight, 400);
}
.ingredient-section-collapsible-heading {
  flex: 1;
  min-width: 0;
  margin: 0;
  font: inherit;
}
.ingredient-section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}
.ingredient-section-toggle:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
  border-radius: 6px;
}
.ingredient-section-toggle-label {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ingredient-section-chevron {
  flex: none;
  width: 17px;
  height: 17px;
  color: inherit;
}
.ingredient-section-actions {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 10px;
}
.ingredient-section-note {
  color: var(--c-ink-2);
  font-weight: 400;
}
.ingredient-section-card {
  display: flex;
  flex-wrap: wrap;
  gap: var(--ingredient-section-gap, 8px);
  margin: var(--ingredient-section-margin, 0 16px);
  padding: var(--ingredient-section-padding, 12px);
  border: var(--ingredient-section-border, 1px solid var(--c-rule));
  border-radius: var(--ingredient-section-radius, 10px);
  background: var(--c-surface);
  box-shadow: var(--shadow-1);
}
</style>
