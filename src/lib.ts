import { useEffect, useState } from 'react'
import type { CalendarEvent, Category, DiaryEntry, GptInboxEventItem, GptInboxItem, GptInboxTaskItem, Mood, MoodLog, Priority, Settings, Task } from './types'

const todayAt = (hour: number, addDays = 0) => {
  const date = new Date()
  date.setDate(date.getDate() + addDays)
  date.setHours(hour, 59, 0, 0)
  return toLocalDateTimeValue(date)
}

export function toLocalDateTimeValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const sampleTasks: Task[] = [
  { id: crypto.randomUUID(), title: '心理学レポートの構成を作る', deadline: todayAt(23, 1), category: '課題', priority: '高', progress: 25, estimatedMinutes: 90, status: '進行中', memo: '授業資料の第3章を引用する', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: crypto.randomUUID(), title: 'ゼミ発表の資料を確認', deadline: todayAt(18, 3), category: '授業', priority: '中', progress: 0, estimatedMinutes: 40, status: '未着手', memo: '先生のコメントを反映', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
  { id: crypto.randomUUID(), title: '日用品を買う', deadline: todayAt(20, 5), category: '買い物', priority: '低', progress: 0, estimatedMinutes: 20, status: '未着手', memo: '洗剤、ティッシュ', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
]

export const defaultSettings: Settings = { tone: '執事', strictness: '標準', notifications: '標準', name: 'レディ' }

export function useStoredState<T>(key: string, initial: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => {
    try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : initial } catch { return initial }
  })
  useEffect(() => { localStorage.setItem(key, JSON.stringify(state)) }, [key, state])
  return [state, setState]
}

export const priorityWeight = { 高: 3, 中: 2, 低: 1 } as const
export const categories: Category[] = ['課題', '授業', '生活', 'バイト', '予定', '買い物', 'その他']
export const priorities: Priority[] = ['高', '中', '低']

export function rankedTasks(tasks: Task[]) {
  return tasks.filter(t => t.status !== '完了').sort((a, b) => {
    const timeA = new Date(a.deadline).getTime(), timeB = new Date(b.deadline).getTime()
    const urgencyA = Math.max(0, 7 - (timeA - Date.now()) / 86400000)
    const urgencyB = Math.max(0, 7 - (timeB - Date.now()) / 86400000)
    return (urgencyB + priorityWeight[b.priority] * 2 + (100 - b.progress) / 50) - (urgencyA + priorityWeight[a.priority] * 2 + (100 - a.progress) / 50)
  })
}

export const moodOptions: { value: Mood; emoji: string; label: string; short: string; score: number }[] = [
  { value: 'very_good', emoji: '😊', label: 'とても良い', short: '絶好調', score: 5 },
  { value: 'good', emoji: '🙂', label: '良い', short: '良い', score: 4 },
  { value: 'normal', emoji: '😐', label: '普通', short: '普通', score: 3 },
  { value: 'tired', emoji: '😞', label: 'しんどい', short: 'しんどい', score: 2 },
  { value: 'exhausted', emoji: '…', label: 'かなり無理', short: '限界', score: 1 },
]

export const moodInfo = (mood?: Mood) => moodOptions.find(item => item.value === mood)
export const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

export function dayPlan(tasks: Task[], mood?: Mood) {
  const ranked = rankedTasks(tasks)
  const count = mood === 'exhausted' ? 1 : mood === 'tired' ? 2 : mood === 'good' ? 4 : mood === 'very_good' ? 5 : 3
  return { top: ranked[0], today: ranked.slice(0, count), extra: ranked.slice(count, count + 2), later: ranked.slice(count + 2) }
}

