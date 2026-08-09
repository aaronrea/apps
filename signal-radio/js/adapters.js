/* ---------------------------------------------------------------------------
 * Signal — station adapters
 *
 * A station is just a plain object:
 *
 *   { id, name, sub, badge, getStreamUrl: async () => "https://..." }
 *
 * getStreamUrl() is async and MUST be safe to call again at any time. Real
 * commercial stations don't publish a static stream URL — you ask a token /
 * session endpoint for a URL scoped to your session, so every (re)start and
 * every retry needs a fresh call.
 *
 * TO WIRE A STATION: paste its URL into STREAM_URLS below. That's the only
 * edit needed. Each entry has a comment saying exactly where to find it.
 * ------------------------------------------------------------------------- */

const STREAM_URLS = {

  // 101X — KROX-FM 101.5, Austin TX. iHeart.
  // iHeart streams look like https://stream.revma.ihrhls.com/zcNNNN — the
  // NNNN is opaque and per-station, so it has to be read, not guessed.
  // Get it: open https://www.101x.com/listen-live/, View Source, search the
  // page for "ihrhls". (Or DevTools → Network → play → find the stream.)
  '101x': '',

  // The Bone — WHPT 102.5, Tampa FL.
  // Heads up: Wikipedia lists WHPT's owner as Cox Media Group, not Audacy —
  // worth confirming which player you're actually sniffing. If it's on
  // StreamTheWorld (what Audacy and many Cox stations use), the URL looks
  // like https://playerservices.streamtheworld.com/api/livestream-redirect/
  // <MOUNT>.aac, where <MOUNT> is usually the call sign + FMAAC.
  // Get it: DevTools → Network on https://www.theboneonline.com/ → hit play.
  'the-bone': '',

  // The Zone — KZNE 1150 AM / K229DK 93.7 FM, College Station TX.
  // Carries Texas A&M football; also a Westwood One affiliate for NFL.
  // Small-market stations are usually the easy case — often a plain, static
  // Shoutcast/Icecast URL with no token at all.
  // Get it: DevTools → Network on https://www.zone1150.com/ → hit play.
  'the-zone': '',

  // SomaFM DEF CON — public, static, no token. Already wired.
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
    badge: 'iHeart',
    async getStreamUrl() {
      // TODO: paste the sniffed URL into STREAM_URLS['101x'] above.
      // If iHeart turns out to hand back a short-lived tokenised URL rather
      // than a stable one, replace this line with the fetch that resolves it
      // — the function is already re-called on every play and every retry.
      return resolveStream(this.id);
    }
  },
  {
    id: 'the-bone',
    name: 'The Bone',
    sub: 'WHPT 102.5 · Tampa, FL',
    badge: 'Audacy',
    async getStreamUrl() {
      // TODO: paste the sniffed URL into STREAM_URLS['the-bone'] above.
      // Same note as 101X: if it's session-scoped, do the fetch here instead.
      return resolveStream(this.id);
    }
  },
  {
    id: 'the-zone',
    name: 'The Zone',
    sub: '93.7 / 1150 · College Station, TX',
    badge: 'KZNE',
    async getStreamUrl() {
      // TODO: paste the sniffed URL into STREAM_URLS['the-zone'] above.
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
