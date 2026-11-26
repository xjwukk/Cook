import { Buffer } from 'node:buffer'
import { AssistantError } from './assistant-error.mjs'

// 图片输入：只用于「读图识菜谱」，不落盘、不入库、不写进保存的菜谱。
//
// 设计约束（见 docs/decisions/0024-assistant-image-input.md）：
// - 只接受 JPG / PNG / WebP 的 base64，拒绝 svg、gif 等可执行或可外链的格式
// - 张数、单张体积、总体积都有上限，避免请求体被撑大、token 成本失控
// - 归一后只保留 { mime, data } 两个字段，其余字段一律丢弃

export const MAX_IMAGES = 4
export const MAX_IMAGE_BYTES = 700 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 3 * 1024 * 1024

export const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])

const BASE64_PATTERN = /^[A-Z0-9+/]*={0,2}$/i

/** 拆分 data URL；不是合法的 base64 data URL 时返回 null。 */
export function splitDataUrl(value) {
  const text = String(value ?? '').trim()
  const match = text.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Z0-9+/]*={0,2})$/i)
  if (!match)
    return null
  return { mime: match[1].toLowerCase(), data: match[2] }
}

/** base64 字符串的字节数；非法字符按无效处理。 */
export function base64Bytes(data) {
  return Buffer.byteLength(String(data ?? ''), 'base64')
}

/**
 * 校验并归一前端传来的图片。非法输入抛 AssistantError（400），合法时返回 [{ mime, data }]。
 */
export function normalizeImages(raw, { maxCount = MAX_IMAGES, maxBytes = MAX_IMAGE_BYTES, maxTotalBytes = MAX_TOTAL_IMAGE_BYTES } = {}) {
  if (!Array.isArray(raw) || !raw.length)
    return []
  if (raw.length > maxCount)
    throw new AssistantError('TOO_MANY_IMAGES', `一次最多上传 ${maxCount} 张图片`, 400)

  const images = []
  let total = 0
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new AssistantError('INVALID_REQUEST', '图片数据不合法', 400)

    let mime = String(item.mime ?? '').trim().toLowerCase()
    let data = String(item.data ?? '').trim()

    // 也接受直接给 data URL 的写法。
    if (!data && item.dataUrl) {
      const split = splitDataUrl(item.dataUrl)
      if (!split)
        throw new AssistantError('INVALID_REQUEST', '图片数据不合法', 400)
      mime = split.mime
      data = split.data
    }

    if (!ALLOWED_IMAGE_MIME.has(mime))
      throw new AssistantError('INVALID_REQUEST', '不支持的图片格式，只支持 JPG、PNG、WebP', 400)
    if (!data || data.length % 4 !== 0 || !BASE64_PATTERN.test(data))
      throw new AssistantError('INVALID_REQUEST', '图片数据不合法', 400)

    const bytes = base64Bytes(data)
    if (bytes > maxBytes)
      throw new AssistantError('IMAGE_TOO_LARGE', `单张图片不能超过 ${Math.round(maxBytes / 1024)} KB`, 400)

    total += bytes
    if (total > maxTotalBytes)
      throw new AssistantError('IMAGE_TOO_LARGE', '图片总大小超出限制，请减少张数或压缩后再试', 400)

    images.push({ mime, data })
  }
  return images
}

/** 组装 OpenAI 兼容端点的多模态片段。 */
export function buildImageParts(images) {
  return images.map(image => ({
    type: 'image_url',
    image_url: { url: `data:${image.mime};base64,${image.data}` },
  }))
}

const VISION_ERROR_HINTS = [
  'image',
  'image_url',
  'vision',
  'multimodal',
  'does not support image',
  'unsupported content',
  'content must be a string',
  'invalid content type',
]

/** 上游报错是否在说「这个模型不收图片」。 */
export function looksLikeUnsupportedVision(status, text) {
  if (![400, 415, 422].includes(Number(status)))
    return false
  const body = String(text ?? '').toLowerCase()
  return VISION_ERROR_HINTS.some(hint => body.includes(hint))
}

/** 统一的友好提示：让用户去助手设置里换一个支持图片的模型。 */
export function visionUnsupportedError() {
  return new AssistantError(
    'VISION_UNSUPPORTED',
    '当前模型不支持图片。请到「我的 → 助手设置」填写「图片模型」，或换一个支持图片的模型。',
    400,
  )
}
