/* ---------------------------------------------------------------------------
 * Slate — service worker
 *
 * Three rules:
 *   1. App shell (HTML/CSS/JS/icons/manifest): cache-first, precached on
 *      install, so the app opens instantly from the home screen.
 *   2. Team logos from ESPN's CDN: cache-first, filled in as they are seen. A
 *      logo never changes and there are only a few dozen of them, so this is
 *      the cheapest possible way to make the offline view look right rather
 *      than like a wall of broken images.
 *   3. The schedule API: never cached here. It is content, not shell, and the
 *      app already keeps the last good result in localStorage where it can be
 *      shown with an honest "updated 9h ago" next to it. Caching it twice
 *      would only create a second, staler source of truth.
 *
 * Bump SHELL_CACHE when shell files change, so the old one is dropped on
 * activate. LOGO_CACHE is deliberately left alone across those bumps — the
 * logos are still good.
 * ------------------------------------------------------------------------- */

const SHELL_CACHE = 'slate-shell-v2';
const LOGO_CACHE = 'slate-logos-v1';
const KEEP = [SHELL_CACHE, LOGO_CACHE];

// Relative to the worker's own location, so this survives being served from a
// GitHub Pages subpath (username.github.io/<repo>/sports-schedule/).
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/espn.js',
  './js/schedule.js',
  './js/store.js',
  './js/teams.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

const LOGO_HOST = 'a.espncdn.com';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => !KEEP.includes(key)).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (url.hostname === LOGO_HOST) {
    event.respondWith(logoFirst(request));
    return;
  }

  /* Anything else off-origin — the schedule API — goes straight to the
   * network, untouched. */
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response && response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
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

/* Logos come back opaque, because an <img> is a no-cors request and the CDN is
 * not asked for CORS headers. An opaque response cannot be inspected — `ok` is
 * always false and `status` is always 0 — so it is stored on the strength of
 * the fetch having resolved at all, and a failed image simply falls through to
 * the abbreviation chip the app draws in its place. */
async function logoFirst(request) {
  const cache = await caches.open(LOGO_CACHE);

  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && (response.ok || response.type === 'opaque')) {
    cache.put(request, response.clone());
  }
  return response;
}
