import { timingSafeEqual } from 'node:crypto'

const dataKey = 'lady-butler:app-data:v1'

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Authorization')
  res.end(JSON.stringify(data))
}

const text = value => typeof value === 'string' ? value.trim() : ''

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

function requireAuth(req, res) {
  const config = redisConfig()
  if (!config || !text(process.env.SYNC_ACCESS_TOKEN)) {
    send(res, 503, { ok: false, error: 'GPT参照用の同期ストレージが未設定です。' })
    return null
  }
  if (!secureEqual(bearerToken(req), process.env.SYNC_ACCESS_TOKEN)) {
    send(res, 401, { ok: false, error: '同期キーが正しくありません。' })
    return null
  }
  return config
}

async function readEnvelope(config) {
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([['GET', dataKey]]),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !Array.isArray(result) || result[0]?.error) throw new Error(`sync storage error: ${response.status}`)
  const raw = result[0]?.result
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : []
const score = { very_good: 5, good: 4, normal: 3, tired: 2, exhausted: 1 }
const timeZone = 'Asia/Tokyo'

function localParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date)
  return Object.fromEntries(parts.map(part => [part.type, part.value]))
}

function contextFrom(envelope) {
  const data = envelope?.data && typeof envelope.data === 'object' ? envelope.data : {}
  const settings = data.settings && typeof data.settings === 'object' ? data.settings : {}
  const shareTasks = settings.gptShareTasks !== false
  const shareMood = settings.gptShareMood !== false
  const shareDiary = settings.gptShareDiary !== false
  const now = new Date()
  const nowIso = now.toISOString()
  const local = localParts(now)
  const today = `${local.year}-${local.month}-${local.day}`
  const currentLocalDateTime = `${today}T${local.hour}:${local.minute}`

  const tasks = shareTasks ? list(data.tasks)
    .filter(task => task.status !== '完了')
    .sort((a, b) => {
      const left = new Date(a.deadline || '9999-12-31').getTime()
      const right = new Date(b.deadline || '9999-12-31').getTime()
      return left - right
    }).slice(0, 30)
    .map(task => ({ id: task.id, title: task.title, deadline: task.deadline || null, category: task.category, priority: task.priority, progress: task.progress, estimatedMinutes: task.estimatedMinutes, status: task.status, memo: task.memo || '' })) : []

  const events = shareTasks ? list(data.events)
    .filter(event => event.recurrence && event.recurrence !== 'none' || new Date(event.endAt || event.startAt).getTime() >= now.getTime() - 3600000)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()).slice(0, 30)
    .map(event => ({ id: event.id, title: event.title, startAt: event.startAt, endAt: event.endAt, location: event.location || '', memo: event.memo || '', recurrence: event.recurrence || 'none', recurrenceUntil: event.recurrenceUntil || null })) : []

  const moodLogs = shareMood ? list(data.moodLogs)
    .sort((a, b) => text(b.date).localeCompare(text(a.date))).slice(0, 7)
    .map(log => ({ date: log.date, mood: log.mood, memo: log.memo || '' })) : []

  const diaries = shareDiary ? list(data.diaries)
    .sort((a, b) => text(b.date).localeCompare(text(a.date))).slice(0, 5)
    .map(entry => ({ date: entry.date, mood: entry.mood, doneToday: entry.doneToday || '', hardThings: entry.hardThings || '', carryOver: entry.carryOver || '', freeMemo: entry.freeMemo || '', aiComment: entry.aiComment || '' })) : []

  const moodAverage = moodLogs.length ? moodLogs.reduce((sum, item) => sum + (score[item.mood] || 3), 0) / moodLogs.length : null
  const guidance = moodAverage !== null && moodAverage <= 2
    ? '最近の気分が低めです。緊急の提出・連絡を優先し、作業量は少なく提案してください。'
    : moodAverage !== null && moodAverage >= 4
      ? '最近は比較的余力があります。最優先の後に、一つだけ前倒しを提案できます。'
      : '締切・予定・気分を合わせて、無理のない量を提案してください。'

  return {
    ok: true,
    generatedAt: nowIso,
    currentLocalDateTime,
    today,
    timeZone,
    locale: 'ja-JP',
    profile: { name: text(settings.name) || 'レディ', tone: settings.tone || '執事', strictness: settings.strictness || '標準' },
    sharing: { tasksAndEvents: shareTasks, mood: shareMood, diary: shareDiary },
    summary: { openTaskCount: tasks.length, upcomingEventCount: events.length, recentMoodCount: moodLogs.length, recentDiaryCount: diaries.length },
    tasks,
    events,
    moodLogs,
    diaries,
    guidance,
    usageNote: '必要な内容だけ自然に反映し、日記を長く引用しないでください。記録がない項目は推測しないでください。相対日付はcurrentLocalDateTimeとtimeZoneを基準に絶対日時へ直してください。ユーザーが記録しないでと明言した内容は送信しないでください。',
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'GET only' })
  const config = requireAuth(req, res)
  if (!config) return
  try {
    const envelope = await readEnvelope(config)
    const context = contextFrom(envelope || { data: {} })
    return send(res, 200, envelope ? context : { ...context, exists: false, message: 'Lady Butlerにはまだ同期データがありません。' })
  } catch (error) {
    return send(res, 500, { ok: false, error: 'Lady Butlerの記録を読み取れませんでした。', detail: String(error?.message || error) })
  }
}
