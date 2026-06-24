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
  const text = Buffer.concat(chunks).toString('utf8')
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

function normalizeItem(raw, sourceText) {
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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'POST only' })

  try {
    const body = await readJson(req)
    const sourceText = text(body.sourceText || body.source_text || body.originalText || body.original_text)
    const rawItems = Array.isArray(body.items) ? body.items : Array.isArray(body.tasks) ? body.tasks : body.task ? [body.task] : [body]
    const items = rawItems.map(item => normalizeItem(item && typeof item === 'object' ? item : {}, sourceText)).filter(Boolean)

    if (!items.length) return send(res, 400, { ok: false, error: 'タスク候補の title が必要です。' })

    const payload = { source: 'custom-gpt', sourceText, items }
    const token = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'lady-butler.vercel.app'
    const protocol = req.headers['x-forwarded-proto'] || 'https'
    const importUrl = `${protocol}://${host}/#gpt-import=${token}`

    return send(res, 200, {
      ok: true,
      count: items.length,
      importUrl,
      message: 'このURLを開くと、Lady ButlerのGPT受信箱に候補として入ります。ユーザーが確認するまでタスクには確定されません。',
      items,
    })
  } catch (error) {
    return send(res, 400, { ok: false, error: 'JSONを読み取れませんでした。', detail: String(error?.message || error) })
  }
}
