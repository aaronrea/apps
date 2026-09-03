/* ---------------------------------------------------------------------------
 * Cone — service worker
 *
 * Two rules, and the second one is the whole reason this file needs care:
 *   1. App shell (HTML/CSS/JS/icons/manifest): cache-first, precached on
 *      install, so the app opens instantly from the home screen.
 *   2. data/*.json: network-FIRST, falling back to cache. A storm tracker
 *      that opens instantly and shows yesterday's position is worse than one
 *      that takes a second. The cached copy exists only so the app still
 *      says something — clearly marked stale by the UI — when there is no
 *      signal.
 *
 * Bump CACHE when shell files change, so the old cache is dropped on activate.
 * ------------------------------------------------------------------------- */

const CACHE = 'cone-shell-v2';

// Relative to the worker's own location, so this survives being served from a
// GitHub Pages subpath (username.github.io/<repo>/hurricane-tracker/).
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/filter.js',
  './js/format.js',
  './js/outlook.js',
  './js/store.js',
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

function isData(url) {
  return url.pathname.endsWith('/data/current-storms.json') || url.pathname.endsWith('/data/outlook-atlantic.json');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isData(url)) {
    event.respondWith(dataFirst(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
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

/* The app cache-busts data/*.json with a `?t=` query, which would otherwise
 * mean every request misses the cache and offline gets nothing. Store it under
 * one stable key and match with ignoreSearch so the fallback actually works. */
async function dataFirst(request) {
  const cache = await caches.open(CACHE);
  const key = new URL(request.url);
  key.search = '';

  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok) cache.put(key.href, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(key.href, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}
