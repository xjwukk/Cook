import { Buffer } from 'node:buffer'
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)

const KEY_LENGTH = 64
const SALT_LENGTH = 16
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

/** 口令要求：至少 8 位，不限制组合，避免把中文或长句拒之门外 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 200
/** 用户名允许中英文、数字、下划线与短横线 */
export const USERNAME_PATTERN = /^[\p{Unified_Ideograph}\w-]{2,32}$/u

export async function hashPassword(password) {
  const salt = randomBytes(SALT_LENGTH)
  const derived = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS)
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt.toString('base64')}$${derived.toString('base64')}`
}

/** 即使参数格式不对也返回 false，绝不抛出，避免把存储细节泄露给调用方 */
export async function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, salt, hash] = String(stored).split('$')
    if (scheme !== 'scrypt')
      return false
    const expected = Buffer.from(hash, 'base64')
    const derived = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    })
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  }
  catch {
    return false
  }
}

export function createSessionToken() {
  return randomBytes(32).toString('base64url')
}

/** 数据库只存会话令牌的哈希：库泄露时不能直接冒充登录 */
export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('base64url')
}

export function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_PATTERN.test(username.trim()))
    return '用户名需为 2–32 位中文、字母、数字、下划线或短横线'
  if (typeof password !== 'string' || password.length < PASSWORD_MIN)
    return `密码至少 ${PASSWORD_MIN} 位`
  if (password.length > PASSWORD_MAX)
    return `密码不能超过 ${PASSWORD_MAX} 位`
  return null
}
