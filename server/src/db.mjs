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
      vision_model TEXT NOT NULL DEFAULT '',
      api_key_cipher TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipe_overrides (
      recipe_id INTEGER PRIMARY KEY,
      data TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'admin',
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recipe_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      custom_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      submitted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      submitted_at INTEGER NOT NULL,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at INTEGER,
      review_note TEXT,
      published_recipe_id INTEGER
    );

    CREATE INDEX IF NOT EXISTS recipe_submissions_status ON recipe_submissions(status, id);

    CREATE TABLE IF NOT EXISTS counters (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
  `)

  // 旧库升级：users 表没有 role 列时补上，已有账号默认是普通用户。
  const columns = db.prepare('PRAGMA table_info(users)').all()
  if (!columns.some(column => column.name === 'role'))
    db.exec('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT \'user\'')

  // 旧库升级：ai_config 表没有 vision_model 列时补上，留空表示跟随主模型。
  const aiColumns = db.prepare('PRAGMA table_info(ai_config)').all()
  if (!aiColumns.some(column => column.name === 'vision_model'))
    db.exec('ALTER TABLE ai_config ADD COLUMN vision_model TEXT NOT NULL DEFAULT \'\'')

  // 旧库升级：recipe_overrides 没有 source 列时补上，'admin' 表示管理员修订。
  const overrideColumns = db.prepare('PRAGMA table_info(recipe_overrides)').all()
  if (!overrideColumns.some(column => column.name === 'source'))
    db.exec('ALTER TABLE recipe_overrides ADD COLUMN source TEXT NOT NULL DEFAULT \'admin\'')

  // 旧库升级：投稿表没有 custom_id 列时补上，用来把投稿对回「我的菜谱」里的那一条。
  const submissionColumns = db.prepare('PRAGMA table_info(recipe_submissions)').all()
  if (!submissionColumns.some(column => column.name === 'custom_id'))
    db.exec('ALTER TABLE recipe_submissions ADD COLUMN custom_id TEXT NOT NULL DEFAULT \'\'')

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

/**
 * 官方菜谱覆盖层：整份 RecipeItem 存成 JSON，按 recipe.csv 的 id 覆盖。
 * 回滚就是删掉这一行，所以不存差异。
 */
export function createRecipeOverrideRepository(db) {
  const rowToRecord = (row) => {
    if (!row)
      return null
    return {
      id: row.recipeId,
      data: JSON.parse(row.data),
      source: row.source ?? 'admin',
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy ?? null,
      updatedByName: row.updatedByName ?? null,
    }
  }

  return {
    list() {
      return db.prepare(`
        SELECT o.recipe_id AS recipeId, o.data, o.source, o.updated_at AS updatedAt,
               o.updated_by AS updatedBy, u.username AS updatedByName
        FROM recipe_overrides o
        LEFT JOIN users u ON u.id = o.updated_by
        ORDER BY o.recipe_id
      `).all().map(rowToRecord)
    },
    get(id) {
      return rowToRecord(db.prepare(`
        SELECT o.recipe_id AS recipeId, o.data, o.source, o.updated_at AS updatedAt,
               o.updated_by AS updatedBy, u.username AS updatedByName
        FROM recipe_overrides o
        LEFT JOIN users u ON u.id = o.updated_by
        WHERE o.recipe_id = ?
      `).get(id))
    },
    put(id, data, userId, source = 'admin') {
      const now = Date.now()
      db.prepare(`
        INSERT INTO recipe_overrides (recipe_id, data, source, updated_by, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(recipe_id) DO UPDATE SET
          data = excluded.data,
          source = excluded.source,
          updated_by = excluded.updated_by,
          updated_at = excluded.updated_at
      `).run(id, JSON.stringify(data), source, userId, now)
      return { updatedAt: now }
    },
    remove(id) {
      return db.prepare('DELETE FROM recipe_overrides WHERE recipe_id = ?').run(id).changes > 0
    },
    /** 覆盖层版本号：最后修改时间；没有覆盖时是 0 */
    version() {
      return db.prepare('SELECT MAX(updated_at) AS version FROM recipe_overrides').get()?.version ?? 0
    },
  }
}

/**
 * 用户投稿：提交到全量菜谱的菜谱，等管理员审核。
 * 审核通过后由管理员分配正式 id 并写入覆盖层，投稿行只记录状态。
 */
export function createRecipeSubmissionRepository(db) {
  const rowToRecord = (row) => {
    if (!row)
      return null
    return {
      id: row.id,
      data: JSON.parse(row.data),
      customId: row.customId ?? '',
      status: row.status,
      submittedBy: row.submittedBy ?? null,
      submittedByName: row.submittedByName ?? null,
      submittedAt: row.submittedAt,
      reviewedBy: row.reviewedBy ?? null,
      reviewedAt: row.reviewedAt ?? null,
      reviewNote: row.reviewNote ?? '',
      publishedRecipeId: row.publishedRecipeId ?? null,
    }
  }

  const SELECT = `
    SELECT s.id, s.data, s.custom_id AS customId, s.status, s.submitted_at AS submittedAt,
           s.submitted_by AS submittedBy, u.username AS submittedByName,
           s.reviewed_by AS reviewedBy, s.reviewed_at AS reviewedAt,
           s.review_note AS reviewNote, s.published_recipe_id AS publishedRecipeId
    FROM recipe_submissions s
    LEFT JOIN users u ON u.id = s.submitted_by
  `

  return {
    list(status) {
      const rows = status
        ? db.prepare(`${SELECT} WHERE s.status = ? ORDER BY s.id DESC`).all(status)
        : db.prepare(`${SELECT} ORDER BY s.id DESC`).all()
      return rows.map(rowToRecord)
    },
    listByUser(userId) {
      return db.prepare(`${SELECT} WHERE s.submitted_by = ? ORDER BY s.id DESC`).all(userId).map(rowToRecord)
    },
    get(id) {
      return rowToRecord(db.prepare(`${SELECT} WHERE s.id = ?`).get(id))
    },
    create(data, userId, customId = '') {
      const now = Date.now()
      const result = db.prepare(`
        INSERT INTO recipe_submissions (data, custom_id, status, submitted_by, submitted_at)
        VALUES (?, ?, 'pending', ?, ?)
      `).run(JSON.stringify(data), customId, userId, now)
      return this.get(Number(result.lastInsertRowid))
    },
    setStatus(id, status, { reviewedBy = null, reviewNote = '', publishedRecipeId = null } = {}) {
      db.prepare(`
        UPDATE recipe_submissions
        SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, published_recipe_id = ?
        WHERE id = ?
      `).run(status, reviewedBy, Date.now(), reviewNote, publishedRecipeId, id)
      return this.get(id)
    },
  }
}

/**
 * 单调计数器：发布到全量菜谱的新菜谱从这里取 id。
 * 计数器只增不减——删掉一条已发布的菜谱也不会把它的 id 重新发出去。
 */
export function createCounterRepository(db) {
  return {
    /**
     * 取下一个 id 并把计数器往前推。
     * floor 是发布 id 的预留段起点，用来避开官方数据集的 id 段。
     */
    allocatePublishedRecipeId(floor) {
      db.exec('BEGIN IMMEDIATE')
      try {
        const row = db.prepare('SELECT value FROM counters WHERE name = ?').get('published_recipe_id')
        const current = Number(row?.value) || 0
        const highest = Number(db.prepare('SELECT MAX(recipe_id) AS value FROM recipe_overrides WHERE recipe_id >= ?').get(floor)?.value) || 0
        const next = Math.max(current, highest, floor)
        db.prepare(`
          INSERT INTO counters (name, value) VALUES (?, ?)
          ON CONFLICT(name) DO UPDATE SET value = excluded.value
        `).run('published_recipe_id', next + 1)
        return next
      }
      finally {
        db.exec('COMMIT')
      }
    },
  }
}

/** 每个账号自己的模型配置；API Key 只存密文。 */
export function createAiConfigRepository(db) {
  return {
    get(userId) {
      return db.prepare(`
        SELECT base_url AS baseUrl, model, vision_model AS visionModel,
               api_key_cipher AS apiKeyCipher, enabled, updated_at AS updatedAt
        FROM ai_config WHERE user_id = ?
      `).get(userId)
    },
    put(userId, { baseUrl, model, visionModel, apiKeyCipher, enabled }) {
      const now = Date.now()
      db.prepare(`
        INSERT INTO ai_config (user_id, base_url, model, vision_model, api_key_cipher, enabled, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          base_url = excluded.base_url, model = excluded.model,
          vision_model = excluded.vision_model,
          api_key_cipher = excluded.api_key_cipher, enabled = excluded.enabled,
          updated_at = excluded.updated_at
      `).run(userId, baseUrl, model, visionModel ?? '', apiKeyCipher, enabled ? 1 : 0, now)
      return { baseUrl, model, visionModel: visionModel ?? '', enabled: Boolean(enabled), updatedAt: now }
    },
    remove(userId) {
      db.prepare('DELETE FROM ai_config WHERE user_id = ?').run(userId)
    },
  }
}
