import { authorizeSyncRequest, redisConfig, syncAuthAvailable } from '../server/sync-auth.js'
import { getFreshCalendarAccessToken, listCalendarEvents, readCalendarConnection, sendJson } from '../server/google-calendar.js'

const maxBodyBytes = 4 * 1024

async function readJson(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
  if (body.length > maxBodyBytes) throw new Error('payload too large')
  return body.length ? JSON.parse(body.toString('utf8')) : {}
}

async function requireSync(req, res) {
  if (!redisConfig() || !(await syncAuthAvailable())) {
    sendJson(res, 503, { ok: false, error: 'PC・スマホ同期のクラウド保存が先に必要です。' })
    return false
  }
  if (!(await authorizeSyncRequest(req))) {
    sendJson(res, 401, { ok: false, error: '共通同期キーが一致しません。' })
    return false
  }
  return true
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true })
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
  if (!(await requireSync(req, res))) return

  try {
    const connection = await readCalendarConnection(req)
    if (!connection?.refreshToken) return sendJson(res, 409, { ok: false, error: 'Googleカレンダーがまだ接続されていません。' })

    const body = await readJson(req)
    const daysBefore = Math.min(30, Math.max(0, Number(body.daysBefore) || 7))
    const daysAfter = Math.min(365, Math.max(7, Number(body.daysAfter) || 90))
    const maxResults = Math.min(100, Math.max(10, Number(body.maxResults) || 80))
    const start = new Date()
    start.setDate(start.getDate() - daysBefore)
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setDate(end.getDate() + daysAfter)
    end.setHours(23, 59, 59, 999)

    const accessToken = await getFreshCalendarAccessToken(req)
    if (!accessToken) return sendJson(res, 409, { ok: false, error: 'Googleカレンダーの接続を確認できませんでした。もう一度接続してください。' })

    const { calendar, items } = await listCalendarEvents(accessToken, {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      maxResults,
    })
    return sendJson(res, 200, {
      ok: true,
      connectedAs: connection.emailAddress || calendar?.summary || '',
      calendarName: calendar?.summaryOverride || calendar?.summary || connection.calendarName || '',
      scanned: items.length,
      daysBefore,
      daysAfter,
      items,
      message: items.length ? `${items.length}件の予定を読み込みました。` : '読み込める予定は見つかりませんでした。',
    })
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: 'Googleカレンダーの予定を確認できませんでした。', detail: String(error?.message || error) })
  }
}
