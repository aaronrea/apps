# Signal

A personal internet radio PWA. Single user, no auth, no backend, no database —
just static files.

Stations:

| Station | Where | Host |
| --- | --- | --- |
| 101X | Austin, TX · Alternative | iHeart |
| The Bone | Tampa, FL · WHPT 102.5 | Audacy |
| Westwood One | NFL & Texas A&M football | Westwood One affiliate |

## Files

```
index.html        markup + the single <audio> element
css/style.css     dark theme
js/adapters.js    the three station adapters (getStreamUrl TODOs live here)
js/app.js         everything else, readable top to bottom
manifest.json     PWA manifest (start_url "." / scope "." — subpath-safe)
sw.js             service worker: cache-first shell, network-only audio
icons/            placeholder icons (180 / 192 / 512)
```

## How playback works

There is exactly **one** `<audio>` element for the whole app; switching
stations swaps its `.src`. New elements are never created — iOS keeps the
background/lock-screen audio session tied to the element the user originally
started, so reusing it is what keeps lock-screen playback alive.

A station is a plain object:

```js
{ id, name, sub, badge, getStreamUrl: async () => "https://..." }
```

`getStreamUrl()` is async and safe to call repeatedly. It's called on every
play and again on every retry.

**Retry:** on the `<audio>` `error` event the app logs it, calls
`getStreamUrl()` once more for a fresh URL, and retries. If that also fails it
shows `error` and stops — one retry, never a loop.

**Status:** `idle → loading → live → paused`, or `error`. Every transition is
timestamped into the on-screen event log at the bottom of the page, which is
the thing to read when a stream misbehaves on the phone (where there's no
console).

## Wiring up the real streams

`js/adapters.js` currently returns public SomaFM test streams from a
`placeholderStream()` helper so the app is fully playable as built. Each
adapter's `getStreamUrl()` body is a marked `TODO` describing what it needs to
do instead.

Real commercial stations don't expose a static URL — the player asks a token /
session endpoint for a session-scoped, expiring stream URL. So for each
station: sniff the network requests its official web player makes, find the
call that hands back the playback URL, and replace the placeholder call with
that fetch. Return the resolved URL. Don't cache it — that's why the function
is re-called on every play and every retry.

When all three are real, delete the `PLACEHOLDER_STREAMS` /
`placeholderStream()` block at the top of the file.

## Service worker

- **App shell** (HTML/CSS/JS/icons/manifest): precached on install,
  cache-first afterwards.
- **Audio**: network-only. Anything with an `audio` request destination, an
  audio/playlist file extension, or a cross-origin URL is passed straight
  through and never cached — live radio must never come from cache.

Bump `CACHE` in `sw.js` after changing shell files so the old cache is dropped
on activate.

## Local check

```bash
cd ..                       # repo root
python3 -m http.server 8000
open http://localhost:8000/signal-radio/
```

`localhost` is a secure context, so the service worker registers. Confirm in
DevTools → Application → Service Workers / Manifest, or just watch the event
log — it prints `service worker registered (scope …)`.

See the repo root [`README.md`](../README.md) for pushing and enabling GitHub
Pages.
