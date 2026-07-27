import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { bearerToken, redisPipeline, syncTokenHash, text } from './sync-auth.js'

const tokenKey = 'lady-butler:google-calendar-token:v1'
const statePrefix = 'lady-butler:google-calendar-oauth-state:v1:'
const calendarReadScope = 'https://www.googleapis.com/auth/calendar.readonly'
const calendarWriteScope = 'https://www.googleapis.com/auth/calendar.events'
const calendarScopes = [calendarReadScope, calendarWriteScope]
const defaultTimeZone = 'Asia/Tokyo'

export function sendJson(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(data))
}

export function requestOrigin(req) {
  const proto = text(req.headers?.['x-forwarded-proto']) || 'https'
  const host = text(req.headers?.['x-forwarded-host'] || req.headers?.host)
  return host ? `${proto.split(',')[0]}://${host.split(',')[0]}` : 'https://lady-butler.vercel.app'
}

export function calendarConfig(req) {
  const clientId = text(process.env.CALENDAR_CLIENT_ID || process.env.GMAIL_CLIENT_ID)
  const clientSecret = text(process.env.CALENDAR_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET)
  const redirectUri = text(process.env.CALENDAR_REDIRECT_URI) || `${requestOrigin(req)}/api/calendar-callback`
  const secret = text(process.env.CALENDAR_TOKEN_SECRET || process.env.GMAIL_TOKEN_SECRET || process.env.GPT_ACTION_TOKEN || process.env.SYNC_ACCESS_TOKEN)
  return clientId && clientSecret && secret ? { clientId, clientSecret, redirectUri, secret } : null
}

export function calendarSetupState(req) {
  const hasClientId = !!text(process.env.CALENDAR_CLIENT_ID || process.env.GMAIL_CLIENT_ID)
  const hasClientSecret = !!text(process.env.CALENDAR_CLIENT_SECRET || process.env.GMAIL_CLIENT_SECRET)
  const hasTokenSecret = !!text(process.env.CALENDAR_TOKEN_SECRET || process.env.GMAIL_TOKEN_SECRET || process.env.GPT_ACTION_TOKEN || process.env.SYNC_ACCESS_TOKEN)
  return {
    configured: !!calendarConfig(req),
    needs: [
      !hasClientId ? 'CALENDAR_CLIENT_ID または GMAIL_CLIENT_ID' : '',
      !hasClientSecret ? 'CALENDAR_CLIENT_SECRET または GMAIL_CLIENT_SECRET' : '',
      !hasTokenSecret ? 'CALENDAR_TOKEN_SECRET または GMAIL_TOKEN_SECRET' : '',
    ].filter(Boolean),
    redirectUri: text(process.env.CALENDAR_REDIRECT_URI) || `${requestOrigin(req)}/api/calendar-callback`,
  }
}

function encryptionKey(secret) {
  return createHash('sha256').update(secret).digest()
}

function encryptJson(value, secret) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

function decryptJson(value, secret) {
  const raw = text(value)
  if (!raw) return null
  if (!raw.startsWith('v1:')) return JSON.parse(raw)
  const [, ivText, tagText, encryptedText] = raw.split(':')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()])
  return JSON.parse(decrypted.toString('utf8'))
}

export async function createCalendarAuthUrl(req) {
  const config = calendarConfig(req)
  if (!config) return null
  const state = randomBytes(24).toString('base64url')
  const tokenHash = syncTokenHash(bearerToken(req))
  await redisPipeline([
    ['SET', `${statePrefix}${state}`, JSON.stringify({ tokenHash, createdAt: new Date().toISOString() }), 'EX', '900'],
  ])
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: calendarScopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function verifyCalendarState(state) {
  const key = `${statePrefix}${text(state)}`
  const [raw] = await redisPipeline([['GET', key], ['DEL', key]])
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function exchangeCodeForCalendarTokens(req, code) {
  const config = calendarConfig(req)
  if (!config) throw new Error('calendar config missing')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code: text(code),
      grant_type: 'authorization_code',
      redirect_uri: config.redirectUri,
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'calendar token exchange failed')
  return payload
}

export async function refreshCalendarAccessToken(req, refreshToken) {
  const config = calendarConfig(req)
  if (!config) throw new Error('calendar config missing')
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'calendar token refresh failed')
  return payload.access_token
}

export async function readCalendarConnection(req) {
  const config = calendarConfig(req)
  if (!config) return null
  const [raw] = await redisPipeline([['GET', tokenKey]])
  if (!raw) return null
  return decryptJson(raw, config.secret)
}

