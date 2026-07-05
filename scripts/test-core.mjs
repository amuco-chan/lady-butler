import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import appDataHandler from '../api/app-data.js'
import gptContextHandler from '../api/gpt-context.js'
import gptInboxHandler from '../api/gpt-inbox.js'
import { butlerGreeting, butlerScheduleAdvice, canAutoAddInboxItem, dayPlan, defaultSettings, expandRecurringEvents, formatDeadline, formatEventTime, inboxItemToEvent, inboxItemToTask, makeDiaryComment, moodGuidance, moodTrend, normalizeGptInboxPayload, parseIcsCalendar, rankedTasks, sampleTasks, scheduleLoadFor, stableButlerChoice, taskLimitForSchedule } from '../src/lib.ts'

async function callGptInbox(body, options = {}) {
  let responseBody = ''
  const req = { method: options.method || 'POST', body, headers: { host: 'lady-butler.vercel.app', 'x-forwarded-proto': 'https', ...(options.headers || {}) } }
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { responseBody = String(value) },
  }
  await gptInboxHandler(req, res)
  return { status: res.statusCode, body: JSON.parse(responseBody) }
}

async function callAppData(body, options = {}) {
  let responseBody = ''
  const req = { method: options.method || 'GET', body, headers: { host: 'lady-butler.vercel.app', 'x-forwarded-proto': 'https', ...(options.headers || {}) } }
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { responseBody = String(value) },
  }
  await appDataHandler(req, res)
  return { status: res.statusCode, body: JSON.parse(responseBody) }
}

async function callGptContext(options = {}) {
  let responseBody = ''
  const req = { method: options.method || 'GET', headers: options.headers || {} }
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { responseBody = String(value) },
  }
  await gptContextHandler(req, res)
  return { status: res.statusCode, body: JSON.parse(responseBody) }
}

assert.equal(defaultSettings.name, 'レディ')
assert.equal(defaultSettings.tone, '執事')
assert.equal(defaultSettings.strictness, '標準')
assert.equal(defaultSettings.remindersEnabled, false)
assert.equal(defaultSettings.reminderTime, '21:30')
assert.equal(defaultSettings.gptShareDiary, true)

const tiredPlan = dayPlan(sampleTasks, 'tired')
assert.equal(tiredPlan.today.length, 2)
assert.equal(tiredPlan.top?.title, '心理学レポートの構成を作る')

const exhaustedPlan = dayPlan(sampleTasks, 'exhausted')
assert.equal(exhaustedPlan.today.length, 1)

assert.equal(scheduleLoadFor(0, 0), 'light')
assert.equal(scheduleLoadFor(2, 90), 'medium')
assert.equal(scheduleLoadFor(1, 250), 'heavy')
assert.equal(taskLimitForSchedule(3, 'normal', 'heavy'), 1)
assert.equal(taskLimitForSchedule(5, 'good', 'heavy'), 2)
assert.equal(taskLimitForSchedule(3, 'normal', 'medium'), 2)
assert.deepEqual(formatDeadline(''), { date: '未設定', label: '締切未設定', urgent: false })
const invalidDeadlineTask = { ...sampleTasks[0], id: 'invalid-deadline', deadline: '', priority: '中', progress: 0 }
const validDeadlineTask = { ...sampleTasks[0], id: 'valid-deadline', deadline: new Date(Date.now() + 86400000).toISOString(), priority: '中', progress: 0 }
assert.equal(rankedTasks([invalidDeadlineTask, validDeadlineTask]).at(-1).id, 'invalid-deadline')

assert.match(moodGuidance('tired'), /詰め込む日ではありません/)
assert.match(moodTrend([{ id: '1', date: '2026-06-24', mood: 'tired', memo: '', createdAt: '', updatedAt: '' }]), /最近の気分/)
assert.equal(stableButlerChoice(['a', 'b', 'c'], 'same-seed'), stableButlerChoice(['a', 'b', 'c'], 'same-seed'))
const greetingVariations = new Set(Array.from({ length: 16 }, (_, index) => butlerGreeting('レディ', undefined, defaultSettings, `2026-07-${String(index + 1).padStart(2, '0')}`).title))
assert.ok(greetingVariations.size >= 2)
assert.match(butlerScheduleAdvice('light', 'tired', defaultSettings, 'tired-day'), /10分|着手/)

const diaryComment = makeDiaryComment({
  mood: 'tired',
  doneToday: '資料を開いた',
  hardThings: '寝不足',
  carryOver: '見出しを整える',
})
assert.match(diaryComment, /資料を開いた/)
assert.match(diaryComment, /寝不足/)
assert.match(diaryComment, /見出しを整える/)

const gptItems = normalizeGptInboxPayload({
  sourceText: '心理学レポートが金曜までなんだよね',
  items: [{ title: '心理学レポートを書く', deadline: '2026-06-26', category: '課題', priority: '高', estimatedMinutes: 90 }],
})
assert.equal(gptItems.length, 1)
assert.equal(gptItems[0].deadline, '2026-06-26T23:59')
const importedTask = inboxItemToTask(gptItems[0])
assert.equal(importedTask.title, '心理学レポートを書く')
assert.equal(importedTask.status, '未着手')

