import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import process from 'node:process'

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'

/**
 * 派生加密密钥：优先用环境变量 COOK_SECRET_KEY，否则在数据目录生成一份随机密钥文件。
 * 密钥文件丢失意味着已保存的 API Key 无法解密，需要用户重新填写。
 */
export function loadSecret({ env = process.env, dbPath }) {
  if (env.COOK_SECRET_KEY)
    return scryptSync(env.COOK_SECRET_KEY, 'cook-assistant', 32)

  const file = join(dirname(dbPath), 'secret.key')
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 })
    try {
      chmodSync(file, 0o600)
    }
    catch {}
  }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64')
}

/** 输出 v1:iv:tag:cipher（均为 base64），便于以后换算法时区分版本。 */
export function encryptSecret(key, text) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join(':')
}

/** 解密失败返回空串，调用方按「未配置」处理，不抛出内部细节。 */
export function decryptSecret(key, payload) {
  try {
    const [version, iv, tag, data] = String(payload).split(':')
    if (version !== VERSION || !iv || !tag || !data)
      return ''
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'))
    decipher.setAuthTag(Buffer.from(tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
  }
  catch {
    return ''
  }
}
