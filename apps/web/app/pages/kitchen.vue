<script setup lang="ts">
import type { CatalogCategory } from '@yunyoujun/cook/personal-catalog'
import pantryData from '@cook/data/pantry.json'
import { uniqueStuff } from '@yunyoujun/cook/recommend'
import { useKitchenStore } from '~/composables/store/kitchen'
import { catalogTitles } from '~/composables/usePersonalCatalog'
import * as base from '~/data/food'

definePageMeta({ layout: 'child' })

const kitchen = useKitchenStore()
const catalog = usePersonalCatalog()
type Editor = 'ingredients' | 'tools' | 'pantry'
const editor = ref<Editor | null>(null)
const query = ref('')
const draft = ref<string[]>([])
const category = ref<CatalogCategory>('vegetable')
const error = ref('')
const notice = ref('')
const titles = { ingredients: '添加食材', tools: '选择厨具', pantry: '确认常备调料' }
const ingredientEmoji = computed(() => new Map(catalog.ingredients.value.map(item => [item.name, item.emoji])))
const toolOptions = computed(() => [...new Set([...catalog.food.value.tools.map(item => item.name), ...kitchen.tools])])
const pantryOptions = computed(() => [...new Set([...pantryData.options, ...kitchen.pantry])])
const options = computed(() => {
  if (editor.value === 'tools')
    return toolOptions.value.map(name => ({ name, emoji: '🍳' }))
  if (editor.value === 'pantry')
    return pantryOptions.value.map(name => ({ name, emoji: '' }))
  return catalog.ingredients.value.filter(item => !kitchen.ingredients.includes(item.name))
})
const matches = computed(() => options.value.filter(item => item.name.includes(query.value.trim())))
const canCreate = computed(() => {
  const entered = query.value.trim()
  const alreadyOwned = editor.value === 'ingredients' && kitchen.ingredients.includes(uniqueStuff([entered])[0] || entered)
  return editor.value !== 'pantry' && !!entered && !matches.value.length && !alreadyOwned
})

function startEditing(mode: Editor) {
  editor.value = mode
  query.value = ''
  error.value = ''
  category.value = mode === 'tools' ? 'tools' : 'vegetable'
  draft.value = mode === 'ingredients' ? [] : [...kitchen[mode]]
}
function toggle(name: string) {
  draft.value = draft.value.includes(name) ? draft.value.filter(item => item !== name) : [...draft.value, name]
}
function saveSelection(names = draft.value) {
  try {
    if (editor.value === 'ingredients')
      kitchen.addIngredients(names)
    else if (editor.value === 'tools')
      kitchen.setTools(names)
    else if (editor.value === 'pantry')
      kitchen.setPantry(names)
    notice.value = editor.value === 'ingredients' ? `已加入 ${names.length} 种食材` : '已保存厨房清单'
    editor.value = null
    error.value = ''
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试。'
  }
}
function removeIngredient(name: string) {
  try {
    kitchen.removeIngredient(name)
    error.value = ''
    notice.value = `已将${name}标记为用完`
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败，请重试。'
  }
}
function createAndAdd() {
  const group = editor.value === 'tools' ? 'tools' : category.value
  const entered = query.value.trim()
  const name = group === 'tools' ? entered : (uniqueStuff([entered])[0] || '')
  if (!name)
    return
  try {
    // 已隐藏的内置条目仍可加入库存，不擅自恢复其目录可见性。
    const exists = group === 'tools'
      ? [...base.tools, ...catalog.value.value.items.filter(item => item.category === 'tools')].some(item => item.name === name)
      : [...base.vegetable, ...base.meat, ...base.staple, ...catalog.value.value.items.filter(item => item.category !== 'tools')].some(item => item.name === name)
    if (!exists)
      catalog.update(current => ({ ...current, items: [...current.items, { category: group, name }] }))
    saveSelection([...new Set([...draft.value, name])])
  }
  catch (e) {
    error.value = e instanceof Error ? e.message : '新增失败，未加入厨房，请重试。'
  }
}
</script>

