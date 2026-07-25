import { exchangeCodeForTokens, getGmailProfile, requestOrigin, saveGmailConnection, verifyGmailState } from '../server/gmail.js'
import { text } from '../server/sync-auth.js'

function redirect(res, location) {
  res.statusCode = 302
  res.setHeader('Location', location)
  res.end()
}

export default async function handler(req, res) {
  const origin = requestOrigin(req)
  const params = new URL(req.url || '/api/gmail-callback', origin).searchParams
  const code = text(params.get('code'))
  const state = text(params.get('state'))
  const error = text(params.get('error'))

  if (error) return redirect(res, `${origin}/?gmail=error&reason=${encodeURIComponent(error)}`)
  if (!code || !state) return redirect(res, `${origin}/?gmail=error&reason=missing_code`)

  try {
    const storedState = await verifyGmailState(state)
    if (!storedState) return redirect(res, `${origin}/?gmail=error&reason=state`)

    const tokens = await exchangeCodeForTokens(req, code)
    if (!tokens.refresh_token) return redirect(res, `${origin}/?gmail=error&reason=no_refresh_token`)

    const profile = await getGmailProfile(tokens.access_token)
    await saveGmailConnection(req, {
      refreshToken: tokens.refresh_token,
      emailAddress: profile.emailAddress || '',
      connectedAt: new Date().toISOString(),
    })
    return redirect(res, `${origin}/?gmail=connected`)
  } catch (caught) {
    return redirect(res, `${origin}/?gmail=error&reason=${encodeURIComponent(String(caught?.message || caught).slice(0, 80))}`)
  }
}
