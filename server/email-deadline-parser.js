const deadlineKeywords = /締切|〆切|期限|提出|回答|返信|支払|支払い|入金|申込|申し込み|登録|必着|課題|レポート|宿題|まで|due|deadline/i
const urgentKeywords = /至急|急ぎ|重要|本日|今日|明日|期限厳守|必着|リマインド|reminder/i
const shortTaskKeywords = /回答|返信|連絡|確認|申込|申し込み|登録/i
const longTaskKeywords = /レポート|課題|論文|発表|資料|試験|テスト/i
const weekdayIndex = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 }

const pad = value => String(value).padStart(2, '0')

function toLocalDateTimeValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function startOfDay(date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function withDate(year, month, day, hour, minute) {
  const date = new Date(year, month - 1, day, hour, minute, 0, 0)
  if (Number.isNaN(date.getTime())) return null
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

function explicitTime(text) {
  const clock = text.match(/(?:午前|午後)?\s*(\d{1,2})\s*[:：]\s*(\d{2})/)
  if (clock) {
    let hour = Number(clock[1])
    const minute = Number(clock[2])
    if (/午後/.test(clock[0]) && hour < 12) hour += 12
    if (/午前/.test(clock[0]) && hour === 12) hour = 0
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute, hasTime: true }
  }
  const japanese = text.match(/(?:午前|午後)?\s*(\d{1,2})\s*時(?:\s*(\d{1,2})\s*分?)?/)
  if (japanese) {
    let hour = Number(japanese[1])
    const minute = japanese[2] ? Number(japanese[2]) : 0
    if (/午後/.test(japanese[0]) && hour < 12) hour += 12
    if (/午前/.test(japanese[0]) && hour === 12) hour = 0
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return { hour, minute, hasTime: true }
  }
  return { hour: 23, minute: 59, hasTime: false }
}

function toParsedDeadline(date, hasTime) {
  return { value: toLocalDateTimeValue(date), hasTime }
}

function dateInNearestYear(month, day, baseDate, hour, minute) {
  const thisYear = withDate(baseDate.getFullYear(), month, day, hour, minute)
  if (!thisYear) return null
  const base = startOfDay(baseDate)
  const candidateDay = startOfDay(thisYear)
  if (candidateDay.getTime() < base.getTime() - 86400000) return withDate(baseDate.getFullYear() + 1, month, day, hour, minute)
  return thisYear
}

function parseWeekdayDeadline(text, baseDate) {
  const match = text.match(/(?:(今週|来週)\s*)?([日月火水木金土])(?:曜|曜日)(?:まで|中|に)?/) || text.match(/(今週|来週)\s*([日月火水木金土])(?:まで|中|に)?/)
  if (!match) return null
  const target = weekdayIndex[match[2]]
  const start = startOfDay(baseDate)
  const current = start.getDay()
  let offset = target - current
  if (match[1] === '来週') offset += 7
  if (!match[1] && offset < 0) offset += 7
  if (match[1] === '今週' && offset < 0) offset += 7
  const time = explicitTime(text)
  const date = new Date(start)
  date.setDate(start.getDate() + offset)
  date.setHours(time.hour, time.minute, 0, 0)
  return toParsedDeadline(date, time.hasTime)
}

function parseRelativeDeadline(text, baseDate) {
  const relative = text.match(/(今日|本日|明日|あした|明後日|あさって)(?:まで|中|に)?/)
  if (!relative) return null
  const addDays = /明後日|あさって/.test(relative[1]) ? 2 : /明日|あした/.test(relative[1]) ? 1 : 0
  const time = explicitTime(text)
  const date = startOfDay(baseDate)
  date.setDate(date.getDate() + addDays)
  date.setHours(time.hour, time.minute, 0, 0)
  return toParsedDeadline(date, time.hasTime)
}

function parseAbsoluteDeadline(text, baseDate) {
  const time = explicitTime(text)
  const full = text.match(/(\d{4})\s*(?:年|[-/.])\s*(\d{1,2})\s*(?:月|[-/.])\s*(\d{1,2})\s*(?:日)?/)
  if (full) {
    const date = withDate(Number(full[1]), Number(full[2]), Number(full[3]), time.hour, time.minute)
    return date ? toParsedDeadline(date, time.hasTime) : null
  }
  const noYear = text.match(/(?:^|[^\d])(\d{1,2})\s*(?:月|\/|\.)\s*(\d{1,2})\s*(?:日)?/)
  if (noYear) {
    const date = dateInNearestYear(Number(noYear[1]), Number(noYear[2]), baseDate, time.hour, time.minute)
    return date ? toParsedDeadline(date, time.hasTime) : null
  }
  return null
}

function parseDeadline(text, baseDate) {
  return parseRelativeDeadline(text, baseDate) || parseAbsoluteDeadline(text, baseDate) || parseWeekdayDeadline(text, baseDate)
}

function compactText(text, max = 80) {
  const clean = String(text || '')
    .replace(/^(件名|subject|締切|期限|提出期限)\s*[:：]\s*/i, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function stableId(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `gmail-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function priorityFor(text) {
  return urgentKeywords.test(text) ? '高' : '中'
}

function minutesFor(text) {
  if (shortTaskKeywords.test(text)) return 20
  if (longTaskKeywords.test(text)) return 90
  return 45
}

function categoryFor(text) {
  if (/課題|レポート|提出|宿題|発表|論文/.test(text)) return '課題'
  if (/授業|講義|ゼミ|出席/.test(text)) return '授業'
  if (/買|購入|注文/.test(text)) return '買い物'
  if (/バイト|勤務|シフト/.test(text)) return 'バイト'
  if (/予約|面談|病院|支払|支払い|入金/.test(text)) return '生活'
  return 'その他'
}

function pickCandidateLines(text, baseDate) {
  const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const picked = lines.filter(line => deadlineKeywords.test(line) || parseAbsoluteDeadline(line, baseDate) || parseRelativeDeadline(line, baseDate) || parseWeekdayDeadline(line, baseDate))
  if (picked.length) return picked
  return deadlineKeywords.test(text) ? [compactText(text, 220)] : []
}

export function parseEmailDeadlineCandidates(input, baseDate = new Date(), options = {}) {
  const text = String(input || '').trim()
  if (!text) return []
  const subject = compactText(options.subject || text.match(/^(?:件名|subject)\s*[:：]\s*(.+)$/im)?.[1] || '', 60)
  const from = compactText(options.from || '', 80)
  const messageId = compactText(options.messageId || '', 80)
  const lines = pickCandidateLines(text, baseDate).slice(0, 8)
  if (!lines.length) return []

  const rawItems = lines.map((line, index) => {
    const context = `${subject ? `件名: ${subject}\n` : ''}${line}`
    const parsed = parseDeadline(context, baseDate) || parseDeadline(text, baseDate)
    const titleBase = subject || compactText(line.replace(/\d{4}\s*(?:年|[-/.])\s*\d{1,2}\s*(?:月|[-/.])\s*\d{1,2}\s*(?:日)?/g, ''), 36) || '締切候補'
    const title = `メール確認：${titleBase}`
    const sourceText = compactText(`${from ? `送信者: ${from} / ` : ''}${context}`, 180)
    const ambiguities = [
      'Gmail由来の候補を確認',
      ...(!parsed ? ['締切日を確認'] : parsed.hasTime ? [] : ['締切時刻が未確認']),
    ]
    return {
      id: stableId(`${messageId}|${title}|${parsed?.value || ''}|${sourceText}|${index}`),
      type: 'task',
      title,
      deadline: parsed?.value || '',
      category: categoryFor(`${subject} ${line}`),
      priority: priorityFor(`${subject} ${line}`),
      estimatedMinutes: minutesFor(`${subject} ${line}`),
      taskType: 'temporary',
      memo: `Gmailより：${compactText(line, 120)}${from ? ` / ${from}` : ''}`,
      sourceText,
      confidence: 'low',
      ambiguities,
      deadlineIsFallback: !parsed,
      createdAt: baseDate.toISOString(),
    }
  })

  const seen = new Set()
  return rawItems.filter(item => {
    const signature = `${item.title}|${item.deadline}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  }).slice(0, 6)
}

export function parseDeadlineCandidatesFromEmails(emails, baseDate = new Date()) {
  const all = []
  for (const email of Array.isArray(emails) ? emails : []) {
    const text = [
      email.subject ? `件名: ${email.subject}` : '',
      email.snippet || '',
      email.body || '',
    ].filter(Boolean).join('\n')
    all.push(...parseEmailDeadlineCandidates(text, baseDate, {
      subject: email.subject,
      from: email.from,
      messageId: email.id,
    }))
  }
  const seen = new Set()
  return all.filter(item => {
    const signature = `${item.title}|${item.deadline}|${item.sourceText}`
    if (seen.has(signature)) return false
    seen.add(signature)
    return true
  }).slice(0, 12)
}
