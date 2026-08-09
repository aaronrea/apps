/* ---------------------------------------------------------------------------
 * Slate — the offline cache
 *
 * The last good set of games, in localStorage. This is the whole offline
 * story: the service worker keeps the shell, this keeps the content. Opening
 * the app on a plane shows last night's schedule, marked stale, instead of a
 * spinner and an apology.
 *
 * Normalised games are stored rather than raw ESPN payloads — about 3KB for
 * three teams instead of about a megabyte, and it means a change to the
 * normaliser can never be defeated by a cache written by the old one (that is
 * what the version in KEY is for; bump it when the game shape changes).
 * ------------------------------------------------------------------------- */

const KEY = 'slate.games.v1';

/* Safari in private mode throws on access rather than returning null, so
 * every call is wrapped. No cache is a slower app, not a broken one. */
function storage() {
  try {
    return window.localStorage;
  } catch (error) {
    return null;
  }
}

export function readCache() {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.games) || !parsed.fetchedAt) return null;

    return { games: parsed.games, fetchedAt: parsed.fetchedAt };
  } catch (error) {
    /* Corrupt or half-written — drop it rather than carry it forward. */
    clearCache();
    return null;
  }
}

export function writeCache(games, fetchedAt) {
  const store = storage();
  if (!store) return false;

  try {
    store.setItem(KEY, JSON.stringify({ games, fetchedAt }));
    return true;
  } catch (error) {
    /* Quota, most likely. Nothing to do about it and nothing worth saying. */
    return false;
  }
}

export function clearCache() {
  const store = storage();
  if (!store) return;
  try { store.removeItem(KEY); } catch (error) { /* nothing to clean up */ }
}