<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/my" />
        </ion-buttons>
        <ion-title>我的厨房</ion-title>
        <ion-buttons slot="end">
          <ion-button router-link="/catalog" aria-label="前往条目管理">
            条目管理
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content :fullscreen="true">
      <main class="kitchen-page">
        <header class="kitchen-intro">
          <p class="kitchen-eyebrow">
            KITCHEN NOTES
          </p>
          <h1>记下家里有什么</h1>
          <p>食材用完就移出，厨具和常备调料随时更新。这里只记清单，不记录数量与保质期。</p>
        </header>
        <p v-if="!kitchen.initialized && !kitchen.ingredients.length" class="kitchen-welcome">
          从刚买回来的食材开始，慢慢整理你的厨房。
        </p>
        <p v-if="error && !editor" class="kitchen-error" role="alert">
          {{ error }}
        </p>
        <p class="kitchen-notice" role="status" aria-live="polite">
          {{ notice }}
        </p>

        <section class="kitchen-section" aria-labelledby="ingredients-title">
          <div class="kitchen-section-heading">
            <h2 id="ingredients-title">
              现有食材 <span>{{ kitchen.ingredients.length }}</span>
            </h2>
            <button class="kitchen-action kitchen-primary" type="button" @click="startEditing('ingredients')">
              添加食材
            </button>
          </div>
          <p class="kitchen-hint">
            已在厨房的食材不会因目录隐藏或删除而消失。
          </p>
          <ul v-if="kitchen.ingredients.length" class="kitchen-stock">
            <li v-for="name in kitchen.ingredients" :key="name">
              <span class="kitchen-stock-name"><span class="kitchen-emoji" aria-hidden="true">{{ ingredientEmoji.get(name) || '🥬' }}</span>{{ name }}</span>
              <button type="button" class="kitchen-action" :aria-label="`${name}用完了，移出厨房`" @click="removeIngredient(name)">
                用完了
              </button>
            </li>
          </ul>
          <div v-else class="kitchen-empty">
            <span class="kitchen-empty-icon" aria-hidden="true">🥬</span>
            <h3>厨房里还没有食材</h3>
            <p>一次选好几样，把今天买的菜记下来。</p>
            <button type="button" class="kitchen-action" @click="startEditing('ingredients')">
              挑选食材
            </button>
          </div>
        </section>

        <div class="kitchen-secondary">
          <section class="kitchen-section" aria-labelledby="tools-title">
            <div class="kitchen-section-heading">
              <h2 id="tools-title">
                我的厨具 <span>{{ kitchen.tools.length }}</span>
              </h2>
              <button type="button" class="kitchen-action" @click="startEditing('tools')">
                选择厨具
              </button>
            </div>
            <ul v-if="kitchen.tools.length" class="kitchen-summary">
              <li v-for="name in kitchen.tools" :key="name">
                {{ name }}
              </li>
            </ul>
            <p v-else class="kitchen-hint">
              还没记录厨具。炒锅、电饭煲……把家里有的都选上。
            </p>
          </section>
          <section class="kitchen-section" aria-labelledby="pantry-title">
            <div class="kitchen-section-heading">
              <h2 id="pantry-title">
                常备调料 <span>{{ kitchen.pantry.length }}</span>
              </h2>
              <button type="button" class="kitchen-action" @click="startEditing('pantry')">
                确认调料
              </button>
            </div>
            <ul v-if="kitchen.pantry.length" class="kitchen-summary">
              <li v-for="name in kitchen.pantry" :key="name">
                {{ name }}
              </li>
            </ul>
            <p v-else class="kitchen-hint">
              还没确认常备调料，只勾选家里确实有的。
            </p>
          </section>
        </div>
        <footer class="kitchen-footer">
          <p>想添加自定义条目，或隐藏不常用的选项？</p>
          <ion-button fill="clear" router-link="/catalog">
            前往条目管理 →
          </ion-button>
        </footer>
      </main>
    </ion-content>

    <ion-modal :is-open="editor !== null" @did-dismiss="editor = null">
      <ion-header>
        <ion-toolbar>
          <ion-buttons slot="start">
            <ion-button @click="editor = null">
              取消
            </ion-button>
          </ion-buttons>
          <ion-title>
            {{ editor ? titles[editor] : '' }}
          </ion-title>
          <ion-buttons slot="end">
            <ion-button :disabled="editor === 'ingredients' && !draft.length" @click="saveSelection()">
              {{ editor === 'ingredients' ? `加入厨房 (${draft.length})` : '保存' }}
            </ion-button>
          </ion-buttons>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <div class="kitchen-picker">
          <p class="kitchen-hint">
            {{ editor === 'ingredients' ? '可多选，确认后一起加入厨房。' : '可多选，取消勾选即可移出；保存后生效。' }}
          </p>
          <label class="kitchen-search-label" for="kitchen-search">
            {{ editor === 'pantry' ? '搜索调料' : '搜索条目' }}
          </label>
          <input id="kitchen-search" v-model="query" class="kitchen-search" type="search" :placeholder="editor === 'tools' ? '搜索厨具名称' : editor === 'pantry' ? '搜索调料名称' : '搜索食材名称'">
          <p v-if="catalog.error.value" class="kitchen-error" role="alert">
            {{ catalog.error.value }}
            <button class="kitchen-action" type="button" @click="catalog.refresh">
              重试读取
            </button>
          </p>
          <p v-if="error" class="kitchen-error" role="alert">
            {{ error }}
          </p>
          <div v-if="matches.length" class="kitchen-choices" aria-label="可多选条目">
            <button v-for="item in matches" :key="item.name" type="button" class="kitchen-choice" :aria-pressed="draft.includes(item.name)" @click="toggle(item.name)">
              <span aria-hidden="true">{{ draft.includes(item.name) ? '✓' : item.emoji }}</span>{{ item.name }}
            </button>
          </div>
          <p v-else class="kitchen-hint">
            {{ query.trim() ? `没有找到「${query.trim()}」。` : editor === 'ingredients' ? '目录中的食材都已加入厨房。' : '暂无可选条目。' }}
          </p>
          <div v-if="canCreate" class="kitchen-create">
            <p>新增条目并加入厨房，也会保留本次已选条目。</p>
            <label v-if="editor === 'ingredients'" class="kitchen-category">条目分类
              <select v-model="category">
                <option v-for="group in (['vegetable', 'meat', 'staple'] as const)" :key="group" :value="group">
                  {{ catalogTitles[group] }}
                </option>
              </select>
            </label>
            <button class="kitchen-action kitchen-primary" type="button" :disabled="!!catalog.error.value" @click="createAndAdd">
              新增「{{ query.trim() }}」并加入厨房
            </button>
          </div>
          <p v-if="draft.length" class="kitchen-hint">
            已选 {{ draft.length }} 项{{ query.trim() ? '（包括搜索范围外的选择）' : '' }}
          </p>
          <ion-button fill="clear" router-link="/catalog" @click="editor = null">
            去条目管理整理目录 →
          </ion-button>
        </div>
      </ion-content>
    </ion-modal>
  </ion-page>
