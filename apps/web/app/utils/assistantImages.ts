// 助手的图片输入：用户在提问框里附上的截图。
//
// 图片只在浏览器里压缩后以 base64 随请求发出，服务端只在内存里转发给模型，
// 不落盘、不入库、也不写进保存的菜谱（见 docs/decisions/0024-assistant-image-input.md）。

export const MAX_IMAGE_COUNT = 4
export const MAX_IMAGE_EDGE = 1280
export const MAX_IMAGE_BYTES = 700 * 1024
export const MAX_TOTAL_IMAGE_BYTES = 3 * 1024 * 1024
export const IMAGE_QUALITY = 0.82

export interface AssistantAttachment {
  id: string
  name: string
  mime: string
  /** 压缩后的 data URL：既作预览图，也作请求体里的图片来源 */
  dataUrl: string
  bytes: number
  width: number
  height: number
}

/** 去掉 data URL 前缀，只留下 base64 载荷。 */
export function stripDataUrlPrefix(value: string): string {
  const text = String(value ?? '').trim()
  const comma = text.indexOf(',')
  return text.startsWith('data:') && comma > 0 ? text.slice(comma + 1) : text
}

/** 拆分 data URL；不是合法的 base64 data URL 时返回 null。 */
export function splitDataUrl(value: string): { mime: string, base64: string } | null {
  const text = String(value ?? '').trim()
  const match = text.match(/^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Z0-9+/]*={0,2})$/i)
  if (!match)
    return null
  return { mime: match[1]!.toLowerCase(), base64: match[2]! }
}

/** base64 data URL 的字节数。 */
export function dataUrlBytes(dataUrl: string): number {
  const base64 = stripDataUrlPrefix(dataUrl)
  if (!base64)
    return 0
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

/**
 * 张数与体积预算：超限时返回给用户看的中文提示，都没超则返回 null。
 * 字节数在压缩之后才知道，所以这一层是给「已压缩好的图片」用的。
 */
export function checkImageBudget(
  existingBytes: number,
  existingCount: number,
  incoming: { bytes: number }[],
): string | null {
  const list = Array.isArray(incoming) ? incoming : []
  if (existingCount + list.length > MAX_IMAGE_COUNT)
    return `一次最多上传 ${MAX_IMAGE_COUNT} 张图片`
  for (const item of list) {
    if (item?.bytes > MAX_IMAGE_BYTES)
      return `单张图片不能超过 ${Math.round(MAX_IMAGE_BYTES / 1024)} KB`
  }
  const total = existingBytes + list.reduce((sum, item) => sum + (item?.bytes ?? 0), 0)
  if (total > MAX_TOTAL_IMAGE_BYTES)
    return `图片总大小超出限制（最多 ${Math.round(MAX_TOTAL_IMAGE_BYTES / 1024 / 1024)} MB）`
  return null
}

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  close: () => void
}

/** 解码图片；优先 createImageBitmap（自动按 EXIF 摆正），失败再退回 <img>。 */
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close?.(),
      }
    }
    catch {
      // 继续走 <img> 兜底。
    }
  }

  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('图片读取失败'))
      element.src = url
    })
    return {
      source: image,
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      close: () => URL.revokeObjectURL(url),
    }
  }
  catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

interface EncodedImage {
  dataUrl: string
  bytes: number
  width: number
  height: number
}

/** 缩放到最长边并编码成 JPEG；透明区域铺白底，避免变黑。 */
function encodeScaled(source: CanvasImageSource, width: number, height: number, maxEdge: number, quality: number): EncodedImage {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('当前浏览器无法处理图片')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.drawImage(source, 0, 0, targetWidth, targetHeight)
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return { dataUrl, bytes: dataUrlBytes(dataUrl), width: targetWidth, height: targetHeight }
}

const ENCODE_ATTEMPTS = [
  { edge: MAX_IMAGE_EDGE, quality: IMAGE_QUALITY },
  { edge: MAX_IMAGE_EDGE, quality: 0.67 },
  { edge: MAX_IMAGE_EDGE, quality: 0.52 },
  { edge: Math.round(MAX_IMAGE_EDGE * 0.8), quality: 0.72 },
  { edge: Math.round(MAX_IMAGE_EDGE * 0.65), quality: 0.6 },
]

let attachmentSeed = 0

/** 压缩单张图片；压到体积上限以内为止。 */
export async function prepareImage(file: File): Promise<AssistantAttachment> {
  if (!file?.type?.startsWith('image/'))
    throw new Error('只能添加图片文件')

  const decoded = await decodeImage(file)
  try {
    for (const attempt of ENCODE_ATTEMPTS) {
      const encoded = encodeScaled(decoded.source, decoded.width, decoded.height, attempt.edge, attempt.quality)
      if (encoded.bytes <= MAX_IMAGE_BYTES) {
        attachmentSeed += 1
        return {
          id: `img-${Date.now().toString(36)}-${attachmentSeed}`,
          name: file.name || '图片',
          mime: 'image/jpeg',
          dataUrl: encoded.dataUrl,
          bytes: encoded.bytes,
          width: encoded.width,
          height: encoded.height,
        }
      }
    }
  }
  finally {
    decoded.close()
  }
  throw new Error('这张图片太大了，压缩后仍然超出限制，请换一张或裁剪后再试')
}

/** 批量处理：过滤非图片、逐张压缩，并按张数与体积预算取舍。 */
export async function prepareImages(
  files: File[] | FileList,
  existing: AssistantAttachment[] = [],
): Promise<{ images: AssistantAttachment[], errors: string[] }> {
  const errors: string[] = []
  const all = Array.from(files ?? [])
  const inputs = all.filter(file => file && typeof file.type === 'string' && file.type.startsWith('image/'))
  const skipped = all.length - inputs.length
  if (skipped > 0)
    errors.push(`有 ${skipped} 个文件不是图片，已跳过`)

  const prepared: AssistantAttachment[] = []
  for (const file of inputs) {
    try {
      prepared.push(await prepareImage(file))
    }
    catch (error) {
      errors.push(error instanceof Error ? error.message : '这张图片处理失败')
    }
  }

  const room = Math.max(0, MAX_IMAGE_COUNT - existing.length)
  const accepted = prepared.slice(0, room)
  if (prepared.length > accepted.length)
    errors.push(`一次最多上传 ${MAX_IMAGE_COUNT} 张图片，多余的已忽略`)

  let total = existing.reduce((sum, item) => sum + (item?.bytes ?? 0), 0)
    + accepted.reduce((sum, item) => sum + (item?.bytes ?? 0), 0)
  while (accepted.length && total > MAX_TOTAL_IMAGE_BYTES) {
    // 丢掉最大的一张，保留其它更有用的。
    let largest = 0
    accepted.forEach((item, index) => {
      if ((item?.bytes ?? 0) > (accepted[largest]?.bytes ?? 0))
        largest = index
    })
    total -= accepted[largest]?.bytes ?? 0
    accepted.splice(largest, 1)
    errors.push('图片总大小超出限制，最大的那张已忽略')
  }

  return { images: accepted, errors }
}
