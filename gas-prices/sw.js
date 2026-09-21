/* ---------------------------------------------------------------------------
 * Pump — service worker
 *
 * Three rules:
 *   1. App shell (HTML/CSS/JS/manifest): network-FIRST with a short timeout,
 *      falling back to the cache. Cache-first is the usual advice, but it
 *      means an installed copy keeps running whatever code it saw on the day
 *      it was installed — forever, because a home-screen app has no address
 *      bar, no pull-to-refresh, and iOS keeps the page alive for days. The
 *      shell here is a few kilobytes on a CDN; paying for it on launch is
 *      cheaper than shipping a fix nobody receives. The cache is still there,
 *      and the timeout means a dead connection costs a moment, not the app.
 *   2. Icons: cache-first. They never change, and they are the only large
 *      files in the shell.
 *   3. data/prices.json: network-FIRST, falling back to cache. A gas price
 *      app that opens instantly and shows Tuesday's prices is worse than one
 *      that takes a second. The cached copy exists only so the app still says
 *      something — clearly marked stale by the UI — when there is no signal.
 *
 * And an update check, which is what an installed app has instead of pull-to-
 * refresh: the page sends {type:'check-update'} on launch, whenever it comes
 * back to the foreground, and when Refresh is pressed. The worker re-fetches
 * every shell file — unchanged ones answer 304 and cost nothing — and if any
 * of them differs from the cached copy it stores the new one and posts
 * {type:'update-ready'} back, which makes the page reload itself onto the new
 * code. See VERSION_KEY below for why that reload lands where it should.
 *
 * Bump CACHE when the shell layout here changes, so the old cache is dropped
 * on activate. Day-to-day code changes no longer need it — rule 1 covers them.
 * ------------------------------------------------------------------------- */

const CACHE = 'pump-shell-v4';

// Relative to the worker's own location, so this survives being served from a
// GitHub Pages subpath (username.github.io/<repo>/gas-prices/).
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/compare.js',
  './js/history.js',
  './js/stations.js',
  './js/store.js',
  './manifest.json'
];

const ICONS = [
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

// How long a shell request waits for the network before the cached copy is
// served instead. Long enough to win on a normal mobile connection, short
// enough that a captive wifi portal doesn't hold the app hostage.
const SHELL_TIMEOUT_MS = 2500;

/* The page's own stylesheet and scripts are stamped with this token on the
 * way out — ./js/app.js becomes ./js/app.js?v=<token> — and the token changes
 * whenever a shell file does. That stamp is not about HTTP caching, which the
 * revalidation below already handles. It is the only way to get a reload onto
 * new code: a browser keeps parsed subresources in an in-memory cache tied to
 * the tab, and reuses them for any same-URL request without ever asking the
 * service worker. Tested every way of asking for a reload; none of them shake
 * it loose. A URL it has never seen does. */
const VERSION_KEY = './__shell-version';

/* True when a shell request has fallen back to the cache in this worker's
 * lifetime, which means the page may be running code older than what is on
 * the server. The next successful update check treats that as a change. */
let servedStale = false;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.concat(ICONS)))
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

function isPrices(url) {
  return url.pathname.endsWith('/data/prices.json');
}

function isIcon(url) {
  return url.pathname.includes('/icons/');
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isPrices(url)) {
    event.respondWith(pricesFirst(request));
    return;
  }

  if (isIcon(url)) {
    event.respondWith(iconFirst(request));
    return;
  }

  event.respondWith(shellFirst(request));
});

self.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'check-update') return;

  event.waitUntil(
    checkShell().then((changed) => {
      if (changed) broadcast({ type: 'update-ready' });
    })
  );
});

