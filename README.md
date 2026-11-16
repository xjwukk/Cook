# Cook · 料理手帐

> 好的，今天我们来做菜 🥬

根据家里现有的食材和厨具找家常菜。本仓库在原 [Cook](https://github.com/YunYouJun/cook) 开源项目（MIT）基础上做了自托管改造：

- 移除了原生 iOS 工程、云函数、云乐坊账号体系、应用内反馈与外部文档入口
- 新增自带账号服务：注册（邀请码）、登录、改密码、好友/家庭账号隔离、收藏与历史跨设备同步
- 保留菜谱数据、检索与推荐逻辑、私人菜谱、个人食材厨具、饮食目标与专题

界面与内容为中文。菜谱数据源自上游项目与 [HowToCook](https://github.com/Anduin2017/HowToCook)（Unlicense）。

## 界面预览

<p align="center">
  <img src="./docs/public/readme/preview.webp" alt="做菜、菜谱库与菜谱详情界面预览" width="100%" />
</p>

<p align="center"><sub>做菜 · 菜谱库 · 菜谱详情</sub></p>

## 功能

- **按食材找菜**：选择食材、厨具、做法、难度、忌口，实时给出能做的菜，并提示「再补一样能多解锁几道」
- **一句话找菜**：本地解析「番茄鸡蛋 不要香菜 用炒锅 简单的」
- **菜谱库**：887 道菜谱，按菜名搜索，收藏
- **料理助手**：用一句话描述食材和口味，助手从菜谱库里挑几道合适的推荐
- **私人菜谱**：自己添加，可导出/导入备份
- **个人食材和厨具**：只展示自己常用的
- **饮食目标与专题**：控重、少添加糖、均衡搭配；次日便当、机构低 GI
- **账号与同步**：登录后收藏和历史在多台设备间同步；未登录也能正常使用，数据只存本机
- **数据备份**：收藏和历史可导出文件或复制到剪贴板

## 快速开始

```bash
pnpm install
pnpm convert        # CSV → JSON，首次运行必须执行
pnpm dev            # http://localhost:3000
```

账号服务单独启动：

```bash
pnpm server:dev     # 需要先在 .env 配置 COOK_ADMIN_* 与 COOK_INVITE_CODE
```

详细配置、Docker 部署与账号权限见 [自托管部署](docs/dev/self-hosting.md)。

## 常用命令

```bash
pnpm validate           # 校验菜谱数据
pnpm lint               # ESLint
pnpm typecheck          # 类型检查
pnpm test -- --run      # 测试
pnpm server:test        # 账号服务测试
pnpm build              # 构建静态站点到 dist/
docker compose up -d --build   # 构建并启动站点与账号服务
```

## 结构

| 目录            | 内容                                                   |
| --------------- | ------------------------------------------------------ |
| `apps/web`      | Nuxt 4 + Ionic 前端（CSR，静态生成）                   |
| `server`        | 自托管账号与同步服务（Node 内置 SQLite，无运行时依赖） |
| `packages/data` | 菜谱数据、食材词典、别名、审核数据                     |
| `packages/cook` | 检索、推荐与数据校验逻辑（CLI）                        |
| `docs`          | VitePress 文档                                         |

## 许可与致谢

代码遵循 [MIT License](./LICENSE)。原项目 © 2022 云游君（YunYouJun）。

感谢原项目与 HowToCook 的数据支持；菜谱视频链接指向 B 站，版权归原作者所有。
