# 前端按钮与交互优化计划

> 状态：**待确认**，本文档确认后再动代码。
> 依据：`docs/dev/design-system.md`、`docs/decisions/0019-warm-editorial-web-visual-direction.md`

## 一、审计结论：现状

### 1. 仓库里已经有了一套完整按钮体系，但几乎没在用

`apps/web/app/styles/buttons.scss` 定义了 `.cook-btn` 基础层 + 5 个变体
（`--primary` 印章 / `--secondary` 墨线 / `--ghost` 工具型 / `--danger` 砖红 / `--quiet` 文字链接）

- 3 档尺寸（44/36/28）+ 加载态 + 焦点环 + 按压反馈 + 触摸设备加高 + 减弱动效降级。
  `css-vars.scss` 里有配套的 `--cook-btn-*` 令牌，`nuxt.config.ts` 也已加载。

**但实际使用只集中在 2 个文件**：

| 文件                         | `cook-btn` 次数 |
| ---------------------------- | --------------- |
| `pages/account.vue`          | 10              |
| `components/admin/users.vue` | 2               |
| 其余全部文件                 | 0               |

而全站 **75 处 `ion-button`** 分布在 18 个文件里，`ionic.css` 里**没有任何一行 `ion-button` 定制**——
这些按钮全部渲染成 Ionic 默认外观（iOS 风格圆角蓝色系），与"温暖编辑式/印章"的设计方向不一致，
并且绕开了 `cook-btn` 的焦点环、禁用态、加载态与触摸加高规则。

### 2. 遗留的颜色令牌违规（违反"组件内不写死颜色值"）

| 文件                                       | 问题                                                              |
| ------------------------------------------ | ----------------------------------------------------------------- |
| `components/FAQItem.vue:13,19`             | `bg-blue-100` `text-blue-900` `text-blue-500` `ring-blue-500`     |
| `components/Switch.vue:10,17,38,65`        | `text-orange-600` `text-green-600` `bg-orange-600` `bg-green-600` |
| `components/ylf/YlfSwitch.vue:17,18`       | `bg-blue-600` `bg-gray` `focus-visible:ring-white`                |
| `components/recipe/RecipeTableItem.vue:18` | `text-blue-500`                                                   |
| `components/content/AboutMenu.vue`         | `hover:text-orange-400` `blue-400` `pink-400` `black-400`         |
| `components/common/SearchRecipe.vue:29`    | `hover:text-yellow-400`                                           |
| `components/common/DarkToggle.vue:15`      | `hover:text-yellow-400`                                           |
| `components/RandomRecipe.vue:47`           | `hover:text-blue-500`                                             |
| `components/layout/SimpleCopyright.vue:17` | `text-pink-400`                                                   |

`DarkToggle` / `SearchRecipe` 实际用的是 `YlfIconButton`（组件本身是合规的），
这些 `hover:text-*` 是在组件外层叠加的覆盖，属于多余且违规的装饰。

### 3. `icon-btn` 是一个不存在的 class

`AboutMenu.vue` 4 处、`SearchRecipe.vue` / `DarkToggle.vue` 各 1 处使用 `class="icon-btn"`，
但全仓库（`uno.config.ts`、各 `styles/*`）**没有定义这个 class**。
结果：这些图标按钮没有命中区、没有焦点环、没有 hover 反馈。
正确做法是改用现成的 `YlfIconButton`（已有 40/44px 命中区、`aria-label`、焦点环、reduced-motion）。

### 4. 死代码

- `uno.config.ts` 的 `btn` / `tag` / `pureTag` shortcut：`btn` 全站 0 次使用；
  `tag`/`pureTag` 各 1 次（`DishTag.vue`、`DateTag.vue`）。
- `components/FAQItem.vue` 被引用 0 次。
- `components/Switch.vue` 与 `ylf/YlfSwitch.vue` 是两套并存的开关实现。

### 5. 交互层面已有的优点（应保留，不动）

- `IngredientChip` / `CookingWorkbench`：44px 命中区、`aria-pressed`、`:focus-visible` 焦点环、
  按压缩放、`prefers-reduced-motion` 降级——质量很高。
- `YlfIconButton`：40px（触摸 44px）、`aria-label` + `title`、统一焦点环。
- `cook-btn`：变体/尺寸/加载/禁用/焦点齐全。
- 反馈链路统一：`showAlert` + `confirmDestructive` + `promptText` + `yunleHaptic`。
- 内容六态（加载/空/错误/部分/成功/权限）在工作台与结果面板已落地。

---

## 二、优化方案

### 阶段 A：统一 `ion-button` 外观（改动最大、收益最高）

**思路**：不替换 75 处 `ion-button` 为原生 `<button>`（那会破坏 Ionic 弹层内的表单行为与 `router-link` 语义），
而是在 `ionic.css` 里给 `ion-button` 加一层令牌驱动的外观覆盖，让它与 `cook-btn` 视觉对齐。

具体：

1. `ionic.css` 新增 `ion-button` 主题段：圆角 `--r-md`、主态填充 `--c-brand` + 文字 `--c-brand-contrast`、
   outline 态墨线边框、`clear` 态透明、危险态 `--c-alert`；
   统一 `--border-radius`、最小高度 44px（触摸 48px）、`:focus-visible` 焦点环。
