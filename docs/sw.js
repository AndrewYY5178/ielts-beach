// sw.js — Service Worker for IELTS Beach
// Cache-first for static assets

const CACHE_NAME = 'ielts-beach-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/favicon.svg',
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
  '/manifest.json',
];

// Install: precache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching v2 assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: cache-first for static, network-first for API
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // API calls: network-first
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Static: cache-first
  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/index.html');
      if (fallback) return fallback;
    }
    return new Response('Offline', { status: 503 });
  }
}

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
    return new Response(JSON.stringify({
      success: false,
      error: { message: 'You are offline' }
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