export async function saveCalendarConnection(req, connection) {
  const config = calendarConfig(req)
  if (!config) throw new Error('calendar config missing')
  await redisPipeline([['SET', tokenKey, encryptJson(connection, config.secret)]])
}

export async function removeCalendarConnection() {
  const [removed = 0] = await redisPipeline([['DEL', tokenKey]])
  return Number(removed) || 0
}

export function calendarCanWrite(connection) {
  return text(connection?.scope).split(/\s+/).includes(calendarWriteScope)
}

export async function calendarFetch(accessToken, url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || `calendar request failed: ${response.status}`)
    error.status = response.status
    error.reason = payload.error?.status || payload.error?.code || payload.error || ''
    throw error
  }
  return payload
}

export async function getFreshCalendarAccessToken(req) {
  const connection = await readCalendarConnection(req)
  if (!connection?.refreshToken) return null
  return refreshCalendarAccessToken(req, connection.refreshToken)
}

export async function getPrimaryCalendar(accessToken) {
  const payload = await calendarFetch(accessToken, 'https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader')
  const calendars = Array.isArray(payload.items) ? payload.items : []
  return calendars.find(item => item.primary) || calendars[0] || null
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function toLocalDateTimeValue(date, timeZone = defaultTimeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value
    return acc
  }, {})
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

