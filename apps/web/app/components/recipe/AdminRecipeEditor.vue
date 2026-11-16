<script lang="ts" setup>
import type { RecipeDictionary, RecipeItem } from '@yunyoujun/cook'
import type { StuffItem } from '~/types'
import { cleanBv, validateRecipes } from '@yunyoujun/cook'
import { uniqueStuff } from '@yunyoujun/cook/recommend'
import { tools as foodTools, meat, staple, vegetable } from '~/data/food'
import { yunleHaptic } from '~/utils/yunleHost'

/**
 * 官方菜谱编辑：只改 recipe.csv 里的 9 列，不做文字步骤正文的在线编辑。
 * 提交前用和 `pnpm validate` 同一套规则做本地校验，错误就地提示，不发请求。
 */
const props = defineProps<{
  recipe: RecipeItem | null
  open: boolean
  saving: boolean
  modified: boolean
}>()

const emit = defineEmits<{
  save: [recipe: RecipeItem]
  revert: []
  cancel: []
}>()

const NAME_MAX = 60

/** recipe.csv 里出现过的 24 种做法 */
const METHODS = [
  '煲',
  '焖',
  '煮',
  '烤',
  '烧',
  '卤',
  '炖',
  '炒',
  '炸',
  '烘',
  '微波加热',
  '凉拌',
  '灼',
  '蒸',
  '煎',
  '焗',
  '拌',
  '腌',
  '盖浇',
  '泡菜',
  '烙',
  '油泼',
  '腌制',
  '汆',
]

const DIFFICULTY_OPTIONS = [
  { value: '', label: '未标注' },
  { value: '简单', label: '简单' },
  { value: '普通', label: '普通' },
  { value: '困难', label: '困难' },
] as const

const { sections, food } = usePersonalCatalog()
const toolOptions = computed(() => food.value.tools)

const dict: RecipeDictionary = {
  stuff: new Set([...vegetable, ...meat, ...staple].map(item => item.name)),
  tools: new Set(foodTools.map(item => item.name)),
}

const name = ref('')
const stuff = ref<string[]>([])
const selectedTools = ref<string[]>([])
const selectedMethods = ref<string[]>([])
const difficulty = ref<RecipeItem['difficulty']>('')
const tagText = ref('')
const bv = ref('')
const link = ref('')
const errors = ref<string[]>([])

const methodOptions = computed(() => [
  ...METHODS,
  ...selectedMethods.value.filter(method => !METHODS.includes(method)),
])
const extraTools = computed(() => selectedTools.value.filter(item => !toolOptions.value.some(tool => tool.name === item)))

function parseList(text: string) {
  return [...new Set(text.split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean))]
}

function fill(recipe: RecipeItem | null) {
  name.value = recipe?.name ?? ''
  stuff.value = recipe ? uniqueStuff(recipe.stuff) : []
  selectedTools.value = recipe ? [...recipe.tools] : []
  selectedMethods.value = recipe ? [...(recipe.methods ?? [])] : []
  difficulty.value = recipe?.difficulty ?? ''
  tagText.value = recipe?.tags?.join('、') ?? ''
  bv.value = recipe?.bv ?? ''
  link.value = recipe?.link ?? ''
  errors.value = []
}

watch(() => props.recipe, fill, { immediate: true })

function selectedNote(items: StuffItem[]) {
  const count = items.filter(item => stuff.value.includes(item.name)).length
  return count ? `已选 ${count} 种` : ''
}

function addStuff(text: string) {
  stuff.value = uniqueStuff([...stuff.value, text])
  errors.value = []
}

function toggleStuff(item: string) {
  stuff.value = stuff.value.includes(item)
    ? stuff.value.filter(name => name !== item)
    : uniqueStuff([...stuff.value, item])
  errors.value = []
  void yunleHaptic('light')
}

function toggleTool(item: string) {
  selectedTools.value = selectedTools.value.includes(item)
    ? selectedTools.value.filter(name => name !== item)
    : [...selectedTools.value, item]
  void yunleHaptic('light')
}

function toggleMethod(item: string) {
  selectedMethods.value = selectedMethods.value.includes(item)
    ? selectedMethods.value.filter(name => name !== item)
    : [...selectedMethods.value, item]
  void yunleHaptic('light')
}

function buildRecipe(): RecipeItem | null {
  const recipe = props.recipe
  if (!recipe || typeof recipe.id !== 'number')
    return null
  return {
    id: recipe.id,
    name: name.value.trim(),
    stuff: uniqueStuff(stuff.value),
    tools: [...selectedTools.value],
    methods: [...selectedMethods.value],
    difficulty: difficulty.value || '',
    tags: parseList(tagText.value),
    bv: cleanBv(bv.value) ?? '',
    link: link.value.trim(),
  }
}

