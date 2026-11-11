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
