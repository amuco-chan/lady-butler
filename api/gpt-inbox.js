const allowedCategories = new Set(['課題', '授業', '生活', 'バイト', '買い物', 'その他'])
const allowedPriorities = new Set(['高', '中', '低'])

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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
  return {
    type: 'task',
    title,
    deadline: text(raw.deadline || raw.dueDate || raw.due_date),
    category: normalizeCategory(raw.category, title),
    priority: allowedPriorities.has(priority) ? priority : '中',
    estimatedMinutes: number(raw.estimatedMinutes || raw.estimated_minutes || raw.minutes, 60),
    memo: text(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いたやること候補',
    sourceText: text(raw.sourceText || raw.source_text) || sourceText,
  }
}

function normalizeEvent(raw, sourceText) {
  const title = text(raw.title || raw.name || raw.summary)
  if (!title) return null
  return {
    type: 'event',
    title,
    startAt: text(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when || raw.date),
    endAt: text(raw.endAt || raw.end_at || raw.end || raw.until),
    location: text(raw.location || raw.place || raw.where),
    memo: text(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いた予定候補',
    sourceText: text(raw.sourceText || raw.source_text) || sourceText,
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })

  try {
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
    const items = rawItems.map(item => {
      const raw = item && typeof item === 'object' ? item : {}
      return isEventLike(raw) ? normalizeEvent(raw, sourceText) : normalizeTask(raw, sourceText)
    }).filter(Boolean)

    if (!items.length) return send(res, 400, { ok: false, error: '候補の title が必要です。' })

    const payload = { source: 'custom-gpt', sourceText, items }
    const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'lady-butler.vercel.app'
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const importUrl = `${protocol}://${host}/#gpt-import=${token}`

    return send(res, 200, {
      ok: true,
      count: items.length,
      importUrl,
      message: 'このURLを開くと、Lady ButlerのGPT受信箱に候補として入ります。ユーザーが確認するまで、やることや予定には確定されません。',
      items,
    })
  } catch (error) {
    return send(res, 400, { ok: false, error: 'JSONを読み取れませんでした。', detail: String(error?.message || error) })
  }
}
const allowedCategories = new Set(['課題', '授業', '生活', 'バイト', '予定', '買い物', 'その他'])
const allowedPriorities = new Set(['高', '中', '低'])

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
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

function number(value, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(text(value), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(720, Math.max(5, Math.round(parsed / 5) * 5))
}

function normalizeTask(raw, sourceText) {
  const title = text(raw.title || raw.name)
  if (!title) return null
  const category = text(raw.category)
  const priority = text(raw.priority)
  return {
    type: 'task',
    title,
    deadline: text(raw.deadline || raw.dueDate || raw.due_date),
    category: allowedCategories.has(category) ? category : '課題',
    priority: allowedPriorities.has(priority) ? priority : '中',
    estimatedMinutes: number(raw.estimatedMinutes || raw.estimated_minutes || raw.minutes, 60),
    memo: text(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いたタスク候補',
    sourceText: text(raw.sourceText || raw.source_text) || sourceText,
  }
}

function normalizeEvent(raw, sourceText) {
  const title = text(raw.title || raw.name || raw.summary)
  if (!title) return null
  return {
    type: 'event',
    title,
    startAt: text(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when || raw.date),
    endAt: text(raw.endAt || raw.end_at || raw.end || raw.until),
    location: text(raw.location || raw.place || raw.where),
    memo: text(raw.memo || raw.note || raw.notes || raw.description) || 'GPTから届いた予定候補',
    sourceText: text(raw.sourceText || raw.source_text) || sourceText,
  }
}

function isEventLike(raw) {
  const type = text(raw.type || raw.kind || raw.itemType || raw.item_type).toLowerCase()
  return ['event', 'schedule', 'calendar', '予定', 'カレンダー'].includes(type) || !!(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when)
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })

  try {
    const body = await readJson(req)
    const sourceText = text(body.sourceText || body.source_text || body.originalText || body.original_text)
    const rawItems = [
      ...(Array.isArray(body.items) ? body.items : []),
      ...(Array.isArray(body.tasks) ? body.tasks : []),
      ...(Array.isArray(body.events) ? body.events : []),
      ...(!Array.isArray(body.items) && !Array.isArray(body.tasks) && !Array.isArray(body.events) && (body.task || body.event || body.title)
        ? [body.task && typeof body.task === 'object' ? body.task : body.event && typeof body.event === 'object' ? body.event : body]
        : []),
    ]
    const items = rawItems.map(item => {
      const raw = item && typeof item === 'object' ? item : {}
      return isEventLike(raw) ? normalizeEvent(raw, sourceText) : normalizeTask(raw, sourceText)
    }).filter(Boolean)

    if (!items.length) return send(res, 400, { ok: false, error: '候補の title が必要です。' })

    const payload = { source: 'custom-gpt', sourceText, items }
    const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'lady-butler.vercel.app'
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const importUrl = `${protocol}://${host}/#gpt-import=${token}`

    return send(res, 200, {
      ok: true,
      count: items.length,
      importUrl,
      message: 'このURLを開くと、Lady ButlerのGPT受信箱に候補として入ります。ユーザーが確認するまでタスクや予定には確定されません。',
      items,
    })
  } catch (error) {
    return send(res, 400, { ok: false, error: 'JSONを読み取れませんでした。', detail: String(error?.message || error) })
  }
}