function dateTimeTextFromGoogleDate(value, endExclusive = false) {
  const [year, month, day] = text(value).split('-').map(Number)
  if (!year || !month || !day) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (endExclusive) date.setUTCDate(date.getUTCDate() - 1)
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${endExclusive ? '23:59' : '00:00'}`
}

function dateTimeFromGoogleDate(value, endExclusive = false) {
  const dateTimeText = dateTimeTextFromGoogleDate(value, endExclusive)
  return dateTimeText ? new Date(`${dateTimeText}:00+09:00`) : null
}

function dateTimeFromGoogleValue(value, endExclusive = false) {
  if (value?.dateTime) {
    const date = new Date(value.dateTime)
    return Number.isNaN(date.getTime()) ? null : date
  }
  if (value?.date) return dateTimeFromGoogleDate(value.date, endExclusive)
  return null
}

function compactText(value, max = 160) {
  const clean = text(value).replace(/\s+/g, ' ')
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function datePart(value) {
  const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function addDaysToDateText(value, days) {
  const [year, month, day] = datePart(value).split('-').map(Number)
  if (!year || !month || !day) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

function googleDateTime(value) {
  const clean = text(value)
  const match = clean.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/)
  return match ? `${match[1]}T${match[2]}:${match[3]}:00+09:00` : ''
}

function recurrenceRule(event) {
  const recurrence = text(event?.recurrence)
  const frequency = recurrence === 'daily' ? 'DAILY' : recurrence === 'weekly' ? 'WEEKLY' : recurrence === 'monthly' ? 'MONTHLY' : ''
  if (!frequency) return ''
  const until = datePart(event?.recurrenceUntil)
  return until ? `RRULE:FREQ=${frequency};UNTIL=${until.replaceAll('-', '')}T145959Z` : `RRULE:FREQ=${frequency}`
}

export function appEventToGooglePayload(event) {
  const title = compactText(event?.title || '(予定名なし)', 120)
  const allDay = !!event?.allDay
  const startDate = datePart(event?.startAt)
  const endDate = datePart(event?.endAt) || startDate
  const payload = {
    summary: title,
    location: compactText(event?.location || '', 120),
    description: compactText(event?.memo || 'Lady Butlerから反映', 1000),
    start: allDay
      ? { date: startDate }
      : { dateTime: googleDateTime(event?.startAt), timeZone: defaultTimeZone },
    end: allDay
      ? { date: addDaysToDateText(endDate, 1) || addDaysToDateText(startDate, 1) }
      : { dateTime: googleDateTime(event?.endAt), timeZone: defaultTimeZone },
  }
  const rule = recurrenceRule(event)
  if (rule) payload.recurrence = [rule]
  return payload
}

export function normalizeAppCalendarEvent(value) {
  const title = compactText(value?.title, 120)
  const startAt = text(value?.startAt)
  const endAt = text(value?.endAt)
  if (!title || !startAt || !endAt) return null
  const recurrence = ['daily', 'weekly', 'monthly'].includes(text(value?.recurrence)) ? text(value.recurrence) : 'none'
  const source = ['manual', 'gpt', 'ics', 'google'].includes(text(value?.source)) ? text(value.source) : 'manual'
  return {
    id: text(value?.id).slice(0, 180) || randomBytes(12).toString('base64url'),
    title,
    startAt,
    endAt,
    location: compactText(value?.location || '', 120),
    memo: compactText(value?.memo || '', 1000),
    recurrence,
    recurrenceUntil: datePart(value?.recurrenceUntil),
    source,
    sourceEventId: text(value?.sourceEventId).slice(0, 180),
    calendarId: text(value?.calendarId).slice(0, 180),
    allDay: !!value?.allDay,
    googleEventId: text(value?.googleEventId).slice(0, 180),
    googleCalendarId: text(value?.googleCalendarId).slice(0, 180),
    googleSyncedAt: text(value?.googleSyncedAt),
    createdAt: text(value?.createdAt) || new Date().toISOString(),
    updatedAt: text(value?.updatedAt) || new Date().toISOString(),
  }
}

export function normalizeGoogleCalendarEvent(item, calendar = {}, now = new Date()) {
  const allDay = !!item?.start?.date && !item?.start?.dateTime
  const eventTimeZone = text(item?.start?.timeZone || item?.end?.timeZone || calendar.timeZone) || defaultTimeZone
  const start = dateTimeFromGoogleValue(item?.start)
  if (!start) return null
  const parsedEnd = dateTimeFromGoogleValue(item?.end, allDay)
  const end = parsedEnd && parsedEnd > start ? parsedEnd : new Date(start.getTime() + 60 * 60 * 1000)
  const title = compactText(item.summary || '(予定名なし)', 120)
  const calendarId = text(calendar.id || item.organizer?.email || 'primary')
  const sourceId = text(item.id || `${title}-${start.toISOString()}`)
  const startAt = allDay ? dateTimeTextFromGoogleDate(item?.start?.date) : toLocalDateTimeValue(start, eventTimeZone)
  const endAt = allDay
    ? (item?.end?.date ? dateTimeTextFromGoogleDate(item.end.date, true) : `${text(item?.start?.date)}T23:59`)
    : toLocalDateTimeValue(end, eventTimeZone)
  if (!startAt || !endAt) return null
  return {
    id: `google-${calendarId}-${sourceId}`.slice(0, 180),
    title,
    startAt,
    endAt,
    location: compactText(item.location || '', 120),
    memo: compactText(item.description || (calendar.summary ? `Googleカレンダー：${calendar.summary}` : 'Googleカレンダーから読み込み'), 260),
    recurrence: 'none',
    recurrenceUntil: '',
    source: 'google',
    sourceEventId: sourceId,
    calendarId,
    googleEventId: sourceId,
    googleCalendarId: calendarId,
    googleSyncedAt: now.toISOString(),
    allDay,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }
}

export async function upsertGoogleCalendarEvent(accessToken, calendar, event, now = new Date()) {
  const cleanEvent = normalizeAppCalendarEvent(event)
  if (!cleanEvent || cleanEvent.source === 'google') return null
  const calendarId = text(cleanEvent.googleCalendarId || calendar?.id || 'primary')
  const payload = appEventToGooglePayload(cleanEvent)
  if (!payload.start?.date && !payload.start?.dateTime) throw new Error('予定の開始日時を確認してください。')
  if (!payload.end?.date && !payload.end?.dateTime) throw new Error('予定の終了日時を確認してください。')

  const encodedCalendarId = encodeURIComponent(calendarId)
  const googleEventId = text(cleanEvent.googleEventId)
  const item = googleEventId
    ? await calendarFetch(accessToken, `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events/${encodeURIComponent(googleEventId)}`, { method: 'PATCH', body: payload })
    : await calendarFetch(accessToken, `https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events`, { method: 'POST', body: payload })
  const syncedAt = now.toISOString()
  return {
    ...cleanEvent,
    googleEventId: text(item.id || googleEventId),
    googleCalendarId: calendarId,
    googleSyncedAt: syncedAt,
    updatedAt: cleanEvent.updatedAt || syncedAt,
  }
}

export async function listCalendarEvents(accessToken, { timeMin, timeMax, maxResults = 50 } = {}) {
  const calendar = await getPrimaryCalendar(accessToken)
  if (!calendar?.id) return { calendar: null, items: [] }
  const params = new URLSearchParams({
    timeMin: timeMin || new Date().toISOString(),
    timeMax: timeMax || new Date(Date.now() + 90 * 86400000).toISOString(),
    maxResults: String(Math.min(100, Math.max(1, Number(maxResults) || 50))),
    singleEvents: 'true',
    orderBy: 'startTime',
    showDeleted: 'false',
  })
  const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar.id)}/events?${params}`
  const payload = await calendarFetch(accessToken, url)
  const items = Array.isArray(payload.items)
    ? payload.items.map(item => normalizeGoogleCalendarEvent(item, calendar)).filter(Boolean)
    : []
  return { calendar, items }
}
