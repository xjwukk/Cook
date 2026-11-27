import type { CustomRecipe } from '~/utils/customRecipe'
import type { PublishPreview } from '~/utils/publishedRecipes'
import { applyServerSubmissions, publicationOf, setPublication } from '~/composables/store/recipePublications'
import { publishPayload } from '~/utils/publishedRecipes'

/** 投稿到全量菜谱：提交、查状态。 */
export const useRecipeSubmissions = createSharedComposable(() => {
  const submitting = ref(false)
  const errorMessage = ref('')

  async function submit(recipe: CustomRecipe, preview: PublishPreview): Promise<boolean> {
    if (preview.blocked) {
      errorMessage.value = '去掉这些食材后就没有可以匹配的食材了，请至少保留一样收录食材。'
      return false
    }
    submitting.value = true
    errorMessage.value = ''
    try {
      const response = await fetch('/api/recipes/submissions', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // customId 让服务端把投稿对回「我的菜谱」里的那一条，换设备也能显示状态。
        body: JSON.stringify({ ...publishPayload(preview), customId: recipe.customId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok)
        throw new Error(body?.error || `投稿失败（${response.status}）`)
      const submission = body.submission as { id: number, status: 'pending', submittedAt: number }
      setPublication(recipe.customId, {
        submissionId: submission.id,
        status: 'pending',
        submittedAt: submission.submittedAt,
      })
      return true
    }
    catch (error) {
      errorMessage.value = error instanceof Error ? error.message : '投稿失败，请稍后重试'
      return false
    }
    finally {
      submitting.value = false
    }
  }

  /** 只刷新本地已经提交过的那几条的状态，不覆盖别处的记录。 */
  async function refresh(): Promise<void> {
    try {
      const response = await fetch('/api/recipes/submissions/mine', { credentials: 'same-origin' })
      if (!response.ok)
        return
      const body = await response.json()
      if (Array.isArray(body.submissions))
        applyServerSubmissions(body.submissions)
    }
    catch {
      // 拉不到状态不影响本地使用，下次进页面再试。
    }
  }

  return {
    submitting: readonly(submitting),
    errorMessage: readonly(errorMessage),
    submit,
    refresh,
    publicationOf,
  }
})
