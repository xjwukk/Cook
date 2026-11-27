/**
 * 决定保存时是否写入 note。
 *
 * 官方菜谱：内容为空，或与官方步骤文本相同，都不写 note（避免无意义覆盖）；
 * 投稿发布的菜谱：note 是步骤的唯一来源，非空就保留。
 */
export function resolveNoteForSave(input: {
  note: string
  officialText?: string
  isPublished: boolean
}): string | undefined {
  const text = input.note.trim()
  if (!text)
    return undefined
  if (input.isPublished)
    return text
  return text === (input.officialText ?? '').trim() ? undefined : text
}
