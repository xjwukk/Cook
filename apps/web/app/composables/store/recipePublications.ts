import { useStorage } from '@vueuse/core'
import { scopedKey } from '~/utils/storageScope'

/**
 * 「我的菜谱」的投稿状态。
 *
 * 单独存一份映射，不往 cook:<uid>:custom-recipes 里的菜谱对象上加字段——
 * 那份数据由 validatePrivateRecipe 严格校验，多一个键就会让整份数组读不出来。
 */

export interface RecipePublication {
  /** 已提交的投稿 id（用于查状态） */
  submissionId?: number
  status: 'pending' | 'approved' | 'rejected' | 'revoked'
  /** 审核通过后服务端分配的正式 id */
  publishedRecipeId?: number
  /** 驳回原因 */
  reviewNote?: string
  submittedAt: number
}

/** customId → 投稿状态 */
export const recipePublications = useStorage<Record<string, RecipePublication>>(
  scopedKey('custom-recipe-publications'),
  {},
)

export function publicationOf(customId: string): RecipePublication | undefined {
  return recipePublications.value[customId]
}

export function setPublication(customId: string, publication: RecipePublication): void {
  recipePublications.value = { ...recipePublications.value, [customId]: publication }
}

export function clearPublication(customId: string): void {
  if (!(customId in recipePublications.value))
    return
  const next = { ...recipePublications.value }
  delete next[customId]
  recipePublications.value = next
}

interface SubmissionRow {
  id: number
  /** 提交时带上的私人菜谱 id；服务端原样存回来，用于对号。 */
  customId?: string
  status: RecipePublication['status']
  publishedRecipeId: number | null
  reviewNote: string
  submittedAt: number
}

/**
 * 用服务端的投稿列表刷新本地状态。
 *
 * 两条对号方式：本地记下的 submissionId，以及服务端存回来的 customId。
 * 后者让「换设备之后状态也不会显示成未投稿」。
 */
export function applyServerSubmissions(rows: SubmissionRow[]): void {
  const bySubmissionId = new Map(rows.map(row => [row.id, row]))
  const byCustomId = new Map(rows.filter(row => row.customId).map(row => [row.customId!, row]))
  const next = { ...recipePublications.value }
  let changed = false

  for (const [customId, publication] of Object.entries(next)) {
    const row = publication.submissionId != null
      ? bySubmissionId.get(publication.submissionId)
      : byCustomId.get(customId)
    if (!row || row.status === publication.status)
      continue
    next[customId] = {
      ...publication,
      submissionId: row.id,
      status: row.status,
      ...(row.publishedRecipeId != null ? { publishedRecipeId: row.publishedRecipeId } : {}),
      ...(row.reviewNote ? { reviewNote: row.reviewNote } : {}),
    }
    changed = true
  }

  // 本地没有记录、但服务端有我这条投稿的（例如换设备），直接补上状态。
  for (const [customId, row] of byCustomId) {
    if (next[customId])
      continue
    next[customId] = {
      submissionId: row.id,
      status: row.status,
      ...(row.publishedRecipeId != null ? { publishedRecipeId: row.publishedRecipeId } : {}),
      ...(row.reviewNote ? { reviewNote: row.reviewNote } : {}),
      submittedAt: row.submittedAt,
    }
    changed = true
  }

  if (changed)
    recipePublications.value = next
}
