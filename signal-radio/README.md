# Signal

A personal internet radio PWA. Single user, no auth, no backend, no database —
just static files.

Stations:

| Station | Where | Host | Stream | Wired? |
| --- | --- | --- | --- | --- |
| 101X | KROX-FM 101.5, Austin TX | StreamGuys (Waterloo Media) | **HLS** `.m3u8` | yes |
| The Bone | WHPT 102.5, Tampa FL | StreamGuys (Cox Media Group) | MP3 128k | yes |
| The Zone | KZNE 1150 / K229DK 93.7, College Station TX — Texas A&M football | SecureNet Systems (SoCast site) | HE-AAC 32k | yes |
| DEF CON | SomaFM | SomaFM | MP3 128k | yes |

All four are static, tokenless URLs — no session endpoint, no CORS problem,
nothing to refresh. They live in `STREAM_URLS` at the top of `js/adapters.js`.

⚠️ **101X is HLS-only.** iOS Safari plays `.m3u8` natively in `<audio>`, so the
iPhone is fine, but **desktop Chrome will not play 101X** without hls.js. That
isn't a broken stream — check it on the phone before chasing it. The other
three are plain progressive streams and play anywhere.

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

## Where the stream URLs came from

All stream URLs live in one `STREAM_URLS` map at the top of `js/adapters.js`.
Wiring a station is a one-line edit. An empty entry isn't silent — selecting
that station logs `no stream URL for "<id>" yet` and goes to `error`.

Two of the three guesses in the original notes were wrong, so here's what's
actually true, for whoever has to re-sniff these when one breaks:

- **101X — not iHeart.** No `ihrhls` or `revma` anywhere on the site. KROX is
  Waterloo Media, and `/listen-live/` injects a StreamGuys player:
  `//player.streamguys.com/waterloo/kroxfm/sgplayer/embed.min.js`. That script
  XHRs `config.json` sitting next to it, and its one and only source is
  `https://waterloo.streamguys1.com/krox-fm/playlist.m3u8`.
  There *is* a stale `KROXFMAAC.aac` StreamTheWorld URL still in the page
  markup — it 404s on every mount variant. Ignore it.
- **The Bone — Cox was right, Audacy was wrong.** Again StreamGuys, no
  StreamTheWorld. The page sets `window.sgStationId = "tam1025"`, and
  `player.streamguys.com/cmg/tam1025/sgplayer/config.json` lists the mounts:
  `…/tam1025-sgplayer-mp3` (128k) and `…-sgplayer-aac` (49k). We use the MP3.
- **The Zone — the easy case, as predicted.** The site is SoCast, but its play
  button opens a SecureNet Systems "Cirrus" popup at
  `radio.securenetsystems.net/cirruscontent/ZONE1150`, whose page carries
  `streamSrcDB = 'https://ice42.securenetsystems.net/ZONE1150'`. The player
  appends `?playSessionID=…` for analytics; the bare URL works without it.

The general lesson: **look for the player vendor, not the station's owner.**
Owner tells you nothing about who serves the audio. Grep a station page for
`streamguys`, `streamtheworld`, `securenetsystems`, `ihrhls`, or `socast`,
find the vendor's config JSON, and the mounts are listed in the clear.

If a station later starts handing back a **short-lived tokenised** URL,
replace that adapter's `resolveStream(this.id)` line with the fetch that
resolves it. `getStreamUrl()` is already async and re-called on every play and
every retry, so nothing else has to change. Don't cache the result — and check
the token endpoint sends `Access-Control-Allow-Origin`, because without it a
`fetch()` from the Pages origin can't call it at all and the backend-free
design stops working.

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