export function formatDeadline(value: string, compact = false) {
  const d = new Date(value)
  const dDate = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const now = new Date()
  const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diffTime = dDate.getTime() - nowDate.getTime()
  const diff = Math.round(diffTime / 86400000)

  const label = diff < 0 ? `${Math.abs(diff)}日超過` : diff === 0 ? '今日' : diff === 1 ? '明日' : `${diff}日後`
  const date = new Intl.DateTimeFormat('ja-JP', compact ? { month: 'numeric', day: 'numeric' } : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
  return { date, label, urgent: diff <= 1 }
}

export function formatEventTime(event: Pick<CalendarEvent, 'startAt' | 'endAt'>) {
  const start = new Date(event.startAt)
  const end = new Date(event.endAt)
  const safeStart = Number.isNaN(start.getTime()) ? new Date() : start
  const safeEnd = Number.isNaN(end.getTime()) ? new Date(safeStart.getTime() + 60 * 60 * 1000) : end
  const startDate = new Date(safeStart.getFullYear(), safeStart.getMonth(), safeStart.getDate())
  const todayDate = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  const diff = Math.round((startDate.getTime() - todayDate.getTime()) / 86400000)
  const label = diff < 0 ? `${Math.abs(diff)}日前` : diff === 0 ? '今日' : diff === 1 ? '明日' : `${diff}日後`
  const date = new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' }).format(safeStart)
  const startTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(safeStart)
  const endTime = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit' }).format(safeEnd)
  const sameDay = localDate(safeStart) === localDate(safeEnd)
  return {
    date,
    time: sameDay ? `${startTime} - ${endTime}` : `${startTime} - ${new Intl.DateTimeFormat('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(safeEnd)}`,
    label,
    today: diff === 0,
    past: diff < 0,
  }
}

export function moodGuidance(mood?: Mood) {
  if (mood === 'very_good') return '本日は余力がありそうです。最優先のあと、先延ばししていたものにも少し触れましょう。'
  if (mood === 'good') return '調子は良さそうです。最優先に加えて、もう一つだけ前倒ししておきましょう。'
  if (mood === 'tired') return '本日は詰め込む日ではありません。最優先と最初の10分だけに絞りましょう。'
  if (mood === 'exhausted') return '本日は緊急の提出・連絡だけで十分です。難しければ休息と、信頼できる方への一言を優先してください。'
  return '締切と優先度に沿って、無理のない順番で進めましょう。'
}

export function moodTrend(logs: MoodLog[]) {
  const recent = [...logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
  if (!recent.length) return '気分を記録すると、予定の組み方に反映します。'
  const average = recent.reduce((sum, log) => sum + (moodInfo(log.mood)?.score ?? 3), 0) / recent.length
  if (recent.length >= 2 && average <= 2) return `ここ${recent.length}日、気分が低めです。今日は最低限のタスクだけに絞りましょう。`
  if (average >= 4) return '最近は調子が安定しています。余力は、前倒しに少しだけ使いましょう。'
  return '最近の気分は大きく崩れていません。いつものペースで十分です。'
}

export function makeDiaryComment(entry: Pick<DiaryEntry, 'mood' | 'doneToday' | 'hardThings' | 'carryOver'>) {
  const done = entry.doneToday.trim() || '今日をここまで過ごせたこと'
  const hard = entry.hardThings.trim() || (entry.mood === 'tired' || entry.mood === 'exhausted' ? '心身の余力が少なかったこと' : '大きな負担は未記入です')
  const carry = entry.carryOver.trim() || '明日の最優先を一つ決めること'
  const ending = entry.mood === 'exhausted' ? '今夜は回復が仕事です。必要なら、信頼できる方に一言だけでもお伝えください。' : entry.mood === 'tired' ? '明日は10分だけ着手できれば十分です。' : '本日の前進を、明日の最初の一手につなげましょう。'
  return `レディ、本日できたことは「${done}」です。完璧でなくとも、これは前進です。\n\nしんどかった点は「${hard}」。ここは根性で押し切るより、負担として認めるのが現実的です。\n\n明日に回すのは「${carry}」。最初から全部ではなく、もっとも小さな一手から始めましょう。\n\n${ending}`
}

const textOf = (value: unknown) => typeof value === 'string' ? value.trim() : ''

export function normalizeCategory(value: unknown, title = ''): Category {
  const text = textOf(value)
  if (categories.includes(text as Category)) return text as Category
  if (/課題|レポート|提出|宿題|発表|論文/.test(`${text} ${title}`)) return '課題'
  if (/授業|講義|ゼミ|出席/.test(`${text} ${title}`)) return '授業'
  if (/買|購入|注文/.test(`${text} ${title}`)) return '買い物'
  if (/バイト|勤務|シフト/.test(`${text} ${title}`)) return 'バイト'
  if (/予定|予約|面談|病院/.test(`${text} ${title}`)) return '予定'
  if (/掃除|洗濯|生活|家事/.test(`${text} ${title}`)) return '生活'
  return 'その他'
}

export function normalizePriority(value: unknown): Priority {
  const text = textOf(value)
  if (priorities.includes(text as Priority)) return text as Priority
  if (/高|急|重要|最優先|やば|危険/.test(text)) return '高'
  if (/低|余裕|いつでも/.test(text)) return '低'
  return '中'
}

export function normalizeDeadline(value: unknown) {
  const fallback = new Date(Date.now() + 86400000)
  fallback.setHours(23, 59, 0, 0)
  const text = textOf(value)
  if (!text) return toLocalDateTimeValue(fallback)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T23:59`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return text
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) return toLocalDateTimeValue(date)
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? toLocalDateTimeValue(fallback) : toLocalDateTimeValue(date)
}

export function normalizeEventStart(value: unknown) {
  const fallback = new Date(Date.now() + 86400000)
  fallback.setHours(9, 0, 0, 0)
  const text = textOf(value)
  if (!text) return toLocalDateTimeValue(fallback)
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text}T09:00`
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)) return text
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:/.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) return toLocalDateTimeValue(date)
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? toLocalDateTimeValue(fallback) : toLocalDateTimeValue(date)
}

