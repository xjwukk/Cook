import { book, bookOutline, chatbubbleEllipses, chatbubbleEllipsesOutline, library, libraryOutline, personCircle, personCircleOutline } from 'ionicons/icons'

const primaryNavigation = [
  { tab: 'home', label: '做菜', href: '/home', icon: bookOutline, activeIcon: book, paths: ['/', '/home', '/tabs', '/tabs/home'] },
  { tab: 'library', label: '菜谱', href: '/library', icon: libraryOutline, activeIcon: library, paths: ['/library', '/tabs/library', '/recipes'] },
  // /apps 保留为别名，旧链接仍然指向料理助手。
  { tab: 'assistant', label: '料理助手', href: '/assistant', icon: chatbubbleEllipsesOutline, activeIcon: chatbubbleEllipses, paths: ['/assistant', '/tabs/assistant', '/apps'] },
  { tab: 'my', label: '我的', href: '/my', icon: personCircleOutline, activeIcon: personCircle, paths: ['/my', '/tabs/my'] },
]

export function normalizeNavigationPath(path: string) {
  return path.replace(/\/+$/, '') || '/'
}

export function getPrimaryNavigation(path: string) {
  const currentPath = normalizeNavigationPath(path)
  return primaryNavigation.map(item => ({
    ...item,
    active: item.paths.includes(currentPath),
  }))
}
