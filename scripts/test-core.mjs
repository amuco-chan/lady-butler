import assert from 'node:assert/strict'
import { dayPlan, defaultSettings, formatEventTime, inboxItemToEvent, inboxItemToTask, makeDiaryComment, moodGuidance, moodTrend, normalizeGptInboxPayload, sampleTasks } from '../src/lib.ts'

assert.equal(defaultSettings.name, 'レディ')
assert.equal(defaultSettings.tone, '執事')
assert.equal(defaultSettings.strictness, '標準')

const tiredPlan = dayPlan(sampleTasks, 'tired')
assert.equal(tiredPlan.today.length, 2)
assert.equal(tiredPlan.top?.title, '心理学レポートの構成を作る')

const exhaustedPlan = dayPlan(sampleTasks, 'exhausted')
assert.equal(exhaustedPlan.today.length, 1)

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

console.log('コア機能テスト: OK')
