// 从仓库根目录的 logo.png 生成各端品牌图标。
//
// 用途：logo.png 是设计源文件，各端需要固定尺寸、不透明、无留白的图标。
// 换 logo 后跑 `node scripts/generate-brand-icons.mjs` 重新生成。
//
// 图标底色用暖纸色 #FBF7F0，与 Web 端 --c-paper 一致（见 docs/dev/design-system.md）。

import { Buffer } from 'node:buffer'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = resolve(root, 'logo.png')
const PAPER = '#FBF7F0'

/** 去掉 logo.png 四周的白色留白，只留手账本本体 */
async function trimmedLogo() {
  return sharp(SOURCE)
    .trim({ threshold: 12 })
    .png()
    .toBuffer()
}

/** 手账本居中放在暖纸色方底上；图标必须是不带 alpha 的 RGB（iOS 不接受透明） */
async function iconCanvas(size, { background = PAPER, inset = 0.06 } = {}) {
  const logo = await trimmedLogo()
  const inner = Math.round(size * (1 - inset * 2))
  return sharp({
    create: { width: size, height: size, channels: 3, background },
  })
    .composite([{ input: await sharp(logo).resize(inner, inner, { fit: 'contain' }).png().toBuffer(), gravity: 'center' }])
    .flatten({ background })
    .removeAlpha()
    .png({ colourType: 2 })
    .toBuffer()
}

/** 从四边泛洪，把连通的近白背景抠成透明；米饭等被轮廓包住的白色不受影响 */
function knockOutBackground(data, width, height, channels) {
  const isWhite = i => data[i] >= 240 && data[i + 1] >= 240 && data[i + 2] >= 240
  const seen = new Uint8Array(width * height)
  const stack = []

  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height)
      return
    const p = y * width + x
    if (seen[p])
      return
    const i = p * channels
    if (!isWhite(i))
      return
    seen[p] = 1
    stack.push(p)
  }

  for (let x = 0; x < width; x++) {
    push(x, 0)
    push(x, height - 1)
  }
  for (let y = 0; y < height; y++) {
    push(0, y)
    push(width - 1, y)
  }

  while (stack.length) {
    const p = stack.pop()
    const x = p % width
    const y = (p - x) / width
    data[p * channels + 3] = 0
    push(x - 1, y)
    push(x + 1, y)
    push(x, y - 1)
    push(x, y + 1)
  }
}

/** 透明底的手账本图层，供 Icon Composer 叠在纯色填充上 */
async function transparentLayer(size, inset = 0.08) {
  const logo = await trimmedLogo()
  const inner = Math.round(size * (1 - inset * 2))
  const { data, info } = await sharp(logo)
    .resize(inner, inner, { fit: 'contain' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  knockOutBackground(data, info.width, info.height, info.channels)

  // Icon Composer 的图层按整张 1024 画布对齐，抠图后要补回透明边距
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{
      input: await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).png().toBuffer(),
      gravity: 'center',
    }])
    .png()
    .toBuffer()
}

/** 把 PNG 装进 ICO 容器（Vista 起支持 PNG 压缩的 ICO） */
function pngToIco(png, size) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(1, 4) // image count

  const entry = Buffer.alloc(16)
  entry.writeUInt8(size >= 256 ? 0 : size, 0) // width
  entry.writeUInt8(size >= 256 ? 0 : size, 1) // height
  entry.writeUInt8(0, 2) // palette size
  entry.writeUInt8(0, 3) // reserved
  entry.writeUInt16LE(1, 4) // color planes
  entry.writeUInt16LE(32, 6) // bits per pixel
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(22, 12) // offset

  return Buffer.concat([header, entry, png])
}

/** SVG favicon：内嵌 base64 位图，圆角暖纸底 */
function faviconSvg(png) {
  const data = png.toString('base64')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">
  <title>料理手帐</title>
  <rect width="64" height="64" rx="14" fill="${PAPER}"/>
  <image x="3" y="3" width="58" height="58" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${data}"/>
</svg>
`
}

/** 站点与文档里的品牌 SVG：满幅暖纸底 + 内嵌位图，圆角交给使用方 CSS */
function brandLogoSvg(png) {
  const data = png.toString('base64')
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">
  <title>料理手帐</title>
  <rect width="64" height="64" fill="${PAPER}"/>
  <image x="2" y="2" width="60" height="60" preserveAspectRatio="xMidYMid meet" xlink:href="data:image/png;base64,${data}"/>
</svg>
`
}

/** Icon Composer 的分层图标配置：纯纸色填充 + 手账本图层 */
function iconComposerJson() {
  return `${JSON.stringify({
    'fill': {
      'solid-color': {
        red: '0.98431',
        green: '0.96863',
        blue: '0.94118',
      },
    },
    'groups': [
      {
        layers: [
          {
            'image-name': 'logo.png',
            'name': 'logo',
          },
        ],
        shadow: {
          kind: 'neutral',
          opacity: 0.35,
        },
        translucency: {
          enabled: false,
          value: 0.5,
        },
      },
    ],
    'supported-platforms': {
      squares: 'shared',
    },
  }, null, 2)}\n`
}

const outputs = []

async function write(path, data) {
  writeFileSync(resolve(root, path), data)
  outputs.push(path)
}

// Web：侧栏与关于页用的品牌图（去掉原图四周留白）
await write('apps/web/public/brand/cook-logo.png', await trimmedLogo())

// Web：favicon / apple-touch-icon / PWA 图标
const icon32 = await iconCanvas(32, { inset: 0.02 })
await write('apps/web/public/icon.ico', pngToIco(icon32, 32))
await write('apps/web/public/favicon.svg', faviconSvg(await iconCanvas(64, { inset: 0.03 })))
await write('apps/web/public/apple-touch-icon.png', await iconCanvas(180))
await write('apps/web/public/pwa-192x192.png', await iconCanvas(192))
await write('apps/web/public/pwa-512x512.png', await iconCanvas(512))

// 关于页与文档站沿用的品牌 SVG（原先是蓝色「蒸汽成云」）
const brandSvg = brandLogoSvg(await iconCanvas(128, { inset: 0.04 }))
for (const path of [
  'apps/web/public/brand/cook-app-icon.svg',
  'apps/web/public/about/assets/cook-app-icon.svg',
  'docs/public/brand/cook-app-icon.svg',
  'docs/public/brand/cook-app-icon-dark.svg',
])
  await write(path, brandSvg)

// iOS：AppIcon 的 1024 兜底位图（不透明）
const iosIcon = 'apps/ios/Cook/Resources/Assets.xcassets/AppIcon.appiconset'
await write(`${iosIcon}/AppIcon-512@2x.png`, await iconCanvas(1024))
await write(`${iosIcon}/AppIcon-dark.png`, await iconCanvas(1024))
await write(`${iosIcon}/AppIcon-tinted.png`, await iconCanvas(1024))

// iOS 26+：Icon Composer 分层图标 = 纯纸色填充 + 手账本图层
await write('apps/ios/Cook/Resources/AppIcon.icon/Assets/logo.png', await transparentLayer(1024))
await write('apps/ios/Cook/Resources/AppIcon.icon/icon.json', iconComposerJson())

console.log(`Generated ${outputs.length} brand assets from logo.png:`)
for (const path of outputs)
  console.log(`  ${path}`)