export function normalizeEventEnd(startAt: string, value: unknown) {
  const text = textOf(value)
  const start = new Date(startAt)
  const fallback = Number.isNaN(start.getTime()) ? new Date(Date.now() + 25 * 60 * 60 * 1000) : new Date(start.getTime() + 60 * 60 * 1000)
  if (!text) return toLocalDateTimeValue(fallback)
  const normalized = normalizeEventStart(text)
  const end = new Date(normalized)
  if (Number.isNaN(end.getTime()) || end <= start) return toLocalDateTimeValue(fallback)
  return normalized
}

export function normalizeEstimatedMinutes(value: unknown) {
  const number = typeof value === 'number' ? value : Number.parseInt(textOf(value), 10)
  if (!Number.isFinite(number)) return 60
  return Math.min(720, Math.max(5, Math.round(number / 5) * 5))
}

function isEventLike(raw: Record<string, unknown>) {
  const type = textOf(raw.type || raw.kind || raw.itemType || raw.item_type).toLowerCase()
  return ['event', 'schedule', 'calendar', '予定', 'カレンダー'].includes(type) || !!(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when)
}

function normalizeGptTask(raw: Record<string, unknown>, sourceText: string, now: string): GptInboxTaskItem[] {
  const title = textOf(raw.title || raw.name)
  if (!title) return []
  const itemSource = textOf(raw.sourceText || raw.source_text) || sourceText
  const memo = textOf(raw.memo || raw.note || raw.notes || raw.description)
  return [{
    id: crypto.randomUUID(),
    type: 'task',
    title,
    deadline: normalizeDeadline(raw.deadline || raw.dueDate || raw.due_date),
    category: normalizeCategory(raw.category, title),
    priority: normalizePriority(raw.priority),
    estimatedMinutes: normalizeEstimatedMinutes(raw.estimatedMinutes || raw.estimated_minutes || raw.minutes),
    memo: memo || (itemSource ? `GPTより：${itemSource}` : 'GPTから届いたタスク候補'),
    sourceText: itemSource,
    createdAt: now,
  }]
}

function normalizeGptEvent(raw: Record<string, unknown>, sourceText: string, now: string): GptInboxEventItem[] {
  const title = textOf(raw.title || raw.name || raw.summary)
  if (!title) return []
  const itemSource = textOf(raw.sourceText || raw.source_text) || sourceText
  const startAt = normalizeEventStart(raw.startAt || raw.start_at || raw.start || raw.dateTime || raw.datetime || raw.when || raw.date)
  const endAt = normalizeEventEnd(startAt, raw.endAt || raw.end_at || raw.end || raw.until)
  const memo = textOf(raw.memo || raw.note || raw.notes || raw.description)
  return [{
    id: crypto.randomUUID(),
    type: 'event',
    title,
    startAt,
    endAt,
    location: textOf(raw.location || raw.place || raw.where),
    memo: memo || (itemSource ? `GPTより：${itemSource}` : 'GPTから届いた予定候補'),
    sourceText: itemSource,
    createdAt: now,
  }]
}

export function normalizeGptInboxPayload(payload: unknown, now = new Date().toISOString()): GptInboxItem[] {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
  const rawItems = [
    ...(Array.isArray(root.items) ? root.items : []),
    ...(Array.isArray(root.tasks) ? root.tasks : []),
    ...(Array.isArray(root.events) ? root.events : []),
    ...(!Array.isArray(root.items) && !Array.isArray(root.tasks) && !Array.isArray(root.events) && (root.title || root.task || root.event)
      ? [root.task && typeof root.task === 'object' ? root.task : root.event && typeof root.event === 'object' ? root.event : root]
      : []),
  ]
  const sourceText = textOf(root.sourceText || root.source_text || root.originalText || root.original_text)
  return rawItems.flatMap((item): GptInboxItem[] => {
    const raw = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return isEventLike(raw) ? normalizeGptEvent(raw, sourceText, now) : normalizeGptTask(raw, sourceText, now)
  })
}

export function parseGptImportHash(hash: string) {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash
  const token = new URLSearchParams(clean).get('gpt-import')
  if (!token) return []
  try {
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/')
    const padded = `${base64}${'='.repeat((4 - base64.length % 4) % 4)}`
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    const json = new TextDecoder().decode(bytes)
    return normalizeGptInboxPayload(JSON.parse(json))
  } catch {
    return []
  }
}

export function inboxItemToTask(item: GptInboxTaskItem): Task {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: item.title,
    deadline: item.deadline,
    category: item.category,
    priority: item.priority,
    progress: 0,
    estimatedMinutes: item.estimatedMinutes,
    status: '未着手',
    memo: item.memo,
    createdAt: now,
    updatedAt: now,
  }
}

export function inboxItemToEvent(item: GptInboxEventItem): CalendarEvent {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    title: item.title,
    startAt: item.startAt,
    endAt: item.endAt,
    location: item.location,
    memo: item.memo,
    createdAt: now,
    updatedAt: now,
  }
}
