import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
/**
 * 把 MiniMax 配置写入指定账号的个人助手配置（ai_config 表）。
 *
 * 直接复用服务端自己的加密与存储逻辑，保证密钥格式、加密方式和
 * /api/assistant/config 保存出来的完全一致——这样在网页「我的 → 助手设置」
 * 里也能正常读取和修改。
 *
 * 用法:
 *   node scripts/set-user-assistant-config.mjs <username> <baseUrl> <model> <apiKey>
 */
import { openDatabase } from '../server/src/db.mjs'
import { encryptSecret, loadSecret } from '../server/src/secret.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.COOK_DB_PATH || resolve(root, 'server/data/cook.sqlite')

const [username, baseUrl, model, apiKey] = process.argv.slice(2)

if (!username || !baseUrl || !model || !apiKey) {
  console.error('用法: node scripts/set-user-assistant-config.mjs <username> <baseUrl> <model> <apiKey>')
  process.exit(1)
}

const db = openDatabase(dbPath)
const user = db.prepare('SELECT id, username, role FROM users WHERE username = ?').get(username)

if (!user) {
  console.error(`找不到账号: ${username}`)
  console.error('现有账号:', db.prepare('SELECT id, username, role FROM users').all().map(u => u.username).join(', '))
  process.exit(1)
}

const secretKey = loadSecret({ dbPath })
const now = Date.now()

db.prepare(`
  INSERT INTO ai_config (user_id, base_url, model, api_key_cipher, enabled, updated_at)
  VALUES (?, ?, ?, ?, 1, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    base_url = excluded.base_url,
    model = excluded.model,
    api_key_cipher = excluded.api_key_cipher,
    enabled = 1,
    updated_at = excluded.updated_at
`).run(user.id, baseUrl.replace(/\/+$/, ''), model, encryptSecret(secretKey, apiKey), now)

const row = db.prepare('SELECT base_url, model, enabled FROM ai_config WHERE user_id = ?').get(user.id)

console.log(`已写入账号 ${user.username} (id=${user.id}, role=${user.role})`)
console.log(`  base_url = ${row.base_url}`)
console.log(`  model    = ${row.model}`)
console.log(`  enabled  = ${row.enabled ? 1 : 0}`)
console.log(`  key      = 已加密存储 (${apiKey.length} 字符)`)
