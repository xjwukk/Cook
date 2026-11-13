# 自托管部署

本项目可以部署在自己的服务器上，所有设备通过同一个域名访问。部署由两部分组成：

```
浏览器 ──HTTPS──▶ Nginx（静态站点 dist/）
                    └── /api/* ──▶ cook-server（Node，SQLite）
```

- **静态站点**：Nuxt 生成的 `dist/`，负责界面、菜谱检索与本地数据。
- **账号服务**：`server/`，Node 24 内置 `node:sqlite` + `crypto.scrypt`，无第三方运行时依赖，负责注册、登录、会话和收藏/历史同步。

## 环境变量

在仓库根目录建 `.env`（已被 git 忽略）：

```bash
COOK_DB_PATH=data/cook.sqlite
# 首次启动创建管理员；已存在时只补角色，不覆盖密码
COOK_ADMIN_USERNAME=你的管理员用户名
COOK_ADMIN_PASSWORD=一个足够长的密码
# 注册邀请码；留空则关闭注册
COOK_INVITE_CODE=换成一串随机字符
# 通过 HTTPS 访问时设为 1
COOK_COOKIE_SECURE=0
# 反向代理后的对外地址，用于校验写请求来源
COOK_ALLOWED_ORIGINS=https://cook.example.com
# 构建时的对外地址，写入 canonical、OG 与 sitemap
NUXT_PUBLIC_SITE_URL=https://cook.example.com
```

## 本地开发

需要两个进程：

```bash
pnpm install
pnpm convert          # 生成菜谱 JSON

# 终端 1：账号服务（读取根目录 .env）
pnpm server:dev

# 终端 2：Web（/api 会代理到 127.0.0.1:8787）
pnpm dev
```

## Docker 部署

```bash
docker compose up -d --build
# http://localhost:8080
```

`compose.yaml` 启动两个容器：

| 服务          | 作用                                                | 数据                                      |
| ------------- | --------------------------------------------------- | ----------------------------------------- |
| `cook`        | Nginx + 静态站点，`/api/` 反代到 `cook-server:8787` | 无                                        |
| `cook-server` | 账号与同步接口                                      | 命名卷 `cook-data`（`/data/cook.sqlite`） |

默认只监听 `127.0.0.1:8080`，建议由宿主机 Nginx / Caddy 终止 TLS 后反代。需要通过服务器 IP 直接访问时：

```bash
COOK_HOST=0.0.0.0 COOK_PORT=8080 docker compose up -d --build
```

### 宿主机 Nginx 示例

```nginx
server {
    listen 443 ssl http2;
    server_name cook.example.com;

    ssl_certificate     /etc/letsencrypt/live/cook.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cook.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

启用 HTTPS 后把 `.env` 里的 `COOK_COOKIE_SECURE` 改成 `1`，并把 `COOK_ALLOWED_ORIGINS`、`NUXT_PUBLIC_SITE_URL` 改成 `https://` 地址后重新构建。

## 账号与权限

- **注册**：必须填写 `COOK_INVITE_CODE`；未配置邀请码时注册接口返回 503。
- **登录**：密码用 scrypt 加盐哈希存储；会话是 HttpOnly、SameSite=Lax 的 Cookie，30 天有效。
- **隔离**：每个账号只能读写自己的收藏与历史；接口从会话取 `user_id`，不接受客户端传入。
- **本机数据**：登录后浏览器用 `cook:u<id>:*` 命名空间存收藏、历史、私人菜谱和个人食材；切换账号互不可见。首次登录会把匿名空间的数据复制到该账号一次。
- **管理员**：`COOK_ADMIN_USERNAME/PASSWORD` 在首次启动时创建。管理员可以查看账号列表、删除账号、重置密码；不能删除自己，也不能删掉最后一个管理员。管理员**不能**查看其他用户的收藏与历史内容。
- **改密码**：登录后在「我的 → 账号」里修改。预置管理员首次登录后应立即修改初始密码。

## 料理助手（可选）

「料理助手」是一个对话式的找菜入口，模型由运营者在服务端配置。不配置时助手页会提示「服务器尚未配置大模型」并禁用输入，其余功能不受影响。

```bash
# .env
COOK_AI_ENABLED=1
COOK_AI_BASE_URL=https://api.deepseek.com/v1   # 任意 OpenAI 兼容端点
COOK_AI_MODEL=deepseek-chat
COOK_AI_API_KEY=sk-...
COOK_AI_USER_DAILY_LIMIT=100                   # 每账号每日提问上限
COOK_AI_USER_MINUTE_LIMIT=10                   # 每账号每分钟上限
```

改完环境变量要重启 `cook-server`。环境变量是**服务器默认配置**；每个账号也可以登录后在「我的 → 助手设置」里填写自己的服务地址、模型与 API Key，自己的配置优先。

用户自己的配置加密存放在 SQLite 的 `ai_config` 表里（AES-256-GCM），页面只显示 `sk-…abcd` 形式的提示，不回显明文。加密密钥默认生成在数据库同目录的 `secret.key`（权限 0600），也可以用 `COOK_SECRET_KEY` 指定；密钥丢失后已保存的 Key 需要重新填写。用户可在同一页面「测试连接」后再保存，或清除配置回落到服务器默认。

工作方式与边界：

- 浏览器用本地词表解析问题，再从**本地菜谱库**粗筛出 40–60 道真实候选；模型只在这批候选里挑选、排序、写理由，因此不会编造不存在的菜。
- 服务端与客户端都会校验模型引用的菜谱 id，候选之外的一律丢弃；模型没有可用结果时回退到本地排序。
- 单轮送入的候选上限由 `COOK_AI_MAX_CANDIDATES` 控制（默认 50），对话只带最近 6 轮。
- 需要登录才能使用；配额记录在 `ai_usage` 表里，重启不会重置。
- 会发送给模型服务商：你的食材、厨具、调料、收藏菜名、最近做过的菜名，以及本次问题。不发送私人菜谱正文或账号资料。分发给他人使用时，请在隐私说明中告知这一点。

## 备份与恢复

停止 `cook-server` 后复制 SQLite 文件即可（WAL 模式下同时保留 `-wal`、`-shm`）：

```bash
docker compose stop cook-server
docker run --rm -v cook-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/cook-data.tgz -C /data .
docker compose start cook-server
```

恢复时把归档解回同一个卷。菜谱数据本身在仓库的 `packages/data/` 中，不依赖这个数据库。

## 数据来源与升级

- `packages/data/recipe.csv` 是菜谱的唯一来源，`pnpm convert` 生成运行时 JSON。
- 升级代码后重新构建即可；账号数据库与静态站点分离，重建镜像不会清空数据。
- 本仓库已移除原生 iOS、云函数与云乐坊账号同步；如上游有新菜谱，只需同步 `packages/data/` 并按 [菜谱数据](./data.md) 校验。
