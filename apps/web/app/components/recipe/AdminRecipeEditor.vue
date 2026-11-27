<script lang="ts" setup>
import type { RecipeDictionary, RecipeItem, RecipeTextBlock } from '@yunyoujun/cook'
import { cleanBv, validateRecipes } from '@yunyoujun/cook'
import { uniqueStuff } from '@yunyoujun/cook/recommend'
import { tools as foodTools, meat, staple, vegetable } from '~/data/food'
import { resolveNoteForSave } from '~/utils/recipeNote'
import { yunleHaptic } from '~/utils/yunleHost'

/**
 * 官方菜谱编辑：改 recipe.csv 里的字段；官方步骤默认只读预览，
 * 点「编辑步骤」后写入覆盖层的 note，清空则回退到 recipe-text.json。
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
const NOTE_MAX = 20_000
/** 服务端 RECIPE_OVERRIDE_LIMIT：非投稿菜谱的单条覆盖数据上限 */
const OVERRIDE_LIMIT_BYTES = 8 * 1024

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

const { food } = usePersonalCatalog()
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

/** 投稿发布的菜谱 id 从高位段开始；它们的步骤在 note 里，可以直接编辑。 */
const PUBLISHED_ID_BASE = 10000
const isPublishedRecipe = computed(() => {
  const id = props.recipe?.id
  return typeof id === 'number' && id >= PUBLISHED_ID_BASE
})

type OfficialStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
type StepsMode = 'readonly' | 'editing'

const note = ref('')
const officialSteps = shallowRef<RecipeTextBlock[]>([])
const officialStatus = ref<OfficialStatus>('idle')
const officialError = ref('')
const stepsMode = ref<StepsMode>('readonly')
let stepRequest = 0

const hasExistingNote = computed(() => Boolean(props.recipe?.note?.trim()))
const officialText = computed(() => stepsToPlainText(officialSteps.value))
const showNoteEditor = computed(() => isPublishedRecipe.value || stepsMode.value === 'editing')
const noteLength = computed(() => [...note.value].length)
const overrideBytes = computed(() => {
  const recipe = buildRecipe()
  return recipe ? new TextEncoder().encode(JSON.stringify(recipe)).length : 0
})

const methodOptions = computed(() => [
  ...METHODS,
  ...selectedMethods.value.filter(method => !METHODS.includes(method)),
])
const extraTools = computed(() => selectedTools.value.filter(item => !toolOptions.value.some(tool => tool.name === item)))

function parseList(text: string) {
  return [...new Set(text.split(/[,，、;；\n]/).map(item => item.trim()).filter(Boolean))]
}

function fill() {
  const recipe = props.recipe
  name.value = recipe?.name ?? ''
  stuff.value = recipe ? uniqueStuff(recipe.stuff) : []
  selectedTools.value = recipe ? [...recipe.tools] : []
  selectedMethods.value = recipe ? [...(recipe.methods ?? [])] : []
  difficulty.value = recipe?.difficulty ?? ''
  tagText.value = recipe?.tags?.join('、') ?? ''
  bv.value = recipe?.bv ?? ''
  link.value = recipe?.link ?? ''
  note.value = recipe?.note ?? ''
  errors.value = []

  // 切换菜谱时让上一道菜的异步加载结果失效
  stepRequest++
  officialSteps.value = []
  officialStatus.value = 'idle'
  officialError.value = ''

  if (!props.open || !recipe) {
    stepsMode.value = 'readonly'
    return
  }
  if (isPublishedRecipe.value || note.value.trim()) {
    // 投稿发布或已经覆盖过步骤：直接编辑 note
    stepsMode.value = 'editing'
    return
  }
  stepsMode.value = 'readonly'
  void loadOfficialSteps()
}

watch([() => props.recipe, () => props.open], fill, { immediate: true })

async function loadOfficialSteps() {
  const id = props.recipe?.id
  if (!props.open || typeof id !== 'number' || id >= PUBLISHED_ID_BASE)
    return
  const request = ++stepRequest
  officialStatus.value = 'loading'
  officialError.value = ''
  try {
    await loadRecipeTexts()
    if (request !== stepRequest)
      return
    officialSteps.value = extractRecipeSteps(findRecipeText(id))
    officialStatus.value = officialSteps.value.length ? 'ready' : 'empty'
  }
  catch {
    if (request !== stepRequest)
      return
    officialStatus.value = 'error'
    officialError.value = '收录步骤加载失败，可以重试或直接手动填写。'
  }
}

function startEditingSteps() {
  if (officialStatus.value === 'loading')
    return
  note.value = officialText.value
  stepsMode.value = 'editing'
}

function cancelEditingSteps() {
  note.value = props.recipe?.note ?? ''
  stepsMode.value = 'readonly'
}

