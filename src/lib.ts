import { useEffect, useState } from 'react'
import type { Category, ChatMessage, ChatMode, DiaryEntry, Mood, MoodLog, Priority, Settings, Task } from './types'

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

export const defaultSettings: Settings = { tone: '執事', strictness: '標準', notifications: '標準', name: 'レディ', aiMode: 'free_gpt', aiAccessToken: '' }

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

export function makeButlerReply(input: string, mode: ChatMode, tasks: Task[], moodLogs: MoodLog[] = [], diaries: DiaryEntry[] = [], settings: Settings = defaultSettings, history: ChatMessage[] = []) {
  const text = input.trim()
  const latestMood = [...moodLogs].sort((a, b) => b.date.localeCompare(a.date))[0]
  const plan = dayPlan(tasks, latestMood?.mood), top = plan.top
  const taskName = top?.title ?? '新しいタスクの整理'
  const firstStep = top ? firstAction(top) : '気になっていることを1つ、タスクとして登録する'
  const lady = settings.name.trim() || 'レディ'
  const concise = settings.tone === '簡潔'
  const gentle = settings.tone === 'やさしい' || settings.strictness === 'やさしめ'
  const strict = settings.strictness === '厳しめ'
  const lastAssistant = [...history].reverse().find(message => message.role === 'assistant')?.content ?? ''
  const moodLine = latestMood ? `直近の気分は「${moodInfo(latestMood.mood)?.label}」。${moodGuidance(latestMood.mood)}` : ''
  const diaryLine = diaries[0]?.carryOver ? `日記に残した「${diaries[0].carryOver}」も候補に入れます。` : ''

  if (/死にたい|消えたい|自傷|自分を傷つけ|殺したい/.test(text)) {
    return `${lady}、今は一人で抱えないでください。私はここで話を聞けますが、この状況を私だけで支えることはできません。\n\n今すぐ危険があるなら、緊急サービスへ連絡するか、近くの信頼できる方に「一人にしないで」と伝えてください。短い一言で構いません。`
  }

  if (/^(ありがとう|ありがと|助かった|サンキュー)[。！!]*$/.test(text)) {
    return concise ? `どういたしまして、${lady}。` : `どういたしまして、${lady}。必要になったら、いつでも続きをお聞かせください。`
  }

  if (/^(おはよう|こんにちは|こんばんは|ただいま|やっほー|やっほ)[。！!]*$/.test(text)) {
    const greeting = /おはよう/.test(text) ? 'おはようございます' : /こんばんは/.test(text) ? 'こんばんは' : /ただいま/.test(text) ? 'お帰りなさいませ' : 'こんにちは'
    return `${greeting}、${lady}。${moodLine ? ` ${moodLine}` : ''}\n今日は、相談・予定の整理・ただのお話、どれから始めましょうか。`
  }

  if (/^(うん|はい|そう|そうだね|わかった|了解|なるほど|おっけー|OK)[。！!]*$/i.test(text)) {
    if (!lastAssistant || /何があった|聞かせて|教えて|ですか|ましょうか|[？?]/.test(lastAssistant)) return `はい、${lady}。急がなくて大丈夫です。続けてください。`
    return concise ? `承知しました。` : `承知しました、${lady}。また話したくなったところから続けましょう。`
  }

  if (/話を?聞いて|ただ聞いて|愚痴|相談(?:に)?乗って|聞いてほしい/.test(text)) {
    return `${lady}、もちろんです。今は結論を急がずに聞きます。うまく整理しなくて構いません。何があったか、そのまま話してください。`
  }

  if (/彼氏|彼女|好きな人|恋愛|友達|人間関係|返信|既読|LINE|家族|先生|同僚|バイト先/.test(text)) {
    if (/むかつく|腹立|イライラ|嫌い/.test(text)) return `${lady}、それは腹が立ちますね。今は無理にきれいにまとめなくて構いません。\nまず、相手が実際にしたことと、そこから感じたことを分けて話してみてください。`
    return `${lady}、それは気になりますよね。相手の反応だけで結論を決める前に、まず「実際に起きたこと」と「自分がどう感じたか」を分けましょう。\nよければ、いちばん引っかかっている場面を一つだけ教えてください。`
  }

  if (/夕飯|晩ごはん|ご飯何|何食べ|食事/.test(text)) {
    return `${lady}、今日は手間で決めましょう。\n余力なしなら買う・頼む、少しなら丼か麺、動けるなら温かい汁物を足す。この三択なら、今の体力に近いのはどれですか。`
  }

  if (/今日|なにすれば|何すれば/.test(text) && !/終わった|完了|できた|進捗/.test(text)) {
    return `${lady}、今日の分だけに絞ります。${moodLine ? `\n${moodLine}` : ''}${diaryLine ? `\n${diaryLine}` : ''}\n\n【今日の最優先】\n${taskName}${top ? `（${formatDeadline(top.deadline).label}・残り${100 - top.progress}%）` : ''}\n\n【今日やること】\n${plan.today.map((task, index) => `${index + 1}. ${task.title} — ${Math.max(10, Math.round(task.estimatedMinutes * (100 - task.progress) / 100))}分`).join('\n') || 'いま気になっていることを一件だけ登録する'}\n\n【余裕があればやること】\n${plan.extra.map(task => `・${task.title}`).join('\n') || '今日は増やさなくて大丈夫です'}\n\n【やらなくていいこと】\n締切の遠い低優先タスク\n\n【最初の10分】\n${firstStep}。`
  }

  if (mode === '進捗報告' || /まだ|半分|できた|進捗|やる気|終わった|少しやった|手をつけた/.test(text)) {
    if (/終わった|完了|できた|少しやった|手をつけた/.test(text) && !/できない|終わってない|まだ/.test(text)) {
      return `${lady}、きちんと前進しています。${/少し|手をつけた/.test(text) ? '着手できたこと自体が大事です。' : 'まずは完了、お疲れさまでした。'}\n今は次へ急がず、保存や提出条件を一度だけ確認しましょう。`
    }
    return `${lady}、進んでいないことは分かりました。責める必要はありません。${moodLine ? `\n${moodLine}` : ''}\nいまは「${taskName}」の全部ではなく、${firstStep}。そこまでで一度止めて構いません。`
  }

  if (mode === '課題サポート' || /レポート|課題|宿題|リアペ|論文/.test(text)) {
    if (/手伝って|やばい|終わらない|間に合わない|どうしよう/.test(text)) return `${lady}、焦りますよね。まず完成させようとせず、締切と提出条件だけ確認しましょう。\nその次は、課題文から「何について」「何をする」の二つを抜き出します。課題文を貼っていただければ、そこから一緒に整えます。`
    return `${lady}、課題の話ですね。課題文・締切・いま書けているところのうち、分かるものだけ教えてください。全部そろっていなくても始められます。`
  }

  if (/疲れた|眠い|しんどい|何もしたくない|動けない/.test(text)) {
    return `${lady}、今は動きにくい状態なのですね。${gentle ? '無理に立て直さなくて大丈夫です。' : 'その状態で予定を詰めると、かえって苦しくなります。'}\n水分を取る、横になる、期限の近い連絡だけする。この中から一つで十分です。`
  }

  if (/不安|焦る|怖い|落ち込|泣きそう|つらい/.test(text)) {
    return `${lady}、それは落ち着かないですよね。今すぐ答えを出さなくて構いません。\nまず、起きている事実を一つと、いちばん心配なことを一つだけ分けて教えてください。`
  }

  if (/無理|やばい|詰ん|だめ/.test(text) || text.toLowerCase().includes('help')) {
    if (!top) return `${lady}、かなり焦っているのですね。まず、いちばん期限が近いものを一つだけ教えてください。そこから順番を作ります。`
    return `${lady}、焦っているのですね。全部を同時に片づける必要はありません。\n今は「${taskName}」だけ見ましょう。最初は ${firstStep}。${strict ? 'ここは先延ばしにせず、10分だけ始めてください。' : '10分で止めても構いません。'} `
  }

  if (mode === 'タスク相談' || /何から|どこから|優先|間に合う|今から何分|終わらせたい/.test(text)) {
    if (!top) return `${lady}、まず気になっていることを一件だけタスクにしましょう。名前だけで構いません。`
    return `${lady}、今は「${taskName}」からです。${formatDeadline(top.deadline).label}で、残りはおよそ${Math.max(10, Math.round(top.estimatedMinutes * (100 - top.progress) / 100))}分です。\n最初は ${firstStep}。その後に続けるか判断しましょう。`
  }

  if (/迷って|決められない|どっち|どうしよう/.test(text)) {
    return `${lady}、一緒に決めましょう。選択肢を二つまで挙げてください。期限・負担・後悔の少なさで比べます。`
  }

  if (/[？?]$|どう思う|どうしたら|教えて/.test(text)) {
    return `${lady}、考える材料をもう一つだけください。いま一番知りたいのは「原因」「選び方」「次の行動」のどれでしょう。質問攻めにはいたしません。`
  }

  return concise
    ? `${lady}、承知しました。もう少し聞かせてください。`
    : `${lady}、その話をもう少し聞かせてください。今は無理にタスクへ結びつけず、いちばん引っかかっているところから整理しましょう。`
}

