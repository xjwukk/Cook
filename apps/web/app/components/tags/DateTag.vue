<template>
  <div
    class="tagSize date-tag pureTag"
    p="x-2"
  >
    <slot />
  </div>
</template>

<style scoped>
/* 姜黄日期章：与墨绿的菜谱章区分 */
.date-tag {
  border-color: var(--c-saffron);
  background: var(--c-saffron-wash);
  color: var(--c-saffron-ink);
}
</style>
