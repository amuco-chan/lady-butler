import { exchangeCodeForCalendarTokens, getPrimaryCalendar, requestOrigin, saveCalendarConnection, verifyCalendarState } from '../server/google-calendar.js'
import { text } from '../server/sync-auth.js'

function redirect(res, location) {
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}

export default async function handler(req, res) {
  const origin = requestOrigin(req)
  const params = new URL(req.url || '/api/calendar-callback', origin).searchParams
  const code = text(params.get('code'))
  const state = text(params.get('state'))
  const error = text(params.get('error'))

  if (error) return redirect(res, `${origin}/?calendar=error&reason=${encodeURIComponent(error)}`)
  if (!code || !state) return redirect(res, `${origin}/?calendar=error&reason=missing_code`)

  try {
    const storedState = await verifyCalendarState(state)
    if (!storedState) return redirect(res, `${origin}/?calendar=error&reason=state`)

    const tokens = await exchangeCodeForCalendarTokens(req, code)
    if (!tokens.refresh_token) return redirect(res, `${origin}/?calendar=error&reason=no_refresh_token`)

    const calendar = await getPrimaryCalendar(tokens.access_token)
    await saveCalendarConnection(req, {
      refreshToken: tokens.refresh_token,
      scope: tokens.scope || '',
      emailAddress: calendar?.summaryOverride || calendar?.summary || '',
      calendarId: calendar?.id || 'primary',
      calendarName: calendar?.summaryOverride || calendar?.summary || 'Googleカレンダー',
      connectedAt: new Date().toISOString(),
      tokenHash: storedState.tokenHash || '',
    })
    return redirect(res, `${origin}/?calendar=connected`)
  } catch (caught) {
    return redirect(res, `${origin}/?calendar=error&reason=${encodeURIComponent(String(caught?.message || caught).slice(0, 80))}`)
  }
}
