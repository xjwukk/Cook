import type { RecipeMatch, RecommendationOptions } from '@yunyoujun/cook/recommend'
import type { RecipeItem } from '~/types'
import { createRecipeRecommender, uniqueStuff } from '@yunyoujun/cook/recommend'
import { favoriteEntries } from '~/composables/store/favorite'
import { recipeHistories } from '~/composables/store/history'
import { useKitchenStore } from '~/composables/store/kitchen'
import { useRecipeStore } from '~/composables/store/recipe'
import { applyRecipeOverrides } from '~/composables/useRecipeOverrides'
import { trackCookEvent } from '~/utils/analytics'
import { db } from '~/utils/db'

/** 单轮送入模型的最大候选数，与服务端 COOK_AI_MAX_CANDIDATES 对齐 */
const MAX_CANDIDATES = 50
const MIN_CANDIDATES = 20
const HISTORY_TURNS = 6

export interface AssistantPick {
  id: number
  why: string
}

export interface AssistantAnswer {
  picked: AssistantPick[]
  answer: string[]
  needs: string[]
  followups: string[]
}

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
  answer?: AssistantAnswer
  matches?: RecipeMatch[]
  error?: boolean
}

interface CandidateRecipe {
  id: number
  name: string
  stuff: string[]
  matched: string[]
  missing: string[]
  tools: string[]
  methods: string[]
  difficulty: string
  tags: string[]
}

function toCandidate(match: RecipeMatch): CandidateRecipe {
  const { recipe } = match
  return {
    id: Number(recipe.id),
    name: recipe.name,
    stuff: uniqueStuff(recipe.stuff ?? []),
    matched: match.matchedStuff,
    missing: match.missingStuff,
    tools: recipe.tools ?? [],
    methods: recipe.methods ?? [],
    difficulty: recipe.difficulty ?? '',
    tags: recipe.tags ?? [],
  }
}

/** 宽口径候选池：先按食材推荐，不足时用浏览列表与菜名补足。 */
export function buildCandidatePool(
  options: RecommendationOptions,
  eligible: RecipeItem[],
): RecipeMatch[] {
  const recommend = createRecipeRecommender(eligible)
  const matches = recommend(options)

  if (matches.length >= MIN_CANDIDATES)
    return matches.slice(0, MAX_CANDIDATES)

  // 补足：优先同厨具/同做法的菜，再按质量分与原始顺序。
  const seen = new Set(matches.map(match => match.recipe.id))
  const fillers = eligible
    .filter(recipe => recipe.id != null && !seen.has(recipe.id))
    .filter(recipe => !options.tool || recipe.tools?.includes(options.tool))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MIN_CANDIDATES - matches.length)
    .map((recipe, index) => ({
      recipe,
      sourceIndex: index,
      requiredStuff: uniqueStuff(recipe.stuff ?? []),
      matchedStuff: [],
      pantryStuff: [],
      missingStuff: uniqueStuff(recipe.stuff ?? []),
      optionalStuff: [],
    }))

  return [...matches, ...fillers].slice(0, MAX_CANDIDATES)
}

export const useAssistant = createSharedComposable(() => {
  const rStore = useRecipeStore()
  const kitchen = useKitchenStore()
  const account = useAccount()

  const messages = ref<AssistantMessage[]>([])
  const status = ref<'idle' | 'sending' | 'error'>('idle')
  const errorMessage = ref('')
  const enabled = ref(false)
  const modelName = ref('')
  const checking = ref(true)

  async function refreshStatus(): Promise<void> {
    checking.value = true
    try {
      const response = await fetch('/api/assistant/status', { credentials: 'same-origin' })
      const body = await response.json()
      enabled.value = Boolean(body.enabled)
      modelName.value = body.model || ''
    }
    catch {
      enabled.value = false
      modelName.value = ''
    }
    finally {
      checking.value = false
    }
  }

  function recentHistory(): { role: 'user' | 'assistant', content: string }[] {
    return messages.value
      .slice(-HISTORY_TURNS)
      .map(message => ({ role: message.role, content: message.content }))
  }

  async function favoriteNames(): Promise<string[]> {
    if (!favoriteEntries.value.length)
      return []
    const ids = new Set(favoriteEntries.value.map(entry => entry.id))
    const recipes = applyRecipeOverrides(await db.recipes.toArray())
    return recipes.filter(recipe => recipe.id != null && ids.has(recipe.id)).map(recipe => recipe.name).slice(0, 30)
  }

  async function send(text: string): Promise<void> {
    const question = text.trim()
    if (!question || status.value === 'sending')
      return

    messages.value.push({ role: 'user', content: question })
    status.value = 'sending'
    errorMessage.value = ''
    trackCookEvent('ask_assistant')

    try {
      const query = rStore.parseText(question)
      const stuff = uniqueStuff([
        ...query.stuff,
        ...query.unknown,
        ...kitchen.ingredients,
        ...rStore.selectedStuff,
      ]).filter(item => !query.avoid.includes(item))

      const matches = buildCandidatePool({
        stuff,
        pantry: uniqueStuff([...kitchen.pantry, ...rStore.selectedPantry]),
        tool: query.tool || rStore.effectiveTool || undefined,
        mode: 'loose',
        avoid: uniqueStuff([...query.avoid, ...rStore.selectedAvoid]),
        methodGroups: uniqueStuff([...query.methodGroups, ...rStore.methodGroups]),
        noSpicy: query.noSpicy || rStore.noSpicy,
        difficulty: [...new Set([...query.difficulty, ...rStore.difficulty])],
      }, rStore.eligibleRecipes)

      const candidates = matches.map(toCandidate).filter(item => Number.isInteger(item.id))
      if (!candidates.length) {
        messages.value.push({
          role: 'assistant',
          content: '还没有能匹配的菜。先在「做菜」或「我的厨房」里加几样食材，再问我一次。',
          error: true,
        })
        status.value = 'error'
        return
      }

      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question,
          history: recentHistory(),
          inventory: {
            ingredients: kitchen.ingredients,
            tools: kitchen.tools,
            pantry: kitchen.pantry,
          },
          favorites: await favoriteNames(),
          historyRecipes: recipeHistories.value.map(item => item.recipe.name).slice(0, 20),
          candidates,
        }),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok)
        throw new Error(body?.error || '助手暂时不可用，请稍后重试')

      const answer = body as AssistantAnswer
      // 客户端再校验一次：只保留候选池里的菜谱。
      const byId = new Map(matches.map(match => [Number(match.recipe.id), match]))
      const pickedMatches = answer.picked
        .map(pick => byId.get(Number(pick.id)))
        .filter((match): match is RecipeMatch => Boolean(match))
      const fallback = pickedMatches.length ? pickedMatches : matches.slice(0, 3)

      messages.value.push({
        role: 'assistant',
        content: answer.answer.join('\n'),
        answer,
        matches: fallback,
      })
      status.value = 'idle'
      trackCookEvent('view_assistant_answer')
    }
    catch (error) {
      const message = error instanceof Error ? error.message : '助手暂时不可用，请稍后重试'
      errorMessage.value = message
      messages.value.push({ role: 'assistant', content: message, error: true })
      status.value = 'error'
    }
  }

  function reset(): void {
    messages.value = []
    status.value = 'idle'
    errorMessage.value = ''
  }

  return {
    messages,
    status,
    errorMessage,
    enabled: readonly(enabled),
    modelName: readonly(modelName),
    checking: readonly(checking),
    isAuthenticated: computed(() => account.isAuthenticated.value),
    refreshStatus,
    send,
    reset,
  }
})
