# 0028 Web 首屏与切页性能

- 状态：已采纳（阶段一已实施；字体重新切分尝试已回退）
- 日期：2026-11-27
- 关联：[0020 品牌与设计令牌](./0020-brand-rename-and-warm-editorial-tokens)、[自托管部署](/dev/self-hosting)

## 背景

用户反馈首次进入页面字体渲染慢，点击底部导航切页明显卡顿。实测（生产环境 + 本地 DevTools / Playwright）：

- 字体 CSS 212 KB（正体、粗体各 97 条 `@font-face`），生产环境 `/fonts/` 没有 gzip 和 `Cache-Control`；样式表在 `<head>` 渲染阻塞。
- 首屏实际请求约 47 个 woff2 切片，按每片约 55 KB 估算约 2–2.5 MB；界面用字 1012 种命中 27 个正体切片（约 1.4 MB）。`font-display: swap` 下每个切片到达都会触发一次文字重排。
- 首次切到「菜谱」有一个 1330 ms 长任务：列表一次补齐 887 行，产生 10,496 个 DOM 节点、8,100 个已 hydrate 自定义元素，其中 887×3 是 `ion-item-sliding / ion-item-options / ion-item-option`。
- `apps/web/public/_headers` 与 `edgeone.json` 的缓存规则写的是 `/assets/*`，但构建产物在 `/_nuxt/`，CDN 部署拿不到长缓存。

## 决定（阶段一）

- 服务器 / CDN 为 `/_nuxt/*` 与 `/fonts/*` 开启缓存，Nginx 开启 gzip；`index.html` 使用 `no-cache`。
- 修正 `_headers` / `edgeone.json` 的 `/_nuxt/*` 路径，补 `/fonts/*`。
- 菜谱库改为**增量渲染**：首屏 30 行，滚动接近底部时用 `IntersectionObserver` 每次追加 50 行。不再在空闲时一次补齐全部，避免单次 1s+ 长任务。
- 菜谱库直接复用 `useRecipeStore().recipes`，不再在页面 mount 时重复读 IndexedDB；store 对外暴露 `recipes`。
- 保留 `content-visibility: auto` 分块和 `ion-item-sliding` 的滑动手感，不引入虚拟滚动。

实测切到「菜谱」的长任务从 1330 ms 降到 55–65 ms，DOM 节点从 10,496 降到约 780（30 行）。

## 后续（待重新评估）

- 字体重新切分：首次尝试把上游 97 个切片合并后按站点用字重切，正体主切片覆盖完整，但粗体按整体用字频率取前 300 字，漏掉了大量界面粗体字（实测 71 个界面粗体字缺 17 个，包括「帐」「详」「情」「完」「去」「站」等），浏览器用 400 字重合成粗体，导致同一个词里真/合成粗体混排。该尝试已回退。
- 如果重做，粗体必须覆盖**与正体相同的站点用字全集**（首屏约 1.36 MB），或者彻底去掉粗体 webfont、全部使用合成粗体（首屏约 681 KB，风格一致但笔画偏软）。重切前后应逐字校验生成字体与上游字形一致。
- `plugins/account.client.ts` 目前是 async 插件，会等 `/api/auth/me` 和覆盖层刷新后才挂载；可改为后台刷新，进一步降低首屏等待。

## 影响

- 菜谱库 DOM 随滚动增长，不再一次性包含 887 行；用户滚到底部时仍会逐步补齐，滚动过程不触发整表重排。
- 字体缓存暂用 30 天 + `must-revalidate`；将来换成带内容哈希的文件名后再改 1 年 immutable。
- 未登录首屏仍会有一次 `/api/auth/me` 401；这是既有行为，后续处理。
- 删除 `ion-item-sliding` 或改用虚拟滚动不在本阶段范围；如果增量渲染后快速滚动仍有抖动，再单独评估。
