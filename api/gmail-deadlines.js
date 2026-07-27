import { authorizeSyncRequest, redisConfig, syncAuthAvailable, text } from '../server/sync-auth.js'
import { getFreshGmailAccessToken, gmailFetch, gmailMessageSearchUrl, normalizeGmailMessage, readGmailConnection, sendJson } from '../server/gmail.js'
import { parseDeadlineCandidatesFromEmails } from '../server/email-deadline-parser.js'

const maxBodyBytes = 8 * 1024
const deadlineQueryTerms = [
  '締切', '〆切', '提出期限', '回答期限', '返信期限', '支払期限', '支払い期限', '申込期限', '登録期限', '必着',
  '提出', '回答', '返信', '支払い', '支払', '入金', '申込', '申し込み', '手続き', '書類', '課題', 'レポート', 'due', 'deadline',
]

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

function searchQuery(days) {
  const safeDays = Math.min(90, Math.max(1, Number(days) || 30))
  return `newer_than:${safeDays}d in:inbox -category:promotions -category:social -category:forums (${deadlineQueryTerms.join(' OR ')})`
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true })
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'POST only' })
  if (!(await requireSync(req, res))) return

  try {
    const connection = await readGmailConnection(req)
    if (!connection?.refreshToken) return sendJson(res, 409, { ok: false, error: 'Gmailがまだ接続されていません。' })

    const body = await readJson(req)
    const maxResults = Math.min(30, Math.max(5, Number(body.maxResults) || 20))
    const days = Math.min(90, Math.max(1, Number(body.days) || 30))
    const accessToken = await getFreshGmailAccessToken(req)
    if (!accessToken) return sendJson(res, 409, { ok: false, error: 'Gmailの接続を確認できませんでした。もう一度接続してください。' })

    const list = await gmailFetch(accessToken, gmailMessageSearchUrl({ query: searchQuery(days), maxResults }))
    const messageRefs = Array.isArray(list.messages) ? list.messages.slice(0, maxResults) : []
    const messages = []
    for (const item of messageRefs) {
      const id = text(item.id)
      if (!id) continue
      const detail = await gmailFetch(accessToken, `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`)
      messages.push(normalizeGmailMessage(detail))
    }

    const items = parseDeadlineCandidatesFromEmails(messages, new Date())
    return sendJson(res, 200, {
      ok: true,
      connectedAs: connection.emailAddress || '',
      scanned: messages.length,
      resultSizeEstimate: Number(list.resultSizeEstimate) || 0,
      days,
      items,
      message: items.length ? `${items.length}件の締切候補を見つけました。` : '締切候補は見つかりませんでした。',
    })
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: 'Gmailの締切候補を確認できませんでした。', detail: String(error?.message || error) })
  }
}
