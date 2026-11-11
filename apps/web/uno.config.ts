import { readFileSync } from 'node:fs'
import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetTypography,
  presetWind3,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

import { methodIcons, toolIcons } from './app/data/cookingIcons'
import { tools } from './app/data/food'

const cookingIconClasses = [...new Set([...Object.values(methodIcons), ...Object.values(toolIcons)])]
const cookingIcons = Object.fromEntries(cookingIconClasses.map((className) => {
  const name = className.slice('i-cook-'.length)
  return [name, readFileSync(new URL(`../../packages/shared/Assets.xcassets/${name}.imageset/icon.svg`, import.meta.url), 'utf8')
    .replaceAll('stroke="#000"', 'stroke="currentColor"')]
}))

const safelist: string[] = ['text-left', ...cookingIconClasses]

tools.forEach((item) => {
  if (item.icon)
    safelist.push(item.icon)
})

export default defineConfig({
  shortcuts: [
    // 令牌驱动：组件不写死颜色，明暗主题自动跟随（0019 方案记录）
    ['tag', 'text-sm cursor-pointer inline-flex justify-center items-center transition-all duration-200 rounded-[var(--r-sm)] border border-[var(--c-rule)] bg-[var(--c-paper-alt)] text-[var(--c-ink-2)] hover:text-[var(--c-brand-ink)] hover:border-[var(--c-rule-strong)]'],
    ['pureTag', 'text-sm inline-flex justify-center items-center transition-all duration-200 rounded-[var(--r-sm)] border border-[var(--c-rule)] bg-[var(--c-paper-alt)] text-[var(--c-ink-2)]'],
    ['btn', 'text-sm px-4 py-1.5 rounded-[var(--r-md)] inline-flex items-center justify-center gap-1 bg-[var(--c-brand)] text-[var(--c-brand-contrast)] cursor-pointer transition-colors duration-200 hover:bg-[var(--c-brand-ink)] disabled:cursor-default disabled:opacity-50'],
  ],
  presets: [
    // wind4 :host style override bug, so use wind3
    presetWind3(),
    presetAttributify(),
    presetIcons({
      scale: 1.2,
      collections: {
        cook: {
          ...cookingIcons,
          // Web 用当前文字颜色生成遮罩，iOS 则由资产目录的模板模式控制颜色。
          wechat: readFileSync(new URL('../../packages/shared/Assets.xcassets/wechat.imageset/icon.svg', import.meta.url), 'utf8')
            .replace('<svg ', '<svg fill="currentColor" '),
        },
      },
    }),
    presetTypography(),
  ],
  transformers: [
    transformerDirectives(),
    transformerVariantGroup(),
  ],
  safelist,
})
