import { createCipheriv, createECDH, createHmac, createPrivateKey, createHash, randomBytes, sign } from 'node:crypto'

const encoder = new TextEncoder()

export function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url')
}

export function base64UrlDecode(value) {
  return Buffer.from(String(value || ''), 'base64url')
}

function hkdfExtract(salt, inputKeyMaterial) {
  return createHmac('sha256', salt).update(inputKeyMaterial).digest()
}

function hkdfExpand(pseudoRandomKey, info, length) {
  const blocks = []
  let previous = Buffer.alloc(0)
  for (let counter = 1; Buffer.concat(blocks).length < length; counter += 1) {
    previous = createHmac('sha256', pseudoRandomKey)
      .update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter])]))
      .digest()
    blocks.push(previous)
  }
  return Buffer.concat(blocks).subarray(0, length)
}

function vapidPrivateKey(publicKey, privateKey) {
  const publicBytes = base64UrlDecode(publicKey)
  const privateBytes = base64UrlDecode(privateKey)
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) throw new Error('invalid VAPID keys')
  return createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: base64UrlEncode(publicBytes.subarray(1, 33)),
      y: base64UrlEncode(publicBytes.subarray(33, 65)),
      d: base64UrlEncode(privateBytes),
    },
    format: 'jwk',
  })
}

export function vapidAuthorization(endpoint, publicKey, privateKey, subject = 'mailto:lady-butler@example.com', now = Date.now()) {
  const header = base64UrlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = base64UrlEncode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: subject,
  }))
  const unsigned = `${header}.${payload}`
  const signature = sign('sha256', Buffer.from(unsigned), { key: vapidPrivateKey(publicKey, privateKey), dsaEncoding: 'ieee-p1363' })
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${publicKey}`
}

export function encryptWebPush(subscription, payload, options = {}) {
  const clientPublicKey = base64UrlDecode(subscription?.keys?.p256dh)
  const authSecret = base64UrlDecode(subscription?.keys?.auth)
  if (clientPublicKey.length !== 65 || clientPublicKey[0] !== 4 || authSecret.length !== 16) throw new Error('invalid push subscription')

  const makeECDH = options.crypto?.createECDH || createECDH
  const server = makeECDH('prime256v1')
  server.generateKeys()
  const serverPublicKey = server.getPublicKey()
  const sharedSecret = server.computeSecret(clientPublicKey)
  const salt = options.salt ? Buffer.from(options.salt) : randomBytes(16)
  const keyInfo = Buffer.concat([encoder.encode('WebPush: info\0'), clientPublicKey, serverPublicKey])
  const inputKeyMaterial = hkdfExpand(hkdfExtract(authSecret, sharedSecret), keyInfo, 32)
  const pseudoRandomKey = hkdfExtract(salt, inputKeyMaterial)
  const contentEncryptionKey = hkdfExpand(pseudoRandomKey, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = hkdfExpand(pseudoRandomKey, encoder.encode('Content-Encoding: nonce\0'), 12)
  const plaintext = Buffer.concat([Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)), Buffer.from([2])])
  const cipher = createCipheriv('aes-128-gcm', contentEncryptionKey, nonce)
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()])
  const recordSize = Math.max(4096, encrypted.length)
  const header = Buffer.alloc(21)
  salt.copy(header, 0)
  header.writeUInt32BE(recordSize, 16)
  header.writeUInt8(serverPublicKey.length, 20)
  return Buffer.concat([header, serverPublicKey, encrypted])
}

export function subscriptionId(subscription) {
  return createHash('sha256').update(String(subscription?.endpoint || '')).digest('hex').slice(0, 32)
}

export async function sendWebPush(subscription, payload, config) {
  const body = encryptWebPush(subscription, payload, { crypto: await import('node:crypto') })
  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthorization(subscription.endpoint, config.publicKey, config.privateKey, config.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(config.ttl ?? 12 * 60 * 60),
      Urgency: config.urgency || 'normal',
    },
    body,
  })
  return response
}
