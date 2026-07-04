import { timingSafeEqual } from 'node:crypto'
import { subscriptionId } from '../server/web-push.js'

const subscriptionsKey = 'lady-butler:push-subscriptions:v1'

function text(value) { return typeof value === 'string' ? value.trim() : '' }
function redisConfig() {
  const url = text(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL).replace(/\/$/, '')
  const token = text(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  return url && token ? { url, token } : null
}
function bearerToken(req) {
  const header = text(req.headers?.authorization)
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header
}
function secureEqual(left, right) {
  const a = Buffer.from(text(left)), b = Buffer.from(text(right))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}
function available() {
  return !!(redisConfig() && text(process.env.SYNC_ACCESS_TOKEN) && text(process.env.VAPID_PUBLIC_KEY) && text(process.env.VAPID_PRIVATE_KEY))
}
function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(data))
}
async function readJson(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}
async function redisPipeline(commands) {
  const config = redisConfig()
  if (!config) throw new Error('push storage unavailable')
  const response = await fetch(`${config.url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) })
  const result = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(result) || result.some(item => item?.error)) throw new Error('push storage error')
  return result.map(item => item?.result)
}
function authorized(req) { return secureEqual(bearerToken(req), process.env.SYNC_ACCESS_TOKEN) }

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  if (req.method === 'GET') return send(res, 200, { ok: true, available: available(), publicKey: available() ? process.env.VAPID_PUBLIC_KEY : '', schedule: '毎朝8時ごろ' })
  if (!available()) return send(res, 503, { ok: false, error: 'バックグラウンド通知はまだ設定されていません。' })
  if (!authorized(req)) return send(res, 401, { ok: false, error: '同期キーが正しくありません。' })

  try {
    const body = await readJson(req)
    const subscription = body.subscription && typeof body.subscription === 'object' ? body.subscription : body
    const id = subscriptionId(subscription)
    if (!text(subscription.endpoint).startsWith('https://') || !text(subscription?.keys?.p256dh) || !text(subscription?.keys?.auth)) return send(res, 400, { ok: false, error: '通知先を登録できませんでした。' })
    if (req.method === 'DELETE') {
      await redisPipeline([['HDEL', subscriptionsKey, id]])
      return send(res, 200, { ok: true, removed: true })
    }
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET, POST or DELETE only' })
    const record = {
      id,
      endpoint: text(subscription.endpoint),
      expirationTime: subscription.expirationTime || null,
      keys: { p256dh: text(subscription.keys.p256dh), auth: text(subscription.keys.auth) },
      name: text(body.name).slice(0, 40) || 'レディ',
      openTasks: Math.max(0, Math.min(999, Number(body.openTasks) || 0)),
      todayEvents: Math.max(0, Math.min(99, Number(body.todayEvents) || 0)),
      tone: text(body.tone).slice(0, 20),
      enabled: body.enabled !== false,
      updatedAt: new Date().toISOString(),
    }
    await redisPipeline([['HSET', subscriptionsKey, id, JSON.stringify(record)]])
    return send(res, 200, { ok: true, subscribed: true, schedule: '毎朝8時ごろ' })
  } catch (error) {
    return send(res, 400, { ok: false, error: '通知設定を保存できませんでした。', detail: String(error?.message || error) })
  }
}
