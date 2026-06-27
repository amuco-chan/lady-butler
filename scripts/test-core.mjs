import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import gptInboxHandler from '../api/gpt-inbox.js'
import { dayPlan, defaultSettings, formatEventTime, inboxItemToEvent, inboxItemToTask, makeDiaryComment, moodGuidance, moodTrend, normalizeGptInboxPayload, sampleTasks, scheduleLoadFor, taskLimitForSchedule } from '../src/lib.ts'

async function callGptInbox(body) {
  let responseBody = ''
  const req = { method: 'POST', body, headers: { host: 'lady-butler.vercel.app', 'x-forwarded-proto': 'https' } }
  const res = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(value) { responseBody = String(value) },
  }
  await gptInboxHandler(req, res)
  return { status: res.statusCode, body: JSON.parse(responseBody) }
}

assert.equal(defaultSettings.name, 'レディ')
assert.equal(defaultSettings.tone, '執事')
assert.equal(defaultSettings.strictness, '標準')
assert.equal(defaultSettings.remindersEnabled, false)
assert.equal(defaultSettings.reminderTime, '21:30')

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

assert.match(moodGuidance('tired'), /詰め込む日ではありません/)
assert.match(moodTrend([{ id: '1', date: '2026-06-24', mood: 'tired', memo: '', createdAt: '', updatedAt: '' }]), /最近の気分/)

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

const apiDeadline = await callGptInbox({
  sourceText: '金曜18時までにレポートを提出する',
  items: [{ type: 'task', title: 'レポートを提出する', deadline: '2026-06-26T18:00', startAt: '2026-06-26T18:00', category: '予定' }],
})
assert.equal(apiDeadline.status, 200)
assert.equal(apiDeadline.body.items[0].type, 'task')
assert.equal(apiDeadline.body.items[0].category, '課題')

const apiShift = await callGptInbox({
  sourceText: '金曜18時からバイト',
  items: [{ type: 'event', title: 'バイト', startAt: '2026-06-26T18:00', endAt: '2026-06-26T22:00' }],
})
assert.equal(apiShift.body.items[0].type, 'event')
assert.equal(apiShift.body.items[0].startAt, '2026-06-26T18:00')

const actionSchema = JSON.parse(await readFile(new URL('../public/gpt-action-openapi.json', import.meta.url), 'utf8'))
const itemSchema = actionSchema.paths['/api/gpt-inbox'].post.requestBody.content['application/json'].schema.properties.items.items
assert.deepEqual(itemSchema.required, ['type', 'title'])
assert.equal(itemSchema.properties.category.enum.includes('予定'), false)

console.log('コア機能テスト: OK')
