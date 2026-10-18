const CACHE_NAME = 'casa-em-dia-v3';
const APP_SHELL = [
  './',
  './index.html',
  './casa-em-dia-prototype.html',
  './app.js',
  './supabase-config.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key.startsWith('casa-em-dia-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(event.request)) ||
          caches.match('./casa-em-dia-prototype.html')
        )
    );
    return;
  }

  if (event.request.destination === 'script') {
    event.respondWith(
      fetch(event.request)
        .then(async response => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, response.clone());
          }
          return response;
        })
        .catch(async error => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          throw error;
        })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
