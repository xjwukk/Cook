# 全量菜谱管理与官方菜谱修改（方案）

> 状态：**已实施**。本文是实施方案与验收记录。

## 背景

887 道官方菜谱在构建时从 `packages/data/recipe.csv` 打包进静态资源，运行时只读地存在浏览器 IndexedDB（`cook-db.recipes`）。目前只有「我的菜谱」能编辑，但那是**另复制一份**的自建菜谱，官方菜谱本身无法修改——写错了食材、视频失效、难度标错，只能改 CSV 重新构建发布。

目标：管理员能在站点内直接修改官方菜谱，改动**全局生效**（所有用户、所有设备看到同一份修订），并能导出补丁 CSV 回灌仓库。

已确认的决策：

1. **仅管理员可改，全局生效**（不是每人一份的个人副本）
2. **浏览页不出现任何管理元素**——菜谱库 `/library` 维持纯浏览
3. 管理入口放在「我的」→「全量菜谱」
4. 可改 **`recipe.csv` 全部列**：菜名、食材、厨具、做法、难度、标签、视频号、图文链接（id 只读）

## 数据模型：全局覆盖层

服务端新增 `recipe_overrides` 表（沿用 `server/src/db.mjs` 现有 `CREATE TABLE IF NOT EXISTS` 迁移写法）：

```sql
CREATE TABLE IF NOT EXISTS recipe_overrides (
  recipe_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,          -- 完整 RecipeItem 的 JSON
  updated_by INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
```

仓库：`createRecipeOverrideRepository(db)` → `list()` / `get(id)` / `put(id, data, userId)` / `remove(id)`。

**为什么存整份而不是差异**：字段少（9 列）、数据小（887 道全量才 171 KB），整份存更简单，回滚 = 删除该行。

## 服务端

### 公开读接口

`GET /api/recipes/overrides` —— 免登录（所有访客都要看到修订后的内容）

```json
{ "version": 1794562174743, "overrides": [{ "id": 23, "name": "...", "stuff": [], "tools": [] }] }
```

- 只返回白名单字段：`id, name, stuff, bv, difficulty, tags, methods, tools, link`
- `Cache-Control: no-store`，`version` 取所有行 `max(updated_at)`

### 管理员写接口

用 `requireAdmin` 守卫（`server/src/index.mjs`）：

| 方法     | 路径                     | 用途                                        |
| -------- | ------------------------ | ------------------------------------------- |
| `GET`    | `/api/admin/recipes`     | 列出全部覆盖记录（含 `updatedAt` / 修改者） |
| `PUT`    | `/api/admin/recipes/:id` | 保存一条覆盖，body 为完整 `RecipeItem`      |
| `DELETE` | `/api/admin/recipes/:id` | 撤销，回落到官方版本                        |

写入校验放在 `server/src/recipe-override.mjs`（只做形状校验，不依赖 887 条数据）：

- `id` 与 URL 一致、非负整数
- `name` 非空、≤ 60 字
- `stuff` / `tools` 为非空字符串数组；`tags` / `methods` 可为空
- `difficulty` ∈ `简单 | 普通 | 困难 | ''`
- `bv` 匹配 `^BV[0-9A-Za-z]{10}$` 或 `av\d+`，可为空；`link` 为 `https://` 开头或空
- 单条 JSON ≤ 8 KB

### 与现有数据的关系

`recipe.csv` 仍是唯一权威源，覆盖层是**运行时补丁**：

- 管理员改完 → 页面立刻生效，无需重新构建
- 想永久固化 → 管理页「导出补丁 CSV」，把改动行合回 `packages/data/recipe.csv`，`pnpm validate` 通过后提交，再删除对应覆盖记录

## 客户端

### 覆盖层加载与合并

新增 `apps/web/app/composables/useRecipeOverrides.ts`：

- `refresh()`：`GET /api/recipes/overrides`，成功写入内存 Map + `localStorage['cook:recipe-overrides']`（带 `version`）；失败读本地缓存兜底
- `apply(recipes)`：按 `id` 用覆盖值替换，返回新数组
- 菜谱 store 保留 IndexedDB 原始数组，对外列表用 `apply()` 计算，覆盖层变化时推荐与搜索会跟着重新计算
- 启动时（`plugins/account.client.ts`）触发一次 `refresh()`
- 直接读 IndexedDB 的菜谱库、收藏、历史、助手候选，在读取时同样调用 `apply()`

这样推荐、搜索、菜谱库、收藏、历史、助手候选**全部生效**。

### 管理页 `apps/web/app/pages/admin/recipes.vue`

路由 `/admin/recipes`，`layout: 'child'`，仅管理员可见（非管理员 `router.replace('/my')`，服务端同时兜底 403）。

页面构成：

