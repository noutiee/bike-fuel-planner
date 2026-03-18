
// sw.js
const CACHE = 'fuel-planner-v3';
const ASSETS = [
  './',                 // resolves to the project folder on GitHub Pages
  './index.html',
  './manifest.json',
  './inventory.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: pre-cache core assets
self.addEventListener('install', (e) => {
  self.skipWaiting(); // activate the new SW sooner
  e.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll(ASSETS);
      } catch (err) {
        // If a single asset 404s (e.g., icon missing), don't fail install entirely.
        console.warn('[SW] Precache failed:', err);
      }
    })()
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
      // Take control of open clients right away
      await self.clients.claim();
    })()
  );
});

// Network: cache-first for precached; network fallback otherwise
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
