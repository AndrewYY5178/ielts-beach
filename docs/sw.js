// sw.js — Service Worker for IELTS Beach
// Network-first: always serve latest, cache for offline fallback

const CACHE_NAME = 'ielts-beach-v3';

// Precache key assets on install
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/index.html',
        '/favicon.svg',
        '/manifest.json',
        '/css/reset.css',
        '/css/variables.css',
        '/css/layout.css',
        '/css/game.css',
        '/css/review.css',
        '/css/favorites.css',
        '/css/auth.css',
        '/css/menu.css',
        '/css/wordbank.css',
        '/css/settings.css',
        '/css/toasts.css',
        '/css/animations.css',
        '/js/app.js',
        '/js/state.js',
        '/js/utils.js',
        '/js/config.js',
        '/js/swipe.js',
        '/js/words.js',
        '/js/word-source.js',
        '/js/game.js',
        '/js/review.js',
        '/js/favorites.js',
        '/js/storage.js',
        '/js/screens.js',
        '/js/sync.js',
        '/js/auth.js',
        '/js/jspdf.umd.min.js',
        '/assets/words/manifest.json',
        '/assets/words/ielts-core.json',
      ]).catch(() => {});
    }).then(() => self.skipWaiting())
  );
});

// Clear old caches immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Network-first: always try network, fall back to cache
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first as before
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Everything else: network-first (get latest), cache for offline
  event.respondWith(networkFirst(event.request));
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    const cached = await caches.match(request);
    if (cached) return cached;

    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503 });
  }
}
