import { createHash, timingSafeEqual } from 'node:crypto'

export const syncTokenHashKey = 'lady-butler:sync-token-hash:v1'

export function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

export function redisConfig() {
  const url = text(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL).replace(/\/$/, '')
  const token = text(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  return url && token ? { url, token } : null
}

export function bearerToken(req) {
  const header = text(req.headers?.authorization)
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header
}

export function secureEqual(left, right) {
  const a = Buffer.from(text(left)), b = Buffer.from(text(right))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export function syncTokenHash(token) {
  return createHash('sha256').update(text(token)).digest('hex')
}

export function validSyncToken(token) {
  return text(token).length >= 32
}

export async function redisPipeline(commands) {
  const config = redisConfig()
  if (!config) throw new Error('sync storage is not configured')
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(result) || result.some(item => item?.error)) throw new Error(`sync storage error: ${response.status}`)
  return result.map(item => item?.result)
}

export async function readStoredSyncTokenHash() {
  if (!redisConfig()) return ''
  const [storedHash] = await redisPipeline([['GET', syncTokenHashKey]])
  return text(storedHash)
}

export async function storeSyncToken(token) {
  if (!validSyncToken(token)) throw new Error('sync token is too short')
  await redisPipeline([['SET', syncTokenHashKey, syncTokenHash(token)]])
}

export async function syncAuthAvailable() {
  if (!redisConfig()) return false
  if (text(process.env.SYNC_ACCESS_TOKEN)) return true
  return !!(await readStoredSyncTokenHash())
}

export async function syncTokenMatches(token) {
  const value = text(token)
  if (!value) return false
  if (text(process.env.SYNC_ACCESS_TOKEN) && secureEqual(value, process.env.SYNC_ACCESS_TOKEN)) return true
  const storedHash = await readStoredSyncTokenHash()
  return !!storedHash && secureEqual(syncTokenHash(value), storedHash)
}

export async function authorizeSyncRequest(req) {
  return syncTokenMatches(bearerToken(req))
}

export async function actionAuthAvailable() {
  if (!redisConfig()) return false
  if (text(process.env.GPT_ACTION_TOKEN)) return true
  return syncAuthAvailable()
}

export async function actionTokenMatches(token) {
  const actionToken = text(process.env.GPT_ACTION_TOKEN)
  if (actionToken) return secureEqual(token, actionToken)
  return syncTokenMatches(token)
}

export async function authorizeActionRequest(req) {
  return actionTokenMatches(bearerToken(req))
}

export async function contextAuthAvailable() {
  if (!redisConfig()) return false
  if (text(process.env.GPT_ACTION_TOKEN) || text(process.env.SYNC_ACCESS_TOKEN)) return true
  return !!(await readStoredSyncTokenHash())
}

export async function contextTokenMatches(token) {
  const value = text(token)
  if (!value) return false
  if (text(process.env.GPT_ACTION_TOKEN) && secureEqual(value, process.env.GPT_ACTION_TOKEN)) return true
  return syncTokenMatches(value)
}

export async function authorizeContextRequest(req) {
  return contextTokenMatches(bearerToken(req))
}