export function buildChatGptPrompt({
  input,
  mode,
  tasks,
  moodLogs = [],
  diaries = [],
  settings = defaultSettings,
  history = [],
}: {
  input: string
  mode: ChatMode
  tasks: Task[]
  moodLogs?: MoodLog[]
  diaries?: DiaryEntry[]
  settings?: Settings
  history?: ChatMessage[]
}) {
  const lady = settings.name?.trim() || 'レディ'
  const latestMood = [...moodLogs].sort((a, b) => b.date.localeCompare(a.date))[0]
  const sortedDiaries = [...diaries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 2)
  const plan = dayPlan(tasks, latestMood?.mood)
  const remaining = rankedTasks(tasks).slice(0, 8)
  const recentHistory = history.slice(-6).map(message => `${message.role === 'assistant' ? '執事' : '私'}: ${message.content}`).join('\n')
  const taskLines = remaining.length
    ? remaining.map(task => `- ${task.title} / 締切:${formatDeadline(task.deadline).label} ${formatDeadline(task.deadline, true).date} / 優先度:${task.priority} / 進捗:${task.progress}% / 目安:${task.estimatedMinutes}分 / メモ:${task.memo || 'なし'}`).join('\n')
    : '- 未完了タスクなし'
  const moodLines = moodLogs.length
    ? [...moodLogs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5).map(log => `- ${log.date}: ${moodInfo(log.mood)?.label ?? log.mood}${log.memo ? `（${log.memo}）` : ''}`).join('\n')
    : '- まだ気分ログなし'
  const diaryLines = sortedDiaries.length
    ? sortedDiaries.map(entry => `- ${entry.date}: 気分=${moodInfo(entry.mood)?.label ?? entry.mood} / できたこと=${entry.doneToday || '未記入'} / しんどかったこと=${entry.hardThings || '未記入'} / 明日に回すこと=${entry.carryOver || '未記入'} / メモ=${entry.freeMemo || '未記入'}`).join('\n')
    : '- まだ日記なし'
  const request = input.trim() || '今日やることを、気分と締切に合わせて現実的に整理してほしい'

  return `あなたは私専属のパーソナル執事AIです。日本語で、上品だけど重すぎない口調で返してください。

呼び名: ${lady}
相談モード: ${mode}
口調: ${settings.tone}
厳しさ: ${settings.strictness}

私の相談:
${request}

今の気分:
${latestMood ? `${moodInfo(latestMood.mood)?.emoji ?? ''} ${moodInfo(latestMood.mood)?.label ?? latestMood.mood}${latestMood.memo ? `（${latestMood.memo}）` : ''}` : '未記録'}

気分の扱い:
- とても良い/良い: 少し多めに提案してよい
- 普通: 締切と優先度をもとに普通に提案
- しんどい: 最低限に絞り、最初の10分だけ提案
- かなり無理: 緊急の提出・連絡など生存ラインだけ。説教しない

未完了タスク:
${taskLines}

アプリ側の今日の候補:
- 最優先: ${plan.top?.title ?? 'なし'}
- 今日やる候補: ${plan.today.map(task => task.title).join('、') || 'なし'}
- 余裕があれば: ${plan.extra.map(task => task.title).join('、') || 'なし'}

最近の気分ログ:
${moodLines}

最近の日記:
${diaryLines}

直近の会話:
${recentHistory || 'なし'}

返答ルール:
1. まず私の状態を短く受け止める
2. 今日やることを増やしすぎない
3. 必要なら【今日の最優先】【今日やること】【余裕があれば】【最初の10分】を使う
4. 最後に執事らしい一言を短く添える
5. アプリに貼り戻してタスク追加できるよう、必要な場合だけ最後に【タスク候補】を作る

【タスク候補】の形式:
・タスク名（期限: 今日/明日/未定、所要: 10分、優先度: 高/中/低）

タスク候補は最大3個。不要なら【タスク候補】は書かなくて構いません。`
}

