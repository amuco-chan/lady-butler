import assert from 'node:assert/strict'
import { createDecipheriv, createECDH, createHmac, generateKeyPairSync, randomBytes } from 'node:crypto'
import { base64UrlDecode, base64UrlEncode, encryptWebPush, subscriptionId, vapidAuthorization } from '../server/web-push.js'

const hkdfExtract = (salt, input) => createHmac('sha256', salt).update(input).digest()
const hkdfExpand = (key, info, length) => {
  const blocks = []
  let previous = Buffer.alloc(0)
  for (let counter = 1; Buffer.concat(blocks).length < length; counter += 1) {
    previous = createHmac('sha256', key).update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter])])).digest()
    blocks.push(previous)
  }
  return Buffer.concat(blocks).subarray(0, length)
}

const client = createECDH('prime256v1')
client.generateKeys()
const auth = randomBytes(16)
const subscription = {
  endpoint: 'https://push.example.test/message/123',
  keys: { p256dh: base64UrlEncode(client.getPublicKey()), auth: base64UrlEncode(auth) },
}
const payload = { title: "Lady's Butler", body: 'おはようございます、レディ。' }
const encrypted = encryptWebPush(subscription, payload)
const salt = encrypted.subarray(0, 16)
assert.equal(encrypted.readUInt32BE(16), 4096)
const keyLength = encrypted.readUInt8(20)
assert.equal(keyLength, 65)
const serverPublicKey = encrypted.subarray(21, 21 + keyLength)
const ciphertext = encrypted.subarray(21 + keyLength)
const sharedSecret = client.computeSecret(serverPublicKey)
const info = Buffer.concat([Buffer.from('WebPush: info\0'), client.getPublicKey(), serverPublicKey])
const ikm = hkdfExpand(hkdfExtract(auth, sharedSecret), info, 32)
const prk = hkdfExtract(salt, ikm)
const key = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0'), 12)
const decipher = createDecipheriv('aes-128-gcm', key, nonce)
decipher.setAuthTag(ciphertext.subarray(-16))
const plaintext = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()])
assert.equal(plaintext.at(-1), 2)
assert.deepEqual(JSON.parse(plaintext.subarray(0, -1).toString()), payload)
assert.equal(subscriptionId(subscription).length, 32)

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const jwk = privateKey.export({ format: 'jwk' })
const publicKey = base64UrlEncode(Buffer.concat([Buffer.from([4]), base64UrlDecode(jwk.x), base64UrlDecode(jwk.y)]))
const authorization = vapidAuthorization(subscription.endpoint, publicKey, jwk.d)
assert.match(authorization, /^vapid t=[^.]+\.[^.]+\.[^,]+, k=/)

console.log('Web Pushテスト: OK')