function submit() {
  const recipe = buildRecipe()
  if (!recipe)
    return

  const messages: string[] = []
  if (!recipe.name)
    messages.push('菜名不能为空')
  else if ([...recipe.name].length > NAME_MAX)
    messages.push(`菜名不能超过 ${NAME_MAX} 个字`)

  const validation = validateRecipes([recipe], dict)
  messages.push(...validation.issues.filter(issue => issue.level === 'error').map(issue => issue.message))

  errors.value = [...new Set(messages)]
  if (errors.value.length) {
    void yunleHaptic('heavy')
    return
  }
  emit('save', recipe)
}

function cancel() {
  emit('cancel')
}
</script>

<template>
  <ion-modal :is-open="open" @did-dismiss="cancel">
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-button :disabled="saving" @click="cancel">
            取消
          </ion-button>
        </ion-buttons>
        <ion-title>
          编辑菜谱
        </ion-title>
        <ion-buttons slot="end">
          <ion-button :strong="true" :disabled="saving" @click="submit">
            {{ saving ? '保存中…' : '保存' }}
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content :fullscreen="true">
      <ion-list :inset="true">
        <ion-item>
          <ion-input
            v-model="name"
            label="菜名"
            placeholder="例如：番茄炒蛋"
            :maxlength="NAME_MAX"
            :clear-input="true"
            @ion-input="errors = []"
          />
        </ion-item>
        <ion-item>
          <ion-input :value="String(recipe?.id ?? '')" label="id（只读）" readonly />
        </ion-item>
      </ion-list>

      <h2 class="cook-group-header">
        食材 · {{ stuff.length }} 种
      </h2>
      <IngredientInput :selected="stuff" @add="addStuff" @remove="toggleStuff" />
      <IngredientSection
        v-for="section in sections"
        :key="section.title"
        :title="section.title"
        :note="selectedNote(section.items)"
      >
        <IngredientChip
          v-for="item in section.items"
          :key="item.name"
          :label="item.name"
          :emoji="item.emoji"
          :selected="stuff.includes(item.name)"
          @click="toggleStuff(item.name)"
        />
      </IngredientSection>

      <IngredientSection title="厨具">
        <IngredientChip
          v-for="item in toolOptions"
          :key="item.name"
          :label="item.name === '一口大锅' ? '炒锅' : (item.label || item.name)"
          :icon="item.icon"
          :selected="selectedTools.includes(item.name)"
          @click="toggleTool(item.name)"
        />
        <IngredientChip
          v-for="item in extraTools"
          :key="item"
          :label="item"
          :selected="true"
          @click="toggleTool(item)"
        />
      </IngredientSection>

      <IngredientSection title="做法">
        <IngredientChip
          v-for="item in methodOptions"
          :key="item"
          :label="item"
          :selected="selectedMethods.includes(item)"
          @click="toggleMethod(item)"
        />
      </IngredientSection>

      <ion-list :inset="true" class="admin-editor-fields">
        <ion-item>
          <ion-select v-model="difficulty" label="难度" interface="popover">
            <ion-select-option v-for="option in DIFFICULTY_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </ion-select-option>
          </ion-select>
        </ion-item>
        <ion-item>
          <ion-input
            v-model="tagText"
            label="标签"
            placeholder="用顿号分隔，如：下饭、快手菜"
            :clear-input="true"
            @ion-input="errors = []"
          />
        </ion-item>
        <ion-item>
          <ion-input
            v-model="bv"
            label="视频号"
            placeholder="BV 号或 av 号，可留空"
            :clear-input="true"
            @ion-input="errors = []"
          />
        </ion-item>
        <ion-item>
          <ion-input
            v-model="link"
            label="图文链接"
            placeholder="https:// 开头，可留空"
            inputmode="url"
            :clear-input="true"
            @ion-input="errors = []"
          />
        </ion-item>
      </ion-list>

      <ul v-if="errors.length" class="admin-editor-errors" role="alert">
        <li v-for="message in errors" :key="message">
          {{ message }}
        </li>
      </ul>

      <p class="cook-group-footer">
        修改会立即对所有访客生效。「导出补丁 CSV」可以把改动合回 recipe.csv 永久固化。
      </p>

      <ion-list v-if="modified" :inset="true" class="admin-editor-revert">
        <ion-item :button="true" :detail="false" :disabled="saving" @click="emit('revert')">
          <ion-label class="ion-text-center" color="danger">
            撤销修改，回到官方版本
          </ion-label>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-modal>
</template>

<style scoped>
.admin-editor-fields {
  margin-top: 20px;
}
.admin-editor-errors {
  margin: 12px 32px 0;
  padding: 12px 16px 12px 32px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--c-alert) 10%, transparent);
  color: var(--c-alert);
  font-size: var(--fs-sm);
  line-height: 1.7;
}
.admin-editor-revert {
  margin-bottom: 40px;
}
</style>
