const CITYRAIL_SW_VERSION = 'cityrail-sw-20260810-v598-pwa-install';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/download.html',
  '/manifest.webmanifest',
  '/logo.png',
  '/logo.webp',
  '/favicon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CITYRAIL_SW_VERSION)
      .then(cache => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CITYRAIL_SW_VERSION).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/map-tile/')) return;
  const isVersionedAsset = url.searchParams.has('v') && /\.(?:js|css|mjs)$/i.test(url.pathname);
  if (request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(CITYRAIL_SW_VERSION).then(cache => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then(hit => hit || caches.match('/index.html')))
    );
    return;
  }
  if (isVersionedAsset) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CITYRAIL_SW_VERSION).then(cache => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then(hit => hit || fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CITYRAIL_SW_VERSION).then(cache => cache.put(request, copy)).catch(() => {});
      }
      return response;
    }))
  );
});
