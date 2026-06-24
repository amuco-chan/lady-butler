import { useEffect, useState } from 'react'
import type { DiaryEntry, Mood, MoodLog, Settings, Task } from './types'

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
