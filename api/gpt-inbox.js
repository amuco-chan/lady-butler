import { createHash, timingSafeEqual } from 'node:crypto'

const allowedCategories = new Set(['課題', '授業', '生活', 'バイト', '買い物', 'その他'])
const allowedPriorities = new Set(['高', '中', '低'])
const allowedConfidence = new Set(['high', 'medium', 'low'])
const queueKey = 'lady-butler:gpt-inbox:v1'

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function textList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 5) : []
}

function number(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(text(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(720, Math.max(5, Math.round(parsed / 5) * 5))
}

function normalizeCategory(value, title) {
  const category = text(value)
  if (allowedCategories.has(category)) return category
  const hint = `${category} ${title}`
  if (/課題|レポート|提出|宿題|発表|論文/.test(hint)) return '課題'
  if (/授業|講義|ゼミ|出席/.test(hint)) return '授業'
  if (/買|購入|注文/.test(hint)) return '買い物'
  if (/バイト|勤務|シフト/.test(hint)) return 'バイト'
  if (/予定|予約|面談|病院|掃除|洗濯|生活|家事/.test(hint)) return '生活'
  return 'その他'
}

function normalizeTask(raw, sourceText) {
  const title = text(raw.title || raw.name)
  if (!title) return null
  const priority = text(raw.priority)
  const deadline = text(raw.deadline || raw.dueDate || raw.due_date)
  const deadlineIsFallback = !deadline
  const ambiguities = [...new Set([...textList(raw.ambiguities || raw.needsConfirmation || raw.needs_confirmation), ...(deadlineIsFallback ? ['締切未指定'] : [])])].slice(0, 5)
  return {
    type: 'task',
    title,
    deadline,
    category: normalizeCategory(raw.category, title),
    priority: allowedPriorities.has(priority) ? priority : '中',
    estimatedMinutes: number(raw.estimatedMinutes || raw.estimated_minutes || raw.minutes, 60),
    memo: text(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いたやること候補',
    sourceText: text(raw.sourceText || raw.source_text) || sourceText,
    confidence: allowedConfidence.has(text(raw.confidence)) ? text(raw.confidence) : deadlineIsFallback ? 'medium' : 'high',
    ambiguities,
    deadlineIsFallback,
  }
}

function normalizeEvent(raw, sourceText) {
  const title = text(raw.title || raw.name || raw.summary)
  if (!title) return null
  const startAt = text(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when || raw.date)
  const startIsFallback = !startAt
  const ambiguities = [...new Set([...textList(raw.ambiguities || raw.needsConfirmation || raw.needs_confirmation), ...(startIsFallback ? ['開始日時未指定'] : [])])].slice(0, 5)
  return {
    type: 'event',
    title,
    startAt,
    endAt: text(raw.endAt || raw.end_at || raw.end || raw.until),
    location: text(raw.location || raw.place || raw.where),
    memo: text(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いた予定候補',
    sourceText: text(raw.sourceText || raw.source_text) || sourceText,
    confidence: allowedConfidence.has(text(raw.confidence)) ? text(raw.confidence) : startIsFallback ? 'low' : 'high',
    ambiguities,
    startIsFallback,
  }
}

function isEventLike(raw) {
  const type = text(raw.type || raw.kind || raw.itemType || raw.item_type).toLowerCase()
  if (['task', 'todo', 'やること', 'タスク'].includes(type)) return false
  if (['event', 'schedule', 'calendar', '予定', 'カレンダー'].includes(type)) return true
  if (raw.deadline || raw.dueDate || raw.due_date) return false
  return !!(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when)
}

function withType(item, type) {
  return item && typeof item === 'object' ? { ...item, type } : item
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

async function redisPipeline(commands) {
  const config = redisConfig()
  if (!config) throw new Error('sync storage is not configured')
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(result) || result.some(item => item?.error)) {
    throw new Error(`sync storage error: ${response.status}`)
  }
  return result.map(item => item?.result)
}

function itemSignature(item) {
  return item.type === 'event'
    ? `${item.type}|${item.title}|${item.startAt}|${item.endAt}|${item.location}`
    : `${item.type}|${item.title}|${item.deadline}|${item.category}`
}

function queueItem(item) {
  const createdAt = new Date().toISOString()
  const id = createHash('sha256').update(itemSignature(item)).digest('hex').slice(0, 24)
  return { ...item, id, createdAt }
}

async function saveQueue(items) {
  const queued = items.map(queueItem)
  const commands = queued.map(item => ['HSET', queueKey, item.id, JSON.stringify(item)])
  commands.push(['EXPIRE', queueKey, String(90 * 24 * 60 * 60)])
  await redisPipeline(commands)
  return queued
}

async function readQueue() {
  const [values = []] = await redisPipeline([['HVALS', queueKey]])
  return (Array.isArray(values) ? values : []).flatMap(value => {
    try { return [JSON.parse(value)] } catch { return [] }
  }).sort((a, b) => text(b.createdAt).localeCompare(text(a.createdAt))).slice(0, 100)
}

async function removeQueue(ids) {
  const safeIds = Array.isArray(ids) ? ids.map(text).filter(Boolean).slice(0, 100) : []
  if (!safeIds.length) return 0
  const [removed = 0] = await redisPipeline([['HDEL', queueKey, ...safeIds]])
  return Number(removed) || 0
}

function requireSyncAuth(req, res) {
  if (!syncAvailable()) {
    send(res, 503, { ok: false, error: '直接同期はまだ設定されていません。' })
    return false
  }
  if (!secureEqual(bearerToken(req), process.env.SYNC_ACCESS_TOKEN)) {
    send(res, 401, { ok: false, error: '同期キーが正しくありません。' })
    return false
  }
  return true
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })

  try {
    if (req.method === 'GET') {
      if (!requireSyncAuth(req, res)) return
      const items = await readQueue()
      return send(res, 200, { ok: true, count: items.length, delivery: 'synced', items })
    }

    if (req.method === 'DELETE') {
      if (!requireSyncAuth(req, res)) return
      const body = await readJson(req)
      const removed = await removeQueue(body.ids)
      return send(res, 200, { ok: true, removed })
    }

    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET, POST or DELETE only' })

    const body = await readJson(req)
    const sourceText = text(body.sourceText || body.source_text || body.originalText || body.original_text)
    const rawItems = [
      ...(Array.isArray(body.items) ? body.items : []),
      ...(Array.isArray(body.tasks) ? body.tasks.map(item => withType(item, 'task')) : []),
      ...(Array.isArray(body.events) ? body.events.map(item => withType(item, 'event')) : []),
      ...(!Array.isArray(body.items) && !Array.isArray(body.tasks) && !Array.isArray(body.events) && (body.task || body.event || body.title)
        ? [body.task && typeof body.task === 'object' ? withType(body.task, 'task') : body.event && typeof body.event === 'object' ? withType(body.event, 'event') : body]
        : []),
    ]
    const items = rawItems.slice(0, 20).map(item => {
      const raw = item && typeof item === 'object' ? item : {}
      return isEventLike(raw) ? normalizeEvent(raw, sourceText) : normalizeTask(raw, sourceText)
    }).filter(Boolean)

    if (!items.length) return send(res, 400, { ok: false, error: '候補の title が必要です。' })

    if (syncAvailable()) {
      if (!requireSyncAuth(req, res)) return
      const queued = await saveQueue(items)
      return send(res, 200, {
        ok: true,
        count: queued.length,
        delivery: 'synced',
        requiresOpen: false,
        message: `${queued.length}件を送りました。内容が明確ならLady Butlerが自動追加します。`,
        items: queued,
      })
    }

    const payload = { source: 'custom-gpt', sourceText, items }
    const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'lady-butler.vercel.app'
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const importUrl = `${protocol}://${host}/#gpt-import=${token}`

    return send(res, 200, {
      ok: true,
      count: items.length,
      delivery: 'link',
      requiresOpen: true,
      importUrl,
      message: 'このリンクを一度開くと、内容が明確なものはLady Butlerへ自動追加されます。',
      items,
    })
  } catch (error) {
    return send(res, 400, { ok: false, error: 'JSONを読み取れませんでした。', detail: String(error?.message || error) })
  }
}
