import { describe, expect, it } from 'vitest'
import { absoluteSiteUrl, appDescription, applyCookRouteSeo, publicPages, siteOrigin, siteTitle, webApplicationJsonLd } from '../apps/web/app/constants/seo'

function shell(title = siteTitle) {
  return `<!doctype html><html lang="zh-CN"><head><title>${title}</title><meta name="description" content="${appDescription}"><link rel="canonical" href="${absoluteSiteUrl('/')}"><meta property="og:title" content="${title}"><meta property="og:description" content="${appDescription}"><meta property="og:url" content="${absoluteSiteUrl('/')}"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${appDescription}"></head><body></body></html>`
}

describe('web app citation metadata', () => {
  it('describes the free web app under its public names', () => {
    const data = webApplicationJsonLd()
    expect(data['@type']).toBe('WebApplication')
    expect(data.name).toBe('料理手帐')
    expect(data.alternateName).toEqual(['Cook'])
    expect(data.url).toBe(absoluteSiteUrl('/'))
    expect(data.isAccessibleForFree).toBe(true)
    expect(data.offers).toMatchObject({ price: '0', priceCurrency: 'CNY' })
    expect(data.author).toMatchObject({ name: '云游君', alternateName: 'YunYouJun' })
    expect(data.creator).toMatchObject({ name: '云游君', alternateName: 'YunYouJun' })
    expect(appDescription).toContain('食材')
    expect(appDescription).toContain('厨具')
    expect(appDescription).not.toContain('云食册')
  })

  it('uses the configured public origin', () => {
    expect(siteOrigin).toBe((import.meta.env.NUXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''))
    expect(absoluteSiteUrl('/library')).toBe(`${siteOrigin}/library`)
  })

  it('rewrites public route shells without touching the homepage or unrelated html', () => {
    const assistant = applyCookRouteSeo(shell(), '/assistant')
    expect(assistant).toContain(`<title>${publicPages.assistant.title}</title>`)
    expect(assistant).toContain(`content="${publicPages.assistant.description}"`)
    expect(assistant).toContain(`href="${absoluteSiteUrl('/assistant')}"`)
    expect(assistant).toContain(`property="og:url" content="${absoluteSiteUrl('/assistant')}"`)
    // 旧入口 /apps 指向同一个助手页
    expect(applyCookRouteSeo(shell(), '/apps')).toContain(`<title>${publicPages.assistant.title}</title>`)
    expect(applyCookRouteSeo(shell(), '/home')).toBe(shell())
    expect(applyCookRouteSeo(shell('其他标题'), '/library')).toBe(shell('其他标题'))
    expect(applyCookRouteSeo(shell(), '/settings')).toBe(shell())
  })
})
