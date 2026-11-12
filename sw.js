// Service worker: оболонка — cache-first, графіки — network-first з резервом у кеші.
const VERSION = 'v0.12.2';
const SHELL = `shell-${VERSION}`;
const DATA = 'data-v1';
const FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css', 'js/app.js', 'js/data.js', 'js/icons.js', 'js/address.js', 'js/config.js', 'js/i18n.js',
  'assets/lamp-on.webp', 'assets/lamp-off.webp', 'icons/icon-192.png', 'icons/icon-180.png', 'icons/favicon.svg',
  'fonts/onest-cyrillic-400-normal.woff2', 'fonts/onest-cyrillic-500-normal.woff2', 'fonts/onest-cyrillic-600-normal.woff2', 'fonts/onest-cyrillic-700-normal.woff2',
  'fonts/onest-latin-400-normal.woff2', 'fonts/onest-latin-500-normal.woff2', 'fonts/onest-latin-600-normal.woff2', 'fonts/onest-latin-700-normal.woff2',
  'fonts/geist-mono-latin-500-normal.woff2', 'fonts/geist-mono-latin-600-normal.woff2',
];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin !== location.origin && !url.pathname.startsWith('/api/schedules/')) return;
  if (url.pathname.includes('/data/') || url.pathname.includes('/api/')) {
    const key = url.origin + url.pathname; // без ?m=… — одна копія на файл
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(DATA).then(x => x.put(key, c)); } return r; })
      .catch(() => caches.match(key).then(r => r || new Response('', { status: 404 }))));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
// Web Push (сервер підключимо пізніше)
self.addEventListener('push', e => {
  const d = e.data ? e.data.json() : { title: 'Electrocity', body: 'Оновлення графіка' };
  e.waitUntil(self.registration.showNotification(d.title, { body: d.body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: d.tag, renotify: !!d.tag, data: d.url || './' }));
});
self.addEventListener('notificationclick', e => { e.notification.close(); e.waitUntil(clients.openWindow(e.notification.data || './')); });
