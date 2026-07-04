const CACHE = 'ladys-butler-v3'
const ROOT = new URL('./', self.registration.scope).href
const APP_SHELL = [
  ROOT,
  new URL('manifest.webmanifest', ROOT).href,
  new URL('app-icon.svg', ROOT).href,
]

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))))
  self.clients.claim()
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const isPrivate = url.origin !== self.location.origin || url.pathname.startsWith('/api/') || event.request.headers.has('authorization')
  if (isPrivate) {
    event.respondWith(fetch(event.request))
    return
  }
  event.respondWith(fetch(event.request).then(response => {
    const cacheControl = response.headers.get('cache-control') || ''
    if (response.ok && !/no-store|private/i.test(cacheControl)) {
      const copy = response.clone()
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)))
    }
    return response
  }).catch(() => caches.match(event.request).then(cached => cached || (event.request.mode === 'navigate' ? caches.match(ROOT) : Response.error()))))
})

self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = { body: event.data?.text() || '' } }
  event.waitUntil(self.registration.showNotification(data.title || "Lady's Butler", {
    body: data.body || '本日の予定を一緒に整えましょう。',
    icon: data.icon || 'app-icon.svg',
    badge: data.badge || 'app-icon.svg',
    tag: data.tag || 'lady-daily-reminder',
    renotify: false,
    data: { url: data.url || ROOT },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || ROOT, ROOT).href
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(openClients => {
    const existing = openClients.find(client => client.url.startsWith(ROOT))
    if (existing) return existing.focus().then(() => existing.navigate(target))
    return clients.openWindow(target)
  }))
})
