<script lang="ts" setup>
const router = useRouter()
function back() {
  router.back()
}
</script>

<template>
  <YlfIconButton
    icon="i-ri-arrow-left-s-line"
    label="返回"
    @click="back"
  />
</template>
