<script lang="ts" setup>
interface StripImage {
  id: string
  name: string
  dataUrl: string
}

const props = withDefaults(defineProps<{
  images: StripImage[]
  removable?: boolean
}>(), {
  removable: false,
})

const emit = defineEmits<{ remove: [id: string] }>()
</script>

<template>
  <ul v-if="props.images?.length" class="assistant-image-strip">
    <li v-for="image in props.images" :key="image.id" class="assistant-image-item">
      <a
        class="assistant-image-thumb"
        :href="image.dataUrl"
        target="_blank"
        rel="noopener"
        :title="image.name"
      >
        <img :src="image.dataUrl" :alt="image.name">
      </a>
      <button
        v-if="props.removable"
        type="button"
        class="assistant-image-remove"
        :aria-label="`移除${image.name}`"
        @click="emit('remove', image.id)"
      >
        ✕
      </button>
    </li>
  </ul>
</template>

<style scoped>
.assistant-image-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.assistant-image-item {
  position: relative;
  flex: none;
}
.assistant-image-thumb {
  display: block;
  width: 72px;
  height: 72px;
  overflow: hidden;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-paper-sunk);
}
.assistant-image-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.assistant-image-remove {
  position: absolute;
  top: -6px;
  inset-inline-end: -6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--c-rule);
  border-radius: var(--r-pill);
  background: var(--c-surface);
  color: var(--c-ink-2);
  font-size: var(--fs-xs);
  line-height: 1;
  cursor: pointer;
}
.assistant-image-remove:hover {
  color: var(--c-ink);
  border-color: var(--c-rule-strong);
}
.assistant-image-remove:focus-visible {
  outline: var(--cook-btn-focus-width) solid var(--c-brand);
  outline-offset: var(--cook-btn-focus-offset);
}
</style>
