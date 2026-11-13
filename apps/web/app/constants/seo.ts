/**
 * Public citation metadata for the web app.
 * 自托管部署时用 NUXT_PUBLIC_SITE_URL 指定对外域名（含协议），构建前设置。
 */
export const siteOrigin = (import.meta.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '')
export const siteName = '料理手帐'
export const siteTitle = '料理手帐｜根据家里的食材和厨具找菜谱'
export const appDescription = '根据家里现有的食材和厨具，找到今天能做的家常菜。点选食材、一句话找菜、看做法、收藏，或随机决定今天吃什么。'
export const socialImagePath = '/brand/cook-logo.png'

export const authorName = '云游君'
export const authorAlternateName = 'YunYouJun'
export const authorUrl = 'https://github.com/YunYouJun'

export interface CookSeoPage {
  title: string
  description: string
  path: string
}

export const publicPages = {
  home: {
    title: siteTitle,
    description: appDescription,
    path: '/',
  },
  library: {
    title: '菜谱｜料理手帐',
    description: '浏览料理手帐收录的家常菜，按菜名查找，也可以只看收藏。',
    path: '/library',
  },
  assistant: {
    title: '料理助手｜料理手帐',
    description: '用一句话描述你的食材和口味，料理助手会从菜谱库里挑几道适合的菜。',
    path: '/assistant',
  },
} as const satisfies Record<string, CookSeoPage>

const routeSeoByPath: Record<string, CookSeoPage> = {
  '/': publicPages.home,
  '/home': publicPages.home,
  '/tabs': publicPages.home,
  '/tabs/home': publicPages.home,
  '/library': publicPages.library,
  '/tabs/library': publicPages.library,
  // /apps 是 /assistant 的历史别名
  '/assistant': publicPages.assistant,
  '/tabs/assistant': publicPages.assistant,
  '/apps': publicPages.assistant,
}

export function absoluteSiteUrl(path = '/') {
  return new URL(path, siteOrigin).href
}

export function personEntity() {
  return {
    '@type': 'Person',
    'name': authorName,
    'alternateName': authorAlternateName,
    'url': authorUrl,
  }
}

export function webApplicationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    '@id': `${siteOrigin}/#app`,
    'name': siteName,
    'alternateName': ['Cook'],
    'url': absoluteSiteUrl('/'),
    'description': appDescription,
    'applicationCategory': 'LifestyleApplication',
    'operatingSystem': 'Web',
    'inLanguage': 'zh-CN',
    'isAccessibleForFree': true,
    'offers': {
      '@type': 'Offer',
      'price': '0',
      'priceCurrency': 'CNY',
    },
    'author': personEntity(),
    'creator': personEntity(),
    'image': absoluteSiteUrl(socialImagePath),
  }
}

export function serializeJsonLd(data: unknown) {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function cookDocumentHead(page: CookSeoPage = publicPages.home) {
  const url = absoluteSiteUrl(page.path)
  const image = absoluteSiteUrl(socialImagePath)
  return {
    title: page.title,
    link: [
      { key: 'canonical', rel: 'canonical' as const, href: url },
    ],
    meta: [
      { key: 'description', name: 'description' as const, content: page.description },
      { key: 'og:type', property: 'og:type' as const, content: 'website' },
      { key: 'og:locale', property: 'og:locale' as const, content: 'zh_CN' },
      { key: 'og:site_name', property: 'og:site_name' as const, content: siteName },
      { key: 'og:title', property: 'og:title' as const, content: page.title },
      { key: 'og:description', property: 'og:description' as const, content: page.description },
      { key: 'og:url', property: 'og:url' as const, content: url },
      { key: 'og:image', property: 'og:image' as const, content: image },
      { key: 'twitter:card', name: 'twitter:card' as const, content: 'summary_large_image' },
      { key: 'twitter:title', name: 'twitter:title' as const, content: page.title },
      { key: 'twitter:description', name: 'twitter:description' as const, content: page.description },
      { key: 'twitter:image', name: 'twitter:image' as const, content: image },
    ],
    script: [
      {
        key: 'ld-webapp',
        type: 'application/ld+json' as const,
        innerHTML: serializeJsonLd(webApplicationJsonLd()),
      },
    ],
  }
}

function normalizePath(route: string) {
  const path = route.split(/[?#]/, 1)[0] || '/'
  if (path.length > 1 && path.endsWith('/'))
    return path.slice(0, -1)
  return path
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function replaceTagAttribute(html: string, tagName: string, matches: (tag: string) => boolean, attribute: string, value: string) {
  return html.replace(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'), (tag) => {
    if (!matches(tag) || !tag.includes(`${attribute}=`))
      return tag
    return tag.replace(new RegExp(`\\b${attribute}=(["'])[\\s\\S]*?\\1`), () => `${attribute}="${escapeHtml(value)}"`)
  })
}

function hasAttribute(tag: string, attribute: string, value: string) {
  return new RegExp(`(?:^|[\\s])${attribute}=(["'])${value}\\1`).test(tag)
}

function replaceMetaContent(html: string, attribute: 'name' | 'property', key: string, content: string) {
  return replaceTagAttribute(html, 'meta', tag => hasAttribute(tag, attribute, key), 'content', content)
}

function replaceCanonical(html: string, url: string) {
  return replaceTagAttribute(html, 'link', tag => hasAttribute(tag, 'rel', 'canonical'), 'href', url)
}

/**
 * The generated SPA shell carries the homepage head. Rewrite public routes so a
 * crawler that does not run JavaScript still sees that route's title and canonical.
 * Homepage aliases already match the shell and are left untouched.
 */
export function applyCookRouteSeo(html: string, route: string) {
  const page = routeSeoByPath[normalizePath(route)]
  if (!page || page.path === '/' || !html.includes(`<title>${siteTitle}</title>`))
    return html
  const url = absoluteSiteUrl(page.path)
  let next = html.replace(`<title>${siteTitle}</title>`, () => `<title>${escapeHtml(page.title)}</title>`)
  next = replaceMetaContent(next, 'name', 'description', page.description)
  next = replaceMetaContent(next, 'property', 'og:title', page.title)
  next = replaceMetaContent(next, 'property', 'og:description', page.description)
  next = replaceMetaContent(next, 'property', 'og:url', url)
  next = replaceMetaContent(next, 'name', 'twitter:title', page.title)
  next = replaceMetaContent(next, 'name', 'twitter:description', page.description)
  return replaceCanonical(next, url)
}