const gptEventItems = normalizeGptInboxPayload({
  sourceText: '明日15時から美容院なんだよね',
  events: [{ title: '美容院', startAt: '2026-06-25T15:00', endAt: '2026-06-25T16:00', location: '駅前' }],
})
assert.equal(gptEventItems.length, 1)
assert.equal(gptEventItems[0].type, 'event')
assert.equal(gptEventItems[0].startAt, '2026-06-25T15:00')
const importedEvent = inboxItemToEvent(gptEventItems[0])
assert.equal(importedEvent.title, '美容院')
assert.equal(importedEvent.location, '駅前')
assert.match(formatEventTime(importedEvent).time, /15:00/)

const weeklyOccurrences = expandRecurringEvents([{
  ...importedEvent,
  id: 'weekly-event',
  startAt: '2026-07-03T10:00',
  endAt: '2026-07-03T11:00',
  recurrence: 'weekly',
  recurrenceUntil: '2026-07-31',
}], new Date('2026-07-01T00:00:00'), new Date('2026-07-31T23:59:59'))
assert.equal(weeklyOccurrences.length, 5)
assert.equal(weeklyOccurrences[1].startAt, '2026-07-10T10:00')

const icsEvents = parseIcsCalendar(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:class-1\nDTSTART:20260706T090000\nDTEND:20260706T103000\nRRULE:FREQ=WEEKLY;UNTIL=20260727T235959\nSUMMARY:英米文学\nLOCATION:301教室\nDESCRIPTION:教科書を持参\nEND:VEVENT\nEND:VCALENDAR`)
assert.equal(icsEvents.length, 1)
assert.equal(icsEvents[0].title, '英米文学')
assert.equal(icsEvents[0].recurrence, 'weekly')
assert.equal(icsEvents[0].recurrenceUntil, '2026-07-27')

const deadlineWithTime = normalizeGptInboxPayload({
  sourceText: '金曜18時までにレポートを提出する',
  items: [{ type: 'task', title: 'レポートを提出する', deadline: '2026-06-26T18:00', startAt: '2026-06-26T18:00', category: '予定' }],
})
assert.equal(deadlineWithTime[0].type, 'task')
assert.equal(deadlineWithTime[0].category, '課題')

const inferredDeadline = normalizeGptInboxPayload({
  items: [{ title: '奨学金の申請', deadline: '2026-07-01T17:00', startAt: '2026-07-01T17:00' }],
})
assert.equal(inferredDeadline[0].type, 'task')

const eventWithoutTime = normalizeGptInboxPayload({
  event: { title: '病院の予約', memo: '時刻は未確認' },
})
assert.equal(eventWithoutTime[0].type, 'event')
assert.equal(eventWithoutTime[0].startIsFallback, true)
assert.equal(eventWithoutTime[0].confidence, 'low')
assert.deepEqual(eventWithoutTime[0].ambiguities, ['開始日時未指定'])

const taskWithoutDeadline = normalizeGptInboxPayload({
  task: { title: '洗剤を買う' },
})
assert.equal(taskWithoutDeadline[0].type, 'task')
assert.equal(taskWithoutDeadline[0].deadlineIsFallback, true)
assert.equal(taskWithoutDeadline[0].confidence, 'medium')
assert.equal(taskWithoutDeadline[0].deadline, '')
assert.deepEqual(taskWithoutDeadline[0].ambiguities, [])

const apiTaskWithoutDeadline = await callGptInbox({ items: [{ type: 'task', title: '洗剤を買う' }] })
assert.equal(apiTaskWithoutDeadline.body.items[0].deadlineIsFallback, true)
assert.equal(apiTaskWithoutDeadline.body.items[0].confidence, 'medium')
assert.equal(apiTaskWithoutDeadline.body.items[0].deadline, '')
assert.deepEqual(apiTaskWithoutDeadline.body.items[0].ambiguities, [])

const invalidTaskDate = normalizeGptInboxPayload({
  items: [{ type: 'task', title: 'レポートを提出する', deadline: '明日18時' }],
})
assert.equal(invalidTaskDate[0].deadline, '')
assert.deepEqual(invalidTaskDate[0].ambiguities, ['締切の日時形式を確認'])
assert.equal(canAutoAddInboxItem(invalidTaskDate[0]), false)

const invalidEventDate = normalizeGptInboxPayload({
  items: [{ type: 'event', title: '美容院', startAt: '明日15時' }],
})
assert.equal(invalidEventDate[0].startIsFallback, true)
assert.deepEqual(invalidEventDate[0].ambiguities, ['開始日時を確認'])
assert.equal(canAutoAddInboxItem(invalidEventDate[0]), false)

const apiDeadline = await callGptInbox({
  sourceText: '金曜18時までにレポートを提出する',
  items: [{ type: 'task', title: 'レポートを提出する', deadline: '2026-06-26T18:00', startAt: '2026-06-26T18:00', category: '予定' }],
})
assert.equal(apiDeadline.status, 200)
assert.equal(apiDeadline.body.items[0].type, 'task')
assert.equal(apiDeadline.body.items[0].category, '課題')
assert.equal(apiDeadline.body.delivery, 'link')
assert.equal(apiDeadline.body.requiresOpen, true)

const apiShift = await callGptInbox({
  sourceText: '毎週金曜18時からバイト',
  items: [{ type: 'event', title: 'バイト', startAt: '2026-06-26T18:00', endAt: '2026-06-26T22:00', recurrence: 'weekly' }],
})
assert.equal(apiShift.body.items[0].type, 'event')
assert.equal(apiShift.body.items[0].startAt, '2026-06-26T18:00')
assert.equal(apiShift.body.items[0].recurrence, 'weekly')

const smartCandidate = normalizeGptInboxPayload({
  items: [{ id: 'stable-id', type: 'task', title: '申請内容を確認', deadline: '2026-07-02', confidence: 'low', ambiguities: ['締切時刻が未確認'], createdAt: '2026-07-01T10:00:00.000Z' }],
})[0]
assert.equal(smartCandidate.id, 'stable-id')
assert.equal(smartCandidate.confidence, 'low')
assert.deepEqual(smartCandidate.ambiguities, ['締切時刻が未確認'])
assert.equal(smartCandidate.createdAt, '2026-07-01T10:00:00.000Z')
assert.equal(canAutoAddInboxItem(gptItems[0]), true)
assert.equal(canAutoAddInboxItem(gptEventItems[0]), true)
assert.equal(canAutoAddInboxItem(eventWithoutTime[0]), false)
assert.equal(canAutoAddInboxItem(taskWithoutDeadline[0]), true)

const originalFetch = globalThis.fetch
const originalSyncToken = process.env.SYNC_ACCESS_TOKEN
const originalGptActionToken = process.env.GPT_ACTION_TOKEN
const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL
const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN
const pipelines = []
const queuedStore = new Map()
const keyValueStore = new Map()
process.env.SYNC_ACCESS_TOKEN = 'personal-test-token'
process.env.GPT_ACTION_TOKEN = 'gpt-action-test-token'
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'
process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-test-token'
globalThis.fetch = async (_url, options) => {
  const commands = JSON.parse(options.body)
  pipelines.push(commands)
  const results = commands.map(command => {
    if (command[0] === 'GET') return { result: keyValueStore.get(command[1]) ?? null }
    if (command[0] === 'SET') { keyValueStore.set(command[1], command[2]); return { result: 'OK' } }
    if (command[0] === 'HSET') { queuedStore.set(command[2], command[3]); return { result: 1 } }
    if (command[0] === 'HVALS') return { result: [...queuedStore.values()] }
    if (command[0] === 'HDEL') {
      let removed = 0
      for (const id of command.slice(2)) if (queuedStore.delete(id)) removed += 1
      return { result: removed }
    }
    if (command[0] === 'DEL') {
      let removed = 0
      for (const key of command.slice(1)) if (keyValueStore.delete(key)) removed += 1
      queuedStore.clear()
      return { result: removed }
    }
    return { result: 1 }
  })
  return { ok: true, status: 200, json: async () => results }
}

const directSync = await callGptInbox({
  sourceText: '明日の17時までに申請する',
  items: [{ type: 'task', title: '申請する', deadline: '2026-07-02T17:00', confidence: 'high' }],
}, { headers: { authorization: 'Bearer gpt-action-test-token' } })
assert.equal(directSync.status, 200)
assert.equal(directSync.body.delivery, 'synced')
assert.equal(directSync.body.requiresOpen, false)
assert.equal(directSync.body.items[0].id.length, 24)
assert.equal(pipelines[0][0][0], 'HSET')
assert.equal(pipelines[0].at(-1)[0], 'EXPIRE')

const cloudRead = await callGptInbox(undefined, { method: 'GET', headers: { authorization: 'Bearer personal-test-token' } })
assert.equal(cloudRead.status, 200)
assert.equal(cloudRead.body.count, 1)
assert.equal(cloudRead.body.items[0].title, '申請する')

const cloudDelete = await callGptInbox({ ids: [directSync.body.items[0].id] }, { method: 'DELETE', headers: { authorization: 'Bearer personal-test-token' } })
assert.equal(cloudDelete.body.removed, 1)

const unauthorizedSync = await callGptInbox({ items: [{ type: 'task', title: '確認する' }] })
assert.equal(unauthorizedSync.status, 401)
const deviceKeyCannotPost = await callGptInbox({ items: [{ type: 'task', title: '確認する' }] }, { headers: { authorization: 'Bearer personal-test-token' } })
assert.equal(deviceKeyCannotPost.status, 401)

const cloudHeaders = { authorization: 'Bearer personal-test-token' }
const emptyAppData = await callAppData(undefined, { method: 'GET', headers: cloudHeaders })
assert.equal(emptyAppData.status, 200)
assert.equal(emptyAppData.body.exists, false)
assert.equal(emptyAppData.body.revision, 0)

const savedAppData = await callAppData({
  baseRevision: 0,
  data: {
    tasks: [{ id: 'task-1', title: '同期テスト', memo: 'x'.repeat(900), updatedAt: '2026-07-03T00:00:00.000Z' }],
    events: [{ id: 'event-1', title: 'ゼミ', startAt: '2099-07-03T14:00', endAt: '2099-07-03T15:00' }],
    moodLogs: [{ id: 'mood-1', date: '2026-07-03', mood: 'tired', memo: '寝不足' }],
    diaries: [{ id: 'diary-1', date: '2026-07-03', mood: 'tired', doneToday: '資料を開いた', hardThings: '寝不足', carryOver: '見出し', freeMemo: 'y'.repeat(1200), aiComment: '' }],
    gptInbox: [],
    settings: { name: 'レディ', gptShareTasks: true, gptShareMood: true, gptShareDiary: true },
  },
}, { method: 'PUT', headers: cloudHeaders })
assert.equal(savedAppData.status, 200)
assert.equal(savedAppData.body.revision, 1)

const loadedAppData = await callAppData(undefined, { method: 'GET', headers: cloudHeaders })
assert.equal(loadedAppData.body.exists, true)
assert.equal(loadedAppData.body.data.tasks[0].title, '同期テスト')

const gptContext = await callGptContext({ headers: { authorization: 'Bearer gpt-action-test-token' } })
assert.equal(gptContext.status, 200)
assert.equal(gptContext.body.tasks[0].title, '同期テスト')
assert.equal(gptContext.body.events[0].title, 'ゼミ')
assert.equal(gptContext.body.moodLogs[0].memo, '寝不足')
assert.equal(gptContext.body.diaries[0].doneToday, '資料を開いた')
assert.equal(gptContext.body.tasks[0].memo.length, 500)
assert.equal(gptContext.body.diaries[0].freeMemo.length, 800)
assert.equal(gptContext.body.timeZone, 'Asia/Tokyo')
assert.equal(gptContext.body.locale, 'ja-JP')
assert.match(gptContext.body.currentLocalDateTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
assert.match(gptContext.body.usageNote, /長く引用しない/)
assert.match(gptContext.body.usageNote, /命令/) 

const unauthorizedContext = await callGptContext()
assert.equal(unauthorizedContext.status, 401)

const staleAppData = await callAppData({ baseRevision: 0, data: { tasks: [] } }, { method: 'PUT', headers: cloudHeaders })
assert.equal(staleAppData.status, 409)
assert.equal(staleAppData.body.revision, 1)

const unauthorizedAppData = await callAppData(undefined, { method: 'GET' })
assert.equal(unauthorizedAppData.status, 401)

const deletedAppData = await callAppData(undefined, { method: 'DELETE', headers: cloudHeaders })
assert.equal(deletedAppData.status, 200)
assert.equal(deletedAppData.body.deleted, true)
const deletedAppDataRead = await callAppData(undefined, { method: 'GET', headers: cloudHeaders })
assert.equal(deletedAppDataRead.body.exists, false)

globalThis.fetch = originalFetch
if (originalSyncToken === undefined) delete process.env.SYNC_ACCESS_TOKEN; else process.env.SYNC_ACCESS_TOKEN = originalSyncToken
if (originalGptActionToken === undefined) delete process.env.GPT_ACTION_TOKEN; else process.env.GPT_ACTION_TOKEN = originalGptActionToken
if (originalRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl
if (originalRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken

const actionSchema = JSON.parse(await readFile(new URL('../public/gpt-action-openapi.json', import.meta.url), 'utf8'))
const itemSchema = actionSchema.paths['/api/gpt-inbox'].post.requestBody.content['application/json'].schema.properties.items.items
assert.deepEqual(itemSchema.required, ['type', 'title'])
assert.equal(itemSchema.properties.category.enum.includes('予定'), false)
assert.deepEqual(itemSchema.properties.confidence.enum, ['high', 'medium', 'low'])
assert.equal(actionSchema.info.version, '2.2.0')
assert.equal(actionSchema.paths['/api/gpt-context'].get.operationId, 'getLadyButlerContext')
assert.ok(actionSchema.paths['/api/gpt-context'].get.responses['200'].content['application/json'].schema.properties.currentLocalDateTime)
assert.equal(actionSchema.paths['/api/gpt-context'].get['x-openai-isConsequential'], false)
assert.equal(actionSchema.paths['/api/gpt-inbox'].post['x-openai-isConsequential'], false)
assert.match(actionSchema.paths['/api/gpt-inbox'].post.description, /real future tasks or events/)
assert.match(actionSchema.paths['/api/gpt-inbox'].post.description, /getLadyButlerContext/)
assert.ok(actionSchema.paths['/api/gpt-inbox'].post.description.length <= 300)

const gptInstructions = await readFile(new URL('../public/gpt-instructions.txt', import.meta.url), 'utf8')
assert.match(gptInstructions, /currentLocalDateTime/)
assert.match(gptInstructions, /締切がなくても/)
assert.match(gptInstructions, /開始日と開始時刻/)
assert.match(gptInstructions, /参照用データ/)

const privacyPage = await readFile(new URL('../public/privacy.html', import.meta.url), 'utf8')
assert.match(privacyPage, /プライバシーとデータの扱い/)
assert.match(privacyPage, /クラウド上の記録/)

console.log('コア機能テスト: OK')
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import appDataHandler from '../api/app-data.js'
import gptContextHandler from '../api/gpt-context.js'
import gptInboxHandler from '../api/gpt-inbox.js'
import { butlerGreeting, butlerScheduleAdvice, canAutoAddInboxItem, dayPlan, defaultSettings, expandRecurringEvents, formatDeadline, formatEventTime, inboxItemToEvent, inboxItemToTask, makeDiaryComment, moodGuidance, moodTrend, normalizeGptInboxPayload, parseIcsCalendar, rankedTasks, sampleTasks, scheduleLoadFor, stableButlerChoice, taskLimitForSchedule } from '../src/lib.ts'

async function callGptInbox(body, options = {}) {
  let responseBody = ''
  const req = { method: options.method || 'POST', body, headers: { host: 'lady-butler.vercel.app', 'x-forwarded-proto': 'https', ...(options.headers || {}) } }
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { responseBody = String(value) },
  }
  await gptInboxHandler(req, res)
  return { status: res.statusCode, body: JSON.parse(responseBody) }
}

async function callAppData(body, options = {}) {
  let responseBody = ''
  const req = { method: options.method || 'GET', body, headers: { host: 'lady-butler.vercel.app', 'x-forwarded-proto': 'https', ...(options.headers || {}) } }
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { responseBody = String(value) },
  }
  await appDataHandler(req, res)
  return { status: res.statusCode, body: JSON.parse(responseBody) }
}

async function callGptContext(options = {}) {
  let responseBody = ''
  const req = { method: options.method || 'GET', headers: options.headers || {} }
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { responseBody = String(value) },
  }
  await gptContextHandler(req, res)
  return { status: res.statusCode, body: JSON.parse(responseBody) }
}

assert.equal(defaultSettings.name, 'レディ')
assert.equal(defaultSettings.tone, '執事')
assert.equal(defaultSettings.strictness, '標準')
assert.equal(defaultSettings.remindersEnabled, false)
assert.equal(defaultSettings.reminderTime, '21:30')
assert.equal(defaultSettings.gptShareDiary, true)

const tiredPlan = dayPlan(sampleTasks, 'tired')
assert.equal(tiredPlan.today.length, 2)
assert.equal(tiredPlan.top?.title, '心理学レポートの構成を作る')

const exhaustedPlan = dayPlan(sampleTasks, 'exhausted')
assert.equal(exhaustedPlan.today.length, 1)

assert.equal(scheduleLoadFor(0, 0), 'light')
assert.equal(scheduleLoadFor(2, 90), 'medium')
assert.equal(scheduleLoadFor(1, 250), 'heavy')
assert.equal(taskLimitForSchedule(3, 'normal', 'heavy'), 1)
assert.equal(taskLimitForSchedule(5, 'good', 'heavy'), 2)
assert.equal(taskLimitForSchedule(3, 'normal', 'medium'), 2)
assert.deepEqual(formatDeadline(''), { date: '未設定', label: '締切未設定', urgent: false })
const invalidDeadlineTask = { ...sampleTasks[0], id: 'invalid-deadline', deadline: '', priority: '中', progress: 0 }
const validDeadlineTask = { ...sampleTasks[0], id: 'valid-deadline', deadline: new Date(Date.now() + 86400000).toISOString(), priority: '中', progress: 0 }
assert.equal(rankedTasks([invalidDeadlineTask, validDeadlineTask]).at(-1).id, 'invalid-deadline')

assert.match(moodGuidance('tired'), /詰め込む日ではありません/)
assert.match(moodTrend([{ id: '1', date: '2026-06-24', mood: 'tired', memo: '', createdAt: '', updatedAt: '' }]), /最近の気分/)
assert.equal(stableButlerChoice(['a', 'b', 'c'], 'same-seed'), stableButlerChoice(['a', 'b', 'c'], 'same-seed'))
const greetingVariations = new Set(Array.from({ length: 16 }, (_, index) => butlerGreeting('レディ', undefined, defaultSettings, `2026-07-${String(index + 1).padStart(2, '0')}`).title))
assert.ok(greetingVariations.size >= 2)
assert.match(butlerScheduleAdvice('light', 'tired', defaultSettings, 'tired-day'), /10分|着手/)

const diaryComment = makeDiaryComment({
  mood: 'tired',
  doneToday: '資料を開いた',
  hardThings: '寝不足',
  carryOver: '見出しを整える',
})
assert.match(diaryComment, /資料を開いた/)
assert.match(diaryComment, /寝不足/)
assert.match(diaryComment, /見出しを整える/)

const gptItems = normalizeGptInboxPayload({
  sourceText: '心理学レポートが金曜までなんだよね',
  items: [{ title: '心理学レポートを書く', deadline: '2026-06-26', category: '課題', priority: '高', estimatedMinutes: 90 }],
})
assert.equal(gptItems.length, 1)
assert.equal(gptItems[0].deadline, '2026-06-26T23:59')
const importedTask = inboxItemToTask(gptItems[0])
assert.equal(importedTask.title, '心理学レポートを書く')
assert.equal(importedTask.status, '未着手')

const gptEventItems = normalizeGptInboxPayload({
  sourceText: '明日15時から美容院なんだよね',
  events: [{ title: '美容院', startAt: '2026-06-25T15:00', endAt: '2026-06-25T16:00', location: '駅前' }],
})
assert.equal(gptEventItems.length, 1)
assert.equal(gptEventItems[0].type, 'event')
assert.equal(gptEventItems[0].startAt, '2026-06-25T15:00')
const importedEvent = inboxItemToEvent(gptEventItems[0])
assert.equal(importedEvent.title, '美容院')
assert.equal(importedEvent.location, '駅前')
assert.match(formatEventTime(importedEvent).time, /15:00/)

const weeklyOccurrences = expandRecurringEvents([{
  ...importedEvent,
  id: 'weekly-event',
  startAt: '2026-07-03T10:00',
  endAt: '2026-07-03T11:00',
  recurrence: 'weekly',
  recurrenceUntil: '2026-07-31',
}], new Date('2026-07-01T00:00:00'), new Date('2026-07-31T23:59:59'))
assert.equal(weeklyOccurrences.length, 5)
assert.equal(weeklyOccurrences[1].startAt, '2026-07-10T10:00')

const icsEvents = parseIcsCalendar(`BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:class-1\nDTSTART:20260706T090000\nDTEND:20260706T103000\nRRULE:FREQ=WEEKLY;UNTIL=20260727T235959\nSUMMARY:英米文学\nLOCATION:301教室\nDESCRIPTION:教科書を持参\nEND:VEVENT\nEND:VCALENDAR`)
assert.equal(icsEvents.length, 1)
assert.equal(icsEvents[0].title, '英米文学')
assert.equal(icsEvents[0].recurrence, 'weekly')
assert.equal(icsEvents[0].recurrenceUntil, '2026-07-27')

const deadlineWithTime = normalizeGptInboxPayload({
  sourceText: '金曜18時までにレポートを提出する',
  items: [{ type: 'task', title: 'レポートを提出する', deadline: '2026-06-26T18:00', startAt: '2026-06-26T18:00', category: '予定' }],
})
assert.equal(deadlineWithTime[0].type, 'task')
assert.equal(deadlineWithTime[0].category, '課題')

const inferredDeadline = normalizeGptInboxPayload({
  items: [{ title: '奨学金の申請', deadline: '2026-07-01T17:00', startAt: '2026-07-01T17:00' }],
})
assert.equal(inferredDeadline[0].type, 'task')

const eventWithoutTime = normalizeGptInboxPayload({
  event: { title: '病院の予約', memo: '時刻は未確認' },
})
assert.equal(eventWithoutTime[0].type, 'event')
assert.equal(eventWithoutTime[0].startIsFallback, true)
assert.equal(eventWithoutTime[0].confidence, 'low')
assert.deepEqual(eventWithoutTime[0].ambiguities, ['開始日時未指定'])

const taskWithoutDeadline = normalizeGptInboxPayload({
  task: { title: '洗剤を買う' },
})
assert.equal(taskWithoutDeadline[0].type, 'task')
assert.equal(taskWithoutDeadline[0].deadlineIsFallback, true)
assert.equal(taskWithoutDeadline[0].confidence, 'medium')
assert.equal(taskWithoutDeadline[0].deadline, '')
assert.deepEqual(taskWithoutDeadline[0].ambiguities, [])

const apiTaskWithoutDeadline = await callGptInbox({ items: [{ type: 'task', title: '洗剤を買う' }] })
assert.equal(apiTaskWithoutDeadline.body.items[0].deadlineIsFallback, true)
assert.equal(apiTaskWithoutDeadline.body.items[0].confidence, 'medium')
assert.equal(apiTaskWithoutDeadline.body.items[0].deadline, '')
assert.deepEqual(apiTaskWithoutDeadline.body.items[0].ambiguities, [])

const invalidTaskDate = normalizeGptInboxPayload({
  items: [{ type: 'task', title: 'レポートを提出する', deadline: '明日18時' }],
})
assert.equal(invalidTaskDate[0].deadline, '')
assert.deepEqual(invalidTaskDate[0].ambiguities, ['締切の日時形式を確認'])
assert.equal(canAutoAddInboxItem(invalidTaskDate[0]), false)

const invalidEventDate = normalizeGptInboxPayload({
  items: [{ type: 'event', title: '美容院', startAt: '明日15時' }],
})
assert.equal(invalidEventDate[0].startIsFallback, true)
assert.deepEqual(invalidEventDate[0].ambiguities, ['開始日時を確認'])
assert.equal(canAutoAddInboxItem(invalidEventDate[0]), false)

const apiDeadline = await callGptInbox({
  sourceText: '金曜18時までにレポートを提出する',
  items: [{ type: 'task', title: 'レポートを提出する', deadline: '2026-06-26T18:00', startAt: '2026-06-26T18:00', category: '予定' }],
})
assert.equal(apiDeadline.status, 200)
assert.equal(apiDeadline.body.items[0].type, 'task')
assert.equal(apiDeadline.body.items[0].category, '課題')
assert.equal(apiDeadline.body.delivery, 'link')
assert.equal(apiDeadline.body.requiresOpen, true)

const apiShift = await callGptInbox({
  sourceText: '毎週金曜18時からバイト',
  items: [{ type: 'event', title: 'バイト', startAt: '2026-06-26T18:00', endAt: '2026-06-26T22:00', recurrence: 'weekly' }],
})
assert.equal(apiShift.body.items[0].type, 'event')
assert.equal(apiShift.body.items[0].startAt, '2026-06-26T18:00')
assert.equal(apiShift.body.items[0].recurrence, 'weekly')

const smartCandidate = normalizeGptInboxPayload({
  items: [{ id: 'stable-id', type: 'task', title: '申請内容を確認', deadline: '2026-07-02', confidence: 'low', ambiguities: ['締切時刻が未確認'], createdAt: '2026-07-01T10:00:00.000Z' }],
})[0]
assert.equal(smartCandidate.id, 'stable-id')
assert.equal(smartCandidate.confidence, 'low')
assert.deepEqual(smartCandidate.ambiguities, ['締切時刻が未確認'])
assert.equal(smartCandidate.createdAt, '2026-07-01T10:00:00.000Z')
assert.equal(canAutoAddInboxItem(gptItems[0]), true)
assert.equal(canAutoAddInboxItem(gptEventItems[0]), true)
assert.equal(canAutoAddInboxItem(eventWithoutTime[0]), false)
assert.equal(canAutoAddInboxItem(taskWithoutDeadline[0]), true)

const originalFetch = globalThis.fetch
const originalSyncToken = process.env.SYNC_ACCESS_TOKEN
const originalRedisUrl = process.env.UPSTASH_REDIS_REST_URL
const originalRedisToken = process.env.UPSTASH_REDIS_REST_TOKEN
const pipelines = []
const queuedStore = new Map()
const keyValueStore = new Map()
process.env.SYNC_ACCESS_TOKEN = 'personal-test-token'
process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example'
process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-test-token'
globalThis.fetch = async (_url, options) => {
  const commands = JSON.parse(options.body)
  pipelines.push(commands)
  const results = commands.map(command => {
    if (command[0] === 'GET') return { result: keyValueStore.get(command[1]) ?? null }
    if (command[0] === 'SET') { keyValueStore.set(command[1], command[2]); return { result: 'OK' } }
    if (command[0] === 'HSET') { queuedStore.set(command[2], command[3]); return { result: 1 } }
    if (command[0] === 'HVALS') return { result: [...queuedStore.values()] }
    if (command[0] === 'HDEL') {
      let removed = 0
      for (const id of command.slice(2)) if (queuedStore.delete(id)) removed += 1
      return { result: removed }
    }
    return { result: 1 }
  })
  return { ok: true, status: 200, json: async () => results }
}

const directSync = await callGptInbox({
  sourceText: '明日の17時までに申請する',
  items: [{ type: 'task', title: '申請する', deadline: '2026-07-02T17:00', confidence: 'high' }],
}, { headers: { authorization: 'Bearer personal-test-token' } })
assert.equal(directSync.status, 200)
assert.equal(directSync.body.delivery, 'synced')
assert.equal(directSync.body.requiresOpen, false)
assert.equal(directSync.body.items[0].id.length, 24)
assert.equal(pipelines[0][0][0], 'HSET')
assert.equal(pipelines[0].at(-1)[0], 'EXPIRE')

const cloudRead = await callGptInbox(undefined, { method: 'GET', headers: { authorization: 'Bearer personal-test-token' } })
assert.equal(cloudRead.status, 200)
assert.equal(cloudRead.body.count, 1)
assert.equal(cloudRead.body.items[0].title, '申請する')

const cloudDelete = await callGptInbox({ ids: [directSync.body.items[0].id] }, { method: 'DELETE', headers: { authorization: 'Bearer personal-test-token' } })
assert.equal(cloudDelete.body.removed, 1)

const unauthorizedSync = await callGptInbox({ items: [{ type: 'task', title: '確認する' }] })
assert.equal(unauthorizedSync.status, 401)

const cloudHeaders = { authorization: 'Bearer personal-test-token' }
const emptyAppData = await callAppData(undefined, { method: 'GET', headers: cloudHeaders })
assert.equal(emptyAppData.status, 200)
assert.equal(emptyAppData.body.exists, false)
assert.equal(emptyAppData.body.revision, 0)

const savedAppData = await callAppData({
  baseRevision: 0,
  data: {
    tasks: [{ id: 'task-1', title: '同期テスト', updatedAt: '2026-07-03T00:00:00.000Z' }],
    events: [{ id: 'event-1', title: 'ゼミ', startAt: '2099-07-03T14:00', endAt: '2099-07-03T15:00' }],
    moodLogs: [{ id: 'mood-1', date: '2026-07-03', mood: 'tired', memo: '寝不足' }],
    diaries: [{ id: 'diary-1', date: '2026-07-03', mood: 'tired', doneToday: '資料を開いた', hardThings: '寝不足', carryOver: '見出し', freeMemo: '', aiComment: '' }],
    gptInbox: [],
    settings: { name: 'レディ', gptShareTasks: true, gptShareMood: true, gptShareDiary: true },
  },
}, { method: 'PUT', headers: cloudHeaders })
assert.equal(savedAppData.status, 200)
assert.equal(savedAppData.body.revision, 1)

const loadedAppData = await callAppData(undefined, { method: 'GET', headers: cloudHeaders })
assert.equal(loadedAppData.body.exists, true)
assert.equal(loadedAppData.body.data.tasks[0].title, '同期テスト')

const gptContext = await callGptContext({ headers: cloudHeaders })
assert.equal(gptContext.status, 200)
assert.equal(gptContext.body.tasks[0].title, '同期テスト')
assert.equal(gptContext.body.events[0].title, 'ゼミ')
assert.equal(gptContext.body.moodLogs[0].memo, '寝不足')
assert.equal(gptContext.body.diaries[0].doneToday, '資料を開いた')
assert.equal(gptContext.body.timeZone, 'Asia/Tokyo')
assert.equal(gptContext.body.locale, 'ja-JP')
assert.match(gptContext.body.currentLocalDateTime, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
assert.match(gptContext.body.usageNote, /長く引用しない/)

const unauthorizedContext = await callGptContext()
assert.equal(unauthorizedContext.status, 401)

const staleAppData = await callAppData({ baseRevision: 0, data: { tasks: [] } }, { method: 'PUT', headers: cloudHeaders })
assert.equal(staleAppData.status, 409)
assert.equal(staleAppData.body.revision, 1)

const unauthorizedAppData = await callAppData(undefined, { method: 'GET' })
assert.equal(unauthorizedAppData.status, 401)

globalThis.fetch = originalFetch
if (originalSyncToken === undefined) delete process.env.SYNC_ACCESS_TOKEN; else process.env.SYNC_ACCESS_TOKEN = originalSyncToken
if (originalRedisUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL; else process.env.UPSTASH_REDIS_REST_URL = originalRedisUrl
if (originalRedisToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN; else process.env.UPSTASH_REDIS_REST_TOKEN = originalRedisToken

const actionSchema = JSON.parse(await readFile(new URL('../public/gpt-action-openapi.json', import.meta.url), 'utf8'))
const itemSchema = actionSchema.paths['/api/gpt-inbox'].post.requestBody.content['application/json'].schema.properties.items.items
assert.deepEqual(itemSchema.required, ['type', 'title'])
assert.equal(itemSchema.properties.category.enum.includes('予定'), false)
assert.deepEqual(itemSchema.properties.confidence.enum, ['high', 'medium', 'low'])
assert.equal(actionSchema.info.version, '2.1.0')
assert.equal(actionSchema.paths['/api/gpt-context'].get.operationId, 'getLadyButlerContext')
assert.ok(actionSchema.paths['/api/gpt-context'].get.responses['200'].content['application/json'].schema.properties.currentLocalDateTime)
assert.equal(actionSchema.paths['/api/gpt-context'].get['x-openai-isConsequential'], false)
assert.equal(actionSchema.paths['/api/gpt-inbox'].post['x-openai-isConsequential'], false)
assert.match(actionSchema.paths['/api/gpt-inbox'].post.description, /real future tasks or events/)
assert.match(actionSchema.paths['/api/gpt-inbox'].post.description, /getLadyButlerContext/)
assert.ok(actionSchema.paths['/api/gpt-inbox'].post.description.length <= 300)

const gptInstructions = await readFile(new URL('../public/gpt-instructions.txt', import.meta.url), 'utf8')
assert.match(gptInstructions, /currentLocalDateTime/)
assert.match(gptInstructions, /締切がなくても/)
assert.match(gptInstructions, /開始日と開始時刻/)

console.log('コア機能テスト: OK')
