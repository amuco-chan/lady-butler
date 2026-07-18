import { authorizeSyncRequest, readStoredSyncTokenHash, redisConfig, storeSyncToken, syncAuthAvailable, text, validSyncToken } from '../server/sync-auth.js'

const maxBodyBytes = 16 * 1024

function send(res, status, data) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store, private')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  if (req.body) return typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks.map(chunk => Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))))
  if (body.length > maxBodyBytes) throw new Error('payload too large')
  return body.length ? JSON.parse(body.toString('utf8')) : {}
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 200, { ok: true })
  const storageConfigured = !!redisConfig()

  try {
    const configured = storageConfigured && await syncAuthAvailable()
    const cloudTokenConfigured = storageConfigured && !!(await readStoredSyncTokenHash())
    const envTokenConfigured = !!text(process.env.SYNC_ACCESS_TOKEN)
    const mode = envTokenConfigured && cloudTokenConfigured ? 'vercel-env-and-cloud-token'
      : envTokenConfigured ? 'vercel-env'
        : cloudTokenConfigured ? 'cloud-token'
          : 'not-configured'

    if (req.method === 'GET') {
      return send(res, 200, {
        ok: true,
        storageConfigured,
        configured,
        mode,
      })
    }

    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'GET or POST only' })
    if (!storageConfigured) return send(res, 503, { ok: false, error: 'クラウド保存の設定がまだありません。Upstash RedisをVercelに接続してください。' })

    if (cloudTokenConfigured && !(await authorizeSyncRequest(req))) {
      return send(res, 401, { ok: false, error: '既存の同期キーと一致しません。現在使っている同期キーで認証してから更新してください。' })
    }

    const body = await readJson(req)
    const token = text(body.token || body.syncToken || body.sync_token)
    if (!validSyncToken(token)) return send(res, 400, { ok: false, error: '同期キーが短すぎます。アプリの「同期キーを作る」から作成してください。' })

    await storeSyncToken(token)
    return send(res, 200, {
      ok: true,
      configured: true,
      mode: text(process.env.SYNC_ACCESS_TOKEN) ? 'vercel-env-and-cloud-token' : 'cloud-token',
      message: '同期キーをクラウドへ登録しました。',
    })
  } catch (error) {
    return send(res, 400, { ok: false, error: '同期キーを登録できませんでした。', detail: String(error?.message || error) })
  }
}