export function taskSuggestionsFromGptReply(reply: string) {
  const section = reply.match(/【タスク候補】([\s\S]*)/)?.[1] ?? ''
  if (!section.trim()) return []

  const suggestions: Task[] = []
  const seen = new Set<string>()
  const lines = section
    .split('\n')
    .map(line => line.trim())
    .filter(line => /^(?:[-*・]|\d+[.)、．])/.test(line))

  for (const line of lines) {
    const rawTitle = line
      .replace(/^(?:[-*・]|\d+[.)、．])\s*/, '')
      .replace(/[（(].*$/, '')
      .replace(/^(?:まず|次に|余裕があれば|最優先で|今日中に)\s*/, '')
      .replace(/[。.!！]+$/, '')
      .trim()

    if (!rawTitle || rawTitle.length > 60 || seen.has(rawTitle)) continue

    const priority = line.match(/優先度\s*[:：]?\s*(高|中|低)/)?.[1] ?? ''
    const input = `${line} ${priority ? `優先度${priority}` : ''} 「${rawTitle}」をタスクに追加して`
    const parsed = taskFromChat(input)
    if (!parsed) continue

    suggestions.push({ ...parsed.task, priority: (priority || parsed.task.priority) as Priority, memo: 'ChatGPTの返事から追加候補' })
    seen.add(rawTitle)
    if (suggestions.length >= 3) break
  }

  return suggestions
}

