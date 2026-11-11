import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')

function readPngMetadata(path: string) {
  const data = readFileSync(resolve(root, path))

  expect(data.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

  return {
    colorType: data[25],
    height: data.readUInt32BE(20),
    width: data.readUInt32BE(16),
  }
}

describe('native app metadata', () => {
  it('uses 云食册 and the native bundle id on iOS', () => {
    const iosProject = readFileSync(resolve(root, 'apps/ios/project.yml'), 'utf8')
    expect(iosProject).toContain('CFBundleDisplayName: 云食册')
    expect(iosProject).toContain('PRODUCT_BUNDLE_IDENTIFIER: fun.yunle.cook')
  })

  it('ships the selected brand icon across web and native iOS', () => {
    const appIcon = readFileSync(resolve(root, 'apps/web/public/brand/cook-app-icon.svg'), 'utf8')
    const iosIconSet = JSON.parse(readFileSync(
      resolve(root, 'apps/ios/Cook/Resources/Assets.xcassets/AppIcon.appiconset/Contents.json'),
      'utf8',
    ))
    const composerIcon = JSON.parse(readFileSync(
      resolve(root, 'apps/ios/Cook/Resources/AppIcon.icon/icon.json'),
      'utf8',
    ))

    // 手账插画 + 暖纸色底，源文件是仓库根目录 logo.png，见 docs/decisions/0020
    expect(appIcon).toContain('viewBox="0 0 64 64"')
    expect(appIcon).toContain('<title>料理手帐</title>')
    expect(appIcon).toContain('<rect width="64" height="64" fill="#FBF7F0"/>')
    expect(appIcon).toContain('data:image/png;base64,')
    expect(appIcon).not.toContain('rx="14"')
    expect(readFileSync(resolve(root, 'apps/ios/Cook/Resources/AppIcon.icon/Assets/logo.png')).length).toBeGreaterThan(0)
    expect(composerIcon.groups[0].layers).toEqual([{ 'image-name': 'logo.png', 'name': 'logo' }])
    expect(composerIcon.fill['solid-color']).toMatchObject({ red: '0.98431', green: '0.96863', blue: '0.94118' })
    expect(iosIconSet.images.map((image: { appearances?: { value: string }[] }) => image.appearances?.[0]?.value ?? 'light'))
      .toEqual(['light', 'dark', 'tinted'])

    expect(readPngMetadata('apps/web/public/pwa-192x192.png')).toMatchObject({ width: 192, height: 192, colorType: 2 })
    expect(readPngMetadata('apps/web/public/pwa-512x512.png')).toMatchObject({ width: 512, height: 512, colorType: 2 })
    expect(readPngMetadata('apps/web/public/apple-touch-icon.png')).toMatchObject({ width: 180, height: 180, colorType: 2 })
    for (const icon of ['AppIcon-512@2x', 'AppIcon-dark', 'AppIcon-tinted'])
      expect(readPngMetadata(`apps/ios/Cook/Resources/Assets.xcassets/AppIcon.appiconset/${icon}.png`)).toMatchObject({ width: 1024, height: 1024, colorType: 2 })
  })
})
