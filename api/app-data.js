import { timingSafeEqual } from 'node:crypto'

const dataKey = 'lady-butler:app-data:v1'
const maxBodyBytes = 512 * 1024

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
  if (body.length > maxBodyBytes) throw new Error('payload too large')
  return body.length ? JSON.parse(body.toString('utf8')) : {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

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

function syncAvailable() {
  return !!(redisConfig() && text(process.env.SYNC_ACCESS_TOKEN))
}

function requireAuth(req, res) {
  if (!syncAvailable()) {
    send(res, 503, { ok: false, error: '端末間同期はまだ設定されていません。' })
    return false
  }
  if (!secureEqual(bearerToken(req), process.env.SYNC_ACCESS_TOKEN)) {
    send(res, 401, { ok: false, error: '同期キーが正しくありません。' })
    return false
  }
  return true
}

async function redisPipeline(commands) {
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

function normalizeData(value) {
  const data = value && typeof value === 'object' ? value : {}
  const list = (key, limit) => Array.isArray(data[key]) ? data[key].filter(item => item && typeof item === 'object').slice(0, limit) : []
  return {
    version: 2,
    tasks: list('tasks', 1000),
    events: list('events', 1000),
    moodLogs: list('moodLogs', 1000),
    diaries: list('diaries', 1000),
    gptInbox: list('gptInbox', 200),
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
  }
}

async function readEnvelope() {
  const [raw] = await redisPipeline([['GET', dataKey]])
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  if (!requireAuth(req, res)) return

  try {
    if (req.method === 'GET') {
      const envelope = await readEnvelope()
      return send(res, 200, envelope
        ? { ok: true, exists: true, ...envelope }
        : { ok: true, exists: false, revision: 0, updatedAt: null, data: null })
    }

    if (req.method !== 'PUT') return send(res, 405, { ok: false, error: 'GET or PUT only' })
    const body = await readJson(req)
    const serialized = JSON.stringify(body.data ?? {})
    if (Buffer.byteLength(serialized, 'utf8') > maxBodyBytes) return send(res, 413, { ok: false, error: '保存データが大きすぎます。' })

    const current = await readEnvelope()
    const currentRevision = Number(current?.revision) || 0
    const baseRevision = Number(body.baseRevision) || 0
    if (baseRevision !== currentRevision) {
      return send(res, 409, { ok: false, error: '別の端末で更新されています。', exists: !!current, ...(current || { revision: 0, data: null }) })
    }

    const envelope = {
      revision: currentRevision + 1,
      updatedAt: new Date().toISOString(),
      data: normalizeData(body.data),
    }
    await redisPipeline([['SET', dataKey, JSON.stringify(envelope)]])
    return send(res, 200, { ok: true, exists: true, ...envelope })
  } catch (error) {
    return send(res, 400, { ok: false, error: '同期データを処理できませんでした。', detail: String(error?.message || error) })
  }
}