/* -- strategies ------------------------------------------------------------ */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shellFirst(request) {
  const cache = await caches.open(CACHE);

  /* Stamped requests come back in as ./js/app.js?v=1234. The server ignores
   * the query, and the cache should too, so everything is stored and looked up
   * under the bare path. */
  const key = unstamped(request.url);
  const kind = shellKind(request, key);

  /* 'no-cache' rather than 'no-store': the file is always revalidated against
   * the server, so GitHub Pages' ten-minute max-age can never hand back a
   * stale copy, but an unchanged file answers 304 and costs nothing.
   *
   * Kept as one promise rather than awaited twice: on a timeout the page gets
   * the cached copy immediately and this keeps running, so the cache is fresh
   * for the next launch either way. */
  const network = fetch(request, { cache: 'no-cache' })
    .then((response) => {
      if (response && response.ok && response.type === 'basic') {
        cache.put(key, response.clone());
      }
      return response;
    })
    .catch(() => null);

  const quick = await Promise.race([network, sleep(SHELL_TIMEOUT_MS)]);
  if (quick) return stamp(quick, kind, cache);

  const cached = await cache.match(key);
  if (cached) {
    servedStale = true;
    return stamp(cached, kind, cache);
  }

  // Nothing cached, so slow is still better than nothing.
  const slow = await network;
  if (slow) return stamp(slow, kind, cache);

  if (kind === 'document') {
    const shell = await cache.match('./index.html');
    if (shell) {
      servedStale = true;
      return stamp(shell, 'document', cache);
    }
  }
  return Response.error();
}

function unstamped(url) {
  const bare = new URL(url);
  bare.search = '';
  return bare.href;
}

function shellKind(request, key) {
  if (request.mode === 'navigate' || request.destination === 'document') return 'document';
  if (new URL(key).pathname.endsWith('.js')) return 'script';
  return null;
}

/* Rewrite the references that pull in the rest of the app so they carry the
 * current token: the document's own css/ and js/ tags, and — because a module
 * reaches its neighbours on its own, without the document ever naming them —
 * the relative import specifiers inside each script. Anything else is passed
 * through untouched. */
async function stamp(response, kind, cache) {
  if (!kind || !response || !response.ok) return response;

  const token = await readToken(cache);
  const body = await response.text();
  const headers = new Headers(response.headers);
  headers.delete('Content-Length');

  const stamped = kind === 'document'
    ? body.replace(/(\s(?:href|src)="\.\/(?:css|js)\/[^"?]+)"/g, '$1?v=' + token + '"')
    : body.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])(\.\/[^'"?]+\.js)\2/g,
                   '$1$2$3?v=' + token + '$2');

  return new Response(stamped, { status: response.status, statusText: response.statusText, headers });
}

async function readToken(cache) {
  const stored = await cache.match(VERSION_KEY);
  if (stored) return (await stored.text()).trim();

  const token = String(Date.now());
  await cache.put(VERSION_KEY, new Response(token));
  return token;
}

async function iconFirst(request) {
  const cache = await caches.open(CACHE);

  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

/* The app cache-busts prices.json with a `?t=` query, which would otherwise
 * mean every request misses the cache and offline gets nothing. Store it under
 * one stable key and match with ignoreSearch so the fallback actually works. */
async function pricesFirst(request) {
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

/* -- update check ---------------------------------------------------------- */

/* Re-fetch every shell file and compare it, as text, against the cached copy.
 * Comparing bodies rather than a version number means there is no constant to
 * remember to bump: whatever is on the server is the answer. Unchanged files
 * cost a 304 and nothing on the wire, so this is cheap enough to run every
 * time the app is opened. Returns true when something the page is running has
 * changed underneath it. */
async function checkShell() {
  const cache = await caches.open(CACHE);
  let changed = false;
  let reached = false;

  await Promise.all(SHELL.map(async (path) => {
    const url = new URL(path, self.location).href;

    let response;
    try {
      response = await fetch(url, { cache: 'no-cache' });
    } catch (err) {
      return;                       // offline; nothing to compare against
    }
    if (!response.ok) return;
    reached = true;

    const fresh = await response.clone().text();
    const cached = await cache.match(url);
    const previous = cached ? await cached.text() : null;

    if (previous !== null && previous !== fresh) changed = true;
    await cache.put(url, response);
  }));

  // A launch that fell back to the cache may be running old code even though
  // the cache has since caught up, so treat it as a change once we can see
  // the network again.
  if (reached && servedStale) {
    servedStale = false;
    changed = true;
  }

  // New token, so the reload that follows asks for URLs the tab has never
  // seen and cannot answer from memory.
  if (changed) await cache.put(VERSION_KEY, new Response(String(Date.now())));

  return changed;
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}
