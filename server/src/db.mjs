import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 单文件 SQLite：账号、会话与用户数据。
 * 用 Node 24 内置的 node:sqlite，避免服务器安装编译型依赖。
 */
export function openDatabase(file) {
  if (file !== ':memory:')
    mkdirSync(dirname(file), { recursive: true })

  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day TEXT NOT NULL,
      day_count INTEGER NOT NULL DEFAULT 0,
      minute TEXT NOT NULL,
      minute_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, day)
    );

    CREATE TABLE IF NOT EXISTS ai_config (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      api_key_cipher TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
  `)

  // 旧库升级：users 表没有 role 列时补上，已有账号默认是普通用户。
  const columns = db.prepare('PRAGMA table_info(users)').all()
  if (!columns.some(column => column.name === 'role'))
    db.exec('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT \'user\'')

  return db
}

export function createUserRepository(db) {
  return {
    findByUsername(username) {
      return db.prepare('SELECT id, username, password_hash AS passwordHash, role FROM users WHERE username = ?').get(username)
    },
    findById(id) {
      return db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id)
    },
    create(username, passwordHash, role = 'user') {
      const now = Date.now()
      const result = db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)')
        .run(username, passwordHash, role, now)
      return { id: Number(result.lastInsertRowid), username, role }
    },
    setRole(id, role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
    },
    updatePassword(id, passwordHash) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id)
    },
    list() {
      return db.prepare(`
        SELECT u.id, u.username, u.role, u.created_at AS createdAt,
               d.updated_at AS dataUpdatedAt
        FROM users u LEFT JOIN user_data d ON d.user_id = u.id
        ORDER BY u.id
      `).all()
    },
    remove(id) {
      db.prepare('DELETE FROM users WHERE id = ?').run(id)
    },
    count() {
      return db.prepare('SELECT COUNT(*) AS n FROM users').get().n
    },
    countAdmins() {
      return db.prepare('SELECT COUNT(*) AS n FROM users WHERE role = \'admin\'').get().n
    },
  }
}

export function createSessionRepository(db) {
  return {
    create(tokenHash, userId, ttlMs) {
      const now = Date.now()
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
        .run(tokenHash, userId, now, now + ttlMs)
    },
    findUser(tokenHash) {
      return db.prepare(`
        SELECT u.id, u.username, u.role, s.expires_at AS expiresAt
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
      `).get(tokenHash)
    },
    delete(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    },
    deleteExpired(now = Date.now()) {
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
    },
  }
}

export function createUserDataRepository(db) {
  return {
    get(userId) {
      const row = db.prepare('SELECT data, updated_at AS updatedAt FROM user_data WHERE user_id = ?').get(userId)
      return row ? { data: JSON.parse(row.data), updatedAt: row.updatedAt } : null
    },
    put(userId, data) {
      const now = Date.now()
      db.prepare(`
        INSERT INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
      `).run(userId, JSON.stringify(data), now)
      return { data, updatedAt: now }
    },
  }
}

/**
 * 助手用量配额：按账号记当日与当日每分钟计数。
 * 放在库里而不是内存里，进程重启后额度不会重置。
 */
export function createAiUsageRepository(db) {
  const dayKey = now => new Date(now).toISOString().slice(0, 10)
  const minuteKey = now => new Date(now).toISOString().slice(0, 16)

  return {
    /** 读取当前额度余量，不计数 */
    peek(userId, now = Date.now()) {
      const row = db.prepare('SELECT day_count AS dayCount, minute_count AS minuteCount FROM ai_usage WHERE user_id = ? AND day = ?')
        .get(userId, dayKey(now))
      return { dayCount: row?.dayCount ?? 0, minuteCount: row?.minuteCount ?? 0 }
    },
    /** 记一次调用并返回新的计数 */
    record(userId, now = Date.now()) {
      const day = dayKey(now)
      const minute = minuteKey(now)
      const existing = db.prepare('SELECT day_count AS dayCount, minute_count AS minuteCount FROM ai_usage WHERE user_id = ? AND day = ?')
        .get(userId, day)
      if (!existing) {
        db.prepare('INSERT INTO ai_usage (user_id, day, day_count, minute, minute_count) VALUES (?, ?, 1, ?, 1)')
          .run(userId, day, minute)
        return { dayCount: 1, minuteCount: 1 }
      }
      const minuteCount = existing.minute === minute ? existing.minuteCount + 1 : 1
      const dayCount = existing.dayCount + 1
      db.prepare('UPDATE ai_usage SET day_count = ?, minute = ?, minute_count = ? WHERE user_id = ? AND day = ?')
        .run(dayCount, minute, minuteCount, userId, day)
      return { dayCount, minuteCount }
    },
    /** 清掉两天前的记录 */
    cleanup(now = Date.now()) {
      db.prepare('DELETE FROM ai_usage WHERE day < ?').run(dayKey(now - 2 * 24 * 60 * 60 * 1000))
    },
  }
}

/** 每个账号自己的模型配置；API Key 只存密文。 */
export function createAiConfigRepository(db) {
  return {
    get(userId) {
      return db.prepare(`
        SELECT base_url AS baseUrl, model, api_key_cipher AS apiKeyCipher,
               enabled, updated_at AS updatedAt
        FROM ai_config WHERE user_id = ?
      `).get(userId)
    },
    put(userId, { baseUrl, model, apiKeyCipher, enabled }) {
      const now = Date.now()
      db.prepare(`
        INSERT INTO ai_config (user_id, base_url, model, api_key_cipher, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          base_url = excluded.base_url, model = excluded.model,
          api_key_cipher = excluded.api_key_cipher, enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(userId, baseUrl, model, apiKeyCipher, enabled ? 1 : 0, now)
      return { baseUrl, model, enabled: Boolean(enabled), updatedAt: now }
    },
    remove(userId) {
      db.prepare('DELETE FROM ai_config WHERE user_id = ?').run(userId)
    },
  }
}
