import { authorizeSyncRequest, redisConfig, syncAuthAvailable } from '../server/sync-auth.js'
import { calendarCanWrite, getFreshCalendarAccessToken, getPrimaryCalendar, listCalendarEvents, readCalendarConnection, sendJson, upsertGoogleCalendarEvent } from '../server/google-calendar.js'

const maxBodyBytes = 64 * 1024

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
    const mode = String(body.mode || '')
    const daysBefore = Math.min(30, Math.max(0, Number(body.daysBefore) || 7))
    const daysAfter = Math.min(365, Math.max(7, Number(body.daysAfter) || 90))
    const maxResults = Math.min(100, Math.max(10, Number(body.maxResults) || 80))

    const accessToken = await getFreshCalendarAccessToken(req)
    if (!accessToken) return sendJson(res, 409, { ok: false, error: 'Googleカレンダーの接続を確認できませんでした。もう一度接続してください。' })

    if (mode === 'syncToGoogle') {
      if (!calendarCanWrite(connection)) {
        return sendJson(res, 403, {
          ok: false,
          needsReconnect: true,
          error: 'Googleカレンダーへ反映する権限がまだありません。もう一度「Googleカレンダーを接続」を押してください。',
        })
      }

      const events = Array.isArray(body.events) ? body.events.slice(0, 40) : []
      if (!events.length) return sendJson(res, 400, { ok: false, error: '反映する予定がありません。' })

      const calendar = await getPrimaryCalendar(accessToken)
      if (!calendar?.id) return sendJson(res, 409, { ok: false, error: '反映先のGoogleカレンダーを確認できませんでした。' })

      const synced = []
      for (const event of events) {
        const item = await upsertGoogleCalendarEvent(accessToken, calendar, event)
        if (item) synced.push(item)
      }
      return sendJson(res, 200, {
        ok: true,
        connectedAs: connection.emailAddress || calendar.summary || '',
        calendarName: calendar.summaryOverride || calendar.summary || connection.calendarName || '',
        items: synced,
        message: synced.length ? `${synced.length}件の予定をGoogleカレンダーへ反映しました。` : '反映できる予定はありませんでした。',
      })
    }

    const start = new Date()
    start.setDate(start.getDate() - daysBefore)
    start.setHours(0, 0, 0, 0)
    const end = new Date()
    end.setDate(end.getDate() + daysAfter)
    end.setHours(23, 59, 59, 999)

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
    const message = String(error?.message || error)
    const needsReconnect = error?.status === 401 || error?.status === 403 || /insufficient|permission|scope/i.test(message)
    return sendJson(res, needsReconnect ? 403 : 400, {
      ok: false,
      needsReconnect,
      error: needsReconnect ? 'Googleカレンダーの権限を確認できませんでした。再接続してください。' : 'Googleカレンダーの予定を確認できませんでした。',
      detail: message,
    })
  }
}
