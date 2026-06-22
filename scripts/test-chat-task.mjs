import assert from 'node:assert/strict'
import { isTaskAddRequest, makeButlerReply, taskFromChat } from '../src/lib.ts'

const parse = input => taskFromChat(input)?.task

const report = parse('明日18時までに心理学レポートを提出するタスクを追加して')
assert.equal(report?.title, '心理学レポートを提出する')
assert.equal(report?.category, '課題')
assert.equal(report?.priority, '高')
assert.match(report?.deadline || '', /T18:00$/)

const shopping = taskFromChat('牛乳を買うをタスクに追加して')
assert.equal(shopping?.task.title, '牛乳を買う')
assert.equal(shopping?.task.category, '買い物')
assert.equal(shopping?.task.estimatedMinutes, 20)
assert.equal(shopping?.usedDefaultDeadline, true)

const housework = parse('金曜までに部屋を掃除する、30分、優先度低で追加して')
assert.equal(housework?.title, '部屋を掃除する')
assert.equal(housework?.category, '生活')
assert.equal(housework?.priority, '低')
assert.equal(housework?.estimatedMinutes, 30)

const longTask = parse('レポートを書く、2時間30分のタスクを追加して')
assert.equal(longTask?.title, 'レポートを書く')
assert.equal(longTask?.estimatedMinutes, 150)
assert.doesNotMatch(longTask?.deadline || '', /T02:00$/)

const numericDate = parse('6/30 15:30に病院へ行く予定を追加して')
assert.equal(numericDate?.title, '病院へ行く')
assert.equal(numericDate?.category, '予定')
assert.match(numericDate?.deadline || '', /-06-30T15:30$/)

assert.equal(isTaskAddRequest('今日の相談をしたい'), false)
assert.equal(taskFromChat('タスク追加して'), null)

const tasks = report ? [report] : []
assert.match(makeButlerReply('こんにちは', '通常相談', tasks), /こんにちは/)
assert.doesNotMatch(makeButlerReply('こんにちは', '通常相談', tasks), /最優先/)
assert.match(makeButlerReply('話を聞いてほしい', '通常相談', tasks), /結論を急がず/)
assert.doesNotMatch(makeButlerReply('彼氏から返信がない', '通常相談', tasks), /最優先/)
assert.match(makeButlerReply('今日なにすればいい？', '通常相談', tasks), /【今日の最優先】/)
assert.match(makeButlerReply('今日レポートできた', '通常相談', tasks), /前進/)
assert.match(makeButlerReply('死にたい', '通常相談', tasks), /一人で抱えない/)

console.log('AIチャットのタスク追加テスト: OK')
