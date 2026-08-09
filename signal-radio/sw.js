/* ---------------------------------------------------------------------------
 * Signal — service worker
 *
 * Two rules, nothing more:
 *   1. App shell (HTML/CSS/JS/icons/manifest): cache-first, precached on
 *      install, so the app opens instantly and works offline.
 *   2. Audio streams: network-only, never cached, never even looked up in the
 *      cache. Live radio is an endless response — caching it would balloon
 *      storage and could serve stale audio.
 *
 * Bump CACHE when shell files change, so the old cache is dropped on activate.
 * ------------------------------------------------------------------------- */

const CACHE = 'signal-shell-v2';

// Relative to the worker's own location, so this survives being served from a
// GitHub Pages subpath (username.github.io/<repo>/signal-radio/).
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/adapters.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Anything that smells like live audio: by request destination, by file
// extension, or simply by being cross-origin (every stream we play is).
function isStream(request) {
  if (request.destination === 'audio') return true;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return true;

  return /\.(mp3|aac|m4a|wav|ogg|opus|flac|m3u8|ts|pls|asx)(\?|$)/i.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;      // let it go straight to the network
  if (isStream(request)) return;             // never cached, never intercepted

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          // Cache same-origin successes so new shell files picked up at
          // runtime are available offline too.
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => {
          // Offline: a navigation still gets the app shell.
          if (request.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
