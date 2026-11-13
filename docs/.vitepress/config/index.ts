import { getVitepressConfig } from '@yunyoujun/docs'
import { defineConfig } from 'vitepress'
import { withYunlefun, yunlefunMarkdown, zhThemeConfig } from 'vitepress-theme-yunlefun/config'
import { serializeProductJsonLd } from '../theme/structured-data.ts'

const vpConfig = getVitepressConfig({
  repo: 'https://github.com/YunYouJun/cook',
})

export default defineConfig(withYunlefun({
  ...vpConfig,
  lang: 'zh-CN',
  title: '云食册',
  cleanUrls: true,
  // 方案记录保留项目历史，其中指向已移除 iOS 文档的链接不再校验。
  ignoreDeadLinks: true,
  description: '有什么食材，就做什么菜。云食册产品官网、iOS 发布信息与料理手帐使用文档。',
  sitemap: {
    hostname: 'https://cook.yunle.fun',
  },
  transformPageData(pageData) {
    const path = pageData.relativePath.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
    pageData.frontmatter.head ??= []
    pageData.frontmatter.head.push(['link', { rel: 'canonical', href: `https://cook.yunle.fun/${path}` }])
    if (pageData.relativePath !== 'index.md')
      return
    const description = typeof pageData.frontmatter.description === 'string' ? pageData.frontmatter.description : ''
    const image = 'https://cook.yunle.fun/ios/light-2-cook-selected.webp'
    const title = '云食册 · 料理手帐｜有什么食材，就做什么菜'
    pageData.frontmatter.head.push(
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:locale', content: 'zh_CN' }],
      ['meta', { property: 'og:site_name', content: '云食册' }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: 'https://cook.yunle.fun/' }],
      ['meta', { property: 'og:image', content: image }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: image }],
      ['script', { type: 'application/ld+json' }, serializeProductJsonLd()],
    )
  },
  markdown: {
    ...vpConfig.markdown,
    config(md) {
      vpConfig.markdown?.config?.(md)
      md.use(yunlefunMarkdown)
    },
  },

  themeConfig: {
    ...vpConfig.themeConfig,
    ...zhThemeConfig,
    editLink: {
      ...vpConfig.themeConfig?.editLink,
      text: '在 GitHub 上编辑此页',
    },

    footer: {
      message: '自托管部署 · <a href="/terms">用户协议</a> · <a href="/privacy">隐私政策</a>',
      copyright: '基于 Cook 开源项目（MIT）· 原项目 © 云游君（YunYouJun）',
    },
    nav: [
      { text: '使用指南', link: '/guide/getting-started' },
      { text: '开发文档', link: '/dev/cli' },
      { text: '方案记录', link: '/decisions/' },
      { text: '打开网页版', link: '/', target: '_self' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '使用指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '一句话找菜', link: '/guide/sentence-input' },
            { text: '第二天带饭', link: '/guide/next-day-lunch' },
            { text: '网页版域名与原有数据', link: '/guide/web-domain' },
          ],
        },
      ],
      '/dev/': [
        {
          text: '开发文档',
          items: [
            { text: '自托管部署', link: '/dev/self-hosting' },
            { text: 'Cook CLI', link: '/dev/cli' },
            { text: '文档站部署', link: '/dev/docs-site' },
            { text: 'Docker 部署', link: '/dev/docker' },
            { text: '菜谱数据', link: '/dev/data' },
            { text: '私人菜谱与文件迁移', link: '/dev/private-recipes' },
            { text: '食材模型展柜', link: '/dev/ingredient-models' },
            { text: '设计系统', link: '/dev/design-system' },
          ],
        },
      ],
      '/decisions/': [
        {
          text: '方案记录',
          items: [
            { text: '说明', link: '/decisions/' },
            { text: '0001 菜谱数据', link: '/decisions/0001-recipe-data' },
            { text: '0002 反馈与固定 id', link: '/decisions/0002-feedback-and-ids' },
            { text: '0003 原生 iOS 与 monorepo', link: '/decisions/0003-native-ios-monorepo' },
            { text: '0004 iOS App 命名', link: '/decisions/0004-ios-app-name' },
            { text: '0005 应用图标', link: '/decisions/0005-app-icon' },
            { text: '0006 iOS Bundle ID', link: '/decisions/0006-ios-bundle-id' },
            { text: '0007 AI 与整句识别', link: '/decisions/0007-ai-and-sentence-input' },
            { text: '0008 iOS 统计与反馈', link: '/decisions/0008-ios-analytics' },
            { text: '0009 图文做法', link: '/decisions/0009-text-recipes' },
            { text: '0010 视频质量分', link: '/decisions/0010-recipe-quality-score' },
            { text: '0011 冰箱与临期提醒', link: '/decisions/0011-fridge-reminders' },
            { text: '0012 反馈渠道分流', link: '/decisions/0012-feedback-channels' },
            { text: '0013 私人菜谱与文件迁移', link: '/decisions/0013-private-recipes' },
            { text: '0014 个人食材和厨具', link: '/decisions/0014-personal-catalog' },
            { text: '0015 官网与网页版域名分工', link: '/decisions/0015-product-site-domains' },
            { text: '0016 原生 Android 与外壳退役', link: '/decisions/0016-native-android-and-capacitor-retirement' },
            { text: '0017 离线视频校验', link: '/decisions/0017-offline-video-checks' },
            { text: '0018 冰箱拍照录入', link: '/decisions/0018-fridge-photo-intake' },
            { text: '0019 Web 视觉方向', link: '/decisions/0019-warm-editorial-web-visual-direction' },
            { text: '0020 品牌更名与视觉令牌', link: '/decisions/0020-brand-rename-and-warm-editorial-tokens' },
            { text: '0021 料理助手', link: '/decisions/0021-cooking-assistant' },
          ],
        },
      ],
    },
  },
}))
