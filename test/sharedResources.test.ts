// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createGenerator } from 'unocss'
import { describe, expect, it } from 'vitest'
import unoConfig from '../apps/web/uno.config'

describe('shared native icon assets', () => {
  it('generates the web icon from the SVG used by the native asset catalog', async () => {
    const svg = readFileSync(new URL('../packages/shared/Assets.xcassets/wechat.imageset/icon.svg', import.meta.url), 'utf8')
    const path = /<path d="([^"]+)"/.exec(svg)?.[1]
    expect(path).toBeTruthy()

    const uno = await createGenerator(unoConfig)
    const { css } = await uno.generate('i-cook-wechat')
    const rule = /\.i-cook-wechat\{([^}]+)\}/.exec(css)?.[1]
    expect(rule).toBeTruthy()
    expect(rule).toContain('mask:')
    expect(rule).toContain('background-color:currentColor')
    const encodedSvg = /url\("data:image\/svg\+xml;utf8,([^"]+)"\)/.exec(rule!)?.[1]
    expect(encodedSvg).toBeTruthy()
    expect(decodeURIComponent(encodedSvg!)).toContain(path!)
  })
})
