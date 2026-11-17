const CACHE_NAME = 'holoo-pwa-shell-v1';
const APP_SHELL = ['./', './index.html', './manifest.json', './icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never intercept or store Supabase, authentication, API, POST, or cross-origin traffic.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (/\/rest\/v1\/|\/auth\/v1\/|\/storage\/v1\//i.test(url.pathname)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
        }
        return response;
      }).catch(async () => {
        return (await caches.match(request)) ||
               (await caches.match('./index.html')) ||
               Response.error();
      })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    }))
  );
});
