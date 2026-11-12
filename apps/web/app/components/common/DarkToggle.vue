<script setup lang="ts">
const { color, toggleDark } = useDarkMode()

useHead({
  meta: [{
    id: 'theme-color',
    name: 'theme-color',
    content: () => color.value === 'dark' ? '#222222' : '#ffffff',
  }],
})
</script>

<template>
  <YlfIconButton
    label="切换深色模式"
    text-xl
    @click="toggleDark()"
  >
    <div i="ri-sun-line dark:ri-moon-line" />
  </YlfIconButton>
</template>
