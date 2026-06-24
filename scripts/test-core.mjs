import assert from 'node:assert/strict'
import { dayPlan, defaultSettings, makeDiaryComment, moodGuidance, moodTrend, sampleTasks } from '../src/lib.ts'

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

console.log('コア機能テスト: OK')
