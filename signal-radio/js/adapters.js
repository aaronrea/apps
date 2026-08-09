/* ---------------------------------------------------------------------------
 * Signal — station adapters
 *
 * A station is just a plain object:
 *
 *   { id, name, sub, badge, getStreamUrl: async () => "https://..." }
 *
 * getStreamUrl() is async and MUST be safe to call again at any time. Real
 * commercial stations don't publish a static stream URL — you ask a token /
 * session endpoint for a URL that is scoped to your session and expires, so
 * every (re)start and every retry needs a fresh call.
 *
 * The three getStreamUrl() bodies below are deliberately unfinished: each one
 * is a TODO describing what it will eventually do, followed by a call to the
 * shared placeholder so the app is fully playable and testable today.
 * ------------------------------------------------------------------------- */

/* --- Temporary placeholder ------------------------------------------------
 * SomaFM publishes plain, public, static HTTPS streams with no token dance.
 * They stand in for the real feeds so playback, retry, MediaSession and the
 * service worker can all be exercised end to end. Delete this block once the
 * real token endpoints are wired up.
 * ------------------------------------------------------------------------ */
const PLACEHOLDER_STREAMS = {
  '101x': 'https://ice1.somafm.com/indiepop-128-mp3',
  'the-bone': 'https://ice1.somafm.com/metal-128-mp3',
  'westwood-one': 'https://ice1.somafm.com/dronezone-128-mp3'
};

async function placeholderStream(id) {
  return PLACEHOLDER_STREAMS[id];
}

const STATIONS = [
  {
    id: '101x',
    name: '101X',
    sub: 'Austin, TX · Alternative',
    badge: 'iHeart',
    async getStreamUrl() {
      // TODO(real feed): KROX-FM / 101X is hosted by iHeart.
      // Sniff the playback request the iHeart web player makes, then here:
      //   1. POST to the iHeart stream/session endpoint for this station id
      //      (it hands back a session-scoped, expiring stream URL — usually
      //      an HLS .m3u8 or a shoutcast-style URL with a token query param).
      //   2. Parse the JSON response and return the resolved URL.
      // Call it fresh every time: the URL expires, so cached values will 403.
      return placeholderStream(this.id);
    }
  },
  {
    id: 'the-bone',
    name: 'The Bone',
    sub: 'Tampa, FL · WHPT 102.5',
    badge: 'Audacy',
    async getStreamUrl() {
      // TODO(real feed): WHPT 102.5 The Bone is hosted by Audacy.
      // Sniff the Audacy web player, then here:
      //   1. Hit the Audacy stream/auth endpoint for this station to get a
      //      session-scoped playback URL (again typically HLS + token).
      //   2. Return the resolved URL.
      // Re-fetched on every play and on every retry, since tokens expire.
      return placeholderStream(this.id);
    }
  },
  {
    id: 'westwood-one',
    name: 'Westwood One',
    sub: 'NFL & Texas A&M football',
    badge: 'Westwood One',
    async getStreamUrl() {
      // TODO(real feed): a Westwood One affiliate carrying the national
      // NFL / Texas A&M play-by-play feeds.
      // Sniff the affiliate's player, then here:
      //   1. Resolve the affiliate's current stream endpoint (these often sit
      //      behind a playlist redirect and/or a per-session token).
      //   2. Return the resolved URL.
      // Note: the affiliate may carry different programming outside game
      // windows — that's expected, this adapter just returns whatever is live.
      return placeholderStream(this.id);
    }
  }
];