function restoreOfficialSteps() {
  note.value = ''
  stepsMode.value = 'readonly'
  if (officialStatus.value === 'idle' || officialStatus.value === 'error')
    void loadOfficialSteps()
}

function retryOfficialSteps() {
  void loadOfficialSteps()
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
  const resolvedNote = resolveNoteForSave({
    note: note.value,
    officialText: officialText.value,
    isPublished: isPublishedRecipe.value,
  })
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
    ...(resolvedNote ? { note: resolvedNote } : {}),
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
  if (noteLength.value > NOTE_MAX)
    messages.push(`步骤不能超过 ${NOTE_MAX} 个字`)
  if (!isPublishedRecipe.value && note.value.trim() && overrideBytes.value > OVERRIDE_LIMIT_BYTES)
    messages.push(`步骤太长，单条覆盖数据不能超过 8 KB（当前约 ${Math.ceil(overrideBytes.value / 1024)} KB），请精简后再保存`)

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
      <RecipeIngredientPicker
        :key="recipe?.id ?? 'new'"
        :selected="stuff"
        @add="addStuff"
        @toggle="toggleStuff"
      />

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

      <ion-list :inset="true">
        <template v-if="showNoteEditor">
          <ion-item>
            <ion-textarea
              v-model="note"
              label="步骤"
              label-placement="stacked"
              placeholder="每行一步，例如：1. 锅中倒油烧热"
              :maxlength="NOTE_MAX"
              :auto-grow="true"
              :rows="8"
              @ion-input="errors = []"
            />
          </ion-item>
          <ion-item lines="none">
            <ion-label class="admin-editor-note-meta">
              <p v-if="!isPublishedRecipe">
                清空并保存会恢复收录的图文步骤。
              </p>
              <p>
                {{ noteLength }} / {{ NOTE_MAX }} 字<template v-if="!isPublishedRecipe">
                  · 约 {{ Math.ceil(overrideBytes / 1024) }} KB / 8 KB
                </template>
              </p>
            </ion-label>
          </ion-item>
          <ion-item v-if="!isPublishedRecipe && hasExistingNote" :button="true" :detail="false" @click="restoreOfficialSteps">
            <ion-label color="medium" class="ion-text-center">
              恢复官方步骤
            </ion-label>
          </ion-item>
          <ion-item v-else-if="!isPublishedRecipe" :button="true" :detail="false" @click="cancelEditingSteps">
            <ion-label color="medium" class="ion-text-center">
              取消编辑
            </ion-label>
          </ion-item>
        </template>

        <template v-else>
          <ion-item v-if="officialStatus === 'loading'">
            <ion-label class="admin-editor-note-hint" role="status">
              <p>正在加载收录的步骤…</p>
            </ion-label>
          </ion-item>
          <ion-item v-else-if="officialStatus === 'error'">
            <ion-label class="admin-editor-note-hint" role="alert">
              <p>{{ officialError }}</p>
            </ion-label>
          </ion-item>
          <ion-item v-else-if="officialStatus === 'ready'">
            <ion-label class="admin-editor-note-preview">
              <p>{{ officialText }}</p>
            </ion-label>
          </ion-item>
          <ion-item v-else>
            <ion-label class="admin-editor-note-hint">
              <p>这道菜没有收录的图文步骤，可以手动填写。</p>
            </ion-label>
          </ion-item>
          <ion-item
            :button="officialStatus !== 'loading'"
            :detail="false"
            :disabled="officialStatus === 'loading'"
            @click="startEditingSteps"
          >
            <ion-label color="primary" class="ion-text-center">
              {{ officialStatus === 'ready' ? '编辑步骤' : '手动编写步骤' }}
            </ion-label>
          </ion-item>
          <ion-item v-if="officialStatus === 'error'" :button="true" :detail="false" @click="retryOfficialSteps">
            <ion-label color="medium" class="ion-text-center">
              重试加载
            </ion-label>
          </ion-item>
        </template>
      </ion-list>

      <ul v-if="errors.length" class="admin-editor-errors" role="alert">
        <li v-for="message in errors" :key="message">
          {{ message }}
        </li>
      </ul>

      <p class="cook-group-footer">
        修改会立即对所有访客生效。「导出补丁 CSV」可以把改动合回 recipe.csv 永久固化；步骤改动只保存在覆盖层。
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
.admin-editor-note-hint p,
.admin-editor-note-meta p {
  margin: 0;
  color: var(--c-ink-3);
  font-size: var(--fs-sm);
  line-height: 1.6;
  white-space: normal;
}
.admin-editor-note-preview p {
  margin: 0;
  color: var(--c-ink);
  font-size: var(--fs-sm);
  line-height: 1.8;
  white-space: pre-wrap;
}
.admin-editor-revert {
  margin-bottom: 40px;
}
</style>
