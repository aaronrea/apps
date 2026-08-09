/* ---------------------------------------------------------------------------
 * Signal — station adapters
 *
 * A station is just a plain object:
 *
 *   { id, name, sub, badge, getStreamUrl: async () => "https://..." }
 *
 * getStreamUrl() is async and MUST be safe to call again at any time. It's
 * called on every play and again on every retry.
 *
 * All four stations turned out to have a static, tokenless URL, so every
 * adapter is just a lookup in STREAM_URLS below. That's not guaranteed to
 * stay true: if one starts handing back a short-lived tokenised URL, replace
 * that station's resolveStream() call with the fetch that resolves it and
 * don't cache the result — the async signature is already there for it.
 * ------------------------------------------------------------------------- */

const STREAM_URLS = {

  // 101X — KROX-FM 101.5, Austin TX. Not iHeart: the station is Waterloo
  // Media and the player is StreamGuys. /listen-live/ injects
  // //player.streamguys.com/waterloo/kroxfm/sgplayer/embed.min.js, which
  // XHRs config.json next to it; that file's only source is this playlist.
  //
  // HLS, and HLS only — there is no direct AAC/MP3 mount on this host. iOS
  // Safari plays .m3u8 natively in <audio>, so the iPhone is fine; desktop
  // Chrome will NOT play this without hls.js. Test it on the phone.
  //
  // The URL is static. Each GET mints a fresh listeningSessionID server-side
  // and returns a master playlist pointing at it, so re-requesting on retry
  // is exactly the right thing — nothing to cache, nothing to expire.
  '101x': 'https://waterloo.streamguys1.com/krox-fm/playlist.m3u8',

  // The Bone — WHPT 102.5, Tampa FL. Cox Media Group was right and Audacy
  // was wrong: no StreamTheWorld anywhere, it's StreamGuys like 101X. The
  // page sets window.sgStationId = "tam1025", and
  // player.streamguys.com/cmg/tam1025/sgplayer/config.json lists the mounts.
  //
  // Two live mounts: -mp3 at 128k and -aac at 49k. Taking the MP3 — it's the
  // better-sounding of the two and plays everywhere, not just on iOS. Swap
  // the suffix to -aac if the bitrate ever matters more than the compatibility.
  'the-bone': 'https://cmg.streamguys1.com/tam1025/tam1025-sgplayer-mp3',

  // The Zone — KZNE 1150 AM / K229DK 93.7 FM, College Station TX.
  // Carries Texas A&M football; also a Westwood One affiliate for NFL.
  // The easy case, as expected. The site is SoCast and hands its play button
  // to a SecureNet Systems "Cirrus" popup, whose page carries
  //   streamSrcDB = 'https://ice42.securenetsystems.net/ZONE1150'
  // The player appends a ?playSessionID=... for its own analytics; the bare
  // URL serves fine without it, so there's no token to fetch.
  //
  // 32k HE-AAC (audio/aacp) — thin, but it's an AM sports-talk signal.
  'the-zone': 'https://ice42.securenetsystems.net/ZONE1150',

  // SomaFM DEF CON — public, static, no token. 128k MP3, still healthy.
  'defcon': 'https://ice5.somafm.com/defcon-128-mp3'
};

// Returns the URL for a station, or throws a message that shows up in the
// on-screen event log — better than a silent failure on the phone.
async function resolveStream(id) {
  const url = STREAM_URLS[id];
  if (!url) {
    throw new Error('no stream URL for "' + id + '" yet — see STREAM_URLS in adapters.js');
  }
  return url;
}

const STATIONS = [
  {
    id: '101x',
    name: '101X',
    sub: 'KROX 101.5 · Austin, TX',
    badge: 'StreamGuys',
    async getStreamUrl() {
      // Static URL — the session lives inside the playlist the server builds
      // per request, not in the URL, so there's nothing to resolve here.
      return resolveStream(this.id);
    }
  },
  {
    id: 'the-bone',
    name: 'The Bone',
    sub: 'WHPT 102.5 · Tampa, FL',
    badge: 'StreamGuys',
    async getStreamUrl() {
      return resolveStream(this.id);
    }
  },
  {
    id: 'the-zone',
    name: 'The Zone',
    sub: '93.7 / 1150 · College Station, TX',
    badge: 'SecureNet',
    async getStreamUrl() {
      return resolveStream(this.id);
    }
  },
  {
    id: 'defcon',
    name: 'DEF CON',
    sub: 'SomaFM · hacker radio',
    badge: 'SomaFM',
    async getStreamUrl() {
      return resolveStream(this.id);
    }
  }
];