export interface ChatTaskResult {
  task: Task
  usedDefaultDeadline: boolean
}

export function isTaskAddRequest(input: string) {
  return /タスク追加|(?:タスク|やること|予定)(?:に|へ)?(?:追加|登録|入れて)|(?:追加|登録)して(?:ください|ほしい)?|覚えておいて/.test(input)
}

export function taskFromChat(input: string): ChatTaskResult | null {
  if (!isTaskAddRequest(input)) return null

  const now = new Date()
  const deadline = new Date(now)
  deadline.setDate(deadline.getDate() + 1)
  deadline.setHours(23, 59, 0, 0)
  let hasDate = false
  let hasTime = false

  const japaneseDate = input.match(/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/)
  const numericDate = input.match(/(?:(\d{4})[/-])?(\d{1,2})[/-](\d{1,2})/)
  const fullDate = japaneseDate || numericDate
  if (fullDate) {
    const specifiedYear = Boolean(fullDate[1])
    const year = specifiedYear ? Number(fullDate[1]) : now.getFullYear()
    const month = Number(fullDate[2])
    const day = Number(fullDate[3])
    const candidate = new Date(year, month - 1, day, 23, 59, 0, 0)
    const valid = candidate.getFullYear() === year && candidate.getMonth() === month - 1 && candidate.getDate() === day
    if (valid) {
      if (!specifiedYear && candidate.getTime() < now.getTime()) candidate.setFullYear(year + 1)
      deadline.setTime(candidate.getTime())
      hasDate = true
    }
  } else if (/明後日/.test(input)) {
    deadline.setTime(now.getTime())
    deadline.setDate(now.getDate() + 2)
    hasDate = true
  } else if (/明日/.test(input)) {
    deadline.setTime(now.getTime())
    deadline.setDate(now.getDate() + 1)
    hasDate = true
  } else if (/今日/.test(input)) {
    deadline.setTime(now.getTime())
    hasDate = true
  } else if (/来週/.test(input)) {
    deadline.setTime(now.getTime())
    deadline.setDate(now.getDate() + 7)
    hasDate = true
  } else {
    const weekday = input.match(/([月火水木金土日])曜(?:日)?/)
    if (weekday) {
      const target = ['日', '月', '火', '水', '木', '金', '土'].indexOf(weekday[1])
      const days = (target - now.getDay() + 7) % 7 || 7
      deadline.setTime(now.getTime())
      deadline.setDate(now.getDate() + days)
      hasDate = true
    }
  }

  const time = input.match(/(午前|午後)?\s*(\d{1,2})(?::(\d{1,2})|時(?!間)(?:(\d{1,2})分|半)?)/)
  if (time) {
    let hour = Number(time[2])
    if (time[1] === '午後' && hour < 12) hour += 12
    if (time[1] === '午前' && hour === 12) hour = 0
    const minute = time[3] ? Number(time[3]) : time[4] ? Number(time[4]) : /半/.test(time[0]) ? 30 : 0
    const valid = hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && !(time[1] && Number(time[2]) > 12)
    if (valid) {
      if (!hasDate) {
        deadline.setTime(now.getTime())
        deadline.setHours(hour, minute, 0, 0)
        if (deadline.getTime() <= now.getTime()) deadline.setDate(deadline.getDate() + 1)
      } else {
        deadline.setHours(hour, minute, 0, 0)
      }
      hasTime = true
    }
  }
  if (!hasTime) {
    deadline.setHours(23, 59, 0, 0)
  }

  const quoted = input.match(/[「『](.+?)[」』]/)?.[1]
  let title = quoted || input
  title = title
    .replace(/^\s*(?:執事[、,]?\s*)?/, '')
    .replace(/^(?:タスク)?追加\s*[:：]\s*/, '')
    .replace(/(?:(?:を)?(?:タスク|やること|予定)(?:を|に|へ)?(?:追加|登録|入れて)(?:して)?|(?:を)?(?:追加|登録)して)(?:ください|ほしい)?[。！!]?$/u, '')
    .replace(/覚えておいて(?:ください)?[。！!]?$/u, '')
    .replace(/(?:(?:\d{4}年)?\d{1,2}月\d{1,2}日|(?:\d{4}[/-])?\d{1,2}[/-]\d{1,2}|明後日|明日|今日|来週|[月火水木金土日]曜(?:日)?)(?:の)?/g, '')
    .replace(/(?:午前|午後)?\s*\d{1,2}(?::\d{1,2}|時(?!間)(?:(?:\d{1,2}分)|半)?)/g, '')
    .replace(/(?:締切|期限)?(?:まで)(?:に)?/g, '')
    .replace(/(?:(?:優先度(?:は|を)?|優先)(?:高|中|低)|(?:緊急|急ぎ))(?:で|に)?/g, '')
    .replace(/\d+(?:\.\d+)?\s*(?:分|時間)(?:くらい|程度)?/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[、,]{2,}/g, '、')
    .replace(/(?:[、,]\s*)?(?:で|に|の)$/u, '')
    .replace(/^[\s、,:：]+|[\s、,:：。！!]+$/g, '')
    .replace(/[をにへ]$/u, '')
    .trim()

  if (hasDate || hasTime) title = title.replace(/^(?:まで)?に\s*/u, '').trim()

  if (!title || /^(?:タスク|やること|予定)$/.test(title)) return null

  let category: Category = 'その他'
  if (/レポート|課題|宿題|提出|論文|作文/.test(title)) category = '課題'
  else if (/授業|講義|ゼミ|予習|復習|ノート/.test(title)) category = '授業'
  else if (/買う|購入|買い物|注文/.test(title)) category = '買い物'
  else if (/バイト|シフト|勤務/.test(title)) category = 'バイト'
  else if (/予約|予定|会う|病院|美容院|面談/.test(title)) category = '予定'
  else if (/掃除|洗濯|片付け|支払|家事|ごみ|ゴミ/.test(title)) category = '生活'

  const daysUntil = (deadline.getTime() - now.getTime()) / 86400000
  let priority: Priority = (hasDate || hasTime) && daysUntil <= 1.75 ? '高' : '中'
  if (/優先度(?:は|を)?低|低優先|いつか|余裕があれば/.test(input)) priority = '低'
  if (/優先度(?:は|を)?高|高優先|最優先|緊急|急ぎ/.test(input)) priority = '高'

  const duration = input.match(/(\d+(?:\.\d+)?)\s*時間(?:\s*(\d+)\s*分)?/) || input.match(/(\d+(?:\.\d+)?)\s*(分)/)
  const defaultMinutes = category === '買い物' ? 20 : category === '予定' ? 30 : category === '課題' ? 60 : 30
  const estimatedMinutes = duration
    ? Math.min(600, Math.max(5, Math.round(Number(duration[1]) * (duration[2] === '分' ? 1 : 60) + (duration[2] === '分' ? 0 : Number(duration[2] || 0)))))
    : defaultMinutes
  const timestamp = now.toISOString()

  return {
    task: {
      id: crypto.randomUUID(),
      title,
      deadline: toLocalDateTimeValue(deadline),
      category,
      priority,
      progress: 0,
      estimatedMinutes,
      status: '未着手',
      memo: 'AIチャットから追加',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    usedDefaultDeadline: !hasDate && !hasTime,
  }
}

export function taskAddedReply(result: ChatTaskResult) {
  const { task, usedDefaultDeadline } = result
  return `承知しました、レディ。「${task.title}」をタスクに追加しました。\n\n締切：${formatDeadline(task.deadline).date}${usedDefaultDeadline ? '（指定がなかったため、明日中に設定）' : ''}\n優先度：${task.priority}\nカテゴリ：${task.category}\n所要時間：${task.estimatedMinutes}分\n\n内容はタスク画面からいつでも編集できます。`
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
