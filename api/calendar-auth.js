import { authorizeSyncRequest, redisConfig, syncAuthAvailable } from '../server/sync-auth.js'
import { calendarCanWrite, calendarSetupState, createCalendarAuthUrl, readCalendarConnection, removeCalendarConnection, sendJson } from '../server/google-calendar.js'

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
  if (!(await requireSync(req, res))) return

  try {
    const setup = calendarSetupState(req)

    if (req.method === 'GET') {
      const connection = setup.configured ? await readCalendarConnection(req) : null
      return sendJson(res, 200, {
        ok: true,
        configured: setup.configured,
        connected: !!connection?.refreshToken,
        canWrite: calendarCanWrite(connection),
        emailAddress: connection?.emailAddress || '',
        calendarId: connection?.calendarId || '',
        calendarName: connection?.calendarName || '',
        connectedAt: connection?.connectedAt || '',
        needs: setup.needs,
        redirectUri: setup.redirectUri,
      })
    }

    if (req.method === 'POST') {
      if (!setup.configured) {
        return sendJson(res, 503, {
          ok: false,
          error: 'Googleカレンダー連携の準備がまだです。',
          needs: setup.needs,
          redirectUri: setup.redirectUri,
        })
      }
      const url = await createCalendarAuthUrl(req)
      return sendJson(res, 200, { ok: true, url })
    }

    if (req.method === 'DELETE') {
      const removed = await removeCalendarConnection()
      return sendJson(res, 200, { ok: true, disconnected: true, removed })
    }

    return sendJson(res, 405, { ok: false, error: 'GET, POST or DELETE only' })
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: 'Googleカレンダー連携を処理できませんでした。', detail: String(error?.message || error) })
  }
}
