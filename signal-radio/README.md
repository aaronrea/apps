# Signal

A personal internet radio PWA. Single user, no auth, no backend, no database —
just static files.

Stations:

| Station | Where | Host | Wired? |
| --- | --- | --- | --- |
| 101X | KROX-FM 101.5, Austin TX | iHeart | no — needs a URL |
| The Bone | WHPT 102.5, Tampa FL | Audacy (verify — see below) | no — needs a URL |
| The Zone | KZNE 1150 / K229DK 93.7, College Station TX — Texas A&M football | KZNE | no — needs a URL |
| DEF CON | SomaFM | SomaFM | yes |

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

All stream URLs live in one `STREAM_URLS` map at the top of `js/adapters.js`.
Wiring a station is a one-line edit: paste its URL into that map. Only DEF CON
is filled in; the other three are empty strings, and selecting one logs
`no stream URL for "<id>" yet` and goes to `error` rather than failing
silently.

Where to find each URL:

- **101X** — iHeart streams look like `https://stream.revma.ihrhls.com/zcNNNN`.
  The `NNNN` is opaque and per-station. Open <https://www.101x.com/listen-live/>,
  View Source, search the page for `ihrhls`.
- **The Bone** — DevTools → Network on <https://www.theboneonline.com/>, hit
  play. Wikipedia lists WHPT's owner as **Cox Media Group**, not Audacy, so
  confirm which player you're sniffing. StreamTheWorld URLs (used by Audacy
  and many Cox stations) look like
  `https://playerservices.streamtheworld.com/api/livestream-redirect/<MOUNT>.aac`,
  where `<MOUNT>` is usually the call sign + `FMAAC`.
- **The Zone** — DevTools → Network on <https://www.zone1150.com/>, hit play.
  Small-market stations often have a plain static Shoutcast/Icecast URL with
  no token at all.

If a station turns out to hand back a **short-lived tokenised** URL rather
than a stable one, replace that adapter's `resolveStream(this.id)` line with
the fetch that resolves it. `getStreamUrl()` is already async and is re-called
on every play and every retry, so nothing else has to change. Don't cache the
result.

Two things to check while sniffing, because they can change the design:

- **CORS** on the token endpoint — no `Access-Control-Allow-Origin` means
  `fetch()` from the Pages origin fails regardless of a correct URL.
- **HLS vs. direct** — iOS Safari plays `.m3u8` natively in `<audio>`; desktop
  Chrome does not, so an HLS station will need hls.js for desktop testing.

Use the **Test a stream URL** field at the bottom of the app to try a
candidate URL before committing it.

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
