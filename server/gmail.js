import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { bearerToken, redisPipeline, syncTokenHash, text } from './sync-auth.js'

const tokenKey = 'lady-butler:gmail-token:v1'
const statePrefix = 'lady-butler:gmail-oauth-state:v1:'
const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly'

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

export function gmailConfig(req) {
  const clientId = text(process.env.GMAIL_CLIENT_ID)
  const clientSecret = text(process.env.GMAIL_CLIENT_SECRET)
  const redirectUri = text(process.env.GMAIL_REDIRECT_URI) || `${requestOrigin(req)}/api/gmail-callback`
  const secret = text(process.env.GMAIL_TOKEN_SECRET || process.env.GPT_ACTION_TOKEN || process.env.SYNC_ACCESS_TOKEN)
  return clientId && clientSecret && secret ? { clientId, clientSecret, redirectUri, secret } : null
}

export function gmailSetupState(req) {
  return {
    configured: !!gmailConfig(req),
    needs: [
      !text(process.env.GMAIL_CLIENT_ID) ? 'GMAIL_CLIENT_ID' : '',
      !text(process.env.GMAIL_CLIENT_SECRET) ? 'GMAIL_CLIENT_SECRET' : '',
      !text(process.env.GMAIL_TOKEN_SECRET || process.env.GPT_ACTION_TOKEN || process.env.SYNC_ACCESS_TOKEN) ? 'GMAIL_TOKEN_SECRET' : '',
    ].filter(Boolean),
    redirectUri: text(process.env.GMAIL_REDIRECT_URI) || `${requestOrigin(req)}/api/gmail-callback`,
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

export async function createGmailAuthUrl(req) {
  const config = gmailConfig(req)
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
    scope: gmailScope,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
}

export async function verifyGmailState(state) {
  const key = `${statePrefix}${text(state)}`
  const [raw] = await redisPipeline([['GET', key], ['DEL', key]])
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

export async function exchangeCodeForTokens(req, code) {
  const config = gmailConfig(req)
  if (!config) throw new Error('gmail config missing')
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
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'token exchange failed')
  return payload
}

export async function refreshGmailAccessToken(req, refreshToken) {
  const config = gmailConfig(req)
  if (!config) throw new Error('gmail config missing')
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
  if (!response.ok) throw new Error(payload.error_description || payload.error || 'token refresh failed')
  return payload.access_token
}

export async function readGmailConnection(req) {
  const config = gmailConfig(req)
  if (!config) return null
  const [raw] = await redisPipeline([['GET', tokenKey]])
  if (!raw) return null
  return decryptJson(raw, config.secret)
}

export async function saveGmailConnection(req, connection) {
  const config = gmailConfig(req)
  if (!config) throw new Error('gmail config missing')
  await redisPipeline([['SET', tokenKey, encryptJson(connection, config.secret)]])
}

export async function removeGmailConnection() {
  const [removed = 0] = await redisPipeline([['DEL', tokenKey]])
  return Number(removed) || 0
}

export async function gmailFetch(accessToken, url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error?.message || payload.error || `gmail request failed: ${response.status}`)
  return payload
}

export async function getGmailProfile(accessToken) {
  return gmailFetch(accessToken, 'https://gmail.googleapis.com/gmail/v1/users/me/profile')
}

export async function getFreshGmailAccessToken(req) {
  const connection = await readGmailConnection(req)
  if (!connection?.refreshToken) return null
  return refreshGmailAccessToken(req, connection.refreshToken)
}

export function gmailMessageSearchUrl({ query, maxResults = 20 }) {
  const params = new URLSearchParams({
    q: query,
    maxResults: String(Math.min(40, Math.max(1, Number(maxResults) || 20))),
    includeSpamTrash: 'false',
  })
  return `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`
}

function decodeBase64Url(value) {
  const raw = text(value)
  if (!raw) return ''
  return Buffer.from(raw.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8')
}

function stripHtml(value) {
  return text(value)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function bodyTextFromPayload(payload, preferred = []) {
  if (!payload || typeof payload !== 'object') return preferred
  if (payload.body?.data && /^text\/plain/i.test(text(payload.mimeType))) preferred.push(decodeBase64Url(payload.body.data))
  if (payload.body?.data && /^text\/html/i.test(text(payload.mimeType))) preferred.push(stripHtml(decodeBase64Url(payload.body.data)))
  for (const part of Array.isArray(payload.parts) ? payload.parts : []) bodyTextFromPayload(part, preferred)
  return preferred
}

export function normalizeGmailMessage(message) {
  const headers = Object.fromEntries((message.payload?.headers || []).map(header => [text(header.name).toLowerCase(), text(header.value)]))
  const body = bodyTextFromPayload(message.payload).join('\n').replace(/\s+\n/g, '\n').trim()
  return {
    id: text(message.id),
    threadId: text(message.threadId),
    subject: headers.subject || '(件名なし)',
    from: headers.from || '',
    date: headers.date || '',
    snippet: text(message.snippet),
    body: body.slice(0, 6000),
  }
}
