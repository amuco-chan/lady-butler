import { timingSafeEqual } from 'node:crypto'
import { sendWebPush } from '../server/web-push.js'

const subscriptionsKey = 'lady-butler:push-subscriptions:v1'
function text(value) { return typeof value === 'string' ? value.trim() : '' }
function redisConfig() {
  const url = text(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL).replace(/\/$/, '')
  const token = text(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
  return url && token ? { url, token } : null
}
function secureEqual(left, right) {
  const a = Buffer.from(text(left)), b = Buffer.from(text(right))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}
function bearerToken(req) {
  const header = text(req.headers?.authorization)
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : header
}
function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, private')
  res.end(JSON.stringify(data))
}
async function redisPipeline(commands) {
  const config = redisConfig()
  if (!config) throw new Error('push storage unavailable')
  const response = await fetch(`${config.url}/pipeline`, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands) })
  const result = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(result) || result.some(item => item?.error)) throw new Error('push storage error')
  return result.map(item => item?.result)
}
function reminderBody(record) {
  const name = text(record.name) || 'レディ'
  const tasks = Number(record.openTasks) || 0
  const events = Number(record.todayEvents) || 0
  if (!tasks && !events) return `${name}、本日は余白のある朝です。急がず、一つだけ整えましょう。`
  if (events >= 3) return `${name}、本日は予定が${events}件です。やることは最小限に絞ってまいりましょう。`
  return `${name}、未完了は${tasks}件、今日の予定は${events}件です。まず一つ、静かに始めましょう。`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' })
  if (!text(process.env.CRON_SECRET) || !secureEqual(bearerToken(req), process.env.CRON_SECRET)) return send(res, 401, { ok: false, error: 'cron authorization required' })
  const publicKey = text(process.env.VAPID_PUBLIC_KEY), privateKey = text(process.env.VAPID_PRIVATE_KEY)
  if (!redisConfig() || !publicKey || !privateKey) return send(res, 503, { ok: false, error: 'push is not configured' })

  try {
    const [values = []] = await redisPipeline([['HVALS', subscriptionsKey]])
    const records = (Array.isArray(values) ? values : []).flatMap(value => { try { return [JSON.parse(value)] } catch { return [] } }).filter(record => record.enabled !== false)
    let delivered = 0
    const stale = []
    for (const record of records) {
      try {
        const response = await sendWebPush(record, {
          title: "Lady's Butler",
          body: reminderBody(record),
          icon: '/app-icon-192.png',
          badge: '/app-icon-192.png',
          tag: 'lady-daily-reminder',
          url: '/',
        }, { publicKey, privateKey, subject: 'mailto:lady-butler@users.noreply.github.com' })
        if (response.ok) delivered += 1
        else if (response.status === 404 || response.status === 410) stale.push(record.id)
      } catch { /* one broken endpoint must not stop the rest */ }
    }
    if (stale.length) await redisPipeline([['HDEL', subscriptionsKey, ...stale]])
    return send(res, 200, { ok: true, subscriptions: records.length, delivered, removed: stale.length })
  } catch (error) {
    return send(res, 500, { ok: false, error: 'notifications failed', detail: String(error?.message || error) })
  }
}