2. `ion-button` 的 `fill="clear"`（工具型）与 `fill="outline"`（次级）分别映射到
   `cook-btn--ghost` / `cook-btn--secondary` 的观感。
3. 补 `ion-button[disabled]` 的降透明与 `cursor: not-allowed`。

**风险**：Ionic 组件内部是 Shadow DOM，部分 CSS 变量（`--background`/`--color`/`--border-radius`）
在 `ion-button` 上可直接覆盖，需逐个属性实测确认。**我会逐个属性核对，不靠猜。**

### 阶段 B：清理令牌违规与死代码

1. `FAQItem.vue`：`bg-blue-100` 等 → `--c-paper-alt` / `--c-ink` / `--c-brand-ink`，
   焦点环改用 `focus-visible:ring` 与 `--c-brand` 配合；组件若确实无人使用则连同文件删除。
2. `Switch.vue`：橙/绿改令牌；**建议删除**——统一到 `YlfSwitch`，
   并把 `YlfSwitch` 的 `bg-blue-600` 改为 `--c-brand`、把 `focus-visible:ring-white`
   改为 `--c-brand` 焦点环（当前白环在浅色纸面上几乎不可见，属实打实的可访问性缺陷）。
3. `RecipeTableItem.vue`：`text-blue-500` → `--c-brand-ink`。
4. `AboutMenu.vue`：4 个 `icon-btn` → `YlfIconButton`；去掉四色 hover 覆盖，
   统一为 `YlfIconButton` 的暖色悬停。
5. `SearchRecipe.vue` / `DarkToggle.vue`：删掉外层 `hover:text-yellow-400` 覆盖。
6. `RandomRecipe.vue`：`hover:text-blue-500` → `--c-brand-ink`。
7. `SimpleCopyright.vue`：`text-pink-400` → `--c-ink-2`。
8. `uno.config.ts`：移除 0 引用的 `btn` shortcut；`tag`/`pureTag` 若仅 2 处使用，
   考虑改为语义化类名后一并移除 shortcut。

### 阶段 C：补齐交互一致性

1. **加载态**：目前只有 `account.vue` 用 `aria-busy` + `ion-spinner`。
   其余异步操作（导入、同步、保存）反馈不统一——统一为 `aria-busy` + `.cook-btn__spinner` 模式。
2. **禁用态**：给 `ion-button` 补 `:disabled` 的降透明与 `not-allowed`。
3. **按下反馈**：`ion-button` 目前没有按压缩放，补 `:active` 缩放（对齐 `--cook-btn-press-scale`），
   并在 `prefers-reduced-motion` 下关闭。
4. **焦点可见性**：统一为 `outline: 2px solid var(--c-brand); outline-offset: 2px`。
5. **触控目标**：审计所有可点区域 ≥44px（`ion-item` 的 `button` 属性、
   `ion-button` 的 `size="small"`、标签页切换等）。

### 阶段 D：文档与验收

1. `docs/dev/design-system.md` 增加「按钮层级」小节，写清
   primary / secondary / ghost / danger / quiet 五档各自的适用场景与"每屏至多一个主按钮"的规则。
2. 更新 `docs/decisions/`（新增 0022 或补充 0019）记录本次统一。
3. 按 `design-system.md` 的验收要求，在 390×844 / 834×1024 / 1440×900 三视口、
   明暗两主题下人工走查并更新 evidence 记录。

---

## 三、改动范围与风险

| 阶段                  | 文件数（估）               | 风险               | 可回退性   |
| --------------------- | -------------------------- | ------------------ | ---------- |
| A `ion-button` 主题化 | 1（`ionic.css`）+ 少量微调 | **中**——影响面最广 | 单文件回退 |
| B 违规清理与死代码    | ~10                        | 低                 | 逐文件回退 |
| C 交互一致性          | ~8                         | 低—中              | 逐文件回退 |
| D 文档                | 2                          | 无                 | —          |

**不做的事**（避免过度设计与回归风险）：

- 不把 75 处 `ion-button` 改写成原生 `<button>`（会破坏 Ionic 弹层与 `router-link` 语义）。
- 不改动业务逻辑、路由、接口或数据格式。
- 不重排页面布局与信息架构。
- 不动已达标的核心交互组件（`IngredientChip` / `CookingWorkbench` / `YlfIconButton`）。

---

## 四、需要你拍板的点

1. **阶段 A 的做法**：给 `ion-button` 加外观覆盖（改动小、影响广）
   vs. 逐个替换成 `cook-btn`（改动大、彻底，但需重写 75 处且要处理弹层语义）。
   **我建议前者。**
2. **`Switch.vue` 是否直接删除**，统一到 `YlfSwitch`？
3. **`FAQItem.vue` 无引用，是删除还是顺手修好配色？**
4. **死代码清理**：`btn` shortcut 与 `tag`/`pureTag` 是否一并移除？
5. **是否要做阶段 D 的三视口 + 明暗双主题人工走查并更新 evidence？**
   （当前环境无浏览器自动化，我会人工核对代码层面的可达性/对比度/触控尺寸，
   但无法生成真实截图——这一点会如实说明。）
6. **是否需要新增轻量 toast**？目前所有成功/失败反馈都走 Ionic 弹窗，
   频次高时打断感较强。Ionic 7 的 `toastController` 是现成的，加一个不阻塞流程的轻提示是可行的小改动。
