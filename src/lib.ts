import { useEffect, useState } from 'react'
import type { ChatMessage, ChatMode, DiaryEntry, Mood, MoodLog, Settings, Task } from './types'

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
  const d = new Date(value), diff = Math.ceil((d.getTime() - Date.now()) / 86400000)
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

export function makeButlerReply(input: string, mode: ChatMode, tasks: Task[], moodLogs: MoodLog[] = [], diaries: DiaryEntry[] = []) {
  const latestMood = [...moodLogs].sort((a, b) => b.date.localeCompare(a.date))[0]
  const plan = dayPlan(tasks, latestMood?.mood), top = plan.top
  const taskName = top?.title ?? '新しいタスクの整理'
  const firstStep = top ? firstAction(top) : '気になっていることを1つ、タスクとして登録する'
  const lower = input.toLowerCase()
  const moodContext = latestMood ? `\n\n直近の気分は「${moodInfo(latestMood.mood)?.label}」です。${moodGuidance(latestMood.mood)}` : ''
  const diaryContext = diaries[0]?.carryOver ? ` 日記で明日に回した「${diaries[0].carryOver}」も忘れずに扱います。` : ''
  if (/今日|なにすれば|何すれば/.test(input)) {
    return `レディ、本日の状況を整理いたしました。${moodContext}${diaryContext}\n\n【今日の最優先】\n${taskName}${top ? `（${formatDeadline(top.deadline).label}・残り${100 - top.progress}%）` : ''}\n\n【今日やること】\n${plan.today.map((t, i) => `${i + 1}. ${t.title} — ${Math.max(10, Math.round(t.estimatedMinutes * (100 - t.progress) / 100))}分`).join('\n') || 'まずタスクを1件登録する'}\n\n【余裕があればやること】\n${plan.extra.map(t => `・${t.title}`).join('\n') || '本日は増やさなくて結構です'}\n\n【やらなくていいこと】\n締切の遠い低優先タスク。今は横に置いてください。\n\n【最初の10分】\n${firstStep}。完璧より、着手を優先いたしましょう。`
  }
  if (mode === '進捗報告' || /まだ|半分|できた|進捗|やる気|終わった/.test(input)) {
    if (/終わった|完了|できた/.test(input) && !/ない|まだ/.test(input)) return `よく進めました、レディ。ここで勢いだけに頼らず、一度保存して提出条件を確認しましょう。\n\n次の一手は「抜けがないか3分だけ見直す」です。それが済んだら、次のタスクは ${taskName} です。`
    return `承知しました、レディ。進んでいない事実は確認しますが、責める時間は不要です。${moodContext}\n\n今の最優先は「${taskName}」。まずは ${firstStep} だけ実行してください。10分後に続けるかを判断しましょう。私は味方ですが、言い訳の味方ではありません。`
  }
  if (mode === '課題サポート' || /レポート|課題/.test(input)) return `レディ、まず課題の条件を切り分けましょう。現在の最優先は「${taskName}」です。\n\n最初の一手は、課題文を開いて「問われている動詞」と「提出条件」に線を引くこと。課題サポート画面に指示文とご自身のメモを入れていただければ、構成と下書きの叩き台まで整えます。`
  if (/無理|やばい|詰ん|だめ/.test(input) || lower.includes('help')) return `レディ、大丈夫です。ただし、状況を曖昧なままにすると夜が詰みます。\n\n現在もっとも危ないのは「${taskName}」です。今は100点を狙うより、0点を避ける判断をいたしましょう。\n\n最初の10分は ${firstStep}。それ以外は一度閉じてください。`
  return `承知しました、レディ。お話を整理すると、今は「${taskName}」を軸に考えるのが現実的です。\n\nまず ${firstStep}。10分だけ進めてから、次の判断をいたしましょう。${input.length < 12 ? '\n\nもう少し聞いてほしいだけでしたら、解決を急がずお供します。' : ''}`
}

function firstAction(task: Task) {
  if (task.category === '課題') return task.progress === 0 ? '課題文を開き、見出しを3つ作る' : '直前の文章を読み、100字だけ書き足す'
  if (task.category === '授業') return '資料を開き、確認箇所を3つメモする'
  if (task.category === '買い物') return '買う物をメモにまとめる'
  return `「${task.title}」に必要なものを1つだけ開く`
}

export function assignmentOutput(data: Record<string, string>) {
  const prompt = data.prompt || '入力された課題'
  const memo = data.memo || 'ご自身の授業での気づき'
  return `## 課題の意図\n「${prompt.slice(0, 80)}${prompt.length > 80 ? '…' : ''}」について、授業内容を踏まえた理解と、ご自身の考察を筋道立てて示す課題です。\n\n## 書くべき内容\n- 問題となっているテーマの要点\n- 授業や資料から読み取れる根拠\n- ${memo}をもとにした自分の考え\n- 考察から導ける結論\n\n## 構成案\n1. 導入：テーマと問題意識を提示\n2. 本論：授業内容・資料を根拠に整理\n3. 考察：自分の意見とその理由\n4. 結論：全体を短くまとめる\n\n## 下書き\n本課題では、${prompt.slice(0, 48)}について考察する。授業で扱った内容を踏まえると、このテーマで重要なのは、事実を整理したうえで自分の立場を明確にすることである。とくに、${memo.slice(0, 70)}という点に注目したい。これは、単に知識として理解するだけでなく、実際の状況との関係を考える必要があるからだ。以上から、このテーマは複数の視点を比較しながら検討することが重要だと考える。\n\n> この下書きは叩き台です。資料の事実とご自身の具体例を加えて、提出物にしてください。\n\n## 提出前チェックリスト\n- [ ] 課題文の問いに直接答えている\n- [ ] 資料の出典・事実を確認した\n- [ ] 自分の意見と理由が入っている\n- [ ] 指定文字数（${data.wordCount || '未指定'}）に収まっている\n- [ ] 誤字脱字と提出形式を確認した`
}

export function initialMessages(): ChatMessage[] {
  return [{ id: crypto.randomUUID(), role: 'assistant', content: 'お帰りなさいませ、レディ。\n本日も、止まったところから一緒に片づけましょう。何が気になっていますか？', createdAt: new Date().toISOString(), mode: '通常相談' }]
}