1. **头部**：`ion-searchbar` 按菜名/食材过滤 +「只看已修改」开关 +「导出补丁 CSV」
2. **列表**：复用 `RecipeListRow` 的视觉，右侧改为「编辑」；已修改的行显示「已修改」徽标（`--c-saffron` 底色）
3. **编辑**：`components/recipe/AdminRecipeEditor.vue`，参照 `PrivateRecipeEditor.vue` 的控件写法
   - 菜名 `<ion-input>`
   - 食材：`IngredientSection` + `IngredientChip`（词表来自 `usePersonalCatalog`），提交时用 `uniqueStuff` 归一
   - 厨具：同上，仅 `food.json` 的 8 项
   - 做法：24 个 `methods` 值多选
   - 难度：`简单 / 普通 / 困难 / 空`
   - 标签：自由输入，顿号分隔
   - 视频号 / 图文链接：文本输入，前端校验格式
   - id：只读
   - **提交前本地校验**：`packages/cook/src/utils/validate.ts` 的 `validateRecipes([edited], dict)`，`dict` 由 `food.json` 构建；错误就地显示，不提交
   - 保存 → `PUT`；「撤销修改」→ `DELETE` 前用 `confirmDestructive` 确认
4. **导出补丁**：用 `recipesToCsv(modified)`（`packages/cook/src/utils/csv.ts`）生成，列顺序与 `recipe.csv` 一致（`name,stuff,bv,difficulty,tags,methods,tools,id,link`），文件名 `recipe-patch-<日期>.csv`

### 「我的」页入口

在 `apps/web/app/pages/tabs/my/index.vue` 的「我的厨房」列表后新增一项，**仅 `user.role === 'admin'` 时渲染**：

```
全量菜谱
浏览与修改收录的 887 道菜谱
```

### 浏览页保持干净

`/library`（`pages/tabs/library/index.vue`）**不加任何编辑按钮、徽标或工具栏**。修订后的菜名等内容会通过覆盖层自动反映，但页面本身仍是纯浏览。

## 关键文件

| 文件                                                   | 改动                                    |
| ------------------------------------------------------ | --------------------------------------- |
| `server/src/db.mjs`                                    | 新增 `recipe_overrides` 表与仓库        |
| `server/src/recipe-override.mjs`                       | 新增：字段形状校验                      |
| `server/src/index.mjs`                                 | 新增 4 个路由（1 公开读 + 3 管理员写）  |
| `apps/web/app/composables/useRecipeOverrides.ts`       | 新增：拉取、缓存、合并                  |
| `apps/web/app/composables/store/recipe.ts`             | 保留原始数组，对外合并覆盖层            |
| `apps/web/app/pages/tabs/library/index.vue`            | 列表读取时合并覆盖层                    |
| `apps/web/app/pages/recipes/favorites.vue`             | 列表读取时合并覆盖层                    |
| `apps/web/app/pages/recipes/history.vue`               | 渲染时合并覆盖层                        |
| `apps/web/app/composables/useAssistant.ts`             | 收藏菜名读取时合并覆盖层                |
| `apps/web/app/pages/admin/recipes.vue`                 | 新增管理页                              |
| `apps/web/app/components/recipe/AdminRecipeEditor.vue` | 新增编辑表单                            |
| `apps/web/app/pages/tabs/my/index.vue`                 | 新增管理员入口                          |
| `apps/web/app/plugins/account.client.ts`               | 启动时刷新覆盖层                        |
| `packages/cook/src/index.ts`                           | 导出 `validateRecipes` 供前端本地校验   |
| `packages/cook/src/utils/paths.ts`                     | 拆出 Node 路径，避免浏览器加载 node:url |
| `server/test/recipe-override.test.mjs`                 | 新增测试                                |
| `docs/decisions/0023-recipe-overrides.md`              | 新增决策记录                            |

## 验收

### 服务端测试（`node:test`，沿用现有 spawn harness）

- 未登录读取覆盖层：200，空数组
- 非管理员写：403
- 管理员写入后：公开接口能读到，字段完整
- 非法输入被拒：空菜名、`difficulty` 越界、`bv` 格式错、`link` 非 https、body 超 8 KB
- `DELETE` 后公开接口回到空
- 按 `id` 覆盖两次只留一条

### 浏览器实测

1. 管理员登录 →「我的」看到「全量菜谱」；普通账号看不到
2. 打开 `/admin/recipes`：搜索「番茄」，改第一道菜的菜名与食材 → 保存
3. 返回 `/library`：该菜显示新菜名（**页面本身无任何编辑元素**）
4. 做菜页选中对应食材 → 推荐结果里也是新菜名（证明覆盖层进入推荐链路）
5. 「只看已修改」筛出该菜；「导出补丁 CSV」只含这一行，列顺序与 `recipe.csv` 一致
6. 「撤销修改」后回到原名
7. 普通账号直接访问 `/admin/recipes` → 跳回「我的」
8. 三视口（390×844 / 834×1024 / 1440×900）截图：管理页列表不溢出、编辑表单可用

### 回归

`pnpm lint` / `pnpm typecheck` / `pnpm test -- --run` / `pnpm server:test` / `pnpm build` 全绿。

## 明确不做

- 不做用户提交 / 审核队列（仅管理员直接生效）
- 不做个人副本覆盖
- 不做文字步骤正文的在线编辑（正文来自 HowToCook 并带指纹校验，改动会使审核数据失效，另立方案）
- 不改 IndexedDB schema 版本号（覆盖层在内存合并，不写回库）
- 不在浏览页暴露任何管理能力
- 不做多人同时编辑的冲突合并（按 `updated_at` 后写胜出，个人站点足够）
