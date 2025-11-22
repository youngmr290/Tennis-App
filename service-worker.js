// service-worker.js
const CACHE_NAME = 'tennis-rotation-v1';

// List of files to cache for offline use.
// Use relative paths so this works on GitHub Pages project URLs.
const ASSETS_TO_CACHE = [
  '/Tennis-App/',
  '/Tennis-App/index.html',
  '/Tennis-App/app.js',
  '/Tennis-App/style.css',
  '/Tennis-App/manifest.json',
  '/Tennis-App/icons/logo-original-500.png'
];

// Install: cache app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(
        ASSETS_TO_CACHE.filter(Boolean) // ignore missing icons if you removed them
      );
    })
  );
});

// Activate: clean up old caches if you bump CACHE_NAME later
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
});

// Fetch: cache-first strategy for all requests
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        return cached;
      }
      // Not in cache – fetch from network and cache a copy
      return fetch(req).then((response) => {
        const respClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(req, respClone);
        });
        return response;
      }).catch(() => {
        // Optional: return a fallback page or nothing on total offline miss
        return caches.match('./index.html');
      });
    })
  );
});
