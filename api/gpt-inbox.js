import { createHash } from 'node:crypto'
import { actionAuthAvailable, authorizeActionRequest, authorizeSyncRequest, redisPipeline, syncAuthAvailable, text } from '../server/sync-auth.js'

const allowedCategories = new Set(['課題', '授業', '生活', 'バイト', '買い物', 'その他'])
const allowedPriorities = new Set(['高', '中', '低'])
const allowedConfidence = new Set(['high', 'medium', 'low'])
const allowedRecurrence = new Set(['none', 'daily', 'weekly', 'monthly'])
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

function shortText(value, max = 500) {
  return text(value).slice(0, max)
}

function textList(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 5) : []
}

function number(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(text(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(720, Math.max(5, Math.round(parsed / 5) * 5))
}

function validDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function normalizeDate(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return ''
  const [, year, month, day] = match
  return validDateParts(Number(year), Number(month), Number(day)) ? `${year}-${month}-${day}` : ''
}

function normalizeLocalDateTime(value, allowDateOnly = false) {
  const raw = text(value)
  if (allowDateOnly) {
    const date = normalizeDate(raw)
    if (date) return `${date}T23:59`
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?$/)
  if (!match) return ''
  const [, year, month, day, hour, minute] = match
  if (!validDateParts(Number(year), Number(month), Number(day)) || Number(hour) > 23 || Number(minute) > 59) return ''
  return `${year}-${month}-${day}T${hour}:${minute}`
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
  const title = shortText(raw.title || raw.name, 120)
  if (!title) return null
  const priority = text(raw.priority)
  const rawDeadline = text(raw.deadline || raw.dueDate || raw.due_date)
  const deadline = normalizeLocalDateTime(rawDeadline, true)
  const deadlineInvalid = !!rawDeadline && !deadline
  const deadlineIsFallback = !deadline
  const ambiguities = [...new Set([...textList(raw.ambiguities || raw.needsConfirmation || raw.needs_confirmation), ...(deadlineInvalid ? ['締切の日時形式を確認'] : [])])].slice(0, 5)
  const rawTaskType = text(raw.taskType || raw.task_type || raw.repeat || raw.routine).toLowerCase()
  return {
    type: 'task',
    title,
    deadline,
    category: normalizeCategory(raw.category, title),
    priority: allowedPriorities.has(priority) ? priority : '中',
    estimatedMinutes: number(raw.estimatedMinutes || raw.estimated_minutes || raw.minutes, 60),
    taskType: ['daily', 'everyday', 'every_day', '毎日', '日課'].includes(rawTaskType) ? 'daily' : 'temporary',
    memo: shortText(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いたやること候補',
    sourceText: shortText(raw.sourceText || raw.source_text) || sourceText,
    confidence: allowedConfidence.has(text(raw.confidence)) ? text(raw.confidence) : deadlineIsFallback ? 'medium' : 'high',
    ambiguities,
    deadlineIsFallback,
  }
}

function normalizeEvent(raw, sourceText) {
  const title = shortText(raw.title || raw.name || raw.summary, 120)
  if (!title) return null
  const rawStart = text(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when || raw.date)
  const rawEnd = text(raw.endAt || raw.end_at || raw.end || raw.until)
  const startAt = normalizeLocalDateTime(rawStart)
  const endAt = normalizeLocalDateTime(rawEnd)
  const invalidStart = !!rawStart && !startAt
  const invalidEnd = !!rawEnd && (!endAt || (startAt && endAt <= startAt))
  const startIsFallback = !startAt
  const ambiguities = [...new Set([
    ...textList(raw.ambiguities || raw.needsConfirmation || raw.needs_confirmation),
    ...(startIsFallback ? [invalidStart ? '開始日時を確認' : '開始日時未指定'] : []),
    ...(invalidEnd ? ['終了日時を確認'] : []),
  ])].slice(0, 5)
  const recurrence = text(raw.recurrence || raw.repeat || raw.frequency).toLowerCase()
  return {
    type: 'event',
    title,
    startAt,
    endAt: invalidEnd ? '' : endAt,
    location: shortText(raw.location || raw.place || raw.where, 200),
    memo: shortText(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いた予定候補',
    recurrence: allowedRecurrence.has(recurrence) ? recurrence : 'none',
    recurrenceUntil: normalizeDate(raw.recurrenceUntil || raw.recurrence_until || raw.repeatUntil || raw.repeat_until),
    sourceText: shortText(raw.sourceText || raw.source_text) || sourceText,
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

async function requireSyncAuth(req, res) {
  if (!(await syncAuthAvailable())) {
    send(res, 503, { ok: false, error: '直接同期はまだ設定されていません。' })
    return false
  }
  if (!(await authorizeSyncRequest(req))) {
    send(res, 401, { ok: false, error: '同期キーが正しくありません。' })
    return false
  }
  return true
}

async function requireActionAuth(req, res) {
  if (!(await actionAuthAvailable())) {
    send(res, 503, { ok: false, error: 'GPT連携用ストレージが未設定です。' })
    return false
  }
  if (!(await authorizeActionRequest(req))) {
    send(res, 401, { ok: false, error: 'GPT連携キーが正しくありません。' })
    return false
  }
  return true
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })

  try {
    if (req.method === 'GET') {
      if (!(await requireSyncAuth(req, res))) return
      const items = await readQueue()
      return send(res, 200, { ok: true, count: items.length, delivery: 'synced', items })
    }

    if (req.method === 'DELETE') {
      if (!(await requireSyncAuth(req, res))) return
      const body = await readJson(req)
      const removed = await removeQueue(body.ids)
      return send(res, 200, { ok: true, removed })
    }

    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET, POST or DELETE only' })

    const body = await readJson(req)
    const sourceText = shortText(body.sourceText || body.source_text || body.originalText || body.original_text)
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

    if (await actionAuthAvailable()) {
      if (!(await requireActionAuth(req, res))) return
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
