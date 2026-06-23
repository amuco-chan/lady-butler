import assert from 'node:assert/strict'
import handler from '../api/chat.js'

process.env.OPENAI_API_KEY = 'test-openai-key'
process.env.APP_ACCESS_TOKEN = 'test-app-token'

async function invoke({ token = 'test-app-token', body = { input: 'こんにちは' } } = {}) {
  let statusCode = 200
  let payload
  const req = { method: 'POST', headers: { 'x-app-token': token }, body }
  const res = {
    status(code) { statusCode = code; return this },
    json(value) { payload = value; return this },
  }
  await handler(req, res)
  return { statusCode, payload }
}

const originalFetch = globalThis.fetch
let requestBody
globalThis.fetch = async (_url, options) => {
  requestBody = JSON.parse(options.body)
  return {
    ok: true,
    status: 200,
    json: async () => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'お帰りなさいませ、レディ。' }] }] }),
  }
}

const unauthorized = await invoke({ token: 'wrong-token' })
assert.equal(unauthorized.statusCode, 401)

const success = await invoke({ body: { input: 'こんにちは', history: [], tasks: [], moodLogs: [], diaries: [], settings: { name: 'レディ' } } })
assert.equal(success.statusCode, 200)
assert.equal(success.payload.reply, 'お帰りなさいませ、レディ。')
assert.equal(requestBody.model, 'gpt-5.4-mini')
assert.equal(requestBody.store, false)
assert.equal(requestBody.reasoning.effort, 'low')
assert.match(requestBody.instructions, /パーソナル執事AI/)

globalThis.fetch = originalFetch
console.log('OpenAI API接続テスト: OK')
