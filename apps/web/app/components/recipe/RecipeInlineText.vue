<script lang="ts" setup>
/**
 * 文字做法里的行内 Markdown：只处理加粗和 http(s) 外链，
 * 其余内容按纯文本渲染，不执行任何 HTML。
 */
const props = defineProps<{
  text: string
}>()

interface Segment {
  type: 'text' | 'strong' | 'link' | 'code'
  text: string
  href?: string
}

const INLINE_RE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g

const segments = computed<Segment[]>(() => {
  const result: Segment[] = []
  let last = 0
  for (const match of props.text.matchAll(INLINE_RE)) {
    const index = match.index ?? 0
    if (index > last)
      result.push({ type: 'text', text: props.text.slice(last, index) })
    const token = match[0]
    if (token.startsWith('**')) {
      result.push({ type: 'strong', text: token.slice(2, -2) })
    }
    else if (token.startsWith('`')) {
      result.push({ type: 'code', text: token.slice(1, -1) })
    }
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link?.[1] && link[2])
        result.push({ type: 'link', text: link[1], href: link[2] })
      else
        result.push({ type: 'text', text: token })
    }
    last = index + token.length
  }
  if (last < props.text.length)
    result.push({ type: 'text', text: props.text.slice(last) })
  return result
})
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <strong v-if="segment.type === 'strong'">{{ segment.text }}</strong>
    <a
      v-else-if="segment.type === 'link'"
      :href="segment.href"
      target="_blank"
      rel="noopener noreferrer"
    >{{ segment.text }}</a>
    <code v-else-if="segment.type === 'code'">{{ segment.text }}</code>
    <template v-else>
      {{ segment.text }}
    </template>
  </template>
</template>

<style scoped>
code {
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--cook-fill);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.92em;
}
</style>