</template>

<style scoped>
.kitchen-page {
  max-width: 960px;
  margin: 0 auto;
  padding: var(--sp-6) var(--sp-4) var(--sp-8);
  color: var(--c-ink);
  line-height: 1.6;
}
.kitchen-intro h1 {
  margin: var(--sp-2) 0 var(--sp-3);
  font-size: var(--fs-xl);
  font-weight: 600;
  line-height: 1.25;
}
.kitchen-intro > p:last-child,
.kitchen-hint,
.kitchen-footer,
.kitchen-empty p {
  color: var(--c-ink-2);
  font-size: var(--fs-base);
}
.kitchen-eyebrow {
  font-family: var(--font-display);
  font-size: var(--fs-sm);
  letter-spacing: 0.12em;
  color: var(--c-brand-ink);
}
.kitchen-welcome {
  padding: var(--sp-4);
  background: var(--c-herb-wash);
  color: var(--c-herb);
  border-radius: var(--r-md);
}
.kitchen-notice {
  min-height: 24px;
  margin-block: var(--sp-3);
  color: var(--c-herb);
}
.kitchen-error {
  color: var(--c-alert);
  overflow-wrap: anywhere;
}
.kitchen-section {
  padding-block: var(--sp-5);
  border-top: 1px solid var(--c-rule);
}
.kitchen-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
}
.kitchen-section h2 {
  margin: 0;
  font-size: var(--fs-lg);
  font-weight: 600;
}
.kitchen-section h2 span {
  margin-left: var(--sp-2);
  font-family: var(--font-display);
  font-size: var(--fs-xl);
  color: var(--c-ink-3);
}
.kitchen-action {
  min-height: 44px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-brand-ink);
  font: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.kitchen-primary {
  border-color: var(--c-brand);
  background: var(--c-brand);
  color: var(--c-brand-contrast);
}
.kitchen-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.kitchen-stock,
.kitchen-summary {
  padding: 0;
  list-style: none;
}
.kitchen-stock {
  display: grid;
  gap: var(--sp-2);
}
.kitchen-stock li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--sp-3);
  padding: var(--sp-2) 0;
  border-bottom: 1px solid var(--c-rule);
}
.kitchen-stock-name {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  min-width: 0;
  overflow-wrap: anywhere;
}
.kitchen-stock .kitchen-action {
  flex-shrink: 0;
}
.kitchen-emoji {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: var(--r-pill);
  background: var(--c-emoji-wash);
  font-size: var(--fs-xl);
}
.kitchen-empty {
  padding: var(--sp-6) var(--sp-3);
  text-align: center;
  background: var(--c-paper-alt);
  border-radius: var(--r-lg);
}
.kitchen-empty-icon {
  font-size: var(--fs-3xl);
}
.kitchen-empty h3 {
  margin-top: var(--sp-2);
  font-size: var(--fs-md);
  font-weight: 600;
}
.kitchen-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.kitchen-summary li {
  padding: var(--sp-2) var(--sp-3);
  border-radius: var(--r-sm);
  background: var(--c-paper-sunk);
  overflow-wrap: anywhere;
  max-width: 100%;
}
.kitchen-footer {
  border-top: 1px solid var(--c-rule);
  padding-top: var(--sp-4);
}
.kitchen-picker {
  padding: var(--sp-4);
  color: var(--c-ink);
  line-height: 1.6;
}
.kitchen-search-label {
  display: block;
  margin-bottom: var(--sp-2);
}
.kitchen-search {
  width: 100%;
  min-height: 48px;
  margin-bottom: var(--sp-5);
  padding: var(--sp-3);
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-paper-sunk);
  color: var(--c-ink);
  font: inherit;
}
.kitchen-choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
}
.kitchen-choice {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
  max-width: 100%;
  min-height: 44px;
  padding: var(--sp-2) var(--sp-3);
  border: 1px solid var(--c-rule);
  border-radius: var(--r-md);
  background: var(--c-surface);
  color: var(--c-ink);
  font: inherit;
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.kitchen-choice[aria-pressed='true'] {
  border-color: var(--c-brand);
  background: var(--c-brand);
  color: var(--c-brand-contrast);
}
.kitchen-create {
  padding: var(--sp-4);
  background: var(--c-paper-alt);
  border-radius: var(--r-md);
}
.kitchen-category {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.kitchen-category select {
  min-height: 44px;
  padding: var(--sp-2);
  border: 1px solid var(--c-rule);
  border-radius: var(--r-sm);
  background: var(--c-surface);
  color: var(--c-ink);
}
:is(button, input, select):focus-visible {
  outline: 2px solid var(--c-brand-ink);
  outline-offset: 2px;
}
@media (min-width: 768px) {
  .kitchen-page {
    padding: var(--sp-7);
  }
  .kitchen-secondary {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-7);
  }
}
</style>
